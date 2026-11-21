import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from '../render/node_modules/sharp/lib/index.js';
import { MAX_STORED_BYTES } from './manual-media.js';

const defaultStorage = () => process.env.STORAGE_PATH || fileURLToPath(new URL('../../storage', import.meta.url));
const text = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('id').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const generic = new Set(['indonesia', 'jakarta', 'kota', 'gedung', 'bank', 'pasar', 'ekonomi', 'bursa', 'saham', 'politik', 'hukum', 'sosial', 'lingkungan']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function relevance(asset, query) {
  if (!asset || typeof asset !== 'object') return [];
  const tags = Array.isArray(asset.tags) ? asset.tags : asset.relevance_tags;
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map(text).filter((tag) => tag.length >= 2 && !generic.has(tag)
    && ` ${query} `.includes(` ${tag} `)))];
}

async function localRaster(asset, storagePath) {
  if (!asset || !String(asset.credit || '').trim() || !String(asset.license || '').trim()
    || !/^[a-f0-9]{64}$/u.test(asset.sha256 || '')) throw new Error('media_provenance_missing');
  if (asset.kind === 'ai_generated' || asset.image_kind === 'ai_generated' || asset.generated === true) throw new Error('media_not_a_photo');
  const openLicense = /^(?:CC0(?: 1\.0)?|CC BY(?:-SA)? (?:2\.0|2\.5|3\.0|4\.0)|Public domain|own_work)$/iu.test(asset.license);
  if (!openLicense && asset.license_verified !== true) throw new Error('media_license_unverified');
  const relative = asset.local_path || asset.path;
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('media_path_invalid');
  const root = await fs.realpath(storagePath);
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`) || await fs.realpath(filename) !== filename) throw new Error('media_path_invalid');
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORED_BYTES) throw new Error('media_path_invalid');
  const bytes = await fs.readFile(filename);
  if (digest(bytes) !== asset.sha256) throw new Error('media_checksum_mismatch');
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 40 * 1024 * 1024 });
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1
    || metadata.width < 320 || metadata.height < 240) throw new Error('media_raster_invalid');
  await image.stats(); // Decode pixels as well: a plausible header is insufficient.
  return { ...asset, local_path: relative, width: metadata.width, height: metadata.height,
    mime: `image/${metadata.format}`, sha256: digest(bytes) };
}

/** Resolve a relevant licensed local photo; a configured adapter also returns local manifest records.
 * No network calls, generated photos, desk defaults, or implicit photo requirement.
 */
export async function resolveEditorialMedia({ topic = '', visualQuery = '', assets = [], storagePath = defaultStorage(),
  licensedPhotoApi, usedAssetIds = [], usedAssetHashes = [] } = {}) {
  const topicText = typeof topic === 'string' ? topic : [topic?.title, ...(topic?.entities || []), ...(topic?.topic_keywords || [])].join(' ');
  const query = text(`${topicText} ${visualQuery}`);
  const rejected = [];
  const usedIds = new Set(usedAssetIds);
  const usedHashes = new Set(usedAssetHashes);
  const choose = async (records, origin) => {
    const ranked = (Array.isArray(records) ? records : []).map((asset, index) => ({ asset, index, matches: relevance(asset, query) }))
      .filter(({ asset, matches }) => matches.length && !usedIds.has(asset.id || asset.asset_id) && !usedHashes.has(asset.sha256))
      .sort((a, b) => b.matches.reduce((sum, tag) => sum + tag.length, 0) - a.matches.reduce((sum, tag) => sum + tag.length, 0) || a.index - b.index);
    for (const { asset, matches } of ranked.slice(0, 20)) {
      try {
        const verified = await localRaster(asset, storagePath);
        return { mode: 'photo', designIntent: 'photo', asset: verified,
          evidence: { origin, matched_tags: matches, sha256: verified.sha256, license: verified.license,
            credit: verified.credit, relevance: 'curated_tag_match', photo_role: verified.photo_role || 'context', truthVerified: false }, rejected };
      } catch (error) {
        rejected.push({ id: asset.id || asset.asset_id || null, reason: String(error.message || 'media_invalid').slice(0, 160) });
      }
    }
    return null;
  };
  const local = await choose(assets, 'local_bank');
  if (local) return local;
  // Adapter configuration is supplied by trusted application code, never source text.
  if (query && licensedPhotoApi?.enabled === true && licensedPhotoApi.licenseVerified === true
    && typeof licensedPhotoApi.search === 'function') {
    try {
      const records = await licensedPhotoApi.search({ query: String(visualQuery || topicText).slice(0, 300), limit: 5, signal: AbortSignal.timeout(10000) });
      const external = await choose(Array.isArray(records) ? records.slice(0, 5) : [], 'licensed_photo_api');
      if (external) return external;
    } catch { rejected.push({ id: null, reason: 'licensed_photo_api_unavailable' }); }
  }
  return { mode: 'typography', designIntent: 'typography', asset: null,
    reason: 'no_relevant_licensed_asset', evidence: { relevance: 'no_verified_match', photo_required: false }, rejected };
}
