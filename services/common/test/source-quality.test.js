import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceQuality, chooseSourceDocuments } from '../source-quality.js';

const doc = (url, text = `Rujukan ${new URL(url).hostname} ${new URL(url).pathname} memuat uraian sumber substantif yang berbeda dan dapat diperiksa redaktur.`, extra = {}) => ({ url, text, text_kind: 'page', ...extra });

test('official and national tiers retain provenance evidence without declaring institutional claims true', () => {
  const political = sourceQuality(doc('https://www.dpr.go.id/berita/rapat', 'DPR menyatakan rancangan undang-undang akan menjamin keadilan.'));
  assert.equal(political.tier, 1);
  assert.equal(political.role, 'institutional_statement');
  assert.equal(political.truthVerified, false);
  assert.ok(political.evidence.includes('attribution_required:not_independent_verification'));
  assert.equal(sourceQuality(doc('https://www.msci.com/index-review')).tier, 1);
  assert.equal(sourceQuality(doc('https://news.detik.com/berita/report')).tier, 2);
  assert.equal(sourceQuality(doc('https://dpr.go.id.evil.example/report')).tier, 4);
  assert.equal(sourceQuality(doc('https://www.kompas.com.evil.example/report')).tier, 4);
  assert.equal(sourceQuality(doc('https://bi.go.id./rilis')).tier, 1);
  assert.equal(sourceQuality(doc('https://bi.go.id./rilis')).publisherIdentity, 'bi.go.id');
});

test('unknown public sources complement trusted reporting and specialist weighting follows the desk', () => {
  const unknown = sourceQuality(doc('https://laporan-independen.example/report'));
  assert.equal(unknown.accepted, true);
  assert.equal(unknown.tier, 4);
  const law = doc('https://www.hukumonline.com/berita/report');
  assert.equal(sourceQuality(law, { desk: 'hukum' }).tier, 3);
  assert.ok(sourceQuality(law, { desk: 'hukum' }).score > sourceQuality(law, { desk: 'bursa' }).score);
  assert.equal(sourceQuality(doc('http://127.0.0.1/report')).accepted, false);
});

test('regional coverage is downweighted only in national scope', () => {
  const regional = doc('https://www.detik.com/sumbagsel/berita/report');
  assert.ok(sourceQuality(regional).penalties.includes('regional_national_scope'));
  assert.ok(sourceQuality(regional).score < sourceQuality(regional, { scope: 'regional' }).score);
  assert.equal(sourceQuality(doc('https://www.detik.com/berita/report')).penalties.length, 0);
});

test('mirrors, republished articles and nonprimary social posts are penalties, not an allowlist', () => {
  const mirror = sourceQuality(doc('https://id.tradingview.com/news/report', undefined, { original_url: 'https://www.kontan.co.id/news/original' }));
  assert.equal(mirror.accepted, true);
  assert.equal(mirror.trusted, false);
  assert.equal(mirror.publisherIdentity, 'kontan.co.id');
  assert.ok(mirror.penalties.includes('mirror'));
  const reprint = sourceQuality(doc('https://www.kompas.com/berita/report', 'Artikel ini telah tayang di ANTARA, bukan laporan independen kedua.'));
  assert.equal(reprint.trusted, false);
  assert.ok(reprint.penalties.includes('syndication'));
  const social = doc('https://www.instagram.com/p/statement', undefined, { kind: 'social' });
  assert.ok(sourceQuality(social).penalties.includes('social_nonprimary'));
  assert.equal(sourceQuality({ ...social, is_primary: true, author: 'Narasumber', source_role: 'statement' }).role, 'primary_statement');
  assert.equal(sourceQuality({ ...social, is_primary: true }).role, 'social_context');
});

test('selection is stable, ranks trusted sources, groups publisher aliases and permits unknown complements', () => {
  const sources = [doc('https://independen.example/one'), doc('https://www.tempo.co/one'), doc('https://www.bi.go.id/one'),
    doc('https://news.detik.com/one'), doc('https://finance.detik.com/two'), doc('https://specialist.example/two')];
  const selected = chooseSourceDocuments(sources);
  assert.deepEqual(selected.map(({ sourceTier }) => sourceTier), [1, 2, 2, 4, 4]);
  assert.equal(new Set(selected.map(({ publisherIdentity }) => publisherIdentity)).size, 5);
  assert.deepEqual(chooseSourceDocuments(sources), selected);
  assert.equal(chooseSourceDocuments([doc('https://www.kompas.com/a'), doc('https://www.kompas.id/b'), ...sources], { limit: 3 }).length, 3);
  assert.equal(chooseSourceDocuments([sources[0], sources[2], sources[5]]).length, 3);
});

test('copied documents, same publishers and snippets never manufacture independent source counts', () => {
  const copy = 'Laporan yang sama disalin utuh ke tiga domain berbeda tanpa peliputan independen baru.';
  assert.throws(() => chooseSourceDocuments([doc('https://www.bi.go.id/a', copy), doc('https://copy.example/b', copy), doc('https://copy2.example/c', copy)]), /independent_publishers/);
  assert.throws(() => chooseSourceDocuments([doc('https://www.bi.go.id/a'), doc('https://www.bi.go.id/b'), doc('https://unknown.example/c')]), /independent_publishers/);
  assert.throws(() => chooseSourceDocuments([doc('https://one.example/a'), doc('https://two.example/b'), doc('https://three.example/c')]), /tier_1_or_2/);
  assert.throws(() => chooseSourceDocuments([doc('https://www.bi.go.id/a', undefined, { text_kind: 'snippet' }), doc('https://two.example/b'), doc('https://three.example/c')]), /tier_1_or_2/);
  assert.throws(() => chooseSourceDocuments([], { limit: 2 }), /limits_invalid/);
});

test('declared mirrors sharing an origin count as one publisher', () => {
  assert.throws(() => chooseSourceDocuments([doc('https://www.bi.go.id/a'),
    doc('https://copy.example/a', undefined, { original_url: 'https://www.bi.go.id/a' }), doc('https://www.tempo.co/report')]), /independent_publishers/);
});

test('syndication without a known origin cannot fill the independent-publisher requirement', () => {
  const reprint = doc('https://copy.example/story', 'Artikel ini telah tayang di portal lain dan memuat laporan yang diterbitkan ulang.');
  assert.throws(() => chooseSourceDocuments([doc('https://www.bi.go.id/a'), doc('https://www.tempo.co/b'), reprint]), /independent_publishers/);
  const selected = chooseSourceDocuments([doc('https://www.bi.go.id/a'), reprint, doc('https://independent.example/b'), doc('https://another.example/c')], { limit: 3 });
  assert.equal(selected.filter(({ source_quality }) => source_quality.independent).length, 3);
});

test('copied bodies with different markdown link targets do not count twice', () => {
  const original = 'Narasumber membahas [keterbukaan informasi](https://www.bi.go.id/rujukan) yang diperlukan bagi masyarakat serta menjelaskan kronologi rapat secara terperinci.';
  const copy = original.replace('https://www.bi.go.id/rujukan', 'https://mirror.example/rujukan');
  assert.throws(() => chooseSourceDocuments([doc('https://www.bi.go.id/a', original), doc('https://copy.example/b', copy), doc('https://www.tempo.co/c')]), /independent_publishers/);
});

test('near-identical full articles with an added footer do not manufacture independence', () => {
  const original = Array.from({ length: 80 }, (_, i) => `kata${i}`).join(' ');
  assert.throws(() => chooseSourceDocuments([doc('https://www.bi.go.id/a', original),
    doc('https://mirror.example/b', `${original} Copyright portal penerbit ulang.`), doc('https://www.tempo.co/report')]), /independent_publishers/);
});

test('unconfigured Indonesian nonprofit publishers retain distinct registrable identities', () => {
  const selected = chooseSourceDocuments([doc('https://www.bi.go.id/a'), doc('https://riset-a.or.id/report'), doc('https://riset-b.or.id/report')]);
  assert.deepEqual(selected.map(({ publisherIdentity }) => publisherIdentity), ['bi.go.id', 'riset-a.or.id', 'riset-b.or.id']);
});
