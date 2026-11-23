import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captionHash, createMetaPublisherWorker, parseWorkerArgs, publicationConfigFromEnv } from '../meta-worker.js';
import { draftContentHash } from '../../common/draft-revision.js';

const configRoot = fs.mkdtempSync('/tmp/opencode/gapura-meta-worker-config-');
after(() => fs.rmSync(configRoot, { recursive: true, force: true }));
const testedPools = new Set();
beforeEach(t => t.mock.method(globalThis, 'fetch', () => { throw new Error('Only injected HTTP is allowed in tests'); }));
afterEach(() => {
  try {
    for (const pool of testedPools) assert.doesNotMatch(pool.state.queries.join('\n'), /verification_reports|verification_status|verification_confidence/i);
  } finally { testedPools.clear(); }
});

const baseEnv = {
  GAPURA_META_CONNECTION: path.join(configRoot, 'missing.json'),
  META_PLATFORMS: 'instagram,facebook',
  META_PAGE_ACCESS_TOKEN: 'page-token',
  META_PAGE_ID: '102321216076547',
  META_INSTAGRAM_ACCOUNT_ID: '17841471438781611',
  META_APP_ID: '1123019133826199',
  META_UNIFIED_CONFIG_ID: '1848852586267233',
  APP_BASE_URL: 'https://gapura.example',
  GAPURA_ADMIN_TOKEN: 'a'.repeat(64),
};

function writeMetaConnection(t, overrides = {}) {
  const root = fs.mkdtempSync('/tmp/opencode/gapura-meta-worker-');
  const file = path.join(root, 'meta-unified.json');
  fs.writeFileSync(file, JSON.stringify({
    access_token: 'unified-suat',
    app_id: '1123019133826199',
    config_id: '1848852586267233',
    client_business_id: '123',
    instagram_account_id: '17841471438781611',
    username: 'gapuramedia',
    graph_version: 'v27.0',
    connected_at: '2026-11-16T00:00:00.000Z',
    expires_at: null,
    ...overrides,
  }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return file;
}

function coverSlide(overrides = {}) {
  return {
    no: 1, layout: 'cover-focus', teks: 'Halo Gapura',
    data: {
      title: 'Halo Gapura', asset_id: '2d30e364-b95d-4d49-82ed-43c548270944',
      asset_sha256: 'a'.repeat(64), image_kind: 'ai_generated',
    },
    ...overrides,
  };
}

function claimRow(overrides = {}) {
  const row = {
    id: 1, draft_id: 7, schedule_id: 1, platform: 'instagram', account_id: '17841471438781611', status: 'publishing',
    attempts: 1, caption: 'Halo Gapura', slides: [coverSlide(), { no: 2 }], content_format: 'carousel',
    hashtags: ['#gapura'], needs_review: false, draft_status: 'scheduled', human_approved: true,
    source_url: 'https://www.bps.go.id/fixture', analyst_passed: true,
    editorial_input: null, editorial_mode: null, caption_body: null, threads_caption: null, angle: null, scope_note: null, editorial_references: null,
    article_body: null, article_references: null, article_facts: null,
    ...overrides,
  };
  return { ...row, approved_content_hash: draftContentHash(row), content_hash: draftContentHash(row), ...overrides };
}

function assertDueSchedule(q) {
  assert.match(q, /sp\.status = 'pending' AND sp\.mode = 'auto' AND sp\.scheduled_at <= NOW\(\)/);
  assert.match(q, /old\.status IN \('publishing', 'success'\)/);
  assert.match(q, /old\.ig_creation_id IS NOT NULL/);
  assert.match(q, /old\.ig_media_id IS NOT NULL OR old\.published_at IS NOT NULL/);
}

function assertReviewEvidence(q) {
  assert.match(q, /AS human_approved/i);
  assert.match(q, /AS approved_content_hash/i);
  assert.match(q, /a\.action = 'approved_auto' AND a\.created_at >= d\.updated_at/);
  assert.match(q, /a\.actor = 'web_admin'/);
  assert.ok(q.includes('^telegram:[0-9]+$'));
  assert.match(q, /ORDER BY a\.created_at DESC, a\.id DESC LIMIT 1/);
  assert.match(q, /SELECT topic\.url FROM topics topic WHERE topic\.id = d\.topic_id/);
  assert.match(q, /d\.hashtags/);
  for (const field of ['editorial_input', 'editorial_mode', 'caption_body', 'threads_caption', 'angle', 'scope_note', 'editorial_references', 'article_body', 'article_references', 'article_facts']) assert.match(q, new RegExp(`d\\.${field}\\b`));
}

function fakePool(rows, { inserted = 1, failPublishedOnce = false, saveContainerCount = 1 } = {}) {
  const queue = structuredClone(rows);
  const state = { updates: [], audits: [], shadowResets: 0, inserts: 0, queries: [], queryCalls: [], current: structuredClone(rows[0]), scheduleActive: true };
  const client = {
    release() {},
    async query(sql, values = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      state.queries.push(q);
      state.queryCalls.push({ q, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q)) return { rows: [], rowCount: 0 };
      if (/^SELECT t\.\*/i.test(q)) {
        assertReviewEvidence(q);
        assertDueSchedule(q);
        assert.match(q, /t\.status = 'publishing'/);
        assert.match(q, /due\.id = t\.schedule_id AND due\.status = 'pending' AND due\.mode = 'auto' AND due\.scheduled_at <= NOW\(\)/);
        assert.match(q, /FOR UPDATE OF t, d$/);
        const current = state.current?.status === 'publishing' && state.scheduleActive ? structuredClone(state.current) : null;
        return { rows: current ? [current] : [], rowCount: current ? 1 : 0 };
      }
      if (/^UPDATE publication_targets SET container_id/i.test(q)) {
        assert.match(q, /WHERE id = \$2 AND status = 'publishing'/);
        return { rowCount: saveContainerCount };
      }
      if (/^UPDATE scheduled_posts sp SET status = 'success'/i.test(q)) return { rowCount: 1 };
      if (/^UPDATE drafts d SET status = 'published'/i.test(q)) return { rowCount: 1 };
      if (/^INSERT INTO publication_targets/i.test(q)) {
        assertDueSchedule(q);
        assert.match(q, /d\.status = 'scheduled'/);
        assert.match(q, /a\.action='approved_auto' ORDER BY a\.created_at DESC,a\.id DESC LIMIT 1/);
        assert.match(q, /publication_targets\.status IN \('pending', 'shadow', 'blocked', 'failed'\)/);
        assert.match(q, /publication_targets\.remote_id IS NULL AND publication_targets\.container_id IS NULL AND publication_targets\.publish_attempted_at IS NULL/);
        state.inserts++; return { rows: [], rowCount: inserted };
      }
      if (/UPDATE publication_targets SET status = 'pending', updated_at = NOW\(\) WHERE status = 'shadow'/i.test(q)) {
        state.shadowResets++; return { rows: [], rowCount: 2 };
      }
      if (/^WITH candidate/i.test(q)) {
        assertDueSchedule(q);
        assertReviewEvidence(q);
        assert.match(q, /t\.status = 'pending' AND d\.status = 'scheduled'/);
        assert.match(q, /due\.id = t\.schedule_id AND due\.draft_id = d\.id AND due\.status = 'pending' AND due\.mode = 'auto' AND due\.scheduled_at <= NOW\(\)/);
        assert.match(q, /FOR UPDATE OF t SKIP LOCKED/);
        assert.match(q, /SET status = 'publishing', attempts = t\.attempts \+ 1/);
        const next = queue.shift();
        if (next) state.current = structuredClone(next);
        return { rows: next ? [next] : [], rowCount: next ? 1 : 0 };
      }
      if (/^UPDATE publication_targets SET status = \$1/i.test(q)) {
        if (values[0] === 'published' && failPublishedOnce) {
          failPublishedOnce = false;
          throw new Error('injected persistence failure');
        }
        assert.match(q, /WHERE id = \$8 AND status = 'publishing'/);
        state.updates.push({
          id: values[7], status: values[0], remoteId: values[1], permalink: values[3],
          error: values[4], publishedAt: values[5], captionHash: values[6],
        });
        if (state.current) state.current.status = values[0];
        return { rowCount: 1 };
      }
      if (/^INSERT INTO audit_log/i.test(q)) { state.audits.push({ draftId: values[0], payload: JSON.parse(values[1]) }); return { rowCount: 1 }; }
      throw new Error(`Unexpected SQL: ${q.slice(0, 80)}`);
    },
  };
  const pool = { state, async connect() { return client; } };
  testedPools.add(pool);
  return pool;
}

function graphFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, authorization: init.headers.Authorization, body: init.body == null ? null : new URLSearchParams(init.body) });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected Meta call: ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return typeof next === 'function' ? next(url, init) : Response.json(next);
  };
  return { calls, fetchImpl };
}

const liveConfig = () => ({ ...publicationConfigFromEnv({ ...baseEnv, META_PUBLISH_MODE: 'live' }), httpTimeoutMs: 2000 });

test('defaults to shadow mode and disables platforms without credentials', () => {
  const config = publicationConfigFromEnv({
    GAPURA_META_CONNECTION: baseEnv.GAPURA_META_CONNECTION,
    META_PLATFORMS: 'instagram,threads',
  });
  assert.equal(config.mode, 'shadow');
  assert.equal(config.platforms.instagram.enabled, false);
  assert.equal(config.platforms.threads.enabled, false);
  assert.throws(() => publicationConfigFromEnv({ META_PLATFORMS: 'tiktok' }), /tidak dikenal/);
});

test('uses a matching Unified Instagram connection while Facebook keeps its Page token', (t) => {
  const file = writeMetaConnection(t);
  const config = publicationConfigFromEnv({
    ...baseEnv,
    GAPURA_META_CONNECTION: file,
    META_INSTAGRAM_ACCESS_TOKEN: 'legacy-instagram-token',
    META_GRAPH_VERSION: 'v23.0',
    META_PLATFORMS: 'instagram,facebook,threads',
    META_THREADS_USER_ID: '99',
    META_THREADS_ACCESS_TOKEN: 'threads-token',
  });

  assert.equal(config.platforms.instagram.accountId, '17841471438781611');
  assert.equal(config.platforms.instagram.accessToken, 'unified-suat');
  assert.equal(config.platforms.instagram.graphVersion, 'v27.0');
  assert.equal(config.platforms.instagram.authType, 'unified_login');
  assert.equal(config.platforms.instagram.enabled, true);
  assert.equal(config.platforms.facebook.accessToken, 'page-token');
  assert.equal(config.platforms.facebook.accountId, '102321216076547');
  assert.deepEqual(config.platforms.threads, { accountId: '99', accessToken: 'threads-token', enabled: true });
});

test('falls back to the legacy Instagram token when no Unified connection exists', () => {
  const config = publicationConfigFromEnv({
    ...baseEnv,
    META_INSTAGRAM_ACCESS_TOKEN: 'legacy-instagram-token',
  });

  assert.equal(config.platforms.instagram.accessToken, 'legacy-instagram-token');
  assert.equal(config.platforms.instagram.accountId, baseEnv.META_INSTAGRAM_ACCOUNT_ID);
  assert.equal(config.platforms.instagram.graphVersion, undefined);
  assert.equal(config.platforms.instagram.authType, undefined);
  assert.equal(config.platforms.facebook.accessToken, 'page-token');
});

test('accepts Unified tokens only for the configured app, config and Instagram account', (t) => {
  for (const overrides of [
    { app_id: '1123019133826100' },
    { config_id: '1848852586267200' },
    { instagram_account_id: '17841471438781000' },
  ]) {
    const file = writeMetaConnection(t, overrides);
    const config = publicationConfigFromEnv({
      ...baseEnv,
      GAPURA_META_CONNECTION: file,
      META_INSTAGRAM_ACCESS_TOKEN: 'legacy-instagram-token',
    });

    assert.equal(config.platforms.instagram.accessToken, 'legacy-instagram-token');
    assert.equal(config.platforms.instagram.accountId, baseEnv.META_INSTAGRAM_ACCOUNT_ID);
    assert.equal(config.platforms.instagram.graphVersion, undefined);
    assert.equal(config.platforms.facebook.accessToken, 'page-token');
  }
  const file = writeMetaConnection(t);
  for (const missing of ['META_APP_ID', 'META_UNIFIED_CONFIG_ID']) {
    const config = publicationConfigFromEnv({ ...baseEnv, GAPURA_META_CONNECTION: file, [missing]: '' });
    assert.equal(config.platforms.instagram.accessToken, 'page-token');
  }
});

test('disables Instagram for an expired matching Unified connection without using a stale fallback token', (t) => {
  const file = writeMetaConnection(t, { expires_at: '2000-01-01T00:00:00.000Z' });
  const config = publicationConfigFromEnv({
    ...baseEnv,
    GAPURA_META_CONNECTION: file,
    META_INSTAGRAM_ACCESS_TOKEN: 'legacy-instagram-token',
  });

  assert.equal(config.platforms.instagram.enabled, false);
  assert.equal(config.platforms.instagram.accessToken, '');
  assert.equal(config.platforms.instagram.accountId, baseEnv.META_INSTAGRAM_ACCOUNT_ID);
  assert.equal(config.platforms.facebook.accessToken, 'page-token');
});

test('Unified Instagram works without a Page token or configured Instagram account and keeps shadow mode', (t) => {
  const file = writeMetaConnection(t, { expires_at: new Date(Date.now() + 3600000).toISOString() });
  const config = publicationConfigFromEnv({
    ...baseEnv,
    GAPURA_META_CONNECTION: file,
    META_PAGE_ACCESS_TOKEN: '',
    META_INSTAGRAM_ACCOUNT_ID: '',
  });

  assert.equal(config.platforms.instagram.enabled, true);
  assert.equal(config.platforms.instagram.accountId, '17841471438781611');
  assert.equal(config.platforms.instagram.accessToken, 'unified-suat');
  assert.equal(config.platforms.instagram.graphVersion, 'v27.0');
  assert.equal(config.platforms.facebook.enabled, false);
  assert.equal(config.platforms.facebook.accessToken, '');
  assert.equal(config.mode, 'shadow');
  const unrequested = publicationConfigFromEnv({ ...baseEnv, GAPURA_META_CONNECTION: file, META_PLATFORMS: 'facebook' });
  assert.equal(unrequested.platforms.instagram.enabled, false);
});

test('missing, malformed and unreadable Unified stores use legacy config without exposing file contents', (t) => {
  const file = writeMetaConnection(t);
  fs.writeFileSync(file, '{"access_token":"private-broken-token"');
  for (const connectionFile of [file, path.dirname(file), `${file}.absent`]) {
    let config;
    assert.doesNotThrow(() => { config = publicationConfigFromEnv({ ...baseEnv, GAPURA_META_CONNECTION: connectionFile }); });
    assert.equal(config.platforms.instagram.accessToken, 'page-token');
    assert.equal(config.platforms.instagram.enabled, true);
    assert.equal(config.platforms.facebook.accessToken, 'page-token');
    assert.equal(JSON.stringify(config).includes('private-broken-token'), false);
  }
});

test('Instagram and Facebook adapters use their own token and Graph version', async (t) => {
  const file = writeMetaConnection(t, { graph_version: 'v28.0' });
  const config = publicationConfigFromEnv({ ...baseEnv, GAPURA_META_CONNECTION: file, META_PUBLISH_MODE: 'live', META_GRAPH_VERSION: 'v24.0' });
  const instagramPool = fakePool([claimRow()]);
  const instagram = graphFetch([
    { id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' }, { status_code: 'FINISHED' },
    { id: 'media-9' }, { permalink: 'https://www.instagram.com/p/abc/' },
  ]);
  const instagramResult = await createMetaPublisherWorker({ pool: instagramPool, config, fetchImpl: instagram.fetchImpl }).runOnce();
  assert.equal(instagramResult.published, 1);
  assert.equal(instagram.calls.length, 6);
  assert.ok(instagram.calls.every(({ url, authorization }) => new URL(url).pathname.startsWith('/v28.0/') && authorization === 'Bearer unified-suat'));

  const facebookPool = fakePool([claimRow({ platform: 'facebook', account_id: baseEnv.META_PAGE_ID })]);
  const facebook = graphFetch([
    { id: 'photo-1' }, { id: 'photo-2' }, { id: 'facebook-post' },
    { permalink_url: 'https://www.facebook.com/posts/abc' },
  ]);
  const facebookResult = await createMetaPublisherWorker({ pool: facebookPool, config, fetchImpl: facebook.fetchImpl }).runOnce();
  assert.equal(facebookResult.published, 1);
  assert.equal(facebook.calls.length, 4);
  assert.ok(facebook.calls.every(({ url, authorization }) => new URL(url).pathname.startsWith('/v24.0/') && authorization === 'Bearer page-token'));
});

test('Threads uses the documented graph.threads.com host and a separate Threads token', () => {
  const config = publicationConfigFromEnv({ ...baseEnv, META_PLATFORMS: 'threads', META_THREADS_USER_ID: '99' });
  assert.equal(config.threadsBaseUrl, 'https://graph.threads.com');
  assert.equal(config.platforms.threads.enabled, false);
  const active = publicationConfigFromEnv({ ...baseEnv, META_PLATFORMS: 'threads', META_THREADS_USER_ID: '99', META_THREADS_ACCESS_TOKEN: 'threads-token' });
  assert.equal(active.platforms.threads.enabled, true);
  assert.equal(active.platforms.threads.accessToken, 'threads-token');
});

test('shadow mode records what would be published without any Meta request', async () => {
  const pool = fakePool([claimRow()]);
  const { calls, fetchImpl } = graphFetch([]);
  const worker = createMetaPublisherWorker({ pool, config: publicationConfigFromEnv(baseEnv), fetchImpl });
  const result = await worker.runOnce();
  assert.equal(result.shadow, 1);
  assert.equal(result.published, 0);
  assert.equal(calls.length, 0);
  assert.equal(pool.state.updates[0].status, 'shadow');
  assert.match(pool.state.updates[0].error, /Shadow mode/);
});

test('live mode publishes a carousel and stores the remote id and permalink', async () => {
  const pool = fakePool([claimRow()]);
  const { calls, fetchImpl } = graphFetch([
    { id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' },
    { status_code: 'FINISHED' },
    { id: 'media-9' },
    { permalink: 'https://www.instagram.com/p/abc/' },
  ]);
  const worker = createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl });
  const result = await worker.runOnce();
  assert.equal(result.published, 1);
  assert.equal(pool.state.updates[0].status, 'published');
  assert.equal(pool.state.updates[0].remoteId, 'media-9');
  assert.equal(pool.state.updates[0].permalink, 'https://www.instagram.com/p/abc/');
  assert.equal(pool.state.audits[0].payload.platform, 'instagram');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 4);
});

test('publication requires explicit human approval, a cleared review flag and matching revision hashes', async () => {
  for (const overrides of [
    ...[false, null, undefined, 'true', 1].map(human_approved => ({ human_approved })),
    ...[true, null, undefined, 0, 'false'].map(needs_review => ({ needs_review })),
    ...['draft', 'approved', 'rejected', 'published'].map(draft_status => ({ draft_status })),
    { approved_content_hash: null }, { approved_content_hash: 'stale-approval' },
    { content_hash: null }, { content_hash: 'stale-target' },
  ]) {
    const pool = fakePool([claimRow(overrides)]);
    const { calls, fetchImpl } = graphFetch([]);
    const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
    assert.equal(result.blocked, 1, JSON.stringify(overrides));
    assert.equal(result.published, 0);
    assert.equal(calls.length, 0);
    assert.equal(pool.state.updates[0].status, 'blocked');
    assert.equal(pool.state.audits.length, 0);
  }
});

test('a scheduled draft without a cover image is blocked before creating any Meta container', async () => {
  const row = claimRow({ slides: [{ no: 1, layout: 'cover-focus', teks: 'Tanpa gambar' }, { no: 2 }] });
  const pool = fakePool([row]);
  const { calls, fetchImpl } = graphFetch([]);
  const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
  assert.equal(result.blocked, 1);
  assert.equal(result.published, 0);
  assert.equal(calls.length, 0);
  assert.equal(pool.state.updates[0].status, 'blocked');
  assert.equal(pool.state.audits.length, 0);
});

test('a revision changed after approval is blocked before creating any Meta container', async () => {
  for (const change of [
    row => { row.caption = 'Revised caption'; },
    row => { row.slides[0].title = 'Revised slide'; },
    row => { row.hashtags = ['#revised']; },
    row => { row.content_format = 'single'; },
  ]) {
    const row = claimRow();
    change(row);
    assert.notEqual(draftContentHash(row), row.approved_content_hash);
    const pool = fakePool([row]); const { calls, fetchImpl } = graphFetch([]);
    const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
    assert.equal(result.blocked, 1);
    assert.equal(calls.length, 0);
    assert.equal(pool.state.audits.length, 0);
  }
});

test('concurrent workers publish one claimed target only once', async () => {
  const pool = fakePool([claimRow()]);
  const { calls, fetchImpl } = graphFetch([
    { id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' }, { status_code: 'FINISHED' },
    { id: 'media-once' }, { permalink: 'https://www.instagram.com/p/once/' },
  ]);
  const worker = createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl });
  const results = await Promise.all([worker.runOnce(), worker.runOnce()]);
  assert.equal(results.reduce((count, result) => count + result.published, 0), 1);
  assert.equal(calls.filter(({ url }) => url.endsWith('/media_publish')).length, 1);
  assert.equal(pool.state.audits.length, 1);
});

test('a retryable Meta failure returns the target to pending until the attempt budget is spent', async () => {
  const retryPool = fakePool([claimRow()]);
  const retry = graphFetch([new Response('busy', { status: 503 })]);
  const retryWorker = createMetaPublisherWorker({ pool: retryPool, config: liveConfig(), fetchImpl: retry.fetchImpl });
  assert.equal((await retryWorker.runOnce()).retried, 1);
  assert.equal(retryPool.state.updates[0].status, 'pending');
  assert.match(retryPool.state.updates[0].error, /gagal sementara/);

  const finalPool = fakePool([claimRow({ attempts: 3 })]);
  const final = graphFetch([new Response('busy', { status: 503 })]);
  const finalWorker = createMetaPublisherWorker({ pool: finalPool, config: liveConfig(), fetchImpl: final.fetchImpl });
  assert.equal((await finalWorker.runOnce()).failed, 1);
  assert.equal(finalPool.state.updates[0].status, 'failed');
});

test('an ambiguous media_publish failure becomes unknown and is never retried or reset with shadow targets', async () => {
  const pool = fakePool([claimRow()]);
  const { calls, fetchImpl } = graphFetch([
    { id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' },
    { status_code: 'FINISHED' },
    new Error('socket hang up'),
  ]);
  const worker = createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl });
  const result = await worker.runOnce();
  assert.equal(result.unknown, 1);
  assert.equal(pool.state.updates[0].status, 'unknown');
  assert.match(pool.state.updates[0].error, /rekonsiliasi manual/);
  const replay = await worker.runOnce({ resetShadow: true });
  assert.equal(replay.published, 0);
  assert.equal(replay.retried, 0);
  assert.equal(pool.state.current.status, 'unknown');
  assert.equal(pool.state.updates.length, 1);
  assert.equal(calls.filter(({ url }) => url.endsWith('/media_publish')).length, 1);
  assert.equal(pool.state.audits.length, 0);
});

test('reset-shadow moves shadow targets back to pending and caption hashes are stable', async () => {
  const pool = fakePool([], { inserted: 0 });
  const worker = createMetaPublisherWorker({ pool, config: publicationConfigFromEnv(baseEnv), fetchImpl: async () => { throw new Error('no calls'); } });
  const result = await worker.runOnce({ resetShadow: true });
  assert.equal(result.reset, 2);
  assert.equal(pool.state.shadowResets, 1);
  assert.equal(captionHash('Halo'), captionHash('Halo'));
  assert.notEqual(captionHash('Halo'), captionHash('Halo!'));
});

test('revoked approval, a changed revision or lost schedule during preparation prevents media_publish', async () => {
  for (const change of [
    state => { state.current.needs_review = true; },
    state => { state.current.human_approved = false; },
    state => { state.current.approved_content_hash = 'changed-approval'; },
    state => { state.current.content_hash = 'changed-target'; },
    state => { state.current.caption = 'Revised caption'; },
    state => { state.current.slides[0].title = 'Revised slide'; },
    state => { state.current.hashtags = ['#revised']; },
    state => { state.current.content_format = 'single'; },
    state => { state.current.draft_status = 'draft'; },
    state => { state.current.draft_status = 'approved'; },
    state => { state.current.draft_status = 'rejected'; },
    state => { state.current.draft_status = 'published'; },
    state => { state.current.account_id = 'different-account'; },
    state => { state.current.source_url = 'http://127.0.0.1/article'; },
    state => { state.scheduleActive = false; },
    state => { state.current = null; },
    state => {
      state.current.caption = 'Revised and reapproved during container preparation';
      state.current.content_hash = state.current.approved_content_hash = draftContentHash(state.current);
    },
  ]) {
    const pool = fakePool([claimRow()]);
    const { calls, fetchImpl } = graphFetch([
      () => { change(pool.state); return Response.json({ id: 'child-1' }); },
      { id: 'child-2' }, { id: 'parent-1' }, { status_code: 'FINISHED' }, { id: 'must-not-publish' },
    ]);
    const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
    assert.equal(result.published, 0);
    assert.equal(result.blocked, 1);
    assert.equal(calls.some(({ url }) => url.endsWith('/media_publish')), false);
    assert.equal(pool.state.updates.at(-1).status, 'blocked');
    assert.equal(pool.state.audits.length, 0);
    assert.ok(pool.state.queries.includes('ROLLBACK'));
  }
});

test('a lost publication claim before container persistence prevents media_publish', async () => {
  const pool = fakePool([claimRow()], { saveContainerCount: 0 });
  const { calls, fetchImpl } = graphFetch([
    { id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' }, { status_code: 'FINISHED' },
  ]);
  const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
  assert.equal(result.failed, 1);
  assert.equal(result.published, 0);
  assert.equal(result.unknown, 0);
  assert.equal(calls.some(({ url }) => url.endsWith('/media_publish')), false);
  assert.equal(pool.state.audits.length, 0);
});

test('database failure after remote success preserves the known remote id as unknown', async () => {
  const pool = fakePool([claimRow()], { failPublishedOnce: true });
  const { fetchImpl } = graphFetch([
    { id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' }, { status_code: 'FINISHED' },
    { id: 'known-media' }, { permalink: 'https://www.instagram.com/p/known/' },
  ]);
  const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
  assert.equal(result.unknown, 1);
  assert.equal(pool.state.updates.at(-1).status, 'unknown');
  assert.equal(pool.state.updates.at(-1).remoteId, 'known-media');
});

test('publication still requires a public source', async () => {
  for (const overrides of [
    { source_url: '' }, { source_url: null }, { source_url: 'http://127.0.0.1/article' },
  ]) {
    const pool = fakePool([claimRow(overrides)]);
    const { calls, fetchImpl } = graphFetch([]);
    const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
    assert.equal(result.blocked, 1);
    assert.equal(calls.length, 0);
    assert.equal(pool.state.audits.length, 0);
  }
});

const originalMetadata = {
  editorial_input: { version: 1, mode: 'explainer', facts: [] }, editorial_mode: 'explainer',
  caption_body: 'Penjelasan warga', threads_caption: 'Penjelasan ringkas Threads #GapuraMedia',
  angle: 'Akses warga', scope_note: 'Mekanisme umum',
  editorial_references: { caption: [{ kind: 'context', fact_ids: [] }], threads: [] },
};
const originalChanges = [
  { editorial_mode: 'current' }, { editorial_input: { version: 1, mode: 'current', facts: [{ id: 'f1', text: 'Fakta terkurasi' }] } },
  { caption_body: 'Isi diubah' }, { threads_caption: 'Threads diubah' }, { angle: 'Angle diubah' }, { scope_note: 'Cakupan diubah' },
  { editorial_references: { caption: [{ kind: 'fact', fact_ids: ['f1'] }], threads: ['f1'] } },
];
const threadsConfig = () => publicationConfigFromEnv({ ...baseEnv, META_PUBLISH_MODE: 'live', META_PLATFORMS: 'threads', META_THREADS_USER_ID: '99', META_THREADS_ACCESS_TOKEN: 'threads-token' });

test('both Meta SQL projections include all original metadata used by the approved revision', async () => {
  const pool = fakePool([claimRow({ ...originalMetadata })]);
  const graph = graphFetch([{ id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' }, { status_code: 'FINISHED' }, { id: 'media-original' }, { permalink: 'https://www.instagram.com/p/original/' }]);
  assert.equal((await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl: graph.fetchImpl }).runOnce()).published, 1);
  const projections = pool.state.queries.filter((q) => /^WITH candidate|^SELECT t\.\*/.test(q));
  assert.equal(projections.length, 3);
  for (const projection of projections) assertReviewEvidence(projection);
});

test('original metadata revised after review is blocked before any Meta request', async () => {
  for (const change of originalChanges) {
    const row = claimRow({ ...originalMetadata });
    Object.assign(row, change);
    const pool = fakePool([row]); const graph = graphFetch([]);
    const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl: graph.fetchImpl }).runOnce();
    assert.equal(result.blocked, 1, JSON.stringify(change));
    assert.equal(result.published, 0);
    assert.equal(graph.calls.length, 0);
    assert.equal(pool.state.updates[0].status, 'blocked');
  }
});

test('original metadata changes during container preparation require review of the newly prepared payload', async () => {
  for (const change of originalChanges) for (const reapproved of [false, true]) {
    const pool = fakePool([claimRow({ ...originalMetadata })]);
    const graph = graphFetch([
      () => {
        Object.assign(pool.state.current, change);
        if (reapproved) pool.state.current.content_hash = pool.state.current.approved_content_hash = draftContentHash(pool.state.current);
        return Response.json({ id: 'child-1' });
      },
      { id: 'child-2' }, { id: 'parent-1' }, { status_code: 'FINISHED' },
    ]);
    const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl: graph.fetchImpl }).runOnce();
    assert.equal(result.blocked, 1, JSON.stringify({ change, reapproved }));
    assert.equal(result.published, 0);
    assert.equal(graph.calls.some(({ url }) => url.endsWith('/media_publish')), false);
    assert.ok(pool.state.queries.includes('ROLLBACK'));
  }
});

test('Threads publishes the reviewed original caption verbatim without appending hashtags again', async () => {
  const reviewed = `${'x'.repeat(487)} #GapuraMedia`;
  assert.equal(reviewed.length, 500);
  const row = claimRow({ ...originalMetadata, platform: 'threads', account_id: '99', slides: [coverSlide()],
    caption: 'Long Instagram caption '.repeat(40), threads_caption: reviewed, hashtags: ['#GapuraMedia'] });
  const pool = fakePool([row]);
  const graph = graphFetch([{ id: 'threads-container' }, { status: 'FINISHED' }, { id: 'threads-post' }, { permalink: 'https://www.threads.net/@gapura/post/fixture' }]);
  const result = await createMetaPublisherWorker({ pool, config: threadsConfig(), fetchImpl: graph.fetchImpl }).runOnce();
  assert.equal(result.published, 1);
  assert.equal(graph.calls[0].body.get('text'), reviewed);
  assert.equal(pool.state.updates[0].captionHash, captionHash(reviewed));
});

test('original Instagram and Facebook captions already contain the reviewed hashtags', async () => {
  for (const platform of ['instagram', 'facebook']) {
    const row = claimRow({ ...originalMetadata, platform, caption: 'Penjelasan warga\n\n#GapuraMedia', hashtags: ['#GapuraMedia'],
      account_id: platform === 'instagram' ? baseEnv.META_INSTAGRAM_ACCOUNT_ID : baseEnv.META_PAGE_ID, slides: [coverSlide()] });
    const pool = fakePool([row]);
    const graph = graphFetch(platform === 'instagram'
      ? [{ id: 'container' }, { status_code: 'FINISHED' }, { id: 'media' }, { permalink: 'https://instagram.com/p/fixture' }]
      : [{ id: 'photo' }, { permalink_url: 'https://facebook.com/posts/fixture' }]);
    const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl: graph.fetchImpl }).runOnce();
    assert.equal(result.published, 1);
    const sent = graph.calls.find(({ body }) => body?.has('caption'));
    assert.equal(sent.body.get('caption'), row.caption);
  }
});

test('legacy Threads drafts retain caption-plus-hashtag fallback and its 500-character guard', async () => {
  for (const caption of ['Historical caption', 'x'.repeat(500)]) {
    const row = claimRow({ platform: 'threads', account_id: '99', slides: [coverSlide()], caption });
    const pool = fakePool([row]);
    const graph = graphFetch([{ id: 'container' }, { status: 'FINISHED' }, { id: 'post' }, {}]);
    const result = await createMetaPublisherWorker({ pool, config: threadsConfig(), fetchImpl: graph.fetchImpl }).runOnce();
    if (caption.length === 500) {
      assert.equal(result.failed, 1);
      assert.equal(graph.calls.length, 0);
    } else {
      assert.equal(result.published, 1);
      assert.equal(graph.calls[0].body.get('text'), `${caption}\n\n#gapura`);
    }
  }
});

test('R6 Threads requires a nonblank reviewed string of at most 500 characters in live and shadow mode', async () => {
  for (const mode of ['live', 'shadow']) for (const editorial_mode of ['explainer', 'current']) for (const threads_caption of [null, undefined, '', '  \n\t', false, 0, {}, [], 'x'.repeat(501)]) {
    const pool = fakePool([claimRow({ ...originalMetadata, platform: 'threads', account_id: '99', editorial_mode,
      caption: 'Short Instagram caption must never substitute for Threads', threads_caption })]);
    const graph = graphFetch([]);
    const result = await createMetaPublisherWorker({ pool, config: { ...threadsConfig(), mode }, fetchImpl: graph.fetchImpl, logger: { warn() {} } }).runOnce();
    assert.equal(result.blocked, 1, JSON.stringify({ mode, editorial_mode, threads_caption }));
    assert.equal(result.published, 0);
    assert.equal(result.shadow, 0);
    assert.equal(result.unknown, 0);
    assert.equal(graph.calls.length, 0);
    assert.equal(pool.state.updates[0].status, 'blocked');
    assert.match(pool.state.updates[0].error, /Caption Threads.*500/);
    assert.equal(pool.state.queries.some((q) => /^UPDATE publication_targets SET container_id/.test(q)), false);
    assert.equal(pool.state.audits.length, 0);
  }
});

test('historical metadata without an original marker cannot replace the Threads text covered by its legacy approval', async () => {
  const row = claimRow({ platform: 'threads', account_id: '99', slides: [coverSlide()], threads_caption: 'Annotation outside the legacy revision hash' });
  const pool = fakePool([row]);
  const graph = graphFetch([{ id: 'container' }, { status: 'FINISHED' }, { id: 'post' }, {}]);
  assert.equal((await createMetaPublisherWorker({ pool, config: threadsConfig(), fetchImpl: graph.fetchImpl }).runOnce()).published, 1);
  assert.equal(graph.calls[0].body.get('text'), 'Halo Gapura\n\n#gapura');
  assert.equal(pool.state.updates[0].captionHash, captionHash(row.caption));
});

test('shadow uses the same complete R6 revision as live publication, including curated facts and paragraph references', async () => {
  const current = {
    ...originalMetadata, editorial_mode: 'current',
    editorial_input: { version: 1, mode: 'current', facts: [{ id: 'f1', text: 'BPS mencatat inflasi 2,1%.', source_url: 'https://www.bps.go.id/fixture', source_name: 'BPS' }] },
    slides: [coverSlide({ teks: 'Inflasi 2,1% menurut BPS', claim_type: 'fact', fact_ids: ['f1'] })],
    editorial_references: { caption: [{ kind: 'fact', fact_ids: ['f1'] }], threads: ['f1'] },
  };
  for (const change of [null, ...originalChanges.map((change) => change.editorial_mode ? { editorial_mode: 'explainer' }
    : change.editorial_references ? { editorial_references: { caption: [], threads: ['f1'] } } : change),
    { editorial_input: { ...current.editorial_input, facts: [{ ...current.editorial_input.facts[0], text: 'Angka diubah setelah persetujuan' }] } },
    { slides: [{ ...current.slides[0], fact_ids: [] }] },
    { editorial_references: { caption: [{ kind: 'fact', fact_ids: [] }], threads: ['f1'] } },
    { editorial_references: { caption: [{ kind: 'fact', fact_ids: ['f1'] }], threads: [] } },
  ]) {
    const row = claimRow(current);
    if (change) Object.assign(row, change);
    const pool = fakePool([row]); const graph = graphFetch([]);
    const result = await createMetaPublisherWorker({ pool, config: publicationConfigFromEnv(baseEnv), fetchImpl: graph.fetchImpl }).runOnce();
    assert.equal(result[change ? 'blocked' : 'shadow'], 1, JSON.stringify(change));
    assert.equal(result.published, 0);
    assert.equal(graph.calls.length, 0);
    assert.equal(pool.state.updates[0].status, change ? 'blocked' : 'shadow');
  }
});

test('parseWorkerArgs parses --reset-shadow and --draft-id and rejects invalid values fail-closed', () => {
  assert.deepEqual(parseWorkerArgs([]), { resetShadow: false, draftId: null });
  assert.deepEqual(parseWorkerArgs(['--reset-shadow']), { resetShadow: true, draftId: null });
  assert.deepEqual(parseWorkerArgs(['--draft-id', '159']), { resetShadow: false, draftId: 159 });
  assert.deepEqual(parseWorkerArgs(['--draft-id=159', '--reset-shadow']), { resetShadow: true, draftId: 159 });
  for (const invalid of [
    ['--draft-id'],
    ['--draft-id', ''],
    ['--draft-id='],
    ['--draft-id', '0'],
    ['--draft-id', '-5'],
    ['--draft-id', 'abc'],
    ['--draft-id=159x'],
    ['--draft-id', '--reset-shadow'],
  ]) {
    assert.throws(() => parseWorkerArgs(invalid), /draft-id|draft_id/i, JSON.stringify(invalid));
  }
});

test('runOnce forwards draftId filter to resetShadow, syncTargets and CLAIM_NEXT and rejects invalid draftId before DB calls', async () => {
  const pool = fakePool([claimRow({ draft_id: 159 })]);
  const worker = createMetaPublisherWorker({ pool, config: publicationConfigFromEnv(baseEnv), fetchImpl: async () => { throw new Error('no calls'); } });
  const result = await worker.runOnce({ resetShadow: true, draftId: 159 });
  assert.equal(result.shadow, 1);

  const resetCall = pool.state.queryCalls.find(({ q }) => /UPDATE publication_targets SET status = 'pending'/i.test(q));
  assert.match(resetCall.q, /\(\$1::bigint IS NULL OR draft_id = \$1::bigint\)/);
  assert.deepEqual(resetCall.values, [159]);

  const syncCalls = pool.state.queryCalls.filter(({ q }) => /^INSERT INTO publication_targets/i.test(q));
  assert.equal(syncCalls.length, 2);
  for (const call of syncCalls) {
    assert.match(call.q, /\(\$3::bigint IS NULL OR d\.id = \$3::bigint\)/);
    assert.equal(call.values[2], 159);
  }

  const claimCalls = pool.state.queryCalls.filter(({ q }) => /^WITH candidate/i.test(q));
  assert.equal(claimCalls.length, 2);
  for (const call of claimCalls) {
    assert.match(call.q, /\(\$3::bigint IS NULL OR t\.draft_id = \$3::bigint\)/);
    assert.equal(call.values[2], 159);
  }

  const badPool = fakePool([]);
  const badWorker = createMetaPublisherWorker({ pool: badPool, config: publicationConfigFromEnv(baseEnv), fetchImpl: async () => { throw new Error('no calls'); } });
  await assert.rejects(() => badWorker.runOnce({ draftId: 'not-a-number' }), /draft_id/i);
  assert.equal(badPool.state.queryCalls.length, 0);
});

test('autopilotPublish flag is forwarded safely and dailyPublishLimit stops claiming additional drafts', async () => {
  const defaultConfig = publicationConfigFromEnv(baseEnv);
  assert.equal(defaultConfig.autopilotPublish, false);
  assert.equal(defaultConfig.dailyPublishLimit, 0);

  const autopilotConfig = publicationConfigFromEnv({
    ...baseEnv,
    META_PUBLISH_MODE: 'live',
    GAPURA_AUTOPILOT_PUBLISH: 'true',
    GAPURA_DAILY_PUBLISH_LIMIT: '6',
  });
  assert.equal(autopilotConfig.autopilotPublish, true);
  assert.equal(autopilotConfig.dailyPublishLimit, 6);

  const todayPublished = [{ draft_id: 11 }, { draft_id: 12 }, { draft_id: 13 }, { draft_id: 14 }, { draft_id: 15 }, { draft_id: 16 }];
  const limitQueries = [];
  const capPool = {
    async connect() {
      return {
        release() {},
        async query(sql, values = []) {
          const q = sql.replace(/\s+/g, ' ').trim();
          limitQueries.push({ q, values });
          if (/SELECT DISTINCT draft_id FROM publication_targets/i.test(q)) {
            return { rows: todayPublished, rowCount: todayPublished.length };
          }
          if (/^INSERT INTO publication_targets/i.test(q)) return { rows: [], rowCount: 0 };
          if (/^WITH candidate/i.test(q)) {
            assert.equal(values[3], true);
            assert.deepEqual(values[4], [11, 12, 13, 14, 15, 16]);
            return { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected SQL: ${q}`);
        },
      };
    },
  };
  const result = await createMetaPublisherWorker({ pool: capPool, config: autopilotConfig, fetchImpl: async () => { throw new Error('no calls'); } }).runOnce();
  assert.equal(result.daily_limit_reached, true);
  assert.equal(result.published, 0);
  assert.ok(limitQueries.some(({ q }) => /^WITH candidate/i.test(q)));
});
