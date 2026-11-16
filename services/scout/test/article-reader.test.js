import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticleReader, robotsAllows } from '../article-reader.js';

const url = 'https://publisher.example.org/news/one';
const html = '<html><h1>Fixture berita</h1><article><p>Pernyataan pertama menjelaskan keputusan lembaga kepada warga.</p><p>Pelaksanaan berlangsung pada tiga wilayah sesuai dokumen yang diterbitkan.</p><p>Catatan berikutnya akan disampaikan setelah tahapan pertama selesai.</p></article></html>';
const response = (status = 200, body = html, headers = { 'content-type': 'text/html; charset=utf-8' }) => ({ status, headers, body: Buffer.from(body) });

function fixture({ responses = [], addresses = ['93.184.216.34'], ...options } = {}) {
  const calls = [];
  const dnsCalls = [];
  let time = 1000;
  const reader = createArticleReader({
    now: () => time,
    lookupImpl: async (host) => { dnsCalls.push(host); return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })); },
    requestImpl: async (request) => {
      calls.push(request);
      const item = responses.shift();
      if (item instanceof Error) throw item;
      if (!item) throw new Error('Unexpected request');
      return item;
    },
    ...options,
  });
  return { reader, calls, dnsCalls, advance() { time += 16 * 60 * 1000; } };
}

test('article reader checks robots and pins public DNS address to the HTTPS request', async () => {
  const f = fixture({ responses: [response(200, 'User-agent: *\nAllow: /', { 'content-type': 'text/plain' }), response()] });
  const document = await f.reader.read({ url });
  assert.equal(document.extraction.status, 'full');
  assert.equal(document.paragraphs.length, 3);
  assert.equal(f.calls[0].url, 'https://publisher.example.org/robots.txt');
  assert.equal(f.calls[1].url, url);
  assert.ok(f.calls.every((call) => call.address === '93.184.216.34' && call.family === 4));
  assert.ok(f.calls.every((call) => call.headers['User-Agent'].includes('GapuraMediaBot')));
  const cached = await f.reader.read({ url });
  assert.equal(cached.body, document.body);
  assert.equal(f.calls.length, 2);
  cached.paragraphs[0].text = 'mutated';
  assert.notEqual((await f.reader.read({ url })).paragraphs[0].text, 'mutated');
});

test('robots rules respect specific agents, longest matches and allow exceptions', () => {
  const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: GapuraMediaBot\nDisallow: /private\nAllow: /private/public\nDisallow: /*?download=*$';
  assert.equal(robotsAllows(robots, url), true);
  assert.equal(robotsAllows(robots, 'https://publisher.example.org/private/report'), false);
  assert.equal(robotsAllows(robots, 'https://publisher.example.org/private/public/report'), true);
  assert.equal(robotsAllows(robots, 'https://publisher.example.org/a?download=1'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow:', url), true);
  assert.equal(robotsAllows('User-agent: OtherBot\nDisallow: /', url), true);
  assert.equal(robotsAllows('User-agent: OtherBot\nUser-agent: GapuraMediaBot\nDisallow: /news', url), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /news\nAllow: /news', url), true);
  assert.equal(robotsAllows('User-agent: GapuraMediaBot\nDisallow:\n\nUser-agent: OtherBot\nDisallow: /', url), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private\n\nUser-agent: GapuraMediaBot\nDisallow: /news', 'https://publisher.example.org/private/a'), true);
});

test('private literal/DNS/mixed DNS and credential URLs are blocked before any request', async () => {
  for (const candidate of ['https://127.0.0.1/a', 'https://[::ffff:127.0.0.1]/a', 'https://localhost/a', 'https://user:pass@publisher.example.org/a', 'http://publisher.example.org/a']) {
    const f = fixture();
    const document = await f.reader.read({ url: candidate });
    assert.equal(document.extraction.status, 'access_denied', candidate);
    assert.equal(f.calls.length, 0);
  }
  for (const addresses of [['10.0.0.1'], ['::1'], ['::ffff:10.0.0.1'], ['93.184.216.34', '192.168.0.1'], ['169.254.169.254'], ['100.64.0.1'], ['2001:db8::1']]) {
    const f = fixture({ addresses });
    assert.equal((await f.reader.read({ url })).extraction.status, 'access_denied', addresses.join(','));
    assert.equal(f.calls.length, 0);
  }
});

test('blocked robots and robots fetch failures never request the article', async () => {
  for (const robotsResponse of [response(200, 'User-agent: *\nDisallow: /news', { 'content-type': 'text/plain' }), response(403, ''), response(503, '')]) {
    const f = fixture({ responses: [robotsResponse] });
    assert.equal((await f.reader.read({ url })).extraction.status, 'robots_disallowed');
    assert.equal(f.calls.length, 1);
  }
  const f = fixture({ responses: [response(404, ''), response()] });
  assert.equal((await f.reader.read({ url })).extraction.status, 'full');
});

test('each redirect is checked, and redirects cannot lead to private targets or loops', async () => {
  const f = fixture({ responses: [response(404, ''), response(302, '', { location: '/news/two' }), response()] });
  assert.equal((await f.reader.read({ url })).extraction.status, 'full');
  assert.equal(f.calls.at(-1).url, 'https://publisher.example.org/news/two');
  const privateRedirect = fixture({ responses: [response(404, ''), response(302, '', { location: 'https://127.0.0.1/private' })] });
  assert.equal((await privateRedirect.reader.read({ url })).extraction.status, 'access_denied');
  assert.equal(privateRedirect.calls.length, 2);
  const loop = fixture({ maxRedirects: 1, responses: [response(404, ''), response(302, '', { location: '/next' }), response(302, '', { location: '/loop' })] });
  assert.equal((await loop.reader.read({ url })).extraction.error_code, 'redirect_limit');
});

test('HTTP failures and invalid/oversized/non-HTML responses have honest material status', async () => {
  const cases = [
    [response(401, ''), 'access_denied'], [response(403, ''), 'access_denied'],
    [response(429, ''), 'rate_limited'], [response(500, ''), 'unavailable'],
    [response(404, ''), 'unavailable'], [response(200, '%PDF', { 'content-type': 'application/pdf' }), 'parse_failed'],
    [response(200, 'x'.repeat(1025)), 'parse_failed'],
  ];
  for (const [article, expected] of cases) {
    const f = fixture({ maxBytes: 1024, responses: [response(404, ''), article] });
    const document = await f.reader.read({ url });
    assert.equal(document.extraction.status, expected);
    assert.equal(document.body, '');
    assert.deepEqual(document.paragraphs, []);
  }
  const f = fixture({ responses: [response(404, ''), Object.assign(new Error('do not leak URL credential'), { code: 'ETIMEDOUT' })] });
  const document = await f.reader.read({ url });
  assert.equal(document.extraction.status, 'unavailable');
  assert.equal(JSON.stringify(document).includes('do not leak'), false);
});

test('robots for a different redirect origin is checked before following the article', async () => {
  const f = fixture({ responses: [response(404, ''), response(302, '', { location: 'https://other.example.org/news/two' }), response(200, 'User-agent: *\nDisallow: /', { 'content-type': 'text/plain' })] });
  const document = await f.reader.read({ url });
  assert.equal(document.extraction.status, 'robots_disallowed');
  assert.equal(f.calls.at(-1).url, 'https://other.example.org/robots.txt');
});

test('an explicit refresh bypasses the article cache without bypassing robots policy', async () => {
  const f = fixture({ responses: [response(404, ''), response(), response(200, html.replace('Fixture berita', 'Judul revisi'))] });
  const first = await f.reader.read({ url });
  const revised = await f.reader.read({ url, refresh: true });
  assert.equal(first.title, 'Fixture berita');
  assert.equal(revised.title, 'Judul revisi');
  assert.equal(f.calls.length, 3, 'robots policy remains cached; article is fetched anew');
});

test('Google News resolves only an explicit publisher article link and checks destination robots', async () => {
  const aggregatorUrl = 'https://news.google.com/rss/articles/opaque';
  const target = 'https://publisher.example.org/news/resolved';
  const page = `<html><body><a href="https://publisher.example.org/">Publisher homepage</a><a href="${target}">Read article</a></body></html>`;
  const f = fixture({ responses: [response(404, ''), response(200, page), response(404, ''), response()] });
  const document = await f.reader.read({ url: aggregatorUrl, publisherUrl: 'https://publisher.example.org/' });
  assert.equal(document.extraction.status, 'full');
  assert.equal(document.canonical_url, target);
  assert.deepEqual(f.calls.map((call) => call.url), ['https://news.google.com/robots.txt', aggregatorUrl, 'https://publisher.example.org/robots.txt', target]);
});

test('an unresolved or ambiguous aggregator page never substitutes its publisher homepage or unrelated link', async () => {
  for (const body of [
    '<a href="https://publisher.example.org/">Publisher</a>',
    '<a href="https://other.example.org/article">Other article</a>',
    '<a href="https://publisher.example.org/a">One</a><a href="https://publisher.example.org/b">Two</a>',
  ]) {
    const f = fixture({ responses: [response(404, ''), response(200, body)] });
    const result = await f.reader.read({ url: 'https://news.google.com/rss/articles/opaque', publisherUrl: 'https://publisher.example.org/' });
    assert.equal(result.extraction.error_code, 'aggregator_unresolved');
    assert.equal(result.body, '');
    assert.equal(f.calls.length, 2);
  }
});

test('one read has a total time budget across DNS, robots, article requests and redirects', async () => {
  const calls = [];
  let time = 0;
  const reader = createArticleReader({
    now: () => time, totalTimeoutMs: 50, timeoutMs: 30,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl: async (input) => {
      calls.push(input);
      time += 30;
      return input.url.endsWith('/robots.txt') ? response(404, '') : response(302, '', { location: '/another' });
    },
  });
  const result = await reader.read({ url });
  assert.equal(result.extraction.error_code, 'request_timeout');
  assert.equal(result.extraction.status, 'unavailable');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.timeoutMs), [30, 20]);
});

test('article redirects to a publisher homepage never turn unrelated homepage stories into source material', async () => {
  const f = fixture({ responses: [response(404, ''), response(302, '', { location: '/' }), response()] });
  const result = await f.reader.read({ url });
  assert.equal(result.extraction.status, 'parse_failed');
  assert.equal(result.extraction.error_code, 'redirect_homepage');
  assert.equal(result.body, '');
  assert.equal(f.calls.length, 2);
});

test('robots matching normalizes percent-encoded unreserved characters without decoding path separators', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private', 'https://publisher.example.org/%70rivate/a'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /%70rivate', 'https://publisher.example.org/private/a'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private/path', 'https://publisher.example.org/private%2Fpath/a'), true);
});
