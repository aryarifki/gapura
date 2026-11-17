// Human review is the only publication gate. Evidence completeness is expressed
// through needs_review on the draft; there is no machine-verification report.
export function validateDraftApproval({ status, needsReview, mode, acknowledgeReview = false }) {
  if (status !== 'draft') return { allowed: false, reason: 'draft_not_reviewable' };
  if (mode !== 'auto' && mode !== 'manual') return { allowed: false, reason: 'invalid_publish_mode' };
  if (mode === 'auto' && needsReview && !acknowledgeReview) return { allowed: false, reason: 'human_review_required' };
  return { allowed: true };
}
