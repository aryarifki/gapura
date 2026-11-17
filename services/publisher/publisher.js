// Publishing is claimed before outbound work. An uncertain media_publish result
// stays in 'publishing' for operator reconciliation; it must never be retried.
import pkg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { validateDraftApproval } from '../common/editorial.js';
import { draftContentHash } from '../common/draft-revision.js';
import { publishFormat, signedPublishImageUrl } from './media.js';

const APPROVAL_EVIDENCE = `
    EXISTS (
      SELECT 1 FROM audit_log a WHERE a.entity = 'draft' AND a.entity_id = d.id
        AND a.action = 'approved_auto' AND a.created_at >= d.updated_at
        AND (a.actor = 'web_admin' OR a.actor ~ '^telegram:[0-9]+$')
    ) AS human_approved,
    (SELECT a.payload->>'content_hash' FROM audit_log a
      WHERE a.entity = 'draft' AND a.entity_id = d.id AND a.action = 'approved_auto'
        AND a.created_at >= d.updated_at
        AND (a.actor = 'web_admin' OR a.actor ~ '^telegram:[0-9]+$')
      ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS approved_content_hash`;

const CLAIM_NEXT = `
  WITH candidate AS (
    SELECT sp.id FROM scheduled_posts sp
    JOIN drafts d ON d.id = sp.draft_id
    WHERE sp.status = 'pending' AND sp.scheduled_at <= NOW()
      AND d.status = 'scheduled' AND sp.manual_reminded_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM publication_targets target WHERE target.draft_id = sp.draft_id)
      AND NOT (sp.id = ANY($1::bigint[]))
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_posts active
        WHERE active.draft_id = sp.draft_id AND active.id <> sp.id
          AND (active.status IN ('publishing', 'success')
               OR active.ig_media_id IS NOT NULL OR active.published_at IS NOT NULL)
      )
    ORDER BY sp.scheduled_at ASC, sp.id ASC
    LIMIT 1 FOR UPDATE OF sp, d SKIP LOCKED
  )
  UPDATE scheduled_posts sp SET status = 'publishing'
  FROM candidate c, drafts d
  WHERE sp.id = c.id AND d.id = sp.draft_id AND sp.status = 'pending'
  RETURNING sp.*, d.caption, d.slides, d.hashtags, d.content_format, d.needs_review,
    d.status AS draft_status, ${APPROVAL_EVIDENCE}`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function publicationGate(post) {
  if (post.draft_status !== 'scheduled') return false;
  if (post.mode === 'auto' && (post.human_approved !== true ||
      post.approved_content_hash !== draftContentHash(post))) return false;
  return validateDraftApproval({
    status: 'draft',
    needsReview: post.needs_review !== false,
    mode: post.mode,
    acknowledgeReview: false,
  }).allowed;
}

export function createPublisher({ pool, fetchImpl = globalThis.fetch, config = {}, sleep: wait = sleep, logger = console }) {
  const timeoutMs = Math.max(1, Math.min(Number(config.httpTimeoutMs) || 15000, 30000));

  async function graphRequest(endpoint, parameters = null) {
    const headers = { Authorization: `Bearer ${config.igAccessToken}` };
    const response = await fetchImpl(`https://graph.facebook.com/v21.0/${endpoint}`, {
      method: parameters ? 'POST' : 'GET', headers,
      ...(parameters ? { body: new URLSearchParams(parameters) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    // Do not persist API bodies/URLs: provider errors can contain credentials.
    if (!response.ok || !data || data.error) throw new Error(`Meta request failed (HTTP ${response.status}).`);
    return data;
  }

  async function publishToInstagramGraphApi(post, slideCount, onCreation, beforePublish, onPublishAttempt) {
    const format = publishFormat(post.content_format, slideCount);
    const itemIds = [];
    for (let slideNo = 1; slideNo <= slideCount; slideNo++) {
      const imageUrl = signedPublishImageUrl({
        baseUrl: config.baseUrl, draftId: post.draft_id, slideNo, signingSecret: config.signingSecret,
      });
      const item = await graphRequest(`${config.igAccountId}/media`, {
        image_url: imageUrl,
        ...(format === 'carousel' ? { is_carousel_item: 'true' } : { caption: post.caption ?? '' }),
      });
      if (typeof item.id !== 'string' || !item.id.trim()) throw new Error('Meta returned no media container id.');
      itemIds.push(item.id);
    }
    let creationId = itemIds[0];
    if (format === 'carousel') {
      const parent = await graphRequest(`${config.igAccountId}/media`, {
        media_type: 'CAROUSEL', children: itemIds.join(','), caption: post.caption ?? '',
      });
      if (typeof parent.id !== 'string' || !parent.id.trim()) throw new Error('Meta returned no carousel container id.');
      creationId = parent.id;
    }
    await onCreation(creationId);
    let ready = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const status = await graphRequest(`${encodeURIComponent(creationId)}?fields=status_code`);
      if (status.status_code === 'FINISHED') { ready = true; break; }
      if (status.status_code !== 'IN_PROGRESS') throw new Error('Meta container is not ready for publishing.');
      if (attempt < 4) await wait(1000);
    }
    if (!ready) throw new Error('Meta container readiness timed out.');

    await beforePublish();
    // From this point even an HTTP failure can mean the remote publish succeeded.
    onPublishAttempt();
    const published = await graphRequest(`${config.igAccountId}/media_publish`, { creation_id: creationId });
    if (typeof published.id !== 'string' || !published.id.trim()) throw new Error('Meta returned no published media id.');
    return published.id;
  }

  async function sendManualPublishReminder(post, slideCount) {
    if (!config.telegramBotToken || !config.telegramAdminChatId) return false;
    try {
      const text = `⏰ <b>JADWAL TAYANG TIBA (Jalur Manual)</b>\n\nDraf <b>#${escapeHtml(post.draft_id)}</b> siap ditinjau untuk publikasi manual.\n📸 ${slideCount} slide\n🔗 ${escapeHtml(config.baseUrl)}\n\nKonfirmasi operator tetap diperlukan setelah posting di Instagram.\n\n<pre>${escapeHtml(String(post.caption ?? '').slice(0, 500))}</pre>`;
      const response = await fetchImpl(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.telegramAdminChatId, text, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await response.json();
      return response.ok && data?.ok === true && Number.isSafeInteger(data.result?.message_id) && data.result.message_id > 0;
    } catch {
      logger.warn(`[Publisher] Reminder Telegram gagal untuk draf #${post.draft_id}.`);
      return false;
    }
  }

  async function recordPublished(client, post, mediaId) {
    const updated = await client.query(
      `UPDATE scheduled_posts SET status = 'success', published_at = NOW(), ig_media_id = $1, error_message = NULL
       WHERE id = $2 AND status = 'publishing' RETURNING id`, [mediaId, post.id],
    );
    if (updated.rowCount !== 1) throw new Error('Publishing claim lost during finalization.');
    const draft = await client.query(
      `UPDATE drafts SET status = 'published', updated_at = NOW()
       WHERE id = $1 AND status = 'scheduled' RETURNING id`, [post.draft_id],
    );
    if (draft.rowCount !== 1) throw new Error('Draft changed during publishing.');
    await client.query(
      `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
       VALUES ('draft', $1, 'published_auto', 'publisher_engine', $2)`,
      [post.draft_id, JSON.stringify({ ig_media_id: mediaId, schedule_id: post.id })],
    );
    await client.query('COMMIT');
  }

  async function runPublisher() {
    if (config.metaWorkerEnabled) return { published: 0, reminded: 0, blocked: 0, uncertain: 0 };
    const client = await pool.connect();
    const attempted = [];
    const result = { published: 0, reminded: 0, blocked: 0, uncertain: 0 };
    try {
      while (true) {
        const { rows } = await client.query(CLAIM_NEXT, [attempted]);
        if (!rows.length) break;
        const post = rows[0];
        attempted.push(post.id);
        let publishAttempted = false;
        let transactionOpen = false;
        try {
          if (post.ig_creation_id || post.ig_media_id || post.published_at) {
            publishAttempted = true;
            throw new Error('Existing publication evidence requires operator reconciliation.');
          }
          if (!publicationGate(post)) throw new Error('Editorial gate blocked.');
          const slides = typeof post.slides === 'string' ? JSON.parse(post.slides) : post.slides;
          if (!Array.isArray(slides)) throw new Error('Draft slides must be an array.');
          const slideCount = slides.length;
          publishFormat(post.content_format, slideCount);
          if (post.mode === 'manual' || !config.igAccountId || !config.igAccessToken) {
            const delivered = await sendManualPublishReminder(post, slideCount);
            await client.query(
              `UPDATE scheduled_posts SET status = 'pending',
                 ${delivered ? 'manual_reminded_at = NOW(),' : ''} error_message = $1
               WHERE id = $2 AND status = 'publishing'`,
              [delivered ? 'Awaiting operator confirmation of manual publication.' : 'Manual reminder delivery failed.', post.id],
            );
            if (delivered) result.reminded++;
            continue;
          }
          const mediaId = await publishToInstagramGraphApi(post, slideCount, async creationId => {
            const saved = await client.query(
              `UPDATE scheduled_posts SET ig_creation_id = $1 WHERE id = $2 AND status = 'publishing' RETURNING id`,
              [creationId, post.id],
            );
            if (saved.rowCount !== 1) throw new Error('Publishing claim lost before remote publish.');
          }, async () => {
            await client.query('BEGIN');
            transactionOpen = true;
            const { rows: current } = await client.query(
              `SELECT sp.*, d.status AS draft_status, d.needs_review, d.caption, d.slides, d.hashtags, d.content_format,
                 ${APPROVAL_EVIDENCE}
               FROM scheduled_posts sp JOIN drafts d ON d.id = sp.draft_id
               WHERE sp.id = $1 FOR UPDATE OF sp, d`, [post.id],
            );
            if (!current[0] || current[0].status !== 'publishing' || current[0].mode !== 'auto' ||
                current[0].ig_media_id || current[0].published_at || !publicationGate(current[0]) ||
                current[0].caption !== post.caption || current[0].content_format !== post.content_format ||
                JSON.stringify(current[0].slides) !== JSON.stringify(post.slides) ||
                draftContentHash(current[0]) !== draftContentHash(post)) {
              throw new Error('Draft or editorial gate changed before publishing.');
            }
          }, () => { publishAttempted = true; });
          await recordPublished(client, post, mediaId);
          transactionOpen = false;
          result.published++;
        } catch (error) {
          if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
          if (publishAttempted) {
            // No status transition: the result or local COMMIT may be ambiguous.
            await client.query(
              `UPDATE scheduled_posts SET error_message = $1 WHERE id = $2 AND status = 'publishing'`,
              ['Publishing outcome unknown; reconcile with Meta before any retry.', post.id],
            );
            result.uncertain++;
          } else {
            await client.query(
              `UPDATE scheduled_posts SET status = 'failed', error_message = $1 WHERE id = $2 AND status = 'publishing'`,
              ['Publishing stopped before media_publish; review editorial gate, assets and container readiness.', post.id],
            );
            result.blocked++;
          }
          logger.warn(`[Publisher] Draf #${post.draft_id}: ${publishAttempted ? 'operator reconciliation required' : 'delivery blocked'}.`);
        }
      }
      return result;
    } finally {
      client.release();
    }
  }
  return { runPublisher };
}

let runtime;
function defaultPublisher() {
  if (!runtime) {
    dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
    const env = process.env;
    runtime = createPublisher({
      pool: new pkg.Pool({ host: env.HME_DB_HOST || '127.0.0.1', port: parseInt(env.HME_DB_PORT || '5432'),
        user: env.HME_DB_USER || 'hme_user', password: env.HME_DB_PASSWORD, database: env.HME_DB_NAME || 'hme' }),
      config: { baseUrl: env.APP_BASE_URL || 'https://gapura.avenia.my.id', igAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
        metaWorkerEnabled: Boolean(String(env.META_PLATFORMS || '').trim()),
        igAccessToken: env.INSTAGRAM_ACCESS_TOKEN, telegramBotToken: env.TELEGRAM_BOT_TOKEN,
        telegramAdminChatId: env.TELEGRAM_ADMIN_CHAT_ID, signingSecret: env.GAPURA_ADMIN_TOKEN || '' },
    });
  }
  return runtime;
}

export async function runPublisher() { return defaultPublisher().runPublisher(); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPublisher().then(() => process.exit(0)).catch(error => {
    console.error('[Publisher] Runner failed:', error.message);
    process.exit(1);
  });
}
