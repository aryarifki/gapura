import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let state;
const topic = { id: 42, title: 'BPS merilis inflasi', summary: 'Inflasi Oktober 2,1%.', primary_source: 'BPS', url: 'https://www.bps.go.id/rilis/1', status: 'scored', verification_status: 'verified' };
const plan = { title: 'Harga pangan', angle: 'Soroti pangan', sections: ['Harga pangan', 'Data inflasi'], verification_requested: true, format: 'single', caption_tone: 'ringkas' };
const queries = [];
const llmPrompts = [];
const productions = [];
let verifies = 0;
let locked = false;
const client = {
  release() {},
  async query(sql, values = []) {
    queries.push({ sql, values });
    if (/pg_try_advisory/.test(sql)) { const acquired = !locked; if (acquired) locked = true; return { rows: [{ acquired, locked: acquired }] }; }
    if (/pg_advisory_unlock/.test(sql)) { locked = false; return { rows: [{ unlocked: true }] }; }
    if (/SELECT .*FROM prompt_jobs/i.test(sql)) return { rows: state.job ? [{ ...state.job }] : [] };
    if (/FROM topics\b/i.test(sql)) return { rows: state.topic ? [{ ...state.topic }] : [] };
    if (/FROM topic_scores\b/i.test(sql)) return { rows: state.score ? [state.score] : [] };
    if (/FROM verification_reports\b/i.test(sql)) return { rows: state.verification ? [state.verification] : [] };
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
  loadAgentsConfig: () => ({ analis: { min_score_threshold: 76 } }),
  callAgentLLM: async (_agent, prompt) => { llmPrompts.push(prompt); if (state.llmError) throw state.llmError; return JSON.stringify({ ...plan, title: 'Rencana revisi' }); },
} });
mock.module('../../verificator/verificator.js', { namedExports: { verifyTopic: async () => { verifies++; await state.verificationWait; return state.verificationResult === undefined ? state.verification : state.verificationResult; } } });
mock.module('../../copywriter/copywriter.js', { namedExports: { produceSingleTopicDraft: async (...args) => { productions.push(args); return { draft_id: 81 }; } } });
mock.module('../../telegram/bot.js', { namedExports: { dispatchDraftToTelegram: async () => {} } });
const { createPlan, regeneratePlan, updatePlan, executeJob } = await import('../studio.js');

test.beforeEach(() => {
  state = { job: { id: 9, topic_id: 42, prompt: 'Utamakan harga pangan', plan: { ...plan }, status: 'plan_review' }, topic: { ...topic }, score: { score_total: 88, verdict: 'passed' }, verification: { id: 7, topic_id: 42, status: 'verified', confidence: 90 } };
  queries.length = 0; llmPrompts.length = 0; productions.length = 0; verifies = 0; locked = false;
});

test('regeneration includes the current reviewed plan and revision instruction without const reassignment', async () => {
  const result = await regeneratePlan(9, 'Pertahankan fokus pangan');
  assert.equal(result.title, 'Rencana revisi');
  assert.ok(llmPrompts[0].includes('Soroti pangan'));
  assert.ok(llmPrompts[0].includes('Pertahankan fokus pangan'));
  assert.equal(state.job.status, 'plan_review');
});

test('planning validates an existing analyzed source before any LLM call', async () => {
  state.topic = null;
  await assert.rejects(createPlan(state.job), /topic_not_found|Topik sumber tidak ditemukan/);
  assert.equal(llmPrompts.length, 0);
  state.topic = { ...topic, status: 'new' };
  await assert.rejects(createPlan(state.job), /topic_not_scored/);
  assert.equal(llmPrompts.length, 0);
});

test('only plan_review jobs permit manual edits or regeneration', async () => {
  for (const status of ['queued', 'planning', 'verifying', 'drafting', 'review', 'cancelled', 'failed']) {
    state.job.status = status;
    await assert.rejects(updatePlan(9, plan), /plan_review|status/i);
    await assert.rejects(regeneratePlan(9), /plan_review|status/i);
  }
  assert.equal(llmPrompts.length, 0);
});

test('execution passes the current plan and prompt as an editorial brief while retaining source facts', async () => {
  const result = await executeJob(9, { autoPublish: true });
  assert.equal(result.scheduled, false);
  assert.equal(productions.length, 1);
  assert.equal(productions[0][0].title, topic.title);
  assert.deepEqual(productions[0][2].editorialBrief.plan, plan);
  assert.equal(productions[0][2].editorialBrief.prompt, state.job.prompt);
  assert.equal(productions[0][2].forceReview, true);
  assert.ok(!queries.some(({ sql }) => /scheduled_posts/.test(sql)));
});

test('a missing source during execution fails meaningfully before verification or rendering', async () => {
  state.topic = null;
  await assert.rejects(executeJob(9), /topic_not_found|Topik sumber tidak ditemukan/);
  assert.equal(verifies, 0);
  assert.equal(productions.length, 0);
});

test('a hoax source cannot bypass its gate with a plan requesting no verification', async () => {
  state.topic.verification_status = 'hoax_detected';
  state.job.plan.verification_requested = false;
  const result = await executeJob(9);
  assert.equal(result.blocked, true);
  assert.equal(productions.length, 0);
  assert.equal(verifies, 0);
});

test('empty or invalid verification output prevents draft production', async () => {
  state.verification = null;
  const result = await executeJob(9);
  assert.equal(result.blocked, true);
  assert.equal(productions.length, 0);
});

test('simultaneous executions produce one draft and return an in_progress result to the duplicate', async () => {
  let finish;
  state.verificationWait = new Promise((resolve) => { finish = resolve; });
  const first = executeJob(9);
  // Advance only promise work until the first execution reaches verification.
  for (let n = 0; n < 50 && !verifies; n++) await Promise.resolve();
  const second = executeJob(9);
  for (let n = 0; n < 20; n++) await Promise.resolve();
  finish();
  const results = await Promise.all([first, second]);
  assert.equal(productions.length, 1);
  assert.ok(results.some((result) => result.in_progress === true));
});

test('a completed retry returns the existing draft without repeating verification or production', async () => {
  state.job = { ...state.job, status: 'review', draft_id: 81 };
  state.draft = { id: 81, status: 'draft', slides: [{ no: 1, teks: topic.title }], rendered_count: 1, content_format: 'single' };
  const result = await executeJob(9);
  assert.equal(result.draftId, 81);
  assert.equal(result.is_existing, true);
  assert.equal(productions.length, 0);
  assert.equal(verifies, 0);
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
  assert.equal(verifies, 0);
});

test('a hoax result returned by verification cannot be overridden by a stale database report', async () => {
  state.verificationResult = { id: 8, topic_id: 42, status: 'hoax_detected', confidence: 95 };
  const result = await executeJob(9);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'hoax_detected');
  assert.equal(productions.length, 0);
});

test('a completed Studio retry still blocks a source subsequently flagged as hoax', async () => {
  state.job = { ...state.job, status: 'review', draft_id: 81 };
  state.topic.verification_status = 'hoax_detected';
  state.draft = { id: 81, status: 'draft', slides: [{ no: 1, teks: topic.title }], rendered_count: 1, content_format: 'single' };
  const result = await executeJob(9);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'hoax_detected');
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
  assert.equal(verifies, 0);
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

test('a completed Studio retry still requires a valid latest persisted verification report', async () => {
  state.job = { ...state.job, status: 'review', draft_id: 81 };
  state.draft = { id: 81, status: 'draft', slides: [{ no: 1, teks: topic.title }], rendered_count: 1, content_format: 'single' };
  state.verification = null;
  await assert.rejects(executeJob(9), /verification_required/);
});

test('a failed job that never reached reviewed production cannot skip plan review on retry', async () => {
  state.job = { ...state.job, status: 'failed', progress: 20 };
  const result = await executeJob(9);
  assert.equal(result.awaiting_plan_review, true);
  assert.equal(verifies, 0);
  assert.equal(productions.length, 0);
});

test('an attempt to run a cancelled job preserves its cancelled status', async () => {
  state.job.status = 'cancelled';
  await assert.rejects(executeJob(9), /Status job/);
  assert.equal(state.job.status, 'cancelled');
});
