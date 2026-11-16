import fs from 'node:fs/promises';
import path from 'node:path';
import { validateAgentConfig } from '../common/agent-config.js';
import { AGENT_KEYS } from '../common/llm.js';
import { mergeAgentConfig } from './access.js';

/** All validation completes before staging files; failed commits restore originals. */
export async function saveSettings(incoming, { configPath, skillsDir }) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('Konfigurasi harus berupa object.');
  const unknown = Object.keys(incoming).filter((key) => key !== 'skills' && !AGENT_KEYS.includes(key));
  if (unknown.length) throw new Error('Nama agen tidak valid.');
  const previous = await fs.readFile(configPath, 'utf8');
  const merged = mergeAgentConfig(JSON.parse(previous), incoming);
  const errors = validateAgentConfig(merged);
  if (errors.length) throw new Error(errors.join(' '));
  const skills = incoming.skills || {};
  if (typeof skills !== 'object' || Array.isArray(skills)) throw new Error('Skills tidak valid.');
  for (const [key, value] of Object.entries(skills)) {
    if (!AGENT_KEYS.includes(key) || typeof value !== 'string' || value.length > 64000) throw new Error('Skills agen tidak valid (maksimal 64000 karakter).');
  }
  delete merged.skills;
  for (const key of AGENT_KEYS) if (merged[key]) delete merged[key].api_key_configured;
  const files = [[configPath, JSON.stringify(merged, null, 2)], ...Object.entries(skills).map(([key, content]) => [path.join(skillsDir, `${key}.skills.md`), content])];
  const originals = await Promise.all(files.map(async ([file]) => {
    try { return await fs.readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }));
  await fs.mkdir(skillsDir, { recursive: true });
  const suffix = `.pending-${process.pid}-${Date.now()}`;
  let committed = 0;
  try {
    for (const [file, content] of files) await fs.writeFile(`${file}${suffix}`, content, { mode: 0o600 });
    for (const [file] of files) { await fs.rename(`${file}${suffix}`, file); committed++; }
  } catch (error) {
    for (let index = 0; index < committed; index++) {
      if (originals[index] === null) await fs.rm(files[index][0], { force: true });
      else await fs.writeFile(files[index][0], originals[index], { mode: 0o600 });
    }
    throw error;
  } finally {
    await Promise.all(files.map(([file]) => fs.rm(`${file}${suffix}`, { force: true })));
  }
  return merged;
}
