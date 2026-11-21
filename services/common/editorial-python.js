import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CANDIDATES = [
  path.join(ROOT, '.venv-editorial', 'bin', 'python'),
  '/etc/gapura/editorial-venv/bin/python',
  '/opt/gapura/editorial-venv/bin/python',
];

export function editorialPythonExecutable({ env = process.env, exists = fs.existsSync } = {}) {
  const configured = String(env.EDITORIAL_PYTHON || env.GAPURA_JSON_REPAIR_PYTHON || '').trim();
  if (configured) return configured;
  return DEFAULT_CANDIDATES.find(exists) || 'python3';
}
