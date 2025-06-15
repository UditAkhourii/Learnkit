import { pgTable, text, serial, integer, jsonb, timestamp, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { boolean } from "drizzle-orm/pg-core";

// User schema
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull(),
  password: text("password").notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  isAdmin: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// User relations
export const usersRelations = relations(users, ({ many }) => ({
  canvases: many(canvases),
  collaborations: many(collaborators)
}));

// Canvas information (for multiple canvases)
export const canvases = pgTable("canvases", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  thumbnail: text("thumbnail"),
  // Visibility settings: 'private', 'collaborative', 'public'
  visibility: text("visibility").default("private").notNull(),
  isPublic: boolean("is_public").default(false).notNull(), // Keeping for backward compatibility
});

export const insertCanvasSchema = createInsertSchema(canvases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCanvas = z.infer<typeof insertCanvasSchema>;
export type Canvas = typeof canvases.$inferSelect;

// Canvas relations
export const canvasesRelations = relations(canvases, ({ one, many }) => ({
  user: one(users, {
    fields: [canvases.userId],
    references: [users.id]
  }),
  elements: many(canvasElements),
  collaborators: many(collaborators)
}));

// Canvas elements schema
export const canvasElements = pgTable("canvas_elements", {
  id: serial("id").primaryKey(),
  canvasId: integer("canvas_id").references(() => canvases.id),
  type: text("type").notNull(), // React Flow node type (textElement, imageElement, etc.)
  element_type: text("element_type"), // Content type (text, image, equation, mindmap, code)
  content: jsonb("content").notNull(), // Stores the element content (text, image URL, etc.)
  position: jsonb("position").notNull(), // {x, y} coordinates
  size: jsonb("size").notNull(), // {width, height}
  style: jsonb("style"), // Optional styling
  original_question: text("original_question"), // The original question that generated this element
  createdAt: timestamp("created_at").defaultNow(),
});

export const canvasElementsRelations = relations(canvasElements, ({ one }) => ({
  canvas: one(canvases, {
    fields: [canvasElements.canvasId],
    references: [canvases.id]
  })
}));

export const insertCanvasElementSchema = createInsertSchema(canvasElements).omit({
  id: true,
  createdAt: true,
});

export type InsertCanvasElement = z.infer<typeof insertCanvasElementSchema>;
export type CanvasElement = typeof canvasElements.$inferSelect;

// Connections between elements
export const connections = pgTable("connections", {
  id: serial("id").primaryKey(),
  // Making sourceId and targetId fully optional to store string IDs in style instead
  sourceId: integer("source_id"),
  targetId: integer("target_id"),
  canvasId: integer("canvas_id").references(() => canvases.id).notNull(), // Which canvas this connection belongs to
  type: text("type").notNull(), // The type of connection (e.g., 'smoothstep', 'straight')
  animated: jsonb("animated").default(false), // Whether the connection is animated
  style: jsonb("style").notNull(), // Contains source and target string IDs from ReactFlow
  createdAt: timestamp("created_at").defaultNow(),
});

export const connectionsRelations = relations(connections, ({ one }) => ({
  source: one(canvasElements, {
    fields: [connections.sourceId],
    references: [canvasElements.id]
  }),
  target: one(canvasElements, {
    fields: [connections.targetId],
    references: [canvasElements.id]
  }),
  canvas: one(canvases, {
    fields: [connections.canvasId],
    references: [canvases.id]
  })
}));

export const insertConnectionSchema = createInsertSchema(connections).omit({
  id: true,
  createdAt: true,
});

export type InsertConnection = z.infer<typeof insertConnectionSchema>;
export type Connection = typeof connections.$inferSelect;

// Canvas collaborators
export const collaborators = pgTable("collaborators", {
  id: serial("id").primaryKey(),
  canvasId: integer("canvas_id").references(() => canvases.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  role: text("role").default("viewer").notNull(), // 'viewer', 'editor'
  createdAt: timestamp("created_at").defaultNow(),
});

export const collaboratorsRelations = relations(collaborators, ({ one }) => ({
  canvas: one(canvases, {
    fields: [collaborators.canvasId],
    references: [canvases.id]
  }),
  user: one(users, {
    fields: [collaborators.userId],
    references: [users.id]
  })
}));

export const insertCollaboratorSchema = createInsertSchema(collaborators).omit({
  id: true,
  createdAt: true,
});

export type InsertCollaborator = z.infer<typeof insertCollaboratorSchema>;
export type Collaborator = typeof collaborators.$inferSelect;
