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
    // Label krom desain (strip bawah sampul) adalah furnitur tetap di
    // tepi bawah kanvas: label-label ini boleh berada di bawah garis
    // sumber, sedangkan semua KONTEN tetap wajib berakhir di atas garis
    // sumber. Bar bawah gelap pada artikel dan penutup dihapus atas
    // perintah pemilik (2026-11-25); kedua layout itu kini memakai
    // footer terang yang sama dengan slide isi lain.
    const chrome = slide.layout === 'editorial-cover'
      ? ['GAPURAMEDIA.MY.ID', 'GESER →']
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
    // Halaman penutup dikecualikan: blok kontennya terpusat vertikal di
    // wilayah konten (audit owner 2026-11-24), diuji khusus di bawah.
    if (slide.layout !== 'editorial-cover' && slide.layout !== 'editorial-lead' && slide.layout !== 'editorial-close') {
      assert.ok(boxes.find((box) => box.textContent === slide.data.title).top < 270, `${slide.layout}: headline must start near the top`);
    }
    const bottom = await sharp(await sharp(image).extract({ left: 0, top: 1310, width: 1080, height: 40 }).toBuffer()).stats();
    assert.ok(bottom.channels.every((channel) => channel.stdev < 1), `${slide.layout}: bottom safe margin must remain clear`);
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
  // Kasus "terlalu banyak" (7 item breakdown, 6 peristiwa linimasa, 7 item
  // impact) TIDAK lagi invalid: batas atasnya dibuang atas perintah
  // pemilik 2026-11-26; yang tetap invalid adalah bentuk datanya.
  for (const items of [undefined, [], [{}], [{ label: ' ', value: 'Narasi' }], [{ label: 'Lokasi', value: '' }], [{ label: 'Lokasi', value: 12 }]]) {
    cases.push([{ ...slides[2], data: { ...slides[2].data, items } }, /items/]);
  }
  for (const events of [undefined, [], [{}], [{ date: ' ', text: 'Catatan', fact_ids: ['f1'] }], [{ date: 'November 2026', text: '', fact_ids: ['f1'] }], [{ date: 'November 2026', text: 'Catatan' }], [{ date: 'November 2026', text: 'Catatan', fact_ids: [] }], [{ date: 'November 2026', text: 'Catatan', fact_ids: [1] }]]) {
    cases.push([{ ...slides[3], data: { ...slides[3].data, events } }, /events|date|text|fact_ids/]);
  }
  for (const field of ['quote', 'author', 'role_label']) for (const value of [undefined, '', ' ']) {
    cases.push([{ ...slides[4], data: { ...slides[4].data, [field]: value } }, new RegExp(field)]);
  }
  cases.push([{ ...slides[6], data: { ...slides[6].data, question: ' ' } }, /question/]);
  for (const items of [[], [{}], [{ label: 'Akses', value: '' }], [{ label: '', value: 0 }], [{ label: 'Akses', value: {} }]]) {
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

test('close slide content is vertically centered in the content region', async () => {
  const slide = slides[6];
  const boxes = await layoutBoxes(slide);
  const label = boxes.find((box) => box.textContent === slide.data.kicker);
  const cta = boxes.find((box) => box.textContent === slide.data.cta);
  const sourceBox = boxes.find((box) => box.textContent === source);
  assert.ok(label && cta && sourceBox, 'close label, save row and source must be laid out');
  // Wilayah konten mulai di 179 (padding akar 72 + header 51 + paddingTop
  // 56) dan berakhir di 1195 (tepi bawah area akar 1278 - paddingBottom
  // 40 - footer terang ±43 yang kini duduk di alur di bawah wilayah
  // konten; bar bawah gelap dihapus atas perintah pemilik 2026-11-25).
  // Blok utama mengisi dan terpusat di seluruh rentang itu; baris sumber
  // tampil di footer terang di bawahnya.
  const blockTop = label.top;
  const blockBottom = cta.top + cta.height;
  const center = (blockTop + blockBottom) / 2;
  const regionCenter = (179 + 1195) / 2;
  assert.ok(blockTop > 300, `close block must not stick to the top (label top ${blockTop})`);
  assert.ok(Math.abs(center - regionCenter) <= 130, `close block must be vertically centered (center ${center}, region center ${regionCenter})`);
  assert.ok(blockBottom < sourceBox.top - 24, 'close block stays above the source line');
});

test('breakdown auto-fit keeps a six-item list on one slide with continuous numbering', async () => {
  // Tangga fit diuji langsung lewat renderEditorial: jalur tata letak yang
  // sama yang dipakai resolveLayout. Datanya meniru kasus audit owner 2026-11-24 (enam tersangka
  // dugaan makar, nilai dua baris) yang di versi terbit terbelah 3+3
  // dengan penomoran mengulang.
  const slide = {
    layout: 'editorial-breakdown', no: 2, source,
    teks: '',
    data: {
      title: 'Enam nama tersangka dugaan makar', kicker: 'Para tersangka',
      items: [
        { label: 'Tersangka — Listyo Sigit Prabowo, mantan Kapolri', value: 'Diduga memerintahkan penyadapan dan menerima laporan hasil penyadapan serta pengawasan' },
        { label: 'Tersangka — Irjen Slamet Uliandi', value: 'Diduga memimpin rapat awal, menentukan sasaran penyadapan, dan menerima laporan kegiatan' },
        { label: 'Tersangka — Irjen Eko Hadi Santoso', value: 'Diduga mengikuti rapat awal serta terlibat penentuan target dan pemberian perintah penyadapan' },
        { label: 'Tersangka — Irjen Ahrie Sonta Nasution', value: 'Diduga menyusun arahan rapat, menentukan target, dan memberi instruksi pengawasan lapangan' },
        { label: 'Tersangka — Brigjen Tedjo Kusumo', value: 'Diduga menjalankan pengawasan langsung terhadap sejumlah sasaran dan melaporkan hasilnya' },
        { label: 'Tersangka — Kombes Iman Imanuddin', value: 'Diduga memerintahkan konten penyerang Polri dan pemesanan 500 kaus salam tiga jari untuk demonstrasi' },
      ],
    },
  };
  const boxes = [];
  const svg = await satori(engine.renderEditorial(slide, 2, 7), {
    width: 1080, height: 1350, fonts: engine.fonts, onNodeDetected: (node) => boxes.push(node),
  });
  await inspect(await sharp(Buffer.from(svg)).png().toBuffer());
  const textBoxes = boxes.filter((box) => box.textContent?.trim());
  const footer = textBoxes.find((box) => box.textContent === source);
  assert.ok(footer, 'source footer must be laid out');
  for (const item of slide.data.items) {
    const valueBox = textBoxes.find((box) => box.textContent === item.value);
    assert.ok(valueBox, `item value laid out: ${item.label}`);
    assert.ok(valueBox.top + valueBox.height < footer.top - 24, `item stays above the footer: ${item.label}`);
  }
  for (const number of ['01', '02', '03', '04', '05', '06']) {
    assert.ok(textBoxes.some((box) => box.textContent === number), `number ${number} rendered exactly once in sequence`);
  }
});

test('timeline auto-fit keeps five dense events on one slide above the source footer', async () => {
  // Tangga fit linimasa diuji dengan data PERSIS slide 4 draf #39 (kasus
  // Candiru, audit owner 2026-11-25): lima peristiwa dengan teks dua-tiga
  // baris. Pada renderer lama tumpukan ini meluap — teks peristiwa keempat
  // menabrak baris sumber di kaki slide dan peristiwa kelima jatuh di luar
  // kanvas — sehingga agen penerbit berhenti sesuai aturan paritas Space.
  // Dengan tangga fit, kelima peristiwa tampil utuh dalam SATU slide dengan
  // teks apa adanya (tidak dipendekkan, tidak dipecah).
  const slide = {
    layout: 'editorial-timeline', no: 4, source: 'Tulis.ink · KompasTV',
    teks: '',
    data: {
      title: 'Jejak Candiru dari serah terima Menhan sampai televisi', kicker: 'Politik · Intelijen',
      events: [
        { date: '23 Oktober 2019', text: 'Ryamizard Ryacudu mengakhiri jabatan Menteri Pertahanan dan Prabowo Subianto dilantik menggantikannya.', fact_ids: ['waktu-ryamizard'] },
        { date: '20 Mei 2020', text: 'Kiriman pertama perangkat keras dari Heha Pte Ltd ke Polri tercatat dalam catatan dagang yang dipetakan Amnesty International.', fact_ids: ['kiriman-rinci-2020'] },
        { date: '27 Januari 2021', text: 'Kiriman lisensi perangkat lunak terkait tercatat, melengkapi total kiriman terkait Candiru sekitar US$33 juta.', fact_ids: ['kiriman-heha-polri'] },
        { date: '1 Mei 2024', text: 'Amnesty International Security Lab menerbitkan laporan A Web of Surveillance tentang masuknya spyware ke Indonesia.', fact_ids: ['kiriman-rinci-2020'] },
        { date: '7 November 2026', text: 'Andi menyampaikan keheranannya atas perangkat Candiru dalam program Bola Liar di KompasTV.', fact_ids: ['andi-kaget'] },
      ],
    },
  };
  const boxes = [];
  const svg = await satori(engine.renderEditorial(slide, 4, 5), {
    width: 1080, height: 1350, fonts: engine.fonts, onNodeDetected: (node) => boxes.push(node),
  });
  await inspect(await sharp(Buffer.from(svg)).png().toBuffer());
  const textBoxes = boxes.filter((box) => box.textContent?.trim());
  const footer = textBoxes.find((box) => box.textContent === slide.source);
  assert.ok(footer, 'source footer must be laid out');
  for (const event of slide.data.events) {
    const dateBox = textBoxes.find((box) => box.textContent === event.date);
    const textBox = textBoxes.find((box) => box.textContent === event.text);
    assert.ok(dateBox, `event date laid out: ${event.date}`);
    assert.ok(textBox, `event text laid out: ${event.date}`);
    assert.ok(textBox.top >= 70 && textBox.top + textBox.height <= 1280, `event text stays inside the canvas: ${event.date}`);
    assert.ok(textBox.top + textBox.height < footer.top - 24, `event text stays above the source footer: ${event.date}`);
  }
  await inspect(await engine.renderSlideToBuffer(slide, 4, 5));
});

test('timeline auto-fit keeps six dense events (draft Space 12) on one slide above the source footer', async () => {
  // Data PERSIS slide 4 draf Space id 12 ("Sidang etik Listyo Sigit…"):
  // enam peristiwa — melebihi batas lama 5/slide yang DIBUANG atas
  // perintah pemilik 2026-11-26 — termasuk tanggal bernama hari dan
  // tanggal gabungan. Tangga auto-fit yang ada ternyata sudah memuatnya
  // utuh satu slide di atas footer sumber, tanpa mengubah teks.
  const slide = {
    layout: 'editorial-timeline', no: 4, source: 'CNA Indonesia · The Stance · Justisio · Channel9.id · NTVNews · SumbarSatu · Periskop.id',
    teks: '',
    data: {
      title: 'Dari rapat 2024 sampai sidang etik 26 November 2026', kicker: 'Linimasa perkara',
      events: [
        { date: '3 Oktober 2024', text: 'Rapat pemetaan tokoh berpengaruh diduga digelar sebelum pelantikan Presiden Prabowo, dipimpin Slamet Uliandi.', fact_ids: ['motif-tahapan'] },
        { date: 'Juli–Agustus 2025', text: 'Bendera One Piece viral sebagai simbol protes dan kekecewaan publik menjelang HUT ke-80 RI.', fact_ids: ['simbol-one-piece'] },
        { date: '10 dan 17 November 2026', text: 'Ahrie Sonta dan Eko Hadi dijatuhi pemberhentian tidak dengan hormat lewat sidang etik; keduanya mengajukan banding.', fact_ids: ['jadwal-propam', 'sidang-etik'] },
        { date: 'Senin, 23 November 2026', text: 'Bareskrim menetapkan enam tersangka dugaan makar dan memamerkan barang bukti, termasuk kaus dan bendera.', fact_ids: ['enam-tersangka', 'barang-bukti'] },
        { date: 'Selasa, 24 November 2026', text: 'Bareskrim meluruskan soal typo: bendera yang ditemukan bertuliskan One Piece, inti perkara pada dokumen 14 poin.', fact_ids: ['klarifikasi-bareskrim', 'typo'] },
        { date: 'Kamis, 26 November 2026', text: 'Sidang etik Listyo Sigit pukul 09.00 WIB di Gedung Divpropam Polri, dipimpin lima jenderal bintang tiga.', fact_ids: ['sidang-etik'] },
      ],
    },
  };
  for (const validate of [() => validateLayoutData(slide.layout, slide.data), () => validateSlide(slide), () => validatePreview(slide, slide.no, 5)]) {
    assert.doesNotThrow(validate, 'six timeline events must be accepted at every render boundary');
  }
  const boxes = [];
  const svg = await satori(engine.renderEditorial(slide, 4, 5), {
    width: 1080, height: 1350, fonts: engine.fonts, onNodeDetected: (node) => boxes.push(node),
  });
  await inspect(await sharp(Buffer.from(svg)).png().toBuffer());
  const textBoxes = boxes.filter((box) => box.textContent?.trim());
  const footer = textBoxes.find((box) => box.textContent === slide.source);
  assert.ok(footer, 'source footer must be laid out');
  for (const event of slide.data.events) {
    const dateBox = textBoxes.find((box) => box.textContent === event.date);
    const textBox = textBoxes.find((box) => box.textContent === event.text);
    assert.ok(dateBox, `event date laid out: ${event.date}`);
    assert.ok(textBox, `event text laid out: ${event.date}`);
    assert.ok(textBox.top + textBox.height < footer.top - 24, `event text stays above the source footer: ${event.date}`);
  }
  await inspect(await engine.renderSlideToBuffer(slide, 4, 5));
});

test('breakdown and impact accept six items at every render boundary', async () => {
  // Batas item daftar editorial dinaikkan 4 -> 6 (audit owner 2026-11-24):
  // daftar enam tersangka/barang bukti harus lolos validasi dan ter-render
  // utuh dalam satu slide, bukan terbelah dengan penomoran mengulang.
  const sixBreakdown = { ...slides[2], data: { ...slides[2].data, items: Array.from({ length: 6 }, (_, i) => ({ label: `Poin ${i + 1}`, value: 'Narasi' })) } };
  const sixImpact = { ...slides[5], data: { ...slides[5].data, items: Array.from({ length: 6 }, (_, i) => ({ label: `Poin ${i + 1}`, value: 'Narasi' })) } };
  // Batas atas item breakdown/impact DIBUANG atas perintah pemilik
  // 2026-11-26: tujuh item pun diterima di semua batas validasi render.
  const sevenBreakdown = { ...slides[2], data: { ...slides[2].data, items: Array.from({ length: 7 }, (_, i) => ({ label: `Poin ${i + 1}`, value: 'Narasi' })) } };
  for (const slide of [sixBreakdown, sixImpact, sevenBreakdown]) {
    for (const validate of [() => validateLayoutData(slide.layout, slide.data), () => validateSlide(slide), () => validatePreview(slide, slide.no, 7), () => engine.resolveLayout(slide, slide.no, 7)]) {
      assert.doesNotThrow(validate, `${slide.layout}: six items must be accepted`);
    }
  }
  await inspect(await engine.renderSlideToBuffer(sixBreakdown, sixBreakdown.no, 7));
});

test('impact items render as uniform numbered rows like breakdown and stay within the slide budget', async () => {
  const slide = {
    layout: 'editorial-impact', no: 4, source,
    teks: 'Jadwal keputusan dan tekanan pasar membuat status Indonesia terus dipantau pelaku pasar.',
    data: {
      title: 'Jadwal keputusan dan tekanan yang dihadapi pasar', kicker: 'Pasar saham RI',
      items: [
        { label: 'Batas konsultasi', value: 'Masukan hingga 30 April 2027; keputusan paling lambat 30 Juni 2027' },
        { label: 'Reaksi pasar', value: 'Jakarta Composite naik 1,59% ke 5.228,24, sementara rupiah menguat 0,57% seusai laporan Bloomberg' },
        { label: 'Tekanan pasar', value: 'Pasar senilai hampir 500 miliar dolar AS turun sekitar 40% sementara keputusan belum ada' },
      ],
    },
  };
  const tree = engine.resolveLayout(slide, 4, 5);
  assert.ok(!nodes(tree).some((node) => String(node.props?.style?.borderLeft || '').includes('5px')), 'impact items no longer use left border bars');
  for (const item of slide.data.items) {
    const node = nodes(tree).find((n) => n.props?.children === item.value);
    assert.ok(node, `item value rendered: ${item.label}`);
    assert.ok(Number.parseInt(node.props.style.fontSize, 10) <= 34, 'item values stay at breakdown scale (<= 34px)');
    assert.notEqual(node.props.style.fontWeight, 700, 'item values are regular weight like breakdown');
  }
  await inspect(await engine.renderSlideToBuffer(slide, 4, 5));
});
