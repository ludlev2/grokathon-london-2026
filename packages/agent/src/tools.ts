import { tool, type Tool } from "ai";
import { z } from "zod";
import type { ToolDefinition, ToolResult } from "./types.js";

/**
 * Define a tool with type-safe input schema
 */
export function defineTool<TSchema extends z.ZodTypeAny>(
  definition: ToolDefinition<TSchema>
): ToolDefinition<TSchema> {
  return definition;
}

/**
 * Convert our tool definitions to AI SDK format
 */
export function convertToolsToSDK(
  toolDefs: Record<string, ToolDefinition>
): Record<string, Tool> {
  const sdkTools: Record<string, Tool> = {};

  for (const [name, def] of Object.entries(toolDefs)) {
    sdkTools[name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (args: z.infer<typeof def.inputSchema>) => {
        const result = await def.execute(args);
        return formatToolResult(result);
      },
    }) as Tool;
  }

  return sdkTools;
}

/**
 * Format tool result for the AI SDK
 */
function formatToolResult(result: ToolResult): string {
  switch (result.type) {
    case "text":
      return result.content;
    case "json":
      return JSON.stringify(result.content, null, 2);
    case "error":
      return `Error: ${result.message}`;
    default: {
      const _exhaustive: never = result;
      throw new Error(`Unhandled result type: ${_exhaustive}`);
    }
  }
}

/**
 * Helper to create a text result
 */
export function textResult(content: string): ToolResult {
  return { type: "text", content };
}

/**
 * Helper to create a JSON result
 */
export function jsonResult(content: unknown): ToolResult {
  return { type: "json", content };
}

/**
 * Helper to create an error result
 */
export function errorResult(message: string): ToolResult {
  return { type: "error", message };
}
