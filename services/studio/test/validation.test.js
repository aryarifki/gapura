import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStudioPlan, validateStudioTopic } from '../validation.js';

const scoredTopic = { id: 42, title: 'Inflasi Oktober 2,1%', status: 'scored', score_total: 88, url: 'https://www.bps.go.id/rilis/1' };

test('accepts only analyzed topics above threshold with public source URL', () => {
  assert.deepEqual(validateStudioTopic(scoredTopic, 76), { valid: true, score: 88 });
  assert.equal(validateStudioTopic({ ...scoredTopic, status: 'new' }).reason, 'topic_not_scored');
  assert.equal(validateStudioTopic({ ...scoredTopic, score_total: 70 }, 76).reason, 'score_below_threshold');
  assert.equal(validateStudioTopic({ ...scoredTopic, url: 'https://localhost/private' }).reason, 'public_source_url_required');
  assert.equal(validateStudioTopic(null).reason, 'topic_not_found');
});

test('normalizes a valid plan without any verification field', () => {
  const result = normalizeStudioPlan({ title: 'Analisis inflasi', sections: ['Data BPS', 'Dampak'], verification_requested: false });
  assert.equal(result.verification_requested, undefined);
});

test('rejects plans that omit useful sections or exceed the story limit', () => {
  assert.throws(() => normalizeStudioPlan({ title: 'Judul', sections: ['satu'] }), /2-6 poin/);
  assert.throws(() => normalizeStudioPlan({ title: 'Judul', sections: Array(7).fill('poin') }), /2-6 poin/);
});

test('rejects invalid or failed scoring metadata and ignores archival verification status', () => {
  assert.equal(validateStudioTopic({ ...scoredTopic, verification_status: 'hoax_detected' }).valid, true);
  assert.equal(validateStudioTopic({ ...scoredTopic, score_verdict: 'rejected' }).reason, 'score_not_passed');
  assert.equal(validateStudioTopic({ ...scoredTopic, score_total: 101 }).reason, 'score_below_threshold');
});

test('plan normalization validates format/tone and keeps sections as editorial guidance', () => {
  assert.throws(() => normalizeStudioPlan({ title: 'Judul', sections: ['Sumber', 'Konteks'], format: 'video' }), /format/i);
  assert.throws(() => normalizeStudioPlan({ title: 'Judul', sections: [{ claim: 'fake' }, 'Konteks'] }), /poin|section/i);
  const normalized = normalizeStudioPlan({ title: 'Judul', sections: ['Sumber', 'Konteks'], format: 'single', unexpected_fact: 'bukan bukti' });
  assert.equal(normalized.format, 'single');
  assert.equal(normalized.unexpected_fact, undefined);
});
