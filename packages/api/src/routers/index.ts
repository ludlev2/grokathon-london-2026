import { publicProcedure, router } from "../index.js";
import { agentRouter } from "./agent.js";
import { snowflakeRouter } from "./snowflake.js";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  agent: agentRouter,
  snowflake: snowflakeRouter,
});

export type AppRouter = typeof appRouter;
