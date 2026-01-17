import { z } from "zod";
import { publicProcedure, router } from "../index";
import {
  createAgent,
  createRillTools,
  createLocalRillService,
  createMockRillService,
} from "@grokathon-london-2026/agent";

// Data Analyst System Prompt
const DATA_ANALYST_SYSTEM_PROMPT = `You are an expert Data Analyst AI assistant powered by Grok. Your role is to help users explore, analyze, and understand their data using Rill Data.

## Your Capabilities
You have access to tools that let you:
- Query data using SQL (rill_query)
- Query metrics views with dimensions and measures (rill_query_metrics)
- List and explore data sources (rill_list_sources)
- List and explore SQL models (rill_list_models)
- List and describe metrics views (rill_list_metrics_views, rill_describe_metrics_view)
- List dashboards (rill_list_dashboards)
- Check project status (rill_project_status)
- Read project files like SQL models and YAML configs (rill_read_file)
- List files in the project (rill_list_files)

## Analysis Workflow
When analyzing data, follow this systematic approach:

1. **Understand the Project**: Start by getting project status and listing available data artifacts
2. **Explore the Schema**: List sources, models, and metrics views to understand the data structure
3. **Examine Definitions**: Read SQL models or describe metrics views to understand calculations
4. **Query Data**: Execute SQL queries or metrics aggregations to answer questions
5. **Iterate**: Refine queries based on results to dig deeper

## Best Practices
- Always start with exploratory queries (LIMIT 10-20) before running full analyses
- Use metrics views when available - they have pre-defined, validated calculations
- Explain your analysis approach before diving into queries
- Present findings clearly with key insights highlighted
- Suggest follow-up analyses when patterns emerge
- Be honest about limitations or data quality issues you notice

## Query Guidelines
- Write clean, readable SQL with proper formatting
- Use meaningful aliases for computed columns
- Add comments for complex calculations
- Use appropriate aggregations (SUM, AVG, COUNT, etc.)
- Always include LIMIT clauses to prevent overwhelming results

## Communication Style
- Be conversational but precise
- Explain technical concepts in accessible terms
- Present numbers with context (comparisons, percentages, trends)
- Use markdown formatting for clarity (tables, lists, code blocks)
- Ask clarifying questions if the analysis goal is unclear

Remember: Your goal is to help users gain actionable insights from their data. Focus on telling the story the data reveals.`;

// Configuration for the Rill project path
// Set USE_REAL_RILL=true and RILL_PROJECT_PATH to use real Rill CLI
const USE_REAL_RILL = process.env.USE_REAL_RILL === "true";
let defaultRillProjectPath: string | undefined = process.env.RILL_PROJECT_PATH || "/mock/ecommerce-analytics";

// Create Rill service - use local CLI if configured, otherwise mock
const rillService = USE_REAL_RILL ? createLocalRillService() : createMockRillService();

console.log(`[Agent] Using ${USE_REAL_RILL ? "REAL Rill CLI" : "Mock Rill Service"}`);
console.log(`[Agent] Default project path: ${defaultRillProjectPath}`);

// Lazy agent creation to ensure env vars are loaded
let agent: ReturnType<typeof createAgent> | null = null;

function getAgent(projectPath?: string) {
  // Recreate agent if project path changes
  const effectivePath = projectPath || defaultRillProjectPath;

  if (!agent) {
    console.log("[Agent Router] Creating agent instance");
    console.log("[Agent Router] XAI_API_KEY present:", !!process.env.XAI_API_KEY);
    console.log("[Agent Router] Rill project path:", effectivePath || "not set");

    const rillTools = createRillTools(rillService, effectivePath);

    agent = createAgent({
      systemPrompt: DATA_ANALYST_SYSTEM_PROMPT,
      tools: rillTools,
      maxSteps: 25, // Data analysis often requires multiple queries
    });
  }
  return agent;
}

// Helper to reset the agent (useful when project path changes)
export function resetAgent() {
  agent = null;
}

// Helper to set the default project path
export function setDefaultRillProjectPath(path: string) {
  defaultRillProjectPath = path;
  agent = null; // Reset agent to pick up new path
}

export const agentRouter = router({
  chat: publicProcedure
    .input(
      z.object({
        message: z.string().min(1).max(4000),
        projectPath: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        console.log("[Agent Router] Starting query:", input.message);
        console.log("[Agent Router] XAI_API_KEY present:", !!process.env.XAI_API_KEY);

        const result = await getAgent(input.projectPath).query(input.message);

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

  // Set the Rill project path
  setProjectPath: publicProcedure
    .input(
      z.object({
        projectPath: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      setDefaultRillProjectPath(input.projectPath);
      return { success: true, projectPath: input.projectPath };
    }),
});
