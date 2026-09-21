import { BaseProvider } from './base.js';
import { fetchWithRetry } from '../utils/fetchWithRetry.js';
import { catalogCache } from '../services/cache.js';

export class AppleBooksProvider extends BaseProvider {
    constructor() { super('Apple Books'); }

    async search(query, skip = 0) {
        const cacheKey = `apple_search_${query}_${skip}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);
        
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=audiobook&limit=50&offset=${skip}`;
        const data = await fetchWithRetry(url);
        if (!data || !data.results) return [];
        
        const results = data.results.map(this._mapItem.bind(this)).filter(Boolean);
        catalogCache.set(cacheKey, results);
        return results;
    }

    async getMeta() { return null; }
    async getStreams() { return []; }
    async getByNarrator(narrator, skip = 0) { return this.search(narrator, skip); }
    async getByGenre(genre, skip = 0) { return this.search(genre, skip); }
    async getSeries(seriesName, skip = 0) { return this.search(seriesName, skip); }

    _mapItem(item) {
        if (!item) return null;
        const artwork = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '1400x1400bb') : null;
        
        let narrator = item.collectionArtistName || null;
        if (!narrator && item.description) {
            const match = item.description.match(/(?:narrated|read|performed) by\s+([^,.\n<]+)/i);
            if (match) narrator = match[1].trim();
        }

        return {
            provider: 'apple',
            id: item.collectionId ? `itunes:${item.collectionId}` : null,
            title: item.collectionName || item.trackName,
            authors: item.artistName ? [item.artistName] : [],
            narrators: narrator ? [narrator] : [],
            description: item.description ? item.description.replace(/<[^>]+>/g, '') : null,
            poster: artwork,
            background: artwork,
            genres: item.primaryGenreName ? [item.primaryGenreName] : [],
            year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : null,
            series: null,
            externalIds: {}
        };
    }
}
