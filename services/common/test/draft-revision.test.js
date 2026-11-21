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

const original = {
  slides: [{ teks: 'Layanan publik' }], caption: 'Caption Gapura', hashtags: ['#Gapura'], content_format: 'carousel',
  editorial_mode: 'explainer',
  editorial_input: { context: 'Konteks awal', facts: [{ text: 'Fakta sumber', source: { url: 'https://example.org/source', title: 'Sumber' } }] },
  caption_body: 'Isi caption', threads_caption: 'Versi Threads #Gapura', angle: 'Dampak bagi warga', scope_note: 'Penjelasan umum',
  editorial_references: { caption: [{ kind: 'context', fact_ids: [] }], threads: [], article: [] },
  article_body: 'Artikel lengkap awal.', article_references: [],
};

test('original revisions cover mode, canonical editorial input and every reviewed metadata field', () => {
  const hash = draftContentHash(original);
  for (const change of [
    { editorial_mode: 'current' }, { editorial_input: { ...original.editorial_input, context: 'Konteks diubah' } },
    { editorial_input: { ...original.editorial_input, facts: [{ ...original.editorial_input.facts[0], source: { url: 'https://example.org/other', title: 'Sumber' } }] } },
    { caption_body: 'Isi caption diubah' }, { threads_caption: 'Versi Threads diubah' },
    { angle: 'Sudut pandang diubah' }, { scope_note: 'Ruang lingkup diubah' },
    { editorial_references: { caption: [{ kind: 'fact', fact_ids: ['f1'] }], threads: [] } },
    { editorial_references: { caption: [], threads: ['f1'] } }, { editorial_references: null },
    { article_body: 'Artikel direvisi tanpa review.' }, { article_references: ['f1'] },
    { editorial_mode: null }, { editorial_input: null },
  ]) assert.notEqual(draftContentHash({ ...original, ...change }), hash, JSON.stringify(change));
});

test('original editorial input sorts nested keys while preserving fact order and the caller object', () => {
  const before = JSON.stringify(original);
  const reordered = { ...original, editorial_input: { facts: [{ source: { title: 'Sumber', url: 'https://example.org/source' }, text: 'Fakta sumber' }], context: 'Konteks awal' } };
  assert.equal(draftContentHash(reordered), draftContentHash(original));
  const facts = [...original.editorial_input.facts, { text: 'Fakta kedua' }];
  assert.notEqual(draftContentHash({ ...original, editorial_input: { facts } }), draftContentHash({ ...original, editorial_input: { facts: facts.toReversed() } }));
  assert.equal(JSON.stringify(original), before);
});

test('nullable R6 columns leave historical hashes unchanged, and either original marker activates hashing', () => {
  const legacy = { caption: 'Caption', slides: [], hashtags: [] };
  const nullable = { editorial_input: null, editorial_mode: null, caption_body: null, threads_caption: null, angle: null, scope_note: null, editorial_references: null, article_body: null, article_references: null };
  assert.equal(draftContentHash({ ...legacy, ...nullable }), draftContentHash(legacy));
  assert.equal(draftContentHash({ ...legacy, caption_body: 'Historical annotation', threads_caption: 'Annotation' }), draftContentHash(legacy));
  for (const marker of [{ editorial_mode: 'current' }, { editorial_input: { context: 'Fixture' } }]) {
    const draft = { ...legacy, ...marker };
    assert.notEqual(draftContentHash(draft), draftContentHash(legacy));
    assert.notEqual(draftContentHash({ ...draft, angle: 'Changed' }), draftContentHash(draft));
    assert.equal(draftContentHash(draft), draftContentHash({ ...draft, ...nullable, ...marker }));
  }
});

test('current fact links bind each slide, caption paragraph and Threads summary without depending on audit timestamps', () => {
  const current = { ...original, editorial_mode: 'current', updated_at: '2026-11-17T12:00:00Z',
    editorial_input: { version: 1, mode: 'current', facts: [{ id: 'f1', text: 'BPS mencatat inflasi 2,1%.', source_url: 'https://www.bps.go.id/fixture', source_name: 'BPS' }] },
    slides: [{ no: 1, teks: 'Inflasi 2,1% menurut BPS', claim_type: 'fact', fact_ids: ['f1'], data: { title: 'Inflasi 2,1%' } }],
    editorial_references: { caption: [{ kind: 'fact', fact_ids: ['f1'] }, { kind: 'context', fact_ids: [] }], threads: ['f1'], article: ['f1'] },
  };
  const hash = draftContentHash(current);
  for (const change of [
    { slides: [{ ...current.slides[0], fact_ids: [] }] },
    { editorial_input: { ...current.editorial_input, facts: [{ ...current.editorial_input.facts[0], source_name: 'Another source' }] } },
    { editorial_references: { ...current.editorial_references, caption: current.editorial_references.caption.toReversed() } },
    { editorial_references: { ...current.editorial_references, caption: [{ kind: 'fact', fact_ids: [] }, current.editorial_references.caption[1]] } },
    { editorial_references: { ...current.editorial_references, threads: [] } },
    { article_body: 'Naskah artikel lain.' }, { article_references: ['f1'] },
  ]) assert.notEqual(draftContentHash({ ...current, ...change }), hash);
  assert.equal(draftContentHash({ ...current, editorial_references: { threads: ['f1'], caption: [{ fact_ids: ['f1'], kind: 'fact' }, { fact_ids: [], kind: 'context' }], article: ['f1'] } }), hash);
  assert.equal(draftContentHash({ ...current, updated_at: '2026-11-18T12:00:00Z' }), hash);
});
