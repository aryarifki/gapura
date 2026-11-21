import test from 'node:test';
import assert from 'node:assert/strict';
import { isDraftComplete } from '../editorial.js';
import { buildEditorialBrief, validateOriginalContent } from '../../common/original-editorial.js';
import { originalFixture, DISCOVERY_TOPICS } from '../../common/test/fixtures/original-editorial.js';

function draft() {
  const brief = buildEditorialBrief(DISCOVERY_TOPICS.sosial);
  const content = validateOriginalContent(originalFixture(brief), brief);
  return { ...content, id: 12, status: 'draft', content_format: content.format, rendered_count: content.slides.length };
}

test('only a fully rendered original carousel is complete, including JSONB string adapters', () => {
  const content = draft();
  assert.equal(isDraftComplete(content), true);
  assert.equal(isDraftComplete({ ...content, slides: JSON.stringify(content.slides), editorial_input: JSON.stringify(content.editorial_input), editorial_references: JSON.stringify(content.editorial_references), article_facts: JSON.stringify(content.article_facts) }), true);
  for (const status of ['approved', 'scheduled', 'published']) assert.equal(isDraftComplete({ ...content, status }), true);
});

test('legacy publisher-source originals and single drafts cannot be reused for R6', () => {
  assert.equal(isDraftComplete({ id: 1, status: 'draft', content_format: 'single', rendered_count: 1, slides: [{ no: 1, layout: 'cover-focus', teks: 'Judul publisher' }] }), false);
  const { editorial_input, ...legacy } = draft();
  assert.equal(isDraftComplete(legacy), false);
});

test('partial, empty, duplicated, malformed and unaudited scripts are incomplete', () => {
  for (const mutate of [
    (value) => { value.rendered_count = 5; },
    (value) => { value.status = 'failed'; },
    (value) => { value.slides[1] = null; },
    (value) => { value.slides[1].teks = ' '; },
    (value) => { value.slides[1].teks = value.slides[2].teks; },
    (value) => { value.slides[1].no = 3; },
    (value) => { delete value.slides[1].purpose; },
    (value) => { value.slides[1].claim_type = 'fact'; },
    (value) => { value.slides[1].fact_ids = ['missing']; },
    (value) => { value.slides[1].layout = 'chart-bar'; },
    (value) => { value.slides = '{not-json'; },
    (value) => { value.caption_body = 'Terlalu pendek'; },
    (value) => { value.caption = 'x'.repeat(2201); },
    (value) => { value.threads_caption = 'x'.repeat(501); },
    (value) => { value.editorial_mode = 'current'; },
    (value) => { value.editorial_input = { version: 0, mode: 'explainer', facts: [] }; },
    (value) => { delete value.editorial_references; },
    (value) => { value.editorial_references.caption[0].fact_ids = ['invented']; },
    (value) => { value.editorial_references.caption.pop(); },
    (value) => { value.editorial_references.threads = ['invented']; },
    (value) => { value.article_body = 'Naskah lama yang belum memiliki panjang artikel yang diwajibkan.'; },
  ]) {
    const value = draft(); mutate(value);
    assert.equal(isDraftComplete(value), false);
  }
  assert.equal(isDraftComplete({ ...draft(), article_body: '' }), false);
});
