import { publicProcedure, router } from "../index.js";
import { agentRouter } from "./agent.js";
import { snowflakeRouter } from "./snowflake.js";
import { sandboxRouter } from "./sandbox.js";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  agent: agentRouter,
  snowflake: snowflakeRouter,
  sandbox: sandboxRouter,
});

export type AppRouter = typeof appRouter;
