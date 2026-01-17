import { createXai } from "@ai-sdk/xai";
import { GROK_MODEL } from "./types.js";

/**
 * Context limit for grok-4-fast-reasoning (approximate token count)
 */
export const CONTEXT_LIMIT = 131072;

/**
 * Create an xAI provider instance
 */
export function createXaiProvider(apiKey?: string) {
  return createXai({
    apiKey: apiKey ?? process.env.XAI_API_KEY,
  });
}

/**
 * Get the configured xAI grok-4-fast-reasoning model
 */
export function getModel(apiKey?: string) {
  const xai = createXaiProvider(apiKey);
  return xai(GROK_MODEL);
}

/**
 * Get the context limit
 */
export function getContextLimit(): number {
  return CONTEXT_LIMIT;
}

/**
 * Estimate token count from text (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
