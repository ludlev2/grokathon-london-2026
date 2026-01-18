/**
 * Sandbox implementation of ExecutionService using Daytona sandboxes.
 * Executes commands against a remote sandbox environment.
 *
 * Unlike local execution, this:
 * 1. Sends commands to a Daytona sandbox via API
 * 2. Requires cd'ing into the working directory before each command
 * 3. Provides true isolation from the host system
 */

import type {
  ExecutionService,
  BashResult,
  BashOptions,
  SQLResult,
  SQLOptions,
} from "./execution.js";

interface SandboxExecutionConfig {
  /** The sandbox ID to execute commands against */
  sandboxId: string;
  /** Working directory inside the sandbox (e.g., /tmp/volume-name) */
  workingDirectory: string;
  /** Server URL for the API */
  serverUrl: string;
  /** Default timeout for bash commands (default: 30000ms) */
  defaultBashTimeout?: number;
  /** Default timeout for SQL queries (default: 60000ms) */
  defaultSqlTimeout?: number;
}

/**
 * Execute a command against a Daytona sandbox via the tRPC API
 *
 * tRPC v11 HTTP format for mutations:
 * - URL: /trpc/<procedure>
 * - Method: POST
 * - Body: The input directly as JSON (not wrapped)
 */
async function executeCommandInSandbox(
  serverUrl: string,
  sandboxId: string,
  command: string,
  workingDir: string | undefined,
  timeout: number
): Promise<{ exitCode: number; result: string }> {
  const input = {
    sandboxId,
    command,
    workingDir,
    timeout,
  };

  // Log for debugging
  console.log("[SandboxExec] Calling tRPC with:", { serverUrl, sandboxId: sandboxId.slice(0, 8), command: command.slice(0, 50) });

  const response = await fetch(`${serverUrl}/trpc/sandbox.executeCommand`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Sandbox command failed: ${response.status} ${responseText}`);
  }

  // Try to parse the response
  let data: unknown;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid JSON response: ${responseText}`);
  }

  // Handle various tRPC response formats
  // Format 1: { result: { data: { json: {...} } } }
  // Format 2: { result: { data: {...} } }
  // Format 3: Array format [{ result: {...} }]

  const result = data as Record<string, unknown>;

  // Check if it's an array (batched response)
  if (Array.isArray(result)) {
    const firstResult = result[0] as Record<string, unknown>;
    if (firstResult?.result) {
      const resultData = (firstResult.result as Record<string, unknown>).data as Record<string, unknown>;
      if (resultData?.json) {
        return resultData.json as { exitCode: number; result: string };
      }
      return resultData as { exitCode: number; result: string };
    }
  }

  // Single response format
  if (result.result) {
    const resultObj = result.result as Record<string, unknown>;
    if (resultObj.data) {
      const dataObj = resultObj.data as Record<string, unknown>;
      if (dataObj.json) {
        return dataObj.json as { exitCode: number; result: string };
      }
      return dataObj as { exitCode: number; result: string };
    }
  }

  throw new Error(`Unexpected response format: ${JSON.stringify(data)}`);
}

/**
 * Create a sandbox execution service for running commands in a Daytona sandbox.
 * Commands are executed by cd'ing into the working directory first.
 */
export function createSandboxExecutionService(
  config: SandboxExecutionConfig
): ExecutionService {
  const {
    sandboxId,
    workingDirectory,
    serverUrl,
    defaultBashTimeout = 30000,
    defaultSqlTimeout = 60000,
  } = config;

  console.log("[SandboxExecutionService] Created with config:", {
    sandboxId,
    workingDirectory,
    serverUrl,
  });

  return {
    async executeBash(
      command: string,
      options?: BashOptions
    ): Promise<BashResult> {
      const startTime = Date.now();
      const timeout = options?.timeout ?? defaultBashTimeout;

      console.log("[SandboxExecutionService.executeBash] Called with:", {
        command,
        sandboxId,
        workingDirectory,
      });

      // Wrap command to cd into working directory first
      const wrappedCommand = `cd "${workingDirectory}" && ${command}`;

      try {
        const result = await executeCommandInSandbox(
          serverUrl,
          sandboxId,
          wrappedCommand,
          undefined, // workingDir is handled in the wrapped command
          timeout
        );

        return {
          stdout: result.result,
          stderr: "",
          exitCode: result.exitCode,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : "Command failed";

        return {
          stdout: "",
          stderr: errorMessage,
          exitCode: 1,
          durationMs,
        };
      }
    },

    async executeSQL(sql: string, options?: SQLOptions): Promise<SQLResult> {
      const startTime = Date.now();
      const timeout = options?.timeout ?? defaultSqlTimeout;

      // Escape double quotes in SQL for shell command
      const escapedSql = sql.replace(/"/g, '\\"');
      // Wrap the rill command to cd into working directory first
      const command = `cd "${workingDirectory}" && rill query --local --sql "${escapedSql}"`;

      try {
        const result = await executeCommandInSandbox(
          serverUrl,
          sandboxId,
          command,
          undefined,
          timeout
        );

        return {
          rawOutput: result.result,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : "SQL query failed";

        // Return the error as output
        if (errorMessage.includes("result")) {
          return {
            rawOutput: errorMessage,
            durationMs,
          };
        }

        throw new Error(errorMessage);
      }
    },
  };
}
