import { BaseProvider } from './base.js';
import { fetchWithRetry } from '../utils/fetchWithRetry.js';
import { catalogCache, metaCache } from '../services/cache.js';
import { createHash } from 'node:crypto';

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
        if (data && !data.error) catalogCache.set(cacheKey, data);
        return data && !data.error ? data : null;
    }

    async search(query, skip = 0, apiKey = '') {
        const url = this.baseUrl + '?q=' + encodeURIComponent(query) + '&maxResults=40&startIndex=' + skip;
        const data = await this._fetch(url, apiKey);
        if (!data || !data.items) return [];

        const results = data.items.map(this._mapItem.bind(this)).filter(Boolean);
        if (results.length === 0) catalogCache.set('gb_empty_' + url + ':' + getApiKeyCacheScope(apiKey), [], 60);
        return results;
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
    async getByGenre(genre, skip = 0) { return this.search('subject:' + genre, skip); }
    async getSeries() { return []; }
    async getStreams() { return []; }

    _mapItem(item) {
        if (!item || !item.volumeInfo) return null;
        const info = item.volumeInfo;
        const imageLinks = info.imageLinks || {};
        const poster = imageLinks.extraLarge || imageLinks.large || imageLinks.medium || imageLinks.thumbnail || null;
        
        let ratings = null;
        if (info.averageRating) {
            ratings = { stars: Math.round(info.averageRating * 2), id: 'gb:' + item.id };
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
            year: info.publishedDate ? new Date(info.publishedDate).getFullYear() : null,
            ratings: ratings,
            series: null
        };
    }
}
