import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import yaml from 'js-yaml';

const root = new URL('../../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const tagline = 'Politik, Sosial, Hukum, Lingkungan & Ekonomi Nasional termasuk Bursa Saham';

test('saved brand identity and Studio defaults reflect all six national desks', () => {
  const tokens = yaml.load(read('design-system/tokens.yaml'));
  assert.equal(tokens.brand.tagline, tagline);
  const html = read('services/web/public/index.html');
  assert.ok(html.includes(`value="${tagline.replaceAll('&', '&amp;')}"`));
  const app = read('services/web/public/app.js');
  assert.ok(app.includes(`brand.tagline || '${tagline}'`));
  for (const source of [html, app, read('README.md')]) {
    assert.doesNotMatch(source, /Data, Hukum &(?:amp;)? Ekonomi Bursa|Portal Data, Hukum|Konten Instagram Data-Editorial & Regulasi Finansial/u);
  }
});

test('Studio sample pages cover the six desks without fictional current-news figures', () => {
  const source = read('services/web/public/app.js');
  const sample = source.slice(source.indexOf('function getDefaultStudioSlides()'), source.indexOf('\nfunction populateStudioTopics()'));
  const slides = JSON.parse(JSON.stringify(runInNewContext(`${sample}\ngetDefaultStudioSlides()`)));
  assert.deepEqual(slides.map((slide) => slide.data.category), ['POLITIK', 'SOSIAL', 'HUKUM', 'LINGKUNGAN', 'EKONOMI NASIONAL', 'BURSA SAHAM']);
  assert.deepEqual(slides.map((slide) => slide.no), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(slides.map((slide) => slide.teks)).size, 6);
  assert.ok(slides.every((slide) => slide.source === 'Contoh redaksi · Gapura Media'));
  assert.doesNotMatch(JSON.stringify(slides), /\d+%|IHSG|rekomendasi investasi|nasihat hukum/u);
});
