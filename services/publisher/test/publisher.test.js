import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidSignedStorageRequest } from '../../common/storage-signature.js';
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
      published_at: null, manual_reminded_at: null, ...overrides.post },
    draft: { id: 7, topic_id: 3, status: 'scheduled', needs_review: false, caption: '<b>Caption & data</b>',
      slides: [{ no: 1 }], content_format: 'carousel', ...overrides.draft },
    reports: overrides.reports ?? [{ id: 3, status: 'verified', confidence: 92 }], audit: [],
    metaOwned: overrides.metaOwned ?? false,
  };
  let finalized = false;
  return {
    state,
    async connect() {
      let snapshot;
      return { release() {}, async query(sql, values = []) {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] }; }
        if (q === 'ROLLBACK') { Object.assign(state, snapshot); return { rows: [] }; }
        if (q === 'COMMIT') {
          if (overrides.commitFailure && finalized) throw new Error('commit outcome unknown');
          snapshot = undefined;
          return { rows: [] };
        }
        const latest = state.reports.at(-1) ?? null;
        const row = () => ({ ...state.post, caption: state.draft.caption, slides: state.draft.slides,
          content_format: state.draft.content_format, needs_review: state.draft.needs_review,
          draft_status: state.draft.status, topic_id: state.draft.topic_id,
          verification: latest, verification_status: latest?.status, verification_confidence: latest?.confidence });
        if (/^WITH /i.test(q) && /UPDATE scheduled_posts/i.test(q)) {
          assert.match(q, /LIMIT 1 FOR UPDATE OF sp, d SKIP LOCKED/);
          assert.match(q, /sp\.status = 'pending'/);
          assert.match(q, /ORDER BY vr\.created_at DESC NULLS LAST, vr\.id DESC LIMIT 1/);
          if (/publication_targets/.test(q) && state.metaOwned) return { rows: [] };
          if (state.post.status !== 'pending' || state.draft.status !== 'scheduled' || state.post.manual_reminded_at || values[0]?.includes(state.post.id)) return { rows: [] };
          state.post.status = 'publishing';
          return { rows: [row()], rowCount: 1 };
        }
        if (/^SELECT sp\.\*/.test(q)) {
          if (/FOR UPDATE/.test(q)) {
            assert.match(q, /ORDER BY vr\.created_at DESC NULLS LAST, vr\.id DESC LIMIT 1/);
            return { rows: [row()] };
          }
          const historicallyVerified = state.reports.some(r => ['verified', 'mostly_verified'].includes(r.status) && r.confidence >= 60);
          return { rows: state.post.status === 'pending' && historicallyVerified && !state.draft.needs_review ? [row()] : [] };
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

test('latest verification revocation blocks an older qualifying report', async t => {
  const db = database({ reports: [{ id: 1, status: 'verified', confidence: 98 }, { id: 2, status: 'hoax_detected', confidence: 99 }] });
  const calls = []; await service(t, db, metaSuccess(calls)).runPublisher();
  assert.equal(calls.length, 0);
  assert.notEqual(db.state.post.status, 'success');
});

test('automatic delivery requires verified confidence >=80 and needs_review exactly false', async t => {
  for (const overrides of [
    { reports: [{ status: 'mostly_verified', confidence: 90 }] },
    { reports: [{ status: 'verified', confidence: 79 }] },
    { reports: [{ status: 'verified', confidence: null }] },
    { reports: [{ status: 'verified', confidence: 'invalid' }] },
    { draft: { needs_review: true } }, { draft: { needs_review: null } }, { reports: [] },
  ]) {
    const db = database(overrides); const calls = [];
    await service(t, db, metaSuccess(calls)).runPublisher();
    assert.equal(calls.length, 0, JSON.stringify(overrides));
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

test('a newer verification or changed draft during container preparation blocks the final publish', async t => {
  for (const change of [
    state => state.reports.push({ id: 4, status: 'hoax_detected', confidence: 99 }),
    state => { state.draft.needs_review = true; },
    state => { state.draft.status = 'rejected'; },
    state => { state.draft.status = 'draft'; },
    state => { state.post.status = 'failed'; },
    state => { state.draft.caption = 'Changed after container creation'; },
    state => { state.draft.slides = [{ no: 1, title: 'Changed after rendering' }]; },
    state => { state.draft.content_format = 'single'; },
  ]) {
    const db = database(); const calls = []; const success = metaSuccess(calls);
    await service(t, db, async (url, options) => {
      if (options?.method === 'GET') change(db.state);
      return success(url, options);
    }).runPublisher();
    assert.equal(calls.filter(c => c.url.includes('/media_publish')).length, 0);
    assert.equal(db.state.post.published_at, null);
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
