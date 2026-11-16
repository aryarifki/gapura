import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATH = '/etc/gapura/meta-unified.json';
const APP_ID = /^[1-9]\d{0,29}$/;
const TOKEN = /^[^\s\x00-\x1f\x7f]{1,10000}$/;
const ACCOUNT_ID = /^[1-9]\d{0,29}$/;
const CONFIG_ID = /^[1-9]\d{0,29}$/;
const VERSION = /^v\d+\.\d+$/;

export function metaConnectionPath(file = process.env.GAPURA_META_CONNECTION) {
  return file || DEFAULT_PATH;
}

function assertConnection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Koneksi Meta harus berupa objek.');
  if (typeof value.access_token !== 'string' || !TOKEN.test(value.access_token)) throw new Error('Token Meta tidak valid.');
  if (typeof value.app_id !== 'string' || !APP_ID.test(value.app_id)) throw new Error('Meta App ID tidak valid.');
  if (typeof value.config_id !== 'string' || !CONFIG_ID.test(value.config_id)) throw new Error('Meta Configuration ID tidak valid.');
  if (typeof value.client_business_id !== 'string' || !ACCOUNT_ID.test(value.client_business_id)) throw new Error('Business ID Meta tidak valid.');
  if (typeof value.instagram_account_id !== 'string' || !ACCOUNT_ID.test(value.instagram_account_id)) throw new Error('Instagram Account ID tidak valid.');
  if (typeof value.username !== 'string' || value.username.length < 1 || value.username.length > 100) throw new Error('Username Instagram tidak valid.');
  if (typeof value.graph_version !== 'string' || !VERSION.test(value.graph_version)) throw new Error('Graph API version tidak valid.');
  if (typeof value.connected_at !== 'string' || Number.isNaN(Date.parse(value.connected_at))) throw new Error('Waktu koneksi Meta tidak valid.');
  if (value.expires_at !== null && (typeof value.expires_at !== 'string' || Number.isNaN(Date.parse(value.expires_at)))) throw new Error('Waktu kedaluwarsa Meta tidak valid.');
}

export function loadMetaConnection(file = metaConnectionPath()) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertConnection(value);
    return value;
  } catch {
    return null;
  }
}

export function saveMetaConnection(value, file = metaConnectionPath()) {
  assertConnection(value);
  const target = metaConnectionPath(file);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch {}
  return { configured: true };
}
