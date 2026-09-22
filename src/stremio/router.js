import pkg from 'stremio-addon-sdk';
const { addonBuilder } = pkg;
import { manifest } from './manifest.js';
import { aggregator } from '../services/aggregator.js';

const builder = new addonBuilder(manifest);

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra, config = {} }) => {
    try {
        const skip = parseInt(extra?.skip || 0, 10);
        const catKey = 'cat_' + id;
        
        if (config[catKey] === false) {
            return { metas: [] };
        }

        let results = [];

        // 1. Dynamic Pinned Rows (Clean name search without invalid prefixes)
        if (id === 'pinned_author') {
            const author = config.pinned_author || 'Stephen King';
            results = await aggregator.searchAndSynthesize(author, skip);
        }
        else if (id === 'pinned_narrator') {
            const narrator = config.pinned_narrator || 'Scott Brick';
            results = await aggregator.searchAndSynthesize(narrator, skip);
        }
        // 2. Base Catalogues
        else if (extra?.search) {
            results = await aggregator.searchAndSynthesize(extra.search, skip);
        } 
        else if (id === 'genre') {
            const selectedGenre = extra?.genre || 'Science Fiction';
            results = await aggregator.searchAndSynthesize('subject:' + selectedGenre, skip);
        }
        else if (id === 'free_public_domain') {
            const searchResults = await aggregator.searchAndSynthesize('classic public domain audiobook', skip);
            results = searchResults.filter(r => r.isPublicDomain || r.id?.startsWith('librivox:') || r.id?.startsWith('ia:'));
        }
        else if (id === 'novels') {
            results = await aggregator.searchAndSynthesize('novel fiction audiobook', skip);
        }
        else if (id === 'short_stories') {
            results = await aggregator.searchAndSynthesize('short stories collection audiobook', skip);
        }
        else if (id === 'drama') {
            results = await aggregator.searchAndSynthesize('drama radio play audiobook', skip);
        }
        else if (id === 'full_cast') {
            results = await aggregator.searchAndSynthesize('full cast dramatization audiobook', skip);
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

        if (config.hide_abridged) {
            results = results.filter(r => r.abridged !== true);
        }
        if (config.public_domain_only) {
            results = results.filter(r => r.isPublicDomain === true || r.id?.startsWith('librivox:') || r.id?.startsWith('ia:'));
        }
        if (config.hide_explicit) {
            results = results.filter(r => {
                const desc = (r.description || '').toLowerCase();
                const genres = (r.genres || []).map(g => g.toLowerCase());
                return !desc.includes('explicit') && !desc.includes('mature') && !genres.includes('explicit');
            });
        }

        const metas = results.map(item => {
            const isFree = item.isPublicDomain || item.id?.startsWith('librivox:') || item.id?.startsWith('ia:');
            const freeBadge = isFree ? '🟢 Free Public Domain' : '';
            const narratorDisplay = item.narrators?.length && item.narrators[0] !== 'Unknown' 
                ? ('🎙️ ' + item.narrators.join(', ')) 
                : '';
            const authorDisplay = item.authors?.length ? ('✍️ ' + item.authors.join(', ')) : '';
            
            const subtitle = [freeBadge, narratorDisplay, authorDisplay].filter(Boolean).join(' • ');

            return {
                id: item.id,
                type: 'movie',
                name: item.title,
                poster: item.poster,
                background: item.background,
                description: subtitle ? (subtitle + '\n\n' + (item.description || '')) : item.description,
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

// --- META HANDLER (Interactive Deep-Linking) ---
builder.defineMetaHandler(async ({ type, id, config = {} }) => {
    try {
        const meta = await aggregator.getMetaAndSynthesize(id);
        if (!meta) return { meta: null };

        if (config.hide_abridged && meta.abridged === true) return { meta: null };
        if (config.public_domain_only && !meta.isPublicDomain && !id.startsWith('librivox:') && !id.startsWith('ia:')) return { meta: null };

        let formattedDesc = '';
        if (meta.narrators?.length && meta.narrators[0] !== 'Unknown') {
            formattedDesc += '🎙️ Narrated by: ' + meta.narrators.join(', ') + '\n';
        }
        if (meta.authors?.length) {
            formattedDesc += '✍️ Author: ' + meta.authors.join(', ') + '\n';
        }
        if (meta.series?.name) {
            formattedDesc += '📚 Series: ' + meta.series.name + (meta.series.index ? (' #' + meta.series.index) : '') + '\n';
        }

        const availableStreams = await aggregator.getStreams(id);
        if (availableStreams && availableStreams.length > 0) {
            formattedDesc += '\n🎧 **Free Public Domain Audio Available** (' + availableStreams.length + ' tracks • LibriVox / Internet Archive)\n';
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

        // Interactive Deep-Links
        if (meta.series?.name) {
            stremioMeta.links.push({
                name: meta.series.name,
                category: 'Series',
                url: 'stremio:///search?search=' + encodeURIComponent(meta.series.name)
            });
        }
        if (meta.authors?.length) {
            meta.authors.forEach(author => {
                stremioMeta.links.push({
                    name: 'More by ' + author,
                    category: 'Author',
                    url: 'stremio:///search?search=' + encodeURIComponent(author)
                });
            });
        }
        if (meta.narrators?.length && meta.narrators[0] !== 'Unknown') {
            meta.narrators.forEach(narrator => {
                stremioMeta.links.push({
                    name: 'Narrated by ' + narrator,
                    category: 'Narrator',
                    url: 'stremio:///search?search=' + encodeURIComponent(narrator)
                });
            });
        }

        return { meta: stremioMeta };
    } catch (err) {
        console.error('[Meta Handler Error]:', err);
        return { meta: null };
    }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ type, id, config = {} }) => {
    try {
        let streams = await aggregator.getStreams(id);
        const playbackStyle = config.playback_style || 'both';

        if (playbackStyle === 'single_file') {
            streams.sort((a, b) => {
                const aIsFull = a.title.toLowerCase().includes('complete') || a.title.toLowerCase().includes('full');
                const bIsFull = b.title.toLowerCase().includes('complete') || b.title.toLowerCase().includes('full');
                if (aIsFull && !bIsFull) return -1;
                if (!aIsFull && bIsFull) return 1;
                return 0;
            });
        } else if (playbackStyle === 'chapters') {
            streams = streams.filter(s => !s.title.toLowerCase().includes('complete') && !s.title.toLowerCase().includes('full'));
        }

        const stremioStreams = streams.map(s => {
            const runtime = s.duration ? (' [' + Math.round(s.duration / 60) + 'm]') : '';
            return {
                url: s.url,
                title: s.title + runtime,
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
