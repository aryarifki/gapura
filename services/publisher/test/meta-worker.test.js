import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captionHash, createMetaPublisherWorker, publicationConfigFromEnv } from '../meta-worker.js';
import { draftContentHash } from '../../common/draft-revision.js';

const configRoot = fs.mkdtempSync('/tmp/opencode/gapura-meta-worker-config-');
after(() => fs.rmSync(configRoot, { recursive: true, force: true }));

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

function claimRow(overrides = {}) {
  const row = {
    id: 1, draft_id: 7, schedule_id: 1, platform: 'instagram', account_id: '17841471438781611', status: 'publishing',
    attempts: 1, caption: 'Halo Gapura', slides: [{ no: 1 }, { no: 2 }], content_format: 'carousel',
    needs_review: false, draft_status: 'scheduled', human_approved: true, verification: { status: 'verified', confidence: 92 },
    source_url: 'https://www.bps.go.id/fixture', analyst_passed: true,
    ...overrides,
  };
  return { ...row, approved_content_hash: draftContentHash(row), content_hash: draftContentHash(row) };
}

function fakePool(rows, { inserted = 1, failPublishedOnce = false } = {}) {
  const queue = [...rows];
  const state = { updates: [], audits: [], shadowResets: 0, inserts: 0, current: structuredClone(rows[0]) };
  const client = {
    release() {},
    async query(sql, values = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q)) return { rows: [], rowCount: 0 };
      if (/^SELECT t\.\*/i.test(q)) return { rows: state.current ? [state.current] : [], rowCount: state.current ? 1 : 0 };
      if (/^UPDATE publication_targets SET container_id/i.test(q)) return { rowCount: 1 };
      if (/^UPDATE scheduled_posts sp SET status = 'success'/i.test(q)) return { rowCount: 1 };
      if (/^UPDATE drafts d SET status = 'published'/i.test(q)) return { rowCount: 1 };
      if (/^INSERT INTO publication_targets/i.test(q)) { state.inserts++; return { rows: [], rowCount: inserted }; }
      if (/UPDATE publication_targets SET status = 'pending', updated_at = NOW\(\) WHERE status = 'shadow'/i.test(q)) {
        state.shadowResets++; return { rows: [], rowCount: 2 };
      }
      if (/^WITH candidate/i.test(q)) {
        assert.match(q, /FOR UPDATE OF t SKIP LOCKED/);
        const next = queue.shift();
        return { rows: next ? [next] : [], rowCount: next ? 1 : 0 };
      }
      if (/^UPDATE publication_targets SET status = \$1/i.test(q)) {
        if (values[0] === 'published' && failPublishedOnce) {
          failPublishedOnce = false;
          throw new Error('injected persistence failure');
        }
        state.updates.push({
          id: values[7], status: values[0], remoteId: values[1], permalink: values[3],
          error: values[4], publishedAt: values[5], captionHash: values[6],
        });
        return { rowCount: 1 };
      }
      if (/^INSERT INTO audit_log/i.test(q)) { state.audits.push({ draftId: values[0], payload: JSON.parse(values[1]) }); return { rowCount: 1 }; }
      throw new Error(`Unexpected SQL: ${q.slice(0, 80)}`);
    },
  };
  return { state, async connect() { return client; } };
}

function graphFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, authorization: init.headers.Authorization });
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

test('the editorial gate blocks publishing before any Meta request', async () => {
  const pool = fakePool([claimRow({ needs_review: true })]);
  const { calls, fetchImpl } = graphFetch([]);
  const worker = createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl });
  const result = await worker.runOnce();
  assert.equal(result.blocked, 1);
  assert.equal(calls.length, 0);
  assert.equal(pool.state.updates[0].status, 'blocked');
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

test('an ambiguous media_publish failure becomes unknown and is never retried', async () => {
  const pool = fakePool([claimRow()]);
  const { fetchImpl } = graphFetch([
    { id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' },
    { status_code: 'FINISHED' },
    new Error('socket hang up'),
  ]);
  const worker = createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl });
  const result = await worker.runOnce();
  assert.equal(result.unknown, 1);
  assert.equal(pool.state.updates[0].status, 'unknown');
  assert.match(pool.state.updates[0].error, /rekonsiliasi manual/);
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

test('a revoked review during container preparation prevents media_publish', async () => {
  const pool = fakePool([claimRow()]);
  const { calls, fetchImpl } = graphFetch([
    () => { pool.state.current.needs_review = true; return Response.json({ id: 'child-1' }); },
    { id: 'child-2' }, { id: 'parent-1' }, { status_code: 'FINISHED' }, { id: 'must-not-publish' },
  ]);
  const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
  assert.equal(result.published, 0);
  assert.equal(calls.some(({ url }) => url.endsWith('/media_publish')), false);
  assert.equal(pool.state.updates.at(-1).status, 'blocked');
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

test('publication still requires a public source and the latest passed analyst result', async () => {
  for (const overrides of [{ analyst_passed: false }, { source_url: '' }, { source_url: 'http://127.0.0.1/article' }]) {
    const pool = fakePool([claimRow(overrides)]);
    const { calls, fetchImpl } = graphFetch([]);
    const result = await createMetaPublisherWorker({ pool, config: liveConfig(), fetchImpl }).runOnce();
    assert.equal(result.blocked, 1);
    assert.equal(calls.length, 0);
  }
});
