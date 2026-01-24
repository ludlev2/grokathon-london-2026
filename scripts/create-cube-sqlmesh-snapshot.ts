/**
 * Script to create a Cube SQLMesh snapshot (Python runtime)
 * Run with: npx tsx scripts/create-cube-sqlmesh-snapshot.ts
 *
 * Creates a Debian Slim Python sandbox with:
 * - Python 3.12 on Debian Slim
 * - sqlmesh[snowflake], pandas, pyarrow, psycopg2-binary
 * - Connectivity to Cube SQL interface (localhost:15432)
 * - Connectivity to Cube REST API (localhost:4000)
 * - Schema file access at /home/daytona/cube/schema
 * - 4 vCPUs, 8GB memory, 20GB disk
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

const SNAPSHOT_NAME = "cube-sqlmesh";

async function main() {
  console.log("=== Creating Cube SQLMesh Snapshot ===\n");

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });

  // Check if snapshot already exists
  const snapshotResult = await daytona.snapshot.list(1, 100);
  const existingSnapshot = snapshotResult.items.find(
    (s) => s.name === SNAPSHOT_NAME
  );

  if (existingSnapshot) {
    console.log(`Snapshot already exists: ${existingSnapshot.name} — deleting to recreate...`);
    await daytona.snapshot.delete(existingSnapshot as any);
    console.log("  Deleted old snapshot.\n");
  }

  console.log(`Creating new snapshot: ${SNAPSHOT_NAME}`);
  console.log("This may take several minutes...\n");

  // Python 3.12 Debian Slim with Node.js + Cube server + SQLMesh + Snowflake
  const cubeSqlmeshImage = Image.debianSlim("3.12")
    // Install system dependencies + Node.js 22 (required by Cube)
    .runCommands(
      "apt-get update && apt-get install -y libpq-dev gcc curl git ca-certificates gnupg && mkdir -p /etc/apt/keyrings && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' > /etc/apt/sources.list.d/nodesource.list && apt-get update && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*"
    )
    // Install Cube server and Snowflake driver globally
    .runCommands(
      "npm install -g @cubejs-backend/server @cubejs-backend/snowflake-driver"
    )
    // Install Python packages for SQLMesh + Snowflake + Cube SQL/REST access
    .pipInstall([
      "sqlmesh[snowflake]",
      "pandas",
      "pyarrow",
      "psycopg2-binary",
      "requests",
    ])
    // Create directory structure for Cube schema files
    .runCommands("mkdir -p /home/daytona/cube/schema")
    .workdir("/home/daytona");

  // Create the snapshot with resources suitable for SQLMesh operations
  const snapshot = await daytona.snapshot.create(
    {
      name: SNAPSHOT_NAME,
      image: cubeSqlmeshImage,
      resources: {
        cpu: 3,
        memory: 5,
        disk: 5,
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
  console.log("\nUsage:");
  console.log(`  - Cube SQL interface: localhost:15432`);
  console.log(`  - Cube REST API: localhost:4000`);
  console.log(`  - Schema files: /home/daytona/cube/schema`);
}

main().catch((err) => {
  console.error("Failed to create snapshot:", err);
  process.exit(1);
});
