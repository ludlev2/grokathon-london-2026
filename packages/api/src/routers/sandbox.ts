import { Daytona, Image } from "@daytonaio/sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@grokathon-london-2026/db";
import { snowflakeConnections } from "@grokathon-london-2026/db/schema";
import { env } from "@grokathon-london-2026/env/server";

import { publicProcedure, router } from "../index.js";
import { decrypt, type SnowflakeCredential } from "../services/snowflake/index.js";

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;

// Volume name prefix
const VOLUME_PREFIX = "grok-vol";

// Snapshot name prefix
const SNAPSHOT_PREFIX = "grok-snap";

// Store active sandbox connections in memory (keyed by sandboxId)
const sandboxConnections = new Map<
	string,
	{ sandbox: Awaited<ReturnType<Daytona["create"]>>; daytona: Daytona }
>();

/**
 * Get or create a Daytona client instance
 */
function getDaytonaClient(): Daytona {
	if (!DAYTONA_API_KEY) {
		throw new Error("DAYTONA_API_KEY is not configured");
	}
	return new Daytona({ apiKey: DAYTONA_API_KEY });
}

/**
 * Build Rill Snowflake DSN string
 * Format: USER@account/DATABASE/SCHEMA?warehouse=WH&role=ROLE&authenticator=SNOWFLAKE_JWT&privateKey=...
 */
function buildRillSnowflakeDsn(
	connection: typeof snowflakeConnections.$inferSelect,
	credential: SnowflakeCredential,
): string {
	const baseUrl = `${connection.username}@${connection.account}/${connection.database}/${connection.schema}`;

	const params = new URLSearchParams();
	params.set("warehouse", connection.warehouse);
	if (connection.role) {
		params.set("role", connection.role);
	}

	if (credential.authMethod === "key_pair") {
		params.set("authenticator", "SNOWFLAKE_JWT");
		// Rill expects the private key in PEM format (pkcs8)
		let privateKey = credential.privateKey;
		// Check if key already has PEM headers, if not add them
		if (!privateKey.includes("-----BEGIN")) {
			// Remove any whitespace first
			privateKey = privateKey.replace(/\s+/g, "");
			// Add PEM headers for PKCS8 format
			privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
		}
		params.set("privateKey", privateKey);
	} else if (credential.authMethod === "password") {
		params.set("password", credential.password);
	}

	return `${baseUrl}?${params.toString()}`;
}

/**
 * Create .env file with Snowflake DSN for Rill in the sandbox
 */
async function createSnowflakeEnvFile(
	sandbox: Awaited<ReturnType<Daytona["create"]>>,
	connectionId: string,
	targetPath: string,
): Promise<void> {
	// Fetch the Snowflake connection
	const [connection] = await db
		.select()
		.from(snowflakeConnections)
		.where(eq(snowflakeConnections.id, connectionId));

	if (!connection) {
		throw new Error(`Snowflake connection not found: ${connectionId}`);
	}

	// Decrypt credentials
	const decrypted = decrypt(connection.encryptedCredentials, env.CREDENTIALS_ENCRYPTION_KEY);
	const credential = JSON.parse(decrypted) as SnowflakeCredential;

	// Build the DSN
	const dsn = buildRillSnowflakeDsn(connection, credential);

	// Create .env content
	const envContent = `connector.snowflake.dsn=${dsn}\n`;

	// Write to the sandbox
	const envPath = `${targetPath}/.env`;
	await sandbox.fs.uploadFile(Buffer.from(envContent, "utf-8"), envPath);

	console.log(`Created .env file at ${envPath} for Snowflake connection: ${connection.name}`);
}

/**
 * Get or create a sandbox connection - auto-connects if not in cache
 */
async function getOrConnectSandbox(sandboxId: string): Promise<{
	sandbox: Awaited<ReturnType<Daytona["create"]>>;
	daytona: Daytona;
}> {
	// Return cached connection immediately if exists
	const existing = sandboxConnections.get(sandboxId);
	if (existing) {
		return existing;
	}

	// Only fetch from API if not in cache
	const daytona = getDaytonaClient();
	const sandbox = await daytona.get(sandboxId);
	sandboxConnections.set(sandboxId, { sandbox, daytona });
	console.log("Connected to sandbox:", sandboxId);
	return { sandbox, daytona };
}

/**
 * Sandbox Router
 *
 * Provides endpoints to create, execute code in, and manage Daytona sandboxes.
 * Sandboxes are isolated execution environments for running untrusted code.
 */
export const sandboxRouter = router({
	/**
	 * List all sandboxes from Daytona API
	 */
	list: publicProcedure.query(async () => {
		const daytona = getDaytonaClient();

		try {
			const result = await daytona.list({}, 1, 100);

			return result.items.map((sandbox) => ({
				sandboxId: sandbox.id,
				state: sandbox.state,
				connected: sandboxConnections.has(sandbox.id),
			}));
		} catch (error) {
			console.error("Failed to list sandboxes:", error);
			throw new Error(
				`Failed to list sandboxes: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}),

	/**
	 * Create a new sandbox, optionally with volumes mounted and/or from a snapshot
	 */
	create: publicProcedure
		.input(
			z.object({
				language: z
					.enum(["typescript", "python", "javascript"])
					.default("python"),
				volumes: z
					.array(
						z.object({
							volumeId: z.string(),
							mountPath: z.string(),
						}),
					)
					.optional(),
				snapshotId: z.string().optional(),
				// If true, copy volume data to /tmp WITHOUT mounting the volume
				// Creates a temp sandbox to read volume, copies data, then creates clean sandbox
				copyVolumesToTmp: z.boolean().optional(),
				// Optional Snowflake connection ID to create .env with DSN for Rill
				snowflakeConnectionId: z.string().uuid().optional(),
				// Resource configuration
				cpu: z.number().min(1).max(8).optional(),
				memory: z.number().min(1).max(16).optional(), // GB
				disk: z.number().min(3).max(50).optional(), // GB
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			try {
				// If a snapshot is specified, find its name
				let snapshotName: string | undefined;
				if (input.snapshotId) {
					const result = await daytona.snapshot.list(1, 100);
					const snapshot = result.items.find((s) => s.id === input.snapshotId);
					if (!snapshot) {
						throw new Error("Snapshot not found");
					}
					if (snapshot.state !== "active") {
						throw new Error(
							`Snapshot is not active (state: ${snapshot.state})`,
						);
					}
					snapshotName = snapshot.name;
				}

				// Resolve volume IDs to actual volume names for correct mount paths
				let resolvedVolumes: { volumeId: string; mountPath: string }[] | undefined;
				if (input.volumes && input.volumes.length > 0) {
					const allVolumes = await daytona.volume.list();
					resolvedVolumes = input.volumes.map((vol) => {
						const volume = allVolumes.find((v) => v.id === vol.volumeId);
						if (!volume) {
							throw new Error(`Volume not found: ${vol.volumeId}`);
						}
						// Use the actual volume name for mount path
						return {
							volumeId: vol.volumeId,
							mountPath: `/home/daytona/${volume.name}`,
						};
					});
					console.log("Resolved volumes:", resolvedVolumes);
				}

				// Build resources config if provided
				const resources = (input.cpu || input.memory || input.disk)
					? { cpu: input.cpu, memory: input.memory, disk: input.disk }
					: undefined;

				// Get the snapshot's image name if we need resources (we'll create from image instead)
				let snapshotImageName: string | undefined;
				if (resources && input.snapshotId) {
					const result = await daytona.snapshot.list(1, 100);
					const snapshot = result.items.find((s) => s.id === input.snapshotId);
					if (snapshot?.imageName) {
						snapshotImageName = snapshot.imageName;
						console.log(`Using snapshot image for resources: ${snapshotImageName}`);
					}
				}

				// If copyVolumesToTmp is set, create sandbox with volumes and copy data to /tmp
				if (input.copyVolumesToTmp && resolvedVolumes && resolvedVolumes.length > 0) {
					console.log("Creating sandbox with volume data copied to /tmp...", { resources });

					// If resources are specified, we need to create from image (resources not supported with snapshots)
					// Use the snapshot's image if available, otherwise fall back to default
					const createParams = resources
						? {
								language: input.language,
								labels: {
									language: input.language,
									...(input.snapshotId && { snapshotId: input.snapshotId }),
								},
								volumes: resolvedVolumes,
								image: snapshotImageName || "daytonaio/ai-starter:latest",
								resources,
							}
						: {
								language: input.language,
								labels: {
									language: input.language,
									...(input.snapshotId && { snapshotId: input.snapshotId }),
								},
								volumes: resolvedVolumes,
								snapshot: snapshotName,
							};

					const sandbox = await daytona.create(createParams);

					sandboxConnections.set(sandbox.id, { sandbox, daytona });

					// Copy each volume to /tmp
					for (const vol of resolvedVolumes) {
						const volumeName = vol.mountPath.split("/").pop() || "volume";
						const tmpPath = `/tmp/${volumeName}`;

						console.log(`Copying ${vol.mountPath} to ${tmpPath}...`);

						// First check if volume path exists and list contents
						const lsResult = await sandbox.process.executeCommand(
							`ls -la "${vol.mountPath}"`,
							undefined,
							undefined,
							30,
						);
						console.log(`Volume contents at ${vol.mountPath}:`, lsResult.result);

						if (lsResult.exitCode !== 0) {
							console.error(`Volume path does not exist or is empty: ${vol.mountPath}`);
							continue;
						}

						// Create target directory and copy volume data to /tmp
						await sandbox.process.executeCommand(
							`mkdir -p "${tmpPath}"`,
							undefined,
							undefined,
							30,
						);

						const copyResult = await sandbox.process.executeCommand(
							`cp -r "${vol.mountPath}/." "${tmpPath}/"`,
							undefined,
							undefined,
							300, // 5 min timeout for large volumes
						);

						if (copyResult.exitCode !== 0) {
							console.error(`Copy failed: ${copyResult.result}`);
						} else {
							console.log(`Copied volume data to ${tmpPath}`);
							// Verify copy
							const verifyResult = await sandbox.process.executeCommand(
								`ls -la "${tmpPath}"`,
								undefined,
								undefined,
								30,
							);
							console.log(`Copied contents at ${tmpPath}:`, verifyResult.result);
						}
					}

					// Delete any existing Rill tmp/cache directories to avoid DuckDB lock conflicts
					for (const vol of resolvedVolumes) {
						const volumeName = vol.mountPath.split("/").pop() || "volume";
						const tmpPath = `/tmp/${volumeName}`;

						// Remove Rill's tmp directory (contains DuckDB which can have lock issues)
						await sandbox.process.executeCommand(
							`rm -rf "${tmpPath}/tmp" "${tmpPath}/.rill"`,
							undefined,
							undefined,
							30,
						);
						console.log(`Cleaned up Rill cache directories in ${tmpPath}`);
					}

					// Create .env file with Snowflake DSN if connection is specified
					if (input.snowflakeConnectionId && resolvedVolumes.length > 0) {
						// Put .env in the first volume's /tmp path
						const volumeName = resolvedVolumes[0].mountPath.split("/").pop() || "volume";
						const tmpPath = `/tmp/${volumeName}`;
						await createSnowflakeEnvFile(sandbox, input.snowflakeConnectionId, tmpPath);
					}

					console.log("Sandbox created with volume data in /tmp:", {
						sandboxId: sandbox.id,
						snapshotId: input.snapshotId,
						snowflakeConnectionId: input.snowflakeConnectionId,
					});

					return {
						sandboxId: sandbox.id,
						language: input.language,
						state: sandbox.state,
						volumes: resolvedVolumes,
						snapshotId: input.snapshotId,
					};
				}

				// Normal path: create sandbox with volumes mounted
				// If resources are specified, we need to create from image (resources not supported with snapshots)
				const normalCreateParams = resources
					? {
							language: input.language,
							labels: {
								language: input.language,
								...(input.snapshotId && { snapshotId: input.snapshotId }),
							},
							volumes: resolvedVolumes,
							image: snapshotImageName || "daytonaio/ai-starter:latest",
							resources,
						}
					: {
							language: input.language,
							labels: {
								language: input.language,
								...(input.snapshotId && { snapshotId: input.snapshotId }),
							},
							volumes: resolvedVolumes,
							snapshot: snapshotName,
						};

				const sandbox = await daytona.create(normalCreateParams);

				sandboxConnections.set(sandbox.id, { sandbox, daytona });

				console.log("Sandbox created:", {
					sandboxId: sandbox.id,
					volumes: resolvedVolumes?.length ?? 0,
					snapshotId: input.snapshotId,
				});

				return {
					sandboxId: sandbox.id,
					language: input.language,
					state: sandbox.state,
					volumes: resolvedVolumes,
					snapshotId: input.snapshotId,
				};
			} catch (error) {
				console.error("Failed to create sandbox:", error);
				throw new Error(
					`Failed to create sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Select/connect to an existing sandbox
	 */
	select: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			// Check if already connected
			const existing = sandboxConnections.get(input.sandboxId);
			if (existing) {
				try {
					const state = existing.sandbox.state;
					if (state === "started" || state === "starting") {
						return {
							sandboxId: input.sandboxId,
							state,
							connected: true,
						};
					}
				} catch {
					// Connection stale, remove it
					sandboxConnections.delete(input.sandboxId);
				}
			}

			const daytona = getDaytonaClient();

			try {
				const sandbox = await daytona.get(input.sandboxId);
				sandboxConnections.set(input.sandboxId, { sandbox, daytona });

				console.log("Sandbox selected:", {
					sandboxId: input.sandboxId,
					state: sandbox.state,
				});

				return {
					sandboxId: sandbox.id,
					state: sandbox.state,
					connected: true,
				};
			} catch (error) {
				console.error("Failed to select sandbox:", error);
				throw new Error(
					`Failed to select sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Execute code in a sandbox
	 */
	executeCode: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				code: z.string().max(50000),
				timeout: z.number().min(1000).max(60000).default(30000),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				// Auto-connect if not already connected
				const entry = await getOrConnectSandbox(input.sandboxId);

				const response = await entry.sandbox.process.codeRun(
					input.code,
					undefined,
					input.timeout,
				);

				return {
					exitCode: response.exitCode,
					result: response.result,
				};
			} catch (error) {
				sandboxConnections.delete(input.sandboxId);
				console.error("Failed to execute code:", error);
				throw new Error(
					`Failed to execute code: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Execute a shell command in a sandbox
	 */
	executeCommand: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				command: z.string().max(10000),
				workingDir: z.string().optional(),
				timeout: z.number().min(1000).max(1800000).default(30000),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				// Auto-connect if not already connected
				const entry = await getOrConnectSandbox(input.sandboxId);

				const response = await entry.sandbox.process.executeCommand(
					input.command,
					input.workingDir,
					undefined,
					Math.floor(input.timeout / 1000),
				);

				// Sanitize output
				let sanitizedResult = response.result ?? "";
				if (typeof sanitizedResult === "string") {
					sanitizedResult = Buffer.from(sanitizedResult, "utf-8").toString(
						"utf-8",
					);
					sanitizedResult = sanitizedResult.replace(
						// biome-ignore lint/suspicious/noControlCharactersInRegex: Need to strip control chars
						/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
						"",
					);
				}

				return {
					exitCode: response.exitCode,
					result: sanitizedResult,
				};
			} catch (error) {
				sandboxConnections.delete(input.sandboxId);
				console.error("Failed to execute command:", error);
				throw new Error(
					`Failed to execute command: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Delete a sandbox
	 */
	delete: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			try {
				const sandbox = await daytona.get(input.sandboxId);
				await daytona.delete(sandbox);
				sandboxConnections.delete(input.sandboxId);

				console.log("Sandbox deleted:", input.sandboxId);

				return { success: true };
			} catch (error) {
				console.error("Failed to delete sandbox:", error);
				throw new Error(
					`Failed to delete sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Disconnect from a sandbox (removes local connection cache only)
	 */
	disconnect: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			sandboxConnections.delete(input.sandboxId);
			console.log("Sandbox disconnected:", input.sandboxId);
			return { success: true };
		}),

	/**
	 * Stop a running sandbox
	 */
	stop: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			try {
				const sandbox = await daytona.get(input.sandboxId);
				await sandbox.stop();
				sandboxConnections.delete(input.sandboxId);

				console.log("Sandbox stopped:", input.sandboxId);

				return { success: true, state: sandbox.state };
			} catch (error) {
				console.error("Failed to stop sandbox:", error);
				throw new Error(
					`Failed to stop sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Start a stopped sandbox
	 */
	start: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			try {
				const sandbox = await daytona.get(input.sandboxId);
				await sandbox.start();
				sandboxConnections.set(input.sandboxId, { sandbox, daytona });

				console.log("Sandbox started:", input.sandboxId);

				return { success: true, state: sandbox.state };
			} catch (error) {
				console.error("Failed to start sandbox:", error);
				throw new Error(
					`Failed to start sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Archive a stopped sandbox
	 */
	archive: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			try {
				const sandbox = await daytona.get(input.sandboxId);

				if (sandbox.state !== "stopped") {
					throw new Error("Sandbox must be stopped before archiving");
				}

				await sandbox.archive();
				sandboxConnections.delete(input.sandboxId);

				console.log("Sandbox archived:", input.sandboxId);

				return { success: true, state: sandbox.state };
			} catch (error) {
				console.error("Failed to archive sandbox:", error);
				throw new Error(
					`Failed to archive sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	// ==================== Volume Management ====================

	/**
	 * List all volumes from Daytona
	 */
	listVolumes: publicProcedure.query(async () => {
		const daytona = getDaytonaClient();

		try {
			const volumes = await daytona.volume.list();

			return volumes.map((volume) => ({
				id: volume.id,
				name: volume.name,
				displayName: volume.name,
			}));
		} catch (error) {
			console.error("Failed to list volumes:", error);
			throw new Error(
				`Failed to list volumes: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}),

	/**
	 * Create a new volume
	 */
	createVolume: publicProcedure
		.input(
			z.object({
				name: z
					.string()
					.min(1)
					.max(50)
					.regex(/^[a-zA-Z0-9-_]+$/),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();
			const volumeName = `${VOLUME_PREFIX}-${input.name}`;

			try {
				const volume = await daytona.volume.create(volumeName);

				console.log("Volume created:", {
					volumeId: volume.id,
					volumeName: volume.name,
				});

				return {
					id: volume.id,
					name: volume.name,
					displayName: input.name,
				};
			} catch (error) {
				console.error("Failed to create volume:", error);
				throw new Error(
					`Failed to create volume: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Delete a volume
	 */
	deleteVolume: publicProcedure
		.input(
			z.object({
				volumeId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			try {
				const volumes = await daytona.volume.list();
				const volume = volumes.find((v) => v.id === input.volumeId);

				if (!volume) {
					throw new Error("Volume not found");
				}

				await daytona.volume.delete(volume);

				console.log("Volume deleted:", input.volumeId);

				return { success: true };
			} catch (error) {
				console.error("Failed to delete volume:", error);
				throw new Error(
					`Failed to delete volume: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	// ==================== File System Operations ====================

	/**
	 * List files in a sandbox directory
	 */
	listFiles: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				path: z.string().default("/home/daytona"),
			}),
		)
		.query(async ({ input }) => {
			try {
				// Auto-connect if not already connected
				const entry = await getOrConnectSandbox(input.sandboxId);

				const files = await entry.sandbox.fs.listFiles(input.path);

				return files.map((file) => ({
					name: file.name,
					isDir: file.isDir,
					size: file.size,
					modTime: file.modTime,
				}));
			} catch (error) {
				console.error("Failed to list files:", error);
				throw new Error(
					`Failed to list files: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Read file content from sandbox
	 */
	readFile: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				path: z.string(),
			}),
		)
		.query(async ({ input }) => {
			try {
				// Auto-connect if not already connected
				const entry = await getOrConnectSandbox(input.sandboxId);

				const content = await entry.sandbox.fs.downloadFile(input.path);

				return {
					path: input.path,
					content: content.toString("utf-8"),
				};
			} catch (error) {
				console.error("Failed to read file:", error);
				throw new Error(
					`Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Delete a file or directory from sandbox
	 */
	deleteFile: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				path: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				// Auto-connect if not already connected
				const entry = await getOrConnectSandbox(input.sandboxId);

				await entry.sandbox.fs.deleteFile(input.path);

				console.log("File deleted:", input.path);

				return { success: true };
			} catch (error) {
				console.error("Failed to delete file:", error);
				throw new Error(
					`Failed to delete file: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	// ==================== Volume Session Operations ====================

	/**
	 * Create a temporary sandbox session for managing volume files
	 */
	createVolumeSession: publicProcedure
		.input(
			z.object({
				volumeId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			const volumes = await daytona.volume.list();
			const volume = volumes.find((v) => v.id === input.volumeId);

			if (!volume) {
				throw new Error("Volume not found");
			}

			const mountPath = `/home/daytona/${volume.name}`;

			try {
				const sandbox = await daytona.create({
					language: "python",
					labels: {
						purpose: "volume-session",
						volumeId: input.volumeId,
					},
					volumes: [
						{
							volumeId: input.volumeId,
							mountPath,
						},
					],
				});

				sandboxConnections.set(sandbox.id, { sandbox, daytona });

				console.log("Volume session created:", {
					sandboxId: sandbox.id,
					volumeId: input.volumeId,
					mountPath,
				});

				return {
					sandboxId: sandbox.id,
					volumeId: input.volumeId,
					volumeName: volume.name,
					mountPath,
				};
			} catch (error) {
				console.error("Failed to create volume session:", error);
				throw new Error(
					`Failed to create volume session: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Close a volume session (deletes the temporary sandbox)
	 */
	closeVolumeSession: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			try {
				const sandbox = await daytona.get(input.sandboxId);
				await daytona.delete(sandbox);
				sandboxConnections.delete(input.sandboxId);

				console.log("Volume session closed:", input.sandboxId);

				return { success: true };
			} catch (error) {
				sandboxConnections.delete(input.sandboxId);
				console.error("Failed to close volume session:", error);
				throw new Error(
					`Failed to close volume session: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Upload a file to a connected sandbox
	 */
	uploadFile: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				path: z.string(),
				content: z.string(), // Base64 encoded
			}),
		)
		.mutation(async ({ input }) => {
			try {
				// Auto-connect if not already connected
				const entry = await getOrConnectSandbox(input.sandboxId);

				// Ensure parent directory exists
				const dirPath = input.path.substring(0, input.path.lastIndexOf("/"));
				try {
					await entry.sandbox.fs.createFolder(dirPath, "755");
				} catch {
					// Directory might already exist
				}

				const content = Buffer.from(input.content, "base64");
				await entry.sandbox.fs.uploadFile(content, input.path);

				console.log("File uploaded:", input.path);

				return { success: true, path: input.path };
			} catch (error) {
				console.error("Failed to upload file:", error);
				throw new Error(
					`Failed to upload file: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Create a folder in a connected sandbox
	 */
	createFolder: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				path: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				// Auto-connect if not already connected
				const entry = await getOrConnectSandbox(input.sandboxId);

				await entry.sandbox.fs.createFolder(input.path, "755");

				console.log("Folder created:", input.path);

				return { success: true, path: input.path };
			} catch (error) {
				console.error("Failed to create folder:", error);
				throw new Error(
					`Failed to create folder: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	// ==================== SNAPSHOT ENDPOINTS ====================

	/**
	 * List all snapshots from Daytona
	 */
	listSnapshots: publicProcedure.query(async () => {
		const daytona = getDaytonaClient();

		try {
			const result = await daytona.snapshot.list(1, 100);

			return result.items.map((snapshot) => ({
				id: snapshot.id,
				name: snapshot.name,
				displayName: snapshot.name,
				state: snapshot.state,
				imageName: snapshot.imageName,
				cpu: snapshot.cpu,
				memory: snapshot.mem,
				disk: snapshot.disk,
				createdAt: snapshot.createdAt,
				errorReason: snapshot.errorReason,
			}));
		} catch (error) {
			console.error("Failed to list snapshots:", error);
			throw new Error(
				`Failed to list snapshots: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}),

	/**
	 * Create a new snapshot from a Docker image or declarative builder
	 */
	createSnapshot: publicProcedure
		.input(
			z.object({
				name: z
					.string()
					.min(1)
					.max(50)
					.regex(/^[a-zA-Z0-9-_]+$/),
				imageName: z.string().optional(),
				pythonVersion: z
					.enum(["3.9", "3.10", "3.11", "3.12", "3.13"])
					.default("3.12"),
				pipPackages: z.array(z.string()).optional(),
				aptPackages: z.array(z.string()).optional(),
				cpu: z.number().min(1).max(8).optional(),
				memory: z.number().min(1).max(16).optional(),
				disk: z.number().min(3).max(50).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();
			const snapshotName = `${SNAPSHOT_PREFIX}-${input.name}`;

			try {
				let imageParam: string | ReturnType<typeof Image.debianSlim>;

				if (input.imageName) {
					imageParam = input.imageName;
				} else {
					let image = Image.debianSlim(input.pythonVersion);

					if (input.aptPackages && input.aptPackages.length > 0) {
						image = image.runCommands(
							`apt-get update && apt-get install -y ${input.aptPackages.join(" ")}`,
						);
					}

					if (input.pipPackages && input.pipPackages.length > 0) {
						image = image.pipInstall(input.pipPackages);
					}

					image = image.workdir("/home/daytona");
					imageParam = image;
				}

				const snapshot = await daytona.snapshot.create(
					{
						name: snapshotName,
						image: imageParam,
						resources:
							input.cpu || input.memory || input.disk
								? {
										cpu: input.cpu,
										memory: input.memory,
										disk: input.disk,
									}
								: undefined,
					},
					{
						onLogs: (log: string) => {
							console.log("Snapshot build log:", log);
						},
					},
				);

				console.log("Snapshot created:", {
					snapshotId: snapshot.id,
					snapshotName: snapshot.name,
				});

				return {
					id: snapshot.id,
					name: snapshot.name,
					displayName: input.name,
					state: snapshot.state,
				};
			} catch (error) {
				console.error("Failed to create snapshot:", error);
				throw new Error(
					`Failed to create snapshot: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Copy volume data to /tmp in an existing sandbox
	 * This copies data from a mounted volume to /tmp/<volume_name> so Rill can access it
	 */
	copyVolumeToTmp: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				volumeName: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				const entry = await getOrConnectSandbox(input.sandboxId);

				const mountPath = `/home/daytona/${input.volumeName}`;
				const tmpPath = `/tmp/${input.volumeName}`;

				console.log(`Copying volume data from ${mountPath} to ${tmpPath}...`);

				// Copy volume data to /tmp
				const result = await entry.sandbox.process.executeCommand(
					`cp -r "${mountPath}" "${tmpPath}"`,
					undefined,
					undefined,
					300, // 5 minute timeout for large copies
				);

				if (result.exitCode !== 0) {
					throw new Error(`Copy failed: ${result.result}`);
				}

				console.log("Volume data copied to /tmp:", {
					sandboxId: input.sandboxId,
					volumeName: input.volumeName,
					tmpPath,
				});

				return {
					success: true,
					tmpPath,
				};
			} catch (error) {
				console.error("Failed to copy volume to /tmp:", error);
				throw new Error(
					`Failed to copy volume to /tmp: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),

	/**
	 * Delete a snapshot
	 */
	deleteSnapshot: publicProcedure
		.input(
			z.object({
				snapshotId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const daytona = getDaytonaClient();

			try {
				const result = await daytona.snapshot.list(1, 100);
				const snapshot = result.items.find((s) => s.id === input.snapshotId);

				if (!snapshot) {
					throw new Error("Snapshot not found");
				}

				await daytona.snapshot.delete(snapshot);

				console.log("Snapshot deleted:", input.snapshotId);

				return { success: true };
			} catch (error) {
				console.error("Failed to delete snapshot:", error);
				throw new Error(
					`Failed to delete snapshot: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}),
});
