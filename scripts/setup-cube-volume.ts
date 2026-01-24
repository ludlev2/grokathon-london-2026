/**
 * Script to create a Daytona volume and upload Cube project files
 * Run with: npx tsx scripts/setup-cube-volume.ts
 *
 * This script:
 * 1. Creates a Daytona volume for Cube project files
 * 2. Creates a sandbox with the cube-snowflake snapshot
 * 3. Uploads all Cube project files (schemas, config, etc.)
 * 4. Installs npm dependencies
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "dotenv";
config({ path: "./apps/server/.env" });

import { Daytona } from "../node_modules/.pnpm/@daytonaio+sdk@0.130.0_ws@8.19.0/node_modules/@daytonaio/sdk/src/index.js";

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
if (!DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY not found in environment");
  process.exit(1);
}

// Configuration
const CUBE_PROJECT_PATH =
  "/Users/ad1thya_r/Documents/margin_monorepo/north_one_cube";
const VOLUME_NAME = "cube-northone";
const SNAPSHOT_NAME = "cube-snowflake";
const MOUNT_PATH = "/home/daytona/cube-project";

// Files/directories to exclude from upload
const EXCLUDE_PATTERNS = [
  ".git",
  ".DS_Store",
  "__pycache__",
  "node_modules",
  ".env", // Exclude env file with credentials
  ".env.example",
  ".cubestore",
  ".claude",
  "logs",
  "tmp",
  "package-lock.json",
];

function shouldExclude(name: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => {
    if (pattern.startsWith("*")) {
      return name.endsWith(pattern.slice(1));
    }
    return name === pattern;
  });
}

interface FileToUpload {
  relativePath: string;
  fullPath: string;
}

function getAllFiles(
  dirPath: string,
  basePath: string = dirPath
): FileToUpload[] {
  const files: FileToUpload[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      console.log(`  Skipping: ${entry.name}`);
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(basePath, fullPath);

    if (entry.isDirectory()) {
      const subFiles = getAllFiles(fullPath, basePath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push({ relativePath, fullPath });
    }
  }

  return files;
}

function getUniqueDirectories(files: FileToUpload[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const dir = path.dirname(file.relativePath);
    if (dir && dir !== ".") {
      // Add all parent directories too
      const parts = dir.split("/");
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        dirs.add(current);
      }
    }
  }
  return Array.from(dirs).sort();
}

async function main() {
  console.log("=== Cube Volume Setup Script ===\n");

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });

  // Step 1: Check if snapshot exists
  console.log(`1. Checking for snapshot: ${SNAPSHOT_NAME}`);
  const snapshotResult = await daytona.snapshot.list(1, 100);
  const existingSnapshot = snapshotResult.items.find(
    (s) => s.name === SNAPSHOT_NAME
  );

  if (!existingSnapshot) {
    console.error(
      `   Snapshot '${SNAPSHOT_NAME}' not found. Run create-cube-snapshot.ts first.`
    );
    process.exit(1);
  }
  console.log(`   Found snapshot: ${existingSnapshot.id}`);

  // Step 2: Create or get the volume
  console.log(`\n2. Creating volume: ${VOLUME_NAME}`);
  let volume: Awaited<ReturnType<typeof daytona.volume.create>>;

  const volumes = await daytona.volume.list();
  const existing = volumes.find((v) => v.name === VOLUME_NAME);

  if (existing) {
    console.log(`   Volume already exists: ${existing.id}`);
    volume = existing;
  } else {
    volume = await daytona.volume.create(VOLUME_NAME);
    console.log(`   Created volume: ${volume.id}`);
  }

  // Wait for volume to be ready
  console.log("\n   Waiting for volume to be ready...");
  let volumeReady = false;
  for (let i = 0; i < 30; i++) {
    const vols = await daytona.volume.list();
    const v = vols.find((vol) => vol.id === volume.id);
    if (v?.state === "ready") {
      console.log("   Volume is ready!");
      volumeReady = true;
      break;
    }
    console.log(`   Volume state: ${v?.state || "unknown"}, waiting...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!volumeReady) {
    console.error("Volume did not become ready in time");
    process.exit(1);
  }

  // Step 3: Create a sandbox with the volume mounted
  console.log("\n3. Creating sandbox with volume mounted...");
  const sandbox = await daytona.create(
    {
      snapshot: SNAPSHOT_NAME,
      volumes: [
        {
          volumeId: volume.id,
          mountPath: MOUNT_PATH,
        },
      ],
    },
    {
      timeout: 0,
      onSnapshotCreateLogs: (log: string) => process.stdout.write(log),
    }
  );
  console.log(`   Created sandbox: ${sandbox.id}`);

  // Step 4: Check if files need to be uploaded
  console.log("\n4. Checking volume contents...");
  let needsUpload = true;
  try {
    const existingFiles = await sandbox.fs.listFiles(MOUNT_PATH);
    if (existingFiles.length > 0) {
      console.log(
        `   Volume already has ${existingFiles.length} files/directories`
      );
      needsUpload = false;
    }
  } catch {
    console.log("   Volume is empty, will upload files");
  }

  if (needsUpload) {
    // Collect all project files
    console.log("\n5. Collecting project files...");
    const files = getAllFiles(CUBE_PROJECT_PATH);
    console.log(`   Found ${files.length} files to upload`);

    // Create all directories first
    console.log("\n6. Creating directories...");
    const directories = getUniqueDirectories(files);
    console.log(`   Creating ${directories.length} directories...`);

    for (const dir of directories) {
      const remoteDirPath = `${MOUNT_PATH}/${dir}`;
      try {
        await sandbox.fs.createFolder(remoteDirPath, "755");
        console.log(`   Created: ${dir}`);
      } catch {
        // Directory might already exist
      }
    }

    // Upload all files
    console.log("\n7. Uploading files to volume...");

    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
      const remotePath = `${MOUNT_PATH}/${file.relativePath}`;
      try {
        await sandbox.fs.uploadFile(file.fullPath, remotePath);
        console.log(`   Uploaded: ${file.relativePath}`);
        successCount++;
      } catch (error) {
        console.error(`   Failed to upload ${file.relativePath}:`, error);
        failCount++;
      }
    }

    console.log(
      `\n   Upload complete: ${successCount} succeeded, ${failCount} failed`
    );
  }

  // Verify the files
  console.log("\n8. Verifying uploaded files...");
  try {
    const rootFiles = await sandbox.fs.listFiles(MOUNT_PATH);
    console.log("   Files in volume root:");
    for (const f of rootFiles) {
      console.log(`     ${f.isDir ? "[DIR]" : "[FILE]"} ${f.name}`);
    }
  } catch (error) {
    console.error("   Failed to list files:", error);
  }

  // Step 9: Install npm dependencies
  console.log("\n9. Installing npm dependencies...");
  try {
    const npmInstall = await sandbox.process.executeCommand(
      `cd ${MOUNT_PATH} && npm install`,
      { timeout: 300000 } // 5 minute timeout for npm install
    );
    console.log(`   npm install output:\n${npmInstall.result || "(no output)"}`);
  } catch (error) {
    console.error("   Failed to run npm install:", error);
  }

  // Test the environment
  console.log("\n10. Testing sandbox environment...");
  try {
    const nodeVersion = await sandbox.process.executeCommand("node --version");
    console.log(`   Node version: ${nodeVersion.result?.trim() || "unknown"}`);

    const npmVersion = await sandbox.process.executeCommand("npm --version");
    console.log(`   npm version: ${npmVersion.result?.trim() || "unknown"}`);

    // Check if cubejs-cli is available
    const cubeCheck = await sandbox.process.executeCommand(
      "cubejs --version 2>&1 || echo 'NOT INSTALLED'"
    );
    console.log(`   Cube CLI: ${cubeCheck.result?.trim() || "unknown"}`);

    // Check package.json
    const pkgCheck = await sandbox.process.executeCommand(
      `cat ${MOUNT_PATH}/package.json 2>&1 || echo 'NOT FOUND'`
    );
    console.log(`   package.json:\n${pkgCheck.result || "(not found)"}`);
  } catch (error) {
    console.error("   Failed to test environment:", error);
  }

  // Clean up - delete the sandbox but keep the volume
  console.log("\n11. Cleaning up sandbox...");
  try {
    await sandbox.delete();
    console.log("   Sandbox deleted (volume persists)");
  } catch (error) {
    console.error("   Failed to delete sandbox:", error);
  }

  // Summary
  console.log("\n=== Setup Complete ===");
  console.log(`\nVolume ID: ${volume.id}`);
  console.log(`Volume Name: ${volume.name}`);
  console.log(`Snapshot: ${SNAPSHOT_NAME}`);
  console.log(`Mount Path: ${MOUNT_PATH}`);
  console.log("\nTo use this volume in a sandbox:");
  console.log(`  - Use snapshot: ${SNAPSHOT_NAME}`);
  console.log(`  - Mount volume ${volume.id} at ${MOUNT_PATH}`);
  console.log(`  - Run: cd ${MOUNT_PATH} && npm run dev`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
