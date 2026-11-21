import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { buildStagedStory, EDITORIAL_STAGE_SCHEMAS, parseEditorialJson } from '../storytelling.js';
import { article } from './storytelling-staged-fixtures.js';

const [S1, S2, S3A, S3B, S3C, S4] = Object.keys(EDITORIAL_STAGE_SCHEMAS);
const passages = [
  [
    'Dinas Perhubungan memindahkan layanan bus di koridor Pasar Utara selama pekerjaan perbaikan jalan di sekitar jalur menuju pasar.',
    'Pada 10 Oktober 2026, petugas memasang penunjuk arah di jalur pengganti dekat pintu timur pasar.',
    'Kepala Bidang Angkutan Kota Pesisir Dewi Aruna memaparkan jalur pengganti bus di sekitar Pasar Utara untuk masa pemeliharaan.',
  ],
  [
    'Pada 12 Oktober 2026, pengelola menyediakan 3 titik pemberhentian sementara di sekitar pasar agar penumpang tetap dapat berpindah.',
  ],
  [
    'Pos informasi di pintu pasar membantu penumpang mencari jalur pengganti dan membaca petunjuk perpindahan menuju koridor lain.',
  ],
];
const documents = [
  { url: 'https://angkutan.example.org/pasar', name: 'Dishub Pesisir', title: 'Pengalihan bus', text: `${passages[0].join('\n')}\nBaca juga: pemberitahuan.\n${'lampiran '.repeat(1600)}Batas rahasia lampiran.` },
  { url: 'https://kota.example.net/pasar', name: 'Warta Kota', title: 'Jalur sementara', text: passages[1].join('\n') },
  { url: 'https://pesisir.example.com/pasar', name: 'Kabar Pesisir', title: 'Informasi untuk penumpang', text: passages[2].join('\n') },
];
const brief = { version: 1, mode: 'current', discovery: { normalized_title: 'Rute bus Pasar Utara dialihkan' }, directions: {}, facts: [], slide_count: 8 };
const synthesis = [
  { kind: 'summary', title: 'Bus Pasar Utara berpindah jalur', angle: 'Mencari jalur pengganti selama perbaikan', scope_note: 'Periode selesai pekerjaan tidak disebutkan dalam bahan.' },
  ...passages.flatMap((parts, source) => parts.map((text, index) => ({ kind: 'evidence', source_id: `d${source + 1}`, fact_id: `f${source + 1}${index + 1}`, text }))),
  { kind: 'timeline', date: '10 Oktober 2026', text: 'Petugas memasang penunjuk arah dekat pintu timur.', fact_ids: 'f12' },
  { kind: 'timeline', date: '12 Oktober 2026', text: 'Pengelola menyediakan titik pemberhentian sementara.', fact_ids: 'f21' },
  { kind: 'number', value: '3', text: 'Jumlah titik pemberhentian sementara di sekitar pasar.', fact_ids: 'f21' },
  { kind: 'person', name: 'Dewi Aruna', expansion: 'Kepala Bidang Angkutan Kota Pesisir', short: 'Kepala Bidang Angkutan', fact_ids: 'f13' },
];
const slide = (no, role, layout, title, kicker, text, fact_ids, extra = {}) => ({
  kind: 'slide', no, role, layout: `editorial-${layout}`, title, kicker, text, fact_ids,
  purpose: `Menguraikan ${title.toLowerCase()}`, visual_query: `ilustrasi bus ${kicker.toLowerCase()}`, ...extra,
});
const carousel = [
  slide(1, 'cover', 'cover', 'Bus Pasar Utara Berpindah Jalur Sementara Selama Pekerjaan Perbaikan Jalan', 'Pengalihan Bus', '', ''),
  slide(2, 'lead', 'lead', 'Koridor Pasar Berubah', 'Pekerjaan Jalan',
    'Dinas Perhubungan memindahkan layanan bus di koridor Pasar Utara selama pekerjaan perbaikan jalan. Penumpang dapat memakai 3 titik pemberhentian sementara yang disediakan pengelola, dengan penunjuk arah yang dipasang pada 10 Oktober 2026 dekat pintu timur pasar dan pos informasi untuk mencari jalur pengganti.',
    'f11,f12,f21,f31,f13'),
  { kind: 'paragraph', no: 2, text: 'Kepala Bidang Angkutan Kota Pesisir Dewi Aruna memaparkan jalur pengganti bus di sekitar Pasar Utara untuk masa pemeliharaan, sehingga penumpang dapat menyesuaikan rencana perjalanan sebelum berangkat.', fact_ids: 'f13' },
  { kind: 'paragraph', no: 2, text: 'Pada 12 Oktober 2026, pengelola menyiapkan 3 titik pemberhentian sementara di sekitar pasar, sementara pos informasi di pintu pasar membantu penumpang membaca petunjuk perpindahan menuju koridor lain.', fact_ids: 'f21,f31' },
  { kind: 'paragraph', no: 2, text: 'Petugas memasang penunjuk arah di jalur pengganti dekat pintu timur pasar pada 10 Oktober 2026, sehingga arah perpindahan dapat dibaca sejak awal.', fact_ids: 'f12' },
  slide(3, 'close', 'close', 'Bagikan Pendapat Anda', 'Ajak Berdiskusi', 'Ikuti kami dan bagikan tulisan ini ke teman Anda. Kirim kritik dan saran melalui kolom komentar.', '', { question: 'Pengalaman apa yang Anda rasakan saat jalur bus berubah?' }),
];
const caption = [
  { kind: 'hook', text: 'Bus belum bisa berhenti di koridor yang biasa dipakai penumpang Pasar Utara.', fact_ids: 'f11' },
  { kind: 'paragraph', text: 'Selama perbaikan jalan, jalur menuju pasar berpindah sementara. Pengelola menyediakan pemberhentian lain di sekitar kawasan agar penumpang dapat melanjutkan perjalanan tanpa kembali ke jalur semula.', fact_ids: 'f11,f21' },
  { kind: 'paragraph', text: 'Dari pintu pasar, pos informasi memudahkan orang memilih lintasan yang sesuai dengan tujuan mereka, termasuk petunjuk untuk berpindah ke koridor lain.', fact_ids: 'f31' },
  { kind: 'question', text: 'Petunjuk apa yang paling Anda butuhkan ketika jalur bus berubah?' },
  ...['GapuraMedia', '#PasarUtara', '#Transportasi', '#BusKota', '#JalurSementara'].map((text) => ({ kind: 'hashtag', text })),
];
const threads = [
  { no: 1, text: 'Perbaikan jalan mengalihkan layanan bus di sekitar Pasar Utara untuk sementara. Penunjuk arah dipasang pada 2026-10-10.', fact_ids: 'f11,f12' },
  { no: 2, text: 'Kepala Bidang Angkutan Dewi Aruna memaparkan lintasan yang dipakai selama pemeliharaan.', fact_ids: 'f13' },
  { no: 3, text: 'Penumpang bisa mencari pemberhentian di sekitar pasar atau membaca petunjuk dari pintu masuk.', fact_ids: 'f21,f31' },
  { no: 4, text: 'Petunjuk arah membantu memilih koridor berikutnya. Apa yang biasanya Anda cari saat pemberhentian dipindah?', fact_ids: 'f31' },
];
const stageOutput = { [S1]: synthesis, [S2]: article, [S3A]: carousel, [S3B]: caption, [S3C]: threads, [S4]: [{ kind: 'verdict', supported: true }] };
const json = (stage) => JSON.stringify(stageOutput[stage]);

test('editorial parser extracts one root and only repairs syntax without changing literal content', async () => {
  assert.deepEqual(await parseEditorialJson('Output:\n```json\n[{"text":"Bus [pasar]"}]\n```'), [{ text: 'Bus [pasar]' }]);
  assert.deepEqual(await parseEditorialJson(String.raw`[{text:'Bus pasar', "count":3,}]`), [{ text: 'Bus pasar', count: 3 }]);
  assert.deepEqual(await parseEditorialJson('[{"text":"belum berlaku" "count":3}]'), [{ text: 'belum berlaku', count: 3 }]);
  for (const [broken, expected] of [
    ['[{"text":}]', /not_syntax_only/u],
    ['[{"text":"tidak"}', /truncated/u],
    ['[{"text":"belum","text":"berlaku"}]', /duplicate/u],
    ['[{"text":"belum"}] [{"text":"berlaku"}]', /multiple/u],
  ]) await assert.rejects(parseEditorialJson(broken), expected);
});

test('the staged DAG hands off exact evidence and checkpoints independent adapter results', async () => {
  const snapshots = [], calls = [], attempts = [];
  let inFlight = 0;
  let adapterStarts = 0;
  let release;
  const allStarted = new Promise((resolve) => { release = resolve; });
  const invoke = async (agent, prompt, _policy, mode, options) => {
    const { stage, responseSchema } = options;
    assert.equal(agent, 'copywriter');
    assert.equal(mode, true);
    assert.equal(options.includeAgentPolicy, false);
    assert.equal(responseSchema.type, 'object');
    assert.deepEqual(responseSchema.required, ['rows']);
    assert.ok(Object.values(responseSchema.properties.rows.items.properties).every((field) => ['integer', 'string', 'boolean'].includes(field.type) && !field.items));
    calls.push(stage);
    options.onAttempt({ provider: 'fixture', model: 'local', outcome: 'success', secret: 'do-not-store' });
    options.onMetadata({ provider: 'fixture', model: 'local', fallback: false, usage: { total_tokens: 25 } });
    if (stage === S1) {
      const input = JSON.parse(prompt.split('PAYLOAD_JSON: ').at(-1));
      assert.equal(input.documents.length, 3);
      assert.equal(input.documents[0].passages.flatMap((text) => text.split(' ')).length, 1500);
      assert.doesNotMatch(prompt, /https?:\/\/|Baca juga:|Batas rahasia/u);
    } else if (stage === S2) {
      assert.match(prompt, /f13/u);
      assert.doesNotMatch(prompt, /lampiran lampiran|https:\/\//u);
    } else if (stage !== S4) {
      assert.deepEqual(Object.keys(JSON.parse(prompt.split('PAYLOAD_JSON: ').at(-1)).article), ['headline', 'lead', 'takeaways']);
      if (++adapterStarts === 3) release();
      await allStarted;
    }
    return json(stage);
  };
  const story = await buildStagedStory(brief, { documents: [
    { ...documents[0], url: 'https://forum.invalid/entry', name: 'Forum Rute', kind: 'forum' }, ...documents,
    { ...documents[0], url: 'https://mirror.example.org/berita', name: 'Cabang Dishub' },
  ], invoke, reviewer: true, onAttempt: (value) => attempts.push(value), saveCheckpoint: async (snapshot) => {
    assert.equal(++inFlight, 1);
    await setImmediate();
    snapshots.push(snapshot);
    inFlight--;
  } });
  assert.deepEqual(calls, [S1, S2, S3A, S3B, S3C, S4]);
  assert.equal(attempts.length, 6);
  assert.ok(attempts.every((attempt) => !('secret' in attempt)));
  assert.equal(story.brief.slide_count, 3);
  assert.equal(story.brief.facts[0].text, passages[0][0]);
  assert.equal(story.brief.facts[0].source_url, documents[0].url);
  assert.equal(story.raw.slides[0].teks, '');
  assert.match(story.raw.slides[0].visual_query, /ilustrasi/u);
  assert.deepEqual(story.raw.slides[1].data.paragraphs[0].fact_ids, ['f13']);
  assert.equal(story.raw.slides[1].data.paragraphs.length, 3);
  assert.deepEqual(story.raw.article_metadata.fact_ids, ['f11', 'f21', 'f31']);
  assert.deepEqual(story.raw.threads_posts[2].fact_ids, ['f21', 'f31']);
  assert.deepEqual(story.raw.hashtags, ['#gapuramedia', '#pasarutara', '#transportasi', '#buskota', '#jalursementara']);
  assert.equal(story.review.publication_approved, false);
  assert.deepEqual(snapshots.map((value) => Object.keys(value.stages).length), [1, 2, 3, 4, 5, 6, 6]);
  assert.equal(story.checkpoint.stages[S2].receipt.usage.total_tokens, 25);
  assert.equal(story.checkpoint.status, 'VALIDATED');
});

test('validation retries one adapter only, saves successful peers, and resumes only the failure', async () => {
  const calls = [], snapshots = [];
  await assert.rejects(buildStagedStory(brief, { documents, saveCheckpoint: async (value) => snapshots.push(value),
    invoke: async (_agent, prompt, _policy, _mode, { stage }) => {
      calls.push(stage);
      if (stage === S3B) {
        if (calls.filter((item) => item === S3B).length === 2) assert.match(prompt, /VALIDATION_RETRY:.*caption_hook_length/u);
        return JSON.stringify([{ ...caption[0], text: 'panjang '.repeat(24) }, ...caption.slice(1)]);
      }
      if ([S3A, S3C].includes(stage)) await setImmediate();
      return json(stage);
    },
  }), /stage3b_caption: caption_hook_length/u);
  assert.equal(calls.filter((stage) => stage === S3B).length, 2);
  for (const stage of [S1, S2, S3A, S3C]) assert.equal(calls.filter((item) => item === stage).length, 1);
  const failed = snapshots.at(-1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stages[S3B].value, null);
  for (const stage of [S1, S2, S3A, S3C]) assert.equal(failed.stages[stage].receipt.status, 'complete');
  const resumedCalls = [];
  const resumed = await buildStagedStory(brief, { documents, checkpoint: failed, invoke: async (_agent, _prompt, _policy, _mode, { stage }) => {
    resumedCalls.push(stage);
    return json(stage);
  } });
  assert.deepEqual(resumedCalls, [S3B]);
  assert.equal(resumed.checkpoint.status, 'VALIDATED');
});

test('curated fallback respects excerpt boundaries, source diversity and untrusted evidence', async () => {
  const curated = { ...brief, facts: documents.flatMap((doc, source) => passages[source].map((text, id) => ({
    id: `input${source}${id}`, text, source_url: doc.url, source_name: doc.name,
  }))) };
  let invoked = 0;
  await assert.rejects(buildStagedStory({ ...curated, facts: curated.facts.map((fact) => ({ ...fact, source_url: 'https://one.example.org/stories' })) }, {
    invoke: async () => { invoked++; },
  }), /source_material_insufficient/u);
  assert.equal(invoked, 0);
  await assert.rejects(buildStagedStory(curated, { invoke: async (_agent, _prompt, _policy, _mode, { stage }) => {
    invoked++;
    assert.equal(stage, S1);
    const fake = structuredClone(synthesis);
    fake[1].text = 'selama pekerjaan perbaikan jalan di sekitar jalur menuju pasar. Pada 10 Oktober 2026, petugas memasang penunjuk arah';
    return JSON.stringify(fake);
  } }), /evidence_excerpt_not_verbatim/u);
  assert.equal(invoked, 2);
});

test('a stage can repair format, but the gate still rejects unsupported numbers in a post', async () => {
  const snapshots = [];
  await assert.rejects(buildStagedStory(brief, { documents, saveCheckpoint: async (value) => snapshots.push(value),
    invoke: async (_agent, _prompt, _policy, _mode, { stage }) => {
      if (stage !== S3C) return json(stage);
      const output = structuredClone(threads);
      output[0].text = 'Perbaikan jalan membuat 80 bus pindah jalur.';
      return `${JSON.stringify(output).slice(0, -1)},]`;
    },
  }), /threads_post_1_number_unreferenced/u);
  assert.equal(snapshots.at(-1).stages[S3C].receipt.attempts.every((row) => row.repaired), true);
});
