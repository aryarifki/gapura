// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Web Dashboard API Server
// File: /root/gapura/services/web/server.js
// Subdomain: gapura.avenia.my.id (Port 3005)
// ==============================================================================

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;
import yaml from 'js-yaml';
import { exec } from 'child_process';
import { isIP } from 'node:net';
import { createOriginGuard, mergeAgentConfig, redactAgentConfig } from './access.js';
import { isValidSignedStorageRequest } from '../common/storage-signature.js';
import { renderPayload, hasEditorialCover } from '../common/images.js';
import { validatePublicSourceUrl, parsePublicSourceUrl } from '../common/sources.js';
import { buildEditorialBrief, normalizeEditorialInput, validateOriginalContent } from '../common/original-editorial.js';
import { draftContentHash } from '../common/draft-revision.js';
import { validateDraftApproval } from '../common/editorial.js';
import { validateAgent, validateAgentConfig } from '../common/agent-config.js';
import { buildAttempts, loadProvidersConfig, saveProvidersConfig, validateProvidersConfig } from '../common/providers.js';
import { loadProviderSecrets, saveProviderSecret } from '../common/secret-store.js';
import { loadModelCache, providerInventory, refreshModels } from '../common/model-catalog.js';
import { saveSettings } from './settings-store.js';
import { DraftError, editDraft, validateSlides as validateDraftSlides } from './drafts.js';
import { createZip } from './export.js';
import { createScheduler } from './scheduler.js';
import { buildCarouselSlides, produceSingleTopicDraft, regenerateDraft } from '../copywriter/copywriter.js';
import { AGENT_KEYS, callAgentLLM, loadAgentsConfig, loadAgentSkills, saveAgentSkills } from '../common/llm.js';
import { runScout } from '../scout/scout.js';
import { validateSourceType } from '../scout/sources.js';
import { runSeoScan, listTrends, promoteTrendToTopic } from '../seo/seo.js';
import { buildTrendHealth } from '../seo/health.js';
import { createPlan, regeneratePlan, updatePlan, executeJob, processQueuedJobs, listJobs, getJob } from '../studio/studio.js';
import { validateStudioTopic } from '../studio/validation.js';
import { runtimeSecret } from '../common/runtime-secret.js';
import { createMetaIntegration } from './meta-integration.js';
import { createArticleReader } from '../scout/article-reader.js';
import { createTopicMaterialService } from '../scout/enrichment.js';
import { createIllustrationService, pinIllustrationSlides, loadIllustration, selectedIllustration, illustrationDescriptor } from '../designer/illustration-store.js';
import { illustrationConfiguration, ASSET_ID } from '../designer/illustrations.js';
import {
  ASSET_ID as MANUAL_ASSET_ID, MEDIA_KIND, RIGHTS_BASES,
  deleteManualMediaRaster, loadManualMedia, manualMediaDescriptor, parseManualUpload,
  readManualMedia, saveManualMediaRaster,
} from '../designer/manual-media.js';
import { randomUUID } from 'node:crypto';
import { createTopicClusterHandler } from './clusters.js';
import { normalizeDesk } from '../common/discovery.js';
import { assertNewsEditorialInput, createTopicEditorialInputLoader, resolveTopicEditorialInput } from '../copywriter/source-input.js';
import { computeNextPublishSlot, loadOccupiedPublishDates, loadPublishingScheduleConfig } from '../common/publish-schedule.js';
import { publishDraftNow } from './publish-now.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const accessGuardOptions = { publicOrigin: process.env.GAPURA_PUBLIC_ORIGIN || '' };
const app = express();
app.use('/api', createOriginGuard(accessGuardOptions));
// Manual uploads embed one bounded base64 raster, so this route parses its own
// JSON before the global 100kb parser would reject an otherwise valid body.
app.post('/api/topics/:id/media', express.json({ limit: '20mb' }), uploadManualMedia);
app.use(express.json());
app.use('/api', (req, res, next) => {
  if (Object.values(req.query).some((value) => typeof value !== 'string')) return res.status(400).json({ error: 'Parameter query harus berupa teks tunggal.' });
  return next();
});
app.param('id', (_req, res, next, value) => {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return res.status(400).json({ error: 'ID harus berupa bilangan bulat positif.' });
  return next();
});
app.param('agent', (_req, res, next, value) => {
  if (!AGENT_KEYS.includes(value)) return res.status(400).json({ error: 'Nama agen tidak valid.' });
  return next();
});

const PORT = parseInt(process.env.PORT || '3005', 10);
const HOST = '127.0.0.1';
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../storage');
const DESIGN_SYSTEM_PATH = process.env.DESIGN_SYSTEM_PATH || path.resolve(__dirname, '../../design-system');
const TOKENS_PATH = path.join(DESIGN_SYSTEM_PATH, 'tokens.yaml');
const AGENTS_CONFIG_PATH = process.env.AGENTS_CONFIG_PATH || path.resolve(__dirname, '../../config/agents.json');
const PROVIDERS_CONFIG_PATH = process.env.PROVIDERS_CONFIG_PATH || path.resolve(__dirname, '../../config/providers.json');
const RENDER_SERVICE_URL = process.env.RENDER_SERVICE_URL || 'http://127.0.0.1:3000';
const RENDER_SECRET = runtimeSecret('RENDER_SECRET', { testValue: 'isolated-render-test' });
const META_INTEGRATION_CONFIG = {
  appId: process.env.META_APP_ID || '',
  configId: process.env.META_UNIFIED_CONFIG_ID || '',
  appSecret: process.env.META_APP_SECRET || '',
  publicOrigin: process.env.GAPURA_PUBLIC_ORIGIN || process.env.APP_BASE_URL || '',
  redirectUri: process.env.META_UNIFIED_REDIRECT_URI || '',
  expectedInstagramId: process.env.META_INSTAGRAM_ACCOUNT_ID || '',
  connectionFile: process.env.GAPURA_META_CONNECTION || '/etc/gapura/meta-unified.json',
  graphVersion: process.env.META_UNIFIED_GRAPH_VERSION || 'v27.0',
};

const pool = new Pool({
  host: process.env.HME_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.HME_DB_PORT || '5432'),
  user: process.env.HME_DB_USER || 'hme_user',
  password: process.env.HME_DB_PASSWORD,
  database: process.env.HME_DB_NAME || 'hme',
});
const draftDependencies = { pool, renderUrl: RENDER_SERVICE_URL, renderSecret: RENDER_SECRET, storagePath: STORAGE_PATH };

function editorialError(res, error) {
  if (/original_|generation_required/u.test(error.message)) return res.status(422).json({ error: 'Naskah editorial belum valid. Periksa mode, catatan fakta dan rujukannya, lalu buat ulang. Mode explainer memakai fakta kosong; mode current memerlukan fakta beratribusi.' });
  if (/source_material_insufficient|source_material_url_invalid/u.test(error.message)) return res.status(422).json({ error: 'Riset web belum menemukan referensi publik yang memadai. Coba pindai ulang, periksa akses sumber, atau masukkan fakta dan URL yang sudah dikurasi.' });
  if (/needs_media|illustration_/u.test(error.message)) return res.status(409).json({ error: 'needs_media: Ilustrasi topik belum siap atau revisinya tidak cocok. Buat atau pilih ilustrasi topik sebelum produksi.' });
  if (/not_found|tidak ditemukan/u.test(error.message)) return res.status(404).json({ error: 'Topik, draf, atau job tidak ditemukan.' });
  if (/Render|render/u.test(error.message)) return res.status(502).json({ error: 'Render belum selesai. Tinjau status draf sebelum mencoba ulang.' });
  if (/Rencana perlu|Rencana harus|Poin sections|Format rencana|slide_count_hint|harus teks maksimal/u.test(error.message)) return res.status(422).json({ error: 'Periksa rencana: judul maksimal 120 karakter, 2-6 fokus editorial, format carousel dengan 3-9 slide, dan arahan berupa teks.' });
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  return res.status(409).json({ error: 'Permintaan belum dapat diproses. Periksa status, skor topik dan rencana editorial, lalu coba ulang.' });
}

function customOriginalContent(body) {
  const input = normalizeEditorialInput(body.editorial_input);
  if (body.editorial_mode !== input.mode) throw new Error('original_mode_mismatch');
  const brief = buildEditorialBrief({ title: body.title, url: body.source_url, primary_source: body.primary_source }, { editorialInput: input });
  const tags = Array.isArray(body.hashtags) ? body.hashtags : [];
  const tagSuffix = tags.length ? `\n\n${tags.join(' ')}` : '';
  const threads = typeof body.threads_caption === 'string' ? body.threads_caption : '';
  const references = body.editorial_references;
  const paragraphs = typeof body.caption_body === 'string' ? body.caption_body.split(/\n\s*\n/u) : [];
  if (!references || !Array.isArray(references.caption) || references.caption.length !== paragraphs.length || !Array.isArray(references.threads)) throw new Error('original_references_invalid');
  const blocks = paragraphs.map((text, index) => ({ ...references.caption[index], text }));
  const media = [];
  const slides = Array.isArray(body.slides) ? body.slides.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('original_slide_invalid');
    const { source, ...slide } = value;
    const { asset_id, asset_sha256, image_kind, disclosure_version, ...authoredData } = slide.data || {};
    const descriptor = { asset_id, asset_sha256, image_kind, disclosure_version };
    if (Object.values(descriptor).some((field) => field !== undefined)) {
      if (typeof asset_id !== 'string' || !ASSET_ID.test(asset_id)
          || (asset_sha256 !== undefined && (typeof asset_sha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(asset_sha256)))
          || (image_kind !== undefined && image_kind !== 'ai_generated') || (disclosure_version !== undefined && disclosure_version !== 1)) throw new Error('illustration_id_invalid');
      media.push(descriptor);
      slide.data = authoredData;
    } else media.push(null);
    return slide;
  }) : body.slides;
  const content = validateOriginalContent({ format: body.format, mode: input.mode, slides,
    angle: body.angle, scope_note: body.scope_note, article_blocks: body.article_blocks, article_metadata: body.article_metadata, caption_blocks: blocks,
    threads_body: tagSuffix && threads.endsWith(tagSuffix) ? threads.slice(0, -tagSuffix.length) : threads,
    threads_fact_ids: references.threads, article_body: body.article_body, article_fact_ids: references.article || body.article_fact_ids,
    hashtags: tags }, brief);
  if (body.caption !== content.caption || body.caption_body !== content.caption_body || body.threads_caption !== content.threads_caption) throw new Error('original_caption_mismatch');
  if (content.article_body.length < 1200 || (input.mode === 'current' && content.article_references.length < 3)) throw new DraftError('Artikel lengkap dan sumber yang memadai wajib tersedia sebelum draf dapat disimpan.', 422);
  // Descriptor ownership, readiness and the pinned hash are checked against the
  // selected topic by pinIllustrationSlides before any insert or raster fetch.
  return { ...content, slides: content.slides.map((slide, index) => media[index] ? { ...slide, data: { ...slide.data, ...media[index] } } : slide) };
}

async function writeAudit(entity, entityId, action, actor = 'web_admin', payload = {}) {
  try {
    await pool.query(
      'INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ($1, $2, $3, $4, $5)',
      [entity, entityId || 0, action, actor, JSON.stringify(payload)]
    );
  } catch (auditError) {
    // Jangan menutupi error utama jika database audit sedang bermasalah.
    console.error('[Audit] gagal menulis log:', auditError.message);
  }
}

const scheduler = createScheduler();
const topicMaterials = createTopicMaterialService({ pool, reader: createArticleReader() });
const topicEditorialLoader = createTopicEditorialInputLoader({ pool, reader: createArticleReader() });
const illustrations = createIllustrationService({ pool, storagePath: STORAGE_PATH });
const illustrationRequests = new Map();
let activeIllustrationRequests = 0;
const materialRequests = new Map();
let activeMaterialRequests = 0;

app.use('/integrations/meta', createMetaIntegration({ config: META_INTEGRATION_CONFIG }));

// Cache-Control & Anti-CDN Stale Middleware (Global)
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// Serve static assets with explicit no-cache
app.use('/storage', (req, res, next) => {
  if (!/^\/drafts\/[1-9]\d*\/slide_[1-9]\d*\.(png|jpg)$/.test(req.path)) return res.status(404).end();
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}, express.static(STORAGE_PATH));

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  },
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'gapura-dashboard', version: '2.0.0' });
});

if (process.env.NODE_ENV === 'test') {
  app.post('/__test/shutdown', (_req, res) => {
    res.status(204).end();
    setImmediate(() => server.close(() => process.exit(0)));
  });
}

app.get('/media/drafts/:draftId/slide_:slideNo.png', async (req, res) => {
  const draftId = Number.parseInt(req.params.draftId, 10);
  const slideNo = Number.parseInt(req.params.slideNo, 10);
  const expires = Number(req.query.expires);
  const signature = String(req.query.signature || '');
  const requestPath = `/storage/drafts/${draftId}/slide_${slideNo}.png`;
  if (!isValidSignedStorageRequest(requestPath, expires, signature, process.env.GAPURA_ADMIN_TOKEN || '')) {
    return res.status(403).json({ error: 'URL aset tidak valid atau sudah kedaluwarsa.' });
  }
  const filePath = path.join(STORAGE_PATH, 'drafts', String(draftId), `slide_${slideNo}.png`);
  return res.sendFile(filePath, (error) => { if (error && !res.headersSent) res.status(error.statusCode || 404).end(); });
});

// JPEG derivatives are what Instagram, Facebook, and Threads fetch. The PNG
// route above stays the dashboard preview.
app.get('/media/drafts/:draftId/slide_:slideNo.jpg', async (req, res) => {
  const draftId = Number.parseInt(req.params.draftId, 10);
  const slideNo = Number.parseInt(req.params.slideNo, 10);
  const expires = Number(req.query.expires);
  const signature = String(req.query.signature || '');
  const requestPath = `/storage/drafts/${draftId}/slide_${slideNo}.jpg`;
  if (!isValidSignedStorageRequest(requestPath, expires, signature, process.env.GAPURA_ADMIN_TOKEN || '')) {
    return res.status(403).json({ error: 'URL aset tidak valid atau sudah kedaluwarsa.' });
  }
  const filePath = path.join(STORAGE_PATH, 'drafts', String(draftId), `slide_${slideNo}.jpg`);
  return res.sendFile(filePath, (error) => { if (error && !res.headersSent) res.status(error.statusCode || 404).end(); });
});

// Log error/aksi dari browser agar tombol yang gagal dapat ditelusuri dari
// menu Log Aktivitas, bukan hanya dari console browser.
app.post('/api/client-log', async (req, res) => {
  const body = req.body || {};
  await writeAudit('web_ui', null, `client_${body.level || 'info'}`, 'web_browser', {
    action: body.action || 'unknown',
    message: String(body.message || '').slice(0, 1000),
    stack: body.stack ? String(body.stack).slice(0, 3000) : null,
    meta: body.meta || {},
    url: body.url || null,
    user_agent: req.get('user-agent') || null,
  });
  res.status(204).end();
});

// 1. Dashboard Stats
app.get('/api/stats', async (req, res) => {
  try {
    const rawRes = await pool.query("SELECT count(*) FROM raw_items WHERE fetched_at >= NOW() - INTERVAL '24 hours'");
    const topicsRes = await pool.query('SELECT count(*) FROM topics');
    const scoresRes = await pool.query("SELECT verdict, count(*) FROM topic_scores WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY verdict");
    const draftsRes = await pool.query("SELECT status, count(*) FROM drafts GROUP BY status");
    const schedRes = await pool.query("SELECT count(*) FROM scheduled_posts WHERE status = 'pending'");

    // Health includes the actual scheduler rather than a legacy workflow flag.
    let renderHealthy = false;
    try {
      const r = await fetch(`${RENDER_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
      renderHealthy = r.ok;
    } catch {}
    const scheduleHealth = await scheduler.status();

    const verdictCounts = {};
    scoresRes.rows.forEach((r) => { verdictCounts[r.verdict] = parseInt(r.count); });

    const draftCounts = {};
    draftsRes.rows.forEach((r) => { draftCounts[r.status] = parseInt(r.count); });

    res.json({
      raw_items: parseInt(rawRes.rows[0].count),
      topics: parseInt(topicsRes.rows[0].count),
      scores: verdictCounts,
      drafts: draftCounts,
      scheduled_posts: parseInt(schedRes.rows[0].count),
      services: {
        database: true,
        render: renderHealthy,
        scheduler: scheduleHealth.active,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Drafts List with Slides
app.get('/api/drafts', async (req, res) => {
  try {
    const { rows: drafts } = await pool.query(`
      SELECT d.*, t.title as topic_title, t.primary_source, t.url as source_url, ts.score_total, ts.reasoning as score_reason
      FROM drafts d
      JOIN topics t ON d.topic_id = t.id
      LEFT JOIN LATERAL (SELECT * FROM topic_scores WHERE topic_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) ts ON TRUE
      ORDER BY COALESCE(d.updated_at, d.created_at) DESC, d.id DESC
    `);

    // Fetch slides for each draft
    for (const d of drafts) {
      const { rows: slides } = await pool.query(
        'SELECT slide_no, layout, render_path, text_snapshot, data_snapshot FROM draft_slides WHERE draft_id = $1 ORDER BY slide_no ASC',
        [d.id]
      );
      d.rendered_slides = slides.map((s) => ({
        slide_no: s.slide_no,
        layout: s.layout,
        text: s.text_snapshot,
        data: s.data_snapshot,
        image_url: `/storage/drafts/${d.id}/slide_${s.slide_no}.png`,
      }));
    }

    res.json(drafts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. Single Draft Detail with Slides
app.get('/api/drafts/:id/export', async (req, res) => {
  try {
    const { buildDraftTextFiles } = await import('./article-export.js');
    const { rows: [draft] } = await pool.query('SELECT d.*, t.title AS topic_title FROM drafts d JOIN topics t ON t.id=d.topic_id WHERE d.id=$1', [req.params.id]);
    if (!draft) return res.status(404).json({ error: 'Draf tidak ditemukan.' });
    const { rows: slides } = await pool.query('SELECT slide_no FROM draft_slides WHERE draft_id=$1 ORDER BY slide_no', [req.params.id]);
    if (!slides.length || slides.length !== draft.slides.length) return res.status(409).json({ error: 'Render belum lengkap. Render ulang sebelum ekspor.' });
    const files = buildDraftTextFiles(draft);
    for (const { slide_no } of slides) files.push({ name: `slide_${slide_no}.png`, data: await fs.promises.readFile(path.join(STORAGE_PATH, 'drafts', req.params.id, `slide_${slide_no}.png`)) });
    res.set('Content-Disposition', `attachment; filename="Gapura_Draft_${req.params.id}.zip"`);
    res.type('application/zip').send(createZip(files));
  } catch (error) { res.status(error.code === 'ENOENT' ? 409 : 500).json({ error: error.code === 'ENOENT' ? 'Aset belum tersedia. Render ulang draf.' : error.message }); }
});

app.get('/api/drafts/:id', async (req, res) => {
  const draftId = parseInt(req.params.id);
  try {
    const { rows: drafts } = await pool.query(`
      SELECT d.*, t.id as topic_id, t.title as topic_title, t.summary as topic_summary, t.primary_source, t.url as source_url, ts.score_total, ts.reasoning as score_reason
      FROM drafts d
      JOIN topics t ON d.topic_id = t.id
      LEFT JOIN LATERAL (SELECT * FROM topic_scores WHERE topic_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) ts ON TRUE
      WHERE d.id = $1
    `, [draftId]);

    if (drafts.length === 0) {
      return res.status(404).json({ error: 'Draf tidak ditemukan' });
    }

    const d = drafts[0];
    for (const field of ['editorial_input', 'editorial_references', 'article_references', 'article_facts']) {
      if (typeof d[field] === 'string') {
        try { d[field] = JSON.parse(d[field]); } catch { if (field === 'article_facts' || field === 'article_references') d[field] = []; }
      }
    }
    d.revision = draftContentHash(d);
    const { rows: slides } = await pool.query(
      'SELECT slide_no, layout, render_path, text_snapshot, data_snapshot FROM draft_slides WHERE draft_id = $1 ORDER BY slide_no ASC',
      [d.id]
    );

    d.rendered_slides = slides.map((s) => ({
      slide_no: s.slide_no,
      layout: s.layout,
      text: s.text_snapshot,
      data: s.data_snapshot,
      image_url: `/storage/drafts/${d.id}/slide_${s.slide_no}.png`,
    }));

    const { rows: publicationTargets } = await pool.query(
      `SELECT id, platform, account_id, status, remote_id, container_id, permalink, error_message, attempts, published_at
       FROM publication_targets WHERE draft_id = $1 ORDER BY id ASC`,
      [d.id],
    );
    const { rows: [latestSchedule] } = await pool.query(
      `SELECT id, status, scheduled_at, published_at FROM scheduled_posts
       WHERE draft_id = $1 ORDER BY id DESC LIMIT 1`,
      [d.id],
    );
    d.publication_targets = publicationTargets;
    d.latest_schedule = latestSchedule || null;

    res.json(d);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2c. Regenerate Draft Carousel via AI Designer
app.post('/api/drafts/:id/regenerate-ai', async (req, res) => {
  const draftId = parseInt(req.params.id);
  try {
    const { rows: [current] } = await pool.query('SELECT topic_id, editorial_input FROM drafts WHERE id=$1', [draftId]);
    if (!current) return res.status(404).json({ error: 'Draf tidak ditemukan.' });
    const options = req.body?.editorial_input === undefined ? {} : { editorialInput: normalizeEditorialInput(req.body.editorial_input) };
    const result = await regenerateDraft(draftId, pool, options);
    const { rows: [draft] } = await pool.query('SELECT caption,hashtags,editorial_input,editorial_mode,editorial_references,caption_body,threads_caption,angle,scope_note,article_body,article_references,article_facts,article_metadata FROM drafts WHERE id=$1', [draftId]);
    const { rows: slides } = await pool.query('SELECT slide_no,layout,text_snapshot AS text,data_snapshot AS data FROM draft_slides WHERE draft_id=$1 ORDER BY slide_no', [draftId]);
    res.json({ status: 'success', ...result, ...draft, needs_review: true, rendered_slides: slides.map((slide) => ({ ...slide, image_url: `/storage/drafts/${draftId}/slide_${slide.slide_no}.png` })) });
  } catch (err) {
    console.error('[Web API] Error regenerating draft:', err);
    return editorialError(res, err);
  }
});

// 2d. On-the-fly AI Slide Generator (Studio Desain & Playground)
app.post('/api/designer/generate-slides', async (req, res) => {
  const { title, primary_source, url } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 240) {
    return res.status(400).json({ error: 'Judul / topik berita wajib diisi.' });
  }
  try {
    const sourceUrl = String(url || '').trim();
    const sourceError = validatePublicSourceUrl(sourceUrl);
    if (sourceError) return res.status(400).json({ error: `URL sumber primer wajib valid: ${sourceError}` });
    const topicId = Number(req.body?.topic_id);
    const topic = topicId > 0 ? await pool.query(`SELECT t.*, ts.score_total, ts.verdict AS score_verdict
      FROM topics t LEFT JOIN LATERAL (SELECT score_total, verdict FROM topic_scores WHERE topic_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) ts ON TRUE
      WHERE t.id=$1`, [topicId]).then(({ rows: [row] }) => row) : null;
    if (topicId > 0 && !topic) return res.status(404).json({ error: 'Topik tidak ditemukan.' });
    if (topicId > 0) {
      const eligibility = validateStudioTopic({ ...topic, ...(topic.status === 'produced' ? { status: 'scored' } : {}) }, loadAgentsConfig().analis?.min_score_threshold ?? 76);
      if (!eligibility.valid || topic.score_verdict !== 'passed') return res.status(409).json({ error: 'Pilih topik yang lolos skor Analis dan memiliki sumber primer.' });
    }
    const editorialInput = topicId > 0
      ? await resolveTopicEditorialInput(topicEditorialLoader, topicId, req.body?.editorial_input)
      : normalizeEditorialInput(req.body?.editorial_input);
    if (editorialInput.mode === 'current') assertNewsEditorialInput(editorialInput);
    const generationTopic = topic || {
      title: title.trim(),
      primary_source: typeof primary_source === 'string' ? primary_source.trim().slice(0, 100) : '',
      url: sourceUrl,
    };
    const content = await buildCarouselSlides(generationTopic, { editorialInput });
    res.json({ status: 'success', ...content });
  } catch (err) {
    console.error('[Web API] Error generating slides via AI Designer:', err);
    return editorialError(res, err);
  }
});

// 2e. Create Draft & Slides from Custom Studio Design
app.post('/api/drafts/create-from-custom', async (req, res) => {
  const { title, summary, primary_source, source_url, slides, caption, hashtags, format } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 240 || !Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: 'Data draf tidak lengkap atau slide kosong.' });
  }
  if (validatePublicSourceUrl(source_url)) return res.status(400).json({ error: 'Sumber primer HTTPS yang dapat diverifikasi wajib diisi.' });
  let original = null;
  try {
    if (req.body.editorial_mode !== undefined || req.body.editorial_input !== undefined) original = customOriginalContent(req.body);
    else if (!(format === 'single' && slides.length === 1) && (slides.length < 3 || slides.length > 9)) throw new Error('original_slide_count_invalid');
    if (!original) throw new DraftError('Naskah custom belum memenuhi kontrak carousel berita dan caption; buat ulang melalui generator berita berbahan sumber.', 422);
    if (original.editorial_mode === 'current') assertNewsEditorialInput(original.editorial_input);
  } catch (error) { return editorialError(res, error); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let topicId = req.body.topic_id;
    if (topicId !== undefined && (!Number.isSafeInteger(topicId) || topicId < 1)) throw new DraftError('topic_id harus bilangan bulat positif.');
    if (topicId) {
      const { rows } = await client.query('SELECT id FROM topics WHERE id=$1', [topicId]);
      if (!rows.length) throw new DraftError('Topik tidak ditemukan.', 404);
    } else {
      const { rows: [topic] } = await client.query(
        `INSERT INTO topics (title,summary,primary_source,url,status,source_kind) VALUES($1,$2,$3,$4,'new','custom_studio') RETURNING id`,
        [title, summary || '', primary_source || parsePublicSourceUrl(source_url).sourceName, source_url]);
      topicId = topic.id;
    }
    let pinnedSlides = await pinIllustrationSlides(validateDraftSlides(original?.slides || slides), { client, topic_id: topicId });
    if (!pinnedSlides[0].data.asset_id) {
      const asset = await selectedIllustration(client, topicId);
      if (asset) pinnedSlides[0].data = { ...pinnedSlides[0].data, ...illustrationDescriptor(asset) };
    }
    // 2. Simpan draft as a review-only design preview; it is not marked as scored.
    const defaultCaption = original.caption;
    const defaultHashtags = original?.hashtags || (Array.isArray(hashtags) && hashtags.length > 0 ? hashtags : ['#GapuraMedia', '#BeritaNasional', '#IsuPublik', '#Indonesia']);

    const { rows: draftRows } = await client.query(
      `INSERT INTO drafts (topic_id, slides, content_format, caption, hashtags, disclaimer_type, status, needs_review, tokens_version, copy_model, article_body, article_references, article_facts)
        VALUES ($1, $2, $3, $4, $5, NULL, 'draft', true, 'v1.0', 'original-editorial-v1', $6, $7, $8) RETURNING id`,
      [topicId, JSON.stringify(pinnedSlides), req.body?.format === 'single' && slides.length === 1 ? 'single' : 'carousel', defaultCaption, defaultHashtags, original.article_body || null, JSON.stringify(original.article_references || []), JSON.stringify(original.article_facts || [])]
    );
    const draftId = draftRows[0].id;
    if (original) await client.query(
      'UPDATE drafts SET editorial_input=$2,editorial_mode=$3,caption_body=$4,threads_caption=$5,angle=$6,scope_note=$7,editorial_references=$8,article_body=$9,article_references=$10,article_facts=$11,article_metadata=$12 WHERE id=$1',
      [draftId, JSON.stringify(original.editorial_input), original.editorial_mode, original.caption_body, original.threads_caption, original.angle, original.scope_note, JSON.stringify(original.editorial_references), original.article_body || null, JSON.stringify(original.article_references || []), JSON.stringify(original.article_facts || []), original.article_metadata ? JSON.stringify(original.article_metadata) : null]);

    // 3. Render slides
    const renderResp = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Render-Secret': RENDER_SECRET,
      },
      body: JSON.stringify({
        draft_id: draftId,
        slides: await renderPayload(pinnedSlides, { storagePath: STORAGE_PATH, resolveAsset: (id) => loadIllustration(client, id, { topic_id: topicId }), resolveMedia: (id) => loadManualMedia(client, id, { topic_id: topicId }) }),
      }),
    });

    if (!renderResp.ok) {
      const errText = await renderResp.text();
      throw new Error(`Render Service error: HTTP ${renderResp.status} - ${errText}`);
    }

    const renderData = await renderResp.json();

    // 4. Simpan ke draft_slides
    for (const slideRes of renderData.rendered_slides) {
      await client.query(
        `INSERT INTO draft_slides (draft_id, slide_no, layout, render_path, text_snapshot, data_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          draftId,
          slideRes.slide_no,
          slideRes.layout,
          slideRes.file_path,
          slides[slideRes.slide_no - 1]?.teks || '',
          JSON.stringify(pinnedSlides[slideRes.slide_no - 1]?.data || {}),
        ]
      );
    }

    // 5. Catat audit_log
    await client.query(
      `INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'created_custom_studio', 'studio_editor', $2)`,
      [draftId, JSON.stringify({ topic_id: topicId, slides_count: slides.length })]
    );

    await client.query('COMMIT');
    res.json({
      status: 'success',
      draft_id: draftId,
      slides_count: slides.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Web API] Error creating custom draft:', err);
    return editorialError(res, err);
  } finally { client.release(); }
});

// 3. Approve Draft
app.post('/api/drafts/:id/approve', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { mode = 'auto' } = req.body; // 'auto' or 'manual'

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: lockedDrafts } = await client.query(
        `SELECT d.*, t.id AS topic_id FROM drafts d
         JOIN topics t ON t.id = d.topic_id WHERE d.id = $1 FOR UPDATE OF d`, [draftId]
      );
      if (!lockedDrafts.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Draf tidak ditemukan.' });
      }
      const contentHash = draftContentHash(lockedDrafts[0]);
      if (req.body.expected_revision !== contentHash) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Draf telah berubah. Muat ulang dan tinjau konten terbaru sebelum menyetujui.' });
      }
      if (req.body.reviewed !== true) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Konfirmasi review konten wajib diisi sebelum menyetujui.' });
      }
      // Explicit typography is a valid editorial fallback when no licensed photo fits.
      if (!hasEditorialCover(lockedDrafts[0].slides)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cover wajib memiliki gambar berlisensi atau desain tipografi editorial eksplisit sebelum disetujui.' });
      }
      if (lockedDrafts[0].copy_model === 'studio-ai-designer') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Draf lama belum memenuhi kontrak berita bersumber. Buat ulang melalui generator berita dan tinjau isi serta caption lengkap sebelum menyetujui.' });
      }
      if (lockedDrafts[0].editorial_input != null
        && (typeof lockedDrafts[0].article_body !== 'string' || lockedDrafts[0].article_body.trim().length < 1200
          || (lockedDrafts[0].editorial_mode === 'current'
            && (!Array.isArray(lockedDrafts[0].article_references) || lockedDrafts[0].article_references.length < 3)))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Artikel berita lengkap atau rujukan riset web belum tersedia; buat ulang melalui riset web sebelum review.' });
      }
      if (lockedDrafts[0].copy_model === 'staged-editorial-v3' && lockedDrafts[0].article_metadata?.pipeline?.status !== 'VALIDATED') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Tahap editorial belum lengkap. Lanjutkan dari checkpoint sebelum review.' });
      }
      const gate = validateDraftApproval({
        status: lockedDrafts[0].status,
        needsReview: lockedDrafts[0].needs_review,
        mode,
        acknowledgeReview: req.body.reviewed === true,
      });
      if (!gate.allowed) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Persetujuan diblokir: ${gate.reason}.` });
      }
      if (lockedDrafts[0].status !== 'draft') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Draf sudah diproses atau tidak lagi dapat disetujui.' });
      }

      if (mode === 'auto') {
        let scheduledAt;
        let slotWib = null;
        try {
          const schedCfg = await loadPublishingScheduleConfig(client);
          const occupied = await loadOccupiedPublishDates(client);
          const slot = computeNextPublishSlot({ hoursWib: schedCfg.hoursWib, occupiedDates: occupied, dailyLimit: schedCfg.dailyLimit });
          scheduledAt = slot.scheduledAt;
          slotWib = slot.slotWib;
        } catch {
          scheduledAt = new Date(Date.now() + 3 * 3600 * 1000);
        }
        await client.query("UPDATE drafts SET status = 'scheduled', needs_review=FALSE, updated_at = NOW() WHERE id = $1", [draftId]);
        await client.query(
          "INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status) VALUES ($1, 'auto', $2, 'pending')",
          [draftId, scheduledAt]
        );
        await client.query(
          "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'approved_auto', 'web_admin', $2)",
          [draftId, JSON.stringify({ scheduled_at: scheduledAt, ...(slotWib ? { slot_wib: slotWib } : {}), content_hash: contentHash })]
        );
      } else {
        await client.query("UPDATE drafts SET status = 'published', updated_at = NOW() WHERE id = $1", [draftId]);
        await client.query(
          "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'published_manual', 'web_admin', $2)",
          [draftId, JSON.stringify({ content_hash: contentHash })]
        );
      }
      await client.query('COMMIT');
    } catch (transactionError) {
      await client.query('ROLLBACK').catch(() => {});
      throw transactionError;
    } finally {
      client.release();
    }

    res.json({ status: 'success', draftId, mode, published: mode === 'manual' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3b. Publish Draft Immediately Across Active Meta Platforms
app.post('/api/drafts/:id/publish-now', async (req, res) => {
  const draftId = parseInt(req.params.id, 10);
  try {
    const result = await publishDraftNow({ pool, draftId, body: req.body || {} });
    return res.status(result.httpStatus).json(result.body);
  } catch (err) {
    console.error('[Web API] Error publishing draft now:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. Reject Draft
app.post('/api/drafts/:id/reject', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { reason = 'Ditolak via web dashboard' } = req.body;

  try {
    const { rowCount } = await pool.query("UPDATE drafts SET status = 'rejected', updated_at = NOW() WHERE id = $1 AND status IN ('draft','scheduled','approved') RETURNING id", [draftId]);
    if (rowCount !== 1) return res.status(409).json({ error: 'Draf sudah diproses atau tidak lagi dapat ditolak.' });
    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'rejected', 'web_admin', $2)",
      [draftId, JSON.stringify({ reason })]
    );

    res.json({ status: 'success', draftId, reason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Edit Slide (Text, Layout & Data) & Re-render
app.post('/api/drafts/:id/edit-slide', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { slide_no, new_text, layout, data, category, source } = req.body;
  try {
    if (!Number.isInteger(slide_no) || slide_no < 1) throw new DraftError('Nomor slide tidak valid.');
    const result = await editDraft(draftId, (draft) => {
      const slide = draft.slides[slide_no - 1];
      if (!slide) throw new DraftError('Slide tidak ditemukan.');
      if (new_text !== undefined) slide.teks = new_text;
      if (layout) slide.layout = layout;
      if (data !== undefined) slide.data = data;
      if (category) slide.data = { ...slide.data, category };
      if (source) slide.source = source;
      return { slides: draft.slides, preserveIllustrations: true };
    }, draftDependencies);
    res.json({ status: 'success', draftId, slide_no, layout: result.slides[slide_no - 1].layout, data: result.slides[slide_no - 1].data, image_url: `/storage/drafts/${draftId}/slide_${slide_no}.png?t=${Date.now()}`, needs_review: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/drafts/:id/illustration', async (req, res) => {
  if (!req.body || Array.isArray(req.body) || Object.keys(req.body).some((key) => key !== 'asset_id') || !ASSET_ID.test(String(req.body.asset_id))) return res.status(400).json({ error: 'asset_id UUID wajib diisi.' });
  try {
    const result = await editDraft(Number(req.params.id), async (draft, client) => {
      const asset = await loadIllustration(client, req.body.asset_id, { topic_id: draft.topic_id });
      const { image_url, image_data, asset_id, asset_sha256, ...data } = draft.slides[0]?.data || {};
      draft.slides[0].data = { ...data, asset_id: asset.id };
      return { slides: draft.slides };
    }, { ...draftDependencies, replaceIllustration: true });
    return res.json({ status: 'success', asset_id: result.slides[0].data.asset_id, needs_review: true });
  } catch (error) { return res.status(error.statusCode || (/^illustration_/u.test(error.message) ? 409 : 500)).json({ error: /^illustration_/u.test(error.message) ? 'Ilustrasi tidak tersedia untuk topik draf ini.' : error.message }); }
});

// 5a. Add Slide to Draft
app.post('/api/drafts/:id/add-slide', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { layout = 'big-statement', teks = 'Poin penting tambahan...', data = {} } = req.body;

  try {
    const result = await editDraft(draftId, (draft) => {
      draft.slides.push({ no: draft.slides.length + 1, layout, teks, data, source: '@gapuramedia' });
      return { slides: draft.slides };
    }, draftDependencies);
    res.json({ status: 'success', draftId, new_slide_no: result.slides.length, total_slides: result.slides.length, needs_review: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 5b. Delete Slide from Draft
app.post('/api/drafts/:id/delete-slide', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { slide_no } = req.body;

  try {
    const result = await editDraft(draftId, (draft) => {
      if (!Number.isInteger(slide_no) || slide_no < 1 || slide_no > draft.slides.length) throw new DraftError('Nomor slide tidak valid.');
      if (draft.slides.length === 1) throw new DraftError('Draf minimal memiliki satu slide.');
      if (slide_no === 1 && draft.slides[0].data?.asset_id) throw new DraftError('Cover ilustrasi dipertahankan; ubah isi atau ganti visual melalui kontrol ilustrasi.', 409);
      draft.slides.splice(slide_no - 1, 1);
      return { slides: draft.slides };
    }, draftDependencies);
    res.json({ status: 'success', draftId, total_slides: result.slides.length, needs_review: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 5b. Update Draft Full (caption, slides, schedule)
app.post('/api/drafts/:id/update-full', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { caption, slides, hashtags, scheduled_at } = req.body;
  try {
    if (scheduled_at) throw new DraftError('Simpan perubahan terlebih dahulu, lalu setujui melalui tombol jadwalkan.');
    if (caption === undefined && slides === undefined && hashtags === undefined) throw new DraftError('Tidak ada perubahan yang dikirim.');
    await editDraft(draftId, (draft) => ({ slides: slides ?? draft.slides, caption: caption ?? draft.caption, hashtags: hashtags ?? draft.hashtags, render: slides !== undefined }), draftDependencies);
    res.json({ status: 'success', draftId });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 6. Topics List with Scores
app.get('/api/topics', async (req, res) => {
  const { status, limit = 50, offset = 0, q = '', sort = 'newest', desk = '' } = req.query;
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 40));
  const pageOffset = Math.max(0, Math.min(1000000, Number.parseInt(offset, 10) || 0));
  if (status && !['new', 'scored', 'rejected', 'produced', 'archived'].includes(status)) {
    return res.status(400).json({ error: 'Status topik tidak valid.' });
  }
  if (String(desk) && !normalizeDesk(String(desk))) return res.status(400).json({ error: 'Desk topik tidak valid.' });
  if (String(q).length > 200) return res.status(400).json({ error: 'Kueri pencarian maksimal 200 karakter.' });
  try {
    let query = `
      SELECT t.*, ts.score_relevance, ts.score_credibility, ts.score_momentum, ts.score_engagement, ts.score_compliance, ts.score_total, ts.verdict, ts.reasoning
      FROM topics t
      LEFT JOIN LATERAL (SELECT s.* FROM topic_scores s WHERE s.topic_id = t.id ORDER BY s.id DESC LIMIT 1) ts ON TRUE
    `;
    const params = [];
    const filters = [];
    if (status) {
      params.push(status);
      filters.push(`t.status = $${params.length}`);
    }
    if (desk) {
      params.push(String(desk).trim().toLocaleLowerCase('id'));
      filters.push(`t.desk = $${params.length}`);
    }
    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      filters.push(`(t.title ILIKE $${params.length} OR COALESCE(t.summary, '') ILIKE $${params.length} OR COALESCE(t.primary_source, '') ILIKE $${params.length})`);
    }
    if (filters.length) query += ` WHERE ${filters.join(' AND ')} `;
    const orderBy = sort === 'score' ? 'COALESCE(ts.score_total, 0) DESC, t.id DESC'
      : sort === 'trend' ? 'COALESCE(t.trend_score, 0) DESC, t.id DESC' : 't.id DESC';
    query += ` ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2} `;
    params.push(pageSize + 1, pageOffset);

    const { rows } = await pool.query(query, params);
    const hasMore = rows.length > pageSize;
    const results = hasMore ? rows.slice(0, pageSize) : rows;
    res.set('X-Has-More', String(hasMore));
    res.set('X-Next-Offset', String(pageOffset + results.length));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6b. Topic event cluster (discovery metadata only)
app.get('/api/topics/:id/cluster', createTopicClusterHandler({ pool }));

// 7. Promote Topic to Copywriter Pipeline
app.get('/api/topics/:id/material', async (req, res) => {
  try {
    const { rows: [topic] } = await pool.query('SELECT * FROM topics WHERE id=$1', [req.params.id]);
    if (!topic) return res.status(404).json({ error: 'Topik tidak ditemukan.' });
    const snapshot = await topicMaterials.latest(req.params.id);
    const { rows: [score] } = await pool.query('SELECT verdict FROM topic_scores WHERE topic_id=$1 ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 1', [req.params.id]);
    const { rows: drafts } = await pool.query('SELECT id FROM drafts WHERE topic_id=$1 LIMIT 1', [req.params.id]);
    const warnings = [];
    if (!snapshot) warnings.push('Materi artikel belum diambil; ringkasan Radar tidak dianggap body lengkap.');
    else if (snapshot.material.extraction.status !== 'full') warnings.push(`Status materi: ${snapshot.material.extraction.status}.`);
    if (score?.verdict !== 'passed') warnings.push('Topik belum lolos Analis.');
    if (!drafts.length) warnings.push('Copywriter belum memproduksi draf.');
    return res.json({ topic, material: snapshot?.material || null, material_id: snapshot?.id || null, content_hash: snapshot?.content_hash || null, warnings });
  } catch {
    return res.status(500).json({ error: 'Materi topik tidak dapat dibaca.' });
  }
});

app.get('/api/topics/:id/illustration', async (req, res) => {
  try {
    const result = await illustrations.list(req.params.id);
    let configured = false;
    try { illustrationConfiguration(); configured = true; } catch { /* Missing configuration is shown without exposing keys. */ }
    return res.json({ ...result, configured });
  } catch (error) { return res.status(error.message === 'topic_not_found' ? 404 : 500).json({ error: error.message === 'topic_not_found' ? 'Topik tidak ditemukan.' : 'Ilustrasi tidak dapat dibaca.' }); }
});

app.post('/api/topics/:id/illustration/generate', async (req, res) => {
  const body = req.body;
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => !['request_id', 'regenerate'].includes(key))
    || !ASSET_ID.test(String(body.request_id)) || (body.regenerate !== undefined && typeof body.regenerate !== 'boolean')) {
    return res.status(400).json({ error: 'request_id UUID wajib diisi; hanya regenerate boolean yang dapat ditambahkan.' });
  }
  const now = Date.now();
  for (const [key, entry] of illustrationRequests) if (entry.expiresAt <= now) illustrationRequests.delete(key);
  const peer = req.socket.remoteAddress || 'unknown';
  const forwarded = req.get('cf-connecting-ip') || '';
  const address = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) && isIP(forwarded) ? forwarded : peer;
  const entry = illustrationRequests.get(address) || { count: 0, expiresAt: now + 10 * 60 * 1000 };
  if (activeIllustrationRequests >= 2 || entry.count >= 5 || (!illustrationRequests.has(address) && illustrationRequests.size >= 1000)) return res.status(429).json({ error: 'Batas pembuatan ilustrasi tercapai. Coba lagi setelah permintaan selesai.' });
  entry.count++;
  illustrationRequests.set(address, entry);
  activeIllustrationRequests++;
  try {
    const result = await illustrations.generate(req.params.id, body);
    await writeAudit('topic', Number(req.params.id), 'illustration_generated', 'web_admin', { asset_id: result.asset.id, status: result.asset.status, is_existing: result.is_existing });
    return res.json(result);
  } catch (error) {
    const status = error.message === 'topic_not_found' ? 404 : error.message === 'illustration_busy' ? 409 : 500;
    return res.status(status).json({ error: status === 404 ? 'Topik tidak ditemukan.' : status === 409 ? 'Ilustrasi topik sedang dibuat.' : 'Ilustrasi tidak dapat diproses.' });
  } finally { activeIllustrationRequests--; }
});

app.get('/api/media/assets/:assetId', async (req, res) => {
  if (!ASSET_ID.test(req.params.assetId)) return res.status(400).json({ error: 'ID aset harus UUID.' });
  try {
    const { asset, bytes } = await illustrations.raster(req.params.assetId);
    return res.set('X-Content-Type-Options', 'nosniff').type(asset.mime).send(bytes);
  } catch (error) { return res.status(error.message === 'illustration_not_found' ? 404 : 409).json({ error: 'Raster ilustrasi belum tersedia atau tidak cocok dengan catatan aset.' }); }
});

const manualUploadRequests = new Map();

function publicManualAsset(asset) {
  return {
    id: asset.id, topic_id: asset.topic_id, kind: asset.kind, credit: asset.credit,
    rights_basis: asset.rights_basis, rights_reference: asset.rights_reference,
    mime: asset.mime, byte_size: asset.byte_size, width: asset.width, height: asset.height,
    sha256: asset.sha256, original_name: asset.original_name, created_at: asset.created_at,
    url: `/api/media/manual/${asset.id}`,
  };
}

// Editor-supplied raster upload. Nothing is written until the provenance fields
// pass, and a failed insert removes the just-written immutable file.
async function uploadManualMedia(req, res) {
  try {
    if (!/^[1-9]\d*$/u.test(String(req.params.id)) || !Number.isSafeInteger(Number(req.params.id))) {
      return res.status(400).json({ error: 'ID harus berupa bilangan bulat positif.' });
    }
    const fields = ['filename', 'data_uri', 'credit', 'rights_basis', 'rights_reference', 'rights_attested'];
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Body unggahan tidak valid.' });
    if (Object.keys(body).some((key) => !fields.includes(key))) return res.status(400).json({ error: `Hanya field ${fields.join(', ')} yang diterima.` });
    if (typeof body.credit !== 'string' || !body.credit.trim() || body.credit.length > 200) return res.status(400).json({ error: 'Credit wajib diisi (maksimal 200 karakter).' });
    if (typeof body.rights_basis !== 'string' || !RIGHTS_BASES.includes(body.rights_basis)) {
      return res.status(400).json({ error: 'Jenis hak (rights_basis) tidak dikenal; pilih own_work, licensed_stock, atau agency_license.' });
    }
    if (body.rights_attested !== true) return res.status(400).json({ error: 'Atestasi hak wajib disetujui sebelum mengunggah gambar.' });
    if (body.rights_reference !== undefined && body.rights_reference !== null
      && (typeof body.rights_reference !== 'string' || body.rights_reference.length > 500)) {
      return res.status(400).json({ error: 'Referensi hak maksimal 500 karakter.' });
    }
    if (body.filename !== undefined && (typeof body.filename !== 'string' || body.filename.length > 255)) {
      return res.status(400).json({ error: 'Nama file maksimal 255 karakter.' });
    }
    let parsed;
    try { parsed = parseManualUpload(body.data_uri); } catch (error) {
      return res.status(400).json({
        error: error.message === 'media_too_large'
          ? 'Gambar melebihi batas 12 MB sebelum diproses.'
          : 'data_uri gambar tidak valid; gunakan JPEG, PNG, atau WebP base64.',
      });
    }
    const now = Date.now();
    for (const [key, entry] of manualUploadRequests) if (entry.expiresAt <= now) manualUploadRequests.delete(key);
    const peer = req.socket.remoteAddress || 'unknown';
    const forwarded = req.get('cf-connecting-ip') || '';
    const address = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) && isIP(forwarded) ? forwarded : peer;
    const limit = manualUploadRequests.get(address) || { count: 0, expiresAt: now + 10 * 60 * 1000 };
    if (limit.count >= 10 || (!manualUploadRequests.has(address) && manualUploadRequests.size >= 1000)) {
      return res.status(429).json({ error: 'Batas unggah media tercapai. Coba lagi setelah beberapa menit.' });
    }
    limit.count++;
    manualUploadRequests.set(address, limit);

    const topicId = Number(req.params.id);
    const { rows: [topic] } = await pool.query('SELECT id FROM topics WHERE id=$1', [topicId]);
    if (!topic) return res.status(404).json({ error: 'Topik tidak ditemukan.' });

    const id = randomUUID();
    let saved;
    try { saved = await saveManualMediaRaster(id, parsed.bytes, { storagePath: STORAGE_PATH }); } catch (error) {
      return res.status(400).json({
        error: error.message === 'media_dimensions_invalid'
          ? 'Gambar minimal 320x240 piksel setelah diproses.'
          : error.message === 'media_too_large'
            ? 'Gambar hasil proses melebihi batas 4 MB.'
            : 'Gambar tidak dapat diproses; unggah ulang sebagai JPEG, PNG, atau WebP.',
      });
    }
    const reference = typeof body.rights_reference === 'string' && body.rights_reference.trim() ? body.rights_reference.trim() : null;
    const originalName = typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim() : null;
    try {
      const { rows: [asset] } = await pool.query(
        `INSERT INTO manual_media_assets (id, topic_id, rights_basis, credit, rights_reference, local_path, mime, byte_size, width, height, sha256, original_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [id, topicId, body.rights_basis, body.credit.trim(), reference, saved.local_path, saved.mime, saved.byte_size, saved.width, saved.height, saved.sha256, originalName],
      );
      await writeAudit('topic', topicId, 'manual_media_uploaded', 'web_admin', { asset_id: id, sha256: saved.sha256 });
      return res.status(201).json({ asset: publicManualAsset(asset), descriptor: manualMediaDescriptor(asset) });
    } catch (error) {
      await deleteManualMediaRaster(id, { storagePath: STORAGE_PATH });
      return res.status(500).json({ error: 'Media manual tidak dapat disimpan.' });
    }
  } catch {
    return res.status(500).json({ error: 'Media manual tidak dapat diproses.' });
  }
}

app.get('/api/topics/:id/media', async (req, res) => {
  try {
    const { rows: [topic] } = await pool.query('SELECT id FROM topics WHERE id=$1', [req.params.id]);
    if (!topic) return res.status(404).json({ error: 'Topik tidak ditemukan.' });
    const { rows } = await pool.query('SELECT * FROM manual_media_assets WHERE topic_id=$1 ORDER BY created_at DESC, id DESC LIMIT 100', [req.params.id]);
    return res.json({ assets: rows.map(publicManualAsset) });
  } catch { return res.status(500).json({ error: 'Media manual tidak dapat dibaca.' }); }
});

app.get('/api/media/manual/:assetId', async (req, res) => {
  if (!MANUAL_ASSET_ID.test(String(req.params.assetId))) return res.status(400).json({ error: 'ID aset harus UUID.' });
  try {
    const asset = await loadManualMedia(pool, req.params.assetId);
    const bytes = await readManualMedia(asset, { storagePath: STORAGE_PATH });
    return res.set('X-Content-Type-Options', 'nosniff').type(asset.mime).send(bytes);
  } catch { return res.status(404).json({ error: 'Raster media manual belum tersedia atau tidak cocok dengan catatan aset.' }); }
});

app.post('/api/drafts/:id/slide-media', async (req, res) => {
  const body = req.body;
  const fields = ['slide_no', 'asset_id'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !fields.includes(key))) {
    return res.status(400).json({ error: `Hanya field ${fields.join(', ')} yang diterima.` });
  }
  if (!Number.isInteger(body.slide_no) || body.slide_no < 1 || body.slide_no > 9) return res.status(400).json({ error: 'Nomor slide tidak valid.' });
  if (typeof body.asset_id !== 'string' || !MANUAL_ASSET_ID.test(body.asset_id)) return res.status(400).json({ error: 'asset_id UUID wajib diisi.' });
  const draftId = Number(req.params.id);
  try {
    const result = await editDraft(draftId, async (draft, client) => {
      const slide = draft.slides[body.slide_no - 1];
      if (!slide) throw new DraftError('Slide tidak ditemukan.');
      const asset = await loadManualMedia(client, body.asset_id, { topic_id: draft.topic_id });
      const { image_url, image_data, image_kind, asset_id, asset_sha256, credit, rights_basis, ...data } = slide.data || {};
      slide.data = { ...data, ...manualMediaDescriptor(asset) };
      if (body.slide_no > 1) slide.layout = 'illustration';
      return { slides: draft.slides };
    }, { ...draftDependencies, replaceIllustration: true });
    return res.json({
      status: 'success', draftId, slide_no: body.slide_no, asset_id: result.slides[body.slide_no - 1].data.asset_id,
      layout: result.slides[body.slide_no - 1].layout, image_url: `/storage/drafts/${draftId}/slide_${body.slide_no}.png?t=${Date.now()}`, needs_review: true,
    });
  } catch (error) {
    const missing = /^media_(not_found|id_invalid|path_invalid|checksum_mismatch|asset_invalid)/u.test(error.message);
    return res.status(error.statusCode || (missing ? 409 : 500)).json({
      error: missing ? 'Media manual tidak tersedia untuk topik draf ini.' : error.message,
    });
  }
});

app.post('/api/topics/:id/material/enrich', async (req, res) => {
  const body = req.body || {};
  if (Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => key !== 'refresh') || (body.refresh !== undefined && typeof body.refresh !== 'boolean')) {
    return res.status(400).json({ error: 'Hanya opsi refresh boolean yang diterima; URL mengikuti topik tersimpan.' });
  }
  const now = Date.now();
  for (const [key, value] of materialRequests) if (value.expiresAt <= now) materialRequests.delete(key);
  const source = req.socket.remoteAddress || 'unknown';
  const forwardedAddress = req.get('cf-connecting-ip') || '';
  const address = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(source) && isIP(forwardedAddress) ? forwardedAddress : source;
  if (!materialRequests.has(address) && materialRequests.size >= 1000) return res.status(429).json({ error: 'Batas pengambilan materi tercapai. Coba lagi nanti.' });
  const limit = materialRequests.get(address) || { count: 0, expiresAt: now + 10 * 60 * 1000 };
  if (limit.count >= 10 || activeMaterialRequests >= 2) return res.status(429).json({ error: 'Batas pengambilan materi tercapai. Coba lagi setelah permintaan selesai.' });
  limit.count++;
  materialRequests.set(address, limit);
  activeMaterialRequests++;
  try {
    const result = await topicMaterials.enrich(req.params.id, { refresh: body.refresh === true });
    return res.json(result);
  } catch (error) {
    const reason = error.message === 'topic_not_found' ? 'Topik tidak ditemukan.' : 'Materi tidak dapat diproses; periksa URL sumber dan status akses.';
    const status = error.message === 'topic_not_found' ? 404
      : /material_.*invalid|topic_id_invalid/u.test(error.message) ? 409 : 500;
    return res.status(status).json({ error: reason });
  } finally { activeMaterialRequests--; }
});

app.post('/api/topics/:id/promote', async (req, res) => {
  const topicId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query('SELECT status FROM topics WHERE id = $1', [topicId]);
    if (!rows.length) return res.status(404).json({ error: 'Topik tidak ditemukan.' });
    if (rows[0].status !== 'scored') return res.status(409).json({ error: 'Topik harus lebih dahulu lolos evaluasi Analis.' });
    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('topic', $1, 'promote_manual', 'web_admin', '{}')",
      [topicId]
    );
    res.json({ status: 'success', topicId, message: 'Topik dipromosikan ke antrean produksi Copywriter.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7b. Auto Produce Topic directly to Draft & Slides
app.post('/api/topics/:id/auto-produce', async (req, res) => {
  const topicId = parseInt(req.params.id);
  const force = req.body?.force === true || req.query?.force === 'true';
  try {
    const topic = (await pool.query('SELECT id FROM topics WHERE id=$1', [topicId])).rows[0];
    if (!topic) return res.status(404).json({ error: 'Topik tidak ditemukan.' });
    const suppliedInput = req.body?.editorial_input === undefined ? undefined
      : await resolveTopicEditorialInput(topicEditorialLoader, topicId, req.body.editorial_input);
    const options = suppliedInput === undefined ? {} : { editorialInput: assertNewsEditorialInput(suppliedInput) };
    let result;
    if (force) {
      const { rows } = await pool.query('SELECT id FROM drafts WHERE topic_id=$1 ORDER BY id DESC LIMIT 1', [topicId]);
      result = rows.length ? await regenerateDraft(rows[0].id, pool, options) : await produceSingleTopicDraft(topicId, pool, options);
    } else result = await produceSingleTopicDraft(topicId, pool, options);
    res.json({ status: 'success', ...result });
  } catch (err) {
    console.error('[Web API] Auto-produce error:', err);
    return editorialError(res, err);
  }
});

// 8. Run Pipeline Runner
let isPipelineRunning = false;
app.post('/api/pipeline/run', (req, res) => {
  if (isPipelineRunning) {
    return res.status(409).json({ status: 'busy', message: 'Pipeline sedang berjalan di background.' });
  }

  isPipelineRunning = true;
  exec('/root/gapura/scripts/run_pipeline.sh', (err, stdout, stderr) => {
    isPipelineRunning = false;
    if (err) {
      console.error('[Web Runner] Pipeline execution error:', err);
    } else {
      console.log('[Web Runner] Pipeline execution success.');
    }
  });

  res.json({ status: 'started', message: 'Pipeline dijalankan di background.' });
});

// 9. Tokens API (Live Design Studio & Realtime Preview Support)
app.get('/api/tokens', (req, res) => {
  try {
    const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
    const parsed = yaml.load(raw);
    res.json({ raw, parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tokens', async (req, res) => {
  const { yaml_content, brand, palette, typography } = req.body;
  try {
    let finalYaml = '';
    if (yaml_content) {
      yaml.load(yaml_content);
      finalYaml = yaml_content;
    } else {
      let existingTokens = {};
      if (fs.existsSync(TOKENS_PATH)) {
        existingTokens = yaml.load(fs.readFileSync(TOKENS_PATH, 'utf8')) || {};
      }
      if (brand) existingTokens.brand = { ...(existingTokens.brand || {}), ...brand };
      if (palette) existingTokens.palette = { ...(existingTokens.palette || {}), ...palette };
      if (typography) existingTokens.typography = { ...(existingTokens.typography || {}), ...typography };
      finalYaml = yaml.dump(existingTokens);
    }

    fs.writeFileSync(TOKENS_PATH, finalYaml, 'utf8');

    // Reload tokens in Render Service
    await fetch(`${RENDER_SERVICE_URL}/tokens/reload`, {
      method: 'POST',
      headers: { 'X-Render-Secret': RENDER_SECRET },
    });

    // Sinkronisasi juga ke config/agents.json jika designer.tokens ada
    try {
      if (fs.existsSync(AGENTS_CONFIG_PATH)) {
        const parsedTokens = yaml.load(finalYaml);
        const agentsConfig = JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, 'utf8'));
        if (agentsConfig.designer) {
          agentsConfig.designer.tokens = {
            palette: parsedTokens.palette || {},
            typography: parsedTokens.typography || {},
          };
          fs.writeFileSync(AGENTS_CONFIG_PATH, JSON.stringify(agentsConfig, null, 2), 'utf8');
        }
      }
    } catch (syncErr) {
      console.warn('[Web API] Warning sync to agents.json:', syncErr.message);
    }

    res.json({ status: 'success', message: 'Tokens desain berhasil disimpan dan disinkronkan ke Render Engine.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9b. Render Single Slide Preview (Proxy ke Render Service Port 3000)
app.post('/api/render/preview', async (req, res) => {
  try {
    const payload = req.body || {};
    const [slide] = await renderPayload([payload.slide], { storagePath: STORAGE_PATH, resolveAsset: (id) => loadIllustration(pool, id) });
    const renderRes = await fetch(`${RENDER_SERVICE_URL}/render/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Render-Secret': RENDER_SECRET,
      },
      body: JSON.stringify({ ...payload, slide }),
    });

    if (!renderRes.ok) {
      const errText = await renderRes.text();
      return res.status(renderRes.status).send(errText);
    }

    const pngBuffer = await renderRes.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(pngBuffer));
  } catch (err) {
    console.error('[Web API] Error proxying render preview:', err);
    res.status(/^illustration_/u.test(err.message) ? 409 : 500).json({ error: /^illustration_/u.test(err.message) ? 'Ilustrasi belum tersedia atau revisinya tidak cocok.' : 'Preview tidak dapat dirender.' });
  }
});

// 9a. Provider & Model Catalog API (admin guard applies to /api)
const PROVIDER_EDITABLE = new Set(['label', 'kind', 'base_url', 'api_key_env', 'enabled', 'default_model', 'models', 'max_tokens', 'headers', 'notes']);
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function providerSnapshot() {
  const config = loadProvidersConfig(PROVIDERS_CONFIG_PATH);
  const secrets = loadProviderSecrets();
  const cache = loadModelCache();
  return {
    providers: providerInventory(config, { env: process.env, secrets, cache }),
    routing: config.routing || { fallback_chain: [] },
  };
}

app.get('/api/providers', (_req, res) => {
  try {
    res.json(providerSnapshot());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/providers/refresh', async (req, res) => {
  try {
    const providerId = req.body?.provider_id ? String(req.body.provider_id) : null;
    if (providerId && !PROVIDER_ID_PATTERN.test(providerId)) return res.status(400).json({ error: 'ID provider tidak valid.' });
    const config = loadProvidersConfig(PROVIDERS_CONFIG_PATH);
    await refreshModels({ providerId, config, env: process.env, secrets: loadProviderSecrets() });
    await writeAudit('ai_providers', null, 'refresh_models', 'web_admin', { provider_id: providerId || 'all' });
    res.json({ status: 'success', ...providerSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/providers/routing', async (req, res) => {
  const chain = req.body?.fallback_chain;
  try {
    const config = loadProvidersConfig(PROVIDERS_CONFIG_PATH);
    config.routing = { ...(config.routing || {}), fallback_chain: chain };
    const errors = validateProvidersConfig(config);
    if (errors.length) return res.status(400).json({ status: 'invalid', details: errors });
    saveProvidersConfig(config, PROVIDERS_CONFIG_PATH);
    await writeAudit('ai_providers', null, 'update_routing', 'web_admin', { entries: Array.isArray(chain) ? chain.length : 0 });
    res.json({ status: 'success', ...providerSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/providers/test', async (req, res) => {
  const { provider_id: providerId } = req.body || {};
  if (!PROVIDER_ID_PATTERN.test(String(providerId || ''))) return res.status(400).json({ error: 'ID provider tidak valid.' });
  const config = loadProvidersConfig(PROVIDERS_CONFIG_PATH);
  const entry = config.providers?.[providerId];
  if (!entry) return res.status(404).json({ error: 'Provider tidak ditemukan.' });
  const model = String(req.body?.model || entry.default_model || '').trim();
  if (!model) return res.status(400).json({ error: 'Model uji wajib diisi.' });
  const prompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim() ? req.body.prompt.slice(0, 300) : 'Balas JSON {"ok":true} tanpa penjelasan.';
  const inlineKey = typeof req.body?.api_key === 'string' ? req.body.api_key.trim() : '';
  const isolated = { providers: config.providers, routing: { fallback_chain: [] } };
  try {
    buildAttempts({ provider: providerId, model, api_key: inlineKey }, isolated, { env: process.env, secrets: loadProviderSecrets() });
  } catch (error) {
    return res.status(400).json({ status: 'invalid', error: error.message });
  }
  const started = Date.now();
  try {
    let metadata;
    const result = await callAgentLLM('studio', prompt, 'Ini uji koneksi provider. Balas JSON {"ok":true}; jangan memproduksi berita.', true, {
      config: { studio: { provider: providerId, model, api_key: inlineKey } },
      providers: isolated,
      env: process.env,
      secrets: loadProviderSecrets(),
      onMetadata: (value) => { metadata = value; },
      timeoutMs: 30000,
    });
    JSON.parse(result.replace(/```json|```/g, '').trim());
    res.json({ status: 'passed', provider: providerId, model: metadata?.model || model, latency_ms: Date.now() - started, message: 'Provider merespons dengan JSON valid. Tidak ada perubahan tersimpan.' });
  } catch (error) {
    res.status(502).json({ status: 'failed', provider: providerId, model, latency_ms: Date.now() - started, error: String(error.message || error).slice(0, 500) });
  }
});

app.post('/api/providers/:providerId', async (req, res) => {
  const providerId = String(req.params.providerId || '');
  if (!PROVIDER_ID_PATTERN.test(providerId)) return res.status(400).json({ error: 'ID provider tidak valid.' });
  const body = req.body || {};
  const unknown = Object.keys(body).filter((key) => !PROVIDER_EDITABLE.has(key));
  if (unknown.length) return res.status(400).json({ error: `Field tidak dikenal: ${unknown.join(', ')}.` });
  if (body.api_key_env === 'FIRECRAWL_API_KEY') return res.status(403).json({ error: 'Firecrawl Search API key hanya dapat dipasang operator pada environment atau secret store server.' });
  try {
    const config = loadProvidersConfig(PROVIDERS_CONFIG_PATH);
    const existing = config.providers[providerId] || {};
    const next = { ...existing };
    for (const [key, value] of Object.entries(body)) {
      if (key === 'models' && typeof value === 'string') next.models = value.split('\n').map((line) => line.trim()).filter(Boolean);
      else next[key] = value;
    }
    if (!next.api_key_env) next.api_key_env = `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
    config.providers[providerId] = next;
    const errors = validateProvidersConfig(config);
    if (errors.length) return res.status(400).json({ status: 'invalid', details: errors });
    saveProvidersConfig(config, PROVIDERS_CONFIG_PATH);
    await writeAudit('ai_providers', null, 'upsert_provider', 'web_admin', { provider_id: providerId, enabled: next.enabled !== false });
    res.json({ status: 'success', ...providerSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/providers/:providerId/key', async (req, res) => {
  const providerId = String(req.params.providerId || '');
  if (!PROVIDER_ID_PATTERN.test(providerId)) return res.status(400).json({ error: 'ID provider tidak valid.' });
  const apiKey = typeof req.body?.api_key === 'string' ? req.body.api_key.trim() : '';
  if (!apiKey) return res.status(400).json({ error: 'API key wajib diisi.' });
  const entry = loadProvidersConfig(PROVIDERS_CONFIG_PATH).providers?.[providerId];
  if (!entry) return res.status(404).json({ error: 'Provider tidak ditemukan.' });
  if (entry.api_key_env === 'FIRECRAWL_API_KEY') return res.status(403).json({ error: 'Firecrawl Search API key hanya dapat dipasang operator pada environment atau secret store server.' });
  try {
    saveProviderSecret(entry.api_key_env, apiKey);
    await writeAudit('ai_providers', null, 'set_api_key', 'web_admin', { provider_id: providerId, env: entry.api_key_env });
    res.json({ status: 'success', provider: providerId, key_configured: true, message: 'API key tersimpan di secret store provider (0600).' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9b. AI Agents Configuration API
app.get('/api/agents/config', (req, res) => {
  try {
    const config = loadAgentsConfig();
    config.skills = {
      scout: loadAgentSkills('scout'),
      analis: loadAgentSkills('analis'),
      copywriter: loadAgentSkills('copywriter'),
      designer: loadAgentSkills('designer'),
      seo: loadAgentSkills('seo'),
      studio: loadAgentSkills('studio'),
    };
    res.json(redactAgentConfig(config));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/config', async (req, res) => {
  try {
    await saveSettings(req.body, {
      configPath: AGENTS_CONFIG_PATH,
      skillsDir: process.env.AGENT_SKILLS_DIR || path.resolve(__dirname, '../../config/skills'),
    });
    const warnings = [];
    if (req.body.designer?.tokens && process.env.GAPURA_DISABLE_WORKERS !== 'true') {
      try {
        const tokens = yaml.load(fs.readFileSync(TOKENS_PATH, 'utf8'));
        for (const key of ['palette', 'typography']) tokens[key] = { ...tokens[key], ...req.body.designer.tokens[key] };
        fs.writeFileSync(`${TOKENS_PATH}.tmp`, yaml.dump(tokens));
        fs.renameSync(`${TOKENS_PATH}.tmp`, TOKENS_PATH);
        const response = await fetch(`${RENDER_SERVICE_URL}/tokens/reload`, { method: 'POST', headers: { 'X-Render-Secret': RENDER_SECRET }, signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (error) { warnings.push(`Konfigurasi tersimpan; sinkronisasi render perlu diulang: ${error.message}`); }
    }
    await writeAudit('ai_agents', 1, 'update_config', 'web_admin', { updated_agents: Object.keys(req.body).filter((key) => key !== 'skills') });
    res.json({ status: 'success', message: 'Konfigurasi enam agen dan skills tersimpan.', warnings });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/agents/config/test', async (req, res) => {
  const { agent, config: candidate = {}, prompt } = req.body || {};
  if (agent === 'scout') {
    const scout = candidate.scout || {};
    const limit = Number(scout.max_items_per_source);
    const threshold = Number(scout.dedup_similarity_threshold);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) return res.status(400).json({ error: 'Batas item atau ambang deduplikasi Scout tidak valid.' });
    return res.json({ status: 'passed', message: 'Scout deterministik: batas item dan deduplikasi valid. Tidak ada panggilan LLM atau penulisan data.' });
  }
  const allowedAgents = new Set(['analis', 'copywriter', 'designer', 'seo', 'studio']);
  if (!allowedAgents.has(agent)) return res.status(400).json({ error: 'Nama agen tidak valid.' });
  if (typeof prompt !== 'string' || prompt.length < 5 || prompt.length > 300) return res.status(400).json({ error: 'Prompt uji harus 5-300 karakter.' });
  if (!candidate?.[agent]) return res.status(400).json({ error: 'Payload konfigurasi agen tidak ditemukan.' });
  const merged = mergeAgentConfig(loadAgentsConfig(), { [agent]: candidate[agent] });
  const validationErrors = validateAgent(agent, merged[agent]);
  if (validationErrors.length) return res.status(400).json({ status: 'invalid', details: validationErrors });
  const current = merged[agent] || {};
  const providersConfig = loadProvidersConfig(PROVIDERS_CONFIG_PATH);
  const secrets = loadProviderSecrets();
  try {
    buildAttempts(current, providersConfig, { env: process.env, secrets });
  } catch (error) {
    return res.status(400).json({ error: `Rantai provider ${agent} tidak dapat dipakai: ${error.message}` });
  }
  try {
    let metadata;
    const result = await callAgentLLM(agent, prompt, 'Ini uji koneksi konfigurasi. Balas JSON {"ok":true}; jangan memproduksi berita.', true, {
      config: merged,
      providers: providersConfig,
      env: process.env,
      secrets,
      skills: req.body.skills?.[agent] ?? loadAgentSkills(agent),
      onMetadata: (value) => { metadata = value; },
      timeoutMs: 15000,
    });
    JSON.parse(result.replace(/```json|```/g, '').trim());
    res.json({ status: 'passed', message: 'Provider merespons dengan JSON valid. Perubahan belum disimpan.', provider: metadata?.provider || current.provider, model: metadata?.model || current.model });
  } catch (error) {
    res.status(502).json({ status: 'failed', error: String(error.message || error).slice(0, 500) });
  }
});

app.get('/api/agents/:agent/skills', (req, res) => {
  const { agent } = req.params;
  const content = loadAgentSkills(agent);
  res.json({ agent, content });
});

app.post('/api/agents/:agent/skills', (req, res) => {
  const { agent } = req.params;
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'Content must be string' });
  try {
    saveAgentSkills(agent, content);
    res.json({ status: 'success', agent, message: `Skills untuk agen ${agent} berhasil disimpan.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Audit Log API
app.get('/api/audit-log', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 50');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Workflow API
app.get('/api/workflow', async (req, res) => {
  const status = await scheduler.status();
  res.json({ ...status, json: { schedule: 'every 15 minutes', command: 'scripts/run_pipeline.sh', steps: ['Scout', 'Trending', 'Analis', 'Copywriter + Render', 'Review'], delivery: 'operator opt-in only', lock: 'flock' } });
});

app.post('/api/workflow/toggle', async (req, res) => {
  const { active } = req.body;
  try {
    if (process.env.GAPURA_DISABLE_WORKERS === 'true') return res.status(409).json({ error: 'Scheduler tidak diubah di lingkungan pengujian.' });
    const status = await scheduler.toggle(active);
    await writeAudit('workflow', 1, active ? 'activated' : 'deactivated', 'web_admin', { active, scheduler: 'systemd' });
    res.json({ status: 'success', ...status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==============================================================================
// 12. News Sources Management API (User Request)
// ==============================================================================
// Get all sources with statistics
app.get('/api/sources', async (req, res) => {
  try {
    const query = `
      SELECT s.*, 
             COUNT(r.id)::int AS total_items_fetched, 
             MAX(r.fetched_at) AS last_item_at
      FROM sources s
      LEFT JOIN raw_items r ON s.id = r.source_id
      GROUP BY s.id
      ORDER BY s.id ASC;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new news source
app.post('/api/sources', async (req, res) => {
  const { name, type = 'rss', url_or_query, category = 'umum', desk = null, poll_interval_mins = 30, is_active = true } = req.body;
  if (!name || !url_or_query) {
    return res.status(400).json({ error: 'Nama sumber dan URL/Query wajib diisi.' });
  }
  const sourceError = validateSourceType(type, url_or_query);
  if (sourceError) return res.status(400).json({ error: sourceError });
  if (typeof category !== 'string' || !category.trim()) return res.status(400).json({ error: 'Kategori sumber wajib berupa teks.' });
  if (desk !== null && desk !== '' && (typeof desk !== 'string' || !normalizeDesk(desk))) {
    return res.status(400).json({ error: 'Desk sumber tidak valid.' });
  }
  const normalizedDesk = desk ? normalizeDesk(desk) : null;

  try {
    const query = `
      INSERT INTO sources (name, type, url_or_query, category, desk, poll_interval_mins, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      name.trim(),
      type.trim(),
      url_or_query.trim(),
      category.trim(),
      normalizedDesk,
      parseInt(poll_interval_mins) || 30,
      Boolean(is_active),
    ]);

    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('sources', $1, 'create_source', 'web_admin', $2)",
      [rows[0].id, JSON.stringify({ name, url_or_query, category, desk: normalizedDesk })]
    );

    res.json({ status: 'success', source: rows[0], message: `Sumber "${name}" berhasil ditambahkan.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update existing news source
app.put('/api/sources/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, type = 'rss', url_or_query, category, poll_interval_mins = 30, is_active = true } = req.body;
  if (!name || !url_or_query) {
    return res.status(400).json({ error: 'Nama sumber dan URL/Query wajib diisi.' });
  }
  const sourceError = validateSourceType(type, url_or_query);
  if (sourceError) return res.status(400).json({ error: sourceError });
  if (category !== undefined && (typeof category !== 'string' || !category.trim())) return res.status(400).json({ error: 'Kategori sumber wajib berupa teks.' });
  const hasDesk = Object.hasOwn(req.body, 'desk');
  if (hasDesk && req.body.desk !== null && req.body.desk !== ''
    && (typeof req.body.desk !== 'string' || !normalizeDesk(req.body.desk))) {
    return res.status(400).json({ error: 'Desk sumber tidak valid.' });
  }
  const normalizedDesk = hasDesk && req.body.desk ? normalizeDesk(req.body.desk) : null;

  try {
    const query = `
      UPDATE sources
      SET name = $1, type = $2, url_or_query = $3, category = COALESCE($4, category), poll_interval_mins = $5, is_active = $6,
          desk = CASE WHEN $7::boolean THEN $8::varchar ELSE desk END, updated_at = NOW()
      WHERE id = $9
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      name.trim(),
      type.trim(),
      url_or_query.trim(),
      category?.trim() ?? null,
      parseInt(poll_interval_mins) || 30,
      Boolean(is_active),
      hasDesk,
      normalizedDesk,
      id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Sumber tidak ditemukan.' });
    }

    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('sources', $1, 'update_source', 'web_admin', $2)",
      [id, JSON.stringify({ name, url_or_query, category, desk: rows[0].desk, is_active })]
    );

    res.json({ status: 'success', source: rows[0], message: `Sumber "${name}" berhasil diperbarui.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete or toggle news source
app.delete('/api/sources/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const hasItems = await pool.query('SELECT 1 FROM raw_items WHERE source_id = $1 LIMIT 1', [id]);
    if (hasItems.rowCount > 0) {
      await pool.query('UPDATE sources SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
      await pool.query(
        "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('sources', $1, 'deactivate_source', 'web_admin', $2)",
        [id, JSON.stringify({ reason: 'Has associated raw_items' })]
      );
      return res.json({ status: 'deactivated', message: 'Sumber dinonaktifkan karena memiliki riwayat berita terhubung.' });
    } else {
      await pool.query('DELETE FROM sources WHERE id = $1', [id]);
      await pool.query(
        "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('sources', $1, 'delete_source', 'web_admin', $2)",
        [id, JSON.stringify({ id })]
      );
      return res.json({ status: 'deleted', message: 'Sumber berhasil dihapus permanen.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger Scout Polling immediately
app.post('/api/sources/poll', async (req, res) => {
  try {
    console.log('[Web API] Memulai tarikan manual Scout RSS Poller...');
    const result = await runScout({ force: true });
    res.json({
      status: 'success',
      message: `Scout selesai: ${result.totalFetched} berita dipindai, ${result.totalDuplicates} duplikat diabaikan, ${result.totalNew} topik baru masuk ke Radar!`,
      result,
    });
  } catch (err) {
    console.error('[Web API] Error running scout poll:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================================================
// 13. Agen SEO — Radar Trending
// ==============================================================================
app.get('/api/trend-sources', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ts.*,
              (SELECT COUNT(*)::int FROM trend_items ti WHERE ti.trend_source_id = ts.id) AS total_items
       FROM trend_sources ts
       ORDER BY ts.is_active DESC, ts.weight DESC, ts.id ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trend-sources', async (req, res) => {
  const { kind, value, label = null, category = 'trending', weight = 10, poll_interval_mins = 60, is_active = true } = req.body || {};
  const allowed = ['x_account', 'x_query', 'google_trends', 'news_query', 'public_web'];
  if (!allowed.includes(kind) || !value) {
    return res.status(400).json({ error: `kind wajib salah satu dari: ${allowed.join(', ')} dan value wajib diisi.` });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO trend_sources (kind, value, label, category, weight, poll_interval_mins, is_active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       RETURNING *`,
      [kind, String(value).trim(), label, category, parseInt(weight) || 10, parseInt(poll_interval_mins) || 60, Boolean(is_active)]
    );
    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('trend_source', $1, 'create', 'web_admin', $2)",
      [rows[0].id, JSON.stringify({ kind, value, label, category })]
    );
    res.json({ status: 'success', source: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Sumber trending ini sudah terdaftar.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/trend-sources/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { kind, value, label = null, category = 'trending', weight = 10, poll_interval_mins = 60, is_active = true } = req.body || {};
  const allowed = ['x_account', 'x_query', 'google_trends', 'news_query', 'public_web'];
  if (!allowed.includes(kind) || !value) {
    return res.status(400).json({ error: 'kind dan value wajib valid.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE trend_sources
       SET kind=$1, value=$2, label=$3, category=$4, weight=$5, poll_interval_mins=$6, is_active=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [kind, String(value).trim(), label, category, parseInt(weight) || 10, parseInt(poll_interval_mins) || 60, Boolean(is_active), id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Sumber trending tidak ditemukan.' });
    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('trend_source', $1, 'update', 'web_admin', $2)",
      [id, JSON.stringify({ kind, value, label, is_active })]
    );
    res.json({ status: 'success', source: rows[0] });
  } catch (err) {
    await writeAudit('trend_source', id, 'error_update', 'web_admin', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/trend-sources/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { rowCount } = await pool.query('DELETE FROM trend_sources WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Sumber trending tidak ditemukan.' });
    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('trend_source', $1, 'delete', 'web_admin', '{}')",
      [id]
    );
    res.json({ status: 'success' });
  } catch (err) {
    await writeAudit('trend_source', id, 'error_delete', 'web_admin', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/seo/scan', async (req, res) => {
  try {
    console.log('[Web API] Memulai pemindaian Agen SEO...');
    const summary = await runSeoScan({ sourceId: req.body?.source_id ? parseInt(req.body.source_id, 10) : null, force: true });
    res.json({
      status: 'success',
      message: `SEO selesai: ${summary.items_seen} item dipindai dari ${summary.sources} sumber, ${summary.items_new} item baru.`,
      summary,
    });
  } catch (err) {
    console.error('[Web API] SEO scan error:', err);
    await writeAudit('seo', 0, 'error_scan', 'web_admin', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/seo/trends', async (req, res) => {
  try {
    const rows = await listTrends({
      limit: req.query.limit || 50,
      platform: req.query.platform || null,
      minScore: req.query.min_score || 0,
    });
    res.json(rows);
  } catch (err) {
    await writeAudit('seo', 0, 'error_list', 'web_admin', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/seo/health', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, is_active, last_scanned_at, last_success_at, last_error FROM trend_sources ORDER BY id`
    );
    res.json(buildTrendHealth(rows, {
      xApiConfigured: Boolean(process.env.X_BEARER_TOKEN),
      rssHubConfigured: Boolean(process.env.RSSHUB_BASE_URL),
      firecrawlApiConfigured: Boolean(process.env.FIRECRAWL_API_KEY || loadProviderSecrets().FIRECRAWL_API_KEY),
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/seo/trends/:id/promote', async (req, res) => {
  const trendId = parseInt(req.params.id, 10);
  try {
    const result = await promoteTrendToTopic(trendId);
    res.json({ status: 'success', ...result, message: 'Trend dipromosikan menjadi topik editorial.' });
  } catch (err) {
    await writeAudit('seo', trendId, 'error_promote', 'web_admin', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ==============================================================================
// 14. Studio Prompt — prompt-driven production (plan -> draft -> publish)
// ==============================================================================
app.post('/api/studio/jobs', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const topicId = Number.parseInt(req.body?.topic_id, 10);
  if (prompt.length < 10) {
    return res.status(400).json({ error: 'Prompt minimal 10 karakter.' });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ error: 'Prompt maksimal 4000 karakter.' });
  }
  if (!Number.isInteger(topicId) || topicId < 1) return res.status(400).json({ error: 'Pilih topik Radar yang sudah lolos Analis dan memiliki sumber primer.' });
  try {
    const { rows: topicRows } = await pool.query(
      `SELECT t.id, t.status, t.url, t.title, ts.score_total, ts.verdict AS score_verdict
       FROM topics t LEFT JOIN LATERAL (
         SELECT score_total,verdict FROM topic_scores WHERE topic_id = t.id ORDER BY created_at DESC,id DESC LIMIT 1
       ) ts ON TRUE WHERE t.id = $1`, [topicId]
    );
    const eligibility = validateStudioTopic(topicRows[0], loadAgentsConfig().analis?.min_score_threshold || 76);
    if (!eligibility.valid) return res.status(409).json({ error: `Topik sumber tidak memenuhi gate: ${eligibility.reason}.` });
    if (topicRows[0].score_verdict !== 'passed') return res.status(409).json({ error: 'Topik sumber belum lolos skor Analis.' });
    const editorialInput = await resolveTopicEditorialInput(topicEditorialLoader, topicId, req.body?.editorial_input);
    const { rowCount: existingDraftCount } = await pool.query('SELECT 1 FROM drafts WHERE topic_id = $1 LIMIT 1', [topicId]);
    if (existingDraftCount) return res.status(409).json({ error: 'Topik sudah memiliki draf. Buka draf tersebut dari Radar Topik untuk diedit.' });
    const { rows } = await pool.query(
      `INSERT INTO prompt_jobs (prompt, mode, topic_id, actor, plan) VALUES ($1, 'review', $2, 'admin', $3) RETURNING *`,
      [prompt, topicId, JSON.stringify({ editorial_input: editorialInput })]
    );
    await writeAudit('prompt_job', rows[0].id, 'created', 'admin', { mode: 'review', topic_id: topicId, prompt_len: prompt.length });
    res.json({ status: 'success', job: rows[0] });
  } catch (err) {
    await writeAudit('prompt_job', 0, 'error_create', 'admin', { error: err.message });
    return editorialError(res, err);
  }
});

app.get('/api/studio/jobs', async (req, res) => {
  try {
    res.json(await listJobs({ limit: parseInt(req.query.limit) || 30 }));
  } catch (err) {
    await writeAudit('prompt_job', 0, 'error_list', 'admin', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/studio/jobs/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const job = await getJob(id);
    if (!job) return res.status(404).json({ error: 'Job tidak ditemukan' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE progress stream per job
app.get('/api/studio/jobs/:id/stream', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  let lastLogId = 0;
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const { rows: jobRows } = await pool.query('SELECT * FROM prompt_jobs WHERE id = $1', [id]);
      if (jobRows.length === 0) { clearInterval(timer); return res.end(); }
      const job = jobRows[0];
      const { rows: logs } = await pool.query(
        'SELECT * FROM job_logs WHERE job_id = $1 AND id > $2 ORDER BY id ASC', [id, lastLogId]);
      for (const log of logs) {
        lastLogId = log.id;
        res.write(`data: ${JSON.stringify({ step: log.step, level: log.level, message: log.message, status: job.status, progress: job.progress })}\n\n`);
      }
      res.write(`: ping ${Date.now()}\n\n`);
      const done = ['plan_review', 'review', 'scheduled', 'published', 'failed', 'cancelled'].includes(job.status);
      if (done || Date.now() - started > 15 * 60 * 1000) {
        res.write(`data: ${JSON.stringify({ done: true, status: job.status, error: job.error })}\n\n`);
        clearInterval(timer);
        res.end();
      }
    } catch (err) {
      clearInterval(timer);
      res.end();
    }
  }, 1500);
  req.on('close', () => clearInterval(timer));
});

// Generate ulang rencana
app.post('/api/studio/jobs/:id/regenerate-plan', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const job = await getJob(id);
    if (!job) return res.status(404).json({ error: 'Job tidak ditemukan.' });
    const options = req.body?.editorial_input === undefined ? {} : {
      editorialInput: await resolveTopicEditorialInput(topicEditorialLoader, job.topic_id, req.body.editorial_input),
    };
    const plan = await regeneratePlan(id, String(req.body?.instruction || '').slice(0, 1000), options);
    res.json({ status: 'success', plan });
  } catch (err) {
    await writeAudit('prompt_job', id, 'error_regenerate_plan', 'admin', { error: err.message });
    return editorialError(res, err);
  }
});

// Edit rencana manual
app.post('/api/studio/jobs/:id/plan', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const plan = await updatePlan(id, req.body?.plan);
    res.json({ status: 'success', plan });
  } catch (err) {
    await writeAudit('prompt_job', id, 'error_update_plan', 'admin', { error: err.message });
    return editorialError(res, err);
  }
});

// Jalankan job (dari status queued/plan_review)
app.post('/api/studio/jobs/:id/run', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { rows } = await pool.query(
      "SELECT * FROM prompt_jobs WHERE id = $1 AND status IN ('queued','plan_review','failed')",
      [id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Job tidak dalam status yang bisa dijalankan.' });
    // Eksekusi async; progress via SSE
    executeJob(id).catch(() => {});
    res.json({ status: 'success', job: rows[0] });
  } catch (err) {
    await writeAudit('prompt_job', id, 'error_run', 'admin', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Batalkan job yang belum jalan
app.post('/api/studio/jobs/:id/cancel', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { rowCount } = await pool.query(
      "UPDATE prompt_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('queued','plan_review')",
      [id]
    );
    if (rowCount === 0) return res.status(409).json({ error: 'Job tidak bisa dibatalkan pada status ini.' });
    await writeAudit('prompt_job', id, 'cancelled', 'admin', {});
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Worker loop: proses job queued tiap 20 detik
const studioWorker = process.env.GAPURA_DISABLE_WORKERS === 'true' ? null
  : setInterval(() => { processQueuedJobs().catch(() => {}); }, 20000);

const server = app.listen(PORT, HOST, () => {
  console.log(`[Gapura Web Dashboard] Running on http://${HOST}:${server.address().port}`);
});
server.on('close', () => { if (studioWorker) clearInterval(studioWorker); });

export { app, pool, server };
