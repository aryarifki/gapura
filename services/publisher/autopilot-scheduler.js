// Autopilot draft scheduler: assigns top priority validated drafts (bursa,
// politik, and Bursa/OJK-linked ekonomi) into upcoming peak-reach WIB slots.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pkg from 'pg';
import { loadAgentsConfig } from '../common/llm.js';
import { projectDiscoveryTopic } from '../common/discovery.js';
import { draftContentHash } from '../common/draft-revision.js';
import { hasEditorialCover } from '../common/images.js';
import { validatePublicSourceUrl } from '../common/sources.js';
import {
  computeNextPublishSlot,
  loadOccupiedPublishDates,
  loadPublishingScheduleConfig,
} from '../common/publish-schedule.js';
import { checkEkonomiPolicy } from '../analis/scoring.js';

export async function runAutopilotScheduler({
  pool,
  config = loadAgentsConfig(),
  env = process.env,
  now = new Date(),
  logger = console,
} = {}) {
  if (env.GAPURA_AUTOPILOT_PUBLISH !== 'true') {
    return { scheduled: 0, skipped: 'disabled', items: [] };
  }
  const analisCfg = config?.analis || {};
  const queueSize = Math.max(1, Number.parseInt(String(env.GAPURA_AUTOPILOT_QUEUE_SIZE || '6'), 10) || 6);
  const client = await pool.connect();
  const items = [];
  try {
    const { rows: [pendingRow] } = await client.query(
      "SELECT COUNT(*)::int AS cnt FROM scheduled_posts WHERE status = 'pending' AND mode = 'auto'",
    );
    const pendingCount = Number(pendingRow?.cnt || 0);
    const slotsNeeded = Math.max(0, queueSize - pendingCount);
    if (slotsNeeded === 0) {
      return { scheduled: 0, pending: pendingCount, queue_size: queueSize, items };
    }

    const { hoursWib, dailyLimit } = await loadPublishingScheduleConfig(client, env);
    const occupiedDates = await loadOccupiedPublishDates(client);

    const { rows: candidates } = await client.query(`
      SELECT d.*, t.id AS topic_id, t.title AS topic_title, t.raw_title, t.normalized_title,
             t.primary_source, t.source_id, t.url AS source_url, t.desk AS topic_desk,
             t.topic_keywords, t.source_published_at, t.created_at AS topic_created_at,
             ts.score_total, ts.verdict AS analyst_verdict
      FROM drafts d
      JOIN topics t ON t.id = d.topic_id
      LEFT JOIN LATERAL (
        SELECT score_total, verdict FROM topic_scores
        WHERE topic_id = t.id ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1
      ) ts ON TRUE
      WHERE d.status = 'draft'
        AND ts.verdict = 'passed'
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_posts sp
          WHERE sp.draft_id = d.id AND sp.status IN ('pending', 'publishing', 'success')
        )
        AND NOT EXISTS (
          SELECT 1 FROM publication_targets pt
          WHERE pt.draft_id = d.id AND pt.status IN ('publishing', 'unknown', 'published')
        )
        AND (
          SELECT COUNT(DISTINCT ds.slide_no) FROM draft_slides ds
          WHERE ds.draft_id = d.id
            AND ds.slide_no BETWEEN 1 AND jsonb_array_length(d.slides)
            AND ds.render_path <> ''
        ) = jsonb_array_length(d.slides)
      ORDER BY CASE WHEN t.desk = 'bursa' THEN 0 WHEN t.desk = 'politik' THEN 1 ELSE 2 END ASC,
               ts.score_total DESC, d.id DESC
      LIMIT 40
    `);

    for (const candidate of candidates) {
      if (items.length >= slotsNeeded) break;
      const topic = {
        id: candidate.topic_id,
        title: candidate.topic_title,
        raw_title: candidate.raw_title,
        normalized_title: candidate.normalized_title,
        primary_source: candidate.primary_source,
        source_id: candidate.source_id,
        url: candidate.source_url,
        desk: candidate.topic_desk,
        topic_keywords: candidate.topic_keywords,
        source_published_at: candidate.source_published_at,
        created_at: candidate.topic_created_at,
      };
      const discovery = projectDiscoveryTopic(topic);
      if (checkEkonomiPolicy(topic, discovery, analisCfg).rejected) continue;
      if (validatePublicSourceUrl(candidate.source_url)) continue;
      if (!hasEditorialCover(candidate.slides)) continue;
      if (candidate.copy_model === 'studio-ai-designer') continue;
      if (candidate.copy_model === 'staged-editorial-v3' && candidate.article_metadata?.pipeline?.status !== 'VALIDATED') continue;
      if (candidate.editorial_input != null) {
        if (typeof candidate.article_body !== 'string' || candidate.article_body.trim().length < 1200) continue;
        if (candidate.editorial_mode === 'current' && (!Array.isArray(candidate.article_references) || candidate.article_references.length < 3)) continue;
      }

      const slot = computeNextPublishSlot({ now, hoursWib, occupiedDates, dailyLimit });
      await client.query('BEGIN');
      try {
        const { rows: [locked] } = await client.query(
          "SELECT * FROM drafts WHERE id = $1 AND status = 'draft' FOR UPDATE",
          [candidate.id],
        );
        if (!locked) {
          await client.query('ROLLBACK');
          continue;
        }
        const contentHash = draftContentHash(locked);
        await client.query(
          "UPDATE drafts SET status = 'scheduled', needs_review = FALSE, updated_at = NOW() WHERE id = $1",
          [candidate.id],
        );
        await client.query(
          "INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status) VALUES ($1, 'auto', $2, 'pending')",
          [candidate.id, slot.scheduledAt],
        );
        await client.query(
          "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'approved_auto', 'owner_autopilot', $2)",
          [candidate.id, JSON.stringify({ scheduled_at: slot.scheduledAt.toISOString(), slot_wib: slot.slotWib, content_hash: contentHash, desk: candidate.topic_desk || null })],
        );
        await client.query('COMMIT');
        occupiedDates.push(slot.scheduledAt);
        items.push({ draft_id: candidate.id, desk: candidate.topic_desk || null, scheduled_at: slot.scheduledAt.toISOString(), slot_wib: slot.slotWib });
        logger.log(`[Autopilot] Draf #${candidate.id} (${candidate.topic_desk || 'umum'}) dijadwalkan -> ${slot.slotWib}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }

    return { scheduled: items.length, pending: pendingCount + items.length, queue_size: queueSize, items };
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
  const env = process.env;
  const pool = new pkg.Pool({
    host: env.HME_DB_HOST || '127.0.0.1',
    port: parseInt(env.HME_DB_PORT || '5432', 10),
    user: env.HME_DB_USER || 'hme_user',
    password: env.HME_DB_PASSWORD,
    database: env.HME_DB_NAME || 'hme',
  });
  runAutopilotScheduler({ pool, env })
    .then((summary) => { console.log('[Autopilot]', JSON.stringify(summary)); process.exit(0); })
    .catch((error) => { console.error('[Autopilot] Gagal:', error.message); process.exit(1); })
    .finally(() => pool.end().catch(() => {}));
}
