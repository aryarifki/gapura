import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { editorialPythonExecutable } from '../../common/editorial-python.js';
import { buildStagedStory, EDITORIAL_STAGE_SCHEMAS, parseEditorialJson } from '../storytelling.js';
import { validateOriginalContent } from '../../common/original-editorial.js';
import { article, brief, caption, carousel, context, documents, passages, response, stages, synthesis, threads } from './storytelling-staged-fixtures.js';

const [S1, S2, S3A, S3B, S3C, S4] = Object.keys(EDITORIAL_STAGE_SCHEMAS);
const gatePath = fileURLToPath(new URL('../story-gate.py', import.meta.url));
const PYTHON = editorialPythonExecutable();
const gate = (stage, value, input = context) => JSON.parse(execFileSync(PYTHON, [gatePath], {
  input: JSON.stringify({ op: 'validate', stage, value, context: input }), encoding: 'utf8',
}));
const payload = (prompt) => JSON.parse(prompt.split('PAYLOAD_JSON: ').at(-1));

test('parser accepts object rows and legacy arrays, preserving semantic literals during syntax repair', async () => {
  const rows = [{ text: 'Bus [pasar], belum berlaku.' }];
  for (const output of [JSON.stringify(rows), JSON.stringify({ rows }), `Jawaban:\n\`\`\`json\n${JSON.stringify({ rows })}\n\`\`\``]) {
    assert.deepEqual(await parseEditorialJson(output), rows);
  }
  assert.deepEqual(await parseEditorialJson('{rows:[{text:\'Bus belum berlaku.\',},]}'), [{ text: 'Bus belum berlaku.' }]);
  assert.deepEqual(await parseEditorialJson('{"rows":[{"text":"Bus belum berlaku.""}]}'), [{ text: 'Bus belum berlaku.' }]);
  assert.deepEqual(await parseEditorialJson('[{"text":"belum berlaku" "count":3}]'), [{ text: 'belum berlaku', count: 3 }]);
  for (const broken of ['{"rows":[{"text":"belum berlaku}]}', '[{"text":"belum berlaku"}', '[{"text":}]', '[{"text":"a","text":"b"}]', '[{"text":"a"}] []', '{"rows":[],"extra":true}']) {
    await assert.rejects(parseEditorialJson(broken));
  }
});

test('root schemas stay shallow and only contain primitive flat row fields', () => {
  for (const schema of Object.values(EDITORIAL_STAGE_SCHEMAS)) {
    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required, ['rows']);
    assert.equal(schema.properties.rows.type, 'array');
    const row = schema.properties.rows.items;
    assert.equal(row.type, 'object');
    for (const property of Object.values(row.properties)) assert.ok(['integer', 'string', 'boolean'].includes(property.type));
    assert.doesNotMatch(JSON.stringify(schema), /"(?:minItems|maxItems|minLength|maxLength|pattern)"/u);
  }
});

test('actual staged gates validate object roots, bounded sources, compact handoffs and complete checkpoints', async () => {
  const snapshots = [], calls = [], attempts = [];
  let starts = 0, inFlight = 0, release;
  const allStarted = new Promise((resolve) => { release = resolve; });
  const story = await buildStagedStory(brief, { documents, reviewer: true,
    saveCheckpoint: async (value) => {
      assert.equal(++inFlight, 1);
      await setImmediate();
      snapshots.push(value);
      inFlight--;
    }, onAttempt: (attempt) => attempts.push(attempt),
    invoke: async (_agent, prompt, _policy, _mode, options) => {
      const { stage } = options;
      calls.push(stage);
      options.onAttempt({ provider: 'fixture', model: 'offline', outcome: 'success', secret: 'discard-this' });
      options.onMetadata({ provider: 'fixture', model: 'offline', usage: { total_tokens: 25 } });
      if (stage === S1) {
        const input = payload(prompt);
        assert.equal(input.documents.length, 3);
        assert.equal(input.documents[0].passages.flatMap((part) => part.split(' ')).length, 1500);
        assert.doesNotMatch(prompt, /https?:\/\/|Baca juga:|Batas rahasia/u);
      } else if (stage === S2) {
        assert.ok(payload(prompt).facts.every((fact) => !('source_url' in fact)));
        assert.ok(!('documents' in payload(prompt)));
        assert.doesNotMatch(prompt, /lampiran lampiran/u);
      } else if (stage !== S4) {
        assert.deepEqual(Object.keys(payload(prompt).article), ['headline', 'lead', 'takeaways']);
        assert.ok(!prompt.includes(article.find((row) => row.kind === 'paragraph').text));
        if (++starts === 3) release();
        await allStarted;
      }
      return response(stage);
    },
  });
  assert.deepEqual(calls, [S1, S2, S3A, S3B, S3C, S4]);
  assert.equal(attempts.length, 6);
  assert.ok(attempts.every((attempt) => !('secret' in attempt)));
  assert.deepEqual([...new Set(snapshots.map((value) => value.status))], ['STAGE1_DONE', 'STAGE2_DONE', 'STAGE3_DONE', 'VALIDATED']);
  assert.equal(story.checkpoint.status, 'VALIDATED');
  assert.ok(Object.values(story.checkpoint.stages).every(({ receipt }) => receipt.status === 'complete'));
  assert.equal(story.checkpoint.stages[S2].receipt.usage.total_tokens, 25);
  assert.equal(story.brief.pipeline_version, 3);
  assert.equal(story.raw.slides[0].teks, '');
  assert.equal(story.raw.slides.length, 3);
  assert.ok(story.brief.facts.every((fact) => !('source_id' in fact)));
  assert.equal(story.raw.article_metadata.entities[0].short, 'Kepala Bidang Angkutan');
  assert.equal(story.review.publication_approved, false);
  // Visual search hints are internal metadata stripped by the integration.
  const raw = { ...story.raw, slides: story.raw.slides.map(({ visual_query, ...slide }) => slide) };
  const content = validateOriginalContent(raw, story.brief);
  assert.equal(content.article_metadata.headline, story.raw.article_metadata.headline);
  assert.equal(content.slides.length, 3);
  assert.equal(content.article_metadata.sections.length, 3);
});

test('staged generation retains legacy array response compatibility', async () => {
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, _p, _s, _j, { stage }) => JSON.stringify(stages[stage]) });
  assert.equal(story.checkpoint.status, 'VALIDATED');
  assert.ok(!story.review);
});

test('checkpoint JSON key ordering does not invent a content-repair receipt', async () => {
  const first = await buildStagedStory(brief, { documents, invoke: async (_a, _p, _s, _j, { stage }) => response(stage) });
  const reorder = (value) => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const resumed = await buildStagedStory(brief, { documents, checkpoint: reorder(first.checkpoint),
    invoke: async () => assert.fail('unchanged checkpoints must not invoke a provider') });
  assert.deepEqual(resumed.raw, first.raw);
  assert.equal(resumed.checkpoint.stages[S1].receipt.local_repairs, undefined);
  assert.equal(resumed.checkpoint.stages[S2].receipt.local_repairs, undefined);
});

test('entity repair keeps gate-accepted entities instead of dropping the whole registry', async () => {
  const badEntity = { kind: 'person', name: 'Budi Santoso', expansion: 'Kepala Dinas Perhubungan Pesisir', fact_ids: 'f21' };
  const story = await buildStagedStory(brief, { documents,
    invoke: async (_a, _p, _s, _j, { stage }) => (stage === S1 ? JSON.stringify({ rows: [...synthesis, badEntity] }) : response(stage)),
  });
  const s1 = story.checkpoint.stages[S1];
  assert.equal(s1.receipt.attempts[0].repair_source, 'local_entity');
  assert.deepEqual(s1.value.filter((row) => row.kind === 'person').map((row) => row.name), ['Dewi Aruna']);
  assert.deepEqual(story.brief.entity_registry.map((entity) => entity.name), ['Dewi Aruna']);
  assert.equal(story.checkpoint.status, 'VALIDATED');
});

test('entity repair preserves valid compact labels and ignores duplicate names', async () => {
  const invalidShort = structuredClone(synthesis);
  invalidShort.find((row) => row.kind === 'person').short = 'Komisaris';
  const duplicate = structuredClone(synthesis.find((row) => row.kind === 'person'));
  for (const rows of [invalidShort, [...synthesis, duplicate]]) {
    let saved;
    await assert.rejects(buildStagedStory(brief, { documents,
      saveCheckpoint: async (value) => { saved = value; },
      invoke: async (_a, _p, _s, _j, { stage }) => {
        if (stage === S1) return JSON.stringify({ rows });
        throw new Error('fixture_stop_after_synthesis');
      },
    }));
    const entities = saved.stages[S1].value.filter((row) => row.kind === 'person');
    assert.equal(entities.length, 1);
    assert.equal(entities[0].name, 'Dewi Aruna');
    assert.equal(entities[0].short || '', rows === invalidShort ? '' : 'Kepala Bidang Angkutan');
  }
});

test('article fact repair updates lead refs independently of explicit metadata refs', () => {
  const rows = structuredClone(article);
  const lead = rows.find((row) => row.kind === 'lead');
  lead.text = lead.text.replace('Penumpang tetap bisa', 'Pada 10 Oktober 2026, penumpang tetap bisa');
  lead.fact_ids = 'f11,f21,f31';
  assert.equal(gate(S2, rows).error, 'article_lead_date_unreferenced');
  const repaired = JSON.parse(execFileSync(PYTHON, [gatePath], {
    input: JSON.stringify({ op: 'fact_repair', stage: S2, value: rows, context }), encoding: 'utf8',
  }));
  assert.equal(repaired.ok, true);
  assert.ok(repaired.value.find((row) => row.kind === 'lead').fact_ids.split(',').includes('f12'));
  assert.equal(gate(S2, repaired.value).ok, true);
});

test('basis points keep their unit across Indonesian wording and never become percent', () => {
  const input = structuredClone(context);
  input.facts.push({ id: 'bps', text: 'Suku bunga naik 25 bps.', source_id: 'd1' });
  const rows = structuredClone(threads);
  rows[0] = { no: 1, text: 'Suku bunga naik 25 basis poin.', fact_ids: 'bps' };
  assert.equal(gate(S3C, rows, input).ok, true);
  rows[0].text = 'Suku bunga naik 25 persen.';
  assert.equal(gate(S3C, rows, input).error, 'threads_post_1_number_unreferenced');
});

test('both years of a sourced year span are supported without inventing a third year', () => {
  const input = structuredClone(context);
  input.facts.push({ id: 'span', text: 'Kebijakan berlaku tahun 2026-2027.', source_id: 'd1' });
  const rows = structuredClone(threads);
  rows[0] = { no: 1, text: 'Kebijakan berlaku pada 2026 dan 2027.', fact_ids: 'span' };
  assert.equal(gate(S3C, rows, input).ok, true);
  rows[0].text = 'Kebijakan berlaku pada 2028.';
  assert.equal(gate(S3C, rows, input).error, 'threads_post_1_number_unreferenced');
});

test('article paragraphs must each satisfy the owner 40-to-55-word requirement', () => {
  assert.equal(gate(S2, article).ok, true);
  for (const count of [39, 56]) {
    const rows = structuredClone(article);
    rows.find((row) => row.kind === 'paragraph').text = Array(count).fill('jalur').join(' ');
    assert.equal(gate(S2, rows).error, 'article_paragraph_40_to_55_words');
  }
});

test('paragraph word repair replaces only rejected paragraphs within the two-attempt stage budget', async () => {
  let articleCalls = 0;
  const bad = structuredClone(article);
  const first = bad.find((row) => row.kind === 'paragraph');
  first.text = first.text.split(' ').slice(0, 39).join(' ');
  const original = article.find((row) => row.kind === 'paragraph');
  const story = await buildStagedStory(brief, { documents,
    invoke: async (_a, prompt, _p, _j, { stage }) => {
      if (stage !== S2) return response(stage);
      if (++articleCalls === 1) return JSON.stringify({ rows: bad });
      assert.match(prompt, /TARGET_ROWS_JSON:/u);
      assert.ok(!prompt.includes(article.filter((row) => row.kind === 'paragraph')[1].text));
      const targets = JSON.parse(prompt.split('TARGET_ROWS_JSON: ')[1].split('\nENTITIES_JSON: ')[0]);
      assert.deepEqual(targets.map((row) => row.kind), ['paragraph']);
      assert.equal(targets[0].repair.minimum_words_to_add, 1);
      return JSON.stringify({ rows: [original] });
    },
  });
  assert.equal(articleCalls, 2);
  assert.deepEqual(story.checkpoint.stages[S2].value, gate(S2, article).value);
  assert.equal(story.checkpoint.stages[S2].receipt.attempts[1].repair_source, 'article_fields');
});

test('metadata length failures repair only the invalid field with exact diagnostics', async () => {
  const bad = structuredClone(article);
  bad.find((row) => row.kind === 'metadata').meta_description = 'rincian '.repeat(32).trim();
  let calls = 0;
  const original = article.find((row) => row.kind === 'metadata');
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, prompt, _p, _j, { stage }) => {
    if (stage !== S2) return response(stage);
    if (++calls === 1) return JSON.stringify({ rows: bad });
    const targets = JSON.parse(prompt.split('TARGET_ROWS_JSON: ')[1].split('\nENTITIES_JSON: ')[0]);
    assert.equal(targets.length, 1);
    assert.deepEqual(targets[0].repair.fields, ['meta_description']);
    assert.ok(targets[0].repair.current_characters.meta_description > 200);
    return JSON.stringify({ rows: [{ kind: 'metadata', meta_description: original.meta_description }] });
  } });
  assert.equal(calls, 2);
  assert.deepEqual(story.checkpoint.stages[S2].value, gate(S2, article).value);
});

test('the carousel close requires its CTA and exactly one question across all visible copy', () => {
  const rows = structuredClone(carousel);
  const close = rows.find((row) => row.role === 'close');
  close.text = '';
  assert.equal(gate(S3A, rows).error, 'carousel_close_cta_required');
  close.text = carousel.find((row) => row.role === 'close').text;
  close.title += '?';
  assert.equal(gate(S3A, rows).error, 'carousel_close_one_question_required');
});

test('focused article repairs safely project full provider responses onto requested rows only', async () => {
  const bad = structuredClone(article);
  bad.find((row) => row.kind === 'paragraph').text = Array(39).fill('jalur').join(' ');
  const returned = structuredClone(article);
  returned.find((row) => row.kind === 'metadata').headline = 'Unrequested invalid short headline';
  returned.filter((row) => row.kind === 'paragraph')[1].text = 'Unrequested edit that must be discarded.';
  let calls = 0;
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, _p, _s, _j, { stage }) => {
    if (stage !== S2) return response(stage);
    return JSON.stringify({ rows: ++calls === 1 ? bad : returned });
  } });
  assert.equal(calls, 2);
  assert.deepEqual(story.checkpoint.stages[S2].value, gate(S2, article).value);
});

test('a local citation repair survives another violation before the targeted provider retry', async () => {
  const bad = structuredClone(article);
  const meta = bad.find((row) => row.kind === 'metadata');
  meta.meta_description += ' Berlaku pada 10 Oktober 2026.';
  bad.find((row) => row.kind === 'paragraph').text = Array(39).fill('jalur').join(' ');
  let calls = 0;
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, prompt, _p, _j, { stage }) => {
    if (stage !== S2) return response(stage);
    if (++calls === 1) return JSON.stringify({ rows: bad });
    const targets = JSON.parse(prompt.split('TARGET_ROWS_JSON: ')[1].split('\nENTITIES_JSON: ')[0]);
    assert.ok(targets.every((row) => row.kind !== 'metadata'));
    const repaired = structuredClone(article);
    Object.assign(repaired.find((row) => row.kind === 'metadata'), meta, { fact_ids: 'f11,f21,f31,f12' });
    return JSON.stringify({ rows: repaired });
  } });
  assert.equal(calls, 2);
  assert.ok(story.checkpoint.stages[S2].value.find((row) => row.kind === 'metadata').fact_ids.includes('f12'));
});

test('a failed stage reports the remaining defect after local citation repair', async () => {
  const rows = structuredClone(article);
  rows.find((row) => row.kind === 'metadata').meta_description += ' Berlaku pada 10 Oktober 2026.';
  rows.find((row) => row.kind === 'paragraph').text = Array(39).fill('jalur').join(' ');
  let checkpoint;
  await assert.rejects(buildStagedStory(brief, { documents,
    saveCheckpoint: async (value) => { checkpoint = value; },
    invoke: async (_a, _p, _s, _j, { stage }) => stage === S2 ? JSON.stringify({ rows }) : response(stage),
  }), /article_paragraph_40_to_55_words/u);
  assert.equal(checkpoint.stages[S2].receipt.error, 'article_paragraph_40_to_55_words');
});

test('article repair selects a bounded whole headline candidate and strips candidate-only fields', async () => {
  const bad = structuredClone(article);
  bad.find((row) => row.kind === 'metadata').headline = 'Judul terlalu pendek';
  let calls = 0;
  const originalMeta = article.find((row) => row.kind === 'metadata');
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, prompt, _p, _j, { stage }) => {
    if (stage !== S2) return response(stage);
    if (++calls === 1) return JSON.stringify({ rows: bad });
    assert.match(prompt, /headline_alt2/u);
    return JSON.stringify({ rows: [
      { kind: 'metadata', headline: 'Masih pendek', headline_alt: originalMeta.headline },
    ] });
  } });
  assert.equal(calls, 2);
  assert.deepEqual(story.checkpoint.stages[S2].value, gate(S2, article).value);
  assert.doesNotMatch(JSON.stringify(story.raw), /headline_alt/u);
});

test('four flat sentence fields become one exact paragraph during generation and repair', async () => {
  const sentences = [
    'Dinas Perhubungan memindahkan layanan bus dari jalur menuju kawasan Pasar Utara.',
    'Perubahan tersebut berlangsung selama pekerjaan perbaikan jalan di sekitar akses pasar.',
    'Pengelola menyediakan pemberhentian sementara agar penumpang tetap dapat berpindah menuju jalur pengganti.',
    'Penunjuk arah membantu penumpang membaca perpindahan yang disiapkan selama pekerjaan di sekitar pasar.',
  ];
  const flat = { kind: 'paragraph', section: 1, fact_ids: 'f11,f12,f21',
    ...Object.fromEntries(sentences.map((value, index) => [`sentence_${index + 1}`, value])) };
  for (const needsRepair of [false, true]) {
    let calls = 0;
    const rows = structuredClone(article);
    const index = rows.findIndex((row) => row.kind === 'paragraph');
    rows[index] = needsRepair ? { ...rows[index], text: Array(39).fill('jalur').join(' ') } : flat;
    const story = await buildStagedStory(brief, { documents, invoke: async (_a, _p, _s, _j, { stage }) => {
      if (stage !== S2) return response(stage);
      return JSON.stringify({ rows: ++calls === 1 ? rows : [flat] });
    } });
    assert.equal(calls, needsRepair ? 2 : 1);
    assert.equal(story.raw.article_metadata.sections[0].paragraphs[0].text, sentences.join(' '));
    assert.doesNotMatch(JSON.stringify(story.raw), /sentence_\d/u);
  }
});

test('the carousel cover reuses the validated article headline and its evidence exactly', async () => {
  const modified = structuredClone(carousel);
  modified.find((row) => row.no === 1).title = 'Provider rewrote the headline';
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, prompt, _p, _j, { stage, maxTokens }) => {
    assert.equal(maxTokens, 4096);
    if (stage === S2) assert.match(prompt, /Nama orang dan jabatannya hanya boleh memakai entities/u);
    return stage === S3A ? JSON.stringify({ rows: modified }) : response(stage);
  } });
  assert.equal(story.raw.slides[0].data.title, story.raw.article_metadata.headline);
  assert.deepEqual(story.raw.slides[0].fact_ids, story.raw.article_metadata.fact_ids);
});

test('synthesis retains publication dates and source cautions as internal context', async () => {
  const dated = structuredClone(documents);
  dated[0].published_at = '2026-10-10';
  dated[0].limitations = 'Internal temporal caution; an announcement is not proof of an outcome.';
  const story = await buildStagedStory(brief, { documents: dated, invoke: async (_a, prompt, _p, _j, { stage }) => {
    if (stage === S1) {
      const source = payload(prompt).documents[0];
      assert.equal(source.published_at, dated[0].published_at);
      assert.deepEqual(source.limitations, [dated[0].limitations]);
    }
    return response(stage);
  } });
  assert.doesNotMatch(JSON.stringify(story.raw), /Internal temporal caution/u);
});

test('key points before article sections receive sourced acronym expansions', async () => {
  const source = structuredClone(synthesis);
  const text = 'Dinas Perhubungan (Dishub) memindahkan layanan bus di koridor Pasar Utara selama pekerjaan perbaikan jalan di sekitar jalur menuju pasar.';
  source.find((row) => row.fact_id === 'f11').text = text;
  source.push({ kind: 'acronym', name: 'Dishub', expansion: 'Dinas Perhubungan (Dishub)', fact_ids: 'f11' });
  const docs = structuredClone(documents);
  docs[0].text = docs[0].text.replace(passages[0][0], text);
  const modified = structuredClone(article);
  modified.find((row) => row.kind === 'takeaway').text = 'Dishub memindahkan layanan bus selama pekerjaan perbaikan jalan dekat Pasar Utara.';
  const story = await buildStagedStory(brief, { documents: docs, invoke: async (_a, _p, _s, _j, { stage }) =>
    JSON.stringify({ rows: stage === S1 ? source : stage === S2 ? modified : stages[stage] }) });
  assert.match(story.raw.article_metadata.takeaways[0].text, /^Dinas Perhubungan \(Dishub\)/u);
  assert.ok(story.raw.article_metadata.takeaways[0].fact_ids.includes('f11'));
});

test('carousel close repair preserves its question and uses a neutral non-question heading', async () => {
  const modified = structuredClone(carousel);
  const close = modified.find((row) => row.no === 3);
  close.title = 'Bagaimana Dampaknya?';
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, _p, _s, _j, { stage }) =>
    stage === S3A ? JSON.stringify({ rows: modified }) : response(stage) });
  const result = story.raw.slides.find((slide) => slide.no === 3);
  assert.equal(result.data.title, 'Pendapat Anda');
  assert.equal(result.data.question, close.question);
  assert.equal(result.teks, close.text);
});

test('a provider error retries the stage transport twice with fresh keys before failing', async () => {
  let articleCalls = 0;
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, _p, _s, _j, options) => {
    if (options.stage !== S2) return response(options.stage);
    articleCalls += 1;
    if (articleCalls <= 2) throw new Error('Gemini could not be reached (timeout).');
    return JSON.stringify({ rows: article });
  } });
  assert.equal(articleCalls, 3);
  assert.equal(story.checkpoint.stages[S2].receipt.status, 'complete');
});

test('a provider error across all stage transport attempts surfaces as a stage failure', async () => {
  let articleCalls = 0;
  await assert.rejects(buildStagedStory(brief, { documents, invoke: async (_a, _p, _s, _j, options) => {
    if (options.stage !== S2) return response(options.stage);
    articleCalls += 1;
    throw new Error('OpenRouter API (402, PROVIDER_ERROR).');
  } }), /stage2_article: OpenRouter API \(402/u);
  assert.equal(articleCalls, 3);
});

test('Gemini stage budget allows two keys per validation attempt (the fallbacks cannot serve large staged prompts)', async () => {
  const bad = structuredClone(article);
  bad.find((row) => row.kind === 'paragraph').text = Array(39).fill('jalur').join(' ');
  let calls = 0;
  const story = await buildStagedStory(brief, { documents, invoke: async (_a, _p, _s, _j, options) => {
    if (options.stage !== S2) return response(options.stage);
    if (++calls === 1) {
      assert.equal(options.geminiAttemptLimit, 4);
      options.onAttempt({ provider: 'gemini', status: 429, outcome: 'rate_limited' });
      options.onAttempt({ provider: 'gemini', status: 200, outcome: 'success' });
      return JSON.stringify({ rows: bad });
    }
    assert.equal(options.geminiAttemptLimit, 2);
    options.onAttempt({ provider: 'gemini', status: 200, outcome: 'success' });
    return JSON.stringify({ rows: article });
  } });
  assert.equal(calls, 2);
  assert.equal(story.checkpoint.stages[S2].receipt.attempts.flatMap((row) => row.provider_attempts).filter((row) => row.provider === 'gemini').length, 3);
});

test('adapter micro-repair adds missing references without changing copy', () => {
  for (const [stage, rows] of [[S3B, structuredClone(caption)], [S3C, structuredClone(threads)]]) {
    const row = stage === S3B ? rows.find((item) => item.kind === 'paragraph') : rows[0];
    row.text += ' Tersedia 3 titik pemberhentian.';
    row.fact_ids = 'f11,f12';
    assert.match(gate(stage, rows).error, /number_unreferenced/u);
    const result = JSON.parse(execFileSync(PYTHON, [gatePath], {
      input: JSON.stringify({ op: 'fact_repair', stage, value: rows, context }), encoding: 'utf8',
    }));
    assert.equal(result.ok, true);
    assert.equal(result.value.find((item) => item.text === row.text)?.text, row.text);
    assert.equal(gate(stage, result.value).ok, true);
  }
});

test('synthesis accepts a sourced full label and a non-substring short capacity without inventing tokens', () => {
  const source = 'Direktur Penilaian Perusahaan Bursa Efek Indonesia (BEI) Iding Pardi menjelaskan proses evaluasi emiten di pasar modal.';
  const rows = structuredClone(synthesis);
  rows.find((row) => row.fact_id === 'f13').text = source;
  const person = rows.find((row) => row.kind === 'person');
  delete person.expansion; delete person.short;
  Object.assign(person, { name: 'Iding Pardi', full_label: 'Iding Pardi, Direktur Penilaian Perusahaan Bursa Efek Indonesia (BEI)', short_label: 'Iding Pardi, Direktur BEI' });
  const input = structuredClone(context);
  input.documents[0].passages[2] = source;
  for (const full of [person.full_label, 'Iding Pardi, Direktur Penilaian Perusahaan Bursa Efek Indonesia']) {
    person.full_label = full;
    const result = gate(S1, rows, input);
    assert.equal(result.ok, true, JSON.stringify(result));
    const entity = result.value.find((row) => row.kind === 'person');
    assert.equal(entity.expansion, full);
    assert.equal(entity.short, 'Iding Pardi, Direktur BEI');
    assert.ok(!('full_label' in entity));
    assert.ok(!full.includes(entity.short));
  }
  for (const short of ['Iding Pardi', 'Iding Pardi, Komisaris BEI', 'Iding Pardi, Direktur NYSE', 'Iding Pardi, BEI']) {
    person.short_label = short;
    assert.equal(gate(S1, rows, input).ok, false, short);
  }
  person.short_label = 'Iding Pardi, Direktur BEI';
  person.fact_ids = 'f11,f21';
  assert.equal(gate(S1, rows, input).ok, false, 'name and capacity cannot be borrowed from unreferenced evidence');
  person.fact_ids = 'f13';
  input.documents[0].passages[2] = 'Mantan ' + source;
  rows.find((row) => row.fact_id === 'f13').text = 'Mantan ' + source;
  assert.equal(gate(S1, rows, input).ok, false, 'dropping a sourced former-office qualifier changes the capacity');
});

test('evidence stays exact and bounded while public claims may paraphrase it', () => {
  const rewritten = structuredClone(synthesis);
  rewritten.find((row) => row.fact_id === 'f11').text = 'Layanan bus berpindah ketika jalan menuju pasar diperbaiki.';
  assert.match(gate(S1, rewritten).error, /not_verbatim/u);
  rewritten.find((row) => row.fact_id === 'f11').text = 'kata '.repeat(26).trim();
  assert.match(gate(S1, rewritten).error, /25_words/u);
  assert.equal(gate(S3C, threads).ok, true);
  const bad = structuredClone(threads);
  bad[0].text = 'Sebanyak 80 bus berpindah jalur.';
  assert.match(gate(S3C, bad).error, /number_unreferenced/u);
});

test('first mentions accept supported name-role order and compact capacities, but no bare headline name', () => {
  const input = structuredClone(context);
  input.entities[0].expansion = 'Dewi Aruna, Kepala Bidang Angkutan Kota Pesisir';
  input.entities[0].short = 'Dewi Aruna, Kepala Bidang Angkutan';
  assert.equal(gate(S2, article, input).ok, true);
  assert.equal(gate(S3A, carousel, input).ok, true);
  assert.equal(gate(S3C, threads, input).ok, true);
  const bad = structuredClone(article);
  bad[0].headline = 'Dewi Aruna Menjelaskan Pengalihan Jalur Bus di Pasar Utara Sementara';
  assert.match(gate(S2, bad, input).error, /first_mention_unexpanded/u);
});

test('a sourced person short label carries its institution acronym in compact channels only', () => {
  const input = structuredClone(context);
  input.facts.find((fact) => fact.id === 'f13').text = 'Direktur Penilaian Perusahaan Bursa Efek Indonesia (BEI) Iding Pardi menjelaskan proses evaluasi emiten di pasar modal.';
  input.entities = [
    { kind: 'person', name: 'Iding Pardi', expansion: 'Iding Pardi, Direktur Penilaian Perusahaan Bursa Efek Indonesia (BEI)', short: 'Iding Pardi, Direktur BEI', fact_ids: ['f13'] },
    { kind: 'acronym', name: 'BEI', expansion: 'Bursa Efek Indonesia (BEI)', fact_ids: ['f13'] },
  ];
  const posts = structuredClone(threads);
  posts[1].text = 'Iding Pardi, Direktur BEI, menjelaskan proses evaluasi emiten di pasar modal.';
  assert.equal(gate(S3C, posts, input).ok, true);
  posts[1].text = 'BEI menjelaskan proses evaluasi emiten di pasar modal.';
  assert.match(gate(S3C, posts, input).error, /acronym_first_mention_unexpanded/u);
  input.entities[0].fact_ids = ['f11'];
  posts[1].text = 'Iding Pardi, Direktur BEI, menjelaskan proses evaluasi emiten di pasar modal.';
  assert.match(gate(S3C, posts, input).error, /acronym_first_mention_unexpanded/u);
});

test('an adapter timeout preserves successful peers and resumes only the failed stage', async () => {
  const snapshots = [], calls = [];
  await assert.rejects(buildStagedStory(brief, { documents, saveCheckpoint: async (value) => snapshots.push(value),
    invoke: async (_a, _p, _s, _j, { stage }) => {
      calls.push(stage);
      if (stage === S3B) throw new Error('fixture_timeout');
      if ([S3A, S3C].includes(stage)) await setImmediate();
      return response(stage);
    },
  }), /fixture_timeout/u);
  const failed = snapshots.at(-1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stages[S3B].receipt.attempts.length, 1);
  for (const stage of [S1, S2, S3A, S3C]) assert.equal(failed.stages[stage].receipt.status, 'complete');
  const resumedCalls = [];
  const resumed = await buildStagedStory(brief, { documents, checkpoint: failed,
    invoke: async (_a, _p, _s, _j, { stage }) => { resumedCalls.push(stage); return response(stage); },
  });
  assert.deepEqual(resumedCalls, [S3B]);
  assert.equal(resumed.checkpoint.status, 'VALIDATED');
});

test('truncated output retries only its stage once and never manufactures a missing field', async () => {
  const calls = [];
  const story = await buildStagedStory(brief, { documents,
    invoke: async (_a, prompt, _s, _j, { stage }) => {
      calls.push(stage);
      if (stage === S3C && calls.filter((item) => item === stage).length === 1) return '{"rows":[{"no":1,"text":"Bus belum';
      if (stage === S3C) assert.match(prompt, /VALIDATION_RETRY:.*json_truncated/u);
      return response(stage);
    },
  });
  assert.equal(calls.filter((stage) => stage === S3C).length, 2);
  for (const stage of [S1, S2, S3A, S3B]) assert.equal(calls.filter((item) => item === stage).length, 1);
  assert.equal(story.checkpoint.stages[S3C].receipt.attempts.length, 2);
  assert.equal(story.raw.threads_posts.length, 4);
});

test('fact review repairs only affected article or adapter stages and rechecks once', async () => {
  const calls = [];
  const story = await buildStagedStory(brief, { documents, reviewer: true,
    invoke: async (_a, prompt, _s, _j, { stage }) => {
      calls.push(stage);
      const count = calls.filter((item) => item === stage).length;
      if (stage === S4 && count === 1) return JSON.stringify({ rows: [
        { kind: 'verdict', supported: false },
        { kind: 'issue', channel: 'article', location: 'paragraf akhir', reason: 'Perjelas hubungan petunjuk dan perpindahan.', fact_ids: 'f31' },
        { kind: 'issue', channel: 'caption', location: 'hook', reason: 'Perjelas status pengalihan sementara.', fact_ids: 'f11' },
      ] });
      if ([S2, S3B].includes(stage) && count === 2) assert.match(prompt, /FACT_CHECK_REPAIR:.*ISSUES_JSON:/u);
      return response(stage);
    },
  });
  for (const stage of [S2, S3B, S4]) assert.equal(calls.filter((item) => item === stage).length, 2);
  for (const stage of [S1, S3A, S3C]) assert.equal(calls.filter((item) => item === stage).length, 1);
  assert.equal(story.review.supported, true);
  assert.equal(story.checkpoint.stages[S3B].receipt.attempts[1].repair_source, 'fact_check');
});

test('a located claim-review issue repairs only its article paragraph and preserves valid peers', async () => {
  const bad = structuredClone(article);
  bad.find((row) => row.kind === 'paragraph').text = bad.find((row) => row.kind === 'paragraph').text.replace('perbaikan jalan', 'pembangunan jembatan');
  let articleCalls = 0, reviewCalls = 0;
  const story = await buildStagedStory(brief, { documents, reviewer: true, invoke: async (_a, prompt, _s, _j, { stage }) => {
    if (stage === S2) {
      if (++articleCalls === 1) return JSON.stringify({ rows: bad });
      const targets = JSON.parse(prompt.split('TARGET_ROWS_JSON: ')[1].split('\nENTITIES_JSON: ')[0]);
      assert.deepEqual(targets.map((row) => row.kind), ['paragraph']);
      assert.match(prompt, /FACT_CHECK_REPAIR:/u);
      return JSON.stringify({ rows: [article.find((row) => row.kind === 'paragraph')] });
    }
    if (stage === S4 && ++reviewCalls === 1) return JSON.stringify({ rows: [
      { kind: 'verdict', supported: false },
      { kind: 'issue', channel: 'article', location: 'sections[0].paragraphs[0]', reason: 'Sumber menyebut perbaikan jalan, bukan pembangunan jembatan.', fact_ids: 'f11' },
    ] });
    return response(stage);
  } });
  assert.equal(articleCalls, 2);
  assert.equal(reviewCalls, 2);
  assert.deepEqual(story.checkpoint.stages[S2].value, gate(S2, article).value);
});

test('unsupported review after the single targeted repair fails without cycling peers', async () => {
  const calls = [], snapshots = [];
  await assert.rejects(buildStagedStory(brief, { documents, reviewer: true, saveCheckpoint: async (value) => snapshots.push(value),
    invoke: async (_a, _p, _s, _j, { stage }) => {
      calls.push(stage);
      return stage === S4 ? JSON.stringify({ rows: [{ kind: 'verdict', supported: false },
        { kind: 'issue', channel: 'threads', reason: 'Konteks waktu belum tepat.', fact_ids: 'f12' }] }) : response(stage);
    },
  }), /original_story_claims_need_revision/u);
  assert.equal(calls.filter((stage) => stage === S4).length, 2);
  assert.equal(calls.filter((stage) => stage === S3C).length, 2);
  for (const stage of [S1, S2, S3A, S3B]) assert.equal(calls.filter((item) => item === stage).length, 1);
  assert.equal(snapshots.at(-1).status, 'failed');
});

test('format repair and semantic repair share a single retry budget per stage', async () => {
  const calls = [];
  await assert.rejects(buildStagedStory(brief, { documents, reviewer: true,
    invoke: async (_a, _p, _s, _j, { stage }) => {
      calls.push(stage);
      if (stage === S3B && calls.filter((item) => item === stage).length === 1) {
        return JSON.stringify({ rows: [{ ...caption[0], text: 'panjang '.repeat(30) }, ...caption.slice(1)] });
      }
      return stage === S4 ? JSON.stringify({ rows: [{ kind: 'verdict', supported: false },
        { kind: 'issue', channel: 'caption', reason: 'Premis belum tepat.', fact_ids: 'f11' }] }) : response(stage);
    },
  }), /stage_repair_budget_exhausted/u);
  assert.equal(calls.filter((stage) => stage === S3B).length, 2);
  assert.equal(calls.filter((stage) => stage === S4).length, 1);
});

test('source selection rejects duplicate publishers and keeps evidence boundaries', async () => {
  let calls = 0;
  await assert.rejects(buildStagedStory(brief, { documents: documents.map((doc) => ({ ...doc, url: 'https://one.example.org/story' })),
    invoke: async () => { calls++; },
  }), /source_material_insufficient/u);
  assert.equal(calls, 0);
  const curated = { ...brief, facts: documents.flatMap((doc, index) => passages[index].map((text, no) => ({
    id: `input${index}${no}`, text, source_url: doc.url, source_name: doc.name,
  }))) };
  await assert.rejects(buildStagedStory(curated, { invoke: async (_a, _p, _s, _j, { stage }) => {
    calls++;
    assert.equal(stage, S1);
    const crossed = structuredClone(synthesis);
    crossed[1].text = 'selama pekerjaan perbaikan jalan di sekitar jalur menuju pasar. Pada 10 Oktober 2026, petugas memasang penunjuk arah';
    return JSON.stringify({ rows: crossed });
  } }), /evidence_excerpt_not_verbatim/u);
  assert.equal(calls, 2);
});

test('resuming a checkpoint reuses a stage that succeeded within the four-request Gemini budget', async () => {
  const snapshots = [];
  let s1Calls = 0;
  await assert.rejects(buildStagedStory(brief, {
    documents,
    saveCheckpoint: async (value) => snapshots.push(value),
    invoke: async (_a, _p, _s, _j, options) => {
      if (options.stage === S1) {
        s1Calls += 1;
        options.onAttempt?.({ provider: 'gemini', status: 503, outcome: 'transient_error' });
        options.onAttempt?.({ provider: 'gemini', status: 429, outcome: 'rate_limited' });
        options.onAttempt?.({ provider: 'gemini', status: 200, outcome: 'success' });
        return response(S1);
      }
      if (options.stage === S2) throw new Error('stop_after_s1');
      return response(options.stage);
    },
  }), /stop_after_s1/u);
  assert.equal(s1Calls, 1);
  const failed = snapshots.at(-1);
  assert.equal(failed.stages[S1].receipt.attempts[0].provider_attempts.length, 3);
  const resumedCalls = [];
  const resumed = await buildStagedStory(brief, {
    documents,
    checkpoint: failed,
    invoke: async (_a, _p, _s, _j, { stage }) => {
      resumedCalls.push(stage);
      return response(stage);
    },
  });
  assert.equal(resumedCalls.includes(S1), false);
  assert.deepEqual(resumedCalls, [S2, S3A, S3B, S3C]);
  assert.equal(resumed.checkpoint.status, 'VALIDATED');
});

test('caption preparation strips extraneous fields from hashtag rows before gate validation', async () => {
  const story = await buildStagedStory(brief, {
    documents,
    invoke: async (_a, _p, _s, _j, { stage }) => {
      if (stage !== S3B) return response(stage);
      const polluted = caption.map((row) => row.kind === 'hashtag' ? { ...row, fact_ids: 'f11' } : row);
      return JSON.stringify({ rows: polluted });
    },
  });
  assert.equal(story.checkpoint.stages[S3B].receipt.status, 'complete');
  assert.ok(story.raw.hashtags.length >= 5);
});

test('a rate-limited transport failure waits out the minute window before retrying', async () => {
  const waits = [];
  let articleCalls = 0;
  const story = await buildStagedStory(brief, {
    documents,
    sleep: async (ms) => { waits.push(ms); },
    rateLimitWaitMs: 45000,
    invoke: async (_a, _p, _s, _j, options) => {
      if (options.stage !== S2) return response(options.stage);
      articleCalls += 1;
      if (articleCalls === 1) {
        const error = new Error('Gemini API (429, RESOURCE_EXHAUSTED): quota');
        error.rateLimited = true;
        throw error;
      }
      return JSON.stringify({ rows: article });
    },
  });
  assert.equal(articleCalls, 2);
  assert.deepEqual(waits, [45000]);
  assert.equal(story.checkpoint.stages[S2].receipt.status, 'complete');
});

test('a non-rate-limited transport failure retries without sleeping', async () => {
  const waits = [];
  let articleCalls = 0;
  await buildStagedStory(brief, {
    documents,
    sleep: async (ms) => { waits.push(ms); },
    invoke: async (_a, _p, _s, _j, options) => {
      if (options.stage !== S2) return response(options.stage);
      articleCalls += 1;
      if (articleCalls === 1) throw new Error('Gemini API (503, UNAVAILABLE).');
      return JSON.stringify({ rows: article });
    },
  });
  assert.equal(articleCalls, 2);
  assert.deepEqual(waits, []);
});

test('a daily quota exhaustion transport failure fails fast without sleeping or retrying', async () => {
  const waits = [];
  let articleCalls = 0;
  await assert.rejects(buildStagedStory(brief, {
    documents,
    sleep: async (ms) => { waits.push(ms); },
    invoke: async (_a, _p, _s, _j, options) => {
      if (options.stage !== S2) return response(options.stage);
      articleCalls += 1;
      const error = new Error('Gemini API (429, RESOURCE_EXHAUSTED): PerDay limit exceeded');
      error.rateLimited = true;
      error.dailyQuotaExhausted = true;
      throw error;
    },
  }), /stage2_article: Gemini API \(429/u);
  assert.equal(articleCalls, 1);
  assert.deepEqual(waits, []);
});

test('stage gate matches validator parity for non-asserted qualifiers (including sementara) and unreferenced Menurut attributions', () => {
  const qFacts = [{ id: 'f1', text: 'Pasokan air sementara dialihkan ke jalur timur.', source_name: 'PDAM Kota' }];
  const qRows = [
    { kind: 'hook', text: 'Pasokan air dialihkan ke jalur timur.', fact_ids: 'f1' },
    { kind: 'paragraph', text: 'Warga di kawasan timur menerima pasokan air melalui jaringan pengalihan pipa utama.', fact_ids: 'f1' },
    { kind: 'paragraph', text: 'Petugas menjaga tekanan aliran air agar kebutuhan harian warga sekitar tetap terpenuhi.', fact_ids: 'f1' },
    { kind: 'question', text: 'Apakah pengalihan jaringan ini sudah menjangkau wilayah Anda?' },
    ...['#GapuraMedia', '#AirBersih', '#LayananPublik', '#Kota', '#Info'].map((text) => ({ kind: 'hashtag', text })),
  ];
  assert.equal(gate(S3B, qRows, { facts: qFacts, entities: [] }).error, 'caption_hook_qualifier_missing');

  const attrFacts = [{ id: 'f1', text: 'Pekerjaan rampung pada November 2026.', source_name: 'news.detik.com' }];
  const attrRows = [
    { kind: 'hook', text: 'Pekerjaan infrastruktur memasuki tahap akhir pada November 2026.', fact_ids: 'f1' },
    { kind: 'paragraph', text: 'Menurut Keterangan pengawas lapangan, pekerjaan fisik ditargetkan selesai pada November 2026.', fact_ids: 'f1' },
    { kind: 'paragraph', text: 'Warga di sekitar lokasi menantikan kelancaran akses setelah pekerjaan perbaikan selesai dilakukan.', fact_ids: 'f1' },
    { kind: 'question', text: 'Apa dampak proyek ini bagi aktivitas warga sekitar?' },
    ...['#GapuraMedia', '#Infrastruktur', '#Publik', '#Pembangunan', '#Info'].map((text) => ({ kind: 'hashtag', text })),
  ];
  assert.equal(gate(S3B, attrRows, { facts: attrFacts, entities: [] }).error, 'caption_paragraph_source_unreferenced');
});

test('local first-mention repair expands unexpanded person mentions in carousel and caption from sourced registry without extra LLM calls', async () => {
  const bareCarousel = structuredClone(carousel);
  bareCarousel.find((row) => row.kind === 'paragraph').text = 'Dewi Aruna memaparkan jalur pengganti bus di sekitar Pasar Utara untuk masa pemeliharaan, sehingga penumpang dapat menyesuaikan rencana perjalanan sebelum berangkat.';
  const bareCaption = structuredClone(caption);
  bareCaption[1].text = 'Selama perbaikan jalan, Dewi Aruna memaparkan jalur menuju pasar berpindah sementara. Pengelola menyediakan pemberhentian lain di sekitar kawasan agar penumpang tetap dapat melanjutkan perjalanan.';

  let calls = { [S3A]: 0, [S3B]: 0 };
  const story = await buildStagedStory(brief, {
    documents,
    invoke: async (_a, _p, _s, _j, { stage }) => {
      if (stage === S3A) { calls[S3A] += 1; return JSON.stringify({ rows: bareCarousel }); }
      if (stage === S3B) { calls[S3B] += 1; return JSON.stringify({ rows: bareCaption }); }
      return response(stage);
    },
  });
  assert.equal(calls[S3A], 1);
  assert.equal(calls[S3B], 1);
  assert.equal(story.checkpoint.stages[S3A].receipt.attempts[0].repair_source, 'local_first_mention');
  assert.equal(story.checkpoint.stages[S3B].receipt.attempts[0].repair_source, 'local_first_mention');
  assert.match(story.raw.caption_blocks[1].text, /Kepala Bidang Angkutan Kota Pesisir Dewi Aruna/u);
});
