import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseFormat, normalizeDesign, validateDesignOutput } from '../carousel.js';

const topic = { title: 'BPS mencatat inflasi Indonesia sebesar 2,1%', summary: 'Inflasi tahunan mencapai 2,1% menurut BPS.' };

test('chooses one image for a compact, simple, verified announcement', () => {
  assert.equal(chooseFormat(topic), 'single');
});

test('chooses a carousel for complex, high-momentum, or low-confidence coverage', () => {
  assert.equal(chooseFormat({ ...topic, title: 'OJK menetapkan regulasi baru', summary: 'Mekanisme dan dampak aturan baru.' }), 'carousel');
  assert.equal(chooseFormat({ ...topic, trendScore: 90 }), 'carousel');
  assert.equal(chooseFormat({ ...topic, verification: { status: 'needs_context' } }), 'carousel');
});

test('normalizes a selected single format to exactly one cover slide without a CTA slide', () => {
  const design = normalizeDesign({ format: 'single', slides: [{ layout: 'stat-grid', teks: topic.title, data: { value: '2.1%' } }] }, topic);
  assert.equal(design.format, 'single');
  assert.equal(design.slides.length, 1);
  assert.equal(design.slides[0].layout, 'cover-focus');
  assert.equal(design.slides[0].data.value, '2.1%');
});

test('discards an image URL invented by the designer instead of supplied by the source', () => {
  const design = normalizeDesign({ format: 'single', slides: [{ teks: 'Headline', data: { image_url: 'https://attacker.example/fake.jpg' } }] }, topic);
  assert.equal(design.slides[0].data.image_url, undefined);
});

test('validates carousel slide count and keeps the closing slide after normalization', () => {
  const fallback = [{ layout: 'cover-focus', teks: 'Cover' }, { layout: 'body', teks: 'Body' }, { layout: 'cta-close', teks: 'Close' }];
  const design = validateDesignOutput({ format: 'carousel', slides: fallback }, topic, fallback);
  assert.equal(design.slides.length, 3);
  assert.equal(design.slides[0].no, 1);
  assert.equal(design.slides[2].layout, 'cta-close');
  assert.throws(() => validateDesignOutput({ format: 'carousel', slides: [{ teks: 'x' }, { teks: 'y' }] }, topic), /minimal berisi tiga slide/);
  assert.throws(() => validateDesignOutput({ format: 'carousel', slides: Array.from({ length: 10 }, () => ({ teks: 'x' })) }, topic), /1-9/);
});
