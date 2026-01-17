import snowflake from "snowflake-sdk";
import { createPrivateKey } from "node:crypto";
import type {
  SnowflakeConfig,
  SnowflakeCredential,
  QueryResult,
  ColumnMetadata,
  HealthCheckResult,
} from "./schemas.js";

const DEFAULT_CONNECTION_TIMEOUT_MS = 30000;
const DEFAULT_QUERY_TIMEOUT_MS = 120000;

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface QueryOptions {
  timeoutMs?: number;
  maxRows?: number;
}

/**
 * Snowflake adapter for executing queries
 */
export class SnowflakeAdapter {
  private connection: snowflake.Connection | null = null;
  private status: ConnectionStatus = "disconnected";

  constructor(
    private readonly config: SnowflakeConfig,
    private readonly credential: SnowflakeCredential
  ) {}

  /**
   * Connect to Snowflake
   */
  async connect(): Promise<void> {
    if (this.status === "connected") {
      return;
    }

    this.status = "connecting";

    const connectionOptions = this.buildConnectionOptions();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.status = "error";
        reject(new Error(`Connection timed out after ${DEFAULT_CONNECTION_TIMEOUT_MS}ms`));
      }, DEFAULT_CONNECTION_TIMEOUT_MS);

      this.connection = snowflake.createConnection(connectionOptions);

      this.connection.connect((err) => {
        clearTimeout(timeoutId);
        if (err) {
          this.status = "error";
          reject(new Error(`Failed to connect to Snowflake: ${err.message}`));
        } else {
          this.status = "connected";
          resolve();
        }
      });
    });
  }

  /**
   * Disconnect from Snowflake
   */
  async disconnect(): Promise<void> {
    if (!this.connection || this.status === "disconnected") {
      return;
    }

    return new Promise((resolve) => {
      this.connection!.destroy((err) => {
        if (err) {
          console.error("Error disconnecting from Snowflake:", err.message);
        }
        this.connection = null;
        this.status = "disconnected";
        resolve();
      });
    });
  }

  /**
   * Execute a SQL query
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    if (this.status !== "connected" || !this.connection) {
      throw new Error("Not connected to Snowflake");
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Query timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.connection!.execute({
        sqlText: sql,
        complete: (err, stmt, rows) => {
          clearTimeout(timeoutId);
          const executionTimeMs = Date.now() - startTime;

          if (err) {
            reject(new Error(`Query execution failed: ${err.message}`));
            return;
          }

          const columns: ColumnMetadata[] = (stmt.getColumns() ?? []).map((col) => ({
            name: col.getName(),
            type: col.getType(),
            nullable: col.isNullable(),
          }));

          let resultRows = (rows ?? []) as T[];
          if (options.maxRows && resultRows.length > options.maxRows) {
            resultRows = resultRows.slice(0, options.maxRows);
          }

          resolve({
            rows: resultRows,
            rowCount: resultRows.length,
            columns,
            executionTimeMs,
          });
        },
      });
    });
  }

  /**
   * Test the connection
   */
  async testConnection(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      await this.connect();
      await this.query("SELECT 1 AS health_check");
      const latencyMs = Date.now() - startTime;

      return {
        status: "healthy",
        latencyMs,
        timestamp: new Date(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : "Unknown error";

      return {
        status: "unhealthy",
        latencyMs,
        message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * List all schemas in the database
   */
  async listSchemas(): Promise<string[]> {
    const result = await this.query<{ SCHEMA_NAME: string }>(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME`
    );
    return result.rows.map((row) => row.SCHEMA_NAME);
  }

  /**
   * List all tables in a schema
   */
  async listTables(schema: string): Promise<string[]> {
    const escapedSchema = this.escapeString(schema);
    const result = await this.query<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${escapedSchema}' ORDER BY TABLE_NAME`
    );
    return result.rows.map((row) => row.TABLE_NAME);
  }

  /**
   * Describe a table's columns
   */
  async describeTable(
    schema: string,
    table: string
  ): Promise<Array<{ name: string; type: string; nullable: boolean }>> {
    const escapedSchema = this.escapeString(schema);
    const escapedTable = this.escapeString(table);
    const result = await this.query<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
    }>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = '${escapedSchema}' AND TABLE_NAME = '${escapedTable}'
       ORDER BY ORDINAL_POSITION`
    );

    return result.rows.map((row) => ({
      name: row.COLUMN_NAME,
      type: row.DATA_TYPE,
      nullable: row.IS_NULLABLE === "YES",
    }));
  }

  /**
   * Build connection options for the Snowflake SDK
   */
  private buildConnectionOptions(): snowflake.ConnectionOptions {
    const baseOptions: snowflake.ConnectionOptions = {
      account: this.config.account,
      username: this.config.username,
      database: this.config.database,
      warehouse: this.config.warehouse,
      schema: this.config.schema,
      application: "grokathon-ai-analyst",
    };

    if (this.config.role) {
      baseOptions.role = this.config.role;
    }

    if (this.credential.authMethod === "key_pair") {
      const privateKey = this.normalizePrivateKey(
        this.credential.privateKey,
        this.credential.privateKeyPassphrase
      );
      baseOptions.authenticator = "SNOWFLAKE_JWT";
      baseOptions.privateKey = privateKey;
    } else {
      baseOptions.password = this.credential.password;
    }

    return baseOptions;
  }

  /**
   * Normalize and potentially decrypt a private key
   */
  private normalizePrivateKey(privateKey: string, passphrase?: string): string {
    // Replace escaped newlines with actual newlines
    let normalized = privateKey.replace(/\\n/g, "\n");

    // If it doesn't have proper PEM headers, try to add them
    if (!normalized.includes("-----BEGIN")) {
      // Check if it's base64 encoded
      const base64Regex = /^[A-Za-z0-9+/=\s]+$/;
      if (base64Regex.test(normalized.replace(/\s/g, ""))) {
        normalized = `-----BEGIN PRIVATE KEY-----\n${normalized}\n-----END PRIVATE KEY-----`;
      }
    }

    // If there's a passphrase, decrypt the key
    if (passphrase) {
      try {
        const keyObject = createPrivateKey({
          key: normalized,
          passphrase: passphrase,
        });
        normalized = keyObject.export({ type: "pkcs8", format: "pem" }) as string;
      } catch (error) {
        throw new Error(
          `Failed to decrypt private key: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    return normalized;
  }

  /**
   * Escape a string for use in SQL
   */
  private escapeString(value: string): string {
    return value.replace(/'/g, "''");
  }
}

/**
 * Execute a query with automatic connection management
 */
export async function withSnowflakeConnection<T>(
  config: SnowflakeConfig,
  credential: SnowflakeCredential,
  operation: (adapter: SnowflakeAdapter) => Promise<T>
): Promise<T> {
  const adapter = new SnowflakeAdapter(config, credential);

  try {
    await adapter.connect();
    return await operation(adapter);
  } finally {
    await adapter.disconnect();
  }
}
