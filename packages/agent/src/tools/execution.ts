/**
 * Simplified execution tools following the Vercel "trust the model" philosophy.
 * Instead of 11 specialized Rill tools, we provide 2 general-purpose tools:
 * - execute_bash: Run bash commands for filesystem exploration
 * - execute_sql: Run SQL queries via Rill
 *
 * @see https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools
 */

import { z } from "zod";
import { defineTool, textResult, jsonResult, errorResult } from "../tools.js";
import type { ToolDefinition } from "../types.js";
import type { ExecutionService } from "../services/execution.js";

const BASH_DESCRIPTION = `Execute a bash command to explore the Rill project filesystem.

## Rill Project Structure
- sources/   - Data source definitions (YAML files defining where data comes from)
- models/    - SQL transformations (*.sql files that transform source data)
- metrics/   - Metrics views with dimensions and measures (YAML files)
- dashboards/ - Dashboard/explore configurations (YAML files)
- rill.yaml  - Project configuration

## Common Commands
- \`ls\` - List directory contents
- \`ls -la sources/\` - List all source definitions
- \`cat metrics/*.yaml\` - Read all metrics view definitions
- \`grep -r "measure" metrics/\` - Find all measure definitions
- \`find . -name "*.sql"\` - Find all SQL model files
- \`head -50 models/orders_enriched.sql\` - Read first 50 lines of a model

## Examples
1. Explore project structure: \`ls -la\`
2. List available metrics: \`ls metrics/\`
3. Read a metrics view: \`cat metrics/sales_metrics.yaml\`
4. Find tables/models: \`grep -r "table:" metrics/\`
5. Search for specific measures: \`grep -r "SUM\\|AVG\\|COUNT" metrics/\`

## Tips
- Always explore before querying to understand available data
- Read metrics YAML to understand dimensions (grouping) and measures (aggregations)
- Check models/*.sql to understand data transformations
- Use pipes for complex exploration: \`cat metrics/*.yaml | grep -A5 "measures:"\``;

const SQL_DESCRIPTION = `Execute a SQL query against the Rill project using DuckDB.

## How to Write Queries
1. First, read the metrics YAML files to understand the data model
2. Identify the source table (usually in models/ directory)
3. Translate measure expressions (SUM, AVG, COUNT) to SQL
4. Use dimension columns for GROUP BY

## Translating Metrics to SQL
When you see in a metrics YAML:
\`\`\`yaml
table: orders_enriched
dimensions:
  - name: region
    column: customer_region
measures:
  - name: total_revenue
    expression: SUM(amount)
  - name: order_count
    expression: COUNT(*)
\`\`\`

Write SQL as:
\`\`\`sql
SELECT
  customer_region as region,
  SUM(amount) as total_revenue,
  COUNT(*) as order_count
FROM orders_enriched
GROUP BY customer_region
ORDER BY total_revenue DESC
\`\`\`

## Rules
- Only SELECT and WITH (CTE) statements are allowed
- No INSERT, UPDATE, DELETE, DROP, or DDL statements
- Use the table name from the metrics view's "table" field
- Apply dimension column mappings in SELECT and GROUP BY

## Examples
1. Get all data: \`SELECT * FROM orders_enriched LIMIT 10\`
2. Aggregate by dimension: \`SELECT region, SUM(amount) FROM orders GROUP BY region\`
3. Time-based analysis: \`SELECT DATE_TRUNC('month', order_date) as month, SUM(revenue) FROM sales GROUP BY 1\`
4. CTEs for complex queries:
   \`\`\`sql
   WITH monthly AS (
     SELECT DATE_TRUNC('month', order_date) as month, SUM(amount) as total
     FROM orders
     GROUP BY 1
   )
   SELECT month, total, LAG(total) OVER (ORDER BY month) as prev_month
   FROM monthly
   \`\`\``;

/**
 * Create the two execution tools for the simplified agent.
 */
export function createExecutionTools(
  service: ExecutionService
): Record<string, ToolDefinition> {
  return {
    execute_bash: defineTool({
      description: BASH_DESCRIPTION,
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .max(2000)
          .describe("The bash command to execute"),
      }),
      async execute({ command }) {
        try {
          const result = await service.executeBash(command);

          if (result.exitCode !== 0) {
            const output = result.stderr || result.stdout || "Command failed";
            return errorResult(`Exit code ${result.exitCode}: ${output}`);
          }

          const output = result.stdout.trim();
          if (!output) {
            return textResult("(no output)");
          }

          return textResult(output);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return errorResult(message);
        }
      },
    }),

    execute_sql: defineTool({
      description: SQL_DESCRIPTION,
      inputSchema: z.object({
        sql: z
          .string()
          .min(1)
          .max(10000)
          .describe("The SQL query to execute (SELECT/WITH only)"),
      }),
      // Limit context usage - only keep 3 most recent SQL results
      ephemeral: 3,
      async execute({ sql }) {
        // Validate SQL is read-only
        const sqlUpper = sql.trim().toUpperCase();
        const forbiddenKeywords = [
          "INSERT",
          "UPDATE",
          "DELETE",
          "DROP",
          "CREATE",
          "ALTER",
          "TRUNCATE",
          "GRANT",
          "REVOKE",
        ];

        for (const keyword of forbiddenKeywords) {
          // Check if keyword appears at start or after whitespace/newline
          const pattern = new RegExp(`(^|\\s)${keyword}\\s`, "i");
          if (pattern.test(sql)) {
            return errorResult(
              `Only SELECT and WITH queries are allowed. Found forbidden keyword: ${keyword}`
            );
          }
        }

        // Ensure query starts with SELECT or WITH
        if (!sqlUpper.startsWith("SELECT") && !sqlUpper.startsWith("WITH")) {
          return errorResult(
            "Query must start with SELECT or WITH. Only read-only queries are allowed."
          );
        }

        try {
          const result = await service.executeSQL(sql);

          // Format result with column info and data
          return jsonResult({
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            durationMs: result.durationMs,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Query failed";
          return errorResult(message);
        }
      },
    }),
  };
}
