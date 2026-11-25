import { validatePublicSourceUrl } from './sources.js';

export const EDITORIAL_CATEGORIES = Object.freeze(['politik', 'sosial', 'hukum', 'lingkungan', 'ekonomi', 'bursa']);

export const EDITORIAL_POLICY = Object.freeze({
  carousel: Object.freeze({ format: 'carousel', min_slides: 3, default_slides: 6, max_slides: 9 }),
  media: Object.freeze({ require_cover_visual: true, default_kind: 'ai_generated', allowed_mime: Object.freeze(['image/jpeg', 'image/png', 'image/webp']), min_width: 320, min_height: 240 }),
  caption: Object.freeze({ target_min_chars: 1200, target_max_chars: 1900, max_chars: 2200 }),
});

const CATEGORY_ALIASES = new Map([
  ['politik', 'politik'], ['politik nasional', 'politik'], ['pemerintahan', 'politik'],
  ['sosial', 'sosial'], ['masyarakat', 'sosial'], ['layanan publik', 'sosial'],
  ['hukum', 'hukum'], ['hak', 'hukum'], ['peradilan', 'hukum'],
  ['lingkungan', 'lingkungan'], ['lingkungan hidup', 'lingkungan'], ['bencana', 'lingkungan'],
  ['ekonomi', 'ekonomi'], ['ekonomi nasional', 'ekonomi'], ['fiskal', 'ekonomi'],
  ['bursa', 'bursa'], ['pasar modal', 'bursa'], ['saham', 'bursa'],
]);

const TRANSPORT_PREFIX = /^\[(?:Google News:\s*X(?: query)? fallback|X\/RSSHub|X)\]\s*/iu;
const NOISE_MARKERS = /\[(?:Google News:[^\]]+|X\/RSSHub|X)\]/iu;
const INTERNAL_CAPTION_MARKERS = /(?:Sumber primer\s*:|Status verifikasi\s*:|Belum terverifikasi otomatis|Jangan jadikan dasar keputusan sebelum ada konfirmasi redaksi|verification_status|confidence\s*:)/iu;
const SLIDE_ROLES = new Set(['cover', 'lead', 'explanation', 'official_statement', 'chronology', 'data', 'public_impact', 'close']);
const LAYOUTS = new Set(['cover-focus', 'big-statement', 'timeline', 'comparison', 'stat-grid', 'chart-bar', 'chart-line', 'regulasi', 'illustration']);
const RIGHTS_BASES = new Set(['owned', 'editor_approved', 'licensed', 'official_reuse']);
const validText = (value) => typeof value === 'string' && Boolean(value.trim());
const normalizedText = (value) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('id').replace(/[.!?]+$/u, '');
const validUrl = (value) => typeof value === 'string' && !validatePublicSourceUrl(value);
const invalid = (reason) => ({ valid: false, reason });
const valid = () => ({ valid: true, reason: null });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function containsInternalText(value, depth = 0) {
  if (depth > 6) return true;
  if (typeof value === 'string') return NOISE_MARKERS.test(value) || INTERNAL_CAPTION_MARKERS.test(value);
  if (value && typeof value === 'object') return Object.values(value).some((entry) => containsInternalText(entry, depth + 1));
  return false;
}

export function normalizeHeadline(value, { publisher = '', publisherAliases = [] } = {}) {
  let result = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  while (TRANSPORT_PREFIX.test(result)) result = result.replace(TRANSPORT_PREFIX, '').trim();
  const aliases = [publisher, ...(Array.isArray(publisherAliases) ? publisherAliases : [])]
    .filter(validText).map((item) => item.replace(/\s+/gu, ' ').trim());
  let previous;
  do {
    previous = result;
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\s+[-|–—]\\s+${escaped}$`, 'iu'), '').trim();
    }
  } while (result !== previous);
  return result;
}

export function normalizeCategory(value) {
  const normalized = typeof value === 'string' ? value.trim().toLocaleLowerCase('id') : '';
  return CATEGORY_ALIASES.get(normalized) || null;
}

function validEvidenceParagraph(paragraph) {
  return Boolean(paragraph && typeof paragraph === 'object' && validText(paragraph.id) && paragraph.id === paragraph.id.trim()
    && validText(paragraph.text) && validUrl(paragraph.source_url)
    && ['official_statement', 'reporting', 'document'].includes(paragraph.role));
}

export function materialSufficiency(material) {
  if (material?.version !== 1) return { sufficient: false, contributions: 0, reason: 'material_version_invalid' };
  const input = Array.isArray(material?.paragraphs) ? material.paragraphs : [];
  const paragraphs = input.filter(validEvidenceParagraph);
  if (paragraphs.length !== input.length) return { sufficient: false, contributions: 0, reason: 'material_paragraph_invalid' };
  if (new Set(paragraphs.map((paragraph) => paragraph.id)).size !== paragraphs.length) return { sufficient: false, contributions: 0, reason: 'material_ids_not_unique' };
  const unique = new Set(paragraphs.map((paragraph) => normalizedText(paragraph.text)));
  const contributions = unique.size;
  return contributions >= 3
    ? { sufficient: true, contributions, reason: null }
    : { sufficient: false, contributions, reason: 'source_content_incomplete' };
}

export function validateMediaAsset(asset) {
  if (!asset || typeof asset !== 'object') return { valid: false, reason: 'media_missing' };
  if (!validText(asset.id)) return invalid('media_id_missing');
  if (asset.kind === 'ai_generated') {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(asset.id)) return invalid('media_id_missing');
    if (!validText(asset.provider) || !validText(asset.model) || !validText(asset.prompt) || asset.prompt.length > 8000
      || !validText(asset.generated_at) || !Number.isFinite(Date.parse(asset.generated_at))
      || asset.rights_basis !== 'ai_generated' || !validUrl(asset.rights_reference)) return invalid('media_generation_missing');
    if (asset.disclosure !== 'Ilustrasi AI · Gapura Media' || asset.disclosure_version !== 1) return invalid('media_disclosure_missing');
    if (asset.status !== 'ready') return invalid('media_not_ready');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[asset.mime];
    if (!extension) return invalid('media_type_invalid');
    if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 320 || asset.height < 240 || asset.width > 4096 || asset.height > 4096) return invalid('media_dimensions_invalid');
    if (asset.local_path !== `media/${asset.id}.${extension}` || typeof asset.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(asset.sha256) || /^0{64}$/u.test(asset.sha256)) return invalid('media_local_identity_missing');
    return valid();
  }
  // R1 historical assets remain readable; new production uses the generative branch.
  if (asset.kind !== undefined) return invalid('media_type_invalid');
  if (!validUrl(asset.url)) return { valid: false, reason: 'media_url_invalid' };
  if (!validUrl(asset.source_url)) return { valid: false, reason: 'media_source_missing' };
  if (!validText(asset.credit)) return { valid: false, reason: 'media_credit_missing' };
  if (!RIGHTS_BASES.has(asset.rights_basis) || !validText(asset.rights_reference) || !validText(asset.rights_approved_by)
    || !validText(asset.rights_approved_at) || !Number.isFinite(Date.parse(asset.rights_approved_at))) return { valid: false, reason: 'media_rights_unknown' };
  if (asset.status !== 'downloaded') return { valid: false, reason: 'media_not_downloaded' };
  if (!EDITORIAL_POLICY.media.allowed_mime.includes(asset.mime)) return { valid: false, reason: 'media_type_invalid' };
  if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < EDITORIAL_POLICY.media.min_width || asset.height < EDITORIAL_POLICY.media.min_height) return { valid: false, reason: 'media_dimensions_invalid' };
  if (!validText(asset.local_path) || /[\\\x00-\x1f]/u.test(asset.local_path) || asset.local_path.split('/').includes('..') || /^[a-z][a-z0-9+.-]*:\/\//iu.test(asset.local_path)
    || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(asset.sha256) || /^0{64}$/u.test(asset.sha256)) return invalid('media_local_identity_missing');
  return valid();
}

function hasEvidence(slide, evidenceIds) {
  return Array.isArray(slide?.evidence_ids) && slide.evidence_ids.length > 0
    && new Set(slide.evidence_ids).size === slide.evidence_ids.length && slide.evidence_ids.every((id) => evidenceIds.has(id));
}

export function validateNewsCarousel(content) {
  if (!content || content.format !== EDITORIAL_POLICY.carousel.format) return { valid: false, reason: 'carousel_required' };
  const slides = Array.isArray(content.slides) ? content.slides : [];
  if (slides.length < EDITORIAL_POLICY.carousel.min_slides || slides.length > EDITORIAL_POLICY.carousel.max_slides) return { valid: false, reason: 'carousel_slide_count' };
  if (slides.some((slide, index) => !slide || slide.no !== index + 1 || typeof slide.teks !== 'string' || !slide.teks.trim())) return { valid: false, reason: 'slide_sequence_or_text' };
  if (slides[0].role !== 'cover' || slides[0].layout !== 'cover-focus') return { valid: false, reason: 'cover_required' };
  const assets = Array.isArray(content.media?.assets) ? content.media.assets : [];
  if (assets.some((asset) => !isObject(asset))) return invalid('media_invalid');
  if (new Set(assets.map((asset) => asset?.id)).size !== assets.length) return invalid('media_ids_not_unique');
  const coverAsset = assets.find((asset) => asset?.id === content.media?.cover_asset_id);
  if (!coverAsset || validateMediaAsset(coverAsset).valid !== true || slides[0].data?.asset_id !== coverAsset.id) return { valid: false, reason: 'cover_photo_required' };
  if (!materialSufficiency(content.material).sufficient) return invalid('material_evidence_missing');
  const paragraphs = content.material.paragraphs;
  const evidenceIds = new Set(paragraphs.map((paragraph) => paragraph.id));
  if (slides.some((slide) => !hasEvidence(slide, evidenceIds))) return { valid: false, reason: 'slide_evidence_required' };
  const texts = new Set();
  for (const slide of slides) {
    if (!SLIDE_ROLES.has(slide.role) || !LAYOUTS.has(slide.layout) || (slide.no > 1 && (slide.layout === 'cover-focus' || slide.role === 'cover'))) return invalid('slide_role_or_layout_invalid');
    if (slide.teks.length > (slide.no === 1 ? 120 : 300) || NOISE_MARKERS.test(slide.teks) || INTERNAL_CAPTION_MARKERS.test(slide.teks)) return invalid('slide_text_invalid');
    const evidence = paragraphs.filter((paragraph) => slide.evidence_ids.includes(paragraph.id));
    if (slide.data !== undefined && !isObject(slide.data)) return invalid('slide_data_invalid');
    const data = slide.data || {};
    if (containsInternalText(data)) return invalid('slide_text_invalid');
    if (data.quote !== undefined || data.author !== undefined) {
      if (!validText(data.quote) || !validText(data.author) || !evidence.some((paragraph) =>
        (paragraph.text.includes(`"${data.quote}"`) || paragraph.text.includes(`“${data.quote}”`)) && paragraph.text.includes(data.author))) return invalid('quote_attribution_invalid');
    }
    if (slide.layout === 'timeline') {
      if (!Array.isArray(data.events) || !data.events.length || data.events.length > 5) return invalid('timeline_invalid');
      let previousDate = '';
      for (const event of data.events) {
        if (!event || typeof event.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(event.date) || !Number.isFinite(Date.parse(event.date))
          || new Date(event.date).toISOString().slice(0, 10) !== event.date || event.date < previousDate
          || !validText(event.text) || !hasEvidence(event, new Set(slide.evidence_ids))) return invalid('timeline_invalid');
        previousDate = event.date;
      }
    }
    if (slide.layout === 'stat-grid' && (!Array.isArray(data.items) || !data.items.length || data.items.length > 4
      || data.items.some((item) => !validText(item?.label) || !(validText(item.value) || (typeof item.value === 'number' && Number.isFinite(item.value)))))) return invalid('stat_grid_invalid');
    if (slide.layout === 'regulasi' && !validText(data.title)) return invalid('regulasi_invalid');
    if (slide.layout === 'comparison' && [data.left, data.right].some((side) => !validText(side?.title) || !validText(side?.text))) return invalid('comparison_invalid');
    if (['chart-bar', 'chart-line'].includes(slide.layout) && (!Array.isArray(data.labels) || !Array.isArray(data.values)
      || !data.labels.length || data.labels.length !== data.values.length || !validText(data.unit)
      || data.labels.some((label) => !validText(label)) || data.values.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) return invalid('chart_invalid');
    const normalized = normalizedText(slide.teks);
    if (texts.has(normalized)) return { valid: false, reason: 'duplicate_slide_content' };
    texts.add(normalized);
  }
  if (!hasEvidence({ evidence_ids: content.caption_evidence_ids }, evidenceIds)) return invalid('caption_evidence_required');
  try { assemblePublicCaption(content.caption, content.hashtags); } catch (error) { return invalid(error.message); }
  return valid();
}

export function validatePublicCaption(caption) {
  if (typeof caption !== 'string' || !caption.trim()) return { valid: false, reason: 'caption_missing' };
  if (caption.length > EDITORIAL_POLICY.caption.max_chars) return { valid: false, reason: 'caption_too_long' };
  if (INTERNAL_CAPTION_MARKERS.test(caption) || NOISE_MARKERS.test(caption)) return { valid: false, reason: 'caption_internal_metadata' };
  return { valid: true, reason: null };
}

export function assemblePublicCaption(body, hashtags = [], { platform = 'instagram' } = {}) {
  const caption = validatePublicCaption(body);
  if (!caption.valid) throw new Error(caption.reason);
  if (/#[\p{L}\p{N}_]+/u.test(body)) throw new Error('caption_hashtags_in_body');
  if (!Array.isArray(hashtags) || hashtags.length > 30 || hashtags.some((tag) => typeof tag !== 'string' || !/^#[\p{L}\p{N}_]{1,40}$/u.test(tag))) throw new Error('hashtags_invalid');
  const seen = new Set();
  const tags = hashtags.filter((tag) => {
    const key = tag.toLocaleLowerCase('id');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const text = [body.trim(), tags.join(' ')].filter(Boolean).join('\n\n');
  if (!['instagram', 'facebook', 'threads'].includes(platform)) throw new Error('caption_platform_invalid');
  if (text.length > (platform === 'threads' ? 500 : EDITORIAL_POLICY.caption.max_chars)) throw new Error('caption_too_long');
  return text;
}
