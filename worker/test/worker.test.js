import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildManifest, parseExtras, toMetaPreview } from "../src/index.js";

test("parses route-style extras and URL query parameters", () => {
  const url = new URL("https://example.test/catalog/movie/librivox_genre/genre=Science%20Fiction&skip=15.json?search=space+travel");
  const extras = parseExtras(url, "genre=Science%20Fiction&skip=15.json");
  assert.equal(extras.genre, "Science Fiction");
  assert.equal(extras.skip, "15");
  assert.equal(extras.search, "space travel");
});

test("manifest advertises language catalogues and independent genre/author search", async () => {
  const manifest = await buildManifest(null);
  assert.equal(manifest.name, "LibriVox Audiobooks");
  assert.ok(manifest.catalogs.some((catalog) => catalog.id === "librivox_lang_bangla"));
  assert.ok(manifest.catalogs.some((catalog) => catalog.id === "librivox_lang_turkish"));
  const genre = manifest.catalogs.find((catalog) => catalog.id === "librivox_genre");
  assert.ok(genre.extra.some((extra) => extra.name === "genre"));
  const author = manifest.catalogs.find((catalog) => catalog.id === "librivox_author");
  assert.ok(author.extra.some((extra) => extra.name === "author"));
});

test("meta previews include language, author, and genre metadata", () => {
  const preview = toMetaPreview({
    id: "lvb-123",
    title: "Test Book",
    author: "A. Writer",
    language: "Bangla",
    genres_json: '["Poetry","Classics"]',
    chapter_count: 3,
    year: 1920,
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

test("catalogue route reports an unconfigured database instead of pretending to be empty", async () => {
  const response = await worker.fetch(new Request("https://addon.test/catalog/movie/librivox_all.json"), {});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /database is not configured/i);
});
