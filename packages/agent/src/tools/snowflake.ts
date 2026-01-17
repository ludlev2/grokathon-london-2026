/**
 * Snowflake tools for the AI agent
 *
 * These tools allow the agent to interact with Snowflake data warehouses
 * for data analysis tasks.
 */

import { z } from "zod";
import { defineTool, jsonResult, errorResult, textResult } from "../tools.js";
import type { ToolDefinition } from "../types.js";

// Types for the Snowflake service interface
interface SnowflakeConnection {
  id: string;
  name: string;
  account: string;
  database: string;
  schema: string;
  warehouse: string;
  status: "active" | "error" | "pending";
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
  executionTimeMs: number;
}

interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
}

/**
 * Service interface for Snowflake operations
 * This should be injected when creating the tools
 */
export interface SnowflakeService {
  listConnections(): Promise<SnowflakeConnection[]>;
  executeQuery(connectionId: string, sql: string, timeoutMs?: number): Promise<QueryResult>;
  listSchemas(connectionId: string): Promise<string[]>;
  listTables(connectionId: string, schema: string): Promise<string[]>;
  describeTable(connectionId: string, schema: string, table: string): Promise<TableColumn[]>;
}

/**
 * Create Snowflake tools with an injected service
 */
export function createSnowflakeTools(service: SnowflakeService): Record<string, ToolDefinition> {
  const listConnectionsTool = defineTool({
    description:
      "List all available Snowflake connections. Use this to find which connections are available for querying.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const connections = await service.listConnections();
        if (connections.length === 0) {
          return textResult(
            "No Snowflake connections are configured. Ask the user to set up a connection first."
          );
        }
        return jsonResult({
          connections: connections.map((c) => ({
            id: c.id,
            name: c.name,
            database: c.database,
            schema: c.schema,
            status: c.status,
          })),
        });
      } catch (error) {
        return errorResult(
          `Failed to list connections: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const executeQueryTool = defineTool({
    description: `Execute a SQL query against a Snowflake connection. Use this to analyze data.
IMPORTANT: Always use SELECT queries for analysis. Never use INSERT, UPDATE, DELETE, or DDL statements.
The query results are limited to prevent memory issues.`,
    inputSchema: z.object({
      connectionId: z.string().describe("The ID of the Snowflake connection to use"),
      sql: z
        .string()
        .max(10000)
        .describe(
          "The SQL query to execute. Use SELECT queries only. Include LIMIT clause for large tables."
        ),
    }),
    execute: async ({ connectionId, sql }) => {
      // Basic safety check - prevent destructive queries
      const normalizedSql = sql.trim().toUpperCase();
      const dangerousKeywords = [
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "TRUNCATE",
        "ALTER",
        "CREATE",
        "REPLACE",
        "MERGE",
        "GRANT",
        "REVOKE",
      ];

      for (const keyword of dangerousKeywords) {
        if (normalizedSql.startsWith(keyword)) {
          return errorResult(
            `Destructive SQL operations are not allowed. Only SELECT queries are permitted.`
          );
        }
      }

      try {
        const result = await service.executeQuery(connectionId, sql);

        // Format the result for the agent
        return jsonResult({
          success: true,
          rowCount: result.rowCount,
          executionTimeMs: result.executionTimeMs,
          columns: result.columns.map((c) => `${c.name} (${c.type})`),
          rows: result.rows.slice(0, 100), // Limit rows to prevent context overflow
          truncated: result.rowCount > 100,
        });
      } catch (error) {
        return errorResult(
          `Query execution failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
    // Keep only the last 3 query results in context to save space
    ephemeral: 3,
  });

  const listSchemasTool = defineTool({
    description:
      "List all schemas in a Snowflake database. Use this to discover what schemas are available.",
    inputSchema: z.object({
      connectionId: z.string().describe("The ID of the Snowflake connection to use"),
    }),
    execute: async ({ connectionId }) => {
      try {
        const schemas = await service.listSchemas(connectionId);
        return jsonResult({ schemas });
      } catch (error) {
        return errorResult(
          `Failed to list schemas: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const listTablesTool = defineTool({
    description:
      "List all tables in a Snowflake schema. Use this to discover what tables are available for analysis.",
    inputSchema: z.object({
      connectionId: z.string().describe("The ID of the Snowflake connection to use"),
      schema: z.string().describe("The schema name to list tables from"),
    }),
    execute: async ({ connectionId, schema }) => {
      try {
        const tables = await service.listTables(connectionId, schema);
        return jsonResult({ schema, tables });
      } catch (error) {
        return errorResult(
          `Failed to list tables: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const describeTableTool = defineTool({
    description:
      "Get the column definitions for a table. Use this to understand the structure of a table before querying it.",
    inputSchema: z.object({
      connectionId: z.string().describe("The ID of the Snowflake connection to use"),
      schema: z.string().describe("The schema name containing the table"),
      table: z.string().describe("The table name to describe"),
    }),
    execute: async ({ connectionId, schema, table }) => {
      try {
        const columns = await service.describeTable(connectionId, schema, table);
        return jsonResult({
          schema,
          table,
          columns: columns.map((c) => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
          })),
        });
      } catch (error) {
        return errorResult(
          `Failed to describe table: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  return {
    snowflake_list_connections: listConnectionsTool,
    snowflake_execute_query: executeQueryTool,
    snowflake_list_schemas: listSchemasTool,
    snowflake_list_tables: listTablesTool,
    snowflake_describe_table: describeTableTool,
  };
}
