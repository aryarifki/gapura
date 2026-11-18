// Multi-platform Meta publisher. Runs from its own systemd timer, never from
// the 15-minute intake cycle. Default mode is shadow: it records what it would
// publish without any network call. Live mode requires META_PUBLISH_MODE=live.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pkg from 'pg';
import { validateDraftApproval } from '../common/editorial.js';
import { draftContentHash } from '../common/draft-revision.js';
import { loadMetaConnection } from '../common/meta-connection-store.js';
import { validatePublicSourceUrl } from '../common/sources.js';
import { signedPublishImageUrls } from './media.js';
import {
  MetaApiError, createFacebookPublisher, createGraphClient,
  createInstagramPublisher, createThreadsPublisher, fetchPermalink,
} from './meta.js';

const PLATFORM_KEYS = ['instagram', 'facebook', 'threads'];

export function publicationConfigFromEnv(env = process.env) {
  const requested = String(env.META_PLATFORMS || '')
    .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const unknown = requested.filter((item) => !PLATFORM_KEYS.includes(item));
  if (unknown.length) throw new Error(`Platform publikasi tidak dikenal: ${unknown.join(', ')}.`);
  const pageToken = env.META_PAGE_ACCESS_TOKEN || '';
  const instagram = {
    accountId: env.META_INSTAGRAM_ACCOUNT_ID || '',
    accessToken: env.META_INSTAGRAM_ACCESS_TOKEN || pageToken,
  };
  let connection = null;
  try {
    connection = loadMetaConnection(env.GAPURA_META_CONNECTION || '/etc/gapura/meta-unified.json');
  } catch {}
  if (connection && connection.app_id === env.META_APP_ID &&
      connection.config_id === env.META_UNIFIED_CONFIG_ID &&
      (!env.META_INSTAGRAM_ACCOUNT_ID || connection.instagram_account_id === env.META_INSTAGRAM_ACCOUNT_ID)) {
    instagram.accountId = connection.instagram_account_id;
    instagram.accessToken = connection.expires_at && Date.parse(connection.expires_at) <= Date.now()
      ? '' : connection.access_token;
    instagram.graphVersion = connection.graph_version || 'v27.0';
    instagram.authType = 'unified_login';
  }
  const platforms = {
    instagram,
    facebook: {
      accountId: env.META_PAGE_ID || '',
      accessToken: pageToken,
    },
    threads: {
      accountId: env.META_THREADS_USER_ID || '',
      accessToken: env.META_THREADS_ACCESS_TOKEN || '',
    },
  };
  for (const [name, entry] of Object.entries(platforms)) {
    entry.enabled = requested.includes(name) && Boolean(entry.accountId) && Boolean(entry.accessToken);
  }
  return {
    mode: env.META_PUBLISH_MODE === 'live' ? 'live' : 'shadow',
    baseUrl: env.APP_BASE_URL || 'https://gapura.avenia.my.id',
    signingSecret: env.GAPURA_ADMIN_TOKEN || '',
    graphBaseUrl: env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
    graphVersion: env.META_GRAPH_VERSION || 'v23.0',
    threadsBaseUrl: env.THREADS_GRAPH_BASE_URL || 'https://graph.threads.com',
    threadsVersion: env.THREADS_GRAPH_VERSION || 'v1.0',
    httpTimeoutMs: Math.max(1000, Math.min(Number(env.META_HTTP_TIMEOUT_MS) || 30000, 60000)),
    maxAttempts: Math.max(1, Math.min(Number(env.META_PUBLISH_MAX_ATTEMPTS) || 3, 5)),
    platforms,
  };
}

export function captionHash(caption) {
  return crypto.createHash('sha256').update(String(caption ?? '')).digest('hex');
}

function gateAllows(row) {
  if (row.draft_status !== 'scheduled' || row.human_approved !== true ||
      row.approved_content_hash !== draftContentHash(row) || row.content_hash !== row.approved_content_hash || row.analyst_passed !== true ||
      validatePublicSourceUrl(row.source_url)) return false;
  return validateDraftApproval({
    status: 'draft',
    needsReview: row.needs_review !== false,
    mode: 'auto',
    acknowledgeReview: false,
  }).allowed;
}

const DRAFT_EVIDENCE = `
    (SELECT topic.url FROM topics topic WHERE topic.id = d.topic_id) AS source_url,
    (SELECT scores.verdict = 'passed' FROM topic_scores scores WHERE scores.topic_id = d.topic_id
      ORDER BY scores.created_at DESC NULLS LAST, scores.id DESC LIMIT 1) AS analyst_passed,
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

const DUE_SCHEDULE = `EXISTS (
  SELECT 1 FROM scheduled_posts sp WHERE sp.draft_id = d.id
    AND sp.status = 'pending' AND sp.mode = 'auto' AND sp.scheduled_at <= NOW()
) AND NOT EXISTS (
  SELECT 1 FROM scheduled_posts old WHERE old.draft_id = d.id
    AND (old.status IN ('publishing', 'success') OR old.ig_creation_id IS NOT NULL
      OR old.ig_media_id IS NOT NULL OR old.published_at IS NOT NULL)
)`;

const CLAIM_NEXT = `
  WITH candidate AS (
    SELECT t.id FROM publication_targets t
    JOIN drafts d ON d.id = t.draft_id
    JOIN jsonb_to_recordset($1::jsonb) active(platform text, account_id text)
      ON active.platform = t.platform AND active.account_id = t.account_id
    WHERE t.status = 'pending' AND d.status = 'scheduled'
      AND NOT (t.id = ANY($2::bigint[])) AND ${DUE_SCHEDULE}
      AND EXISTS (SELECT 1 FROM scheduled_posts due WHERE due.id = t.schedule_id
        AND due.draft_id = d.id AND due.status = 'pending' AND due.mode = 'auto' AND due.scheduled_at <= NOW())
    ORDER BY t.created_at ASC, t.id ASC
    LIMIT 1 FOR UPDATE OF t SKIP LOCKED
  )
  UPDATE publication_targets t
  SET status = 'publishing', attempts = t.attempts + 1, claimed_at = NOW(), updated_at = NOW()
  FROM candidate c, drafts d
  WHERE t.id = c.id AND d.id = t.draft_id AND t.status = 'pending'
  RETURNING t.*, d.caption, d.hashtags, d.slides, d.content_format, d.needs_review,
    d.editorial_input, d.editorial_mode, d.caption_body, d.threads_caption, d.angle, d.scope_note, d.editorial_references,
    d.status AS draft_status, ${DRAFT_EVIDENCE}`;

export function createMetaPublisherWorker({ pool, config, fetchImpl = globalThis.fetch, logger = console }) {
  const adapters = new Map();
  const activeAccounts = Object.entries(config.platforms).filter(([, entry]) => entry.enabled)
    .map(([platform, entry]) => ({ platform, account_id: entry.accountId }));

  function adapterFor(platform) {
    if (adapters.has(platform)) return adapters.get(platform);
    const entry = config.platforms[platform];
    if (!entry?.enabled) throw new Error(`Platform ${platform} tidak aktif.`);
    const client = createGraphClient({
      fetchImpl,
      accessToken: entry.accessToken,
      version: platform === 'threads' ? config.threadsVersion : entry.graphVersion || config.graphVersion,
      baseUrl: platform === 'threads' ? config.threadsBaseUrl : config.graphBaseUrl,
      timeoutMs: config.httpTimeoutMs,
    });
    const adapter = platform === 'instagram'
      ? createInstagramPublisher({ client, igUserId: entry.accountId })
      : platform === 'facebook'
        ? createFacebookPublisher({ client, pageId: entry.accountId })
        : createThreadsPublisher({ client, threadsUserId: entry.accountId });
    const wrapped = { ...adapter, client };
    adapters.set(platform, wrapped);
    return wrapped;
  }

  async function syncTargets(client) {
    let inserted = 0;
    for (const platform of PLATFORM_KEYS) {
      const entry = config.platforms[platform];
      if (!entry?.enabled) continue;
      const { rowCount } = await client.query(
        `INSERT INTO publication_targets (draft_id, platform, account_id, schedule_id, content_hash)
         SELECT d.id, $1, $2, sp.id,
           (SELECT a.payload->>'content_hash' FROM audit_log a WHERE a.entity='draft' AND a.entity_id=d.id
             AND a.action='approved_auto' ORDER BY a.created_at DESC,a.id DESC LIMIT 1)
         FROM drafts d
         JOIN LATERAL (SELECT id FROM scheduled_posts WHERE draft_id = d.id
           AND status = 'pending' AND mode = 'auto' AND scheduled_at <= NOW()
           ORDER BY scheduled_at DESC, id DESC LIMIT 1) sp ON TRUE
           WHERE d.status = 'scheduled' AND ${DUE_SCHEDULE}
             AND NOT EXISTS (SELECT 1 FROM publication_targets old WHERE old.draft_id = d.id
               AND old.platform = $1 AND old.account_id <> $2)
         ON CONFLICT (draft_id, platform, account_id) DO UPDATE
            SET schedule_id = EXCLUDED.schedule_id, status = 'pending', attempts = 0,
              content_hash = EXCLUDED.content_hash, error_message = NULL, updated_at = NOW()
           WHERE publication_targets.schedule_id IS DISTINCT FROM EXCLUDED.schedule_id
             AND publication_targets.status IN ('pending', 'shadow', 'blocked', 'failed')
             AND publication_targets.remote_id IS NULL AND publication_targets.container_id IS NULL
             AND publication_targets.publish_attempted_at IS NULL`,
        [platform, entry.accountId],
      );
      inserted += rowCount || 0;
    }
    return inserted;
  }

  async function finalize(client, row, patch) {
    const { rowCount } = await client.query(
      `UPDATE publication_targets
       SET status = $1, remote_id = $2, container_id = $3, permalink = $4,
            error_message = $5, published_at = $6, caption_hash = $7,
            publish_attempted_at = CASE WHEN $1 IN ('published', 'unknown') THEN COALESCE(publish_attempted_at, NOW())
              WHEN $1 = 'blocked' THEN NULL ELSE publish_attempted_at END,
            updated_at = NOW()
       WHERE id = $8 AND status = 'publishing'`,
      [patch.status, patch.remoteId ?? null, patch.containerId ?? null, patch.permalink ?? null,
        patch.error ?? null, patch.publishedAt ?? null, patch.captionHash ?? null, row.id],
    );
    if (rowCount !== 1) throw new Error('Klaim publikasi hilang saat finalisasi.');
  }

  async function runOnce({ resetShadow = false } = {}) {
    const result = { inserted: 0, shadow: 0, published: 0, failed: 0, blocked: 0, unknown: 0, retried: 0 };
    const client = await pool.connect();
    const attempted = [];
    try {
      if (resetShadow) {
        const { rowCount } = await client.query(
          `UPDATE publication_targets SET status = 'pending', updated_at = NOW() WHERE status = 'shadow'`,
        );
        result.reset = rowCount || 0;
      }
      result.inserted = await syncTargets(client);
      while (true) {
        const { rows } = await client.query(CLAIM_NEXT, [JSON.stringify(activeAccounts), attempted]);
        if (!rows.length) break;
        const row = rows[0];
        attempted.push(row.id);
        let transactionOpen = false;
        let publishAttempted = false;
        let published = null;
        let permalink = null;
        let containerId = row.container_id || null;
        try {
          if (!gateAllows(row)) {
            await finalize(client, row, { status: 'blocked', error: 'Gate editorial/persetujuan review menolak publikasi.' });
            result.blocked++;
            continue;
          }
          const original = row.editorial_input != null || row.editorial_mode != null;
          const reviewedThreads = original && row.platform === 'threads';
          if (reviewedThreads && (typeof row.threads_caption !== 'string' || !row.threads_caption.trim() || row.threads_caption.length > 500)) {
            throw Object.assign(new Error('Caption Threads R6 wajib berupa teks yang sudah direview, tidak kosong, dan maksimal 500 karakter.'), { blocked: true });
          }
          if (config.mode !== 'live') {
            await finalize(client, row, { status: 'shadow', error: 'Shadow mode: tidak ada panggilan Meta.' });
            result.shadow++;
            continue;
          }
          const adapter = adapterFor(row.platform);
          const slides = typeof row.slides === 'string' ? JSON.parse(row.slides) : row.slides;
          if (!Array.isArray(slides) || !slides.length) throw new Error('Draf tidak memiliki slide.');
          const imageUrls = signedPublishImageUrls({
            baseUrl: config.baseUrl, draftId: row.draft_id, slideCount: slides.length,
            signingSecret: config.signingSecret,
          });
          const caption = reviewedThreads
            ? row.threads_caption
            : original ? String(row.caption || '')
              : [String(row.caption || ''), (row.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
          if (row.platform === 'threads' && caption.length > 500) throw new Error('Caption Threads melebihi 500 karakter; minta review versi khusus Threads.');
          published = await adapter.publish({ imageUrls, caption, beforePublish: async (creationId) => {
            containerId = creationId;
            const saved = await client.query(
              `UPDATE publication_targets SET container_id = $1, publish_attempted_at = NOW(), updated_at = NOW()
                WHERE id = $2 AND status = 'publishing'`, [creationId, row.id],
            );
            if (saved.rowCount !== 1) throw new Error('Klaim publikasi hilang sebelum publish.');
            await client.query('BEGIN');
            transactionOpen = true;
            const { rows: [current] } = await client.query(
              `SELECT t.*, d.caption, d.hashtags, d.slides, d.content_format, d.needs_review,
                  d.editorial_input, d.editorial_mode, d.caption_body, d.threads_caption, d.angle, d.scope_note, d.editorial_references,
                  d.status AS draft_status, ${DRAFT_EVIDENCE}
               FROM publication_targets t JOIN drafts d ON d.id = t.draft_id
               WHERE t.id = $1 AND t.status = 'publishing' AND ${DUE_SCHEDULE}
                 AND EXISTS (SELECT 1 FROM scheduled_posts due WHERE due.id = t.schedule_id
                   AND due.status = 'pending' AND due.mode = 'auto' AND due.scheduled_at <= NOW())
               FOR UPDATE OF t, d`, [row.id],
            );
            if (!current || !gateAllows(current) || current.account_id !== adapter.accountId ||
                current.caption !== row.caption || current.content_format !== row.content_format ||
                JSON.stringify(current.slides) !== JSON.stringify(row.slides) ||
                JSON.stringify(current.hashtags) !== JSON.stringify(row.hashtags)) {
              throw Object.assign(new Error('Konten atau persetujuan berubah sebelum publish.'), { blocked: true });
            }
            if (current.approved_content_hash !== draftContentHash(current) || current.content_hash !== row.content_hash) {
              throw Object.assign(new Error('Hash konten tidak sesuai persetujuan redaktur.'), { blocked: true });
            }
            publishAttempted = true;
          } });
          permalink = await fetchPermalink(adapter.client, published.remoteId, { platform: row.platform });
          await finalize(client, row, {
            status: 'published',
            remoteId: published.remoteId,
            containerId: published.containerId || null,
            permalink,
            captionHash: captionHash(reviewedThreads ? row.threads_caption : row.caption),
            publishedAt: new Date(),
          });
          await client.query(
            `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
             VALUES ('draft', $1, 'published_platform', 'meta_publisher', $2)`,
            [row.draft_id, JSON.stringify({ platform: row.platform, account_id: row.account_id, remote_id: published.remoteId, permalink })],
          );
          await client.query(
            `UPDATE scheduled_posts sp SET status = 'success', published_at = NOW(), error_message = NULL
             WHERE sp.id = $1 AND sp.status = 'pending'
               AND NOT EXISTS (SELECT 1 FROM publication_targets t
                 WHERE t.schedule_id = sp.id AND t.status <> 'published')`, [row.schedule_id],
          );
          await client.query(
            `UPDATE drafts d SET status = 'published', updated_at = NOW()
             WHERE d.id = $1 AND d.status = 'scheduled'
               AND EXISTS (SELECT 1 FROM scheduled_posts sp WHERE sp.id = $2 AND sp.status = 'success')`,
            [row.draft_id, row.schedule_id],
          );
          await client.query('COMMIT');
          transactionOpen = false;
          result.published++;
        } catch (error) {
          if (transactionOpen) {
            await client.query('ROLLBACK').catch(() => {});
            transactionOpen = false;
          }
          const apiError = error instanceof MetaApiError ? error : null;
          if (publishAttempted || error.uncertain || published) {
            await finalize(client, row, {
              status: 'unknown',
              remoteId: published?.remoteId,
              containerId: published?.containerId || containerId,
              permalink,
              error: `Hasil publish tidak pasti; rekonsiliasi manual sebelum retry. ${error.message}`.slice(0, 500),
            });
            result.unknown++;
          } else if (error.blocked) {
            await finalize(client, row, { status: 'blocked', error: error.message });
            result.blocked++;
          } else if (apiError?.retryable && row.attempts < config.maxAttempts) {
            await finalize(client, row, { status: 'pending', error: `Percobaan ${row.attempts} gagal sementara: ${error.message}`.slice(0, 500) });
            result.retried++;
          } else {
            await finalize(client, row, { status: 'failed', error: String(error.message).slice(0, 500) });
            result.failed++;
          }
          logger.warn(`[MetaPublisher] Draf #${row.draft_id} ${row.platform}: ${result.unknown ? 'unknown' : 'handled'} (${error.message}).`);
        }
      }
      return result;
    } finally {
      client.release();
    }
  }

  return { runOnce, syncTargets };
}

function defaultRuntime() {
  dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
  const env = process.env;
  return {
    pool: new pkg.Pool({
      host: env.HME_DB_HOST || '127.0.0.1',
      port: parseInt(env.HME_DB_PORT || '5432', 10),
      user: env.HME_DB_USER || 'hme_user',
      password: env.HME_DB_PASSWORD,
      database: env.HME_DB_NAME || 'hme',
    }),
    config: publicationConfigFromEnv(env),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtime = defaultRuntime();
  const enabled = Object.values(runtime.config.platforms).some((entry) => entry.enabled);
  if (!enabled) {
    console.log('[MetaPublisher] Tidak ada platform aktif (META_PLATFORMS kosong atau kredensial belum lengkap).');
    process.exit(0);
  }
  console.log(`[MetaPublisher] mode=${runtime.config.mode}`);
  createMetaPublisherWorker({ pool: runtime.pool, config: runtime.config })
    .runOnce({ resetShadow: process.argv.includes('--reset-shadow') })
    .then((result) => { console.log('[MetaPublisher]', JSON.stringify(result)); process.exit(0); })
    .catch((error) => { console.error('[MetaPublisher] Runner gagal:', error.message); process.exit(1); });
}
