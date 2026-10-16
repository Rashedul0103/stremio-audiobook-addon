import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = path.join(workerRoot, "migrations");

class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    for (const migration of fs.readdirSync(migrationsRoot).filter((name) => name.endsWith(".sql")).sort()) {
      this.sqlite.exec(fs.readFileSync(path.join(migrationsRoot, migration), "utf8"));
    }
  }

  prepare(sql) {
    const d1 = this;
    return {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async all() {
        return { results: d1.sqlite.prepare(sql).all(...this.args) };
      },
      async first() {
        return d1.sqlite.prepare(sql).get(...this.args) || null;
      },
    };
  }

  close() {
    this.sqlite.close();
  }
}

function seedBook(db, book) {
  db.sqlite.prepare(`
    INSERT INTO books (
      id, title, author, language, genres_json, description, poster, year,
      chapter_count, chapters_json, search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    book.id,
    book.title,
    book.author,
    book.language,
    JSON.stringify(book.genres),
    book.description || "",
    null,
    book.year ?? null,
    book.chapters.length,
    JSON.stringify(book.chapters),
    [book.title, book.author, book.language, ...book.genres].join(" "),
  );
  for (const genre of book.genres) {
    db.sqlite.prepare("INSERT OR IGNORE INTO genres (slug, name) VALUES (?, ?)")
      .run(genre.toLowerCase().replace(/[^a-z0-9]+/g, "-"), genre);
  }
}

function fixture() {
  const db = new SqliteD1();
  seedBook(db, {
    id: "lvb-bn-1",
    title: "Banshi",
    author: "Rabindranath Tagore",
    language: "Bangla",
    genres: ["Poetry"],
    description: "A Bangla poem.",
    year: 1920,
    chapters: [
      { title: "Banshi", url: "https://archive.org/download/poetry/banshi.mp3", duration: 226 },
      { title: "Injected URL", url: "javascript:alert(1)", duration: 1 },
      { title: "Local file", url: "file:///etc/passwd", duration: 1 },
    ],
  });
  seedBook(db, {
    id: "lvb-en-1",
    title: "The Secret Garden",
    author: "Frances Hodgson Burnett",
    language: "English",
    genres: ["Children", "Fiction"],
    year: 1911,
    chapters: [{ title: "Chapter 1", url: "https://archive.org/download/garden/ch01.mp3", duration: 95 }],
  });
  seedBook(db, {
    id: "lvb-ur-1",
    title: "Selected Ghazals",
    author: "Mirza Ghalib",
    language: "Urdu",
    genres: ["Poetry", "Classics"],
    chapters: [{ title: "Ghazal 1", url: "https://archive.org/download/ghazals/one.mp3", duration: 75 }],
  });
  seedBook(db, {
    id: "lvb-multivoice-1",
    title: "Z Multi Voice Play",
    author: "Various",
    language: "English",
    genres: ["Plays Drama"],
    chapters: [
      { title: "Act 1", reader: "Reader One", url: "https://archive.org/download/multivoice/act1.mp3", duration: 300 },
      { title: "Act 2", reader: "Reader Two", url: "https://archive.org/download/multivoice/act2.mp3", duration: 320 },
    ],
  });
  seedBook(db, {
    id: "lvb-fullcast-1",
    title: "A Full Cast Audio Drama",
    author: "Various",
    language: "English",
    genres: ["Plays Drama"],
    chapters: [
      { title: "Act 1", reader: "Group", url: "https://archive.org/download/fullcast/act1.mp3", duration: 300 },
      { title: "Act 2", reader: "Group", url: "https://archive.org/download/fullcast/act2.mp3", duration: 320 },
    ],
  });
  return { DB: db, close: () => db.close() };
}

test("real SQLite migration supports language, per-genre, audio-type, search and alphabetical routes", async (t) => {
  const env = fixture();
  t.after(() => env.close());

  let response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_lang_bangla.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Banshi"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_genre_poetry.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(new Set((await response.json()).metas.map((book) => book.name)), new Set(["Banshi", "Selected Ghazals"]));

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_type_poetry.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(new Set((await response.json()).metas.map((book) => book.name)), new Set(["Banshi", "Selected Ghazals"]));

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_search/search=Secret%20Garden.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["The Secret Garden"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_type_multi_reader.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Z Multi Voice Play"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_type_group_reading.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["A Full Cast Audio Drama"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_type_audio_drama.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(new Set((await response.json()).metas.map((book) => book.name)), new Set(["A Full Cast Audio Drama", "Z Multi Voice Play"]));

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_alpha_b_t/skip=1&limit=1.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Selected Ghazals"]);
});

test("real SQLite manifest includes genres populated by the migration/import schema", async (t) => {
  const env = fixture();
  t.after(() => env.close());

  const response = await worker.fetch(new Request("https://addon.test/manifest.json"), env);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  const genreCatalog = manifest.catalogs.find((catalog) => catalog.id === "librivox_genre_poetry");
  assert.ok(genreCatalog);
  assert.equal(genreCatalog.name, "Genre · Poetry");
  assert.equal(manifest.catalogs.some((catalog) => catalog.id === "librivox_all"), false);
  assert.equal(manifest.catalogs.some((catalog) => catalog.id === "librivox_author"), false);
});

test("real SQLite metadata and playback return only HTTP(S) chapter URLs", async (t) => {
  const env = fixture();
  t.after(() => env.close());

  let response = await worker.fetch(new Request("https://addon.test/meta/movie/lvb-bn-1.json"), env);
  assert.equal(response.status, 200);
  const meta = (await response.json()).meta;
  assert.equal(meta.name, "Banshi");
  assert.match(meta.description, /Language: Bangla/);
  assert.match(meta.description, /Genres: Poetry/);
  assert.deepEqual(meta.genres, ["Poetry"]);

  response = await worker.fetch(new Request("https://addon.test/stream/movie/lvb-bn-1.json"), env);
  assert.equal(response.status, 200);
  const streams = (await response.json()).streams;
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://archive.org/download/poetry/banshi.mp3");
});

test("HEAD responses have no body and error/health responses are not cached", async (t) => {
  const env = fixture();
  t.after(() => env.close());

  let response = await worker.fetch(new Request("https://addon.test/manifest.json", { method: "HEAD" }), env);
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.match(response.headers.get("Content-Type"), /application\/json/);

  response = await worker.fetch(new Request("https://addon.test/health"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_alpha_b_t.json"), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_alpha_b_t.json", { method: "HEAD" }), {});
  assert.equal(response.status, 503);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
