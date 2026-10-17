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

const HIDDEN_GENRE_KEYS = new Set([
  "nonfictionbibles", "nonfictionbiblesamericanstandardversion",
  "nonfictionbiblesdouayrheimsversion", "nonfictionbibleskingjamesversion",
  "nonfictionbiblesweymouthnewtestament", "nonfictionbiblesworldenglishbible",
  "nonfictionbiblesyoungsliteraltranslation", "nonfictionreligion",
  "nonfictionreligionchristianitybiographies", "nonfictionreligionchristianitycommentary",
  "nonfictionreligionchristianityother",
]);
const GENRE_SECTIONS = {
  1: "General fiction, fantasy and adventure",
  2: "Children's fiction and nonfiction",
  3: "Crime, suspense and drama",
  4: "Poetry and short stories",
  5: "Nonfiction: general subjects",
  6: "History and philosophy",
  7: "Religion and scripture",
  8: "Other source categories",
};
const CURATED_SHELVES = [
  { id: "plays_dramatic", name: "Plays and dramatic works", filter: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%plays%' OR lower(value) LIKE '%dramatic reading%' OR lower(value) LIKE '%audio drama%')" },
  { id: "poetry_verse", name: "Poetry and verse", filter: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%poetry%' OR lower(value) LIKE '%poem%' OR lower(value) LIKE '%verse%')" },
  { id: "short_works", name: "Short works and collections", filter: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%short stor%' OR lower(value) LIKE '%antholog%' OR lower(value) LIKE '%short work%' OR lower(value) LIKE '%literary collections%' OR lower(value) LIKE '%essays%')" },
  { id: "children_literary", name: "Children's literary works", filter: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%children%' OR lower(value) LIKE '%young adult%')" },
  { id: "general_literary", name: "General literary fiction", filter: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%fiction%' AND lower(value) NOT LIKE '%children%' AND lower(value) NOT LIKE '%religious fiction%')" },
  { id: "historical_literary", name: "Historical literary works", filter: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%historical fiction%' OR lower(value) LIKE '%history%')" },
  { id: "scientific_educational", name: "Scientific and educational works", filter: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%science%' OR lower(value) LIKE '%education%' OR lower(value) LIKE '%mathematics%' OR lower(value) LIKE '%language learning%')" },
  { id: "reference_unclassified", name: "Reference and unclassified works", filter: "EXISTS (SELECT 1 FROM json_each(books.genres_json) WHERE lower(value) LIKE '%reference%' OR lower(value) LIKE '%other unclassified%')" },
];

function normalizedGenreKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isHiddenGenreName(value) {
  return HIDDEN_GENRE_KEYS.has(normalizedGenreKey(value));
}
function genreSectionNumber(genre) {
  const slug = String(genre?.slug || "").toLowerCase();
  if (/^(asian-antiquity|action-adventure-fiction|classics-greek-latin|culture-heritage|epistolary|family-life|fantastic-fiction|fictional-biographies|general-fiction|historical-fiction|humorous-fiction|literary-fiction|nature-animal-fiction|nautical-marine-fiction|romance$|sagas$|satire$|sports-fiction|travel-fiction|war-military-fiction|westerns$)/.test(slug)) return 1;
  if (/^(children|children-s-)/.test(slug)) return 2;
  if (/^(crime-mystery-fiction|dramatic-readings|erotica$|plays|suspense-espionage)/.test(slug)) return 3;
  if (/^(poetry|short-stories)/.test(slug)) return 4;
  if (/^(non-fiction-history|non-fiction-philosophy|non-fiction-political-science|non-fiction-psychology)/.test(slug)) return 6;
  if (/^(religious-fiction|non-fiction-religion-other-religions)/.test(slug)) return 7;
  if (/^non-fiction/.test(slug)) return 5;
  if (/^other-unclassified/.test(slug)) return 8;
  return 8;
}
function displayGenreName(value) {
  return String(value || "").replace(/\bNon[- ]Fiction\b/gi, "Nonfiction")
    .replace(/\s+(?:-|–|—)\s+/g, " — ").replace(/\s*&\s*/g, " & ")
    .replace(/\s+/g, " ").trim();
}
function genreCatalogLabel(genre) {
  const number = genreSectionNumber(genre);
  return number + ". " + GENRE_SECTIONS[number] + " · " + displayGenreName(genre.name);
}

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

function readerNames(book) {
  return readJsonArray(book.reader_names_json)
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => name.trim());
}
function formatRuntime(seconds) {
  const total = safeNumber(seconds, 0);
  if (!total) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return hours ? hours + "h " + minutes + "m" : minutes + "m";
}
function posterUrl(book, origin = "") {
  if (!book.poster) return FALLBACK_POSTER;
  if (!origin) return book.poster;
  return origin + "/cover/" + encodeURIComponent(book.id) + ".jpg?v=" + encodeURIComponent(book.poster);
}
function metadataDescription(book, genres) {
  const readers = readerNames(book);
  const runtime = book.total_duration || formatRuntime(book.total_duration_seconds);
  const lines = [
    String(book.description || "").trim() || "LibriVox public-domain audiobook.",
    "",
    "Language: " + (book.language || "Unknown"),
    "Author: " + (book.author && book.author !== "Unknown author" ? book.author : "Unknown author"),
    "Genres: " + (genres.length ? genres.join(", ") : "Unclassified"),
    "Audio tracks/chapters: " + safeNumber(book.chapter_count, 0),
    runtime ? "Total runtime: " + runtime : "",
    book.copyright_year ? "Source text copyright year: " + book.copyright_year : "",
    book.librivox_id ? "LibriVox project ID: " + book.librivox_id : "",
    readers.length ? "Readers: " + readers.join(", ") : "",
    book.url_librivox ? "LibriVox catalogue: " + book.url_librivox : "",
    book.url_text_source ? "Source text: " + book.url_text_source : "",
    book.url_rss ? "RSS feed: " + book.url_rss : "",
    book.url_zip_file ? "ZIP download: " + book.url_zip_file : "",
    book.url_project ? "Project forum: " + book.url_project : "",
  ];
  return lines.filter((line, index) => line || index === 0).join("\n");
}
export function toMetaPreview(book, origin = "") {
  const genres = readJsonArray(book.genres_json).filter((genre) => !isHiddenGenreName(genre));
  const author = book.author && book.author !== "Unknown author" ? [book.author] : [];
  const readers = readerNames(book);
  const poster = posterUrl(book, origin);
  const runtime = book.total_duration || formatRuntime(book.total_duration_seconds) || undefined;
  return {
    id: book.id, type: "movie", name: book.title, poster, background: poster,
    description: metadataDescription(book, genres),
    genres, director: author, cast: readers, runtime,
    website: book.url_librivox || undefined,
    links: [
      book.url_librivox ? { name: "LibriVox catalogue", category: "other", url: book.url_librivox } : null,
      book.url_text_source ? { name: "Source text", category: "other", url: book.url_text_source } : null,
      book.url_rss ? { name: "RSS feed", category: "other", url: book.url_rss } : null,
      book.url_zip_file ? { name: "Download ZIP", category: "other", url: book.url_zip_file } : null,
      book.url_project ? { name: "Project forum", category: "other", url: book.url_project } : null,
    ].filter(Boolean),
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

  // One row per genre, no matter how large it is. Large rows use skip pagination.
  const orderedGenres = (genres || [])
    .filter((genre) => genre?.name && genre?.slug && !isHiddenGenreName(genre.name))
    .sort((a, b) => genreSectionNumber(a) - genreSectionNumber(b) ||
      displayGenreName(a.name).localeCompare(displayGenreName(b.name), undefined, { sensitivity: "base" }));
  for (const genre of orderedGenres) {
    catalogs.push({
      type: "movie",
      id: "librivox_genre_" + genre.slug,
      name: genreCatalogLabel(genre),
      extra: [skip],
    });
  }
  for (const shelf of CURATED_SHELVES) {
    catalogs.push({
      type: "movie",
      id: "librivox_collection_" + shelf.id,
      name: "8. Other source categories · " + shelf.name,
      extra: [skip],
    });
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
    version: "1.2.0",
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
  if (catalogId.startsWith("librivox_collection_")) {
    const collectionId = catalogId.slice("librivox_collection_".length);
    const shelf = CURATED_SHELVES.find((item) => item.id === collectionId);
    if (shelf) where.push("(" + shelf.filter + ")");
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
    "SELECT id, title, author, language, genres_json, poster, year, chapter_count, description, copyright_year, librivox_id, total_duration_seconds, total_duration, url_librivox, url_rss, url_zip_file, url_project, url_text_source, reader_names_json",
    "FROM books",
    where.length ? "WHERE " + where.join(" AND ") : "",
    "ORDER BY title COLLATE NOCASE, COALESCE(librivox_id, 0) DESC, COALESCE(copyright_year, 0) DESC, id",
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
  const collection = /^librivox_collection_[a-z0-9_]+$/.test(route.id) &&
    CURATED_SHELVES.some((shelf) => "librivox_collection_" + shelf.id === route.id);
  const alpha = /^librivox_alpha_(?:0_9|other|[a-z]_[a-z])$/.test(route.id);
  const search = route.id === "librivox_search";
  if (!lang && !genre && !audioType && !collection && !alpha && !search) return json({ metas: [] });

  // Search is a filter-only row and must never return the whole library by accident.
  if (search && !extras.search) return json({ metas: [] });
  if (!db) return json({ error: "Catalogue database is not configured yet." }, 503);

  const { sql, bind } = bookQuery(route.id, extras);
  const result = await db.prepare(sql).bind(...bind).all();
  return json({ metas: (result.results || []).map((book) => toMetaPreview(book, route.origin || "")) });
}

async function getMeta(db, route) {
  if (route.type !== "movie") return json({ meta: null });
  if (!db) return json({ error: "Catalogue database is not configured yet." }, 503);
  const book = await db.prepare(
    "SELECT id, title, author, language, genres_json, description, poster, year, chapter_count, copyright_year, librivox_id, total_duration_seconds, total_duration, url_librivox, url_rss, url_zip_file, url_project, url_text_source, reader_names_json FROM books WHERE id = ? LIMIT 1"
  ).bind(route.id).first();
  if (!book) return json({ meta: null });
  const genres = readJsonArray(book.genres_json).filter((genre) => !isHiddenGenreName(genre));
  const meta = toMetaPreview(book, route.origin || "");
  meta.description = metadataDescription(book, genres);
  return json({ meta });
}

async function getCover(db, bookId) {
  if (!db) return Response.redirect(FALLBACK_POSTER, 302);
  const book = await db.prepare("SELECT poster FROM books WHERE id = ? LIMIT 1").bind(bookId).first();
  if (!book?.poster) return Response.redirect(FALLBACK_POSTER, 302);
  let source;
  try { source = new URL(book.poster); }
  catch { return Response.redirect(FALLBACK_POSTER, 302); }

  const host = source.hostname.toLowerCase();
  const trustedHost = host === "librivox.org" || host.endsWith(".librivox.org") ||
    host === "archive.org" || host.endsWith(".archive.org");
  if (source.protocol !== "https:" || !trustedHost) return Response.redirect(FALLBACK_POSTER, 302);

  try {
    const upstream = await fetch(source.toString(), {
      headers: { Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" },
      cf: { cacheTtl: 2592000, cacheEverything: true },
    });
    const contentType = upstream.headers.get("Content-Type") || "";
    if (!upstream.ok || !contentType.toLowerCase().startsWith("image/")) {
      return Response.redirect(FALLBACK_POSTER, 302);
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS, "Content-Type": contentType,
        "Cache-Control": "public, max-age=2592000, s-maxage=2592000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.redirect(FALLBACK_POSTER, 302);
  }
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
    const coverMatch = url.pathname.match(/^\/cover\/(lvb-[a-z0-9-]+)\.jpg$/i);
    if (coverMatch) return await getCover(env.DB, coverMatch[1]);
    if (url.pathname === "/") {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>LibriVox Audiobooks Addon</title><h1>LibriVox Audiobooks</h1><p>Install the addon using <a href="/manifest.json">manifest.json</a>.</p><p><a href="/health">Health status</a></p>',
        { headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const route = parseRoute(url.pathname);
    if (!route) return json({ error: "Not found" }, 404);
    route.origin = url.origin;
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
