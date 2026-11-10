// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Render Micro-Service HTTP API
// File: /root/gapura/services/render/server.js
// ==============================================================================

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { RenderEngine } from './engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env dari root repositori gapura
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.RENDER_PORT || 3000;
const HOST = process.env.RENDER_HOST || '127.0.0.1';
const RENDER_SECRET = process.env.RENDER_SECRET || 'dev_render_secret_hme';
const STORAGE_PATH = process.env.STORAGE_PATH || path.resolve(__dirname, '../../storage');
const DESIGN_SYSTEM_PATH = process.env.DESIGN_SYSTEM_PATH || path.resolve(__dirname, '../../design-system');

// Inisialisasi Render Engine
const engine = new RenderEngine(DESIGN_SYSTEM_PATH);

// Middleware Validasi Shared Secret
const authenticate = (req, res, next) => {
  const secretHeader = req.headers['x-render-secret'];
  if (!secretHeader || secretHeader !== RENDER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-Render-Secret' });
  }
  next();
};

// 1. Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hme-render-service',
    version: '2.0.0',
    uptime: process.uptime(),
    memory_usage: process.memoryUsage(),
    fonts_loaded: engine.fonts.map((f) => `${f.name} (${f.weight})`),
  });
});

// 2. Batch Render Full Carousel Draf
app.post('/render', authenticate, async (req, res) => {
  const { draft_id, slides } = req.body;

  if (!draft_id || !Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: 'Invalid payload: draft_id and non-empty slides array required' });
  }

  const startTime = Date.now();
  try {
    const draftsOutputDir = path.join(STORAGE_PATH, 'drafts');
    const renderedSlides = await engine.renderCarouselToDisk(draft_id, slides, draftsOutputDir);
    const totalTimeMs = Date.now() - startTime;

    res.json({
      status: 'success',
      draft_id,
      rendered_slides: renderedSlides,
      total_time_ms: totalTimeMs,
    });
  } catch (err) {
    console.error(`[Render API] Error rendering draft ${draft_id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Single Slide Preview (Returns PNG image buffer directly)
app.post('/render/preview', authenticate, async (req, res) => {
  const { slide, slide_no, total_slides } = req.body;

  if (!slide || !slide.teks) {
    return res.status(400).json({ error: 'Invalid payload: slide object with teks is required' });
  }

  try {
    const pngBuffer = await engine.renderSlideToBuffer(
      slide,
      slide_no || 1,
      total_slides || 1
    );
    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (err) {
    console.error('[Render API] Error rendering preview:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Reload Tokens & Layouts
app.post('/tokens/reload', authenticate, (req, res) => {
  try {
    engine.reloadTokens();
    res.json({ status: 'success', message: 'Tokens reloaded successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[hme-render-service] Running deterministically on http://${HOST}:${PORT}`);
});
