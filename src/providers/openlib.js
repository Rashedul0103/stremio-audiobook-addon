import { BaseProvider } from './base.js';
import { fetchWithRetry } from '../utils/fetchWithRetry.js';
import { catalogCache, metaCache } from '../services/cache.js';

export class OpenLibraryProvider extends BaseProvider {
    constructor() { super('Open Library'); }

    async search(query, skip = 0) {
        const cacheKey = `ol_search_${query}_${skip}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=50&offset=${skip}`;
        const data = await fetchWithRetry(url);
        if (!data || !data.docs) return [];

        const results = data.docs.map(this._mapDoc.bind(this)).filter(Boolean);
        catalogCache.set(cacheKey, results);
        return results;
    }

    async getMeta(id) {
        let workId = id;
        if (id.startsWith('olid:')) workId = id.substring(5);
        else if (id.startsWith('isbn:')) {
            const isbn = id.substring(5);
            const url = `https://openlibrary.org/isbn/${isbn}.json`;
            const edition = await fetchWithRetry(url);
            if (edition && edition.works && edition.works[0]) {
                workId = edition.works[0].key.split('/').pop();
            } else return null;
        } else return null;

        const cacheKey = `ol_meta_${workId}`;
        if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

        const url = `https://openlibrary.org/works/${workId}.json`;
        const work = await fetchWithRetry(url);
        if (!work) return null;

        const meta = this._mapWork(work);
        metaCache.set(cacheKey, meta);
        return meta;
    }

    async getByNarrator() { return []; }
    async getByGenre(genre, skip = 0) { return this.search(`subject:${genre}`, skip); }
    async getSeries(seriesName, skip = 0) { return this.search(`series:${seriesName}`, skip); }
    async getStreams() { return []; }

    _mapDoc(doc) {
        if (!doc) return null;
        const coverId = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null;
        return {
            provider: 'openlib',
            id: doc.key ? `olid:${doc.key.split('/').pop()}` : null,
            title: doc.title,
            authors: doc.author_name || [],
            narrators: [],
            description: null,
            poster: coverId,
            background: coverId,
            genres: doc.subject ? doc.subject.slice(0, 5) : [],
            year: doc.first_publish_year,
            series: doc.series ? doc.series.map(s => ({ name: s })) : [],
            externalIds: { olid: doc.key ? `olid:${doc.key.split('/').pop()}` : null }
        };
    }

    _mapWork(work) {
        const coverId = work.covers && work.covers[0] ? `https://covers.openlibrary.org/b/id/${work.covers[0]}-L.jpg` : null;
        return {
            provider: 'openlib',
            id: work.key ? `olid:${work.key.split('/').pop()}` : null,
            title: work.title,
            authors: [],
            narrators: [],
            description: work.description ? (typeof work.description === 'string' ? work.description : work.description.value) : null,
            poster: coverId,
            background: coverId,
            genres: work.subjects ? work.subjects.slice(0, 10) : [],
            year: null,
            series: work.series ? work.series.map(s => ({ name: s })) : [],
            externalIds: { olid: work.key ? `olid:${work.key.split('/').pop()}` : null }
        };
    }
}
