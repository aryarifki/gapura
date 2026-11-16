import { validatePublicSourceUrl } from '../common/sources.js';

export function validateStudioTopic(topic, threshold = 76) {
  if (!topic) return { valid: false, reason: 'topic_not_found' };
  if (topic.verification_status === 'hoax_detected') return { valid: false, reason: 'hoax_detected' };
  if (topic.status !== 'scored') return { valid: false, reason: 'topic_not_scored' };
  if (topic.score_verdict !== undefined && topic.score_verdict !== 'passed') return { valid: false, reason: 'score_not_passed' };
  const score = Number(topic.score_total);
  if (!Number.isInteger(score) || score < threshold || score > 100) return { valid: false, reason: 'score_below_threshold' };
  if (validatePublicSourceUrl(topic.url)) return { valid: false, reason: 'public_source_url_required' };
  return { valid: true, score };
}

export function normalizeStudioPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Rencana harus berupa object JSON.');
  const title = typeof plan.title === 'string' ? plan.title.trim() : '';
  if (Array.isArray(plan.sections) && plan.sections.some((item) => typeof item !== 'string' || item.length > 600)) throw new Error('Poin sections harus teks maksimal 600 karakter.');
  const sections = Array.isArray(plan.sections) ? plan.sections.map((item) => item.trim()).filter(Boolean) : [];
  if (!title || title.length > 120 || sections.length < 2 || sections.length > 6) {
    throw new Error('Rencana perlu judul (maksimal 120 karakter) dan 2-6 poin isi.');
  }
  if (plan.format !== undefined && !['single', 'carousel'].includes(plan.format)) throw new Error('Format rencana harus single atau carousel.');
  const result = { title, sections, verification_requested: true };
  for (const key of ['angle', 'goal', 'caption_tone', 'revision_instruction']) {
    if (plan[key] !== undefined) {
      if (typeof plan[key] !== 'string' || plan[key].length > 1000) throw new Error(`${key} harus teks maksimal 1000 karakter.`);
      result[key] = plan[key].trim();
    }
  }
  if (plan.format) result.format = plan.format;
  if (plan.slide_count_hint !== undefined) {
    if (!Number.isInteger(plan.slide_count_hint) || plan.slide_count_hint < 1 || plan.slide_count_hint > 9) throw new Error('slide_count_hint harus 1-9.');
    result.slide_count_hint = plan.slide_count_hint;
  }
  if (Array.isArray(plan.hashtags)) result.hashtags = [...new Set(plan.hashtags.filter((tag) => typeof tag === 'string' && /^#[\p{L}\p{N}_]{1,40}$/u.test(tag)))].slice(0, 12);
  return result;
}
