/**
 * Script to create a Cube snapshot with Node.js and Cube dependencies
 * Run with: npx tsx scripts/create-cube-snapshot.ts
 *
 * Creates a snapshot with:
 * - Node.js 22 (required by Cube)
 * - Cube server and Snowflake driver
 * - 2 vCPUs, 3GB memory, 5GB disk
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

const SNAPSHOT_NAME = "cube-snowflake";

async function main() {
  console.log("=== Creating Cube Snapshot ===\n");

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
    console.log(
      `  CPU: ${existingSnapshot.cpu}, Memory: ${existingSnapshot.mem}, Disk: ${existingSnapshot.disk}`
    );
    return;
  }

  console.log(`Creating new snapshot: ${SNAPSHOT_NAME}`);
  console.log("This may take several minutes...\n");

  // Create a Node.js based image for Cube
  // Using debian slim with Node.js 22 (required by Cube package.json)
  const cubeImage = Image.base("node:22-slim")
    // Install necessary build tools for native dependencies
    .runCommands(
      "apt-get update && apt-get install -y python3 make g++ curl git && rm -rf /var/lib/apt/lists/*"
    )
    // Install Cube CLI and server dependencies globally
    .runCommands("npm install -g cubejs-cli @cubejs-backend/server @cubejs-backend/server-core @cubejs-backend/snowflake-driver")
    .workdir("/home/daytona");

  // Create the snapshot with specified resources
  const snapshot = await daytona.snapshot.create(
    {
      name: SNAPSHOT_NAME,
      image: cubeImage,
      resources: {
        cpu: 2,
        memory: 3, // 3GB
        disk: 5, // 5GB
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
  console.log(
    `  CPU: ${snapshot.cpu}, Memory: ${snapshot.mem}, Disk: ${snapshot.disk}`
  );
}

main().catch((err) => {
  console.error("Failed to create snapshot:", err);
  process.exit(1);
});
