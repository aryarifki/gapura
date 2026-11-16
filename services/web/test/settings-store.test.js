import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveSettings } from '../settings-store.js';

test('saves all seven agents and their skills without clearing stored keys', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gapura-settings-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'agents.json');
  const skillsDir = path.join(directory, 'skills');
  const config = JSON.parse(await fs.readFile(new URL('../../../config/agents.json', import.meta.url), 'utf8'));
  config.studio.api_key = 'stored-secret';
  await fs.writeFile(configPath, JSON.stringify(config));
  const saved = await saveSettings({ studio: { api_key: '', system_prompt: 'Edited Studio policy' }, skills: { studio: 'Edited Studio rubric' } }, { configPath, skillsDir });
  assert.equal(saved.studio.api_key, 'stored-secret');
  const disk = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(disk.studio.system_prompt, 'Edited Studio policy');
  assert.equal(disk.analis.model, config.analis.model);
  assert.equal(disk.skills, undefined);
  assert.equal(await fs.readFile(path.join(skillsDir, 'studio.skills.md'), 'utf8'), 'Edited Studio rubric');
});

test('rejects the entire save before any file write on invalid skills or settings', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gapura-settings-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'agents.json');
  const original = await fs.readFile(new URL('../../../config/agents.json', import.meta.url), 'utf8');
  await fs.writeFile(configPath, original);
  await assert.rejects(() => saveSettings({ studio: { model: '' }, skills: { studio: 'must not write' } }, { configPath, skillsDir: path.join(directory, 'skills') }), /model wajib/);
  assert.equal(await fs.readFile(configPath, 'utf8'), original);
  await assert.rejects(() => saveSettings({ skills: { '../../outside': 'no' } }, { configPath, skillsDir: path.join(directory, 'skills') }), /skills.*valid/i);
});
