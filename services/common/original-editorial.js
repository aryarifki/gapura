import { projectDiscoveryTopic } from './discovery.js';
import { validatePublicSourceUrl } from './sources.js';

export const ORIGINAL_EDITORIAL_VERSION = 1;
export const ORIGINAL_MODES = Object.freeze(['explainer', 'current']);
export const ORIGINAL_FORMAT = 'carousel';
export const ORIGINAL_SLIDE_RANGE = Object.freeze({ min: 3, default: 6, max: 9 });
export const ORIGINAL_LAYOUTS = Object.freeze(['cover-focus', 'big-statement', 'stat-grid', 'chart-bar', 'chart-line', 'regulasi', 'timeline', 'comparison', 'illustration']);
export const ORIGINAL_ROLES = Object.freeze(['cover', 'lead', 'explanation', 'official_statement', 'chronology', 'data', 'public_impact', 'close']);
export const ORIGINAL_CLAIM_TYPES = Object.freeze(['context', 'analysis', 'fact']);

const TEXT_MAX = 4000;
const ID = /^[a-z][a-z0-9_-]{0,39}$/iu;
const INTERNAL = /(?:Sumber primer\s*:|Status verifikasi\s*:|\b(?:verification_status|needs_review|editorial_input|editorial_mode|fact_ids|source_url|scope_note|caption_blocks|threads_body|confidence)\s*:|Belum terverifikasi otomatis|verifikator|verificator|\b(?:http|https):\/\/|www\.)/iu;
const NUMERIC = /(?:\b\d+(?:[.,]\d+)?\s*(?:%|persen|juta|ribu|miliar|triliun)?\b|\b(?:19|20)\d{2}\b|\b(?:kemarin|hari ini|besok|pada tanggal|pada \d{1,2})\b)/iu;
const EVENT_CLAIM = /(?:menetapkan|memutuskan|mengumumkan|mengonfirmasi|terjadi|meninggal|tewas|ditangkap|ditahan|mencapai|terdampak|naik|turun|menang|kalah|dinyatakan|mengalami|memastikan)\b/iu;
const QUOTE = /[“”"]|\b(?:kata|ujar|tutur)\s+[\p{Lu}]/u;
const ATTRIBUTION = /\b[Mm]enurut\s+([\p{Lu}][\p{L}]*)/gu;
const NUMBER = /(?<![\p{L}\p{N}.,+\-])(?:(Rp|IDR|USD|US\$|EUR|\$)\s*)?([+\-]?\d+(?:[.,]\d+)*)(?:\s*(%|persen|juta|ribu|miliar|triliun|kg))?(?![\p{L}\p{N}]|[.,]\d)/giu;
const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)(?:\s+\d{4})?\b/giu;
const RELATIVE_DATE = /\b(?:kemarin|hari ini|besok|pekan ini|minggu ini|bulan ini|tahun ini)\b/iu;
const CONDITIONAL = /\b(?:dapat|bisa|mungkin|jika|apabila|bila|bagaimana|mekanisme|berpotensi)\b/iu;
const QUALIFIER = /\b(?:diduga|dugaan|dituduh|tuduhan|belum|berpotensi|diperkirakan|sementara(?!\s+itu\b)|kemungkinan)\b/iu;

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
function quantities(value) {
  return [...value.matchAll(NUMBER)].map(([, currency = '', number, unit = '']) => ({
    currency: currency.toLocaleLowerCase('id').replace(/^idr$/u, 'rp').replace(/^us\$$/u, 'usd'),
    value: magnitude(number), unit: unit.toLocaleLowerCase('id').replace(/^persen$/u, '%'),
  }));
}
function sameQuantity(a, b) { return a.currency === b.currency && a.value === b.value && a.unit === b.unit; }
function hasFactNumber(textValue, facts) {
  const available = facts.flatMap((fact) => quantities(fact.text));
  return quantities(textValue).every((number) => available.some((candidate) => sameQuantity(number, candidate)));
}

function normalizeFactIds(value, map, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8 || value.some((id) => typeof id !== 'string' || !map.has(id))) fail(`${field}_invalid`);
  if (new Set(value).size !== value.length) fail(`${field}_duplicate`);
  return [...value];
}

function checkOriginalText(value, { brief, factIds, claimType, field }) {
  const valueText = text(value, field);
  if (INTERNAL.test(valueText) || /#[\p{L}\p{N}_]+/u.test(valueText)) fail(`${field}_internal`);
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
      if (!facts.some((fact) => normalized(fact.text).includes(normalized(date)))) fail(`${field}_date_unreferenced`);
    }
    if (QUOTE.test(valueText)) {
      if (!factIds.length || !facts.some((fact) => fact.quote && valueText.includes(fact.quote.text) && valueText.includes(fact.quote.speaker))) fail(`${field}_quote_unreferenced`);
      for (const [, quoted] of valueText.matchAll(/[“"]([^”"]+)[”"]/gu)) {
        if (!facts.some((fact) => fact.quote?.text === quoted || fact.quote?.text === quoted.replace(/,$/u, ''))) fail(`${field}_quote_unreferenced`);
      }
      for (const [, speaker] of valueText.matchAll(/\b(?:kata|ujar|tutur)\s+([\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)*)/gu)) {
        if (!facts.some((fact) => fact.quote && normalized(fact.quote.speaker) === normalized(speaker))) fail(`${field}_speaker_mismatch`);
      }
    }
    for (const [, attributed] of valueText.matchAll(ATTRIBUTION)) {
      if (!facts.some((fact) => normalized(fact.source_name).includes(normalized(attributed)))) fail(`${field}_source_unreferenced`);
    }
    if (facts.some((fact) => QUALIFIER.test(fact.text)) && !QUALIFIER.test(valueText)
        && (claimType === 'fact' || EVENT_CLAIM.test(valueText))) fail(`${field}_qualifier_missing`);
  }
  return valueText;
}

function validateSlideData(slide, brief, map) {
  const data = slide.data === undefined ? {} : slide.data;
  exactKeys(data, ['title', 'subtitle', 'callout', 'quote', 'author', 'items', 'labels', 'values', 'unit', 'events', 'left', 'right'], 'slide_data');
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
      exactKeys(item, ['label', 'value'], 'stat_grid_item');
      const label = supported(item.label, 'stat_label');
      const value = supported(item.value, 'stat_value');
      if (!facts.some((fact) => normalized(fact.text).includes(normalized(label)) && normalized(fact.text).includes(normalized(value)))) fail('stat_pair_unreferenced');
      check(value, 'stat_value');
      return { label, value };
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
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date < previous) fail('timeline_date_invalid');
      previous = date;
      return { date, text: checkOriginalText(event.text, { brief, factIds, claimType: 'fact', field: 'timeline_text' }), fact_ids: factIds };
    });
  }
  for (const side of ['left', 'right']) if (data[side] !== undefined) {
    exactKeys(data[side], ['title', 'text'], `comparison_${side}`);
    result[side] = { title: check(data[side].title, `comparison_${side}_title`), text: check(data[side].text, `comparison_${side}_text`) };
  }
  return result;
}

function requireLayoutData(layout, data) {
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
  const seenText = new Set();
  const seenPurpose = new Set();
  const slides = raw.slides.map((slide, index) => {
    exactKeys(slide, ['no', 'role', 'purpose', 'claim_type', 'fact_ids', 'layout', 'teks', 'data'], 'slide');
    if (slide.no !== index + 1) fail('slide_sequence_invalid');
    if (!ORIGINAL_ROLES.includes(slide.role) || !ORIGINAL_CLAIM_TYPES.includes(slide.claim_type) || !ORIGINAL_LAYOUTS.includes(slide.layout)) fail('slide_contract_invalid');
    if (index === 0 && (slide.role !== 'cover' || slide.layout !== 'cover-focus')) fail('cover_required');
    if (index > 0 && slide.role === 'cover') fail('cover_duplicate');
    const purpose = text(slide.purpose, `slide_${index}_purpose`, 500);
    if (seenPurpose.has(normalized(purpose))) fail('slide_purpose_duplicate');
    seenPurpose.add(normalized(purpose));
    const factIds = normalizeFactIds(slide.fact_ids, map, `slide_${index}_fact_ids`);
    const teks = checkOriginalText(slide.teks, { brief, factIds, claimType: slide.claim_type, field: `slide_${index}_text` });
    if (teks.length > (index === 0 ? 120 : 500)) fail('slide_text_length');
    if (seenText.has(normalized(teks))) fail('slide_text_duplicate');
    seenText.add(normalized(teks));
    const data = validateSlideData(slide, brief, map);
    requireLayoutData(slide.layout, data);
    return { no: index + 1, role: slide.role, purpose, claim_type: slide.claim_type,
      layout: slide.layout, teks, fact_ids: factIds, data, source: brief.discovery.source_name || 'Gapura Media' };
  });
  if (brief.mode === 'explainer' && slides.some((slide) => slide.fact_ids.length || slide.claim_type === 'fact')) fail('explainer_fact_claim');

  const blocks = raw.caption_blocks.map((block, index) => {
    if (!block || !['context', 'analysis', 'fact'].includes(block.kind)) fail(`caption_block_${index}_kind`);
    const factIds = normalizeFactIds(block.fact_ids, map, `caption_block_${index}_fact_ids`);
    const blockText = checkOriginalText(block.text, { brief, factIds, claimType: block.kind === 'fact' ? 'fact' : block.kind, field: `caption_block_${index}` });
    return { kind: block.kind, text: blockText, fact_ids: factIds };
  });
  if (brief.mode === 'current' && !slides.some((slide) => slide.claim_type === 'fact' && slide.fact_ids.length)
      && !blocks.some((block) => block.kind === 'fact' && block.fact_ids.length)) fail('current_facts_unused');
  const captionBody = blocks.map((block) => block.text).join('\n\n');
  if (captionBody.length < 1200 || captionBody.length > 1900) fail('caption_body_length');
  const hashtags = Array.isArray(raw.hashtags) ? raw.hashtags : [];
  if (hashtags.length > 12 || hashtags.some((tag) => typeof tag !== 'string' || !/^#[\p{L}\p{N}_]{1,40}$/u.test(tag))) fail('hashtags_invalid');
  const uniqueTags = [...new Set(hashtags.map((tag) => tag.toLocaleLowerCase('id')))].map((tag) => hashtags.find((item) => item.toLocaleLowerCase('id') === tag));
  const caption = [captionBody, uniqueTags.join(' ')].filter(Boolean).join('\n\n');
  if (caption.length > 2200) fail('caption_length');
  const threadsBody = text(raw.threads_body, 'threads_body', 1200);
  const threadsFactIds = normalizeFactIds(raw.threads_fact_ids, map, 'threads_fact_ids');
  checkOriginalText(threadsBody, { brief, factIds: threadsFactIds, claimType: threadsFactIds.length ? 'fact' : 'context', field: 'threads' });
  const threadsCaption = [threadsBody, uniqueTags.join(' ')].filter(Boolean).join('\n\n');
  if (threadsCaption.length > 500) fail('threads_length');
  const sourceUrl = brief.discovery.source_url || '';
  return {
    format: ORIGINAL_FORMAT, slides, caption, caption_body: captionBody, threads_caption: threadsCaption,
    hashtags: uniqueTags, editorial_mode: brief.mode,
    editorial_input: { version: brief.version, mode: brief.mode, facts: brief.facts },
    editorial_references: { caption: blocks.map(({ kind, fact_ids }) => ({ kind, fact_ids })), threads: threadsFactIds },
    angle: checkOriginalText(text(raw.angle, 'angle', 1000), { brief, factIds: [], claimType: 'context', field: 'angle' }),
    scope_note: checkOriginalText(text(raw.scope_note, 'scope_note', 1200), { brief, factIds: [], claimType: 'context', field: 'scope_note' }),
    needs_review: true, disclaimer_type: null, source_url: sourceUrl,
  };
}

export function validateOriginalDesign(raw, content) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.slides) || raw.slides.length !== content.slides.length) fail('design_invalid');
  const slides = raw.slides.map((item, index) => {
    if (!item || item.no !== index + 1 || typeof item.layout !== 'string' || !ORIGINAL_LAYOUTS.includes(item.layout)) fail('design_layout_invalid');
    if (item.teks !== undefined || item.data !== undefined || item.role !== undefined || item.fact_ids !== undefined) fail('design_text_mutation');
    if (index === 0 && item.layout !== 'cover-focus') fail('design_cover_invalid');
    requireLayoutData(item.layout, content.slides[index].data);
    return { ...content.slides[index], layout: item.layout };
  });
  return { ...content, slides };
}
