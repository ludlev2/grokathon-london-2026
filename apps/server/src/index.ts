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
  createSandboxExecutionService,
  // Browser Use Cloud
  createBrowserUseTools,
  createBrowserUseCloudService,
  // Types
  type ToolDefinition,
  type AgentContext,
  type Agent,
} from "@grokathon-london-2026/agent";
import { randomUUID } from "crypto";

const app = new Hono();
const PORT = 3000;

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

const SANDBOX_AGENT_SYSTEM_PROMPT = `You are an expert Data Analyst AI assistant running inside a Daytona sandbox. You have two tools:

1. **execute_bash** - Explore the Rill project filesystem
2. **execute_sql** - Query data via DuckDB

## Important: Working Directory
All your commands are automatically executed within the configured working directory in the sandbox. This is typically /tmp/<volume-name> where your Rill project is located.

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

Remember: You are running inside an isolated sandbox environment. Your goal is to help users gain actionable insights from their data.`;

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

// ===========================================
// SESSION MANAGEMENT
// ===========================================

interface Session {
  id: string;
  agent: Agent;
  context: AgentContext;
  mode: AgentMode;
  projectPath: string;
  createdAt: number;
  lastAccessedAt: number;
}

interface SandboxSession {
  id: string;
  agent: Agent;
  context: AgentContext;
  sandboxId: string;
  workingDirectory: string;
  createdAt: number;
  lastAccessedAt: number;
}

// In-memory session storage (consider Redis for production)
const sessions = new Map<string, Session>();
const sandboxSessions = new Map<string, SandboxSession>();

// Clean up old sessions (older than 1 hour)
const SESSION_TTL_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(id);
      console.log(`[Session] Expired: ${id}`);
    }
  }
  for (const [id, session] of sandboxSessions.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sandboxSessions.delete(id);
      console.log(`[SandboxSession] Expired: ${id}`);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

function createStreamingAgent(mode: AgentMode, projectPath?: string) {
  const effectivePath = projectPath || defaultRillProjectPath || ".";
  const browserTools = getBrowserTools();
  const hasBrowserTools = Object.keys(browserTools).length > 0;

  // Add browser capabilities to system prompt if available
  const browserPromptAddition = hasBrowserTools
    ? `

## Fetching Live Web Data

You have access to pre-built browser skills that fetch live data (Fed rates, stock prices, etc).

1. Call browser_list_skills to see available skills
2. Use browser_execute_skill with the skill ID to fetch data

ONLY use browser_execute_skill with existing skills. Do NOT use browser_run_task.`
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

/**
 * Create a sandbox agent that executes commands against a Daytona sandbox
 */
function createSandboxAgent(sandboxId: string, workingDirectory: string) {
  const executionService = createSandboxExecutionService({
    sandboxId,
    workingDirectory,
    serverUrl: `http://localhost:${PORT}`,
  });
  const executionTools = createExecutionTools(executionService);
  return createAgent({
    systemPrompt: SANDBOX_AGENT_SYSTEM_PROMPT,
    tools: executionTools,
    maxSteps: 25,
  });
}

// Streaming chat endpoint using Server-Sent Events
app.post("/api/chat/stream", async (c) => {
  const body = await c.req.json<{
    message: string;
    mode?: AgentMode;
    projectPath?: string;
    sessionId?: string;
  }>();
  const { message, mode = "general", projectPath, sessionId } = body;

  if (!message || typeof message !== "string") {
    return c.json({ error: "Message is required" }, 400);
  }

  console.log("[Stream] Message:", message.slice(0, 100));
  console.log("[Stream] Mode:", mode);
  console.log("[Stream] Session:", sessionId || "new");

  return streamSSE(c, async (stream) => {
    try {
      let session: Session;
      let isNewSession = false;

      if (sessionId && sessions.has(sessionId)) {
        // Continue existing session
        session = sessions.get(sessionId)!;
        session.lastAccessedAt = Date.now();
        console.log(`[Session] Continuing: ${sessionId}`);
      } else {
        // Create new session
        const effectivePath = projectPath || defaultRillProjectPath || ".";
        const agent = createStreamingAgent(mode, effectivePath);
        const newSessionId = randomUUID();

        session = {
          id: newSessionId,
          agent,
          context: agent.createNewContext(),
          mode,
          projectPath: effectivePath,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
        };

        sessions.set(newSessionId, session);
        isNewSession = true;
        console.log(`[Session] Created: ${newSessionId}`);
      }

      // Send session info first
      await stream.writeSSE({
        data: JSON.stringify({
          type: "session",
          sessionId: session.id,
          isNew: isNewSession,
        }),
        event: "session",
      });

      // Stream the response - always use continueConversationStream to maintain session context
      const eventStream = session.agent.continueConversationStream(session.context, message);

      for await (const event of eventStream) {
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

// ===========================================
// SANDBOX AGENT STREAMING ENDPOINT
// ===========================================

// Sandbox agent streaming endpoint
app.post("/api/sandbox-agent/stream", async (c) => {
  const body = await c.req.json<{
    message: string;
    sandboxId: string;
    workingDirectory: string;
    sessionId?: string;
  }>();
  const { message, sandboxId, workingDirectory, sessionId } = body;

  if (!message || typeof message !== "string") {
    return c.json({ error: "Message is required" }, 400);
  }

  if (!sandboxId || typeof sandboxId !== "string") {
    return c.json({ error: "Sandbox ID is required" }, 400);
  }

  if (!workingDirectory || typeof workingDirectory !== "string") {
    return c.json({ error: "Working directory is required" }, 400);
  }

  console.log("[SandboxAgent] Message:", message.slice(0, 100));
  console.log("[SandboxAgent] Sandbox:", sandboxId);
  console.log("[SandboxAgent] Working Directory:", workingDirectory);
  console.log("[SandboxAgent] Session:", sessionId || "new");

  return streamSSE(c, async (stream) => {
    try {
      let session: SandboxSession;
      let isNewSession = false;

      // Check if we have an existing session with the same sandbox and working directory
      if (sessionId && sandboxSessions.has(sessionId)) {
        const existingSession = sandboxSessions.get(sessionId)!;
        // Only reuse session if sandbox and working directory match
        if (existingSession.sandboxId === sandboxId && existingSession.workingDirectory === workingDirectory) {
          session = existingSession;
          session.lastAccessedAt = Date.now();
          console.log(`[SandboxSession] Continuing: ${sessionId}`);
        } else {
          // Create new session if sandbox or working directory changed
          const agent = createSandboxAgent(sandboxId, workingDirectory);
          const newSessionId = randomUUID();

          session = {
            id: newSessionId,
            agent,
            context: agent.createNewContext(),
            sandboxId,
            workingDirectory,
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
          };

          sandboxSessions.set(newSessionId, session);
          isNewSession = true;
          console.log(`[SandboxSession] Created (config changed): ${newSessionId}`);
        }
      } else {
        // Create new session
        const agent = createSandboxAgent(sandboxId, workingDirectory);
        const newSessionId = randomUUID();

        session = {
          id: newSessionId,
          agent,
          context: agent.createNewContext(),
          sandboxId,
          workingDirectory,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
        };

        sandboxSessions.set(newSessionId, session);
        isNewSession = true;
        console.log(`[SandboxSession] Created: ${newSessionId}`);
      }

      // Send session info first
      await stream.writeSSE({
        data: JSON.stringify({
          type: "session",
          sessionId: session.id,
          isNew: isNewSession,
        }),
        event: "session",
      });

      // Stream the response
      const eventStream = session.agent.continueConversationStream(session.context, message);

      for await (const event of eventStream) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });
      }
    } catch (error) {
      console.error("[SandboxAgent] Error:", error);
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
