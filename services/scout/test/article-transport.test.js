import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

let scenario;
mock.module('node:https', { namedExports: { request: (...args) => scenario(...args) } });
const { requestArticleHttps } = await import('../article-reader.js');

function fakeTransport(t, { chunks = [], headers = {}, aborted = false, stalled = false } = {}) {
  let captured;
  scenario = (url, options, onResponse) => {
    const req = new EventEmitter();
    captured = { url, options };
    req.destroy = (error) => { req.emit('error', error); req.emit('close'); };
    req.end = () => {
      if (stalled) return;
      queueMicrotask(() => {
        const res = new EventEmitter();
        let destroyed = false;
        res.statusCode = 200;
        res.headers = headers;
        res.destroy = (error) => { destroyed = true; res.emit('error', error); req.emit('close'); };
        onResponse(res);
        if (destroyed) return;
        for (const chunk of chunks) { res.emit('data', Buffer.from(chunk)); if (destroyed) return; }
        if (aborted) res.emit('aborted');
        else res.emit('end');
        req.emit('close');
      });
    };
    return req;
  };
  t.after(() => { scenario = null; });
  return { get captured() { return captured; } };
}

const input = { url: 'https://publisher.example.org/article', address: '93.184.216.34', family: 4, headers: { 'User-Agent': 'GapuraMediaBot' }, maxBytes: 8, timeoutMs: 30 };

test('native HTTPS pins lookup while keeping original hostname for TLS and sends no credentials', async (t) => {
  const f = fakeTransport(t, { chunks: ['ab', 'cd'], headers: { 'content-type': 'text/html' } });
  const result = await requestArticleHttps(input);
  assert.equal(result.body.toString(), 'abcd');
  assert.equal(f.captured.url.hostname, 'publisher.example.org');
  const pinned = await new Promise((resolve, reject) => f.captured.options.lookup('publisher.example.org', { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
  assert.deepEqual(pinned, [{ address: input.address, family: 4 }]);
  assert.equal(f.captured.options.agent, false);
  assert.equal(f.captured.options.headers['Accept-Encoding'], 'identity');
  assert.equal(f.captured.options.headers.Authorization, undefined);
  assert.equal(f.captured.options.headers.Cookie, undefined);
});

test('native transport enforces streaming byte ceiling even without content-length', async (t) => {
  fakeTransport(t, { chunks: ['12345', '67890'] });
  await assert.rejects(() => requestArticleHttps(input), (error) => error.code === 'response_too_large');
});

test('oversized length, compressed encoding and truncated streams are refused', { timeout: 2000 }, async (t) => {
  for (const [options, code] of [
    [{ headers: { 'content-length': '100' } }, 'response_too_large'],
    [{ headers: { 'content-encoding': 'gzip' } }, 'response_encoding_unsupported'],
    [{ chunks: ['short'], aborted: true }, 'response_aborted'],
  ]) await t.test(code, async (sub) => {
    fakeTransport(sub, options);
    await assert.rejects(() => requestArticleHttps(input), (error) => error.code === code);
  });
});

test('a stalled native request has a real deadline', async (t) => {
  fakeTransport(t, { stalled: true });
  await assert.rejects(() => requestArticleHttps(input), (error) => error.code === 'request_timeout');
});
