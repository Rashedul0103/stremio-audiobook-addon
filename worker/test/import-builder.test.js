import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const builderPath = path.join(projectRoot, "scripts/build-librivox-d1-import.mjs");

function playlist(entries) {
  return [
    "#EXTM3U",
    ...entries.flatMap((entry) => [
      "#EXTINF:" + entry.duration + ' group-title="' + entry.group + '",' + entry.label,
      entry.url,
    ]),
    "",
  ].join("\n");
}

test("D1 import builder groups tracks by title and language, retaining genre and chapter metadata", (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "libri-import-test-"));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const source = path.join(temp, "source");
  const filtered = path.join(source, "filtered");
  const titleDir = path.join(filtered, "by-title");
  const languageDir = path.join(filtered, "by-language");
  const genreDir = path.join(filtered, "by-genre");
  for (const dir of [titleDir, languageDir, genreDir]) fs.mkdirSync(dir, { recursive: true });

  const tracks = {
    en1: "https://archive.org/download/example/chapter_01.mp3",
    en2: "https://archive.org/download/example/chapter_02.mp3",
    bn: "https://archive.org/download/multilingual/bengali_poem.mp3",
    tr: "https://archive.org/download/multilingual/turkish_poem.mp3",
    hi: "https://archive.org/download/hindi/hindi_story.mp3",
    ur: "https://archive.org/download/urdu/urdu_ghazal.mp3",
    ar: "https://archive.org/download/arabic/arabic_story.mp3",
  };

  const languages = {
    english: [["en1", "English"], ["en2", "English"]],
    bangla: [["bn", "Bangla"]],
    hindi: [["hi", "Hindi"]],
    urdu: [["ur", "Urdu"]],
    arabic: [["ar", "Arabic"]],
    turkish: [["tr", "Turkish"]],
  };
  for (const [slug, entries] of Object.entries(languages)) {
    const file = path.join(languageDir, slug + ".m3u");
    fs.writeFileSync(file, playlist(entries.map(([key, language]) => ({
      duration: 60,
      group: language,
      label: "Test recording",
      url: tracks[key],
    }))));
  }

  fs.writeFileSync(path.join(genreDir, "fiction.m3u"), playlist([
    { duration: 120, group: "Fiction", label: "Example Book — Jane Writer · Chapter 1", url: tracks.en1 },
    { duration: 180, group: "Fiction", label: "Example Book — Jane Writer · Chapter 2", url: tracks.en2 },
    { duration: 80, group: "Fiction", label: "Hindi Story — Hindi Author · Story", url: tracks.hi },
  ]));
  fs.writeFileSync(path.join(genreDir, "poetry.m3u"), playlist([
    { duration: 40, group: "Poetry", label: "Multilingual Book — Various · Bengali poem", url: tracks.bn },
    { duration: 45, group: "Poetry", label: "Multilingual Book — Various · Turkish poem", url: tracks.tr },
    { duration: 50, group: "Poetry", label: "Urdu Ghazal — Urdu Author · Ghazal", url: tracks.ur },
  ]));
  fs.writeFileSync(path.join(genreDir, "language.m3u"), playlist([
    { duration: 55, group: "Language", label: "Arabic Story — Arabic Author · Story", url: tracks.ar },
  ]));

  fs.writeFileSync(path.join(titleDir, "example-book.m3u"), playlist([
    { duration: 120, group: "Example Book", label: "Example Book — Jane Writer · Chapter 1", url: tracks.en1 },
    { duration: 180, group: "Example Book", label: "Example Book — Jane Writer · Chapter 2", url: tracks.en2 },
  ]));
  fs.writeFileSync(path.join(titleDir, "multilingual-book.m3u"), playlist([
    { duration: 40, group: "Multilingual Book", label: "Multilingual Book — Various · Bengali poem", url: tracks.bn },
    { duration: 45, group: "Multilingual Book", label: "Multilingual Book — Various · Turkish poem", url: tracks.tr },
  ]));
  for (const [key, label, author, genre] of [
    ["hi", "Hindi Story", "Hindi Author", "Fiction"],
    ["ur", "Urdu Ghazal", "Urdu Author", "Poetry"],
    ["ar", "Arabic Story", "Arabic Author", "Language"],
  ]) {
    fs.writeFileSync(path.join(titleDir, key + "-book.m3u"), playlist([
      { duration: 60, group: label, label: label + " — " + author + " · Chapter", url: tracks[key] },
    ]));
  }

  const output = path.join(temp, "sql");
  const run = spawnSync(process.execPath, [builderPath, source, output], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const summary = JSON.parse(fs.readFileSync(path.join(output, "summary.json"), "utf8"));
  assert.equal(summary.books, 6);
  assert.equal(summary.chapters, 7);
  assert.equal(summary.genres, 3);
  assert.equal(summary.languages.English, 1);
  assert.equal(summary.languages.Bangla, 1);
  assert.equal(summary.languages.Turkish, 1);
  assert.ok(summary.bookSqlBatches >= 1);
  assert.match(summary.importGeneration, /^[a-f0-9]{24}$/);
  const pruneSqlPath = path.join(output, "99-prune-stale.sql");
  assert.ok(fs.existsSync(pruneSqlPath));
  const pruneSql = fs.readFileSync(pruneSqlPath, "utf8");
  assert.match(pruneSql, /DELETE FROM books WHERE import_generation <> '[a-f0-9]{24}'/);
  assert.match(pruneSql, /DELETE FROM genres WHERE import_generation <> '[a-f0-9]{24}'/);
  assert.equal(fs.existsSync(path.join(output, "00-clear.sql")), false);

  const allBookSql = fs.readdirSync(output).filter((name) => name.startsWith("10-books-"))
    .map((name) => fs.readFileSync(path.join(output, name), "utf8")).join("\n");
  assert.match(allBookSql, /Example Book/);
  assert.match(allBookSql, /Jane Writer/);
  assert.match(allBookSql, /chapter_01\.mp3/);
  assert.match(allBookSql, /Multilingual Book/);
  assert.match(allBookSql, /import_generation/);
  assert.equal(allBookSql.includes("DELETE FROM books"), false);

  const allGenreSql = fs.readdirSync(output).filter((name) => name.startsWith("20-genres-"))
    .map((name) => fs.readFileSync(path.join(output, name), "utf8")).join("\n");
  assert.match(allGenreSql, /import_generation/);

  const migrations = path.join(projectRoot, "worker/migrations");
  const db = new DatabaseSync(":memory:");
  context.after(() => db.close());
  for (const migration of fs.readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(migrations, migration), "utf8"));
  }
  db.prepare(`
    INSERT INTO books (
      id, title, author, language, genres_json, description, year,
      chapter_count, chapters_json, search_text, import_generation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("obsolete-old-book", "Obsolete Book", "Old Author", "English", '["Removed Genre"]',
    "Stale row fixture", null, 1, "[]", "obsolete old author", "old-generation");
  db.prepare("INSERT INTO genres (slug, name, import_generation) VALUES (?, ?, ?)")
    .run("removed-genre", "Removed Genre", "old-generation");

  // Apply SQL files in the same lexical order used by the Cloudflare import workflow.
  for (const name of fs.readdirSync(output).filter((file) => file.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(output, name), "utf8"));
  }

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM books").get().count, summary.books);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM genres").get().count, summary.genres);
  assert.equal(db.prepare("SELECT id FROM books WHERE id = ?").get("obsolete-old-book"), undefined);
  assert.equal(db.prepare("SELECT slug FROM genres WHERE slug = ?").get("removed-genre"), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM books WHERE import_generation <> ?")
    .get(summary.importGeneration).count, 0);
});
