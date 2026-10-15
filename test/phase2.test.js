import test from 'node:test';
import assert from 'node:assert/strict';
import { Aggregator } from '../src/services/aggregator.js';
import { catalogCache } from '../src/services/cache.js';
import { parseDurationSeconds } from '../src/providers/streams.js';

test('cluster identity bridge merges both previously separate clusters', () => {
    const aggregator = new Aggregator();
    const items = [
        { id: 'isbn:111', title: 'Book Alpha', authors: [] },
        { id: 'isbn:222', title: 'Book Beta', authors: [] },
        { id: 'isbn:222', title: 'Third record', authors: [], externalIds: { isbn: '111' } }
    ];
    const clusters = aggregator._clusterItems(items);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].length, 3);
});

test('canonical ID prefers an ISBN over an Apple collection ID regardless of provider order', () => {
    const aggregator = new Aggregator();
    const merged = aggregator._mergeGroup([
        { provider: 'apple', id: 'itunes:123', title: 'Book Alpha', authors: ['Jane Doe'] },
        { provider: 'google', id: 'isbn:9781234567890', title: 'Book Alpha', authors: ['Jane Doe'] }
    ]);
    assert.equal(merged.id, 'isbn:9781234567890');
    assert.deepEqual(new Set(merged.sourceIds), new Set(['itunes:123', 'isbn:9781234567890']));
});

test('author search uses provider author queries and filters unrelated records', async () => {
    const aggregator = new Aggregator();
    const author = 'Phase Two Exampleauthor';
    const title = 'Phase Two Unique Book';
    const calls = [];
    const item = (provider, id, authors = [author]) => ({ provider, id, title, authors, externalIds: {} });

    aggregator.providers.apple.search = async (query, skip) => {
        calls.push(['apple', query, skip]);
        return [item('apple', 'itunes:801'), item('apple', 'itunes:802', ['Someone Else'])];
    };
    aggregator.providers.google.searchByAuthor = async (query, skip, key) => {
        calls.push(['google', query, skip, key]);
        return [item('google', 'isbn:9780000000801')];
    };
    aggregator.providers.openlib.searchByAuthor = async (query, skip) => {
        calls.push(['openlib', query, skip]);
        return [item('openlib', 'olid:OL801W')];
    };
    aggregator.providers.librivox.searchByAuthor = async (query, skip) => {
        calls.push(['librivox', query, skip]);
        return [item('librivox', 'librivox:801')];
    };
    aggregator.providers.internetarchive.searchByAuthor = async (query, skip) => {
        calls.push(['internetarchive', query, skip]);
        return [item('ia', 'ia:phase-two-801')];
    };

    const results = await aggregator.searchByAuthor(author, 0, 'test-key');
    assert.deepEqual(new Set(calls.map(call => call[0])), new Set(['apple', 'google', 'openlib', 'librivox', 'internetarchive']));
    assert.deepEqual(calls.find(call => call[0] === 'google'), ['google', author, 0, 'test-key']);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'isbn:9780000000801');
    assert.equal(results[0].title, title);
});

test('empty aggregate results use a short negative cache TTL', async () => {
    const aggregator = new Aggregator();
    aggregator.providers.apple.search = async () => [];
    aggregator.providers.google.search = async () => [];
    aggregator.providers.openlib.search = async () => [];
    aggregator.providers.librivox.search = async () => [];

    const query = 'unique-negative-cache-phase-two-query';
    const results = await aggregator.searchAndSynthesize(query, 0);
    assert.deepEqual(results, []);

    const key = 'agg_search_' + query + '_0_default';
    const expiresAt = catalogCache.getTtl(key);
    assert.ok(expiresAt);
    const remainingSeconds = (expiresAt - Date.now()) / 1000;
    assert.ok(remainingSeconds > 0 && remainingSeconds <= 61, `Expected <=61s TTL, got ${remainingSeconds}`);
});

test('LibriVox durations parse HH:MM:SS and MM:SS instead of only the first integer', () => {
    assert.equal(parseDurationSeconds('01:02:03'), 3723);
    assert.equal(parseDurationSeconds('08:04'), 484);
    assert.equal(parseDurationSeconds('125'), 125);
    assert.equal(parseDurationSeconds('not-a-duration'), null);
});

test('stream resolution aggregates verified matching sources and rejects wrong titles', async () => {
    const aggregator = new Aggregator();
    let titleQuery;
    aggregator.getMetaAndSynthesize = async () => ({
        id: 'isbn:9780000000001',
        title: 'Book Alpha',
        authors: ['Jane Doe'],
        sourceIds: ['librivox:known', 'ia:known'],
        isPublicDomain: false
    });

    aggregator.providers.librivox.getStreams = async id => {
        if (id === 'librivox:known') return [{ url: 'https://audio.example/lv-known.mp3', name: 'LibriVox', title: 'Chapter 1' }];
        if (id === 'librivox:match') return [{ url: 'https://audio.example/lv-known.mp3', name: 'LibriVox', title: 'Duplicate chapter' }];
        return [];
    };
    aggregator.providers.librivox.searchByTitle = async title => {
        titleQuery = title;
        return [
            { id: 'librivox:match', title: 'Book Alpha', authors: ['Jane Doe'] },
            { id: 'librivox:wrong', title: 'Book Beta', authors: ['Jane Doe'] }
        ];
    };

    aggregator.providers.internetarchive.getMeta = async id => ({
        id, title: 'Book Alpha', authors: ['Jane Doe'], isPublicDomain: true
    });
    aggregator.providers.internetarchive.getStreams = async id => {
        if (id === 'ia:known') return [{ url: 'https://audio.example/ia-known.mp3', name: 'Internet Archive', title: 'Full audio' }];
        if (id === 'ia:match') return [{ url: 'https://audio.example/ia-match.mp3', name: 'Internet Archive', title: 'Full audio' }];
        return [];
    };
    aggregator.providers.internetarchive.searchByTitle = async () => [
        { id: 'ia:match', title: 'Book Alpha', authors: ['Jane Doe'], isPublicDomain: true },
        { id: 'ia:wrong', title: 'Book Beta', authors: ['Jane Doe'], isPublicDomain: true },
        { id: 'ia:restricted', title: 'Book Alpha', authors: ['Jane Doe'], isPublicDomain: false }
    ];

    const streams = await aggregator.getStreams('isbn:9780000000001');
    assert.equal(titleQuery, 'Book Alpha');
    assert.deepEqual(new Set(streams.map(stream => stream.url)), new Set([
        'https://audio.example/lv-known.mp3',
        'https://audio.example/ia-known.mp3',
        'https://audio.example/ia-match.mp3'
    ]));
    assert.equal(streams.some(stream => stream.url.includes('lv-wrong')), false);
});
