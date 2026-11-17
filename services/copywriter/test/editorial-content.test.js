import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceBasedContent } from '../editorial.js';

test('uses only facts present in the article data in deterministic fallback copy', () => {
  const result = buildEvidenceBasedContent({
    title: 'BPS mencatat inflasi sebesar 2,1%',
    summary: 'Inflasi tahunan Indonesia pada Oktober tercatat 2,1% menurut BPS.',
    primary_source: 'BPS',
    url: 'https://www.bps.go.id/rilis/1',
    format: 'carousel',
  });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /2,1%/);
  assert.match(serialized, /https:\/\/www\.bps\.go\.id\/rilis\/1/);
  assert.doesNotMatch(serialized, /katalis domestik|stabilitas fundamental|transmisi kebijakan/);
  assert.equal(result.format, 'single');
  assert.equal(result.slides.length, 1);
  assert.equal(result.slides[0].layout, 'cover-focus');
});

test('flags missing source evidence and avoids manufacturing a body narrative', () => {
  const result = buildEvidenceBasedContent({ title: 'OJK menerbitkan aturan baru', summary: '', primary_source: '', url: '' });
  assert.equal(result.needs_review, true);
  assert.equal(result.source_url, '');
  assert.ok(result.caption.startsWith('OJK menerbitkan aturan baru\n\n'));
  assert.doesNotMatch(result.caption, /Sumber primer|Status verifikasi/i);
  assert.equal(result.slides.filter((slide) => slide.layout === 'big-statement').length, 0);
});

test('supports a single-layer post without an injected carousel CTA', () => {
  const result = buildEvidenceBasedContent({
    title: 'BPS merilis inflasi 2,1%', summary: 'Inflasi Oktober 2,1%.', primary_source: 'BPS',
    url: 'https://www.bps.go.id/rilis/1', format: 'single',
  });
  assert.equal(result.slides.length, 1);
  assert.equal(result.format, 'single');
});
