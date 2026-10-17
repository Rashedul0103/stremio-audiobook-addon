-- Add official LibriVox project metadata to improve Nuvio detail pages.
ALTER TABLE books ADD COLUMN copyright_year INTEGER;
ALTER TABLE books ADD COLUMN librivox_id INTEGER;
ALTER TABLE books ADD COLUMN total_duration_seconds INTEGER;
ALTER TABLE books ADD COLUMN total_duration TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN url_librivox TEXT;
ALTER TABLE books ADD COLUMN url_rss TEXT;
ALTER TABLE books ADD COLUMN url_zip_file TEXT;
ALTER TABLE books ADD COLUMN url_project TEXT;
ALTER TABLE books ADD COLUMN url_text_source TEXT;
ALTER TABLE books ADD COLUMN reader_names_json TEXT NOT NULL DEFAULT '[]';
