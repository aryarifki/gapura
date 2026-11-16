import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProductionGate, needsHumanReview, validateDraftApproval } from '../../common/editorial.js';

test('requires an analyst-passed topic before producing a new draft', () => {
  assert.deepEqual(evaluateProductionGate({ topicStatus: 'new' }), { allowed: false, reason: 'topic_not_scored' });
  assert.deepEqual(evaluateProductionGate({ topicStatus: 'rejected' }), { allowed: false, reason: 'topic_not_scored' });
});

test('returns an existing draft without rerunning production', () => {
  assert.deepEqual(evaluateProductionGate({ topicStatus: 'rejected', existingDraftId: 12 }), {
    allowed: true, existing: true, draftId: 12,
  });
});

test('never allows a hoax report to enter production, even with force', () => {
  assert.deepEqual(evaluateProductionGate({ topicStatus: 'scored', verification: { status: 'hoax_detected' }, force: true }), {
    allowed: false, reason: 'hoax_detected',
  });
});

test('permits an analyzed topic with an unverified report only as a review-required draft', () => {
  assert.deepEqual(evaluateProductionGate({ topicStatus: 'scored', verification: { status: 'unverified', confidence: 25 } }), {
    allowed: true, existing: false, needsReview: true,
  });
});

test('blocks a scored topic until an authoritative verification report exists', () => {
  assert.deepEqual(evaluateProductionGate({ topicStatus: 'scored' }), { allowed: false, reason: 'verification_required' });
});

test('only clears review for a high-confidence full verification', () => {
  assert.equal(needsHumanReview({ status: 'verified', confidence: 92 }), false);
  assert.equal(needsHumanReview({ status: 'mostly_verified', confidence: 92 }), true);
});

test('requires manual review when evidence is missing, weak, or contextual', () => {
  assert.equal(needsHumanReview(null), true);
  assert.equal(needsHumanReview({ status: 'verified', confidence: 40 }), true);
  assert.equal(needsHumanReview({ status: 'needs_context', confidence: 65 }), true);
});

test('blocks auto scheduling for review-required drafts and weak fact checks', () => {
  assert.equal(validateDraftApproval({ status: 'draft', needsReview: true, verification: { status: 'verified', confidence: 98 }, mode: 'auto' }).reason, 'human_review_required');
  assert.equal(validateDraftApproval({ status: 'draft', needsReview: false, verification: { status: 'needs_context', confidence: 70 }, mode: 'auto' }).reason, 'verification_gate_not_met');
});

test('permits verified auto scheduling only from draft state and never schedules hoaxes', () => {
  assert.deepEqual(validateDraftApproval({ status: 'draft', needsReview: false, verification: { status: 'verified', confidence: 90 }, mode: 'auto' }), { allowed: true });
  assert.equal(validateDraftApproval({ status: 'draft', needsReview: false, verification: { status: 'hoax_detected', confidence: 99 }, mode: 'auto' }).reason, 'hoax_detected');
  assert.equal(validateDraftApproval({ status: 'scheduled', needsReview: false, verification: { status: 'verified', confidence: 90 }, mode: 'auto' }).reason, 'draft_not_reviewable');
});

test('confidence must be finite and within 80..100 for automatic approval', () => {
  for (const confidence of [101, Infinity, NaN, 'invalid', null, -1, 79]) {
    assert.equal(validateDraftApproval({ status: 'draft', needsReview: false, verification: { status: 'verified', confidence }, mode: 'auto' }).allowed, false);
    assert.equal(needsHumanReview({ status: 'verified', confidence }), true);
  }
  for (const confidence of [80, 100]) {
    assert.equal(validateDraftApproval({ status: 'draft', needsReview: false, verification: { status: 'verified', confidence }, mode: 'auto' }).allowed, true);
  }
});
