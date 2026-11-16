import test from 'node:test';
import assert from 'node:assert/strict';
import { loadService, recordingDb } from '../../scout/test/service-harness.js';

const title = 'Bank Indonesia mempertahankan suku bunga 5 persen';
const topic = { id: 1, title, summary: 'Keputusan suku bunga BI', url: 'https://www.bi.go.id/siaran-pers/1', primary_source: 'Bank Indonesia', created_at: '2026-11-16T00:00:00Z' };
function newsItem(headline, publisher, description = '') {
  return `<item><title>${headline}</title><link>https://news.google.com/rss/articles/${publisher.replaceAll('.', '-')}</link><source url="https://${publisher}">${publisher}</source><description>${description}</description><pubDate>2026-11-16T00:00:00Z</pubDate></item>`;
}
async function verify({ current = topic, news = '', local = [], verdict } = {}) {
  const db = recordingDb((sql, params) => {
    if (sql.includes('SELECT * FROM topics')) return { rows: [current] };
    if (sql.includes('similarity(')) return { rows: local };
    if (sql.includes('INSERT INTO verification_reports')) return { rows: [{ status: params[1], confidence: params[2], corroboration: JSON.parse(params[4]), claims: JSON.parse(params[5]), summary: params[8] }] };
    return { rows: [] };
  });
  const { verifyTopic } = await loadService('verificator/verificator.js', {
    client: db,
    config: verdict ? { verifikator: { api_key: 'fixture-key' } } : {},
    llm: async () => JSON.stringify(verdict),
    fetchImpl: async () => new Response(`<rss><channel>${news}</channel></rss>`),
  });
  return verifyTopic(1, { client: db });
}

test('official-looking names and misleading hostnames never elevate an untrusted source', async () => {
  for (const url of ['https://evil.example.org/a', 'https://bi.go.id.evil.example.org/a', 'https://bi.go.id@127.0.0.1/a', 'https://bi.go.id.local/a', 'file:///bi.go.id']) {
    const result = await verify({ current: { ...topic, url, primary_source: 'Otoritas Kementerian' } });
    assert.notEqual(result.signals.tier.tier, 'resmi', url);
    assert.equal(result.status, 'unverified');
  }
});

test('heuristics stay provisional even for a real official source and relevant headlines', async () => {
  const result = await verify({ news: newsItem(title, 'kontan.co.id') + newsItem(title, 'antaranews.com') });
  assert.equal(result.signals.tier.tier, 'resmi');
  assert.equal(result.status, 'needs_context');
  assert.ok(result.confidence <= 60);
});

test('unrelated headlines, same-publisher subdomains and local duplicates are not independent corroboration', async () => {
  const result = await verify({
    current: { ...topic, url: 'https://keuangan.kontan.co.id/a' },
    news: newsItem(title, 'investasi.kontan.co.id') + newsItem('Jadwal pertandingan sepak bola hari ini', 'antaranews.com') + newsItem(title, 'www.kontan.co.id'),
    local: [{ id: 2, title, url: 'https://nasional.kontan.co.id/a', primary_source: 'Kontan', sim: 0.9 }],
  });
  assert.equal(result.corroboration.google_news.distinct_domains, 0);
  assert.equal(result.corroboration.independent_publishers, 0);
  assert.equal(result.status, 'unverified');
  assert.equal(result.corroboration.google_news.examples[0].url.startsWith('https://news.google.com/'), true);
});

test('invalid publication dates remain unknown instead of crashing verification', async () => {
  const result = await verify({ current: { ...topic, published_at: 'bad-date', created_at: 'also-bad' } });
  assert.equal(result.signals.freshness.published_at, null);
  assert.equal(result.signals.freshness.age_hours, null);
});

test('LLM verified or hoax assertions are capped when supplied evidence cannot support them', async () => {
  for (const status of ['verified', 'mostly_verified', 'hoax_detected']) {
    const result = await verify({ verdict: { status, confidence: 100, claim: title, summary: 'All proven', claims: [{ claim: title, assessment: 'supported', note: 'I know this fact' }] } });
    assert.equal(result.status, 'unverified');
    assert.ok(result.confidence <= 30);
    assert.notEqual(result.claims[0]?.assessment, 'supported');
  }
});

test('full verification requires an explicit main-claim check citing real supplied excerpts from independent publishers', async () => {
  const description = 'Bank Indonesia mempertahankan suku bunga 5 persen pada rapat November 2026.';
  const result = await verify({
    news: newsItem(title, 'kontan.co.id', description) + newsItem(title, 'antaranews.com', description),
    verdict: {
      status: 'verified', confidence: 95, claim: title, summary: 'Didukung dua kutipan berita',
      claims: [{ claim: title, assessment: 'supported', evidence_ids: ['news:0', 'news:1'], quotes: [description, description] }],
    },
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.corroboration.independent_publishers, 2);
  assert.equal(result.claims[0].assessment, 'supported');
});

test('invented quotes and a different claim cannot authorize the verified badge', async () => {
  const result = await verify({
    news: newsItem(title, 'kontan.co.id', 'Bank Indonesia membahas ekonomi') + newsItem(title, 'antaranews.com', 'Pertemuan Bank Indonesia berlangsung'),
    verdict: { status: 'verified', confidence: 99, claim: title, claims: [{ claim: 'Ekonomi tumbuh 9 persen', assessment: 'supported', evidence_ids: ['news:0', 'news:1'], quotes: ['Ekonomi tumbuh 9 persen', 'Ekonomi tumbuh 9 persen'] }] },
  });
  assert.notEqual(result.status, 'verified');
  assert.notEqual(result.claims[0]?.assessment, 'supported');
});

test('headline echoes with publisher labels are not supporting excerpts', async () => {
  const result = await verify({
    news: newsItem(title, 'kontan.co.id', `${title} kontan.co.id`) + newsItem(title, 'antaranews.com', `${title} antaranews.com`),
    verdict: { status: 'verified', confidence: 100, claims: [{ claim: title, assessment: 'supported', evidence_ids: ['news:0', 'news:1'], quotes: [`${title} kontan.co.id`, `${title} antaranews.com`] }] },
  });
  assert.notEqual(result.status, 'verified');
});

test('negated excerpts and a changed action cannot be treated as support for the main claim', async () => {
  for (const excerpt of [
    'Bank Indonesia tidak mempertahankan suku bunga 5 persen pada rapat November 2026.',
    'Bank Indonesia menaikkan suku bunga 5 persen pada rapat November 2026.',
  ]) {
    const result = await verify({
      news: newsItem(title, 'kontan.co.id', excerpt) + newsItem(title, 'antaranews.com', excerpt),
      verdict: { status: 'verified', confidence: 99, claims: [{ claim: title, assessment: 'supported', evidence_ids: ['news:0', 'news:1'], quotes: [excerpt, excerpt] }] },
    });
    assert.notEqual(result.status, 'verified');
  }
});

test('a partial claim check cannot verify a stronger original headline', async () => {
  const original = 'Bank Indonesia menaikkan suku bunga menjadi 5 persen';
  const checked = 'Bank Indonesia suku bunga 5 persen';
  const description = 'Bank Indonesia mempertahankan suku bunga 5 persen pada rapat November 2026.';
  const result = await verify({
    current: { ...topic, title: original },
    news: newsItem(original, 'kontan.co.id', description) + newsItem(original, 'antaranews.com', description),
    verdict: { status: 'verified', confidence: 99, claims: [{ claim: checked, assessment: 'supported', evidence_ids: ['news:0', 'news:1'], quotes: [description, description] }] },
  });
  assert.notEqual(result.status, 'verified');
});

test('malformed LLM claim entries are ignored while the final verdict stays bounded', async () => {
  const result = await verify({ verdict: { status: 'verified', confidence: 100, claims: [null, 12, 'supported'] } });
  assert.equal(result.status, 'unverified');
  assert.deepEqual(result.claims, []);
});

test('supporting excerpts cannot justify an adverse misleading verdict', async () => {
  const description = 'Bank Indonesia mempertahankan suku bunga 5 persen pada rapat November 2026.';
  const result = await verify({
    news: newsItem(title, 'kontan.co.id', description) + newsItem(title, 'antaranews.com', description),
    verdict: { status: 'misleading', confidence: 99, claims: [{ claim: title, assessment: 'supported', evidence_ids: ['news:0', 'news:1'], quotes: [description, description] }] },
  });
  assert.equal(result.status, 'needs_context');
  assert.ok(result.confidence <= 60);
});

test('an unverified model response cannot report high confidence without supplied evidence', async () => {
  const result = await verify({ verdict: { status: 'unverified', confidence: 100, claims: [] } });
  assert.equal(result.status, 'unverified');
  assert.ok(result.confidence <= 30);
});

test('a supported main claim with other unchecked claims remains provisional', async () => {
  const description = 'Bank Indonesia mempertahankan suku bunga 5 persen pada rapat November 2026.';
  const result = await verify({
    news: newsItem(title, 'kontan.co.id', description) + newsItem(title, 'antaranews.com', description),
    verdict: { status: 'verified', confidence: 99, claims: [
      { claim: title, assessment: 'supported', evidence_ids: ['news:0', 'news:1'], quotes: [description, description] },
      { claim: 'Inflasi turun 2 persen', assessment: 'unsupported', evidence_ids: [], quotes: [] },
    ] },
  });
  assert.equal(result.status, 'needs_context');
});
