import { BaseProvider } from './base.js';
import { fetchWithRetry } from '../utils/fetchWithRetry.js';
import { catalogCache, metaCache } from '../services/cache.js';
import { createHash } from 'node:crypto';
import { normalizeLanguage } from '../utils/language.js';
import { extractAwards } from '../utils/genreMapper.js';

export function getApiKeyCacheScope(apiKey = '') {
    if (!apiKey) return 'default';
    return createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16);
}

export class GoogleBooksProvider extends BaseProvider {
    constructor() {
        super('Google Books');
        this.baseUrl = 'https://www.googleapis.com/books/v1/volumes';
    }

    async _fetch(url, apiKey = '') {
        const cacheKey = 'gb:' + url + ':' + getApiKeyCacheScope(apiKey);
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        let finalUrl = url;
        if (apiKey) {
            const parsedUrl = new URL(url);
            parsedUrl.searchParams.set('key', String(apiKey));
            finalUrl = parsedUrl.toString();
        }

        const data = await fetchWithRetry(finalUrl);
        if (data && !data.error) catalogCache.set(cacheKey, data, Array.isArray(data.items) && data.items.length === 0 ? 60 : 0);
        return data && !data.error ? data : null;
    }

    async search(query, skip = 0, apiKey = '', options = {}) {
        const params = new URLSearchParams({
            q: query,
            maxResults: '40',
            startIndex: String(skip)
        });
        if (options.orderBy === 'newest') params.set('orderBy', 'newest');
        if (options.language) params.set('langRestrict', options.language);

        const data = await this._fetch(this.baseUrl + '?' + params.toString(), apiKey);
        if (!data || !Array.isArray(data.items)) return [];
        return data.items.map(this._mapItem.bind(this)).filter(Boolean);
    }

    async searchNewest(query = 'audiobook', skip = 0, apiKey = '') {
        return this.search(query, skip, apiKey, { orderBy: 'newest' });
    }

    async searchByAuthor(author, skip = 0, apiKey = '') {
        const escaped = String(author).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return this.search(`inauthor:"${escaped}"`, skip, apiKey);
    }

    async getMeta(id, apiKey = '') {
        let url = null;
        if (id.startsWith('isbn:')) {
            url = this.baseUrl + '?q=isbn:' + id.substring(5);
        } else if (id.startsWith('gb:')) {
            url = this.baseUrl + '/' + id.substring(3);
        } else {
            return null;
        }

        const cacheKey = 'gb_meta_' + id + ':' + getApiKeyCacheScope(apiKey);
        if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

        const data = await this._fetch(url, apiKey);
        if (!data) return null;

        const item = data.items ? data.items[0] : data;
        const meta = this._mapItem(item);
        if (meta) metaCache.set(cacheKey, meta);
        return meta;
    }

    async getByNarrator() { return []; }
    async getByGenre(genre, skip = 0, apiKey = '') { return this.search('subject:' + genre, skip, apiKey); }
    async getSeries() { return []; }
    async getStreams() { return []; }

    _mapItem(item) {
        if (!item || !item.volumeInfo) return null;
        const info = item.volumeInfo;
        const imageLinks = info.imageLinks || {};
        const poster = imageLinks.extraLarge || imageLinks.large || imageLinks.medium || imageLinks.thumbnail || null;
        
        let ratings = null;
        if (Number.isFinite(info.averageRating) && info.averageRating > 0) {
            ratings = {
                score: info.averageRating,
                count: Number.isFinite(info.ratingsCount) ? info.ratingsCount : 0,
                stars: Math.round(info.averageRating * 2),
                id: 'gb:' + item.id,
                source: 'Google Books'
            };
        }

        const isbnObj = info.industryIdentifiers 
            ? info.industryIdentifiers.find(i => i.type === 'ISBN_13') || info.industryIdentifiers[0] 
            : null;

        const canonicalId = isbnObj ? ('isbn:' + isbnObj.identifier) : ('gb:' + item.id);

        return {
            provider: 'google',
            id: canonicalId,
            title: info.title,
            authors: info.authors || [],
            narrators: [],
            description: info.description || null,
            poster: poster ? poster.replace(/^http:/, 'https:') : null,
            background: poster ? poster.replace(/^http:/, 'https:') : null,
            genres: info.categories || [],
            language: normalizeLanguage(info.language),
            awards: extractAwards([...(info.categories || []), info.title, info.description]),
            year: info.publishedDate ? new Date(info.publishedDate).getFullYear() : null,
            ratings: ratings,
            series: null
        };
    }
}
