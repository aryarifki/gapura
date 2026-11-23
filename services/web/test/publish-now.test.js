import test from 'node:test';
import assert from 'node:assert/strict';
import { publishDraftNow } from '../publish-now.js';
import { draftContentHash } from '../../common/draft-revision.js';

const baseDraft = {
  id: 301,
  topic_id: 901,
  status: 'draft',
  needs_review: true,
  copy_model: 'staged-editorial-v3',
  content_format: 'carousel',
  caption: 'IHSG menguat pada penutupan perdagangan.\n\n#GapuraMedia',
  hashtags: ['#GapuraMedia'],
  slides: [{ no: 1, role: 'cover', layout: 'editorial-cover', teks: '', data: { title: 'IHSG Menguat', kicker: 'Bursa', cover_mode: 'typography' } }],
  editorial_input: { version: 1, mode: 'current', facts: [] },
  editorial_mode: 'current',
  caption_body: 'IHSG menguat pada penutupan perdagangan.',
  threads_caption: 'IHSG menguat #GapuraMedia',
  angle: 'Pergerakan bursa',
  scope_note: 'Data perdagangan harian',
  editorial_references: { caption: [], threads: [] },
  article_body: 'A'.repeat(1300),
  article_references: [{ url: 'https://a.example' }, { url: 'https://b.example' }, { url: 'https://c.example' }],
  article_facts: [],
  article_metadata: { pipeline: { status: 'VALIDATED' } },
  source_url: 'https://www.idxchannel.com/market-news/fixture',
  analyst_verdict: 'passed',
  updated_at: '2026-11-23T10:00:00.000Z',
};

const activeEnv = {
  META_PLATFORMS: 'instagram,facebook',
  META_PAGE_ACCESS_TOKEN: 'page-token',
  META_PAGE_ID: '102321216076547',
  META_INSTAGRAM_ACCOUNT_ID: '17841471438781611',
  META_INSTAGRAM_ACCESS_TOKEN: 'ig-token',
  GAPURA_ADMIN_TOKEN: 'x'.repeat(64),
};

test('publishDraftNow fails with 503 when no Meta platform is active', async () => {
  const pool = { connect() { throw new Error('Should not open DB connection without active Meta platform'); } };
  const res = await publishDraftNow({ pool, draftId: 301, env: { META_PLATFORMS: '' } });
  assert.equal(res.httpStatus, 503);
});

test('publishDraftNow rejects stale revision, unchecked review, and uncertain publication targets', async () => {
  const revision = draftContentHash(baseDraft);
  const makePool = (draftOverride = {}, targets = []) => ({
    async connect() {
      return {
        release() {},
        async query(sql) {
          const q = sql.replace(/\s+/g, ' ').trim();
          if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [] };
          if (q.includes('FROM drafts d JOIN topics t')) return { rows: [{ ...baseDraft, ...draftOverride }] };
          if (q.includes('FROM publication_targets WHERE draft_id = $1')) return { rows: targets };
          throw new Error(`Unexpected SQL: ${q}`);
        },
      };
    },
  });

  const stale = await publishDraftNow({
    pool: makePool(),
    draftId: 301,
    body: { reviewed: true, expected_revision: 'stale-hash' },
    env: activeEnv,
  });
  assert.equal(stale.httpStatus, 409);

  const unchecked = await publishDraftNow({
    pool: makePool(),
    draftId: 301,
    body: { reviewed: false, expected_revision: revision },
    env: activeEnv,
  });
  assert.equal(unchecked.httpStatus, 409);

  const uncertain = await publishDraftNow({
    pool: makePool({}, [{ id: 1, status: 'unknown' }]),
    draftId: 301,
    body: { reviewed: true, expected_revision: revision },
    env: activeEnv,
  });
  assert.equal(uncertain.httpStatus, 409);
});

test('publishDraftNow promotes a reviewed draft and triggers scoped cross-platform worker', async () => {
  const revision = draftContentHash(baseDraft);
  let workerArgs = null;
  let committed = false;
  const targetsAfter = [
    { id: 10, platform: 'instagram', account_id: '17841471438781611', status: 'published', remote_id: 'ig-1', container_id: 'c-1', permalink: 'https://instagram.com/p/1', error_message: null, attempts: 1, published_at: '2026-11-23T12:00:00Z' },
    { id: 11, platform: 'facebook', account_id: '102321216076547', status: 'published', remote_id: 'fb-1', container_id: null, permalink: 'https://facebook.com/posts/1', error_message: null, attempts: 1, published_at: '2026-11-23T12:00:05Z' },
  ];
  const pool = {
    async connect() {
      return {
        release() {},
        async query(sql) {
          const q = sql.replace(/\s+/g, ' ').trim();
          if (q === 'BEGIN' || q === 'ROLLBACK') return { rows: [] };
          if (q === 'COMMIT') { committed = true; return { rows: [] }; }
          if (q.includes('FROM drafts d JOIN topics t')) return { rows: [{ ...baseDraft }] };
          if (q.includes('FROM publication_targets WHERE draft_id = $1')) return { rows: [] };
          if (q.startsWith("UPDATE drafts SET status = 'scheduled'")) return { rowCount: 1 };
          if (q.startsWith('INSERT INTO scheduled_posts')) return { rowCount: 1 };
          if (q.startsWith('INSERT INTO audit_log')) return { rowCount: 1 };
          throw new Error(`Unexpected SQL: ${q}`);
        },
      };
    },
    async query(sql) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.includes('FROM publication_targets WHERE draft_id = $1 ORDER BY')) return { rows: targetsAfter };
      if (q === 'SELECT status FROM drafts WHERE id = $1') return { rows: [{ status: 'published' }] };
      throw new Error(`Unexpected Pool SQL: ${q}`);
    },
  };

  const res = await publishDraftNow({
    pool,
    draftId: 301,
    body: { reviewed: true, expected_revision: revision },
    env: activeEnv,
    createWorker: ({ config }) => ({
      async runOnce(args) {
        assert.equal(config.mode, 'live');
        workerArgs = args;
        return { inserted: 2, shadow: 0, published: 2, failed: 0, blocked: 0, unknown: 0, retried: 0, reset: 0 };
      },
    }),
  });

  assert.equal(committed, true);
  assert.deepEqual(workerArgs, { draftId: 301, resetShadow: true });
  assert.equal(res.httpStatus, 200);
  assert.equal(res.body.status, 'published');
  assert.equal(res.body.targets.length, 2);
});

test('publishDraftNow retries transient platform errors automatically so partial publish finishes in one click', async () => {
  const revision = draftContentHash(baseDraft);
  const runCalls = [];
  const targetsAfter = [
    { id: 10, platform: 'instagram', account_id: '17841471438781611', status: 'published', remote_id: 'ig-retry-ok', container_id: 'c-2', permalink: 'https://instagram.com/p/retryok', error_message: null, attempts: 2, published_at: '2026-11-23T13:35:00Z' },
    { id: 11, platform: 'facebook', account_id: '102321216076547', status: 'published', remote_id: 'fb-ok', container_id: null, permalink: 'https://facebook.com/posts/ok', error_message: null, attempts: 1, published_at: '2026-11-23T13:34:50Z' },
  ];
  const pool = {
    async connect() {
      return {
        release() {},
        async query(sql) {
          const q = sql.replace(/\s+/g, ' ').trim();
          if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [] };
          if (q.includes('FROM drafts d JOIN topics t')) return { rows: [{ ...baseDraft }] };
          if (q.includes('FROM publication_targets WHERE draft_id = $1')) return { rows: [] };
          if (q.startsWith("UPDATE drafts SET status = 'scheduled'")) return { rowCount: 1 };
          if (q.startsWith('INSERT INTO scheduled_posts')) return { rowCount: 1 };
          if (q.startsWith('INSERT INTO audit_log')) return { rowCount: 1 };
          throw new Error(`Unexpected SQL: ${q}`);
        },
      };
    },
    async query(sql) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.includes('FROM publication_targets WHERE draft_id = $1 ORDER BY')) return { rows: targetsAfter };
      if (q === 'SELECT status FROM drafts WHERE id = $1') return { rows: [{ status: 'published' }] };
      throw new Error(`Unexpected Pool SQL: ${q}`);
    },
  };

  const res = await publishDraftNow({
    pool,
    draftId: 301,
    body: { reviewed: true, expected_revision: revision },
    env: activeEnv,
    retryDelayMs: 0,
    maxRetryPasses: 2,
    createWorker: () => ({
      async runOnce(args) {
        runCalls.push(args);
        if (runCalls.length === 1) {
          return { inserted: 2, shadow: 0, published: 1, failed: 0, blocked: 0, unknown: 0, retried: 1, reset: 0 };
        }
        return { inserted: 0, shadow: 0, published: 1, failed: 0, blocked: 0, unknown: 0, retried: 0 };
      },
    }),
  });

  assert.deepEqual(runCalls, [
    { draftId: 301, resetShadow: true },
    { draftId: 301, resetShadow: false },
  ]);
  assert.equal(res.httpStatus, 200);
  assert.equal(res.body.status, 'published');
  assert.equal(res.body.summary.published, 2);
});
