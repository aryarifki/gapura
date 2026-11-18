import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { originalFixture } from '../../common/test/fixtures/original-editorial.js';
import { buildEditorialBrief, validateOriginalContent } from '../../common/original-editorial.js';

let state;
const topic = { id: 42, title: 'BPS merilis inflasi', summary: 'Inflasi Oktober 2,1%.', primary_source: 'BPS', url: 'https://www.bps.go.id/rilis/1', status: 'scored' };
const plan = { title: 'Harga pangan', angle: 'Soroti pangan', sections: ['Harga pangan', 'Data inflasi'], format: 'carousel', slide_count_hint: 6, caption_tone: 'ringkas', editorial_input: { version: 1, mode: 'explainer', facts: [] } };
const completeDraft = () => ({ ...validateOriginalContent(originalFixture(), buildEditorialBrief(topic)), id: 81, status: 'draft', content_format: 'carousel', rendered_count: 6 });
const queries = [];
const llmPrompts = [];
const productions = [];
const dispatches = [];
let locked = false;
let releases = 0;
const client = {
  release() { releases++; },
  async query(sql, values = []) {
    queries.push({ sql, values });
    if (/\bverification_reports\b/i.test(sql)) throw new Error('Archived verification reports must not be accessed');
    if (/pg_try_advisory/.test(sql)) { const acquired = !locked; if (acquired) locked = true; return { rows: [{ acquired, locked: acquired }] }; }
    if (/pg_advisory_unlock/.test(sql)) { locked = false; return { rows: [{ unlocked: true }] }; }
    if (/SELECT .*FROM prompt_jobs/i.test(sql)) return { rows: state.job ? [{ ...state.job }] : [] };
    if (/FROM topics\b/i.test(sql)) return { rows: state.topic ? [{ ...state.topic }] : [] };
    if (/FROM topic_scores\b/i.test(sql)) return { rows: state.score ? [state.score] : [] };
    if (/FROM drafts\b/i.test(sql)) return { rows: state.draft ? [state.draft] : [] };
    if (/UPDATE prompt_jobs SET plan/.test(sql)) state.job.plan = JSON.parse(values[1]);
    const status = sql.match(/UPDATE prompt_jobs SET status = '([^']+)'/);
    if (status) state.job.status = status[1];
    return { rows: [{ ...state.job }], rowCount: 1 };
  },
};
mock.module('pg', { defaultExport: { Pool: class { query(...args) { return client.query(...args); } connect() { return Promise.resolve(client); } } } });
mock.module('dotenv', { defaultExport: { config() {} } });
mock.module('../../common/llm.js', { namedExports: {
  loadAgentsConfig: () => ({ analis: { min_score_threshold: state.threshold ?? 76 } }),
  callAgentLLM: async (_agent, prompt) => { llmPrompts.push(prompt); if (state.llmError) throw state.llmError; return JSON.stringify({ ...plan, title: 'Rencana revisi' }); },
} });
mock.module('../../copywriter/copywriter.js', { namedExports: { produceSingleTopicDraft: async (...args) => {
  productions.push(args);
  state.onProduction?.();
  await state.productionWait;
  if (state.productionError) throw state.productionError;
  return { draft_id: 81 };
} } });
mock.module('../../telegram/bot.js', { namedExports: { dispatchDraftToTelegram: async (draftId) => { dispatches.push(draftId); } } });
const { createPlan, regeneratePlan, updatePlan, executeJob } = await import('../studio.js');

test.beforeEach(() => {
  state = { job: { id: 9, topic_id: 42, prompt: 'Utamakan harga pangan', plan: { ...plan }, status: 'plan_review' }, topic: { ...topic }, score: { score_total: 88, verdict: 'passed' } };
  queries.length = 0; llmPrompts.length = 0; productions.length = 0; dispatches.length = 0; locked = false; releases = 0;
});

test.afterEach(() => {
  assert.ok(!queries.some(({ sql }) => /\bverification_reports\b/i.test(sql)), 'Studio must not read or write archived reports');
  assert.equal(locked, false, 'job lock must be released on success and failure');
});

test('regeneration includes the current reviewed plan and revision instruction without const reassignment', async () => {
  const result = await regeneratePlan(9, 'Pertahankan fokus pangan');
  assert.equal(result.title, 'Rencana revisi');
  assert.ok(llmPrompts[0].includes('Soroti pangan'));
  assert.ok(llmPrompts[0].includes('Pertahankan fokus pangan'));
  assert.equal(state.job.status, 'plan_review');
  assert.equal(Object.hasOwn(result, 'verification_requested'), false);
  assert.doesNotMatch(llmPrompts[0], /verification_requested|verifyTopic/);
});

test('planning validates an existing analyzed source before any LLM call', async () => {
  state.topic = null;
  await assert.rejects(createPlan(state.job), /topic_not_found|Topik sumber tidak ditemukan/);
  assert.equal(llmPrompts.length, 0);
  state.topic = { ...topic, status: 'new' };
  await assert.rejects(createPlan(state.job), /topic_not_scored/);
  assert.equal(llmPrompts.length, 0);
});

test('plan creation, regeneration and manual updates all retain analyst, source evidence and public URL gates', async () => {
  const cases = [
    { score: null, reason: /score_below_threshold|score_not_passed/ },
    { score: { score_total: 75, verdict: 'passed' }, reason: /score_below_threshold/ },
    { score: { score_total: 88, verdict: 'rejected' }, reason: /score_not_passed/ },
    ...['title', 'primary_source'].map((field) => ({ topic: { [field]: ' ' }, reason: /source_evidence_required/ })),
    ...['', 'http://www.bps.go.id/rilis/1', 'https://127.0.0.1/private', 'https://user:secret@www.bps.go.id/rilis/1'].map((url) => ({ topic: { url }, reason: /public_source_url_required/ })),
  ];
  for (const fixture of cases) {
    state.topic = { ...topic, ...fixture.topic };
    state.score = Object.hasOwn(fixture, 'score') ? fixture.score : { score_total: 88, verdict: 'passed' };
    for (const action of [() => createPlan(state.job), () => regeneratePlan(9), () => updatePlan(9, plan)]) {
      await assert.rejects(action(), fixture.reason);
    }
  }
  assert.equal(llmPrompts.length, 0);
  assert.equal(productions.length, 0);
});

test('only plan_review jobs permit manual edits or regeneration', async () => {
  for (const status of ['queued', 'planning', 'verifying', 'drafting', 'review', 'cancelled', 'failed']) {
    state.job.status = status;
    await assert.rejects(updatePlan(9, plan), /plan_review|status/i);
    await assert.rejects(regeneratePlan(9), /plan_review|status/i);
  }
  assert.equal(llmPrompts.length, 0);
});

test('execution passes the reviewed plan/input and source ID to original production without publisher material', async () => {
  const result = await executeJob(9, { autoPublish: true });
  assert.equal(result.scheduled, false);
  assert.equal(productions.length, 1);
  assert.equal(productions[0][0], topic.id);
  assert.equal(productions[0][1], null, 'Copywriter owns its atomic production transaction');
  assert.deepEqual(productions[0][2].editorialBrief.plan, plan);
  assert.equal(productions[0][2].editorialBrief.prompt, state.job.prompt);
  assert.equal(productions[0][2].forceReview, true);
  assert.deepEqual(productions[0][2].editorialInput, plan.editorial_input);
  assert.equal(productions[0][2].slideCount, 6);
  assert.equal(state.job.status, 'review');
  assert.deepEqual(dispatches, [81]);
  assert.deepEqual(queries.flatMap(({ sql }) => {
    const match = sql.match(/UPDATE prompt_jobs SET status = '([^']+)'/);
    return match ? [match[1]] : [];
  }), ['drafting', 'review']);
  assert.ok(!queries.some(({ sql }) => /scheduled_posts/.test(sql)));
});

test('a missing source during execution fails before drafting or review dispatch', async () => {
  state.topic = null;
  await assert.rejects(executeJob(9), /topic_not_found|Topik sumber tidak ditemukan/);
  assert.equal(productions.length, 0);
  assert.equal(dispatches.length, 0);
  assert.equal(state.job.status, 'failed');
});

test('archived verification flags and legacy plan requests cannot block reviewed source production', async () => {
  for (const verification_requested of [true, false]) {
    state.job.status = 'plan_review';
    state.topic.verification_status = 'hoax_detected';
    state.job.plan = { ...plan, verification_requested };
    const result = await executeJob(9);
    assert.equal(result.draftId, 81);
    assert.equal(result.scheduled, false);
    assert.equal(state.job.status, 'review');
    assert.equal(Object.hasOwn(productions.at(-1)[2].editorialBrief.plan, 'verification_requested'), false);
  }
  assert.equal(productions.length, 2);
});

test('execution enforces the configured analyst threshold without relying on a report', async () => {
  state.threshold = 90;
  await assert.rejects(executeJob(9), /score_below_threshold/);
  assert.equal(productions.length, 0);
  assert.equal(dispatches.length, 0);
});

test('simultaneous executions produce one draft and return an in_progress result to the duplicate', async () => {
  let finish;
  let started;
  const productionStarted = new Promise((resolve) => { started = resolve; });
  state.onProduction = started;
  state.productionWait = new Promise((resolve) => { finish = resolve; });
  const first = executeJob(9);
  await productionStarted;
  let duplicate;
  try { duplicate = await executeJob(9); }
  finally { finish(); }
  const result = await first;
  assert.equal(productions.length, 1);
  assert.deepEqual(duplicate, { in_progress: true });
  assert.equal(result.draftId, 81);
  assert.equal(queries.filter(({ sql }) => /pg_advisory_unlock/.test(sql)).length, 1);
  assert.ok(queries.filter(({ sql }) => /pg_try_advisory|pg_advisory_unlock/.test(sql)).every(({ values }) => values[0] === 'gapura:studio:9'));
  assert.equal(releases, 2);
});

test('a completed retry returns the existing draft without production or duplicate dispatch', async () => {
  state.job = { ...state.job, status: 'review', draft_id: 81 };
  state.draft = completeDraft();
  const result = await executeJob(9);
  assert.equal(result.draftId, 81);
  assert.equal(result.is_existing, true);
  assert.equal(productions.length, 0);
  assert.equal(dispatches.length, 0);
});

test('a completed job cannot report an incomplete linked draft as a successful retry', async () => {
  state.job = { ...state.job, status: 'review', draft_id: 81 };
  state.draft = { id: 81, status: 'draft', slides: [{ no: 1, teks: topic.title }], rendered_count: 0, content_format: 'single' };
  await assert.rejects(executeJob(9), /draft_incomplete/);
  assert.equal(productions.length, 0);
});

test('a queued job with an unreviewed plan still stops at plan_review before production', async () => {
  state.job.status = 'queued';
  const result = await executeJob(9);
  assert.equal(result.awaiting_plan_review, true);
  assert.equal(state.job.status, 'plan_review');
  assert.equal(productions.length, 0);
});

test('a legacy verified flag cannot bypass a newly rejected analyst score', async () => {
  state.topic.verification_status = 'verified';
  state.score = { score_total: 88, verdict: 'rejected' };
  await assert.rejects(executeJob(9), /score_not_passed/);
  assert.equal(productions.length, 0);
  assert.equal(dispatches.length, 0);
});

test('a completed Studio retry ignores archived verification flags while retaining human review', async () => {
  state.job = { ...state.job, status: 'review', draft_id: 81 };
  state.topic.verification_status = 'hoax_detected';
  state.draft = completeDraft();
  const result = await executeJob(9);
  assert.deepEqual(result, { draftId: 81, is_existing: true, scheduled: false });
  assert.equal(state.job.status, 'review');
  assert.equal(productions.length, 0);
});

test('an interrupted failed Studio job can recover its already-produced source', async () => {
  state.job = { ...state.job, status: 'failed', draft_id: 81 };
  state.topic.status = 'produced';
  const result = await executeJob(9);
  assert.equal(result.draftId, 81);
  assert.equal(productions.length, 1);
});

test('a planning status with an existing plan still requires explicit plan_review production approval', async () => {
  state.job.status = 'planning';
  const result = await executeJob(9);
  assert.equal(result.awaiting_plan_review, true);
  assert.equal(productions.length, 0);
});

test('failed plan regeneration preserves the previous plan and restores its editable review status', async () => {
  state.llmError = new Error('model offline');
  await assert.rejects(regeneratePlan(9, 'Ringkas'), /model offline/);
  assert.deepEqual(state.job.plan, plan);
  assert.equal(state.job.status, 'plan_review');
});

test('a completed Studio single with two rendered slides fails completion validation', async () => {
  state.job = { ...state.job, status: 'review', draft_id: 81 };
  state.draft = { id: 81, status: 'draft', slides: [{ no: 1, teks: topic.title }, { no: 2, teks: topic.summary }], rendered_count: 2, content_format: 'single' };
  await assert.rejects(executeJob(9), /draft_incomplete/);
});

test('a completed Studio retry still rejects a source whose evidence or public URL is no longer usable', async () => {
  state.job = { ...state.job, status: 'review', draft_id: 81 };
  state.draft = completeDraft();
  for (const [changes, reason] of [
    [{ title: ' ' }, /source_evidence_required/],
    [{ url: 'https://localhost/private' }, /public_source_url_required/],
  ]) {
    state.job.status = 'review';
    state.topic = { ...topic, ...changes };
    await assert.rejects(executeJob(9), reason);
  }
  assert.equal(productions.length, 0);
});

test('a failed job that never reached reviewed production cannot skip plan review on retry', async () => {
  state.job = { ...state.job, status: 'failed', progress: 20 };
  const result = await executeJob(9);
  assert.equal(result.awaiting_plan_review, true);
  assert.equal(productions.length, 0);
});

test('failed atomic draft production fails the job and releases its lock before a retry', async () => {
  state.productionError = new Error('render transaction rolled back');
  await assert.rejects(executeJob(9), /render transaction rolled back/);
  assert.equal(state.job.status, 'failed');
  assert.equal(dispatches.length, 0);
  assert.equal(locked, false);
  assert.ok(!queries.some(({ sql }) => /UPDATE prompt_jobs SET draft_id/.test(sql)));
  state.productionError = null;
  state.job.progress = 60;
  const result = await executeJob(9);
  assert.equal(result.draftId, 81);
  assert.equal(state.job.status, 'review');
});

test('an attempt to run a cancelled job preserves its cancelled status', async () => {
  state.job.status = 'cancelled';
  await assert.rejects(executeJob(9), /Status job/);
  assert.equal(state.job.status, 'cancelled');
});

test('planning accepts discovery without a summary and projects away publisher body, photos and arbitrary plan material', async () => {
  state.topic = { ...topic, summary: '', body: 'PUBLISHER_BODY_SENTINEL', image_url: 'https://example.org/PUBLISHER_PHOTO_SENTINEL.jpg' };
  state.job.plan = { ...plan, material: { content: 'PLAN_BODY_SENTINEL' } };
  const result = await createPlan(state.job);
  assert.equal(result.format, 'carousel');
  assert.equal(result.slide_count_hint, 6);
  assert.doesNotMatch(llmPrompts[0], /PUBLISHER_BODY_SENTINEL|PUBLISHER_PHOTO_SENTINEL|PLAN_BODY_SENTINEL|BUKTI_SUMBER_JSON|"summary"|"image_url"/);
  assert.match(llmPrompts[0], /normalized_title|source_url/);
  state.topic.summary = 'PUBLISHER_SUMMARY_SENTINEL';
  await createPlan(state.job);
  assert.doesNotMatch(llmPrompts[1], /PUBLISHER_SUMMARY_SENTINEL|PUBLISHER_BODY_SENTINEL|PUBLISHER_PHOTO_SENTINEL|"summary"|"body"|"image_url"/);
});

test('a queued editorial input seed must become a reviewed plan before original production', async () => {
  const editorial_input = { version: 1, mode: 'current', facts: [
    { id: 'service', text: 'Dinas menyatakan layanan kembali dibuka bagi warga setelah perbaikan fasilitas selesai.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
    { id: 'access', text: 'Warga dapat mengakses layanan melalui kantor kecamatan sesuai jadwal yang ditetapkan.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
    { id: 'requirements', text: 'Petugas menyediakan informasi mengenai persyaratan dan dokumen yang perlu disiapkan.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
  ] };
  state.job = { ...state.job, status: 'queued', plan: { editorial_input } };
  const result = await executeJob(9);
  assert.equal(result.awaiting_plan_review, true);
  assert.equal(state.job.status, 'plan_review');
  assert.equal(productions.length, 0);
  assert.equal(llmPrompts.length, 1);
  assert.deepEqual(result.plan.editorial_input, editorial_input);
  await executeJob(9);
  assert.deepEqual(productions[0][2].editorialInput, editorial_input);
});

test('manual plan updates and plan regeneration preserve input unless explicitly replaced', async () => {
  const editorial_input = { version: 1, mode: 'current', facts: [
    { id: 'service', text: 'Dinas menyatakan layanan kembali dibuka bagi warga setelah perbaikan fasilitas selesai.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
    { id: 'access', text: 'Warga dapat mengakses layanan melalui kantor kecamatan sesuai jadwal yang ditetapkan.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
    { id: 'requirements', text: 'Petugas menyediakan informasi mengenai persyaratan dan dokumen yang perlu disiapkan.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
  ] };
  state.job.plan.editorial_input = editorial_input;
  const { editorial_input: ignored, ...edited } = plan;
  assert.deepEqual((await updatePlan(9, edited)).editorial_input, editorial_input);
  assert.deepEqual((await regeneratePlan(9)).editorial_input, editorial_input);
  assert.deepEqual((await regeneratePlan(9, '', { editorialInput: { mode: 'explainer', facts: [] } })).editorial_input, plan.editorial_input);
});
