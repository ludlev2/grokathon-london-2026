import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@grokathon-london-2026/db";
import { snowflakeConnections } from "@grokathon-london-2026/db/schema";
import { env } from "@grokathon-london-2026/env/server";

import { publicProcedure, router } from "../index.js";
import {
  encrypt,
  decrypt,
  createSnowflakeConnectionSchema,
  updateSnowflakeConnectionSchema,
  executeQuerySchema,
  SnowflakeAdapter,
  withSnowflakeConnection,
  type SnowflakeConfig,
  type SnowflakeCredential,
} from "../services/snowflake/index.js";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/**
 * Parse and decrypt stored credentials
 */
function decryptCredentials(encryptedCredentials: string): SnowflakeCredential {
  const decrypted = decrypt(encryptedCredentials, env.CREDENTIALS_ENCRYPTION_KEY);
  return JSON.parse(decrypted) as SnowflakeCredential;
}

/**
 * Build config from a connection record
 */
function buildConfig(connection: typeof snowflakeConnections.$inferSelect): SnowflakeConfig {
  return {
    account: connection.account,
    username: connection.username,
    warehouse: connection.warehouse,
    database: connection.database,
    schema: connection.schema,
    role: connection.role ?? undefined,
  };
}

export const snowflakeRouter = router({
  /**
   * List all Snowflake connections
   */
  list: publicProcedure.query(async () => {
    const connections = await db.select().from(snowflakeConnections);
    return connections.map((conn) => ({
      id: conn.id,
      name: conn.name,
      account: conn.account,
      username: conn.username,
      warehouse: conn.warehouse,
      database: conn.database,
      schema: conn.schema,
      role: conn.role,
      authMethod: conn.authMethod,
      status: conn.status,
      lastTestedAt: conn.lastTestedAt,
      lastErrorMessage: conn.lastErrorMessage,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }));
  }),

  /**
   * Get a single connection by ID
   */
  get: publicProcedure.input(z.object({ id: uuidSchema })).query(async ({ input }) => {
    const [connection] = await db
      .select()
      .from(snowflakeConnections)
      .where(eq(snowflakeConnections.id, input.id));

    if (!connection) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Snowflake connection not found",
      });
    }

    return {
      id: connection.id,
      name: connection.name,
      account: connection.account,
      username: connection.username,
      warehouse: connection.warehouse,
      database: connection.database,
      schema: connection.schema,
      role: connection.role,
      authMethod: connection.authMethod,
      status: connection.status,
      lastTestedAt: connection.lastTestedAt,
      lastErrorMessage: connection.lastErrorMessage,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }),

  /**
   * Create a new Snowflake connection
   */
  create: publicProcedure.input(createSnowflakeConnectionSchema).mutation(async ({ input }) => {
    const encryptedCredentials = encrypt(
      JSON.stringify(input.credential),
      env.CREDENTIALS_ENCRYPTION_KEY
    );

    const [connection] = await db
      .insert(snowflakeConnections)
      .values({
        name: input.name,
        account: input.config.account,
        username: input.config.username,
        warehouse: input.config.warehouse,
        database: input.config.database,
        schema: input.config.schema,
        role: input.config.role,
        authMethod: input.credential.authMethod,
        encryptedCredentials,
      })
      .returning();

    if (!connection) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create connection",
      });
    }

    return {
      id: connection.id,
      name: connection.name,
    };
  }),

  /**
   * Update an existing Snowflake connection
   */
  update: publicProcedure.input(updateSnowflakeConnectionSchema).mutation(async ({ input }) => {
    const [existing] = await db
      .select()
      .from(snowflakeConnections)
      .where(eq(snowflakeConnections.id, input.id));

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Snowflake connection not found",
      });
    }

    const updateData: Partial<typeof snowflakeConnections.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.name) {
      updateData.name = input.name;
    }

    if (input.config) {
      if (input.config.account) updateData.account = input.config.account;
      if (input.config.username) updateData.username = input.config.username;
      if (input.config.warehouse) updateData.warehouse = input.config.warehouse;
      if (input.config.database) updateData.database = input.config.database;
      if (input.config.schema) updateData.schema = input.config.schema;
      if (input.config.role !== undefined) updateData.role = input.config.role;
    }

    if (input.credential) {
      updateData.authMethod = input.credential.authMethod;
      updateData.encryptedCredentials = encrypt(
        JSON.stringify(input.credential),
        env.CREDENTIALS_ENCRYPTION_KEY
      );
    }

    const [updated] = await db
      .update(snowflakeConnections)
      .set(updateData)
      .where(eq(snowflakeConnections.id, input.id))
      .returning();

    if (!updated) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update connection",
      });
    }

    return {
      id: updated.id,
      name: updated.name,
    };
  }),

  /**
   * Delete a Snowflake connection
   */
  delete: publicProcedure.input(z.object({ id: uuidSchema })).mutation(async ({ input }) => {
    const [deleted] = await db
      .delete(snowflakeConnections)
      .where(eq(snowflakeConnections.id, input.id))
      .returning();

    if (!deleted) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Snowflake connection not found",
      });
    }

    return { success: true };
  }),

  /**
   * Test a Snowflake connection
   */
  testConnection: publicProcedure
    .input(z.object({ id: uuidSchema }))
    .mutation(async ({ input }) => {
      const [connection] = await db
        .select()
        .from(snowflakeConnections)
        .where(eq(snowflakeConnections.id, input.id));

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Snowflake connection not found",
        });
      }

      const config = buildConfig(connection);
      const credential = decryptCredentials(connection.encryptedCredentials);

      const adapter = new SnowflakeAdapter(config, credential);
      const result = await adapter.testConnection();
      await adapter.disconnect();

      // Update connection status
      await db
        .update(snowflakeConnections)
        .set({
          status: result.status === "healthy" ? "active" : "error",
          lastTestedAt: new Date(),
          lastErrorMessage: result.message ?? null,
          updatedAt: new Date(),
        })
        .where(eq(snowflakeConnections.id, input.id));

      return {
        success: result.status === "healthy",
        latencyMs: result.latencyMs,
        message: result.message,
      };
    }),

  /**
   * Execute a SQL query
   */
  executeQuery: publicProcedure.input(executeQuerySchema).mutation(async ({ input }) => {
    const [connection] = await db
      .select()
      .from(snowflakeConnections)
      .where(eq(snowflakeConnections.id, input.connectionId));

    if (!connection) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Snowflake connection not found",
      });
    }

    const config = buildConfig(connection);
    const credential = decryptCredentials(connection.encryptedCredentials);

    try {
      const result = await withSnowflakeConnection(config, credential, async (adapter) => {
        return adapter.query(input.sql, { timeoutMs: input.timeoutMs });
      });

      return result;
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Query execution failed",
      });
    }
  }),

  /**
   * List schemas in the connected database
   */
  listSchemas: publicProcedure.input(z.object({ id: uuidSchema })).query(async ({ input }) => {
    const [connection] = await db
      .select()
      .from(snowflakeConnections)
      .where(eq(snowflakeConnections.id, input.id));

    if (!connection) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Snowflake connection not found",
      });
    }

    const config = buildConfig(connection);
    const credential = decryptCredentials(connection.encryptedCredentials);

    const schemas = await withSnowflakeConnection(config, credential, async (adapter) => {
      return adapter.listSchemas();
    });

    return schemas;
  }),

  /**
   * List tables in a schema
   */
  listTables: publicProcedure
    .input(z.object({ id: uuidSchema, schema: z.string().min(1) }))
    .query(async ({ input }) => {
      const [connection] = await db
        .select()
        .from(snowflakeConnections)
        .where(eq(snowflakeConnections.id, input.id));

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Snowflake connection not found",
        });
      }

      const config = buildConfig(connection);
      const credential = decryptCredentials(connection.encryptedCredentials);

      const tables = await withSnowflakeConnection(config, credential, async (adapter) => {
        return adapter.listTables(input.schema);
      });

      return tables;
    }),

  /**
   * Describe a table's columns
   */
  describeTable: publicProcedure
    .input(z.object({ id: uuidSchema, schema: z.string().min(1), table: z.string().min(1) }))
    .query(async ({ input }) => {
      const [connection] = await db
        .select()
        .from(snowflakeConnections)
        .where(eq(snowflakeConnections.id, input.id));

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Snowflake connection not found",
        });
      }

      const config = buildConfig(connection);
      const credential = decryptCredentials(connection.encryptedCredentials);

      const columns = await withSnowflakeConnection(config, credential, async (adapter) => {
        return adapter.describeTable(input.schema, input.table);
      });

      return columns;
    }),
});
