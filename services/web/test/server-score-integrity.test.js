import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pkg from 'pg';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const pool = enabled ? new pkg.Pool({ host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER, password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME }) : null;
const migrationPath = new URL('../../../database/migrations/20261116_validate_topic_scores.sql', import.meta.url);
const auditPath = new URL('../../../database/audits/topic_scores_integrity.sql', import.meta.url);

async function legacyScores(t, scores) {
  const client = await pool.connect();
  t.after(async () => {
    await client.query('ROLLBACK');
    await client.query('DROP TABLE IF EXISTS pg_temp.topic_scores');
    client.release();
  });
  // Recreate a pre-validation table without touching the shared application data.
  await client.query('CREATE TEMP TABLE topic_scores (LIKE public.topic_scores INCLUDING ALL)');
  await client.query('ALTER TABLE topic_scores DROP CONSTRAINT topic_scores_component_total');
  for (const [index, values] of scores.entries()) await client.query(
    `INSERT INTO topic_scores(id,topic_id,score_relevance,score_credibility,score_momentum,score_engagement,score_compliance,score_total,verdict,model,prompt_version,reasoning)
     VALUES($1,1,$2,$3,$4,$5,$6,$7,'passed','legacy-fixture','historical-version','Preserve historical evidence')`,
    [index + 1, ...values],
  );
  await client.query(`ALTER TABLE topic_scores ADD CONSTRAINT topic_scores_component_total
    CHECK (score_total = score_relevance + score_credibility + score_momentum + score_engagement + score_compliance) NOT VALID`);
  return client;
}

const snapshot = async (client) => (await client.query('SELECT * FROM topic_scores ORDER BY id')).rows;
const validated = async (client) => (await client.query("SELECT convalidated FROM pg_constraint WHERE conrelid='topic_scores'::regclass AND conname='topic_scores_component_total'")).rows[0].convalidated;

test('score migration validates consistent historical and custom-weight rows without rewriting them', { skip: !enabled }, async (t) => {
  const migration = await fs.readFile(migrationPath, 'utf8');
  const client = await legacyScores(t, [[30, 20, 15, 10, 10, 85], [40, 20, 20, 10, 10, 100]]);
  const before = await snapshot(client);
  assert.equal(await validated(client), false);
  await client.query(migration);
  assert.equal(await validated(client), true);
  assert.deepEqual(await snapshot(client), before);
  await client.query(migration);
  assert.deepEqual(await snapshot(client), before, 'repeat runs preserve historical scores and metadata');
  await assert.rejects(() => client.query('UPDATE topic_scores SET score_total=84 WHERE id=1'), (error) => error.code === '23514');
});

test('score migration refuses mismatched history until an explicit row mapping is applied', { skip: !enabled }, async (t) => {
  const migration = await fs.readFile(migrationPath, 'utf8');
  const client = await legacyScores(t, [[30, 20, 15, 10, 10, 90]]);
  const before = await snapshot(client);
  await assert.rejects(() => client.query(migration), (error) => error.code === '23514' && /1/.test(error.message));
  await client.query('ROLLBACK');
  assert.equal(await validated(client), false);
  assert.deepEqual(await snapshot(client), before, 'migration must never invent a repair');
  // This mapping applies ONLY to this synthetic fixture, whose five components
  // are authoritative. No production mapping is inferred from this test.
  const mapped = await client.query(`UPDATE topic_scores SET score_total=85 WHERE id=1
    AND score_total=90 AND score_relevance=30 AND score_credibility=20
    AND score_momentum=15 AND score_engagement=10 AND score_compliance=10 RETURNING *`);
  assert.equal(mapped.rowCount, 1);
  assert.deepEqual(mapped.rows[0], { ...before[0], score_total: 85 });
  await client.query(migration);
  assert.equal(await validated(client), true);
});

test('score migration rejects over-100 component sums without clipping or normalizing evidence', { skip: !enabled }, async (t) => {
  const migration = await fs.readFile(migrationPath, 'utf8');
  const client = await legacyScores(t, [[30, 25, 20, 15, 20, 100]]);
  const before = await snapshot(client);
  await assert.rejects(() => client.query(migration), (error) => error.code === '23514');
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(client), before);
});

test('score audit is read-only and counts legacy mismatches', { skip: !enabled }, async (t) => {
  const audit = await fs.readFile(auditPath, 'utf8');
  const client = await legacyScores(t, [[30, 20, 15, 10, 10, 90], [40, 20, 20, 10, 10, 100]]);
  const before = await snapshot(client);
  const results = await client.query(audit);
  const summary = results.find((result) => result.rows[0]?.total_rows !== undefined).rows[0];
  assert.equal(Number(summary.total_rows), 2);
  assert.equal(Number(summary.total_mismatch), 1);
  assert.equal(Number(summary.out_of_range), 0);
  assert.deepEqual(await snapshot(client), before);
  assert.equal(await validated(client), false);
});

test.after(async () => { if (pool) await pool.end(); });
