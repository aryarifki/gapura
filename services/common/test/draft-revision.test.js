import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { draftContentHash } from '../draft-revision.js';

test('hashes only canonical draft content with recursively sorted JSON object keys', () => {
  const draft = {
    slides: [{ teks: 'Headline', data: { title: 'Title', chart: [{ value: 2, label: 'A' }], empty: null }, no: 1 }],
    caption: 'Caption', hashtags: ['#News'], content_format: 'single',
  };
  const before = JSON.stringify(draft);
  const canonical = '{"caption":"Caption","content_format":"single","hashtags":["#News"],"slides":[{"data":{"chart":[{"label":"A","value":2}],"empty":null,"title":"Title"},"no":1,"teks":"Headline"}]}';
  assert.equal(draftContentHash(draft), createHash('sha256').update(canonical).digest('hex'));
  assert.equal(draftContentHash({
    content_format: 'single', hashtags: ['#News'], caption: 'Caption',
    slides: [{ no: 1, data: { empty: null, chart: [{ label: 'A', value: 2 }], title: 'Title' }, teks: 'Headline' }],
    id: 99, status: 'scheduled', needs_review: false, updated_at: '2026-11-16',
  }), draftContentHash(draft));
  assert.equal(JSON.stringify(draft), before);
});

test('normalizes missing hashtags and absent content fields to stable defaults', () => {
  const defaults = { slides: [], caption: '', hashtags: [], content_format: 'carousel' };
  assert.equal(draftContentHash({}), draftContentHash(defaults));
  assert.equal(draftContentHash({ slides: null, caption: null, hashtags: null, content_format: null }), draftContentHash(defaults));
  const content = { slides: [{ teks: 'Headline' }], caption: 'Caption', content_format: 'single' };
  assert.equal(draftContentHash(content), draftContentHash({ ...content, hashtags: [] }));
});

test('changes revision for each content field and preserves slide and hashtag array order', () => {
  const draft = { slides: [{ teks: 'First' }, { teks: 'Second' }], caption: 'Caption', hashtags: ['#News', '#Gapura'], content_format: 'carousel' };
  const hash = draftContentHash(draft);
  assert.match(hash, /^[a-f0-9]{64}$/);
  for (const change of [
    { slides: [{ teks: 'Edited' }, draft.slides[1]] },
    { caption: 'Edited caption' },
    { hashtags: ['#Edited'] },
    { content_format: 'single' },
    { slides: [...draft.slides].reverse() },
    { hashtags: [...draft.hashtags].reverse() },
  ]) assert.notEqual(draftContentHash({ ...draft, ...change }), hash);
});
