import test from 'node:test';
import assert from 'node:assert/strict';
import { researchTopic } from '../research.js';
import { loadService } from '../../scout/test/service-harness.js';

const topic = { title: 'Perubahan rute angkutan', summary: 'Rute bus dialihkan selama perbaikan jembatan.', url: 'https://bsky.app/search?q=rute', primary_source: 'Bluesky' };
const sources = [
  { url: 'https://www.antaranews.com/rute', name: 'ANTARA', title: 'Rute berubah', kind: 'news', text: [
    'Rute pengganti melayani Terminal Pusat hingga kawasan sekolah mulai Senin pagi.',
    'Pengalihan dilakukan ketika jembatan lama diperbaiki oleh petugas kota.',
    'Operator menyediakan bus tambahan pada jam masuk dan pulang sekolah.',
    'Warga dapat melihat peta layanan baru di halte dan laman dinas perhubungan.',
  ].join(' ') },
  { url: 'https://www.kompas.com/rute', name: 'Kompas', title: 'Pengalaman penumpang', kind: 'news', text: [
    'Perubahan rute membuat penumpang berpindah kendaraan di Terminal Pusat.',
    'Pengalihan rute mengharuskan sebagian warga menempuh perjalanan lebih lama.',
  ].join(' ') },
  { url: 'https://www.tempo.co/rute', name: 'Tempo', title: 'Lintasan pengganti', kind: 'web', text: 'Dinas Perhubungan mengumumkan rute pengganti menuju kawasan sekolah melalui Terminal Pusat. Peta rute angkutan dipasang pada halte dan kantor layanan untuk membantu penumpang.' },
];
const reader = { async read({ url }) { return { canonical_url: url, title: '', body: '', extraction: { status: 'unavailable' } }; } };

test('research verifies selected facts verbatim, drops fabricated passages and deduplicates search URLs', async () => {
  let request;
  const input = await researchTopic(topic, {
    search: async (query, options) => { request = { query, options }; return sources; },
    reader,
    choose: async (documents, candidates) => {
      assert.equal(documents.length, sources.length, 'repeated search hits from one URL are merged');
      const chosen = candidates.filter((item) => item.source_id === documents[0].source_id).slice(0, 2);
      return [...chosen.map(({ passage_id }) => passage_id), { source_id: documents[1].source_id, passage: 'Angka jumlah penumpang adalah 88 ribu per hari.' }];
    },
  });
  assert.match(request.query, /Perubahan rute angkutan/iu);
  assert.equal(request.options.queries.length, 2, 'discovery expands to two focused search queries');
  assert.match(request.options.queries[0], /kronologi|pernyataan resmi/iu);
  assert.match(request.options.queries[1], /pihak terkait|angka|dampak/iu);
  assert.equal(request.options.firecrawlLimit, 4);
  assert.ok(input.facts.length >= 3);
  assert.ok(input.facts.some(({ text }) => text.includes('Rute pengganti melayani')));
  assert.ok(input.facts.some(({ text }) => text.includes('Pengalihan dilakukan')));
  assert.ok(input.facts.some(({ source_url }) => source_url === sources[1].url), 'verbatim fallback adds a third fact from a different source');
  assert.equal(input.facts.some(({ text }) => /88 ribu/iu.test(text)), false);
});

test('default research rejects a single publisher even if the article contains three facts', async () => {
  const article = { url: 'https://news.example/full-report', name: 'Media A', kind: 'news', text: sources[0].text };
  await assert.rejects(researchTopic(topic, { search: async () => [article], reader, choose: async () => [] }), /penerbit berbeda/);
  const input = await researchTopic(topic, {
    minimumPublishers: 1,
    search: async () => [article], reader,
    choose: async (_documents, candidates) => [candidates[0].passage_id],
  });
  assert.equal(new Set(input.facts.map(({ source_url }) => source_url)).size, 1, 'source count is not confused with fact count');
  assert.ok(input.facts.length >= 3);
  assert.ok(input.facts.every(({ text }) => article.text.includes(text)));
});

test('duplicate and overlapping source sentences never count as three separate facts', async () => {
  const repeated = { url: 'https://news.example/repeated', name: 'Media A', kind: 'news', text:
    'Kota membuka layanan bus pada Senin pagi untuk warga. Kota membuka layanan bus pada Senin pagi untuk warga. Kota membuka layanan bus pada Senin pagi untuk warga.' };
  await assert.rejects(researchTopic(topic, { search: async () => [repeated], reader, choose: async () => [] }), /source_material_insufficient/);
});

test('unrelated stories that only share a broad institution keyword are excluded', async () => {
  const kurTopic = { title: 'OJK Sumbar larang agunan KUR mikro', summary: 'OJK Sumatera Barat menjelaskan agunan kredit usaha rakyat.', url: 'https://news.example/kur', primary_source: 'Laporan ekonomi' };
  const report = { url: kurTopic.url, name: 'Laporan ekonomi', kind: 'news', text: [
    'OJK Sumatera Barat melarang agunan dalam penyaluran KUR mikro kepada nasabah.',
    'KUR mikro tanpa agunan berlaku untuk plafon paling tinggi Rp100 juta sesuai ketentuan.',
    'Pengaduan agunan KUR dapat disampaikan ke kantor OJK Sumbar ketika nasabah mengalami kendala.',
  ].join(' ') };
  const hits = [
    { url: 'https://news.example/cyber', name: 'Media Siber', kind: 'news', text: 'Otoritas Jasa Keuangan meminta bank meningkatkan pengawasan atas serangan siber terhadap nasabah mereka. Nasabah juga diminta melapor ketika mengalami gangguan layanan digital.' },
    report,
  ];
  const input = await researchTopic(kurTopic, { minimumPublishers: 1, search: async () => hits, reader, choose: async () => [] });
  assert.ok(input.facts.length >= 3);
  assert.equal(input.facts.some(({ source_url }) => source_url === hits[0].url), false);
});

test('curated duplicate facts do not inflate the independent evidence count', async () => {
  const duplicate = { id: 'seed1', text: sources[0].text.split(' ').slice(0, 10).join(' '), source_url: sources[0].url, source_name: 'Media A' };
  await assert.rejects(researchTopic(topic, { search: async () => [], reader, seedFacts: [duplicate, { ...duplicate, id: 'seed2' }] }), /source_material_insufficient/);
});

test('search snippets and search result pages cannot stand in for retrieved source bodies', async () => {
  const snippet = { ...sources[0], url: 'https://news.example/unreadable', text_kind: 'snippet' };
  const searchPage = { ...sources[0], url: 'https://www.google.com/search?q=rute' };
  await assert.rejects(researchTopic(topic, {
    search: async () => [snippet, searchPage], reader, choose: async () => [],
  }), /source_material_insufficient/);
  const input = await researchTopic(topic, {
    minimumPublishers: 1,
    search: async () => [snippet],
    reader: { async read({ url }) { return { canonical_url: url, title: 'Rute berubah', body: sources[0].text }; } },
    choose: async () => [],
  });
  assert.ok(input.facts.length >= 3);
  assert.ok(input.facts.every(({ text }) => sources[0].text.includes(text)));
});

test('source reports with different quantities and negations remain separate evidence', async () => {
  const report = { ...sources[0], text: [
    'Operator rute bus menambah 10 kendaraan untuk melayani kawasan sekolah selama renovasi jembatan.',
    'Operator rute bus menambah 20 kendaraan untuk melayani kawasan sekolah selama renovasi jembatan.',
    'Operator rute bus belum menambah 20 kendaraan untuk melayani kawasan sekolah selama renovasi jembatan.',
  ].join(' ') };
  const input = await researchTopic(topic, { minimumPublishers: 1, search: async () => [report], reader, choose: async () => [] });
  assert.equal(input.facts.length, 3);
  assert.ok(input.facts.some(({ text }) => text.includes('10 kendaraan')));
  assert.ok(input.facts.some(({ text }) => text.includes('belum menambah 20')));
});

test('default selection sends the research topic and an isolated ID-only contract, then falls back verbatim', async () => {
  let calls = 0;
  const { researchTopic: actualResearch } = await loadService('copywriter/research.js', {
    llm: async (agent, prompt, policy, jsonMode, options) => {
      calls++;
      assert.equal(agent, 'copywriter');
      assert.equal(options.includeAgentPolicy, false);
      assert.equal(options.skills, '');
      assert.equal(jsonMode, true);
      assert.match(prompt, /TOPIK_RISET_JSON:.*Perubahan rute angkutan/u);
      assert.match(policy, /passage_ids/u);
      const candidates = JSON.parse(prompt.split('KANDIDAT_PETIKAN_JSON: ')[1]);
      return JSON.stringify({ passage_ids: [candidates[0].passage_id, 'invented-id'] });
    },
  });
  const input = await actualResearch(topic, { search: async () => sources, reader });
  assert.equal(calls, 1);
  assert.ok(input.facts.length >= 3);
  assert.ok(input.facts.every(({ text, source_url }) => sources.some((source) => source.url === source_url && source.text.includes(text))));
});

test('snippet leads promoted by article-reader pass the three-publisher source quality gate as pages', async () => {
  const snippetHits = sources.map((source) => ({
    url: source.url, name: source.name, title: source.title, kind: source.kind, text: '', text_kind: 'snippet',
  }));
  let selectedDocs = [];
  const input = await researchTopic(topic, {
    minimumPublishers: 3,
    search: async () => snippetHits,
    reader: {
      async read({ url }) {
        const match = sources.find((source) => source.url === url);
        return { canonical_url: url, title: match.title, publisher: match.name, body: match.text };
      },
    },
    choose: async () => [],
    onDocuments: (docs) => { selectedDocs = docs; },
  });
  assert.equal(selectedDocs.length, 3);
  assert.equal(selectedDocs.every((doc) => doc.text_kind === 'page'), true);
  assert.ok(input.facts.length >= 3);
});
