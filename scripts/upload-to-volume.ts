import * as fs from "fs";
import * as path from "path";

const API_URL = "http://localhost:3000/trpc";
const SOURCE_DIR = "/Users/ad1thya_r/Documents/PointSwitch-GigaRepo/north_one";
const VOLUME_NAME = "rill-northone-test-2";

// Patterns to exclude
const EXCLUDE_PATTERNS = [
  /\/\.git\//,
  /\/\.DS_Store$/,
  /\/__pycache__\//,
  /\/logs\//,
  /\.pem$/,
  /\/tmp\//,
  /\/tmp$/,
  /\/\.env$/,
  /^\.env$/,
];

function shouldExclude(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function getAllFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (shouldExclude(fullPath) || shouldExclude(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

async function trpcMutation(procedure: string, input: unknown) {
  const res = await fetch(`${API_URL}/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data.result.data;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Use existing volume that was just created
  const volume = {
    id: "cf264ed1-06ba-46f3-981a-d6eba96161d0",
    name: "grok-vol-rill-northone-test-2",
    displayName: "rill-northone-test-2",
  };
  console.log("Using existing volume:", volume);

  // 2. Wait for volume to be ready and create session
  console.log("Waiting for volume to be ready...");
  let session: { sandboxId: string; mountPath: string } | null = null;
  for (let i = 0; i < 30; i++) {
    try {
      session = await trpcMutation("sandbox.createVolumeSession", {
        volumeId: volume.id,
      });
      break;
    } catch (e) {
      console.log(`Volume not ready yet, waiting... (attempt ${i + 1}/30)`);
      await sleep(2000);
    }
  }

  if (!session) {
    throw new Error("Volume never became ready");
  }
  console.log("Volume session created:", session);

  // 3. Get all files to upload
  const files = getAllFiles(SOURCE_DIR);
  console.log(`Found ${files.length} files to upload`);

  // 4. Upload each file
  let uploaded = 0;
  let failed = 0;

  for (const relativePath of files) {
    const sourcePath = path.join(SOURCE_DIR, relativePath);
    const targetPath = path.join(session.mountPath, relativePath);

    try {
      const content = fs.readFileSync(sourcePath);
      const base64Content = content.toString("base64");

      await trpcMutation("sandbox.uploadFile", {
        sandboxId: session.sandboxId,
        path: targetPath,
        content: base64Content,
      });

      uploaded++;
      if (uploaded % 20 === 0) {
        console.log(`Uploaded ${uploaded}/${files.length} files...`);
      }
    } catch (error) {
      console.error(`Failed to upload ${relativePath}:`, error);
      failed++;
    }
  }

  console.log(`\nUpload complete: ${uploaded} uploaded, ${failed} failed`);

  // 5. Close the volume session
  console.log("Closing volume session...");
  await trpcMutation("sandbox.closeVolumeSession", {
    sandboxId: session.sandboxId,
  });

  console.log("\nDone! Volume is ready:", volume.name);
}

main().catch(console.error);
