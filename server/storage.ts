import { 
  users, type User, type InsertUser,
  canvasElements, type CanvasElement, type InsertCanvasElement,
  connections, type Connection, type InsertConnection,
  canvases, type Canvas, type InsertCanvas,
  collaborators, type Collaborator, type InsertCollaborator
} from "@shared/schema";
import session from "express-session";
import connectPg from "connect-pg-simple";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>; // Admin: Get all users
  updateUser(id: number, data: Partial<User>): Promise<User | undefined>; // Admin: Update user
  deleteUser(id: number): Promise<boolean>; // Admin: Delete user
  setUserAdminStatus(id: number, isAdmin: boolean): Promise<User | undefined>; // Admin: Set admin status
  getStats(): Promise<{ 
    userCount: number; 
    canvasCount: number; 
    elementCount: number;
    connectionCount: number; 
  }>; // Admin: Get stats
  
  // Access control
  userHasAccessToCanvas(userId: number, canvasId: number): Promise<boolean>;

  // Canvas element operations
  getAllCanvasElements(): Promise<CanvasElement[]>;
  getCanvasElement(id: number): Promise<CanvasElement | undefined>;
  getCanvasElementsByCanvasId(canvasId: number): Promise<CanvasElement[]>;
  createCanvasElement(element: InsertCanvasElement): Promise<CanvasElement>;
  updateCanvasElement(id: number, element: Partial<InsertCanvasElement>): Promise<CanvasElement | undefined>;
  deleteCanvasElement(id: number): Promise<boolean>;
  deleteCanvasElementsByCanvasId(canvasId: number): Promise<boolean>;

  // Connection operations
  getAllConnections(): Promise<Connection[]>;
  getConnection(id: number): Promise<Connection | undefined>;
  getConnectionsByCanvasId(canvasId: number): Promise<Connection[]>;
  createConnection(connection: InsertConnection): Promise<Connection>;
  deleteConnection(id: number): Promise<boolean>;
  deleteConnectionsByCanvasId(canvasId: number): Promise<boolean>;

  // Canvas operations
  getAllCanvases(): Promise<Canvas[]>;
  getUserCanvases(userId: number): Promise<Canvas[]>;
  getUserCanvasesAndPublic(userId: number): Promise<Canvas[]>; // Get user's canvases and public canvases
  getUserCollaborativeCanvases(userId: number): Promise<Canvas[]>; // Get canvases where user is a collaborator
  getAllAccessibleCanvases(userId: number): Promise<Canvas[]>; // Get all canvases user can access (own, collaborative, public)
  getCanvas(id: number): Promise<Canvas | undefined>;
  createCanvas(canvas: InsertCanvas): Promise<Canvas>;
  updateCanvas(id: number, data: Partial<Canvas>): Promise<Canvas | undefined>;
  updateCanvasVisibility(id: number, visibility: string): Promise<Canvas | undefined>;
  deleteCanvas(id: number): Promise<boolean>;
  
  // Collaboration operations
  getCanvasCollaborators(canvasId: number): Promise<Collaborator[]>;
  addCollaborator(collaborator: InsertCollaborator): Promise<Collaborator>;
  updateCollaboratorRole(id: number, role: string): Promise<Collaborator | undefined>;
  removeCollaborator(id: number): Promise<boolean>;
  isCollaborator(canvasId: number, userId: number): Promise<boolean>;
  
  // Canvas state operations (batch operations for elements and connections)
  replaceCanvasState(canvasId: number, elements: any[], connections: any[]): Promise<boolean>;

  // Session store
  sessionStore: session.Store;
}

import { db } from "./db";
import { eq } from "drizzle-orm";
import { client } from "./db";

const PostgresSessionStore = connectPg(session);

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    // Initialize session store
    this.sessionStore = new PostgresSessionStore({
      conObject: {
        connectionString: process.env.DATABASE_URL,
      },
      createTableIfMissing: true,
    });
    
    // Create a default canvas on initialization
    this.createDefaultCanvas();
  }

  private async createDefaultCanvas() {
    // No longer creating a default canvas as canvases should be tied to users
    return;
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }
  
  // Admin operations
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }
  
  async updateUser(id: number, data: Partial<User>): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
    
    return updatedUser;
  }
  
  async deleteUser(id: number): Promise<boolean> {
    // First delete all canvases owned by this user
    const userCanvases = await this.getUserCanvases(id);
    for (const canvas of userCanvases) {
      await this.deleteCanvas(canvas.id);
    }
    
    // Then delete the user
    const [deletedUser] = await db
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    
    return !!deletedUser;
  }
  
  async setUserAdminStatus(id: number, isAdmin: boolean): Promise<User | undefined> {
    return await this.updateUser(id, { isAdmin });
  }
  
  async getStats(): Promise<{ 
    userCount: number; 
    canvasCount: number; 
    elementCount: number;
    connectionCount: number; 
  }> {
    try {
      const [userCountResult] = await client`SELECT COUNT(*) as count FROM users`;
      const [canvasCountResult] = await client`SELECT COUNT(*) as count FROM canvases`;
      const [elementCountResult] = await client`SELECT COUNT(*) as count FROM canvas_elements`;
      const [connectionCountResult] = await client`SELECT COUNT(*) as count FROM connections`;
      
      return {
        userCount: parseInt(userCountResult?.count || '0'),
        canvasCount: parseInt(canvasCountResult?.count || '0'),
        elementCount: parseInt(elementCountResult?.count || '0'),
        connectionCount: parseInt(connectionCountResult?.count || '0')
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return {
        userCount: 0,
        canvasCount: 0,
        elementCount: 0,
        connectionCount: 0
      };
    }
  }

  // Canvas element operations
  async getAllCanvasElements(): Promise<CanvasElement[]> {
    return await db.select().from(canvasElements);
  }

  async getCanvasElement(id: number): Promise<CanvasElement | undefined> {
    const [element] = await db.select().from(canvasElements).where(eq(canvasElements.id, id));
    return element;
  }

  async createCanvasElement(element: InsertCanvasElement): Promise<CanvasElement> {
    const [createdElement] = await db.insert(canvasElements).values(element).returning();
    return createdElement;
  }

  async updateCanvasElement(id: number, element: Partial<InsertCanvasElement>): Promise<CanvasElement | undefined> {
    const [updatedElement] = await db
      .update(canvasElements)
      .set(element)
      .where(eq(canvasElements.id, id))
      .returning();
    
    return updatedElement;
  }

  async deleteCanvasElement(id: number): Promise<boolean> {
    const [deletedElement] = await db
      .delete(canvasElements)
      .where(eq(canvasElements.id, id))
      .returning({ id: canvasElements.id });
    
    return !!deletedElement;
  }

  // Connection operations
  async getAllConnections(): Promise<Connection[]> {
    return await db.select().from(connections);
  }

  async getConnection(id: number): Promise<Connection | undefined> {
    const [connection] = await db.select().from(connections).where(eq(connections.id, id));
    return connection;
  }

  async createConnection(connection: InsertConnection): Promise<Connection> {
    console.log('Creating connection:', JSON.stringify(connection));
    
    // Handle ReactFlow connection data
    if (typeof connection.style === 'object' && connection.style !== null) {
      const style = connection.style as Record<string, any>;
      
      // If source/target are in the style object but not in sourceId/targetId,
      // try to extract them
      if (!connection.sourceId && style.source) {
        try {
          // Try to convert source to a number if it's a numeric string
          if (!isNaN(parseInt(style.source))) {
            connection.sourceId = parseInt(style.source);
          }
        } catch (err) {
          console.log('Could not parse source as integer');
        }
      }
      
      if (!connection.targetId && style.target) {
        try {
          // Try to convert target to a number if it's a numeric string
          if (!isNaN(parseInt(style.target))) {
            connection.targetId = parseInt(style.target);
          }
        } catch (err) {
          console.log('Could not parse target as integer');
        }
      }
    }
    
    const [createdConnection] = await db.insert(connections).values(connection).returning();
    return createdConnection;
  }

  async deleteConnection(id: number): Promise<boolean> {
    const [deletedConnection] = await db
      .delete(connections)
      .where(eq(connections.id, id))
      .returning({ id: connections.id });
    
    return !!deletedConnection;
  }

  // Canvas operations
  async getAllCanvases(): Promise<Canvas[]> {
    return await db.select().from(canvases);
  }

  async getUserCanvases(userId: number): Promise<Canvas[]> {
    return await db.select().from(canvases).where(eq(canvases.userId, userId));
  }
  
  async getUserCanvasesAndPublic(userId: number): Promise<Canvas[]> {
    try {
      // Only get canvases owned by the user (ignoring public status)
      const result = await client`
        SELECT * FROM canvases 
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
      `;
      return result as unknown as Canvas[];
    } catch (error) {
      console.error('Error fetching user canvases:', error);
      return [];
    }
  }

  async getCanvas(id: number): Promise<Canvas | undefined> {
    const [canvas] = await db.select().from(canvases).where(eq(canvases.id, id));
    return canvas;
  }

  async createCanvas(canvas: InsertCanvas): Promise<Canvas> {
    const [createdCanvas] = await db.insert(canvases).values(canvas).returning();
    return createdCanvas;
  }

  async updateCanvas(id: number, data: Partial<Canvas>): Promise<Canvas | undefined> {
    const [updatedCanvas] = await db
      .update(canvases)
      .set(data)
      .where(eq(canvases.id, id))
      .returning();
    
    return updatedCanvas;
  }
  
  async updateCanvasVisibility(id: number, visibility: string): Promise<Canvas | undefined> {
    // Validate visibility value
    if (!['private', 'collaborative', 'public'].includes(visibility)) {
      throw new Error("Invalid visibility value. Must be 'private', 'collaborative', or 'public'");
    }
    
    // For backward compatibility, update isPublic based on visibility
    const isPublic = visibility === 'public';
    
    const [updatedCanvas] = await db
      .update(canvases)
      .set({ 
        visibility, 
        isPublic,
        updatedAt: new Date()
      })
      .where(eq(canvases.id, id))
      .returning();
    
    return updatedCanvas;
  }

  async deleteCanvas(id: number): Promise<boolean> {
    // First delete all elements and connections associated with this canvas
    await this.deleteCanvasElementsByCanvasId(id);
    await this.deleteConnectionsByCanvasId(id);
    
    // Delete all collaborators associated with this canvas
    try {
      await client`DELETE FROM collaborators WHERE canvas_id = ${id}`;
    } catch (error) {
      console.error('Error deleting collaborators:', error);
    }
    
    // Then delete the canvas itself
    const [deletedCanvas] = await db
      .delete(canvases)
      .where(eq(canvases.id, id))
      .returning({ id: canvases.id });
    
    return !!deletedCanvas;
  }
  
  // Collaboration methods
  async getUserCollaborativeCanvases(userId: number): Promise<Canvas[]> {
    try {
      // Get canvases where user is a collaborator
      const result = await client`
        SELECT c.* FROM canvases c
        JOIN collaborators col ON c.id = col.canvas_id
        WHERE col.user_id = ${userId}
        ORDER BY c.updated_at DESC
      `;
      return result as unknown as Canvas[];
    } catch (error) {
      console.error('Error fetching collaborative canvases:', error);
      return [];
    }
  }
  
  async getAllAccessibleCanvases(userId: number): Promise<Canvas[]> {
    try {
      // Get all canvases that user can access (own, collaborative, public)
      const result = await client`
        SELECT DISTINCT c.* FROM canvases c
        LEFT JOIN collaborators col ON c.id = col.canvas_id
        WHERE 
          c.user_id = ${userId} OR
          (col.user_id = ${userId}) OR
          c.visibility = 'public'
        ORDER BY c.updated_at DESC
      `;
      return result as unknown as Canvas[];
    } catch (error) {
      console.error('Error fetching accessible canvases:', error);
      return [];
    }
  }
  
  async getCanvasCollaborators(canvasId: number): Promise<Collaborator[]> {
    try {
      const result = await db
        .select()
        .from(collaborators)
        .where(eq(collaborators.canvasId, canvasId));
      return result;
    } catch (error) {
      console.error('Error fetching canvas collaborators:', error);
      return [];
    }
  }
  
  async addCollaborator(collaborator: InsertCollaborator): Promise<Collaborator> {
    try {
      // Check if collaborator already exists
      const existingCollaborator = await client`
        SELECT * FROM collaborators 
        WHERE canvas_id = ${collaborator.canvasId} AND user_id = ${collaborator.userId}
      `;
      
      if (existingCollaborator && existingCollaborator.length > 0) {
        throw new Error('User is already a collaborator on this canvas');
      }
      
      const [addedCollaborator] = await db
        .insert(collaborators)
        .values(collaborator)
        .returning();
        
      return addedCollaborator;
    } catch (error) {
      console.error('Error adding collaborator:', error);
      throw error;
    }
  }
  
  async updateCollaboratorRole(id: number, role: string): Promise<Collaborator | undefined> {
    try {
      // Validate role
      if (!['viewer', 'editor'].includes(role)) {
        throw new Error("Invalid role. Must be 'viewer' or 'editor'");
      }
      
      const [updatedCollaborator] = await db
        .update(collaborators)
        .set({ role })
        .where(eq(collaborators.id, id))
        .returning();
        
      return updatedCollaborator;
    } catch (error) {
      console.error('Error updating collaborator role:', error);
      throw error;
    }
  }
  
  async removeCollaborator(id: number): Promise<boolean> {
    try {
      const [removedCollaborator] = await db
        .delete(collaborators)
        .where(eq(collaborators.id, id))
        .returning({ id: collaborators.id });
        
      return !!removedCollaborator;
    } catch (error) {
      console.error('Error removing collaborator:', error);
      return false;
    }
  }
  
  async isCollaborator(canvasId: number, userId: number): Promise<boolean> {
    try {
      const result = await client`
        SELECT * FROM collaborators 
        WHERE canvas_id = ${canvasId} AND user_id = ${userId}
        LIMIT 1
      `;
      
      return result.length > 0;
    } catch (error) {
      console.error('Error checking collaborator status:', error);
      return false;
    }
  }
  
  async userHasAccessToCanvas(userId: number, canvasId: number): Promise<boolean> {
    try {
      // Get the canvas
      const canvas = await this.getCanvas(canvasId);
      if (!canvas) return false;
      
      // Check if user is the owner
      if (canvas.userId === userId) {
        console.log(`User ${userId} has access to canvas ${canvasId} as owner`);
        return true;
      }
      
      // Check if canvas is public
      if (canvas.visibility === 'public' || canvas.isPublic === true) {
        console.log(`User ${userId} has access to canvas ${canvasId} as it is public`);
        return true;
      }
      
      // Check if user is a collaborator (for both collaborative and private canvases)
      const isCollaborator = await this.isCollaborator(canvasId, userId);
      if (isCollaborator) {
        console.log(`User ${userId} has access to canvas ${canvasId} as collaborator`);
        return true;
      }
      
      // User doesn't have access
      console.log(`User ${userId} does not have access to canvas ${canvasId}`);
      return false;
    } catch (error) {
      console.error('Error checking canvas access:', error);
      return false;
    }
  }
  
  // New methods for canvas elements and connections by canvas ID
  async getCanvasElementsByCanvasId(canvasId: number): Promise<CanvasElement[]> {
    try {
      const result = await client`
        SELECT * FROM canvas_elements WHERE canvas_id = ${canvasId}
      `;
      return result as unknown as CanvasElement[];
    } catch (error) {
      console.error('Error fetching canvas elements:', error);
      return [];
    }
  }
  
  async deleteCanvasElementsByCanvasId(canvasId: number): Promise<boolean> {
    try {
      await client`DELETE FROM canvas_elements WHERE canvas_id = ${canvasId}`;
      return true;
    } catch (error) {
      console.error('Error deleting canvas elements:', error);
      return false;
    }
  }
  
  async getConnectionsByCanvasId(canvasId: number): Promise<Connection[]> {
    try {
      // Enhanced query with source and target element data for more reliable connection reconstruction
      const result = await client`
        WITH 
          element_mapping AS (
            SELECT id, canvas_id, content, style, type FROM canvas_elements WHERE canvas_id = ${canvasId}
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
          c.canvas_id = ${canvasId}
        ORDER BY 
          c.id ASC
      `;
      
      // Log what we found for debugging
      console.log(`Retrieved ${result.length} connections for canvas ${canvasId} with enhanced element data`);
      
      return result as unknown as Connection[];
    } catch (error) {
      console.error('Error fetching connections:', error);
      return [];
    }
  }
  
  async deleteConnectionsByCanvasId(canvasId: number): Promise<boolean> {
    try {
      await client`DELETE FROM connections WHERE canvas_id = ${canvasId}`;
      return true;
    } catch (error) {
      console.error('Error deleting connections:', error);
      return false;
    }
  }
  
  // Completely redesigned canvas state replacement with robust ID handling
  async replaceCanvasState(canvasId: number, elements: any[], edgeConnections: any[]): Promise<boolean> {
    try {
      console.log(`Starting canvas state replacement for canvas ${canvasId}`);
      
      // 1. Clear existing data
      await client`DELETE FROM canvas_elements WHERE canvas_id = ${canvasId}`;
      await client`DELETE FROM connections WHERE canvas_id = ${canvasId}`;
      console.log(`Deleted existing elements and connections for canvas ${canvasId}`);
      
      // 2. Element ID mapping for consistent references
      // Map from client-side IDs to database IDs for connections
      const clientIdToDbId = new Map<string, number>();
      
      // Additional mapping for more reliable element lookup by alternative IDs
      const additionalIdMap = new Map<string, string>();
      
      // Track all stored element IDs to ensure connection references are valid
      const storedElements = new Set<number>();
      
      // 3. Insert all elements first and track their IDs
      if (elements && elements.length > 0) {
        console.log(`Inserting ${elements.length} elements for canvas ${canvasId}`);
        
        // Process elements one by one to get their database IDs
        for (const el of elements) {
          // Skip invalid elements
          if (!el.type) {
            console.log('Skipping invalid element - missing type');
            continue;
          }
          
          // Get the client-side ID as a string - this is what connections refer to
          const clientId = String(el.id);
          
          // Map the node and content types
          const nodeType = el.type || 'textElement';
          const contentType = (el.data && el.data.type) ? el.data.type : 'text';
          
          // Ensure original question is captured
          const originalQuestion = (el.data && el.data.originalQuestion) ? el.data.originalQuestion : '';
          
          // Extract any existing client IDs from content
          if (el.data && el.data.content) {
            try {
              // If content is a string (JSON), try to parse it
              const contentData = typeof el.data.content === 'string' 
                ? JSON.parse(el.data.content) 
                : el.data.content;
                
              // Get any client ID stored in content
              if (contentData.clientId) {
                additionalIdMap.set(String(contentData.clientId), clientId);
              }
              if (contentData._clientId) {
                additionalIdMap.set(String(contentData._clientId), clientId);
              }
            } catch (e) {
              console.warn('Could not parse element content for client IDs');
            }
          }
          
          // Extract any existing client IDs from style
          if (el.style) {
            try {
              // If style is a string (JSON), try to parse it
              const styleData = typeof el.style === 'string'
                ? JSON.parse(el.style)
                : el.style;
                
              // Get any client ID stored in style
              if (styleData.clientId) {
                additionalIdMap.set(String(styleData.clientId), clientId);
              }
            } catch (e) {
              console.warn('Could not parse element style for client IDs');
            }
          }
          
          // Store the client ID in both style and content for redundancy
          const styleObj = {
            ...(el.style || {}),
            clientId: clientId  // Critical for reconnecting when loaded
          };
          
          const contentObj = {
            ...(el.data && el.data.content ? el.data.content : {}),
            clientId: clientId,  // Primary location for the ID
            _clientId: clientId  // Backup location with alternative key name
          };
          
          // Serialize objects to JSON
          const content = JSON.stringify(contentObj);
          const position = JSON.stringify(el.position || {x: 0, y: 0});
          const size = JSON.stringify(el.size || {width: 300, height: 200});
          const style = JSON.stringify(styleObj);
          
          // Insert the element and get its database ID
          const result = await client`
            INSERT INTO canvas_elements 
            (canvas_id, type, element_type, content, position, size, style, original_question) 
            VALUES 
            (${canvasId}, ${nodeType}, ${contentType}, ${content}, ${position}, ${size}, ${style}, ${originalQuestion})
            RETURNING id
          `;
          
          if (result && result.length > 0) {
            const dbId = result[0].id;
            clientIdToDbId.set(clientId, dbId);
            // Add to our set of stored element IDs for connection validation
            storedElements.add(dbId);
            console.log(`Mapped element: Client ID "${clientId}" → Database ID ${dbId}`);
          } else {
            console.warn(`Failed to get database ID for element with client ID ${clientId}`);
          }
        }
      }
      
      // Log our ID mapping for debugging
      console.log(`Built ID mapping with ${clientIdToDbId.size} entries`);
      
      // 4. Now insert connections using the database IDs from our map
      if (edgeConnections && edgeConnections.length > 0) {
        console.log(`Processing ${edgeConnections.length} connections for canvas ${canvasId}`);
        
        // Helper function to resolve client IDs using various strategies
        const resolveClientId = (id: string): string | null => {
          // Direct match in our client ID map
          if (clientIdToDbId.has(id)) {
            return id;
          }
          
          // Check alternative ID mapping
          if (additionalIdMap.has(id)) {
            const resolvedId = additionalIdMap.get(id);
            console.log(`Resolved ID '${id}' to '${resolvedId}' using additional mapping`);
            return resolvedId!;
          }
          
          return null;
        };
        
        // Preprocess connections to resolve source/target IDs
        for (const conn of edgeConnections) {
          if (!conn.source || !conn.target) continue;
          
          // Extract the original source/target IDs
          const originalSourceId = String(conn.source);
          const originalTargetId = String(conn.target);
          
          // Check if style contains additional ID information
          let sourceFromStyle = null;
          let targetFromStyle = null;
          
          if (conn.style) {
            const style = typeof conn.style === 'object' ? conn.style : 
                         (typeof conn.style === 'string' ? JSON.parse(conn.style) : {});
            
            // Look for source/target in style object
            if (style.sourceId) sourceFromStyle = String(style.sourceId);
            if (style.targetId) targetFromStyle = String(style.targetId);
            if (style.sourceClientId) sourceFromStyle = String(style.sourceClientId);
            if (style.targetClientId) targetFromStyle = String(style.targetClientId);
          }
          
          // Try to resolve the source ID
          let resolvedSourceId = resolveClientId(originalSourceId);
          if (!resolvedSourceId && sourceFromStyle) {
            resolvedSourceId = resolveClientId(sourceFromStyle);
            if (resolvedSourceId) {
              console.log(`Resolved connection source from style: '${sourceFromStyle}' → '${resolvedSourceId}'`);
              conn.source = resolvedSourceId;
            }
          }
          
          // Try to resolve the target ID
          let resolvedTargetId = resolveClientId(originalTargetId);
          if (!resolvedTargetId && targetFromStyle) {
            resolvedTargetId = resolveClientId(targetFromStyle);
            if (resolvedTargetId) {
              console.log(`Resolved connection target from style: '${targetFromStyle}' → '${resolvedTargetId}'`);
              conn.target = resolvedTargetId;
            }
          }
        }
        
        // Filter valid connections and process them
        const validConnections = edgeConnections.filter(conn => {
          if (!conn.source || !conn.target) {
            console.log('Filtering invalid connection - missing source or target');
            return false;
          }
          
          const sourceClientId = String(conn.source);
          const targetClientId = String(conn.target);
          
          // Check if both source and target elements exist in our database
          if (!clientIdToDbId.has(sourceClientId)) {
            console.warn(`Filtering connection - source element '${sourceClientId}' not found in database`);
            return false;
          }
          
          if (!clientIdToDbId.has(targetClientId)) {
            console.warn(`Filtering connection - target element '${targetClientId}' not found in database`);
            return false;
          }
          
          return true;
        });
        
        console.log(`Found ${validConnections.length} valid connections out of ${edgeConnections.length}`);
        
        // Insert the valid connections
        for (const conn of validConnections) {
          const sourceClientId = String(conn.source);
          const targetClientId = String(conn.target);
          
          // Lookup database IDs from our mapping
          const sourceDbId = clientIdToDbId.get(sourceClientId);
          const targetDbId = clientIdToDbId.get(targetClientId);
          
          if (!sourceDbId || !targetDbId) {
            console.warn(`Skipping connection - missing database ID mapping`);
            continue;
          }
          
          console.log(`Adding connection: ${sourceClientId}(${sourceDbId}) → ${targetClientId}(${targetDbId})`);
          
          const type = conn.type || 'default';
          const animated = JSON.stringify(conn.animated === true);
          
          // Store both client and database IDs in the style for complete reference
          const styleObj = {
            // Original React Flow IDs (strings)
            sourceClientId: sourceClientId,
            targetClientId: targetClientId,
            
            // Database IDs (numbers)
            sourceDbId: sourceDbId,
            targetDbId: targetDbId,
            
            // Connection appearance
            type: conn.type || 'smoothstep',
            stroke: (conn.style && conn.style.stroke) || '#6366f1', 
            strokeWidth: (conn.style && conn.style.strokeWidth) || 2,
            
            // Any other style properties
            ...(conn.style || {})
          };
          
          const style = JSON.stringify(styleObj);
          
          // Insert using database IDs for the foreign key fields
          await client`
            INSERT INTO connections 
            (canvas_id, source_id, target_id, type, animated, style) 
            VALUES 
            (${canvasId}, ${sourceDbId}, ${targetDbId}, ${type}, ${animated}, ${style})
          `;
        }
      }
      
      // 5. Update the canvas timestamp
      const now = new Date().toISOString();
      await client`UPDATE canvases SET updated_at = ${now} WHERE id = ${canvasId}`;
      
      console.log(`Successfully saved canvas state for canvas ${canvasId}`);
      return true;
    } catch (error: unknown) {
      console.error("Error replacing canvas state:", error);
      return false;
    }
  }
}

export const storage = new DatabaseStorage();
