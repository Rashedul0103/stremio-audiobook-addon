#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const [sourceRepo = "", outputDir = "librivox-d1-import"] = process.argv.slice(2);
if (!sourceRepo) {
  console.error("Usage: node scripts/build-librivox-d1-import.mjs <librivox-repo-directory> <output-directory>");
  process.exit(2);
}

const filteredRoot = path.join(sourceRepo, "filtered");
const titleRoot = path.join(filteredRoot, "by-title");
const languageRoot = path.join(filteredRoot, "by-language");
const genreRoot = path.join(filteredRoot, "by-genre");
if (![titleRoot, languageRoot, genreRoot].every((dir) => fs.existsSync(dir))) {
  throw new Error("The source repository must contain generated filtered/by-title, filtered/by-language and filtered/by-genre playlists. Generate them first.");
}

const LANGUAGES = [
  ["english", "English"],
  ["bangla", "Bangla"],
  ["hindi", "Hindi"],
  ["urdu", "Urdu"],
  ["arabic", "Arabic"],
  ["turkish", "Turkish"],
];

function walkM3u(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkM3u(abs));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".m3u")) files.push(abs);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function parseM3u(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries = [];
  let info = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      info = line;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (/^https?:\/\//i.test(line)) {
      const comma = info.indexOf(",");
      const durationText = info.startsWith("#EXTINF:")
        ? info.slice(8, comma < 0 ? undefined : comma).match(/^-?\d+/)?.[0]
        : null;
      const label = comma >= 0 ? info.slice(comma + 1).trim() : path.basename(line);
      const groupTitle = info.match(/\bgroup-title="([^"]*)"/i)?.[1]?.trim() || "";
      entries.push({
        url: line,
        duration: durationText === undefined || durationText === null ? 0 : Math.max(0, Number.parseInt(durationText, 10) || 0),
        label,
        groupTitle,
      });
    }
    info = "";
  }
  return entries;
}

function genreSlug(name) {
  return String(name || "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}

function sqlText(value) {
  return "'" + String(value ?? "").replace(/\u0000/g, "").replace(/'/g, "''") + "'";
}

function sqlValue(value) {
  return value === null || value === undefined ? "NULL" : sqlText(value);
}

function parseBookLabel(label) {
  const normalized = String(label || "").trim();
  const separator = normalized.indexOf(" — ");
  if (separator < 0) {
    const descriptorSeparator = normalized.indexOf(" · ");
    return {
      title: (descriptorSeparator < 0 ? normalized : normalized.slice(0, descriptorSeparator)).trim() || "Unknown title",
      author: "Unknown author",
      chapter: descriptorSeparator < 0 ? "" : normalized.slice(descriptorSeparator + 3).trim(),
    };
  }

  const title = normalized.slice(0, separator).trim() || "Unknown title";
  const remainder = normalized.slice(separator + 3);
  const descriptorSeparator = remainder.indexOf(" · ");
  const author = (descriptorSeparator < 0 ? remainder : remainder.slice(0, descriptorSeparator)).trim() || "Unknown author";

  return {
    title,
    author,
    chapter: descriptorSeparator < 0 ? "" : remainder.slice(descriptorSeparator + 3).trim(),
  };
}

function chapterTitle(label, parsed) {
  return parsed.chapter || label || parsed.title;
}

function writeBatches(prefix, statements, maxBytes = 300_000, maxStatements = 250) {
  let batch = [];
  let bytes = 0;
  let number = 1;
  const flush = () => {
    if (!batch.length) return;
    const filename = prefix + String(number++).padStart(4, "0") + ".sql";
    fs.writeFileSync(path.join(outputDir, filename), batch.join("\n") + "\n", "utf8");
    batch = [];
    bytes = 0;
  };
  for (const statement of statements) {
    const size = Buffer.byteLength(statement, "utf8") + 1;
    if (batch.length && (bytes + size > maxBytes || batch.length >= maxStatements)) flush();
    batch.push(statement);
    bytes += size;
    if (size > maxBytes) flush();
  }
  flush();
  return number - 1;
}

console.log("Indexing the six language playlists...");
const languageByUrl = new Map();
for (const [slug, language] of LANGUAGES) {
  const file = path.join(languageRoot, slug + ".m3u");
  if (!fs.existsSync(file)) throw new Error("Missing language playlist: " + file);
  for (const row of parseM3u(file)) {
    if (!languageByUrl.has(row.url)) languageByUrl.set(row.url, language);
  }
}
console.log("Language-mapped tracks:", languageByUrl.size);

console.log("Indexing genre playlists...");
const genresByUrl = new Map();
for (const file of walkM3u(genreRoot)) {
  const rows = parseM3u(file);
  const fallback = path.basename(file, ".m3u").replace(/-/g, " ");
  for (const row of rows) {
    const genre = row.groupTitle || fallback;
    if (!genresByUrl.has(row.url)) genresByUrl.set(row.url, new Set());
    genresByUrl.get(row.url).add(genre);
  }
}
console.log("Genre-mapped tracks:", genresByUrl.size);

console.log("Grouping title playlists into book records by each EXTINF book label...");
const books = new Map();
const titleFiles = walkM3u(titleRoot);

for (const file of titleFiles) {
  const rows = parseM3u(file);
  if (!rows.length) continue;

  // Some by-title source files are alphabetic buckets (for example "1.m3u")
  // containing thousands of different books. The file/group-title is a browse
  // bucket, not necessarily a book title. Recover the actual book and author
  // from every EXTINF label instead of grouping the entire file into one row.
  for (const row of rows) {
    const language = languageByUrl.get(row.url);
    if (!language) continue;

    const parsed = parseBookLabel(row.label);
    const title = parsed.title || "Unknown title";
    const author = parsed.author || "Unknown author";
    const identity = [genreSlug(title), genreSlug(author), language].join("|");
    const id = "lvb-" + createHash("sha256").update(identity).digest("hex").slice(0, 20);

    if (!books.has(id)) {
      books.set(id, {
        id,
        title,
        author,
        language,
        genres: new Set(),
        chapters: [],
        chapterUrls: new Set(),
      });
    }

    const book = books.get(id);
    for (const genre of (genresByUrl.get(row.url) || [])) book.genres.add(genre);

    // A book can appear in both an alphabetic bucket and a per-title source
    // playlist. Deduplicate audio URLs so chapter playback isn't repeated.
    if (!book.chapterUrls.has(row.url)) {
      book.chapterUrls.add(row.url);
      book.chapters.push({
        title: chapterTitle(row.label, parsed),
        url: row.url,
        duration: row.duration,
      });
    }
  }
}

const normalizedBooks = [...books.values()].map((book) => {
  const genres = book.genres.size ? [...book.genres].sort((a, b) => a.localeCompare(b)) : ["Unclassified"];
  book.chapters.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) ||
    a.url.localeCompare(b.url)
  );
  const description = "LibriVox public-domain audiobook. " + book.chapters.length + " audio track(s)/chapter(s).";
  const searchText = [book.title, book.author, book.language, ...genres].join(" ");
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    language: book.language,
    genres_json: JSON.stringify(genres),
    description,
    poster: null,
    year: null,
    chapter_count: book.chapters.length,
    chapters_json: JSON.stringify(book.chapters),
    search_text: searchText,
    genres,
  };
}).filter((book) => book.chapter_count > 0)
  .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));

if (!normalizedBooks.length) throw new Error("No books were built; refusing to generate an empty import.");

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "00-clear.sql"), "DELETE FROM genres;\n", "utf8");

function bookToSqlStatements(book) {
  const makeInsert = (chaptersJson) =>
    "INSERT INTO books (id,title,author,language,genres_json,description,poster,year,chapter_count,chapters_json,search_text) VALUES (" +
    [
      sqlText(book.id), sqlText(book.title), sqlText(book.author), sqlText(book.language),
      sqlText(book.genres_json), sqlText(book.description), sqlValue(book.poster),
      book.year === null ? "NULL" : String(book.year), String(book.chapter_count),
      sqlText(chaptersJson), sqlText(book.search_text),
    ].join(",") + ") ON CONFLICT(id) DO UPDATE SET " +
    "title=excluded.title,author=excluded.author,language=excluded.language," +
    "genres_json=excluded.genres_json,description=excluded.description,poster=excluded.poster," +
    "year=excluded.year,chapter_count=excluded.chapter_count,chapters_json=excluded.chapters_json," +
    "search_text=excluded.search_text;";

  const directInsert = makeInsert(book.chapters_json);
  if (Buffer.byteLength(directInsert, "utf8") < 90_000) return [directInsert];

  if (Buffer.byteLength(book.chapters_json, "utf8") > 1_750_000) {
    throw new Error("One title exceeds D1's safe 2 MB row limit: " + book.title + " (" + book.chapter_count + " tracks). Split this collection before importing.");
  }

  // D1 limits a single SQL statement to 100 KB. Store large chapter arrays in
  // smaller string chunks, appending them to the same row in order.
  const chunks = [];
  let chunk = "";
  for (const character of book.chapters_json) {
    const candidate = chunk + character;
    if (chunk && Buffer.byteLength(sqlText(candidate), "utf8") > 70_000) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);

  const statements = [makeInsert("[]")];
  for (let i = 0; i < chunks.length; i++) {
    const assignment = i === 0
      ? "chapters_json = " + sqlText(chunks[i])
      : "chapters_json = chapters_json || " + sqlText(chunks[i]);
    statements.push(
      "UPDATE books SET " + assignment + " WHERE id = " + sqlText(book.id) + ";"
    );
  }
  return statements;
}

const bookSql = normalizedBooks.flatMap(bookToSqlStatements);

const uniqueGenres = new Map();
for (const book of normalizedBooks) {
  for (const genre of book.genres) uniqueGenres.set(genreSlug(genre), genre);
}
const genreSql = [...uniqueGenres.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([slug, name]) =>
  "INSERT OR REPLACE INTO genres (slug,name) VALUES (" + sqlText(slug) + "," + sqlText(name) + ");"
);

const bookBatches = writeBatches("10-books-", bookSql);
const genreBatches = writeBatches("20-genres-", genreSql, 150_000, 400);

const summary = {
  books: normalizedBooks.length,
  chapters: normalizedBooks.reduce((sum, book) => sum + book.chapter_count, 0),
  genres: uniqueGenres.size,
  languages: Object.fromEntries(LANGUAGES.map(([, name]) => [
    name,
    normalizedBooks.filter((book) => book.language === name).length,
  ])),
  bookSqlBatches: bookBatches,
  genreSqlBatches: genreBatches,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
