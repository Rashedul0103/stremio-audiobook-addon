#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LANGUAGE_NAMES = ["English", "Bangla", "Hindi", "Urdu", "Arabic", "Turkish"];

function quoteSql(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

export function buildVerificationQuery(summary) {
  if (!/^[a-f0-9]{24}$/.test(summary?.importGeneration || "")) {
    throw new Error("Import summary is missing a valid generation marker.");
  }
  if (!Number.isInteger(summary.books) || summary.books < 1 ||
      !Number.isInteger(summary.chapters) || summary.chapters < 1 ||
      !Number.isInteger(summary.genres) || summary.genres < 1) {
    throw new Error("Import summary has invalid book, chapter, or genre counts.");
  }

  const generation = quoteSql(summary.importGeneration);
  const query = [
    "(SELECT COUNT(*) FROM books) AS books",
    "(SELECT COUNT(*) FROM genres) AS genres",
    "(SELECT COALESCE(SUM(chapter_count), 0) FROM books) AS chapters",
    `(SELECT COUNT(*) FROM books WHERE import_generation = ${generation}) AS generation_books`,
    `(SELECT COUNT(*) FROM books WHERE import_generation IS NULL OR import_generation <> ${generation}) AS stale_books`,
    `(SELECT COUNT(*) FROM genres WHERE import_generation = ${generation}) AS generation_genres`,
    `(SELECT COUNT(*) FROM genres WHERE import_generation IS NULL OR import_generation <> ${generation}) AS stale_genres`,
    ...LANGUAGE_NAMES.map((language) =>
      `(SELECT COUNT(*) FROM books WHERE language = ${quoteSql(language)}) AS books_${language.toLowerCase()}`
    ),
  ];
  return "SELECT\n  " + query.join(",\n  ") + ";";
}

const REQUIRED_RESULT_KEYS = [
  "books", "genres", "chapters", "generation_books", "stale_books",
  "generation_genres", "stale_genres",
  ...LANGUAGE_NAMES.map((language) => "books_" + language.toLowerCase()),
];

export function extractVerificationRow(payload) {
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;

    if (REQUIRED_RESULT_KEYS.every((key) => Object.hasOwn(node, key))) return node;

    for (const value of Object.values(node)) {
      const found = visit(value);
      if (found) return found;
    }
    return null;
  };

  const row = visit(payload);
  if (!row) {
    throw new Error("Wrangler returned no result row with the expected remote D1 verification columns.");
  }

  const normalized = {};
  for (const key of REQUIRED_RESULT_KEYS) {
    const value = Number(row[key]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Remote D1 verification returned an invalid count for " + key + ".");
    }
    normalized[key] = value;
  }
  return normalized;
}

export function compareVerification(summary, row) {
  const expected = {
    books: summary.books,
    genres: summary.genres,
    chapters: summary.chapters,
    generation_books: summary.books,
    stale_books: 0,
    generation_genres: summary.genres,
    stale_genres: 0,
  };
  for (const language of LANGUAGE_NAMES) {
    expected["books_" + language.toLowerCase()] = summary.languages?.[language] || 0;
  }

  const mismatches = [];
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) mismatches.push({ field: key, expected: value, actual: row[key] });
  }

  return {
    ok: mismatches.length === 0,
    expected,
    actual: row,
    mismatches,
  };
}

export function verifyWranglerPayload(summary, payload) {
  const row = extractVerificationRow(payload);
  return compareVerification(summary, row);
}

function main() {
  const [summaryPath, reportPath = "remote-import-verification.json"] = process.argv.slice(2);
  if (!summaryPath) {
    console.error("Usage: node scripts/verify-d1-import.mjs <summary.json> [report.json]");
    process.exitCode = 2;
    return;
  }

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(path.resolve(summaryPath), "utf8"));
  } catch (error) {
    console.error("Could not read import summary:", error.message);
    process.exitCode = 1;
    return;
  }

  let query;
  try {
    query = buildVerificationQuery(summary);
  } catch (error) {
    console.error("Invalid import summary:", error.message);
    process.exitCode = 1;
    return;
  }

  const result = spawnSync("wrangler", [
    "d1", "execute", "librivox-audiobooks",
    "--remote", "--config", "worker/wrangler.jsonc",
    "--command", query, "--json",
  ], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 5 * 1024 * 1024,
  });

  if (result.error) {
    console.error("Could not start Wrangler for remote verification:", result.error.message);
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().slice(-4000);
    console.error("Remote D1 verification query failed.", detail);
    process.exitCode = result.status || 1;
    return;
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    console.error("Wrangler did not return valid JSON for remote D1 verification.");
    process.exitCode = 1;
    return;
  }

  let verification;
  try {
    verification = verifyWranglerPayload(summary, payload);
  } catch (error) {
    console.error("Could not interpret remote D1 verification:", error.message);
    process.exitCode = 1;
    return;
  }

  const report = {
    importGeneration: summary.importGeneration,
    verifiedAt: new Date().toISOString(),
    ...verification,
  };
  const absoluteReportPath = path.resolve(reportPath);
  fs.mkdirSync(path.dirname(absoluteReportPath), { recursive: true });
  fs.writeFileSync(absoluteReportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (!verification.ok) {
    console.error("Remote D1 counts do not match the source import summary; do not treat this import as complete.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
