const SCORE_LIMITS = { relevance: 30, credibility: 25, momentum: 20, engagement: 15, compliance: 10 };

export function normalizeWeights(weights = SCORE_LIMITS) {
  const normalized = {};
  for (const key of Object.keys(SCORE_LIMITS)) {
    const weight = weights[key];
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) throw new Error('Bobot harus bilangan bulat 0-100 dengan jumlah 100.');
    normalized[key] = weight;
  }
  if (Object.values(normalized).reduce((sum, n) => sum + n, 0) !== 100) throw new Error('Jumlah bobot harus 100.');
  return normalized;
}

export function normalizeScoreResult(value, threshold = 76, weights = SCORE_LIMITS) {
  const limits = normalizeWeights(weights);
  const scores = value?.scores;
  if (!scores || typeof scores !== 'object') throw new Error('Hasil skor tidak memiliki komponen scores.');
  const normalized = {};
  for (const [key, max] of Object.entries(limits)) {
    const score = scores[key];
    if (!Number.isInteger(score) || score < 0 || score > max) throw new Error(`Skor ${key} harus bilangan bulat 0-${max}.`);
    normalized[key] = score;
  }
  const total = value.score_total;
  const componentTotal = Object.values(normalized).reduce((sum, score) => sum + score, 0);
  if (!Number.isInteger(total) || total !== componentTotal) throw new Error('score_total harus sama dengan jumlah lima komponen skor.');
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) throw new Error('Ambang skor harus bilangan bulat 0-100.');
  return {
    scores: normalized,
    score_total: total,
    verdict: total >= threshold ? 'passed' : 'rejected',
    reasoning: String(value.reasoning || '').slice(0, 1000),
  };
}

export function parseFastFailRules(raw) {
  const lines = String(raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const rules = [];
  for (const pattern of lines) {
    try {
      new RegExp(pattern, 'iu');
      rules.push({ regex: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, 'iu'), reason: `Aturan Filter: ${pattern.slice(0, 40)}` });
    } catch {
      rules.push({ regex: new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), reason: `Aturan teks literal: ${pattern.slice(0, 40)}` });
    }
  }
  return rules;
}
