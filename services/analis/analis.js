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
import { loadAgentsConfig, callAgentLLM } from '../common/llm.js';
import { normalizeScoreResult, normalizeWeights, parseFastFailRules } from './scoring.js';

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

// 1. FAST-FAIL PATTERNS (0 Biaya Token - Deterministic Default)
const DEFAULT_FAST_FAIL_PATTERNS = [
  { regex: /\b(rekomendasi saham|target harga|koleksi saham|potensial cuan|saham pilihan|serok|to the moon)\b/i, reason: 'Kepatuhan: Terdeteksi rekomendasi/ajakan beli-jual saham spesifik' },
  { regex: /\b(prilly latuconsina|gosip|artis|selebriti|viral tiktok)\b/i, reason: 'Relevansi: Berita hiburan/gaya hidup tanpa substansi data ekonomi' },
  { regex: /selamat ulang tahun|ucapan selamat|dirgahayu|peresmian gedung/i, reason: 'Relevansi: Acara seremonial administratif tanpa data atau regulasi' },
  { regex: /\b(sara|ujaran kebencian|fitnah|politik identitas)\b/i, reason: 'Keamanan: Pelanggaran etika editorial dan kebijakan Meta' },
];

function getFastFailRules(analisCfg) {
  if (analisCfg && analisCfg.fast_fail_rules && typeof analisCfg.fast_fail_rules === 'string') {
    const rules = parseFastFailRules(analisCfg.fast_fail_rules);
    if (rules.length > 0) return rules;
  }
  return DEFAULT_FAST_FAIL_PATTERNS;
}

// Heuristic Scoring jika API Key belum dipasang
function calculateHeuristicScore(title, summary, primarySource, weights = {}) {
  const text = `${title} ${summary || ''}`.toLowerCase();
  const maxRel = weights.relevance ?? 30;
  const maxCred = weights.credibility ?? 25;
  const maxMom = weights.momentum ?? 20;
  const maxEng = weights.engagement ?? 15;
  const maxComp = weights.compliance ?? 10;

  let rel = Math.round(maxRel * 0.33);
  let cred = Math.round(maxCred * 0.4);
  let mom = Math.round(maxMom * 0.5);
  let eng = Math.round(maxEng * 0.5);
  let comp = maxComp;

  // Relevansi Niche
  if (/inflasi|pdb|cadangan devisa|bi-rate|suku bunga|neraca perdagangan|apbn/i.test(text)) rel += Math.round(maxRel * 0.6);
  else if (/ihsg|bursa efek|pasar modal|transaksi nego|ipo|msci|kapitalisasi/i.test(text)) rel += Math.round(maxRel * 0.55);
  else if (/\b(ojk|pojk|peraturan|uu|hukum|regulasi|putusan mk|sanksi)\b/i.test(text)) rel += Math.round(maxRel * 0.55);
  else if (/kredit|perbankan|dhe|asuransi|multifinance/i.test(text)) rel += Math.round(maxRel * 0.4);
  rel = Math.min(maxRel, rel);

  // Kualitas Data & Kredibilitas
  if (/\b(bps|bank indonesia|bi|ojk|bei|idx|kemenkeu)\b/i.test(primarySource || '') || /\b(resmi|siaran pers)\b/i.test(text)) cred += Math.round(maxCred * 0.4);
  if (/\d+([.,]\d+)?%/.test(text)) cred += Math.round(maxCred * 0.16); // Ada persentase
  if (/rp\s*\d+|usd\s*\d+|triliun|miliar/i.test(text)) cred += Math.round(maxCred * 0.16); // Ada nilai konkret
  cred = Math.min(maxCred, cred);

  // Momentum
  if (/terbaru|rilis|resmi|breaking|hari ini|q3|kuartal/i.test(text)) mom += Math.round(maxMom * 0.4);
  mom = Math.min(maxMom, mom);

  // Potensi Interaksi
  if (/dompet|investor|masyarakat|bunga|pinjol|utang|rupiah|daya beli/i.test(text)) eng += Math.round(maxEng * 0.35);
  eng = Math.min(maxEng, eng);

  const total = rel + cred + mom + eng + comp;
  return {
    scores: { relevance: rel, credibility: cred, momentum: mom, engagement: eng, compliance: comp },
    total,
    reasoning: `Skor dihitung otomatis: Relevansi=${rel}/${maxRel}, Kredibilitas=${cred}/${maxCred}, Momentum=${mom}/${maxMom}, Interaksi=${eng}/${maxEng}, Kepatuhan=${comp}/${maxComp}`,
  };
}

async function saveScore(client, topicId, result, model) {
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO topic_scores (topic_id, score_relevance, score_credibility, score_momentum, score_engagement, score_compliance, score_total, verdict, reasoning, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [topicId, result.scores.relevance, result.scores.credibility, result.scores.momentum,
        result.scores.engagement, result.scores.compliance, result.score_total, result.verdict, result.reasoning, model.slice(0, 50)]
    );
    await client.query('UPDATE topics SET status = $2, updated_at = NOW() WHERE id = $1', [topicId, result.verdict === 'passed' ? 'scored' : 'rejected']);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function runAnalis({ client: suppliedClient, config = loadAgentsConfig() } = {}) {
  const fullAgentsConfig = config;
  const analisCfg = fullAgentsConfig.analis || {};
  const maxTopics = analisCfg.max_topics_per_run ?? 20;
  if (!Number.isSafeInteger(maxTopics) || maxTopics < 1) throw new Error('max_topics_per_run harus bilangan bulat positif.');
  const weights = normalizeWeights(analisCfg.weights);
  const client = suppliedClient || await pool.connect();
  const startTime = Date.now();
  console.log('[Analis] Memulai evaluasi topik baru...');

  // Muat konfigurasi dinamis agen analis
  const fastFailRules = getFastFailRules(analisCfg);

  let evaluated = 0;
  let passed = 0;
  let fastFailed = 0;
  let scoreRejected = 0;

  try {
    // Ambil setting ambang batas (prioritaskan config/agents.json, lalu app_settings)
    let minThreshold = analisCfg.min_score_threshold;
    if (minThreshold === undefined || minThreshold === null) {
      const { rows: settingRows } = await client.query("SELECT value FROM app_settings WHERE key = 'score_threshold'");
      minThreshold = settingRows[0]?.value?.initial_strict_score ?? 70;
    }
    if (!Number.isInteger(minThreshold) || minThreshold < 0 || minThreshold > 100) throw new Error('Ambang skor harus bilangan bulat 0-100.');
    console.log(`[Analis] Ambang batas kelulusan (threshold): ${minThreshold}`);

    // Bound each scheduled run and prioritize fresh topics over the old backlog.
    const { rows: newTopics } = await client.query(
      "SELECT * FROM topics WHERE status = 'new' ORDER BY created_at DESC, id DESC LIMIT $1", [maxTopics]
    );
    console.log(`[Analis] Ditemukan ${newTopics.length} topik untuk dievaluasi.`);

    for (const topic of newTopics) {
      evaluated++;
      const fullText = `${topic.title} ${topic.summary || ''}`;

      // --- GATE 1: FAST-FAIL CHECK (Dynamic from agent config) ---
      let fastFailMatch = null;
      const warning = /\b(waspada|peringatan|memperingatkan|hindari|penindakan|penipuan|jangan)\b/i.test(fullText)
        && /\b(ojk|satgas|polisi|penipuan|investasi bodong)\b/i.test(fullText);
      const filteredText = warning ? fullText.replace(/\b(investasi bodong|serok|saham pilihan|rekomendasi saham|target harga|koleksi saham|potensial cuan|to the moon)\b/gi, '') : fullText;
      for (const rule of fastFailRules) {
        // Regulatory warnings often quote the very promotion they warn against.
        if (rule.regex.test(filteredText)) {
          fastFailMatch = rule.reason;
          break;
        }
      }

      if (fastFailMatch) {
        fastFailed++;
        console.log(`[Analis] [FAST-FAIL] #${topic.id}: "${topic.title}" -> ${fastFailMatch}`);

        await saveScore(client, topic.id, { scores: { relevance: 0, credibility: 0, momentum: 0, engagement: 0, compliance: 0 }, score_total: 0, verdict: 'fast_failed', reasoning: fastFailMatch }, 'fast-fail-gate');
        continue;
      }

      // --- GATE 2: SCORING (0-100) ---
      let scoreResult = null;
      let modelUsed = analisCfg.model || 'heuristic-analis-v2';

      // Cek apakah API Key Agen Analis tersedia
      const apiKey = analisCfg.api_key || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
      if (apiKey && apiKey.length > 5) {
        try {
          const promptText = `Evaluasi berita ini untuk akun Instagram @gapuramedia (niche data ekonomi, hukum, bursa saham):
Judul: ${topic.title}
Ringkasan: ${topic.summary || ''}
Sumber: ${topic.primary_source || ''}

Bobot penilaian:
- Relevansi: 0-${weights.relevance}
- Kredibilitas: 0-${weights.credibility}
- Momentum: 0-${weights.momentum}
- Interaksi: 0-${weights.engagement}
- Kepatuhan: 0-${weights.compliance}

Kembalikan HANYA JSON:
{
  "scores": {
    "relevance": 0-${weights.relevance},
    "credibility": 0-${weights.credibility},
    "momentum": 0-${weights.momentum},
    "engagement": 0-${weights.engagement},
    "compliance": 0-${weights.compliance}
  },
  "score_total": 0-100,
  "verdict": "passed" | "rejected",
  "reasoning": "maksimal 30 kata"
}`;

          const llmOutput = await callAgentLLM('analis', promptText, analisCfg.system_prompt || '', true);
          scoreResult = normalizeScoreResult(JSON.parse(llmOutput), minThreshold, weights);
          modelUsed = `${analisCfg.provider || 'gemini'}/${analisCfg.model || 'gemini-2.0-flash'}`;
        } catch (llmErr) {
          console.warn('[Analis] Gagal panggil LLM, fallback ke heuristik:', llmErr.message);
        }
      }

      // Fallback ke Heuristik jika LLM tidak tersedia
      if (!scoreResult || typeof scoreResult.score_total !== 'number') {
        const h = calculateHeuristicScore(topic.title, topic.summary, topic.primary_source, weights);
        scoreResult = {
          scores: h.scores,
          score_total: h.total,
          verdict: h.total >= minThreshold ? 'passed' : 'rejected',
          reasoning: h.reasoning,
        };
        modelUsed = 'heuristic-analis-v2';
      }

      scoreResult = normalizeScoreResult(scoreResult, minThreshold, weights);
      await saveScore(client, topic.id, scoreResult, modelUsed);

      const isPassed = scoreResult.verdict === 'passed';
      if (isPassed) {
        passed++;
        console.log(`[Analis] [LOLOS ${scoreResult.score_total}/100] #${topic.id}: "${topic.title}"`);
      } else {
        scoreRejected++;
        console.log(`[Analis] [GUGUR ${scoreResult.score_total}/100] #${topic.id}: "${topic.title}"`);
      }
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
    if (!suppliedClient) client.release();
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
