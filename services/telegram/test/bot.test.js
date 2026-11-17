import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBot } from '../bot.js';
import { draftContentHash } from '../../common/draft-revision.js';
const config = { botToken: 'fake-bot-token', adminChatId: '-10088', adminUserIds: ['42'], httpTimeoutMs: 20 };
const actor = { userId: '42', chatId: '-10088' };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function database(overrides = {}) {
  const state = {
    draft: { id: 7, topic_id: 3, status: 'draft', needs_review: false, telegram_dispatched_at: null,
      slides: [{ no: 1 }], title: '<i>Judul & berita</i>', primary_source: '<Sumber>', score_total: 90,
      reasoning: '<b>Alasan</b>', caption: 'Caption <data> & fakta', hashtags: ['#a&b'], ...overrides.draft },
    slides: overrides.slides ?? [{ render_path: '/mock/slide_1.png', slide_no: 1 }],
    schedules: structuredClone(overrides.schedules ?? []), audit: [], queries: [],
  };
  const queries = state.queries;
  let locked = false;
  const waiters = [];
  return { state, async connect() {
    let ownsLock = false; let snapshot;
    const unlock = () => { if (ownsLock) { ownsLock = false; locked = false; waiters.shift()?.(); } };
    return { release: unlock, async query(sql, values = []) {
      const q = sql.replace(/\s+/g, ' ').trim(); queries.push(q);
      if (q === 'BEGIN') return { rows: [] };
      if (q === 'ROLLBACK') { if (snapshot) Object.assign(state, snapshot, { queries }); unlock(); return { rows: [] }; }
      if (q === 'COMMIT') { snapshot = undefined; unlock(); return { rows: [] }; }
      if (/SELECT .*FROM drafts/.test(q) && /WHERE d?\.?id = \$1/.test(q)) {
        assert.match(q, /WHERE d\.id = \$1 FOR UPDATE OF d/);
        if (/JOIN topics/.test(q)) {
          assert.match(q, /FROM topic_scores WHERE topic_id = t\.id ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1/);
          assert.match(q, /SKIP LOCKED/);
        }
        if (/FOR UPDATE/.test(q)) {
          if (locked && /SKIP LOCKED/.test(q)) return { rows: [] };
          while (locked) await new Promise(resolve => waiters.push(resolve));
          locked = ownsLock = true;
          snapshot = structuredClone(state);
        }
        return { rows: values[0] === state.draft.id ? [{ ...state.draft }] : [] };
      }
      if (/FROM draft_slides/.test(q)) return { rows: state.slides };
      if (/SELECT .*FROM scheduled_posts/.test(q)) {
        assert.match(q, /status IN \('pending', 'publishing', 'success'\)/);
        assert.match(q, /ig_creation_id IS NOT NULL OR ig_media_id IS NOT NULL OR published_at IS NOT NULL/);
        return { rows: state.schedules.filter(s => ['pending', 'publishing', 'success'].includes(s.status) ||
          s.ig_creation_id != null || s.ig_media_id != null || s.published_at != null) };
      }
      if (/INSERT INTO scheduled_posts/.test(q)) {
        assert.match(q, /VALUES \(\$1, 'auto', \$2, 'pending'\)/);
        const row = { id: state.schedules.length + 1, draft_id: values[0], mode: 'auto', status: 'pending' };
        state.schedules.push(row); return { rows: [row], rowCount: 1 };
      }
      if (/UPDATE drafts/.test(q)) {
        if (/telegram_dispatched_at = NOW\(\)/.test(q)) state.draft.telegram_dispatched_at = 'now';
        const status = /status = '(\w+)'/.exec(q)?.[1];
        if (status && !/SET telegram_dispatched_at/.test(q)) {
          assert.match(q, /WHERE id = \$1 AND status = 'draft' RETURNING id/);
          state.draft.status = status;
        }
        return { rows: [{ id: state.draft.id }], rowCount: 1 };
      }
      if (/INSERT INTO audit_log/.test(q)) {
        if (overrides.auditFailure) throw new Error('audit insert failed');
        state.audit.push(values); return { rows: [], rowCount: 1 };
      }
      if (/SELECT id FROM drafts/.test(q)) return { rows: state.draft.status === 'draft' && !state.draft.telegram_dispatched_at ? [{ id: state.draft.id }] : [] };
      throw new Error(`Unexpected mock query: ${q}`);
    } };
  } };
}

function service(t, db, fetchImpl = async () => { throw new Error('Unexpected outbound request'); }, configOverrides = {}) {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Only injected HTTP is allowed in tests'); });
  t.after(() => assert.doesNotMatch(db.state.queries.join('\n'), /verification_reports|verification_status|verification_confidence/i));
  const deps = { pool: db, fetchImpl, config: { ...config, ...configOverrides },
    fsImpl: { existsSync: () => true, readFileSync: () => Buffer.from('mock-png') }, logger: { log() {}, warn() {}, error() {} } };
  return createTelegramBot(deps);
}

const callback = (overrides = {}) => ({ id: 'cb-1', from: { id: 42, is_bot: false },
  message: { chat: { id: -10088 } }, data: 'approve_auto:7', ...overrides });

test('approval fails closed without an authorized user AND matching delivery chat', async t => {
  for (const [context, settings] of [
    [actor, { adminUserIds: [] }], [actor, { adminChatId: '' }],
    [{ userId: '-10088', chatId: '-10088' }, {}], [{ userId: '99', chatId: '-10088' }, {}],
    [{ userId: '42', chatId: '-90000' }, {}], ['admin', {}],
  ]) {
    const db = database(); const bot = service(t, db, undefined, settings);
    const result = await bot.handleApprovalAction('approve_auto', 7, context);
    assert.equal(result.allowed, false);
    assert.equal(db.state.queries.length, 0);
    assert.equal(db.state.draft.status, 'draft');
  }
});

test('auto approval requires human review cleared explicitly and cannot acknowledge it from Telegram', async t => {
  for (const needs_review of [true, null, undefined, 0, 'false']) {
    const db = database({ draft: { needs_review } }); const result = await service(t, db).handleApprovalAction('approve_auto', 7, actor);
    assert.equal(result.allowed, false, String(needs_review));
    assert.equal(result.reason, 'human_review_required');
    assert.equal(db.state.draft.needs_review, needs_review);
    assert.equal(db.state.draft.status, 'draft');
    assert.equal(db.state.schedules.length, 0);
    assert.equal(db.state.audit.length, 0);
  }
});

test('an explicit operator approval records the current revision without reading verification archives', async t => {
  for (const action of ['approve_auto', 'approve_manual']) {
    const db = database(); const oldHash = draftContentHash(db.state.draft);
    db.state.draft.caption = 'Revisi caption oleh redaktur';
    db.state.draft.hashtags = ['#revisi'];
    const currentHash = draftContentHash(db.state.draft);
    const result = await service(t, db).handleApprovalAction(action, 7, actor);
    assert.equal(result.allowed, true);
    assert.equal(result.status, action === 'approve_auto' ? 'scheduled' : 'approved');
    assert.notEqual(oldHash, currentHash);
    assert.equal(db.state.audit.length, 1);
    assert.deepEqual(db.state.audit[0].slice(0, 3), [7, action === 'approve_auto' ? 'approved_auto' : 'approved_manual', 'telegram:42']);
    assert.equal(JSON.parse(db.state.audit[0][3]).content_hash, currentHash);
    assert.equal(db.state.schedules.length, action === 'approve_auto' ? 1 : 0);
  }
});

test('active schedules and previous publication evidence require reconciliation before any new decision', async t => {
  for (const action of ['approve_auto', 'approve_manual', 'reject']) {
    for (const evidence of [
      { status: 'pending' }, { status: 'publishing' }, { status: 'success' },
      { status: 'failed', ig_creation_id: 'old-container' }, { status: 'failed', ig_media_id: 'old-media' },
      { status: 'failed', published_at: 'earlier' },
    ]) {
      const db = database({ schedules: [{ id: 1, draft_id: 7, ...evidence }] });
      const result = await service(t, db).handleApprovalAction(action, 7, actor);
      assert.equal(result.allowed, false);
      assert.equal(result.reason, 'existing_schedule_requires_review');
      assert.equal(db.state.draft.status, 'draft');
      assert.equal(db.state.schedules.length, 1);
      assert.equal(db.state.audit.length, 0);
    }
  }
});

test('concurrent duplicate approval creates one schedule and one audit record', async t => {
  const db = database(); const bot = service(t, db);
  const results = await Promise.all([
    bot.handleApprovalAction('approve_auto', 7, actor), bot.handleApprovalAction('approve_auto', 7, actor),
  ]);
  assert.equal(results.filter(r => r.allowed).length, 1);
  assert.equal(db.state.draft.status, 'scheduled');
  assert.equal(db.state.schedules.length, 1);
  assert.equal(db.state.audit.length, 1);
});

test('audit failure rolls back approval and scheduling together', async t => {
  const db = database({ auditFailure: true });
  await assert.rejects(service(t, db).handleApprovalAction('approve_auto', 7, actor), /audit/);
  assert.equal(db.state.draft.status, 'draft');
  assert.equal(db.state.schedules.length, 0);
});

test('manual approval preserves the review flag and requires operator confirmation after posting', async t => {
  const db = database({ draft: { needs_review: true } });
  const bot = service(t, db); const result = await bot.handleApprovalAction('approve_manual', 7, actor);
  assert.equal(result.status, 'approved');
  assert.equal(db.state.draft.status, 'approved');
  assert.equal(db.state.draft.needs_review, true);
  assert.equal(db.state.schedules.length, 0);
  assert.equal(db.state.audit[0][1], 'approved_manual');
  assert.equal(JSON.parse(db.state.audit[0][3]).content_hash, draftContentHash(db.state.draft));
  assert.equal((await bot.handleApprovalAction('approve_manual', 7, actor)).allowed, false);
});

test('approved, scheduled and terminal drafts cannot receive another Telegram decision', async t => {
  for (const status of ['approved', 'scheduled', 'rejected', 'published']) {
    for (const action of ['approve_auto', 'approve_manual', 'reject']) {
      const db = database({ draft: { status } });
      assert.deepEqual(await service(t, db).handleApprovalAction(action, 7, actor), { allowed: false, reason: 'draft_not_reviewable' });
      assert.equal(db.state.draft.status, status);
      assert.equal(db.state.schedules.length, 0);
      assert.equal(db.state.audit.length, 0);
    }
  }
});

test('callback parser rejects bot actors, foreign chats and malformed draft ids without DB or HTTP', async t => {
  const db = database(); const bot = service(t, db);
  for (const cb of [callback({ from: { id: 42, is_bot: true } }), callback({ message: { chat: { id: -999 } } }),
    callback({ from: { id: 99 } }), callback({ data: 'approve_auto:7junk' }), callback({ data: 'approve_auto:7:extra' }),
    callback({ data: 'approve_auto:9007199254740992' }), callback({ message: undefined })]) {
    assert.equal((await bot.processCallbackQuery(cb)).allowed, false);
  }
  assert.equal(db.state.queries.length, 0);
});

test('authorized group callback schedules once and replies to the group with bounded requests', async t => {
  const db = database(); const calls = [];
  const contentHash = draftContentHash(db.state.draft);
  const bot = service(t, db, async (url, options) => { calls.push({ url, options }); return json({ ok: true, result: { message_id: 33 } }); });
  assert.equal((await bot.processCallbackQuery(callback())).allowed, true);
  assert.equal(db.state.schedules.length, 1);
  assert.equal(db.state.audit.length, 1);
  assert.deepEqual(db.state.audit[0].slice(0, 3), [7, 'approved_auto', 'telegram:42']);
  const payload = JSON.parse(db.state.audit[0][3]);
  assert.equal(payload.content_hash, contentHash);
  assert.equal(payload.chat_id, '-10088');
  assert.ok(Number.isFinite(Date.parse(payload.scheduled_at)));
  const replies = calls.filter(c => c.url.endsWith('/sendMessage'));
  assert.equal(JSON.parse(replies[0].options.body).chat_id, '-10088');
  assert.ok(calls.every(c => c.options.signal instanceof AbortSignal));
});

test('Telegram cannot acknowledge editorial review and directs the operator to the web editor', async t => {
  const db = database({ draft: { needs_review: true } }); const calls = [];
  const bot = service(t, db, async (url, options) => { calls.push({ url, options }); return json({ ok: true, result: { message_id: 33 } }); });
  const result = await bot.processCallbackQuery(callback());
  assert.equal(result.allowed, false);
  assert.equal(db.state.draft.needs_review, true);
  assert.equal(db.state.draft.status, 'draft');
  assert.equal(db.state.schedules.length, 0);
  const text = JSON.parse(calls.find(c => c.url.endsWith('/sendMessage')).options.body).text;
  assert.match(text, /editor.*web/i);
});

test('dispatch sends one photo via sendPhoto and writes dedup marker only after both deliveries', async t => {
  const db = database(); const calls = [];
  const bot = service(t, db, async (url, options) => {
    assert.equal(db.state.draft.telegram_dispatched_at, null);
    calls.push({ url, options }); return json({ ok: true, result: { message_id: calls.length } });
  });
  assert.equal(await bot.dispatchDraftToTelegram(7), true);
  assert.equal(await bot.dispatchDraftToTelegram(7), true);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/sendPhoto'));
  assert.equal(calls[0].options.body.get('photo').name, 'slide_1.png');
  assert.equal(db.state.draft.telegram_dispatched_at, 'now');
  const message = JSON.parse(calls[1].options.body);
  assert.ok(message.text.includes('&lt;i&gt;Judul &amp; berita&lt;/i&gt;'));
  assert.ok(message.text.includes('Caption &lt;data&gt; &amp; fakta'));
  assert.ok(message.text.includes('<b>Skor Analis:</b> 90/100'));
  assert.ok(message.text.includes('&lt;b&gt;Alasan&lt;/b&gt;'));
  assert.doesNotMatch(message.text, /verifik|confidence|hoax/i);
  assert.deepEqual(message.reply_markup.inline_keyboard.flat().map(button => button.callback_data),
    ['approve_auto:7', 'approve_manual:7', 'reject:7']);
  assert.ok(calls.every(c => c.options.signal instanceof AbortSignal));
});

test('concurrent dispatch sends a single review package', async t => {
  const db = database(); const calls = [];
  const bot = service(t, db, async (url, options) => { calls.push({ url, options }); return json({ ok: true, result: { message_id: calls.length } }); });
  await Promise.all([bot.dispatchDraftToTelegram(7), bot.dispatchDraftToTelegram(7)]);
  assert.equal(calls.length, 2);
  assert.equal(db.state.draft.telegram_dispatched_at, 'now');
});

test('two photos form one media group with a message receipt per photo', async t => {
  const db = database({ draft: { slides: [{ no: 1 }, { no: 2 }] }, slides: [
    { render_path: '/mock/slide_1.png', slide_no: 1 }, { render_path: '/mock/slide_2.png', slide_no: 2 },
  ] }); const calls = [];
  const bot = service(t, db, async (url, options) => {
    calls.push({ url, options }); return json({ ok: true, result: url.endsWith('/sendMediaGroup') ? [{ message_id: 1 }, { message_id: 2 }] : { message_id: 3 } });
  });
  assert.equal(await bot.dispatchDraftToTelegram(7), true);
  assert.ok(calls[0].url.endsWith('/sendMediaGroup'));
  assert.equal(JSON.parse(calls[0].options.body.get('media')).length, 2);
});

test('failed media/message responses never record delivery and may be retried', async t => {
  for (const failure of ['http', 'api', 'receipt', 'description']) {
    const db = database(); let requests = 0;
    const bot = service(t, db, async () => {
      requests++;
      if (failure === 'http') return json({ ok: true, result: { message_id: 1 } }, 500);
      if (failure === 'api') return json({ ok: false, description: 'rejected' });
      if (failure === 'receipt') return json({ ok: true, result: {} });
      return requests === 1 ? json({ ok: true, result: { message_id: 1 } }) : json({ ok: false });
    });
    assert.equal(await bot.dispatchDraftToTelegram(7), false, failure);
    assert.equal(db.state.draft.telegram_dispatched_at, null);
    assert.equal(db.state.audit.length, 0);
    assert.equal(requests, failure === 'description' ? 2 : 1);
  }
});

test('invalid Telegram message ids do not count as delivered review packages', async t => {
  for (const messageId of [0, -1]) {
    const db = database();
    const bot = service(t, db, async () => json({ ok: true, result: { message_id: messageId } }));
    assert.equal(await bot.dispatchDraftToTelegram(7), false);
    assert.equal(db.state.draft.telegram_dispatched_at, null);
  }
});

test('dispatch retries after an API failure, and pending dispatcher skips acknowledged drafts', async t => {
  const db = database(); let requests = 0;
  const bot = service(t, db, async () => {
    requests++;
    return json(requests === 1 ? { ok: false } : { ok: true, result: { message_id: requests } });
  });
  assert.equal(await bot.dispatchPendingDrafts(), 0);
  assert.equal(db.state.draft.telegram_dispatched_at, null);
  assert.equal(await bot.dispatchPendingDrafts(), 1);
  assert.equal(await bot.dispatchPendingDrafts(), 0);
  assert.equal(requests, 3);
});

test('polling is sequential, advances offset after handling, and requires an actor allowlist', async t => {
  const db = database(); const calls = []; const controller = new AbortController();
  const bot = service(t, db, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/getUpdates')) {
      const body = JSON.parse(options.body);
      if (body.offset === 0) return json({ ok: true, result: [{ update_id: 10, callback_query: callback() }] });
      assert.equal(body.offset, 11);
      controller.abort();
      return json({ ok: true, result: [] });
    }
    return json({ ok: true, result: { message_id: calls.length } });
  });
  await bot.startBotPolling({ signal: controller.signal });
  assert.equal(db.state.schedules.length, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/getUpdates')).length, 2);
  assert.ok(calls.every(c => c.options.signal instanceof AbortSignal));
  await service(t, database(), undefined, { adminUserIds: [] }).startBotPolling();
});

test('missing delivery config and incomplete slide assets fail without recording delivery', async t => {
  const db = database();
  assert.equal(await service(t, db, undefined, { botToken: '' }).dispatchDraftToTelegram(7), false);
  const missing = database({ slides: [] });
  assert.equal(await service(t, missing).dispatchDraftToTelegram(7), false);
  assert.equal(missing.state.draft.telegram_dispatched_at, null);
});
