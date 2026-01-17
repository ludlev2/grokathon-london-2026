/**
 * Local implementation of RillService that executes Rill CLI commands directly.
 * This can be swapped out for a Daytona-based implementation later.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join, parse } from "node:path";
import { parse as parseYaml } from "yaml";
import type { RillService } from "../tools/rill.js";

const execAsync = promisify(exec);

interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Create a local Rill service that executes CLI commands directly
 */
export function createLocalRillService(): RillService {
  async function runRillCommand(
    projectPath: string,
    args: string[],
    options: { timeout?: number } = {}
  ): Promise<string> {
    const command = `rill ${args.join(" ")}`;
    const timeout = options.timeout || 60000;

    try {
      const result: ExecResult = await execAsync(command, {
        cwd: projectPath,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return result.stdout;
    } catch (error) {
      const execError = error as ExecResult & { message?: string };
      throw new Error(execError.stderr || execError.message || "Command failed");
    }
  }

  async function parseJsonOutput<T>(output: string): Promise<T> {
    try {
      return JSON.parse(output) as T;
    } catch {
      throw new Error(`Failed to parse Rill output: ${output.slice(0, 200)}`);
    }
  }

  return {
    async query(projectPath, sql) {
      const startTime = Date.now();
      const output = await runRillCommand(projectPath, [
        "query",
        ".",
        "--sql",
        `"${sql.replace(/"/g, '\\"')}"`,
        "--format",
        "json",
      ]);

      const data = await parseJsonOutput<Record<string, unknown>[]>(output);
      const columns = data.length > 0 ? Object.keys(data[0] ?? {}) : [];

      return {
        columns,
        rows: data,
        rowCount: data.length,
        executionTimeMs: Date.now() - startTime,
      };
    },

    async queryWithResolver(projectPath, resolver, properties) {
      const startTime = Date.now();
      const args = ["query", ".", "--resolver", resolver, "--format", "json"];

      for (const [key, value] of Object.entries(properties)) {
        args.push("--properties", `${key}=${value}`);
      }

      const output = await runRillCommand(projectPath, args);
      const data = await parseJsonOutput<Record<string, unknown>[]>(output);
      const columns = data.length > 0 ? Object.keys(data[0] ?? {}) : [];

      return {
        columns,
        rows: data,
        rowCount: data.length,
        executionTimeMs: Date.now() - startTime,
      };
    },

    async listSources(projectPath) {
      const sourcesDir = join(projectPath, "sources");
      try {
        const files = await readdir(sourcesDir);
        const sources = [];

        for (const file of files) {
          if (file.endsWith(".yaml") || file.endsWith(".yml")) {
            const content = await readFile(join(sourcesDir, file), "utf-8");
            const config = parseYaml(content) as Record<string, unknown>;
            sources.push({
              name: parse(file).name,
              type: String(config.type || "unknown"),
              path: join("sources", file),
              connector: config.connector as string | undefined,
            });
          }
        }

        return sources;
      } catch (error) {
        // Directory might not exist
        return [];
      }
    },

    async listModels(projectPath) {
      const modelsDir = join(projectPath, "models");
      try {
        const files = await readdir(modelsDir);
        const models = [];

        for (const file of files) {
          if (file.endsWith(".sql")) {
            models.push({
              name: parse(file).name,
              path: join("models", file),
            });
          }
        }

        return models;
      } catch {
        return [];
      }
    },

    async listMetricsViews(projectPath) {
      // Check both metrics/ and dashboards/ directories
      const dirsToCheck = [
        join(projectPath, "metrics"),
        join(projectPath, "dashboards"),
      ];

      const metricsViews = [];

      for (const dir of dirsToCheck) {
        try {
          const files = await readdir(dir);

          for (const file of files) {
            if (file.endsWith(".yaml") || file.endsWith(".yml")) {
              const content = await readFile(join(dir, file), "utf-8");
              const config = parseYaml(content) as Record<string, unknown>;

              if (config.type === "metrics_view" || config.kind === "metrics-view") {
                const dimensions = (config.dimensions as Array<Record<string, unknown>>) || [];
                const measures = (config.measures as Array<Record<string, unknown>>) || [];

                metricsViews.push({
                  name: parse(file).name,
                  path: join(dir.includes("metrics") ? "metrics" : "dashboards", file),
                  table: String(config.table || config.source || ""),
                  timeseries: config.timeseries as string | undefined,
                  dimensions: dimensions.map((d) => ({
                    name: String(d.name || d.column || ""),
                    column: String(d.column || d.name || ""),
                    description: d.description as string | undefined,
                  })),
                  measures: measures.map((m) => ({
                    name: String(m.name || ""),
                    expression: String(m.expression || ""),
                    description: m.description as string | undefined,
                  })),
                });
              }
            }
          }
        } catch {
          // Directory might not exist
        }
      }

      return metricsViews;
    },

    async listDashboards(projectPath) {
      const dashboardsDir = join(projectPath, "dashboards");
      try {
        const files = await readdir(dashboardsDir);
        const dashboards = [];

        for (const file of files) {
          if (file.endsWith(".yaml") || file.endsWith(".yml")) {
            const content = await readFile(join(dashboardsDir, file), "utf-8");
            const config = parseYaml(content) as Record<string, unknown>;

            if (config.type === "explore") {
              dashboards.push({
                name: parse(file).name,
                path: join("dashboards", file),
                metricsView: String(config.metrics_view || ""),
                title: config.title as string | undefined,
                description: config.description as string | undefined,
              });
            }
          }
        }

        return dashboards;
      } catch {
        return [];
      }
    },

    async getProjectStatus(projectPath) {
      const sources = await this.listSources(projectPath);
      const models = await this.listModels(projectPath);
      const metricsViews = await this.listMetricsViews(projectPath);
      const dashboards = await this.listDashboards(projectPath);

      // Try to get any errors from rill project status
      const errors: string[] = [];
      try {
        await runRillCommand(projectPath, ["project", "status"]);
      } catch (error) {
        if (error instanceof Error) {
          errors.push(error.message);
        }
      }

      return {
        projectPath,
        sources: sources.length,
        models: models.length,
        metricsViews: metricsViews.length,
        dashboards: dashboards.length,
        errors,
      };
    },

    async readProjectFile(projectPath, filePath) {
      const fullPath = join(projectPath, filePath);

      // Security check
      if (!fullPath.startsWith(projectPath)) {
        throw new Error("Invalid file path");
      }

      const content = await readFile(fullPath, "utf-8");
      return content;
    },

    async listProjectFiles(projectPath, directory) {
      const targetDir = directory
        ? join(projectPath, directory)
        : projectPath;

      try {
        const entries = await readdir(targetDir, { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      } catch {
        return [];
      }
    },

    async executeCommand(projectPath, args) {
      return runRillCommand(projectPath, args);
    },
  };
}
