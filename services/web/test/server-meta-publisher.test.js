import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from 'pg';
import { createMetaPublisherWorker, publicationConfigFromEnv } from '../../publisher/meta-worker.js';
import { draftContentHash } from '../../common/draft-revision.js';
import { createPublisher } from '../../publisher/publisher.js';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const pool = enabled ? new pkg.Pool({ host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER, password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME }) : null;
const env = { META_PLATFORMS: 'instagram', META_PAGE_ACCESS_TOKEN: 'fixture-token', META_INSTAGRAM_ACCOUNT_ID: '1784', GAPURA_ADMIN_TOKEN: 'x'.repeat(64), APP_BASE_URL: 'https://gapura.example' };
const logger = { warn() {} };

async function seed({ due = true, reviewed = true, accountId = '1784', platform = 'instagram' } = {}) {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,primary_source,status) VALUES('Publisher fixture','https://www.bps.go.id/publisher-fixture','BPS','produced') RETURNING id");
  await pool.query("INSERT INTO topic_scores(topic_id,score_relevance,score_credibility,score_momentum,score_engagement,score_compliance,score_total,verdict,model) VALUES($1,30,25,20,15,10,100,'passed','fixture')", [topic.id]);
  const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,status,needs_review,copy_model,content_format) VALUES($1,$2,'Fixture caption','scheduled',false,'fixture','single') RETURNING id", [topic.id, JSON.stringify([{ no: 1, layout: 'cover-focus', teks: 'Approved text', data: {} }])]);
  const { rows: [schedule] } = await pool.query("INSERT INTO scheduled_posts(draft_id,mode,scheduled_at,status) VALUES($1,'auto',NOW()+($2::int*interval '1 hour'),'pending') RETURNING id", [draft.id, due ? -1 : 1]);
  const { rows: [content] } = await pool.query('SELECT * FROM drafts WHERE id=$1', [draft.id]);
  if (reviewed) await pool.query("INSERT INTO audit_log(entity,entity_id,action,actor,payload) VALUES('draft',$1,'approved_auto','web_admin',$2)", [draft.id, JSON.stringify({ content_hash: draftContentHash(content) })]);
  const { rows: [target] } = await pool.query('INSERT INTO publication_targets(draft_id,platform,account_id) VALUES($1,$2,$3) RETURNING id', [draft.id, platform, accountId]);
  return { draftId: draft.id, scheduleId: schedule.id, targetId: target.id };
}

function worker(extraEnv = {}, fetchImpl = async () => { throw new Error('Unexpected remote request'); }) {
  return createMetaPublisherWorker({ pool, config: publicationConfigFromEnv({ ...env, ...extraEnv }), fetchImpl, logger });
}

test('Meta database: future schedules and a different configured account remain untouched', { skip: !enabled }, async () => {
  const future = await seed({ due: false });
  const other = await seed({ accountId: 'old-account' });
  await worker().runOnce();
  const { rows } = await pool.query('SELECT id,status,attempts FROM publication_targets WHERE id=ANY($1::bigint[]) ORDER BY id', [[future.targetId, other.targetId]]);
  assert.deepEqual(rows.map(({ status, attempts }) => ({ status, attempts })), [{ status: 'pending', attempts: 0 }, { status: 'pending', attempts: 0 }]);
});

test('Meta database: scheduled status alone is insufficient without a human approval record', { skip: !enabled }, async () => {
  const item = await seed({ reviewed: false });
  await worker().runOnce();
  const { rows: [target] } = await pool.query('SELECT status,error_message FROM publication_targets WHERE id=$1', [item.targetId]);
  assert.equal(target.status, 'blocked');
  assert.match(target.error_message, /review|persetujuan|approval/i);
});

test('Meta database: transient errors retry on a later cycle, at most once per cycle', { skip: !enabled }, async () => {
  const item = await seed();
  let calls = 0;
  const runner = worker({ META_PUBLISH_MODE: 'live' }, async () => { calls++; return new Response('busy', { status: 503 }); });
  const first = await runner.runOnce();
  let target = (await pool.query('SELECT status,attempts FROM publication_targets WHERE id=$1', [item.targetId])).rows[0];
  assert.equal(first.retried, 1);
  assert.deepEqual(target, { status: 'pending', attempts: 1 });
  assert.equal(calls, 1);
  await runner.runOnce();
  target = (await pool.query('SELECT status,attempts FROM publication_targets WHERE id=$1', [item.targetId])).rows[0];
  assert.deepEqual(target, { status: 'pending', attempts: 2 });
  await pool.query("UPDATE publication_targets SET status='failed' WHERE id=$1", [item.targetId]);
});

test('Meta database: a new approved schedule can replace an unattempted blocked target', { skip: !enabled }, async () => {
  const item = await seed();
  await worker().runOnce();
  await pool.query("UPDATE publication_targets SET status='blocked' WHERE id=$1", [item.targetId]);
  await pool.query("UPDATE scheduled_posts SET status='failed' WHERE id=$1", [item.scheduleId]);
  await pool.query("INSERT INTO scheduled_posts(draft_id,mode,scheduled_at,status) VALUES($1,'auto',NOW()-interval '1 minute','pending')", [item.draftId]);
  const result = await worker().runOnce();
  assert.equal(result.shadow, 1);
  const { rows: [target] } = await pool.query('SELECT status,attempts FROM publication_targets WHERE id=$1', [item.targetId]);
  assert.deepEqual(target, { status: 'shadow', attempts: 1 });
});

test('Meta database: success completes the schedule and draft without a legacy duplicate', { skip: !enabled }, async () => {
  const item = await seed();
  const responses = [{ id: 'container-1' }, { status_code: 'FINISHED' }, { id: 'media-1' }, { permalink: 'https://instagram.com/p/fixture' }];
  const result = await worker({ META_PUBLISH_MODE: 'live' }, async () => Response.json(responses.shift())).runOnce();
  assert.equal(result.published, 1);
  const { rows: [draft] } = await pool.query('SELECT status FROM drafts WHERE id=$1', [item.draftId]);
  const { rows: [schedule] } = await pool.query('SELECT status FROM scheduled_posts WHERE id=$1', [item.scheduleId]);
  assert.equal(draft.status, 'published');
  assert.equal(schedule.status, 'success');
  const repeated = await worker({ META_PUBLISH_MODE: 'live' }).runOnce();
  assert.equal(repeated.published, 0);
});

test('Meta database: an attempted or unknown publication prevents editing its approved assets', { skip: !enabled }, async () => {
  const item = await seed();
  await pool.query("UPDATE publication_targets SET status='unknown',publish_attempted_at=NOW() WHERE id=$1", [item.targetId]);
  const response = await fetch(`${process.env.GAPURA_TEST_BASE}/api/drafts/${item.draftId}/update-full`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GAPURA_ADMIN_TOKEN}` },
    body: JSON.stringify({ caption: 'Must not replace a possibly published caption', hashtags: [] }),
  });
  assert.equal(response.status, 409);
  const { rows: [draft] } = await pool.query('SELECT caption FROM drafts WHERE id=$1', [item.draftId]);
  assert.equal(draft.caption, 'Fixture caption');
});

test('legacy publisher database: current human approval hash is required in both claim and locked publish', { skip: !enabled }, async () => {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,status) VALUES('Legacy fixture','https://example.org/legacy','produced') RETURNING id");
  for (const approved of [false, true]) {
    const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,hashtags,status,needs_review,copy_model,content_format) VALUES($1,$2,'Legacy approved caption',$3,'scheduled',false,'fixture','single') RETURNING *", [topic.id, JSON.stringify([{ no: 1, layout: 'cover-focus', teks: 'Legacy fixture', data: {} }]), ['#GapuraMedia']]);
    await pool.query("INSERT INTO scheduled_posts(draft_id,mode,scheduled_at,status) VALUES($1,'auto',NOW()-interval '1 minute','pending')", [draft.id]);
    if (approved) await pool.query("INSERT INTO audit_log(entity,entity_id,action,actor,payload) VALUES('draft',$1,'approved_auto','web_admin',$2)", [draft.id, JSON.stringify({ content_hash: draftContentHash(draft) })]);
    const calls = [];
    const runner = createPublisher({ pool, config: { baseUrl: 'https://gapura.example', igAccountId: 'fake-account', igAccessToken: 'fake-token', signingSecret: 'fixture-secret' }, logger, fetchImpl: async (url, options) => {
      calls.push(String(url));
      return Response.json(String(url).includes('/media_publish') ? { id: 'fixture-published' } : options?.method === 'GET' ? { status_code: 'FINISHED' } : { id: 'fixture-container' });
    } });
    const result = await runner.runPublisher();
    assert.equal(calls.some((url) => url.includes('/media_publish')), approved);
    assert.equal(result.published, approved ? 1 : 0);
    assert.equal((await pool.query('SELECT status FROM drafts WHERE id=$1', [draft.id])).rows[0].status, approved ? 'published' : 'scheduled');
  }
});

test.after(async () => { if (pool) await pool.end(); });
