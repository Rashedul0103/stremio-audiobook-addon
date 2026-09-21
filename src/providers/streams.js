import { BaseProvider } from './base.js';
import { fetchWithRetry } from '../utils/fetchWithRetry.js';
import { catalogCache, streamCache, metaCache } from '../services/cache.js';

export class LibriVoxProvider extends BaseProvider {
    constructor() { super('LibriVox'); }

    async search(query, skip = 0) {
        const cacheKey = `lv_search_${query}_${skip}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const url = `https://librivox.org/api/feed/audiobooks?title=${encodeURIComponent(query)}&format=json&limit=50&offset=${skip}`;
        const data = await fetchWithRetry(url);
        if (!data || !data.books) return [];

        const results = data.books.map(this._mapBook.bind(this)).filter(Boolean);
        catalogCache.set(cacheKey, results);
        return results;
    }

    async getMeta(id) {
        if (!id.startsWith('librivox:')) return null;
        const lvId = id.substring(9);
        const cacheKey = `lv_meta_${lvId}`;
        if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

        const url = `https://librivox.org/api/feed/audiobooks?id=${lvId}&format=json`;
        const data = await fetchWithRetry(url);
        if (!data || !data.books || data.books.length === 0) return null;

        const meta = this._mapBook(data.books[0]);
        metaCache.set(cacheKey, meta);
        return meta;
    }

    async getStreams(id) {
        if (!id.startsWith('librivox:')) return [];
        const lvId = id.substring(9);
        const cacheKey = `lv_streams_${lvId}`;
        if (streamCache.has(cacheKey)) return streamCache.get(cacheKey);

        const url = `https://librivox.org/api/feed/audiotracks?project_id=${lvId}&format=json`;
        const data = await fetchWithRetry(url);
        if (!data || !data.sections) return [];

        const streams = data.sections.map(sec => ({
            url: sec.listen_url,
            name: 'LibriVox',
            title: `Ch. ${sec.section_number}: ${sec.title || `Part ${sec.section_number}`}`,
            duration: sec.playtime ? parseInt(sec.playtime, 10) : null
        })).filter(s => s.url);

        streamCache.set(cacheKey, streams);
        return streams;
    }

    async getByNarrator() { return []; }
    async getByGenre() { return []; }
    async getSeries() { return []; }

    _mapBook(book) {
        if (!book) return null;
        return {
            provider: 'librivox',
            id: `librivox:${book.id}`,
            title: book.title,
            authors: book.authors ? book.authors.map(a => `${a.first_name} ${a.last_name}`.trim()) : [],
            narrators: [],
            description: book.description ? book.description.replace(/<[^>]+>/g, '') : null,
            poster: null,
            background: null,
            genres: ['Classics', 'Public Domain'],
            year: book.copyright_year ? parseInt(book.copyright_year, 10) : null,
            isPublicDomain: true,
            externalIds: {}
        };
    }
}

export class InternetArchiveProvider extends BaseProvider {
    constructor() { super('Internet Archive'); }

    async search(query, skip = 0) {
        const cacheKey = `ia_search_${query}_${skip}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+mediatype:audio&fl[]=identifier,title,creator,description,year&rows=50&start=${skip}&output=json`;
        const data = await fetchWithRetry(url);
        if (!data || !data.response || !data.response.docs) return [];

        const results = data.response.docs.map(this._mapItem.bind(this)).filter(Boolean);
        catalogCache.set(cacheKey, results);
        return results;
    }

    async getMeta(id) {
        if (!id.startsWith('ia:')) return null;
        const iaId = id.substring(3);
        const cacheKey = `ia_meta_${iaId}`;
        if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

        const url = `https://archive.org/metadata/${iaId}`;
        const data = await fetchWithRetry(url);
        if (!data || !data.metadata) return null;

        const meta = {
            provider: 'ia',
            id: `ia:${iaId}`,
            title: data.metadata.title,
            authors: data.metadata.creator ? (Array.isArray(data.metadata.creator) ? data.metadata.creator : [data.metadata.creator]) : [],
            narrators: [],
            description: data.metadata.description || null,
            poster: `https://archive.org/services/img/${iaId}`,
            background: null,
            genres: [],
            year: data.metadata.year ? parseInt(data.metadata.year, 10) : null,
            isPublicDomain: true,
            externalIds: {}
        };

        metaCache.set(cacheKey, meta);
        return meta;
    }

    async getStreams(id) {
        if (!id.startsWith('ia:')) return [];
        const iaId = id.substring(3);
        const cacheKey = `ia_streams_${iaId}`;
        if (streamCache.has(cacheKey)) return streamCache.get(cacheKey);

        const url = `https://archive.org/metadata/${iaId}`;
        const data = await fetchWithRetry(url);
        if (!data || !data.files) return [];

        const streams = data.files
            .filter(f => f.name && (f.name.endsWith('.mp3') || f.name.endsWith('.m4b') || f.name.endsWith('.ogg')))
            .map(f => ({
                url: `https://archive.org/download/${iaId}/${encodeURIComponent(f.name)}`,
                name: 'Internet Archive',
                title: f.title || f.name,
                duration: f.length ? Math.round(parseFloat(f.length)) : null
            }));

        streamCache.set(cacheKey, streams);
        return streams;
    }

    async getByNarrator() { return []; }
    async getByGenre() { return []; }
    async getSeries() { return []; }

    _mapItem(item) {
        if (!item) return null;
        return {
            provider: 'ia',
            id: `ia:${item.identifier}`,
            title: item.title,
            authors: item.creator ? (Array.isArray(item.creator) ? item.creator : [item.creator]) : [],
            narrators: [],
            description: item.description || null,
            poster: `https://archive.org/services/img/${item.identifier}`,
            background: null,
            genres: [],
            year: item.year ? parseInt(item.year, 10) : null,
            isPublicDomain: true,
            externalIds: {}
        };
    }
}
