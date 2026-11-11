// ==============================================================================
// Homeless Media Engine (HME) v2.2 - Studio Prompt Service
// File: /root/gapura/services/studio/studio.js
// Prompt-driven production: plan -> topic -> verify -> draft -> render ->
// telegram -> publish. Dijalankan sebagai job queue berbasis Postgres.
// ==============================================================================

import pkg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { callAgentLLM } from '../common/llm.js';
import { verifyTopic } from '../verificator/verificator.js';
import { produceSingleTopicDraft } from '../copywriter/copywriter.js';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const pool = new Pool({
  host: process.env.HME_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.HME_DB_PORT || '5432'),
  user: process.env.HME_DB_USER || 'hme_user',
  password: process.env.HME_DB_PASSWORD,
  database: process.env.HME_DB_NAME || 'hme',
});

// ------------------------------------------------------------------------------
// Logging per langkah: sumber progress UI (job_logs + audit_log).
// ------------------------------------------------------------------------------
export async function logStep(jobId, step, message, level = 'info') {
  await pool.query(
    'INSERT INTO job_logs (job_id, step, level, message) VALUES ($1, $2, $3, $4)',
    [jobId, step, level, String(message).slice(0, 2000)]
  );
  await pool.query('UPDATE prompt_jobs SET current_step = $2, updated_at = NOW() WHERE id = $1', [jobId, step]);
  console.log(`[Studio #${jobId}] ${step}: ${message}`);
}

async function failJob(jobId, step, err) {
  console.error(`[Studio #${jobId}] ${step} gagal:`, err);
  await pool.query(
    "UPDATE prompt_jobs SET status = 'failed', current_step = $2, error = $3, updated_at = NOW() WHERE id = $1",
    [jobId, step, String(err.message || err).slice(0, 2000)]
  );
  await logStep(jobId, step, `GAGAL: ${err.message || err}`, 'error');
  await pool.query(
    `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
     VALUES ('prompt_job', $1, 'error', 'studio-agent', $2)`,
    [jobId, JSON.stringify({ step, error: String(err.message || err).slice(0, 800) })]
  );
}

// ------------------------------------------------------------------------------
// Step 1: Perencanaan. LLM mengubah prompt admin menjadi rencana terstruktur
// yang bisa diedit/di-generate ulang sebelum produksi.
// ------------------------------------------------------------------------------
const PLAN_SCHEMA_HINT = `Balas HANYA JSON valid dengan bentuk:
{
  "title": "judul topik ringkas",
  "angle": "sudut pandang liputan",
  "goal": "tujuan konten (analisis mendalam | verifikasi fakta | perspektif alternatif | opini | info)",
  "sections": ["poin 1", "poin 2", "poin 3"],
  "verification_requested": true|false,
  "slide_count_hint": 5,
  "caption_tone": "editorial",
  "hashtags": ["#tag1", "#tag2"]
}`;

export async function createPlan(job) {
  await pool.query("UPDATE prompt_jobs SET status = 'planning', progress = 5, updated_at = NOW() WHERE id = $1", [job.id]);
  await logStep(job.id, 'planning', 'Menyusun rencana konten dari prompt admin...');

  const promptText = `Ubah permintaan admin berikut menjadi rencana konten carousel.
Permintaan admin:
"""
${job.prompt}
"""
${PLAN_SCHEMA_HINT}`;

  const raw = await callAgentLLM('studio', promptText, '', true);
  let plan;
  try {
    plan = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error('Rencana dari LLM bukan JSON valid.');
  }
  // ponytail: validasi minimal — trust boundary adalah LLM, tapi bentuk kecil.
  if (!plan.title || !Array.isArray(plan.sections) || plan.sections.length === 0) {
    throw new Error('Rencana tidak lengkap (title/sections wajib).');
  }

  await pool.query(
    "UPDATE prompt_jobs SET plan = $2, progress = 20, updated_at = NOW() WHERE id = $1",
    [job.id, JSON.stringify(plan)]
  );
  await logStep(job.id, 'planning', `Rencana siap: "${plan.title}" (${plan.sections.length} poin).`);
  return plan;
}

export async function regeneratePlan(jobId, extraInstruction = '') {
  const { rows } = await pool.query('SELECT * FROM prompt_jobs WHERE id = $1', [jobId]);
  if (rows.length === 0) throw new Error('Job tidak ditemukan');
  const job = rows[0];
  const promptText = `Ubah permintaan admin berikut menjadi rencana konten carousel.
Permintaan admin:
"""
${job.prompt}
"""
${extraInstruction ? `Instruksi revisi admin: ${extraInstruction}` : ''}
${PLAN_SCHEMA_HINT}`;
  const raw = await callAgentLLM('studio', promptText, '', true);
  const plan = JSON.parse(raw.replace(/```json|```/g, '').trim());
  if (!plan.title || !Array.isArray(plan.sections) || plan.sections.length === 0) {
    throw new Error('Rencana tidak lengkap (title/sections wajib).');
  }
  await pool.query('UPDATE prompt_jobs SET plan = $2, updated_at = NOW() WHERE id = $1', [jobId, JSON.stringify(plan)]);
  await logStep(jobId, 'planning', 'Rencana di-generate ulang.');
  return plan;
}

export async function updatePlan(jobId, plan) {
  if (!plan || !plan.title) throw new Error('Plan tidak valid');
  await pool.query('UPDATE prompt_jobs SET plan = $2, updated_at = NOW() WHERE id = $1', [jobId, JSON.stringify(plan)]);
  await logStep(jobId, 'planning', 'Rencana diperbarui manual oleh admin.');
  return plan;
}

// ------------------------------------------------------------------------------
// Step 2: Buat topik dari rencana (masuk jalur standar bursa topik).
// ------------------------------------------------------------------------------
async function createTopicFromPlan(job, plan) {
  const { rows } = await pool.query(
    `INSERT INTO topics (title, summary, url, primary_source, status, source_kind)
     VALUES ($1, $2, $3, $4, 'scored', 'studio')
     RETURNING id`,
    [
      plan.title,
      [plan.angle, plan.goal ? `Tujuan: ${plan.goal}` : '', plan.sections ? `Poin: ${plan.sections.join('; ')}` : '']
        .filter(Boolean).join(' ') || plan.title,
      null,
      'Studio Prompt',
    ]
  );
  const topicId = rows[0].id;
  await pool.query(
    `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
     VALUES ('topic', $1, 'created_studio_prompt', 'studio-agent', $2)`,
    [topicId, JSON.stringify({ job_id: job.id })]
  );
  await pool.query('UPDATE prompt_jobs SET topic_id = $2, updated_at = NOW() WHERE id = $1', [job.id, topicId]);
  return topicId;
}

// ------------------------------------------------------------------------------
// Eksekusi full job: planning sudah selesai -> topic -> verify -> draft.
// Publish (telegram + jadwal) hanya bila auto_publish.
// ------------------------------------------------------------------------------
export async function executeJob(jobId, { autoPublish = false } = {}) {
  const { rows } = await pool.query('SELECT * FROM prompt_jobs WHERE id = $1', [jobId]);
  if (rows.length === 0) throw new Error('Job tidak ditemukan');
  const job = rows[0];

  try {
    const plan = job.plan || (await createPlan(job));
    if (!job.plan) {
      // Rencana baru selesai -> berhenti untuk ACC admin (kecuali auto_publish).
      if (!autoPublish) {
        await pool.query("UPDATE prompt_jobs SET status = 'plan_review', progress = 25, updated_at = NOW() WHERE id = $1", [jobId]);
        await logStep(jobId, 'planning', 'Rencana menunggu ACC admin (edit / generate ulang / produksi).');
        return { awaiting_plan_review: true, plan };
      }
    }

    // 1. Topik
    let topicId = job.topic_id;
    if (!topicId) {
      await logStep(jobId, 'topic', 'Membuat topik dari rencana...');
      topicId = await createTopicFromPlan(job, plan);
    }
    const { rows: topicRows } = await pool.query('SELECT * FROM topics WHERE id = $1', [topicId]);
    const topic = topicRows[0];

    // 2. Verifikasi (jika diminta)
    let verification = null;
    if (plan.verification_requested) {
      await pool.query("UPDATE prompt_jobs SET status = 'verifying', progress = 40, updated_at = NOW() WHERE id = $1", [jobId]);
      await logStep(jobId, 'verifying', 'Menjalankan verifikasi fakta...');
      verification = await verifyTopic(topicId);
      if (verification?.id) {
        await pool.query('UPDATE prompt_jobs SET verification_id = $2, updated_at = NOW() WHERE id = $1', [jobId, verification.id]);
      }
      await logStep(jobId, 'verifying', `Verifikasi selesai: ${verification?.status || 'tanpa status'}.`);
      if (verification?.status === 'hoax_detected') {
        await pool.query(
          "UPDATE prompt_jobs SET status = 'failed', error = 'Konten terindikasi hoaks; produksi diblokir.', updated_at = NOW() WHERE id = $1",
          [jobId]
        );
        await logStep(jobId, 'verifying', 'Produksi diblokir: hoax_detected.', 'error');
        return { blocked: true, verification };
      }
    }

    // 3. Draft + render via jalur copywriter standar
    await pool.query("UPDATE prompt_jobs SET status = 'drafting', progress = 60, updated_at = NOW() WHERE id = $1", [jobId]);
    await logStep(jobId, 'drafting', 'Memproduksi draft carousel...');
    const { draft_id: draftId } = await produceSingleTopicDraft(topic);
    await pool.query('UPDATE prompt_jobs SET draft_id = $2, progress = 85, updated_at = NOW() WHERE id = $1', [jobId, draftId]);
    await logStep(jobId, 'drafting', `Draft #${draftId} siap.`);

    // 4. Dispatch Telegram untuk review admin
    await pool.query("UPDATE prompt_jobs SET status = 'dispatching', progress = 90, updated_at = NOW() WHERE id = $1", [jobId]);
    try {
      const { dispatchDraftToTelegram } = await import('../telegram/bot.js');
      await dispatchDraftToTelegram(draftId);
      await logStep(jobId, 'dispatching', 'Draft dikirim ke Telegram admin untuk review.');
    } catch (err) {
      await logStep(jobId, 'dispatching', `Telegram gagal (draft tetap ada): ${err.message}`, 'warn');
    }

    // 5. Auto publish = jadwal +3 jam (jalur standar publisher)
    if (autoPublish) {
      const scheduledAt = new Date(Date.now() + 3 * 3600 * 1000);
      await pool.query(
        `INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status) VALUES ($1, 'auto', $2, 'pending')`,
        [draftId, scheduledAt]
      );
      await pool.query("UPDATE drafts SET status = 'scheduled', updated_at = NOW() WHERE id = $1", [draftId]);
      await logStep(jobId, 'scheduling', `Draft dijadwalkan tayang ${scheduledAt.toISOString()}.`);
      await pool.query(
        "UPDATE prompt_jobs SET status = 'scheduled', progress = 100, updated_at = NOW() WHERE id = $1",
        [jobId]
      );
      return { draftId, scheduled: true, scheduledAt };
    }

    await pool.query(
      "UPDATE prompt_jobs SET status = 'review', progress = 100, updated_at = NOW() WHERE id = $1",
      [jobId]
    );
    await logStep(jobId, 'review', 'Job selesai; menunggu review admin di dashboard/Telegram.');
    return { draftId, scheduled: false };
  } catch (err) {
    await failJob(jobId, job.current_step || 'execute', err);
    throw err;
  }
}

// ------------------------------------------------------------------------------
// Worker loop: ambil job queued tertua, eksekusi. Dipanggil dari web server
// (setInterval) atau CLI.
// ------------------------------------------------------------------------------
let workerRunning = false;
export async function processQueuedJobs({ autoPublish = false } = {}) {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const { rows } = await pool.query(
      `UPDATE prompt_jobs SET status = 'planning', current_step = 'planning', updated_at = NOW()
       WHERE id = (SELECT id FROM prompt_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`
    );
    if (rows.length > 0) {
      await executeJob(rows[0].id, { autoPublish });
    }
  } catch (err) {
    console.error('[Studio] Worker error:', err);
  } finally {
    workerRunning = false;
  }
}

export async function listJobs({ limit = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT j.*, d.status AS draft_status
     FROM prompt_jobs j
     LEFT JOIN drafts d ON j.draft_id = d.id
     ORDER BY j.id DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getJob(jobId) {
  const { rows } = await pool.query('SELECT * FROM prompt_jobs WHERE id = $1', [jobId]);
  if (rows.length === 0) return null;
  const job = rows[0];
  const { rows: logs } = await pool.query('SELECT * FROM job_logs WHERE job_id = $1 ORDER BY id ASC', [jobId]);
  job.logs = logs;
  return job;
}

// CLI: node services/studio/studio.js  -> proses antrian sekali
const isCli = process.argv[1] && process.argv[1].endsWith('studio.js');
if (isCli) {
  processQueuedJobs().then(() => process.exit(0));
}
