import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildEditorialBrief, validateOriginalContent } from '../../common/original-editorial.js';
import { originalFixture } from '../../common/test/fixtures/original-editorial.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const ROOT = path.resolve(PUBLIC, '../../..');
const enabled = Boolean(process.env.PLAYWRIGHT_PATH);

test('Chromium: newsroom opens without login, navigation, fresh draft review, Radar actions, and edited agent settings', { skip: !enabled, timeout: 60000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const target = path.resolve(PUBLIC, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!target.startsWith(`${PUBLIC}/`)) { res.writeHead(403).end(); return; }
      const data = await fs.readFile(target);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(target)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }).end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config/agents.json'), 'utf8'));
  config.skills = Object.fromEntries(await Promise.all(['scout', 'analis', 'copywriter', 'designer', 'seo', 'studio'].map(async (key) => [key, await fs.readFile(path.join(ROOT, 'config/skills', `${key}.skills.md`), 'utf8')])));
  const stamp = '2026-11-16T02:00:00Z';
  const topic = { id: '42', title: 'Inflasi Oktober 2,1% menurut BPS', summary: 'Data BPS menunjukkan inflasi tahunan 2,1%.', status: 'scored', desk: 'ekonomi', score_total: 88, primary_source: 'BPS', url: 'https://www.bps.go.id/rilis/1', created_at: stamp, verification_status: 'verified' };
  const tagline = 'Politik, Sosial, Hukum, Lingkungan & Ekonomi Nasional termasuk Bursa Saham';
  const draft = { id: '21', topic_id: '42', topic_title: topic.title, caption: topic.summary, hashtags: ['#GapuraMedia'], primary_source: 'BPS', source_url: topic.url, status: 'draft', score_total: 88, created_at: stamp, rendered_slides: [{ slide_no: 1, layout: 'cover-focus', text: topic.title, data: { title: topic.title }, image_url: '/assets/logo.png' }] };
  const assetId = '2d30e364-b95d-4d49-82ed-43c548270944';
  let illustration = null;
  const currentInput = { version: 1, mode: 'current', facts: [{ id: 'service', text: 'Layanan dibuka kembali.', source_url: 'https://example.org/rilis', source_name: 'Dinas' }] };
  const makeContent = (input = { mode: 'explainer', facts: [] }) => { const brief = buildEditorialBrief(topic, { editorialInput: input }); return validateOriginalContent(originalFixture(brief), brief); };
  let detailDraft = { ...draft, ...makeContent(currentInput), caption: 'Fresh detail caption for review', revision: 'fixture-reviewed-revision' };
  let jobs = [];
  const requests = [];
  const credentialedRequests = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() ? JSON.parse(request.postData()) : {};
    requests.push({ path: url.pathname, query: url.search, body, method: request.method() });
    const requestHeaders = await request.allHeaders();
    if (requestHeaders.authorization || requestHeaders.cookie) credentialedRequests.push(url.pathname);
    let data = [];
    let status = 200;
    const headers = { 'Content-Type': 'application/json' };
    switch (url.pathname) {
      case '/api/stats': data = { raw_items: 2, scores: { passed: 1 }, drafts: { draft: 1 }, services: { database: true, render: true, n8n: true } }; break;
      case '/api/drafts': data = [draft]; break;
      case '/api/drafts/21': data = detailDraft; break;
      case '/api/drafts/21/update-full': detailDraft = { ...detailDraft, caption: body.caption, revision: 'fixture-edited-revision' }; data = { status: 'success' }; break;
      case '/api/drafts/21/regenerate-ai':
        detailDraft = { ...detailDraft, ...makeContent(body.editorial_input), revision: 'fixture-regenerated-revision' };
        data = { status: 'success', ...detailDraft, needs_review: true }; break;
      case '/api/drafts/21/add-slide': status = 422; data = { error: 'Slide editorial belum valid; periksa data dan rujukan.' }; break;
      case '/api/designer/generate-slides': data = { status: 'success', ...makeContent(body.editorial_input) }; break;
      case '/api/drafts/create-from-custom':
        detailDraft = { ...detailDraft, ...body, revision: 'fixture-custom-revision', rendered_slides: body.slides.map((slide) => ({ slide_no: slide.no, layout: slide.layout, text: slide.teks, data: slide.data, image_url: '/assets/logo.png' })) };
        data = { status: 'success', draft_id: 21 }; break;
      case '/api/studio/jobs':
        if (request.method() === 'POST') jobs = [{ id: 9, prompt: body.prompt, topic_id: 42, status: 'queued', plan: { editorial_input: body.editorial_input }, created_at: stamp }];
        data = request.method() === 'POST' ? { status: 'success', job: jobs[0] } : jobs; break;
      case '/api/studio/jobs/9/stream':
        jobs[0] = { ...jobs[0], status: 'plan_review', plan: { ...jobs[0].plan, title: 'Mekanisme layanan warga', angle: 'Akses layanan', sections: ['Mekanisme layanan', 'Hak warga'], format: 'carousel', slide_count_hint: 6 } };
        await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'data: {"done":true,"status":"plan_review"}\n\n' }); return;
      case '/api/drafts/21/approve':
        status = body.reviewed === true && body.expected_revision === detailDraft.revision ? 200 : 409;
        data = status === 200 ? { status: 'success' } : { error: 'Draf telah berubah. Muat ulang dan tinjau konten terbaru sebelum menyetujui.' };
        break;
      case '/api/topics': data = url.searchParams.get('q')?.includes('nothing') ? [] : [topic]; headers['X-Has-More'] = 'false'; headers['X-Next-Offset'] = '1'; break;
      case '/api/topics/42/illustration': data = { assets: illustration ? [illustration] : [], selected: illustration, configured: true }; break;
      case '/api/topics/42/illustration/generate': illustration = { id: assetId, status: 'ready', kind: 'ai_generated', disclosure: 'Ilustrasi AI · Gapura Media' }; data = { asset: illustration, is_existing: false }; break;
      case `/api/media/assets/${assetId}`:
        await route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: await fs.readFile(path.join(PUBLIC, 'assets/logo.png')) }); return;
      case '/api/drafts/21/illustration':
        detailDraft = { ...detailDraft, revision: 'fixture-illustration-revision', rendered_slides: detailDraft.rendered_slides.map((slide, i) => i ? slide : { ...slide, data: { ...slide.data, asset_id: body.asset_id, asset_sha256: 'a'.repeat(64), image_kind: 'ai_generated', disclosure_version: 1 } }) };
        data = { status: 'success', asset_id: body.asset_id, needs_review: true }; break;
      case '/api/agents/config':
        if (request.method() === 'POST') { for (const [key, value] of Object.entries(body)) config[key] = { ...config[key], ...value }; data = { status: 'success' }; }
        else data = config;
        break;
      case '/api/agents/config/test': data = { status: 'passed', message: 'Fixture provider returned JSON' }; break;
      case '/api/providers': data = {
        providers: [{
          id: 'gemini', label: 'Google Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com',
          enabled: true, key_configured: true, model_count: 2, models: ['gemini-3.5-flash-lite', 'gemini-2.5-flash'],
          default_model: 'gemini-3.5-flash-lite', notes: '', fetched_at: stamp, error: null,
        }],
        routing: { fallback_chain: ['gemini/gemini-2.5-flash'] },
      }; break;
      case '/api/seo/health': data = { stale: true, x_api_configured: false, rsshub_configured: false, active_sources: 2, successful_sources: 1, latest_success_at: stamp }; break;
      case '/api/sources': data = [{ id: 1, name: 'ANTARA Politik', category: 'umum', desk: 'politik', type: 'rss', url_or_query: 'https://example.org/politik.xml', is_active: true, poll_interval_mins: 30 }, { id: 2, name: 'Lintas isu', category: 'umum', desk: null, type: 'rss', url_or_query: 'https://example.org/general.xml', is_active: true, poll_interval_mins: 30 }]; break;
      case '/api/workflow': data = { active: false, json: {} }; break;
      case '/api/tokens': data = { parsed: { brand: { tagline } }, raw: `brand:\n  tagline: ${tagline}\n` }; break;
      case '/api/render/preview':
        await route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: await fs.readFile(path.join(PUBLIC, 'assets/logo.png')) }); return;
      case '/api/client-log': status = 204; break;
      default: data = [];
    }
    await route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(data) });
  });
  await page.goto(base);
  assert.equal(await page.locator('#admin-access-gate, #admin-access-form, #admin-access-token, .access-gate, .access-panel').count(), 0, 'The newsroom must not contain admin login markup');
  assert.equal(await page.locator('.app-container').evaluate((app) => app.inert), false, 'The newsroom must be interactive immediately');
  await page.waitForFunction(() => document.querySelector('#ov-raw-val').textContent === '2');
  assert.deepEqual(requests.filter((entry) => entry.path.startsWith('/api/access/')), [], 'Startup must not request admin access endpoints');
  await page.locator('[data-view="view-topics"]').click();
  await page.locator('[data-produce-topic="42"]').waitFor();
  assert.equal(await page.locator('[data-verify-topic], [data-view="view-verifications"], [data-agent="verifikator"]').count(), 0);
  assert.doesNotMatch(await page.locator('.radar-item-card').innerText(), /Belum diverifikasi|verified|Verifikasi/);
  assert.match(await page.locator('.radar-item-card').innerText(), /Ekonomi Nasional/i);
  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/topics' && new URL(response.url()).searchParams.get('desk') === 'politik'),
    page.locator('#topic-desk').selectOption('politik'),
  ]);
  assert.ok(requests.some((entry) => entry.path === '/api/topics' && new URLSearchParams(entry.query).get('desk') === 'politik'));
  await page.locator('#topic-desk').selectOption('');
  assert.equal(requests.filter((r) => r.path.includes('/illustration')).length, 0, 'loading Radar must not generate or fetch images');
  await page.locator('[data-illustration-action="open"]').click();
  await page.getByText('Belum ada ilustrasi AI.', { exact: true }).waitFor();
  await page.locator('[data-illustration-action="generate"]').click();
  await page.getByText('Ilustrasi terpilih siap.', { exact: true }).waitFor();
  const generationRequests = requests.filter((r) => r.path.endsWith('/illustration/generate'));
  assert.equal(generationRequests.length, 1);
  assert.match(generationRequests[0].body.request_id, /^[a-f0-9-]{36}$/u);
  assert.deepEqual(Object.keys(generationRequests[0].body), ['request_id']);
  await page.locator(`[data-topic-illustration="42"] img`).waitFor();
  assert.equal(await page.locator(`[data-topic-illustration="42"] img`).evaluate((image) => image.complete && image.naturalWidth > 0), true);
  await page.locator('[data-view="view-review"]').click();
  await page.locator('.gallery-card').click();
  await page.waitForURL('**/#view-review/draft/21');
  await page.waitForFunction(() => document.querySelector('#editor-input-caption').value === 'Fresh detail caption for review');
  assert.match(await page.locator('#editor-editorial-mode').textContent(), /Current/);
  assert.match(await page.locator('#editor-editorial-angle').textContent(), /Membaca hubungan/);
  assert.match(await page.locator('#editor-editorial-scope').textContent(), /mekanisme umum/);
  assert.match(await page.locator('#editor-editorial-references').textContent(), /service: Layanan dibuka kembali.*Dinas/);
  assert.equal(await page.locator('#editor-editorial-references a').getAttribute('href'), currentInput.facts[0].source_url);
  assert.ok(requests.some((entry) => entry.method === 'GET' && entry.path === '/api/drafts/21'));
  assert.equal(await page.locator('#editor-reviewed').isChecked(), false);
  await page.locator('#editor-reviewed').check();
  await page.locator('#btn-use-topic-illustration').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Ilustrasi diperbarui'));
  assert.equal(await page.locator('#editor-reviewed').isChecked(), false);
  assert.ok(requests.some((r) => r.path === '/api/drafts/21/illustration' && r.body.asset_id === assetId));
  detailDraft = { ...detailDraft, caption: 'Changed in another browser', revision: 'fixture-remote-revision' };
  const beforeStaleApproval = requests.length;
  await page.locator('#editor-reviewed').check();
  await page.locator('#btn-action-approve-auto').click();
  await page.waitForFunction(() => /muat ulang/i.test(document.querySelector('#toast').textContent));
  assert.deepEqual(requests.slice(beforeStaleApproval).filter((entry) => entry.path.startsWith('/api/drafts')), [{
    path: '/api/drafts/21/approve', query: '', method: 'POST',
    body: { mode: 'auto', reviewed: true, expected_revision: 'fixture-illustration-revision' },
  }]);
  assert.equal(await page.locator('#editor-input-caption').inputValue(), 'Fresh detail caption for review');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#editor-input-caption').value === 'Changed in another browser');
  assert.equal(await page.locator('#editor-reviewed').isChecked(), false);
  await page.locator('#editor-reviewed').check();
  await page.locator('#editor-input-caption').fill('Saved edit requires a fresh review');
  await page.locator('#btn-save-text-only').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('caption berhasil disimpan'));
  assert.equal(await page.locator('#editor-reviewed').isChecked(), false);
  await page.locator('#editor-reviewed').check();
  const beforeEditedApproval = requests.length;
  await page.locator('#btn-action-approve-auto').click();
  await page.waitForFunction(() => /muat ulang/i.test(document.querySelector('#toast').textContent));
  assert.deepEqual(requests.slice(beforeEditedApproval).filter((entry) => entry.path.startsWith('/api/drafts')), []);
  await page.locator('#btn-back-to-gallery').click();
  await page.locator('#review-gallery-subview').waitFor({ state: 'visible' });
  await page.locator('.gallery-card').click();
  await page.waitForFunction(() => document.querySelector('#editor-input-caption').value === 'Saved edit requires a fresh review');
  assert.equal(await page.locator('#editor-reviewed').isChecked(), false);
  const beforeFreshApproval = requests.length;
  await page.locator('#editor-reviewed').check();
  await page.locator('#btn-action-approve-auto').click();
  await page.locator('#review-gallery-subview').waitFor({ state: 'visible' });
  assert.deepEqual(requests.slice(beforeFreshApproval).filter((entry) => entry.path === '/api/drafts/21' || entry.path.endsWith('/approve')), [{
    path: '/api/drafts/21/approve', query: '', method: 'POST',
    body: { mode: 'auto', reviewed: true, expected_revision: 'fixture-edited-revision' },
  }]);
  await page.goBack();
  assert.equal(new URL(page.url()).hash, '#view-topics');
  await page.locator('#topic-search').fill('nothing');
  await page.waitForFunction(() => document.querySelector('#radar-list-container').textContent.includes('Tidak ada topik'));
  await page.locator('#topic-search').fill('');
  await page.locator('[data-view="view-agents"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.provider-row').length > 0);
  assert.match(await page.locator('#provider-catalog-status').textContent(), /1 provider/);
  await page.locator('[data-agent="studio"]').click();
  await page.locator('#studio-agent-prompt').fill('Edited Studio instruction from browser test');
  await page.locator('#btn-test-agent-config').click();
  await page.waitForFunction(() => document.querySelector('#agent-test-status').textContent.includes('passed'));
  await page.locator('#btn-save-agents-config-top').click();
  await page.waitForFunction(() => !document.querySelector('#btn-save-agents-config-top').disabled);
  assert.equal(config.studio.system_prompt, 'Edited Studio instruction from browser test');
  assert.ok(requests.some((entry) => entry.path === '/api/agents/config/test' && entry.body.config.studio.system_prompt === 'Edited Studio instruction from browser test'));
  await page.locator('[data-agent="designer"]').click();
  await page.locator('#designer-image-model').fill('gemini-3.1-flash-lite-image');
  await page.locator('#btn-save-agents-config-top').click();
  await page.waitForFunction(() => !document.querySelector('#btn-save-agents-config-top').disabled);
  assert.equal(config.designer.image_generation.model, 'gemini-3.1-flash-lite-image');
  await page.locator('[data-view="view-trends"]').click();
  await page.waitForFunction(() => document.querySelector('#trend-health-message').textContent.includes('fallback'));
  for (const desk of ['politik', 'sosial', 'hukum', 'lingkungan', 'ekonomi', 'bursa']) {
    assert.equal(await page.locator(`#trend-source-category option[value="${desk}"]`).count(), 1);
  }
  await page.locator('[data-view="view-sources"]').click();
  await page.getByText('ANTARA Politik', { exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('#sources-table-body').innerText(), /Ekonomi Umum/);
  assert.match(await page.locator('#sources-table-body').innerText(), /Umum \/ Lintas Isu|Desk otomatis/);
  await page.locator('#btn-open-add-source-modal').click();
  assert.equal(await page.locator('#source-input-category').inputValue(), 'umum');
  await page.locator('#btn-close-source-modal').click();
  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/render/preview'),
    page.locator('[data-view="view-tokens"]').click(),
  ]);
  await page.waitForFunction((expected) => document.querySelector('#studio-brand-tagline').value === expected, tagline);
  assert.ok(requests.some((entry) => entry.path === '/api/render/preview' && entry.body.tokens.brand.tagline === tagline));
  await page.locator('[data-view="view-studio-prompt"]').click();
  await page.waitForFunction(() => document.querySelector('#studio-source-topic').options.length > 1);
  await page.locator('#studio-source-topic').selectOption('42');
  await page.locator('#studio-prompt-input').fill('Jelaskan mekanisme akses layanan publik');
  await page.locator('#studio-editorial-mode').selectOption('current');
  const beforeEmptyCurrent = requests.filter((request) => request.path === '/api/studio/jobs' && request.method === 'POST').length;
  await page.locator('#btn-studio-submit').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('minimal satu catatan fakta'));
  assert.equal(requests.filter((request) => request.path === '/api/studio/jobs' && request.method === 'POST').length, beforeEmptyCurrent);
  await page.locator('#studio-editorial-facts').fill(JSON.stringify(currentInput.facts));
  await page.locator('#btn-studio-submit').click();
  await page.locator('#plan-edit-9').waitFor({ state: 'attached' });
  const submittedJob = requests.find((request) => request.path === '/api/studio/jobs' && request.method === 'POST');
  assert.deepEqual(submittedJob.body.editorial_input, currentInput);
  assert.equal(JSON.parse(await page.locator('#plan-edit-9').inputValue()).editorial_input.mode, 'current');
  assert.equal(submittedJob.body.summary, undefined);
  await page.evaluate((editorial_input) => renderStudioJobs([{ id: 10, status: 'queued', prompt: 'Queued editorial seed', plan: { editorial_input } }]), currentInput);
  assert.equal(await page.locator('#studio-job-10 .btn-studio-run, #plan-edit-10').count(), 0, 'seed input must not render as a reviewed plan');
  await page.locator('#btn-studio-refresh').click();
  await page.locator('#plan-edit-9').waitFor({ state: 'attached' });
  await page.locator('[data-view="view-review"]').click();
  await page.locator('.gallery-card').click();
  await page.locator('#editor-original-review details summary').click();
  await page.locator('#editor-reviewed').check();
  await page.locator('#editor-regenerate-mode').selectOption('explainer');
  assert.equal(await page.locator('#editor-reviewed').isChecked(), false);
  await page.locator('#editor-regenerate-facts').fill('[]');
  await page.locator('#btn-action-regenerate-ai').click();
  await page.waitForFunction(() => document.querySelector('#editor-editorial-mode').textContent.includes('Explainer'));
  assert.deepEqual(requests.find((request) => request.path === '/api/drafts/21/regenerate-ai').body.editorial_input, { version: 1, mode: 'explainer', facts: [] });
  assert.equal(await page.locator('#editor-reviewed').isChecked(), false);
  await page.locator('[data-view="view-tokens"]').click();
  await page.locator('#studio-quick-topic-select').selectOption('42');
  assert.equal(await page.locator('#btn-studio-save-to-drafts').isDisabled(), true);
  await page.locator('#studio-custom-editorial-mode').selectOption('current');
  await page.locator('#studio-custom-editorial-facts').fill(JSON.stringify(currentInput.facts));
  await page.locator('#btn-studio-generate-ai').click();
  await page.waitForFunction(() => !document.querySelector('#btn-studio-generate-ai').disabled);
  assert.equal(await page.locator('#btn-studio-save-to-drafts').isDisabled(), false);
  assert.match(await page.locator('#studio-generated-scope').textContent(), /Current/);
  await page.locator('#btn-studio-save-to-drafts').click();
  await page.waitForURL('**/#view-review/draft/21');
  const custom = requests.find((request) => request.path === '/api/drafts/create-from-custom').body;
  assert.equal(custom.format, 'carousel');
  assert.equal(custom.slides.length, 6);
  assert.equal(custom.editorial_mode, 'current');
  assert.deepEqual(custom.editorial_input, currentInput);
  assert.ok(custom.caption_body.length >= 1200);
  assert.ok(custom.threads_caption.length <= 500);
  assert.deepEqual(custom.editorial_references, makeContent(currentInput).editorial_references);
  assert.equal(custom.summary, undefined);
  await page.waitForFunction(() => document.querySelectorAll('.editor-thumb-box').length === 6);
  await page.once('dialog', (dialog) => dialog.accept());
  const beforeRejectedAdd = await page.locator('.editor-thumb-box').count();
  await page.locator('#btn-add-slide-editor').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Slide editorial belum valid'));
  assert.equal(await page.locator('.editor-thumb-box').count(), beforeRejectedAdd);
  detailDraft = { ...detailDraft, rendered_slides: detailDraft.rendered_slides.slice(0, 3) };
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.editor-thumb-box').length === 3);
  const beforeMinimumDelete = requests.length;
  await page.locator('#btn-del-slide-editor').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('minimal harus memiliki 3 slide'));
  assert.deepEqual(requests.slice(beforeMinimumDelete).filter((entry) => entry.path.endsWith('/delete-slide')), []);
  assert.equal(await page.locator('.editor-thumb-box').count(), 3);
  await page.locator('[data-view="view-studio-prompt"]').click();
  await fs.mkdir('/tmp/opencode/gapura-evidence', { recursive: true });
  await page.screenshot({ path: '/tmp/opencode/gapura-evidence/studio-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#btn-toggle-sidebar').click();
  await page.locator('[data-view="view-topics"]').click();
  await page.waitForURL('**/#view-topics');
  await page.locator('#view-topics').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#app-sidebar').evaluate((sidebar) => sidebar.classList.contains('mobile-open')), false);
  await page.screenshot({ path: '/tmp/opencode/gapura-evidence/radar-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page must not overflow horizontally');
  assert.equal(await page.locator('.app-container').evaluate((app) => app.inert), false);
  assert.deepEqual(requests.filter((entry) => entry.path.startsWith('/api/access/')), [], 'Navigation and reload must not request admin access endpoints');
  assert.deepEqual(requests.filter((entry) => /\/verifications?(?:\/|$)|\/verify$/u.test(entry.path)), [], 'The dashboard must not request retired verification endpoints');
  assert.ok(requests.filter((entry) => entry.path === '/api/agents/config' && entry.method === 'POST').every((entry) => !Object.hasOwn(entry.body, 'verifikator') && !Object.hasOwn(entry.body.skills, 'verifikator')));
  assert.deepEqual(credentialedRequests, [], 'API requests must work without tokens or cookies');
  assert.deepEqual(await page.context().cookies(), [], 'The newsroom must not bootstrap an admin cookie');
  assert.ok(requests.some((entry) => entry.path === '/api/client-log' && entry.body.action === 'ui.click'), 'Best-effort click logging must remain active');
  assert.deepEqual(errors, []);
});
