/**
 * Browser Use Tools for AI Agent
 *
 * Provides tools for browser automation using Browser Use Cloud.
 * Enables the agent to run browser tasks, use skills, and fetch web data.
 */

import { z } from "zod";
import { defineTool, jsonResult, errorResult } from "../tools.js";
import type { ToolDefinition } from "../types.js";
import type { BrowserUseService } from "../services/browser-use.js";

const BROWSER_TASK_DESCRIPTION = `Run a browser automation task using natural language.
The browser will execute your instructions and return the result.



## Capabilities
- Navigate to websites
- Click buttons and links
- Fill forms and submit
- Extract text and data
- Take screenshots
- Handle multi-page workflows

## Tips
- Be specific about what data you want extracted
- Mention the exact website URL when possible
- Describe the expected format of the result`;

const GET_TASK_RESULT_DESCRIPTION = `Get the status and result of a browser task.
Use this to check on tasks that were started with waitForCompletion=false,
or to retrieve more details about a completed task.`;

const LIST_SKILLS_DESCRIPTION = `List available browser automation skills.
Skills are reusable workflows that can be executed with parameters.
Use this to discover what pre-built automations are available.`;

const EXECUTE_SKILL_DESCRIPTION = `Execute a browser automation skill.
Skills are reusable workflows. Pass the skill ID and any required parameters.
Use browser_list_skills first to see available skills and their parameters.`;

const STOP_TASK_DESCRIPTION = `Stop a running browser task.
Use this to cancel a task that is taking too long or is no longer needed.`;

const CREATE_SKILL_DESCRIPTION = `Create a reusable browser automation skill.
Skills are saved automations that can be executed repeatedly with consistent results.

Use this AFTER successfully fetching repeatable public data (rates, prices, statistics)
to save it as a skill for future use. The skill will have a fixed input/output schema.

Example goals:
- "Get current federal funds rate from FRED"
- "Get S&P 500 price from Yahoo Finance"
- "Get latest unemployment rate from BLS"

The skill builds asynchronously and will be available for future use via browser_execute_skill.`;

/**
 * Create browser automation tools for the agent.
 */
export function createBrowserUseTools(
  service: BrowserUseService
): Record<string, ToolDefinition> {
  return {
    browser_run_task: defineTool({
      description: BROWSER_TASK_DESCRIPTION,
      inputSchema: z.object({
        task: z
          .string()
          .min(1)
          .max(2000)
          .describe(
            "Natural language description of what you want the browser to do"
          ),
        waitForCompletion: z
          .boolean()
          .optional()
          .default(true)
          .describe("Whether to wait for the task to complete (default: true)"),
      }),
      async execute({ task, waitForCompletion }) {
        try {
          const createResult = await service.createTask({ task });

          if (!waitForCompletion) {
            return jsonResult({
              taskId: createResult.id,
              sessionId: createResult.sessionId,
              liveUrl: createResult.liveUrl,
              status: "started",
              message:
                "Task started. Use browser_get_task_result to check status and get results.",
            });
          }

          // Wait for completion
          const completedTask = await service.waitForTask(createResult.id, {
            timeoutMs: 180000, // 3 minutes
            pollIntervalMs: 3000,
          });

          return jsonResult({
            taskId: completedTask.id,
            status: completedTask.status,
            success: completedTask.isSuccess,
            output: completedTask.output,
            steps: completedTask.steps?.length ?? 0,
            outputFiles: completedTask.outputFiles,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return errorResult(message);
        }
      },
    }),

    browser_get_task_result: defineTool({
      description: GET_TASK_RESULT_DESCRIPTION,
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the task to check"),
        waitForCompletion: z
          .boolean()
          .optional()
          .default(false)
          .describe("Whether to wait for the task to complete"),
      }),
      async execute({ taskId, waitForCompletion }) {
        try {
          if (waitForCompletion) {
            const task = await service.waitForTask(taskId);
            return jsonResult({
              taskId: task.id,
              status: task.status,
              success: task.isSuccess,
              output: task.output,
              steps: task.steps?.length ?? 0,
            });
          }

          const task = await service.getTask(taskId);
          return jsonResult({
            taskId: task.id,
            status: task.status,
            success: task.isSuccess,
            output: task.output,
            steps: task.steps?.length ?? 0,
            finishedAt: task.finishedAt,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return errorResult(message);
        }
      },
    }),

    browser_list_skills: defineTool({
      description: LIST_SKILLS_DESCRIPTION,
      inputSchema: z.object({}),
      async execute() {
        try {
          const skills = await service.listSkills();
          return jsonResult({
            count: skills.length,
            skills: skills.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              status: s.status,
            })),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return errorResult(message);
        }
      },
    }),

    browser_execute_skill: defineTool({
      description: EXECUTE_SKILL_DESCRIPTION,
      inputSchema: z.object({
        skillId: z.string().describe("The ID of the skill to execute"),
        parameters: z
          .record(z.string(), z.unknown())
          .optional()
          .default({})
          .describe("Parameters to pass to the skill"),
      }),
      async execute({ skillId, parameters }) {
        try {
          const result = await service.executeSkill({
            skillId,
            parameters,
          });
          return jsonResult(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return errorResult(message);
        }
      },
    }),

    browser_stop_task: defineTool({
      description: STOP_TASK_DESCRIPTION,
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the task to stop"),
      }),
      async execute({ taskId }) {
        try {
          await service.stopTask(taskId);
          return jsonResult({ success: true, message: `Task ${taskId} stopped` });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return errorResult(message);
        }
      },
    }),

    browser_create_skill: defineTool({
      description: CREATE_SKILL_DESCRIPTION,
      inputSchema: z.object({
        goal: z
          .string()
          .min(1)
          .max(500)
          .describe(
            "High-level objective (e.g., 'Get current federal funds rate from FRED')"
          ),
        agentPrompt: z
          .string()
          .min(1)
          .max(2000)
          .describe(
            "Detailed step-by-step instructions for the browser agent to follow"
          ),
        waitForBuild: z
          .boolean()
          .optional()
          .default(true)
          .describe("Whether to wait for the skill to finish building (default: true)"),
      }),
      async execute({ goal, agentPrompt, waitForBuild }) {
        try {
          const createResult = await service.createSkill({ goal, agentPrompt });

          if (!waitForBuild) {
            return jsonResult({
              skillId: createResult.id,
              status: createResult.status,
              message:
                "Skill creation started. Use browser_list_skills to check when it's ready.",
            });
          }

          // Wait for skill to build
          const skill = await service.waitForSkill(createResult.id, {
            timeoutMs: 300000, // 5 minutes
            pollIntervalMs: 2000,
          });

          if (skill.status === "failed") {
            return errorResult("Skill build failed");
          }

          return jsonResult({
            skillId: skill.id,
            name: skill.name,
            description: skill.description,
            status: skill.status,
            inputSchema: skill.inputSchema,
            outputSchema: skill.outputSchema,
            message: "Skill created successfully. Use browser_execute_skill to run it.",
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return errorResult(message);
        }
      },
    }),
  };
}
