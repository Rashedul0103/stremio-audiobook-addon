import { AppleBooksProvider } from '../providers/apple.js';
import { OpenLibraryProvider } from '../providers/openlib.js';
import { GoogleBooksProvider, getApiKeyCacheScope } from '../providers/google.js';
import { AudnexusProvider } from '../providers/audnexus.js';
import { LibriVoxProvider, InternetArchiveProvider } from '../providers/streams.js';
import { generateWorkFingerprint, generateSlug, cleanNarrator, cleanAuthor, cleanTitle } from '../utils/normalizer.js';
import { normalizeGenres } from '../utils/genreMapper.js';
import { normalizeLanguage } from '../utils/language.js';
import { catalogCache, metaCache } from './cache.js';

function authorMatches(query, authors = []) {
    const wanted = cleanTitle(query).split(/\s+/).filter(Boolean);
    if (wanted.length === 0) return true;
    return authors.some(author => {
        const tokens = cleanTitle(author).split(/\s+/).filter(Boolean);
        return wanted.every(token => tokens.includes(token));
    });
}

function sameWorkTitle(left, right) {
    const a = cleanTitle(left);
    const b = cleanTitle(right);
    return Boolean(a && b && a === b);
}

function sameWorkAuthors(leftAuthors = [], rightAuthors = []) {
    if (!leftAuthors.length || !rightAuthors.length) return true;
    return leftAuthors.some(left => authorMatches(left, rightAuthors));
}

function escapeQueryPhrase(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim();
}

function matchesGenre(item, genre) {
    const wanted = normalizeGenres([genre])[0]?.toLowerCase();
    if (!wanted) return false;
    return (item?.genres || []).some(value => {
        const actual = normalizeGenres([value])[0]?.toLowerCase();
        return actual === wanted || Boolean(actual && actual.includes(wanted));
    });
}

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
            const workFp = cleanAuthor(item.authors)
                ? generateWorkFingerprint(item.title, item.authors)
                : null;

            const keys = [];
            if (item.id && /^(isbn|asin|olid|librivox|ia|gb|itunes):/.test(item.id)) keys.push(item.id);
            if (ext.isbn) keys.push(`isbn:${ext.isbn}`);
            if (ext.asin) keys.push(`asin:${ext.asin}`);
            if (ext.olid) keys.push(String(ext.olid).startsWith('olid:') ? String(ext.olid) : `olid:${ext.olid}`);
            if (workFp && workFp !== ':') keys.push(`work:${workFp}`);

            // One record can bridge two previously separate clusters. Merge both clusters,
            // then update every index entry so the bridge actually joins the complete groups.
            const matches = [...new Set(keys.map(key => idToCluster.get(key)).filter(Boolean))];
            let targetCluster = matches[0];

            if (!targetCluster) {
                targetCluster = [];
                clusters.push(targetCluster);
            } else {
                for (const otherCluster of matches.slice(1)) {
                    if (otherCluster === targetCluster) continue;
                    targetCluster.push(...otherCluster);
                    const index = clusters.indexOf(otherCluster);
                    if (index !== -1) clusters.splice(index, 1);
                    for (const [key, cluster] of idToCluster) {
                        if (cluster === otherCluster) idToCluster.set(key, targetCluster);
                    }
                }
            }

            targetCluster.push(item);
            for (const key of keys) idToCluster.set(key, targetCluster);
        }

        return clusters.filter(cluster => cluster.length > 0);
    }

    _mergeGroup(group) {
        if (!group || group.length === 0) return null;

        const canonical = {
            id: null, type: 'movie', title: '', poster: null, background: null,
            description: null, genres: [], authors: [], narrators: [], year: null,
            abridged: null, series: null, ratings: null, awards: [], streams: [],
            externalIds: {}, sourceIds: [], rights: [], language: null, isPublicDomain: false
        };

        const providerPriority = { audnexus: 6, apple: 5, openlib: 4, google: 3, librivox: 2, ia: 1 };
        group.sort((a, b) => (providerPriority[b.provider] || 0) - (providerPriority[a.provider] || 0));

        const rawNarrators = [];

        for (const item of group) {
            if (item.id && !canonical.sourceIds.includes(item.id)) canonical.sourceIds.push(item.id);
            if (item.rights) canonical.rights.push(...(Array.isArray(item.rights) ? item.rights : [item.rights]));

            if (item.externalIds) {
                Object.assign(canonical.externalIds, item.externalIds);
            }

            if (!canonical.title && item.title) canonical.title = item.title;
            if (!canonical.poster && item.poster) canonical.poster = item.poster;
            if (!canonical.background && item.background) canonical.background = item.background;
            if (!canonical.description && item.description) canonical.description = item.description;
            if (!canonical.year && item.year) canonical.year = item.year;
            if (!canonical.language && item.language) canonical.language = item.language;
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
            // Rights are resolved conservatively after the canonical ID is selected.
        }

        // Identifier preference is independent of provider display/metadata priority.
        // Otherwise an Apple result encountered first can hide a better ISBN identifier.
        const idCandidates = [];
        const addCandidate = (id, priority) => {
            if (id) idCandidates.push({ id: String(id), priority });
        };
        for (const item of group) {
            const id = item.id || '';
            if (id.startsWith('isbn:')) addCandidate(id, 1);
            else if (item.externalIds?.isbn) addCandidate(`isbn:${item.externalIds.isbn}`, 1);
            if (id.startsWith('asin:')) addCandidate(id, 2);
            else if (item.externalIds?.asin) addCandidate(`asin:${item.externalIds.asin}`, 2);
            if (id.startsWith('olid:')) addCandidate(id, 3);
            else if (item.externalIds?.olid) addCandidate(String(item.externalIds.olid).startsWith('olid:') ? item.externalIds.olid : `olid:${item.externalIds.olid}`, 3);
            if (id.startsWith('librivox:')) addCandidate(id, 4);
            if (id.startsWith('ia:')) addCandidate(id, 5);
            if (id.startsWith('gb:')) addCandidate(id, 6);
            if (id.startsWith('itunes:')) addCandidate(id, 7);
        }
        canonical.id = idCandidates.sort((a, b) => a.priority - b.priority)[0]?.id || null;

        // Do not attribute Internet Archive rights to unrelated editions in the same work cluster.
        canonical.isPublicDomain =
            group.some(item => item.provider === 'librivox' && item.isPublicDomain === true) ||
            (canonical.id?.startsWith('ia:') &&
                group.some(item => item.provider === 'ia' && item.isPublicDomain === true));
        canonical.sourceIds = [...new Set(canonical.sourceIds)];
        canonical.rights = [...new Set(canonical.rights)];

        // Smart Narrator Preservation (Preserves original uppercase formatting)
        canonical.narrators = rawNarrators.length > 0 ? [...new Set(rawNarrators)] : ['Unknown'];

        if (!canonical.id) {
            const slug = generateSlug(`${canonical.title} ${canonical.authors[0] || ''}`);
            canonical.id = slug ? `slug:${slug}` : `hash:${Date.now()}`;
        }

        return canonical;
    }

    _synthesizeItems(allResults) {
        const clusters = this._clusterItems(allResults);
        const synthesized = [];

        for (const group of clusters) {
            const narratorMap = new Map();
            for (const item of group) {
                for (const narr of (item.narrators || [])) {
                    const cleaned = cleanNarrator(narr);
                    if (cleaned !== 'unknown') narratorMap.set(cleaned, narr);
                }
            }

            if (narratorMap.size > 1) {
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

        return synthesized.filter(Boolean);
    }

    async searchAndSynthesize(query, skip = 0, googleApiKey = '', options = {}) {
        const orderBy = options.orderBy === 'newest' ? 'newest' : 'relevance';
        const cacheKey = `agg_search_${query}_${skip}_${orderBy}_${normalizeLanguage(options.language) || 'all'}_${getApiKeyCacheScope(googleApiKey)}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const [appleRes, googleRes, openlibRes, librivoxRes, iaRes] = await Promise.allSettled([
            this.providers.apple.search(query, skip),
            this.providers.google.search(query, skip, googleApiKey, { orderBy, language: options.language }),
            this.providers.openlib.search(query, skip, options.language),
            this.providers.librivox.search(query, skip),
            this.providers.internetarchive.search(query, skip, options.language)
        ]);

        const allResults = [
            ...(appleRes.status === 'fulfilled' ? appleRes.value : []),
            ...(googleRes.status === 'fulfilled' ? googleRes.value : []),
            ...(openlibRes.status === 'fulfilled' ? openlibRes.value : []),
            ...(librivoxRes.status === 'fulfilled' ? librivoxRes.value : []),
            ...(iaRes.status === 'fulfilled' ? iaRes.value : [])
        ];

        let synthesized = this._synthesizeItems(allResults);
        if (orderBy === 'newest') synthesized = synthesized.filter(item => Number.isFinite(item.year)).sort((a, b) => b.year - a.year);
        // A zero-result aggregate may mean every provider is temporarily unavailable.
        // Keep this negative cache short so recovery is visible without waiting a full day.
        catalogCache.set(cacheKey, synthesized, synthesized.length === 0 ? 60 : 0);
        return synthesized;
    }

    async searchByGenre(genre, skip = 0, googleApiKey = '', language = '') {
        const cacheKey = `agg_genre_${genre}_${skip}_${normalizeLanguage(language) || 'all'}_${getApiKeyCacheScope(googleApiKey)}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const [appleRes, googleRes, openlibRes, librivoxRes, iaRes] = await Promise.allSettled([
            this.providers.apple.search(genre, skip),
            this.providers.google.getByGenre(genre, skip, googleApiKey, language),
            this.providers.openlib.getByGenre(genre, skip, language),
            this.providers.librivox.searchByGenre(genre, skip),
            this.providers.internetarchive.searchByGenre(genre, skip, language)
        ]);
        const raw = [
            ...(appleRes.status === 'fulfilled' ? appleRes.value : []),
            ...(googleRes.status === 'fulfilled' ? googleRes.value : []),
            ...(openlibRes.status === 'fulfilled' ? openlibRes.value : []),
            ...(librivoxRes.status === 'fulfilled' ? librivoxRes.value : []),
            ...(iaRes.status === 'fulfilled' ? iaRes.value : [])
        ];
        const synthesized = this._synthesizeItems(raw).filter(item => matchesGenre(item, genre));
        catalogCache.set(cacheKey, synthesized, synthesized.length === 0 ? 60 : 0);
        return synthesized;
    }

    async searchByNarrator(narrator, skip = 0, googleApiKey = '', language = '') {
        const cacheKey = `agg_narrator_${narrator}_${skip}_${normalizeLanguage(language) || 'all'}_${getApiKeyCacheScope(googleApiKey)}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);
        const candidates = await this.searchAndSynthesize(narrator, skip, googleApiKey, { language });
        const expected = cleanNarrator(narrator);
        const results = candidates.filter(item =>
            expected !== 'unknown' &&
            (item.narrators || []).some(value => cleanNarrator(value) === expected)
        );
        catalogCache.set(cacheKey, results, results.length === 0 ? 60 : 0);
        return results;
    }

    async searchByAuthor(author, skip = 0, googleApiKey = '', language = '') {
        const cacheKey = `agg_author_${author}_${skip}_${normalizeLanguage(language) || 'all'}_${getApiKeyCacheScope(googleApiKey)}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const [appleRes, googleRes, openlibRes, librivoxRes, iaRes] = await Promise.allSettled([
            this.providers.apple.search(author, skip),
            this.providers.google.searchByAuthor(author, skip, googleApiKey, language),
            this.providers.openlib.searchByAuthor(author, skip, language),
            this.providers.librivox.searchByAuthor(author, skip),
            this.providers.internetarchive.searchByAuthor(author, skip, language)
        ]);
        const results = [
            ...(appleRes.status === 'fulfilled' ? appleRes.value : []),
            ...(googleRes.status === 'fulfilled' ? googleRes.value : []),
            ...(openlibRes.status === 'fulfilled' ? openlibRes.value : []),
            ...(librivoxRes.status === 'fulfilled' ? librivoxRes.value : []),
            ...(iaRes.status === 'fulfilled' ? iaRes.value : [])
        ].filter(item => authorMatches(author, item.authors || []));

        const synthesized = this._synthesizeItems(results);
        catalogCache.set(cacheKey, synthesized, synthesized.length === 0 ? 60 : 0);
        return synthesized;
    }

    async getMetaAndSynthesize(id, googleApiKey = '') {
        const cacheKey = `agg_meta_${id}_${getApiKeyCacheScope(googleApiKey)}`;
        if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

        let results = [];

        if (id.startsWith('isbn:')) {
            const isbn = id.substring(5);
            const [googleRes, openlibRes] = await Promise.allSettled([
                this.providers.google.getMeta(id, googleApiKey),
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
        } else if (id.startsWith('ia:')) {
            const res = await this.providers.internetarchive.getMeta(id);
            if (res) results.push(res);
        } else if (id.startsWith('gb:')) {
            const res = await this.providers.google.getMeta(id, googleApiKey);
            if (res) results.push(res);
        } else if (id.startsWith('itunes:')) {
            const res = await this.providers.apple.getMeta(id);
            if (res) results.push(res);
        } else if (id.startsWith('slug:')) {
            const cleanQuery = id.substring(5).replace(/-/g, ' ');
            const searchResults = await this.searchAndSynthesize(cleanQuery, 0, googleApiKey);
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
     * Resolves streams from known provider IDs first, then looks for exact title/author
     * matches in LibriVox and Internet Archive. Never send the author inside LibriVox's
     * title parameter, and never expose IA results as public-domain audio without rights evidence.
     */
    async getStreams(id, googleApiKey = '') {
        const meta = await this.getMetaAndSynthesize(id, googleApiKey);
        if (!meta) return [];

        const streams = [];
        const seenUrls = new Set();
        const visitedSources = new Set();

        const appendStreams = candidates => {
            for (const stream of candidates || []) {
                if (!stream?.url || seenUrls.has(stream.url)) continue;
                seenUrls.add(stream.url);
                streams.push(stream);
            }
        };

        const resolveKnownSource = async sourceId => {
            if (!sourceId || visitedSources.has(sourceId)) return;
            visitedSources.add(sourceId);

            if (sourceId.startsWith('librivox:')) {
                appendStreams(await this.providers.librivox.getStreams(sourceId));
            } else if (sourceId.startsWith('ia:')) {
                const sourceMeta = sourceId === id ? meta : await this.providers.internetarchive.getMeta(sourceId);
                if (sourceMeta?.isPublicDomain === true) {
                    appendStreams(await this.providers.internetarchive.getStreams(sourceId));
                }
            }
        };

        for (const sourceId of [id, ...(meta.sourceIds || [])]) {
            await resolveKnownSource(sourceId);
        }

        if (meta.title) {
            const [lvResult, iaResult] = await Promise.allSettled([
                this.providers.librivox.searchByTitle(meta.title, 0),
                this.providers.internetarchive.searchByTitle(meta.title, 0)
            ]);

            const matchesWork = candidate =>
                sameWorkTitle(candidate?.title, meta.title) &&
                sameWorkAuthors(meta.authors || [], candidate?.authors || []);

            const lvBooks = (lvResult.status === 'fulfilled' ? lvResult.value : [])
                .filter(matchesWork)
                .slice(0, 3);
            for (const book of lvBooks) {
                if (book?.id && !visitedSources.has(book.id)) {
                    await resolveKnownSource(book.id);
                }
            }

            const iaBooks = (iaResult.status === 'fulfilled' ? iaResult.value : [])
                .filter(book => book?.isPublicDomain === true && matchesWork(book))
                .slice(0, 3);
            for (const book of iaBooks) {
                if (!book?.id || visitedSources.has(book.id)) continue;
                // Re-read full metadata before offering playback; search-index rights can be stale.
                const fullMeta = await this.providers.internetarchive.getMeta(book.id);
                if (fullMeta?.isPublicDomain === true) {
                    visitedSources.add(book.id);
                    appendStreams(await this.providers.internetarchive.getStreams(book.id));
                }
            }
        }

        return streams;
    }
}

export const aggregator = new Aggregator();
