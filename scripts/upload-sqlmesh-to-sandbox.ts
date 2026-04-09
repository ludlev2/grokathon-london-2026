/**
 * Upload SQLMesh project files to a Daytona sandbox
 * npx tsx scripts/upload-sqlmesh-to-sandbox.ts
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

const SOURCE_DIR = "/Users/ad1thya_r/Documents/margin_monorepo/north_one_sqlmesh";
const REMOTE_DIR = "/home/daytona/sqlmesh_project";
const SANDBOX_ID = "5f939c80-b056-4385-ab50-41103868997c";

const EXCLUDE = [".git", ".DS_Store", "__pycache__", ".venv", ".cache", ".claude", "logs", ".sqlmesh", "north_one.duckdb", "node_modules", ".gitignore", "snowflake_rsa_key.pub", "seeds"];

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
  console.log("=== Upload SQLMesh to Sandbox ===\n");

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });
  const sandbox = await daytona.get(SANDBOX_ID);
  console.log(`Connected to sandbox: ${SANDBOX_ID}\n`);

  // Clean existing
  await sandbox.process.executeCommand(`rm -rf ${REMOTE_DIR}`);
  console.log("Cleaned existing directory.\n");

  const files = getFiles(SOURCE_DIR);
  console.log(`Files to upload: ${files.length}\n`);

  // Create all directories first
  await sandbox.fs.createFolder(REMOTE_DIR, "755").catch(() => {});
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
    console.log(`  mkdir: ${d}`);
  }

  // Upload files directly to their final paths, 5 at a time
  console.log("\nUploading files:");
  const BATCH_SIZE = 5;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (f) => {
        const dest = `${REMOTE_DIR}/${f.rel}`;
        const content = fs.readFileSync(f.full);
        await sandbox.fs.uploadFile(content, dest);
        console.log(`  [${files.indexOf(f) + 1}/${files.length}] ${f.rel} (${content.length}b)`);
      })
    );
    // Small delay between batches
    if (i + BATCH_SIZE < files.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Fix config.yaml - update private_key_path for sandbox
  console.log("\nPatching config.yaml...");
  const configContent = fs.readFileSync(path.join(SOURCE_DIR, "config.yaml"), "utf-8");
  const fixedConfig = configContent.replace(
    /private_key_path: .*/,
    `private_key_path: ${REMOTE_DIR}/snowflake_rsa_key.p8`
  );
  await sandbox.fs.uploadFile(Buffer.from(fixedConfig), `${REMOTE_DIR}/config.yaml`);
  console.log("  Updated private_key_path");

  // Set key permissions
  await sandbox.process.executeCommand(`chmod 600 ${REMOTE_DIR}/snowflake_rsa_key.p8`);
  console.log("  Set key permissions to 600");

  console.log("\nVerifying...");
  const res = await sandbox.process.executeCommand(`find ${REMOTE_DIR} -type f | sort`);
  console.log(res.result);

  console.log("\n=== Done ===");
  console.log(`Sandbox: ${SANDBOX_ID}`);
  console.log(`Path: ${REMOTE_DIR}`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
