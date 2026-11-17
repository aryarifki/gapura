import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraftApproval } from '../../common/editorial.js';

test('blocks auto scheduling while a draft still needs review', () => {
  assert.equal(validateDraftApproval({ status: 'draft', needsReview: true, mode: 'auto' }).reason, 'human_review_required');
});

test('permits auto scheduling only from draft state with explicit review acknowledged', () => {
  assert.deepEqual(validateDraftApproval({ status: 'draft', needsReview: false, mode: 'auto' }), { allowed: true });
  assert.deepEqual(validateDraftApproval({ status: 'draft', needsReview: true, mode: 'auto', acknowledgeReview: true }), { allowed: true });
  assert.equal(validateDraftApproval({ status: 'scheduled', needsReview: false, mode: 'auto' }).reason, 'draft_not_reviewable');
});

test('manual approval needs neither auto review acknowledgement nor a review flag', () => {
  assert.deepEqual(validateDraftApproval({ status: 'draft', needsReview: true, mode: 'manual' }), { allowed: true });
  assert.equal(validateDraftApproval({ status: 'draft', needsReview: false, mode: 'publish-now' }).reason, 'invalid_publish_mode');
});

test('the approval gate carries no machine verification input', () => {
  const gate = validateDraftApproval({ status: 'draft', needsReview: false, mode: 'auto', verification: { status: 'hoax_detected', confidence: 99 } });
  assert.deepEqual(gate, { allowed: true });
});
