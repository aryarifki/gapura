const SCORE_LIMITS = { relevance: 30, credibility: 25, momentum: 20, engagement: 15, compliance: 10 };
export const PRIORITY_DESKS_DEFAULT = Object.freeze(['bursa', 'politik']);

const OJK_TOPIC_REGEX = /\b(ojk|otoritas jasa keuangan|pojk|seojk|satgas pasti|dewan komisioner ojk)\b/iu;
const BURSA_TOPIC_REGEX = /\b(ihsg|bei|idx|bursa efek|pasar modal|saham|emiten|ipo|right issue|rights issue|stock split|reverse split|buyback|dividen|rups|rupst|rupslb|sekuritas|reksa dana|reksadana|obligasi|sukuk korporasi|ksei|kpei|lq45|idx30|msci|ftse|kapitalisasi pasar|delisting|suspensi saham|unusual market activity|aksi korporasi|tender offer|corporate action|papan pemantauan|waran|warant|indeks saham|investor pasar modal|bursa saham)\b/iu;

export function isBursaOrOjkTopic(topic, discovery = null) {
  if (!topic || typeof topic !== 'object') return false;
  const category = String(topic.category || '').trim().toLowerCase();
  if (category === 'news_pasar' || category === 'ojk_regulasi') return true;
  const keywords = Array.isArray(discovery?.topic_keywords)
    ? discovery.topic_keywords.join(' ')
    : Array.isArray(topic.topic_keywords)
      ? topic.topic_keywords.join(' ')
      : '';
  const metadataText = [
    discovery?.normalized_title,
    discovery?.raw_title,
    topic.normalized_title,
    topic.raw_title,
    topic.title,
    discovery?.source_name,
    topic.primary_source,
    keywords,
    topic.url,
  ].filter(Boolean).join(' ');
  return OJK_TOPIC_REGEX.test(metadataText) || BURSA_TOPIC_REGEX.test(metadataText);
}

export function checkEkonomiPolicy(topic, discovery = null, analisCfg = {}) {
  if (analisCfg?.ekonomi_requires_bursa_or_ojk !== true) {
    return { rejected: false, reason: null };
  }
  const desk = String(discovery?.desk || topic?.desk || '').trim().toLowerCase();
  if (desk !== 'ekonomi') {
    return { rejected: false, reason: null };
  }
  if (isBursaOrOjkTopic(topic, discovery)) {
    return { rejected: false, reason: null };
  }
  return {
    rejected: true,
    reason: 'Kebijakan Desk Ekonomi: Topik ekonomi tanpa kaitan langsung dengan bursa/pasar modal atau OJK ditolak.',
  };
}

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
