import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Box,
	CheckCircle,
	Clock,
	Cpu,
	HardDrive,
	Loader2,
	MemoryStick,
	Package,
	RefreshCw,
	XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/snapshots")({
	component: SnapshotsComponent,
});

function SnapshotsComponent() {
	// Fetch snapshots
	const {
		data: snapshots,
		isLoading,
		refetch,
	} = useQuery({
		...trpc.sandbox.listSnapshots.queryOptions(),
	});

	const getStateIcon = (state: string) => {
		switch (state) {
			case "active":
				return <CheckCircle className="h-4 w-4 text-green-500" />;
			case "pending":
			case "pulling":
			case "building":
				return <Clock className="h-4 w-4 text-yellow-500" />;
			case "error":
			case "build_failed":
				return <XCircle className="h-4 w-4 text-red-500" />;
			default:
				return <Clock className="h-4 w-4 text-muted-foreground" />;
		}
	};

	const getStateBadgeColor = (state: string) => {
		switch (state) {
			case "active":
				return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
			case "pending":
			case "pulling":
			case "building":
				return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
			case "error":
			case "build_failed":
				return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
			default:
				return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400";
		}
	};

	return (
		<div className="container mx-auto p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="font-bold text-2xl">Snapshots</h1>
					<p className="text-muted-foreground">
						Pre-configured sandbox templates with installed dependencies
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={() => refetch()}>
					<RefreshCw className="mr-2 h-4 w-4" />
					Refresh
				</Button>
			</div>

			{/* Snapshots List */}
			{isLoading ? (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : !snapshots || snapshots.length === 0 ? (
				<div className="rounded-lg border border-dashed p-12 text-center">
					<Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
					<h3 className="mb-2 font-medium text-lg">No snapshots found</h3>
					<p className="text-muted-foreground">
						Snapshots created in Daytona will appear here.
						<br />
						Use snapshots when creating sandboxes for faster startup with
						pre-installed packages.
					</p>
				</div>
			) : (
				<div className="grid gap-4">
					{snapshots.map((snapshot) => (
						<div
							key={snapshot.id}
							className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
						>
							<div className="flex items-start justify-between">
								<div className="flex items-start gap-3">
									<div className="rounded-lg bg-muted p-2">
										<Box className="h-5 w-5" />
									</div>
									<div>
										<div className="flex items-center gap-2">
											<h3 className="font-medium">{snapshot.displayName}</h3>
											<span
												className={cn(
													"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
													getStateBadgeColor(snapshot.state),
												)}
											>
												{getStateIcon(snapshot.state)}
												{snapshot.state}
											</span>
										</div>
										<p className="font-mono text-muted-foreground text-sm">
											{snapshot.name}
										</p>
										{snapshot.imageName && (
											<p className="mt-1 text-muted-foreground text-xs">
												Image: {snapshot.imageName}
											</p>
										)}
										{snapshot.errorReason && (
											<p className="mt-1 text-destructive text-xs">
												Error: {snapshot.errorReason}
											</p>
										)}
									</div>
								</div>

								{/* Resources */}
								<div className="flex items-center gap-3 text-muted-foreground text-sm">
									{snapshot.cpu && (
										<div className="flex items-center gap-1">
											<Cpu className="h-3.5 w-3.5" />
											<span>{snapshot.cpu} vCPU</span>
										</div>
									)}
									{snapshot.memory && (
										<div className="flex items-center gap-1">
											<MemoryStick className="h-3.5 w-3.5" />
											<span>{snapshot.memory} GB</span>
										</div>
									)}
									{snapshot.disk && (
										<div className="flex items-center gap-1">
											<HardDrive className="h-3.5 w-3.5" />
											<span>{snapshot.disk} GB</span>
										</div>
									)}
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
