// Telegram review delivery and operator-driven approval. Chat IDs identify the
// destination; a separate, explicit user allowlist authorizes callback actors.
import pkg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { validateDraftApproval } from '../common/editorial.js';
import { draftContentHash } from '../common/draft-revision.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function numericId(value, allowNegative = false) {
  const text = String(value ?? '');
  return (allowNegative ? /^-?[1-9]\d*$/ : /^[1-9]\d*$/).test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}

function deliveredMessage(message) {
  return Number.isSafeInteger(message?.message_id) && message.message_id > 0;
}

export function createTelegramBot({ pool, fetchImpl = globalThis.fetch, config = {}, fsImpl = fs, logger = console }) {
  const timeoutMs = Math.max(1, Math.min(Number(config.httpTimeoutMs) || 15000, 30000));
  const adminChatId = numericId(config.adminChatId, true);
  const adminUserIds = new Set((Array.isArray(config.adminUserIds) ? config.adminUserIds : []).map(id => numericId(id)).filter(Boolean));

  function authorized(actor) {
    return Boolean(adminChatId && actor && typeof actor === 'object' && actor.isBot !== true &&
      numericId(actor.chatId, true) === adminChatId && adminUserIds.has(numericId(actor.userId)));
  }

  async function request(method, body, { multipart = false, polling = false } = {}) {
    if (!config.botToken) return null;
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/${method}`, {
        method: 'POST', ...(multipart ? {} : { headers: { 'Content-Type': 'application/json' } }),
        body: multipart ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(polling ? Math.max(timeoutMs, 15000) : timeoutMs),
      });
      const data = await response.json();
      if (!response.ok || data?.ok !== true) return null;
      return data;
    } catch {
      logger.warn(`[Telegram] ${method} delivery failed.`);
      return null;
    }
  }

  async function sendMessage(chatId, text, replyMarkup) {
    const response = await request('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    return deliveredMessage(response?.result);
  }

  async function sendPhotos(chatId, imagePaths) {
    if (imagePaths.length < 1 || imagePaths.length > 10) return false;
    const body = new FormData();
    body.append('chat_id', chatId);
    if (imagePaths.length === 1) {
      body.append('photo', new Blob([fsImpl.readFileSync(imagePaths[0])]), path.basename(imagePaths[0]));
      const response = await request('sendPhoto', body, { multipart: true });
      return deliveredMessage(response?.result);
    }
    const media = imagePaths.map((imagePath, index) => {
      const name = `photo_${index}`;
      body.append(name, new Blob([fsImpl.readFileSync(imagePath)]), path.basename(imagePath));
      return { type: 'photo', media: `attach://${name}` };
    });
    body.append('media', JSON.stringify(media));
    const response = await request('sendMediaGroup', body, { multipart: true });
    return Array.isArray(response?.result) && response.result.length === imagePaths.length &&
      response.result.every(deliveredMessage);
  }

  async function handleApprovalAction(action, draftId, actor = null) {
    if (!authorized(actor)) return { allowed: false, reason: 'unauthorized_actor' };
    if (!['approve_auto', 'approve_manual', 'reject'].includes(action) || !numericId(draftId)) {
      return { allowed: false, reason: 'invalid_action' };
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT d.* FROM drafts d WHERE d.id = $1 FOR UPDATE OF d', [Number(draftId)],
      );
      const draft = rows[0];
      if (!draft || draft.status !== 'draft') {
        await client.query('ROLLBACK');
        return { allowed: false, reason: draft ? 'draft_not_reviewable' : 'draft_not_found' };
      }
      const { rows: active } = await client.query(
        `SELECT id FROM scheduled_posts WHERE draft_id = $1
         AND (status IN ('pending', 'publishing', 'success') OR ig_creation_id IS NOT NULL
              OR ig_media_id IS NOT NULL OR published_at IS NOT NULL) LIMIT 1`, [Number(draftId)],
      );
      if (active.length) {
        await client.query('ROLLBACK');
        return { allowed: false, reason: 'existing_schedule_requires_review' };
      }
      let status = 'rejected';
      let scheduledAt;
      if (action !== 'reject') {
        const mode = action === 'approve_auto' ? 'auto' : 'manual';
        const gate = validateDraftApproval({ status: draft.status, needsReview: draft.needs_review !== false,
          mode, acknowledgeReview: false });
        if (!gate.allowed) {
          await client.query('ROLLBACK');
          return { allowed: false, reason: gate.reason };
        }
        status = mode === 'auto' ? 'scheduled' : 'approved';
        if (mode === 'auto') {
          scheduledAt = new Date(Date.now() + 3 * 3600 * 1000);
          await client.query(
            `INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status)
             VALUES ($1, 'auto', $2, 'pending')`, [Number(draftId), scheduledAt],
          );
        }
      }
      // Status values are selected exclusively from the fixed transitions above.
      const update = await client.query(
        `UPDATE drafts SET status = '${status}', updated_at = NOW() WHERE id = $1 AND status = 'draft' RETURNING id`,
        [Number(draftId)],
      );
      if (update.rowCount !== 1) throw new Error('Draft changed during approval.');
      const auditAction = action === 'reject' ? 'rejected' : action === 'approve_auto' ? 'approved_auto' : 'approved_manual';
      await client.query(
        `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
         VALUES ('draft', $1, $2, $3, $4)`,
        [Number(draftId), auditAction, `telegram:${numericId(actor.userId)}`,
          JSON.stringify({ chat_id: adminChatId, ...(action !== 'reject' ? { content_hash: draftContentHash(draft) } : {}), ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) })],
      );
      await client.query('COMMIT');
      return { allowed: true, status, ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function processCallbackQuery(callback) {
    const actor = { userId: callback?.from?.id, chatId: callback?.message?.chat?.id, isBot: callback?.from?.is_bot };
    const parsed = /^(approve_auto|approve_manual|reject):([1-9]\d*)$/.exec(callback?.data ?? '');
    if (!authorized(actor) || !parsed || !numericId(parsed[2])) return { allowed: false, reason: 'invalid_or_unauthorized_callback' };
    const draftId = Number(parsed[2]);
    const result = await handleApprovalAction(parsed[1], draftId, actor);
    const text = result.allowed
      ? result.status === 'scheduled' ? `✅ Draf #${draftId} disetujui dan dijadwalkan.`
        : result.status === 'approved' ? `📲 Draf #${draftId} disetujui untuk publikasi manual. Konfirmasi operator diperlukan setelah posting.`
          : `❌ Draf #${draftId} ditolak.`
      : result.reason === 'human_review_required'
        ? `⚠️ Draf #${draftId} memerlukan review. Buka editor di dashboard web dan konfirmasi review sebelum persetujuan Auto.`
        : `⚠️ Draf #${draftId} belum diproses: ${escapeHtml(result.reason)}.`;
    await sendMessage(adminChatId, text);
    if (callback.id) await request('answerCallbackQuery', { callback_query_id: callback.id, text: result.allowed ? 'Keputusan disimpan.' : 'Keputusan diblokir.' });
    return result;
  }

  async function dispatchDraftToTelegram(draftId) {
    if (!config.botToken || !adminChatId || !numericId(draftId)) return false;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Hold the row until delivery acknowledgement to serialize dispatchers.
      const { rows } = await client.query(
        `SELECT d.*, t.title, t.primary_source, ts.score_total, ts.reasoning
         FROM drafts d JOIN topics t ON t.id = d.topic_id
         LEFT JOIN LATERAL (
           SELECT score_total, reasoning FROM topic_scores WHERE topic_id = t.id
           ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1
         ) ts ON TRUE
         WHERE d.id = $1 FOR UPDATE OF d SKIP LOCKED`, [Number(draftId)],
      );
      const draft = rows[0];
      if (!draft || draft.status !== 'draft') { await client.query('ROLLBACK'); return false; }
      if (draft.telegram_dispatched_at) { await client.query('COMMIT'); return true; }
      const { rows: slides } = await client.query(
        'SELECT render_path, slide_no FROM draft_slides WHERE draft_id = $1 ORDER BY slide_no ASC', [Number(draftId)],
      );
      const draftSlides = typeof draft.slides === 'string' ? JSON.parse(draft.slides) : draft.slides;
      if (!Array.isArray(draftSlides) || draftSlides.length < 1 || draftSlides.length > 10 ||
          slides.length !== draftSlides.length || slides.some((slide, index) =>
            Number(slide.slide_no) !== index + 1 || !slide.render_path || !fsImpl.existsSync(slide.render_path))) {
        throw new Error('Draft slide assets are incomplete.');
      }
      if (!await sendPhotos(adminChatId, slides.map(slide => slide.render_path))) {
        throw new Error('Telegram media delivery was not acknowledged.');
      }
      // Bounds apply before escaping so long editorial text cannot exceed the
      // Telegram message limit, even if every character becomes an HTML entity.
      const text = `📌 <b>DRAF BARU #${Number(draftId)}</b>\n` +
        `<b>Judul:</b> ${escapeHtml(String(draft.title ?? '').slice(0, 100))}\n` +
        `<b>Sumber:</b> ${escapeHtml(String(draft.primary_source ?? '').slice(0, 60))}\n` +
        `<b>Skor Analis:</b> ${escapeHtml(String(draft.score_total ?? '-').slice(0, 5))}/100\n` +
        `<b>Alasan:</b> ${escapeHtml(String(draft.reasoning ?? '-').slice(0, 80))}\n\n` +
        `<b>CAPTION (ringkasan):</b>\n${escapeHtml(String(draft.caption ?? '').slice(0, 300))}\n\n` +
        `<b>HASHTAGS:</b> ${escapeHtml((Array.isArray(draft.hashtags) ? draft.hashtags.join(' ') : '').slice(0, 60))}`;
      const keyboard = { inline_keyboard: [
        [{ text: '✅ Setujui (Auto)', callback_data: `approve_auto:${draftId}` },
          { text: '📲 Setujui (Manual)', callback_data: `approve_manual:${draftId}` }],
        [{ text: '❌ Tolak Draf', callback_data: `reject:${draftId}` }],
      ] };
      if (!await sendMessage(adminChatId, text, keyboard)) throw new Error('Telegram review message was not acknowledged.');
      await client.query(
        `UPDATE drafts SET telegram_dispatched_at = NOW() WHERE id = $1 AND telegram_dispatched_at IS NULL`, [Number(draftId)],
      );
      await client.query('COMMIT');
      return true;
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      logger.warn(`[Telegram] Dispatch draf #${draftId} belum dikonfirmasi.`);
      return false;
    } finally {
      client.release();
    }
  }

  async function dispatchPendingDrafts() {
    if (!config.botToken || !adminChatId) return 0;
    const client = await pool.connect();
    let rows;
    try {
      ({ rows } = await client.query("SELECT id FROM drafts WHERE status = 'draft' AND telegram_dispatched_at IS NULL ORDER BY id ASC"));
    } finally { client.release(); }
    let delivered = 0;
    for (const row of rows) if (await dispatchDraftToTelegram(row.id)) delivered++;
    return delivered;
  }

  async function startBotPolling({ signal } = {}) {
    if (!config.botToken || !adminChatId || !adminUserIds.size) {
      logger.warn('[Telegram] Polling disabled: bot token, chat and user allowlist are required.');
      return;
    }
    let offset = 0;
    // A sequential long-poll loop avoids overlapping getUpdates consumers.
    while (!signal?.aborted) {
      const updates = await request('getUpdates', { offset, timeout: 10, allowed_updates: ['callback_query'] }, { polling: true });
      if (Array.isArray(updates?.result)) {
        for (const update of updates.result) {
          if (!Number.isSafeInteger(update.update_id) || update.update_id < offset) continue;
          try {
            if (update.callback_query) await processCallbackQuery(update.callback_query);
            offset = update.update_id + 1;
          } catch {
            logger.warn('[Telegram] Callback failed; waiting for a retry.');
            break;
          }
        }
      }
      try { await sleep(1000, undefined, { signal }); } catch { if (signal?.aborted) break; }
    }
  }

  return { dispatchDraftToTelegram, dispatchPendingDrafts, handleApprovalAction, processCallbackQuery, startBotPolling };
}

let runtime;
function defaultBot() {
  if (!runtime) {
    dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
    const env = process.env;
    runtime = createTelegramBot({
      pool: new pkg.Pool({ host: env.HME_DB_HOST || '127.0.0.1', port: parseInt(env.HME_DB_PORT || '5432'),
        user: env.HME_DB_USER || 'hme_user', password: env.HME_DB_PASSWORD, database: env.HME_DB_NAME || 'hme' }),
      config: { botToken: env.TELEGRAM_BOT_TOKEN, adminChatId: env.TELEGRAM_ADMIN_CHAT_ID,
        adminUserIds: (env.TELEGRAM_ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean) },
    });
  }
  return runtime;
}

export async function dispatchDraftToTelegram(draftId) { return defaultBot().dispatchDraftToTelegram(draftId); }
export async function dispatchPendingDrafts() { return defaultBot().dispatchPendingDrafts(); }
export async function handleApprovalAction(action, draftId, actor) { return defaultBot().handleApprovalAction(action, draftId, actor); }
export async function startBotPolling(options) { return defaultBot().startBotPolling(options); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dispatchPendingDrafts().then(() => startBotPolling()).catch(error => {
    console.error('[Telegram] Runner failed:', error.message);
    process.exitCode = 1;
  });
}
