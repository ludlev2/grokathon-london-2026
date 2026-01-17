import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronRight,
	File,
	Folder,
	FolderOpen,
	FolderPlus,
	HardDrive,
	Loader2,
	RefreshCw,
	Trash2,
	Upload,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc, trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/volumes")({
	component: VolumesComponent,
});

interface FileInfo {
	name: string;
	isDir: boolean;
	size: number;
	modTime: string;
}

interface VolumeSession {
	sandboxId: string;
	volumeId: string;
	volumeName: string;
	mountPath: string;
}

// Volume File Browser Component
function VolumeFileBrowser({
	session,
	onClose,
}: {
	session: VolumeSession;
	onClose: () => void;
}) {
	const [currentPath, setCurrentPath] = useState(session.mountPath);
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
		new Set([session.mountPath]),
	);
	const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const folderInputRef = useRef<HTMLInputElement>(null);

	// Fetch files for current directory
	const {
		data: files,
		isLoading: isLoadingFiles,
		refetch: refetchFiles,
	} = useQuery({
		...trpc.sandbox.listFiles.queryOptions({
			sandboxId: session.sandboxId,
			path: currentPath,
		}),
	});

	// Close session mutation
	const closeSession = useMutation({
		mutationFn: () =>
			trpcClient.sandbox.closeVolumeSession.mutate({
				sandboxId: session.sandboxId,
			}),
		onSuccess: () => {
			onClose();
		},
		onError: (error) => {
			console.error("Error closing session:", error.message);
			// Close anyway on the UI side
			onClose();
		},
	});

	// Upload file mutation
	const uploadFile = useMutation({
		mutationFn: (params: { path: string; content: string }) =>
			trpcClient.sandbox.uploadFile.mutate({
				sandboxId: session.sandboxId,
				...params,
			}),
		onSuccess: () => {
			refetchFiles();
		},
	});

	// Create folder mutation
	const createFolder = useMutation({
		mutationFn: (path: string) =>
			trpcClient.sandbox.createFolder.mutate({
				sandboxId: session.sandboxId,
				path,
			}),
		onSuccess: () => {
			refetchFiles();
		},
	});

	// Delete file mutation
	const deleteFile = useMutation({
		mutationFn: (path: string) =>
			trpcClient.sandbox.deleteFile.mutate({
				sandboxId: session.sandboxId,
				path,
			}),
		onSuccess: () => {
			refetchFiles();
		},
	});

	// Handle directory toggle
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

	// Handle file click
	const handleFileClick = useCallback(
		(file: FileInfo) => {
			const fullPath = `${currentPath}/${file.name}`;
			if (file.isDir) {
				toggleDir(fullPath);
			}
		},
		[currentPath, toggleDir],
	);

	// Navigate up
	const goUp = useCallback(() => {
		const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
		if (parent.startsWith(session.mountPath) || parent === session.mountPath) {
			setCurrentPath(parent);
		}
	}, [currentPath, session.mountPath]);

	// Handle file selection for upload
	const handleFileSelect = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const fileList = e.target.files;
			if (!fileList || fileList.length === 0) return;

			const filesToUpload = Array.from(fileList);
			const fileNames = filesToUpload.map((f) => f.name);
			setUploadingFiles(fileNames);

			try {
				for (const file of filesToUpload) {
					const content = await new Promise<string>((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => {
							const base64 = (reader.result as string).split(",")[1];
							resolve(base64);
						};
						reader.onerror = reject;
						reader.readAsDataURL(file);
					});

					// Get the path - use webkitRelativePath for folder uploads
					const relativePath =
						(file as File & { webkitRelativePath?: string })
							.webkitRelativePath || file.name;
					const uploadPath = `${currentPath}/${relativePath}`;

					await uploadFile.mutateAsync({ path: uploadPath, content });
				}
			} catch (error) {
				console.error("Upload error:", error);
			} finally {
				setUploadingFiles([]);
				e.target.value = "";
			}
		},
		[currentPath, uploadFile],
	);

	// Handle new folder creation
	const handleCreateFolder = useCallback(() => {
		const name = prompt("Enter folder name:");
		if (name?.trim()) {
			const folderPath = `${currentPath}/${name.trim()}`;
			createFolder.mutate(folderPath);
		}
	}, [currentPath, createFolder]);

	// Handle delete
	const handleDelete = useCallback(
		(file: FileInfo) => {
			const fullPath = `${currentPath}/${file.name}`;
			if (confirm(`Are you sure you want to delete "${file.name}"?`)) {
				deleteFile.mutate(fullPath);
			}
		},
		[currentPath, deleteFile],
	);

	// Handle close with confirmation
	const handleClose = useCallback(() => {
		closeSession.mutate();
	}, [closeSession]);

	const isUploading = uploadingFiles.length > 0;
	const relativePath = currentPath.replace(session.mountPath, "") || "/";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-lg border bg-background shadow-lg">
				{/* Header */}
				<div className="flex items-center justify-between border-b px-4 py-3">
					<div className="flex items-center gap-3">
						<HardDrive className="size-5 text-blue-500" />
						<div>
							<h2 className="font-semibold">{session.volumeName}</h2>
							<p className="text-muted-foreground text-xs">
								Files will persist after closing
							</p>
						</div>
					</div>
					<Button
						variant="default"
						size="sm"
						onClick={handleClose}
						disabled={closeSession.isPending || isUploading}
					>
						{closeSession.isPending ? (
							<Loader2 className="mr-2 size-4 animate-spin" />
						) : null}
						Done
					</Button>
				</div>

				{/* Toolbar */}
				<div className="flex items-center gap-2 border-b px-4 py-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => fileInputRef.current?.click()}
						disabled={isUploading}
					>
						<Upload className="mr-2 size-4" />
						Upload Files
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => folderInputRef.current?.click()}
						disabled={isUploading}
					>
						<Upload className="mr-2 size-4" />
						Upload Folder
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={handleCreateFolder}
						disabled={isUploading || createFolder.isPending}
					>
						<FolderPlus className="mr-2 size-4" />
						New Folder
					</Button>
					<div className="flex-1" />
					<Button
						variant="ghost"
						size="sm"
						onClick={() => refetchFiles()}
						disabled={isLoadingFiles}
					>
						<RefreshCw
							className={cn("size-4", isLoadingFiles && "animate-spin")}
						/>
					</Button>
				</div>

				{/* Path breadcrumb */}
				<div className="flex items-center gap-1 border-b bg-muted/30 px-4 py-2 text-sm">
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2"
						onClick={goUp}
						disabled={currentPath === session.mountPath}
					>
						..
					</Button>
					<HardDrive className="size-3 text-blue-500" />
					<span className="font-medium text-blue-600 dark:text-blue-400">
						{session.volumeName}
					</span>
					<span className="text-muted-foreground">{relativePath}</span>
				</div>

				{/* File list */}
				<div className="flex-1 overflow-auto">
					{isUploading && (
						<div className="border-b bg-blue-50 px-4 py-2 dark:bg-blue-950">
							<div className="flex items-center gap-2 text-blue-700 text-sm dark:text-blue-300">
								<Loader2 className="size-4 animate-spin" />
								Uploading {uploadingFiles.length} file(s)...
							</div>
						</div>
					)}

					{isLoadingFiles ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="size-6 animate-spin text-muted-foreground" />
						</div>
					) : files && files.length > 0 ? (
						<div className="divide-y">
							{files
								.sort((a, b) => {
									if (a.isDir && !b.isDir) return -1;
									if (!a.isDir && b.isDir) return 1;
									return a.name.localeCompare(b.name);
								})
								.map((file) => {
									const fullPath = `${currentPath}/${file.name}`;
									const isExpanded = expandedDirs.has(fullPath);

									return (
										<div
											key={file.name}
											className="flex items-center justify-between px-4 py-2 hover:bg-muted/50"
										>
											<button
												type="button"
												onClick={() => handleFileClick(file)}
												className="flex flex-1 items-center gap-2 text-left"
											>
												{file.isDir ? (
													<>
														{isExpanded ? (
															<ChevronDown className="size-4 text-muted-foreground" />
														) : (
															<ChevronRight className="size-4 text-muted-foreground" />
														)}
														{isExpanded ? (
															<FolderOpen className="size-4 text-yellow-500" />
														) : (
															<Folder className="size-4 text-yellow-500" />
														)}
													</>
												) : (
													<>
														<span className="w-4" />
														<File className="size-4 text-muted-foreground" />
													</>
												)}
												<span className="truncate">{file.name}</span>
											</button>
											<div className="flex items-center gap-2">
												{!file.isDir && (
													<span className="text-muted-foreground text-xs">
														{formatFileSize(file.size)}
													</span>
												)}
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleDelete(file)}
													disabled={deleteFile.isPending}
													className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
												>
													<Trash2 className="size-3" />
												</Button>
											</div>
										</div>
									);
								})}
						</div>
					) : (
						<div className="py-12 text-center text-muted-foreground">
							<Folder className="mx-auto mb-3 size-8 opacity-50" />
							<p className="text-sm">Empty folder</p>
							<p className="mt-1 text-xs">
								Upload files or create a new folder
							</p>
						</div>
					)}
				</div>

				{/* Hidden file inputs */}
				<input
					ref={fileInputRef}
					type="file"
					multiple
					className="hidden"
					onChange={handleFileSelect}
				/>
				<input
					ref={folderInputRef}
					type="file"
					multiple
					// @ts-expect-error webkitdirectory is not in the type definition
					webkitdirectory=""
					className="hidden"
					onChange={handleFileSelect}
				/>
			</div>
		</div>
	);
}

// Format file size helper
function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function VolumesComponent() {
	const [activeSession, setActiveSession] = useState<VolumeSession | null>(
		null,
	);

	// Query for listing volumes
	const {
		data: volumes,
		refetch: refetchVolumes,
		isLoading: isLoadingVolumes,
	} = useQuery(trpc.sandbox.listVolumes.queryOptions());

	// Create volume session mutation
	const createSession = useMutation({
		mutationFn: (volumeId: string) =>
			trpcClient.sandbox.createVolumeSession.mutate({ volumeId }),
		onSuccess: (result) => {
			setActiveSession(result);
		},
		onError: (error) => {
			console.error("Error creating session:", error.message);
		},
	});

	// Handle open volume for file management
	const handleOpenVolume = useCallback(
		(volumeId: string) => {
			createSession.mutate(volumeId);
		},
		[createSession],
	);

	// Handle close session
	const handleCloseSession = useCallback(() => {
		setActiveSession(null);
	}, []);

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-3">
					<HardDrive className="size-5" />
					<h1 className="font-semibold text-lg">Volumes</h1>
					{volumes && (
						<span className="text-muted-foreground text-sm">
							{volumes.length} volume{volumes.length !== 1 ? "s" : ""}
						</span>
					)}
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => refetchVolumes()}
					disabled={isLoadingVolumes}
				>
					<RefreshCw
						className={cn("size-4", isLoadingVolumes && "animate-spin")}
					/>
				</Button>
			</div>

			{/* Main content */}
			<div className="flex-1 overflow-auto p-4">
				<div className="mx-auto max-w-2xl space-y-4">
					{/* Volume list */}
					<div className="rounded-lg border">
						<div className="border-b bg-muted/30 px-4 py-2">
							<h2 className="font-medium text-sm">Your Volumes</h2>
						</div>

						{isLoadingVolumes ? (
							<div className="flex items-center justify-center py-12">
								<Loader2 className="size-6 animate-spin text-muted-foreground" />
							</div>
						) : volumes && volumes.length > 0 ? (
							<div className="divide-y">
								{volumes.map((volume) => (
									<div
										key={volume.id}
										className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-muted/50"
										onClick={() => handleOpenVolume(volume.id)}
									>
										<div className="flex items-center gap-3">
											<HardDrive className="size-5 text-blue-500" />
											<div>
												<div className="font-medium">{volume.displayName}</div>
												<div className="font-mono text-muted-foreground text-xs">
													{volume.id}
												</div>
											</div>
										</div>
										<div className="flex items-center gap-2 text-muted-foreground text-sm">
											<span>Click to browse files</span>
											{createSession.isPending && (
												<Loader2 className="size-4 animate-spin" />
											)}
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="py-12 text-center text-muted-foreground">
								<HardDrive className="mx-auto mb-3 size-8 opacity-50" />
								<p className="text-sm">No volumes found</p>
								<p className="mt-1 text-xs">
									Volumes created in Daytona will appear here
								</p>
							</div>
						)}
					</div>

					{/* Info section */}
					<div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
						<h3 className="mb-2 font-medium text-sm">About Volumes</h3>
						<ul className="space-y-1 text-muted-foreground text-sm">
							<li>
								Volumes provide persistent storage that can be shared across
								sandboxes
							</li>
							<li>Click on a volume to browse and manage its files</li>
							<li>Files in volumes persist even when sandboxes are deleted</li>
							<li>
								Mount volumes when creating sandboxes to access shared data
							</li>
						</ul>
					</div>
				</div>
			</div>

			{/* Volume File Browser Modal */}
			{activeSession && (
				<VolumeFileBrowser
					session={activeSession}
					onClose={handleCloseSession}
				/>
			)}
		</div>
	);
}
