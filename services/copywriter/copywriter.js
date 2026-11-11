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

/**
 * Pecah teks menjadi beberapa bagian utuh tanpa memotong kata/kalimat.
 * Dipakai agar carousel tidak pernah membuang informasi (tidak ada "...").
 */
export function chunkText(text, maxChars = 300) {
  const clean = cleanSentence(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      pushCurrent();
      // Kalimat ekstrem panjang: pecah per kata, jangan per karakter.
      let buf = '';
      for (const word of sentence.split(/\s+/)) {
        if ((buf ? buf + ' ' : '') .length + word.length > maxChars && buf) {
          chunks.push(buf.trim());
          buf = word;
        } else {
          buf = buf ? `${buf} ${word}` : word;
        }
      }
      if (buf.trim()) chunks.push(buf.trim());
      continue;
    }
    if ((current ? current + ' ' : '').length + sentence.length > maxChars && current) {
      pushCurrent();
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  pushCurrent();
  return chunks;
}

/** Normalisasi nomor slide setelah injeksi/pemecahan. */
function renumberSlides(slides) {
  slides.forEach((slide, idx) => {
    slide.no = idx + 1;
  });
  return slides;
}

/** Label kredibilitas dari confidence 0-100. */
function credibilityLabel(confidence) {
  const n = parseInt(confidence, 10) || 0;
  if (n >= 85) return 'Tinggi';
  if (n >= 65) return 'Sedang';
  return 'Rendah';
}

/**
 * Slide verifikasi dari laporan Agen Verifikator (bila tersedia).
 */
export function buildVerificationSlide(verification, topic, slideNo) {
  if (!verification) return null;
  const v = typeof verification === 'string' ? { status: verification } : verification;
  const corroboration = v.corroboration || {};
  const examples = corroboration.google_news?.examples || [];
  const misconceptions = Array.isArray(v.misconceptions) ? v.misconceptions : [];
  const claim =
    v.claim ||
    (Array.isArray(v.claims) && v.claims[0]?.claim) ||
    topic.title;

  const sources = examples
    .filter((e) => e && (e.url || e.domain))
    .slice(0, 3)
    .map((e) => `${e.domain || 'sumber'}${e.title ? ` — ${String(e.title).slice(0, 90)}` : ''}`);

  return {
    no: slideNo,
    layout: 'verifikasi',
    teks: claim,
    data: {
      status: v.status || 'unverified',
      claim,
      explanation: v.deep_explanation || v.summary || '',
      misconception: misconceptions[0] || '',
      sources,
      credibility: credibilityLabel(v.confidence),
      confidence: v.confidence || 0,
    },
    source: topic.primary_source || '@gapuramedia',
  };
}

/** Blok catatan verifikasi untuk caption. */
export function verificationCaptionBlock(verification) {
  if (!verification) return '';
  const statusLabel = {
    verified: 'TERVERIFIKASI',
    mostly_verified: 'SEBAGIAN BESAR TERVERIFIKASI',
    needs_context: 'PERLU KONTEKS',
    unverified: 'BELUM TERVERIFIKASI',
    opinion: 'OPINI / ANALISIS',
    speculation: 'SPEKULASI',
    misleading: 'BERPOTENSI MENYESATKAN',
    hoax_detected: 'HOAKS / TIDAK VALID',
  }[verification.status] || 'BELUM TERVERIFIKASI';

  const lines = [`Catatan Verifikasi — ${statusLabel} (keyakinan ${verification.confidence || 0}%)`];
  if (verification.summary) lines.push(verification.summary);
  if (verification.deep_explanation) lines.push(verification.deep_explanation);
  if (Array.isArray(verification.misconceptions) && verification.misconceptions[0]) {
    lines.push(`Yang sering disalahpahami: ${verification.misconceptions[0]}`);
  }
  if (verification.disclaimer) lines.push(verification.disclaimer);
  return lines.join('\n');
}

// Generator Carousel Data-Editorial Deterministik yang Menyesuaikan Isi Berita secara Cerdas
/**
 * Slide penutup standar (CTA + disclaimer). Dipakai baik oleh jalur
 * deterministik maupun jalur AI Designer agar carousel selalu punya penutup
 * dan slide verifikasi tidak pernah jatuh di posisi terakhir.
 */
export function buildCloseSlide(topic) {
  const isRegulasi = /ojk|pojk|peraturan|uu|hukum|sanksi|denda|aturan/i.test(topic.title);
  const isCurrency = /rupiah|dolar|kurs|valas|nilai tukar/i.test(topic.title);
  const isMarket = /ihsg|saham|bursa|emiten|dividen|pasar modal/i.test(topic.title);

  const question = isCurrency
    ? 'Bagaimana pergerakan kurs ini memengaruhi biaya operasional dan investasimu?'
    : isRegulasi
    ? 'Apakah institusi dan portofoliomu sudah siap memenuhi kepatuhan aturan baru ini?'
    : isMarket
    ? 'Bagaimana strategimu menyikapi dinamika dan likuiditas bursa saat ini?'
    : 'Bagaimana tren data makro ini memengaruhi keputusan finansialmu ke depan?';

  return {
    no: 0,
    layout: 'cta-close',
    teks: question,
    data: {
      cta: 'Simpan postingan ini & ikuti @gapuramedia untuk update data, hukum, dan ekonomi bursa harian.',
      disclaimer: isRegulasi
        ? 'Konten ini disajikan untuk edukasi hukum & regulasi publik, bukan merupakan nasihat hukum resmi.'
        : 'Konten ini disajikan untuk edukasi data pasar publik, bukan merupakan rekomendasi investasi beli/jual saham.',
    },
    source: '@gapuramedia',
  };
}

export function buildDeterministicCarouselSlides(topic, verification = null) {
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

  // Slide 1: Cover murni — hanya judul + angka utama bila benar-benar informatif.
  const hasNumericHook = Boolean(pojkMatch || rupiahMatch || dollarMatch || percentMatch || poinMatch);
  slides.push({
    no: 1,
    layout: 'cover-focus',
    teks: topic.title,
    data: {
      title: topic.title,
      ...(hasNumericHook ? { value: hookValue, unit: hookUnit } : {}),
    },
    source: topic.primary_source || '@gapuramedia',
  });

  // Slide 2+: Big Statement (konteks inti) — teks panjang dipecah ke slide lanjutan,
  // bukan dipotong dengan "...".
  const s1Chunks = chunkText(s1, 300);
  s1Chunks.forEach((chunk, idx) => {
    slides.push({
      no: slides.length + 1,
      layout: 'big-statement',
      teks: chunk,
      data: {
        author: idx === 0 ? topic.primary_source || 'Otoritas Terkait' : null,
        category: idx === 0 ? 'FAKTA KUNCI' : 'LANJUTAN KONTEKS',
      },
      source: topic.primary_source || '@gapuramedia',
    });
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
      source: topic.primary_source || '@gapuramedia',
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
        source: topic.primary_source || '@gapuramedia',
      });
    } else {
      const s2Text = s2 !== s1 ? s2 : 'Pencatatan data ini menjadi indikator penting dalam mengukur arah stabilitas fundamental ekonomi dan sentimen pasar modal nasional.';
      chunkText(s2Text, 300).forEach((chunk, idx) => {
        slides.push({
          no: slides.length + 1,
          layout: 'big-statement',
          teks: chunk,
          data: {
            author: idx === 0 ? topic.primary_source : null,
            category: idx === 0 ? 'SOROTAN DATA' : 'LANJUTAN DATA',
          },
          source: topic.primary_source || '@gapuramedia',
        });
      });
    }
  }

  // Slide 4+: Implikasi Nyata (Comparison) — teks utuh, dipecah bila perlu.
  const leftText = s2.length > 25 ? s2 : 'Faktor katalis domestik dan stabilitas likuiditas menjadi penopang utama.';
  const rightText = s3.length > 25 && s3 !== s2 ? s3 : 'Pelaku pasar perlu mencermati transmisi kebijakan terhadap pergerakan suku bunga dan portofolio.';
  const leftChunks = chunkText(leftText, 320);
  const rightChunks = chunkText(rightText, 320);
  const comparisonParts = Math.max(leftChunks.length, rightChunks.length);

  for (let i = 0; i < comparisonParts; i++) {
    slides.push({
      no: slides.length + 1,
      layout: 'comparison',
      teks: comparisonParts > 1 ? `Dampak & Implikasi bagi Pelaku Pasar (${i + 1}/${comparisonParts})` : 'Dampak & Implikasi bagi Pelaku Pasar',
      data: {
        left: {
          title: i === 0 ? (isRegulasi ? 'Fokus Regulasi' : 'Kondisi Pemicu') : 'Lanjutan Konteks',
          text: leftChunks[i] || '—',
        },
        right: {
          title: i === 0 ? (isRegulasi ? 'Kewajiban Pelaku' : 'Arah Prospek') : 'Lanjutan Dampak',
          text: rightChunks[i] || '—',
        },
        category: 'ANALISIS DAMPAK',
      },
      source: topic.primary_source || '@gapuramedia',
    });
  }

  // Slide 5: CTA Close (Penutup, Pertanyaan Diskusi & Disclaimer)
  const verificationSlide = buildVerificationSlide(verification, topic, slides.length + 1);
  if (verificationSlide) slides.push(verificationSlide);

  slides.push({ ...buildCloseSlide(topic), no: slides.length + 1 });

  let caption = `${topic.title}\n\n${topic.summary || ''}\n\nAnalisis Editorial:\nLangkah dan data yang dilaporkan oleh ${topic.primary_source || 'otoritas'} ini memperlihatkan perkembangan penting yang patut dicermati oleh pelaku pasar, investor, dan pengambil keputusan. Informasi faktual ini memberikan gambaran objektif mengenai arah kebijakan dan stabilitas fundamental ekonomi nasional.\n\nSumber Data: ${topic.primary_source} (${topic.url})\n\n---\nDisclaimer: Informasi disajikan untuk tujuan edukasi publik dan bukan merupakan rekomendasi investasi beli/jual saham atau nasihat hukum resmi.`;

  const hashtags = [
    '#GapuraMedia',
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

  if (verification) {
    caption = `${caption}\n\n${verificationCaptionBlock(verification)}`;
  }

  return {
    slides: renumberSlides(slides),
    caption,
    hashtags,
    disclaimer_type: isRegulasi ? 'hukum' : 'keuangan',
    needs_review: Boolean(verification && ['hoax_detected', 'misleading', 'unverified'].includes(verification.status)),
    verification_status: verification?.status || null,
  };
}

/**
 * Build Carousel Slides: Menggabungkan kekuatan Agen Designer (Full AI) dan Copywriter
 */
export async function buildCarouselSlides(topic, verification = null) {
  const cfg = loadAgentsConfig();
  const copyCfg = cfg.copywriter || {};

  // 1. Serahkan perancangan arsitektur visual & layout carousel kepada AI DESIGNER
  let slides = [];
  try {
    const { designCarouselSlides } = await import('../designer/designer.js');
    slides = await designCarouselSlides(topic);
  } catch (desErr) {
    console.warn('[Copywriter] AI Designer error, menggunakan generator adaptif cerdas:', desErr.message);
  }

  if (!slides || slides.length === 0) {
    const fallback = buildDeterministicCarouselSlides(topic, verification);
    slides = fallback.slides;
  } else {
    // Normalisasi output AI Designer: slide 1 selalu cover murni, carousel
    // selalu punya penutup, dan slide verifikasi disisipkan sebelum penutup.
    slides = slides.filter((sl) => sl && sl.layout !== 'verifikasi');
    if (slides[0]) slides[0].layout = 'cover-focus';

    const hasCloseSlide = slides.some((sl) => /^(cta-close|cta|close|penutup)/i.test(String(sl.layout || '')));
    if (!hasCloseSlide) slides.push(buildCloseSlide(topic));

    const verSlide = buildVerificationSlide(verification, topic, 0);
    if (verSlide) {
      const insertAt = Math.max(1, slides.length - 1);
      slides.splice(insertAt, 0, verSlide);
    }
    slides = renumberSlides(slides);
  }

  // 2. Susun Caption Editorial & Hashtags oleh AGEN COPYWRITER
  const isRegulasi = /ojk|pojk|peraturan|uu|hukum|sanksi|denda|aturan/i.test(topic.title);
  let caption = `${topic.title}\n\n${topic.summary || ''}\n\nAnalisis Editorial:\nLangkah dan data yang dilaporkan oleh ${topic.primary_source || 'otoritas'} ini memperlihatkan perkembangan penting yang patut dicermati oleh pelaku pasar, investor, dan pengambil keputusan. Informasi faktual ini memberikan gambaran objektif mengenai arah kebijakan dan stabilitas fundamental ekonomi nasional.\n\nSumber Data: ${topic.primary_source} (${topic.url})\n\n---\nDisclaimer: Informasi disajikan untuk tujuan edukasi publik dan bukan merupakan rekomendasi investasi beli/jual saham atau nasihat hukum resmi.`;
  let hashtags = ['#GapuraMedia', '#DataEkonomi', '#BursaSaham', '#IHSG', '#OJK', '#Regulasi', '#PasarModal', '#EkonomiIndonesia', '#KeterbukaanInformasi'];

  const apiKey = copyCfg.api_key || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (apiKey && apiKey.trim().length > 0) {
    try {
      const prompt = `Tuliskan caption editorial Instagram 150-250 kata dan 8-12 hashtag untuk berita berikut:
Judul: ${topic.title}
Ringkasan: ${topic.summary || ''}
Sumber: ${topic.primary_source || ''}

Kembalikan HANYA format JSON valid berikut tanpa markdown wrap:
{
  "caption": "...",
  "hashtags": ["#GapuraMedia", "#DataEkonomi", "#IHSG"]
}`;
      const capResp = await callAgentLLM('copywriter', prompt, copyCfg.system_prompt || '', true);
      const capParsed = JSON.parse(capResp);
      if (capParsed.caption) caption = capParsed.caption;
      if (Array.isArray(capParsed.hashtags)) hashtags = capParsed.hashtags;
    } catch (llmErr) {
      console.warn('[Copywriter] LLM caption gagal, gunakan caption standar:', llmErr.message);
    }
  }

  if (verification) {
    caption = `${caption}\n\n${verificationCaptionBlock(verification)}`;
  }

  return {
    slides: renumberSlides(slides),
    caption,
    hashtags,
    disclaimer_type: isRegulasi ? 'hukum' : 'keuangan',
    needs_review: Boolean(verification && ['hoax_detected', 'misleading', 'unverified'].includes(verification.status)),
    verification_status: verification?.status || null,
  };
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
    const { rows: verificationRows } = await client.query(
      'SELECT * FROM verification_reports WHERE topic_id = $1 ORDER BY created_at DESC LIMIT 1',
      [topic.id]
    );
    const carouselData = await buildCarouselSlides(topic, verificationRows[0] || null);

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
         AND COALESCE(t.verification_status, '') <> 'hoax_detected'
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
