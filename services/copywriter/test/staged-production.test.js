import test from 'node:test';
import assert from 'node:assert/strict';
import { produceStagedTopic } from '../staged-production.js';

const editorialInput = { version: 1, mode: 'current', facts: [
  { id: 'f1', text: 'Layanan kota beralih rute selama perbaikan jalan untuk melindungi perjalanan warga.', source_name: 'Dinas', source_url: 'https://one.example.org/a' },
  { id: 'f2', text: 'Pengelola menyediakan pemberhentian pengganti bagi penumpang yang akan ke pasar.', source_name: 'Warta', source_url: 'https://two.example.net/a' },
  { id: 'f3', text: 'Warga membaca petunjuk arah yang dipasang di halte menuju jalur pengganti.', source_name: 'Kabar', source_url: 'https://three.example.com/a' },
] };
function fixture() {
  const calls = []; const drafts = []; let serial = 900; let released = false;
  const client = {
    release() { released = true; },
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('SELECT t.*')) return { rows: [{ id: 71, title: 'Layanan kota berubah', url: editorialInput.facts[0].source_url,
        primary_source: 'Dinas', status: 'scored', score_total: 90, score_verdict: 'passed', desk: 'sosial' }] };
      if (sql.includes('SELECT d.*')) return { rows: drafts };
      if (sql.includes('SELECT 1 FROM publication_targets')) return { rows: [] };
      if (sql.includes('INSERT INTO drafts')) {
        const draft = { id: ++serial, topic_id: 71, status: 'failed', slides: [], copy_model: 'staged-editorial-v3', article_metadata: JSON.parse(values[1]) };
        drafts.unshift(draft); return { rows: [{ id: draft.id }] };
      }
      if (sql.includes('jsonb_set')) { const d = drafts.find((row) => row.id === values[0]); d.article_metadata.pipeline = JSON.parse(values[1]); return { rows: [], rowCount: 1 }; }
      if (sql.includes("needs_review=TRUE,status='failed'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  return { pool: { connect: async () => client }, calls, drafts, get released() { return released; } };
}

test('a failed adapter leaves committed peers in a failed shell and resume reuses them', async () => {
  const f = fixture(); let rendered = 0;
  const good = { version: 3, stages: { stage1_synthesis: { value: ['source'], receipt: { status: 'complete' } }, stage2_article: { value: ['article'], receipt: { status: 'complete' } } }, status: 'STAGE2_DONE' };
  const deps = { pool: f.pool, editorialInput, renderContent: async () => { rendered++; },
    buildContent: async (_topic, options) => { await options.saveCheckpoint(good); throw new Error('stage3a timeout'); } };
  await assert.rejects(produceStagedTopic(71, deps), /stage3a timeout/);
  assert.equal(rendered, 0);
  assert.equal(f.drafts.length, 1);
  assert.equal(f.drafts[0].status, 'failed');
  assert.equal(f.drafts[0].article_metadata.pipeline.stages.stage2_article.receipt.status, 'complete');
  assert.equal(f.calls.some(({ sql }) => sql === 'BEGIN'), false, 'provider work must not hold an open DB transaction');
  await assert.rejects(produceStagedTopic(71, { ...deps, buildContent: async (_topic, options) => {
    assert.deepEqual(options.checkpoint.stages, good.stages); throw new Error('remaining adapter failed');
  } }), /remaining adapter failed/);
  assert.equal(f.drafts.length, 1);
  assert.equal(f.calls.filter(({ sql }) => sql.includes('pg_advisory_unlock')).length, 2);
  assert.equal(f.released, true);
});

test('changing the evidence starts a new checkpoint instead of resuming a stale article', async () => {
  const f = fixture();
  const buildContent = async (_topic, options) => { assert.equal(options.checkpoint, undefined); throw new Error('stop after shell'); };
  const deps = { pool: f.pool, editorialInput, buildContent, renderContent: async () => assert.fail('render must not run') };
  await assert.rejects(produceStagedTopic(71, deps), /stop after shell/);
  const nextInput = structuredClone(editorialInput); nextInput.facts[0].text += ' Perubahan diumumkan pengelola.';
  await assert.rejects(produceStagedTopic(71, { ...deps, editorialInput: nextInput }), /stop after shell/);
  assert.equal(f.drafts.length, 2);
  assert.notEqual(f.drafts[0].article_metadata.pipeline.input_hash, f.drafts[1].article_metadata.pipeline.input_hash);
});
