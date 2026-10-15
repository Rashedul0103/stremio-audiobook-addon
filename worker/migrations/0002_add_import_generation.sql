-- Track which source snapshot last refreshed each row. The importer only prunes rows
-- from older snapshots after all upsert batches have completed successfully.
ALTER TABLE books ADD COLUMN import_generation TEXT NOT NULL DEFAULT '';
ALTER TABLE genres ADD COLUMN import_generation TEXT NOT NULL DEFAULT '';
