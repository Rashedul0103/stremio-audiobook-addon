const defaultExtra = [
    { name: 'skip', isRequired: false },
    { name: 'search', isRequired: false }
];

export const manifest = {
    id: 'community.audiobook.cinemeta',
    version: '1.0.0',
    name: 'Cinemeta of Audiobooks',
    description: 'Comprehensive audiobook discovery, cinema-grade metadata, and source-aggregation engine.',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Audiobook_icon.svg/1200px-Audiobook_icon.svg.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie'],
    idPrefixes: ['isbn:', 'asin:', 'olid:', 'slug:', 'librivox:', 'ia:', 'gb:', 'itunes:'],
    catalogs: [
        { type: 'movie', id: 'bestsellers', name: 'Bestsellers', extra: defaultExtra },
        { type: 'movie', id: 'new_releases', name: 'New Releases', extra: defaultExtra },
        { type: 'movie', id: 'trending', name: 'Popular & Trending', extra: defaultExtra },
        { type: 'movie', id: 'top_rated', name: 'Top Rated', extra: defaultExtra },
        { type: 'movie', id: 'award_winners', name: 'Award Winners', extra: defaultExtra },
        { type: 'movie', id: 'full_cast', name: 'Full Cast Dramatizations', extra: defaultExtra },
        { type: 'movie', id: 'series', name: 'Book Series', extra: defaultExtra },
        { type: 'movie', id: 'by_narrator', name: 'By Narrator', extra: defaultExtra },
        { 
            type: 'movie', 
            id: 'genre', 
            name: 'Genres', 
            extra: [
                { 
                    name: 'genre', 
                    isRequired: false,
                    options: ['Science Fiction', 'Fantasy', 'Thriller', 'Mystery', 'Romance', 'Biography', 'History', 'Self-Help', 'Horror', 'Classics'] 
                },
                { name: 'skip', isRequired: false }
            ] 
        },
        { type: 'movie', id: 'search', name: 'Search', extra: [{ name: 'search', isRequired: true }, { name: 'skip', isRequired: false }] }
    ],
    configuration: [
        // Catalogue Toggles
        { key: 'cat_bestsellers', type: 'checkbox', title: 'Enable Bestsellers', default: true },
        { key: 'cat_new_releases', type: 'checkbox', title: 'Enable New Releases', default: true },
        { key: 'cat_trending', type: 'checkbox', title: 'Enable Popular & Trending', default: true },
        { key: 'cat_top_rated', type: 'checkbox', title: 'Enable Top Rated', default: true },
        { key: 'cat_award_winners', type: 'checkbox', title: 'Enable Award Winners', default: true },
        { key: 'cat_full_cast', type: 'checkbox', title: 'Enable Full Cast', default: true },
        { key: 'cat_series', type: 'checkbox', title: 'Enable Book Series', default: true },
        { key: 'cat_by_narrator', type: 'checkbox', title: 'Enable By Narrator', default: true },
        { key: 'cat_genre', type: 'checkbox', title: 'Enable Genres', default: true },
        { key: 'cat_search', type: 'checkbox', title: 'Enable Search', default: true },
        // Content Preferences
        { key: 'hide_abridged', type: 'checkbox', title: 'Hide Abridged Versions', default: false },
        { key: 'public_domain_only', type: 'checkbox', title: 'Public Domain Only (LibriVox / IA)', default: false }
    ],
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    }
};
