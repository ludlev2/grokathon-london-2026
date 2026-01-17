import { z } from "zod";
import { publicProcedure, router } from "../index";
import {
  createAgent,
  defineTool,
  textResult,
  jsonResult,
} from "@grokathon-london-2026/agent";
import { dataAnalysisTools } from "../tools/data-analysis.js";

// Define tools for the agent
const weatherTool = defineTool({
  description: "Get the current weather for a location",
  inputSchema: z.object({
    location: z.string().max(100).describe("City name or location"),
  }),
  execute: async ({ location }) => {
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
  description:
    "Perform basic math calculations (add, subtract, multiply, divide)",
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

// Lazy agent creation to ensure env vars are loaded
let agent: ReturnType<typeof createAgent> | null = null;

function getAgent() {
  if (!agent) {
    console.log("[Agent Router] Creating agent instance");
    console.log("[Agent Router] XAI_API_KEY present:", !!process.env.XAI_API_KEY);

    agent = createAgent({
      systemPrompt: `You are a data analysis assistant powered by Grok. You help users analyze business data using Snowflake and Rill.

You have access to powerful data analysis tools:
- **listSnowflakeConnections**: See available data connections
- **createDataSandbox**: Create an isolated environment for data analysis with Snowflake credentials
- **executeDataQuery**: Run SQL queries against Snowflake
- **listRillMetrics**: Discover available metrics and dimensions for analysis
- **getRillMetricsView**: Read the definition of a specific metrics view
- **startRillServer**: Start the Rill development server for interactive exploration
- **runSandboxCommand**: Execute shell commands for advanced operations
- **deleteSandbox**: Clean up resources when done

**Workflow for data analysis:**
1. First, use listSnowflakeConnections to see what data sources are available
2. Create a sandbox with createDataSandbox using the desired connection
3. Use executeDataQuery to run SQL queries and analyze data
4. When finished, use deleteSandbox to clean up

Be precise with SQL queries and provide clear insights from query results.
When you have completed the analysis, use the done tool to signal completion.`,
      tools: {
        weather: weatherTool,
        calculator: calculatorTool,
        // Data analysis tools
        ...dataAnalysisTools,
      },
      maxSteps: 25, // More steps for complex data analysis
    });
  }
  return agent;
}

export const agentRouter = router({
  chat: publicProcedure
    .input(
      z.object({
        message: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ input }) => {
      try {
        console.log("[Agent Router] Starting query:", input.message);
        console.log("[Agent Router] XAI_API_KEY present:", !!process.env.XAI_API_KEY);

        const result = await getAgent().query(input.message);

        console.log("[Agent Router] Query complete:", {
          textLength: result.text?.length,
          steps: result.steps,
        });

        // Get detailed step information from messages
        const toolCalls: Array<{ toolName: string; args: unknown; toolCallId: string }> = [];
        const toolResults: Array<{ toolName: string; result: unknown; toolCallId: string }> = [];

        for (const msg of result.messages) {
          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (typeof part === "object" && part !== null && "type" in part && part.type === "tool-call") {
                const toolPart = part as { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };
                toolCalls.push({
                  toolName: toolPart.toolName,
                  args: toolPart.input,
                  toolCallId: toolPart.toolCallId,
                });
              }
            }
          }
          if (msg.role === "tool" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (typeof part === "object" && part !== null && "type" in part && part.type === "tool-result") {
                const toolPart = part as { type: "tool-result"; toolCallId: string; toolName: string; output: unknown };
                toolResults.push({
                  toolName: toolPart.toolName,
                  result: toolPart.output,
                  toolCallId: toolPart.toolCallId,
                });
              }
            }
          }
        }

        return {
          response: result.text,
          steps: result.steps,
          toolCalls,
          toolResults,
        };
      } catch (error) {
        console.error("[Agent Router] Error:", error);

        // Log more details about the error
        if (error instanceof Error) {
          console.error("[Agent Router] Error name:", error.name);
          console.error("[Agent Router] Error message:", error.message);
          console.error("[Agent Router] Error stack:", error.stack);
        }

        throw error;
      }
    }),
});
