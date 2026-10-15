import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVerificationQuery,
  extractVerificationRow,
  compareVerification,
  verifyWranglerPayload,
} from "../scripts/verify-d1-import.mjs";

const summary = {
  importGeneration: "0123456789abcdef01234567",
  books: 3,
  chapters: 8,
  genres: 4,
  languages: {
    English: 1,
    Bangla: 1,
    Hindi: 0,
    Urdu: 1,
    Arabic: 0,
    Turkish: 0,
  },
};

function row() {
  return {
    books: 3,
    genres: 4,
    chapters: 8,
    generation_books: 3,
    stale_books: 0,
    generation_genres: 4,
    stale_genres: 0,
    books_english: 1,
    books_bangla: 1,
    books_hindi: 0,
    books_urdu: 1,
    books_arabic: 0,
    books_turkish: 0,
  };
}

test("verification query checks total, generation, stale rows, chapters and all six languages", () => {
  const query = buildVerificationQuery(summary);
  assert.match(query, /COUNT\(\*\) FROM books/);
  assert.match(query, /import_generation = '0123456789abcdef01234567'/);
  assert.match(query, /import_generation IS NULL OR import_generation <>/);
  assert.match(query, /SUM\(chapter_count\)/);
  for (const language of ["English", "Bangla", "Hindi", "Urdu", "Arabic", "Turkish"]) {
    assert.ok(query.includes("language = '" + language + "'"));
  }
});

test("verification parser reads Wrangler D1 execute JSON and checks a matching snapshot", () => {
  const payload = [{
    success: true,
    results: [row()],
    meta: { served_by: "d1" },
    query: "SELECT ...",
  }];
  assert.deepEqual(extractVerificationRow(payload), row());
  const result = verifyWranglerPayload(summary, payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test("verification fails when row counts or stale-generation rows differ", () => {
  const actual = row();
  actual.books = 2;
  actual.generation_books = 2;
  actual.stale_books = 1;
  actual.books_bangla = 0;
  const result = compareVerification(summary, actual);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches.map(item => item.field), [
    "books", "generation_books", "stale_books", "books_bangla"
  ]);
});

test("verification rejects malformed source summaries and missing Wrangler result rows", () => {
  assert.throws(() => buildVerificationQuery({ ...summary, importGeneration: "bad" }), /generation marker/i);
  assert.throws(() => extractVerificationRow([{ success: true, results: [] }]), /no result row/i);
  assert.throws(() => extractVerificationRow([{ results: [{ books: "not-a-count" }] }]), /no result row/i);
});
