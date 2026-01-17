import { generateText, type ModelMessage } from "ai";
import type {
  AgentConfig,
  AgentContext,
  ToolDefinition,
  TrackedMessage,
} from "./types.js";
import { getModel, getContextLimit, estimateTokens } from "./models.js";

/**
 * Create a new agent context
 */
export function createContext(): AgentContext {
  return {
    messages: [],
    stepCount: 0,
    startTime: Date.now(),
  };
}

/**
 * Add a message to the context with tracking metadata
 */
export function addMessage(
  context: AgentContext,
  message: ModelMessage,
  ephemeralInfo?: { toolName: string; index: number }
): void {
  context.messages.push({
    message,
    timestamp: Date.now(),
    ephemeral: ephemeralInfo,
  });
}

/**
 * Get messages ready for the AI SDK (without tracking metadata)
 */
export function getMessages(context: AgentContext): ModelMessage[] {
  return context.messages.map((tm) => tm.message);
}

/**
 * Trim ephemeral messages to keep only the most recent N for each tool
 */
export function trimEphemeralMessages(
  context: AgentContext,
  tools: Record<string, ToolDefinition>
): void {
  // Group ephemeral messages by tool name
  const ephemeralByTool = new Map<string, TrackedMessage[]>();

  for (const tracked of context.messages) {
    if (tracked.ephemeral) {
      const existing = ephemeralByTool.get(tracked.ephemeral.toolName) ?? [];
      existing.push(tracked);
      ephemeralByTool.set(tracked.ephemeral.toolName, existing);
    }
  }

  // Determine which messages to remove
  const toRemove = new Set<TrackedMessage>();

  for (const [toolName, messages] of ephemeralByTool.entries()) {
    const toolDef = tools[toolName];
    if (!toolDef?.ephemeral) continue;

    const keepCount = toolDef.ephemeral;
    if (messages.length <= keepCount) continue;

    // Sort by timestamp (oldest first) and mark older ones for removal
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const removeCount = sorted.length - keepCount;

    for (let i = 0; i < removeCount; i++) {
      const msg = sorted[i];
      if (msg) {
        toRemove.add(msg);
      }
    }
  }

  // Filter out removed messages
  context.messages = context.messages.filter((tm) => !toRemove.has(tm));
}

/**
 * Estimate the total token count of messages in context
 */
export function estimateContextTokens(context: AgentContext): number {
  let total = 0;

  for (const tracked of context.messages) {
    const msg = tracked.message;

    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ("text" in part && typeof part.text === "string") {
          total += estimateTokens(part.text);
        } else if ("result" in part) {
          total += estimateTokens(JSON.stringify(part.result));
        }
      }
    }
  }

  return total;
}

/**
 * Check if context compaction is needed and perform it if so
 */
export async function maybeCompactContext(
  context: AgentContext,
  config: AgentConfig
): Promise<void> {
  if (!config.compaction) return;

  const contextLimit = getContextLimit();
  const threshold = contextLimit * config.compaction.thresholdRatio;
  const currentTokens = estimateContextTokens(context);

  if (currentTokens < threshold) return;

  // Perform compaction by summarizing older messages
  await compactContext(context, config);
}

/**
 * Compact context by summarizing older messages
 */
async function compactContext(
  context: AgentContext,
  config: AgentConfig
): Promise<void> {
  // Keep the most recent messages and summarize the rest
  const keepRecent = 4; // Keep last 4 messages (2 turns)

  if (context.messages.length <= keepRecent + 1) {
    return; // Not enough to compact
  }

  const toSummarize = context.messages.slice(0, -keepRecent);
  const toKeep = context.messages.slice(-keepRecent);

  // Generate summary
  const summaryModel = getModel(config.apiKey);

  const messagesForSummary: ModelMessage[] = toSummarize.map((tm) => tm.message);

  const { text: summary } = await generateText({
    model: summaryModel,
    system: `You are a summarization assistant. Summarize the following conversation history concisely,
preserving key information, decisions made, and any important context needed to continue the task.
Keep the summary under 500 words.`,
    messages: messagesForSummary,
  });

  // Replace old messages with summary
  const summaryMessage: TrackedMessage = {
    message: {
      role: "user",
      content: `[Previous conversation summary]\n${summary}\n[End of summary - conversation continues below]`,
    },
    timestamp: Date.now(),
  };

  context.messages = [summaryMessage, ...toKeep];
}
