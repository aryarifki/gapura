// ==============================================================================
// GME v2.1 - Agen Verifikator (Fact-Check & Anti-Miskonsepsi)
// File: /root/gapura/services/verificator/verificator.js
// ------------------------------------------------------------------------------
// Memverifikasi berita: valid / opini / spekulasi / menyesatkan / hoaks.
// Pendekatan berlapis (tidak mengarang putusan):
//   1. Sinyal deterministik  : tier sumber, klaim angka, kata hedge/clickbait,
//                              kebaruan, dan penanda misinformasi.
//   2. Korroborasi           : Google News RSS lintas domain + kemiripan judul
//                              lokal (pg_trgm) terhadap topik lain.
//   3. Penilaian LLM         : rubrik verifikasi + penjelasan mendalam.
//   4. Fallback heuristik    : bila LLM gagal, status tetap jujur "belum
//                              terverifikasi otomatis" + disclaimer redaksi.
// ==============================================================================

import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fetchFeed, googleNewsRssUrl, domainOf } from '../common/rss.js';
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

const MAJOR_MEDIA = [
  'antaranews.com', 'kompas.com', 'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com',
  'tempo.co', 'katadata.co.id', 'detik.com', 'liputan6.com', 'cnnindonesia.com',
  'investor.id', 'idnfinancials.com', 'emitennews.com', 'reuters.com', 'bloomberg.com',
  'ft.com', 'wsj.com', 'thejakartapost.com', 'jakartaglobe.id', 'tirto.id',
];

const OPINION_WORDS = [
  'menurut saya', 'sebaiknya', 'seharusnya', 'pendapat', 'opini', 'saya kira',
  'rasanya', 'bisa jadi', 'diduga', 'tampaknya', 'sepertinya', 'konon', 'katanya',
  'kabarnya', 'disebut-sebut', 'isunya', 'spekulasi', 'prediksi', 'proyeksi',
];

const CLICKBAIT_WORDS = [
  'viral', 'heboh', 'geger', 'bikin heboh', 'ternyata', 'wajib tahu', 'simak',
  'gak nyangka', 'tidak disangka', 'menghebohkan', 'ramai dibahas', 'bikin kaget',
  'mencengangkan', '!!!', '??',
];

const MISINFO_MARKERS = [
  'hoax', 'hoaks', 'fitnah', 'berita bohong', 'tidak benar', 'menyesatkan',
  'propaganda', 'konspirasi', 'tanpa bukti', 'tanpa sumber',
];

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function extractNumbers(text) {
  const matches = String(text || '').match(/\d[\d.,]*\s*(?:%|persen|triliun|miliar|juta|ribu|poin|bps)?/gi) || [];
  return Array.from(
    new Set(
      matches
        .map((m) => m.replace(/\s+/g, '').toLowerCase())
        .filter((m) => m.replace(/[^\d]/g, '').length >= 1)
    )
  ).slice(0, 12);
}

function countHits(text, words) {
  const lower = String(text || '').toLowerCase();
  return words.filter((w) => lower.includes(w));
}

function sourceTier(url, sourceName) {
  const domain = domainOf(url);
  const name = String(sourceName || '').toLowerCase();

  if (domain.endsWith('.go.id') || domain.endsWith('.gov') || name.includes('kementerian') || name.includes('otoritas')) {
    return { tier: 'resmi', label: 'Sumber resmi / pemerintah', points: 45, domain };
  }
  if (MAJOR_MEDIA.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { tier: 'media_utama', label: 'Media utama terverifikasi', points: 30, domain };
  }
  if (domain) {
    return { tier: 'tidak_dikenal', label: 'Domain tidak terklasifikasi', points: 12, domain };
  }
  return { tier: 'tanpa_url', label: 'Tidak ada URL sumber', points: 5, domain: '' };
}

// ------------------------------------------------------------------------------
// 1. Sinyal deterministik
// ------------------------------------------------------------------------------
function collectSignals(topic) {
  const text = `${topic.title || ''} ${topic.summary || ''}`;
  const tier = sourceTier(topic.url, topic.primary_source);

  const opinionHits = countHits(text, OPINION_WORDS);
  const clickbaitHits = countHits(text, CLICKBAIT_WORDS);
  const misinfoHits = countHits(text, MISINFO_MARKERS);
  const numbers = extractNumbers(text);

  const publishedAt = topic.published_at ? new Date(topic.published_at) : topic.created_at ? new Date(topic.created_at) : null;
  const ageHours = publishedAt ? Math.max(0, (Date.now() - publishedAt.getTime()) / 36e5) : null;

  return {
    tier,
    numbers,
    opinion: { hits: opinionHits, score: opinionHits.length },
    clickbait: { hits: clickbaitHits, score: clickbaitHits.length },
    misinfo: { hits: misinfoHits, score: misinfoHits.length },
    freshness: { published_at: publishedAt?.toISOString() || null, age_hours: ageHours === null ? null : Math.round(ageHours) },
    title_is_question: /\?$/.test(String(topic.title || '').trim()),
  };
}

// ------------------------------------------------------------------------------
// 2a. Korroborasi Google News (keyless)
// ------------------------------------------------------------------------------
function buildCorroborationQuery(title) {
  const clean = normalizeText(title)
    .replace(/["“”]/g, ' ')
    .replace(/\s[-–—|]\s.*$/, '')
    .replace(/\b(viral|heboh|geger|ternyata|wajib tahu|simak)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = clean.split(' ').filter(Boolean).slice(0, 10);
  return words.join(' ');
}

async function googleNewsCorroboration(topic) {
  const query = buildCorroborationQuery(topic.title);
  if (!query) return { query: '', items: [], distinct_domains: 0, numeric_overlap: 0, error: null };

  const feed = await fetchFeed(googleNewsRssUrl(query, { when: '7d' }), { timeoutMs: 12000 });
  if (!feed.ok) {
    return { query, items: [], distinct_domains: 0, numeric_overlap: 0, error: feed.error || 'gagal mengambil Google News' };
  }

  const sourceDomain = domainOf(topic.url);
  const numbers = extractNumbers(`${topic.title} ${topic.summary || ''}`);

  const items = feed.items.slice(0, 10).map((it) => {
    const publisher = normalizeText(it.extra?.sourceName) || normalizeText(it.author);
    // Link Google News selalu news.google.com; domain penerbit ada di extra.sourceUrl.
    const domain = domainOf(it.extra?.sourceUrl) || domainOf(it.link);
    const text = `${it.title} ${it.description || ''}`;
    const overlap = numbers.filter((n) => text.toLowerCase().includes(n)).length;
    return {
      title: normalizeText(it.title),
      url: it.extra?.sourceUrl || it.link,
      google_news_url: it.link,
      domain,
      publisher,
      published_at: it.pubDate,
      numeric_overlap: overlap,
    };
  });

  const domains = new Set(items.map((i) => i.domain).filter((d) => d && d !== sourceDomain));

  return {
    query,
    items,
    distinct_domains: domains.size,
    numeric_overlap: items.reduce((max, i) => Math.max(max, i.numeric_overlap), 0),
    error: null,
  };
}

// ------------------------------------------------------------------------------
// 2b. Korroborasi lokal (pg_trgm)
// ------------------------------------------------------------------------------
async function localCorroboration(client, topic) {
  try {
    const { rows } = await client.query(
      `SELECT id, title, primary_source, url, similarity(title, $1) AS sim
       FROM topics
       WHERE id <> $2 AND similarity(title, $1) >= 0.35
       ORDER BY sim DESC
       LIMIT 5`,
      [String(topic.title || ''), topic.id]
    );
    return rows.map((r) => ({ topic_id: r.id, title: r.title, source: r.primary_source, url: r.url, similarity: Number(r.sim.toFixed(2)) }));
  } catch (err) {
    return [];
  }
}

// ------------------------------------------------------------------------------
// 3. Penilaian heuristik (fallback jujur)
// ------------------------------------------------------------------------------
function heuristicVerdict(topic, signals, corroboration, local) {
  const supporting = corroboration.distinct_domains + local.length;
  const tier = signals.tier.tier;
  let status;
  let confidence;

  if (signals.misinfo.score >= 2 && supporting === 0) {
    status = 'misleading';
    confidence = 45;
  } else if (signals.opinion.score >= 2 && tier !== 'resmi') {
    status = 'opinion';
    confidence = 65;
  } else if (tier === 'resmi' && supporting >= 1) {
    status = 'verified';
    confidence = Math.min(92, 82 + supporting * 2);
  } else if (tier === 'resmi') {
    status = 'mostly_verified';
    confidence = 78;
  } else if (supporting >= 2) {
    status = 'mostly_verified';
    confidence = Math.min(85, 55 + supporting * 6 + (corroboration.numeric_overlap > 0 ? 5 : 0));
  } else if (signals.clickbait.score >= 2 && supporting === 0) {
    status = 'misleading';
    confidence = 48;
  } else if (supporting === 1) {
    status = 'needs_context';
    confidence = 52;
  } else {
    status = 'unverified';
    confidence = 25;
  }

  return {
    status,
    confidence,
    method: 'heuristic',
    claim: normalizeText(topic.title),
    summary:
      status === 'verified' || status === 'mostly_verified'
        ? `Klaim utama selaras dengan ${supporting} sumber pembanding yang ditemukan otomatis.`
        : 'Belum cukup bukti otomatis untuk menyatakan klaim ini valid sepenuhnya.',
    deep_explanation:
      'Pemeriksaan otomatis ini hanya memakai sinyal yang dapat diukur: tier sumber, kecocokan angka, dan jumlah domain pembanding. ' +
      'Status ini bukan putusan akhir. Redaksi perlu membaca sumber primer dan menambahkan konteks sebelum konten dipublikasikan.',
    reader_takeaway:
      'Jangan menyimpulkan benar/salah hanya dari judul. Periksa sumber primer, tanggal, dan apakah angka pada judul benar-benar disebut di dokumen aslinya.',
    misconceptions: [],
    red_flags: [
      ...signals.clickbait.hits.map((w) => `Bahasa clickbait: "${w}"`),
      ...signals.misinfo.hits.map((w) => `Penanda misinformasi: "${w}"`),
      ...signals.opinion.hits.map((w) => `Bahasa opini/spekulasi: "${w}"`),
    ],
    claims: [],
  };
}

// ------------------------------------------------------------------------------
// 4. Penilaian LLM (rubrik)
// ------------------------------------------------------------------------------
async function llmVerdict(topic, signals, corroboration, local) {
  const cfg = loadAgentsConfig();
  const verCfg = cfg.verifikator || {};
  const apiKey = verCfg.api_key || process.env.GEMINI_API_KEY || '';
  if (!apiKey || !apiKey.trim()) throw new Error('API key verifikator belum dikonfigurasi');

  const evidence = {
    judul: topic.title,
    ringkasan: topic.summary || '',
    sumber_primer: topic.primary_source || '',
    url: topic.url || '',
    tier_sumber: signals.tier,
    angka_pada_berita: signals.numbers,
    penanda_bahasa: {
      opini: signals.opinion.hits,
      clickbait: signals.clickbait.hits,
      misinformasi: signals.misinfo.hits,
    },
    korroborasi_google_news: {
      query: corroboration.query,
      jumlah_domain_berbeda: corroboration.distinct_domains,
      maksimum_kecocokan_angka: corroboration.numeric_overlap,
      contoh: corroboration.items.slice(0, 5).map((i) => ({ judul: i.title, domain: i.domain, url: i.url })),
    },
    topik_lokal_mirip: local,
  };

  const prompt = `Lakukan verifikasi editorial terhadap berita berikut. Gunakan HANYA bukti yang diberikan; jangan mengarang fakta, angka, atau sumber.

DATA BUKTI:
${JSON.stringify(evidence, null, 2)}

RUBRIK:
1. "verified" hanya jika klaim utama didukung sumber resmi ATAU ≥2 domain pembanding independen dan angka kunci konsisten.
2. "mostly_verified" jika indikasi kuat tetapi konteks masih kurang.
3. "needs_context" jika klaim benar sebagian tetapi berpotensi disalahpahami tanpa konteks.
4. "opinion" jika isinya pendapat/analisis, bukan pernyataan fakta.
5. "speculation" jika berisi prediksi/desas-desus tanpa bukti.
6. "misleading" jika judul/angka menyesatkan meski ada fakta benar.
7. "hoax_detected" HANYA jika ada bukti kontradiksi kuat, bukan sekadar kecurigaan.
8. "unverified" jika bukti tidak cukup.

Tugas tambahan:
- "claim": satu kalimat klaim utama yang diuji.
- "deep_explanation": 3-5 kalimat penjelasan yang membuat pembaca paham duduk perkaranya, termasuk apa yang benar, apa yang belum terbukti, dan mengapa.
- "reader_takeaway": 1-2 kalimat agar pembaca tidak miskonsepsi.
- "misconceptions": daftar kesalahpahaman umum yang mungkin muncul (maks 3).
- "claims": daftar klaim spesifik dengan penilaian "supported" | "unsupported" | "unclear".
- "confidence": 0-100, sesuai kekuatan bukti.

Kembalikan HANYA JSON valid:
{
  "status": "verified|mostly_verified|needs_context|unverified|opinion|speculation|misleading|hoax_detected",
  "confidence": 0,
  "claim": "",
  "summary": "",
  "deep_explanation": "",
  "reader_takeaway": "",
  "misconceptions": [],
  "red_flags": [],
  "claims": [{ "claim": "", "assessment": "supported|unsupported|unclear", "note": "" }]
}`;

  const resp = await callAgentLLM('verifikator', prompt, verCfg.system_prompt || '', true);
  const parsed = JSON.parse(resp);
  const allowed = new Set([
    'verified', 'mostly_verified', 'needs_context', 'unverified',
    'opinion', 'speculation', 'misleading', 'hoax_detected',
  ]);
  if (!allowed.has(parsed.status)) throw new Error(`Status verifikasi tidak valid: ${parsed.status}`);

  return {
    status: parsed.status,
    confidence: Math.max(0, Math.min(100, parseInt(parsed.confidence, 10) || 0)),
    method: 'llm+corroboration',
    claim: normalizeText(parsed.claim) || normalizeText(topic.title),
    summary: normalizeText(parsed.summary),
    deep_explanation: normalizeText(parsed.deep_explanation),
    reader_takeaway: normalizeText(parsed.reader_takeaway),
    misconceptions: Array.isArray(parsed.misconceptions) ? parsed.misconceptions.filter(Boolean).slice(0, 3) : [],
    red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.filter(Boolean).slice(0, 6) : [],
    claims: Array.isArray(parsed.claims) ? parsed.claims.slice(0, 8) : [],
  };
}

const STATUS_DISCLAIMER = {
  verified: 'Terverifikasi melalui sumber resmi dan/atau beberapa sumber independen. Tetap periksa dokumen primer.',
  mostly_verified: 'Indikasi kuat, namun sebagian konteks masih perlu dikonfirmasi redaksi.',
  needs_context: 'Sebagian klaim benar tetapi berpotensi menyesatkan bila dibaca tanpa konteks lengkap.',
  unverified: 'Belum terverifikasi otomatis. Jangan jadikan dasar keputusan sebelum ada konfirmasi redaksi.',
  opinion: 'Ini opini/analisis, bukan pernyataan fakta. Perbedaannya penting.',
  speculation: 'Ini spekulasi/prediksi tanpa bukti yang cukup.',
  misleading: 'Judul atau angka berpotensi menyesatkan meskipun ada elemen fakta.',
  hoax_detected: 'Terdapat kontradiksi kuat dengan bukti yang tersedia. Konten diblokir dari produksi otomatis.',
};

/**
 * Verifikasi satu topik. Mengembalikan laporan lengkap dan menyimpannya.
 */
export async function verifyTopic(topicId, { client } = {}) {
  const db = client || (await pool.connect());
  const shouldRelease = !client;

  try {
    const { rows } = await db.query('SELECT * FROM topics WHERE id = $1', [topicId]);
    if (rows.length === 0) throw new Error('Topik tidak ditemukan');
    const topic = rows[0];

    const signals = collectSignals(topic);
    const [corroboration, local] = await Promise.all([
      googleNewsCorroboration(topic).catch((err) => ({ query: '', items: [], distinct_domains: 0, numeric_overlap: 0, error: err.message })),
      localCorroboration(db, topic),
    ]);

    let result;
    try {
      result = await llmVerdict(topic, signals, corroboration, local);
    } catch (err) {
      console.warn(`[Verifikator] LLM gagal untuk topik #${topicId}, memakai heuristik jujur:`, err.message);
      result = heuristicVerdict(topic, signals, corroboration, local);
      result.llm_error = err.message;
    }

    // Guard: jangan biarkan LLM meloloskan konten yang sinyalnya sudah menyesatkan.
    const heuristic = heuristicVerdict(topic, signals, corroboration, local);
    if (result.method === 'llm+corroboration' && heuristic.status === 'misleading' && result.status === 'verified' && result.confidence < 80) {
      result.status = 'needs_context';
      result.red_flags = [...new Set([...(result.red_flags || []), 'Sinyal clickbait/misinformasi kuat pada judul'])];
    }

    const disclaimer = STATUS_DISCLAIMER[result.status] || STATUS_DISCLAIMER.unverified;

    const { rows: saved } = await db.query(
      `INSERT INTO verification_reports
        (topic_id, status, confidence, source_tier, corroboration, claims, misconceptions,
         red_flags, summary, deep_explanation, reader_takeaway, disclaimer, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        topicId,
        result.status,
        result.confidence,
        signals.tier.tier,
        JSON.stringify({
          google_news: {
            query: corroboration.query,
            distinct_domains: corroboration.distinct_domains,
            numeric_overlap: corroboration.numeric_overlap,
            examples: corroboration.items.slice(0, 5),
            error: corroboration.error,
          },
          local_topics: local,
          signals,
        }),
        JSON.stringify(result.claims || []),
        JSON.stringify(result.misconceptions || []),
        JSON.stringify(result.red_flags || []),
        result.summary || null,
        result.deep_explanation || null,
        result.reader_takeaway || null,
        disclaimer,
        result.method,
      ]
    );

    await db.query('UPDATE topics SET verification_status = $2, updated_at = NOW() WHERE id = $1', [topicId, result.status]);
    await db.query(
      `INSERT INTO agent_runs (agent, entity_id, completed_at, status, model)
       VALUES ('verifikator', $1, NOW(), 'success', $2)`,
      [topicId, result.method]
    );

    return { ...saved[0], signals, llm_error: result.llm_error || null };
  } finally {
    if (shouldRelease) db.release();
  }
}

export async function getLatestVerification(topicId) {
  const { rows } = await pool.query(
    'SELECT * FROM verification_reports WHERE topic_id = $1 ORDER BY created_at DESC LIMIT 1',
    [topicId]
  );
  return rows[0] || null;
}

/**
 * Verifikasi batch untuk topik yang sudah lolos Analis tetapi belum pernah
 * diverifikasi. Dipakai pipeline agar copywriter selalu menerima konteks
 * verifikasi sebelum memproduksi carousel.
 */
export async function verifyScoredTopics(limit = 3) {
  const { rows } = await pool.query(
    `SELECT t.id, ts.score_total
     FROM topics t
     LEFT JOIN topic_scores ts ON ts.id = (
       SELECT id FROM topic_scores WHERE topic_id = t.id ORDER BY created_at DESC LIMIT 1
     )
     WHERE t.status = 'scored'
       AND NOT EXISTS (SELECT 1 FROM verification_reports vr WHERE vr.topic_id = t.id)
     ORDER BY COALESCE(ts.score_total, 0) DESC, t.id ASC
     LIMIT $1`,
    [parseInt(limit, 10) || 3]
  );

  const summary = { candidates: rows.length, verified: 0, errors: [] };
  for (const row of rows) {
    try {
      const report = await verifyTopic(row.id);
      summary.verified += 1;
      console.log(`[Verifikator] Topik #${row.id}: ${report.status} (keyakinan ${report.confidence}%)`);
    } catch (err) {
      summary.errors.push({ topic_id: row.id, error: err.message });
      console.warn(`[Verifikator] Gagal memverifikasi topik #${row.id}:`, err.message);
    }
  }
  return summary;
}

export async function listVerifications({ limit = 50, status = null } = {}) {
  const params = [parseInt(limit, 10) || 50];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE vr.status = $2';
  }
  const { rows } = await pool.query(
    `SELECT vr.*, t.title, t.primary_source, t.url, t.status AS topic_status
     FROM verification_reports vr
     JOIN topics t ON t.id = vr.topic_id
     ${where}
     ORDER BY vr.created_at DESC
     LIMIT $1`,
    params
  );
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--batch') {
    verifyScoredTopics(parseInt(process.argv[3], 10) || 3)
      .then((summary) => {
        console.log('Verifikator batch selesai:', JSON.stringify(summary));
        pool.end();
      })
      .catch((err) => {
        console.error('Verifikator batch error:', err);
        pool.end();
        process.exit(1);
      });
  } else {
    const topicId = parseInt(arg, 10);
    if (!topicId) {
      console.error('Usage: node verificator.js <topic_id> | node verificator.js --batch [limit]');
      process.exit(1);
    }
    verifyTopic(topicId)
      .then((r) => {
        console.log(JSON.stringify({ status: r.status, confidence: r.confidence, summary: r.summary }, null, 2));
        pool.end();
      })
      .catch((err) => {
        console.error('Verifikator error:', err);
        pool.end();
        process.exit(1);
      });
  }
}
