import test from 'node:test';
import assert from 'node:assert/strict';
import { getApiKeyCacheScope } from '../src/providers/google.js';
import { isExplicitlyPublicDomain } from '../src/providers/streams.js';
import { getConfigureHtml } from '../src/stremio/configureHtml.js';
import { manifest } from '../src/stremio/manifest.js';

test('Google Books cache scopes are deterministic and distinct per key', () => {
    assert.equal(getApiKeyCacheScope('example-key'), getApiKeyCacheScope('example-key'));
    assert.notEqual(getApiKeyCacheScope('example-key'), getApiKeyCacheScope('another-key'));
    assert.equal(getApiKeyCacheScope('example-key').includes('example-key'), false);
});

test('Internet Archive unknown or restricted rights are not public domain', () => {
    assert.equal(isExplicitlyPublicDomain({}), false);
    assert.equal(isExplicitlyPublicDomain({ rights: 'Not in the public domain' }), false);
    assert.equal(isExplicitlyPublicDomain({ rights: 'All rights reserved' }), false);
    assert.equal(isExplicitlyPublicDomain({ rights: 'This work is in the public domain' }), true);
    assert.equal(isExplicitlyPublicDomain({ licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' }), true);
});

test('configurator safely embeds hostile input and uses the correct Stremio URI', () => {
    const attack = JSON.stringify({ pinned_author: '</script><script>alert(1)</script>' });
    const html = getConfigureHtml(manifest, 'localhost:7000', attack);
    assert.equal(html.includes('</script><script>alert(1)</script>'), false);
    assert.equal(html.includes(String.raw`\\u003c/script\\u003e`), true);
    assert.equal(html.includes(String.raw`url.replace(/^https?:\\/\\//i, "stremio://")`), true);
});

test('malformed configurator input falls back instead of being injected', () => {
    const html = getConfigureHtml(manifest, 'localhost:7000', '%');
    assert.equal(html.includes('const existingConfig = "{}";'), true);
});
