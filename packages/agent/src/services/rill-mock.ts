/**
 * Mock implementation of RillService for testing without Rill/Daytona.
 * Returns sample data that mimics a real Rill project.
 */

import type { RillService } from "../tools/rill.js";

// Sample data for a fictional e-commerce analytics project
const SAMPLE_SOURCES = [
  {
    name: "orders",
    type: "csv",
    path: "sources/orders.yaml",
    connector: "local_file",
  },
  {
    name: "customers",
    type: "csv",
    path: "sources/customers.yaml",
    connector: "local_file",
  },
  {
    name: "products",
    type: "csv",
    path: "sources/products.yaml",
    connector: "local_file",
  },
];

const SAMPLE_MODELS = [
  {
    name: "orders_enriched",
    path: "models/orders_enriched.sql",
    sql: `SELECT
  o.order_id,
  o.customer_id,
  c.customer_name,
  c.region,
  o.product_id,
  p.product_name,
  p.category,
  o.quantity,
  o.unit_price,
  o.quantity * o.unit_price as total_amount,
  o.order_date
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
JOIN products p ON o.product_id = p.product_id`,
  },
  {
    name: "daily_sales",
    path: "models/daily_sales.sql",
    sql: `SELECT
  DATE_TRUNC('day', order_date) as date,
  category,
  region,
  COUNT(*) as order_count,
  SUM(total_amount) as revenue
FROM orders_enriched
GROUP BY 1, 2, 3`,
  },
];

const SAMPLE_METRICS_VIEWS = [
  {
    name: "sales_metrics",
    path: "metrics/sales_metrics.yaml",
    table: "orders_enriched",
    timeseries: "order_date",
    dimensions: [
      { name: "region", column: "region", description: "Customer region" },
      { name: "category", column: "category", description: "Product category" },
      { name: "customer_name", column: "customer_name", description: "Customer name" },
      { name: "product_name", column: "product_name", description: "Product name" },
    ],
    measures: [
      { name: "total_revenue", expression: "SUM(total_amount)", description: "Total revenue" },
      { name: "order_count", expression: "COUNT(*)", description: "Number of orders" },
      { name: "avg_order_value", expression: "AVG(total_amount)", description: "Average order value" },
      { name: "total_quantity", expression: "SUM(quantity)", description: "Total items sold" },
    ],
  },
];

const SAMPLE_DASHBOARDS = [
  {
    name: "sales_dashboard",
    path: "dashboards/sales_dashboard.yaml",
    metricsView: "sales_metrics",
    title: "Sales Performance Dashboard",
    description: "Track sales performance across regions and categories",
  },
];

// Sample query data
const SAMPLE_QUERY_DATA = [
  { region: "North America", category: "Electronics", revenue: 125000.50, order_count: 450 },
  { region: "Europe", category: "Electronics", revenue: 98000.25, order_count: 380 },
  { region: "Asia Pacific", category: "Electronics", revenue: 156000.75, order_count: 520 },
  { region: "North America", category: "Clothing", revenue: 78000.00, order_count: 890 },
  { region: "Europe", category: "Clothing", revenue: 65000.50, order_count: 720 },
  { region: "Asia Pacific", category: "Clothing", revenue: 92000.25, order_count: 980 },
  { region: "North America", category: "Home & Garden", revenue: 45000.75, order_count: 320 },
  { region: "Europe", category: "Home & Garden", revenue: 38000.00, order_count: 280 },
  { region: "Asia Pacific", category: "Home & Garden", revenue: 52000.50, order_count: 390 },
];

const SAMPLE_DAILY_SALES = [
  { date: "2024-01-15", category: "Electronics", region: "North America", order_count: 42, revenue: 12500.00 },
  { date: "2024-01-15", category: "Clothing", region: "North America", order_count: 78, revenue: 6800.00 },
  { date: "2024-01-16", category: "Electronics", region: "North America", order_count: 38, revenue: 11200.00 },
  { date: "2024-01-16", category: "Clothing", region: "Europe", order_count: 65, revenue: 5900.00 },
  { date: "2024-01-17", category: "Electronics", region: "Asia Pacific", order_count: 55, revenue: 16500.00 },
  { date: "2024-01-17", category: "Home & Garden", region: "Europe", order_count: 32, revenue: 4200.00 },
];

/**
 * Create a mock Rill service for testing
 */
export function createMockRillService(): RillService {
  // Simulate network latency
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    async query(_projectPath, sql) {
      await delay(300 + Math.random() * 200); // Simulate query time

      const normalizedSql = sql.toLowerCase();

      // Return different data based on what's being queried
      let rows: Record<string, unknown>[];

      if (normalizedSql.includes("daily_sales") || normalizedSql.includes("date_trunc")) {
        rows = SAMPLE_DAILY_SALES;
      } else if (normalizedSql.includes("group by")) {
        rows = SAMPLE_QUERY_DATA;
      } else {
        // Default: return a subset of enriched orders
        rows = [
          { order_id: 1001, customer_name: "Acme Corp", product_name: "Laptop Pro", category: "Electronics", quantity: 2, total_amount: 2400.00, order_date: "2024-01-15" },
          { order_id: 1002, customer_name: "Tech Solutions", product_name: "Monitor 27\"", category: "Electronics", quantity: 5, total_amount: 1500.00, order_date: "2024-01-15" },
          { order_id: 1003, customer_name: "Retail Hub", product_name: "T-Shirt Pack", category: "Clothing", quantity: 50, total_amount: 750.00, order_date: "2024-01-16" },
          { order_id: 1004, customer_name: "Home Essentials", product_name: "Garden Set", category: "Home & Garden", quantity: 3, total_amount: 450.00, order_date: "2024-01-16" },
          { order_id: 1005, customer_name: "Acme Corp", product_name: "Keyboard", category: "Electronics", quantity: 10, total_amount: 800.00, order_date: "2024-01-17" },
        ];
      }

      // Apply LIMIT if present
      const limitMatch = sql.match(/limit\s+(\d+)/i);
      if (limitMatch?.[1]) {
        const limit = parseInt(limitMatch[1], 10);
        rows = rows.slice(0, limit);
      }

      return {
        columns: rows.length > 0 ? Object.keys(rows[0] ?? {}) : [],
        rows,
        rowCount: rows.length,
        executionTimeMs: 150 + Math.random() * 100,
      };
    },

    async queryWithResolver(_projectPath, _resolver, properties) {
      await delay(400 + Math.random() * 300);

      // Parse dimensions from properties
      const dimensions = properties.dimensions ? JSON.parse(properties.dimensions) : [];

      // Generate aggregated data based on requested dimensions
      let rows: Record<string, unknown>[];

      if (dimensions.some((d: { name: string }) => d.name === "region")) {
        rows = [
          { region: "North America", total_revenue: 248000.75, order_count: 1660 },
          { region: "Europe", total_revenue: 201000.75, order_count: 1380 },
          { region: "Asia Pacific", total_revenue: 300000.50, order_count: 1890 },
        ];
      } else if (dimensions.some((d: { name: string }) => d.name === "category")) {
        rows = [
          { category: "Electronics", total_revenue: 379000.50, order_count: 1350 },
          { category: "Clothing", total_revenue: 235000.75, order_count: 2590 },
          { category: "Home & Garden", total_revenue: 135000.25, order_count: 990 },
        ];
      } else {
        rows = [{ total_revenue: 749000.50, order_count: 4930, avg_order_value: 151.93 }];
      }

      return {
        columns: rows.length > 0 ? Object.keys(rows[0] ?? {}) : [],
        rows,
        rowCount: rows.length,
        executionTimeMs: 200 + Math.random() * 150,
      };
    },

    async listSources(_projectPath) {
      await delay(100);
      return SAMPLE_SOURCES;
    },

    async listModels(_projectPath) {
      await delay(100);
      return SAMPLE_MODELS;
    },

    async listMetricsViews(_projectPath) {
      await delay(100);
      return SAMPLE_METRICS_VIEWS;
    },

    async listDashboards(_projectPath) {
      await delay(100);
      return SAMPLE_DASHBOARDS;
    },

    async getProjectStatus(projectPath) {
      await delay(150);
      return {
        projectPath: projectPath || "/mock/ecommerce-analytics",
        sources: SAMPLE_SOURCES.length,
        models: SAMPLE_MODELS.length,
        metricsViews: SAMPLE_METRICS_VIEWS.length,
        dashboards: SAMPLE_DASHBOARDS.length,
        errors: [],
      };
    },

    async readProjectFile(_projectPath, filePath) {
      await delay(50);

      // Return sample file contents
      if (filePath.includes("orders_enriched.sql")) {
        return SAMPLE_MODELS[0]?.sql || "";
      }
      if (filePath.includes("daily_sales.sql")) {
        return SAMPLE_MODELS[1]?.sql || "";
      }
      if (filePath.includes("sales_metrics.yaml")) {
        return `# Sales Metrics View
type: metrics_view
table: orders_enriched
timeseries: order_date

dimensions:
  - name: region
    column: region
    description: Customer region
  - name: category
    column: category
    description: Product category

measures:
  - name: total_revenue
    expression: SUM(total_amount)
  - name: order_count
    expression: COUNT(*)
  - name: avg_order_value
    expression: AVG(total_amount)`;
      }

      return `# ${filePath}\n# Sample content for testing`;
    },

    async listProjectFiles(_projectPath, directory) {
      await delay(50);

      if (directory === "sources") {
        return ["orders.yaml", "customers.yaml", "products.yaml"];
      }
      if (directory === "models") {
        return ["orders_enriched.sql", "daily_sales.sql"];
      }
      if (directory === "metrics") {
        return ["sales_metrics.yaml"];
      }
      if (directory === "dashboards") {
        return ["sales_dashboard.yaml"];
      }

      return ["sources/", "models/", "metrics/", "dashboards/", "rill.yaml"];
    },

    async executeCommand(_projectPath, args) {
      await delay(200);

      const command = args.join(" ");

      if (command.includes("project status")) {
        return `Project: ecommerce-analytics
Status: OK
Sources: 3
Models: 2
Metrics Views: 1
Dashboards: 1`;
      }

      if (command.includes("version")) {
        return "rill version 0.43.0 (mock)";
      }

      return `Executed: rill ${command}\n(Mock response)`;
    },
  };
}
