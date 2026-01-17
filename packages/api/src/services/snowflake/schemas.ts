import { z } from "zod";

/**
 * Snowflake connection configuration (non-sensitive)
 */
export const snowflakeConfigSchema = z.object({
  account: z.string().min(1).max(255),
  username: z.string().min(1).max(255),
  warehouse: z.string().min(1).max(255),
  database: z.string().min(1).max(255),
  schema: z.string().min(1).max(255),
  role: z.string().max(255).optional(),
});

export type SnowflakeConfig = z.infer<typeof snowflakeConfigSchema>;

/**
 * Key-pair authentication credentials
 */
export const keyPairCredentialSchema = z.object({
  authMethod: z.literal("key_pair"),
  privateKey: z.string().min(1).max(10000),
  privateKeyPassphrase: z.string().max(255).optional(),
});

/**
 * Password authentication credentials
 */
export const passwordCredentialSchema = z.object({
  authMethod: z.literal("password"),
  password: z.string().min(1).max(255),
});

/**
 * Combined credential schema (discriminated union)
 */
export const snowflakeCredentialSchema = z.discriminatedUnion("authMethod", [
  keyPairCredentialSchema,
  passwordCredentialSchema,
]);

export type SnowflakeCredential = z.infer<typeof snowflakeCredentialSchema>;

/**
 * Input for creating a new Snowflake connection
 */
export const createSnowflakeConnectionSchema = z.object({
  name: z.string().min(1).max(255),
  config: snowflakeConfigSchema,
  credential: snowflakeCredentialSchema,
});

export type CreateSnowflakeConnectionInput = z.infer<typeof createSnowflakeConnectionSchema>;

/**
 * Input for updating a Snowflake connection
 */
export const updateSnowflakeConnectionSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  name: z.string().min(1).max(255).optional(),
  config: snowflakeConfigSchema.partial().optional(),
  credential: snowflakeCredentialSchema.optional(),
});

export type UpdateSnowflakeConnectionInput = z.infer<typeof updateSnowflakeConnectionSchema>;

/**
 * Query execution input
 */
export const executeQuerySchema = z.object({
  connectionId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  sql: z.string().min(1).max(100000),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
});

export type ExecuteQueryInput = z.infer<typeof executeQuerySchema>;

/**
 * Query result
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  columns: ColumnMetadata[];
  executionTimeMs: number;
}

export interface ColumnMetadata {
  name: string;
  type: string;
  nullable: boolean;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: "healthy" | "unhealthy";
  latencyMs: number;
  message?: string;
  timestamp: Date;
}
