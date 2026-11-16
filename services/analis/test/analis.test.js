import test from 'node:test';
import assert from 'node:assert/strict';
import { loadService, recordingDb } from '../../scout/test/service-harness.js';

function transactionDb(topics, { failStatus = false } = {}) {
  let pending = [], persisted = [];
  const db = recordingDb((sql, params) => {
    if (sql.includes('SELECT * FROM topics')) {
      let selected = [...topics];
      if (sql.includes('ORDER BY created_at DESC')) {
        selected.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
      } else if (sql.includes('ORDER BY id ASC')) selected.sort((a, b) => a.id - b.id);
      if (sql.includes('LIMIT $1')) selected = selected.slice(0, params[0]);
      return { rows: selected };
    }
    if (sql === 'BEGIN') { pending = []; return { rows: [] }; }
    if (sql === 'COMMIT') { persisted.push(...pending); pending = []; return { rows: [] }; }
    if (sql === 'ROLLBACK') { pending = []; return { rows: [] }; }
    if (sql.includes('INSERT INTO topic_scores')) { pending.push(params); return { rows: [] }; }
    if (failStatus && sql.includes('UPDATE topics')) throw new Error('test status update failed');
    return { rows: [] };
  });
  db.scores = () => persisted;
  return db;
}

test('sasaran and investment scam warnings avoid fast-fail while actual investment promotions fail', async () => {
  const db = transactionDb([
    { id: 1, title: 'Sasaran inflasi Bank Indonesia terbaru', summary: '' },
    { id: 2, title: 'OJK memperingatkan masyarakat: hindari investasi bodong dan jangan serok saham', summary: 'Waspada penipuan investasi.' },
    { id: 3, title: 'Serok saham pilihan ini, potensial cuan!', summary: 'Beli sekarang.' },
  ]);
  const { runAnalis } = await loadService('analis/analis.js', {
    client: db, config: { analis: { min_score_threshold: 70, fast_fail_rules: 'sara\ninvestasi bodong\nserok' } },
  });
  const result = await runAnalis();
  assert.equal(result.fastFailed, 1);
  assert.equal(db.scores().length, 3);
});

test('configured weights and invalid LLM scores are validated before atomic per-topic status changes', async () => {
  const db = transactionDb([{ id: 1, title: 'Rilis inflasi BPS hari ini 2,5%', primary_source: 'BPS' }]);
  const weights = { relevance: 40, credibility: 20, momentum: 20, engagement: 10, compliance: 10 };
  const { runAnalis } = await loadService('analis/analis.js', {
    client: db, config: { analis: { weights, min_score_threshold: 75, api_key: 'fixture-key' } },
    llm: async () => JSON.stringify({ scores: weights, score_total: 99, verdict: 'passed' }),
  });
  const result = await runAnalis();
  assert.equal(result.evaluated, 1);
  const score = db.scores()[0];
  assert.ok(score);
  assert.equal(score[6], score.slice(1, 6).reduce((sum, n) => sum + n, 0));
  assert.equal(score[9], 'heuristic-analis-v2');
  assert.ok(db.calls.findIndex((call) => call.sql === 'BEGIN') < db.calls.findIndex((call) => call.sql.includes('INSERT INTO topic_scores')));
});

test('a failed status update rolls its score back and does not leave a partially processed topic', async () => {
  const db = transactionDb([{ id: 1, title: 'Data inflasi', primary_source: 'BPS' }], { failStatus: true });
  const { runAnalis } = await loadService('analis/analis.js', { client: db, config: { analis: { min_score_threshold: 70 } } });
  await assert.rejects(() => runAnalis(), /test status update failed/);
  assert.ok(db.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(db.scores().length, 0);
});

test('zero component weights remain zero in the LLM rubric', async () => {
  const weights = { relevance: 50, credibility: 50, momentum: 0, engagement: 0, compliance: 0 };
  let prompt;
  const db = transactionDb([{ id: 1, title: 'Data inflasi BPS' }]);
  const { runAnalis } = await loadService('analis/analis.js', {
    client: db, config: { analis: { api_key: 'fixture-key', weights, min_score_threshold: 80 } },
    llm: async (_, value) => { prompt = value; return JSON.stringify({ scores: weights, score_total: 100 }); },
  });
  await runAnalis();
  assert.match(prompt, /Momentum: 0-0/);
  assert.match(prompt, /Kepatuhan: 0-0/);
  assert.equal(db.scores()[0][3], 0);
});

test('a regulatory warning does not disable unrelated ethics rules in a combined pattern', async () => {
  const db = transactionDb([{ id: 1, title: 'OJK memperingatkan investasi bodong disertai ujaran kebencian' }]);
  const { runAnalis } = await loadService('analis/analis.js', {
    client: db, config: { analis: { min_score_threshold: 70, fast_fail_rules: 'investasi bodong|ujaran kebencian' } },
  });
  const result = await runAnalis();
  assert.equal(result.fastFailed, 1);
});

test('defaults to twenty newest topics and leaves the rest of a backlog untouched', async () => {
  const db = transactionDb(Array.from({ length: 25 }, (_, i) => ({
    id: i + 1, title: 'Data inflasi BPS', created_at: new Date(Date.UTC(2026, 10, 16, 0, i)).toISOString(),
  })));
  const { runAnalis } = await loadService('analis/analis.js', {
    client: db, config: { analis: { min_score_threshold: 70 } },
  });
  const result = await runAnalis({ client: db });
  assert.equal(result.evaluated, 20);
  assert.deepEqual(db.scores().map((score) => score[0]), Array.from({ length: 20 }, (_, i) => 25 - i));
  assert.equal(db.calls.filter((call) => call.sql.includes('UPDATE topics')).length, 20);
});

test('honors max_topics_per_run and prioritizes creation time with a newest-ID tie breaker', async () => {
  const db = transactionDb([
    { id: 100, title: 'Data inflasi lama', created_at: '2020-01-01T00:00:00Z' },
    { id: 2, title: 'Data inflasi terbaru', created_at: '2026-11-16T02:00:00Z' },
    { id: 3, title: 'Data inflasi terbaru kedua', created_at: '2026-11-16T02:00:00Z' },
    { id: 4, title: 'Data inflasi pagi', created_at: '2026-11-16T01:00:00Z' },
  ]);
  const { runAnalis } = await loadService('analis/analis.js', { client: db });
  const result = await runAnalis({ client: db, config: { analis: { min_score_threshold: 70, max_topics_per_run: 2 } } });
  assert.equal(result.evaluated, 2);
  assert.deepEqual(db.scores().map((score) => score[0]), [3, 2]);
});

test('rejects invalid batch limits before querying or changing topics', async () => {
  const db = transactionDb([]);
  const { runAnalis } = await loadService('analis/analis.js', { client: db });
  for (const maxTopics of [0, -1, 1.5, 'invalid']) {
    await assert.rejects(() => runAnalis({ client: db, config: { analis: { max_topics_per_run: maxTopics } } }), /max_topics_per_run/);
  }
  assert.equal(db.calls.length, 0);
});
