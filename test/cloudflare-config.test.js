import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/validate-cloudflare-config.mjs");

function run(config, flags = [], env = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-preflight-"));
  try {
    const configPath = path.join(temp, "wrangler.jsonc");
    fs.writeFileSync(configPath, JSON.stringify(config));
    return spawnSync(process.execPath, [script, configPath, ...flags], {
      encoding: "utf8",
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "", ...env },
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test("preflight accepts a real D1 UUID when deploy credentials are present", () => {
  const result = run(
    { d1_databases: [{ database_id: "12345678-1234-4abc-8abc-123456789abc" }] },
    ["--require-secrets"],
    { CLOUDFLARE_ACCOUNT_ID: "test-account-id", CLOUDFLARE_API_TOKEN: "test-token" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Configuration is valid/);
});

test("preflight rejects the repository's all-zero placeholder UUID", () => {
  const result = run({ d1_databases: [{ database_id: "00000000-0000-0000-0000-000000000000" }] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Replace the placeholder database_id/);
});

test("preflight fails early when Cloudflare Actions secrets are missing", () => {
  const result = run(
    { d1_databases: [{ database_id: "12345678-1234-4abc-8abc-123456789abc" }] },
    ["--require-secrets"],
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN/);
  assert.equal(result.stderr.includes("test-token"), false);
});

test("preflight rejects malformed config without a database ID", () => {
  const result = run({ name: "missing-db-id" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No "database_id" field found/);
});
