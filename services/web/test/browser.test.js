import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  config.skills = Object.fromEntries(await Promise.all(['scout', 'analis', 'copywriter', 'designer', 'seo', 'verifikator', 'studio'].map(async (key) => [key, await fs.readFile(path.join(ROOT, 'config/skills', `${key}.skills.md`), 'utf8')])));
  const stamp = '2026-11-16T02:00:00Z';
  const topic = { id: '42', title: 'Inflasi Oktober 2,1% menurut BPS', summary: 'Data BPS menunjukkan inflasi tahunan 2,1%.', status: 'scored', score_total: 88, primary_source: 'BPS', url: 'https://www.bps.go.id/rilis/1', created_at: stamp, verification_status: 'verified' };
  const draft = { id: '21', topic_id: '42', topic_title: topic.title, caption: topic.summary, hashtags: ['#GapuraMedia'], primary_source: 'BPS', source_url: topic.url, status: 'draft', score_total: 88, created_at: stamp, rendered_slides: [{ slide_no: 1, layout: 'cover-focus', text: topic.title, data: { title: topic.title }, image_url: '/assets/logo.png' }] };
  let detailDraft = { ...draft, caption: 'Fresh detail caption for review', revision: 'fixture-reviewed-revision' };
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
      case '/api/drafts/21/approve':
        status = body.reviewed === true && body.expected_revision === detailDraft.revision ? 200 : 409;
        data = status === 200 ? { status: 'success' } : { error: 'Draf telah berubah. Muat ulang dan tinjau konten terbaru sebelum menyetujui.' };
        break;
      case '/api/topics': data = url.searchParams.get('q')?.includes('nothing') ? [] : [topic]; headers['X-Has-More'] = 'false'; headers['X-Next-Offset'] = '1'; break;
      case '/api/topics/42/verify': data = { report: { status: 'verified', confidence: 90 } }; break;
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
      case '/api/workflow': data = { active: false, json: {} }; break;
      case '/api/tokens': data = { parsed: {}, raw: '' }; break;
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
  await page.locator('[data-verify-topic="42"]').waitFor();
  await page.locator('[data-verify-topic="42"]').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('selesai'));
  await page.locator('[data-view="view-review"]').click();
  await page.locator('.gallery-card').click();
  await page.waitForURL('**/#view-review/draft/21');
  await page.waitForFunction(() => document.querySelector('#editor-input-caption').value === 'Fresh detail caption for review');
  assert.ok(requests.some((entry) => entry.method === 'GET' && entry.path === '/api/drafts/21'));
  assert.equal(await page.locator('#editor-reviewed').isChecked(), false);
  detailDraft = { ...detailDraft, caption: 'Changed in another browser', revision: 'fixture-remote-revision' };
  const beforeStaleApproval = requests.length;
  await page.locator('#editor-reviewed').check();
  await page.locator('#btn-action-approve-auto').click();
  await page.waitForFunction(() => /muat ulang/i.test(document.querySelector('#toast').textContent));
  assert.deepEqual(requests.slice(beforeStaleApproval).filter((entry) => entry.path.startsWith('/api/drafts')), [{
    path: '/api/drafts/21/approve', query: '', method: 'POST',
    body: { mode: 'auto', reviewed: true, expected_revision: 'fixture-reviewed-revision' },
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
  await page.locator('[data-view="view-trends"]').click();
  await page.waitForFunction(() => document.querySelector('#trend-health-message').textContent.includes('fallback'));
  await page.locator('[data-view="view-verifications"]').click();
  await page.locator('[data-view="view-studio-prompt"]').click();
  await page.waitForFunction(() => document.querySelector('#studio-source-topic').options.length > 1);
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
  assert.deepEqual(credentialedRequests, [], 'API requests must work without tokens or cookies');
  assert.deepEqual(await page.context().cookies(), [], 'The newsroom must not bootstrap an admin cookie');
  assert.ok(requests.some((entry) => entry.path === '/api/client-log' && entry.body.action === 'ui.click'), 'Best-effort click logging must remain active');
  assert.deepEqual(errors, []);
});
