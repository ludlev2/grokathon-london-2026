import { z } from "zod";
import { Daytona } from "@daytonaio/sdk";
import { db } from "@grokathon-london-2026/db";
import { snowflakeConnections } from "@grokathon-london-2026/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "../services/snowflake/index.js";
import { defineTool, jsonResult, textResult, errorResult } from "@grokathon-london-2026/agent";

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
const CREDENTIALS_ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;

// Store active sandbox connections
const sandboxConnections = new Map<
	string,
	{ sandbox: Awaited<ReturnType<Daytona["create"]>>; daytona: Daytona }
>();

// Store active Rill sessions
interface RillSession {
	sessionId: string;
	sandboxId: string;
	status: "starting" | "running" | "stopped" | "error";
	startedAt: Date;
	projectPath: string;
}
const rillSessions = new Map<string, RillSession>();

// Track the current active sandbox for the session
let activeSandboxId: string | null = null;

function getDaytonaClient(): Daytona {
	if (!DAYTONA_API_KEY) {
		throw new Error("DAYTONA_API_KEY is not configured");
	}
	return new Daytona({ apiKey: DAYTONA_API_KEY });
}

/**
 * Generate Rill .env content for Snowflake connection using JWT auth
 */
function generateRillEnvContent(config: {
	account: string;
	username: string;
	database: string;
	schema: string;
	warehouse: string;
	role: string | null;
	privateKey: string;
}): string {
	const roleParam = config.role ? `&role=${config.role}` : "";
	const dsn = `${config.username}@${config.account}/${config.database}/${config.schema}?warehouse=${config.warehouse}${roleParam}&authenticator=SNOWFLAKE_JWT&privateKey=${config.privateKey}`;
	return `connector.snowflake.dsn=${dsn}`;
}

// ==================== TOOL DEFINITIONS ====================

/**
 * Tool to create a data analysis sandbox with Rill + Snowflake configured
 */
export const createDataSandboxTool = defineTool({
	description: `Create a new data analysis sandbox environment with Rill and Snowflake credentials configured.
This sets up an isolated environment where you can run data queries against Snowflake.
You need to provide the Snowflake connection ID to inject credentials.
After creation, you can upload a Rill project and start analyzing data.`,
	inputSchema: z.object({
		snowflakeConnectionId: z
			.string()
			.describe("The ID of the Snowflake connection to use for data access"),
		snapshotId: z
			.string()
			.optional()
			.describe(
				"Optional: ID of a pre-built snapshot with Rill installed for faster startup",
			),
	}),
	execute: async ({ snowflakeConnectionId, snapshotId }) => {
		const daytona = getDaytonaClient();

		// Fetch Snowflake credentials
		const connection = await db.query.snowflakeConnections.findFirst({
			where: eq(snowflakeConnections.id, snowflakeConnectionId),
		});

		if (!connection) {
			return errorResult("Snowflake connection not found");
		}

		// Decrypt credentials
		if (!CREDENTIALS_ENCRYPTION_KEY) {
			return errorResult("Encryption key not configured");
		}
		const decryptedCreds = JSON.parse(
			decrypt(connection.encryptedCredentials, CREDENTIALS_ENCRYPTION_KEY),
		) as { privateKey?: string };

		if (!decryptedCreds.privateKey) {
			return errorResult("Snowflake connection must use key_pair auth for Rill");
		}

		// Find snapshot if provided
		let snapshotName: string | undefined;
		if (snapshotId) {
			const snapshots = await daytona.snapshot.list(1, 100);
			const snapshot = snapshots.items.find((s) => s.id === snapshotId);
			if (snapshot && snapshot.state === "active") {
				snapshotName = snapshot.name;
			}
		}

		// Create sandbox
		const sandbox = await daytona.create({
			language: "python",
			labels: {
				purpose: "rill-analysis",
				snowflakeConnectionId,
			},
			snapshot: snapshotName,
		});

		sandboxConnections.set(sandbox.id, { sandbox, daytona });
		activeSandboxId = sandbox.id;

		// Create project directory and write .env
		const projectDir = "/home/daytona/rill-project";
		await sandbox.fs.createFolder(projectDir, "755");

		const envContent = generateRillEnvContent({
			account: connection.account,
			username: connection.username,
			database: connection.database,
			schema: connection.schema,
			warehouse: connection.warehouse,
			role: connection.role,
			privateKey: decryptedCreds.privateKey.replace(/\n/g, ""),
		});

		await sandbox.fs.uploadFile(
			Buffer.from(envContent, "utf-8"),
			`${projectDir}/.env`,
		);

		return jsonResult({
			sandboxId: sandbox.id,
			state: sandbox.state,
			projectPath: projectDir,
			message:
				"Data sandbox created with Snowflake credentials. Ready for Rill project upload and queries.",
		});
	},
});

/**
 * Tool to execute a SQL query in the data sandbox using Rill
 */
export const executeDataQueryTool = defineTool({
	description: `Execute a SQL query against the connected Snowflake data warehouse using Rill.
This runs the query in the sandbox and returns the results.
The SQL should be valid Snowflake SQL syntax.
If no sandboxId is provided, uses the most recently created sandbox.`,
	inputSchema: z.object({
		sql: z
			.string()
			.max(50000)
			.describe("The SQL query to execute against Snowflake"),
		sandboxId: z
			.string()
			.optional()
			.describe(
				"Optional: specific sandbox ID to use. If not provided, uses active sandbox.",
			),
	}),
	execute: async ({ sql, sandboxId }) => {
		const targetSandboxId = sandboxId || activeSandboxId;

		if (!targetSandboxId) {
			return errorResult("No sandbox available. Create one first using createDataSandbox.");
		}

		const entry = sandboxConnections.get(targetSandboxId);
		if (!entry) {
			return errorResult("Sandbox not connected. It may have been stopped.");
		}

		const projectPath = "/home/daytona/rill-project";
		const escapedSql = sql.replace(/'/g, "'\\''");

		const response = await entry.sandbox.process.executeCommand(
			`cd ${projectPath} && rill query '${escapedSql}'`,
			undefined,
			undefined,
			300, // 5 min timeout for complex queries
		);

		// Sanitize output
		let result = response.result ?? "";
		result = Buffer.from(result, "utf-8").toString("utf-8");
		result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

		if (response.exitCode !== 0) {
			return errorResult(`Query failed: ${result}`);
		}

		return textResult(result);
	},
});

/**
 * Tool to run a shell command in the sandbox (for advanced operations)
 */
export const runSandboxCommandTool = defineTool({
	description: `Execute a shell command in the data sandbox.
Use this for operations like listing files, checking Rill status, or running custom scripts.
Be careful with commands that might affect the sandbox state.`,
	inputSchema: z.object({
		command: z
			.string()
			.max(10000)
			.describe("The shell command to execute"),
		workingDir: z
			.string()
			.optional()
			.describe("Optional working directory for the command"),
		sandboxId: z
			.string()
			.optional()
			.describe("Optional sandbox ID. Uses active sandbox if not provided."),
	}),
	execute: async ({ command, workingDir, sandboxId }) => {
		const targetSandboxId = sandboxId || activeSandboxId;

		if (!targetSandboxId) {
			return errorResult("No sandbox available.");
		}

		const entry = sandboxConnections.get(targetSandboxId);
		if (!entry) {
			return errorResult("Sandbox not connected.");
		}

		const response = await entry.sandbox.process.executeCommand(
			command,
			workingDir,
			undefined,
			60, // 1 min timeout
		);

		let result = response.result ?? "";
		result = Buffer.from(result, "utf-8").toString("utf-8");
		result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

		return jsonResult({
			exitCode: response.exitCode,
			output: result,
		});
	},
});

/**
 * Tool to start the Rill server for interactive data exploration
 */
export const startRillServerTool = defineTool({
	description: `Start the Rill development server in the sandbox.
This enables the full Rill data analysis environment with dashboards and metrics exploration.
The server runs in the background and provides a web interface for data exploration.`,
	inputSchema: z.object({
		sandboxId: z
			.string()
			.optional()
			.describe("Optional sandbox ID. Uses active sandbox if not provided."),
	}),
	execute: async ({ sandboxId }) => {
		const targetSandboxId = sandboxId || activeSandboxId;

		if (!targetSandboxId) {
			return errorResult("No sandbox available.");
		}

		const entry = sandboxConnections.get(targetSandboxId);
		if (!entry) {
			return errorResult("Sandbox not connected.");
		}

		const sessionId = `rill-${targetSandboxId}`;
		const projectPath = "/home/daytona/rill-project";

		// Check if already running
		if (rillSessions.has(sessionId)) {
			const existing = rillSessions.get(sessionId);
			if (existing?.status === "running") {
				return jsonResult({
					status: "already_running",
					sessionId,
					message: "Rill server is already running",
				});
			}
		}

		// Create background session
		await entry.sandbox.process.createSession(sessionId);
		await entry.sandbox.process.executeSessionCommand(sessionId, {
			command: `cd ${projectPath} && rill start --no-open`,
			async: true,
		});

		rillSessions.set(sessionId, {
			sessionId,
			sandboxId: targetSandboxId,
			status: "running",
			startedAt: new Date(),
			projectPath,
		});

		return jsonResult({
			status: "started",
			sessionId,
			message: "Rill server started in background",
		});
	},
});

/**
 * Tool to list available Snowflake connections
 */
export const listSnowflakeConnectionsTool = defineTool({
	description: `List all available Snowflake connections that can be used for data analysis.
Returns connection details (but not credentials) to help you choose which data source to use.`,
	inputSchema: z.object({}),
	execute: async () => {
		const connections = await db.query.snowflakeConnections.findMany();

		const result = connections.map((c) => ({
			id: c.id,
			name: c.name,
			account: c.account,
			database: c.database,
			schema: c.schema,
			warehouse: c.warehouse,
			status: c.status,
			lastTestedAt: c.lastTestedAt,
		}));

		return jsonResult({
			connections: result,
			count: result.length,
		});
	},
});

/**
 * Tool to list available Rill metrics views
 */
export const listRillMetricsTool = defineTool({
	description: `List available metrics views in the Rill project.
Metrics views define aggregations and dimensions for data analysis.
Use this to discover what analytical queries are available.`,
	inputSchema: z.object({
		sandboxId: z
			.string()
			.optional()
			.describe("Optional sandbox ID. Uses active sandbox if not provided."),
	}),
	execute: async ({ sandboxId }) => {
		const targetSandboxId = sandboxId || activeSandboxId;

		if (!targetSandboxId) {
			return errorResult("No sandbox available.");
		}

		const entry = sandboxConnections.get(targetSandboxId);
		if (!entry) {
			return errorResult("Sandbox not connected.");
		}

		const projectPath = "/home/daytona/rill-project";
		const response = await entry.sandbox.process.executeCommand(
			`find ${projectPath}/metrics -name "*.yaml" -o -name "*.yml" 2>/dev/null || echo ""`,
		);

		const files = (response.result ?? "")
			.split("\n")
			.filter((f) => f.trim());

		return jsonResult({
			metricsFiles: files,
			count: files.length,
		});
	},
});

/**
 * Tool to read a specific Rill metrics view definition
 */
export const getRillMetricsViewTool = defineTool({
	description: `Read the definition of a specific Rill metrics view.
This returns the YAML configuration including measures, dimensions, and data model.
Use this to understand what queries can be run against a metrics view.`,
	inputSchema: z.object({
		metricsFile: z
			.string()
			.describe("Path to the metrics YAML file"),
		sandboxId: z
			.string()
			.optional()
			.describe("Optional sandbox ID. Uses active sandbox if not provided."),
	}),
	execute: async ({ metricsFile, sandboxId }) => {
		const targetSandboxId = sandboxId || activeSandboxId;

		if (!targetSandboxId) {
			return errorResult("No sandbox available.");
		}

		const entry = sandboxConnections.get(targetSandboxId);
		if (!entry) {
			return errorResult("Sandbox not connected.");
		}

		const content = await entry.sandbox.fs.downloadFile(metricsFile);

		return textResult(content.toString("utf-8"));
	},
});

/**
 * Tool to cleanup/delete a sandbox
 */
export const deleteSandboxTool = defineTool({
	description: `Delete a data analysis sandbox when it's no longer needed.
This cleans up resources and removes the sandbox.`,
	inputSchema: z.object({
		sandboxId: z
			.string()
			.describe("The ID of the sandbox to delete"),
	}),
	execute: async ({ sandboxId }) => {
		const entry = sandboxConnections.get(sandboxId);

		if (!entry) {
			// Try to get it from Daytona directly
			const daytona = getDaytonaClient();
			try {
				const sandbox = await daytona.get(sandboxId);
				await daytona.delete(sandbox);
			} catch {
				return errorResult("Sandbox not found");
			}
		} else {
			await entry.daytona.delete(entry.sandbox);
			sandboxConnections.delete(sandboxId);
		}

		// Clean up rill sessions
		const sessionId = `rill-${sandboxId}`;
		rillSessions.delete(sessionId);

		if (activeSandboxId === sandboxId) {
			activeSandboxId = null;
		}

		return jsonResult({
			success: true,
			message: "Sandbox deleted",
		});
	},
});

// Export all tools as a collection
export const dataAnalysisTools = {
	createDataSandbox: createDataSandboxTool,
	executeDataQuery: executeDataQueryTool,
	runSandboxCommand: runSandboxCommandTool,
	startRillServer: startRillServerTool,
	listSnowflakeConnections: listSnowflakeConnectionsTool,
	listRillMetrics: listRillMetricsTool,
	getRillMetricsView: getRillMetricsViewTool,
	deleteSandbox: deleteSandboxTool,
};
