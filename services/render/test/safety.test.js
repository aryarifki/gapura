import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';

const designPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../design-system');
const pngData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/FrcAAAAASUVORK5CYII=';
const slide = (teks, no = 1) => ({ no, layout: 'cover-focus', teks });

function temporaryOutput(t) {
  const root = fs.mkdtempSync('/tmp/opencode/render-safety-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'drafts');
  fs.mkdirSync(output);
  return output;
}

function stubEngine(render = async (entry) => Buffer.from(entry.teks)) {
  const engine = Object.create(RenderEngine.prototype);
  engine.renderSlideToBuffer = render;
  return engine;
}

function seed(output, id = '41') {
  const directory = path.join(output, id);
  fs.mkdirSync(directory);
  for (let no = 1; no <= 3; no++) fs.writeFileSync(path.join(directory, `slide_${no}.png`), `old ${no}`);
  return directory;
}

function readBatch(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((file) => [file, fs.readFileSync(path.join(directory, file), 'utf8')]));
}

test('a failed batch preserves every previously published slide and removes staging', async (t) => {
  const output = temporaryOutput(t);
  const directory = seed(output);
  const original = readBatch(directory);
  const engine = stubEngine(async (entry) => {
    if (entry.no === 2) throw new Error('injected render failure');
    return Buffer.from(entry.teks);
  });

  await assert.rejects(engine.renderCarouselToDisk(41, [slide('new 1'), slide('new 2', 2)], output), /injected render failure/);
  assert.deepEqual(readBatch(directory), original);
  assert.deepEqual(fs.readdirSync(output), ['41']);
});

test('a successful smaller batch replaces the directory and removes obsolete slides', async (t) => {
  const output = temporaryOutput(t);
  const directory = seed(output);
  const results = await stubEngine().renderCarouselToDisk('41', [slide('new 1')], output);
  assert.deepEqual(readBatch(directory), { 'slide_1.png': 'new 1' });
  assert.equal(results[0].file_path, path.join(directory, 'slide_1.png'));
  assert.equal(results[0].slide_no, 1);
  assert.deepEqual(fs.readdirSync(output), ['41']);
});

test('old output stays intact while the replacement batch is still rendering', async (t) => {
  const output = temporaryOutput(t);
  const directory = seed(output);
  const original = readBatch(directory);
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const engine = stubEngine(async (entry) => {
    if (entry.no === 2) {
      entered.resolve();
      await gate.promise;
    }
    return Buffer.from(entry.teks);
  });
  const pending = engine.renderCarouselToDisk(41, [slide('new 1'), slide('new 2', 2)], output);
  await entered.promise;
  try {
    assert.deepEqual(readBatch(directory), original);
  } finally {
    gate.resolve();
    await pending;
  }
  assert.deepEqual(readBatch(directory), { 'slide_1.png': 'new 1', 'slide_2.png': 'new 2' });
});

test('same-draft batches serialize across engines, including after a failure', async (t) => {
  const output = temporaryOutput(t);
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const calls = [];
  const first = stubEngine(async () => {
    calls.push('first');
    entered.resolve();
    await gate.promise;
    throw new Error('first failed');
  });
  const second = stubEngine(async (entry) => {
    calls.push('second');
    return Buffer.from(entry.teks);
  });
  const failed = assert.rejects(first.renderCarouselToDisk(41, [slide('first')], output), /first failed/);
  await entered.promise;
  const next = second.renderCarouselToDisk('41', [slide('second')], output);
  await setImmediate();
  try {
    assert.deepEqual(calls, ['first']);
  } finally {
    gate.resolve();
    await Promise.all([failed, next]);
  }
  assert.deepEqual(calls, ['first', 'second']);
  assert.deepEqual(readBatch(path.join(output, '41')), { 'slide_1.png': 'second' });
  assert.deepEqual(fs.readdirSync(output), ['41']);
});

test('batches for different drafts can render independently', async (t) => {
  const output = temporaryOutput(t);
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const engine = stubEngine(async (entry) => {
    if (entry.teks === 'blocked') {
      entered.resolve();
      await gate.promise;
    }
    return Buffer.from(entry.teks);
  });
  const first = engine.renderCarouselToDisk(41, [slide('blocked')], output);
  await entered.promise;
  try {
    await engine.renderCarouselToDisk(42, [slide('independent')], output);
    assert.equal(fs.readFileSync(path.join(output, '42/slide_1.png'), 'utf8'), 'independent');
  } finally {
    gate.resolve();
    await first;
  }
});

test('a failed directory promotion restores the previous batch and removes staging', async (t) => {
  const output = temporaryOutput(t);
  const directory = seed(output);
  const original = readBatch(directory);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === directory && !String(from).endsWith('.previous')) {
      throw Object.assign(new Error('injected promotion failure'), { code: 'EIO' });
    }
    return rename(from, to);
  });
  await assert.rejects(stubEngine().renderCarouselToDisk(41, [slide('replacement')], output), /injected promotion failure/);
  assert.deepEqual(readBatch(directory), original);
  assert.deepEqual(fs.readdirSync(output), ['41']);
});

test('draft IDs must be positive safe integers before any directory is created', async (t) => {
  const output = temporaryOutput(t);
  const engine = stubEngine();
  for (const id of ['../escape', 'test_9_layouts', 0, -1, 1.5, '', '01', '1e2', true, {}, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(engine.renderCarouselToDisk(id, [slide('safe')], output), /draft_id/);
  }
  assert.deepEqual(fs.readdirSync(output), []);
});

test('batch shape, layout, text and consecutive slide numbers are validated before rendering', async (t) => {
  const output = temporaryOutput(t);
  let renders = 0;
  const engine = stubEngine(async () => { renders++; return Buffer.from('unexpected'); });
  const invalid = [
    [], Array.from({ length: 10 }, (_, index) => slide('too many', index + 1)),
    [slide('first'), slide('duplicate', 1)], [slide('gap', 2)],
    [{ ...slide('unsafe'), no: '../escape' }],
    [{ ...slide('unsafe'), layout: '../template' }],
    [{ ...slide('unsafe'), layout: 'x'.repeat(65) }],
    [slide('x'.repeat(4001))], [slide({ text: 'not a string' })],
    [{ ...slide('unsafe'), data: { items: 'not an array' } }],
    [{ ...slide('unsafe'), data: { labels: ['A'], values: [1, 2] } }],
  ];
  for (const slides of invalid) await assert.rejects(engine.renderCarouselToDisk(41, slides, output), /Invalid payload/);
  assert.equal(renders, 0);
  assert.deepEqual(fs.readdirSync(output), []);
});

test('overlapping previews and ordinary renders each use isolated token snapshots', async () => {
  const engine = new RenderEngine(designPath);
  const original = structuredClone(engine.tokens);
  const entry = slide('Concurrent previews');
  const [first, second, ordinary] = await Promise.all([
    engine.renderSlideToBuffer(entry, 1, 1, { palette: { cover_bg: '#112233' } }),
    engine.renderSlideToBuffer(entry, 1, 1, { palette: { cover_bg: '#334455' } }),
    engine.renderSlideToBuffer(entry, 1, 1),
  ]);
  const color = async (png) => [...await sharp(png).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  assert.deepEqual(await color(first), [17, 34, 51]);
  assert.deepEqual(await color(second), [51, 68, 85]);
  assert.deepEqual(await color(ordinary), [...Buffer.from(original.palette.cover_bg.slice(1), 'hex')]);
  assert.deepEqual(engine.tokens, original);
});

test('renderer rejects remote, malformed, SVG, spoofed and oversized image_data without fetching', async (t) => {
  const engine = new RenderEngine(designPath);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('External requests disabled in tests'); });
  const values = [
    'http://127.0.0.1/private', 'https://example.invalid/image.png', 'file:///etc/passwd',
    'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
    'data:image/png;base64,not-base64!',
    'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64'),
    'data:image/png;base64,' + Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64'),
  ];
  for (const image_data of values) {
    await assert.rejects(engine.renderSlideToBuffer({ ...slide('Photo'), data: { image_data } }, 1, 1), /image_data/);
  }
  assert.equal(fetches, 0);
});

test('embedded images render locally while unhydrated source image_url is rejected without fetching', async (t) => {
  const engine = new RenderEngine(designPath);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Source metadata must not be fetched'); });
  const png = await engine.renderSlideToBuffer({ ...slide('Local rendering'), data: { image_data: pngData } }, 1, 1);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  await assert.rejects(
    engine.renderSlideToBuffer({ ...slide('Unhydrated source'), data: { image_url: 'http://127.0.0.1/private' } }, 1, 1),
    /image_url/
  );
});
