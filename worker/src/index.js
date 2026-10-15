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
      chapterCount ? "Audio tracks/chapters: " + chapterCount : "",
    ].filter(Boolean).join("\n"),
    genres,
    director: author,
    cast: [],
    releaseInfo: book.year ? String(book.year) : undefined,
  };
}

function baseCatalogs(genres) {
  const skip = { name: "skip", isRequired: false };
  const search = { name: "search", isRequired: false };
  const catalogs = [
    { type: "movie", id: "librivox_all", name: "LibriVox · All Audiobooks", extra: [search, skip] },
    { type: "movie", id: "librivox_author", name: "LibriVox · Search by Author", extra: [{ name: "author", isRequired: true }, skip] },
    { type: "movie", id: "librivox_genre", name: "LibriVox · Browse by Genre", extra: [{ name: "genre", isRequired: true, options: genres }, skip] },
    { type: "movie", id: "librivox_search", name: "LibriVox · Search Books", extra: [{ name: "search", isRequired: true }, skip] },
  ];
  for (const language of LANGUAGES) {
    catalogs.push({
      type: "movie",
      id: "librivox_lang_" + language.slug,
      name: "LibriVox · " + language.name,
      extra: [search, skip],
    });
  }
  return catalogs;
}

export async function buildManifest(db) {
  let genres = FALLBACK_GENRES;
  if (db) {
    try {
      const result = await db.prepare("SELECT name FROM genres ORDER BY name COLLATE NOCASE").all();
      const names = (result.results || []).map((row) => row.name).filter(Boolean);
      if (names.length) genres = names;
    } catch {
      // Keep the manifest available while the database is being initialized.
    }
  }
  return {
    id: "org.rashedul0103.librivox",
    version: "1.0.0",
    name: "LibriVox Audiobooks",
    description: "Browse LibriVox recordings by language, genre, author and book title.",
    logo: FALLBACK_POSTER,
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    idPrefixes: ["lvb-"],
    catalogs: baseCatalogs(genres),
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
  if (catalogId === "librivox_genre" && extras.genre) {
    where.push("EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) = lower(?))");
    bind.push(extras.genre.slice(0, 100));
  }
  if (catalogId === "librivox_author" && extras.author) {
    where.push("instr(lower(author), lower(?)) > 0");
    bind.push(extras.author.slice(0, 160));
  }
  const searchTerm = extras.search;
  if (searchTerm && catalogId !== "librivox_author") {
    where.push("instr(lower(search_text), lower(?)) > 0");
    bind.push(searchTerm.slice(0, 160));
  }
  const limit = Math.min(PAGE_SIZE, Math.max(1, safeNumber(extras.limit, PAGE_SIZE)));
  const skip = Math.min(1_000_000, safeNumber(extras.skip, 0));
  const sql = [
    "SELECT id, title, author, language, genres_json, poster, year, chapter_count",
    "FROM books",
    where.length ? "WHERE " + where.join(" AND ") : "",
    "ORDER BY title COLLATE NOCASE, id",
    "LIMIT ? OFFSET ?",
  ].filter(Boolean).join(" ");
  bind.push(limit, skip);
  return { sql, bind };
}

async function getCatalog(db, route, extras) {
  if (route.type !== "movie") return json({ metas: [] });

  const allowedCatalogs = new Set([
    "librivox_all",
    "librivox_author",
    "librivox_genre",
    "librivox_search",
    ...LANGUAGES.map((language) => "librivox_lang_" + language.slug),
  ]);
  if (!allowedCatalogs.has(route.id)) return json({ metas: [] });

  // Required filters should never accidentally turn a filtered catalogue into
  // an unfiltered dump of the entire library.
  if (route.id === "librivox_author" && !extras.author) return json({ metas: [] });
  if (route.id === "librivox_genre" && !extras.genre) return json({ metas: [] });
  if (route.id === "librivox_search" && !extras.search) return json({ metas: [] });
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
