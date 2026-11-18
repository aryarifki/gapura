import { normalizeEditorialInput, validateOriginalDesign, ORIGINAL_ROLES, ORIGINAL_CLAIM_TYPES } from '../common/original-editorial.js';

const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;

/** Legacy source excerpts are never eligible for R6 retry/idempotent reuse. */
export function isDraftComplete(draft) {
  if (!draft || !['draft', 'approved', 'scheduled', 'published'].includes(draft.status) || draft.content_format !== 'carousel') return false;
  try {
    const input = json(draft.editorial_input);
    if (input?.version !== 1 || !['explainer', 'current'].includes(input.mode) || draft.editorial_mode !== input.mode) return false;
    normalizeEditorialInput(input);
    if (typeof draft.caption_body !== 'string' || draft.caption_body.trim().length < 1200 || draft.caption_body.length > 1900
        || typeof draft.caption !== 'string' || !draft.caption.trim() || draft.caption.length > 2200
        || typeof draft.threads_caption !== 'string' || !draft.threads_caption.trim() || draft.threads_caption.length > 500
        || typeof draft.angle !== 'string' || !draft.angle.trim() || typeof draft.scope_note !== 'string' || !draft.scope_note.trim()) return false;
    const slides = json(draft.slides);
    if (!Array.isArray(slides) || slides.length < 3 || slides.length > 9 || Number(draft.rendered_count) !== slides.length) return false;
    const factIds = new Set(input.facts.map((fact) => fact.id));
    const validIds = (ids) => Array.isArray(ids) && new Set(ids).size === ids.length && ids.every((id) => factIds.has(id));
    const references = json(draft.editorial_references);
    if (!references || !Array.isArray(references.caption) || references.caption.length !== draft.caption_body.split(/\n\s*\n/u).length
        || !validIds(references.threads) || references.caption.some((block) => !block || !ORIGINAL_CLAIM_TYPES.includes(block.kind)
          || !validIds(block.fact_ids) || (block.kind === 'fact' && (input.mode !== 'current' || !block.fact_ids.length)))) return false;
    if (slides.some((slide, index) => !slide || slide.no !== index + 1 || typeof slide.teks !== 'string' || !slide.teks.trim()
        || !ORIGINAL_ROLES.includes(slide.role) || (index === 0 ? slide.role !== 'cover' : slide.role === 'cover')
        || typeof slide.purpose !== 'string' || !slide.purpose.trim() || !ORIGINAL_CLAIM_TYPES.includes(slide.claim_type)
        || !validIds(slide.fact_ids)
        || (slide.claim_type === 'fact' && (input.mode !== 'current' || !slide.fact_ids.length)))) return false;
    if (new Set(slides.map((slide) => slide.teks.trim().toLocaleLowerCase('id'))).size !== slides.length) return false;
    validateOriginalDesign({ slides: slides.map(({ no, layout }) => ({ no, layout })) }, { format: 'carousel', slides });
    return true;
  } catch { return false; }
}
