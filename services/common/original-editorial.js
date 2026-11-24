import { projectDiscoveryTopic } from './discovery.js';
import { validatePublicSourceUrl } from './sources.js';
import { distinctPublishers } from './research-sources.js';

export const ORIGINAL_EDITORIAL_VERSION = 1;
export const ORIGINAL_MODES = Object.freeze(['explainer', 'current']);
export const ORIGINAL_FORMAT = 'carousel';
export const ORIGINAL_SLIDE_RANGE = Object.freeze({ min: 3, default: 6, max: 9 });
export const STORY_LAYOUTS = Object.freeze(['editorial-cover', 'editorial-lead', 'editorial-breakdown', 'editorial-timeline', 'editorial-quote', 'editorial-impact', 'editorial-close']);
export const ORIGINAL_LAYOUTS = Object.freeze(['cover-focus', 'big-statement', 'stat-grid', 'chart-bar', 'chart-line', 'regulasi', 'timeline', 'comparison', 'illustration', ...STORY_LAYOUTS]);
export const ORIGINAL_ROLES = Object.freeze(['cover', 'lead', 'explanation', 'official_statement', 'chronology', 'data', 'public_impact', 'close']);
export const ORIGINAL_CLAIM_TYPES = Object.freeze(['context', 'analysis', 'fact']);

const TEXT_MAX = 4000;
const ID = /^[a-z][a-z0-9_-]{0,39}$/iu;
const INTERNAL = /(?:Sumber primer\s*:|Status verifikasi\s*:|\b(?:verification_status|needs_review|editorial_input|editorial_mode|fact_ids|source_url|scope_note|caption_blocks|threads_body|confidence)\s*:|Belum terverifikasi otomatis|verifikator|verificator|\b(?:http|https):\/\/|www\.)/iu;
const NUMERIC = /(?:\b\d+(?:[.,]\d+)?\s*(?:%|persen|juta|ribu|miliar|triliun)?\b|\b(?:19|20)\d{2}\b|\b(?:kemarin|hari ini|besok|pada tanggal|pada \d{1,2})\b)/iu;
const EVENT_CLAIM = /(?:menetapkan|memutuskan|mengumumkan|mengonfirmasi|terjadi|meninggal|tewas|ditangkap|ditahan|mencapai|terdampak|naik|turun|menang|kalah|dinyatakan|mengalami|memastikan)\b/iu;
const QUOTE = /[“”"]|\b(?:kata|ujar|tutur)\s+[\p{Lu}]/u;
const ATTRIBUTION = /\b[Mm]enurut\s+([\p{Lu}][\p{L}]*)/gu;
const NUMBER = /(?<![\p{L}\p{N}.,+\-])(?:(Rp|IDR|USD|US\$|EUR|\$)\s*)?([+\-]?\d+(?:[.,]\d+)*)(?:\s*(%|persen|juta|ribu|miliar|triliun|bps|basis\s+(?:poin|point)|kg))?(?![\p{L}\p{N}]|[.,]\d)/giu;
const MONTH_NAMES = 'Januari Februari Maret April Mei Juni Juli Agustus September Oktober November Desember'.split(' ');
const ENGLISH_MONTHS = 'January February March April May June July August September October November December'.split(' ');
const MONTH_NUMBER = new Map([...MONTH_NAMES, ...ENGLISH_MONTHS].map((name, index) => [name.toLowerCase(), index % 12 + 1]));
const MONTH_PATTERN = [...new Set([...MONTH_NAMES, ...ENGLISH_MONTHS])].join('|');
const DATE = new RegExp(`\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{1,2}/\\d{1,2}|(?:${MONTH_PATTERN})\\s+\\d{1,2}(?:,\\s*\\d{4})?|\\d{1,2}\\s+(?:${MONTH_PATTERN})(?:\\s+\\d{4})?|(?:${MONTH_PATTERN})\\s+\\d{4})\\b`, 'giu');
const YEAR_SPAN = /(?<![\p{L}\p{N}_.,+\-])((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})(?![\p{L}\p{N}_])/gu;
const RELATIVE_DATE = /\b(?:kemarin|hari ini|besok|pekan ini|minggu ini|bulan ini|tahun ini)\b/iu;
const CONDITIONAL = /\b(?:dapat|bisa|mungkin|jika|apabila|bila|bagaimana|mekanisme|berpotensi)\b/iu;
const QUALIFIER = /\b(?:diduga|dugaan|dituduh|tuduhan|belum|berpotensi|diperkirakan|sementara(?!\s+itu\b)|kemungkinan)\b/iu;
const EDITORIAL_FILLER = /\b(?:baca rilis lengkap|cek pembaruan berikutnya|yang perlu diperiksa|konteks dan batas informasi|ikuti pembaruan)\b/iu;
const ARTICLE_MIN = 1200;
const ARTICLE_MAX = 12000;
const PUBLIC_META_COMMENT = /(?:\b(?:uraian|sampel|naskah) ini (?:merupakan|membaca|membahas)|\bperlu dibedakan\b|\b(?:bukan hasil (?:evaluasi|review)|bukan (?:proyeksi|kepastian hasil|jaminan)|batas klaim|konteks dan batas informasi|metadata|petikan terpilih)\b)/iu;

const fail = (reason) => { throw new Error(`original_${reason}`); };
const text = (value, field, max = TEXT_MAX) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${field}_invalid`);
  return value.replace(/\s+/gu, ' ').trim();
};
const optionalText = (value, field, max = TEXT_MAX) => {
  if (value === undefined || value === null || value === '') return '';
  return text(value, field, max);
};
const plain = (value) => String(value || '').replace(/\s+/gu, ' ').trim();
const normalized = (value) => plain(value).toLocaleLowerCase('id').replace(/[.!?]+$/u, '');
const hasPublicUrl = (value) => typeof value === 'string' && value.trim() && !validatePublicSourceUrl(value);

function exactKeys(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field}_invalid`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${field}_field_forbidden`);
}

function normalizeQuote(value, fact) {
  if (value === undefined) return undefined;
  exactKeys(value, ['text', 'speaker'], 'quote');
  const quoteText = text(value.text, 'quote_text', 1000);
  const speaker = text(value.speaker, 'quote_speaker', 300);
  if (!fact.text.includes(quoteText) || !fact.text.includes(speaker)) fail('quote_not_in_fact');
  return { text: quoteText, speaker };
}

function normalizeInput(value = {}) {
  exactKeys(value, ['version', 'mode', 'facts'], 'editorial_input');
  const version = value.version === undefined ? ORIGINAL_EDITORIAL_VERSION : value.version;
  if (version !== ORIGINAL_EDITORIAL_VERSION) fail('version_invalid');
  const mode = value.mode === undefined ? 'explainer' : value.mode;
  if (!ORIGINAL_MODES.includes(mode)) fail('mode_invalid');
  if (value.facts !== undefined && !Array.isArray(value.facts)) fail('facts_invalid');
  const facts = (value.facts || []).map((fact, index) => {
    exactKeys(fact, ['id', 'text', 'source_url', 'source_name', 'quote'], `fact_${index}`);
    const id = text(fact.id, `fact_${index}_id`, 40);
    if (!ID.test(id)) fail(`fact_${index}_id_invalid`);
    const factText = text(fact.text, `fact_${index}_text`, 4000);
    if (/^https?:\/\//iu.test(factText)) fail(`fact_${index}_text_missing`);
    const sourceUrl = text(fact.source_url, `fact_${index}_source_url`, 2000);
    if (!hasPublicUrl(sourceUrl)) fail(`fact_${index}_source_url_invalid`);
    const sourceName = text(fact.source_name, `fact_${index}_source_name`, 200);
    const normalizedFact = { id, text: factText, source_url: sourceUrl, source_name: sourceName };
    const quote = normalizeQuote(fact.quote, normalizedFact);
    if (quote) normalizedFact.quote = quote;
    return normalizedFact;
  });
  if (facts.length > 30 || facts.reduce((sum, fact) => sum + fact.text.length, 0) > 30000) fail('facts_too_large');
  if (new Set(facts.map((fact) => fact.id)).size !== facts.length) fail('fact_ids_not_unique');
  if (mode === 'current' && facts.length === 0) fail('current_facts_required');
  if (mode === 'explainer' && facts.length > 0) fail('explainer_facts_forbidden');
  return { version, mode, facts };
}

export function normalizeEditorialInput(value = {}) {
  try { return normalizeInput(value); }
  catch (error) { throw new Error(`original_editorial_input_${String(error.message).replace(/^original_/u, '')}`); }
}

function directionsFromBrief(editorialBrief) {
  const plan = editorialBrief?.plan && typeof editorialBrief.plan === 'object' ? editorialBrief.plan : {};
  const sections = Array.isArray(plan.sections) ? plan.sections.slice(0, 6).map((section) => text(section, 'direction_section', 600)) : [];
  return {
    prompt: optionalText(editorialBrief?.prompt, 'direction_prompt', 5001),
    title: optionalText(plan.title, 'direction_title', 240),
    angle: optionalText(plan.angle, 'direction_angle', 1000),
    sections,
    caption_tone: optionalText(plan.caption_tone, 'direction_caption_tone', 100),
  };
}

export function buildEditorialBrief(topic, { editorialInput = {}, editorialBrief = null, slideCount = ORIGINAL_SLIDE_RANGE.default } = {}) {
  const input = normalizeEditorialInput(editorialInput);
  if (!Number.isInteger(slideCount) || slideCount < ORIGINAL_SLIDE_RANGE.min || slideCount > ORIGINAL_SLIDE_RANGE.max) fail('slide_count_invalid');
  const discovery = projectDiscoveryTopic(topic);
  if (!discovery?.normalized_title) fail('discovery_title_missing');
  return { version: ORIGINAL_EDITORIAL_VERSION, discovery, mode: input.mode, facts: input.facts, directions: directionsFromBrief(editorialBrief), slide_count: slideCount };
}

function factMap(brief) { return new Map((brief.facts || []).map((fact) => [fact.id, fact])); }
function magnitude(value) {
  const raw = value.includes(',') ? value.replaceAll('.', '').replace(',', '.')
    : /^[+-]?\d{1,3}(?:\.\d{3})+$/u.test(value) ? value.replaceAll('.', '') : value;
  return Number(raw);
}
function quantities(value, source = false) {
  const result = [...value.replace(YEAR_SPAN, '$1 dan $2').replace(DATE, ' ').matchAll(NUMBER)].map(([, currency = '', number, unit = '']) => ({
    currency: currency.toLocaleLowerCase('id').replace(/^idr$/u, 'rp').replace(/^us\$$/u, 'usd'),
    value: magnitude(number), unit: unit.toLocaleLowerCase('id').replace(/^persen$/u, '%').replace(/^basis\s+(?:poin|point)$/u, 'bps'),
  }));
  if (source) for (const date of value.match(DATE) || []) {
    const year = dateParts(date)?.[0];
    if (year) result.push({ currency: '', value: year, unit: '' });
  }
  return result;
}
function sameQuantity(a, b) { return a.currency === b.currency && a.value === b.value && a.unit === b.unit; }
function hasFactNumber(textValue, facts) {
  const available = facts.flatMap((fact) => quantities(fact.text, true));
  return quantities(textValue).every((number) => available.some((candidate) => sameQuantity(number, candidate)));
}

// Match the staged Python gate: translate date notation, never the event date.
function dateParts(label) {
  const value = label.toLowerCase().replaceAll(',', ' ').replace(/\s+/gu, ' ').trim();
  let match;
  if ((match = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/u.exec(value))) return [+match[1], +match[2], +match[3]];
  if ((match = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/u.exec(value))) return [match[3] ? +match[3] + (match[3].length === 2 ? 2000 : 0) : null, +match[2], +match[1]];
  if ((match = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/u.exec(value)) && MONTH_NUMBER.has(match[2])) return [match[3] ? +match[3] : null, MONTH_NUMBER.get(match[2]), +match[1]];
  if ((match = /^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/u.exec(value)) && MONTH_NUMBER.has(match[1])) return [match[3] ? +match[3] : null, MONTH_NUMBER.get(match[1]), +match[2]];
  if ((match = /^([a-z]+)\s+(\d{4})$/u.exec(value)) && MONTH_NUMBER.has(match[1])) return [+match[2], MONTH_NUMBER.get(match[1]), null];
  return null;
}

function dateSupported(label, facts) {
  const target = dateParts(label);
  if (!target) return false;
  const candidates = facts.flatMap((fact) => (fact.text.match(DATE) || []).map(dateParts)).filter(Boolean)
    .filter((source) => target.every((value, index) => value === null || source[index] === null || value === source[index]));
  return candidates.length > 0 && target.every((value, index) => value === null || candidates.some((source) => source[index] === value));
}

function normalizeFactIds(value, map, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > map.size || value.some((id) => typeof id !== 'string' || !map.has(id))) fail(`${field}_invalid`);
  if (new Set(value).size !== value.length) fail(`${field}_duplicate`);
  return [...value];
}

function checkOriginalText(value, { brief, factIds, claimType, field }) {
  const valueText = text(value, field);
  if (INTERNAL.test(valueText) || EDITORIAL_FILLER.test(valueText) || /#[\p{L}\p{N}_]+/u.test(valueText)) fail(`${field}_internal`);
  const facts = factIds.map((id) => factMap(brief).get(id));
  if (brief.mode === 'explainer') {
    if (claimType === 'fact' || factIds.length || NUMERIC.test(valueText) || QUOTE.test(valueText) || [...valueText.matchAll(ATTRIBUTION)].length
        || (EVENT_CLAIM.test(valueText) && !CONDITIONAL.test(valueText))) fail(`${field}_unsupported_claim`);
  } else {
    if (claimType === 'fact' && !factIds.length) fail(`${field}_fact_reference_required`);
    if (EVENT_CLAIM.test(valueText) && !CONDITIONAL.test(valueText) && !factIds.length) fail(`${field}_fact_reference_required`);
    if (NUMERIC.test(valueText) && !hasFactNumber(valueText, facts)) fail(`${field}_number_unreferenced`);
    if (RELATIVE_DATE.test(valueText)) fail(`${field}_relative_date_unsupported`);
    for (const date of valueText.match(DATE) || []) {
      if (!dateSupported(date, facts)) fail(`${field}_date_unreferenced`);
    }
    if ((brief.pipeline_version === 3 ? /[“”"]/u.test(valueText) : QUOTE.test(valueText))) {
      if (!factIds.length || !facts.some((fact) => fact.quote && valueText.includes(fact.quote.text) && valueText.includes(fact.quote.speaker))) fail(`${field}_quote_unreferenced`);
      for (const [, quoted] of valueText.matchAll(/[“"]([^”"]+)[”"]/gu)) {
        if (!facts.some((fact) => fact.quote?.text === quoted || fact.quote?.text === quoted.replace(/,$/u, ''))) fail(`${field}_quote_unreferenced`);
      }
      for (const [, speaker] of valueText.matchAll(/\b(?:kata|ujar|tutur)\s+([\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)*)/gu)) {
        if (!facts.some((fact) => fact.quote && normalized(fact.quote.speaker) === normalized(speaker))) fail(`${field}_speaker_mismatch`);
      }
    }
    for (const [, attributed] of valueText.matchAll(ATTRIBUTION)) {
      if (/^(?:anda|kamu|kalian)$/iu.test(attributed) && /\?$/u.test(valueText)) continue;
      if (!facts.some((fact) => normalized(fact.source_name).includes(normalized(attributed)))) fail(`${field}_source_unreferenced`);
    }
    if ((brief.pipeline_version === 3 ? facts.length > 0 && facts.every((fact) => QUALIFIER.test(fact.text)) : facts.some((fact) => QUALIFIER.test(fact.text))) && !QUALIFIER.test(valueText)
        && (claimType === 'fact' || EVENT_CLAIM.test(valueText))) fail(`${field}_qualifier_missing`);
  }
  return valueText;
}

function validateSlideData(slide, brief, map) {
  const data = slide.data === undefined ? {} : slide.data;
  exactKeys(data, ['title', 'subtitle', 'callout', 'quote', 'author', 'items', 'labels', 'values', 'unit', 'events', 'left', 'right', 'kicker', 'role_label', 'question', 'cta', 'paragraphs'], 'slide_data');
  const refs = normalizeFactIds(slide.fact_ids, map, 'slide_fact_ids');
  const facts = refs.map((id) => map.get(id));
  const check = (value, field) => checkOriginalText(value, { brief, factIds: refs, claimType: slide.claim_type, field });
  const supported = (value, field) => {
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) fail(`${field}_invalid`);
    const result = text(String(value), field, 500);
    if (INTERNAL.test(result) || /#[\p{L}\p{N}_]+/u.test(result)) fail(`${field}_internal`);
    if (!facts.some((fact) => normalized(fact.text).includes(normalized(result)))) fail(`${field}_unreferenced`);
    return result;
  };
  const result = {};
  for (const key of ['title', 'subtitle', 'callout']) if (data[key] !== undefined) result[key] = check(data[key], `slide_data_${key}`);
  for (const key of ['kicker', 'role_label', 'question', 'cta']) if (data[key] !== undefined) {
    result[key] = check(data[key], `slide_data_${key}`);
    if (result[key].length > (key === 'kicker' ? 40 : 200)) fail(`slide_data_${key}_length`);
  }
  if (data.quote !== undefined || data.author !== undefined) {
    const quote = text(data.quote, 'slide_quote', 1000);
    const author = text(data.author, 'slide_author', 300);
    if (INTERNAL.test(quote) || INTERNAL.test(author)) fail('quote_internal');
    if (!facts.some((fact) => fact.quote && fact.quote.text === quote && fact.quote.speaker === author)) fail('quote_attribution_invalid');
    Object.assign(result, { quote, author });
  }
  if (data.items !== undefined) {
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 4) fail('stat_grid_data_missing');
    result.items = data.items.map((item) => {
      exactKeys(item, ['label', 'value', 'fact_ids'], 'stat_grid_item');
      const itemRefs = item.fact_ids === undefined ? refs : normalizeFactIds(item.fact_ids, map, 'list_fact_ids');
      if (itemRefs.some((id) => !refs.includes(id))) fail('list_fact_ids_invalid');
      const narrative = ['editorial-breakdown', 'editorial-impact'].includes(slide.layout);
      const label = narrative ? check(item.label, 'list_label') : supported(item.label, 'stat_label');
      const value = narrative ? check(item.value, 'list_value') : supported(item.value, 'stat_value');
      if (!narrative && !facts.some((fact) => normalized(fact.text).includes(normalized(label)) && normalized(fact.text).includes(normalized(value)))) fail('stat_pair_unreferenced');
      check(value, 'stat_value');
      return { label, value, ...(item.fact_ids ? { fact_ids: itemRefs } : {}) };
    });
  }
  if (data.labels !== undefined || data.values !== undefined || data.unit !== undefined) {
    if (!Array.isArray(data.labels) || !Array.isArray(data.values) || !data.labels.length || data.labels.length > 8 || data.labels.length !== data.values.length
        || data.values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) fail('chart_data_missing');
    result.labels = data.labels.map((label) => supported(label, 'chart_label'));
    result.values = [...data.values];
    result.unit = supported(data.unit, 'chart_unit');
    result.values.forEach((value, index) => {
      if (!facts.some((fact) => normalized(fact.text).includes(normalized(result.labels[index]))
        && hasFactNumber(`${value} ${result.unit}`, [fact]))) fail('chart_pair_unreferenced');
    });
  }
  if (data.events !== undefined) {
    if (!Array.isArray(data.events) || !data.events.length || data.events.length > 5) fail('timeline_data_missing');
    let previous = '';
    result.events = data.events.map((event) => {
      exactKeys(event, ['date', 'text', 'fact_ids'], 'timeline_event');
      const factIds = event.fact_ids === undefined ? refs : normalizeFactIds(event.fact_ids, map, 'timeline_fact_ids');
      if (!factIds.length || factIds.some((id) => !refs.includes(id))) fail('timeline_fact_ids_invalid');
      const date = text(event.date, 'timeline_date', 100);
      if (!factIds.some((id) => map.get(id).text.includes(date))) fail('timeline_date_unreferenced');
      if (slide.layout !== 'editorial-timeline' && (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date < previous)) fail('timeline_date_invalid');
      previous = date;
      return { date, text: checkOriginalText(event.text, { brief, factIds, claimType: 'fact', field: 'timeline_text' }), fact_ids: factIds };
    });
  }
  if (data.paragraphs !== undefined) {
    if (!Array.isArray(data.paragraphs) || data.paragraphs.length < 2 || data.paragraphs.length > 4) fail('lead_paragraphs_2_to_4');
    result.paragraphs = data.paragraphs.map((paragraph, index) => {
      exactKeys(paragraph, ['text', 'fact_ids'], `lead_paragraph_${index}`);
      const factIds = normalizeFactIds(paragraph.fact_ids, map, `lead_paragraph_${index}_fact_ids`);
      if (!factIds.length || factIds.some((id) => !refs.includes(id))) fail(`lead_paragraph_${index}_fact_ids_invalid`);
      return { text: checkOriginalText(paragraph.text, { brief, factIds, claimType: 'fact', field: `lead_paragraph_${index}` }), fact_ids: factIds };
    });
  }
  for (const side of ['left', 'right']) if (data[side] !== undefined) {
    exactKeys(data[side], ['title', 'text'], `comparison_${side}`);
    result[side] = { title: check(data[side].title, `comparison_${side}_title`), text: check(data[side].text, `comparison_${side}_text`) };
  }
  return result;
}

function requireLayoutData(layout, data) {
  if (STORY_LAYOUTS.includes(layout) && !data.title) fail('story_slide_heading_required');
  if (layout === 'editorial-breakdown' && !data.items?.length) fail('story_breakdown_required');
  if (layout === 'editorial-timeline' && !data.events?.length) fail('story_timeline_required');
  if (layout === 'editorial-quote' && (!data.quote || !data.author || !data.role_label)) fail('story_quote_required');
  if (layout === 'editorial-close' && !data.question) fail('story_close_question_required');
  if (layout === 'stat-grid' && !data.items?.length) fail('stat_grid_data_missing');
  if (['chart-bar', 'chart-line'].includes(layout) && (!data.labels?.length || !data.values?.length || !data.unit)) fail('chart_data_missing');
  if (layout === 'timeline' && !data.events?.length) fail('timeline_data_missing');
  if (layout === 'comparison' && (!data.left || !data.right)) fail('comparison_data_missing');
  if (layout === 'regulasi' && !data.title) fail('regulasi_title_missing');
}

export function validateOriginalContent(raw, brief) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('content_invalid');
  if (raw.format !== ORIGINAL_FORMAT) fail('format_invalid');
  if (raw.mode !== brief.mode) fail('mode_mismatch');
  if (!Array.isArray(raw.slides) || raw.slides.length < ORIGINAL_SLIDE_RANGE.min || raw.slides.length > ORIGINAL_SLIDE_RANGE.max) fail('slide_count_invalid');
  if (!Array.isArray(raw.caption_blocks) || !raw.caption_blocks.length) fail('caption_blocks_missing');
  const map = factMap(brief);
  const story = raw.article_metadata ? normalizeStory(raw.article_metadata, brief, map) : null;
  if (story) raw = { ...raw, article_blocks: [story.lead, ...story.sections.flatMap((section) => section.paragraphs)] };
  const seenText = new Set();
  const seenPurpose = new Set();
  const slides = raw.slides.map((slide, index) => {
    exactKeys(slide, ['no', 'role', 'purpose', 'claim_type', 'fact_ids', 'layout', 'teks', 'data'], 'slide');
    if (slide.no !== index + 1) fail('slide_sequence_invalid');
    if (!ORIGINAL_ROLES.includes(slide.role) || !ORIGINAL_CLAIM_TYPES.includes(slide.claim_type) || !ORIGINAL_LAYOUTS.includes(slide.layout)) fail('slide_contract_invalid');
    if (index === 0 && (slide.role !== 'cover' || slide.layout !== (story ? 'editorial-cover' : 'cover-focus'))) fail('cover_required');
    if (index > 0 && slide.role === 'cover') fail('cover_duplicate');
    const purpose = text(slide.purpose, `slide_${index}_purpose`, 500);
    if (seenPurpose.has(normalized(purpose))) fail('slide_purpose_duplicate');
    seenPurpose.add(normalized(purpose));
    const factIds = normalizeFactIds(slide.fact_ids, map, `slide_${index}_fact_ids`);
    const emptyStoryBody = story && slide.teks === '' && (index === 0 || ['editorial-breakdown', 'editorial-timeline', 'editorial-quote'].includes(slide.layout));
    const teks = emptyStoryBody ? '' : checkOriginalText(slide.teks, { brief, factIds, claimType: slide.claim_type, field: `slide_${index}_text` });
    if (teks.length > (index === 0 ? 120 : 500)) fail('slide_text_length');
    if (!story && brief.mode === 'current' && brief.facts.length >= 3 && index > 0 && teks.length < 80) fail('slide_text_length');
    if (teks && seenText.has(normalized(teks))) fail('slide_text_duplicate');
    if (teks) seenText.add(normalized(teks));
    const data = validateSlideData(slide, brief, map);
    requireLayoutData(slide.layout, data);
    if (story) {
      if (!STORY_LAYOUTS.includes(slide.layout)) fail('story_layout_required');
      if (PUBLIC_META_COMMENT.test([teks, ...Object.values(data).filter((value) => typeof value === 'string')].join(' '))) fail('story_public_meta_comment');
      // Anggaran kata per slide (25/40/310) DIHAPUS atas keputusan owner
      // 2026-11-24: kepadatan slide diatur aturan editorial di README
      // intake (brief terstruktur, blok ringkas), bukan gerbang keras.
    }
    return { no: index + 1, role: slide.role, purpose, claim_type: slide.claim_type,
      layout: slide.layout, teks, fact_ids: factIds, data, source: story
        ? [...new Set(factIds.map((id) => map.get(id).source_name))].join(' · ')
        : brief.discovery.source_name || 'Gapura Media' };
  });
  if (brief.mode === 'explainer' && slides.some((slide) => slide.fact_ids.length || slide.claim_type === 'fact')) fail('explainer_fact_claim');

  const blocks = raw.caption_blocks.map((block, index) => {
    if (!block || !['context', 'analysis', 'fact'].includes(block.kind)) fail(`caption_block_${index}_kind`);
    const factIds = normalizeFactIds(block.fact_ids, map, `caption_block_${index}_fact_ids`);
    const blockText = checkOriginalText(story ? stripBodyTags(block.text) : block.text, { brief, factIds, claimType: block.kind === 'fact' ? 'fact' : block.kind, field: `caption_block_${index}` });
    if (story && PUBLIC_META_COMMENT.test(blockText)) fail('story_public_meta_comment');
    return { kind: block.kind, text: blockText, fact_ids: factIds };
  });
  if (brief.mode === 'current' && !slides.some((slide) => slide.claim_type === 'fact' && slide.fact_ids.length)
      && !blocks.some((block) => block.kind === 'fact' && block.fact_ids.length)) fail('current_facts_unused');
  if (brief.mode === 'current' && brief.facts.length >= 3) {
    const used = new Set(slides.flatMap((slide) => slide.fact_ids));
    const captionUsed = new Set(blocks.flatMap((block) => block.fact_ids));
    if (used.size < 3 || captionUsed.size < 3) fail('current_fact_coverage');
  }
  const captionBody = blocks.map((block) => block.text).join('\n\n');
  if (captionBody.length < (story ? 300 : 1200) || captionBody.length > (story ? 1700 : 1900)) fail('caption_body_length');
  // Batas hook caption 125 karakter DIHAPUS atas keputusan owner
  // 2026-11-24; hook singkat tetap dianjurkan aturan editorial intake.
  const hashtags = Array.isArray(raw.hashtags) ? raw.hashtags : [];
  if (hashtags.length > 12 || hashtags.some((tag) => typeof tag !== 'string' || !/^#[\p{L}\p{N}_]{1,40}$/u.test(tag))) fail('hashtags_invalid');
  const uniqueTags = [...new Set(hashtags.map((tag) => tag.toLocaleLowerCase('id')))].map((tag) => hashtags.find((item) => item.toLocaleLowerCase('id') === tag));
  if (story && (uniqueTags.length < 5 || uniqueTags.length > 8)) fail('story_hashtag_count');
  const caption = [captionBody, uniqueTags.join(' ')].filter(Boolean).join('\n\n');
  if (caption.length > 2200) fail('caption_length');
  const threadsBody = text(story ? stripBodyTags(raw.threads_body) : raw.threads_body, 'threads_body', 1200);
  const threadsFactIds = normalizeFactIds(raw.threads_fact_ids, map, 'threads_fact_ids');
  checkOriginalText(threadsBody, { brief, factIds: threadsFactIds, claimType: threadsFactIds.length ? 'fact' : 'context', field: 'threads' });
  const threadsCaption = raw.threads_posts ? threadsBody : [threadsBody, uniqueTags.join(' ')].filter(Boolean).join('\n\n');
  if (threadsCaption.length > 500) fail('threads_length');
  const articleBlocksRaw = raw.article_blocks;
  if (articleBlocksRaw !== undefined && (!Array.isArray(articleBlocksRaw) || articleBlocksRaw.length < 3 || articleBlocksRaw.length > 24)) fail('article_blocks_invalid');
  const articleBlocks = (articleBlocksRaw || []).map((block, index) => {
    exactKeys(block, ['text', 'fact_ids'], `article_block_${index}`);
    const factIds = normalizeFactIds(block.fact_ids, map, `article_block_${index}_fact_ids`);
    if (brief.mode === 'current' && !factIds.length) fail('article_fact_reference_required');
    const body = checkOriginalText(block.text, {
      brief, factIds, claimType: brief.mode === 'current' ? 'fact' : 'context', field: `article_block_${index}`,
    });
    if (body.length < 20) fail(`article_block_${index}_too_short`);
    return { text: body, fact_ids: factIds };
  });
  const articleBody = articleBlocks.map((block) => block.text).join('\n\n');
  const articleFactIds = [...new Set(articleBlocks.flatMap((block) => block.fact_ids))];
  if (articleBlocks.length && (articleBody.length < ARTICLE_MIN || articleBody.length > ARTICLE_MAX)) fail('article_body_length');
  if (articleBlocks.length && (INTERNAL.test(articleBody) || EDITORIAL_FILLER.test(articleBody))) fail('article_body_internal');
  if (articleBlocks.length && brief.mode === 'current' && articleFactIds.length < Math.min(3, brief.facts.length)) fail('article_fact_coverage');
  if (story) {
    if (brief.mode === 'current' && distinctPublishers(brief.facts.filter((fact) => articleFactIds.includes(fact.id))).size < 3) fail('story_source_diversity');
    if (brief.facts.some((fact) => articleFactIds.includes(fact.id) && /(^|\.)tradingview\.com$/iu.test(new URL(fact.source_url).hostname))) fail('story_original_publisher_required');
    if (slides.filter((slide) => slide.role !== 'cover').every((slide) => slide.layout === slides[1].layout)) fail('story_layout_monotony');
    if (PUBLIC_META_COMMENT.test(articleBody) || PUBLIC_META_COMMENT.test(threadsBody)) fail('story_public_meta_comment');
    if (/^(?:Dalam laporan|Laporan\s+\S+)/iu.test(story.lead.text)) fail('story_lead_attribution_first');
    const articleCopy = [story.headline, story.lead.text,
      ...story.takeaways.map((item) => item.text), ...story.sections.flatMap((section) => [section.heading, ...section.paragraphs.map((item) => item.text)])].join(' ');
    const carouselCopy = slides.map(({ teks, data }) => [data.kicker, data.title, data.subtitle, teks, data.quote, data.author,
      data.role_label, data.question, data.cta, ...(data.items || []).flatMap((item) => [item.label, item.value]),
      ...(data.paragraphs || []).map((paragraph) => paragraph.text),
      ...(data.events || []).flatMap((event) => [event.date, event.text])].filter(Boolean).join(' ')).join(' ');
    const entities = [...(brief.entity_registry || []), ...story.entities];
    assertEntitiesExpanded(entities, [{ value: articleCopy }, { value: captionBody }, { value: carouselCopy, allowShort: true },
      { value: raw.threads_posts ? raw.threads_posts.map((post) => post.text).join(' ') : threadsCaption, allowShort: true }]);
  }
  const sourceUrl = brief.discovery.source_url || '';
  return {
    format: ORIGINAL_FORMAT, slides, caption, caption_body: captionBody, threads_caption: threadsCaption,
    hashtags: uniqueTags, editorial_mode: brief.mode,
    editorial_input: { version: brief.version, mode: brief.mode, facts: brief.facts },
    editorial_references: { caption: blocks.map(({ kind, fact_ids }) => ({ kind, fact_ids })), threads: threadsFactIds, article: articleFactIds },
    article_body: articleBody, article_references: articleFactIds, article_blocks: articleBlocks,
    ...(story ? { article_metadata: story } : {}),
    article_facts: brief.facts.filter((fact) => articleFactIds.includes(fact.id)),
    angle: story ? text(raw.angle, 'angle', 1000) : checkOriginalText(text(raw.angle, 'angle', 1000), { brief, factIds: [], claimType: 'context', field: 'angle' }),
    scope_note: story ? text(raw.scope_note, 'scope_note', 1200) : checkOriginalText(text(raw.scope_note, 'scope_note', 1200), { brief, factIds: [], claimType: 'context', field: 'scope_note' }),
    needs_review: true, disclaimer_type: null, source_url: sourceUrl,
  };
}

export function validateOriginalDesign(raw, content) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.slides) || raw.slides.length !== content.slides.length) fail('design_invalid');
  const slides = raw.slides.map((item, index) => {
    if (!item || item.no !== index + 1 || typeof item.layout !== 'string' || !ORIGINAL_LAYOUTS.includes(item.layout)) fail('design_layout_invalid');
    if (item.teks !== undefined || item.data !== undefined || item.role !== undefined || item.fact_ids !== undefined) fail('design_text_mutation');
    if (index === 0 && item.layout !== (content.article_metadata ? 'editorial-cover' : 'cover-focus')) fail('design_cover_invalid');
    if (content.article_metadata && !STORY_LAYOUTS.includes(item.layout)) fail('design_story_layout_invalid');
    requireLayoutData(item.layout, content.slides[index].data);
    return { ...content.slides[index], layout: item.layout };
  });
  return { ...content, slides };
}

function stripBodyTags(value) { return typeof value === 'string' ? value.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]{2,}/gu, ' ').trim() : value; }

function normalizeStory(raw, brief, map) {
  exactKeys(raw, ['editorial_version', 'headline', 'seo_title', 'meta_description', 'lead', 'takeaways', 'sections', 'entities', 'fact_ids'], 'story');
  if (raw.editorial_version !== 2) fail('story_version_invalid');
  const publicText = (value, field, max) => {
    const result = text(value, field, max);
    if (INTERNAL.test(result) || PUBLIC_META_COMMENT.test(result)) fail(`story_${field}_internal`);
    return result;
  };
  const headline = publicText(raw.headline, 'headline', 120);
  if (/^(?:Laporan\s|Artikel lengkap|Berita terbaru)/iu.test(headline)) fail('story_headline_placeholder');
  const block = (value, field) => {
    exactKeys(value, ['text', 'fact_ids'], field);
    const factIds = normalizeFactIds(value.fact_ids, map, `${field}_fact_ids`);
    if (brief.mode === 'current' && !factIds.length) fail('story_fact_reference_required');
    const body = checkOriginalText(value.text, { brief, factIds, claimType: brief.mode === 'current' ? 'fact' : 'context', field });
    if (PUBLIC_META_COMMENT.test(body)) fail('story_public_meta_comment');
    return { text: body, fact_ids: factIds };
  };
  const lead = block(raw.lead, 'story_lead');
  if (!Array.isArray(raw.takeaways) || raw.takeaways.length < 2 || raw.takeaways.length > 4) fail('story_takeaways_invalid');
  if (!Array.isArray(raw.sections) || raw.sections.length < 2 || raw.sections.length > 6) fail('story_sections_invalid');
  const sections = raw.sections.map((section, index) => {
    exactKeys(section, ['heading', 'paragraphs', 'fact_ids'], 'story_section');
    if (!Array.isArray(section.paragraphs) || !section.paragraphs.length || section.paragraphs.length > 6) fail('story_section_paragraphs_invalid');
    const refs = section.fact_ids === undefined ? undefined : normalizeFactIds(section.fact_ids, map, 'story_heading_fact_ids');
    return { heading: publicText(section.heading, `section_${index}_heading`, 100), ...(refs ? { fact_ids: refs } : {}), paragraphs: section.paragraphs.map((p, i) => block(p, `story_section_${index}_${i}`)) };
  });
  if (!Array.isArray(raw.entities) || raw.entities.length > 16) fail('story_entities_invalid');
  const entities = raw.entities.map((entity) => {
    exactKeys(entity, ['kind', 'name', 'expansion', 'short', 'fact_ids'], 'story_entity');
    if (!['person', 'acronym'].includes(entity.kind)) fail('story_entity_kind_invalid');
    const factIds = normalizeFactIds(entity.fact_ids, map, 'story_entity_fact_ids');
    const name = publicText(entity.name, 'entity_name', 100);
    const expansion = publicText(entity.expansion, 'entity_expansion', 180);
    const tokens = (value) => normalized(value).match(/[\p{L}\p{N}]+/gu) || [];
    const supportedLabel = (label) => factIds.some((id) => {
      const source = normalized(map.get(id).text);
      const sourceWords = new Set(tokens(source));
      return source.includes(normalized(name)) && tokens(label).every((word) => sourceWords.has(word));
    });
    if (!supportedLabel(expansion)) fail('story_entity_unsupported');
    const short = entity.short === undefined ? '' : publicText(entity.short, 'entity_short', 120);
    if (short && !supportedLabel(short)) fail('story_entity_short_unsupported');
    return { kind: entity.kind, name, expansion, ...(short ? { short } : {}), fact_ids: factIds };
  });
  return { editorial_version: 2, headline, ...(raw.fact_ids ? { fact_ids: normalizeFactIds(raw.fact_ids, map, 'story_metadata_fact_ids') } : {}),
    seo_title: publicText(raw.seo_title, 'seo_title', 100), meta_description: publicText(raw.meta_description, 'meta_description', 200),
    lead, takeaways: raw.takeaways.map((item, index) => block(item, `story_takeaway_${index}`)), sections, entities };
}

function assertEntitiesExpanded(entities, channels) {
  const contains = (value, phrase) => new RegExp(`(?<![\\p{L}\\p{N}])${plain(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/gu, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(value);
  const segmenter = new Intl.Segmenter('id', { granularity: 'sentence' });
  const words = (value) => normalized(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const labelIn = (sentence, label) => contains(words(sentence), words(label));
  for (const { value, allowShort = false } of channels) for (const entity of entities) {
    const sentence = [...segmenter.segment(value)].map(({ segment }) => segment).find((part) => contains(part, entity.name));
    const nameWords = words(entity.name);
    const coreExpansion = (label) => (nameWords
      ? words(label).replace(new RegExp(`(?:^|\\s)${nameWords.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?=\\s|$)`, 'gu'), ' ')
      : words(label)).replace(/\s+/gu, ' ').trim();
    const expandedIn = (label) => labelIn(sentence || '', label)
      || (Boolean(coreExpansion(label)) && labelIn(sentence || '', coreExpansion(label)));
    const compactPerson = allowShort && entity.kind === 'acronym' && entities.some((person) => person.kind === 'person' && person.short
      && contains(person.short, entity.name) && labelIn(sentence || '', person.short)
      && person.fact_ids.some((id) => entity.fact_ids.includes(id)));
    if (sentence && !expandedIn(entity.expansion) && !(allowShort && entity.short && expandedIn(entity.short)) && !compactPerson) fail(`story_${entity.kind}_first_mention_unexpanded`);
  }
}
