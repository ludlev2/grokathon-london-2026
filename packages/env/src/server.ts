import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // Encryption key for Snowflake credentials (min 32 chars recommended)
    CREDENTIALS_ENCRYPTION_KEY: z.string().min(16),
    // Browser Use Cloud API key (optional - enables browser automation)
    BROWSER_USE_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
