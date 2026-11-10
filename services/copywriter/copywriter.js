// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Agen Copywriter & Pipeline Carousel
// File: /root/gapura/services/copywriter/copywriter.js
// ==============================================================================

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { callAgentLLM, loadAgentsConfig } from '../common/llm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const pool = new Pool({
  host: process.env.HME_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.HME_DB_PORT || '5432'),
  user: process.env.HME_DB_USER || 'hme_user',
  password: process.env.HME_DB_PASSWORD,
  database: process.env.HME_DB_NAME || 'hme',
});

const RENDER_SERVICE_URL = 'http://127.0.0.1:3000/render';
const RENDER_SECRET = process.env.RENDER_SECRET || 'dev_render_secret_hme';

function cleanSentence(s) {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').replace(/^[-–—•\s]+/, '').trim();
}

// Generator Carousel Data-Editorial Deterministik yang Menyesuaikan Isi Berita secara Cerdas
export function buildDeterministicCarouselSlides(topic) {
  const fullText = `${topic.title}. ${topic.summary || ''}`;

  // 1. Ekstraksi Angka & Entitas Faktual Nyata dari Berita
  const rupiahMatch = fullText.match(/Rp\s*([\d.,]+(?:\s*(?:triliun|miliar|juta))?)/i);
  const dollarMatch = fullText.match(/USD\s*([\d.,]+(?:\s*(?:triliun|miliar|juta))?)/i);
  const percentMatch = fullText.match(/([-+]?[\d.,]+\s*%)/);
  const poinMatch = fullText.match(/([-+]?[\d.,]+\s*poin)/i);
  const pojkMatch = fullText.match(/(POJK\s*(?:Nomor|No\.?)?\s*[\d/]+(?:\s*Tahun\s*\d{4})?|UU\s*(?:Nomor|No\.?)?\s*[\d/]+|Putusan\s*MK[^\s,.]*|Peraturan\s*[\w\s/]+)/i);

  const isRegulasi = /ojk|pojk|peraturan|uu|hukum|sanksi|denda|aturan|putusan mk|kemenkumham/i.test(fullText);
  const isMarket = /ihsg|saham|bursa|bei|idx|delisting|msci|kapitalisasi|transaksi/i.test(fullText);
  const isCurrency = /rupiah|dolar|valas|kurs|cadangan devisa|bi-rate|suku bunga/i.test(fullText);
  const isMacro = /inflasi|pdb|neraca perdagangan|ekspor|impor|apbn|pajak|kemiskinan|bps/i.test(fullText);

  // Potong kalimat-kalimat substansial dari summary
  const sentences = (topic.summary || topic.title)
    .split(/(?<=[.!?])\s+/)
    .map(cleanSentence)
    .filter((s) => s.length >= 25);

  const s1 = sentences[0] || topic.title;
  const s2 = sentences[1] || s1;
  const s3 = sentences[2] || s2;

  // Tentukan hook stat angka utama
  let hookValue = 'DATA UTAMA';
  let hookUnit = (topic.primary_source || 'DATA RESMI').toUpperCase();

  if (pojkMatch) {
    hookValue = pojkMatch[0].toUpperCase();
    hookUnit = 'REGULASI TERVERIFIKASI';
  } else if (rupiahMatch) {
    hookValue = rupiahMatch[0];
    hookUnit = isCurrency ? 'KURS PERDAGANGAN' : 'NILAI TRANSAKSI';
  } else if (dollarMatch) {
    hookValue = dollarMatch[0];
    hookUnit = 'NILAI VALAS';
  } else if (percentMatch) {
    hookValue = percentMatch[0];
    hookUnit = isMacro ? 'ANGKA REALISASI' : 'PERUBAHAN PASAR';
  } else if (poinMatch) {
    hookValue = poinMatch[0];
    hookUnit = 'PERGERAKAN INDEKS';
  } else if (isRegulasi) {
    hookValue = 'KEBIJAKAN';
    hookUnit = 'REGULASI RESMI';
  } else if (isMarket) {
    hookValue = 'PASAR MODAL';
    hookUnit = 'BURSA EFEK';
  } else {
    hookValue = 'DATA MAKRO';
    hookUnit = 'INDIKATOR RESMI';
  }

  const categoryName = isRegulasi
    ? 'HUKUM & REGULASI'
    : isCurrency
    ? 'VALUTA & MAKRO'
    : isMarket
    ? 'PASAR MODAL'
    : 'MAKRO EKONOMI';

  const slides = [];

  // Slide 1: Cover Stat (Hook Utama Berita)
  slides.push({
    no: 1,
    layout: 'cover-stat',
    teks: topic.title,
    data: {
      value: hookValue,
      unit: hookUnit,
      title: topic.title,
      category: categoryName,
    },
    source: topic.primary_source || '@homelessmedia',
  });

  // Slide 2: Big Statement (Konteks Inti Berita)
  slides.push({
    no: 2,
    layout: 'big-statement',
    teks: s1,
    data: {
      author: topic.primary_source || 'Otoritas Terkait',
      category: 'FAKTA KUNCI',
    },
    source: topic.primary_source || '@homelessmedia',
  });

  // Slide 3: Evidence (Menyesuaikan Otomatis Isi Berita)
  if (isRegulasi) {
    slides.push({
      no: 3,
      layout: 'regulasi',
      teks: s2 !== s1 ? s2 : 'Penerapan standar baru dan pengawasan ketat diberlakukan bagi seluruh institusi terkait demi kepastian hukum dan perlindungan publik.',
      data: {
        title: pojkMatch ? pojkMatch[0] : 'POIN KETENTUAN & REGULASI',
        category: 'HUKUM & REGULASI',
      },
      source: topic.primary_source || '@homelessmedia',
    });
  } else {
    // Siapkan items untuk stat-grid dari fakta yang terdeteksi di berita
    const statItems = [];
    if (rupiahMatch) statItems.push({ label: 'Nilai Kurs', value: rupiahMatch[0] });
    if (percentMatch) statItems.push({ label: 'Perubahan', value: percentMatch[0] });
    if (poinMatch) statItems.push({ label: 'Pergeseran Poin', value: poinMatch[0] });
    if (dollarMatch) statItems.push({ label: 'Patokan Valas', value: dollarMatch[0] });

    if (statItems.length >= 2) {
      slides.push({
        no: 3,
        layout: 'stat-grid',
        teks: 'Indikator & Realisasi Angka Penting',
        data: {
          items: statItems.slice(0, 4),
          category: 'BEDAH DATA',
        },
        source: topic.primary_source || '@homelessmedia',
      });
    } else {
      slides.push({
        no: 3,
        layout: 'big-statement',
        teks: s2 !== s1 ? s2 : 'Pencatatan data ini menjadi indikator penting dalam mengukur arah stabilitas fundamental ekonomi dan sentimen pasar modal nasional.',
        data: {
          author: topic.primary_source,
          category: 'SOROTAN DATA',
        },
        source: topic.primary_source || '@homelessmedia',
      });
    }
  }

  // Slide 4: Implikasi Nyata (Comparison)
  slides.push({
    no: 4,
    layout: 'comparison',
    teks: 'Dampak & Implikasi bagi Pelaku Pasar',
    data: {
      left: {
        title: isRegulasi ? 'Fokus Regulasi' : 'Kondisi Pemicu',
        text: s2.length > 25 ? s2.slice(0, 140) + '...' : 'Faktor katalis domestik dan stabilitas likuiditas menjadi penopang utama.',
      },
      right: {
        title: isRegulasi ? 'Kewajiban Pelaku' : 'Arah Prospek',
        text: s3.length > 25 && s3 !== s2 ? s3.slice(0, 140) + '...' : 'Pelaku pasar perlu mencermati transmisi kebijakan terhadap pergerakan suku bunga dan portofolio.',
      },
      category: 'ANALISIS DAMPAK',
    },
    source: topic.primary_source || '@homelessmedia',
  });

  // Slide 5: CTA Close (Penutup, Pertanyaan Diskusi & Disclaimer)
  const questionTopic = isCurrency
    ? 'Bagaimana pergerakan kurs ini memengaruhi biaya operasional dan investasimu?'
    : isRegulasi
    ? 'Apakah institusi dan portofoliomu sudah siap memenuhi kepatuhan aturan baru ini?'
    : isMarket
    ? 'Bagaimana strategimu menyikapi dinamika dan likuiditas bursa saat ini?'
    : 'Bagaimana tren data makro ini memengaruhi keputusan finansialmu ke depan?';

  slides.push({
    no: 5,
    layout: 'cta-close',
    teks: questionTopic,
    data: {
      cta: 'Simpan postingan ini & ikuti @homelessmedia untuk update data, hukum, dan ekonomi bursa harian.',
      disclaimer: isRegulasi
        ? 'Konten ini disajikan untuk edukasi hukum & regulasi publik, bukan merupakan nasihat hukum resmi.'
        : 'Konten ini disajikan untuk edukasi data pasar publik, bukan merupakan rekomendasi investasi beli/jual saham.',
    },
    source: '@homelessmedia',
  });

  const caption = `${topic.title}\n\n${topic.summary || ''}\n\nAnalisis Editorial:\nLangkah dan data yang dilaporkan oleh ${topic.primary_source || 'otoritas'} ini memperlihatkan perkembangan penting yang patut dicermati oleh pelaku pasar, investor, dan pengambil keputusan. Informasi faktual ini memberikan gambaran objektif mengenai arah kebijakan dan stabilitas fundamental ekonomi nasional.\n\nSumber Data: ${topic.primary_source} (${topic.url})\n\n---\nDisclaimer: Informasi disajikan untuk tujuan edukasi publik dan bukan merupakan rekomendasi investasi beli/jual saham atau nasihat hukum resmi.`;

  const hashtags = [
    '#HomelessMedia',
    '#DataEkonomi',
    '#BursaSaham',
    '#IHSG',
    '#OJK',
    '#Regulasi',
    '#PasarModal',
    '#EkonomiIndonesia',
    '#InvestasiCerdas',
    '#KeterbukaanInformasi',
  ];

  return {
    slides,
    caption,
    hashtags,
    disclaimer_type: isRegulasi ? 'hukum' : 'keuangan',
    needs_review: false,
  };
}

/**
 * Build Carousel Slides: Coba pakai AI LLM dulu, jika gagal fallback ke generator cerdas
 */
export async function buildCarouselSlides(topic) {
  const cfg = loadAgentsConfig();
  const copyCfg = cfg.copywriter || {};

  // Jika API Key tersedia, gunakan LLM dinamis
  if (copyCfg.api_key && copyCfg.api_key.trim().length > 0) {
    try {
      const prompt = `Analisis mendalam berita berikut dan buat carousel Instagram 5 slide yang MENYAMPAIKAN INFORMASI SECARA UTUH, PADAT FAKTA, dan MENYESUAIKAN DINAMIS DENGAN ISI BERITA:
Judul: ${topic.title}
Ringkasan Faktual: ${topic.summary || ''}
Sumber Primer: ${topic.primary_source || ''}
URL: ${topic.url || ''}

PILIH LAYOUT TERBAIK UNTUK SETIAP SLIDE dari 7 opsi layout berikut:
1. "cover-stat" -> Hook angka/persen tajam di cover (data: { value: "Angka/Stat Besar", unit: "Unit/Keterangan", title: "Judul", category: "Kategori" })
2. "big-statement" -> Kutipan pernyataan narasumber atau fakta kunci (data: { author: "Narasumber/Instansi", category: "Kategori" })
3. "stat-grid" -> 2-4 kotak metrik angka penting (data: { items: [{ label: "...", value: "..." }], category: "Kategori" })
4. "regulasi" -> Poin aturan OJK/UU/POJK/putusan hukum (data: { title: "Nama Regulasi/Pasal" })
5. "comparison" -> Perbandingan sebelum vs sesudah atau katalis vs dampak (data: { left: { title: "...", text: "..." }, right: { title: "...", text: "..." }, category: "Kategori" })
6. "timeline" -> Tahapan kronologis peristiwa (data: { events: [{ date: "...", text: "..." }] })
7. "cta-close" -> Slide penutup berisi pertanyaan reflektif & CTA (data: { cta: "...", disclaimer: "..." })

ATURAN WAJIB:
- DILARANG MENGGUNAKAN DATA PALSU/FIKTIF. Ekstrak fakta, angka, nama pejabat/instansi langsung dari teks berita di atas.
- Teks narasi di setiap slide harus padat, informatif, dan mudah dipahami pembaca Instagram.
- Kembalikan HANYA format JSON valid berikut tanpa markdown wrap:
{
  "slides": [
    { "no": 1, "layout": "cover-stat", "teks": "Judul/Hook", "data": { ... }, "source": "..." },
    { "no": 2, "layout": "big-statement", "teks": "...", "data": { ... }, "source": "..." },
    { "no": 3, "layout": "stat-grid" | "regulasi" | "big-statement", "teks": "...", "data": { ... }, "source": "..." },
    { "no": 4, "layout": "comparison" | "big-statement", "teks": "...", "data": { ... }, "source": "..." },
    { "no": 5, "layout": "cta-close", "teks": "Pertanyaan reflektif?", "data": { "cta": "...", "disclaimer": "..." }, "source": "@homelessmedia" }
  ],
  "caption": "Caption 150-250 kata berstruktur rapi...",
  "hashtags": ["#HomelessMedia", "#DataEkonomi", "#IHSG"],
  "disclaimer_type": "keuangan" | "hukum",
  "needs_review": false
}`;

      const aiResponse = await callAgentLLM('copywriter', prompt, copyCfg.system_prompt || '', true);
      const parsed = JSON.parse(aiResponse);
      if (parsed && Array.isArray(parsed.slides) && parsed.slides.length >= 3) {
        console.log(`[Copywriter] Sukses menghasilkan konten dinamis adaptif via AI LLM (${copyCfg.model || 'llm'})`);
        return parsed;
      }
    } catch (llmErr) {
      console.warn('[Copywriter] LLM gagal, menggunakan generator cerdas deterministik:', llmErr.message);
    }
  }

  return buildDeterministicCarouselSlides(topic);
}

/**
 * Menghasilkan dan menyimpan draf untuk satu topik spesifik
 */
export async function produceSingleTopicDraft(topic, dbClient = null) {
  const client = dbClient || (await pool.connect());
  const shouldRelease = !dbClient;

  try {
    // Cek apakah draf sudah ada
    const { rows: existing } = await client.query('SELECT id FROM drafts WHERE topic_id = $1 LIMIT 1', [topic.id]);
    if (existing.length > 0) {
      return { draft_id: existing[0].id, is_existing: true };
    }

    console.log(`[Copywriter] Memproduksi draf untuk Topik #${topic.id}: "${topic.title}"...`);
    const carouselData = await buildCarouselSlides(topic);

    // 1. Simpan ke tabel drafts
    const insertDraft = await client.query(
      `INSERT INTO drafts (topic_id, slides, caption, hashtags, disclaimer_type, status, needs_review, tokens_version, copy_model)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, 'v1.0', 'data-editorial-engine-v2')
       RETURNING id`,
      [
        topic.id,
        JSON.stringify(carouselData.slides),
        carouselData.caption,
        carouselData.hashtags,
        carouselData.disclaimer_type || 'keuangan',
        carouselData.needs_review || false,
      ]
    );

    const draftId = insertDraft.rows[0].id;
    console.log(`[Copywriter] Draf #${draftId} disimpan ke DB. Mengirim ke Render Service...`);

    // 2. Render seluruh slide ke PNG melalui Render Service
    const renderResp = await fetch(RENDER_SERVICE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Render-Secret': RENDER_SECRET,
      },
      body: JSON.stringify({
        draft_id: draftId,
        slides: carouselData.slides,
      }),
    });

    if (!renderResp.ok) {
      const errText = await renderResp.text();
      throw new Error(`Render Service error: HTTP ${renderResp.status} - ${errText}`);
    }

    const renderData = await renderResp.json();
    console.log(`[Copywriter] Render berhasil: ${renderData.rendered_slides.length} slide dalam ${renderData.total_time_ms} ms.`);

    // 3. Simpan record slide ke draft_slides
    for (const slideRes of renderData.rendered_slides) {
      await client.query(
        `INSERT INTO draft_slides (draft_id, slide_no, layout, render_path, text_snapshot, data_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (draft_id, slide_no) DO UPDATE
         SET render_path = EXCLUDED.render_path, rendered_at = NOW()`,
        [
          draftId,
          slideRes.slide_no,
          slideRes.layout,
          slideRes.file_path,
          carouselData.slides[slideRes.slide_no - 1]?.teks || '',
          JSON.stringify(carouselData.slides[slideRes.slide_no - 1]?.data || {}),
        ]
      );
    }

    // 4. Update status topik menjadi 'produced'
    await client.query("UPDATE topics SET status = 'produced', updated_at = NOW() WHERE id = $1", [topic.id]);

    // 5. Catat audit_log
    await client.query(
      `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
       VALUES ('draft', $1, 'produced', 'copywriter-engine', $2)`,
      [draftId, JSON.stringify({ slides_count: carouselData.slides.length, total_time_ms: renderData.total_time_ms })]
    );

    return { draft_id: draftId, is_existing: false, slides_count: carouselData.slides.length };
  } finally {
    if (shouldRelease) client.release();
  }
}

/**
 * Runner pipeline untuk memproduksi sejumlah topik teratas
 */
export async function runCopywriter(maxDrafts = 3) {
  const client = await pool.connect();
  const startTime = Date.now();
  console.log(`[Copywriter] Memulai produksi draf (Maksimal ${maxDrafts} draf)...`);

  let produced = 0;

  try {
    const { rows: scoredTopics } = await client.query(
      `SELECT t.*, ts.score_total
       FROM topics t
       JOIN topic_scores ts ON t.id = ts.topic_id
       WHERE t.status = 'scored'
       ORDER BY ts.score_total DESC, t.id ASC
       LIMIT $1`,
      [maxDrafts]
    );

    console.log(`[Copywriter] Ditemukan ${scoredTopics.length} topik siap produksi.`);

    for (const topic of scoredTopics) {
      await produceSingleTopicDraft(topic, client);
      produced++;
    }

    const durationMs = Date.now() - startTime;
    return { produced, durationMs };
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCopywriter(3)
    .then((res) => {
      console.log('Copywriter run complete:', res);
      pool.end();
    })
    .catch((err) => {
      console.error('Copywriter run error:', err);
      pool.end();
      process.exit(1);
    });
}
