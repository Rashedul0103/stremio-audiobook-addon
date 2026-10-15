CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Unknown author',
  language TEXT NOT NULL,
  genres_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  poster TEXT,
  year INTEGER,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  chapters_json TEXT NOT NULL DEFAULT '[]',
  search_text TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_books_language_title
  ON books(language, title COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_books_title
  ON books(title COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_books_author
  ON books(author COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS genres (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
