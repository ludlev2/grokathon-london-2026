/**
 * Example usage of the agent SDK with xAI grok-4-fast-reasoning
 *
 * Run with: npx tsx packages/agent/src/example.ts
 * Requires XAI_API_KEY environment variable
 */

import { z } from "zod";
import { createAgent, defineTool, textResult, jsonResult } from "./index.js";

// Define some example tools
const weatherTool = defineTool({
  description: "Get the current weather for a location",
  inputSchema: z.object({
    location: z.string().max(100).describe("City name or location"),
  }),
  execute: async ({ location }) => {
    // Simulated weather data
    const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temp = Math.floor(Math.random() * 30) + 10;

    return jsonResult({
      location,
      temperature: temp,
      unit: "celsius",
      condition,
    });
  },
});

const calculatorTool = defineTool({
  description: "Perform basic math calculations (add, subtract, multiply, divide)",
  inputSchema: z.object({
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
    operation: z
      .enum(["add", "subtract", "multiply", "divide"])
      .describe("The operation to perform"),
  }),
  execute: async ({ a, b, operation }) => {
    let result: number;
    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) {
          return { type: "error" as const, message: "Division by zero" };
        }
        result = a / b;
        break;
      default: {
        const _exhaustive: never = operation;
        throw new Error(`Unknown operation: ${_exhaustive}`);
      }
    }
    return textResult(`${a} ${operation} ${b} = ${result}`);
  },
});

// Create the agent
const agent = createAgent({
  systemPrompt: `You are a helpful assistant with access to tools.
Use the weather tool to check weather conditions.
Use the calculator tool for math calculations.
When you have completed the user's request, use the done tool to signal completion.`,
  tools: {
    weather: weatherTool,
    calculator: calculatorTool,
  },
  maxSteps: 10,
  // Optional: Enable context compaction at 80% of context limit
  compaction: {
    thresholdRatio: 0.8,
  },
});

// Example: Simple query
async function runSimpleExample() {
  console.log("=== Simple Query Example ===\n");

  const result = await agent.query(
    "What's the weather in London and what is 25 multiplied by 4?"
  );

  console.log("Final result:", result.text);
  console.log("Steps taken:", result.steps);
  console.log("---\n");
}

// Example: Streaming events
async function runStreamingExample() {
  console.log("=== Streaming Example ===\n");

  for await (const event of agent.queryStream(
    "Calculate 100 divided by 5 and tell me the weather in Paris"
  )) {
    switch (event.type) {
      case "tool_call":
        console.log(`[Tool Call] ${event.toolName}:`, event.args);
        break;
      case "tool_result":
        console.log(`[Tool Result] ${event.toolName}:`, event.result);
        break;
      case "step_complete":
        console.log(`[Step ${event.stepNumber} complete]`);
        break;
      case "text_delta":
        console.log(`[Text] ${event.delta}`);
        break;
      case "done":
        console.log(`[Done] ${event.result}`);
        break;
    }
  }

  console.log("---\n");
}

// Run examples
async function main() {
  if (!process.env.XAI_API_KEY) {
    console.error("Error: XAI_API_KEY environment variable is required");
    process.exit(1);
  }

  await runSimpleExample();
  await runStreamingExample();
}

main().catch(console.error);
