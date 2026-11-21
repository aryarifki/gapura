import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pkg from 'pg';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const base = process.env.GAPURA_TEST_BASE;
const pool = enabled ? new pkg.Pool({ host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER,
  password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME }) : null;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQr2v8DwAD/AIeQQ4/TQAAAABJRU5ErkJggg==', 'base64');

test.before(() => {
  if (!enabled) return;
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.GAPURA_DISABLE_WORKERS, 'true');
  assert.match(process.env.HME_DB_NAME, /^gapura_test_/u);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  assert.ok(process.env.GAPURA_TEST_STORAGE.startsWith('/tmp/opencode/'));
});
test.after(async () => { if (pool) await pool.end(); });

async function seed(t, { metadata = null, coverTitle = 'Layanan kembali ke kecamatan' } = {}) {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,primary_source) VALUES('Kecamatan membuka akses layanan warga','https://example.org/rilis','Dinas') RETURNING id");
  const facts = [
    { id: 'open', text: 'Dinas membuka layanan.', source_name: 'Dinas', source_url: 'https://example.org/rilis?utm_source=feed#lead' },
    { id: 'access', text: 'Akses berada di kecamatan.', source_name: 'Dinas', source_url: 'https://example.org/rilis' },
  ];
  const slides = [{ no: 1, role: 'cover', layout: 'cover-focus', teks: coverTitle, data: { title: coverTitle } }];
  const { rows: [draft] } = await pool.query(`INSERT INTO drafts(topic_id,slides,caption,caption_body,hashtags,copy_model,article_body,article_references,article_facts)
    VALUES($1,$2,'Caption usang #GapuraMedia','Layanan warga dibuka kembali.',ARRAY['#GapuraMedia','#Layanan'],'fixture-export',$3,$4,$5) RETURNING id`,
  [topic.id, JSON.stringify(slides), 'Layanan dibuka kembali melalui kantor kecamatan.\n\nWarga dapat mendatangi loket.', JSON.stringify(['open', 'access']), JSON.stringify(facts)]);
  if (metadata) await pool.query('UPDATE drafts SET article_metadata=$2 WHERE id=$1', [draft.id, JSON.stringify(metadata)]);
  const directory = path.join(process.env.GAPURA_TEST_STORAGE, 'drafts', String(draft.id));
  t.after(async () => {
    await pool.query('DELETE FROM draft_slides WHERE draft_id=$1', [draft.id]);
    await pool.query('DELETE FROM drafts WHERE id=$1', [draft.id]);
    await pool.query('DELETE FROM topics WHERE id=$1', [topic.id]);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { id: draft.id, directory };
}

async function renderRecord(draft) {
  await pool.query("INSERT INTO draft_slides(draft_id,slide_no,layout,render_path) VALUES($1,1,'cover-focus',$2)", [draft.id, path.join(draft.directory, 'slide_1.png')]);
}

async function readExport(id) {
  const response = await fetch(`${base}/api/drafts/${id}/export`);
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get('content-type'), /application\/zip/u);
  assert.equal(response.headers.get('content-disposition'), `attachment; filename="Gapura_Draft_${id}.zip"`);
  return JSON.parse(execFileSync('python3', ['-c', `import io,json,sys,zipfile
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
print(json.dumps({name: list(z.read(name)) if name.endswith('.png') else z.read(name).decode('utf-8') for name in z.namelist()}))`],
  { input: Buffer.from(await response.arrayBuffer()), encoding: 'utf8' }));
}

test('export API retains complete-render and real-asset checks before returning a ZIP', { skip: !enabled }, async (t) => {
  const draft = await seed(t);
  let response = await fetch(`${base}/api/drafts/${draft.id}/export`);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Render belum lengkap/u);
  await renderRecord(draft);
  response = await fetch(`${base}/api/drafts/${draft.id}/export`);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Aset belum tersedia/u);
  await fs.mkdir(draft.directory, { recursive: true });
  await fs.writeFile(path.join(draft.directory, 'slide_1.png'), image);
  const files = await readExport(draft.id);
  assert.deepEqual(Object.keys(files), ['caption.txt', 'article.md', 'slide_1.png']);
  assert.deepEqual(Buffer.from(files['slide_1.png']), image);
  assert.equal(files['caption.txt'], 'Layanan warga dibuka kembali.\n\n#GapuraMedia #Layanan');
  assert.match(files['article.md'], /^# Layanan kembali ke kecamatan\n/u);
  assert.equal((files['article.md'].match(/https:\/\/example\.org\/rilis/g) || []).length, 1);
});

test('export API joins the topic title for legacy article fallbacks and retains legacy caption text', { skip: !enabled }, async (t) => {
  const draft = await seed(t, { coverTitle: 'Artikel lengkap' });
  await pool.query("UPDATE drafts SET caption_body=NULL,caption='Caption arsip.\n\n#GapuraMedia #Layanan' WHERE id=$1", [draft.id]);
  await renderRecord(draft);
  await fs.mkdir(draft.directory, { recursive: true });
  await fs.writeFile(path.join(draft.directory, 'slide_1.png'), image);
  const files = await readExport(draft.id);
  assert.equal(files['caption.txt'], 'Caption arsip.\n\n#GapuraMedia #Layanan');
  assert.match(files['article.md'], /^# Kecamatan membuka akses layanan warga\n/u);
  assert.doesNotMatch(files['article.md'], /# Artikel lengkap/u);
});

test('export API reads structured article metadata without changing stored fact provenance', { skip: !enabled }, async (t) => {
  const metadata = { editorial_version: 2, headline: 'Dinas membuka layanan warga di kecamatan', seo_title: 'Layanan warga dibuka',
    meta_description: 'Akses layanan warga kembali tersedia melalui kecamatan.',
    lead: { text: 'Layanan warga kembali tersedia melalui kecamatan.', fact_ids: ['open'] },
    takeaways: [{ text: 'Warga dilayani di kantor kecamatan.', fact_ids: ['access'] }],
    sections: [{ heading: 'Akses bagi warga', paragraphs: [{ text: 'Loket kecamatan melayani kebutuhan warga.', fact_ids: ['access'] }] }], entities: [] };
  const draft = await seed(t, { metadata });
  await renderRecord(draft);
  await fs.mkdir(draft.directory, { recursive: true });
  await fs.writeFile(path.join(draft.directory, 'slide_1.png'), image);
  const before = (await pool.query('SELECT article_metadata,article_references,article_facts FROM drafts WHERE id=$1', [draft.id])).rows[0];
  const files = await readExport(draft.id);
  assert.match(files['article.md'], /^# Dinas membuka layanan warga di kecamatan\n/u);
  assert.match(files['article.md'], /## Poin utama\n\n- Warga dilayani di kantor kecamatan\./u);
  assert.match(files['article.md'], /## Akses bagi warga\n\nLoket kecamatan melayani kebutuhan warga\./u);
  assert.equal((files['article.md'].match(/https:\/\/example\.org\/rilis/g) || []).length, 1);
  assert.deepEqual((await pool.query('SELECT article_metadata,article_references,article_facts FROM drafts WHERE id=$1', [draft.id])).rows[0], before);
});
