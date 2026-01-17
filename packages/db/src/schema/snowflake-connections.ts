import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const authMethodEnum = ["key_pair", "password"] as const satisfies readonly string[];
export type AuthMethod = (typeof authMethodEnum)[number];

export const connectionStatusEnum = ["active", "error", "pending"] as const satisfies readonly string[];
export type ConnectionStatus = (typeof connectionStatusEnum)[number];

export const snowflakeConnections = sqliteTable("snowflake_connections", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),

  // Connection config
  account: text("account").notNull(),
  username: text("username").notNull(),
  warehouse: text("warehouse").notNull(),
  database: text("database").notNull(),
  schema: text("schema").notNull(),
  role: text("role"),

  // Authentication
  authMethod: text("auth_method", { enum: authMethodEnum }).notNull(),
  // Encrypted credentials stored as JSON string
  // For key_pair: { privateKey: string, privateKeyPassphrase?: string }
  // For password: { password: string }
  encryptedCredentials: text("encrypted_credentials").notNull(),

  // Status tracking
  status: text("status", { enum: connectionStatusEnum }).notNull().default("pending"),
  lastTestedAt: integer("last_tested_at", { mode: "timestamp" }),
  lastErrorMessage: text("last_error_message"),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type SnowflakeConnection = typeof snowflakeConnections.$inferSelect;
export type SnowflakeConnectionInsert = typeof snowflakeConnections.$inferInsert;
