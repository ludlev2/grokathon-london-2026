/**
 * Upload Cube project files to a Daytona sandbox
 * npx tsx scripts/upload-cube-to-volume.ts
 *
 * Uploads all files flat, then organizes into subdirectories
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "dotenv";
config({ path: "./apps/server/.env" });

import { Daytona } from "../node_modules/.pnpm/@daytonaio+sdk@0.130.0_ws@8.19.0/node_modules/@daytonaio/sdk/src/index.js";

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
if (!DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY not found");
  process.exit(1);
}

const SOURCE_DIR = "/Users/ad1thya_r/Documents/margin_monorepo/north_one_cube";
const SNAPSHOT_NAME = "cube-snowflake";
const REMOTE_DIR = "/home/daytona/cube-project";
const EXISTING_SANDBOX_ID = process.env.CUBE_SANDBOX_ID || "";

const EXCLUDE = [".git", ".DS_Store", "node_modules", ".env", ".env.example", ".cubestore", ".claude", "package-lock.json", "docs", "scripts"];

function getFiles(dir: string, base: string = dir): { rel: string; full: string; name: string }[] {
  const files: { rel: string; full: string; name: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      files.push(...getFiles(full, base));
    } else {
      files.push({ rel, full, name: entry.name });
    }
  }
  return files;
}

async function main() {
  console.log("=== Upload Cube to Sandbox ===\n");

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });
  let sandbox: Awaited<ReturnType<typeof daytona.create>>;

  if (EXISTING_SANDBOX_ID) {
    console.log(`Connecting to sandbox: ${EXISTING_SANDBOX_ID}`);
    try {
      sandbox = await daytona.get(EXISTING_SANDBOX_ID);
      console.log("Connected!\n");
    } catch {
      console.log("Not found, creating new...\n");
      sandbox = null as any;
    }
  }

  if (!sandbox) {
    console.log(`Creating sandbox (${SNAPSHOT_NAME})...`);
    sandbox = await daytona.create({ snapshot: SNAPSHOT_NAME }, { timeout: 60 });
    console.log(`Created: ${sandbox.id}`);
    console.log(`\n>>> Add to .env: CUBE_SANDBOX_ID=${sandbox.id}\n`);
  }

  const files = getFiles(SOURCE_DIR);
  console.log(`Files to upload: ${files.length}\n`);

  // Create base dir
  await sandbox.fs.createFolder(REMOTE_DIR, "755").catch(() => {});

  // Step 1: Upload ALL files flat to root
  console.log("Uploading files flat to root:");
  for (const f of files) {
    const flatDest = `${REMOTE_DIR}/${f.name}`;
    const content = fs.readFileSync(f.full);
    const start = Date.now();
    await sandbox.fs.uploadFile(content, flatDest);
    const ms = Date.now() - start;
    console.log(`  ${f.name} (${content.length} bytes, ${ms}ms)`);
  }

  // Step 2: Create subdirectories
  console.log("\nCreating subdirectories...");
  const dirs = new Set<string>();
  for (const f of files) {
    const d = path.dirname(f.rel);
    if (d && d !== ".") {
      let cur = "";
      for (const p of d.split("/")) {
        cur = cur ? `${cur}/${p}` : p;
        dirs.add(cur);
      }
    }
  }
  for (const d of Array.from(dirs).sort()) {
    await sandbox.fs.createFolder(`${REMOTE_DIR}/${d}`, "755").catch(() => {});
    console.log(`  Created: ${d}`);
  }

  // Step 3: Move files to correct locations
  console.log("\nOrganizing files:");
  for (const f of files) {
    const d = path.dirname(f.rel);
    if (d && d !== ".") {
      const src = `${REMOTE_DIR}/${f.name}`;
      const dest = `${REMOTE_DIR}/${f.rel}`;
      await sandbox.fs.moveFiles(src, dest);
      console.log(`  ${f.name} -> ${f.rel}`);
    }
  }

  console.log("\nVerifying...");
  const res = await sandbox.process.executeCommand(`find ${REMOTE_DIR} -type f`);
  console.log(res.result);

  console.log("\n=== Done ===");
  console.log(`Sandbox: ${sandbox.id}`);
  console.log(`Path: ${REMOTE_DIR}`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
