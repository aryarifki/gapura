const REVIEW_STATUSES = new Set(['needs_context', 'unverified', 'opinion', 'speculation', 'misleading', 'hoax_detected']);

export function needsHumanReview(verification) {
  if (!verification || REVIEW_STATUSES.has(verification.status)) return true;
  const confidence = Number(verification.confidence);
  return verification.status !== 'verified' || !Number.isFinite(confidence) || confidence < 80 || confidence > 100;
}

export function evaluateProductionGate({ topicStatus, existingDraftId = null, verification = null, force = false }) {
  if (existingDraftId && !force) return { allowed: true, existing: true, draftId: existingDraftId };
  if (verification?.status === 'hoax_detected') return { allowed: false, reason: 'hoax_detected' };
  if (topicStatus !== 'scored') return { allowed: false, reason: 'topic_not_scored' };
  if (!verification) return { allowed: false, reason: 'verification_required' };
  return { allowed: true, existing: false, needsReview: needsHumanReview(verification) };
}

export function validateDraftApproval({ status, needsReview, verification, mode, acknowledgeReview = false }) {
  if (status !== 'draft') return { allowed: false, reason: 'draft_not_reviewable' };
  if (mode !== 'auto' && mode !== 'manual') return { allowed: false, reason: 'invalid_publish_mode' };
  if (verification?.status === 'hoax_detected') return { allowed: false, reason: 'hoax_detected' };
  if (mode === 'auto' && needsReview && !acknowledgeReview) return { allowed: false, reason: 'human_review_required' };
  if (mode === 'auto' && needsHumanReview(verification)) {
    return { allowed: false, reason: 'verification_gate_not_met' };
  }
  return { allowed: true };
}
