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
        if (this.sql.includes("COUNT(DISTINCT genre_map.book_id) AS count")) {
          const counts = new Map();
          for (const book of db.books) {
            for (const name of JSON.parse(book.genres_json)) {
              counts.set(name, (counts.get(name) || 0) + 1);
            }
          }
          return { results: [...counts].map(([name, count]) => ({
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            count,
          })) };
        }
        if (this.sql.includes("SELECT slug, name FROM genres")) {
          return { results: db.genres.map((name) => ({
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          })) };
        }
        if (this.sql.includes("AS initial")) {
          const groups = new Map();
          for (const book of db.books) {
            const initial = String(book.title || "").trim().charAt(0).toUpperCase();
            groups.set(initial, (groups.get(initial) || 0) + 1);
          }
          return { results: [...groups].map(([initial, count]) => ({ initial, count })) };
        }
        if (!this.sql.includes("FROM books")) return { results: [] };
        let rows = [...db.books];
        let argIndex = 0;
        if (this.sql.includes("language = ?")) {
          const language = this.args[argIndex++];
          rows = rows.filter((book) => book.language === language);
        }
        if (this.sql.includes("JOIN genres AS g ON lower(g.name)")) {
          const slug = String(this.args[argIndex++] || "").toLowerCase();
          rows = rows.filter((book) => JSON.parse(book.genres_json).some((item) =>
            item.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === slug));
        } else if (this.sql.includes("EXISTS (SELECT 1 FROM json_each(books.genres_json)")) {
          const genre = String(this.args[argIndex++] || "").toLowerCase();
          rows = rows.filter((book) => JSON.parse(book.genres_json).some((item) => item.toLowerCase() === genre));
        }
        if (this.sql.includes("SUBSTR(LTRIM(title), 1, 1)) BETWEEN ? AND ?")) {
          const first = String(this.args[argIndex++] || "").toUpperCase();
          const last = String(this.args[argIndex++] || "").toUpperCase();
          rows = rows.filter((book) => {
            const initial = String(book.title || "").trim().charAt(0).toUpperCase();
            return initial >= first && initial <= last;
          });
        }
        if (this.sql.includes("SUBSTR(LTRIM(title), 1, 1)) GLOB '[0-9]'")) {
          rows = rows.filter((book) => /^[0-9]/.test(String(book.title || "").trim()));
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

test("manifest advertises language, audio-type, per-genre and alphabetical catalogue rows", async () => {
  const manifest = await buildManifest(new FakeD1());
  assert.equal(manifest.name, "LibriVox Audiobooks");
  for (const language of ["english", "bangla", "hindi", "urdu", "arabic", "turkish"]) {
    assert.ok(manifest.catalogs.some((catalog) => catalog.id === "librivox_lang_" + language));
  }
  const genre = manifest.catalogs.find((catalog) => catalog.id === "librivox_genre_poetry");
  assert.equal(genre.name, "Genre · Poetry");
  assert.ok(manifest.catalogs.some((catalog) => catalog.id === "librivox_type_audio_drama"));
  assert.ok(manifest.catalogs.some((catalog) => catalog.id.startsWith("librivox_alpha_")));
  assert.ok(manifest.catalogs.some((catalog) => catalog.id === "librivox_search"));
  assert.equal(manifest.catalogs.some((catalog) => catalog.id === "librivox_all"), false);
  assert.equal(manifest.catalogs.some((catalog) => catalog.id === "librivox_author"), false);
});

test("large genres are split into labeled pages with no missing books", async () => {
  const manyBooks = Array.from({ length: 205 }, (_, index) => ({
    id: "lvb-poetry-" + String(index).padStart(3, "0"),
    title: "Poetry Book " + String(index).padStart(3, "0"),
    author: "Test Author",
    language: "English",
    genres_json: '["Poetry"]',
    description: "Test volume",
    poster: null,
    year: null,
    chapter_count: 1,
    chapters_json: JSON.stringify([{
      title: "Track 1",
      url: "https://archive.org/download/test/track-" + index + ".mp3",
      duration: 60,
    }]),
    search_text: "poetry book test author english",
  }));
  const env = { DB: new FakeD1(manyBooks) };
  const manifest = await buildManifest(env.DB);
  const shelves = manifest.catalogs.filter((catalog) => catalog.id.startsWith("librivox_genre_poetry"));
  assert.equal(shelves.length, 3);
  assert.deepEqual(shelves.map((catalog) => catalog.name), [
    "Genre · Poetry (1/3)",
    "Genre · Poetry (2/3)",
    "Genre · Poetry (3/3)",
  ]);

  const pageNames = [];
  for (const page of [1, 2, 3]) {
    const id = page === 1 ? "librivox_genre_poetry" : "librivox_genre_poetry_p" + page;
    const response = await worker.fetch(new Request("https://addon.test/catalog/movie/" + id + ".json"), env);
    assert.equal(response.status, 200);
    const metas = (await response.json()).metas;
    pageNames.push(...metas.map((book) => book.name));
    assert.equal(metas.length, page < 3 ? 100 : 5);
  }
  assert.equal(new Set(pageNames).size, 205);
  assert.equal(pageNames.length, 205);
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

test("catalogue routes independently filter by language, genre, alphabetical range and title search", async () => {
  const env = { DB: new FakeD1() };

  let response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_lang_bangla.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Banshi"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_genre_poetry.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Banshi", "Selected Ghazals"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_alpha_b_t.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["Banshi", "Selected Ghazals", "The Secret Garden"]);

  response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_search/search=Secret%20Garden.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).metas.map((book) => book.name), ["The Secret Garden"]);
});

test("search-only catalogs and unknown catalogue IDs never dump the full library", async () => {
  const env = { DB: new FakeD1() };
  for (const path of [
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
  const response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_alpha_a_c.json"), {});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /database is not configured/i);
});
