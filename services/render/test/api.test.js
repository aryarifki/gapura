import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const pngData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/FrcAAAAASUVORK5CYII=';
const slide = { no: 1, layout: 'cover-focus', teks: 'Safe render', data: { image_data: pngData } };
let child;
let storage;
let baseUrl;

before(async () => {
  storage = fs.mkdtempSync('/tmp/opencode/render-api-');
  child = fork(path.join(directory, 'helpers/api-process.js'), [], {
    env: { ...process.env, RENDER_PORT: '0', RENDER_HOST: '127.0.0.1', RENDER_SECRET: 'isolated-render-test', STORAGE_PATH: storage },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout.resume();
  child.stderr.resume();
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  baseUrl = `http://127.0.0.1:${message.port}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  if (storage) fs.rmSync(storage, { recursive: true, force: true });
});

function post(endpoint, payload, secret = 'isolated-render-test') {
  return fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-Secret': secret }, body: JSON.stringify(payload) });
}

test('render endpoints retain authentication and successful batch/PNG response contracts', async () => {
  assert.equal((await post('/render', { draft_id: 41, slides: [slide] }, 'wrong')).status, 401);
  const batch = await post('/render', { draft_id: 41, slides: [slide] });
  assert.equal(batch.status, 200);
  const body = await batch.json();
  assert.equal(body.status, 'success');
  assert.equal(body.rendered_slides[0].file_path, path.join(storage, 'drafts/41/slide_1.png'));
  const preview = await post('/render/preview', { slide, slide_no: 1, total_slides: 1, tokens: { palette: { cover_bg: '#112233' } } });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /^image\/png/);
  assert.ok((await preview.arrayBuffer()).byteLength > 0);
});

test('batch endpoint validates ID, 1-9 slides, layout, text, numbering and data shapes before engine calls', async () => {
  const invalid = [
    { draft_id: '../escape', slides: [slide] }, { draft_id: 'test_9_layouts', slides: [slide] },
    { draft_id: -1, slides: [slide] }, { draft_id: 1.5, slides: [slide] },
    { draft_id: true, slides: [slide] }, { draft_id: {}, slides: [slide] },
    { draft_id: 41, slides: [] },
    { draft_id: 41, slides: Array.from({ length: 10 }, (_, index) => ({ ...slide, no: index + 1 })) },
    { draft_id: 41, slides: [{ ...slide, layout: { name: 'cover-focus' } }] },
    { draft_id: 41, slides: [{ ...slide, layout: 'invalid layout with spaces' }] },
    { draft_id: 41, slides: [{ ...slide, teks: 'x'.repeat(4001) }] },
    { draft_id: 41, slides: [{ ...slide, teks: { unsafe: 'shape' } }] },
    { draft_id: 41, slides: [{ ...slide, no: '../escape' }] },
    { draft_id: 41, slides: [{ ...slide, data: { items: 'invalid' } }] },
  ];
  for (const payload of invalid) {
    const response = await post('/render', payload);
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 180));
    assert.match((await response.json()).error, /Invalid payload/);
  }
});

test('preview endpoint validates slide counts, text, nested collections and safe tokens', async () => {
  const invalid = [
    { slide, slide_no: 0 }, { slide, slide_no: 1.5 }, { slide, slide_no: '1' },
    { slide, slide_no: 2, total_slides: 1 }, { slide, total_slides: 10 }, { slide, total_slides: -1 },
    { slide: { ...slide, layout: '../template' } },
    { slide: { ...slide, teks: 'x'.repeat(4001) } },
    { slide: { ...slide, source: { text: 'not a string' } } },
    { slide: { ...slide, data: { bullets: Array(33).fill('too many') } } },
    { slide: { ...slide, data: { labels: ['A'], values: [1, 2] } } },
    { slide, tokens: [] }, { slide, tokens: { palette: { bg: 'url(http://127.0.0.1/private)' } } },
    { slide, tokens: { palette: { bg: '#12345' } } },
  ];
  for (const payload of invalid) {
    const response = await post('/render/preview', payload);
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 180));
    assert.match((await response.json()).error, /Invalid payload/);
  }
});

test('both endpoints reject data layouts without supplied data before mocked rendering', async () => {
  for (const [layout, field] of [['stat-grid', /items/], ['chart-bar', /labels|values/], ['chart-line', /labels|values/], ['timeline', /events/], ['comparison', /left|right/]]) {
    const entry = { no: 2, layout, teks: 'Membaca konteks layanan publik.', data: {} };
    for (const [endpoint, payload] of [['/render', { draft_id: 41, slides: [slide, entry] }], ['/render/preview', { slide: entry, slide_no: 2, total_slides: 3 }]]) {
      const response = await post(endpoint, payload);
      assert.equal(response.status, 400, `${endpoint}: ${layout}`);
      assert.match((await response.json()).error, field);
    }
  }
});

test('both endpoints reject remote, SVG, invalid and oversized embedded image data', async () => {
  const values = [
    'https://example.invalid/image.png', 'file:///etc/passwd',
    'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'),
    'data:image/png;base64,not-base64!',
    'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64'),
    'data:image/png;base64,' + Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64'),
  ];
  for (const image_data of values) {
    const entry = { ...slide, data: { image_data } };
    for (const [endpoint, payload] of [['/render', { draft_id: 41, slides: [entry] }], ['/render/preview', { slide: entry }]]) {
      const response = await post(endpoint, payload);
      assert.equal(response.status, 400, `${endpoint}: ${image_data.slice(0, 100)}`);
      assert.match((await response.json()).error, /image_data/);
    }
  }
});

test('source image_url must be hydrated at the trusted caller before either render endpoint', async () => {
  const entry = { ...slide, data: { image_url: 'https://images.unsplash.com/source.jpg' } };
  for (const [endpoint, payload] of [['/render', { draft_id: 41, slides: [entry] }], ['/render/preview', { slide: entry }]]) {
    const response = await post(endpoint, payload);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /image_url/);
  }
});

test('malformed and oversized JSON returns bounded JSON errors', async () => {
  for (const [body, status] of [['{"broken":', 400], [JSON.stringify({ oversized: 'x'.repeat(10 * 1024 * 1024) }), 413]]) {
    const response = await fetch(`${baseUrl}/render/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-Secret': 'isolated-render-test' }, body });
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.ok((await response.text()).length < 300);
  }
});

test('render errors do not disclose internal storage paths', async () => {
  const entry = { ...slide, teks: 'simulate render failure' };
  for (const [endpoint, payload] of [['/render', { draft_id: 41, slides: [entry] }], ['/render/preview', { slide: entry }]]) {
    const response = await post(endpoint, payload);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Rendering failed' });
  }
});
