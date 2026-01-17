import { generateText, streamText, stepCountIs } from "ai";
import type {
  AgentConfig,
  AgentContext,
  AgentEvent,
  AgentResult,
  ToolDefinition,
} from "./types.js";
import { TaskComplete } from "./types.js";
import { getModel } from "./models.js";
import { convertToolsToSDK } from "./tools.js";
import {
  createContext,
  addMessage,
  getMessages,
  trimEphemeralMessages,
  maybeCompactContext,
} from "./context.js";

const DEFAULT_MAX_STEPS = 50;

/**
 * Create an agent with the given configuration
 */
export function createAgent(config: AgentConfig) {
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  const allTools: Record<string, ToolDefinition> = { ...config.tools };
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
     * Run the agent with real-time streaming events.
     * Events are emitted as they happen, not after all steps complete.
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

        const result = streamText({
          model,
          system: config.systemPrompt,
          messages: getMessages(context),
          tools: sdkTools,
          stopWhen: stepCountIs(maxSteps),
        });

        let currentStep = 0;
        let accumulatedText = "";

        // Stream events in real-time
        for await (const chunk of result.fullStream) {
          switch (chunk.type) {
            case "tool-call":
              yield {
                type: "tool_call",
                toolName: chunk.toolName,
                args: chunk.input,
              };
              break;

            case "tool-result":
              yield {
                type: "tool_result",
                toolName: chunk.toolName,
                result: { type: "text", content: String(chunk.output) },
              };
              currentStep++;
              yield { type: "step_complete", stepNumber: currentStep };
              break;

            case "text-delta":
              accumulatedText += chunk.text;
              yield { type: "text_delta", delta: chunk.text };
              break;

            case "reasoning-delta":
              // For reasoning models, treat reasoning as text delta
              yield { type: "text_delta", delta: chunk.text };
              accumulatedText += chunk.text;
              break;

            case "error":
              throw new Error(String(chunk.error));
          }
        }

        // Get the final response for context management
        const response = await result.response;

        // Add all response messages to context
        for (const msg of response.messages) {
          addMessage(context, msg);
        }

        context.stepCount = currentStep;

        // Get final text if not accumulated during streaming
        if (!accumulatedText) {
          const finalText = await result.text;
          const reasoningText = await result.reasoningText;
          accumulatedText = finalText || reasoningText || "";
        }

        yield {
          type: "done",
          result: accumulatedText || `Completed in ${context.stepCount} steps`,
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
     * Get the raw streamText result for integration with AI SDK response helpers
     */
    queryStreamRaw(prompt: string) {
      const context = createContext();
      addMessage(context, { role: "user", content: prompt });
      trimEphemeralMessages(context, allTools);

      return streamText({
        model,
        system: config.systemPrompt,
        messages: getMessages(context),
        tools: sdkTools,
        stopWhen: stepCountIs(maxSteps),
      });
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

        // Handle reasoning models
        finalText = result.text || result.reasoningText || "";

        if (!finalText && context.stepCount >= maxSteps) {
          finalText = `Agent reached maximum steps (${maxSteps}) without completing.`;
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
     * Continue an existing conversation with streaming events.
     * Use this to maintain conversation context across multiple turns.
     */
    async *continueConversationStream(
      context: AgentContext,
      prompt: string
    ): AsyncGenerator<AgentEvent> {
      // Add new user message
      addMessage(context, { role: "user", content: prompt });

      try {
        trimEphemeralMessages(context, allTools);
        await maybeCompactContext(context, config);

        const remainingSteps = Math.max(1, maxSteps - context.stepCount);

        const result = streamText({
          model,
          system: config.systemPrompt,
          messages: getMessages(context),
          tools: sdkTools,
          stopWhen: stepCountIs(remainingSteps),
        });

        let currentStep = 0;
        let accumulatedText = "";

        // Stream events in real-time
        for await (const chunk of result.fullStream) {
          switch (chunk.type) {
            case "tool-call":
              yield {
                type: "tool_call",
                toolName: chunk.toolName,
                args: chunk.input,
              };
              break;

            case "tool-result":
              yield {
                type: "tool_result",
                toolName: chunk.toolName,
                result: { type: "text", content: String(chunk.output) },
              };
              currentStep++;
              yield { type: "step_complete", stepNumber: currentStep };
              break;

            case "text-delta":
              accumulatedText += chunk.text;
              yield { type: "text_delta", delta: chunk.text };
              break;

            case "reasoning-delta":
              yield { type: "text_delta", delta: chunk.text };
              accumulatedText += chunk.text;
              break;

            case "error":
              throw new Error(String(chunk.error));
          }
        }

        // Get the final response for context management
        const response = await result.response;

        // Add all response messages to context
        for (const msg of response.messages) {
          addMessage(context, msg);
        }

        context.stepCount += currentStep;

        // Get final text if not accumulated during streaming
        if (!accumulatedText) {
          const finalText = await result.text;
          const reasoningText = await result.reasoningText;
          accumulatedText = finalText || reasoningText || "";
        }

        yield {
          type: "done",
          result: accumulatedText || `Completed in ${context.stepCount} steps`,
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
     * Create a new context for a conversation session
     */
    createNewContext(): AgentContext {
      return createContext();
    },
  };
}

export type Agent = ReturnType<typeof createAgent>;
