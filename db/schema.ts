import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// WebAuthn credentials prove possession of a passkey. Server sessions guard notes.
export const passkeys = sqliteTable("passkeys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports").notNull().default("[]"),
  deviceType: text("device_type").notNull().default("singleDevice"),
  backedUp: integer("backed_up").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(),
  challenge: text("challenge").notNull(),
  purpose: text("purpose").notNull(),
  context: text("context").notNull(),
  name: text("name"),
  expiresAt: integer("expires_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  credentialId: text("credential_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const privateNotes = sqliteTable("private_notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  outcome: text("outcome").notNull(),
  detail: text("detail").notNull(),
  createdAt: integer("created_at").notNull(),
});
