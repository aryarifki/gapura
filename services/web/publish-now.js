import { draftContentHash } from '../common/draft-revision.js';
import { validateDraftApproval } from '../common/editorial.js';
import { hasEditorialCover } from '../common/images.js';
import { validatePublicSourceUrl } from '../common/sources.js';
import { createMetaPublisherWorker, publicationConfigFromEnv } from '../publisher/meta-worker.js';

function httpResult(status, body) {
  return { httpStatus: status, body };
}

export async function publishDraftNow({
  pool,
  draftId,
  body = {},
  env = process.env,
  configFromEnv = publicationConfigFromEnv,
  createWorker = createMetaPublisherWorker,
}) {
  const publishConfig = configFromEnv({ ...env, META_PUBLISH_MODE: 'live' });
  const hasPlatform = Object.values(publishConfig.platforms || {}).some((entry) => entry?.enabled);
  if (!hasPlatform) {
    return httpResult(503, { error: 'Belum ada platform Meta aktif yang terkonfigurasi.' });
  }

  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query('BEGIN');
    transaction = true;
    const { rows } = await client.query(
      `SELECT d.*, t.url AS source_url,
              (SELECT ts.verdict FROM topic_scores ts WHERE ts.topic_id = t.id
               ORDER BY ts.created_at DESC NULLS LAST, ts.id DESC LIMIT 1) AS analyst_verdict
       FROM drafts d
       JOIN topics t ON t.id = d.topic_id
       WHERE d.id = $1 FOR UPDATE OF d`,
      [draftId],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(404, { error: 'Draf tidak ditemukan.' });
    }
    const draft = rows[0];
    const contentHash = draftContentHash(draft);
    if (body?.expected_revision !== contentHash) {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Draf telah berubah. Muat ulang dan tinjau konten terbaru sebelum publish.' });
    }
    if (!['draft', 'scheduled'].includes(draft.status)) {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Draf sudah diterbitkan atau tidak dalam status yang dapat dipublish.' });
    }

    const { rows: existingTargets } = await client.query(
      `SELECT id, status, remote_id, container_id, publish_attempted_at
       FROM publication_targets WHERE draft_id = $1`,
      [draftId],
    );
    if (existingTargets.some((t) => ['publishing', 'unknown'].includes(t.status))) {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Publikasi draf ini memiliki status tidak pasti; rekonsiliasi manual sebelum mencoba ulang.' });
    }

    if (!hasEditorialCover(draft.slides)) {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Cover wajib memiliki gambar berlisensi atau desain tipografi editorial sebelum publish.' });
    }
    if (draft.copy_model === 'studio-ai-designer') {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Draf lama belum memenuhi kontrak berita bersumber.' });
    }
    if (draft.editorial_input != null && (typeof draft.article_body !== 'string' || draft.article_body.trim().length < 1200
        || (draft.editorial_mode === 'current' && (!Array.isArray(draft.article_references) || draft.article_references.length < 3)))) {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Artikel berita lengkap atau rujukan riset web belum lengkap sebelum publish.' });
    }
    if (draft.copy_model === 'staged-editorial-v3' && draft.article_metadata?.pipeline?.status !== 'VALIDATED') {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Tahap editorial belum lengkap (belum VALIDATED).' });
    }
    if (validatePublicSourceUrl(draft.source_url)) {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Sumber topik harus berupa URL HTTPS publik yang valid.' });
    }
    if (draft.analyst_verdict !== 'passed') {
      await client.query('ROLLBACK');
      transaction = false;
      return httpResult(409, { error: 'Topik harus memiliki verdict Analis passed sebelum publish.' });
    }

    if (draft.status === 'draft') {
      if (body?.reviewed !== true) {
        await client.query('ROLLBACK');
        transaction = false;
        return httpResult(409, { error: 'Konfirmasi review konten wajib dicentang sebelum publish.' });
      }
      const gate = validateDraftApproval({ status: 'draft', needsReview: draft.needs_review, mode: 'auto', acknowledgeReview: true });
      if (!gate.allowed) {
        await client.query('ROLLBACK');
        transaction = false;
        return httpResult(409, { error: `Publikasi diblokir: ${gate.reason}.` });
      }
      await client.query("UPDATE drafts SET status = 'scheduled', needs_review = FALSE, updated_at = NOW() WHERE id = $1", [draftId]);
      await client.query("INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status) VALUES ($1, 'auto', NOW(), 'pending')", [draftId]);
      await client.query(
        "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'approved_auto', 'web_admin', $2)",
        [draftId, JSON.stringify({ scheduled_at: new Date().toISOString(), content_hash: contentHash, publish_now: true })],
      );
    } else {
      const { rows: existingApproval } = await client.query(
        `SELECT 1 FROM audit_log a
         WHERE a.entity = 'draft' AND a.entity_id = $1 AND a.action = 'approved_auto'
           AND a.created_at >= $2::timestamptz AND a.payload->>'content_hash' = $3
           AND (a.actor = 'web_admin' OR a.actor ~ '^telegram:[0-9]+$' OR ($4::boolean AND a.actor = 'owner_autopilot'))
         LIMIT 1`,
        [draftId, draft.updated_at, contentHash, Boolean(publishConfig.autopilotPublish)],
      );
      if (!existingApproval.length) {
        if (body?.reviewed !== true) {
          await client.query('ROLLBACK');
          transaction = false;
          return httpResult(409, { error: 'Konfirmasi review konten wajib dicentang sebelum publish.' });
        }
        await client.query('UPDATE drafts SET needs_review = FALSE WHERE id = $1 AND needs_review = TRUE', [draftId]);
        await client.query(
          "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'approved_auto', 'web_admin', $2)",
          [draftId, JSON.stringify({ scheduled_at: new Date().toISOString(), content_hash: contentHash, publish_now: true })],
        );
      }
      const { rowCount: updatedPending } = await client.query(
        `UPDATE scheduled_posts SET scheduled_at = LEAST(scheduled_at, NOW())
         WHERE draft_id = $1 AND status = 'pending' AND mode = 'auto'`,
        [draftId],
      );
      if (updatedPending === 0) {
        await client.query("INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status) VALUES ($1, 'auto', NOW(), 'pending')", [draftId]);
      }
      await client.query(
        `UPDATE publication_targets SET status = 'pending', error_message = NULL, updated_at = NOW()
         WHERE draft_id = $1 AND status IN ('failed', 'blocked')
           AND remote_id IS NULL AND container_id IS NULL AND publish_attempted_at IS NULL`,
        [draftId],
      );
    }

    await client.query('COMMIT');
    transaction = false;
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const summary = await createWorker({ pool, config: publishConfig }).runOnce({ draftId, resetShadow: true });
  const { rows: targets } = await pool.query(
    `SELECT id, platform, account_id, status, remote_id, container_id, permalink, error_message, attempts, published_at
     FROM publication_targets WHERE draft_id = $1 ORDER BY id ASC`,
    [draftId],
  );
  const { rows: [latestDraft] } = await pool.query('SELECT status FROM drafts WHERE id = $1', [draftId]);
  const draft_status = latestDraft?.status || 'scheduled';

  if (summary.published > 0) {
    const allPublished = targets.length > 0 && targets.every((t) => t.status === 'published');
    return httpResult(200, {
      status: allPublished ? 'published' : 'partial',
      draftId,
      draft_status,
      summary,
      targets,
    });
  }

  const error = targets.map((t) => t.error_message).filter(Boolean).join('; ') || 'Publikasi lintas platform gagal.';
  return httpResult(summary.blocked > 0 ? 409 : 502, {
    status: 'failed',
    error,
    draftId,
    draft_status,
    summary,
    targets,
  });
}
