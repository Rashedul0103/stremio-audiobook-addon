#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const requireSecrets = args.includes("--require-secrets");
const configArg = args.find((arg) => !arg.startsWith("--")) || "worker/wrangler.jsonc";
const configPath = path.resolve(configArg);

function fail(message) {
  console.error("[Cloudflare preflight] " + message);
  process.exit(1);
}

if (!fs.existsSync(configPath)) fail("Wrangler config not found: " + configPath);

const source = fs.readFileSync(configPath, "utf8");
const match = source.match(/"database_id"\s*:\s*"([^"]+)"/);
if (!match) fail('No "database_id" field found in ' + configPath);

const databaseId = match[1].trim();
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId);
const isPlaceholder = /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(databaseId);
if (!isUuid || isPlaceholder) {
  fail('Replace the placeholder database_id in ' + configPath + " with the real D1 UUID before deploying or importing.");
}

if (requireSecrets) {
  const missing = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]
    .filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) {
    fail("Missing required Actions secret(s): " + missing.join(", ") + ". Configure them in repository Settings → Secrets and variables → Actions.");
  }
}

console.log("[Cloudflare preflight] Configuration is valid; D1 ID is set" +
  (requireSecrets ? " and required credentials are present." : "."));
