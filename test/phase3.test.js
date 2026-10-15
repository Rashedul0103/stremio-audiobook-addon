import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLanguage, filterByLanguage, toLibraryLanguageCode } from '../src/utils/language.js';
import { extractAwards } from '../src/utils/genreMapper.js';
import { GoogleBooksProvider } from '../src/providers/google.js';
import { Aggregator } from '../src/services/aggregator.js';
import { getConfigureHtml } from '../src/stremio/configureHtml.js';
import { manifest } from '../src/stremio/manifest.js';

test('language metadata maps ISO, MARC, display names, and Open Library paths', () => {
    assert.equal(normalizeLanguage('en'), 'en');
    assert.equal(normalizeLanguage('Bengali'), 'bn');
    assert.equal(normalizeLanguage('ben'), 'bn');
    assert.equal(normalizeLanguage('/languages/hin'), 'hi');
    assert.equal(normalizeLanguage('Arabic'), 'ar');
    assert.equal(normalizeLanguage('Turkish'), 'tr');
    assert.equal(normalizeLanguage('Multilingual'), null);
    assert.equal(toLibraryLanguageCode('bn'), 'ben');
    assert.equal(toLibraryLanguageCode('tr'), 'tur');
});

test('language filter excludes unknown and mismatched records when a language is selected', () => {
    const items = [
        { title: 'English', language: 'eng' },
        { title: 'Bangla', language: 'bn' },
        { title: 'Unknown' }
    ];
    assert.deepEqual(filterByLanguage(items, 'bn').map(item => item.title), ['Bangla']);
    assert.deepEqual(filterByLanguage(items, 'all'), items);
});

test('award extraction requires both an award name and evidence of winning or receiving it', () => {
    assert.deepEqual(extractAwards(['Winner of the Audie Award for Fiction']), ['Audie Award']);
    assert.deepEqual(extractAwards(['Recipient of the Hugo Award', 'Pulitzer Prize winner']), ['Hugo Award', 'Pulitzer Prize']);
    assert.deepEqual(extractAwards(['The Audie Awards annual guide', 'Hugo Award shortlist']), []);
});

test('Google Books mapping retains actual score, review count, and language', () => {
    const provider = new GoogleBooksProvider();
    const meta = provider._mapItem({
        id: 'volume-phase3',
        volumeInfo: {
            title: 'Bangla Award Book',
            authors: ['Example Author'],
            averageRating: 4.7,
            ratingsCount: 140,
            language: 'bn',
            description: 'Winner of the Audie Award for Fiction'
        }
    });
    assert.equal(meta.language, 'bn');
    assert.equal(meta.ratings.score, 4.7);
    assert.equal(meta.ratings.count, 140);
    assert.deepEqual(meta.awards, ['Audie Award']);
});

test('newest aggregate mode passes newest ordering and selected language to Google Books', async () => {
    const aggregator = new Aggregator();
    let googleOptions;
    const record = (provider, id, title, year, language = 'bn') => ({
        provider, id, title, year, language, authors: [title + ' Author'], genres: []
    });
    aggregator.providers.apple.search = async () => [record('apple', 'itunes:old', 'Older Item', 2001)];
    aggregator.providers.google.search = async (_query, _skip, _key, options) => {
        googleOptions = options;
        return [
            record('google', 'isbn:9780000000001', 'Newer Item', 2024),
            record('google', 'isbn:9780000000002', 'Middle Item', 2018)
        ];
    };
    aggregator.providers.openlib.search = async () => [];
    aggregator.providers.librivox.search = async () => [];
    aggregator.providers.internetarchive.search = async () => [];

    const results = await aggregator.searchAndSynthesize(
        'phase-three-newest-fixture',
        0,
        '',
        { orderBy: 'newest', language: 'bn' }
    );
    assert.deepEqual(googleOptions, { orderBy: 'newest', language: 'bn' });
    assert.deepEqual(results.map(item => item.title), ['Newer Item', 'Middle Item', 'Older Item']);
});

test('genre catalogue results are filtered by provider-supplied genre metadata', async () => {
    const aggregator = new Aggregator();
    const book = (provider, id, title, genre) => ({
        provider, id, title, authors: [title + ' Author'], genres: [genre], language: 'en'
    });
    aggregator.providers.apple.search = async () => [book('apple', 'itunes:fantasy', 'Fantasy Book', 'Fantasy')];
    aggregator.providers.google.getByGenre = async () => [book('google', 'isbn:science', 'Science Fiction Book', 'Science Fiction')];
    aggregator.providers.openlib.getByGenre = async () => [];
    aggregator.providers.librivox.searchByGenre = async () => [];
    aggregator.providers.internetarchive.searchByGenre = async () => [];

    const results = await aggregator.searchByGenre('Fantasy');
    assert.deepEqual(results.map(item => item.title), ['Fantasy Book']);
});

test('narrator catalogue returns only verified narrator matches', async () => {
    const aggregator = new Aggregator();
    aggregator.searchAndSynthesize = async () => [
        { title: 'Read by Stephen Fry', narrators: ['Stephen Fry'] },
        { title: 'Read by Someone Else', narrators: ['Someone Else'] },
        { title: 'Unknown Narrator', narrators: ['Unknown'] }
    ];
    const results = await aggregator.searchByNarrator('Stephen Fry');
    assert.deepEqual(results.map(item => item.title), ['Read by Stephen Fry']);
});

test('catalogue names do not claim an unsupported global bestseller or trending rank', () => {
    const find = id => manifest.catalogs.find(catalog => catalog.id === id);
    assert.equal(find('bestsellers').name, 'Bestseller Mentions');
    assert.equal(find('trending').name, 'Explore Audiobooks');
    assert.equal(find('new_releases').name, 'Recently Published');
    assert.equal(find('by_narrator').extra.some(extra => extra.name === 'narrator' && extra.isRequired), true);
});

test('configurator exposes the requested South Asian and Turkish languages', () => {
    const html = getConfigureHtml(manifest, 'localhost:7000', '{}');
    for (const code of ['en', 'bn', 'hi', 'ur', 'ar', 'tr']) {
        assert.equal(html.includes('value="' + code + '"'), true, 'Missing language option: ' + code);
    }
});
