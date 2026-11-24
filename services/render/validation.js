// Keep rendering bounded and local. Source image URLs are hydrated by trusted
// callers; only embedded raster images can become Satori image sources.
export const MAX_SLIDES = 9;
export const EDITORIAL_LAYOUTS = Object.freeze([
  'editorial-cover', 'editorial-lead', 'editorial-breakdown', 'editorial-timeline',
  'editorial-quote', 'editorial-impact', 'editorial-close',
]);
const MAX_TEXT = 4000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_REQUEST_IMAGE_BYTES = 7 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const IMAGE_KINDS = new Set(['ai_generated', 'editor_upload']);
const RIGHTS_BASES = new Set(['own_work', 'licensed_stock', 'agency_license']);
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(message) {
  throw Object.assign(new Error(`Invalid payload: ${message}`), { status: 400 });
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid(`${name} must be an object`);
  }
}

function text(value, name, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length > max) invalid(`${name} must be a string of at most ${max} characters`);
}

function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SLIDES) invalid(`${name} must be an integer from 1 to ${MAX_SLIDES}`);
}

export function validateDraftId(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d{0,15}$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    invalid('draft_id must be a positive safe integer');
  }
  return String(value);
}

function imageData(value, budget) {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_CHARS + 32) invalid('image_data exceeds the 4 MiB limit');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) invalid('image_data must be a base64 PNG, JPEG or WebP data URI');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) invalid('image_data is invalid or exceeds the 4 MiB limit');
  const validType = match[1] === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : match[1] === 'jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!validType) invalid('image_data content does not match its raster MIME type');
  budget.imageBytes += bytes.length;
  if (budget.imageBytes > MAX_REQUEST_IMAGE_BYTES) invalid('image_data total exceeds the 7 MiB batch limit');
}

function bounded(value, name, budget, depth = 0) {
  if (++budget.nodes > 4096 || depth > 6) invalid(`${name} is too complex`);
  if (name.endsWith('.image_data')) return imageData(value, budget);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    text(value, name);
    budget.text += value.length;
    if (budget.text > 64000) invalid('total text exceeds 64000 characters');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(`${name} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 32) invalid(`${name} may have at most 32 entries`);
    value.forEach((entry, index) => bounded(entry, `${name}[${index}]`, budget, depth + 1));
    return;
  }
  object(value, name);
  if (Object.keys(value).length > 64) invalid(`${name} may have at most 64 fields`);
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > 64 || FORBIDDEN_KEYS.has(key)) invalid(`${name} has an invalid field`);
    bounded(entry, `${name}.${key}`, budget, depth + 1);
  }
}

function collection(data, key, check) {
  if (data[key] === undefined) return;
  if (!Array.isArray(data[key])) invalid(`slide.data.${key} must be an array`);
  data[key].forEach((value) => check(value, `slide.data.${key} entry`));
}

function scalar(value, name) {
  if (typeof value === 'number' && Number.isFinite(value)) return;
  text(value, name);
}

function textFields(data, fields) {
  for (const field of fields) if (data[field] !== undefined && data[field] !== null) text(data[field], `slide.data.${field}`);
}

const hasText = (value) => typeof value === 'string' && Boolean(value.trim());

// Historical data layouts remain available, but every displayed datum must come
// from the caller. Share this check with direct layout resolution and the API.
export function validateLayoutData(layout, data = {}) {
  if (EDITORIAL_LAYOUTS.includes(layout)) {
    object(data, 'slide.data');
    if (!hasText(data.title)) invalid(`${layout} requires non-empty slide.data.title`);
    if (layout === 'editorial-breakdown' && (!Array.isArray(data.items) || !data.items.length || data.items.length > 6
      || data.items.some((item) => !hasText(item?.label) || !hasText(item?.value)))) {
      invalid('editorial-breakdown requires 1-6 slide.data.items with a non-empty label and narrative value');
    }
    if (layout === 'editorial-timeline' && (!Array.isArray(data.events) || !data.events.length || data.events.length > 5
      || data.events.some((event) => !hasText(event?.date) || !hasText(event?.text) || !Array.isArray(event?.fact_ids)
        || !event.fact_ids.length || event.fact_ids.length > 8 || event.fact_ids.some((id) => !hasText(id))))) {
      invalid('editorial-timeline requires 1-5 slide.data.events with a source date, text and non-empty fact_ids');
    }
    if (layout === 'editorial-quote' && ['quote', 'author', 'role_label'].some((field) => !hasText(data[field]))) {
      invalid('editorial-quote requires non-empty slide.data.quote, author and role_label');
    }
    if (layout === 'editorial-close' && !hasText(data.question)) invalid('editorial-close requires non-empty slide.data.question');
    if (layout === 'editorial-impact' && data.items !== undefined && (!Array.isArray(data.items) || !data.items.length || data.items.length > 6
      || data.items.some((item) => !hasText(item?.label) || !(hasText(item?.value) || (typeof item?.value === 'number' && Number.isFinite(item.value)))))) {
      invalid('editorial-impact requires 1-6 slide.data.items with a non-empty label and value when items are supplied');
    }
  }
  if (layout === 'stat-grid' && (!Array.isArray(data.items) || !data.items.length || data.items.some((item) =>
    !hasText(item?.label) || !(hasText(item?.value) || (typeof item?.value === 'number' && Number.isFinite(item.value)))))) {
    invalid('stat-grid requires non-empty slide.data.items with a label and value for every item');
  }
  if (['chart-bar', 'chart-line'].includes(layout) && (!Array.isArray(data.labels) || !Array.isArray(data.values)
    || !data.labels.length || data.labels.length !== data.values.length || data.labels.some((label) => !hasText(label))
    || data.values.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) {
    invalid(`${layout} requires non-empty slide.data.labels and finite numeric values of matching length`);
  }
  if (layout === 'timeline' && (!Array.isArray(data.events) || !data.events.length
    || data.events.some((event) => !hasText(event?.date) || !hasText(event?.text)))) {
    invalid('timeline requires non-empty slide.data.events with a date and text for every event');
  }
  if (layout === 'comparison' && ['left', 'right'].some((side) => !hasText(data[side]?.title) || !hasText(data[side]?.text))) {
    invalid('comparison requires slide.data.left and right, each with a non-empty title and text');
  }
}

export function validateSlide(slide, budget = { nodes: 0, text: 0, imageBytes: 0 }) {
  object(slide, 'slide');
  bounded(slide, 'slide', budget);
  if (slide.no !== undefined) count(slide.no, 'slide.no');
  if (slide.layout !== undefined && (typeof slide.layout !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(slide.layout))) {
    invalid('slide.layout must be a layout slug of at most 64 characters');
  }
  if (slide.teks !== undefined) text(slide.teks, 'slide.teks');
  if (slide.source !== undefined && slide.source !== null) text(slide.source, 'slide.source', 1000);
  const data = slide.data ?? {};
  object(data, 'slide.data');
  if (data.image_url !== undefined && data.image_url !== null && data.image_url !== '') {
    invalid('slide.data.image_url must be hydrated to image_data by the trusted caller');
  }
  if (Object.hasOwn(data, 'image_kind') && !IMAGE_KINDS.has(data.image_kind)) invalid('slide.data.image_kind must be ai_generated or editor_upload when present');
  if (data.image_kind) {
    if (typeof data.asset_id !== 'string' || !ASSET_ID.test(data.asset_id)) {
      invalid(`slide.data.asset_id must be a UUID for an ${data.image_kind} image`);
    }
    if (data.asset_sha256 !== undefined && (typeof data.asset_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(data.asset_sha256))) {
      invalid('slide.data.asset_sha256 must be a SHA-256 digest when present');
    }
    if (data.image_data === undefined) invalid(`slide.data.image_data is required for an ${data.image_kind} image`);
    if (data.image_kind === 'editor_upload') {
      if (!hasText(data.credit) || data.credit.length > 200) invalid('slide.data.credit is required for an editor_upload image');
      if (!RIGHTS_BASES.has(data.rights_basis)) invalid('slide.data.rights_basis must be a known rights basis for an editor_upload image');
    }
  }
  textFields(data, ['title', 'headline', 'kicker', 'role_label', 'question', 'subtitle', 'subtext', 'unit', 'label', 'category', 'author', 'quote', 'callout', 'regulasi', 'note', 'cta', 'disclaimer', 'status', 'verdict', 'claim', 'explanation', 'finding', 'fakta', 'misconception', 'miskonsepsi', 'source_note', 'image_url', 'credit']);
  for (const key of ['value', 'stat', 'credibility']) if (data[key] !== undefined && data[key] !== null) scalar(data[key], `slide.data.${key}`);
  if (!(slide.teks || data.title || data.headline || '').trim()) invalid('slide requires non-empty teks, title or headline');

  for (const key of ['items', 'cards', 'metrics']) collection(data, key, (item, name) => {
    object(item, name);
    textFields(item, ['label', 'title', 'text']);
    for (const field of ['value', 'stat', 'number']) if (item[field] !== undefined) scalar(item[field], `${name}.${field}`);
  });
  for (const key of ['bullets', 'points', 'labels', 'sources']) collection(data, key, text);
  collection(data, 'values', (value, name) => { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${name} must be a finite number`); });
  if ((data.labels !== undefined || data.values !== undefined) && (!data.labels?.length || data.labels.length !== data.values?.length)) {
    invalid('slide.data.labels and values must be non-empty arrays of matching length');
  }
  collection(data, 'events', (event, name) => { object(event, name); text(event.date, `${name}.date`); text(event.text, `${name}.text`); });
  collection(data, 'paragraphs', (paragraph, name) => { object(paragraph, name); text(paragraph.text, `${name}.text`, 600); });
  collection(data, 'list', (entry, name) => {
    if (typeof entry === 'string') return text(entry, name);
    object(entry, name);
    textFields(entry, ['label', 'title', 'text']);
    for (const key of ['value', 'stat', 'number']) if (entry[key] !== undefined) scalar(entry[key], `${name}.${key}`);
  });
  if (data.list?.length && data.list.some((entry) => typeof entry !== typeof data.list[0])) invalid('slide.data.list must contain only text or only objects');
  for (const key of ['left', 'right']) if (data[key] !== undefined) { object(data[key], `slide.data.${key}`); textFields(data[key], ['title', 'text', 'content']); }
  validateLayoutData(slide.layout, data);
  return slide;
}

export function validateSlides(slides) {
  if (!Array.isArray(slides) || slides.length < 1 || slides.length > MAX_SLIDES) invalid(`slides must contain 1-${MAX_SLIDES} slides`);
  const budget = { nodes: 0, text: 0, imageBytes: 0 };
  slides.forEach((slide, index) => {
    validateSlide(slide, budget);
    if (slide.no !== undefined && slide.no !== index + 1) invalid('slide.no must be consecutive, starting at 1');
  });
  return slides;
}

export function validateOverrides(tokens) {
  if (tokens === null || tokens === undefined) return;
  object(tokens, 'tokens');
  bounded(tokens, 'tokens', { nodes: 0, text: 0, imageBytes: 0 });
  for (const key of ['brand', 'palette', 'typography', 'grid', 'canvas', 'chart']) if (tokens[key] !== undefined) object(tokens[key], `tokens.${key}`);
  for (const [key, value] of Object.entries(tokens.palette || {})) {
    if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) invalid(`tokens.palette.${key} must be a hex color`);
  }
  for (const [key, value] of Object.entries(tokens.brand || {})) text(value, `tokens.brand.${key}`, 1000);
  for (const [key, value] of Object.entries(tokens.grid || {})) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 200) invalid(`tokens.grid.${key} must be a number from 0 to 200`);
}

export function validatePreview(slide, slideNo = 1, totalSlides = 1, tokens = null) {
  count(slideNo, 'slide_no');
  count(totalSlides, 'total_slides');
  if (slideNo > totalSlides) invalid('slide_no cannot exceed total_slides');
  validateSlide(slide);
  validateOverrides(tokens);
}

export function validateRenderRequest(body, preview = false) {
  object(body, 'body');
  if (preview) validatePreview(body.slide, body.slide_no, body.total_slides, body.tokens);
  else { validateDraftId(body.draft_id); validateSlides(body.slides); }
}
