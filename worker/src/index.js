const LANGUAGES = [
  { slug: "english", name: "English" },
  { slug: "bangla", name: "Bangla" },
  { slug: "hindi", name: "Hindi" },
  { slug: "urdu", name: "Urdu" },
  { slug: "arabic", name: "Arabic" },
  { slug: "turkish", name: "Turkish" },
];

const FALLBACK_GENRES = [
  "Adventure", "Biography", "Children", "Classics", "Drama", "Fantasy",
  "Fiction", "History", "Horror", "Humor", "Mystery", "Non-Fiction",
  "Poetry", "Religion", "Romance", "Science", "Science Fiction", "Short Stories",
  "Travel", "Young Adults",
];
const PAGE_SIZE = 100;
const FALLBACK_POSTER = "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Audiobook_icon.svg/512px-Audiobook_icon.svg.png";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status >= 400 ? "no-store" : "public, max-age=60",
      ...extraHeaders,
    },
  });
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    return value;
  }
}

/** Parse Stremio-style extras from either /key=value&skip=0.json or query parameters. */
export function parseExtras(url, rawExtra = "") {
  const extras = {};
  const raw = String(rawExtra || "").replace(/\.json$/i, "");
  for (const part of raw.split("&")) {
    if (!part) continue;
    const splitAt = part.indexOf("=");
    if (splitAt < 1) continue;
    const key = safeDecode(part.slice(0, splitAt));
    const value = safeDecode(part.slice(splitAt + 1));
    if (key) extras[key] = value;
  }
  for (const [key, value] of url.searchParams.entries()) {
    extras[key] = value;
  }
  return extras;
}

function readJsonArray(value) {
  try {
    const result = JSON.parse(value || "[]");
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

function safeNumber(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function toMetaPreview(book) {
  const genres = readJsonArray(book.genres_json);
  const author = book.author && book.author !== "Unknown author" ? [book.author] : [];
  const chapterCount = safeNumber(book.chapter_count, 0);
  return {
    id: book.id,
    type: "movie",
    name: book.title,
    poster: book.poster || FALLBACK_POSTER,
    background: book.poster || FALLBACK_POSTER,
    description: [
      book.language ? "Language: " + book.language : "",
      author.length ? "Author: " + author.join(", ") : "",
      genres.length ? "Genres: " + genres.join(", ") : "Genres: Unclassified",
      chapterCount ? "Audio tracks/chapters: " + chapterCount : "",
    ].filter(Boolean).join("\n"),
    genres,
    director: author,
    cast: [],
    releaseInfo: book.year ? String(book.year) : undefined,
  };
}

const AUDIO_TYPES = [
  { id: "audio_drama", name: "Plays & Audio Drama" },
  { id: "dramatic_readings", name: "Dramatic Readings" },
  { id: "group_reading", name: "Group Readings (source-marked)" },
  { id: "multi_reader", name: "Multiple Identified Readers (2+)" },
  { id: "single_reader", name: "Single Identified Narrator" },
  { id: "short_stories", name: "Short Stories & Anthologies" },
  { id: "poetry", name: "Poetry & Verse" },
  { id: "children", name: "Children's Audiobooks" },
  { id: "religion", name: "Religion & Scripture" },
  { id: "nonfiction", name: "Nonfiction, Essays & Reference" },
  { id: "fantasy_scifi", name: "Fantasy & Science Fiction" },
  { id: "mystery_thrillers", name: "Mystery, Crime & Suspense" },
];

const TYPE_FILTERS = {
  audio_drama: "(EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%plays%' OR lower(value) LIKE '%drama%' OR lower(value) LIKE '%radio play%') OR lower(title) LIKE '%radio play%' OR lower(title) LIKE '%audio drama%')",
  dramatic_readings: "(EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%dramatic reading%') OR lower(title) LIKE '%dramatic reading%' OR lower(title) LIKE '%dramatized reading%' OR lower(title) LIKE '%dramatised reading%')",
  group_reading: "EXISTS (SELECT 1 FROM json_each(books.chapters_json) AS reader_chapter WHERE lower(trim(json_extract(reader_chapter.value, '$.reader'))) = 'group')",
  multi_reader: "(SELECT COUNT(DISTINCT lower(trim(json_extract(reader_chapter.value, '$.reader'))) ) FROM json_each(books.chapters_json) AS reader_chapter WHERE json_extract(reader_chapter.value, '$.reader') IS NOT NULL AND trim(json_extract(reader_chapter.value, '$.reader')) <> '' AND lower(trim(json_extract(reader_chapter.value, '$.reader'))) NOT IN ('unknown', 'group')) >= 2",
  single_reader: "(SELECT COUNT(DISTINCT lower(trim(json_extract(reader_chapter.value, '$.reader'))) ) FROM json_each(books.chapters_json) AS reader_chapter WHERE json_extract(reader_chapter.value, '$.reader') IS NOT NULL AND trim(json_extract(reader_chapter.value, '$.reader')) <> '' AND lower(trim(json_extract(reader_chapter.value, '$.reader'))) NOT IN ('unknown', 'group')) = 1",
  short_stories: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%short stor%' OR lower(value) LIKE '%antholog%')",
  poetry: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%poetry%' OR lower(value) LIKE '%poem%' OR lower(value) LIKE '%verse%')",
  children: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%children%' OR lower(value) LIKE '%young adult%')",
  religion: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%religion%' OR lower(value) LIKE '%bible%' OR lower(value) LIKE '%scripture%' OR lower(value) LIKE '%christianity%')",
  nonfiction: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%non fiction%' OR lower(value) LIKE '%non-fiction%' OR lower(value) LIKE '%reference%' OR lower(value) LIKE '%essays%')",
  fantasy_scifi: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%fantasy fiction%' OR lower(value) LIKE '%science fiction%' OR lower(value) LIKE '%fantastic fiction%')",
  mystery_thrillers: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%crime%' OR lower(value) LIKE '%mystery%' OR lower(value) LIKE '%detective%' OR lower(value) LIKE '%thriller%' OR lower(value) LIKE '%suspense%')",
};

function alphaCatalogId(start, end) {
  return start === "OTHER" ? "librivox_alpha_other"
    : start === "0" ? "librivox_alpha_0_9"
    : "librivox_alpha_" + start.toLowerCase() + "_" + end.toLowerCase();
}

function buildAlphaCatalogs(initialRows) {
  const counts = new Map();
  for (const row of initialRows || []) {
    const initial = String(row.initial || "").trim().toUpperCase();
    const count = safeNumber(row.count, 0);
    if (!count) continue;
    if (/^[A-Z]$/.test(initial)) counts.set(initial, (counts.get(initial) || 0) + count);
    else if (/^[0-9]$/.test(initial)) counts.set("#", (counts.get("#") || 0) + count);
    else counts.set("OTHER", (counts.get("OTHER") || 0) + count);
  }

  const catalogs = [];
  if (counts.get("#")) {
    catalogs.push({ type: "movie", id: alphaCatalogId("0", "9"), name: "Books · 0–9", extra: [{ name: "skip", isRequired: false }] });
  }

  // Build contiguous, balanced letter ranges so every title beginning A–Z
  // belongs to exactly one row. Large initial-letter groups can stand alone.
  let start = null;
  let end = null;
  let total = 0;
  const target = 1100;
  const flush = () => {
    if (start === null || total === 0) return;
    catalogs.push({
      type: "movie",
      id: alphaCatalogId(start, end),
      name: "Books · " + start + (start === end ? "" : "–" + end),
      extra: [{ name: "skip", isRequired: false }],
    });
    start = null;
    end = null;
    total = 0;
  };
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const count = counts.get(letter) || 0;
    if (count && start === null) start = letter;
    if (count) {
      end = letter;
      total += count;
    }
    if (total >= target) flush();
  }
  flush();

  if (counts.get("OTHER")) {
    catalogs.push({ type: "movie", id: alphaCatalogId("OTHER", "OTHER"), name: "Books · Other Titles", extra: [{ name: "skip", isRequired: false }] });
  }
  return catalogs;
}

function baseCatalogs(genres, initialRows) {
  const skip = { name: "skip", isRequired: false };
  const search = { name: "search", isRequired: true };
  const catalogs = [];

  // One row for each requested language. Nothing is removed from the database:
  // these are views of the same complete imported set.
  for (const language of LANGUAGES) {
    catalogs.push({
      type: "movie",
      id: "librivox_lang_" + language.slug,
      name: "LibriVox · " + language.name,
      extra: [{ name: "search", isRequired: false }, skip],
    });
  }

  for (const type of AUDIO_TYPES) {
    catalogs.push({
      type: "movie",
      id: "librivox_type_" + type.id,
      name: "Type · " + type.name,
      extra: [skip],
    });
  }

  // Give every real imported genre its own named row. The title itself also
  // retains all genre labels in its metadata, including multi-genre books.
  for (const genre of genres) {
    if (!genre?.name || !genre?.slug) continue;
    // Split large genres into separate 100-book shelves so every page has a
    // clear genre label and clients do not need to paginate one enormous row.
    const bookCount = safeNumber(genre.count, 0);
    const pageCount = Math.max(1, Math.ceil(bookCount / PAGE_SIZE));
    for (let page = 1; page <= pageCount; page++) {
      const paged = pageCount > 1;
      catalogs.push({
        type: "movie",
        id: "librivox_genre_" + genre.slug + (paged ? "_p" + page : ""),
        name: "Genre · " + genre.name + (paged ? " (" + page + "/" + pageCount + ")" : ""),
        extra: [],
      });
    }
  }

  catalogs.push(...buildAlphaCatalogs(initialRows));
  catalogs.push({
    type: "movie",
    id: "librivox_search",
    name: "Search LibriVox Books",
    extra: [search, skip],
  });
  return catalogs;
}

export async function buildManifest(db) {
  let genres = FALLBACK_GENRES.map((name) => ({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    count: 0,
  }));
  let initialRows = [];
  if (db) {
    try {
      const result = await db.prepare(
        "SELECT g.slug, g.name, COUNT(DISTINCT genre_map.book_id) AS count " +
        "FROM genres AS g " +
        "LEFT JOIN (SELECT b.id AS book_id, genre_item.value AS genre_name " +
        "FROM books AS b, json_each(b.genres_json) AS genre_item) AS genre_map " +
        "ON lower(genre_map.genre_name) = lower(g.name) " +
        "GROUP BY g.slug, g.name ORDER BY g.name COLLATE NOCASE"
      ).all();
      const rows = result.results || [];
      if (rows.length) genres = rows.map((row) => ({
        name: row.name,
        slug: row.slug,
        count: safeNumber(row.count, 0),
      })).filter((row) => row.name && row.slug);
    } catch {
      // Keep the manifest available while the database is being initialized.
    }
    try {
      const result = await db.prepare(
        "SELECT UPPER(SUBSTR(LTRIM(title), 1, 1)) AS initial, COUNT(*) AS count FROM books GROUP BY initial"
      ).all();
      initialRows = result.results || [];
    } catch {
      // Alphabetical rows are omitted only when the database cannot supply counts.
    }
  }
  return {
    id: "org.rashedul0103.librivox",
    version: "1.1.0",
    name: "LibriVox Audiobooks",
    description: "Browse the complete LibriVox catalogue by language, genre, audio type and title range.",
    logo: FALLBACK_POSTER,
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    idPrefixes: ["lvb-"],
    catalogs: baseCatalogs(genres, initialRows),
    behaviorHints: { configurable: false, configurationRequired: false },
  };
}

function parseRoute(pathname) {
  const match = pathname.match(/^\/(catalog|meta|stream)\/([^/]+)\/([^/]+)(?:\/(.*))?\.json$/);
  if (!match) return null;
  return {
    resource: match[1],
    type: safeDecode(match[2]),
    id: safeDecode(match[3]),
    rawExtra: match[4] || "",
  };
}

function bookQuery(catalogId, extras) {
  const where = [];
  const bind = [];
  const lang = LANGUAGES.find((item) => "librivox_lang_" + item.slug === catalogId);
  if (lang) {
    where.push("language = ?");
    bind.push(lang.name);
  }

  let genrePage = 1;
  const genreMatch = catalogId.match(/^librivox_genre_([a-z0-9-]+)(?:_p(\d+))?$/);
  if (genreMatch) {
    const slug = genreMatch[1];
    genrePage = Math.max(1, safeNumber(genreMatch[2], 1));
    where.push(
      "EXISTS (SELECT 1 FROM json_each(books.genres_json) AS genre_item " +
      "JOIN genres AS g ON lower(g.name) = lower(genre_item.value) WHERE g.slug = ?)"
    );
    bind.push(slug);
  }

  if (catalogId.startsWith("librivox_type_")) {
    const typeId = catalogId.slice("librivox_type_".length);
    if (TYPE_FILTERS[typeId]) where.push("(" + TYPE_FILTERS[typeId] + ")");
  }

  if (catalogId.startsWith("librivox_alpha_")) {
    const range = catalogId.slice("librivox_alpha_".length);
    if (range === "0_9") {
      where.push("UPPER(SUBSTR(LTRIM(title), 1, 1)) GLOB '[0-9]'");
    } else if (range === "other") {
      where.push("NOT (UPPER(SUBSTR(LTRIM(title), 1, 1)) BETWEEN 'A' AND 'Z') AND NOT (UPPER(SUBSTR(LTRIM(title), 1, 1)) GLOB '[0-9]')");
    } else {
      const match = range.match(/^([a-z])_([a-z])$/);
      if (match) {
        where.push("UPPER(SUBSTR(LTRIM(title), 1, 1)) BETWEEN ? AND ?");
        bind.push(match[1].toUpperCase(), match[2].toUpperCase());
      } else {
        where.push("1 = 0");
      }
    }
  }

  const searchTerm = extras.search;
  if (searchTerm) {
    where.push("instr(lower(search_text), lower(?)) > 0");
    bind.push(searchTerm.slice(0, 160));
  }

  const limit = Math.min(PAGE_SIZE, Math.max(1, safeNumber(extras.limit, PAGE_SIZE)));
  const skip = Math.min(1_000_000, safeNumber(extras.skip, 0));
  const offset = (genrePage - 1) * PAGE_SIZE + skip;
  const sql = [
    "SELECT id, title, author, language, genres_json, poster, year, chapter_count",
    "FROM books",
    where.length ? "WHERE " + where.join(" AND ") : "",
    "ORDER BY title COLLATE NOCASE, id",
    "LIMIT ? OFFSET ?",
  ].filter(Boolean).join(" ");
  bind.push(limit, offset);
  return { sql, bind };
}

async function getCatalog(db, route, extras) {
  if (route.type !== "movie") return json({ metas: [] });

  const lang = LANGUAGES.some((language) => "librivox_lang_" + language.slug === route.id);
  const genre = /^librivox_genre_[a-z0-9-]+(?:_p\d+)?$/.test(route.id);
  const audioType = /^librivox_type_[a-z0-9_]+$/.test(route.id) &&
    Object.prototype.hasOwnProperty.call(TYPE_FILTERS, route.id.slice("librivox_type_".length));
  const alpha = /^librivox_alpha_(?:0_9|other|[a-z]_[a-z])$/.test(route.id);
  const search = route.id === "librivox_search";
  if (!lang && !genre && !audioType && !alpha && !search) return json({ metas: [] });

  // Search is a filter-only row and must never return the whole library by accident.
  if (search && !extras.search) return json({ metas: [] });
  if (!db) return json({ error: "Catalogue database is not configured yet." }, 503);

  const { sql, bind } = bookQuery(route.id, extras);
  const result = await db.prepare(sql).bind(...bind).all();
  return json({ metas: (result.results || []).map(toMetaPreview) });
}

async function getMeta(db, route) {
  if (route.type !== "movie") return json({ meta: null });
  if (!db) return json({ error: "Catalogue database is not configured yet." }, 503);
  const book = await db.prepare(
    "SELECT id, title, author, language, genres_json, description, poster, year, chapter_count FROM books WHERE id = ? LIMIT 1"
  ).bind(route.id).first();
  if (!book) return json({ meta: null });
  const genres = readJsonArray(book.genres_json);
  const description = [
    book.description || "",
    "",
    "Language: " + book.language,
    "Author: " + (book.author || "Unknown author"),
    "Genres: " + (genres.length ? genres.join(", ") : "Unclassified"),
    "Audio tracks/chapters: " + safeNumber(book.chapter_count, 0),
  ].filter((line, index, array) => line || (index > 0 && array[index - 1])).join("\n");
  return json({
    meta: {
      id: book.id,
      type: "movie",
      name: book.title,
      poster: book.poster || FALLBACK_POSTER,
      background: book.poster || FALLBACK_POSTER,
      description,
      genres,
      director: book.author && book.author !== "Unknown author" ? [book.author] : [],
      cast: [],
      releaseInfo: book.year ? String(book.year) : undefined,
    },
  });
}

async function getStreams(db, route) {
  if (route.type !== "movie") return json({ streams: [] });
  if (!db) return json({ error: "Catalogue database is not configured yet." }, 503);
  const row = await db.prepare("SELECT title, chapters_json FROM books WHERE id = ? LIMIT 1")
    .bind(route.id).first();
  if (!row) return json({ streams: [] });
  const chapters = readJsonArray(row.chapters_json);
  return json({
    streams: chapters.filter((chapter) => /^https?:\/\//i.test(chapter.url || "")).map((chapter, index) => {
      const duration = safeNumber(chapter.duration, 0);
      const minutes = duration ? " (" + Math.round(duration / 60) + " min)" : "";
      return {
        url: chapter.url,
        title: (chapter.title || "Track " + (index + 1)) + minutes,
        name: "LibriVox",
      };
    }),
  });
}

async function handleRequest(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET, HEAD, OPTIONS" });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (!env.DB) return json({ ok: false, database: "not_configured" }, 503, { "Cache-Control": "no-store" });
      try {
        const row = await env.DB.prepare("SELECT COUNT(*) AS books FROM books").first();
        return json({ ok: true, books: safeNumber(row?.books), service: "librivox-audiobook-addon" }, 200, { "Cache-Control": "no-store" });
      } catch {
        return json({ ok: false, database: "not_initialized" }, 503, { "Cache-Control": "no-store" });
      }
    }
    if (url.pathname === "/manifest.json") {
      return json(await buildManifest(env.DB), 200, { "Cache-Control": "public, max-age=300" });
    }
    if (url.pathname === "/") {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>LibriVox Audiobooks Addon</title><h1>LibriVox Audiobooks</h1><p>Install the addon using <a href="/manifest.json">manifest.json</a>.</p><p><a href="/health">Health status</a></p>',
        { headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const route = parseRoute(url.pathname);
    if (!route) return json({ error: "Not found" }, 404);
    const extras = parseExtras(url, route.rawExtra);
    try {
      if (route.resource === "catalog") return await getCatalog(env.DB, route, extras);
      if (route.resource === "meta") return await getMeta(env.DB, route);
      if (route.resource === "stream") return await getStreams(env.DB, route);
      return json({ error: "Unsupported resource" }, 404);
    } catch (error) {
      // Keep implementation details and SQL out of the public response.
      console.error("Addon request failed", error);
      return json({ error: "Catalogue request failed. Check the Worker logs." }, 500);
    }
}

export default {
  async fetch(request, env) {
    if (request.method === "HEAD") {
      const getRequest = new Request(request.url, {
        method: "GET",
        headers: request.headers,
      });
      const response = await handleRequest(getRequest, env);
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return handleRequest(request, env);
  },
};
