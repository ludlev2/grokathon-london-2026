/**
 * Local implementation of ExecutionService using child_process.
 * Used for local development - can be swapped for Daytona in production.
 *
 * SECURITY NOTE: This file intentionally uses exec() instead of execFile() because:
 * 1. We need shell features: pipes, globbing, redirects (e.g., `cat *.yaml | grep measure`)
 * 2. This follows Vercel's "trust the model" design philosophy
 * 3. In production, Daytona workspaces provide containerized sandboxing
 * 4. In local dev, commands are visible and the model is trusted
 *
 * See: https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
  ExecutionService,
  BashResult,
  BashOptions,
  SQLResult,
  SQLOptions,
} from "./execution.js";

const execAsync = promisify(exec);

interface LocalExecutionConfig {
  /** Path to the Rill project directory */
  projectPath: string;
  /** Default timeout for bash commands (default: 30000ms) */
  defaultBashTimeout?: number;
  /** Default timeout for SQL queries (default: 60000ms) */
  defaultSqlTimeout?: number;
  /** Default max buffer size (default: 10MB) */
  defaultMaxBuffer?: number;
}

/**
 * Create a local execution service for running bash commands and SQL queries.
 * Uses child_process.exec() to enable shell features required for data exploration.
 */
export function createLocalExecutionService(
  config: LocalExecutionConfig
): ExecutionService {
  const {
    projectPath,
    defaultBashTimeout = 30000,
    defaultSqlTimeout = 60000,
    defaultMaxBuffer = 10 * 1024 * 1024, // 10MB
  } = config;

  return {
    async executeBash(
      command: string,
      options?: BashOptions
    ): Promise<BashResult> {
      const startTime = Date.now();
      const cwd = options?.cwd ?? projectPath;
      const timeout = options?.timeout ?? defaultBashTimeout;
      const maxBuffer = options?.maxBuffer ?? defaultMaxBuffer;

      try {
        const result = await execAsync(command, {
          cwd,
          timeout,
          maxBuffer,
          shell: "/bin/bash",
        });

        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: 0,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const execError = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          message?: string;
        };

        return {
          stdout: execError.stdout ?? "",
          stderr: execError.stderr ?? execError.message ?? "Command failed",
          exitCode: execError.code ?? 1,
          durationMs,
        };
      }
    },

    async executeSQL(sql: string, options?: SQLOptions): Promise<SQLResult> {
      const startTime = Date.now();
      const timeout = options?.timeout ?? defaultSqlTimeout;
      const maxBuffer = options?.maxBuffer ?? defaultMaxBuffer;

      // Escape double quotes in SQL for shell command
      const escapedSql = sql.replace(/"/g, '\\"');
      const command = `rill query --local --sql "${escapedSql}"`;

      try {
        const result = await execAsync(command, {
          cwd: projectPath,
          timeout,
          maxBuffer,
          shell: "/bin/bash",
        });

        return {
          rawOutput: result.stdout,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const execError = error as {
          stdout?: string;
          stderr?: string;
          message?: string;
        };

        // Return partial output if available
        if (execError.stdout) {
          return {
            rawOutput: execError.stdout,
            durationMs,
          };
        }

        throw new Error(
          execError.stderr ?? execError.message ?? "SQL query failed"
        );
      }
    },
  };
}
