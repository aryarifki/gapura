import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { publisherIdentity } from './research-sources.js';
import { validatePublicSourceUrl } from './sources.js';

const policy = JSON.parse(fs.readFileSync(new URL('../../config/source-quality.json', import.meta.url), 'utf8'));
const plain = (value) => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const within = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const familyFor = (host, families) => families.find(({ domains }) => domains.some((domain) => within(host, domain)));
const sourceUrl = (source) => typeof source === 'string' ? source : source?.url || source?.source_url;
const body = (source) => plain(source?.text || source?.body || source?.markdown);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const publisher = (value) => {
  if (validatePublicSourceUrl(value)) return null;
  const url = new URL(value); url.hostname = url.hostname.replace(/\.$/u, '');
  const labels = url.hostname.split('.');
  if (/^(?:or|sch|web|my|biz|mil|desa|ponpes)\.id$/u.test(labels.slice(-2).join('.'))) return labels.slice(-3).join('.');
  return publisherIdentity(url.href);
};
const contentKey = (source) => body(source).toLowerCase().replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gu, '$1')
  .replace(/https?:\/\/\S+/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function nearCopy(left, right) {
  const a = left.split(' '); const b = right.split(' ');
  if (Math.min(a.length, b.length) < 50) return false;
  const shingles = (words) => new Set(words.slice(0, -5).map((_, index) => words.slice(index, index + 6).join(' ')));
  const sa = shingles(a); const sb = shingles(b);
  const overlap = [...sa].filter((entry) => sb.has(entry)).length;
  return overlap / Math.max(sa.size, sb.size) >= 0.9;
}

/** Tier measures provenance, never whether a statement is objectively true. */
export function sourceQuality(source, { desk = '', scope = 'national' } = {}) {
  const url = sourceUrl(source);
  const invalid = validatePublicSourceUrl(url);
  if (invalid) return { accepted: false, tier: null, score: 0, publisherIdentity: null, role: 'invalid', trusted: false, evidence: [invalid], truthVerified: false };
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/u, '');
  const official = familyFor(host, policy.officialFamilies);
  const national = familyFor(host, policy.nationalFamilies);
  const specialist = familyFor(host, policy.specialistFamilies);
  const family = official || national || specialist;
  const government = policy.officialSuffixes.some((suffix) => within(host, suffix));
  const tier = official || government ? 1 : national ? 2 : specialist ? 3 : 4;
  const evidence = [official || government ? `official_domain:${official?.id || 'go.id'}`
    : family ? `configured_family:${family.id}` : 'unknown_public_source:complement_allowed', `tier:${tier}`];
  const penalties = [];
  let score = policy.tierScores[tier];
  let identity = family?.id || publisher(url);
  const penalize = (reason, amount) => { penalties.push(reason); evidence.push(`penalty:${reason}:${amount}`); score -= amount; };
  const deskKey = plain(desk).toLowerCase().replace(/ nasional$/u, '');
  if (specialist?.desks.includes(deskKey)) {
    score += policy.specialistDeskBonus;
    evidence.push(`specialist_desk:${deskKey}:+${policy.specialistDeskBonus}`);
  }
  const regional = source?.regional === true || ['regional', 'local', 'daerah', 'lokal'].includes(source?.scope)
    || policy.regionalPatterns.some((pattern) => new RegExp(pattern, 'iu').test(`${host}${new URL(url).pathname}`));
  if (['national', 'nasional'].includes(plain(scope).toLowerCase()) && regional) penalize('regional_national_scope', policy.penalties.regionalNationalScope);
  const originalUrl = source?.original_url || source?.syndicated_from || source?.canonical_url;
  const originalPublisher = typeof originalUrl === 'string' ? publisher(originalUrl) : null;
  const mirror = source?.kind === 'mirror' || source?.mirror === true || source?.is_mirror === true
    || policy.mirrorDomains.some((domain) => within(host, domain))
    || (originalPublisher && originalPublisher !== publisher(url));
  const syndicated = source?.kind === 'syndication' || source?.syndicated === true || source?.is_syndicated === true || Boolean(source?.syndicated_from)
    || /(?:artikel|berita|tulisan) ini (?:telah |sebelumnya )?(?:tayang|terbit|dipublikasikan) (?:di|pada)|diterbitkan ulang (?:dari|dengan izin)|republished (?:from|with permission)|syndicated (?:from|by)/iu.test(body(source));
  if (mirror) penalize('mirror', policy.penalties.mirror);
  if (syndicated) penalize('syndication', policy.penalties.syndication);
  if ((mirror || syndicated) && originalPublisher) {
    const originalHost = new URL(originalUrl).hostname.toLowerCase().replace(/\.$/u, '');
    identity = familyFor(originalHost, [...policy.officialFamilies, ...policy.nationalFamilies, ...policy.specialistFamilies])?.id || originalPublisher;
    evidence.push(`origin_publisher:${identity}`);
  }
  const social = ['social', 'forum'].includes(source?.kind) || policy.socialDomains.some((domain) => within(host, domain));
  // A primary post must identify its author and what statement it evidences.
  const primaryPost = social && source?.is_primary === true && Boolean(source?.author || source?.speaker)
    && ['statement', 'testimony'].includes(source?.source_role);
  if (social && !primaryPost) penalize('social_nonprimary', policy.penalties.socialNonprimary);
  const role = social ? primaryPost ? 'primary_statement' : 'social_context'
    : mirror ? 'mirror' : syndicated ? 'syndicated_reporting'
      : tier === 1 ? 'institutional_statement' : tier === 2 ? 'independent_reporting'
        : tier === 3 ? 'specialist_analysis' : 'supplementary_source';
  evidence.push(`role:${role}`, 'tier_quality_is_not_truth');
  if (tier === 1 || primaryPost) evidence.push('attribution_required:not_independent_verification');
  return { accepted: true, tier, score: Math.max(0, score), publisherIdentity: identity, role,
    trusted: tier <= 2 && !mirror && !syndicated && !social,
    independent: !mirror && !syndicated && (!social || primaryPost), regional: Boolean(regional), penalties, evidence, truthVerified: false };
}

/** Select 3–5 independent publishers; unknown sources remain eligible complements. */
export function chooseSourceDocuments(sources, { desk, scope = 'national', limit = 5, minimumPublishers = 3 } = {}) {
  if (!Number.isInteger(limit) || limit < 3 || limit > 5 || !Number.isInteger(minimumPublishers)
    || minimumPublishers < 3 || minimumPublishers > limit) throw new Error('source_quality_limits_invalid');
  const ranked = (Array.isArray(sources) ? sources : []).map((source, index) => ({ source, index, quality: sourceQuality(source, { desk, scope }) }))
    .filter(({ source, quality }) => quality.accepted && body(source).length >= 30 && source.text_kind !== 'snippet')
    .sort((a, b) => b.quality.score - a.quality.score || a.index - b.index);
  const selected = [];
  const publishers = new Set();
  const documents = new Set();
  const documentTexts = [];
  const add = (item) => {
    const normalized = contentKey(item.source);
    const fingerprint = hash(normalized);
    if (publishers.has(item.quality.publisherIdentity) || documents.has(fingerprint) || documentTexts.some((text) => nearCopy(text, normalized))) return;
    publishers.add(item.quality.publisherIdentity); documents.add(fingerprint);
    documentTexts.push(normalized);
    selected.push(item);
  };
  const trusted = ranked.find(({ quality }) => quality.trusted);
  if (!trusted) throw new Error('source_material_insufficient: source_quality_requires_one_tier_1_or_2');
  add(trusted);
  // Accepted reprints/context remain research leads, not extra independent reports.
  for (const item of ranked) { if (selected.length >= limit) break; if (item.quality.independent) add(item); }
  if (publishers.size < minimumPublishers) throw new Error(`source_material_insufficient: source_quality_requires_${minimumPublishers}_independent_publishers`);
  return selected.sort((a, b) => b.quality.score - a.quality.score || a.index - b.index)
    .map(({ source, quality }) => ({ ...source, publisherIdentity: quality.publisherIdentity, sourceTier: quality.tier, source_quality: quality }));
}
