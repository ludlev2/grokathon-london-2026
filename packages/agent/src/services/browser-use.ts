/**
 * Browser Use Cloud API Service
 *
 * Provides browser automation capabilities through the Browser Use Cloud API.
 * Allows running tasks, managing skills, and retrieving results.
 */

export type TaskStatus = "started" | "paused" | "finished" | "stopped";

export interface TaskStep {
  number: number;
  memory?: string;
  evaluationPreviousGoal?: string;
  nextGoal?: string;
  url?: string;
  screenshotUrl?: string | null;
  actions?: string[];
}

export interface OutputFile {
  id: string;
  fileName: string;
}

export interface Task {
  id: string;
  sessionId: string;
  llm: string;
  task: string;
  status: TaskStatus;
  startedAt: string;
  finishedAt: string | null;
  metadata: Record<string, unknown>;
  steps?: TaskStep[];
  outputFiles?: OutputFile[];
  output: string | null;
  browserUseVersion?: string | null;
  isSuccess: boolean | null;
  liveUrl?: string;
}

export interface CreateTaskRequest {
  task: string;
  /** Optional LLM model to use */
  llm?: string;
}

export interface CreateTaskResponse {
  id: string;
  sessionId: string;
  liveUrl?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  status: "pending" | "building" | "finished" | "failed";
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface ExecuteSkillRequest {
  skillId: string;
  parameters: Record<string, unknown>;
}

export interface ExecuteSkillResponse {
  success: boolean;
  result: unknown;
  error?: string;
}

export interface BrowserUseService {
  /**
   * Create and run a new browser automation task
   */
  createTask(request: CreateTaskRequest): Promise<CreateTaskResponse>;

  /**
   * Get the status and details of a task
   */
  getTask(taskId: string): Promise<Task>;

  /**
   * Wait for a task to complete and return the result
   */
  waitForTask(
    taskId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<Task>;

  /**
   * Stop a running task
   */
  stopTask(taskId: string): Promise<void>;

  /**
   * List available skills
   */
  listSkills(): Promise<Skill[]>;

  /**
   * Get details of a specific skill
   */
  getSkill(skillId: string): Promise<Skill>;

  /**
   * Execute a skill with parameters
   */
  executeSkill(request: ExecuteSkillRequest): Promise<ExecuteSkillResponse>;
}
