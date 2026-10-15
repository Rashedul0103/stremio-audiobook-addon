# Cloudflare Worker deployment for LibriVox Audiobooks

This folder adds a native Cloudflare Worker endpoint for Nuvio/Stremio-compatible audiobook catalogues. It is separate from the existing Node.js addon, so the existing implementation is preserved.

## What it provides

- One addon manifest URL: `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/manifest.json`
- Separate catalogue rows for English, Bangla, Hindi, Urdu, Arabic and Turkish.
- Genre browsing, author filtering, and title/author search.
- Book metadata with playable chapter/audio URLs.
- Cloudflare D1 storage with one row per book, avoiding one database row per audio chapter.
- CORS headers for client apps.

The Worker implements the standard Stremio addon routes: `/manifest.json`, `/catalog/movie/{catalogId}.json`, `/meta/movie/{bookId}.json`, and `/stream/movie/{bookId}.json`. Nuvio Enhanced compatibility still needs to be confirmed by installing and testing the deployed URL inside the app.

## Free-tier setup

This design uses Workers and D1 only; it does not require a VPS or a traditional always-on server. Keep the Cloudflare account on the Free plan. Do not enable paid services or upgrade the plan.

1. Create a Cloudflare account.
2. Create a D1 database named `librivox-audiobooks` from the Cloudflare dashboard, or with Wrangler:
   ```sh
   npx wrangler@4 d1 create librivox-audiobooks
   ```
3. Copy the database UUID shown by Cloudflare. In `worker/wrangler.jsonc`, replace the all-zero placeholder in `database_id` with that UUID.
4. In the GitHub repository settings, add these Actions secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN` with the minimum Workers and D1 edit permissions required by Wrangler.
5. Merge the Worker files into `main`. The deploy workflow applies the D1 schema and deploys the Worker.
6. Open the GitHub Actions tab and manually run **Import LibriVox catalogue into D1**. This downloads the public `Rashedul0103/librivox_audiobooks` source repository, converts the six-language generated M3Us into book records, and imports them into D1.

The all-zero UUID is a setup placeholder, not a live database ID. Deployment and import will fail until it is replaced and the two repository secrets are configured. No Cloudflare deployment has been performed by this code change.

## Local checks

From the repository root:

```sh
node --check worker/src/index.js
node --test worker/test/worker.test.js
node --check scripts/build-librivox-d1-import.mjs
```

To run a local Worker after configuring Wrangler:

```sh
cd worker
npx wrangler@4 dev
```

The catalogue routes return a service error until the D1 migration has been applied and the import workflow has populated the database.

## Catalogue import notes

The importer reads the generated `filtered/by-language`, `filtered/by-genre`, and `filtered/by-title` playlists. It groups track URLs by title and language, preserving chapter names, durations, genres, authors, and direct audio URLs. Chapter lists are stored as JSON on each book record, so the initial import stays below D1's daily row-write limit for this catalogue size.

The source M3U playlist is not modified. The original Node.js addon is not deleted or replaced. The Worker uses the existing LibriVox playlist repository as its input; it does not mirror or rehost the audio files.

## Public service safety

This is a public, read-only API. It has no database-write endpoint exposed to clients. Search terms are parameter-bound, returned catalogues are paginated, and errors do not expose SQL or internal exception details. Review Cloudflare's current Free-plan quotas before opening the URL to high-volume public use.
