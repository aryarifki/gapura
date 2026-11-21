import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(path.join(root, 'services/web/package.json'));
const env = require('dotenv').parse(await fs.readFile('/etc/gapura/runtime.env', 'utf8'));
for (const [key, value] of Object.entries(env)) process.env[key] = value;
if (process.env.R7_RENDER_SERVICE_URL) process.env.RENDER_SERVICE_URL = process.env.R7_RENDER_SERVICE_URL;
process.env.GAPURA_DISABLE_WORKERS = 'true';

const desk = process.argv[2];
if (!['bursa', 'ekonomi'].includes(desk)) throw new Error('Choose bursa or ekonomi for this review run.');
const topicId = desk === 'bursa' ? 1188 : 1187;
const packet = path.join(root, 'storage/r7-multistage-20261120');
const dir = path.join(packet, 'samples', desk);
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runDir = path.join(dir, 'runs', runId);
await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
try { await fs.rename(path.join(dir, 'raw'), path.join(runDir, 'previous_raw')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const file of ['REVIEW_STATUS.json', 'checkpoint.json', 'draft.json', 'article.md', 'caption.txt', 'threads.txt', 'slide_1.png', 'slide_2.png', 'slide_3.png', 'AUTOMATED_AUDIT.json']) {
  try {
    await fs.mkdir(path.join(runDir, 'previous_exports'), { recursive: true, mode: 0o700 });
    await fs.rename(path.join(dir, file), path.join(runDir, 'previous_exports', file));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const sourceFile = process.argv[3] || path.join(packet, 'research', desk, 'sources.json');
let sources = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
if (!Array.isArray(sources)) sources = sources.documents || sources.sources;
if (!Array.isArray(sources) || sources.length < 3) throw new Error('source_material_insufficient');
const editorial = JSON.parse(await fs.readFile(path.join(root, 'storage/r7-editorial-v2-20261119/research', desk, 'input.json'), 'utf8'));
const editorialInput = { version: 1, mode: 'current', facts: editorial.facts.map(({ id, text, source_url, source_name }) => ({ id, text, source_url, source_name })) };
let editorialBrief;
try { editorialBrief = JSON.parse(await fs.readFile(path.join(packet, 'research', desk, 'editorial-brief.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

let editorialAssets = [];
try {
  const bank = JSON.parse(await fs.readFile(path.join(packet, 'media/manifest.json'), 'utf8'));
  editorialAssets = bank.assets || bank.media || (Array.isArray(bank) ? bank : []);
} catch { /* no media bank: typographic cover, recorded by the pipeline */ }

const attempts = [];
const { produceSingleTopicDraft, pool } = await import('../services/copywriter/copywriter.js');
const { exportArticle, exportCaption } = await import('../services/web/article-export.js');
const { draftContentHash } = await import('../services/common/draft-revision.js');
const save = async (file, value) => {
  const content = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2);
  await fs.mkdir(path.dirname(path.join(runDir, file)), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(runDir, file), content, { mode: 0o600 });
  await fs.writeFile(path.join(dir, file), content, { mode: 0o600 });
};
const start = Date.now();
try {
  const result = await produceSingleTopicDraft(topicId, pool, { storytelling: true, editorialInput, sourceDocuments: sources,
    regenerate: process.env.R7_REGENERATE === 'true',
    ...(editorialBrief ? { editorialBrief } : {}),
    editorialAssets,
    onAttempt: (entry) => { attempts.push(entry); console.log(JSON.stringify(entry)); },
    onRows: async (stage, attempt, rows, providerRows) => {
      await fs.mkdir(path.join(dir, 'raw'), { recursive: true, mode: 0o700 });
      await save(path.join('raw', `${stage}_attempt${attempt}.json`), rows);
      if (providerRows) await save(path.join('raw', `provider_${stage}_attempt${attempt}.json`), providerRows);
    },
    saveCheckpoint: (checkpoint) => save('checkpoint.json', checkpoint),
  });
  const { rows: [draft] } = await pool.query('SELECT d.*,t.title AS topic_title FROM drafts d JOIN topics t ON t.id=d.topic_id WHERE d.id=$1', [result.draft_id]);
  if (draft.status !== 'draft' || draft.needs_review !== true || draft.article_metadata?.pipeline?.status !== 'VALIDATED') throw new Error('live_draft_not_validated');
  await save('draft.json', draft);
  await save('article.md', exportArticle(draft));
  await save('caption.txt', exportCaption(draft));
  await save('threads.txt', (draft.article_metadata.threads_posts || []).map((post) => `${post.no}. ${post.text}`).join('\n\n'));
  const rasters = [];
  for (let no = 1; no <= 3; no++) {
    const png = await fs.readFile(path.join(root, 'storage/drafts', String(draft.id), `slide_${no}.png`));
    await save(`slide_${no}.png`, png);
    rasters.push({ slide: no, file: path.join(dir, `slide_${no}.png`), sha256: createHash('sha256').update(png).digest('hex') });
  }
  const status = { desk, run_id: runId, run_directory: runDir, editorial_brief: editorialBrief || null, draft_id: draft.id, stage: 'R7', status: 'technical_validation_complete', elapsed_ms: Date.now() - start,
    revision: draftContentHash(draft), attempts, rasters, media_mode: draft.article_metadata?.media?.mode || null,
    owner_decision: 'revision_requested', human_editorial_audit: 'pending', visual_audit: 'pending', publication_approved: false };
  await save('REVIEW_STATUS.json', status);
  console.log(JSON.stringify({ desk, draft_id: draft.id, status: draft.status, review: dir, elapsed_ms: status.elapsed_ms }));
} catch (error) {
  // Provider messages are already redacted; never dump input configuration.
  const status = { desk, run_id: runId, run_directory: runDir, editorial_brief: editorialBrief || null, stage: 'R7', status: 'failed', elapsed_ms: Date.now() - start, error: String(error.message).slice(0, 1500), attempts,
    owner_decision: 'revision_requested', publication_approved: false };
  await save('REVIEW_STATUS.json', status);
  console.error(JSON.stringify(status));
  process.exitCode = 1;
} finally { await pool.end(); }
