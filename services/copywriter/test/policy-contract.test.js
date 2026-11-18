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
test('generator contracts require original six-slide carousels, explicit evidence and human-reviewed captions', async () => {
  const copy = await readFile(new URL('config/skills/copywriter.skills.md', root), 'utf8');
  const designer = await readFile(new URL('config/skills/designer.skills.md', root), 'utf8');
  const studio = await readFile(new URL('config/skills/studio.skills.md', root), 'utf8');
  assert.match(copy, /2200.*(?:hashtag|tag)/i);
  assert.match(copy, /1200.{0,20}1900/);
  assert.match(copy, /Threads[\s\S]*500/i);
  assert.match(copy, /explainer/i);
  assert.match(copy, /current/i);
  assert.match(copy, /fact_ids/);
  assert.match(copy, /caption_blocks/);
  assert.match(copy, /(?:6|enam).{0,20}slide|slide.{0,20}(?:6|enam)/i);
  assert.match(designer, /layout/i);
  assert.match(designer, /naskah[\s\S]*(?:valid|orisinal)/i);
  assert.doesNotMatch(copy, /gunakan hanya judul\/ringkasan sumber|caption.*petikan sumber|jika hanya satu poin, gunakan single/i);
  assert.doesNotMatch(designer, /pilih.*single.*tepat 1|data\.image_url.*boleh|visual hanya menyusun bukti judul\/ringkasan/i);
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
  assert.match(cfg.copywriter.system_prompt, /orisinal|original/i);
  assert.match(cfg.designer.system_prompt, /layout/i);
  assert.doesNotMatch(cfg.copywriter.system_prompt, /petikan verbatim judul\/ringkasan/i);
  assert.doesNotMatch(cfg.studio.system_prompt, /verification_requested|verification_required|verifikator|verificator/i);
});
