import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEditorialBrief, validateOriginalContent } from '../original-editorial.js';
import { draftContentHash } from '../draft-revision.js';
import { buildChatRequest } from '../providers.js';
import { storyFixture, storyInput, storyTopic } from './fixtures/story-editorial.js';
import { EDITORIAL_STORY_SCHEMA } from '../../copywriter/storytelling.js';

const brief = () => buildEditorialBrief(storyTopic, { editorialInput: structuredClone(storyInput), slideCount: 5 });
test('story format preserves article identity, sections and channel-native layout data', () => {
  const raw = storyFixture();
  const c = validateOriginalContent(raw, brief());
  assert.equal(c.article_metadata.headline, raw.article_metadata.headline);
  assert.equal(c.article_metadata.sections.length, 2);
  assert.ok(c.article_body.startsWith('Rute bus menuju'));
  assert.ok(c.article_body.length >= 1200);
  assert.ok(c.caption_body.length < 1200 && c.caption_body.length >= 300);
  assert.equal(new Set(c.slides.slice(1).map((slide) => slide.layout)).size, 4);
});

test('story rejects single-publisher evidence, repetitive layouts and public compliance prose', () => {
  const oneSource = brief();
  oneSource.facts = oneSource.facts.map((fact) => ({ ...fact, source_url: 'https://one.example.com/story' }));
  assert.throws(() => validateOriginalContent(storyFixture(), oneSource), /story_source_diversity/);
  const flat = storyFixture();
  flat.slides.slice(1).forEach((slide) => { slide.layout = 'editorial-lead'; delete slide.data.items; });
  assert.throws(() => validateOriginalContent(flat, brief()), /story_layout_monotony/);
  const defensive = storyFixture();
  defensive.article_metadata.sections[0].paragraphs[0].text += ' Uraian ini merupakan pembacaan laporan, bukan hasil evaluasi.';
  assert.throws(() => validateOriginalContent(defensive, brief()), /story_public_meta_comment/);
});

test('story keeps body hashtags as written (owner 2026-11-26) and still assembles the final hashtag group', () => {
  const raw = storyFixture();
  raw.caption_blocks[0].text += ' #GapuraMedia';
  raw.threads_body += ' #GapuraMedia';
  raw.hashtags.push('#gapuramedia');
  const c = validateOriginalContent(raw, brief());
  // Tagar di badan teks TIDAK lagi dihapus (perintah pemilik 2026-11-26):
  // tagar bisa menjadi subjek berita (kasus '#IdonesiaSadar' pada draf
  // Space id 12), jadi teks lolos apa adanya; grup tagar akhir tetap
  // dirakit seperti biasa.
  assert.ok(c.caption_body.includes('#GapuraMedia'));
  assert.equal((c.caption.match(/#GapuraMedia/gu) || []).length, 2);
  assert.equal((c.threads_caption.match(/#GapuraMedia/gu) || []).length, 2);
});

test('story accepts the platform maximum of 30 hashtags and fits the Threads caption by priority order', () => {
  const raw = storyFixture();
  const extra = Array.from({ length: 25 }, (_, i) => `#Topik${String(i + 1).padStart(2, '0')}`.padEnd(30, 'a'));
  raw.hashtags = [...raw.hashtags, ...extra];
  assert.equal(raw.hashtags.length, 30);
  const c = validateOriginalContent(raw, brief());
  assert.equal(c.hashtags.length, 30);
  assert.ok(c.caption.includes(extra.at(-1)));
  assert.ok(c.threads_caption.length <= 500);
  assert.ok(c.threads_caption.includes('#GapuraMedia'));
  assert.ok(!c.threads_caption.includes(extra.at(-1)));
  const tooMany = storyFixture();
  tooMany.hashtags = [...raw.hashtags, '#SatuLagi'];
  assert.throws(() => validateOriginalContent(tooMany, brief()), /hashtags_invalid/);
});

test('article, caption, carousel and Threads each expand a person at its first mention', () => {
  const raw = storyFixture(); const b = brief();
  b.facts.push({ id: 'person', text: 'Direktur Transportasi Ari Setiawan mengumumkan pengalihan rute bus kepada warga.', source_url: 'https://city.example.com/rute', source_name: 'Dishub Kota Uji' });
  raw.article_metadata.entities.push({ kind: 'person', name: 'Ari Setiawan', expansion: 'Direktur Transportasi', fact_ids: ['person'] });
  raw.article_metadata.lead.text += ' Direktur Transportasi Ari Setiawan mengumumkan pengalihan.';
  raw.article_metadata.lead.fact_ids.push('person');
  raw.article_metadata.headline = 'Ari Setiawan menjelaskan perubahan rute bus';
  assert.throws(() => validateOriginalContent(raw, b), /person_first_mention_unexpanded/);
  raw.article_metadata.headline = 'Direktur Transportasi Ari Setiawan menjelaskan perubahan rute bus';
  raw.caption_blocks[1].text += ' Ari Setiawan mengumumkan pengalihan.';
  raw.caption_blocks[1].fact_ids.push('person');
  assert.throws(() => validateOriginalContent(raw, b), /person_first_mention_unexpanded/);
  raw.caption_blocks[1].text = raw.caption_blocks[1].text.replace(' Ari Setiawan', ' Direktur Transportasi Ari Setiawan');
  raw.threads_body += ' Ari Setiawan mengumumkan pengalihan.';
  raw.threads_fact_ids.push('person');
  assert.throws(() => validateOriginalContent(raw, b), /person_first_mention_unexpanded/);
  raw.threads_body = raw.threads_body.replace(' Ari Setiawan', ' Direktur Transportasi Ari Setiawan');
  raw.slides[0].data.title = 'Ari Setiawan menjelaskan perubahan rute';
  raw.slides[0].fact_ids.push('person');
  assert.throws(() => validateOriginalContent(raw, b), /person_first_mention_unexpanded/);
  raw.slides[0].data.title = 'Direktur Transportasi Ari Setiawan menjelaskan rute';
  assert.doesNotThrow(() => validateOriginalContent(raw, b));
});

test('article metadata changes invalidate the reviewed revision but nullable history is stable', () => {
  const c = validateOriginalContent(storyFixture(), brief());
  assert.notEqual(draftContentHash(c), draftContentHash({ ...c, article_metadata: { ...c.article_metadata, headline: 'Judul diubah' } }));
  const legacy = { slides: [], caption: 'Caption', editorial_mode: 'current' };
  assert.equal(draftContentHash(legacy), draftContentHash({ ...legacy, article_metadata: null }));
});

test('story dates are accepted as written without fact-wording cross-checks (owner 2026-11-26)', () => {
  for (const source of ['November 30, 2026', '2026-11-30', '30/11/2026']) {
    const b = brief();
    b.facts.push({ id: 'dated', text: `Layanan berlaku ${source}.`, source_url: 'https://city.example.com/jadwal', source_name: 'Dishub Kota Uji' });
    const raw = storyFixture();
    const paragraph = raw.article_metadata.sections[0].paragraphs[0];
    paragraph.text += ' Layanan berlaku pada 30 November 2026.';
    paragraph.fact_ids.push('dated');
    assert.doesNotThrow(() => validateOriginalContent(raw, b), source);
    paragraph.text = paragraph.text.replace('30 November 2026', '29 November 2026');
    // Tanggal pada mode cerita tidak lagi wajib persis teks fakta
    // (perintah pemilik 2026-11-26; kasus tanggal linimasa draf Space 12).
    assert.doesNotThrow(() => validateOriginalContent(raw, b), source);
  }
});

test('story relative-date phrases are accepted as written (owner 2026-11-26)', () => {
  const raw = storyFixture();
  const paragraph = raw.article_metadata.sections[0].paragraphs[0];
  paragraph.text += ' Perubahan ini mulai dirasakan warga minggu ini dan dibahas lagi tahun ini.';
  raw.caption_blocks[0].text += ' Warga merasakan perubahan ini minggu ini.';
  // Frasa tanggal relatif pada mode cerita TIDAK lagi dilarang
  // (perintah pemilik 2026-11-26; larangan ini dulu memaksa penulisan
  // ulang teks draf Space id 10). Mode non-cerita tidak berubah.
  assert.doesNotThrow(() => validateOriginalContent(raw, brief()));
  const c = validateOriginalContent(raw, brief());
  assert.ok(c.article_body.includes('minggu ini'));
  assert.ok(c.caption_body.includes('minggu ini'));
});

test('public basis-point claims retain units and can cite every available fact', () => {
  const b = brief();
  b.facts.push({ id: 'bps', text: 'Suku bunga naik 25 bps.', source_url: 'https://city.example.com/suku-bunga', source_name: 'Kota Uji' });
  for (let index = 0; index < 4; index++) b.facts.push({ ...b.facts[0], id: `extra${index}` });
  const raw = storyFixture();
  const paragraph = raw.article_metadata.sections[0].paragraphs[0];
  paragraph.text += ' Suku bunga naik 25 basis poin.';
  paragraph.fact_ids = b.facts.map((fact) => fact.id);
  assert.doesNotThrow(() => validateOriginalContent(raw, b));
  paragraph.text = paragraph.text.replace('25 basis poin', '25 persen');
  // Angka pada mode cerita tidak lagi dicocokkan ke teks fakta
  // (perintah pemilik 2026-11-26).
  assert.doesNotThrow(() => validateOriginalContent(raw, b));
});

test('public year claims can use sourced calendar years and both bounds of a year span', () => {
  for (const source of ['Kebijakan berlaku tahun 2026-2027.', 'Kebijakan berlaku pada 18 November 2027.']) {
    const b = brief();
    b.facts.push({ id: 'year', text: source, source_url: 'https://city.example.com/tahun', source_name: 'Kota Uji' });
    const raw = storyFixture();
    const paragraph = raw.article_metadata.sections[0].paragraphs[0];
    paragraph.text += ' Kebijakan berlaku pada 2027.';
    paragraph.fact_ids.push('year');
    assert.doesNotThrow(() => validateOriginalContent(raw, b));
    paragraph.text = paragraph.text.replace('pada 2027', 'pada 2028');
    // Tahun pada mode cerita tidak lagi dicocokkan ke teks fakta
    // (perintah pemilik 2026-11-26).
    assert.doesNotThrow(() => validateOriginalContent(raw, b));
  }
});

test('story attributions are accepted as written (owner 2026-11-26); audience questions unaffected', () => {
  const raw = storyFixture();
  const closing = raw.caption_blocks.at(-1);
  closing.text = closing.text.replace('Informasi perjalanan apa', 'Menurut Anda, informasi perjalanan apa');
  assert.doesNotThrow(() => validateOriginalContent(raw, brief()));
  closing.text = closing.text.replace('Menurut Anda', 'Menurut Menteri');
  // Atribusi 'Menurut …' pada mode cerita tidak lagi dicocokkan ke nama
  // sumber fakta (perintah pemilik 2026-11-26; kasus 'Menurut Susatyo'
  // dan 'menurut Bareskrim' pada draf Space id 12).
  assert.doesNotThrow(() => validateOriginalContent(raw, brief()));
});

test('draft Space 12 cases are accepted as written after the owner relaxation 2026-11-26', () => {
  // Seluruh pola penolakan pada draf Space id 12 ("Sidang etik Listyo
  // Sigit…") kini DITERIMA apa adanya: validator menyesuaikan paket
  // Space, bukan sebaliknya (perintah pemilik 2026-11-26).
  const b = brief();
  b.facts.push({ id: 'f6', text: 'Pengalihan diduga bersifat sementara selama perbaikan berlangsung.', source_url: 'https://daily.example.org/bus', source_name: 'Harian Kota Uji' });
  const raw = storyFixture();
  // (1) Linimasa 6 peristiwa (dulu maks 5) dengan tanggal bernama hari dan
  // tanggal gabungan yang tidak tertulis persis di fakta.
  raw.slides[3] = { no: 4, role: 'chronology', purpose: 'Urutan kejadian', claim_type: 'fact',
    fact_ids: ['f1', 'f2', 'f3', 'f4', 'f5'], layout: 'editorial-timeline', teks: '',
    data: { title: 'Urutan kejadian perkara rute', kicker: 'LINIMASA', events: [
      { date: 'Senin, 3 November 2026', text: 'Dinas mengumumkan pengalihan rute melalui Terminal Jaya.', fact_ids: ['f1'] },
      { date: '4 dan 5 November 2026', text: 'Operator menambah bus pada jam sekolah untuk rute pengganti.', fact_ids: ['f2'] },
      { date: 'Rabu, 5 November 2026', text: 'Forum warga melaporkan kebutuhan berpindah kendaraan di terminal.', fact_ids: ['f3'] },
      { date: 'Kamis, 6 November 2026', text: 'Peta rute pengganti dipasang di halte dan kantor layanan.', fact_ids: ['f4'] },
      { date: 'Jumat, 7 November 2026', text: 'Petugas menerima pertanyaan warga mengenai titik perpindahan.', fact_ids: ['f5'] },
      { date: 'Sabtu, 8 November 2026', text: 'Layanan rute pengganti berjalan dengan titik perpindahan yang sama.', fact_ids: ['f1'] },
    ] } };
  // (2) Daftar breakdown 7 item (dulu maks 6) tetap satu slide.
  raw.slides[2].data.items.push(
    { label: 'Halte', value: 'Peta terpasang' }, { label: 'Terminal', value: 'Titik pindah' },
    { label: 'Sekolah', value: 'Jam berangkat' }, { label: 'Warga', value: 'Bertanya petugas' },
  );
  // (3) Pertanyaan penutup 203+ karakter (dulu maks 200).
  raw.slides[4].data.question = 'Menurutmu, informasi perjalanan seperti apa yang paling kamu butuhkan ketika rute bus berubah, titik perpindahan berpindah tempat, dan jadwal layanan sekolah ikut menyesuaikan selama jembatan lama diperbaiki?';
  // (4) Takeaways 5 (dulu maks 4) dan sections 7 (dulu maks 6).
  raw.article_metadata.takeaways.push(
    { text: 'Peta rute pengganti tersedia di halte dan kantor layanan.', fact_ids: ['f4'] },
    { text: 'Petugas layanan menerima pertanyaan arah perjalanan warga.', fact_ids: ['f5'] },
  );
  for (let i = 0; i < 5; i++) raw.article_metadata.sections.push({ heading: `Bagian tambahan ${i + 1}`,
    paragraphs: [{ text: 'Rincian layanan rute pengganti dijelaskan kembali agar warga memahami titik perpindahan dan arah perjalanan bus selama perbaikan jembatan berlangsung.', fact_ids: ['f1'] }] });
  // (5) Tagar subjek berita di caption lolos apa adanya.
  raw.caption_blocks[0].text += ' Tagar #IdonesiaSadar ramai dibahas warga.';
  // (6) Kutipan langsung yang tidak terdaftar sebagai fact.quote, atribusi
  // di luar nama sumber fakta, dan angka yang tidak ada di fakta.
  raw.article_metadata.sections[0].paragraphs[0].text += ' “Kami siap melayani warga,” kata Petugas Lapangan. Menurut Kepala Dinas, 25 halte memasang peta baru.';
  // (7) Fakta berkualifier ('diduga') dirujuk teks tanpa kata kualifier.
  raw.article_metadata.sections[1].paragraphs[0].text += ' Petugas menetapkan titik perpindahan di Terminal Jaya untuk semua rute pengganti.';
  raw.article_metadata.sections[1].paragraphs[0].fact_ids.push('f6');
  const c = validateOriginalContent(raw, b);
  assert.equal(c.slides[3].data.events.length, 6);
  assert.equal(c.slides[3].data.events[0].date, 'Senin, 3 November 2026');
  assert.equal(c.slides[3].data.events[1].date, '4 dan 5 November 2026');
  assert.equal(c.slides[2].data.items.length, 7);
  assert.ok(c.slides[4].data.question.length > 200);
  assert.equal(c.article_metadata.takeaways.length, 5);
  assert.equal(c.article_metadata.sections.length, 7);
  assert.ok(c.caption_body.includes('#IdonesiaSadar'));
  assert.ok(c.article_body.includes('Menurut Kepala Dinas, 25 halte'));
});

test('Gemini structured generation receives the editorial JSON schema', () => {
  const request = buildChatRequest({ kind: 'gemini', baseUrl: 'https://example.com', model: 'fixture', maxTokens: 8192 }, { prompt: 'Story', responseSchema: EDITORIAL_STORY_SCHEMA });
  assert.deepEqual(request.body.generationConfig.responseJsonSchema, EDITORIAL_STORY_SCHEMA);
  assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
});

test('story acronym first mention accepts full expansion wording even when the acronym is introduced inline', () => {
  const raw = storyFixture();
  const b = brief();
  b.facts.push({ id: 'acr', text: 'Data Survei Sosial Ekonomi Nasional (Susenas) dipakai untuk memetakan biaya hidup.', source_url: 'https://city.example.com/susenas', source_name: 'BPS Kota Uji' });
  raw.article_metadata.entities.push({ kind: 'acronym', name: 'Susenas', expansion: 'Survei Sosial Ekonomi Nasional (Susenas)', fact_ids: ['acr'] });
  const target = raw.article_metadata.sections[0].paragraphs[0];
  target.text += ' Data tersebut bersumber dari Survei Sosial Ekonomi Nasional atau disingkat sebagai Susenas terbaru.';
  target.fact_ids.push('acr');
  assert.doesNotThrow(() => validateOriginalContent(raw, b));
  target.text = target.text.replace('Survei Sosial Ekonomi Nasional atau disingkat sebagai Susenas', 'Susenas');
  assert.throws(() => validateOriginalContent(raw, b), /acronym_first_mention_unexpanded/u);
});
