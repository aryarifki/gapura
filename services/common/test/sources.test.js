import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicSourceUrl, validatePublicSourceUrl } from '../sources.js';

test('accepts public HTTPS source URLs and extracts publisher domains', () => {
  assert.equal(validatePublicSourceUrl('https://www.bps.go.id/pressrelease/'), null);
  assert.deepEqual(parsePublicSourceUrl('https://www.antaranews.com/ekonomi/1'), {
    url: 'https://www.antaranews.com/ekonomi/1', sourceName: 'antaranews.com',
  });
});

test('rejects invalid schemes, userinfo, and local/private address targets', () => {
  for (const url of ['not-a-url', 'http://example.com/a', 'https://user:pass@example.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.4/a', 'https://192.168.1.2/a', 'https://[::1]/a']) {
    assert.notEqual(validatePublicSourceUrl(url), null, url);
  }
});
