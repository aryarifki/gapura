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
import { produceSingleTopicDraft, buildCarouselSlides } from '../copywriter/copywriter.js';
import { designCarouselSlides } from '../designer/designer.js';
import { loadAgentsConfig, loadAgentSkills, saveAgentSkills } from '../common/llm.js';
import { runScout } from '../scout/scout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(express.json());

const PORT = 3005;
const HOST = '127.0.0.1';
const STORAGE_PATH = path.resolve(__dirname, '../../storage');
const DESIGN_SYSTEM_PATH = path.resolve(__dirname, '../../design-system');
const TOKENS_PATH = path.join(DESIGN_SYSTEM_PATH, 'tokens.yaml');
const AGENTS_CONFIG_PATH = path.resolve(__dirname, '../../config/agents.json');
const RENDER_SERVICE_URL = 'http://127.0.0.1:3000';
const RENDER_SECRET = process.env.RENDER_SECRET || 'dev_render_secret_hme';

const pool = new Pool({
  host: process.env.HME_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.HME_DB_PORT || '5432'),
  user: process.env.HME_DB_USER || 'hme_user',
  password: process.env.HME_DB_PASSWORD,
  database: process.env.HME_DB_NAME || 'hme',
});

const n8nPool = new Pool({
  host: process.env.DB_POSTGRESDB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_POSTGRESDB_PORT || '5432'),
  user: process.env.DB_POSTGRESDB_USER || 'hme_user',
  password: process.env.DB_POSTGRESDB_PASSWORD,
  database: process.env.DB_POSTGRESDB_DATABASE || 'n8n',
  max: 3,
});

// Serve static assets
app.use('/storage', express.static(STORAGE_PATH));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'gapura-dashboard', version: '2.0.0' });
});

// 1. Dashboard Stats
app.get('/api/stats', async (req, res) => {
  try {
    const rawRes = await pool.query('SELECT count(*) FROM raw_items');
    const topicsRes = await pool.query('SELECT count(*) FROM topics');
    const scoresRes = await pool.query("SELECT verdict, count(*) FROM topic_scores GROUP BY verdict");
    const draftsRes = await pool.query("SELECT status, count(*) FROM drafts GROUP BY status");
    const schedRes = await pool.query("SELECT count(*) FROM scheduled_posts WHERE status = 'pending'");

    // Check Render Service & n8n health
    let renderHealthy = false;
    let n8nHealthy = false;
    try {
      const r = await fetch(`${RENDER_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
      renderHealthy = r.ok;
    } catch {}
    try {
      const n = await fetch('http://127.0.0.1:5678/healthz', { signal: AbortSignal.timeout(2000) });
      n8nHealthy = n.ok;
    } catch {}

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
        n8n: n8nHealthy,
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
      LEFT JOIN topic_scores ts ON t.id = ts.topic_id
      ORDER BY 
        CASE WHEN d.status = 'draft' THEN 1 WHEN d.status = 'scheduled' THEN 2 WHEN d.status = 'approved' THEN 3 ELSE 4 END,
        d.id DESC
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
app.get('/api/drafts/:id', async (req, res) => {
  const draftId = parseInt(req.params.id);
  try {
    const { rows: drafts } = await pool.query(`
      SELECT d.*, t.id as topic_id, t.title as topic_title, t.summary as topic_summary, t.primary_source, t.url as source_url, ts.score_total, ts.reasoning as score_reason
      FROM drafts d
      JOIN topics t ON d.topic_id = t.id
      LEFT JOIN topic_scores ts ON t.id = ts.topic_id
      WHERE d.id = $1
    `, [draftId]);

    if (drafts.length === 0) {
      return res.status(404).json({ error: 'Draf tidak ditemukan' });
    }

    const d = drafts[0];
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

    res.json(d);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2c. Regenerate Draft Carousel via AI Designer
app.post('/api/drafts/:id/regenerate-ai', async (req, res) => {
  const draftId = parseInt(req.params.id);
  try {
    const { rows: drafts } = await pool.query(`
      SELECT d.*, t.id as topic_id, t.title, t.summary, t.primary_source, t.url
      FROM drafts d
      JOIN topics t ON d.topic_id = t.id
      WHERE d.id = $1
    `, [draftId]);

    if (drafts.length === 0) {
      return res.status(404).json({ error: 'Draf tidak ditemukan' });
    }

    const d = drafts[0];
    const topic = {
      id: d.topic_id,
      title: d.title,
      summary: d.summary,
      primary_source: d.primary_source,
      url: d.url,
    };

    console.log(`[Web API] Regenerasi draf #${draftId} dengan AI Designer...`);
    const carouselData = await buildCarouselSlides(topic);

    // Call Render Service
    const renderResp = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Render-Secret': RENDER_SECRET,
      },
      body: JSON.stringify({
        draft_id: draftId,
        slides: carouselData.slides,
      }),
    });

    if (!renderResp.ok) {
      const errText = await renderResp.text();
      throw new Error(`Render Service error: HTTP ${renderResp.status} - ${errText}`);
    }

    const renderData = await renderResp.json();

    // Update drafts table
    await pool.query(
      `UPDATE drafts SET slides = $1, caption = $2, hashtags = $3, status = 'draft', updated_at = NOW() WHERE id = $4`,
      [JSON.stringify(carouselData.slides), carouselData.caption, carouselData.hashtags, draftId]
    );

    // Replace draft_slides records
    await pool.query('DELETE FROM draft_slides WHERE draft_id = $1', [draftId]);
    for (const slideRes of renderData.rendered_slides) {
      await pool.query(
        `INSERT INTO draft_slides (draft_id, slide_no, layout, render_path, text_snapshot, data_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          draftId,
          slideRes.slide_no,
          slideRes.layout,
          slideRes.file_path,
          carouselData.slides[slideRes.slide_no - 1]?.teks || '',
          JSON.stringify(carouselData.slides[slideRes.slide_no - 1]?.data || {}),
        ]
      );
    }

    await pool.query(
      `INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'regenerated_ai', 'web_editor', $2)`,
      [draftId, JSON.stringify({ slides_count: carouselData.slides.length })]
    );

    const updatedSlides = renderData.rendered_slides.map((s) => ({
      slide_no: s.slide_no,
      layout: s.layout,
      text: carouselData.slides[s.slide_no - 1]?.teks || '',
      data: carouselData.slides[s.slide_no - 1]?.data || {},
      image_url: `/storage/drafts/${draftId}/slide_${s.slide_no}.png`,
    }));

    res.json({
      status: 'success',
      draft_id: draftId,
      caption: carouselData.caption,
      hashtags: carouselData.hashtags,
      rendered_slides: updatedSlides,
    });
  } catch (err) {
    console.error('[Web API] Error regenerating draft:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2d. On-the-fly AI Slide Generator (Studio Desain & Playground)
app.post('/api/designer/generate-slides', async (req, res) => {
  const { title, summary, primary_source } = req.body;
  if (!title || title.trim().length === 0) {
    return res.status(400).json({ error: 'Judul / topik berita wajib diisi.' });
  }
  try {
    const topic = {
      id: 0,
      title: title.trim(),
      summary: (summary || '').trim(),
      primary_source: (primary_source || '@gapuramedia').trim(),
      url: '',
    };
    const slides = await designCarouselSlides(topic);
    res.json({ status: 'success', slides });
  } catch (err) {
    console.error('[Web API] Error generating slides via AI Designer:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2e. Create Draft & Slides from Custom Studio Design
app.post('/api/drafts/create-from-custom', async (req, res) => {
  const { title, summary, primary_source, slides, caption, hashtags } = req.body;
  if (!title || !Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: 'Data draf tidak lengkap atau slide kosong.' });
  }
  try {
    // 1. Simpan Topik
    const { rows: topicRows } = await pool.query(
      `INSERT INTO topics (title, summary, primary_source, url, status)
       VALUES ($1, $2, $3, $4, 'produced') RETURNING id`,
      [title, summary || '', primary_source || '@gapuramedia', 'custom-studio']
    );
    const topicId = topicRows[0].id;

    // 2. Simpan Draft
    const defaultCaption = caption || `${title}\n\n${summary || ''}\n\nSumber Data: ${primary_source || '@gapuramedia'}\n\n---\nDisclaimer: Informasi disajikan untuk tujuan edukasi publik dan bukan merupakan rekomendasi investasi beli/jual saham atau nasihat hukum resmi.`;
    const defaultHashtags = Array.isArray(hashtags) && hashtags.length > 0 ? hashtags : ['#GapuraMedia', '#DataEkonomi', '#BursaSaham', '#IHSG'];

    const { rows: draftRows } = await pool.query(
      `INSERT INTO drafts (topic_id, slides, caption, hashtags, disclaimer_type, status, needs_review, tokens_version, copy_model)
       VALUES ($1, $2, $3, $4, 'keuangan', 'draft', false, 'v1.0', 'studio-ai-designer') RETURNING id`,
      [topicId, JSON.stringify(slides), defaultCaption, defaultHashtags]
    );
    const draftId = draftRows[0].id;

    // 3. Render slides
    const renderResp = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Render-Secret': RENDER_SECRET,
      },
      body: JSON.stringify({
        draft_id: draftId,
        slides,
      }),
    });

    if (!renderResp.ok) {
      const errText = await renderResp.text();
      throw new Error(`Render Service error: HTTP ${renderResp.status} - ${errText}`);
    }

    const renderData = await renderResp.json();

    // 4. Simpan ke draft_slides
    for (const slideRes of renderData.rendered_slides) {
      await pool.query(
        `INSERT INTO draft_slides (draft_id, slide_no, layout, render_path, text_snapshot, data_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          draftId,
          slideRes.slide_no,
          slideRes.layout,
          slideRes.file_path,
          slides[slideRes.slide_no - 1]?.teks || '',
          JSON.stringify(slides[slideRes.slide_no - 1]?.data || {}),
        ]
      );
    }

    // 5. Catat audit_log
    await pool.query(
      `INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'created_custom_studio', 'studio_editor', $2)`,
      [draftId, JSON.stringify({ topic_id: topicId, slides_count: slides.length })]
    );

    res.json({
      status: 'success',
      draft_id: draftId,
      slides_count: slides.length,
    });
  } catch (err) {
    console.error('[Web API] Error creating custom draft:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Approve Draft
app.post('/api/drafts/:id/approve', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { mode = 'auto' } = req.body; // 'auto' or 'manual'

  try {
    if (mode === 'auto') {
      const scheduledAt = new Date(Date.now() + 3 * 3600 * 1000);
      await pool.query("UPDATE drafts SET status = 'scheduled', updated_at = NOW() WHERE id = $1", [draftId]);
      await pool.query(
        "INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status) VALUES ($1, 'auto', $2, 'pending')",
        [draftId, scheduledAt]
      );
      await pool.query(
        "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'approved_auto', 'web_admin', $2)",
        [draftId, JSON.stringify({ scheduled_at: scheduledAt })]
      );
    } else {
      await pool.query("UPDATE drafts SET status = 'approved', updated_at = NOW() WHERE id = $1", [draftId]);
      await pool.query(
        "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'approved_manual', 'web_admin', '{}')",
        [draftId]
      );
    }

    res.json({ status: 'success', draftId, mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Reject Draft
app.post('/api/drafts/:id/reject', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { reason = 'Ditolak via web dashboard' } = req.body;

  try {
    await pool.query("UPDATE drafts SET status = 'rejected', updated_at = NOW() WHERE id = $1", [draftId]);
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
    const { rows: drafts } = await pool.query('SELECT slides FROM drafts WHERE id = $1', [draftId]);
    if (drafts.length === 0) return res.status(404).json({ error: 'Draft not found' });

    const slides = drafts[0].slides;
    const targetIdx = slides.findIndex((s) => (s.no || 0) === slide_no || slides.indexOf(s) === slide_no - 1);
    if (targetIdx === -1) return res.status(400).json({ error: 'Slide number not found' });

    if (new_text !== undefined) slides[targetIdx].teks = new_text;
    if (layout) slides[targetIdx].layout = layout;
    if (data !== undefined) slides[targetIdx].data = data;
    if (category) {
      if (!slides[targetIdx].data) slides[targetIdx].data = {};
      slides[targetIdx].data.category = category;
    }
    if (source) slides[targetIdx].source = source;

    // Call Render Service
    const renderResp = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Secret': RENDER_SECRET },
      body: JSON.stringify({ draft_id: draftId, slides }),
    });

    if (!renderResp.ok) throw new Error('Render service failed');

    // Update DB
    const slideFilePath = path.join(STORAGE_PATH, 'drafts', String(draftId), `slide_${slide_no}.png`);
    await pool.query('UPDATE drafts SET slides = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(slides), draftId]);
    await pool.query(
      `INSERT INTO draft_slides (draft_id, slide_no, layout, render_path, text_snapshot, data_snapshot, rendered_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (draft_id, slide_no) DO UPDATE
       SET layout = EXCLUDED.layout, render_path = EXCLUDED.render_path, text_snapshot = EXCLUDED.text_snapshot, data_snapshot = EXCLUDED.data_snapshot, rendered_at = NOW()`,
      [draftId, slide_no, slides[targetIdx].layout, slideFilePath, slides[targetIdx].teks, JSON.stringify(slides[targetIdx].data || {})]
    );

    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'edit_slide', 'web_admin', $2)",
      [draftId, JSON.stringify({ slide_no, layout: slides[targetIdx].layout, teks: slides[targetIdx].teks })]
    );

    res.json({
      status: 'success',
      draftId,
      slide_no,
      layout: slides[targetIdx].layout,
      data: slides[targetIdx].data,
      image_url: `/storage/drafts/${draftId}/slide_${slide_no}.png?t=${Date.now()}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5a. Add Slide to Draft
app.post('/api/drafts/:id/add-slide', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { layout = 'big-statement', teks = 'Poin penting tambahan...', data = {} } = req.body;

  try {
    const { rows: drafts } = await pool.query('SELECT slides FROM drafts WHERE id = $1', [draftId]);
    if (drafts.length === 0) return res.status(404).json({ error: 'Draft not found' });

    const slides = drafts[0].slides;
    const newSlideNo = slides.length + 1;
    slides.push({
      no: newSlideNo,
      layout,
      teks,
      data,
      source: '@gapuramedia',
    });

    // Re-render
    const renderResp = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Secret': RENDER_SECRET },
      body: JSON.stringify({ draft_id: draftId, slides }),
    });

    if (!renderResp.ok) throw new Error('Render service failed');

    const newSlidePath = path.join(STORAGE_PATH, 'drafts', String(draftId), `slide_${newSlideNo}.png`);
    await pool.query('UPDATE drafts SET slides = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(slides), draftId]);
    await pool.query(
      `INSERT INTO draft_slides (draft_id, slide_no, layout, render_path, text_snapshot, data_snapshot, rendered_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [draftId, newSlideNo, layout, newSlidePath, teks, JSON.stringify(data)]
    );

    res.json({ status: 'success', draftId, new_slide_no: newSlideNo, total_slides: slides.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5b. Delete Slide from Draft
app.post('/api/drafts/:id/delete-slide', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { slide_no } = req.body;

  try {
    const { rows: drafts } = await pool.query('SELECT slides FROM drafts WHERE id = $1', [draftId]);
    if (drafts.length === 0) return res.status(404).json({ error: 'Draft not found' });

    let slides = drafts[0].slides;
    if (slides.length <= 1) return res.status(400).json({ error: 'Draf minimal harus memiliki 1 slide.' });

    slides = slides.filter((s, idx) => (s.no || idx + 1) !== slide_no);
    slides.forEach((s, idx) => { s.no = idx + 1; });

    // Clean old slide files and re-render
    const renderResp = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Secret': RENDER_SECRET },
      body: JSON.stringify({ draft_id: draftId, slides }),
    });

    if (!renderResp.ok) throw new Error('Render service failed');

    await pool.query('DELETE FROM draft_slides WHERE draft_id = $1', [draftId]);
    for (const s of slides) {
      const sPath = path.join(STORAGE_PATH, 'drafts', String(draftId), `slide_${s.no}.png`);
      await pool.query(
        `INSERT INTO draft_slides (draft_id, slide_no, layout, render_path, text_snapshot, data_snapshot, rendered_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [draftId, s.no, s.layout, sPath, s.teks, JSON.stringify(s.data || {})]
      );
    }
    await pool.query('UPDATE drafts SET slides = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(slides), draftId]);

    res.json({ status: 'success', draftId, total_slides: slides.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5b. Update Draft Full (caption, slides, schedule)
app.post('/api/drafts/:id/update-full', async (req, res) => {
  const draftId = parseInt(req.params.id);
  const { caption, slides, scheduled_at, mode = 'auto' } = req.body;
  try {
    if (caption) {
      await pool.query('UPDATE drafts SET caption = $1, updated_at = NOW() WHERE id = $2', [caption, draftId]);
    }
    if (slides && Array.isArray(slides)) {
      await pool.query('UPDATE drafts SET slides = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(slides), draftId]);
      await fetch(`${RENDER_SERVICE_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Render-Secret': RENDER_SECRET },
        body: JSON.stringify({ draft_id: draftId, slides }),
      });
      // Update draft_slides snapshots
      for (const s of slides) {
        await pool.query(
          'UPDATE draft_slides SET text_snapshot = $1, rendered_at = NOW() WHERE draft_id = $2 AND slide_no = $3',
          [s.teks || '', draftId, s.no]
        );
      }
    }
    if (scheduled_at) {
      await pool.query("UPDATE drafts SET status = 'scheduled', updated_at = NOW() WHERE id = $1", [draftId]);
      await pool.query(
        "INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status) VALUES ($1, $2, $3, 'pending')",
        [draftId, mode, new Date(scheduled_at)]
      );
      await pool.query(
        "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('draft', $1, 'scheduled_custom', 'web_admin', $2)",
        [draftId, JSON.stringify({ scheduled_at, mode })]
      );
    }
    res.json({ status: 'success', draftId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Topics List with Scores
app.get('/api/topics', async (req, res) => {
  const { status, limit = 50 } = req.query;
  try {
    let query = `
      SELECT t.*, ts.score_relevance, ts.score_credibility, ts.score_momentum, ts.score_engagement, ts.score_compliance, ts.score_total, ts.verdict, ts.reasoning
      FROM topics t
      LEFT JOIN topic_scores ts ON t.id = ts.topic_id
    `;
    const params = [];
    if (status) {
      query += ' WHERE t.status = $1 ';
      params.push(status);
    }
    query += ` ORDER BY t.id DESC LIMIT $${params.length + 1} `;
    params.push(parseInt(limit));

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Promote Topic to Copywriter Pipeline
app.post('/api/topics/:id/promote', async (req, res) => {
  const topicId = parseInt(req.params.id);
  try {
    await pool.query("UPDATE topics SET status = 'scored', updated_at = NOW() WHERE id = $1", [topicId]);
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
    // Cek apakah sudah pernah diproduksi
    const { rows: existingDrafts } = await pool.query('SELECT id FROM drafts WHERE topic_id = $1 LIMIT 1', [topicId]);
    if (existingDrafts.length > 0 && !force) {
      return res.json({ status: 'success', draft_id: existingDrafts[0].id, is_existing: true });
    }

    // Ambil detail topik
    const { rows: topics } = await pool.query('SELECT * FROM topics WHERE id = $1', [topicId]);
    if (topics.length === 0) {
      return res.status(404).json({ error: 'Topik tidak ditemukan' });
    }

    const topic = topics[0];
    if (existingDrafts.length > 0 && force) {
      const draftId = existingDrafts[0].id;
      const carouselData = await buildCarouselSlides(topic);
      const renderResp = await fetch(`${RENDER_SERVICE_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Render-Secret': RENDER_SECRET },
        body: JSON.stringify({ draft_id: draftId, slides: carouselData.slides }),
      });
      const renderData = await renderResp.json();
      await pool.query('UPDATE drafts SET slides = $1, caption = $2, hashtags = $3, status = $4, updated_at = NOW() WHERE id = $5',
        [JSON.stringify(carouselData.slides), carouselData.caption, carouselData.hashtags, 'draft', draftId]);
      await pool.query('DELETE FROM draft_slides WHERE draft_id = $1', [draftId]);
      for (const slideRes of renderData.rendered_slides) {
        await pool.query(
          `INSERT INTO draft_slides (draft_id, slide_no, layout, render_path, text_snapshot, data_snapshot)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            draftId,
            slideRes.slide_no,
            slideRes.layout,
            slideRes.file_path,
            carouselData.slides[slideRes.slide_no - 1]?.teks || '',
            JSON.stringify(carouselData.slides[slideRes.slide_no - 1]?.data || {}),
          ]
        );
      }
      return res.json({ status: 'success', draft_id: draftId, is_existing: false, slides_count: carouselData.slides.length });
    }

    const result = await produceSingleTopicDraft(topic, pool);
    res.json({ status: 'success', draft_id: result.draft_id, is_existing: false, slides_count: result.slides_count });
  } catch (err) {
    console.error('[Web API] Auto-produce error:', err);
    res.status(500).json({ error: err.message });
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
    const renderRes = await fetch(`${RENDER_SERVICE_URL}/render/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Render-Secret': RENDER_SECRET,
      },
      body: JSON.stringify(req.body),
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
    res.status(500).json({ error: err.message });
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
    };
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/config', async (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ error: 'Payload konfigurasi tidak valid.' });
    }

    // 1. Simpan skills.md kustom untuk masing-masing agen
    if (newConfig.skills && typeof newConfig.skills === 'object') {
      ['scout', 'analis', 'copywriter', 'designer'].forEach((key) => {
        if (typeof newConfig.skills[key] === 'string') {
          saveAgentSkills(key, newConfig.skills[key]);
        }
      });
    }

    // 2. Simpan konfigurasi ke config/agents.json (tanpa bloat payload skills)
    const jsonToSave = { ...newConfig };
    delete jsonToSave.skills;
    fs.writeFileSync(AGENTS_CONFIG_PATH, JSON.stringify(jsonToSave, null, 2), 'utf8');

    // 3. Jika konfigurasi designer / tokens ada pembaruan, sinkronisasi ke tokens.yaml dan reload Render Service
    if (newConfig.designer && newConfig.designer.tokens) {
      try {
        let existingTokens = {};
        if (fs.existsSync(TOKENS_PATH)) {
          existingTokens = yaml.load(fs.readFileSync(TOKENS_PATH, 'utf8')) || {};
        }
        existingTokens.palette = {
          ...(existingTokens.palette || {}),
          ...(newConfig.designer.tokens.palette || {}),
        };
        existingTokens.typography = {
          ...(existingTokens.typography || {}),
          ...(newConfig.designer.tokens.typography || {}),
        };
        const tokensYaml = yaml.dump(existingTokens);
        fs.writeFileSync(TOKENS_PATH, tokensYaml, 'utf8');
        await fetch(`${RENDER_SERVICE_URL}/tokens/reload`, {
          method: 'POST',
          headers: { 'X-Render-Secret': RENDER_SECRET },
        });
        console.log('[Web API] Desain tokens berhasil disinkronisasi & di-reload di Render Service.');
      } catch (tokenErr) {
        console.warn('[Web API] Gagal sinkronisasi token desain:', tokenErr.message);
      }
    }

    // 4. Jika threshold analis diubah, sinkronisasi ke app_settings DB
    if (newConfig.analis && newConfig.analis.min_score_threshold) {
      try {
        await pool.query(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES ('score_threshold', $1, NOW())
           ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify({ initial_strict_score: parseInt(newConfig.analis.min_score_threshold) })]
        );
      } catch (dbErr) {
        console.warn('[Web API] Gagal sinkronisasi score_threshold ke DB:', dbErr.message);
      }
    }

    // 5. Catat ke audit_log
    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('ai_agents', 1, 'update_config', 'web_admin', $1)",
      [JSON.stringify({ updated_agents: Object.keys(newConfig) })]
    );

    res.json({ status: 'success', message: 'Konfigurasi 4 Agen AI dan seluruh berkas skills.md berhasil disimpan dan diterapkan ke seluruh sistem.' });
  } catch (err) {
    console.error('[Web API] Gagal menyimpan config agen:', err);
    res.status(500).json({ error: err.message });
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
  try {
    const workflowPath = path.resolve(__dirname, '../../workflows/HME_Content_Pipeline.json');
    let workflowJson = {};
    if (fs.existsSync(workflowPath)) {
      workflowJson = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    }

    let dbWorkflow = null;
    try {
      const { rows } = await n8nPool.query(
        'SELECT id, name, active, "updatedAt" FROM workflow_entity WHERE id = $1 LIMIT 1',
        ['d3j0Kr9koCQFlRIG']
      );
      if (rows.length > 0) {
        dbWorkflow = rows[0];
      }
    } catch (dbErr) {
      console.warn('[Web API] Query n8n DB error:', dbErr.message);
    }

    res.json({
      id: dbWorkflow ? dbWorkflow.id : 'd3j0Kr9koCQFlRIG',
      name: dbWorkflow ? dbWorkflow.name : 'Homeless Media Engine - Content Pipeline',
      active: dbWorkflow ? dbWorkflow.active : false,
      updated_at: dbWorkflow ? dbWorkflow.updatedAt : null,
      canvas_url: 'https://n8n.avenia.my.id/workflow/d3j0Kr9koCQFlRIG',
      json: workflowJson,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflow/toggle', async (req, res) => {
  const { active } = req.body;
  try {
    const isActive = Boolean(active);
    await n8nPool.query(
      'UPDATE workflow_entity SET active = $1, "updatedAt" = NOW() WHERE id = $2',
      [isActive, 'd3j0Kr9koCQFlRIG']
    );

    // Reload / restart n8n to apply schedule triggers cleanly
    exec('systemctl restart hme-n8n', (err) => {
      if (err) console.error('[Web API] Failed to restart hme-n8n:', err);
    });

    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('workflow', 1, $1, 'web_admin', $2)",
      [isActive ? 'activated' : 'deactivated', JSON.stringify({ active: isActive })]
    );

    res.json({ status: 'success', active: isActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  const { name, type = 'rss', url_or_query, category = 'news_pasar', poll_interval_mins = 30, is_active = true } = req.body;
  if (!name || !url_or_query) {
    return res.status(400).json({ error: 'Nama sumber dan URL/Query wajib diisi.' });
  }

  try {
    const query = `
      INSERT INTO sources (name, type, url_or_query, category, poll_interval_mins, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      name.trim(),
      type.trim(),
      url_or_query.trim(),
      category.trim(),
      parseInt(poll_interval_mins) || 30,
      Boolean(is_active),
    ]);

    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('sources', $1, 'create_source', 'web_admin', $2)",
      [rows[0].id, JSON.stringify({ name, url_or_query, category })]
    );

    res.json({ status: 'success', source: rows[0], message: `Sumber "${name}" berhasil ditambahkan.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update existing news source
app.put('/api/sources/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, type = 'rss', url_or_query, category = 'news_pasar', poll_interval_mins = 30, is_active = true } = req.body;
  if (!name || !url_or_query) {
    return res.status(400).json({ error: 'Nama sumber dan URL/Query wajib diisi.' });
  }

  try {
    const query = `
      UPDATE sources
      SET name = $1, type = $2, url_or_query = $3, category = $4, poll_interval_mins = $5, is_active = $6, updated_at = NOW()
      WHERE id = $7
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      name.trim(),
      type.trim(),
      url_or_query.trim(),
      category.trim(),
      parseInt(poll_interval_mins) || 30,
      Boolean(is_active),
      id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Sumber tidak ditemukan.' });
    }

    await pool.query(
      "INSERT INTO audit_log (entity, entity_id, action, actor, payload) VALUES ('sources', $1, 'update_source', 'web_admin', $2)",
      [id, JSON.stringify({ name, url_or_query, category, is_active })]
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
    const result = await runScout();
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

app.listen(PORT, HOST, () => {
  console.log(`[Gapura Web Dashboard] Running on http://${HOST}:${PORT}`);
});
