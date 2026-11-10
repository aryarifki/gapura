// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Agen Analis
// File: /root/gapura/services/analis/analis.js
// Fast-Fail Filter & 0-100 Scoring Engine
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

// 1. FAST-FAIL PATTERNS (0 Biaya Token - Deterministic)
const FAST_FAIL_PATTERNS = [
  { regex: /rekomendasi saham|target harga|koleksi saham|potensial cuan|saham pilihan|serok|to the moon/i, reason: 'Kepatuhan: Terdeteksi rekomendasi/ajakan beli-jual saham spesifik' },
  { regex: /prilly latuconsina|gosip|artis|selebriti|viral tiktok/i, reason: 'Relevansi: Berita hiburan/gaya hidup tanpa substansi data ekonomi' },
  { regex: /selamat ulang tahun|ucapan selamat|dirgahayu|peresmian gedung/i, reason: 'Relevansi: Acara seremonial administratif tanpa data atau regulasi' },
  { regex: /sara|ujaran kebencian|fitnah|politik identitas/i, reason: 'Keamanan: Pelanggaran etika editorial dan kebijakan Meta' },
];

// Heuristic Scoring jika API Key belum dipasang
function calculateHeuristicScore(title, summary, primarySource) {
  const text = `${title} ${summary || ''}`.toLowerCase();
  let rel = 10;
  let cred = 10;
  let mom = 10;
  let eng = 8;
  let comp = 10;

  // Relevansi Niche (0-30)
  if (/inflasi|pdb|cadangan devisa|bi-rate|suku bunga|neraca perdagangan|apbn/i.test(text)) rel += 18;
  else if (/ihsg|bursa efek|pasar modal|transaksi nego|ipo|msci|kapitalisasi/i.test(text)) rel += 16;
  else if (/ojk|pojk|peraturan|uu|hukum|regulasi|putusan mk|sanksi/i.test(text)) rel += 16;
  else if (/kredit|perbankan|dhe|asuransi|multifinance/i.test(text)) rel += 12;
  rel = Math.min(30, rel);

  // Kualitas Data & Kredibilitas (0-25)
  if (/bps|bank indonesia|bi|ojk|bei|idx|kemenkeu/i.test(primarySource) || /resmi|siaran pers/i.test(text)) cred += 10;
  if (/\d+([.,]\d+)?%/.test(text)) cred += 4; // Ada persentase
  if (/rp\s*\d+|usd\s*\d+|triliun|miliar/i.test(text)) cred += 4; // Ada nilai uang konkret
  cred = Math.min(25, cred);

  // Momentum (0-20)
  if (/terbaru|rilis|resmi|breaking|hari ini|q3|kuartal/i.test(text)) mom += 8;
  mom = Math.min(20, mom);

  // Potensi Interaksi (0-15)
  if (/dompet|investor|masyarakat|bunga|pinjol|utang|rupiah|daya beli/i.test(text)) eng += 5;
  eng = Math.min(15, eng);

  // Kepatuhan (0-10)
  comp = 10;

  const total = rel + cred + mom + eng + comp;
  return {
    scores: { relevance: rel, credibility: cred, momentum: mom, engagement: eng, compliance: comp },
    total,
    reasoning: `Skor dihitung otomatis: Relevansi=${rel}/30, Kredibilitas=${cred}/25, Momentum=${mom}/20, Interaksi=${eng}/15, Kepatuhan=${comp}/10`,
  };
}

export async function runAnalis() {
  const client = await pool.connect();
  const startTime = Date.now();
  console.log('[Analis] Memulai evaluasi topik baru...');

  let evaluated = 0;
  let passed = 0;
  let fastFailed = 0;
  let scoreRejected = 0;

  try {
    // Ambil setting ambang batas
    const { rows: settingRows } = await client.query("SELECT value FROM app_settings WHERE key = 'score_threshold'");
    const minThreshold = settingRows[0]?.value?.initial_strict_score || 70;
    console.log(`[Analis] Ambang batas kelulusan (threshold): ${minThreshold}`);

    // Ambil topik yang masih berstatus 'new'
    const { rows: newTopics } = await client.query("SELECT * FROM topics WHERE status = 'new' ORDER BY id ASC");
    console.log(`[Analis] Ditemukan ${newTopics.length} topik untuk dievaluasi.`);

    for (const topic of newTopics) {
      evaluated++;
      const fullText = `${topic.title} ${topic.summary || ''}`;

      // --- GATE 1: FAST-FAIL CHECK ---
      let fastFailMatch = null;
      for (const rule of FAST_FAIL_PATTERNS) {
        if (rule.regex.test(fullText)) {
          fastFailMatch = rule.reason;
          break;
        }
      }

      if (fastFailMatch) {
        fastFailed++;
        console.log(`[Analis] [FAST-FAIL] #${topic.id}: "${topic.title}" -> ${fastFailMatch}`);

        await client.query("UPDATE topics SET status = 'rejected', updated_at = NOW() WHERE id = $1", [topic.id]);
        await client.query(
          `INSERT INTO topic_scores (topic_id, score_relevance, score_credibility, score_momentum, score_engagement, score_compliance, score_total, verdict, reasoning, model)
           VALUES ($1, 0, 0, 0, 0, 0, 0, 'fast_failed', $2, 'fast-fail-gate')`,
          [topic.id, fastFailMatch]
        );
        continue;
      }

      // --- GATE 2: SCORING (0-100) ---
      let scoreResult = null;
      let modelUsed = 'heuristic-analis-v2';

      // Cek apakah API Key Gemini tersedia di env
      if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10) {
        try {
          modelUsed = 'gemini-2.0-flash';
          const promptText = `Evaluasi berita ini untuk akun Instagram @homelessmedia (niche data ekonomi, hukum, bursa saham):
Judul: ${topic.title}
Ringkasan: ${topic.summary}
Sumber: ${topic.primary_source}

Kembalikan HANYA JSON:
{
  "scores": { "relevance": 0-30, "credibility": 0-25, "momentum": 0-20, "engagement": 0-15, "compliance": 0-10 },
  "score_total": 0-100,
  "verdict": "passed" | "rejected",
  "reasoning": "maksimal 30 kata"
}`;

          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { responseMimeType: 'application/json' },
              }),
            }
          );

          if (resp.ok) {
            const data = await resp.json();
            const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
            scoreResult = JSON.parse(textResponse);
          }
        } catch (llmErr) {
          console.warn('[Analis] Gagal panggil Gemini API, fallback ke heuristik:', llmErr.message);
        }
      }

      // Fallback ke Heuristik jika LLM tidak tersedia
      if (!scoreResult) {
        const h = calculateHeuristicScore(topic.title, topic.summary, topic.primary_source);
        scoreResult = {
          scores: h.scores,
          score_total: h.total,
          verdict: h.total >= minThreshold ? 'passed' : 'rejected',
          reasoning: h.reasoning,
        };
      }

      const isPassed = scoreResult.score_total >= minThreshold;
      const verdict = isPassed ? 'passed' : 'rejected';

      if (isPassed) {
        passed++;
        console.log(`[Analis] [LOLOS ${scoreResult.score_total}/100] #${topic.id}: "${topic.title}"`);
        await client.query("UPDATE topics SET status = 'scored', updated_at = NOW() WHERE id = $1", [topic.id]);
      } else {
        scoreRejected++;
        console.log(`[Analis] [GUGUR ${scoreResult.score_total}/100] #${topic.id}: "${topic.title}"`);
        await client.query("UPDATE topics SET status = 'rejected', updated_at = NOW() WHERE id = $1", [topic.id]);
      }

      await client.query(
        `INSERT INTO topic_scores (topic_id, score_relevance, score_credibility, score_momentum, score_engagement, score_compliance, score_total, verdict, reasoning, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          topic.id,
          scoreResult.scores.relevance,
          scoreResult.scores.credibility,
          scoreResult.scores.momentum,
          scoreResult.scores.engagement,
          scoreResult.scores.compliance,
          scoreResult.score_total,
          verdict,
          scoreResult.reasoning,
          modelUsed,
        ]
      );
    }

    // Catat Telemetri Agen Analis
    const durationMs = Date.now() - startTime;
    await client.query(
      `INSERT INTO agent_runs (agent, started_at, completed_at, status, model, tokens_input, tokens_output, est_cost_idr)
       VALUES ('analis', NOW(), NOW(), 'success', 'analis-gate-hybrid', $1, $2, 0.00)`,
      [evaluated * 150, evaluated * 40]
    );

    console.log(`\n[Analis] Selesai: ${evaluated} dievaluasi, ${fastFailed} fast-failed, ${scoreRejected} gugur skor, ${passed} lolos ke antrean Copywriter.`);
    return { evaluated, fastFailed, scoreRejected, passed, durationMs };
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAnalis()
    .then((res) => {
      console.log('Analis run complete:', res);
      pool.end();
    })
    .catch((err) => {
      console.error('Analis run error:', err);
      pool.end();
      process.exit(1);
    });
}
