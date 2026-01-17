import { createContext } from "@grokathon-london-2026/api/context";
import { appRouter } from "@grokathon-london-2026/api/routers/index";
import { env } from "@grokathon-london-2026/env/server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import {
  createAgent,
  // Approach A: Specialized (11 tools)
  createRillTools,
  createLocalRillService,
  // Approach B: General (2 tools)
  createExecutionTools,
  createLocalExecutionService,
} from "@grokathon-london-2026/agent";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

// ===========================================
// MODE SELECTION
// ===========================================
// Set AGENT_MODE=specialized for 11-tool approach
// Set AGENT_MODE=general for 2-tool approach (default)
type AgentMode = "specialized" | "general";
const AGENT_MODE: AgentMode =
  (process.env.AGENT_MODE as AgentMode) || "general";

console.log(`[Server] Agent Mode: ${AGENT_MODE.toUpperCase()}`);

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

Remember: Your goal is to help users gain actionable insights from their data.`;

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
SELECT customer_region as region, SUM(amount) as total_revenue
FROM orders_enriched
GROUP BY customer_region
ORDER BY total_revenue DESC
\`\`\`

## Best Practices
- Always explore the project first to understand the data
- Read metrics YAML to see predefined dimensions and measures
- Use LIMIT for initial queries to preview data
- Explain your analysis approach clearly

Remember: Your goal is to help users gain actionable insights from their data.`;

// ===========================================
// AGENT CONFIGURATION
// ===========================================

let defaultRillProjectPath: string | undefined =
  process.env.RILL_PROJECT_PATH || ".";

console.log(`[Server] Default project path: ${defaultRillProjectPath}`);

function createStreamingAgent(projectPath?: string) {
  const effectivePath = projectPath || defaultRillProjectPath || ".";

  let tools;
  let systemPrompt;

  if (AGENT_MODE === "specialized") {
    // Approach A: 11 specialized Rill tools
    const rillService = createLocalRillService();
    tools = createRillTools(rillService, effectivePath);
    systemPrompt = SPECIALIZED_SYSTEM_PROMPT;
  } else {
    // Approach B: 2 general tools
    const executionService = createLocalExecutionService({
      projectPath: effectivePath,
    });
    tools = createExecutionTools(executionService);
    systemPrompt = GENERAL_SYSTEM_PROMPT;
  }

  return createAgent({
    systemPrompt,
    tools,
    maxSteps: 25,
  });
}

// Streaming chat endpoint using Server-Sent Events
app.post("/api/chat/stream", async (c) => {
  const body = await c.req.json<{ message: string; projectPath?: string }>();
  const { message, projectPath } = body;

  if (!message || typeof message !== "string") {
    return c.json({ error: "Message is required" }, 400);
  }

  console.log("[Stream] Starting query:", message);
  console.log("[Stream] Mode:", AGENT_MODE);

  return streamSSE(c, async (stream) => {
    try {
      const agent = createStreamingAgent(projectPath);

      for await (const event of agent.queryStream(message)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });
      }
    } catch (error) {
      console.error("[Stream] Error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        event: "error",
      });
    }
  });
});

// Set the default Rill project path
app.post("/api/config/project-path", async (c) => {
  const body = await c.req.json<{ projectPath: string }>();
  defaultRillProjectPath = body.projectPath;
  return c.json({ success: true, projectPath: body.projectPath });
});

// Get current mode
app.get("/api/config/mode", (c) => {
  return c.json({
    mode: AGENT_MODE,
    projectPath: defaultRillProjectPath,
  });
});

import { serve } from "@hono/node-server";

// Use different ports for each mode so they can run side-by-side
// AGENT_MODE=specialized → port 3000
// AGENT_MODE=general → port 3002
// (Web app is on port 3001)
const PORT = AGENT_MODE === "specialized" ? 3000 : 3002;

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`\n========================================`);
    console.log(`  Agent Mode: ${AGENT_MODE.toUpperCase()}`);
    console.log(`  Tools: ${AGENT_MODE === "specialized" ? "11 specialized" : "2 general"}`);
    console.log(`  Port: ${info.port}`);
    console.log(`  URL: http://localhost:${info.port}`);
    console.log(`========================================\n`);
  },
);
