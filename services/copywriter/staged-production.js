import { createHash } from 'node:crypto';
import { isDraftComplete } from './editorial.js';
import { validateStudioTopic } from '../studio/validation.js';
import { loadAgentsConfig } from '../common/llm.js';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Commit each checkpoint independently. An incomplete shell can never pass review. */
export async function produceStagedTopic(topicId, { pool, editorialInput, sourceDocuments, buildContent, renderContent, options = {} }) {
  const client = await pool.connect();
  const lock = `gapura:topic:${topicId}`;
  let draftId; let checkpoint; let transaction = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock]);
    const { rows: [topic] } = await client.query(`SELECT t.*, ts.score_total, ts.verdict AS score_verdict
      FROM topics t LEFT JOIN LATERAL (SELECT score_total,verdict FROM topic_scores
        WHERE topic_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) ts ON TRUE WHERE t.id=$1`, [topicId]);
    if (!topic) throw new Error('topic_not_found');
    const eligibility = validateStudioTopic({ ...topic, ...(topic.status === 'produced' ? { status: 'scored' } : {}) }, loadAgentsConfig().analis?.min_score_threshold ?? 76);
    if (!eligibility.valid) throw new Error(eligibility.reason);
    const inputHash = hash([editorialInput, sourceDocuments || null, options.editorialBrief || null, 3]);
    const { rows: previous } = await client.query(`SELECT d.*, (SELECT count(*) FROM draft_slides s WHERE s.draft_id=d.id) AS rendered_count
      FROM drafts d WHERE d.topic_id=$1 ORDER BY d.id DESC`, [topicId]);
    const reusable = previous.find((row) => row.article_metadata?.pipeline?.input_hash === inputHash && row.copy_model === 'staged-editorial-v3');
    if (reusable && isDraftComplete(reusable) && !options.regenerate) return { draft_id: reusable.id, is_existing: true, slides_count: reusable.slides.length };
    if (reusable?.status === 'failed') {
      const { rows: busy } = await client.query(`SELECT 1 FROM publication_targets WHERE draft_id=$1
        AND (status IN ('publishing','unknown','published') OR publish_attempted_at IS NOT NULL OR remote_id IS NOT NULL)`, [reusable.id]);
      if (busy.length) throw new Error('draft_publication_requires_reconciliation');
      draftId = reusable.id;
      checkpoint = reusable.article_metadata.pipeline;
    } else {
      const { rows: [draft] } = await client.query(`INSERT INTO drafts(topic_id,slides,caption,hashtags,content_format,status,needs_review,copy_model,article_metadata)
        VALUES($1,'[]','', '{}','carousel','failed',TRUE,'staged-editorial-v3',$2) RETURNING id`,
      [topicId, JSON.stringify({ editorial_version: 2, pipeline: { version: 3, input_hash: inputHash, status: 'STARTED', stages: {} } })]);
      draftId = draft.id;
    }
    const saveCheckpoint = async (value) => {
      const pipeline = { ...value, version: 3, input_hash: inputHash, source_documents: sourceDocuments || null };
      await client.query(`UPDATE drafts SET article_metadata=jsonb_set(COALESCE(article_metadata,'{}'::jsonb),'{pipeline}',$2::jsonb),
        status='failed',needs_review=TRUE,updated_at=NOW() WHERE id=$1 AND status='failed'`, [draftId, JSON.stringify(pipeline)]);
      await options.saveCheckpoint?.(pipeline);
    };
    const content = await buildContent(topic, { ...options, storytelling: true, editorialInput, sourceDocuments, checkpoint, saveCheckpoint });
    content.article_metadata.pipeline = { ...content.article_metadata.pipeline, input_hash: inputHash, status: 'VALIDATED', source_documents: sourceDocuments || null };
    if (options.legalContext) content.article_metadata.legal_context = options.legalContext;
    // Render all files to an atomic staging directory before exposing any content.
    await client.query('BEGIN'); transaction = true;
    const rendered = await renderContent(client, draftId, content, { ...options, topicId });
    await client.query(`UPDATE drafts SET slides=$2,caption=$3,hashtags=$4,editorial_input=$5,editorial_mode=$6,
      caption_body=$7,threads_caption=$8,angle=$9,scope_note=$10,editorial_references=$11,
      article_body=$12,article_references=$13,article_facts=$14,article_metadata=$15,
      status='draft',needs_review=TRUE,updated_at=NOW() WHERE id=$1 AND status='failed'`,
    [draftId, JSON.stringify(content.slides), content.caption, content.hashtags, JSON.stringify(content.editorial_input), content.editorial_mode,
      content.caption_body, content.threads_caption, content.angle, content.scope_note, JSON.stringify(content.editorial_references),
      content.article_body, JSON.stringify(content.article_references), JSON.stringify(content.article_facts), JSON.stringify(content.article_metadata)]);
    await client.query("UPDATE topics SET status='produced',updated_at=NOW() WHERE id=$1", [topicId]);
    await client.query(`INSERT INTO audit_log(entity,entity_id,action,actor,payload)
      VALUES('draft',$1,'produced','staged-copywriter',$2)`, [draftId, JSON.stringify({ editorial_version: 2,
      original_editorial_brief: content.editorial_input, editorial_check: content.editorial_check,
      stage_receipts: Object.fromEntries(Object.entries(content.article_metadata.pipeline.stages || {}).map(([key, value]) => [key, value.receipt])),
      total_time_ms: rendered?.total_time_ms, publication_approved: false })]);
    await client.query('COMMIT'); transaction = false;
    return { draft_id: draftId, is_existing: false, slides_count: content.slides.length, format: 'carousel' };
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    if (draftId) await client.query(`UPDATE drafts SET needs_review=TRUE,status='failed',updated_at=NOW() WHERE id=$1 AND status IN ('failed','draft')`, [draftId]).catch(() => {});
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]).catch(() => {});
    client.release();
  }
}
