/**
 * Browser Use Cloud API Implementation
 *
 * Implements the BrowserUseService interface using the Browser Use Cloud API.
 */

import type {
  BrowserUseService,
  CreateTaskRequest,
  CreateTaskResponse,
  Task,
  Skill,
  ExecuteSkillRequest,
  ExecuteSkillResponse,
} from "./browser-use.js";

const API_BASE_URL = "https://api.browser-use.com/api/v2";

export interface BrowserUseCloudConfig {
  apiKey: string;
}

export function createBrowserUseCloudService(
  config: BrowserUseCloudConfig
): BrowserUseService {
  const { apiKey } = config;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${API_BASE_URL}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "X-Browser-Use-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Browser Use API error (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  return {
    async createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {
      const result = await request<{ id: string; sessionId: string }>(
        "POST",
        "/tasks",
        { task: req.task, llm: req.llm }
      );

      // Also get the session to retrieve the liveUrl
      try {
        const session = await request<{ liveUrl?: string }>(
          "GET",
          `/sessions/${result.sessionId}`
        );
        return {
          ...result,
          liveUrl: session.liveUrl,
        };
      } catch {
        return result;
      }
    },

    async getTask(taskId: string): Promise<Task> {
      return request<Task>("GET", `/tasks/${taskId}`);
    },

    async waitForTask(
      taskId: string,
      options?: { timeoutMs?: number; pollIntervalMs?: number }
    ): Promise<Task> {
      const timeoutMs = options?.timeoutMs ?? 300000; // 5 minutes default
      const pollIntervalMs = options?.pollIntervalMs ?? 2000; // 2 seconds default
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        const task = await this.getTask(taskId);

        if (task.status === "finished" || task.status === "stopped") {
          return task;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms`);
    },

    async stopTask(taskId: string): Promise<void> {
      await request<void>("POST", `/tasks/${taskId}/stop`);
    },

    async listSkills(): Promise<Skill[]> {
      const result = await request<{ items: Skill[] }>("GET", "/skills");
      return result.items;
    },

    async getSkill(skillId: string): Promise<Skill> {
      return request<Skill>("GET", `/skills/${skillId}`);
    },

    async executeSkill(req: ExecuteSkillRequest): Promise<ExecuteSkillResponse> {
      try {
        const result = await request<{ result: unknown }>(
          "POST",
          `/skills/${req.skillId}/execute`,
          { parameters: req.parameters }
        );
        return {
          success: true,
          result: result.result,
        };
      } catch (error) {
        return {
          success: false,
          result: null,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  };
}
