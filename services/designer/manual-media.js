// Editor-supplied rasters. Uploads are re-encoded from a bounded input so EXIF,
// colour profiles and multi-page data never reach storage; every stored file is
// immutable and addressed by the checksum recorded in manual_media_assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import sharp from '../render/node_modules/sharp/lib/index.js';

export const ASSET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const MEDIA_KIND = 'editor_upload';
export const RIGHTS_BASES = Object.freeze(['own_work', 'licensed_stock', 'agency_license']);
export const MAX_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_STORED_BYTES = 4 * 1024 * 1024;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DATA_URI = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;
const storageRoot = () => process.env.STORAGE_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storage');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parseManualUpload(value) {
  const match = typeof value === 'string' ? DATA_URI.exec(value) : null;
  if (!match || !MIME.has(match[1]) || match[2].length % 4 !== 0) throw new Error('media_type_invalid');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[2]) throw new Error('media_type_invalid');
  if (bytes.length > MAX_INPUT_BYTES) throw new Error('media_too_large');
  return { bytes, mime: match[1] };
}

async function manualDirectory(storagePath, create = false) {
  const root = path.resolve(storagePath);
  const directory = path.join(root, 'media', 'manual');
  if (create) await fs.mkdir(directory, { recursive: true });
  const rootStat = await fs.lstat(root);
  const mediaStat = await fs.lstat(path.join(root, 'media'));
  const stat = await fs.lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !mediaStat.isDirectory() || mediaStat.isSymbolicLink()
    || !stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw new Error('media_path_invalid');
  return directory;
}

/** Re-encode one bounded raster; the returned identity describes the stored bytes. */
export async function saveManualMediaRaster(id, bytes, { storagePath = storageRoot() } = {}) {
  if (!ASSET_ID.test(id)) throw new Error('media_id_invalid');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_INPUT_BYTES) throw new Error('media_raster_invalid');
  let source;
  try {
    source = await sharp(bytes, { failOn: 'warning', limitInputPixels: 40 * 1024 * 1024 }).metadata();
  } catch { throw new Error('media_raster_invalid'); }
  if (!['jpeg', 'png', 'webp'].includes(source.format) || (source.pages || 1) !== 1) throw new Error('media_type_invalid');
  let data;
  let info;
  try {
    ({ data, info } = await sharp(bytes, { failOn: 'warning', limitInputPixels: 40 * 1024 * 1024 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true }));
  } catch { throw new Error('media_raster_invalid'); }
  if (info.width < 320 || info.height < 240) throw new Error('media_dimensions_invalid');
  if (info.width > 4096 || info.height > 4096 || data.length > MAX_STORED_BYTES) throw new Error('media_too_large');
  const directory = await manualDirectory(storagePath, true);
  const filename = `${id}.jpg`;
  const temporary = path.join(directory, `.${id}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
    // link() is atomic and fails if the immutable asset name already exists.
    await fs.link(temporary, path.join(directory, filename));
  } finally { await fs.unlink(temporary).catch(() => {}); }
  return { local_path: `media/manual/${filename}`, sha256: digest(data), mime: 'image/jpeg', width: info.width, height: info.height, byte_size: data.length };
}

export async function readManualMedia(asset, { storagePath = storageRoot() } = {}) {
  if (!asset || !ASSET_ID.test(String(asset.id)) || asset.kind !== MEDIA_KIND || !MIME.has(asset.mime)) throw new Error('media_asset_invalid');
  if (asset.local_path !== `media/manual/${asset.id}.jpg`) throw new Error('media_path_invalid');
  const directory = await manualDirectory(storagePath);
  const file = path.join(directory, `${asset.id}.jpg`);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORED_BYTES || await fs.realpath(file) !== file) throw new Error('media_path_invalid');
  const bytes = await fs.readFile(file);
  if (digest(bytes) !== asset.sha256) throw new Error('media_checksum_mismatch');
  return bytes;
}

export async function deleteManualMediaRaster(id, { storagePath = storageRoot() } = {}) {
  if (!ASSET_ID.test(String(id))) return;
  await fs.unlink(path.join(storagePath, 'media', 'manual', `${id}.jpg`)).catch(() => {});
}

export async function loadManualMedia(client, id, { topic_id } = {}) {
  if (typeof id !== 'string' || !ASSET_ID.test(id)) throw new Error('media_id_invalid');
  const { rows: [asset] } = await client.query('SELECT * FROM manual_media_assets WHERE id=$1', [id]);
  if (!asset || (topic_id !== undefined && String(topic_id) !== String(asset.topic_id))) throw new Error('media_not_found');
  return asset;
}

export function manualMediaDescriptor(asset) {
  if (!asset || asset.kind !== MEDIA_KIND) throw new Error('media_asset_invalid');
  return {
    asset_id: asset.id, asset_sha256: asset.sha256, image_kind: MEDIA_KIND,
    credit: asset.credit, rights_basis: asset.rights_basis,
  };
}
