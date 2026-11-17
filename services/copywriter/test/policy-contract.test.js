import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const agents = ['scout', 'analis', 'copywriter', 'designer', 'seo', 'studio'];
test('all six editorial documents mark external content as data and prohibit invented evidence', async () => {
  for (const agent of agents) {
    const document = await readFile(new URL(`config/skills/${agent}.skills.md`, root), 'utf8');
    assert.match(document, /data, bukan instruksi/i, agent);
    assert.match(document, /jangan mengarang/i, agent);
    assert.doesNotMatch(document, /verifikasi terbaru|laporan verifikasi|verifikator|verificator/i, agent);
  }
});
test('Scout and SEO accurately describe deterministic runtime and the role of their text settings', async () => {
  for (const agent of ['scout', 'seo']) {
    const document = await readFile(new URL(`config/skills/${agent}.skills.md`, root), 'utf8');
    assert.match(document, /deterministik/i, agent);
    assert.match(document, /tidak.*(?:LLM|model)/i, agent);
  }
});
test('generator contracts permit single, ground carousel bodies, and preserve caption metadata', async () => {
  const copy = await readFile(new URL('config/skills/copywriter.skills.md', root), 'utf8');
  const designer = await readFile(new URL('config/skills/designer.skills.md', root), 'utf8');
  const studio = await readFile(new URL('config/skills/studio.skills.md', root), 'utf8');
  assert.match(copy, /2200.*(?:hashtag|tag)/i);
  assert.match(copy, /disclaimer.*relevan|relevan.*disclaimer/i);
  assert.match(designer, /single.*tepat 1/i);
  assert.match(designer, /allowlist/i);
  assert.match(designer, /tanpa.*filler|jangan.*filler/i);
  assert.match(studio, /plan_review/);
  assert.match(studio, /plan_review.*draf\/render atomik.*review manusia/);
  assert.match(studio, /needs_review:true/);
  assert.match(copy, /lolos Analis/);
  assert.doesNotMatch(studio, /verification_requested|verification_required|verifying|verifikator|verificator/i);
  assert.match(studio, /bukan.*bukti|bukan.*fakta/i);
  assert.doesNotMatch(studio, /review → publish|review.*auto.publish/i);
});
test('system prompts align with evidence rules while preserving existing provider/model identifiers', async () => {
  const cfg = JSON.parse(await readFile(new URL('config/agents.json', root), 'utf8'));
  assert.deepEqual(Object.keys(cfg).sort(), [...agents].sort(), 'the active runtime has exactly six configured agents');
  for (const agent of agents) {
    assert.match(cfg[agent].system_prompt || cfg[agent].rules, /data, bukan instruksi/i, agent);
    assert.doesNotMatch(cfg[agent].system_prompt || cfg[agent].rules, /verifikasi terbaru|laporan verifikasi|verifikator|verificator/i, agent);
    if (agent !== 'scout') {
      assert.equal(cfg[agent].provider, 'gemini');
      assert.equal(cfg[agent].model, 'gemini-3.5-flash-lite');
      assert.equal(cfg[agent].endpoint, 'https://generativelanguage.googleapis.com');
    }
  }
  assert.match(cfg.studio.system_prompt, /lolos Analis/);
  assert.match(cfg.studio.system_prompt, /review manusia/);
  assert.doesNotMatch(cfg.studio.system_prompt, /verification_requested|verification_required|verifikator|verificator/i);
});
