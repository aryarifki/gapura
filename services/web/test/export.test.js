import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createZip } from '../export.js';
import { buildDraftTextFiles, exportArticle, exportCaption } from '../article-export.js';

test('ZIP package extracts ordered PNG and caption contents with valid CRC', () => {
  const zip = createZip([{ name: 'slide_1.png', data: Buffer.from([0, 1, 2, 255]) }, { name: 'caption.txt', data: 'Naskah Gapura 2,1%\n#GapuraMedia' }]);
  const report = execFileSync('python3', ['-c', "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.read('slide_1.png')==bytes([0,1,2,255]); print(z.read('caption.txt').decode())"], { input: zip, encoding: 'utf8' });
  assert.match(report, /Naskah Gapura 2,1%/);
});

test('caption export uses the reviewed body and canonical hashtags exactly once', () => {
  assert.equal(exportCaption({
    caption_body: 'Layanan warga dibuka kembali.\n\nJadwal tersedia di kecamatan.\n\n#GapuraMedia #Layanan',
    caption: 'Caption lama yang tidak lagi direview.\n\n#Lama',
    hashtags: ['#GapuraMedia', '#Layanan', '#gapuramedia', '#LAYANAN'],
  }), 'Layanan warga dibuka kembali.\n\nJadwal tersedia di kecamatan.\n\n#GapuraMedia #Layanan');
});

test('legacy captions retain their prose and do not repeat existing trailing hashtags', () => {
  for (const caption_body of [undefined, null, '', '   ']) {
    assert.equal(exportCaption({ caption_body, caption: 'Naskah lama.\n\n#GapuraMedia #Layanan\n#GapuraMedia', hashtags: ['#GapuraMedia', '#Layanan'] }),
      'Naskah lama.\n\n#GapuraMedia #Layanan');
  }
  assert.equal(exportCaption({ caption: 'Naskah lama.\n\n#Ékonomi #GapuraMedia #ékonomi', hashtags: [] }), 'Naskah lama.\n\n#Ékonomi #GapuraMedia');
  assert.equal(exportCaption({ caption: 'Naskah lama tanpa tag.', hashtags: ['#GapuraMedia'] }), 'Naskah lama tanpa tag.\n\n#GapuraMedia');
  assert.equal(exportCaption({ caption: 'Naskah tanpa tag.' }), 'Naskah tanpa tag.');
});

test('a hashtag within reviewed prose is retained without appending it again', () => {
  assert.equal(exportCaption({ caption_body: 'Perdebatan #Layanan berlanjut di daerah.\n\n#Lama', hashtags: ['#layanan', '#GapuraMedia'] }),
    'Perdebatan #Layanan berlanjut di daerah.\n\n#GapuraMedia');
});

const articleFacts = [
  { id: 'service', text: 'Dinas membuka layanan warga.', source_name: 'Dinas', source_url: 'https://EXAMPLE.org:443/rilis?b=2&utm_source=feed&a=1#layanan' },
  { id: 'access', text: 'Akses tersedia melalui kecamatan.', source_name: 'Dinas layanan', source_url: 'https://example.org/rilis?a=1&b=2&fbclid=tracking' },
  { id: 'schedule', text: 'Jadwal layanan diumumkan.', source_name: 'Dinas jadwal', source_url: 'https://example.org/rilis?b=2&a=1' },
  { id: 'context', text: 'Warga membahas perubahan layanan.', source_name: 'Forum warga', source_url: 'https://forum.example.org/layanan' },
];

const story = {
  editorial_version: 2,
  headline: 'Layanan kecamatan dibuka kembali untuk warga',
  seo_title: 'Pembukaan layanan warga di kecamatan',
  meta_description: 'Dinas membuka kembali layanan di kecamatan dan menjelaskan jadwal bagi warga.',
  lead: { text: 'Dinas membuka kembali layanan warga melalui kantor kecamatan.', fact_ids: ['service'] },
  takeaways: [
    { text: 'Warga dapat mendatangi kantor kecamatan.', fact_ids: ['access'] },
    { text: 'Jadwal diumumkan melalui kanal dinas.', fact_ids: ['schedule'] },
  ],
  sections: [
    { heading: 'Cara mengakses layanan', paragraphs: [{ text: 'Kantor kecamatan melayani warga sesuai jadwal yang diumumkan.', fact_ids: ['access', 'schedule'] }] },
    { heading: 'Tanggapan warga', paragraphs: [{ text: 'Forum warga membahas perubahan akses layanan di daerah.', fact_ids: ['context'] }] },
  ],
  entities: [],
};

function draft(overrides = {}) {
  return {
    caption: 'Caption layanan.\n\n#GapuraMedia', hashtags: ['#GapuraMedia'],
    slides: [{ no: 1, role: 'cover', layout: 'cover-focus', teks: 'Judul cover pendek', data: { title: 'Layanan bagi warga kecamatan' } }],
    topic_title: 'Penemuan topik layanan', article_body: 'Paragraf artikel tersimpan.\n\nAkses layanan berlangsung melalui kantor kecamatan.',
    article_references: ['service', 'access', 'schedule', 'context'], article_facts: structuredClone(articleFacts), ...overrides,
  };
}

test('structured articles export the actual headline, description, lead, takeaways and section headings', () => {
  const article = exportArticle(draft({ article_metadata: structuredClone(story) }));
  assert.equal(article, `# ${story.headline}\n\n> ${story.meta_description}\n\n${story.lead.text}\n\n## Poin utama\n\n- ${story.takeaways[0].text}\n- ${story.takeaways[1].text}\n\n## Cara mengakses layanan\n\n${story.sections[0].paragraphs[0].text}\n\n## Tanggapan warga\n\n${story.sections[1].paragraphs[0].text}\n\n## Referensi\n\n- [Dinas](<https://example.org/rilis?a=1&b=2>)\n- [Forum warga](<https://forum.example.org/layanan>)\n`);
  assert.doesNotMatch(article, /Artikel lengkap|Paragraf artikel tersimpan|Judul cover pendek/);
});

test('bibliographies deduplicate canonical public URLs while retaining every underlying fact reference', () => {
  const input = draft({ article_metadata: structuredClone(story), article_references: ['service', 'access', 'service', 'schedule', 'context'] });
  const before = structuredClone(input);
  const article = exportArticle(input);
  const sources = article.split('## Referensi\n\n')[1].trim().split('\n');
  assert.deepEqual(sources, ['- [Dinas](<https://example.org/rilis?a=1&b=2>)', '- [Forum warga](<https://forum.example.org/layanan>)']);
  assert.deepEqual(input, before, 'the source list must not collapse fact records or claim-to-fact mappings');
});

test('metadata claim references include sources used only in takeaways without inventing aggregator replacements', () => {
  const input = draft({ article_metadata: structuredClone(story), article_references: ['service'], article_facts: articleFacts.slice(0, 1),
    editorial_input: { facts: [
      ...articleFacts.slice(1),
      { id: 'discovery', text: 'Bahan discovery tersimpan.', source_name: 'Publisher asli', source_url: 'https://news.google.com/rss/articles/encoded-item?hl=id&gl=ID&utm_medium=rss' },
    ] } });
  input.article_metadata.takeaways.push({ text: 'Bahan discovery tersedia untuk warga.', fact_ids: ['discovery'] });
  const article = exportArticle(input);
  assert.equal((article.match(/example\.org\/rilis\?a=1&b=2/g) || []).length, 1);
  assert.match(article, /\[Forum warga\]\(<https:\/\/forum\.example\.org\/layanan>\)/);
  assert.match(article, /\[Publisher asli\]\(<https:\/\/news\.google\.com\/rss\/articles\/encoded-item\?gl=ID&hl=id>\)/);
  assert.doesNotMatch(article, /utm_medium/);
});

test('legacy article headings prefer cover data, then cover text, then joined topic title', () => {
  for (const [overrides, headline] of [
    [{}, 'Layanan bagi warga kecamatan'],
    [{ slides: [{ no: 1, role: 'cover', teks: 'Layanan kembali ke kecamatan', data: {} }] }, 'Layanan kembali ke kecamatan'],
    [{ slides: [{ no: 1, teks: 'Artikel lengkap', data: { title: 'Berita terbaru' } }] }, 'Penemuan topik layanan'],
    [{ slides: [] }, 'Penemuan topik layanan'],
  ]) {
    const value = draft(overrides);
    const article = exportArticle(value);
    assert.ok(article.startsWith(`# ${headline}\n\n${value.article_body}\n\n## Referensi\n\n`), article);
  }
  assert.throws(() => exportArticle(draft({ slides: [], topic_title: 'Artikel lengkap' })), /Judul artikel belum tersedia/);
});

test('JSON string fields and caption-only legacy drafts retain export compatibility', () => {
  const value = draft({ article_metadata: structuredClone(story) });
  const encoded = { ...value };
  for (const field of ['slides', 'article_metadata', 'article_references', 'article_facts', 'hashtags']) encoded[field] = JSON.stringify(encoded[field]);
  assert.deepEqual(buildDraftTextFiles(encoded), buildDraftTextFiles(value));
  assert.deepEqual(buildDraftTextFiles({ caption: 'Caption arsip.\n\n#Arsip', slides: [] }), [{ name: 'caption.txt', data: 'Caption arsip.\n\n#Arsip' }]);
  assert.ok(exportArticle(draft({ article_body: null, article_metadata: structuredClone(story) })).startsWith(`# ${story.headline}\n`));
});

test('export files contain only article and caption data with valid public bibliography URLs', () => {
  const value = draft({ api_key: 'CONFIG_SECRET_SENTINEL', article_facts: [
    ...articleFacts,
    { id: 'private', source_name: 'Interal', source_url: 'https://127.0.0.1/private' },
    { id: 'credentials', source_name: 'Credential URL', source_url: 'https://user:URL_SECRET_SENTINEL@example.org/private' },
  ], article_references: [...draft().article_references, 'private', 'credentials'] });
  const files = buildDraftTextFiles(value);
  assert.deepEqual(files.map((file) => file.name), ['caption.txt', 'article.md']);
  assert.doesNotMatch(files.map((file) => file.data).join('\n'), /CONFIG_SECRET_SENTINEL|URL_SECRET_SENTINEL|127\.0\.0\.1/);
});
