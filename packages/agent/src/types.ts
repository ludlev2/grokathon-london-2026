import type { z } from "zod";
import type { ModelMessage } from "ai";

/**
 * Supported xAI Grok model - only grok-4-fast-reasoning
 */
export const GROK_MODEL = "grok-4-1-fast-reasoning" as const;

export type GrokModel = typeof GROK_MODEL;

/**
 * Tool definition with Zod schema for type-safe parameters
 */
export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Human-readable description of what the tool does */
  description: string;
  /** Zod schema for input validation */
  inputSchema: TInput;
  /** Execute the tool with validated input */
  execute: (input: z.infer<TInput>) => Promise<ToolResult>;
  /**
   * Number of previous tool results to keep in context.
   * When set, older results from this tool are trimmed to save context.
   * Useful for tools that return large outputs (screenshots, DOM, etc.)
   */
  ephemeral?: number;
}

/**
 * Result returned by a tool execution
 */
export type ToolResult =
  | { type: "text"; content: string }
  | { type: "json"; content: unknown }
  | { type: "error"; message: string };

/**
 * Signal to indicate the agent should stop
 */
export class TaskComplete extends Error {
  constructor(public readonly result: string) {
    super(`Task completed: ${result}`);
    this.name = "TaskComplete";
  }
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** System prompt providing context and instructions */
  systemPrompt: string;
  /** Available tools */
  tools: Record<string, ToolDefinition>;
  /** Maximum number of steps before forcing stop */
  maxSteps?: number;
  /**
   * Context compaction configuration.
   * When token count approaches this ratio of max context, summarize older messages.
   */
  compaction?: {
    /** Threshold ratio (0-1) of max context to trigger compaction */
    thresholdRatio: number;
  };
  /** xAI API key (defaults to XAI_API_KEY env var) */
  apiKey?: string;
}

/**
 * Event types emitted during agent execution
 */
export type AgentEvent =
  | { type: "tool_call"; toolName: string; args: unknown }
  | { type: "tool_result"; toolName: string; result: ToolResult }
  | { type: "text_delta"; delta: string }
  | { type: "step_complete"; stepNumber: number }
  | { type: "done"; result: string };

/**
 * Agent query result
 */
export interface AgentResult {
  /** Final text response from the agent */
  text: string;
  /** Number of steps taken */
  steps: number;
  /** Full message history */
  messages: ModelMessage[];
}

/**
 * Internal message with metadata for context management
 */
export interface TrackedMessage {
  message: ModelMessage;
  /** Timestamp when message was added */
  timestamp: number;
  /** Whether this message contains ephemeral tool results */
  ephemeral?: {
    toolName: string;
    index: number;
  };
}

/**
 * Context state for an agent session
 */
export interface AgentContext {
  messages: TrackedMessage[];
  stepCount: number;
  startTime: number;
}
