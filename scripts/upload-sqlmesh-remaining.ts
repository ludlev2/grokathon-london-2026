/**
 * Upload remaining SQLMesh files - reconnects after each file
 * npx tsx scripts/upload-sqlmesh-remaining.ts
 */

import * as fs from "node:fs";
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

const REMAINING_FILES = [
  "models/seeds/GL_5071_RTP_COS.sql",
  "models/seeds/GL_6163_BaaS_New_Account_Fees.sql",
  "models/seeds/GL_6275_BaaS_G_and_A.sql",
  "models/seeds/GL_6279_Network_Fees.sql",
  "models/staging/stg_business_details.sql",
  "models/staging/stg_daily_revenue.sql",
  "models/staging/stg_eod_balances.sql",
  "models/staging/stg_transactions.sql",
  "snowflake_rsa_key.p8",
];

async function uploadOne(rel: string) {
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });
  const sandbox = await daytona.get(SANDBOX_ID);
  const full = `${SOURCE_DIR}/${rel}`;
  const dest = `${REMOTE_DIR}/${rel}`;
  const content = fs.readFileSync(full);
  await sandbox.fs.uploadFile(content, dest);
  console.log(`OK: ${rel} (${content.length}b)`);
}

async function main() {
  console.log("=== Upload Remaining (reconnect per file) ===\n");

  for (let i = 0; i < REMAINING_FILES.length; i++) {
    console.log(`[${i + 1}/${REMAINING_FILES.length}] ${REMAINING_FILES[i]}`);
    try {
      await uploadOne(REMAINING_FILES[i]);
    } catch (e: any) {
      console.log(`  FAILED: ${e.message} - retrying...`);
      await new Promise(r => setTimeout(r, 2000));
      await uploadOne(REMAINING_FILES[i]);
    }
  }

  // Patch config + set permissions
  console.log("\nPatching config.yaml...");
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });
  const sandbox = await daytona.get(SANDBOX_ID);
  const configContent = fs.readFileSync(`${SOURCE_DIR}/config.yaml`, "utf-8");
  const fixedConfig = configContent.replace(
    /private_key_path: .*/,
    `private_key_path: ${REMOTE_DIR}/snowflake_rsa_key.p8`
  );
  await sandbox.fs.uploadFile(Buffer.from(fixedConfig), `${REMOTE_DIR}/config.yaml`);
  console.log("  config.yaml patched");
  await sandbox.process.executeCommand(`chmod 600 ${REMOTE_DIR}/snowflake_rsa_key.p8`);
  console.log("  key permissions set");

  // Verify
  const res = await sandbox.process.executeCommand(`find ${REMOTE_DIR} -type f | sort`);
  console.log("\nAll files:\n" + res.result);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
