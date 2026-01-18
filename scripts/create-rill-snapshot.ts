/**
 * Script to create a Rill snapshot with more resources
 * Run with: npx tsx scripts/create-rill-snapshot.ts
 *
 * Based on the existing rill-duckdb snapshot (1 CPU, 1GB, 3GB disk)
 * but with upgraded resources: 4 CPU, 8GB memory, 20GB disk
 */

import { config } from "dotenv";
config({ path: "./apps/server/.env" });

import {
  Daytona,
  Image,
} from "../node_modules/.pnpm/@daytonaio+sdk@0.130.0_ws@8.19.0/node_modules/@daytonaio/sdk/src/index.js";

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
if (!DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY not found in environment");
  process.exit(1);
}

// New snapshot name - same config as rill-duckdb but with more resources
const SNAPSHOT_NAME = "rill-duckdb-large";

async function main() {
  console.log("=== Creating Rill Snapshot with More Resources ===\n");

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });

  // Check if snapshot already exists
  const snapshotResult = await daytona.snapshot.list(1, 100);
  const existingSnapshot = snapshotResult.items.find(
    (s) => s.name === SNAPSHOT_NAME
  );

  if (existingSnapshot) {
    console.log(`Snapshot already exists: ${existingSnapshot.name}`);
    console.log(`  ID: ${existingSnapshot.id}`);
    console.log(`  State: ${existingSnapshot.state}`);
    console.log(`  CPU: ${existingSnapshot.cpu}, Memory: ${existingSnapshot.mem}, Disk: ${existingSnapshot.disk}`);
    return;
  }

  console.log(`Creating new snapshot: ${SNAPSHOT_NAME}`);
  console.log("This may take several minutes...\n");

  // Same image configuration as the existing rill-duckdb snapshot
  // from margin's setup-rill-volume.ts
  const rillImage = Image.debianSlim("3.12")
    .pipInstall(["duckdb", "pandas", "pyarrow"])
    // Install curl, git, and unzip (Rill requires git at runtime)
    .runCommands("apt-get update && apt-get install -y curl unzip git")
    // Download and install Rill directly from GitHub releases (non-interactive)
    .runCommands(
      "curl -sL https://github.com/rilldata/rill/releases/download/v0.78.2/rill_linux_amd64.zip -o /tmp/rill.zip && unzip -o /tmp/rill.zip -d /usr/local/bin && chmod +x /usr/local/bin/rill && rm /tmp/rill.zip"
    )
    .workdir("/home/daytona");

  // Create the snapshot with upgraded resources
  const snapshot = await daytona.snapshot.create(
    {
      name: SNAPSHOT_NAME,
      image: rillImage,
      resources: {
        cpu: 4,
        memory: 8, // 8GB (was 1GB)
        disk: 10,  // 10GB (was 3GB)
      },
    },
    {
      onLogs: (log: string) => process.stdout.write(log),
    }
  );

  console.log("\n=== Snapshot Created Successfully ===");
  console.log(`  ID: ${snapshot.id}`);
  console.log(`  Name: ${snapshot.name}`);
  console.log(`  State: ${snapshot.state}`);
  console.log(`  CPU: ${snapshot.cpu}, Memory: ${snapshot.mem}, Disk: ${snapshot.disk}`);
}

main().catch((err) => {
  console.error("Failed to create snapshot:", err);
  process.exit(1);
});
