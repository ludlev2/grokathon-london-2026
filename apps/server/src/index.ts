import { createContext } from "@grokathon-london-2026/api/context";
import { appRouter } from "@grokathon-london-2026/api/routers/index";
import { env } from "@grokathon-london-2026/env/server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  createAgent,
  // Approach A: Specialized (11 tools)
  createRillTools,
  createLocalRillService,
  // Approach B: General (2 tools)
  createExecutionTools,
  createLocalExecutionService,
  // Browser Use Cloud
  createBrowserUseTools,
  createBrowserUseCloudService,
  // Types
  type ToolDefinition,
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
// SYSTEM PROMPTS
// ===========================================

type AgentMode = "specialized" | "general";

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
const browserUseApiKey = env.BROWSER_USE_API_KEY;

console.log(`[Server] Default project path: ${defaultRillProjectPath}`);
console.log(`[Server] Browser Use API: ${browserUseApiKey ? "enabled" : "disabled"}`);

// Create browser tools if API key is available
function getBrowserTools(): Record<string, ToolDefinition> {
  if (!browserUseApiKey) {
    return {};
  }
  const browserService = createBrowserUseCloudService({ apiKey: browserUseApiKey });
  return createBrowserUseTools(browserService);
}

function createStreamingAgent(mode: AgentMode, projectPath?: string) {
  const effectivePath = projectPath || defaultRillProjectPath || ".";
  const browserTools = getBrowserTools();
  const hasBrowserTools = Object.keys(browserTools).length > 0;

  // Add browser capabilities to system prompt if available
  const browserPromptAddition = hasBrowserTools
    ? `

You can fetch live data from the web using browser_run_task when needed.
Use ONE authoritative source per query - don't cross-reference multiple sites.
After successfully fetching repeatable public data, create a skill for it using browser_create_skill.
Before fetching, check browser_list_skills to see if a relevant skill already exists.`
    : "";

  if (mode === "specialized") {
    // Approach A: 11 specialized Rill tools
    const rillService = createLocalRillService();
    const rillTools = createRillTools(rillService, effectivePath);
    return createAgent({
      systemPrompt: SPECIALIZED_SYSTEM_PROMPT + browserPromptAddition,
      tools: { ...rillTools, ...browserTools },
      maxSteps: 25,
    });
  }

  // Approach B: 2 general tools (default)
  const executionService = createLocalExecutionService({
    projectPath: effectivePath,
  });
  const executionTools = createExecutionTools(executionService);
  return createAgent({
    systemPrompt: GENERAL_SYSTEM_PROMPT + browserPromptAddition,
    tools: { ...executionTools, ...browserTools },
    maxSteps: 25,
  });
}

// Streaming chat endpoint using Server-Sent Events
app.post("/api/chat/stream", async (c) => {
  const body = await c.req.json<{
    message: string;
    mode?: AgentMode;
    projectPath?: string;
  }>();
  const { message, mode = "general", projectPath } = body;

  if (!message || typeof message !== "string") {
    return c.json({ error: "Message is required" }, 400);
  }

  console.log("[Stream] Starting query:", message);
  console.log("[Stream] Mode:", mode);

  return streamSSE(c, async (stream) => {
    try {
      const agent = createStreamingAgent(mode, projectPath);

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

// Get current config
app.get("/api/config", (c) => {
  return c.json({
    projectPath: defaultRillProjectPath,
    availableModes: ["general", "specialized"] as const,
  });
});

const PORT = 3000;

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    const browserToolCount = browserUseApiKey ? 6 : 0;
    console.log(`\n========================================`);
    console.log(`  Server running on port ${info.port}`);
    console.log(`  URL: http://localhost:${info.port}`);
    console.log(`  Modes: general (${2 + browserToolCount} tools), specialized (${11 + browserToolCount} tools)`);
    console.log(`========================================\n`);
  },
);
