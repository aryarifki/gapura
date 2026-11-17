import { validatePublicSourceUrl } from './sources.js';
import { normalizeCategory, normalizeHeadline } from './editorial-contract.js';

export const DISCOVERY_INPUT_FIELDS = Object.freeze([
  'source_id',
  'source_name',
  'source_url',
  'raw_title',
  'normalized_title',
  'published_at',
  'discovered_at',
  'desk',
  'topic_keywords',
]);

// Serials of the source body must never be accepted by an agent prompt, even
// when a caller accidentally passes a full row from the registry.
const FORBIDDEN_DISCOVERY_KEYS = new Set([
  'summary', 'content', 'content_raw', 'content_html', 'body', 'description',
  'image_url', 'images', 'publisher_url', 'source_material', 'material', 'paragraphs', 'snapshot',
]);

const SOURCE_DESKS = new Map([
  ['news_pasar', 'bursa'],
  ['ojk_regulasi', 'ekonomi'],
  ['bi_moneter', 'ekonomi'],
  ['data_bps', 'ekonomi'],
  ['jdih_hukum', 'hukum'],
]);

const DESK_TERMS = Object.freeze({
  politik: ['pemerintah', 'presiden', 'wakil presiden', 'menteri', 'kementerian', 'dpr', 'dprd', 'mpr', 'pemilu', 'pilkada', 'kpu', 'bawaslu', 'kabinet', 'istana', 'politik', 'partai', 'koalisi'],
  sosial: ['pendidikan', 'sekolah', 'guru', 'siswa', 'mahasiswa', 'kesehatan', 'rumah sakit', 'puskesmas', 'bpjs', 'tenaga kerja', 'upah minimum', 'buruh', 'kemiskinan', 'bansos', 'bantuan sosial', 'gizi', 'stunting', 'layanan publik', 'warga', 'ketimpangan', 'disabilitas', 'sosial'],
  hukum: ['hukum', 'pengadilan', 'putusan', 'hakim', 'jaksa', 'kejaksaan', 'kepolisian', 'polisi', 'kpk', 'korupsi', 'pidana', 'perdata', 'mahkamah', 'pasal', 'tersangka', 'terdakwa', 'sidang', 'perkara', 'regulasi', 'ruu', 'perppu', 'jdih', 'sanksi'],
  lingkungan: ['lingkungan', 'iklim', 'emisi', 'karbon', 'polusi', 'banjir', 'gempa', 'erupsi', 'gunung', 'kebakaran hutan', 'bmkg', 'bnpb', 'bencana', 'kehutanan', 'tambang', 'pertambangan', 'energi terbarukan', 'mangrove', 'cuaca ekstrem', 'kekeringan', 'longsor'],
  ekonomi: ['inflasi', 'deflasi', 'suku bunga', 'bank indonesia', 'apbn', 'defisit', 'pdb', 'pertumbuhan ekonomi', 'ekspor', 'impor', 'rupiah', 'nilai tukar', 'harga', 'pangan', 'industri', 'umkm', 'pajak', 'subsidi', 'bps', 'kemenkeu', 'fiskal', 'moneter', 'kredit', 'perbankan', 'bank', 'daya beli', 'investasi', 'neraca perdagangan', 'cadangan devisa', 'pengangguran'],
  bursa: ['ihsg', 'bei', 'idx', 'saham', 'emiten', 'ipo', 'obligasi', 'reksa dana', 'indeks', 'kapitalisasi', 'dividen', 'aksi korporasi', 'pasar modal', 'right issue', 'bursa', 'sekuritas', 'broker'],
});

const STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'di', 'ke', 'dari', 'untuk', 'pada', 'dengan', 'akan', 'ini', 'itu', 'tidak', 'bukan',
  'dalam', 'oleh', 'sebagai', 'juga', 'sudah', 'belum', 'masih', 'karena', 'setelah', 'sebelum', 'kata', 'ujar',
  'menurut', 'soal', 'atas', 'bagi', 'serta', 'agar', 'bisa', 'dapat', 'telah', 'ada', 'saat', 'ketika', 'hingga',
  'sampai', 'lebih', 'paling', 'sangat', 'secara', 'terhadap', 'tentang', 'antara', 'melalui', 'tanpa', 'pun', 'lah',
  'kah', 'nya', 'para', 'per', 'demi', 'guna', 'ialah', 'adalah', 'menjadi', 'namun', 'tetapi', 'sedangkan', 'bahwa',
  'supaya', 'kalau', 'jika', 'maka', 'hanya', 'saja', 'kedua', 'satu', 'dua', 'tiga', 'kami', 'kita', 'mereka', 'dia',
  'anda', 'saya', 'dia', 'kini', 'usai', 'sebut', 'jelas', 'kepada', 'bagaimana', 'mengapa', 'siapa', 'apa',
]);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const termPatterns = new Map();

function plainText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&([a-z]+);/giu, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/gu, ' ')
    .trim();
}

function isoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function safeUrl(value) {
  const url = String(value || '').trim();
  return url && !validatePublicSourceUrl(url) ? url : null;
}

function termPattern(term) {
  if (!termPatterns.has(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    termPatterns.set(term, new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu'));
  }
  return termPatterns.get(term);
}

export function normalizeDesk(value) {
  return normalizeCategory(value);
}

function deskForSource(category) {
  const curated = normalizeDesk(category);
  if (curated) return curated;
  return SOURCE_DESKS.get(plainText(category).toLocaleLowerCase('id')) || null;
}

export function inferDesk({ category = '', title = '' } = {}) {
  const curated = deskForSource(category);
  if (curated) return curated;
  const text = plainText(title);
  if (!text) return null;
  const matches = [];
  for (const [desk, terms] of Object.entries(DESK_TERMS)) {
    const score = terms.reduce((total, term) => total + (termPattern(term).test(text) ? 1 : 0), 0);
    if (score > 0) matches.push({ desk, score });
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.score - a.score);
  return matches.length > 1 && matches[0].score === matches[1].score ? null : matches[0].desk;
}

export function titleTokens(value) {
  const tokens = plainText(value).toLocaleLowerCase('id').match(/[\p{L}][\p{L}\p{N}-]*/gu) || [];
  return [...new Set(tokens.filter((token) => token.length >= 3 && !STOPWORDS.has(token)))];
}

export function topicKeywords(value, limit = 8) {
  return titleTokens(value).slice(0, limit);
}

export function containsForbiddenDiscoveryContent(value, depth = 0) {
  if (depth > 6 || !value || typeof value !== 'object') return [];
  const found = new Set();
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_DISCOVERY_KEYS.has(key.toLocaleLowerCase('en'))) found.add(key.toLocaleLowerCase('en'));
    for (const child of containsForbiddenDiscoveryContent(entry, depth + 1)) found.add(child);
  }
  return [...found];
}

export function projectDiscoveryTopic(topic) {
  if (!topic || typeof topic !== 'object') return null;
  const sourceName = plainText(topic.primary_source).slice(0, 100);
  const normalized = plainText(topic.normalized_title)
    || normalizeHeadline(topic.title, { publisher: sourceName });
  const rawTitle = plainText(topic.raw_title) || plainText(topic.title);
  const desk = normalizeDesk(topic.desk) || inferDesk({ category: topic.category, title: normalized });
  const providedKeywords = Array.isArray(topic.topic_keywords)
    ? topic.topic_keywords.map((keyword) => plainText(keyword).toLocaleLowerCase('id'))
      .filter((keyword) => keyword.length >= 3 && !STOPWORDS.has(keyword))
    : [];
  return {
    source_id: positiveId(topic.source_id),
    source_name: sourceName || null,
    source_url: safeUrl(topic.url),
    raw_title: rawTitle || null,
    normalized_title: normalized || null,
    published_at: isoDate(topic.source_published_at ?? topic.published_at),
    discovered_at: isoDate(topic.created_at ?? topic.discovered_at),
    desk,
    topic_keywords: [...new Set(providedKeywords)].slice(0, 8).length
      ? [...new Set(providedKeywords)].slice(0, 8)
      : topicKeywords(normalized),
  };
}
