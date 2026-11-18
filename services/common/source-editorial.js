import { materialSufficiency } from './editorial-contract.js';
import { normalizeEditorialInput } from './original-editorial.js';

const MIN_FACT_LENGTH = 20;
const MAX_FACT_LENGTH = 4000;
const MAX_FACTS = 20;
const MAX_FACT_CHARS = 30000;
const SOURCE_NAV = /^(?:baca\b|baca juga\b|simak juga\b|lihat juga\b|ikuti kami\b|berlangganan\b|advertorial\b|penulis\b|wartawan\b|pewarta\b|reporter\b|editor\b|copyright\b|dilarang keras\b)/iu;
const plain = (value) => typeof value === 'string' ? value.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim() : '';

export function topicEditorialInput(material) {
  const sufficiency = materialSufficiency(material);
  if (!sufficiency.sufficient || !['full', 'partial'].includes(material?.extraction?.status)) {
    throw new Error('source_material_insufficient: Materi artikel tidak cukup untuk menulis berita. Periksa URL, akses sumber, dan jumlah paragraf yang berhasil dibaca.');
  }
  const sourceUrl = material.article_url || material.discovery_url;
  const sourceName = plain(material.publisher) || 'Sumber berita';
  const facts = [];
  let total = 0;
  const seen = new Set();
  for (const paragraph of material.paragraphs) {
    const text = plain(paragraph.text);
    const key = text.toLocaleLowerCase('id');
    const url = paragraph.source_url || sourceUrl;
    if (text.length < MIN_FACT_LENGTH || text.length > MAX_FACT_LENGTH || SOURCE_NAV.test(text) || /copyright\s*[©(]/iu.test(text) || !url || seen.has(key)
      || total + text.length > MAX_FACT_CHARS) continue;
    seen.add(key);
    facts.push({ id: `p${facts.length + 1}`, text, source_url: url, source_name: sourceName });
    total += text.length;
    if (facts.length >= MAX_FACTS) break;
  }
  if (facts.length < 3) throw new Error('source_material_insufficient: Artikel harus memiliki sedikitnya tiga paragraf berbeda yang dapat dirujuk.');
  return normalizeEditorialInput({ version: 1, mode: 'current', facts });
}
