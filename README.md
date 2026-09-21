# 🎧 Cinemeta of Audiobooks

A comprehensive, cinema-grade audiobook discovery, metadata, and source-aggregation engine for Stremio and Nuvio.

## Features
- **Rich Metadata**: Synthesizes data from Apple Books, Google Books, Open Library, and Audnexus into a single "Golden Record".
- **Smart Deduplication**: Two-tier identity resolution preserves distinct narrations while eliminating duplicates.
- **Native Tab Grouping**: Chapter MP3s and full recordings from LibriVox and Internet Archive are organized in separate tabs with durations.
- **Cross-Addon Compatibility**: Standard `isbn:`, `asin:`, and `olid:` prefixes allow downstream add-ons to provide companion streams.
- **Fully Configurable**: Toggle individual catalogues, activate "Public Domain Only" mode, or hide abridged versions via the settings page.

## Catalogues
- Bestsellers
- New Releases
- Popular & Trending
- Top Rated
- Award Winners
- Full Cast Dramatizations
- Book Series
- By Narrator
- Genres
- Search

## Local Testing
1. Run `npm install`
2. Run `npm start`
3. Install in Stremio via: `stremio://localhost:7000/manifest.json`

## Deployment
Deploy to a persistent Node.js host like [Railway](https://railway.app/) or [Fly.io](https://fly.io/):
- Set `PORT` (assigned automatically by host).
- Set `ADDON_PUBLIC_URL` to your production URL.
- Install via: `stremio://<your-domain>/manifest.json`
