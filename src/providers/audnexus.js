import { BaseProvider } from './base.js';
import { fetchWithRetry } from '../utils/fetchWithRetry.js';
import { metaCache } from '../services/cache.js';

export class AudnexusProvider extends BaseProvider {
    constructor() { super('Audnexus'); }

    async search() { return []; }

    async getMeta(id) {
        if (!id.startsWith('asin:')) return null;
        const asin = id.substring(5);
        const cacheKey = `audnexus_meta_${asin}`;
        if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

        const url = `https://api.audnex.us/books/${asin}`;
        const data = await fetchWithRetry(url);
        if (!data) return null;

        const meta = {
            provider: 'audnexus',
            id: `asin:${data.asin}`,
            title: data.title,
            authors: data.authors ? data.authors.map(a => a.name) : [],
            narrators: data.narrators ? data.narrators.map(n => n.name) : [],
            description: data.summary || null,
            poster: data.image || null,
            background: data.image || null,
            genres: [],
            year: data.releaseDate ? new Date(data.releaseDate).getFullYear() : null,
            abridged: data.abridged || false,
            series: data.seriesPrimary ? [{ name: data.seriesPrimary.name, index: data.seriesPrimary.position }] : [],
            externalIds: { asin: data.asin, isbn: data.isbn }
        };

        metaCache.set(cacheKey, meta);
        return meta;
    }

    async getByNarrator() { return []; }
    async getByGenre() { return []; }
    async getSeries() { return []; }
    async getStreams() { return []; }
}
