import { createHash } from 'node:crypto';
import { materialSufficiency } from '../common/editorial-contract.js';
import { validatePublicSourceUrl } from '../common/sources.js';

const KINDS = new Set(['rss_full', 'feed_summary', 'article_html', 'json_ld', 'x_post']);
const STATUSES = new Set(['full', 'partial', 'summary_only', 'paywall', 'access_denied', 'robots_disallowed', 'rate_limited', 'parse_failed', 'unavailable']);
const FAILURE_STATUSES = new Set(['summary_only', 'paywall', 'access_denied', 'robots_disallowed', 'rate_limited', 'parse_failed', 'unavailable']);
const MAX_BODY_CHARS = 100000;
const isObject = (value) => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validUrl = (value) => typeof value === 'string' && !validatePublicSourceUrl(value);
const invalid = (field) => { throw new TypeError(`material_${field}_invalid`); };

// A JSONB snapshot must not silently lose undefined, functions, sparse entries,
// non-finite numbers or custom object serialization. Sorting never changes arrays.
function canonicalValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if ((!Array.isArray(value) && !isObject(value)) || ancestors.has(value) || ancestors.size > 50
    || Object.getOwnPropertySymbols(value).length) invalid('json');
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) invalid('json');
    result = Array.from(value, (entry) => canonicalValue(entry, ancestors));
  } else {
    result = Object.fromEntries(Object.keys(value).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value')) invalid('json');
      return [key, canonicalValue(descriptor.value, ancestors)];
    }));
  }
  ancestors.delete(value);
  return result;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const midnight = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0, 10) === value.slice(0, 10);
}

function validateMaterial(material) {
  if (!isObject(material) || material.version !== 1) invalid('version');
  for (const field of ['raw_title', 'headline', 'provider']) if (typeof material[field] !== 'string') invalid(field);
  if (material.publisher !== null && typeof material.publisher !== 'string') invalid('publisher');
  if (!validUrl(material.discovery_url) || (material.article_url !== null && !validUrl(material.article_url))) invalid('url');
  for (const field of ['published_at', 'updated_at']) if (material[field] !== null && !validDate(material[field])) invalid('date');
  if (!validDate(material.retrieved_at)) invalid('date');
  if (typeof material.body !== 'string' || material.body.length > MAX_BODY_CHARS) invalid('body');
  if (material.extraction?.status === 'full' && (!material.body.trim() || !material.paragraphs?.length)) invalid('body');
  if (!Array.isArray(material.paragraphs) || !material.paragraphs.every(isObject)) invalid('paragraphs');
  const sufficiency = materialSufficiency(material);
  // Insufficient material and failed extractions are evidence too. Only malformed
  // references/IDs are rejected; no three-contribution production gate belongs here.
  if (!sufficiency.sufficient && sufficiency.reason !== 'source_content_incomplete') invalid('paragraphs');
  if (!Array.isArray(material.images) || !material.images.every((image) => typeof image === 'string' ? validUrl(image)
    : isObject(image) && validUrl(image.url) && (image.source_url === undefined || validUrl(image.source_url)))) invalid('images');
  if ('discovery_summary' in material && material.discovery_summary !== null && typeof material.discovery_summary !== 'string') invalid('discovery_summary');
  const extraction = material.extraction;
  if (!isObject(extraction) || (extraction.kind !== null && !KINDS.has(extraction.kind)) || !STATUSES.has(extraction.status)
    || (extraction.kind === null && !FAILURE_STATUSES.has(extraction.status))
    || (extraction.error_code !== null && typeof extraction.error_code !== 'string')) invalid('extraction');
}

function validateTopicId(topicId) {
  if (!(typeof topicId === 'string' || typeof topicId === 'bigint' || (typeof topicId === 'number' && Number.isSafeInteger(topicId)))) {
    throw new TypeError('topic_id_invalid');
  }
  const value = String(topicId);
  if (!/^[1-9]\d{0,18}$/u.test(value) || BigInt(value) > 9223372036854775807n) throw new TypeError('topic_id_invalid');
}

export async function persistTopicMaterial(client, topicId, material) {
  validateTopicId(topicId);
  const snapshot = canonicalValue(material);
  validateMaterial(snapshot);
  const { retrieved_at, ...content } = snapshot;
  const contentHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const { rows: [row] } = await client.query(
    `INSERT INTO topic_materials (topic_id, content_hash, material)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (topic_id, content_hash) DO UPDATE SET last_seen_at = NOW()
     RETURNING id, content_hash, (xmax = 0) AS inserted`,
    [topicId, contentHash, JSON.stringify(snapshot)],
  );
  return { id: row.id, content_hash: row.content_hash, is_existing: !row.inserted };
}

export async function loadLatestTopicMaterial(client, topicId) {
  validateTopicId(topicId);
  const { rows } = await client.query(
    `SELECT id, topic_id, content_hash, material, created_at, last_seen_at
     FROM topic_materials WHERE topic_id = $1
     ORDER BY last_seen_at DESC, id DESC LIMIT 1`,
    [topicId],
  );
  return rows[0] || null;
}
