// Types
export type {
  GrokModel,
  ToolDefinition,
  ToolResult,
  AgentConfig,
  AgentEvent,
  AgentResult,
  AgentContext,
  TrackedMessage,
} from "./types.js";

export { GROK_MODEL, TaskComplete } from "./types.js";

// Agent
export { createAgent, type Agent } from "./agent.js";

// Tools
export {
  defineTool,
  textResult,
  jsonResult,
  errorResult,
} from "./tools.js";

// Snowflake tools
export {
  createSnowflakeTools,
  type SnowflakeService,
} from "./tools/snowflake.js";

// Rill tools
export { createRillTools, type RillService } from "./tools/rill.js";

// Rill service implementations
export { createLocalRillService } from "./services/rill-local.js";
export { createMockRillService } from "./services/rill-mock.js";

// Context management
export { createContext, addMessage, getMessages } from "./context.js";

// Model utilities
export { getModel, getContextLimit, estimateTokens } from "./models.js";
