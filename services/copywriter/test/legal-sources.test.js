import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { needsLegalContext, lookupLegalSources } from '../legal-sources.js';

const baseUrl = 'http://127.0.0.1:18080';
const caseNumber = '90/PUU-XXI/2023';
const caseTopic = { desk: 'politik', title: `Putusan MK ${caseNumber} tentang syarat pencalonan`, summary: 'Catatan redaksi privat.' };
const decisionUrl = 'https://s.mkri.id/public/content/persidangan/putusan/90-PUU-XXI-2023.pdf';
const decision = {
  lembaga: 'MK', nomor_perkara: caseNumber, judul: `Putusan ${caseNumber}`,
  sumber_url: `${decisionUrl}?utm_source=index#amar`,
  amar_putusan: 'Mengabulkan permohonan Pemohon untuk sebagian.\nMenolak permohonan Pemohon untuk selain dan selebihnya.',
};
const regulationUrl = 'https://peraturan.go.id/id/uu-no-27-tahun-2022';
const regulation = {
  jenis: 'Undang-Undang', nomor: '27', tahun: 2022, judul: 'Pelindungan Data Pribadi', sumber_url: regulationUrl,
};
const data = (items) => Response.json({ items });

test('recognizes the law desk and central legal references in other desks', () => {
  for (const topic of [
    { desk: 'hukum', title: 'Perkembangan pemeriksaan saksi' },
    { category: 'peradilan', title: 'Perkembangan pemeriksaan saksi' },
    { desk: 'ekonomi', title: 'PP No.36 Tahun 2021 tentang Pengupahan' },
    { desk: 'bursa', title: 'OJK terbitkan aturan baru kepemilikan saham' },
    { desk: 'lingkungan', title: 'Putusan 36 K/TUN/2024 dan izin pertambangan' },
    caseTopic,
  ]) assert.equal(needsLegalContext(topic), true, topic.title);
  assert.equal(needsLegalContext({ desk: 'bursa', title: 'IHSG menguat pada pembukaan', summary: 'Regulasi pernah disinggung tahun lalu.' }), false);
  assert.equal(needsLegalContext({ desk: 'politik', title: 'PP Muhammadiyah gelar rapat pengurus' }), false);
  assert.equal(needsLegalContext(null), false);
});

test('looks up the case identifier using only a bounded GET and cites the stored amar', async () => {
  const requests = [];
  const result = await lookupLegalSources(caseTopic, {
    baseUrl,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return data([
        { ...decision, nomor_perkara: '91/PUU-XXI/2023', sumber_url: 'https://www.mkri.id/putusan/lain', amar_putusan: `Mempertimbangkan Putusan ${caseNumber}.` },
        decision,
      ]);
    },
  });
  assert.equal(requests.length, 1);
  const [{ url, options }] = requests;
  assert.equal(url.origin, baseUrl);
  assert.equal(url.pathname, '/api/data/decisions');
  assert.deepEqual(Object.fromEntries(url.searchParams), { q: caseNumber, page: '1', limit: '5' });
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.deepEqual(options.headers, { Accept: 'application/json' });
  assert.equal(options.body, undefined);
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(result, { status: 'ok', leads: [], documents: [{
    url: decisionUrl, title: decision.judul, name: 'Mahkamah Konstitusi RI',
    text: decision.amar_putusan.replace('\n', ' '), kind: 'legal', text_kind: 'page',
  }] });
});

test('an unavailable regulation archive still permits decision evidence for a mixed headline', async () => {
  const paths = [];
  const result = await lookupLegalSources({ ...caseTopic, title: `Putusan MK ${caseNumber} tentang UU Nomor 7 Tahun 2017` }, {
    baseUrl, fetchImpl: async (url) => {
      paths.push(url.pathname);
      return url.pathname === '/api/data/decisions' ? data([decision]) : new Response(null, { status: 503 });
    },
  });
  assert.deepEqual(paths.sort(), ['/api/data/decisions', '/api/data/regulations']);
  assert.equal(result.status, 'ok');
  assert.equal(result.documents[0].url, decisionUrl);
});

test('uses statute type, number and year to match leads and keeps index metadata out of evidence', async () => {
  const sourceUrl = 'https://peraturan.go.id/id/pp-no-36-tahun-2021';
  const row = {
    jenis: 'Peraturan Pemerintah (PP)', nomor: 36, tahun: '2021', judul: 'Pengupahan', sumber_url: sourceUrl,
    status: 'Berlaku', total_pasal: 44, text: 'Unverified text assigned to the index entry.', pdf_path: '/pdf_downloads/pp36.pdf',
  };
  const requests = [];
  const result = await lookupLegalSources({ desk: 'ekonomi', title: 'PP No.36 Tahun 2021 tentang Pengupahan' }, {
    baseUrl, fetchImpl: async (url) => {
      requests.push(url);
      return data([
        { ...row, jenis: 'Perpres', sumber_url: 'https://peraturan.go.id/id/perpres-no-36-tahun-2021' },
        { ...row, tahun: 2024, sumber_url: 'https://peraturan.go.id/id/pp-no-36-tahun-2024' },
        row,
      ]);
    },
  });
  assert.deepEqual(requests.map((url) => url.searchParams.get('q')), ['36 Tahun 2021', 'pengupahan']);
  assert.ok(requests.every((url) => url.pathname === '/api/data/regulations'));
  assert.deepEqual(result, { status: 'metadata_only', documents: [], leads: [{ url: sourceUrl, name: 'Peraturan.go.id', title: row.judul }] });
});

test('blank amar remains a lead and source links are restricted to credential-free official HTTPS', async () => {
  const result = await lookupLegalSources(caseTopic, {
    baseUrl,
    fetchImpl: async () => data([
      { ...decision, sumber_url: 'https://www.mkri.id.invalid/putusan/example' },
      { ...decision, sumber_url: 'http://www.mkri.id/putusan/example' },
      { ...decision, sumber_url: 'https://www.mkri.id:8443/putusan/example' },
      { ...decision, sumber_url: 'https://user@www.mkri.id/putusan/example' },
      { ...decision, amar_putusan: 'Belum tersedia.', ringkasan: 'Permohonan dikabulkan.' },
    ]),
  });
  assert.deepEqual(result, { status: 'metadata_only', documents: [], leads: [{ url: decisionUrl, name: 'Mahkamah Konstitusi RI', title: decision.judul }] });
});

test('extracts the requested statutory provision from the indexed official PDF', async () => {
  const pdfUrl = 'https://peraturan.go.id/files/uu-27-2022.pdf';
  const pdfBody = '%PDF-1.4\nsynthetic test document';
  const extracted = [
    'UNDANG-UNDANG NOMOR 27 TAHUN 2022', 'TENTANG', 'PELINDUNGAN DATA PRIBADI',
    'Mengingat:', 'Pasal 5', 'Ketentuan lain yang disebut dalam pembukaan.',
    'MEMUTUSKAN:', 'Pasal 4', 'Ketentuan contoh pasal sebelumnya.',
    'Pasal 5', 'Ketentuan contoh pasal yang dicari.', 'Pasal 6', 'Ketentuan contoh pasal berikutnya.',
  ].join('\n');
  const requests = [];
  const topic = { desk: 'sosial', title: 'Pasal 5 UU PDP dibahas dalam rapat' };
  const result = await lookupLegalSources(topic, {
    baseUrl,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return url.origin === baseUrl ? data([{ ...regulation, pdf_path: pdfUrl }]) : new Response(pdfBody);
    },
    extractPdfText: async (pdf) => {
      assert.equal(pdf.toString(), pdfBody);
      return extracted;
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.searchParams.get('q'), 'pelindungan data pribadi');
  assert.equal(requests[1].url.href, pdfUrl);
  assert.deepEqual(requests[1].options.headers, { Accept: 'application/pdf' });
  assert.equal(requests[1].options.signal, requests[0].options.signal);
  assert.deepEqual(result, { status: 'ok', leads: [], documents: [{
    url: pdfUrl, name: 'Peraturan.go.id', title: regulation.judul, text: 'Pasal 5 Ketentuan contoh pasal yang dicari.', kind: 'legal', text_kind: 'page',
  }] });
});

test('unreadable, mismatched or unrelated PDF provisions still leave a citation lead', async () => {
  const pdfUrl = 'https://peraturan.go.id/files/uu-27-2022.pdf';
  const topic = { title: 'Pasal 5 UU PDP dibahas dalam rapat' };
  const extractedCases = [
    'MEMUTUSKAN:\nPasal 4\nKetentuan contoh pasal lain.',
    'UNDANG-UNDANG NOMOR 12 TAHUN 2023\nMEMUTUSKAN:\nPasal 5\nKetentuan yang salah dokumen.',
    'Katalog peraturan.\nPasal 5\nRingkasan isi ketentuan tanpa naskah resmi.',
    'MEMUTUSKAN:\nPasal 5\nPasal 6\nKetentuan contoh pasal lain.',
    new Error('PDF parser unavailable'),
  ];
  for (const extracted of extractedCases) {
    const result = await lookupLegalSources(topic, {
      baseUrl,
      fetchImpl: async (url) => url.origin === baseUrl ? data([{ ...regulation, pdf_path: pdfUrl }]) : new Response('%PDF-1.4'),
      extractPdfText: async () => {
        if (extracted instanceof Error) throw extracted;
        return extracted;
      },
    });
    assert.equal(result.status, 'metadata_only');
    assert.equal(result.documents.length, 0);
    assert.equal(result.leads[0].url, regulationUrl);
  }
});

test('fails soft on missing config, bad responses, redirects and oversized streams', async () => {
  let calls = 0;
  const unexpected = async () => { calls++; throw new Error('unexpected request'); };
  assert.equal((await lookupLegalSources({ desk: 'bursa', title: 'IHSG naik' }, { baseUrl, fetchImpl: unexpected })).status, 'not_needed');
  assert.equal((await lookupLegalSources(caseTopic, { baseUrl: '', fetchImpl: unexpected })).status, 'not_configured');
  assert.equal((await lookupLegalSources(caseTopic, { baseUrl: 'https://user@ocrawler.example', fetchImpl: unexpected })).status, 'invalid_config');
  assert.equal(calls, 0);

  const badResponses = [
    () => Response.json({ some_other_field: [] }),
    () => new Response('gateway busy', { status: 503 }),
    () => Response.redirect('https://example.invalid/api/data/decisions'),
    () => new Response('x'.repeat(256 * 1024 + 1)),
  ];
  for (const response of badResponses) {
    assert.deepEqual(await lookupLegalSources(caseTopic, { baseUrl, fetchImpl: async () => response() }),
      { status: 'unavailable', documents: [], leads: [] });
  }
  assert.equal((await lookupLegalSources(caseTopic, { baseUrl, fetchImpl: async () => data([]) })).status, 'no_match');
});

test('runs a real GET against a loopback index fixture and stops on a stalled response', async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (new URL(req.url, baseUrl).searchParams.get('q') === caseNumber) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [decision] }));
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await lookupLegalSources(caseTopic, { baseUrl: origin })).status, 'ok');
  assert.equal(requests[0].method, 'GET');
  assert.match(requests[0].path, /^\/api\/data\/decisions\?q=90%2FPUU-XXI%2F2023&page=1&limit=5$/u);
  const stalled = { ...caseTopic, title: 'Putusan MK 99/PUU-XXI/2023' };
  assert.equal((await lookupLegalSources(stalled, { baseUrl: origin, timeoutMs: 50 })).status, 'unavailable');
});
