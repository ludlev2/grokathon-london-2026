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

// ===========================================
// APPROACH A: Specialized Tools (11 tools)
// ===========================================
// The traditional approach with specialized Rill tools
export { createRillTools, type RillService } from "./tools/rill.js";
export { createLocalRillService } from "./services/rill-local.js";

// ===========================================
// APPROACH B: General Tools (2 tools)
// ===========================================
// The Vercel "trust the model" approach with just bash + SQL
export { createExecutionTools } from "./tools/execution.js";
export type {
  ExecutionService,
  BashResult,
  BashOptions,
  SQLResult,
  SQLOptions,
} from "./services/execution.js";
export { createLocalExecutionService } from "./services/execution-local.js";

// ===========================================
// Browser Use Cloud Tools
// ===========================================
// Browser automation through Browser Use Cloud API
export { createBrowserUseTools } from "./tools/browser-use.js";
export type {
  BrowserUseService,
  Task as BrowserTask,
  TaskStatus as BrowserTaskStatus,
  Skill as BrowserSkill,
  CreateTaskRequest as BrowserCreateTaskRequest,
  CreateTaskResponse as BrowserCreateTaskResponse,
  ExecuteSkillRequest as BrowserExecuteSkillRequest,
  ExecuteSkillResponse as BrowserExecuteSkillResponse,
  CreateSkillRequest as BrowserCreateSkillRequest,
  CreateSkillResponse as BrowserCreateSkillResponse,
} from "./services/browser-use.js";
export {
  createBrowserUseCloudService,
  type BrowserUseCloudConfig,
} from "./services/browser-use-cloud.js";

// Context management
export { createContext, addMessage, getMessages } from "./context.js";

// Model utilities
export { getModel, getContextLimit, estimateTokens } from "./models.js";
