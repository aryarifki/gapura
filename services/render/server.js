// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Render Micro-Service HTTP API
// File: /root/gapura/services/render/server.js
// ==============================================================================

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { RenderEngine, ensureJpegDerivatives } from './engine.js';
import { validateRenderRequest } from './validation.js';
import { runtimeSecret } from '../common/runtime-secret.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env dari root repositori gapura
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.RENDER_PORT || 3000;
const HOST = process.env.RENDER_HOST || '127.0.0.1';
const RENDER_SECRET = runtimeSecret('RENDER_SECRET', { testValue: 'isolated-render-test' });
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
  const startTime = Date.now();
  try {
    validateRenderRequest(req.body);
    const { draft_id, slides } = req.body;
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
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[Render API] Error rendering draft:', err);
    res.status(500).json({ error: 'Rendering failed' });
  }
});

// 3. Single Slide Preview (Returns PNG image buffer directly, supports override tokens)
app.post('/render/preview', authenticate, async (req, res) => {
  try {
    validateRenderRequest(req.body, true);
    const { slide, slide_no, total_slides, tokens } = req.body;
    const pngBuffer = await engine.renderSlideToBuffer(
      slide,
      slide_no ?? 1,
      total_slides ?? 1,
      tokens ?? null
    );
    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[Render API] Error rendering preview:', err);
    res.status(500).json({ error: 'Rendering failed' });
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

// JSON parser failures must not expose Express stack traces or request content.
app.use((err, req, res, next) => {
  const status = err.status === 413 ? 413 : 400;
  res.status(status).json({ error: status === 413 ? 'Payload too large' : 'Invalid JSON payload' });
});

app.listen(PORT, HOST, async () => {
  console.log(`[hme-render-service] Running deterministically on http://${HOST}:${PORT}`);
  try {
    const created = await ensureJpegDerivatives(path.join(STORAGE_PATH, 'drafts'));
    if (created) console.log(`[hme-render-service] Backfilled ${created} JPEG publication derivative(s).`);
  } catch (error) {
    console.warn(`[hme-render-service] JPEG backfill skipped: ${error.message}`);
  }
});
