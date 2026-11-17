import { chooseFormat, validateDesignOutput } from '../common/carousel.js';
import { needsHumanReview } from '../common/editorial.js';
import { isAllowedImageUrl, applyCoverIllustration } from '../common/images.js';

const DISCLAIMER = 'Informasi ini untuk edukasi publik dan bukan rekomendasi investasi atau nasihat hukum.';
const STATUSES = new Set(['verified', 'mostly_verified', 'needs_context', 'unverified', 'opinion', 'speculation', 'misleading', 'hoax_detected']);
const LAYOUTS = new Set(['cover-focus', 'big-statement', 'stat-grid', 'chart-bar', 'chart-line', 'regulasi', 'timeline', 'comparison']);
const LABELS = new Set(['Fakta sumber', 'Fakta yang tersedia', 'Konteks sumber', 'Data sumber', 'Lanjutan sumber']);
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const comparable = (value) => clean(value).toLocaleLowerCase('id').replace(/[.!?]+$/, '');

export function chunkText(text, maxChars = 300) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + word.length + 1 > maxChars) { chunks.push(current); current = ''; }
    current = current ? `${current} ${word}` : word;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function sourcePassages(topic, editorialBrief = null) {
  const title = comparable(topic?.title);
  const passages = [...new Set(clean(topic?.summary).split(/(?<=[.!?])\s+(?=[\p{L}“"(])/u).filter((text) => comparable(text) && comparable(text) !== title))];
  const plan = editorialBrief?.plan || {};
  const directions = [...(Array.isArray(plan.sections) ? plan.sections : []), plan.angle, editorialBrief?.prompt].filter(Boolean);
  // Briefs rank source excerpts; their text is never promoted to source evidence.
  const tokens = (value) => comparable(value).match(/[\p{L}]{4,}/gu) || [];
  const score = (text) => directions.reduce((sum, direction, index) => sum + tokens(direction).filter((word) => comparable(text).includes(word)).length / (index + 1), 0);
  return passages.map((text, index) => ({ text, index, score: score(text) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(({ text }) => text);
}

export function hasSourceExcerpt(text, topic) {
  const value = comparable(text);
  if (!value) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const end = /\d$/.test(value) ? '(?![\\p{L}\\p{N}.,])' : '(?![\\p{L}\\p{N}])';
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}.,])${escaped}${end}`, 'u');
  return [topic?.title, topic?.summary].some((evidence) => pattern.test(comparable(evidence)));
}

function hasSourceStatement(text, topic) {
  const value = comparable(text);
  return Boolean(value && (comparable(topic?.title) === value || comparable(topic?.summary) === value || sourcePassages(topic).some((passage) => comparable(passage) === value)));
}

export function isDraftComplete(draft) {
  if (!draft || !['draft', 'approved', 'scheduled', 'published'].includes(draft.status)) return false;
  try {
    const slides = typeof draft.slides === 'string' ? JSON.parse(draft.slides) : draft.slides;
    if (!Array.isArray(slides) || slides.length > 9 || !slides.length || Number(draft.rendered_count) !== slides.length) return false;
    if (slides.some((slide) => !slide || typeof slide.teks !== 'string' || !slide.teks.trim())) return false;
    if (draft.content_format === 'single' ? slides.length !== 1 : draft.content_format !== 'carousel' || slides.length < 3) return false;
    validateDesignOutput({ format: draft.content_format, slides }, {});
    return true;
  } catch { return false; }
}

function sourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? String(value).trim() : '';
  } catch { return ''; }
}

export function verificationCaptionBlock(verification) {
  if (!verification) return '';
  const status = STATUSES.has(verification.status) ? verification.status : 'unverified';
  // Verification metadata is not an extra source of facts, quotes or speculation.
  return `Status verifikasi: ${status}.`;
}

export function composeCaption(topic, { body, hashtags, verification = null, editorialBrief = null, disclaimer = '' } = {}) {
  const source = clean(topic?.primary_source) || 'Media asal';
  const url = sourceUrl(topic?.url);
  const tags = [...new Set((hashtags || ['#GapuraMedia', '#BeritaNasional', '#Indonesia'])
    .filter((tag) => typeof tag === 'string' && /^#[\p{L}\p{N}_]{1,40}$/u.test(tag)))].slice(0, 12);
  const sourceLine = url ? `Sumber primer: ${source} · ${url}` : 'Sumber primer belum tersedia; verifikasi manual wajib sebelum publikasi.';
  const disclaimers = [...new Set([disclaimer || DISCLAIMER, topic?.disclaimer, verification?.disclaimer].filter((text) => typeof text === 'string' && text.trim()).map((text) => text.trim()))];
  const suffix = [sourceLine, verificationCaptionBlock(verification), ...disclaimers, tags.join(' ')].filter(Boolean).join('\n\n');
  const available = 2200 - suffix.length - 2;
  if (available < 1) throw new Error('URL sumber dan disclaimer melebihi batas caption Instagram 2200 karakter.');
  const candidates = body ? String(body).split(/\n+/).map(clean).filter(Boolean) : [clean(topic?.title), ...sourcePassages(topic, editorialBrief)];
  const selected = [];
  for (const paragraph of candidates) {
    if (selected.includes(paragraph)) continue;
    const candidate = [...selected, paragraph].join('\n\n');
    if (candidate.length <= available) selected.push(paragraph);
  }
  // Omit whole unsupported/oversized passages rather than clipping source facts.
  const caption = [selected.join('\n\n'), suffix].filter(Boolean).join('\n\n');
  return { caption, hashtags: tags };
}

export function groundedCaptionBody(value, topic) {
  if (typeof value !== 'string' || !value.trim()) return false;
  return value.split(/\n+|(?<=[.!?])\s+(?=[\p{L}“"(])/u).filter((part) => part.trim()).every((part) => hasSourceStatement(part, topic));
}

export function validateGroundedDesign(raw, topic, fallback) {
  if (!raw || !Array.isArray(raw.slides) || !raw.slides.length || raw.slides.length > 9) throw new Error('Desain perlu 1-9 slide.');
  if (!['single', 'carousel'].includes(raw.format)) throw new Error('Format desain harus single atau carousel.');
  if (raw.format === 'single' && raw.slides.length !== 1) throw new Error('Single harus tepat 1 slide.');
  if (raw.format === 'carousel' && raw.slides.length < 3) throw new Error('Carousel perlu 3-9 slide bermakna.');
  if (topic.format && raw.format !== topic.format) throw new Error('Format berbeda dari pilihan editorial.');
  const seen = new Set();
  const source = clean(topic.primary_source) || '@gapuramedia';
  const evidenceText = (value, key) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'number') value = String(value);
    if (typeof value !== 'string' || (!hasSourceExcerpt(value, topic) && !(key === 'title' && LABELS.has(value)))) {
      throw new Error(`Teks desain tidak didukung sumber: ${key}.`);
    }
  };
  const field = (value, key) => {
    if (Array.isArray(value)) return value.map((item) => field(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([childKey]) => ['title', 'text', 'label', 'value', 'unit', 'date'].includes(childKey))
      .map(([childKey, item]) => [childKey, field(item, childKey)]));
    evidenceText(value, key);
    return value;
  };
  const slides = raw.slides.map((slide, index) => {
    if (!slide || typeof slide !== 'object') throw new Error('Slide tidak valid.');
    evidenceText(slide.teks, 'teks');
    if (!hasSourceStatement(slide.teks, topic)) throw new Error('Narasi perlu kalimat sumber utuh agar tidak mengubah konteks.');
    if (!clean(slide.teks) || seen.has(comparable(slide.teks))) throw new Error('Slide kosong atau mengulang sumber yang sama.');
    seen.add(comparable(slide.teks));
    const data = {};
    for (const key of ['title', 'subtitle', 'value', 'unit', 'label', 'items', 'left', 'right', 'bullets', 'callout', 'regulasi', 'quote', 'author', 'points', 'labels', 'values', 'events']) {
      if (slide.data?.[key] !== undefined) data[key] = field(slide.data[key], key);
    }
    const together = (...values) => [topic.title, ...sourcePassages(topic)].some((passage) => values.every((value) => comparable(passage).includes(comparable(value))));
    if (data.value && !together(data.label || data.title || slide.teks, data.value, data.unit || '')) throw new Error('Angka dan labelnya harus merujuk bukti yang sama.');
    if (slide.layout === 'stat-grid' && (!Array.isArray(data.items) || !data.items.length || data.items.length > 4
        || data.items.some((item) => !item.label || item.value === undefined || !together(item.label, item.value, item.unit || '')))) throw new Error('Stat-grid perlu label dan nilai berpasangan dari bukti yang sama.');
    if (['chart-bar', 'chart-line'].includes(slide.layout) && (!Array.isArray(data.labels) || !Array.isArray(data.values) || !data.labels.length || data.labels.length !== data.values.length
        || !data.unit || data.values.some((value, position) => typeof value !== 'number' || !Number.isFinite(value) || !together(data.labels[position], String(value), data.unit)))) throw new Error('Grafik perlu seri label, nilai dan unit sumber yang lengkap.');
    if (slide.layout === 'timeline' && (!Array.isArray(data.events) || !data.events.length || data.events.length > 5
        || data.events.some((event) => !event.date || !event.text || !together(event.date, event.text)))) throw new Error('Timeline perlu events tanggal dan teks sumber.');
    if (slide.layout === 'comparison' && [data.left, data.right].some((side) => !side?.title || !side?.text || !together(side.title, side.text))) throw new Error('Comparison perlu dua sisi dengan bukti lengkap.');
    if (data.quote && ![topic.title, topic.summary].some((text) => String(text || '').includes(`“${data.quote}”`) || String(text || '').includes(`"${data.quote}"`))) {
      throw new Error('Kutipan harus verbatim dengan atribusi dalam sumber.');
    }
    if (data.quote && (!data.author || !sourcePassages(topic).some((passage) => passage.includes(data.quote) && passage.includes(data.author)))) throw new Error('Kutipan dan atribusinya harus berada dalam bukti yang sama.');
    if (data.author && !hasSourceExcerpt(data.author, topic)) throw new Error('Atribusi kutipan tidak ada di sumber.');
    if (slide.data?.image_url === topic.image_url && isAllowedImageUrl(topic.image_url)) data.image_url = topic.image_url;
    if (index === 0) {
      for (const key of Object.keys(data)) if (!['title', 'value', 'unit', 'image_url'].includes(key)) delete data[key];
      data.title ||= slide.teks;
      if (!hasSourceStatement(data.title, topic)) throw new Error('Headline cover harus mempertahankan kalimat sumber utuh.');
    }
    return { no: index + 1, layout: index === 0 ? 'cover-focus' : LAYOUTS.has(slide.layout) ? slide.layout : 'big-statement', teks: clean(slide.teks), data, source };
  });
  return validateDesignOutput({ format: raw.format, slides }, topic, fallback?.slides || []);
}

export function buildEvidenceBasedContent(topic, requestedFormat = topic?.format, options = {}) {
  const { verification = topic?.verification || null, editorialBrief = null } = options;
  const plan = editorialBrief?.plan || {};
  const requested = plan.format || requestedFormat;
  const title = clean(topic?.title) || 'Topik perlu dirumuskan redaksi';
  const passages = sourcePassages(topic, editorialBrief);
  // Select source excerpts in editorial priority; the complete source URL remains in the caption.
  const chunks = passages.flatMap((text) => chunkText(text)).filter((text) => text.length <= 300).slice(0, 8);
  const desired = ['single', 'carousel'].includes(requested) ? requested : chooseFormat({ ...topic, verification });
  const format = desired === 'carousel' && chunks.length >= 2 ? 'carousel' : 'single';
  const source = clean(topic?.primary_source) || '@gapuramedia';
  const cover = { no: 1, layout: 'cover-focus', teks: title, data: { title }, source };
  // A relevant photo is optional. The designer may select it explicitly; fallback stays textual.
  const slides = [cover];
  if (format === 'carousel') chunks.forEach((text) => slides.push({ no: slides.length + 1, layout: 'big-statement', teks: text, data: {}, source }));
  const captionData = composeCaption(topic, { verification, editorialBrief });
  return applyCoverIllustration({
    ...validateDesignOutput({ format, slides }, topic), ...captionData,
    disclaimer_type: /ojk|pojk|\buu\b|hukum|regulasi|peraturan/i.test(title) ? 'hukum' : 'keuangan',
    needs_review: !topic?.summary || !topic?.primary_source || !sourceUrl(topic?.url) || needsHumanReview(verification),
    verification_status: verification?.status || null,
    source_url: sourceUrl(topic?.url),
  }, topic?.cover_illustration);
}
