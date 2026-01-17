/**
 * Execution service interface for running bash commands and SQL queries.
 * Designed for easy swapping between local and Daytona implementations.
 */

export interface BashOptions {
  /** Working directory for command execution */
  cwd?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum buffer size for stdout/stderr (default: 10MB) */
  maxBuffer?: number;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SQLOptions {
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Maximum buffer size for output (default: 50MB) */
  maxBuffer?: number;
}

export interface SQLResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

/**
 * ExecutionService provides a sandboxed environment for running
 * bash commands and SQL queries against a Rill project.
 *
 * Implementations:
 * - LocalExecutionService: Uses child_process for local development
 * - DaytonaExecutionService: Uses Daytona SDK for production sandboxing (future)
 */
export interface ExecutionService {
  /**
   * Execute a bash command.
   * Used for exploring the filesystem, reading files, etc.
   */
  executeBash(command: string, options?: BashOptions): Promise<BashResult>;

  /**
   * Execute a SQL query via `rill query --local`.
   * Only SELECT/WITH queries are allowed.
   */
  executeSQL(sql: string, options?: SQLOptions): Promise<SQLResult>;
}
