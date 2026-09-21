import { AppleBooksProvider } from '../providers/apple.js';
import { OpenLibraryProvider } from '../providers/openlib.js';
import { GoogleBooksProvider } from '../providers/google.js';
import { AudnexusProvider } from '../providers/audnexus.js';
import { LibriVoxProvider, InternetArchiveProvider } from '../providers/streams.js';
import { generateWorkFingerprint, generateSlug, cleanNarrator } from '../utils/normalizer.js';
import { normalizeGenres, extractAwards } from '../utils/genreMapper.js';
import { catalogCache, metaCache } from './cache.js';

export class Aggregator {
    constructor() {
        this.providers = {
            apple: new AppleBooksProvider(),
            openlib: new OpenLibraryProvider(),
            google: new GoogleBooksProvider(),
            audnexus: new AudnexusProvider(),
            librivox: new LibriVoxProvider(),
            internetarchive: new InternetArchiveProvider()
        };
    }

    /**
     * Unified Cluster Matching:
     * Links items by ISBN, ASIN, OLID, or Work Fingerprint (title:author) into one cluster.
     */
    _clusterItems(items) {
        const clusters = [];
        const idToCluster = new Map();

        for (const item of items) {
            if (!item || !item.title) continue;

            const ext = item.externalIds || {};
            const workFp = generateWorkFingerprint(item.title, item.authors);
            
            // Gather all candidate identity keys for this item
            const keys = [];
            if (item.id?.startsWith('isbn:')) keys.push(item.id);
            if (ext.isbn) keys.push(`isbn:${ext.isbn}`);
            if (item.id?.startsWith('asin:')) keys.push(item.id);
            if (ext.asin) keys.push(`asin:${ext.asin}`);
            if (item.id?.startsWith('olid:')) keys.push(item.id);
            if (workFp && workFp !== ':') keys.push(`work:${workFp}`);

            // Find if any key matches an existing cluster
            let targetCluster = null;
            for (const key of keys) {
                if (idToCluster.has(key)) {
                    targetCluster = idToCluster.get(key);
                    break;
                }
            }

            if (!targetCluster) {
                targetCluster = [];
                clusters.push(targetCluster);
            }

            targetCluster.push(item);
            for (const key of keys) {
                idToCluster.set(key, targetCluster);
            }
        }

        // Deduplicate clusters (in case references merged)
        return Array.from(new Set(clusters));
    }

    _mergeGroup(group) {
        if (!group || group.length === 0) return null;

        const canonical = {
            id: null, type: 'movie', title: '', poster: null, background: null,
            description: null, genres: [], authors: [], narrators: [], year: null,
            abridged: null, series: null, ratings: null, awards: [], streams: [],
            externalIds: {}, isPublicDomain: false
        };

        const providerPriority = { audnexus: 6, apple: 5, openlib: 4, google: 3, librivox: 2, ia: 1 };
        group.sort((a, b) => (providerPriority[b.provider] || 0) - (providerPriority[a.provider] || 0));

        const rawNarrators = [];

        for (const item of group) {
            // Assign canonical ID with priority: ISBN -> ASIN -> OLID -> LibriVox -> Slug
            if (!canonical.id) {
                if (item.id?.startsWith('isbn:')) canonical.id = item.id;
                else if (item.externalIds?.isbn) canonical.id = `isbn:${item.externalIds.isbn}`;
                else if (item.id?.startsWith('asin:')) canonical.id = item.id;
                else if (item.externalIds?.asin) canonical.id = `asin:${item.externalIds.asin}`;
                else if (item.id?.startsWith('olid:')) canonical.id = item.id;
                else if (item.id?.startsWith('librivox:')) canonical.id = item.id;
            }

            if (item.externalIds) {
                Object.assign(canonical.externalIds, item.externalIds);
            }

            if (!canonical.title && item.title) canonical.title = item.title;
            if (!canonical.poster && item.poster) canonical.poster = item.poster;
            if (!canonical.background && item.background) canonical.background = item.background;
            if (!canonical.description && item.description) canonical.description = item.description;
            if (!canonical.year && item.year) canonical.year = item.year;
            if (canonical.abridged === null && item.abridged !== undefined) canonical.abridged = item.abridged;
            if (!canonical.series && item.series?.length > 0) canonical.series = item.series[0];
            if (!canonical.ratings && item.ratings) canonical.ratings = item.ratings;

            if (item.authors?.length) {
                canonical.authors = [...new Set([...canonical.authors, ...item.authors])];
            }
            if (item.narrators?.length) {
                for (const n of item.narrators) {
                    if (n && cleanNarrator(n) !== 'unknown') rawNarrators.push(n);
                }
            }
            if (item.genres?.length) {
                canonical.genres = [...new Set([...canonical.genres, ...normalizeGenres(item.genres)])];
            }
            if (item.awards?.length) {
                canonical.awards = [...new Set([...canonical.awards, ...item.awards])];
            }
            if (item.isPublicDomain) canonical.isPublicDomain = true;
        }

        // Smart Narrator Preservation (Preserves original uppercase formatting)
        canonical.narrators = rawNarrators.length > 0 ? [...new Set(rawNarrators)] : ['Unknown'];

        if (!canonical.id) {
            const slug = generateSlug(`${canonical.title} ${canonical.authors[0] || ''}`);
            canonical.id = slug ? `slug:${slug}` : `hash:${Date.now()}`;
        }

        return canonical;
    }

    async searchAndSynthesize(query, skip = 0) {
        const cacheKey = `agg_search_${query}_${skip}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const [appleRes, googleRes, openlibRes, librivoxRes] = await Promise.allSettled([
            this.providers.apple.search(query, skip),
            this.providers.google.search(query, skip),
            this.providers.openlib.search(query, skip),
            this.providers.librivox.search(query, skip)
        ]);

        const allResults = [
            ...(appleRes.status === 'fulfilled' ? appleRes.value : []),
            ...(googleRes.status === 'fulfilled' ? googleRes.value : []),
            ...(openlibRes.status === 'fulfilled' ? openlibRes.value : []),
            ...(librivoxRes.status === 'fulfilled' ? librivoxRes.value : [])
        ];

        const clusters = this._clusterItems(allResults);
        const synthesized = [];

        for (const group of clusters) {
            // Check for distinctly verified narrators
            const narratorMap = new Map();
            for (const item of group) {
                for (const narr of (item.narrators || [])) {
                    const cleaned = cleanNarrator(narr);
                    if (cleaned !== 'unknown') narratorMap.set(cleaned, narr);
                }
            }

            if (narratorMap.size > 1) {
                // Bifurcate into distinct edition cards for each verified narrator
                for (const [cleanedKey] of narratorMap) {
                    const filteredGroup = group.filter(item => {
                        const hasThisNarrator = (item.narrators || []).some(n => cleanNarrator(n) === cleanedKey);
                        const hasNoNarrator = !item.narrators || item.narrators.length === 0 || cleanNarrator(item.narrators) === 'unknown';
                        return hasThisNarrator || hasNoNarrator;
                    });
                    synthesized.push(this._mergeGroup(filteredGroup));
                }
            } else {
                synthesized.push(this._mergeGroup(group));
            }
        }

        catalogCache.set(cacheKey, synthesized);
        return synthesized;
    }

    async getMetaAndSynthesize(id) {
        const cacheKey = `agg_meta_${id}`;
        if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

        let results = [];

        if (id.startsWith('isbn:')) {
            const isbn = id.substring(5);
            const [googleRes, openlibRes] = await Promise.allSettled([
                this.providers.google.getMeta(id),
                this.providers.openlib.getMeta(id)
            ]);
            if (googleRes.status === 'fulfilled' && googleRes.value) results.push(googleRes.value);
            if (openlibRes.status === 'fulfilled' && openlibRes.value) results.push(openlibRes.value);

            const title = results[0]?.title;
            const author = results[0]?.authors?.[0];
            if (title) {
                const appleRes = await this.providers.apple.search(`${title} ${author || ''}`);
                if (appleRes?.length > 0) results.push(appleRes[0]);
            }
        } else if (id.startsWith('asin:')) {
            const res = await this.providers.audnexus.getMeta(id);
            if (res) results.push(res);
        } else if (id.startsWith('olid:')) {
            const res = await this.providers.openlib.getMeta(id);
            if (res) results.push(res);
        } else if (id.startsWith('librivox:')) {
            const res = await this.providers.librivox.getMeta(id);
            if (res) {
                results.push(res);
                if (res.title) {
                    const appleRes = await this.providers.apple.search(`${res.title} ${res.authors?.[0] || ''}`);
                    if (appleRes?.length > 0) results.push(appleRes[0]);
                }
            }
        } else if (id.startsWith('slug:')) {
            const cleanQuery = id.substring(5).replace(/-/g, ' ');
            const searchResults = await this.searchAndSynthesize(cleanQuery, 0);
            if (searchResults.length > 0) {
                metaCache.set(cacheKey, searchResults[0]);
                return searchResults[0];
            }
        }

        if (results.length === 0) return null;

        // All results fetched for this ID belong to this single canonical record
        const merged = this._mergeGroup(results);
        metaCache.set(cacheKey, merged);
        return merged;
    }

    /**
     * Resolves playable streams with automatic LibriVox fallback for ISBN/Slug items
     */
    async getStreams(id) {
        let streams = [];

        if (id.startsWith('librivox:')) {
            const res = await this.providers.librivox.getStreams(id);
            if (res) streams.push(...res);
        } else if (id.startsWith('ia:')) {
            const res = await this.providers.internetarchive.getStreams(id);
            if (res) streams.push(...res);
        } else {
            // For isbn:, asin:, or slug:, resolve metadata and query LibriVox by title
            const meta = await this.getMetaAndSynthesize(id);
            if (meta?.title) {
                const query = `${meta.title} ${meta.authors?.[0] || ''}`.trim();
                const lvBooks = await this.providers.librivox.search(query, 0);
                if (lvBooks.length > 0) {
                    const lvStreams = await this.providers.librivox.getStreams(lvBooks[0].id);
                    if (lvStreams) streams.push(...lvStreams);
                }
            }
        }

        return streams;
    }
}

export const aggregator = new Aggregator();
