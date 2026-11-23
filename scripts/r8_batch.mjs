#!/usr/bin/env node
// R8 acceptance batch runner (manual, operator-invoked).
//
// Produces N consecutive editorial-v2 drafts from eligible Analis-passed topics,
// sequentially and idempotently. It deliberately stops at needs_review=true:
// it never approves, schedules, publishes, or enables timers. A separate human
// review + separate publish mandate are still required (blueprint R8).
//
// A stage that fails on a transient provider blip (Gemini 5xx/timeout) or on a
// stochastic word-count gate leaves only a failed 0-slide draft, so the topic
// stays eligible for the next pass. `--passes` bounds those retries; a topic
// that fails every pass is reported once, under its topic id.
//
// Usage:  node scripts/r8_batch.mjs [--limit 20] [--passes 3] [--topic-delay-ms 10000] [--pass-delay-ms 65000] [--max-topic-attempts 2] [--dry-run] [--report <path>]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(path.join(root, 'services/web/package.json'));

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function intArg(name, fallback, min, max) {
  const raw = arg(name, null);
  if (raw === null || raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(Math.trunc(parsed), max)) : fallback;
}

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = intArg('--limit', 20, 1, 100);
const PASSES = intArg('--passes', 3, 1, 10);
// Gemini 3.5-flash emits transient UNAVAILABLE/429 bursts that last far longer
// than one retry. A short gap between topics reduces burst collisions across the
// 6-key pool, and a 65s inter-pass pause matches llm-pool.js 429 cooldown.
const TOPIC_DELAY_MS = intArg('--topic-delay-ms', 10000, 0, 120000);
const PASS_DELAY_MS = intArg('--pass-delay-ms', 65000, 0, 600000);
const MAX_TOPIC_ATTEMPTS = intArg('--max-topic-attempts', 2, 1, 5);
const INITIAL_EXCLUDED = (arg('--exclude', '') || '').split(',').map((v) => v.trim()).filter((v) => /^\d+$/.test(v));
const REPORT = path.resolve(arg('--report', path.join(root, 'storage/r8-batch-20261121/RUN_REPORT.json')));

// Operators run this manually. Background workers stay paused and the pipeline
// timers are not touched by this script.
process.env.GAPURA_DISABLE_WORKERS = 'true';
if (!process.env.GAPURA_ENV_FILE_MARKER) {
  const envFile = process.env.GAPURA_ENV_FILE || '/etc/gapura/runtime.env';
  try {
    const parsed = require('dotenv').parse(await fs.readFile(envFile, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) if (process.env[key] === undefined) process.env[key] = value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const { pool, produceSingleTopicDraft } = await import('../services/copywriter/copywriter.js');
const { loadAgentsConfig } = await import('../services/common/llm.js');

const threshold = loadAgentsConfig().analis?.min_score_threshold ?? 76;

async function listExistingR8Drafts() {
  const { rows } = await pool.query(
    `SELECT d.id AS draft_id, d.topic_id, COALESCE(t.desk, '') AS desk, left(t.title, 140) AS title,
            jsonb_array_length(d.slides) AS slides, d.article_metadata->'media'->>'mode' AS cover_mode
       FROM drafts d
       JOIN topics t ON t.id = d.topic_id
      WHERE d.status = 'draft' AND d.needs_review = TRUE AND d.copy_model = 'staged-editorial-v3'
      ORDER BY d.id ASC`,
  );
  return rows;
}

async function selectCandidates(limit, excludedIds = []) {
  const { rows } = await pool.query(
    `SELECT t.id, COALESCE(t.desk,'') AS desk, t.title, t.primary_source, t.url, s.score_total
       FROM topics t
       JOIN LATERAL (
         SELECT score_total, verdict FROM topic_scores
          WHERE topic_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1
       ) s ON TRUE
      WHERE t.status = 'scored' AND s.verdict = 'passed' AND s.score_total >= $2
        -- A topic whose only drafts are failed/rejected is still producible: a
        -- failed attempt leaves an incomplete 0-slide shell that must not block
        -- the retry (produce() inserts a fresh draft when no complete one exists).
        AND NOT EXISTS (
          SELECT 1 FROM drafts d
           WHERE d.topic_id = t.id AND d.status NOT IN ('failed', 'rejected')
        )
        AND NOT (t.id = ANY($3::bigint[]))
      ORDER BY (
        SELECT count(*) FROM drafts df
         WHERE df.topic_id = t.id AND df.status IN ('failed', 'rejected')
      ) ASC, s.score_total DESC, t.id ASC
      LIMIT $1`,
    [limit, threshold, excludedIds],
  );
  return rows;
}

async function attempt(topic) {
  const entry = { topic_id: topic.id, desk: topic.desk || null, score_total: topic.score_total, title: String(topic.title || '').slice(0, 140) };
  const at = Date.now();
  try {
    const result = await produceSingleTopicDraft(topic.id, pool, { storytelling: true });
    const { rows: [draft] } = await pool.query(
      'SELECT id, status, needs_review, copy_model, article_metadata, jsonb_array_length(slides) AS slides FROM drafts WHERE id=$1',
      [result.draft_id],
    );
    entry.draft_id = draft.id;
    entry.outcome = result.is_existing ? 'already_present' : 'produced';
    entry.status = draft.status;
    entry.needs_review = draft.needs_review;
    entry.slides = draft.slides;
    entry.copy_model = draft.copy_model;
    entry.pipeline_status = draft.article_metadata?.pipeline?.status || null;
    entry.cover_mode = draft.article_metadata?.media?.mode || null;
    if (!result.is_existing && draft.article_metadata?.pipeline?.status !== 'VALIDATED') entry.outcome = 'unvalidated';
  } catch (error) {
    const message = String(error?.message || error);
    entry.error = message.slice(0, 400);
    if (/source_material_insufficient/.test(message)) entry.outcome = 'blocked_material';
    else if (/illustration_|cover_/.test(message)) entry.outcome = 'blocked_visual';
    else entry.outcome = 'technical_failed';
  }
  entry.elapsed_ms = Date.now() - at;
  return entry;
}

const started = Date.now();
const existingBefore = await listExistingR8Drafts();
const report = {
  stage: 'R8',
  kind: 'manual_shadow_batch',
  started_at: new Date().toISOString(),
  limit: LIMIT,
  max_passes: PASSES,
  topic_delay_ms: TOPIC_DELAY_MS,
  pass_delay_ms: PASS_DELAY_MS,
  max_topic_attempts: MAX_TOPIC_ATTEMPTS,
  ...(INITIAL_EXCLUDED.length ? { initial_excluded: INITIAL_EXCLUDED } : {}),
  threshold,
  dry_run: DRY_RUN,
  publishing: { mode: process.env.META_PUBLISH_MODE || 'shadow', live_calls_made: 0, approval_performed: false },
  existing_r8_drafts_before_run: existingBefore,
  summary: { attempted: 0, succeeded: 0, blocked_material: 0, blocked_visual: 0, technical_failed: 0, already_present: 0, desks: {} },
  passes: [],
  drafts: [],
};

try {
  if (DRY_RUN) {
    const candidates = await selectCandidates(LIMIT, INITIAL_EXCLUDED);
    report.candidates_selected = candidates.length;
    report.candidate_ids = candidates.map((row) => row.id);
    report.candidates = candidates;
    report.status = 'dry_run_complete';
  } else {
    const finalByTopic = new Map();
    const failedAttemptsByTopic = new Map();
    for (let pass = 1; pass <= PASSES; pass++) {
      if (report.summary.succeeded >= LIMIT) break;
      if (pass > 1 && PASS_DELAY_MS > 0) {
        report.passes.push({ pass, waiting_ms: PASS_DELAY_MS });
        await new Promise((resolve) => { setTimeout(resolve, PASS_DELAY_MS); });
      }
      const remaining = LIMIT - report.summary.succeeded;
      const failedExhausted = [...failedAttemptsByTopic.entries()]
        .filter(([, count]) => count >= MAX_TOPIC_ATTEMPTS)
        .map(([topicId]) => topicId);
      const excludedIds = [...new Set([...INITIAL_EXCLUDED, ...failedExhausted])];
      const candidates = await selectCandidates(remaining, excludedIds);
      if (!candidates.length) {
        report.passes.push({ pass, selected: [], excluded_exhausted: excludedIds, note: 'no_eligible_candidates' });
        break;
      }
      report.passes.push({ pass, selected: candidates.map((row) => row.id), ...(excludedIds.length ? { excluded_exhausted: excludedIds } : {}) });
      for (const [index, topic] of candidates.entries()) {
        if (report.summary.succeeded >= LIMIT) break;
        if (index > 0 && TOPIC_DELAY_MS > 0) {
          await new Promise((resolve) => { setTimeout(resolve, TOPIC_DELAY_MS); });
        }
        report.summary.attempted += 1;
        const entry = await attempt(topic);
        entry.pass = pass;
        const previous = finalByTopic.get(topic.id);
        if (previous) entry.retries = (previous.retries || 0) + 1;
        finalByTopic.set(topic.id, entry);
        if (entry.outcome === 'already_present') report.summary.already_present += 1;
        else if (entry.outcome === 'produced') {
          report.summary.succeeded += 1;
          const deskKey = entry.desk || 'unassigned';
          report.summary.desks[deskKey] = (report.summary.desks[deskKey] || 0) + 1;
        } else {
          report.summary[entry.outcome] = (report.summary[entry.outcome] || 0) + 1;
          failedAttemptsByTopic.set(topic.id, (failedAttemptsByTopic.get(topic.id) || 0) + 1);
        }
        console.log(JSON.stringify(entry));
      }
    }
    report.drafts = [...finalByTopic.values()];
    report.unique_topics = finalByTopic.size;
    report.status = report.summary.succeeded >= LIMIT ? 'batch_complete' : 'batch_incomplete';
    if (report.status === 'batch_incomplete') process.exitCode = 2;
  }
} catch (error) {
  report.status = 'batch_aborted';
  report.fatal_error = String(error?.message || error).slice(0, 600);
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  report.elapsed_ms = Date.now() - started;
  await fs.mkdir(path.dirname(REPORT), { recursive: true, mode: 0o700 });
  await fs.writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ report: REPORT, status: report.status, summary: report.summary, elapsed_ms: report.elapsed_ms }));
  await pool.end();
}
