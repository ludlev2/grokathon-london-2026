import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import CodeMirror from "@uiw/react-codemirror";
import {
	Archive,
	Box,
	Check,
	ChevronDown,
	ChevronRight,
	Code,
	Database,
	File,
	Folder,
	FolderOpen,
	HardDrive,
	Loader2,
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightClose,
	PanelRightOpen,
	Play,
	Plus,
	Power,
	RefreshCw,
	Send,
	Snowflake,
	Square,
	Terminal,
	Trash2,
	Unplug,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { trpc, trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/sandbox")({
	component: SandboxComponent,
});

type Language = "typescript" | "python" | "javascript";
type InputMode = "code" | "terminal";

interface SandboxInfo {
	sandboxId: string;
	state?: string;
	connected: boolean;
}

interface FileInfo {
	name: string;
	isDir: boolean;
	size: number;
	modTime: string;
}

interface TerminalHistoryEntry {
	command: string;
	output: string;
	exitCode: number;
}

function getStateColor(state: string | undefined): string {
	switch (state) {
		case "started":
			return "text-green-500";
		case "starting":
			return "text-yellow-500";
		case "stopped":
		case "stopping":
			return "text-orange-500";
		case "archived":
		case "archiving":
			return "text-blue-500";
		case "error":
			return "text-red-500";
		default:
			return "text-muted-foreground";
	}
}

function getStateLabel(state: string | undefined): string {
	switch (state) {
		case "started":
			return "Running";
		case "starting":
			return "Starting";
		case "stopped":
			return "Stopped";
		case "stopping":
			return "Stopping";
		case "archived":
			return "Archived";
		case "archiving":
			return "Archiving";
		case "error":
			return "Error";
		default:
			return state ?? "Unknown";
	}
}

// Get file extension for syntax highlighting
function getFileExtension(filename: string): string {
	const parts = filename.split(".");
	return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

// Get CodeMirror language extension based on file extension
function getLanguageExtension(filename: string) {
	const ext = getFileExtension(filename);
	switch (ext) {
		case "js":
		case "jsx":
		case "ts":
		case "tsx":
			return javascript({ jsx: true, typescript: ext.includes("t") });
		case "py":
			return python();
		case "sql":
			return sql();
		case "yaml":
		case "yml":
			return yaml();
		default:
			return [];
	}
}

// Check if a path is inside a mounted volume
function isVolumePath(path: string): boolean {
	return path.startsWith("/home/daytona/");
}

// Extract volume name from path
function getVolumeNameFromPath(path: string): string | null {
	const match = path.match(/^\/home\/daytona\/volume\/([^/]+)/);
	return match ? match[1] : null;
}

// File Browser Component
function FileBrowser({
	sandboxId,
	onFileSelect,
	selectedPath,
}: {
	sandboxId: string | null;
	onFileSelect: (path: string) => void;
	selectedPath: string | null;
}) {
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
		new Set(["/home/daytona"]),
	);
	const [currentPath, setCurrentPath] = useState("/home/daytona");

	// Check if currently in a volume path
	const inVolume = isVolumePath(currentPath);
	const currentVolumeName = getVolumeNameFromPath(currentPath);

	// Fetch files for the current directory
	const {
		data: files,
		isLoading,
		refetch,
	} = useQuery({
		...trpc.sandbox.listFiles.queryOptions({
			sandboxId: sandboxId ?? "",
			path: currentPath,
		}),
		enabled: !!sandboxId,
	});

	const toggleDir = useCallback((path: string) => {
		setExpandedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
		setCurrentPath(path);
	}, []);

	const handleFileClick = useCallback(
		(file: FileInfo) => {
			const fullPath = `${currentPath}/${file.name}`;
			if (file.isDir) {
				toggleDir(fullPath);
			} else {
				onFileSelect(fullPath);
			}
		},
		[currentPath, onFileSelect, toggleDir],
	);

	// Navigate up
	const goUp = useCallback(() => {
		const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
		setCurrentPath(parent);
	}, [currentPath]);

	if (!sandboxId) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-muted-foreground text-sm">
				Connect to a sandbox to browse files
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{/* Path breadcrumb */}
			<div className="flex items-center gap-1 border-b px-2 py-1.5 text-xs">
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-1"
					onClick={goUp}
					disabled={currentPath === "/"}
				>
					..
				</Button>
				{inVolume ? (
					<div className="flex min-w-0 flex-1 items-center gap-1.5">
						<HardDrive className="size-3 shrink-0 text-blue-500" />
						<span className="truncate font-medium text-blue-600 dark:text-blue-400">
							{currentVolumeName}
						</span>
						<span className="truncate text-muted-foreground">
							{currentPath.replace(
								`/home/daytona/${currentVolumeName}`,
								"",
							) || "/"}
						</span>
					</div>
				) : (
					<span className="truncate text-muted-foreground">{currentPath}</span>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto h-6 w-6 shrink-0 p-0"
					onClick={() => refetch()}
				>
					<RefreshCw className="size-3" />
				</Button>
			</div>

			{/* File list */}
			<div className="flex-1 overflow-auto">
				{isLoading ? (
					<div className="flex items-center justify-center p-4">
						<Loader2 className="size-4 animate-spin" />
					</div>
				) : files && files.length > 0 ? (
					<div className="py-1">
						{files
							.sort((a, b) => {
								// Directories first, then alphabetically
								if (a.isDir && !b.isDir) return -1;
								if (!a.isDir && b.isDir) return 1;
								return a.name.localeCompare(b.name);
							})
							.map((file) => {
								const fullPath = `${currentPath}/${file.name}`;
								const isSelected = selectedPath === fullPath;
								const isExpanded = expandedDirs.has(fullPath);
								// Check if this is a volume folder (inside /home/daytona/)
								const isVolumeFolder =
									file.isDir && currentPath === "/home/daytona/volume";
								// Check if this is the "volume" folder itself
								const isVolumesDir =
									file.isDir &&
									file.name === "volume" &&
									currentPath === "/home/daytona";

								return (
									<button
										key={file.name}
										type="button"
										onClick={() => handleFileClick(file)}
										className={cn(
											"flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted/50",
											isSelected && "bg-muted",
											isVolumeFolder &&
												"bg-blue-50/50 hover:bg-blue-100/50 dark:bg-blue-950/30 dark:hover:bg-blue-900/30",
										)}
									>
										{file.isDir ? (
											<>
												{isExpanded ? (
													<ChevronDown className="size-3 text-muted-foreground" />
												) : (
													<ChevronRight className="size-3 text-muted-foreground" />
												)}
												{isVolumeFolder || isVolumesDir ? (
													<HardDrive
														className={cn(
															"size-4",
															isVolumeFolder
																? "text-blue-500"
																: "text-muted-foreground",
														)}
													/>
												) : isExpanded ? (
													<FolderOpen className="size-4 text-yellow-500" />
												) : (
													<Folder className="size-4 text-yellow-500" />
												)}
											</>
										) : (
											<>
												<span className="w-3" />
												<File className="size-4 text-muted-foreground" />
											</>
										)}
										<span
											className={cn(
												"truncate",
												isVolumeFolder &&
													"font-medium text-blue-600 dark:text-blue-400",
											)}
										>
											{file.name}
										</span>
									</button>
								);
							})}
					</div>
				) : (
					<div className="p-4 text-center text-muted-foreground text-sm">
						Empty directory
					</div>
				)}
			</div>
		</div>
	);
}

function SandboxComponent() {
	const [code, setCode] = useState(`# Write your code here
print("Hello from Daytona sandbox!")
`);
	const [output, setOutput] = useState("");
	const [language, setLanguage] = useState<Language>("python");
	const [selectedSandboxId, setSelectedSandboxId] = useState<string | null>(
		null,
	);
	const [inputMode, setInputMode] = useState<InputMode>("code");
	const [terminalInput, setTerminalInput] = useState("");
	const [terminalHistory, setTerminalHistory] = useState<
		TerminalHistoryEntry[]
	>([]);
	const [commandHistoryIndex, setCommandHistoryIndex] = useState(-1);
	const [showOutput, setShowOutput] = useState(true);
	const [showFileBrowser, setShowFileBrowser] = useState(true);
	const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
	const [fileContent, setFileContent] = useState<string | null>(null);
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [selectedVolumeIds, setSelectedVolumeIds] = useState<string[]>([]);
	const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
		null,
	);
	const [copyVolumesToTmp, setCopyVolumesToTmp] = useState(false);
	const [selectedSnowflakeConnectionId, setSelectedSnowflakeConnectionId] = useState<string | null>(null);
	const [sandboxCpu, setSandboxCpu] = useState<number>(4);
	const [sandboxMemory, setSandboxMemory] = useState<number>(8);
	const [sandboxDisk, setSandboxDisk] = useState<number>(20);
	const terminalInputRef = useRef<HTMLInputElement>(null);
	const terminalEndRef = useRef<HTMLDivElement>(null);

	// Query for listing sandboxes from Daytona
	const {
		data: sandboxes,
		refetch: refetchSandboxes,
		isLoading: isLoadingSandboxes,
	} = useQuery(trpc.sandbox.list.queryOptions());

	// Query for listing volumes
	const { data: volumes, isLoading: isLoadingVolumes } = useQuery(
		trpc.sandbox.listVolumes.queryOptions(),
	);

	// Query for listing snapshots
	const { data: snapshots, isLoading: isLoadingSnapshots } = useQuery(
		trpc.sandbox.listSnapshots.queryOptions(),
	);

	// Query for listing Snowflake connections
	const { data: snowflakeConnections, isLoading: isLoadingSnowflakeConnections } = useQuery(
		trpc.snowflake.list.queryOptions(),
	);

	// Filter to only show active snapshots
	const activeSnapshots = snapshots?.filter((s) => s.state === "active") ?? [];

	// Find the currently selected sandbox
	const selectedSandbox = sandboxes?.find(
		(s) => s.sandboxId === selectedSandboxId,
	);

	// Query for reading file content
	const { data: fileData, isLoading: isLoadingFile } = useQuery({
		...trpc.sandbox.readFile.queryOptions({
			sandboxId: selectedSandboxId ?? "",
			path: selectedFilePath ?? "",
		}),
		enabled: !!selectedSandboxId && !!selectedFilePath,
	});

	// Update file content when data loads
	useEffect(() => {
		if (fileData?.content) {
			setFileContent(fileData.content);
		}
	}, [fileData]);

	// Create sandbox mutation
	const createSandbox = useMutation({
		mutationFn: ({
			lang,
			volumeIds,
			snapshotId,
			copyToTmp,
			snowflakeConnectionId,
			cpu,
			memory,
			disk,
		}: {
			lang: Language;
			volumeIds: string[];
			snapshotId: string | null;
			copyToTmp: boolean;
			snowflakeConnectionId: string | null;
			cpu?: number;
			memory?: number;
			disk?: number;
		}) => {
			// Build volume mounts with /home/daytona/<volume_name> paths
			const volumeMounts = volumeIds
				.map((volumeId) => {
					const volume = volumes?.find((v) => v.id === volumeId);
					if (!volume) return null;
					return {
						volumeId,
						mountPath: `/home/daytona/${volume.displayName}`,
					};
				})
				.filter(Boolean) as { volumeId: string; mountPath: string }[];

			return trpcClient.sandbox.create.mutate({
				language: lang,
				volumes: volumeMounts.length > 0 ? volumeMounts : undefined,
				snapshotId: snapshotId ?? undefined,
				copyVolumesToTmp: copyToTmp && volumeMounts.length > 0 ? true : undefined,
				snowflakeConnectionId: snowflakeConnectionId ?? undefined,
				cpu,
				memory,
				disk,
			});
		},
		onSuccess: (result, variables) => {
			refetchSandboxes();
			setSelectedSandboxId(result.sandboxId);
			setShowCreateDialog(false);
			setSelectedVolumeIds([]);
			setSelectedSnapshotId(null);
			setCopyVolumesToTmp(false);
			setSelectedSnowflakeConnectionId(null);
			const volumeInfo =
				variables.copyToTmp && variables.volumeIds.length > 0
					? ` with volume data copied to /tmp (no mount)`
					: result.volumes && result.volumes.length > 0
						? ` with ${result.volumes.length} volume(s) mounted`
						: "";
			const snapshotInfo = result.snapshotId ? " from snapshot" : "";
			const snowflakeInfo = variables.snowflakeConnectionId ? " with Snowflake .env" : "";
			setOutput(`Sandbox created and connected${snapshotInfo}${volumeInfo}${snowflakeInfo}.\n`);
		},
		onError: (error) => {
			setOutput(`Error creating sandbox: ${error.message}\n`);
		},
	});

	// Select/connect to sandbox mutation
	const selectSandbox = useMutation({
		mutationFn: (sandboxId: string) =>
			trpcClient.sandbox.select.mutate({ sandboxId }),
		onSuccess: (result) => {
			refetchSandboxes();
			setSelectedSandboxId(result.sandboxId);
			setOutput(`Connected to sandbox (state: ${result.state}).\n`);
		},
		onError: (error) => {
			setOutput(`Error connecting to sandbox: ${error.message}\n`);
		},
	});

	// Execute code mutation
	const executeCode = useMutation({
		mutationFn: ({
			sandboxId,
			codeToRun,
		}: {
			sandboxId: string;
			codeToRun: string;
		}) => trpcClient.sandbox.executeCode.mutate({ sandboxId, code: codeToRun }),
		onSuccess: (result) => {
			setOutput((prev) => {
				const exitInfo =
					result.exitCode !== 0 ? `[Exit code: ${result.exitCode}]\n` : "";
				return `${prev}${exitInfo}${result.result}\n`;
			});
		},
		onError: (error) => {
			setOutput((prev) => `${prev}Error: ${error.message}\n`);
			refetchSandboxes();
		},
	});

	// Execute command mutation
	const executeCommand = useMutation({
		mutationFn: ({
			sandboxId,
			command,
		}: {
			sandboxId: string;
			command: string;
		}) =>
			trpcClient.sandbox.executeCommand.mutate({
				sandboxId,
				command,
				timeout: 600000, // 10 minutes for long-running commands like sqlmesh plan
			}),
		onSuccess: (result, variables) => {
			setTerminalHistory((prev) => [
				...prev,
				{
					command: variables.command,
					output: result.result,
					exitCode: result.exitCode,
				},
			]);
			setTimeout(() => {
				terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
			}, 50);
		},
		onError: (error, variables) => {
			setTerminalHistory((prev) => [
				...prev,
				{
					command: variables.command,
					output: `Error: ${error.message}`,
					exitCode: 1,
				},
			]);
			refetchSandboxes();
		},
	});

	// Delete sandbox mutation
	const deleteSandbox = useMutation({
		mutationFn: (sandboxId: string) =>
			trpcClient.sandbox.delete.mutate({ sandboxId }),
		onSuccess: () => {
			setSelectedSandboxId(null);
			refetchSandboxes();
			setOutput("Sandbox deleted.\n");
			setTerminalHistory([]);
			setSelectedFilePath(null);
			setFileContent(null);
		},
		onError: (error) => {
			setOutput((prev) => `${prev}Error deleting sandbox: ${error.message}\n`);
		},
	});

	// Disconnect mutation
	const disconnectSandbox = useMutation({
		mutationFn: (sandboxId: string) =>
			trpcClient.sandbox.disconnect.mutate({ sandboxId }),
		onSuccess: () => {
			setSelectedSandboxId(null);
			refetchSandboxes();
			setOutput("Disconnected from sandbox.\n");
			setSelectedFilePath(null);
			setFileContent(null);
		},
		onError: (error) => {
			setOutput((prev) => `${prev}Error disconnecting: ${error.message}\n`);
		},
	});

	// Stop sandbox mutation
	const stopSandbox = useMutation({
		mutationFn: (sandboxId: string) =>
			trpcClient.sandbox.stop.mutate({ sandboxId }),
		onSuccess: () => {
			refetchSandboxes();
			setOutput("Sandbox stopped.\n");
		},
		onError: (error) => {
			setOutput((prev) => `${prev}Error stopping sandbox: ${error.message}\n`);
		},
	});

	// Start sandbox mutation
	const startSandbox = useMutation({
		mutationFn: (sandboxId: string) =>
			trpcClient.sandbox.start.mutate({ sandboxId }),
		onSuccess: () => {
			refetchSandboxes();
			setOutput("Sandbox started and connected.\n");
		},
		onError: (error) => {
			setOutput((prev) => `${prev}Error starting sandbox: ${error.message}\n`);
		},
	});

	// Archive sandbox mutation
	const archiveSandbox = useMutation({
		mutationFn: (sandboxId: string) =>
			trpcClient.sandbox.archive.mutate({ sandboxId }),
		onSuccess: () => {
			refetchSandboxes();
			setOutput("Sandbox archived.\n");
		},
		onError: (error) => {
			setOutput((prev) => `${prev}Error archiving sandbox: ${error.message}\n`);
		},
	});

	const handleRun = useCallback(() => {
		if (!selectedSandbox) {
			setOutput("No sandbox selected. Please select or create one first.\n");
			return;
		}
		executeCode.mutate({
			sandboxId: selectedSandbox.sandboxId,
			codeToRun: code,
		});
	}, [selectedSandbox, code, executeCode]);

	const handleTerminalSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			const command = terminalInput.trim();
			if (!command || !selectedSandbox) return;

			executeCommand.mutate({
				sandboxId: selectedSandbox.sandboxId,
				command,
			});
			setTerminalInput("");
			setCommandHistoryIndex(-1);
		},
		[selectedSandbox, terminalInput, executeCommand],
	);

	const handleTerminalKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			const commands = terminalHistory.map((h) => h.command);
			if (e.key === "ArrowUp") {
				e.preventDefault();
				const newIndex = Math.min(commandHistoryIndex + 1, commands.length - 1);
				setCommandHistoryIndex(newIndex);
				if (commands.length > 0 && newIndex >= 0) {
					setTerminalInput(commands[commands.length - 1 - newIndex]);
				}
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				const newIndex = Math.max(commandHistoryIndex - 1, -1);
				setCommandHistoryIndex(newIndex);
				if (newIndex >= 0) {
					setTerminalInput(commands[commands.length - 1 - newIndex]);
				} else {
					setTerminalInput("");
				}
			}
		},
		[terminalHistory, commandHistoryIndex],
	);

	const handleCreateSandbox = useCallback(() => {
		createSandbox.mutate({
			lang: language,
			volumeIds: selectedVolumeIds,
			snapshotId: selectedSnapshotId,
			copyToTmp: copyVolumesToTmp,
			snowflakeConnectionId: selectedSnowflakeConnectionId,
			cpu: sandboxCpu,
			memory: sandboxMemory,
			disk: sandboxDisk,
		});
	}, [createSandbox, language, selectedVolumeIds, selectedSnapshotId, copyVolumesToTmp, selectedSnowflakeConnectionId, sandboxCpu, sandboxMemory, sandboxDisk]);

	const handleToggleVolume = useCallback((volumeId: string) => {
		setSelectedVolumeIds((prev) =>
			prev.includes(volumeId)
				? prev.filter((id) => id !== volumeId)
				: [...prev, volumeId],
		);
	}, []);

	const handleSelectSandbox = useCallback(
		(sandbox: SandboxInfo) => {
			// Just set the selected sandbox - commands will auto-connect on the backend
			setSelectedSandboxId(sandbox.sandboxId);
		},
		[],
	);

	const handleDeleteSandbox = useCallback(() => {
		if (selectedSandbox) {
			deleteSandbox.mutate(selectedSandbox.sandboxId);
		}
	}, [selectedSandbox, deleteSandbox]);

	const handleDisconnect = useCallback(() => {
		if (selectedSandbox) {
			disconnectSandbox.mutate(selectedSandbox.sandboxId);
		}
	}, [selectedSandbox, disconnectSandbox]);

	const handleStopSandbox = useCallback(() => {
		if (selectedSandbox) {
			stopSandbox.mutate(selectedSandbox.sandboxId);
		}
	}, [selectedSandbox, stopSandbox]);

	const handleStartSandbox = useCallback(() => {
		if (selectedSandbox) {
			startSandbox.mutate(selectedSandbox.sandboxId);
		}
	}, [selectedSandbox, startSandbox]);

	const handleArchiveSandbox = useCallback(() => {
		if (selectedSandbox) {
			archiveSandbox.mutate(selectedSandbox.sandboxId);
		}
	}, [selectedSandbox, archiveSandbox]);

	// Handle file selection from browser
	const handleFileSelect = useCallback((path: string) => {
		setSelectedFilePath(path);
		setInputMode("code");
	}, []);

	const isLoading =
		createSandbox.isPending ||
		selectSandbox.isPending ||
		executeCode.isPending ||
		executeCommand.isPending ||
		deleteSandbox.isPending ||
		disconnectSandbox.isPending ||
		stopSandbox.isPending ||
		startSandbox.isPending ||
		archiveSandbox.isPending;

	const canRun =
		selectedSandbox?.connected && !isLoading && inputMode === "code";
	const canStop =
		selectedSandbox &&
		(selectedSandbox.state === "started" ||
			selectedSandbox.state === "starting") &&
		!isLoading;
	const canStart =
		selectedSandbox &&
		(selectedSandbox.state === "stopped" ||
			selectedSandbox.state === "archived") &&
		!isLoading;
	const canArchive =
		selectedSandbox && selectedSandbox.state === "stopped" && !isLoading;

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center justify-between border-b px-4 py-2">
				<div className="flex items-center gap-3">
					<h1 className="font-semibold">Sandbox</h1>

					{/* Sandbox selector dropdown */}
					<DropdownMenu>
						<DropdownMenuTrigger
							className="inline-flex min-w-[180px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
							disabled={isLoading}
						>
							{isLoadingSandboxes ? (
								<span className="text-muted-foreground">Loading...</span>
							) : selectedSandbox ? (
								<span className="flex items-center gap-2">
									<span
										className={`size-2 rounded-full ${selectedSandbox.connected ? "bg-green-500" : "bg-gray-400"}`}
									/>
									<span className="font-mono text-xs">
										{selectedSandbox.sandboxId.slice(0, 8)}...
									</span>
									<span
										className={`text-xs ${getStateColor(selectedSandbox.state)}`}
									>
										({getStateLabel(selectedSandbox.state)})
									</span>
								</span>
							) : (
								<span className="text-muted-foreground text-xs">
									Select sandbox...
								</span>
							)}
							<ChevronDown className="ml-2 size-4" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-[280px]">
							{sandboxes && sandboxes.length > 0 ? (
								<>
									{sandboxes.map((sandbox) => (
										<DropdownMenuItem
											key={sandbox.sandboxId}
											onClick={() => handleSelectSandbox(sandbox)}
											className="flex items-center justify-between"
										>
											<span className="flex items-center gap-2">
												<span
													className={`size-2 rounded-full ${sandbox.connected ? "bg-green-500" : "bg-gray-400"}`}
												/>
												<span className="font-mono text-xs">
													{sandbox.sandboxId.slice(0, 16)}...
												</span>
											</span>
											<span className="flex items-center gap-2">
												<span
													className={`text-xs ${getStateColor(sandbox.state)}`}
												>
													{getStateLabel(sandbox.state)}
												</span>
												{sandbox.sandboxId === selectedSandboxId && (
													<Check className="size-4" />
												)}
											</span>
										</DropdownMenuItem>
									))}
									<DropdownMenuSeparator />
								</>
							) : (
								<div className="px-2 py-1.5 text-muted-foreground text-sm">
									No sandboxes found
								</div>
							)}

							<DropdownMenuItem
								onClick={() => setShowCreateDialog(true)}
								disabled={createSandbox.isPending}
							>
								<Plus className="mr-2 size-4" />
								Create new...
							</DropdownMenuItem>

							<DropdownMenuItem
								onClick={() => refetchSandboxes()}
								disabled={isLoadingSandboxes}
							>
								<RefreshCw className="mr-2 size-4" />
								Refresh list
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{/* Language selector */}
					<select
						value={language}
						onChange={(e) => setLanguage(e.target.value as Language)}
						disabled={!!selectedSandbox || isLoading}
						className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
					>
						<option value="python">Python</option>
						<option value="typescript">TypeScript</option>
						<option value="javascript">JavaScript</option>
					</select>
				</div>

				<div className="flex items-center gap-2">
					{selectedSandbox && (
						<>
							{canStart && (
								<Button
									variant="outline"
									size="sm"
									onClick={handleStartSandbox}
									disabled={isLoading}
									title="Start sandbox"
								>
									{startSandbox.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Power className="size-4" />
									)}
								</Button>
							)}

							{canStop && (
								<Button
									variant="outline"
									size="sm"
									onClick={handleStopSandbox}
									disabled={isLoading}
									title="Stop sandbox"
								>
									{stopSandbox.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Square className="size-4" />
									)}
								</Button>
							)}

							{canArchive && (
								<Button
									variant="outline"
									size="sm"
									onClick={handleArchiveSandbox}
									disabled={isLoading}
									title="Archive sandbox"
								>
									{archiveSandbox.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Archive className="size-4" />
									)}
								</Button>
							)}

							<Button
								variant="outline"
								size="sm"
								onClick={handleDisconnect}
								disabled={isLoading}
								title="Disconnect"
							>
								{disconnectSandbox.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Unplug className="size-4" />
								)}
							</Button>

							<Button
								variant="outline"
								size="sm"
								onClick={handleDeleteSandbox}
								disabled={isLoading}
								title="Delete sandbox"
								className="text-destructive hover:text-destructive"
							>
								{deleteSandbox.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Trash2 className="size-4" />
								)}
							</Button>
						</>
					)}

					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowFileBrowser(!showFileBrowser)}
						title={showFileBrowser ? "Hide files" : "Show files"}
					>
						{showFileBrowser ? (
							<PanelLeftClose className="size-4" />
						) : (
							<PanelLeftOpen className="size-4" />
						)}
					</Button>

					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowOutput(!showOutput)}
						title={showOutput ? "Hide output" : "Show output"}
					>
						{showOutput ? (
							<PanelRightClose className="size-4" />
						) : (
							<PanelRightOpen className="size-4" />
						)}
					</Button>

					{inputMode === "code" && (
						<Button size="sm" onClick={handleRun} disabled={!canRun}>
							{executeCode.isPending ? (
								<Loader2 className="mr-2 size-4 animate-spin" />
							) : (
								<Play className="mr-2 size-4" />
							)}
							Run
						</Button>
					)}
				</div>
			</div>

			{/* Main content - three panel layout */}
			<div className="flex flex-1 overflow-hidden">
				{/* Left panel - File Browser */}
				{showFileBrowser && (
					<div className="w-64 border-r">
						<FileBrowser
							sandboxId={selectedSandbox?.connected ? selectedSandboxId : null}
							onFileSelect={handleFileSelect}
							selectedPath={selectedFilePath}
						/>
					</div>
				)}

				{/* Center panel - Code editor or Terminal */}
				<div className="flex flex-1 flex-col">
					{/* Tab switcher */}
					<div className="flex items-center border-b bg-muted/30">
						<button
							type="button"
							onClick={() => setInputMode("code")}
							className={cn(
								"flex items-center gap-2 px-4 py-2 text-sm transition-colors",
								inputMode === "code"
									? "border-primary border-b-2 bg-background text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<Code className="size-4" />
							{selectedFilePath ? selectedFilePath.split("/").pop() : "Editor"}
						</button>
						<button
							type="button"
							onClick={() => {
								setInputMode("terminal");
								setTimeout(() => terminalInputRef.current?.focus(), 50);
							}}
							className={cn(
								"flex items-center gap-2 px-4 py-2 text-sm transition-colors",
								inputMode === "terminal"
									? "border-primary border-b-2 bg-background text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<Terminal className="size-4" />
							Terminal
						</button>
					</div>

					{/* Content based on mode */}
					{inputMode === "code" ? (
						<div className="flex-1 overflow-auto">
							{selectedFilePath && fileContent !== null ? (
								isLoadingFile ? (
									<div className="flex h-full items-center justify-center">
										<Loader2 className="size-6 animate-spin" />
									</div>
								) : (
									<CodeMirror
										value={fileContent}
										height="100%"
										extensions={[getLanguageExtension(selectedFilePath)]}
										editable={false}
										basicSetup={{
											lineNumbers: true,
											highlightActiveLineGutter: false,
											highlightActiveLine: false,
											foldGutter: true,
											syntaxHighlighting: true,
										}}
										className="h-full text-sm"
									/>
								)
							) : (
								<CodeMirror
									value={code}
									height="100%"
									extensions={[
										language === "python"
											? python()
											: javascript({
													jsx: true,
													typescript: language === "typescript",
												}),
									]}
									onChange={(value: string) => setCode(value)}
									basicSetup={{
										lineNumbers: true,
										highlightActiveLineGutter: true,
										highlightActiveLine: true,
										foldGutter: true,
										syntaxHighlighting: true,
									}}
									className="h-full text-sm"
								/>
							)}
						</div>
					) : (
						<div className="flex flex-1 flex-col bg-zinc-950 text-zinc-100">
							<div className="flex-1 overflow-auto p-4 font-mono text-sm">
								{terminalHistory.length === 0 ? (
									<div className="text-zinc-500">
										{selectedSandbox?.connected
											? "Type a command and press Enter..."
											: "Connect to a sandbox to use the terminal."}
									</div>
								) : (
									terminalHistory.map((entry, index) => (
										<div key={`${entry.command}-${index}`} className="mb-3">
											<div className="flex items-center gap-2 text-green-400">
												<span>$</span>
												<span>{entry.command}</span>
											</div>
											{entry.output && (
												<pre
													className={cn(
														"mt-1 whitespace-pre-wrap",
														entry.exitCode !== 0 && "text-red-400",
													)}
												>
													{entry.output}
												</pre>
											)}
										</div>
									))
								)}
								<div ref={terminalEndRef} />
							</div>

							<form
								onSubmit={handleTerminalSubmit}
								className="flex items-center gap-2 border-zinc-800 border-t px-4 py-2"
							>
								<span className="text-green-400">$</span>
								<input
									ref={terminalInputRef}
									type="text"
									value={terminalInput}
									onChange={(e) => setTerminalInput(e.target.value)}
									onKeyDown={handleTerminalKeyDown}
									disabled={!selectedSandbox?.connected || isLoading}
									className="flex-1 bg-transparent font-mono text-sm focus:outline-none disabled:opacity-50"
									placeholder={
										selectedSandbox?.connected
											? "Enter command..."
											: "Connect to a sandbox first"
									}
									autoComplete="off"
									spellCheck={false}
								/>
								<Button
									type="submit"
									size="sm"
									variant="ghost"
									disabled={
										!selectedSandbox?.connected ||
										!terminalInput.trim() ||
										isLoading
									}
									className="text-zinc-400 hover:text-zinc-100"
								>
									{executeCommand.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Send className="size-4" />
									)}
								</Button>
							</form>
						</div>
					)}
				</div>

				{/* Right panel - Output */}
				{showOutput && (
					<div className="flex w-80 flex-col border-l">
						<div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
							<span className="text-muted-foreground text-sm">Output</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setOutput("")}
								className="h-6 px-2 text-xs"
							>
								Clear
							</Button>
						</div>
						<pre className="flex-1 overflow-auto whitespace-pre-wrap bg-background p-4 font-mono text-sm">
							{output || "Output will appear here..."}
						</pre>
					</div>
				)}
			</div>

			{/* Create Sandbox Dialog */}
			{showCreateDialog && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
						<div className="mb-4 flex items-center justify-between">
							<h2 className="font-semibold text-lg">Create New Sandbox</h2>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setShowCreateDialog(false);
									setSelectedVolumeIds([]);
									setSelectedSnapshotId(null);
									setCopyVolumesToTmp(false);
									setSelectedSnowflakeConnectionId(null);
								}}
								className="h-8 w-8 p-0"
							>
								<X className="size-4" />
							</Button>
						</div>

						{/* Snapshot selection */}
						<div className="mb-4">
							<label className="mb-2 block font-medium text-sm">
								Snapshot (optional)
							</label>
							<p className="mb-2 text-muted-foreground text-xs">
								Use a snapshot for faster startup with pre-installed packages
							</p>
							{isLoadingSnapshots ? (
								<div className="flex items-center justify-center py-4">
									<Loader2 className="size-5 animate-spin text-muted-foreground" />
								</div>
							) : activeSnapshots.length > 0 ? (
								<div className="max-h-32 space-y-2 overflow-auto rounded-md border p-2">
									{/* No snapshot option */}
									<button
										type="button"
										onClick={() => setSelectedSnapshotId(null)}
										className={cn(
											"flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
											selectedSnapshotId === null
												? "bg-primary/10 ring-1 ring-primary"
												: "hover:bg-muted",
										)}
									>
										<div
											className={cn(
												"flex size-4 shrink-0 items-center justify-center rounded-full border",
												selectedSnapshotId === null
													? "border-primary bg-primary"
													: "border-muted-foreground/30",
											)}
										>
											{selectedSnapshotId === null && (
												<div className="size-2 rounded-full bg-primary-foreground" />
											)}
										</div>
										<span className="text-muted-foreground">
											Default (no snapshot)
										</span>
									</button>
									{activeSnapshots.map((snapshot) => {
										const isSelected = selectedSnapshotId === snapshot.id;
										return (
											<button
												key={snapshot.id}
												type="button"
												onClick={() => setSelectedSnapshotId(snapshot.id)}
												className={cn(
													"flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
													isSelected
														? "bg-primary/10 ring-1 ring-primary"
														: "hover:bg-muted",
												)}
											>
												<div
													className={cn(
														"flex size-4 shrink-0 items-center justify-center rounded-full border",
														isSelected
															? "border-primary bg-primary"
															: "border-muted-foreground/30",
													)}
												>
													{isSelected && (
														<div className="size-2 rounded-full bg-primary-foreground" />
													)}
												</div>
												<Box className="size-4 text-muted-foreground" />
												<div className="min-w-0 flex-1">
													<div className="truncate font-medium">
														{snapshot.displayName}
													</div>
													{snapshot.imageName && (
														<div className="truncate text-muted-foreground text-xs">
															{snapshot.imageName}
														</div>
													)}
												</div>
											</button>
										);
									})}
								</div>
							) : (
								<div className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-sm">
									<Box className="mx-auto mb-1 size-5 opacity-50" />
									<p className="text-xs">No active snapshots available</p>
								</div>
							)}
						</div>

						{/* Language selection */}
						<div className="mb-4">
							<label className="mb-2 block font-medium text-sm">Runtime</label>
							<select
								value={language}
								onChange={(e) => setLanguage(e.target.value as Language)}
								className="w-full rounded-md border bg-background px-3 py-2 text-sm"
							>
								<option value="python">Python</option>
								<option value="typescript">TypeScript</option>
								<option value="javascript">JavaScript</option>
							</select>
						</div>

						{/* Resource configuration */}
						<div className="mb-4">
							<label className="mb-2 block font-medium text-sm">Resources</label>
							<div className="grid grid-cols-3 gap-3">
								<div>
									<label className="mb-1 block text-muted-foreground text-xs">CPU (cores)</label>
									<input
										type="number"
										min={1}
										value={sandboxCpu}
										onChange={(e) => setSandboxCpu(Number(e.target.value) || 1)}
										className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
									/>
								</div>
								<div>
									<label className="mb-1 block text-muted-foreground text-xs">Memory (GB)</label>
									<input
										type="number"
										min={1}
										value={sandboxMemory}
										onChange={(e) => setSandboxMemory(Number(e.target.value) || 1)}
										className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
									/>
								</div>
								<div>
									<label className="mb-1 block text-muted-foreground text-xs">Disk (GB)</label>
									<input
										type="number"
										min={1}
										value={sandboxDisk}
										onChange={(e) => setSandboxDisk(Number(e.target.value) || 1)}
										className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
									/>
								</div>
							</div>
						</div>

						{/* Volume selection */}
						<div className="mb-6">
							<label className="mb-2 block font-medium text-sm">
								Mount Volumes (optional)
							</label>
							{isLoadingVolumes ? (
								<div className="flex items-center justify-center py-4">
									<Loader2 className="size-5 animate-spin text-muted-foreground" />
								</div>
							) : volumes && volumes.length > 0 ? (
								<div className="max-h-32 space-y-2 overflow-auto rounded-md border p-2">
									{volumes.map((volume) => {
										const isSelected = selectedVolumeIds.includes(volume.id);
										return (
											<button
												key={volume.id}
												type="button"
												onClick={() => handleToggleVolume(volume.id)}
												className={cn(
													"flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
													isSelected
														? "bg-primary/10 ring-1 ring-primary"
														: "hover:bg-muted",
												)}
											>
												<div
													className={cn(
														"flex size-5 shrink-0 items-center justify-center rounded border",
														isSelected
															? "border-primary bg-primary text-primary-foreground"
															: "border-muted-foreground/30",
													)}
												>
													{isSelected && <Check className="size-3" />}
												</div>
												<HardDrive className="size-4 text-muted-foreground" />
												<div className="min-w-0 flex-1">
													<div className="truncate font-medium">
														{volume.displayName}
													</div>
													<div className="truncate text-muted-foreground text-xs">
														/home/daytona/{volume.displayName}
													</div>
												</div>
											</button>
										);
									})}
								</div>
							) : (
								<div className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-sm">
									<HardDrive className="mx-auto mb-1 size-5 opacity-50" />
									<p className="text-xs">No volumes available</p>
								</div>
							)}
							{selectedVolumeIds.length > 0 && (
								<>
									<p className="mt-2 text-muted-foreground text-xs">
										{selectedVolumeIds.length} volume(s) selected
									</p>
									{/* Copy to /tmp option */}
									<button
										type="button"
										onClick={() => setCopyVolumesToTmp(!copyVolumesToTmp)}
										className={cn(
											"mt-3 flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
											copyVolumesToTmp
												? "border-primary bg-primary/10"
												: "hover:bg-muted",
										)}
									>
										<div
											className={cn(
												"flex size-5 shrink-0 items-center justify-center rounded border",
												copyVolumesToTmp
													? "border-primary bg-primary text-primary-foreground"
													: "border-muted-foreground/30",
											)}
										>
											{copyVolumesToTmp && <Check className="size-3" />}
										</div>
										<div className="min-w-0 flex-1">
											<div className="font-medium">Copy to /tmp (for Rill)</div>
											<div className="text-muted-foreground text-xs">
												Copy volume data to /tmp without mounting. Required for Rill dashboards.
											</div>
										</div>
									</button>

									{/* Snowflake Connection selector - only show when copyVolumesToTmp is enabled */}
									{copyVolumesToTmp && (
										<div className="mt-3">
											<label className="mb-2 block font-medium text-sm">
												Snowflake Connection (for Rill .env)
											</label>
											{isLoadingSnowflakeConnections ? (
												<div className="flex items-center justify-center py-2">
													<Loader2 className="size-4 animate-spin text-muted-foreground" />
												</div>
											) : snowflakeConnections && snowflakeConnections.length > 0 ? (
												<div className="max-h-32 space-y-2 overflow-auto rounded-md border p-2">
													{/* No connection option */}
													<button
														type="button"
														onClick={() => setSelectedSnowflakeConnectionId(null)}
														className={cn(
															"flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
															selectedSnowflakeConnectionId === null
																? "bg-primary/10 ring-1 ring-primary"
																: "hover:bg-muted",
														)}
													>
														<div
															className={cn(
																"flex size-4 shrink-0 items-center justify-center rounded-full border",
																selectedSnowflakeConnectionId === null
																	? "border-primary bg-primary"
																	: "border-muted-foreground/30",
															)}
														>
															{selectedSnowflakeConnectionId === null && (
																<div className="size-2 rounded-full bg-primary-foreground" />
															)}
														</div>
														<span className="text-muted-foreground">
															No Snowflake connection
														</span>
													</button>
													{snowflakeConnections.map((conn) => {
														const isSelected = selectedSnowflakeConnectionId === conn.id;
														return (
															<button
																key={conn.id}
																type="button"
																onClick={() => setSelectedSnowflakeConnectionId(conn.id)}
																className={cn(
																	"flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
																	isSelected
																		? "bg-primary/10 ring-1 ring-primary"
																		: "hover:bg-muted",
																)}
															>
																<div
																	className={cn(
																		"flex size-4 shrink-0 items-center justify-center rounded-full border",
																		isSelected
																			? "border-primary bg-primary"
																			: "border-muted-foreground/30",
																	)}
																>
																	{isSelected && (
																		<div className="size-2 rounded-full bg-primary-foreground" />
																	)}
																</div>
																<Snowflake className="size-4 text-blue-500" />
																<div className="min-w-0 flex-1">
																	<div className="truncate font-medium">{conn.name}</div>
																	<div className="truncate text-muted-foreground text-xs">
																		{conn.database}/{conn.schema}
																	</div>
																</div>
															</button>
														);
													})}
												</div>
											) : (
												<div className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-sm">
													<Database className="mx-auto mb-1 size-5 opacity-50" />
													<p className="text-xs">No Snowflake connections configured</p>
												</div>
											)}
										</div>
									)}
								</>
							)}
						</div>

						{/* Actions */}
						<div className="flex justify-end gap-2">
							<Button
								variant="outline"
								onClick={() => {
									setShowCreateDialog(false);
									setSelectedVolumeIds([]);
									setSelectedSnapshotId(null);
									setCopyVolumesToTmp(false);
									setSelectedSnowflakeConnectionId(null);
								}}
							>
								Cancel
							</Button>
							<Button
								onClick={handleCreateSandbox}
								disabled={createSandbox.isPending}
							>
								{createSandbox.isPending ? (
									<Loader2 className="mr-2 size-4 animate-spin" />
								) : (
									<Plus className="mr-2 size-4" />
								)}
								Create Sandbox
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
