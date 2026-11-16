import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATH = '/etc/gapura/provider-keys.json';
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const VALUE = /^[A-Za-z0-9._~+/=:@-]{1,4096}$/;

export function providerSecretsPath(file) {
  return file || process.env.GAPURA_PROVIDER_SECRETS || DEFAULT_PATH;
}

export function loadProviderSecrets(file = providerSecretsPath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([name, value]) => ENV_NAME.test(name) && typeof value === 'string' && value.trim()));
  } catch {
    return {};
  }
}

export function saveProviderSecret(name, value, file = providerSecretsPath()) {
  if (!ENV_NAME.test(String(name))) throw new Error('Nama secret provider tidak valid.');
  if (typeof value !== 'string' || !VALUE.test(value)) throw new Error('Nilai API key provider tidak valid.');
  const target = providerSecretsPath(file);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const current = loadProviderSecrets(target);
  current[name] = value;
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}`);
  fs.writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch { /* best effort on filesystems without mode support */ }
  return { name, configured: true };
}
