/**
 * Rill CLI tools for the AI agent
 *
 * These tools allow the agent to interact with Rill data projects
 * for data analysis and dashboard creation.
 *
 * The service interface abstracts the execution environment, allowing
 * these tools to work both locally and inside a Daytona sandbox.
 */

import { z } from "zod";
import { defineTool, jsonResult, errorResult, textResult } from "../tools.js";
import type { ToolDefinition } from "../types.js";

// Types for Rill project structures
interface RillSource {
  name: string;
  type: string;
  path: string;
  connector?: string;
}

interface RillModel {
  name: string;
  path: string;
  sql?: string;
}

interface RillMetricsView {
  name: string;
  path: string;
  table: string;
  timeseries?: string;
  dimensions: Array<{ name: string; column: string; description?: string }>;
  measures: Array<{ name: string; expression: string; description?: string }>;
}

interface RillDashboard {
  name: string;
  path: string;
  metricsView: string;
  title?: string;
  description?: string;
}

interface RillQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs?: number;
}

interface RillProjectStatus {
  projectPath: string;
  sources: number;
  models: number;
  metricsViews: number;
  dashboards: number;
  errors: string[];
}

/**
 * Service interface for Rill CLI operations
 * This abstracts the execution environment (local vs Daytona sandbox)
 */
export interface RillService {
  /** Execute a SQL query using `rill query` */
  query(projectPath: string, sql: string): Promise<RillQueryResult>;

  /** Execute a query using a resolver (e.g., metrics_view_aggregation) */
  queryWithResolver(
    projectPath: string,
    resolver: string,
    properties: Record<string, string>
  ): Promise<RillQueryResult>;

  /** List all sources in the project */
  listSources(projectPath: string): Promise<RillSource[]>;

  /** List all models in the project */
  listModels(projectPath: string): Promise<RillModel[]>;

  /** List all metrics views in the project */
  listMetricsViews(projectPath: string): Promise<RillMetricsView[]>;

  /** List all dashboards in the project */
  listDashboards(projectPath: string): Promise<RillDashboard[]>;

  /** Get project status and health */
  getProjectStatus(projectPath: string): Promise<RillProjectStatus>;

  /** Read a file from the project (YAML configs, SQL models) */
  readProjectFile(projectPath: string, filePath: string): Promise<string>;

  /** List files in a project directory */
  listProjectFiles(projectPath: string, directory?: string): Promise<string[]>;

  /** Execute an arbitrary safe Rill CLI command */
  executeCommand(projectPath: string, args: string[]): Promise<string>;
}

/**
 * Create Rill tools with an injected service
 */
export function createRillTools(
  service: RillService,
  defaultProjectPath?: string
): Record<string, ToolDefinition> {
  // Helper to resolve project path
  const getProjectPath = (providedPath?: string): string => {
    const path = providedPath || defaultProjectPath;
    if (!path) {
      throw new Error(
        "No project path provided and no default project path configured"
      );
    }
    return path;
  };

  const queryTool = defineTool({
    description: `Execute a SQL query against a Rill project using DuckDB.
Use this to explore and analyze data in the project.
The query runs against the project's models and sources.
Examples:
- SELECT * FROM my_model LIMIT 10
- SELECT category, SUM(revenue) FROM sales GROUP BY category`,
    inputSchema: z.object({
      sql: z
        .string()
        .max(10000)
        .describe("The SQL query to execute against the Rill project"),
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ sql, projectPath }) => {
      try {
        const path = getProjectPath(projectPath);
        const result = await service.query(path, sql);

        return jsonResult({
          success: true,
          rowCount: result.rowCount,
          executionTimeMs: result.executionTimeMs,
          columns: result.columns,
          rows: result.rows.slice(0, 100),
          truncated: result.rowCount > 100,
        });
      } catch (error) {
        return errorResult(
          `Query failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
    ephemeral: 3,
  });

  const queryMetricsTool = defineTool({
    description: `Query a metrics view using Metrics SQL.
Use this for analytical queries on defined metrics.
You can query the metrics view like a table, selecting dimensions and measures by name.
Example: SELECT region, total_revenue FROM my_metrics_view WHERE country = 'US' LIMIT 100`,
    inputSchema: z.object({
      metricsView: z.string().describe("Name of the metrics view to query"),
      dimensions: z
        .array(z.string())
        .optional()
        .describe("Dimension names to select"),
      measures: z
        .array(z.string())
        .optional()
        .describe("Measure names to select"),
      where: z.string().optional().describe("SQL WHERE clause for filtering"),
      limit: z.number().optional().default(100).describe("Max rows to return"),
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({
      metricsView,
      dimensions,
      measures,
      where,
      limit,
      projectPath,
    }) => {
      try {
        const path = getProjectPath(projectPath);

        // Build Metrics SQL query
        const selectParts: string[] = [];
        if (dimensions?.length) {
          selectParts.push(...dimensions);
        }
        if (measures?.length) {
          selectParts.push(...measures);
        }

        if (selectParts.length === 0) {
          return errorResult("At least one dimension or measure must be specified");
        }

        let sql = `SELECT ${selectParts.join(", ")} FROM ${metricsView}`;
        if (where) {
          sql += ` WHERE ${where}`;
        }
        sql += ` LIMIT ${limit || 100}`;

        const result = await service.queryWithResolver(
          path,
          "metrics_sql",
          { sql }
        );

        return jsonResult({
          success: true,
          metricsView,
          sql,
          rowCount: result.rowCount,
          columns: result.columns,
          rows: result.rows.slice(0, 100),
          truncated: result.rowCount > 100,
        });
      } catch (error) {
        return errorResult(
          `Metrics query failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
    ephemeral: 3,
  });

  const listSourcesTool = defineTool({
    description: `List all data sources in the Rill project.
Sources are the raw data inputs (CSV files, database connections, etc.)`,
    inputSchema: z.object({
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ projectPath }) => {
      try {
        const path = getProjectPath(projectPath);
        const sources = await service.listSources(path);

        if (sources.length === 0) {
          return textResult(
            "No sources found in the project. Sources are typically in the 'sources/' directory."
          );
        }

        return jsonResult({
          count: sources.length,
          sources: sources.map((s) => ({
            name: s.name,
            type: s.type,
            connector: s.connector,
          })),
        });
      } catch (error) {
        return errorResult(
          `Failed to list sources: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const listModelsTool = defineTool({
    description: `List all SQL models in the Rill project.
Models transform raw sources into analysis-ready tables using SQL.`,
    inputSchema: z.object({
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ projectPath }) => {
      try {
        const path = getProjectPath(projectPath);
        const models = await service.listModels(path);

        if (models.length === 0) {
          return textResult(
            "No models found in the project. Models are typically SQL files in the 'models/' directory."
          );
        }

        return jsonResult({
          count: models.length,
          models: models.map((m) => ({
            name: m.name,
            path: m.path,
          })),
        });
      } catch (error) {
        return errorResult(
          `Failed to list models: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const listMetricsViewsTool = defineTool({
    description: `List all metrics views in the Rill project.
Metrics views define dimensions and measures for analytical dashboards.
They're the semantic layer on top of your data models.`,
    inputSchema: z.object({
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ projectPath }) => {
      try {
        const path = getProjectPath(projectPath);
        const metricsViews = await service.listMetricsViews(path);

        if (metricsViews.length === 0) {
          return textResult(
            "No metrics views found. Create a YAML file in 'metrics/' directory."
          );
        }

        return jsonResult({
          count: metricsViews.length,
          metricsViews: metricsViews.map((mv) => ({
            name: mv.name,
            table: mv.table,
            dimensionCount: mv.dimensions.length,
            measureCount: mv.measures.length,
          })),
        });
      } catch (error) {
        return errorResult(
          `Failed to list metrics views: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const describeMetricsViewTool = defineTool({
    description: `Get detailed information about a specific metrics view.
Use this to understand available dimensions and measures before querying.`,
    inputSchema: z.object({
      metricsViewName: z.string().describe("Name of the metrics view"),
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ metricsViewName, projectPath }) => {
      try {
        const path = getProjectPath(projectPath);
        const metricsViews = await service.listMetricsViews(path);
        const mv = metricsViews.find((m) => m.name === metricsViewName);

        if (!mv) {
          return errorResult(
            `Metrics view '${metricsViewName}' not found. Use rill_list_metrics_views to see available views.`
          );
        }

        return jsonResult({
          name: mv.name,
          table: mv.table,
          timeseries: mv.timeseries,
          dimensions: mv.dimensions.map((d) => ({
            name: d.name,
            column: d.column,
            description: d.description,
          })),
          measures: mv.measures.map((m) => ({
            name: m.name,
            expression: m.expression,
            description: m.description,
          })),
        });
      } catch (error) {
        return errorResult(
          `Failed to describe metrics view: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const listDashboardsTool = defineTool({
    description: `List all dashboards (explores) in the Rill project.
Dashboards provide interactive visualizations of metrics views.`,
    inputSchema: z.object({
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ projectPath }) => {
      try {
        const path = getProjectPath(projectPath);
        const dashboards = await service.listDashboards(path);

        if (dashboards.length === 0) {
          return textResult(
            "No dashboards found. Create a YAML file in 'dashboards/' directory."
          );
        }

        return jsonResult({
          count: dashboards.length,
          dashboards: dashboards.map((d) => ({
            name: d.name,
            title: d.title,
            metricsView: d.metricsView,
          })),
        });
      } catch (error) {
        return errorResult(
          `Failed to list dashboards: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const getProjectStatusTool = defineTool({
    description: `Get the status of a Rill project including counts of sources, models, metrics views, and any errors.`,
    inputSchema: z.object({
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ projectPath }) => {
      try {
        const path = getProjectPath(projectPath);
        const status = await service.getProjectStatus(path);

        return jsonResult({
          projectPath: status.projectPath,
          components: {
            sources: status.sources,
            models: status.models,
            metricsViews: status.metricsViews,
            dashboards: status.dashboards,
          },
          healthy: status.errors.length === 0,
          errors: status.errors,
        });
      } catch (error) {
        return errorResult(
          `Failed to get project status: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const readFileTool = defineTool({
    description: `Read a file from the Rill project (SQL models, YAML configs).
Use this to understand existing model logic or metrics definitions.`,
    inputSchema: z.object({
      filePath: z
        .string()
        .describe("Relative path to the file within the project"),
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ filePath, projectPath }) => {
      try {
        const path = getProjectPath(projectPath);

        // Security: prevent directory traversal
        if (filePath.includes("..")) {
          return errorResult("Invalid file path: directory traversal not allowed");
        }

        const content = await service.readProjectFile(path, filePath);
        return textResult(content);
      } catch (error) {
        return errorResult(
          `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const listFilesTool = defineTool({
    description: `List files in a Rill project directory.
Useful for discovering sources, models, and configuration files.`,
    inputSchema: z.object({
      directory: z
        .string()
        .optional()
        .describe("Directory to list (e.g., 'sources', 'models', 'metrics')"),
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ directory, projectPath }) => {
      try {
        const path = getProjectPath(projectPath);
        const files = await service.listProjectFiles(path, directory);

        return jsonResult({
          directory: directory || ".",
          files,
        });
      } catch (error) {
        return errorResult(
          `Failed to list files: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  const executeCommandTool = defineTool({
    description: `Execute a Rill CLI command for advanced operations.
Only safe, read-only commands are allowed.
Examples: 'project status', 'env list', 'project logs'`,
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          "The Rill CLI command to run (without 'rill' prefix). E.g., 'project status'"
        ),
      projectPath: z
        .string()
        .optional()
        .describe("Path to the Rill project (optional if default is set)"),
    }),
    execute: async ({ command, projectPath }) => {
      try {
        const path = getProjectPath(projectPath);

        // Safety: whitelist allowed commands
        const allowedCommands = [
          "project status",
          "project list",
          "project logs",
          "env list",
          "query",
          "version",
          "help",
        ];

        const normalizedCommand = command.trim().toLowerCase();

        // Check if command starts with any allowed prefix
        const isAllowed = allowedCommands.some((allowed) =>
          normalizedCommand.startsWith(allowed)
        );

        if (!isAllowed) {
          return errorResult(
            `Command not allowed. Allowed commands: ${allowedCommands.join(", ")}`
          );
        }

        const args = command.split(/\s+/);
        const output = await service.executeCommand(path, args);

        return textResult(output);
      } catch (error) {
        return errorResult(
          `Command failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  return {
    rill_query: queryTool,
    rill_query_metrics: queryMetricsTool,
    rill_list_sources: listSourcesTool,
    rill_list_models: listModelsTool,
    rill_list_metrics_views: listMetricsViewsTool,
    rill_describe_metrics_view: describeMetricsViewTool,
    rill_list_dashboards: listDashboardsTool,
    rill_project_status: getProjectStatusTool,
    rill_read_file: readFileTool,
    rill_list_files: listFilesTool,
    rill_execute_command: executeCommandTool,
  };
}
