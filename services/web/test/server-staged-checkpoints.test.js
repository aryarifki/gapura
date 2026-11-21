import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from 'pg';
import { produceStagedTopic } from '../../copywriter/staged-production.js';
import { storyInput } from '../../common/test/fixtures/story-editorial.js';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const config = { host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER,
  password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME };
const pool = enabled ? new pkg.Pool(config) : null;
test.after(async () => { await pool?.end(); });

test('PostgreSQL retains a failed stage checkpoint across connections while approval stays blocked', { skip: !enabled }, async (t) => {
  assert.match(process.env.HME_DB_NAME, /^gapura_test_/u);
  const { rows: [topic] } = await pool.query(`INSERT INTO topics(title,primary_source,url,status)
    VALUES('Pengalihan rute bus selama perbaikan','Dinas','https://city.example.com/rute','scored') RETURNING id`);
  await pool.query(`INSERT INTO topic_scores(topic_id,score_relevance,score_credibility,score_momentum,score_engagement,score_compliance,score_total,verdict,model)
    VALUES($1,30,25,20,10,10,95,'passed','offline-fixture')`, [topic.id]);
  t.after(async () => {
    await pool.query('DELETE FROM drafts WHERE topic_id=$1', [topic.id]);
    await pool.query('DELETE FROM topics WHERE id=$1', [topic.id]);
  });
  const s1 = { value: [{ fact_id: 'f1', text: 'Fakta sintetis yang diuji.' }], receipt: { status: 'complete', input_hash: 'fixture' } };
  let shellId;
  await assert.rejects(produceStagedTopic(topic.id, { pool, editorialInput: storyInput,
    buildContent: async (_topic, options) => {
      await options.saveCheckpoint({ stages: { stage1_synthesis: s1 }, status: 'STAGE1_DONE' });
      // A separate connection must see the commit before the provider returns.
      const { rows: [saved] } = await pool.query('SELECT id,status,article_metadata FROM drafts WHERE topic_id=$1 ORDER BY id DESC LIMIT 1', [topic.id]);
      shellId = saved.id;
      assert.equal(saved.status, 'failed');
      assert.deepEqual(saved.article_metadata.pipeline.stages.stage1_synthesis, s1);
      throw new Error('simulated stage2 timeout');
    }, renderContent: async () => assert.fail('rendering partial editorial output is forbidden'),
  }), /simulated stage2 timeout/);
  const detail = await fetch(`${process.env.GAPURA_TEST_BASE}/api/drafts/${shellId}`).then((r) => r.json());
  assert.equal(detail.status, 'failed');
  const approve = await fetch(`${process.env.GAPURA_TEST_BASE}/api/drafts/${shellId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'auto', expected_revision: detail.revision, reviewed: true }) });
  assert.equal(approve.status, 409);
  await assert.rejects(produceStagedTopic(topic.id, { pool, editorialInput: storyInput,
    buildContent: async (_topic, options) => { assert.deepEqual(options.checkpoint.stages.stage1_synthesis, s1); throw new Error('resume stage2 only'); },
    renderContent: async () => assert.fail('render must not run'),
  }), /resume stage2 only/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM drafts WHERE topic_id=$1', [topic.id])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM scheduled_posts WHERE draft_id=$1', [shellId])).rows[0].n, 0);
});
