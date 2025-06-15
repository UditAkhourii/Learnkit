import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  processLearningQuestion, 
  generateImage, 
  processFollowUpQuestion,
  generateAssistantVisualization,
  generateLearningResourcesWithLinks,
  generatePromptSuggestions,
  generateImageCaptions
} from "./openai";
import { 
  insertCanvasElementSchema, 
  insertConnectionSchema, 
  insertCanvasSchema,
  insertCollaboratorSchema,
  type InsertConnection,
  type InsertCollaborator
} from "@shared/schema";
import { ZodError } from "zod";
import { setupAuth } from "./auth";
import { hashPassword } from "./auth";
import { client } from "./db";
import { WebSocketServer, WebSocket } from 'ws';
import type { WebSocket as WSType } from 'ws';

// WebSocket readyState constants for more readable code
const WS_CONNECTING = WebSocket.CONNECTING;
const WS_OPEN = WebSocket.OPEN;
const WS_CLOSING = WebSocket.CLOSING;
const WS_CLOSED = WebSocket.CLOSED;

// Define a custom interface that extends the WebSocket type with our custom properties
interface ExtendedWebSocket extends WSType {
  isAlive?: boolean;
  userId?: number;
  canvasId?: number;
  username?: string;
  lastActivity?: number;
  connectionId?: string;
}

// WebSocket state constants are defined above using WebSocket constants

// Define types for the WebSocket messages
interface WebSocketMessage {
  type: string;
  payload: any;
  canvasId: number;
  userId: number;
  username: string;
}

// Store active connections by canvas ID
const canvasConnections = new Map<number, Map<number, ExtendedWebSocket>>();

// Get connections for a specific canvas
function getCanvasConnections(canvasId: number): Map<number, ExtendedWebSocket> {
  if (!canvasConnections.has(canvasId)) {
    canvasConnections.set(canvasId, new Map<number, ExtendedWebSocket>());
  }
  return canvasConnections.get(canvasId)!;
}

// Helper to check if a WebSocket is actually open and connectable
function isSocketConnected(socket: ExtendedWebSocket): boolean {
  return socket && socket.readyState === WS_OPEN;
}

// Helper to safely send a message to a WebSocket
function safeSendMessage(socket: ExtendedWebSocket, message: any, userId: number): boolean {
  if (!isSocketConnected(socket)) {
    return false;
  }
  
  try {
    // Make sure we're sending a string
    const messageString = typeof message === 'string' ? message : JSON.stringify(message);
    socket.send(messageString);
    return true;
  } catch (error) {
    console.error(`Error sending message to user ${userId}:`, error);
    return false;
  }
}

// Send message to all users connected to a specific canvas except the sender
function broadcastToCanvas(canvasId: number, message: WebSocketMessage, excludeUserId?: number) {
  const connections = getCanvasConnections(canvasId);
  console.log(`Broadcasting to ${connections.size} connections for canvas ${canvasId}, message type: ${message.type}`);
  
  if (connections.size === 0) {
    // No connections to process
    return;
  }
  
  // Prepare the message string once to improve performance
  const messageString = JSON.stringify(message);
  
  let successCount = 0;
  let closedCount = 0;
  let skippedCount = 0;
  
  // First identify closed connections to clean up
  const toRemove: number[] = [];
  
  connections.forEach((socket, userId) => {
    // Skip the sender if specified
    if (excludeUserId !== undefined && userId === excludeUserId) {
      skippedCount++;
      return;
    }
    
    // Check if we have a valid socket reference
    if (!socket) {
      toRemove.push(userId);
      console.log(`No socket found for user ${userId}, removing from connections`);
      return;
    }
    
    // Use the helper method to check connection state
    if (!isSocketConnected(socket)) {
      // Mark for removal if the socket is not open
      if (socket.readyState === WS_CLOSED || socket.readyState === WS_CLOSING) {
        toRemove.push(userId);
        closedCount++;
        console.log(`Socket for user ${userId} is ${socket.readyState === WS_CLOSED ? 'CLOSED' : 'CLOSING'}, removing from connections`);
      } else {
        console.log(`Socket for user ${userId} is in state ${socket.readyState}, not sending message`);
      }
    } else {
      // Socket is connected, try to send
      if (safeSendMessage(socket, messageString, userId)) {
        successCount++;
      } else {
        // If sending failed, mark for removal
        toRemove.push(userId);
        console.error(`Failed to send message to user ${userId}, removing from active connections`);
      }
    }
  });
  
  // Clean up closed or failed connections
  for (const userId of toRemove) {
    connections.delete(userId);
    console.log(`Removed user ${userId} connection from canvas ${canvasId}`);
  }
  
  // More detailed logging
  console.log(`Broadcast complete: sent to ${successCount} clients, skipped ${skippedCount}, removed ${closedCount} inactive connections`);
  
  // For active user tracking, log the current connected users
  if (connections.size > 0) {
    console.log(`Current active users on canvas ${canvasId}: ${Array.from(connections.keys()).join(', ')}`);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication routes
  setupAuth(app);
  // API endpoint for processing learning questions
  app.post("/api/generate", async (req: Request, res: Response) => {
    try {
      const { question } = req.body;
      
      if (!question || typeof question !== "string") {
        return res.status(400).json({ message: "Question is required" });
      }
      
      const aiResponse = await processLearningQuestion(question);
      return res.json(aiResponse);
    } catch (error) {
      console.error("Error generating content:", error);
      return res.status(500).json({ message: `Failed to generate content: ${(error as Error).message}` });
    }
  });
  
  // API endpoint for processing follow-up questions on existing elements
  app.post("/api/follow-up", async (req: Request, res: Response) => {
    try {
      const { elementType, elementContent, question, originalQuestion, previousResponses } = req.body;
      
      if (!elementType || !elementContent || !question) {
        return res.status(400).json({ message: "Element type, element content, and question are required" });
      }
      
      const followUpResponse = await processFollowUpQuestion(
        elementType, 
        elementContent, 
        question,
        originalQuestion,
        previousResponses
      );
      return res.json(followUpResponse);
    } catch (error) {
      console.error("Error processing follow-up question:", error);
      return res.status(500).json({ message: `Failed to process follow-up question: ${(error as Error).message}` });
    }
  });

  // API endpoint for generating images
  app.post("/api/generate-image", async (req: Request, res: Response) => {
    try {
      const { prompt, count = 3 } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ message: "Prompt is required" });
      }
      
      // Generate multiple images for a visualization-centric learning experience
      const imageUrls = await generateImage(prompt, count);
      
      // Generate captions for the images
      const imageCaptions = await generateImageCaptions(prompt, imageUrls);
      
      return res.json({ 
        imageUrls,
        imageCaptions
      });
    } catch (error) {
      console.error("Error generating image:", error);
      return res.status(500).json({ message: `Failed to generate image: ${(error as Error).message}` });
    }
  });
  
  // API endpoint for specialized educational visualizations using the assistant
  app.post("/api/generate-specialized-visualization", async (req: Request, res: Response) => {
    try {
      const { prompt, topic } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ message: "Prompt is required" });
      }
      
      console.log(`Generating specialized visualization for: ${prompt}`);
      const visualization = await generateAssistantVisualization(prompt);
      return res.json({ visualization });
    } catch (error) {
      console.error("Error generating specialized visualization:", error);
      return res.status(500).json({ 
        message: `Failed to generate specialized visualization: ${(error as Error).message}`,
        fallback: true
      });
    }
  });
  
  // API endpoint for generating learning resources with live links
  app.post("/api/generate-learning-resources", async (req: Request, res: Response) => {
    try {
      const { topic } = req.body;
      
      if (!topic || typeof topic !== "string") {
        return res.status(400).json({ message: "Topic is required" });
      }
      
      console.log(`Generating learning resources for: ${topic}`);
      const resources = await generateLearningResourcesWithLinks(topic);
      return res.json({ resources });
    } catch (error) {
      console.error("Error generating learning resources:", error);
      return res.status(500).json({ 
        message: `Failed to generate learning resources: ${(error as Error).message}`,
        fallback: true
      });
    }
  });
  
  // API endpoint for generating AI-powered prompt suggestions
  app.get("/api/prompt-suggestions", async (req: Request, res: Response) => {
    try {
      const topic = req.query.topic as string | undefined;
      console.log(`Generating prompt suggestions${topic ? ` for topic: ${topic}` : ''}`);
      
      const suggestions = await generatePromptSuggestions(topic);
      return res.json({ suggestions });
    } catch (error) {
      console.error("Error generating prompt suggestions:", error);
      return res.status(500).json({ 
        message: `Failed to generate prompt suggestions: ${(error as Error).message}`,
        fallback: true
      });
    }
  });

  // Canvas element CRUD operations
  app.get("/api/canvas-elements", async (_req: Request, res: Response) => {
    try {
      const elements = await storage.getAllCanvasElements();
      return res.json(elements);
    } catch (error) {
      return res.status(500).json({ message: `Failed to fetch canvas elements: ${(error as Error).message}` });
    }
  });

  app.post("/api/canvas-elements", async (req: Request, res: Response) => {
    try {
      const validatedData = insertCanvasElementSchema.parse(req.body);
      const element = await storage.createCanvasElement(validatedData);
      return res.status(201).json(element);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      return res.status(500).json({ message: `Failed to create canvas element: ${(error as Error).message}` });
    }
  });

  app.put("/api/canvas-elements/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const element = await storage.updateCanvasElement(id, req.body);
      if (!element) {
        return res.status(404).json({ message: `Canvas element with ID ${id} not found` });
      }
      
      return res.json(element);
    } catch (error) {
      return res.status(500).json({ message: `Failed to update canvas element: ${(error as Error).message}` });
    }
  });

  app.delete("/api/canvas-elements/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const success = await storage.deleteCanvasElement(id);
      if (!success) {
        return res.status(404).json({ message: `Canvas element with ID ${id} not found` });
      }
      
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ message: `Failed to delete canvas element: ${(error as Error).message}` });
    }
  });

  // Connection CRUD operations
  app.get("/api/connections", async (_req: Request, res: Response) => {
    try {
      const connections = await storage.getAllConnections();
      return res.json(connections);
    } catch (error) {
      return res.status(500).json({ message: `Failed to fetch connections: ${(error as Error).message}` });
    }
  });

  app.post("/api/connections", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      console.log('Creating connection:', JSON.stringify(req.body));
      
      // Check if the source and target IDs are provided
      if (!req.body.source && !req.body.target) {
        return res.status(400).json({ message: "Missing source or target" });
      }
      
      // Handle ReactFlow style connections
      const connectionData: Partial<InsertConnection> = {
        canvasId: req.body.canvasId,
        type: req.body.type || 'default',
        animated: req.body.animated || false,
        // Store source and target in style
        style: {
          source: req.body.source,
          target: req.body.target,
          ...(req.body.style || {})
        }
      };
      
      // Try to parse source/target as integers if they are numeric
      try {
        if (req.body.source && !isNaN(parseInt(req.body.source))) {
          connectionData.sourceId = parseInt(req.body.source);
        }
      } catch (err) {
        console.log('Could not parse source as integer');
      }
      
      try {
        if (req.body.target && !isNaN(parseInt(req.body.target))) {
          connectionData.targetId = parseInt(req.body.target);
        }
      } catch (err) {
        console.log('Could not parse target as integer');
      }
      
      // Validate and create the connection
      const validatedData = insertConnectionSchema.parse(connectionData);
      const connection = await storage.createConnection(validatedData);
      
      console.log(`Created connection with ID ${connection.id} (${connection.sourceId} -> ${connection.targetId})`);
      
      return res.status(201).json(connection);
    } catch (error) {
      if (error instanceof ZodError) {
        console.error('Validation error:', error.errors);
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      console.error('Error creating connection:', error);
      return res.status(500).json({ message: `Failed to create connection: ${(error as Error).message}` });
    }
  });

  app.delete("/api/connections/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const success = await storage.deleteConnection(id);
      if (!success) {
        return res.status(404).json({ message: `Connection with ID ${id} not found` });
      }
      
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ message: `Failed to delete connection: ${(error as Error).message}` });
    }
  });

  // Canvas CRUD operations
  app.get("/api/canvases", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      console.log(`Fetching canvases for user ID: ${req.user!.id}, username: ${req.user!.username} (isAdmin: ${req.user!.isAdmin})`);
      
      let canvases;
      // If user is admin, get all canvases, otherwise just the user's canvases and public canvases
      if (req.user!.isAdmin) {
        canvases = await storage.getAllCanvases();
        console.log(`Admin user fetched all ${canvases.length} canvases`);
      } else {
        // Get user's own canvases and public canvases from other users
        canvases = await storage.getUserCanvasesAndPublic(req.user!.id);
        console.log(`Found ${canvases.length} canvases for user ID: ${req.user!.id} (including public canvases)`);
      }
      
      return res.json(canvases);
    } catch (error) {
      console.error(`Error fetching canvases for user ID ${req.user!.id}:`, error);
      return res.status(500).json({ message: `Failed to fetch canvases: ${(error as Error).message}` });
    }
  });

  app.get("/api/canvases/:id", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      console.log(`Fetching canvas ID: ${id} for user ID: ${req.user!.id}`);
      const canvas = await storage.getCanvas(id);
      if (!canvas) {
        console.log(`Canvas with ID ${id} not found`);
        return res.status(404).json({ message: `Canvas with ID ${id} not found` });
      }
      
      console.log(`Canvas ${id} belongs to User ID: ${canvas.userId}, current user is: ${req.user!.id} (isAdmin: ${req.user!.isAdmin})`);
      
      // Check if user has access to this canvas (owner, admin, collaborator, or public)
      const hasAccess = await storage.userHasAccessToCanvas(req.user!.id, id);
      // Admin override
      const isAdmin = req.user!.isAdmin === true;
      
      if (!hasAccess && !isAdmin) {
        console.error(`Access denied: User ID ${req.user!.id} does not have access to Canvas ${id}`);
        return res.status(403).json({ message: "Forbidden" });
      }
      
      return res.json(canvas);
    } catch (error) {
      console.error(`Error fetching canvas ID ${req.params.id}:`, error);
      return res.status(500).json({ message: `Failed to fetch canvas: ${(error as Error).message}` });
    }
  });

  app.post("/api/canvases", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      console.log(`Creating canvas for user ID: ${req.user!.id}, username: ${req.user!.username}`);
      
      const userData = { ...req.body, userId: req.user!.id };
      const validatedData = insertCanvasSchema.parse(userData);
      const canvas = await storage.createCanvas(validatedData);
      
      console.log(`Created new canvas "${canvas.name}" (ID: ${canvas.id}) for user ID: ${req.user!.id}`);
      
      return res.status(201).json(canvas);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      return res.status(500).json({ message: `Failed to create canvas: ${(error as Error).message}` });
    }
  });

  app.put("/api/canvases/:id", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // Check if canvas exists and belongs to the user
      const existingCanvas = await storage.getCanvas(id);
      if (!existingCanvas) {
        return res.status(404).json({ message: `Canvas with ID ${id} not found` });
      }
      
      if (existingCanvas.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Update the canvas
      const updatedData = { 
        ...req.body,
        updatedAt: new Date()
      };
      
      const updatedCanvas = await storage.updateCanvas(id, updatedData);
      return res.json(updatedCanvas);
    } catch (error) {
      return res.status(500).json({ message: `Failed to update canvas: ${(error as Error).message}` });
    }
  });

  app.delete("/api/canvases/:id", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // Check if canvas belongs to the user or user is admin
      const canvas = await storage.getCanvas(id);
      if (!canvas) {
        return res.status(404).json({ message: `Canvas with ID ${id} not found` });
      }
      
      if (canvas.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const success = await storage.deleteCanvas(id);
      if (!success) {
        return res.status(404).json({ message: `Canvas with ID ${id} not found` });
      }
      
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ message: `Failed to delete canvas: ${(error as Error).message}` });
    }
  });
  
  // Canvas state endpoints (elements and connections)
  app.get("/api/canvases/:id/state", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      
      // Check if canvas exists
      const canvas = await storage.getCanvas(id);
      if (!canvas) {
        return res.status(404).json({ message: `Canvas with ID ${id} not found` });
      }
      
      console.log(`Canvas ${id} belongs to User ID: ${canvas.userId}, current user is: ${req.user!.id} (isAdmin: ${req.user!.isAdmin})`);
      
      // Check if user has access to this canvas (owner, admin, collaborator, or public)
      const hasAccess = await storage.userHasAccessToCanvas(req.user!.id, id);
      // Admin override
      const isAdmin = req.user!.isAdmin === true;
      
      if (!hasAccess && !isAdmin) {
        return res.status(403).json({ 
          message: "You don't have permission to access this whiteboard",
          canvasOwner: canvas.userId,
          currentUser: req.user!.id
        });
      }
      
      // Use raw SQL for better control
      const elementsResult = await client`
        SELECT * FROM canvas_elements WHERE canvas_id = ${id}
      `;

      // ENHANCED: Query connections with more comprehensive element data
      // This improves connection reconstruction by providing multiple ID references
      const connectionsResult = await client`
        WITH 
          element_mapping AS (
            SELECT id, canvas_id, content, style, type FROM canvas_elements WHERE canvas_id = ${id}
          )
        SELECT 
          c.id, 
          c.canvas_id, 
          c.source_id, 
          c.target_id, 
          c.type, 
          c.animated, 
          c.style,
          source_el.content as source_content,
          target_el.content as target_content,
          source_el.style as source_style,
          target_el.style as target_style,
          source_el.type as source_type,
          target_el.type as target_type
        FROM 
          connections c
        LEFT JOIN 
          element_mapping source_el ON c.source_id = source_el.id
        LEFT JOIN 
          element_mapping target_el ON c.target_id = target_el.id
        WHERE 
          c.canvas_id = ${id}
        ORDER BY 
          c.id ASC
      `;
      
      console.log(`Retrieved ${elementsResult.length} elements and ${connectionsResult.length} connections for canvas ${id}`);
      if (elementsResult.length > 0) {
        console.log('First element sample:', JSON.stringify(elementsResult[0]).substring(0, 150));
      }
      
      // Log connection details for debugging
      if (connectionsResult.length > 0) {
        console.log('Connection samples:');
        connectionsResult.slice(0, 3).forEach((conn, idx) => {
          console.log(`Connection ${idx}: id=${conn.id}, source_id=${conn.source_id}, target_id=${conn.target_id}, style=${typeof conn.style === 'string' ? conn.style.substring(0, 100) : JSON.stringify(conn.style).substring(0, 100)}...`);
        });
      } else {
        console.log('No connections found for this canvas');
      }
      
      // Always create the element ID map for connection resolution
      const elementIdMap = new Map();
      const clientIdToDbIdMap = new Map();
      
      // Process all elements
      if (elementsResult.length > 0) {
        // First pass - extract all ID information from elements and build mapping
        elementsResult.forEach(el => {
          const dbId = el.id;
          let clientId = dbId.toString(); // Default client ID is string version of DB ID
          let originalClientId = null;
          
          // Try to extract the client ID from the style or content for better ID consistency
          try {
            // Parse style to check for client ID
            let styleObj: Record<string, any> = {};
            if (typeof el.style === 'string') {
              styleObj = JSON.parse(el.style);
            } else if (el.style && typeof el.style === 'object') {
              styleObj = el.style as Record<string, any>;
            }
            
            if ('clientId' in styleObj && styleObj.clientId) {
              originalClientId = styleObj.clientId;
            } else if ('originalId' in styleObj && styleObj.originalId) {
              originalClientId = styleObj.originalId;
            }
            
            // If we found an original client ID, use it
            if (originalClientId) {
              clientId = originalClientId;
            }
            
            // Also check content for client ID as backup
            let contentObj: Record<string, any> = {};
            if (typeof el.content === 'string') {
              contentObj = JSON.parse(el.content);
            } else if (el.content && typeof el.content === 'object') {
              contentObj = el.content as Record<string, any>;
            }
            
            if ('_clientId' in contentObj && contentObj._clientId && !originalClientId) {
              clientId = contentObj._clientId;
            }
            
          } catch (err) {
            console.error(`Error extracting client ID from element ${dbId}:`, err);
          }
          
          // Create bidirectional mapping
          elementIdMap.set(dbId, clientId);
          clientIdToDbIdMap.set(clientId, dbId);
          
          console.log(`Mapped element: DB ID ${dbId} <--> Client ID ${clientId}`);
        });
        
        console.log(`Created element ID map with ${elementIdMap.size} entries`);
      }
      
      // Map database results to expected format (client-side objects)
      const elements = elementsResult.map(el => {
        try {
          // Parse JSON fields that are stored as strings
          let parsedPosition;
          let parsedStyle;
          let parsedSize;
          let parsedContent;
          
          try {
            // Parse position if it's a string
            parsedPosition = typeof el.position === 'string' 
              ? JSON.parse(el.position) 
              : (el.position || { x: 100, y: 100 });
          } catch (err) {
            console.error(`Failed to parse position for element ${el.id}:`, err);
            parsedPosition = { x: 100, y: 100 };
          }
          
          try {
            // Parse style if it's a string
            parsedStyle = typeof el.style === 'string' 
              ? JSON.parse(el.style) 
              : (el.style || {});
          } catch (err) {
            console.error(`Failed to parse style for element ${el.id}:`, err);
            parsedStyle = {};
          }
          
          try {
            // Parse size if it's a string
            parsedSize = typeof el.size === 'string' 
              ? JSON.parse(el.size) 
              : el.size;
          } catch (err) {
            console.error(`Failed to parse size for element ${el.id}:`, err);
            parsedSize = undefined;
          }
          
          try {
            // Parse content if it's a string
            parsedContent = typeof el.content === 'string' 
              ? JSON.parse(el.content) 
              : (el.content || {});
          } catch (err) {
            console.error(`Failed to parse content for element ${el.id}:`, err);
            parsedContent = el.content || {};
          }
          
          // Map elementType to the correct React Flow node type
          // Default to textElement for safety
          let nodeType = 'textElement';
          
          // First try using the element_type field
          if (el.element_type === 'text') {
            nodeType = 'textElement';
          } else if (el.element_type === 'image') {
            nodeType = 'imageElement';
          } else if (el.element_type === 'equation') {
            nodeType = 'equationElement';
          } else if (el.element_type === 'diagram' || el.element_type === 'mindmap') {
            nodeType = 'diagramElement';
          } else if (el.element_type === 'code') {
            nodeType = 'codeElement';
          } else if (el.element_type === 'resource' || el.element_type === 'resources') {
            nodeType = 'resourceElement';
          }
          
          // Parse the content.type field if it exists (important for determining element type)
          let contentType = el.element_type || 'text';
          if (parsedContent && typeof parsedContent === 'object' && parsedContent.type) {
            contentType = parsedContent.type;
            
            // Re-map from content.type if element_type is not available
            if (!el.element_type) {
              if (contentType === 'text') {
                nodeType = 'textElement';
              } else if (contentType === 'image') {
                nodeType = 'imageElement';
              } else if (contentType === 'equation') {
                nodeType = 'equationElement';
              } else if (contentType === 'diagram') {
                nodeType = 'diagramElement';
              } else if (contentType === 'code') {
                nodeType = 'codeElement';
              } else if (contentType === 'resource' || contentType === 'resources') {
                nodeType = 'resourceElement';
              }
            }
          }
          
          // Get type from element.type field if it matches specific patterns
          if (typeof el.type === 'string') {
            if (el.type.includes('textElement')) {
              nodeType = 'textElement';
            } else if (el.type.includes('imageElement')) {
              nodeType = 'imageElement';
            } else if (el.type.includes('equationElement')) {
              nodeType = 'equationElement';
            } else if (el.type.includes('diagramElement')) {
              nodeType = 'diagramElement';
            } else if (el.type.includes('codeElement')) {
              nodeType = 'codeElement';
            } else if (el.type.includes('resourceElement')) {
              nodeType = 'resourceElement';
            }
          }
          
          console.log(`Processing element ${el.id}: type=${nodeType}, contentType=${contentType}`);
          
          // Return the formatted React Flow element
          return {
            id: el.id.toString(),
            type: nodeType,
            position: parsedPosition,
            data: {
              type: contentType,
              content: parsedContent,
              originalQuestion: el.original_question || ''
            },
            draggable: true,
            style: parsedStyle,
            size: parsedSize
          };
        } catch (error) {
          console.error(`Error processing element ${el.id}:`, error);
          // Return null for elements that can't be processed, we'll filter these out
          return null;
        }
      }).filter(Boolean);

      // Log element processing results
      console.log(`Successfully processed ${elements.length} elements for client`);
      if (elements.length > 0) {
        console.log('First processed element sample:', JSON.stringify(elements[0]).substring(0, 150));
      }
      
      const connections = connectionsResult.map(conn => {
        try {
          console.log(`Processing connection ${conn.id} for client:`, JSON.stringify(conn).substring(0, 200));
          
          // Parse the style field if it's a string
          let parsedStyle: Record<string, any> = {};
          try {
            if (typeof conn.style === 'string') {
              parsedStyle = JSON.parse(conn.style);
            } else if (conn.style) {
              parsedStyle = conn.style as Record<string, any>;
            }
          } catch (err) {
            console.error(`Failed to parse style for connection ${conn.id}:`, err);
          }
          
          console.log(`Connection ${conn.id} parsed style:`, parsedStyle);
          
          // Get source and target from the style object
          // ReactFlow requires source and target to be strings
          let source = '';
          let target = '';
          
          // First priority: Look for client IDs in the style object
          if (typeof parsedStyle === 'object' && parsedStyle !== null) {
            // Check for sourceClientId and targetClientId first (most reliable)
            if ('sourceClientId' in parsedStyle && parsedStyle.sourceClientId) {
              source = parsedStyle.sourceClientId.toString();
              console.log(`Found sourceClientId '${source}' in style object for connection ${conn.id}`);
            } else if ('sourceId' in parsedStyle && parsedStyle.sourceId) {
              source = parsedStyle.sourceId.toString();
              console.log(`Found sourceId '${source}' in style object for connection ${conn.id}`);
            } else if ('source' in parsedStyle && parsedStyle.source) {
              source = parsedStyle.source.toString();
              console.log(`Found source '${source}' in style object for connection ${conn.id}`);
            }
            
            if ('targetClientId' in parsedStyle && parsedStyle.targetClientId) {
              target = parsedStyle.targetClientId.toString();
              console.log(`Found targetClientId '${target}' in style object for connection ${conn.id}`);
            } else if ('targetId' in parsedStyle && parsedStyle.targetId) {
              target = parsedStyle.targetId.toString();
              console.log(`Found targetId '${target}' in style object for connection ${conn.id}`);
            } else if ('target' in parsedStyle && parsedStyle.target) {
              target = parsedStyle.target.toString();
              console.log(`Found target '${target}' in style object for connection ${conn.id}`);
            }
          }
          
          // ENHANCED CONNECTION LOOKUP: Check for source/target from content data
          // Look for client IDs in the source_content and target_content fields from our JOIN query
          if ((!source || source === 'undefined') && conn.source_content) {
            try {
              // Parse the content if it's a string
              const sourceContent = typeof conn.source_content === 'string' 
                ? JSON.parse(conn.source_content) 
                : conn.source_content;
                
              // Look for client ID in content
              if (sourceContent && typeof sourceContent === 'object') {
                if (sourceContent.clientId) {
                  source = sourceContent.clientId.toString();
                  console.log(`Found source from source_content.clientId: '${source}' for connection ${conn.id}`);
                } else if (sourceContent._clientId) {
                  source = sourceContent._clientId.toString();
                  console.log(`Found source from source_content._clientId: '${source}' for connection ${conn.id}`);
                }
              }
            } catch (e) {
              console.warn(`Error parsing source_content for connection ${conn.id}:`, e);
            }
          }
          
          if ((!target || target === 'undefined') && conn.target_content) {
            try {
              // Parse the content if it's a string
              const targetContent = typeof conn.target_content === 'string' 
                ? JSON.parse(conn.target_content) 
                : conn.target_content;
                
              // Look for client ID in content
              if (targetContent && typeof targetContent === 'object') {
                if (targetContent.clientId) {
                  target = targetContent.clientId.toString();
                  console.log(`Found target from target_content.clientId: '${target}' for connection ${conn.id}`);
                } else if (targetContent._clientId) {
                  target = targetContent._clientId.toString();
                  console.log(`Found target from target_content._clientId: '${target}' for connection ${conn.id}`);
                }
              }
            } catch (e) {
              console.warn(`Error parsing target_content for connection ${conn.id}:`, e);
            }
          }
          
          // ENHANCED CONNECTION LOOKUP: Check for source/target from style data
          if ((!source || source === 'undefined') && conn.source_style) {
            try {
              // Parse the style if it's a string
              const sourceStyle = typeof conn.source_style === 'string' 
                ? JSON.parse(conn.source_style) 
                : conn.source_style;
                
              // Look for client ID in style
              if (sourceStyle && typeof sourceStyle === 'object' && sourceStyle.clientId) {
                source = sourceStyle.clientId.toString();
                console.log(`Found source from source_style.clientId: '${source}' for connection ${conn.id}`);
              }
            } catch (e) {
              console.warn(`Error parsing source_style for connection ${conn.id}:`, e);
            }
          }
          
          if ((!target || target === 'undefined') && conn.target_style) {
            try {
              // Parse the style if it's a string
              const targetStyle = typeof conn.target_style === 'string' 
                ? JSON.parse(conn.target_style) 
                : conn.target_style;
                
              // Look for client ID in style
              if (targetStyle && typeof targetStyle === 'object' && targetStyle.clientId) {
                target = targetStyle.clientId.toString();
                console.log(`Found target from target_style.clientId: '${target}' for connection ${conn.id}`);
              }
            } catch (e) {
              console.warn(`Error parsing target_style for connection ${conn.id}:`, e);
            }
          }
          
          // FALLBACK: If not found in content/style, try the DB columns and map to client IDs
          if ((!source || source === 'undefined') && conn.source_id) {
            // Try to find in the element map first
            if (elementIdMap.has(conn.source_id)) {
              source = elementIdMap.get(conn.source_id);
              console.log(`Mapped source DB ID ${conn.source_id} to client ID '${source}' for connection ${conn.id}`);
            } else {
              // Fallback to direct conversion
              source = conn.source_id.toString();
              console.log(`Using source_id '${source}' from DB for connection ${conn.id} (no mapping available)`);
            }
          }
          
          if ((!target || target === 'undefined') && conn.target_id) {
            // Try to find in the element map first
            if (elementIdMap.has(conn.target_id)) {
              target = elementIdMap.get(conn.target_id);
              console.log(`Mapped target DB ID ${conn.target_id} to client ID '${target}' for connection ${conn.id}`);
            } else {
              // Fallback to direct conversion
              target = conn.target_id.toString();
              console.log(`Using target_id '${target}' from DB for connection ${conn.id} (no mapping available)`);
            }
          }
          
          // Last resort checks
          if (!source || !target || source === 'undefined' || target === 'undefined') {
            console.warn(`Connection ${conn.id} has missing or invalid source/target. Source: '${source}', Target: '${target}'`);
            return null; // Return null to filter out invalid connections
          }
          
          // Log the connection source/target for debugging
          console.log(`Using connection ${conn.id} with source=${source}, target=${target}`);
          
          // Convert animated field to boolean
          let animatedValue = false;
          try {
            if (typeof conn.animated === 'string') {
              // It might be stored as JSON string "true" or "false"
              animatedValue = JSON.parse(conn.animated) === true;
            } else if (typeof conn.animated === 'boolean') {
              animatedValue = conn.animated;
            } else if (conn.animated && typeof conn.animated === 'object') {
              // It might be stored as a JSONB boolean
              animatedValue = Boolean(conn.animated);
            }
          } catch (err) {
            console.log(`Could not parse animated value for connection ${conn.id}, defaulting to false`);
          }
          
          // Return the formatted React Flow connection
          // Make sure source and target are strings
          const sourceStr = String(source);
          const targetStr = String(target);
          
          const connectionObject = {
            id: conn.id.toString(),
            source: sourceStr,
            target: targetStr,
            type: conn.type || 'smoothstep',
            animated: animatedValue,
            // Include styles
            style: {
              // Extract any existing style properties except source and target
              ...(Object.entries(parsedStyle).reduce((acc, [key, value]) => {
                if (key !== 'source' && key !== 'target') {
                  acc[key] = value;
                }
                return acc;
              }, {} as Record<string, any>)),
              // Ensure we have default styles for visibility
              stroke: (parsedStyle as any).stroke || '#6366f1',
              strokeWidth: (parsedStyle as any).strokeWidth || 2
            }
          };
          
          console.log(`Returning connection object:`, connectionObject);
          return connectionObject;
        } catch (error) {
          console.error(`Error processing connection ${conn.id}:`, error);
          // Return null for connections that can't be processed, we'll filter these out
          return null;
        }
      }).filter(Boolean);
      
      // Log connection processing results
      console.log(`Successfully processed ${connections.length} connections for client`);
      
      res.json({
        elements,
        connections
      });
    } catch (error) {
      console.error("Error fetching canvas state:", error);
      return res.status(500).json({ message: `Failed to fetch canvas state: ${(error as Error).message}` });
    }
  });
  
  app.put("/api/canvases/:id/state", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      
      // Check if canvas exists
      const canvas = await storage.getCanvas(id);
      if (!canvas) {
        return res.status(404).json({ message: `Canvas with ID ${id} not found` });
      }
      
      console.log(`Save request for canvas ${id} (User ID: ${req.user!.id}) with ${req.body.elements?.length || 0} elements and ${req.body.connections?.length || 0} connections`);
      console.log(`Canvas ${id} belongs to User ID: ${canvas.userId}, current user ID: ${req.user!.id} (isAdmin: ${req.user!.isAdmin})`);
      
      // Check if user is owner, admin, or collaborator
      const isOwner = canvas.userId === req.user!.id;
      const isAdmin = req.user!.isAdmin === true;
      const isCollaborator = await storage.isCollaborator(id, req.user!.id);
      
      // Public canvases can be viewed but not edited by non-collaborators
      // Only owners, admins, and collaborators can edit
      if (!isOwner && !isAdmin && !isCollaborator) {
        return res.status(403).json({ 
          message: "You don't have permission to save this whiteboard",
          canvasOwner: canvas.userId,
          currentUser: req.user!.id
        });
      }
      
      const { elements, connections } = req.body;
      
      // Log save request
      console.log(`Save request for canvas ${id} (User ID: ${req.user!.id}) with ${elements?.length} elements and ${connections?.length} connections`);
      console.log(`Canvas ${id} belongs to User ID: ${canvas.userId}, current user ID: ${req.user!.id} (isAdmin: ${req.user!.isAdmin})`);
      
      // Validate request data
      if (!Array.isArray(elements)) {
        return res.status(400).json({ message: "Invalid elements array" });
      }
      
      if (!Array.isArray(connections)) {
        return res.status(400).json({ message: "Invalid connections array" });
      }
      
      // Enhance elements with consistent client IDs for better persistence
      const enhancedElements = elements.map(element => {
        // Copy to avoid modifying original object
        const enhancedElement = { ...element };
        
        // Ensure ID is a string
        const elementId = String(enhancedElement.id);
        
        // Process style property
        if (enhancedElement.style) {
          // If style is a string (JSON), parse it first
          let styleObj = {};
          if (typeof enhancedElement.style === 'string') {
            try {
              styleObj = JSON.parse(enhancedElement.style);
            } catch (e) {
              console.warn(`Failed to parse style JSON, creating new style object`);
            }
          } else if (typeof enhancedElement.style === 'object') {
            styleObj = { ...enhancedElement.style };
          }
          
          // Add client ID into style
          styleObj = {
            ...styleObj,
            clientId: elementId,     // Current ID for connections
            originalId: elementId    // Original ID for tracking
          };
          
          // Set the enhanced style back
          enhancedElement.style = styleObj;
        } else {
          // Create new style object with IDs
          enhancedElement.style = {
            clientId: elementId,
            originalId: elementId
          };
        }
        
        // Process data.content property
        if (enhancedElement.data && enhancedElement.data.content) {
          let contentObj = {};
          
          // Parse content if it's a string
          if (typeof enhancedElement.data.content === 'string') {
            try {
              contentObj = JSON.parse(enhancedElement.data.content);
            } catch (e) {
              console.warn(`Failed to parse content JSON, creating new content object`);
            }
          } else if (typeof enhancedElement.data.content === 'object') {
            contentObj = { ...enhancedElement.data.content };
          }
          
          // Add redundant ID references
          contentObj = {
            ...contentObj,
            clientId: elementId,
            _clientId: elementId  // For backward compatibility
          };
          
          // Set enhanced content back
          enhancedElement.data.content = contentObj;
        } else {
          // Create content structure if missing
          if (!enhancedElement.data) {
            enhancedElement.data = { type: 'text' };
          }
          
          enhancedElement.data.content = {
            clientId: elementId,
            _clientId: elementId
          };
        }
        
        return enhancedElement;
      });
      
      // Process connections with enhanced elements
      const enhancedConnections = connections.map(conn => {
        // Create a processed copy of the connection with rich metadata
        const enhancedConn = { ...conn };
        
        // Make sure source and target are strings
        if (enhancedConn.source) enhancedConn.source = String(enhancedConn.source);
        if (enhancedConn.target) enhancedConn.target = String(enhancedConn.target);
        
        // Make sure style is an object
        if (!enhancedConn.style) enhancedConn.style = {};
        else if (typeof enhancedConn.style === 'string') {
          try {
            enhancedConn.style = JSON.parse(enhancedConn.style);
          } catch (e) {
            console.warn('Failed to parse connection style JSON, using empty object');
            enhancedConn.style = {};
          }
        }
        
        // Create a rich style object with multiple ID reference formats
        enhancedConn.style = {
          ...enhancedConn.style,
          // Original React Flow format
          source: enhancedConn.source,
          target: enhancedConn.target,
          
          // Explicit formats for redundancy
          sourceId: enhancedConn.source,
          targetId: enhancedConn.target,
          sourceClientId: enhancedConn.source,
          targetClientId: enhancedConn.target,
          
          // Connection styling
          type: enhancedConn.type || 'smoothstep',
          stroke: (enhancedConn.style as any)?.stroke || '#6366f1',
          strokeWidth: (enhancedConn.style as any)?.strokeWidth || 2
        };
        
        return enhancedConn;
      });
      
      // NOTE: No longer filtering connections here - we're delegating 
      // all connection validation to storage.ts which has robust ID mapping
      console.log(`Passing ${enhancedConnections.length} enhanced connections to the database`);
      
      try {
        // Use the improved storage method for saving canvas state with enhanced data
        const success = await storage.replaceCanvasState(id, enhancedElements, enhancedConnections);
        
        if (success) {
          res.json({ 
            success: true, 
            message: `Saved ${enhancedElements.length} elements and ${enhancedConnections.length} connections`,
            timestamp: new Date().toISOString()
          });
        } else {
          throw new Error("Failed to save canvas state");
        }
      } catch (dbError: unknown) {
        console.error("Database error during canvas save:", dbError);
        
        // Try one more time to update just the timestamp
        try {
          await storage.updateCanvas(id, { updatedAt: new Date() });
          return res.status(207).json({ 
            partial: true,
            message: "Canvas timestamp updated but elements and connections save failed",
            error: dbError instanceof Error ? dbError.message : String(dbError),
            timestamp: new Date().toISOString()
          });
        } catch (finalError) {
          return res.status(500).json({ 
            message: `Database error: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error: unknown) {
      console.error("Error saving canvas state:", error);
      return res.status(500).json({ 
        message: `Failed to save canvas state: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Admin routes
  // Middleware to check if user is an admin
  const isAdmin = (req: Request, res: Response, next: Function) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    if (!req.user!.isAdmin) {
      return res.status(403).json({ message: "Forbidden. Admin access required." });
    }
    
    next();
  };
  
  // Admin: Create admin account
  app.post("/api/admin/create", async (req: Request, res: Response) => {
    try {
      const { username, email, password } = req.body;
      
      // First check if this is the first user - if so, allow admin creation
      const users = await storage.getAllUsers();
      const firstUser = users.length === 0;
      
      // Only allow admin creation for the first user or by existing admins
      if (!firstUser && (!req.isAuthenticated() || !req.user!.isAdmin)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      
      // Create the admin user
      const hashedPassword = await hashPassword(password);
      const adminUser = await storage.createUser({
        username,
        email,
        password: hashedPassword,
      });
      
      // Set admin status
      await storage.setUserAdminStatus(adminUser.id, true);
      
      return res.status(201).json({ message: "Admin user created successfully" });
    } catch (error) {
      console.error("Error creating admin:", error);
      return res.status(500).json({ message: `Failed to create admin: ${(error as Error).message}` });
    }
  });
  
  // Admin: Get platform statistics
  app.get("/api/admin/stats", isAdmin, async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getStats();
      return res.json(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      return res.status(500).json({ message: `Failed to fetch stats: ${(error as Error).message}` });
    }
  });
  
  // Admin: Get all users
  app.get("/api/admin/users", isAdmin, async (_req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      // Don't expose password hashes
      const safeUsers = users.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });
      return res.json(safeUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      return res.status(500).json({ message: `Failed to fetch users: ${(error as Error).message}` });
    }
  });
  
  // Admin: Get user by ID
  app.get("/api/admin/users/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: `User with ID ${id} not found` });
      }
      
      // Don't expose password hash
      const { password, ...userWithoutPassword } = user;
      return res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error fetching user:", error);
      return res.status(500).json({ message: `Failed to fetch user: ${(error as Error).message}` });
    }
  });
  
  // Admin: Update user
  app.put("/api/admin/users/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: `User with ID ${id} not found` });
      }
      
      // Don't allow updating password via this endpoint
      const { password, id: userId, ...updateableFields } = req.body;
      
      const updatedUser = await storage.updateUser(id, updateableFields);
      if (!updatedUser) {
        return res.status(404).json({ message: `Failed to update user` });
      }
      
      // Don't expose password hash
      const { password: userPass, ...userWithoutPassword } = updatedUser;
      return res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error updating user:", error);
      return res.status(500).json({ message: `Failed to update user: ${(error as Error).message}` });
    }
  });
  
  // Admin: Delete user
  app.delete("/api/admin/users/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      
      // Don't allow deleting the current admin
      if (req.user && id === req.user!.id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      
      const success = await storage.deleteUser(id);
      if (!success) {
        return res.status(404).json({ message: `User with ID ${id} not found` });
      }
      
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      return res.status(500).json({ message: `Failed to delete user: ${(error as Error).message}` });
    }
  });
  
  // Admin: Set user admin status
  app.put("/api/admin/users/:id/admin", isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      
      const { isAdmin } = req.body;
      if (typeof isAdmin !== 'boolean') {
        return res.status(400).json({ message: "isAdmin must be a boolean" });
      }
      
      const updatedUser = await storage.setUserAdminStatus(id, isAdmin);
      if (!updatedUser) {
        return res.status(404).json({ message: `User with ID ${id} not found` });
      }
      
      // Don't expose password hash
      const { password, ...userWithoutPassword } = updatedUser;
      return res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error updating admin status:", error);
      return res.status(500).json({ message: `Failed to update admin status: ${(error as Error).message}` });
    }
  });
  
  // Admin: Get user's canvases
  app.get("/api/admin/users/:id/canvases", isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      
      // Verify user exists first
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: `User with ID ${id} not found` });
      }
      
      console.log(`Admin ${req.user!.username} (ID: ${req.user!.id}) viewing canvases for user ${user.username} (ID: ${id})`);
      
      const canvases = await storage.getUserCanvases(id);
      return res.json(canvases);
    } catch (error) {
      console.error("Error fetching user canvases:", error);
      return res.status(500).json({ message: `Failed to fetch user canvases: ${(error as Error).message}` });
    }
  });

  const httpServer = createServer(app);
  
  // Create WebSocket server for collaborative editing
  // Create a more robust WebSocket server with enhanced configuration
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws',
    // Enhanced WebSocket configuration
    clientTracking: true,
    // Increase timeouts and add more resilient settings
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024
      },
      concurrencyLimit: 10,
      threshold: 1024
    },
    // Increase max payload size
    maxPayload: 5 * 1024 * 1024 // 5 MB
  });
  
  // Add a heartbeat mechanism to keep connections alive
  function heartbeat(this: ExtendedWebSocket) {
    this.isAlive = true;
    this.lastActivity = Date.now();
    
    // Reduce log noise - only log occasionally
    if (Math.random() < 0.1) {
      const userId = this.userId || 'unknown';
      const canvasId = this.canvasId || 'none';
      console.log(`Heartbeat received from client ${userId} on canvas ${canvasId}`);
    }
    
    // Send a heartbeat acknowledgment to help client know the connection is still alive
    try {
      if (this.readyState === WS_OPEN) {
        this.send(JSON.stringify({
          type: 'heartbeat-ack',
          payload: { timestamp: Date.now() },
          canvasId: this.canvasId || 0,
          userId: this.userId || 0,
          username: 'server'
        }));
      }
    } catch (e) {
      // Don't log errors here to avoid log spam
    }
  }
  
  // Set up a ping interval to check for dead connections
  const pingInterval = setInterval(() => {
    let activeCount = 0;
    let inactiveCount = 0;
    
    wss.clients.forEach((ws) => {
      // Cast the WebSocket to our extended type
      const typedWs = ws as ExtendedWebSocket;
      
      if (typedWs.isAlive === false) {
        console.log(`Terminating inactive WebSocket connection for user ${typedWs.userId || 'unknown'}`);
        inactiveCount++;
        return typedWs.terminate();
      }
      
      activeCount++;
      typedWs.isAlive = false;
      try {
        typedWs.ping();
      } catch (e) {
        console.error(`Error pinging client ${typedWs.userId || 'unknown'}:`, e);
        // Force terminate if ping fails
        try {
          typedWs.terminate();
        } catch (terminateError) {
          console.error('Error terminating socket after ping failure:', terminateError);
        }
      }
    });
    
    // Log stats
    if (activeCount > 0 || inactiveCount > 0) {
      console.log(`WebSocket Stats: ${activeCount} active connections, ${inactiveCount} terminated`);
    }
    
  }, 20000); // Check every 20 seconds
  
  // Clean up interval on server close
  wss.on('close', () => {
    console.log('WebSocket server closing, clearing ping interval');
    clearInterval(pingInterval);
  });
  
  wss.on('connection', (ws: WSType, req) => {
    console.log('New WebSocket connection from', req.headers.origin, 'URL:', req.url);
    
    // Log connection details
    console.log('WebSocket connection details:', {
      ip: req.socket.remoteAddress,
      headers: {
        upgrade: req.headers.upgrade,
        connection: req.headers.connection,
        host: req.headers.host,
        origin: req.headers.origin,
        path: req.url
      }
    });
    
    // Cast the WebSocket to our extended type
    const typedWs = ws as ExtendedWebSocket;
    
    // Mark the connection as alive initially
    typedWs.isAlive = true;
    
    // Set up heartbeat response
    typedWs.on('pong', heartbeat);
    
    // Send initial confirmation to client that connection is established
    try {
      const initialMessage = {
        type: 'server-connection-established',
        payload: { 
          timestamp: Date.now(),
          message: 'Server connection established. Ready for canvas join.'
        },
        canvasId: 0,
        userId: 0,
        username: 'server'
      };
      console.log('Sending initial message to client:', initialMessage);
      typedWs.send(JSON.stringify(initialMessage));
    } catch (e) {
      console.error('Error sending initial confirmation:', e);
    }
    
    // Store user and canvas info
    let currentUserId: number | null = null;
    let currentCanvasId: number | null = null;
    
    // Handle messages from clients
    typedWs.on('message', async (message: any) => {
      try {
        // Make sure the connection is still active before processing the message
        if (typedWs.readyState !== WS_OPEN) {
          console.warn('Received message for non-open socket, dropping', typedWs.readyState);
          return;
        }
        
        const messageStr = message.toString();
        console.log('Received message:', messageStr.substring(0, 100) + (messageStr.length > 100 ? '...' : ''));
        
        // Parse the message data
        let data: WebSocketMessage;
        try {
          data = JSON.parse(messageStr) as WebSocketMessage;
        } catch (jsonError) {
          console.error('Failed to parse WebSocket message as JSON:', jsonError);
          try {
            // Send back an error message
            typedWs.send(JSON.stringify({
              type: 'error',
              payload: { error: 'Invalid JSON message format' },
              canvasId: 0,
              userId: 0,
              username: 'server'
            }));
          } catch (sendError) {
            console.error('Error sending JSON error message:', sendError);
          }
          return;
        }
        
        // Validate message structure
        if (!data.canvasId || !data.userId || !data.type) {
          console.error('Invalid message format, missing required fields');
          try {
            typedWs.send(JSON.stringify({
              type: 'error',
              payload: { error: 'Message missing required fields (canvasId, userId, or type)' },
              canvasId: data.canvasId || 0,
              userId: data.userId || 0,
              username: 'server'
            }));
          } catch (sendError) {
            console.error('Error sending validation error message:', sendError);
          }
          return;
        }
        
        const canvasId = data.canvasId;
        const userId = data.userId;
        
        // Store these for cleanup when connection closes
        currentUserId = userId;
        currentCanvasId = canvasId;
        
        // Store connection data in WebSocket object for easier access
        typedWs.userId = userId;
        typedWs.canvasId = canvasId;
        typedWs.username = data.username;
        
        // Update heartbeat to mark connection as alive when messaging
        typedWs.isAlive = true;
        
        // Store the connection for this user and canvas if not already stored
        const canvasUsers = getCanvasConnections(canvasId);
        const existingConnection = canvasUsers.get(userId);
        
        // If there's an existing connection and it's not this one, close the older one
        if (existingConnection && existingConnection !== typedWs) {
          console.log(`User ${userId} already has an active connection to canvas ${canvasId}. Replacing.`);
          try {
            existingConnection.close(1000, 'Replaced by newer connection');
          } catch (closeError) {
            console.error('Error closing replaced connection:', closeError);
          }
          // Remove old connection from map
          canvasUsers.delete(userId);
        }
        
        // Add this connection to the map
        canvasUsers.set(userId, typedWs);
        console.log(`User ${userId} connected to canvas ${canvasId}. Current connections: ${canvasUsers.size}`);
        
        // Send acknowledgment back to client
        try {
          typedWs.send(JSON.stringify({
            type: 'connection-acknowledged',
            payload: { 
              success: true, 
              timestamp: Date.now(),
              connectedUsers: Array.from(canvasUsers.keys())
            },
            canvasId,
            userId,
            username: data.username
          }));
        } catch (e) {
          console.error(`Error sending acknowledgment to user ${userId}:`, e);
        }
        
        // Handle different message types
        switch (data.type) {
          case 'join-canvas':
            console.log(`Processing join-canvas message for user ${userId} on canvas ${canvasId}`);
            
            // First, make sure this socket is properly registered
            if (!canvasUsers.has(userId) || canvasUsers.get(userId) !== typedWs) {
              console.log(`Re-registering user ${userId} connection for canvas ${canvasId}`);
              canvasUsers.set(userId, typedWs);
            }
            
            // Send the list of currently active users to the joining user
            try {
              const activeUsers = Array.from(canvasUsers.keys()).filter(id => id !== userId);
              console.log(`Sending active users to joining user ${userId}: [${activeUsers.join(', ')}]`);
              
              typedWs.send(JSON.stringify({
                type: 'active-users',
                payload: { users: activeUsers },
                canvasId,
                userId: 0, // Server message
                username: 'server'
              }));
            } catch (err) {
              console.error(`Error sending active users to joining user ${userId}:`, err);
            }
            
            // Then broadcast to others that this user has joined
            broadcastToCanvas(canvasId, {
              type: 'user-joined',
              payload: { userId: data.userId, username: data.username },
              canvasId,
              userId,
              username: data.username
            }, userId);
            break;
            
          case 'leave-canvas':
            console.log(`Processing leave-canvas message for user ${userId} on canvas ${canvasId}`);
            
            // User has left the canvas
            broadcastToCanvas(canvasId, {
              type: 'user-left',
              payload: { userId: data.userId, username: data.username },
              canvasId,
              userId,
              username: data.username
            }, userId);
            
            // Remove user from the connections
            if (canvasUsers.has(userId)) {
              console.log(`Removing user ${userId} from canvas ${canvasId} connections`);
              canvasUsers.delete(userId);
            }
            break;
            
          case 'canvas-update':
            // User has made changes to the canvas
            broadcastToCanvas(canvasId, {
              type: 'canvas-update',
              payload: data.payload,
              canvasId,
              userId,
              username: data.username
            }, userId);
            break;
            
          case 'cursor-position':
            // User has moved their cursor
            broadcastToCanvas(canvasId, {
              type: 'cursor-position',
              payload: data.payload,
              canvasId,
              userId,
              username: data.username
            }, userId);
            break;
            
          case 'heartbeat':
            // Client is sending a heartbeat to keep the connection alive
            // Mark the connection as alive
            typedWs.isAlive = true;
            
            // Only log occasionally to prevent log spam
            if (Math.random() < 0.1) { // Log approximately 10% of heartbeats
              console.log(`Received heartbeat from user ${userId} on canvas ${canvasId}`);
            }
            
            // No need to broadcast heartbeats to other clients
            break;
            
          default:
            console.log(`Unknown message type: ${data.type}`);
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });
    
    // Handle WebSocket close event
    typedWs.on('close', () => {
      console.log('WebSocket connection closed');
      
      // If we have stored user info in the WebSocket object, use that
      if (typedWs.userId && typedWs.canvasId) {
        const canvasUsers = getCanvasConnections(typedWs.canvasId);
        if (canvasUsers.has(typedWs.userId)) {
          canvasUsers.delete(typedWs.userId);
          console.log(`Removed user ${typedWs.userId} from canvas ${typedWs.canvasId}`);
          
          // Notify other users with the username if available
          broadcastToCanvas(typedWs.canvasId, {
            type: 'user-left',
            payload: { userId: typedWs.userId },
            canvasId: typedWs.canvasId,
            userId: typedWs.userId,
            username: typedWs.username || '' 
          });
          
          return; // We've found and handled the connection
        }
      }
      
      // Fallback: search all canvas connections if we don't have the info
      canvasConnections.forEach((users, canvasId) => {
        users.forEach((socket, userId) => {
          if (socket === typedWs) {
            users.delete(userId);
            console.log(`Removed user ${userId} from canvas ${canvasId}`);
            
            // Notify other users
            broadcastToCanvas(canvasId, {
              type: 'user-left',
              payload: { userId },
              canvasId,
              userId,
              username: '' // We don't know the username here
            });
          }
        });
      });
    });
  });
  
  // Add collaboration API endpoints
  
  // Get all collaborators for a canvas
  app.get("/api/canvases/:id/collaborators", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const canvasId = parseInt(req.params.id);
      if (isNaN(canvasId)) {
        return res.status(400).json({ message: "Invalid canvas ID" });
      }
      
      // Verify the user has access to the canvas
      const canvas = await storage.getCanvas(canvasId);
      if (!canvas) {
        return res.status(404).json({ message: "Canvas not found" });
      }
      
      // Only canvas owner and collaborators can see collaborators list
      const isOwner = canvas.userId === req.user!.id;
      const isCollaborator = await storage.isCollaborator(canvasId, req.user!.id);
      
      if (!isOwner && !isCollaborator && !req.user!.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const collaborators = await storage.getCanvasCollaborators(canvasId);
      
      // Get the full user details for each collaborator
      const collaboratorDetails = await Promise.all(
        collaborators.map(async (collab) => {
          const user = await storage.getUser(collab.userId);
          return {
            id: collab.id,
            userId: collab.userId,
            username: user?.username,
            email: user?.email,
            role: collab.role,
            createdAt: collab.createdAt
          };
        })
      );
      
      return res.json(collaboratorDetails);
    } catch (error) {
      console.error("Error fetching collaborators:", error);
      return res.status(500).json({ 
        message: `Failed to fetch collaborators: ${(error as Error).message}`
      });
    }
  });
  
  // Add a collaborator to a canvas
  app.post("/api/canvases/:id/collaborators", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const canvasId = parseInt(req.params.id);
      if (isNaN(canvasId)) {
        return res.status(400).json({ message: "Invalid canvas ID" });
      }
      
      // Verify the user owns the canvas
      const canvas = await storage.getCanvas(canvasId);
      if (!canvas) {
        return res.status(404).json({ message: "Canvas not found" });
      }
      
      if (canvas.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ message: "Only the canvas owner can add collaborators" });
      }
      
      const { usernameOrEmail, role } = req.body;
      
      if (!usernameOrEmail) {
        return res.status(400).json({ message: "Username or email is required" });
      }
      
      // Find the user by username or email
      let user = await storage.getUserByUsername(usernameOrEmail);
      if (!user) {
        user = await storage.getUserByEmail(usernameOrEmail);
      }
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Prevent adding the owner as a collaborator
      if (user.id === canvas.userId) {
        return res.status(400).json({ message: "Cannot add canvas owner as a collaborator" });
      }
      
      // Create collaborator record
      const collaboratorData: InsertCollaborator = {
        canvasId,
        userId: user.id,
        role: role || 'viewer'
      };
      
      const validatedData = insertCollaboratorSchema.parse(collaboratorData);
      const collaborator = await storage.addCollaborator(validatedData);
      
      // Return collaborator with user details
      const result = {
        ...collaborator,
        username: user.username,
        email: user.email
      };
      
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      console.error("Error adding collaborator:", error);
      return res.status(500).json({ 
        message: `Failed to add collaborator: ${(error as Error).message}`
      });
    }
  });
  
  // Update a collaborator's role
  app.put("/api/collaborators/:id", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid collaborator ID" });
      }
      
      const { role } = req.body;
      if (!role || !['viewer', 'editor'].includes(role)) {
        return res.status(400).json({ message: "Invalid role. Must be 'viewer' or 'editor'" });
      }
      
      // Find the collaborator
      const collaborators = await storage.getCanvasCollaborators(0);
      const foundCollaborator = collaborators.find(c => c.id === id);
      
      if (!foundCollaborator) {
        return res.status(404).json({ message: "Collaborator not found" });
      }
      
      // Verify the user owns the canvas
      const canvas = await storage.getCanvas(foundCollaborator.canvasId);
      if (!canvas) {
        return res.status(404).json({ message: "Canvas not found" });
      }
      
      if (canvas.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ message: "Only the canvas owner can update collaborator roles" });
      }
      
      // Update the collaborator's role
      const updatedCollaborator = await storage.updateCollaboratorRole(id, role);
      
      if (!updatedCollaborator) {
        return res.status(404).json({ message: "Collaborator not found" });
      }
      
      return res.json(updatedCollaborator);
    } catch (error) {
      console.error("Error updating collaborator role:", error);
      return res.status(500).json({ 
        message: `Failed to update collaborator role: ${(error as Error).message}`
      });
    }
  });
  
  // Remove a collaborator
  app.delete("/api/collaborators/:id", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid collaborator ID" });
      }
      
      // Find the collaborator
      const collaborators = await storage.getCanvasCollaborators(0);
      const foundCollaborator = collaborators.find(c => c.id === id);
      
      if (!foundCollaborator) {
        return res.status(404).json({ message: "Collaborator not found" });
      }
      
      // Verify the user owns the canvas
      const canvas = await storage.getCanvas(foundCollaborator.canvasId);
      if (!canvas) {
        return res.status(404).json({ message: "Canvas not found" });
      }
      
      // Allow canvas owner, the collaborator themselves, or admin to remove
      const isOwner = canvas.userId === req.user!.id;
      const isSelf = foundCollaborator.userId === req.user!.id;
      
      if (!isOwner && !isSelf && !req.user!.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Remove the collaborator
      const success = await storage.removeCollaborator(id);
      
      if (!success) {
        return res.status(404).json({ message: "Collaborator not found" });
      }
      
      return res.json({ success: true });
    } catch (error) {
      console.error("Error removing collaborator:", error);
      return res.status(500).json({ 
        message: `Failed to remove collaborator: ${(error as Error).message}`
      });
    }
  });
  
  // Update canvas visibility
  app.put("/api/canvases/:id/visibility", async (req: Request, res: Response) => {
    try {
      // Ensure user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid canvas ID" });
      }
      
      const { visibility } = req.body;
      if (!visibility || !['private', 'collaborative', 'public'].includes(visibility)) {
        return res.status(400).json({ 
          message: "Invalid visibility value. Must be 'private', 'collaborative', or 'public'" 
        });
      }
      
      // Verify the user owns the canvas
      const canvas = await storage.getCanvas(id);
      if (!canvas) {
        return res.status(404).json({ message: "Canvas not found" });
      }
      
      if (canvas.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ message: "Only the canvas owner can update visibility" });
      }
      
      // Update the canvas visibility
      const updatedCanvas = await storage.updateCanvasVisibility(id, visibility);
      
      if (!updatedCanvas) {
        return res.status(404).json({ message: "Canvas not found" });
      }
      
      return res.json(updatedCanvas);
    } catch (error) {
      console.error("Error updating canvas visibility:", error);
      return res.status(500).json({ 
        message: `Failed to update canvas visibility: ${(error as Error).message}`
      });
    }
  });
  
  return httpServer;
}
