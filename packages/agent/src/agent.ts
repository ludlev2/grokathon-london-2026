import { generateText, stepCountIs } from "ai";
import type {
  AgentConfig,
  AgentContext,
  AgentEvent,
  AgentResult,
  ToolDefinition,
} from "./types.js";
import { TaskComplete } from "./types.js";
import { getModel } from "./models.js";
import { convertToolsToSDK, createDoneTool } from "./tools.js";
import {
  createContext,
  addMessage,
  getMessages,
  trimEphemeralMessages,
  maybeCompactContext,
} from "./context.js";

const DEFAULT_MAX_STEPS = 50;

/**
 * Extract done message from tool results if the done tool was called
 */
function extractDoneMessage(steps: Array<{ toolResults: Array<{ toolName: string; output: unknown }> }>): string | null {
  for (const step of steps) {
    for (const toolResult of step.toolResults) {
      if (toolResult.toolName === "done" && typeof toolResult.output === "string") {
        return toolResult.output;
      }
    }
  }
  return null;
}

/**
 * Create an agent with the given configuration
 */
export function createAgent(config: AgentConfig) {
  const requireDoneTool = config.requireDoneTool ?? true;
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  // Add done tool if required
  const allTools: Record<string, ToolDefinition> = { ...config.tools };
  if (requireDoneTool) {
    allTools.done = createDoneTool();
  }

  const sdkTools = convertToolsToSDK(allTools);
  const model = getModel(config.apiKey);

  return {
    /**
     * Run the agent with a prompt and return the final result
     */
    async query(prompt: string): Promise<AgentResult> {
      const context = createContext();

      // Add initial user message
      addMessage(context, { role: "user", content: prompt });

      let finalText = "";

      try {
        // Trim ephemeral messages before running
        trimEphemeralMessages(context, allTools);

        // Check if context compaction is needed
        await maybeCompactContext(context, config);

        const result = await generateText({
          model,
          system: config.systemPrompt,
          messages: getMessages(context),
          tools: sdkTools,
          stopWhen: stepCountIs(maxSteps),
        });

        // Debug logging for reasoning models
        console.log("[Agent] Response:", {
          text: result.text?.slice(0, 200),
          reasoningText: result.reasoningText?.slice(0, 200),
          stepsCount: result.steps.length,
          finishReason: result.finishReason,
        });

        // Add all response messages to context
        for (const msg of result.response.messages) {
          addMessage(context, msg);
        }

        context.stepCount = result.steps.length;

        // Check if done tool was called - this is the primary completion signal
        const doneMessage = extractDoneMessage(result.steps);
        if (doneMessage) {
          finalText = doneMessage;
        } else {
          // Handle reasoning models - they may return content in reasoningText instead of text
          finalText = result.text || result.reasoningText || "";

          // If still no text, check the last step for any text content
          if (!finalText && result.steps.length > 0) {
            const lastStep = result.steps[result.steps.length - 1];
            if (lastStep) {
              finalText = lastStep.text || lastStep.reasoningText || "";
            }
          }

          if (!finalText && context.stepCount >= maxSteps) {
            finalText = `Agent reached maximum steps (${maxSteps}) without completing.`;
          }
        }
      } catch (error) {
        if (error instanceof TaskComplete) {
          finalText = error.result;
        } else {
          throw error;
        }
      }

      return {
        text: finalText,
        steps: context.stepCount,
        messages: getMessages(context),
      };
    },

    /**
     * Run the agent with streaming events
     */
    async *queryStream(prompt: string): AsyncGenerator<AgentEvent> {
      const context = createContext();

      // Add initial user message
      addMessage(context, { role: "user", content: prompt });

      try {
        // Trim ephemeral messages before running
        trimEphemeralMessages(context, allTools);

        // Check if context compaction is needed
        await maybeCompactContext(context, config);

        const result = await generateText({
          model,
          system: config.systemPrompt,
          messages: getMessages(context),
          tools: sdkTools,
          stopWhen: stepCountIs(maxSteps),
        });

        // Emit events for each step
        for (let i = 0; i < result.steps.length; i++) {
          const step = result.steps[i];
          if (!step) continue;

          // Emit tool call events
          for (const toolCall of step.toolCalls) {
            yield {
              type: "tool_call",
              toolName: toolCall.toolName,
              args: toolCall.input,
            };
          }

          // Emit tool result events
          for (const toolResult of step.toolResults) {
            yield {
              type: "tool_result",
              toolName: toolResult.toolName,
              result: { type: "text", content: String(toolResult.output) },
            };
          }

          yield { type: "step_complete", stepNumber: i + 1 };
        }

        // Add all response messages to context
        for (const msg of result.response.messages) {
          addMessage(context, msg);
        }

        context.stepCount = result.steps.length;

        // Check if done tool was called
        const doneMessage = extractDoneMessage(result.steps);
        let responseText: string;

        if (doneMessage) {
          responseText = doneMessage;
        } else {
          // Handle reasoning models
          responseText = result.text || result.reasoningText || "";
        }

        if (responseText) {
          yield { type: "text_delta", delta: responseText };
        }

        yield {
          type: "done",
          result: responseText || `Completed in ${context.stepCount} steps`,
        };
      } catch (error) {
        if (error instanceof TaskComplete) {
          yield { type: "done", result: error.result };
        } else {
          throw error;
        }
      }
    },

    /**
     * Continue an existing conversation
     */
    async continueConversation(
      context: AgentContext,
      prompt: string
    ): Promise<AgentResult> {
      // Add new user message
      addMessage(context, { role: "user", content: prompt });

      let finalText = "";

      try {
        trimEphemeralMessages(context, allTools);
        await maybeCompactContext(context, config);

        const remainingSteps = Math.max(1, maxSteps - context.stepCount);

        const result = await generateText({
          model,
          system: config.systemPrompt,
          messages: getMessages(context),
          tools: sdkTools,
          stopWhen: stepCountIs(remainingSteps),
        });

        for (const msg of result.response.messages) {
          addMessage(context, msg);
        }

        context.stepCount += result.steps.length;

        // Check if done tool was called
        const doneMessage = extractDoneMessage(result.steps);
        if (doneMessage) {
          finalText = doneMessage;
        } else {
          // Handle reasoning models
          finalText = result.text || result.reasoningText || "";

          if (!finalText && context.stepCount >= maxSteps) {
            finalText = `Agent reached maximum steps (${maxSteps}) without completing.`;
          }
        }
      } catch (error) {
        if (error instanceof TaskComplete) {
          finalText = error.result;
        } else {
          throw error;
        }
      }

      return {
        text: finalText,
        steps: context.stepCount,
        messages: getMessages(context),
      };
    },
  };
}

export type Agent = ReturnType<typeof createAgent>;
