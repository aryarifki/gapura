import { execFile } from 'node:child_process';
import { normalizeCategory, normalizeHeadline } from '../common/editorial-contract.js';

const REGULATION = /\b(?:peraturan pemerintah pengganti undang[- ]undang|undang[- ]undang|peraturan (?:pemerintah|presiden|menteri|daerah|ojk|otoritas jasa keuangan|bank indonesia)|keputusan (?:presiden|menteri)|perppu|perpu|perpres|permen|perda|keppres|kepmen|pojk|pbi|ruu|uu|pp(?=\s+(?:(?:no\.?|nomor)\s*)?\d))\b/iu;
const REGULATION_NUMBER = new RegExp(`(${REGULATION.source})(?: (?:republik indonesia|ri))?\\s+(?:(?:no\\.?\\s*|nomor\\s+))?(\\d{1,6})(?:\\s+tahun\\s+|\\s*\\/\\s*)((?:19|20)\\d{2})\\b`, 'iu');
const RULE_CONTEXT = /\b(?:regulasi|aturan baru|aturan hukum|(?:ubah|terbitkan|revisi|sahkan) aturan|pasal\s+\d+[a-z]?|r?kuhp|r?kuhap)\b/iu;
const COURT_CONTEXT = /\b(?:putusan(?!\s+wasit)|pengadilan|mahkamah (?:konstitusi|agung)|(?:mk|ma) (?:putuskan|kabulkan|tolak|adili|uji|batalkan)|vonis|amar putusan|uji materi|judicial review|gugatan)\b/iu;
const CASE_NUMBER = /\b(?:\d{1,7}\s+(?:K|PK|P)\/[a-z.]+\/\d{4}|\d{1,7}\/(?:PUU|SKLN|PHPU(?:\.[a-z]+)?|PHPKADA)(?:-[ivxlcdm]+)?\/\d{4}|\d{1,7}\/(?:Pid|Pdt|Tun|G|P)(?:\.[a-z]+)*\/\d{4}\/(?:PN|PTUN|PTA|PT|PA)(?:[ .][a-z]+(?:\.[a-z]+)?)?)\b/iu;
const RULE_ALIASES = new Map([
  ['undang-undang', 'uu'], ['undang undang', 'uu'],
  ['peraturan pemerintah pengganti undang-undang', 'perppu'], ['perpu', 'perppu'],
  ['peraturan pemerintah', 'pp'], ['peraturan presiden', 'perpres'], ['peraturan menteri', 'permen'],
  ['peraturan daerah', 'perda'], ['peraturan ojk', 'pojk'], ['peraturan otoritas jasa keuangan', 'pojk'], ['peraturan bank indonesia', 'pbi'],
  ['keputusan presiden', 'keppres'], ['keputusan menteri', 'kepmen'],
]);
const RULE_TITLES = new Map([
  ['pdp', 'pelindungan data pribadi'], ['ite', 'informasi dan transaksi elektronik'],
  ['p2sk', 'pengembangan dan penguatan sektor keuangan'],
  ['kuhp', 'kitab undang-undang hukum pidana'], ['kuhap', 'kitab undang-undang hukum acara pidana'],
]);
const REGULATION_HOSTS = new Map([
  ['peraturan.go.id', 'Peraturan.go.id'], ['www.peraturan.go.id', 'Peraturan.go.id'],
  ['peraturan.bpk.go.id', 'JDIH BPK RI'],
]);
const DECISION_HOSTS = new Map([
  ['putusan3.mahkamahagung.go.id', 'Mahkamah Agung RI'], ['putusan.mahkamahagung.go.id', 'Mahkamah Agung RI'],
  ['mkri.id', 'Mahkamah Konstitusi RI'], ['www.mkri.id', 'Mahkamah Konstitusi RI'], ['s.mkri.id', 'Mahkamah Konstitusi RI'],
]);
const RESULT_LIMIT = 5;
const MAX_TEXT_LENGTH = 8000;
const NO_AMAR = /^(?:[-–—.]+|n\/?a|null|nihil|amar putusan|mengadili|(?:amar(?: putusan)? )?(?:belum|tidak) (?:ada|tersedia)|dalam proses)[.!:]?$/iu;

const plain = (value) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
const headline = (topic) => normalizeHeadline(topic?.normalized_title || topic?.title, { publisher: topic?.primary_source }).slice(0, 400);
const lawDesk = (topic) => [topic?.desk, topic?.category].some((value) => normalizeCategory(value) === 'hukum' || value === 'jdih_hukum');

export function needsLegalContext(topic) {
  const title = headline(topic);
  return lawDesk(topic) || [REGULATION, RULE_CONTEXT, COURT_CONTEXT, CASE_NUMBER].some((pattern) => pattern.test(title));
}

function statuteType(value) {
  const name = plain(value).toLocaleLowerCase('id');
  const type = name === 'pp' ? name : name.match(REGULATION)?.[0].toLocaleLowerCase('id') || '';
  return RULE_ALIASES.get(type) || type;
}

// The index matches substrings. Send a short legal identifier or subject from
// the public headline. Topic summaries and full records stay in Gapura.
function subjectQuery(value, wordLimit = 4) {
  const subject = plain(value).toLocaleLowerCase('id')
    .replace(/^(?:(?:soal|tentang|terkait|atas|mk|ma|putusan|perkara|terbaru|resmi|mengenai)\s+)*/u, '')
    .split(/[,;:|–—]|\s+\b(?:yang|mulai|usai|setelah|sebelum|disahkan|dibahas|direvisi|disorot|diterapkan|berlaku|mengatur|mewajibkan|ditolak|dikabulkan|bakal|akan|untuk)\b/u, 1)[0];
  const alias = RULE_TITLES.get(subject.split(' ', 1)[0]);
  if (alias) return alias;
  const words = [];
  for (const word of subject.split(' ').slice(0, wordLimit)) {
    if (!/^[\p{L}]{2,24}(?:-[\p{L}]{2,24})?$/u.test(word)) break;
    words.push(word);
  }
  while (['dan', 'atau', 'di', 'atas', 'soal'].includes(words.at(-1))) words.pop();
  return words.join(' ').replace(/\bperlindungan data pribadi\b/u, 'pelindungan data pribadi');
}

function lookupPlan(title) {
  const plans = [];
  const number = title.match(REGULATION_NUMBER);
  const rule = title.match(REGULATION) || title.match(RULE_CONTEXT);
  if (rule) {
    const reference = number && { type: statuteType(number[1]), number: Number(number[2]), year: Number(number[3]) };
    const match = number || rule;
    const namedRule = RULE_TITLES.get(rule[0].toLocaleLowerCase('id').replace(/^r(?=kuh)/u, ''));
    const subject = namedRule || subjectQuery(title.slice(match.index + match[0].length));
    if (reference && reference.type !== 'ruu') plans.push({ archive: 'regulations', q: `${reference.number} Tahun ${reference.year}`, reference });
    if (subject && reference?.type !== 'ruu') plans.push({ archive: 'regulations', q: subject, reference });
  }
  const caseNumber = title.match(CASE_NUMBER)?.[0];
  const court = title.match(COURT_CONTEXT);
  if (caseNumber) plans.unshift({ archive: 'decisions', q: caseNumber, caseNumber });
  else if (court || !rule) {
    const subject = subjectQuery(court ? title.slice(court.index + court[0].length) : title, 2);
    if (subject.includes(' ')) plans.unshift({ archive: 'decisions', q: subject });
  }
  return plans.slice(0, 2);
}

function matchesLookup(row, plan) {
  if (!row || typeof row !== 'object') return false;
  if (plan.caseNumber) {
    const key = (value) => plain(value).replace(/\s+/gu, '').toLocaleLowerCase('id');
    return key(row.nomor_perkara) === key(plan.caseNumber);
  }
  if (plan.reference) return statuteType(row.jenis || row.judul) === plan.reference.type
    && Number(row.nomor) === plan.reference.number && Number(row.tahun) === plan.reference.year;
  const q = plan.q.toLocaleLowerCase('id');
  return [row.judul, row.amar_putusan].some((value) => plain(value).toLocaleLowerCase('id').includes(q));
}

function corpusOrigin(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return null;
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

function officialSource(value, archive) {
  if (typeof value !== 'string' || !URL.canParse(value)) return null;
  const url = new URL(value);
  const name = (archive === 'regulations' ? REGULATION_HOSTS : DECISION_HOSTS).get(url.hostname);
  if (!name || url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname === '/') return null;
  if ([...url.searchParams.keys()].some((key) => !/^(?:utm_[a-z_]+|fbclid|gclid)$/iu.test(key))) return null;
  url.search = '';
  url.hash = '';
  return { url: url.href, name };
}

function isPdf(source) {
  return source && /\.pdf$/iu.test(new URL(source.url).pathname);
}

async function readBytes(url, { fetchImpl, signal, accept, maxBytes }) {
  const response = await fetchImpl(url, { method: 'GET', headers: { Accept: accept }, credentials: 'omit', redirect: 'error', signal });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('legal_response_unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxBytes) throw new Error('legal_response_too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function searchArchive(origin, plan, request) {
  const url = new URL(`/api/data/${plan.archive}`, origin);
  url.search = new URLSearchParams({ q: plan.q, page: '1', limit: String(RESULT_LIMIT) });
  try {
    const body = JSON.parse(await readBytes(url, { ...request, accept: 'application/json', maxBytes: 256 * 1024 }));
    return Array.isArray(body?.items) ? body.items.slice(0, RESULT_LIMIT).filter((row) => matchesLookup(row, plan)) : null;
  } catch {
    return null;
  }
}

function readPdfText(pdf, signal) {
  return new Promise((resolve, reject) => {
    const child = execFile('pdftotext', ['-q', '-enc', 'UTF-8', '-f', '1', '-l', '18', '-', '-'], {
      signal, timeout: 1500, maxBuffer: 512 * 1024, env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(pdf);
  });
}

function excerpt(value) {
  const text = plain(value);
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH).replace(/\s+\S*$/u, '') : text;
}

async function regulationText(pdfUrl, row, title, request, extractPdfText) {
  try {
    const pdf = await readBytes(new URL(pdfUrl), { ...request, accept: 'application/pdf', maxBytes: 5 * 1024 * 1024 });
    if (pdf.subarray(0, 5).toString() !== '%PDF-') return '';
    const text = await extractPdfText(pdf, request.signal);
    const start = text.search(/\bmemutuskan\s*:/iu);
    if (start === -1) return '';
    const header = text.slice(0, start).split(/^[ \t]*tentang[ \t]*$/imu, 1)[0];
    const identifier = header.match(/\bnomor\s+(\d+)\s+tahun\s+(\d{4})\b/iu);
    if (identifier && (Number(identifier[1]) !== Number(row.nomor) || Number(identifier[2]) !== Number(row.tahun))) return '';
    const requested = title.match(/\bpasal\s+(\d+[a-z]?)\b/iu)?.[1];
    const article = (number) => new RegExp(`^[ \\t]*pasal[ \\t]+${number}[ \\t]*\\.?[ \\t]*$`, 'imu');
    const articleNumber = '(?:\\d+[a-z]?|[ivxlcdm]+)';
    const body = text.slice(start);
    const heading = article(requested || articleNumber).exec(body);
    if (!heading) return '';
    const rest = body.slice(heading.index + heading[0].length);
    const next = rest.search(article(articleNumber));
    if (!/\p{L}{3}/u.test(next === -1 ? rest : rest.slice(0, next))) return '';
    return excerpt(heading[0] + (requested && next !== -1 ? rest.slice(0, next) : rest));
  } catch {
    return '';
  }
}

/** Returns substantive legal documents and separate citation leads from the existing index. */
export async function lookupLegalSources(topic, {
  baseUrl = process.env.OCRAWLER_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = 3500, extractPdfText = readPdfText,
} = {}) {
  const documents = new Map();
  const leads = new Map();
  const result = (status) => ({ status, documents: [...documents.values()], leads: [...leads.values()] });
  if (!needsLegalContext(topic)) return result('not_needed');
  if (baseUrl == null || (typeof baseUrl === 'string' && !baseUrl.trim())) return result('not_configured');
  const origin = corpusOrigin(baseUrl);
  if (!origin) return result('invalid_config');
  const title = headline(topic);
  const plans = lookupPlan(title);
  const request = { fetchImpl, signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? Math.min(5000, Math.max(1, Math.trunc(timeoutMs))) : 3500) };
  const matches = await Promise.all(plans.map((plan) => searchArchive(origin, plan, request)));

  let regulationPdf;
  for (const [index, rows] of matches.entries()) {
    const { archive } = plans[index];
    for (const row of rows || []) {
      const pdfSource = officialSource(row.pdf_path, archive);
      const source = officialSource(row.sumber_url, archive) || (isPdf(pdfSource) ? pdfSource : null);
      if (!source) continue;
      const name = plain(row.judul) || plain(row.nomor_perkara);
      if (!name) continue;
      const citation = { ...source, title: name.slice(0, 300) };
      const text = archive === 'decisions' ? excerpt(row.amar_putusan) : '';
      if (text && !NO_AMAR.test(text) && /\p{L}/u.test(text)) {
        documents.set(citation.url, { ...citation, text, kind: 'legal', text_kind: 'page' });
        leads.delete(citation.url);
      } else if (!documents.has(citation.url)) {
        leads.set(citation.url, citation);
      }
      if (archive === 'regulations' && !regulationPdf) {
        const pdf = [source, pdfSource].find(isPdf);
        if (pdf) regulationPdf = { citation, pdf, row };
      }
    }
  }
  if (regulationPdf && !request.signal.aborted) {
    const { citation, pdf, row } = regulationPdf;
    const text = await regulationText(pdf.url, row, title, request, extractPdfText);
    if (text) {
      documents.set(pdf.url, { ...citation, ...pdf, text, kind: 'legal', text_kind: 'page' });
      leads.delete(citation.url);
    }
  }
  if (documents.size) return result('ok');
  if (leads.size) return result('metadata_only');
  return result(matches.includes(null) ? 'unavailable' : 'no_match');
}
