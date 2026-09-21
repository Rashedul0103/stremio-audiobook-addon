import pkg from 'stremio-addon-sdk';
const { addonBuilder } = pkg;
import { manifest } from './manifest.js';
import { aggregator } from '../services/aggregator.js';

const builder = new addonBuilder(manifest);

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra, config = {} }) => {
    try {
        const skip = parseInt(extra?.skip || 0, 10);
        
        // 1. Catalogue enable/disable toggle check
        const catKey = `cat_${id}`;
        if (config[catKey] === false) {
            return { metas: [] };
        }

        let results = [];

        // 2. Route to catalogue logic
        if (extra?.search) {
            results = await aggregator.searchAndSynthesize(extra.search, skip);
        } 
        else if (id === 'genre') {
            const selectedGenre = extra?.genre || 'Science Fiction';
            results = await aggregator.searchAndSynthesize(`subject:${selectedGenre}`, skip);
        }
        else if (id === 'full_cast') {
            results = await aggregator.searchAndSynthesize('full cast dramatization', skip);
        }
        else if (id === 'bestsellers' || id === 'trending') {
            results = await aggregator.searchAndSynthesize('bestselling audiobooks', skip);
        }
        else if (id === 'new_releases') {
            results = await aggregator.searchAndSynthesize('new release audiobooks', skip);
        }
        else if (id === 'top_rated') {
            results = await aggregator.searchAndSynthesize('highly rated audiobooks', skip);
        }
        else if (id === 'award_winners') {
            results = await aggregator.searchAndSynthesize('audie award winner audiobook', skip);
        }
        else if (id === 'series') {
            results = await aggregator.searchAndSynthesize('popular book series', skip);
        }
        else if (id === 'by_narrator') {
            results = await aggregator.searchAndSynthesize('popular audiobook narrators', skip);
        } else {
            results = await aggregator.searchAndSynthesize('audiobook', skip);
        }

        // 3. Apply Content Filters
        if (config.hide_abridged) {
            results = results.filter(r => r.abridged !== true);
        }
        if (config.public_domain_only) {
            results = results.filter(r => r.isPublicDomain === true || r.id?.startsWith('librivox:') || r.id?.startsWith('ia:'));
        }

        const metas = results.map(item => {
            const narratorDisplay = item.narrators?.length && item.narrators[0] !== 'Unknown' 
                ? `🎙️ ${item.narrators.join(', ')}` 
                : '';
            const authorDisplay = item.authors?.length ? `✍️ ${item.authors.join(', ')}` : '';
            const subtitle = [narratorDisplay, authorDisplay].filter(Boolean).join(' • ');

            return {
                id: item.id,
                type: 'movie',
                name: item.title,
                poster: item.poster,
                background: item.background,
                description: subtitle ? `${subtitle}\n\n${item.description || ''}` : item.description,
                genres: item.genres,
                director: item.authors,
                cast: item.narrators,
                releaseInfo: item.year ? String(item.year) : null
            };
        });

        return { metas };
    } catch (err) {
        console.error('[Catalog Handler Error]:', err);
        return { metas: [] };
    }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ type, id, config = {} }) => {
    try {
        const meta = await aggregator.getMetaAndSynthesize(id);
        if (!meta) return { meta: null };

        if (config.hide_abridged && meta.abridged === true) {
            return { meta: null };
        }
        if (config.public_domain_only && !meta.isPublicDomain && !id.startsWith('librivox:') && !id.startsWith('ia:')) {
            return { meta: null };
        }

        let formattedDesc = '';
        if (meta.narrators?.length && meta.narrators[0] !== 'Unknown') {
            formattedDesc += `🎙️ Narrated by: ${meta.narrators.join(', ')}\n`;
        }
        if (meta.authors?.length) {
            formattedDesc += `✍️ Author: ${meta.authors.join(', ')}\n`;
        }
        if (meta.series?.name) {
            formattedDesc += `📚 Series: ${meta.series.name}${meta.series.index ? ` #${meta.series.index}` : ''}\n`;
        }
        if (formattedDesc) formattedDesc += '\n';
        formattedDesc += meta.description || 'No description available.';

        const stremioMeta = {
            id: meta.id,
            type: 'movie',
            name: meta.title,
            poster: meta.poster,
            background: meta.background,
            description: formattedDesc,
            genres: meta.genres,
            director: meta.authors,
            cast: meta.narrators,
            releaseInfo: meta.year ? String(meta.year) : null,
            links: []
        };

        if (meta.series?.name) {
            stremioMeta.links.push({
                name: meta.series.name,
                category: 'Series',
                url: `stremio:///search?search=${encodeURIComponent(meta.series.name)}`
            });
        }
        if (meta.authors?.[0]) {
            stremioMeta.links.push({
                name: meta.authors[0],
                category: 'Author',
                url: `stremio:///search?search=${encodeURIComponent(meta.authors[0])}`
            });
        }

        return { meta: stremioMeta };
    } catch (err) {
        console.error('[Meta Handler Error]:', err);
        return { meta: null };
    }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ type, id }) => {
    try {
        // Leverages aggregator's proven LibriVox & Internet Archive stream resolution
        const streams = await aggregator.getStreams(id);

        const stremioStreams = streams.map(s => {
            const runtime = s.duration ? ` [${Math.round(s.duration / 60)}m]` : '';
            return {
                url: s.url,
                title: `${s.title}${runtime}`,
                name: s.name || 'Audiobook Stream'
            };
        });

        return { streams: stremioStreams };
    } catch (err) {
        console.error('[Stream Handler Error]:', err);
        return { streams: [] };
    }
});

export const addonInterface = builder.getInterface();
