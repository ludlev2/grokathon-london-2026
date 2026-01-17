import { z } from "zod";
import { publicProcedure, router } from "../index";
import {
  createAgent,
  // Approach A: Specialized (11 tools)
  createRillTools,
  createLocalRillService,
  // Approach B: General (2 tools)
  createExecutionTools,
  createLocalExecutionService,
} from "@grokathon-london-2026/agent";

// ===========================================
// MODE SELECTION
// ===========================================
// Set AGENT_MODE=specialized for 11-tool approach
// Set AGENT_MODE=general for 2-tool approach (default)
type AgentMode = "specialized" | "general";
const AGENT_MODE: AgentMode =
  (process.env.AGENT_MODE as AgentMode) || "general";

console.log(`[Agent] Mode: ${AGENT_MODE.toUpperCase()}`);

// ===========================================
// SYSTEM PROMPTS
// ===========================================

const SPECIALIZED_SYSTEM_PROMPT = `You are an expert Data Analyst AI assistant powered by Grok. Your role is to help users explore, analyze, and understand their data using Rill Data.

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

const GENERAL_SYSTEM_PROMPT = `You are an expert Data Analyst AI assistant. You have two tools:

1. **execute_bash** - Explore the Rill project filesystem
2. **execute_sql** - Query data via DuckDB

## Rill Project Structure
- sources/   - Data source definitions (YAML)
- models/    - SQL transformations (*.sql)
- metrics/   - Metrics views with dimensions/measures (YAML)
- dashboards/ - Dashboard configs (YAML)
- rill.yaml  - Project configuration

## Workflow
1. Start by exploring: \`ls -la\` to see project structure
2. Read metrics YAML files to understand available data: \`cat metrics/*.yaml\`
3. Understand models by reading SQL files: \`cat models/*.sql\`
4. Translate measure expressions to SQL queries
5. Query and analyze data

## Translating Metrics to SQL

When you see in a metrics YAML:
\`\`\`yaml
table: orders_enriched
dimensions:
  - name: region
    column: customer_region
measures:
  - name: total_revenue
    expression: SUM(amount)
\`\`\`

Write SQL as:
\`\`\`sql
SELECT
  customer_region as region,
  SUM(amount) as total_revenue
FROM orders_enriched
GROUP BY customer_region
ORDER BY total_revenue DESC
\`\`\`

## Best Practices
- Always explore the project first to understand the data
- Read metrics YAML to see predefined dimensions and measures
- Use LIMIT for initial queries to preview data
- Explain your analysis approach clearly
- Present findings with context (comparisons, trends)
- Ask clarifying questions if the goal is unclear

## Query Guidelines
- Write clean, readable SQL with meaningful aliases
- Use appropriate aggregations (SUM, AVG, COUNT, etc.)
- Always include LIMIT to prevent overwhelming results
- Use CTEs (WITH clauses) for complex multi-step queries

Remember: Your goal is to help users gain actionable insights from their data.`;

// ===========================================
// AGENT CONFIGURATION
// ===========================================

let defaultRillProjectPath: string | undefined =
  process.env.RILL_PROJECT_PATH || ".";

console.log(`[Agent] Default project path: ${defaultRillProjectPath}`);

// Lazy agent creation
let agent: ReturnType<typeof createAgent> | null = null;

function getAgent(projectPath?: string) {
  const effectivePath = projectPath || defaultRillProjectPath || ".";

  if (!agent || projectPath) {
    console.log("[Agent Router] Creating agent instance");
    console.log("[Agent Router] Mode:", AGENT_MODE);
    console.log("[Agent Router] Project path:", effectivePath);

    let tools;
    let systemPrompt;

    if (AGENT_MODE === "specialized") {
      // Approach A: 11 specialized Rill tools
      const rillService = createLocalRillService();
      tools = createRillTools(rillService, effectivePath);
      systemPrompt = SPECIALIZED_SYSTEM_PROMPT;
      console.log("[Agent Router] Using SPECIALIZED tools (11 tools)");
    } else {
      // Approach B: 2 general tools
      const executionService = createLocalExecutionService({
        projectPath: effectivePath,
      });
      tools = createExecutionTools(executionService);
      systemPrompt = GENERAL_SYSTEM_PROMPT;
      console.log("[Agent Router] Using GENERAL tools (2 tools)");
    }

    agent = createAgent({
      systemPrompt,
      tools,
      maxSteps: 25,
    });
  }
  return agent;
}

export function resetAgent() {
  agent = null;
}

export function setDefaultRillProjectPath(path: string) {
  defaultRillProjectPath = path;
  agent = null;
}

// ===========================================
// TRPC ROUTER
// ===========================================

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
        console.log("[Agent Router] Query:", input.message);
        console.log("[Agent Router] Mode:", AGENT_MODE);

        const result = await getAgent(input.projectPath).query(input.message);

        console.log("[Agent Router] Complete:", {
          textLength: result.text?.length,
          steps: result.steps,
        });

        // Extract tool calls and results from messages
        const toolCalls: Array<{
          toolName: string;
          args: unknown;
          toolCallId: string;
        }> = [];
        const toolResults: Array<{
          toolName: string;
          result: unknown;
          toolCallId: string;
        }> = [];

        for (const msg of result.messages) {
          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (
                typeof part === "object" &&
                part !== null &&
                "type" in part &&
                part.type === "tool-call"
              ) {
                const toolPart = part as {
                  type: "tool-call";
                  toolCallId: string;
                  toolName: string;
                  input: unknown;
                };
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
              if (
                typeof part === "object" &&
                part !== null &&
                "type" in part &&
                part.type === "tool-result"
              ) {
                const toolPart = part as {
                  type: "tool-result";
                  toolCallId: string;
                  toolName: string;
                  output: unknown;
                };
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
          mode: AGENT_MODE,
        };
      } catch (error) {
        console.error("[Agent Router] Error:", error);
        if (error instanceof Error) {
          console.error("[Agent Router] Error:", error.message);
        }
        throw error;
      }
    }),

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

  // Get current mode for debugging
  getMode: publicProcedure.query(() => {
    return {
      mode: AGENT_MODE,
      projectPath: defaultRillProjectPath,
    };
  }),
});
