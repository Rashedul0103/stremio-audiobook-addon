import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildManifest, parseExtras, toMetaPreview } from "../src/index.js";

const sampleBooks = [
  {
    id: "lvb-en-1", title: "The Secret Garden", author: "Frances Hodgson Burnett",
    language: "English", genres_json: '["Children","Fiction"]', description: "A classic children's novel.",
    poster: null, year: 1911, chapter_count: 2,
    chapters_json: JSON.stringify([
      { title: "Chapter 1", url: "https://archive.org/download/secret/ch01.mp3", duration: 95 },
      { title: "Chapter 2", url: "https://archive.org/download/secret/ch02.mp3", duration: 120 },
    ]),
    search_text: "The Secret Garden Frances Hodgson Burnett English Children Fiction",
  },
  {
    id: "lvb-bn-1", title: "Banshi", author: "Rabindranath Tagore",
    language: "Bangla", genres_json: '["Poetry"]', description: "A Bangla poem.",
    poster: null, year: null, chapter_count: 1,
    chapters_json: JSON.stringify([
      { title: "Banshi", url: "https://archive.org/download/poetry/banshi.mp3", duration: 226 },
    ]),
    search_text: "Banshi Rabindranath Tagore Bangla Poetry",
  },
  {
    id: "lvb-ur-1", title: "Selected Ghazals", author: "Mirza Ghalib",
    language: "Urdu", genres_json: '["Poetry","Classics"]', description: "Selected ghazals.",
    poster: null, year: null, chapter_count: 1,
    chapters_json: JSON.stringify([
      { title: "Ghazal 1", url: "https://archive.org/download/ghazals/one.mp3", duration: 75 },
    ]),
    search_text: "Selected Ghazals Mirza Ghalib Urdu Poetry Classics",
  },
];

class FakeD1 {
  constructor(books = sampleBooks) {
    this.books = books;
    this.genres = [...new Set(books.flatMap((book) => JSON.parse(book.genres_json)))].sort();
  }

  prepare(sql) {
    const db = this;
    return {
      sql,
      args: [],
      bind(...args) { this.args = args; return this; },
      async all() {
        if (this.sql.includes("SELECT name FROM genres")) {
          return { results: db.genres.map((name) => ({ name })) };
        }
        if (!this.sql.includes("FROM books")) return { results: [] };
        let rows = [...db.books];
        let argIndex = 0;
        if (this.sql.includes("language = ?")) {
          const language = this.args[argIndex++];
          rows = rows.filter((book) => book.language === language);
        }
        if (this.sql.includes("EXISTS (SELECT 1 FROM json_each(books.genres_json)")) {
          const genre = String(this.args[argIndex++] || "").toLowerCase();
          rows = rows.filter((book) => JSON.parse(book.genres_json).some((item) => item.toLowerCase() === genre));
        }
        if (this.sql.includes("instr(lower(author), lower(?))")) {
          const author = String(this.args[argIndex++] || "").toLowerCase();
          rows = rows.filter((book) => book.author.toLowerCase().includes(author));
        }
        if (this.sql.includes("instr(lower(search_text), lower(?))")) {
          const search = String(this.args[argIndex++] || "").toLowerCase();
          rows = rows.filter((book) => book.search_text.toLowerCase().includes(search));
        }
        const limit = this.args[this.args.length - 2];
        const offset = this.args[this.args.length - 1];
        rows.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
        if (Number.isInteger(limit) && Number.isInteger(offset)) rows = rows.slice(offset, offset + limit);
        return { results: rows };
      },
      async first() {
        if (this.sql.includes("COUNT(*) AS books")) return { books: db.books.length };
        if (this.sql.includes("FROM books") && this.sql.includes("WHERE id = ?")) {
          return db.books.find((book) => book.id === this.args[0]) || null;
        }
        return null;
      },
    };
  }
}

test("parses route-style extras and URL query parameters", () => {
  const url = new URL("https://example.test/catalog/movie/librivox_genre/genre=Science%20Fiction&skip=15.json?search=space+travel");
  const extras = parseExtras(url, "genre=Science%20Fiction&skip=15.json");
  assert.equal(extras.genre, "Science Fiction");
  assert.equal(extras.skip, "15");
  assert.equal(extras.search, "space travel");
});

test("manifest advertises six language catalogues and independent genre/author filters", async () => {
  const manifest = await buildManifest(new FakeD1());
  assert.equal(manifest.name, "LibriVox Audiobooks");
  for (const language of ["english", "bangla", "hindi", "urdu", "arabic", "turkish"]) {
    assert.ok(manifest.catalogs.some((catalog) => catalog.id === "librivox_lang_" + language));
  }
  const genre = manifest.catalogs.find((catalog) => catalog.id === "librivox_genre");
  assert.ok(genre.extra.some((extra) => extra.name === "genre"));
  assert.ok(genre.extra.find((extra) => extra.name === "genre").options.includes("Poetry"));
  assert.equal(genre.extra.find((extra) => extra.name === "genre").isRequired, false);
  const all = manifest.catalogs.find((catalog) => catalog.id === "librivox_all");
  assert.ok(all.extra.find((extra) => extra.name === "genre").options.includes("Poetry"));
  const author = manifest.catalogs.find((catalog) => catalog.id === "librivox_author");
  assert.ok(author.extra.some((extra) => extra.name === "author"));
});

test("meta previews include language, author, and genre metadata", () => {
  const preview = toMetaPreview({
    id: "lvb-123", title: "Test Book", author: "A. Writer", language: "Bangla",
    genres_json: '["Poetry","Classics"]', chapter_count: 3, year: 1920,
  });
  assert.equal(preview.id, "lvb-123");
  assert.equal(preview.name, "Test Book");
  assert.deepEqual(preview.genres, ["Poetry", "Classics"]);
  assert.match(preview.description, /Language: Bangla/);
  assert.match(preview.description, /Author: A\. Writer/);
  assert.equal(preview.releaseInfo, "1920");
});

test("manifest route works without a database and includes CORS headers", async () => {
  const response = await worker.fetch(new Request("https://addon.test/manifest.json"), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await response.json();
  assert.equal(body.id, "org.rashedul0103.librivox");
});

test("catalogue routes independently filter by language, genre, author and title search", async () => {
  const env = { DB: new FakeD1() };

  let response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_lang_bangla.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Banshi"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_genre/genre=Poetry.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Banshi", "Selected Ghazals"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_all/genre=Poetry.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Banshi", "Selected Ghazals"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_genre.json"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).metas.length, 3);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_author/author=Tagore.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Banshi"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_search/search=Secret%20Garden.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["The Secret Garden"]);
});

test("search-only catalogs and unknown catalogue IDs never dump the full library", async () => {
  const env = { DB: new FakeD1() };
  for (const path of [
    "/catalog/movie/librivox_author.json",
    "/catalog/movie/librivox_search.json",
    "/catalog/movie/not_a_catalogue.json",
  ]) {
    const response = await worker.fetch(new Request("https://addon.test" + path), env);
    assert.equal(response.status, 200, path);
    assert.deepEqual((await response.json()).metas, [], path);
  }
});

test("book metadata and chapter URLs are returned for playback", async () => {
  const env = { DB: new FakeD1() };
  let response = await worker.fetch(new Request("https://addon.test/meta/movie/lvb-bn-1.json"), env);
  assert.equal(response.status, 200);
  const meta = (await response.json()).meta;
  assert.equal(meta.name, "Banshi");
  assert.match(meta.description, /Language: Bangla/);
  assert.deepEqual(meta.genres, ["Poetry"]);

  response = await worker.fetch(new Request("https://addon.test/stream/movie/lvb-bn-1.json"), env);
  assert.equal(response.status, 200);
  const streams = (await response.json()).streams;
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://archive.org/download/poetry/banshi.mp3");
  assert.match(streams[0].title, /Banshi/);
});

test("catalogue route reports an unconfigured database instead of pretending to be empty", async () => {
  const response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_all.json"), {});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /database is not configured/i);
});
