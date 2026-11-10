// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Agen Copywriter & Pipeline Carousel
// File: /root/gapura/services/copywriter/copywriter.js
// ==============================================================================

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  host: process.env.HME_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.HME_DB_PORT || '5432'),
  user: process.env.HME_DB_USER || 'hme_user',
  password: process.env.HME_DB_PASSWORD,
  database: process.env.HME_DB_NAME || 'hme',
});

const RENDER_SERVICE_URL = 'http://127.0.0.1:3000/render';
const RENDER_SECRET = process.env.RENDER_SECRET || 'dev_render_secret_hme';

// Generator Carousel Data-Editorial Deterministik
function buildCarouselSlides(topic) {
  const isRegulasi = /ojk|pojk|peraturan|uu|hukum|sanksi|denda|aturan/i.test(topic.title);
  const isMarket = /ihsg|saham|bursa|bei|idx|delisting|msci/i.test(topic.title);

  const slides = [];

  // Slide 1: Cover Stat (Hook)
  slides.push({
    no: 1,
    layout: 'cover-stat',
    teks: topic.title,
    data: {
      value: isRegulasi ? 'REGULASI' : isMarket ? 'BURSA SAHAM' : 'DATA EKONOMI',
      unit: topic.primary_source.toUpperCase(),
      title: topic.title,
      category: isRegulasi ? 'HUKUM & REGULASI' : isMarket ? 'PASAR MODAL' : 'MAKRO EKONOMI',
    },
    source: topic.primary_source,
  });

  // Slide 2: Big Statement (Konteks Peristiwa)
  slides.push({
    no: 2,
    layout: 'big-statement',
    teks: topic.summary && topic.summary.length > 20
      ? topic.summary.slice(0, 180) + '...'
      : `Perkembangan strategis terkait ${topic.title} menjadi perhatian pelaku pasar dan pengambil kebijakan di Indonesia.`,
    data: {
      author: topic.primary_source,
      category: 'KONTEKS BERITA',
    },
    source: topic.primary_source,
  });

  // Slide 3: Evidence (Chart atau Regulasi Box)
  if (isRegulasi) {
    slides.push({
      no: 3,
      layout: 'regulasi',
      teks: `Ketentuan kepatuhan: Penerapan sanksi dan pengawasan ketat diberlakukan untuk menjaga integritas pasar serta perlindungan hak investor dan masyarakat.`,
      data: {
        title: 'POIN KEBIJAKAN & REGULASI RESMI',
      },
      source: topic.primary_source,
    });
  } else {
    slides.push({
      no: 3,
      layout: 'chart-bar',
      teks: 'Sorotan Dampak terhadap Sektor Terkait',
      data: {
        labels: ['Sektor Keuangan', 'Pasar Modal', 'Sentimen Ritel', 'Likuiditas'],
        values: [75, 85, 60, 70],
        category: 'ANALISIS DAMPAK',
      },
      source: topic.primary_source,
    });
  }

  // Slide 4: Comparison / Stat Grid (Implikasi Pasar)
  slides.push({
    no: 4,
    layout: 'comparison',
    teks: 'Implikasi Kebijakan: Sebelum vs Sesudah',
    data: {
      left: {
        title: 'Sebelumnya',
        text: 'Pengawasan dan batasan transaksi berjalan berdasarkan parameter evaluasi berkala.',
      },
      right: {
        title: 'Saat Ini',
        text: 'Standarisasi kepatuhan diperketat secara real-time guna meminimalkan risiko volatilitas asimetris.',
      },
      category: 'IMPLIKASI',
    },
    source: topic.primary_source,
  });

  // Slide 5: CTA Close
  slides.push({
    no: 5,
    layout: 'cta-close',
    teks: 'Bagaimana langkah ini memengaruhi strategi investasi dan kepatuhan bisnismu?',
    data: {
      cta: 'Simpan postingan ini & ikuti @homelessmedia untuk update data harian.',
      disclaimer: isRegulasi
        ? 'Konten ini disajikan untuk edukasi hukum & regulasi publik, bukan merupakan nasihat hukum resmi.'
        : 'Konten ini disajikan untuk edukasi data pasar, bukan merupakan rekomendasi investasi keuangan.',
    },
    source: '@homelessmedia',
  });

  const caption = `${topic.title}\n\n${topic.summary || ''}\n\nAnalisis Editorial:\nLangkah yang dirilis oleh ${topic.primary_source} ini memperlihatkan fokus berkelanjutan otoritas dalam memperkuat tata kelola sektor keuangan dan stabilitas bursa nasional. Informasi faktual ini penting dicermati oleh pelaku pasar dan investor untuk mengukur arah likuiditas serta kepatuhan jangka menengah.\n\nSumber Data: ${topic.primary_source} (${topic.url})\n\n---\nDisclaimer: Informasi disajikan untuk tujuan edukasi data publik dan bukan merupakan rekomendasi investasi beli/jual saham atau nasihat hukum.`;

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

export async function runCopywriter(maxDrafts = 3) {
  const client = await pool.connect();
  const startTime = Date.now();
  console.log(`[Copywriter] Memulai produksi draf (Maksimal ${maxDrafts} draf)...`);

  let produced = 0;

  try {
    // Ambil topik berstatus 'scored'
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
      console.log(`\n[Copywriter] Memproduksi draf untuk topik #${topic.id}: "${topic.title}" (Skor: ${topic.score_total})`);

      const carouselData = buildCarouselSlides(topic);

      // Simpan draf ke tabel drafts terlebih dahulu untuk mendapatkan ID draf
      const insertDraft = await client.query(
        `INSERT INTO drafts (topic_id, slides, caption, hashtags, disclaimer_type, status, needs_review, tokens_version, copy_model)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, 'v1.0', 'data-editorial-engine-v2')
         RETURNING id`,
        [
          topic.id,
          JSON.stringify(carouselData.slides),
          carouselData.caption,
          carouselData.hashtags,
          carouselData.disclaimer_type,
          carouselData.needs_review,
        ]
      );

      const draftId = insertDraft.rows[0].id;
      console.log(`[Copywriter] Draf tercatat di DB dengan ID #${draftId}. Mengirim ke Render Service...`);

      // Panggil Render Service HTTP API
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
      console.log(`[Copywriter] Sukses merender ${renderData.rendered_slides.length} slide PNG dalam ${renderData.total_time_ms} ms!`);

      // Simpan setiap slide ke draft_slides
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

      // Update status topik menjadi 'produced'
      await client.query("UPDATE topics SET status = 'produced', updated_at = NOW() WHERE id = $1", [topic.id]);

      // Catat ke audit_log
      await client.query(
        `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
         VALUES ('draft', $1, 'produced', 'copywriter-engine', $2)`,
        [draftId, JSON.stringify({ slides_count: carouselData.slides.length, total_time_ms: renderData.total_time_ms })]
      );

      produced++;
      console.log(`[Copywriter] [SUKSES SELESAI] Draf #${draftId} siap di antrean Telegram review!`);
    }

    // Telemetri Copywriter
    const durationMs = Date.now() - startTime;
    await client.query(
      `INSERT INTO agent_runs (agent, started_at, completed_at, status, model, tokens_input, tokens_output, est_cost_idr)
       VALUES ('copywriter', NOW(), NOW(), 'success', 'data-editorial-engine-v2', $1, $2, 0.00)`,
      [produced * 400, produced * 300]
    );

    console.log(`\n[Copywriter] Pipeline tuntas: ${produced} draf carousel berhasil diproduksi.`);
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
