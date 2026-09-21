import { BaseProvider } from './base.js';
import { fetchWithRetry } from '../utils/fetchWithRetry.js';
import { catalogCache, metaCache } from '../services/cache.js';

export class GoogleBooksProvider extends BaseProvider {
    constructor() { super('Google Books'); }

    async search(query, skip = 0) {
        const cacheKey = `gb_search_${query}_${skip}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=40&startIndex=${skip}`;
        const data = await fetchWithRetry(url);
        if (!data || !data.items) return [];

        const results = data.items.map(this._mapItem.bind(this)).filter(Boolean);
        catalogCache.set(cacheKey, results);
        return results;
    }

    async getMeta(id) {
        let url = null;
        if (id.startsWith('isbn:')) {
            url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${id.substring(5)}`;
        } else if (id.startsWith('gb:')) {
            url = `https://www.googleapis.com/books/v1/volumes/${id.substring(3)}`;
        } else {
            return null;
        }

        const cacheKey = `gb_meta_${id}`;
        if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

        const data = await fetchWithRetry(url);
        if (!data) return null;

        const item = data.items ? data.items[0] : data;
        const meta = this._mapItem(item);
        if (meta) metaCache.set(cacheKey, meta);
        return meta;
    }

    async getByNarrator() { return []; }
    async getByGenre(genre, skip = 0) { return this.search(`subject:${genre}`, skip); }
    async getSeries() { return []; }
    async getStreams() { return []; }

    _mapItem(item) {
        if (!item || !item.volumeInfo) return null;
        const info = item.volumeInfo;
        const imageLinks = info.imageLinks || {};
        const poster = imageLinks.extraLarge || imageLinks.large || imageLinks.medium || imageLinks.thumbnail || null;
        
        let ratings = null;
        if (info.averageRating) {
            ratings = { stars: Math.round(info.averageRating * 2), id: `gb:${item.id}` };
        }

        const isbnObj = info.industryIdentifiers 
            ? info.industryIdentifiers.find(i => i.type === 'ISBN_13') || info.industryIdentifiers[0] 
            : null;

        const canonicalId = isbnObj ? `isbn:${isbnObj.identifier}` : `gb:${item.id}`;

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
            series: null,
            externalIds: {}
        };
    }
}
