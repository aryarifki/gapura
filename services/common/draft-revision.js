import { createHash } from 'node:crypto';

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
}

export function draftContentHash(draft) {
  const content = { slides: draft.slides ?? [], caption: draft.caption ?? '', hashtags: draft.hashtags ?? [], content_format: draft.content_format ?? 'carousel' };
  if (draft.editorial_input != null || draft.editorial_mode != null) {
    for (const field of ['editorial_input', 'editorial_mode', 'caption_body', 'threads_caption', 'angle', 'scope_note', 'editorial_references']) content[field] = draft[field] ?? null;
  }
  return createHash('sha256').update(JSON.stringify(sortKeys(content))).digest('hex');
}
