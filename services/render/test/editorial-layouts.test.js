import './helpers/offline.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import satori from 'satori';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';
import { EDITORIAL_LAYOUTS, validateLayoutData, validateSlide, validatePreview } from '../validation.js';

const engine = new RenderEngine(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../design-system'));
const source = 'Dokumen uji lingkungan · Pernyataan forum warga';
const assetId = '2d30e364-b95d-4d49-82ed-43c548270944';
const slides = [
  { layout: 'editorial-cover', teks: 'Warga membutuhkan pemantauan terbuka dan tindak lanjut konsisten.', data: { title: 'Udara bersih masih jadi pekerjaan rumah', kicker: 'Lingkungan' } },
  { layout: 'editorial-lead', teks: 'Laporan kualitas udara membantu warga memahami perubahan dan memilih langkah perlindungan yang sesuai.', data: { title: 'Data terbuka jadi pintu awal', kicker: 'Perkembangan utama', paragraphs: [
    { text: 'Data konsentrasi partikulat yang diterbitkan berkala membantu warga membaca pola harian, membandingkan antar titik ukur, dan menentukan kapan aktivitas luar ruang perlu disesuaikan.', fact_ids: [] },
    { text: 'Pemantauan yang terbuka juga memberi dasar bagi tindak lanjut bersama, mulai dari pembatasan sumber emisi di tingkat lingkungan sampai evaluasi kebijakan udara bersih oleh pemerintah daerah.', fact_ids: [] },
  ] } },
  { layout: 'editorial-breakdown', teks: 'Lihat informasi ini.', data: { title: 'Tiga fokus pemantauan', kicker: 'Yang perlu dibaca', items: [
    { label: 'Lokasi', value: 'Titik ukur tersedia.' }, { label: 'Waktu', value: 'Pembaruan dicatat berkala.' }, { label: 'Tindak lanjut', value: 'Warga bisa bertanya.' },
  ] } },
  { layout: 'editorial-timeline', teks: 'Perkembangan dalam dokumen publik.', data: { title: 'Dari catatan ke tindakan', kicker: 'Kronologi', events: [
    { date: 'Senin, 16 November 2026', text: 'Data dipublikasikan.', fact_ids: ['fact-data'] },
    { date: '19 November 2026', text: 'Warga memberi tanggapan.', fact_ids: ['fact-forum'] },
    { date: 'November 2026', text: 'Catatan dibahas bersama.', fact_ids: ['fact-meeting'] },
  ] } },
  { layout: 'editorial-quote', teks: 'Pernyataan dalam forum warga.', data: { title: 'Keterbukaan jadi tuntutan', kicker: 'Suara warga', quote: 'Kami membutuhkan informasi yang bisa dibaca dan diperiksa bersama.', author: 'Narasumber Uji', role_label: 'Perwakilan forum warga' } },
  { layout: 'editorial-impact', teks: 'Informasi yang mudah dibaca membantu warga memahami kondisi sekitar sebelum menentukan aktivitas harian.', data: { title: 'Manfaat bagi warga', kicker: 'Dampak publik' } },
  { layout: 'editorial-close', teks: 'Catat kebutuhan informasi di lingkunganmu.', data: { title: 'Buka ruang diskusi', kicker: 'Giliran pembaca', question: 'Informasi apa yang paling kamu butuhkan?', cta: 'Simpan dan bagikan pertanyaanmu' } },
].map((slide, index) => ({ ...slide, no: index + 1, source }));

const raster = await sharp({ create: { width: 1080, height: 720, channels: 3, background: '#D6289B' } }).png().toBuffer();
const imageData = `data:image/png;base64,${raster.toString('base64')}`;
const photoCover = (kind) => ({ ...slides[0], data: {
  ...slides[0].data, image_data: imageData, image_kind: kind, asset_id: assetId,
  asset_sha256: createHash('sha256').update(raster).digest('hex'), credit: 'Dokumentasi warga uji', rights_basis: 'own_work',
} });

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat().flatMap(nodes)];
}

function texts(tree) {
  return nodes(tree).flatMap((node) => [node.props?.children].flat().filter((text) => typeof text === 'string'));
}

async function inspect(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1350);
  return { data, info };
}

async function layoutBoxes(slide) {
  const boxes = [];
  await satori(engine.resolveLayout(slide, slide.no, slides.length), {
    width: 1080, height: 1350, fonts: engine.fonts, onNodeDetected: (node) => boxes.push(node),
  });
  return boxes.filter((box) => box.textContent?.trim());
}

test('the seven semantic layouts preserve supplied copy and paint distinct offline PNGs with safe text bounds', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network access permitted'); });
  assert.deepEqual(slides.map((slide) => slide.layout), [...EDITORIAL_LAYOUTS]);
  const hashes = new Set();
  for (const slide of slides) {
    const original = structuredClone(slide);
    const tree = engine.resolveLayout(slide, slide.no, slides.length);
    const rendered = texts(tree);
    // Halaman artikel menggambar judul berita asli sebagai tajuk (gaya
    // media berita); kicker lead tetap metadata. Semua layout wajib
    // mempertahankan teks, judul, dan sumber yang diberikan.
    const expectedCopy = slide.layout === 'editorial-lead'
      ? [slide.teks, slide.data.title, source]
      : [slide.teks, slide.data.title, slide.data.kicker, source];
    for (const copy of expectedCopy) assert.ok(rendered.includes(copy), `${slide.layout}: missing ${copy}`);
    assert.doesNotMatch(rendered.join(' '), /KONTEKS|BULLISH|fact-data|fact-forum|fact-meeting/u);
    const image = await engine.renderSlideToBuffer(slide, slide.no, slides.length);
    const { data, info } = await inspect(image);
    hashes.add(createHash('sha256').update(image).digest('hex'));
    let dark = 0;
    let light = 0;
    // Halaman artikel tidak memiliki judul navy; tinta tubuhnya adalah
    // muted #546A7B di atas mist #EDF4F4, jadi ambang tinta lead disesuaikan.
    const isInk = slide.layout === 'editorial-lead'
      ? (r, g, b) => r < 110 && g < 135 && b < 155
      : (r, g, b) => r < 70 && g < 100 && b < 130;
    // Pada layout gelap, teks aksen mint/amber adalah cat "terang" walau
    // tidak semua kanalnya melewati 200; hitung piksel cerah per kanal maks.
    const isDarkLayout = ['editorial-cover', 'editorial-quote', 'editorial-close'].includes(slide.layout);
    for (let y = 190; y < 1150; y++) for (let x = 72; x < 1008; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (isInk(data[offset], data[offset + 1], data[offset + 2])) dark++;
      if (data[offset] > 200 && data[offset + 1] > 200 && data[offset + 2] > 200) light++;
      else if (isDarkLayout && Math.max(data[offset], data[offset + 1], data[offset + 2]) > 200) light++;
    }
    assert.ok(dark > 5000 && light > 5000, `${slide.layout}: headline and body must paint with contrast`);
    const boxes = await layoutBoxes(slide);
    const footer = boxes.find((box) => box.textContent === source);
    assert.ok(footer, 'factual source must be laid out in the footer');
    // Label krom desain (strip bawah sampul; bar bawah gelap pada artikel
    // dan penutup) adalah furnitur tetap di tepi bawah kanvas: label-label
    // ini boleh berada di bawah garis sumber, sedangkan semua KONTEN tetap
    // wajib berakhir di atas garis sumber.
    const chrome = slide.layout === 'editorial-cover'
      ? ['GAPURAMEDIA.MY.ID', 'GESER →']
      : (slide.layout === 'editorial-lead' || slide.layout === 'editorial-close')
        ? ['GAPURAMEDIA.MY.ID', 'GESER →', '@gapuramedia']
        : [];
    for (const box of boxes) {
      assert.ok(box.left >= 70 && box.left + box.width <= 1010, `${slide.layout}: horizontal overflow for ${box.textContent}`);
      if (chrome.includes(box.textContent)) {
        assert.ok(box.top + box.height <= 1350, `${slide.layout}: chrome label escapes the canvas: ${box.textContent}`);
      } else {
        assert.ok(box.top >= 70 && box.top + box.height <= 1280, `${slide.layout}: vertical overflow for ${box.textContent}`);
        if (![source, '@gapuramedia'].includes(box.textContent)) assert.ok(box.top + box.height < footer.top - 24, `${slide.layout}: content overlaps factual provenance`);
      }
    }
    if (slide.layout !== 'editorial-cover' && slide.layout !== 'editorial-lead') {
      assert.ok(boxes.find((box) => box.textContent === slide.data.title).top < 270, `${slide.layout}: headline must start near the top`);
    }
    const bottom = await sharp(await sharp(image).extract({ left: 0, top: 1310, width: 1080, height: 40 }).toBuffer()).stats();
    if (slide.layout === 'editorial-lead' || slide.layout === 'editorial-close') {
      // Pada layout ber-bar, pita terbawah adalah bar gelap itu sendiri.
      assert.ok(bottom.channels.every((channel) => channel.mean < 60), `${slide.layout}: bottom band must be the dark bottom bar`);
    } else {
      assert.ok(bottom.channels.every((channel) => channel.stdev < 1), `${slide.layout}: bottom safe margin must remain clear`);
    }
    assert.deepEqual(slide, original, 'rendering must not alter source copy or event fact_ids');
  }
  assert.equal(hashes.size, slides.length);
});

test('standalone body previews use the chosen semantic layout even at slide 1', () => {
  for (const slide of slides.slice(1)) {
    const tree = engine.resolveLayout({ ...slide, no: 1 }, 1, 1);
    const rendered = texts(tree);
    if (slide.layout === 'editorial-lead') assert.ok(rendered.includes(slide.data.title), 'editorial-lead: the real headline must be drawn');
    else assert.ok(rendered.includes(slide.data.title));
    assert.ok(rendered.includes(source));
    assert.ok(!rendered.includes('Geser →'));
    if (slide.data.items) {
      for (const item of slide.data.items) assert.ok(rendered.includes(item.value));
      for (const number of ['01', '02', '03']) assert.ok(rendered.includes(number));
    }
    if (slide.data.events) for (const event of slide.data.events) {
      assert.ok(rendered.includes(event.date), 'source date strings must stay exact');
      assert.ok(rendered.includes(event.text));
    }
    if (slide.data.quote) for (const key of ['quote', 'author', 'role_label']) assert.ok(rendered.includes(slide.data[key]));
    if (slide.data.question) {
      // Pertanyaan penutup digambar sebagai baris-baris terpisah agar token
      // '@' tidak tumpah; gabungan barisnya harus membentuk teks aslinya.
      assert.ok(rendered.join(' ').replace(/\s+/g, ' ').includes(slide.data.question), 'close question copy must be preserved across its lines');
      assert.ok(rendered.includes(slide.data.cta));
    }
  }
});

test('a full 25-word photo cover and 40-word quotation keep every line above the source footer', async () => {
  const cover = photoCover('editor_upload');
  cover.data.title = 'Pemantauan kualitas udara membutuhkan keterbukaan informasi dari pemerintah daerah setempat';
  cover.teks = 'Masyarakat dapat membaca perkembangan terbaru sekaligus mengetahui langkah perlindungan yang relevan untuk kebutuhan aktivitas harian.';
  const quotation = structuredClone(slides[4]);
  quotation.data.quote = 'Informasi yang terbuka membantu masyarakat memahami persoalan bersama, menilai perubahan secara jernih, dan menyampaikan pertanyaan yang tepat agar tindak lanjut dapat dibahas dengan pemerintah secara terbuka di lingkungan tempat tinggal masing-masing warga.';
  quotation.teks = 'Pernyataan terbuka dalam forum warga.';
  assert.equal(`${cover.data.title} ${cover.teks}`.split(/\s+/u).length, 25);
  assert.equal(`${quotation.data.title} ${quotation.teks} ${quotation.data.quote}`.split(/\s+/u).length, 40);
  for (const slide of [cover, quotation]) {
    await inspect(await engine.renderSlideToBuffer(slide, slide.no, 7));
    const boxes = await layoutBoxes(slide);
    const footer = boxes.find((box) => box.textContent === source);
    for (const box of boxes.filter((entry) => ![source, '@gapuramedia', 'GAPURAMEDIA.MY.ID', 'GESER →'].includes(entry.textContent))) {
      assert.ok(box.left >= 70 && box.left + box.width <= 1010, `text overflows horizontally: ${box.textContent}`);
      assert.ok(box.top + box.height < footer.top - 24, `text reaches the footer: ${box.textContent}`);
    }
  }
});

test('editorial headings and per-layout data are required at every render boundary', async () => {
  const cases = [];
  for (const slide of slides) {
    for (const value of [undefined, '', ' ', null, 12, {}]) {
      cases.push([{ ...slide, data: { ...slide.data, title: value } }, /title/]);
    }
  }
  for (const slide of slides) for (const value of [12, {}]) {
    const bad = { ...slide, data: { ...slide.data, kicker: value } };
    assert.throws(() => validateSlide(bad), { status: 400, message: /kicker/ }, `${slide.layout}: non-string kicker must be rejected`);
  }
  for (const slide of slides) for (const value of ['', ' ', null]) {
    const ok = { ...slide, data: { ...slide.data, kicker: value } };
    for (const validate of [() => validateLayoutData(ok.layout, ok.data), () => validateSlide(ok)]) assert.doesNotThrow(validate, `${ok.layout}: optional kicker must be accepted`);
  }
  for (const slide of slides) {
    const data = { ...slide.data };
    delete data.kicker;
    const ok = { ...slide, data };
    for (const validate of [() => validateLayoutData(ok.layout, ok.data), () => validateSlide(ok)]) assert.doesNotThrow(validate, `${ok.layout}: absent kicker must be accepted`);
  }
  for (const items of [undefined, [], [{}], [{ label: ' ', value: 'Narasi' }], [{ label: 'Lokasi', value: '' }], [{ label: 'Lokasi', value: 12 }], Array(5).fill({ label: 'Lokasi', value: 'Narasi' })]) {
    cases.push([{ ...slides[2], data: { ...slides[2].data, items } }, /items/]);
  }
  for (const events of [undefined, [], [{}], [{ date: ' ', text: 'Catatan', fact_ids: ['f1'] }], [{ date: 'November 2026', text: '', fact_ids: ['f1'] }], [{ date: 'November 2026', text: 'Catatan' }], [{ date: 'November 2026', text: 'Catatan', fact_ids: [] }], [{ date: 'November 2026', text: 'Catatan', fact_ids: [1] }], Array(6).fill(slides[3].data.events[0])]) {
    cases.push([{ ...slides[3], data: { ...slides[3].data, events } }, /events|date|text|fact_ids/]);
  }
  for (const field of ['quote', 'author', 'role_label']) for (const value of [undefined, '', ' ']) {
    cases.push([{ ...slides[4], data: { ...slides[4].data, [field]: value } }, new RegExp(field)]);
  }
  cases.push([{ ...slides[6], data: { ...slides[6].data, question: ' ' } }, /question/]);
  for (const items of [[], [{}], [{ label: 'Akses', value: '' }], [{ label: '', value: 0 }], [{ label: 'Akses', value: {} }], Array(5).fill({ label: 'Akses', value: 0 })]) {
    cases.push([{ ...slides[5], data: { ...slides[5].data, items } }, /items|value/]);
  }
  for (const [slide, message] of cases) {
    for (const validate of [() => validateLayoutData(slide.layout, slide.data), () => validateSlide(slide), () => validatePreview(slide, slide.no, 7), () => engine.resolveLayout(slide, slide.no, 7)]) {
      assert.throws(validate, { status: 400, message }, `${slide.layout}: incomplete semantic data`);
    }
    await assert.rejects(engine.renderSlideToBuffer(slide, slide.no, 7), { status: 400, message });
  }
});

test('new editorial text fields accept text and reject objects, numbers and arrays', () => {
  for (const field of ['kicker', 'role_label', 'question', 'cta']) {
    for (const value of [{ text: 'invalid' }, 12, ['invalid']]) {
      assert.throws(() => validateSlide({ ...slides[1], data: { ...slides[1].data, [field]: value } }), { status: 400, message: new RegExp(field) });
    }
    assert.doesNotThrow(() => validateSlide({ ...slides[1], data: { ...slides[1].data, [field]: 'Teks editorial' } }));
  }
});

for (const kind of ['editor_upload', 'ai_generated']) {
  test(`editorial cover paints the hydrated ${kind} raster, gradient and independent disclosure offline`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('No image fetching permitted'); });
    const slide = photoCover(kind);
    const tree = engine.resolveLayout(slide, 1, 7);
    const label = kind === 'editor_upload' ? 'Gambar: Dokumentasi warga uji' : 'Ilustrasi AI · Gapura Media';
    const rendered = texts(tree);
    assert.equal(nodes(tree).filter((node) => node.type === 'img' && node.props.src === imageData).length, 1);
    assert.equal(rendered.filter((text) => text === label).length, 1);
    assert.ok(rendered.includes(source), 'image credit cannot replace factual provenance');
    assert.ok(rendered.includes('GESER →'));
    const image = await engine.renderSlideToBuffer(slide, 1, 7);
    await inspect(image);
    const photoStats = await sharp(await sharp(image).extract({ left: 72, top: 230, width: 936, height: 160 }).toBuffer()).stats();
    assert.ok(photoStats.channels[0].mean > 115 && photoStats.channels[2].mean > 80, 'the supplied colored raster must fill a substantial visible image area');
    const boxes = await layoutBoxes(slide);
    const footer = boxes.find((box) => box.textContent === source);
    for (const copy of [slide.data.title, slide.teks, label]) {
      const box = boxes.find((entry) => entry.textContent === copy);
      assert.ok(box && box.top + box.height < footer.top - 24, `photo cover clips ${copy}`);
    }
    assert.ok(boxes.some((box) => box.textContent === 'GESER →'), 'photo cover keeps the swipe cue in the bottom strip');
  });
}

test('editorial cover rejects unhydrated, remote, corrupt and unattributed manual images', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network access permitted'); });
  for (const [patch, message] of [
    [{ image_url: 'https://example.invalid/photo.jpg' }, /image_url/],
    [{ image_data: 'https://example.invalid/photo.jpg' }, /image_data/],
    [{ image_data: 'file:///etc/passwd' }, /image_data/],
    [{ image_data: 'data:image/png;base64,iVBORw0KGgo=' }, /decodable raster/],
    [{ credit: '' }, /credit/], [{ rights_basis: 'unknown' }, /rights_basis/], [{ asset_id: 'unknown' }, /asset_id/],
  ]) {
    const slide = photoCover('editor_upload');
    Object.assign(slide.data, patch);
    await assert.rejects(engine.renderSlideToBuffer(slide, 1, 7), { status: 400, message });
  }
});

test('impact emphasizes only explicitly supplied numbers, including zero, and retains narrative explanations', async () => {
  const narrative = slides[5];
  const tree = engine.resolveLayout(narrative, 6, 7);
  assert.ok(texts(tree).includes(narrative.teks));
  assert.ok(!nodes(tree).some((node) => Number.parseInt(node.props?.style?.fontSize, 10) > 100), 'narrative impact cannot invent a hero metric');
  for (const value of [0, '2,1%']) {
    const slide = { ...narrative, data: { ...narrative.data, value, unit: 'indikator uji' } };
    const nodesWithValue = nodes(engine.resolveLayout(slide, 6, 7)).filter((node) => node.props?.children === String(value));
    assert.equal(nodesWithValue.length, 1);
    assert.ok(Number.parseInt(nodesWithValue[0].props.style.fontSize, 10) > 100);
    await inspect(await engine.renderSlideToBuffer(slide, 6, 7));
  }
  const list = { ...narrative, data: { ...narrative.data, items: [{ label: 'Pemantauan', value: 'Data lebih mudah dibaca.' }, { label: 'Akses uji', value: 0 }] } };
  const rendered = texts(engine.resolveLayout(list, 6, 7));
  for (const copy of ['Pemantauan', 'Data lebih mudah dibaca.', 'Akses uji', '0']) assert.ok(rendered.includes(copy));
  await inspect(await engine.renderSlideToBuffer(list, 6, 7));
  const explanation = { ...narrative, data: { ...narrative.data, value: 'Akses informasi lebih terbuka' } };
  const ordinaryValue = nodes(engine.resolveLayout(explanation, 6, 7)).find((node) => node.props?.children === explanation.data.value);
  assert.ok(ordinaryValue && Number.parseInt(ordinaryValue.props.style.fontSize, 10) < 60, 'qualitative values stay visible without becoming invented hero metrics');
});

test('semantic carousel disk export creates real PNG and JPEG files while invalid data cannot replace them', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled'); });
  const output = fs.mkdtempSync('/tmp/opencode/render-editorial-');
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const batch = [photoCover('editor_upload'), ...slides.slice(1)];
  const results = await engine.renderCarouselToDisk(41, batch, output);
  assert.equal(results.length, 7);
  const hashes = [];
  for (let i = 1; i <= 7; i++) for (const [extension, format] of [['png', 'png'], ['jpg', 'jpeg']]) {
    const buffer = fs.readFileSync(path.join(output, '41', `slide_${i}.${extension}`));
    assert.equal((await sharp(buffer).metadata()).format, format);
    await inspect(buffer);
    hashes.push(createHash('sha256').update(buffer).digest('hex'));
  }
  const original = fs.readFileSync(path.join(output, '41/slide_1.png'));
  const invalid = structuredClone(batch);
  invalid[2].data.items = [];
  await assert.rejects(engine.renderCarouselToDisk(41, invalid, output), { status: 400, message: /items/ });
  assert.deepEqual(fs.readFileSync(path.join(output, '41/slide_1.png')), original);
  assert.equal(new Set(hashes).size, 14);
  assert.deepEqual(fs.readdirSync(output), ['41']);
});
