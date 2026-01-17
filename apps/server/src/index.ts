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
  createRillTools,
  createMockRillService,
  createLocalRillService,
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

// Data Analyst System Prompt for streaming endpoint
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

Remember: Your goal is to help users gain actionable insights from their data. Focus on telling the story the data reveals.`;

// Configuration for the Rill project
// Set USE_REAL_RILL=true and RILL_PROJECT_PATH to use real Rill CLI
const USE_REAL_RILL = process.env.USE_REAL_RILL === "true";
let defaultRillProjectPath: string | undefined =
  process.env.RILL_PROJECT_PATH || "/mock/ecommerce-analytics";

// Create Rill service - use local CLI if configured, otherwise mock
const rillService = USE_REAL_RILL
  ? createLocalRillService()
  : createMockRillService();

console.log(`[Server] Using ${USE_REAL_RILL ? "REAL Rill CLI" : "Mock Rill Service"}`);
console.log(`[Server] Default project path: ${defaultRillProjectPath}`);

function createStreamingAgent(projectPath?: string) {
  const effectivePath = projectPath || defaultRillProjectPath;
  const rillTools = createRillTools(rillService, effectivePath);

  return createAgent({
    systemPrompt: DATA_ANALYST_SYSTEM_PROMPT,
    tools: rillTools,
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

  console.log("[Stream] Starting streaming query:", message);

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

import { serve } from "@hono/node-server";

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
