import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidSignedStorageRequest } from '../../common/storage-signature.js';
import { draftContentHash } from '../../common/draft-revision.js';
import { createPublisher } from '../publisher.js';

const config = {
  baseUrl: 'https://gapura.example', igAccountId: 'fake-account', igAccessToken: 'fake-meta-token',
  telegramBotToken: 'fake-bot-token', telegramAdminChatId: '-10088', signingSecret: 'fake-signing-key',
  httpTimeoutMs: 20,
};
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function database(overrides = {}) {
  const state = {
    post: { id: 1, draft_id: 7, mode: 'auto', status: 'pending', ig_creation_id: null, ig_media_id: null,
      published_at: null, manual_reminded_at: null, scheduled_at: '2000-01-01T00:00:00.000Z', ...overrides.post },
    draft: { id: 7, topic_id: 3, status: 'scheduled', needs_review: false, caption: '<b>Caption & data</b>',
      slides: [{ no: 1 }], hashtags: ['#gapura'], content_format: 'carousel', updated_at: '2026-11-17T00:00:00Z',
      editorial_input: null, editorial_mode: null, caption_body: null, threads_caption: null, angle: null, scope_note: null, editorial_references: null, ...overrides.draft },
    audit: [], siblings: overrides.siblings ?? [],
    metaOwned: overrides.metaOwned ?? false,
  };
  state.approvals = overrides.approvals ?? [{ id: 1, entity: 'draft', entity_id: 7,
    action: state.post.mode === 'manual' ? 'approved_manual' : 'approved_auto', actor: 'web_admin',
    created_at: '2026-11-17T00:00:01Z', payload: { content_hash: draftContentHash(state.draft) } }];
  const queries = [];
  let finalized = false;
  return {
    state, queries,
    async connect() {
      let snapshot;
      return { release() {}, async query(sql, values = []) {
        const q = sql.replace(/\s+/g, ' ').trim();
        queries.push(q);
        if (q === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] }; }
        if (q === 'ROLLBACK') { Object.assign(state, snapshot); return { rows: [] }; }
        if (q === 'COMMIT') {
          if (overrides.commitFailure && finalized) throw new Error('commit outcome unknown');
          snapshot = undefined;
          return { rows: [] };
        }
        const row = () => {
          const approvals = state.approvals.filter(a => a.entity === 'draft' && a.entity_id === state.draft.id &&
            a.action === (state.post.mode === 'manual' ? 'approved_manual' : 'approved_auto') &&
            (a.actor === 'web_admin' || /^telegram:[0-9]+$/.test(a.actor)) && Date.parse(a.created_at) >= Date.parse(state.draft.updated_at))
            .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
          // Project approval evidence only when the production SQL requests it.
          // Otherwise a complete mock row could conceal a missing proof query.
          return { ...state.post, caption: state.draft.caption, slides: structuredClone(state.draft.slides),
            content_format: state.draft.content_format, needs_review: state.draft.needs_review,
            draft_status: state.draft.status,
            ...(/d\.hashtags\b/.test(q) ? { hashtags: structuredClone(state.draft.hashtags) } : {}),
            ...Object.fromEntries(['editorial_input', 'editorial_mode', 'caption_body', 'threads_caption', 'angle', 'scope_note', 'editorial_references', 'article_body', 'article_references', 'article_facts']
              .filter((field) => new RegExp(`d\\.${field}\\b`).test(q))
              .map((field) => [field, structuredClone(state.draft[field])])),
            ...(/AS human_approved/i.test(q) ? { human_approved: approvals.length > 0 } : {}),
            ...(/AS approved_content_hash/i.test(q) ? { approved_content_hash: approvals.at(-1)?.payload?.content_hash ?? null } : {}),
          };
        };
        if (/^WITH /i.test(q) && /UPDATE scheduled_posts/i.test(q)) {
          assert.match(q, /LIMIT 1 FOR UPDATE OF sp, d SKIP LOCKED/);
          assert.match(q, /sp\.status = 'pending'/);
          assert.match(q, /sp\.scheduled_at <= NOW\(\)/);
          assert.match(q, /d\.status = 'scheduled'/);
          assert.match(q, /sp\.manual_reminded_at IS NULL/);
          assert.match(q, /NOT EXISTS \(SELECT 1 FROM publication_targets target WHERE target\.draft_id = sp\.draft_id\)/);
          assert.match(q, /active\.status IN \('publishing', 'success'\)/);
          assert.match(q, /active\.ig_media_id IS NOT NULL OR active\.published_at IS NOT NULL/);
          if (state.metaOwned || state.siblings.some(post => post.draft_id === state.post.draft_id && post.id !== state.post.id &&
            (['publishing', 'success'].includes(post.status) || post.ig_media_id != null || post.published_at != null))) return { rows: [] };
          if (state.post.status !== 'pending' || state.draft.status !== 'scheduled' || state.post.manual_reminded_at ||
            Date.parse(state.post.scheduled_at) > Date.now() || values[0]?.includes(state.post.id)) return { rows: [] };
          state.post.status = 'publishing';
          return { rows: [row()], rowCount: 1 };
        }
        if (/^SELECT sp\.\*/.test(q)) {
          assert.match(q, /WHERE sp\.id = \$1 FOR UPDATE OF sp, d/);
          return { rows: [row()] };
        }
        if (/UPDATE scheduled_posts/.test(q)) {
          if (/ig_post_id/.test(q)) throw new Error('column "ig_post_id" does not exist');
          if (/AND status = 'publishing'/.test(q) && state.post.status !== 'publishing') return { rows: [], rowCount: 0 };
          const status = /SET status = '(\w+)'/.exec(q)?.[1];
          if (status) state.post.status = status;
          if (/ig_creation_id = \$1/.test(q)) state.post.ig_creation_id = values[0];
          if (/ig_media_id = \$1/.test(q)) state.post.ig_media_id = values[0];
          if (/published_at = NOW\(\)/.test(q)) { state.post.published_at = 'now'; finalized = true; }
          if (/manual_reminded_at = NOW\(\)/.test(q)) state.post.manual_reminded_at = 'now';
          if (/error_message = \$1/.test(q)) state.post.error_message = values[0];
          return { rows: [{ id: state.post.id }], rowCount: 1 };
        }
        if (/UPDATE drafts/.test(q)) {
          state.draft.status = /status = '(\w+)'/.exec(q)[1];
          return { rows: [{ id: state.draft.id }], rowCount: 1 };
        }
        if (/INSERT INTO audit_log/.test(q)) {
          state.audit.push({ values, sql: q });
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected mock query: ${q}`);
      } };
    },
  };
}

function service(t, db, fetchImpl, configOverrides = {}) {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Only injected HTTP is allowed in tests'); });
  t.after(() => assert.doesNotMatch(db.queries.join('\n'), /verification_reports|verification_status|verification_confidence/i));
  const deps = { pool: db, fetchImpl, config: { ...config, ...configOverrides }, sleep: async () => {}, logger: { log() {}, warn() {}, error() {} } };
  return createPublisher(deps);
}

function metaSuccess(calls) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/media_publish')) return json({ id: 'ig-post-123' });
    if (options?.method === 'GET') return json({ status_code: 'FINISHED' });
    return json({ id: `container-${calls.length}` });
  };
}

test('two workers claim the same scheduled post at most once', async t => {
  const db = database(); const calls = [];
  const publisher = service(t, db, metaSuccess(calls));
  await Promise.all([publisher.runPublisher(), publisher.runPublisher()]);
  assert.equal(calls.filter(c => c.url.includes('/media_publish')).length, 1);
  assert.equal(db.state.post.status, 'success');
  assert.equal(db.state.post.ig_media_id, 'ig-post-123');
  assert.equal(db.state.draft.status, 'published');
  assert.equal(db.state.audit.length, 1);
});

test('legacy publisher leaves Meta-owned drafts to the multi-platform worker', async t => {
  const db = database({ metaOwned: true });
  const calls = [];
  await service(t, db, metaSuccess(calls)).runPublisher();
  assert.equal(calls.length, 0);
  assert.equal(db.state.post.status, 'pending');
});

test('legacy runtime delegates completely when the Meta worker is configured', async t => {
  const db = database();
  const calls = [];
  await service(t, db, metaSuccess(calls), { metaWorkerEnabled: true }).runPublisher();
  assert.equal(calls.length, 0);
  assert.equal(db.state.post.status, 'pending');
});

test('delivery only claims due pending schedules whose draft is still scheduled', async t => {
  for (const overrides of [
    ...['draft', 'approved', 'rejected', 'published'].map(status => ({ draft: { status } })),
    ...['publishing', 'success', 'failed'].map(status => ({ post: { status } })),
    { post: { scheduled_at: '2999-01-01T00:00:00.000Z' } },
  ]) {
    const db = database(overrides); const calls = [];
    assert.deepEqual(await service(t, db, metaSuccess(calls)).runPublisher(), { published: 0, reminded: 0, blocked: 0, uncertain: 0 });
    assert.equal(calls.length, 0, JSON.stringify(overrides));
    assert.equal(db.state.audit.length, 0);
  }
});

test('automatic delivery requires human review cleared explicitly and a valid publish mode', async t => {
  for (const overrides of [
    ...[true, null, undefined, 0, 'false'].map(needs_review => ({ draft: { needs_review } })),
    { post: { mode: 'invalid' } },
  ]) {
    const db = database(overrides); const calls = [];
    const result = await service(t, db, metaSuccess(calls)).runPublisher();
    assert.equal(calls.length, 0, JSON.stringify(overrides));
    assert.equal(result.blocked, 1);
    assert.equal(db.state.post.status, 'failed');
    assert.equal(db.state.post.published_at, null);
    assert.equal(db.state.audit.length, 0);
  }
});

test('scheduled status alone cannot authorize automatic publication without human approval', async t => {
  const db = database({ approvals: [] }); const calls = [];
  const result = await service(t, db, metaSuccess(calls)).runPublisher();
  assert.equal(calls.length, 0);
  assert.equal(result.blocked, 1);
  assert.equal(db.state.post.published_at, null);
  assert.equal(db.state.draft.status, 'scheduled');
  assert.equal(db.state.audit.length, 0);
});

test('only the latest current-revision approval by an authorized human can authorize publication', async t => {
  for (const change of [
    state => { state.approvals[0].actor = 'publisher_engine'; },
    state => { state.approvals[0].actor = 'telegram:unknown'; },
    state => { state.approvals[0].action = 'approved_manual'; },
    state => { state.approvals[0].entity_id = 8; },
    state => { state.approvals[0].created_at = '2026-11-16T23:59:59Z'; },
    state => { state.approvals[0].payload = {}; },
    state => { state.approvals.push({ ...state.approvals[0], id: 2, payload: { content_hash: 'newer-stale-approval' } }); },
  ]) {
    const db = database(); const calls = [];
    change(db.state);
    const result = await service(t, db, metaSuccess(calls)).runPublisher();
    assert.equal(result.published, 0);
    assert.equal(result.blocked, 1);
    assert.equal(calls.length, 0);
    assert.equal(db.state.post.published_at, null);
    assert.equal(db.state.audit.length, 0);
  }
});

test('automatic publication rejects a stale approval after a revision changes', async t => {
  for (const change of [
    draft => { draft.caption = 'Caption revised after approval'; },
    draft => { draft.slides[0].title = 'Slide revised after approval'; },
    draft => { draft.hashtags = ['#revised']; },
    draft => { draft.content_format = 'single'; },
  ]) {
    const db = database(); const calls = [];
    change(db.state.draft);
    assert.notEqual(draftContentHash(db.state.draft), db.state.approvals[0].payload.content_hash);
    const result = await service(t, db, metaSuccess(calls)).runPublisher();
    assert.equal(calls.length, 0);
    assert.equal(result.blocked, 1);
    assert.equal(db.state.post.published_at, null);
    assert.equal(db.state.audit.length, 0);
  }
});

test('approval evidence is loaded for both the claim and locked pre-publication recheck', async t => {
  const db = database(); const calls = [];
  const result = await service(t, db, metaSuccess(calls)).runPublisher();
  assert.equal(result.published, 1);
  const reads = db.queries.filter(q => /^WITH /.test(q) || /^SELECT sp\.\*/.test(q));
  assert.ok(reads.some(q => /FOR UPDATE OF sp, d$/.test(q)));
  for (const q of reads) {
    assert.match(q, /d\.hashtags\b/);
    assert.match(q, /AS human_approved/i);
    assert.match(q, /AS approved_content_hash/i);
    assert.match(q, /FROM audit_log/);
    assert.match(q, /approved_auto/);
    assert.match(q, /created_at >= d\.updated_at/);
    assert.match(q, /web_admin/);
    assert.ok(q.includes('^telegram:[0-9]+$'));
    assert.match(q, /ORDER BY a\.created_at DESC,\s*a\.id DESC LIMIT 1/);
  }
});

test('another claimed or previously published schedule prevents duplicate delivery', async t => {
  for (const evidence of [
    { status: 'publishing' }, { status: 'success' },
    { status: 'failed', ig_media_id: 'existing-media' }, { status: 'failed', published_at: 'earlier' },
  ]) {
    const db = database({ siblings: [{ id: 2, draft_id: 7, ...evidence }] }); const calls = [];
    await service(t, db, metaSuccess(calls)).runPublisher();
    assert.equal(calls.length, 0, JSON.stringify(evidence));
    assert.equal(db.state.post.status, 'pending');
    assert.equal(db.state.audit.length, 0);
  }
});

test('a successful manual reminder remains scheduled until operator confirmation and sends once', async t => {
  const db = database({ post: { mode: 'manual' }, draft: { needs_review: true } }); const calls = [];
  const publisher = service(t, db, async (url, options) => { calls.push({ url, options }); return json({ ok: true, result: { message_id: 42 } }); });
  await publisher.runPublisher(); await publisher.runPublisher();
  assert.equal(calls.length, 1);
  assert.equal(db.state.draft.status, 'scheduled');
  assert.equal(db.state.post.status, 'pending');
  assert.equal(db.state.post.published_at, null);
  assert.equal(db.state.post.manual_reminded_at, 'now');
  const message = JSON.parse(calls[0].options.body);
  assert.ok(message.text.includes('&lt;b&gt;Caption &amp; data&lt;/b&gt;'));
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('Telegram HTTP success with ok:false does not record a reminder or publication', async t => {
  const db = database({ post: { mode: 'manual' } });
  await service(t, db, async () => json({ ok: false, error_code: 400 })).runPublisher();
  assert.equal(db.state.post.manual_reminded_at, null);
  assert.equal(db.state.post.published_at, null);
  assert.equal(db.state.draft.status, 'scheduled');
});

test('invalid Telegram reminder receipt cannot suppress future delivery', async t => {
  for (const messageId of [0, -1]) {
    const db = database({ post: { mode: 'manual' } });
    await service(t, db, async () => json({ ok: true, result: { message_id: messageId } })).runPublisher();
    assert.equal(db.state.post.manual_reminded_at, null);
    assert.equal(db.state.post.published_at, null);
  }
});

test('missing Meta credentials sends a single manual reminder without claiming publication', async t => {
  const db = database(); const calls = [];
  const bot = service(t, db, async (url, options) => { calls.push({ url, options }); return json({ ok: true, result: { message_id: 1 } }); }, { igAccessToken: '' });
  await bot.runPublisher(); await bot.runPublisher();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/sendMessage'));
  assert.equal(db.state.post.status, 'pending');
  assert.equal(db.state.post.published_at, null);
  assert.equal(db.state.draft.status, 'scheduled');
});

test('a publish timeout leaves an ambiguous post claimed and never automatically retries', async t => {
  const db = database(); const calls = [];
  const publisher = service(t, db, async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/media_publish')) throw new Error('network timeout');
    if (options?.method === 'GET') return json({ status_code: 'FINISHED' });
    return json({ id: 'creation-1' });
  });
  await publisher.runPublisher(); await publisher.runPublisher();
  assert.equal(db.state.post.status, 'publishing');
  assert.equal(db.state.post.ig_creation_id, 'creation-1');
  assert.equal(db.state.draft.status, 'scheduled');
  assert.equal(calls.filter(c => c.url.includes('/media_publish')).length, 1);
});

test('revoked human review or changed content and schedule during preparation blocks the final publish', async t => {
  for (const change of [
    state => { state.approvals = []; },
    state => { state.approvals[0].payload.content_hash = 'stale-hash'; },
    state => { state.draft.needs_review = true; },
    state => { state.draft.needs_review = null; },
    state => { state.draft.status = 'rejected'; },
    state => { state.draft.status = 'draft'; },
    state => { state.draft.status = 'approved'; },
    state => { state.draft.status = 'published'; },
    state => { state.post.status = 'failed'; },
    state => { state.post.mode = 'manual'; },
    state => { state.post.ig_media_id = 'existing-media'; },
    state => { state.post.published_at = 'earlier'; },
    state => { state.draft.caption = 'Changed after container creation'; },
    state => { state.draft.slides = [{ no: 1, title: 'Changed after rendering' }]; },
    state => { state.draft.hashtags = ['#changed']; },
    state => { state.draft.content_format = 'single'; },
  ]) {
    const db = database(); const calls = []; const success = metaSuccess(calls);
    const result = await service(t, db, async (url, options) => {
      if (options?.method === 'GET') change(db.state);
      return success(url, options);
    }).runPublisher();
    assert.equal(result.blocked, 1);
    assert.equal(calls.filter(c => c.url.includes('/media_publish')).length, 0);
    assert.notEqual(db.state.post.published_at, 'now');
    assert.equal(db.state.audit.length, 0);
  }
});

test('HTTP timeout signal actually aborts the remote publish and leaves a reconciliation hold', async t => {
  const db = database(); let aborted = false;
  const publisher = service(t, db, async (url, options) => {
    if (!String(url).includes('/media_publish')) return json(options.method === 'GET' ? { status_code: 'FINISHED' } : { id: 'creation-1' });
    return new Promise((resolve, reject) => {
      const watchdog = setTimeout(() => reject(new Error('Request was not bounded')), 1000);
      options.signal.addEventListener('abort', () => {
        aborted = true; clearTimeout(watchdog); reject(options.signal.reason);
      }, { once: true });
    });
  });
  await publisher.runPublisher();
  assert.equal(aborted, true);
  assert.equal(db.state.post.status, 'publishing');
});

test('missing Meta result id fails closed instead of recording published', async t => {
  const db = database(); const calls = [];
  const successfulFetch = metaSuccess(calls);
  await service(t, db, (url, options) => String(url).includes('/media_publish') ? json({}) : successfulFetch(url, options)).runPublisher();
  assert.equal(db.state.post.status, 'publishing');
  assert.equal(db.state.draft.status, 'scheduled');
});

test('previous creation/media evidence on a requeued post requires operator reconciliation', async t => {
  for (const post of [{ ig_creation_id: 'old-creation' }, { ig_media_id: 'old-media' }, { published_at: 'earlier' }]) {
    const db = database({ post }); const calls = [];
    await service(t, db, metaSuccess(calls)).runPublisher();
    assert.equal(calls.length, 0);
    assert.equal(db.state.post.status, 'publishing');
  }
});

test('single-image legacy drafts use signed media, readiness checks and no carousel container', async t => {
  const db = database(); const calls = [];
  await service(t, db, metaSuccess(calls)).runPublisher();
  const creates = calls.filter(c => c.url.endsWith('/media'));
  assert.equal(creates.length, 1);
  const form = creates[0].options.body;
  assert.equal(form.get('is_carousel_item'), null);
  assert.equal(form.get('caption'), db.state.draft.caption);
  const image = new URL(form.get('image_url'));
  assert.equal(image.pathname, '/media/drafts/7/slide_1.png');
  assert.equal(isValidSignedStorageRequest(image.pathname.replace('/media/', '/storage/'), image.searchParams.get('expires'), image.searchParams.get('signature'), config.signingSecret), true);
  assert.ok(calls.some(c => c.options.method === 'GET'));
  assert.ok(calls.every(c => c.options.signal instanceof AbortSignal));
  assert.ok(calls.every(c => !c.url.includes(config.igAccessToken)));
});

test('carousel uses child containers plus one parent before publishing', async t => {
  const db = database({ draft: { slides: [{ no: 1 }, { no: 2 }] } }); const calls = [];
  await service(t, db, metaSuccess(calls)).runPublisher();
  const creates = calls.filter(c => c.url.endsWith('/media'));
  assert.equal(creates.length, 3);
  assert.equal(creates[0].options.body.get('is_carousel_item'), 'true');
  assert.equal(creates[1].options.body.get('is_carousel_item'), 'true');
  assert.equal(creates[2].options.body.get('media_type'), 'CAROUSEL');
  assert.equal(creates[2].options.body.get('children'), 'container-1,container-2');
  assert.equal(db.state.post.ig_creation_id, 'container-3');
  assert.equal(db.state.post.ig_media_id, 'ig-post-123');
});

test('container readiness is bounded and invalid slide payload never contacts Meta', async t => {
  for (const slides of [[], null, '{bad-json']) {
    const db = database({ draft: { slides } }); const calls = [];
    await service(t, db, metaSuccess(calls)).runPublisher();
    assert.equal(calls.length, 0);
  }
  const db = database(); const calls = [];
  await service(t, db, async (url, options) => {
    calls.push({ url: String(url), options });
    return json(options?.method === 'GET' ? { status_code: 'IN_PROGRESS' } : { id: 'creation-1' });
  }).runPublisher();
  assert.equal(calls.filter(c => c.options.method === 'GET').length, 5);
  assert.equal(calls.filter(c => c.url.includes('/media_publish')).length, 0);
  assert.equal(db.state.post.status, 'failed');
});

test('local finalization failure after Meta success does not authorize an automatic retry', async t => {
  const db = database({ commitFailure: true }); const calls = [];
  await service(t, db, metaSuccess(calls)).runPublisher();
  assert.equal(calls.filter(c => c.url.includes('/media_publish')).length, 1);
  assert.equal(db.state.post.status, 'publishing');
  assert.equal(db.state.draft.status, 'scheduled');
});

const originalMetadata = {
  editorial_input: { version: 1, mode: 'explainer', facts: [] }, editorial_mode: 'explainer',
  caption_body: 'Penjelasan bagi warga', threads_caption: 'Ringkasan Threads #GapuraMedia',
  angle: 'Akses bagi warga', scope_note: 'Penjelasan mekanisme umum',
  editorial_references: { caption: [{ kind: 'context', fact_ids: [] }], threads: [] },
};
const originalChanges = [
  { editorial_mode: 'current' }, { editorial_input: { version: 1, mode: 'current', facts: [{ id: 'f1', text: 'Fakta redaksi' }] } },
  { caption_body: 'Isi diubah' }, { threads_caption: 'Threads diubah' }, { angle: 'Angle diubah' }, { scope_note: 'Cakupan diubah' },
  { editorial_references: { caption: [{ kind: 'fact', fact_ids: ['f1'] }], threads: ['f1'] } },
];

test('legacy publisher loads all original metadata during claim and locked publish without changing its delivery behavior', async t => {
  const db = database({ draft: originalMetadata }); const calls = [];
  const result = await service(t, db, metaSuccess(calls)).runPublisher();
  assert.equal(result.published, 1);
  const reads = db.queries.filter((q) => /^WITH |^SELECT sp\.\*/.test(q));
  assert.equal(reads.length, 3);
  for (const q of reads) for (const field of Object.keys(originalMetadata)) assert.match(q, new RegExp(`d\\.${field}\\b`));
});

test('legacy publisher blocks each original metadata change after approval before calling Meta', async t => {
  for (const change of originalChanges) {
    const db = database({ draft: originalMetadata }); const calls = [];
    Object.assign(db.state.draft, change);
    const result = await service(t, db, metaSuccess(calls)).runPublisher();
    assert.equal(result.blocked, 1, JSON.stringify(change));
    assert.equal(result.published, 0);
    assert.equal(calls.length, 0);
    assert.equal(db.state.audit.length, 0);
  }
});

test('legacy publisher cannot publish a prepared original revision after its metadata changes, even if reapproved', async t => {
  for (const change of originalChanges) for (const reapproved of [false, true]) {
    const db = database({ draft: originalMetadata }); const calls = [];
    const success = metaSuccess(calls);
    const result = await service(t, db, async (url, options) => {
      if (options?.method === 'GET') {
        Object.assign(db.state.draft, change);
        if (reapproved) db.state.approvals[0].payload.content_hash = draftContentHash(db.state.draft);
      }
      return success(url, options);
    }).runPublisher();
    assert.equal(result.blocked, 1, JSON.stringify({ change, reapproved }));
    assert.equal(result.published, 0);
    assert.equal(calls.some(({ url }) => url.includes('/media_publish')), false);
    assert.equal(db.state.audit.length, 0);
  }
});
