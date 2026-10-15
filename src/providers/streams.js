import { BaseProvider } from './base.js';
import { fetchWithRetry } from '../utils/fetchWithRetry.js';
import { catalogCache, streamCache, metaCache } from '../services/cache.js';
import { normalizeLanguage } from '../utils/language.js';
import { normalizeGenres, extractAwards } from '../utils/genreMapper.js';

function escapeSearchPhrase(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim();
}

export function parseDurationSeconds(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? Math.round(value) : null;

    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const seconds = Number(raw);
        return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
    }

    if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(raw)) return null;
    const parts = raw.split(':').map(Number);
    const seconds = parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];
    return seconds > 0 ? seconds : null;
}

export function isExplicitlyPublicDomain(record = {}) {
    const values = [
        record.licenseurl,
        record.license,
        record.rights,
        record.copyright_status
    ].flat(Infinity).filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean);

    const explicitPublicDomainLicense = values.some(value =>
        /creativecommons\.org\/publicdomain\/(?:zero|mark)\/1\.0\/?(?:[?#].*)?$/i.test(value) ||
        /creativecommons\.org\/licenses\/zero\/1\.0\/?(?:[?#].*)?$/i.test(value)
    );
    if (explicitPublicDomainLicense) return true;

    return values.some(value =>
        /\bpublic[\s_-]*domain\b/i.test(value) &&
        !/\bnot\b.{0,25}\bpublic[\s_-]*domain\b|\ball rights reserved\b/i.test(value)
    );
}

export class LibriVoxProvider extends BaseProvider {
    constructor() { super('LibriVox'); }

    async search(query, skip = 0) {
        return this.searchByTitle(query, skip);
    }

    async searchByTitle(title, skip = 0) {
        return this._searchByField('title', title, skip);
    }

    async searchByAuthor(author, skip = 0) {
        // Use a separate author query. LibriVox has recently had server errors for
        // combined title+author filters, so do not send both fields together.
        return this._searchByField('author', author, skip);
    }

    async _searchByField(field, query, skip = 0) {
        const cacheKey = `lv_${field}_${query}_${skip}`;
        if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);

        const url = new URL('https://librivox.org/api/feed/audiobooks');
        url.searchParams.set(field, query);
        url.searchParams.set('format', 'json');
        url.searchParams.set('extended', '1');
        url.searchParams.set('limit', '50');
        url.searchParams.set('offset', String(skip));

        const data = await fetchWithRetry(url.toString());
        if (!data || !Array.isArray(data.books)) return [];

        const results = data.books.map(this._mapBook.bind(this)).filter(Boolean);
        catalogCache.set(cacheKey, results, results.length === 0 ? 60 : 0);
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
            duration: parseDurationSeconds(sec.playtime)
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
            genres: [...new Set(['Classics', 'Public Domain', ...normalizeGenres((book.genres || []).map(genre => typeof genre === 'string' ? genre : genre.name).filter(Boolean))])],
            language: normalizeLanguage(book.language),
            awards: extractAwards([book.title, book.description]),
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

        const url = new URL('https://archive.org/advancedsearch.php');
        url.searchParams.set('q', `${query} AND mediatype:audio`);
        for (const field of ['identifier', 'title', 'creator', 'description', 'year', 'licenseurl', 'rights', 'copyright_status', 'language', 'subject']) {
            url.searchParams.append('fl[]', field);
        }
        url.searchParams.set('rows', '50');
        url.searchParams.set('start', String(skip));
        url.searchParams.set('output', 'json');

        const data = await fetchWithRetry(url.toString());
        if (!data || !data.response || !Array.isArray(data.response.docs)) return [];

        const results = data.response.docs.map(this._mapItem.bind(this)).filter(Boolean);
        catalogCache.set(cacheKey, results, results.length === 0 ? 60 : 0);
        return results;
    }

    async searchByTitle(title, skip = 0) {
        return this.search(`title:"${escapeSearchPhrase(title)}"`, skip);
    }

    async searchByAuthor(author, skip = 0) {
        return this.search(`creator:"${escapeSearchPhrase(author)}"`, skip);
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
            rights: data.metadata.rights || data.metadata.licenseurl || data.metadata.copyright_status || null,
            language: normalizeLanguage(data.metadata.language),
            genres: normalizeGenres(Array.isArray(data.metadata.subject) ? data.metadata.subject : data.metadata.subject ? [data.metadata.subject] : []),
            awards: extractAwards([data.metadata.title, data.metadata.description, ...(Array.isArray(data.metadata.subject) ? data.metadata.subject : [data.metadata.subject || ''])]),
            isPublicDomain: isExplicitlyPublicDomain(data.metadata),
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
            genres: normalizeGenres(Array.isArray(item.subject) ? item.subject : item.subject ? [item.subject] : []),
            language: normalizeLanguage(item.language),
            awards: extractAwards([item.title, item.description, ...(Array.isArray(item.subject) ? item.subject : [item.subject || ''])]),
            year: item.year ? parseInt(item.year, 10) : null,
            rights: item.rights || item.licenseurl || item.copyright_status || null,
            isPublicDomain: isExplicitlyPublicDomain(item),
            externalIds: {}
        };
    }
}
