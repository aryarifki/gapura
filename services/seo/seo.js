// ==============================================================================
// GME v2.1 - Agen SEO (Trending & Virality Hunter)
// File: /root/gapura/services/seo/seo.js
// ------------------------------------------------------------------------------
// Mencari berita/percakapan yang sedang viral dari:
//   1. X/Twitter  : via X API v2 (X_BEARER_TOKEN) -> RSSHub (RSSHUB_BASE_URL)
//                   -> Google News proxy (keyless, berbasis nama institusi)
//   2. Google Trends RSS (keyless)
//   3. Momentum berita Google News RSS (keyless)
// Semua sumber dapat dikustomisasi dari dashboard (tabel trend_sources).
// ==============================================================================

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fetchFeed, parseFeed, googleNewsRssUrl, domainOf } from '../common/rss.js';
import { loadAgentsConfig } from '../common/llm.js';

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

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || '';
const RSSHUB_BASE_URL = (process.env.RSSHUB_BASE_URL || '').replace(/\/+$/, '');

const DEFAULT_KEYWORDS = [
  'ihsg', 'bursa', 'saham', 'ojk', 'pojk', 'bank indonesia', 'bi-rate', 'rupiah',
  'inflasi', 'bps', 'apbn', 'pajak', 'suku bunga', 'pasar modal', 'bei', 'idx',
  'regulasi', 'dividen', 'emiten', 'obligasi', 'investasi',
];

const CATEGORY_KEYWORDS = {
  pasar_modal: ['ihsg', 'saham', 'bursa', 'emiten', 'bei', 'idx', 'dividen', 'pasar modal'],
  regulasi: ['ojk', 'pojk', 'regulasi', 'sanksi', 'uu', 'putusan', 'kepatuhan'],
  moneter: ['bank indonesia', 'bi-rate', 'suku bunga', 'rupiah', 'kurs', 'inflasi', 'devisa'],
  fiskal: ['apbn', 'pajak', 'kemenkeu', 'defisit', 'belanja negara', 'subsidi'],
  data_makro: ['bps', 'inflasi', 'pdb', 'ekspor', 'impor', 'neraca', 'kemiskinan'],
  trending: [],
};

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function hashKey(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hoursAgo(date) {
  if (!date) return 48;
  return Math.max(0, (Date.now() - new Date(date).getTime()) / 36e5);
}

/** "200+" / "2.000+" / "1,5 jt" -> angka kasar untuk skor. */
function parseApproxTraffic(raw) {
  const s = String(raw || '').toLowerCase().replace(/\+/g, '').trim();
  if (!s) return 0;
  const m = s.match(/([\d.,]+)\s*(jt|juta|rb|ribu|k|m)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  const unit = m[2];
  if (unit === 'jt' || unit === 'juta' || unit === 'm') n *= 1e6;
  else if (unit === 'rb' || unit === 'ribu' || unit === 'k') n *= 1e3;
  return Math.round(n);
}

function keywordListFor(category) {
  const cfg = loadAgentsConfig();
  const custom = String(cfg.scout?.custom_keywords || '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_KEYWORDS, ...(CATEGORY_KEYWORDS[category] || []), ...custom]));
}

function matchedKeywords(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.filter((kw) => kw && lower.includes(kw));
}

/**
 * Skor viralitas 0-100: sinyal platform + bobot sumber + kebaruan + relevansi kata kunci.
 */
function computeVirality({ platform, engagement = {}, publishedAt, sourceWeight = 10, keywords = [], text = '' }) {
  let platformScore = 0;
  if (platform === 'x') {
    const raw =
      (engagement.likes || 0) +
      2 * (engagement.retweets || 0) +
      1.5 * (engagement.replies || 0) +
      0.75 * (engagement.quotes || 0) +
      0.25 * (engagement.impressions || 0) / 10;
    platformScore = Math.min(70, Math.round(Math.log10(raw + 1) * 22));
  } else if (platform === 'google_trends') {
    const traffic = engagement.approx_traffic || 0;
    platformScore = Math.min(70, Math.round(Math.log10(traffic + 1) * 20));
  } else {
    platformScore = 32; // momentum berita: baseline
  }

  const weightScore = Math.min(20, Math.round((Number(sourceWeight) || 10) * 0.8));
  const age = hoursAgo(publishedAt);
  const recencyScore = age <= 3 ? 12 : age <= 12 ? 8 : age <= 24 ? 4 : 0;
  const matched = matchedKeywords(text, keywords);
  const keywordScore = matched.length ? Math.min(10, matched.length * 3) : 0;

  let total = Math.max(0, Math.min(100, platformScore + weightScore + recencyScore + keywordScore));
  // Google Trends sering berisi topik hiburan/olahraga di luar niche. Tanpa
  // kecocokan kata kunci, turunkan drastis agar tidak menenggelamkan berita relevan.
  if (platform === 'google_trends' && matched.length === 0) {
    total = Math.round(total * 0.3);
  }
  return {
    score: total,
    matched,
    breakdown: { platform: platformScore, source_weight: weightScore, recency: recencyScore, keywords: keywordScore },
  };
}

// ------------------------------------------------------------------------------
// Provider X/Twitter
// ------------------------------------------------------------------------------
async function fetchXUserTweets(handle) {
  const username = String(handle).replace(/^@/, '');
  if (!X_BEARER_TOKEN) throw new Error('X_BEARER_TOKEN tidak dikonfigurasi');

  const userRes = await fetch(
    `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics,name`,
    { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }, signal: AbortSignal.timeout(15000) }
  );
  if (!userRes.ok) throw new Error(`X user lookup HTTP ${userRes.status}`);
  const userData = await userRes.json();
  const userId = userData?.data?.id;
  if (!userId) throw new Error(`Akun X @${username} tidak ditemukan`);

  const tweetsRes = await fetch(
    `https://api.twitter.com/2/users/${userId}/tweets?max_results=10&exclude=retweets,replies&tweet.fields=created_at,public_metrics`,
    { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }, signal: AbortSignal.timeout(15000) }
  );
  if (!tweetsRes.ok) throw new Error(`X timeline HTTP ${tweetsRes.status}`);
  const tweetsData = await tweetsRes.json();

  return (tweetsData.data || []).map((t) => ({
    provider: 'x_api',
    platform: 'x',
    author: `@${username}`,
    title: normalizeText(t.text).slice(0, 280),
    snippet: normalizeText(t.text),
    url: `https://x.com/${username}/status/${t.id}`,
    published_at: toDate(t.created_at),
    engagement: {
      likes: t.public_metrics?.like_count || 0,
      retweets: t.public_metrics?.retweet_count || 0,
      replies: t.public_metrics?.reply_count || 0,
      quotes: t.public_metrics?.quote_count || 0,
    },
  }));
}

async function fetchXSearch(query) {
  if (!X_BEARER_TOKEN) throw new Error('X_BEARER_TOKEN tidak dikonfigurasi');
  const q = `${query} -is:retweet lang:id`;
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=20&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,name`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`X search HTTP ${res.status}`);
  const data = await res.json();
  const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));

  return (data.data || []).map((t) => {
    const u = users.get(t.author_id);
    return {
      provider: 'x_api',
      platform: 'x',
      author: u ? `@${u.username}` : null,
      title: normalizeText(t.text).slice(0, 280),
      snippet: normalizeText(t.text),
      url: u ? `https://x.com/${u.username}/status/${t.id}` : null,
      published_at: toDate(t.created_at),
      engagement: {
        likes: t.public_metrics?.like_count || 0,
        retweets: t.public_metrics?.retweet_count || 0,
        replies: t.public_metrics?.reply_count || 0,
        quotes: t.public_metrics?.quote_count || 0,
      },
    };
  });
}

async function fetchRsshubUser(handle) {
  if (!RSSHUB_BASE_URL) throw new Error('RSSHUB_BASE_URL tidak dikonfigurasi');
  const username = String(handle).replace(/^@/, '');
  const feed = await fetchFeed(`${RSSHUB_BASE_URL}/twitter/user/${encodeURIComponent(username)}`);
  if (!feed.ok) throw new Error(`RSSHub HTTP ${feed.status || 0}`);
  return feed.items.map((it) => ({
    provider: 'rsshub',
    platform: 'x',
    author: `@${username}`,
    title: normalizeText(it.title || it.description).slice(0, 280),
    snippet: normalizeText(it.description || it.title),
    url: it.link,
    published_at: toDate(it.pubDate),
    engagement: {},
  }));
}

/** Fallback jujur tanpa X API: cari momentum pemberitaan institusi via Google News. */
function keywordsFromLabel(label, handle) {
  const cleaned = String(label || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[@#]/g, ' ')
    .replace(/\b(media|channel|news|indonesia|ri)\b/gi, (m) => (m.toLowerCase() === 'indonesia' ? '' : m))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(handle || '').replace(/^@/, '');
}

async function fetchGoogleNewsProxy(source) {
  const query = source.kind === 'x_account'
    ? keywordsFromLabel(source.label, source.value)
    : source.value;
  const feed = await fetchFeed(googleNewsRssUrl(query, { when: '1d' }));
  if (!feed.ok) throw new Error(`Google News HTTP ${feed.status || 0}`);
  return feed.items.slice(0, 15).map((it) => ({
    provider: 'google_news_proxy',
    platform: 'news',
    author: domainOf(it.link) || 'Google News',
    title: normalizeText(it.title),
    snippet: normalizeText(it.description),
    url: it.link,
    published_at: toDate(it.pubDate),
    engagement: {},
  }));
}

async function fetchGoogleTrends(source) {
  const geo = (source.value || 'ID').toUpperCase();
  const feed = await fetchFeed(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`);
  if (!feed.ok) throw new Error(`Google Trends HTTP ${feed.status || 0}`);
  return feed.items.slice(0, 20).map((it) => {
    const traffic = parseApproxTraffic(it.extra?.approxTraffic);
    const news = it.extra?.newsItems || [];
    const mainNews = news[0];
    return {
      provider: 'google_trends',
      platform: 'google_trends',
      author: geo,
      title: normalizeText(it.title),
      snippet: mainNews ? `${mainNews.title}${mainNews.source ? ` — ${mainNews.source}` : ''}` : normalizeText(it.description),
      url: mainNews?.url || it.link || `https://trends.google.com/trends/explore?geo=${geo}&q=${encodeURIComponent(it.title)}`,
      published_at: toDate(it.pubDate),
      engagement: { approx_traffic: traffic, traffic_label: it.extra?.approxTraffic || '' },
    };
  });
}

async function fetchSourceItems(source) {
  switch (source.kind) {
    case 'x_account': {
      const errors = [];
      if (X_BEARER_TOKEN) {
        try {
          return await fetchXUserTweets(source.value);
        } catch (err) {
          errors.push(`x_api: ${err.message}`);
        }
      }
      if (RSSHUB_BASE_URL) {
        try {
          return await fetchRsshubUser(source.value);
        } catch (err) {
          errors.push(`rsshub: ${err.message}`);
        }
      }
      const items = await fetchGoogleNewsProxy(source);
      if (errors.length && items.length === 0) throw new Error(errors.join(' | '));
      return items;
    }
    case 'x_query': {
      if (X_BEARER_TOKEN) return fetchXSearch(source.value);
      return fetchGoogleNewsProxy(source);
    }
    case 'google_trends':
      return fetchGoogleTrends(source);
    case 'news_query':
      return fetchGoogleNewsProxy(source);
    default:
      throw new Error(`Jenis sumber tidak dikenal: ${source.kind}`);
  }
}

// ------------------------------------------------------------------------------
// Simpan & skor
// ------------------------------------------------------------------------------
async function saveTrendItem(client, source, item, keywords) {
  const title = normalizeText(item.title);
  if (!title) return null;

  const canonicalUrl = item.url ? String(item.url).split('?')[0] : '';
  const dedupSeed = canonicalUrl || `${item.platform}:${item.author || ''}:${title.toLowerCase()}`;
  const urlHash = hashKey(dedupSeed);

  const virality = computeVirality({
    platform: item.platform,
    engagement: item.engagement,
    publishedAt: item.published_at,
    sourceWeight: source.weight,
    keywords,
    text: `${title} ${item.snippet || ''}`,
  });

  const { rows } = await client.query(
    `INSERT INTO trend_items
       (trend_source_id, platform, provider, author, title, snippet, url, url_hash,
        engagement, virality_score, score_breakdown, matched_keywords, published_at, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (url_hash) WHERE url_hash IS NOT NULL DO UPDATE SET
       virality_score = EXCLUDED.virality_score,
       engagement = EXCLUDED.engagement,
       score_breakdown = EXCLUDED.score_breakdown,
       matched_keywords = EXCLUDED.matched_keywords,
       fetched_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      source.id,
      item.platform,
      item.provider,
      item.author || null,
      title,
      item.snippet || null,
      item.url || null,
      urlHash,
      JSON.stringify(item.engagement || {}),
      virality.score,
      JSON.stringify(virality.breakdown),
      virality.matched,
      item.published_at,
    ]
  );

  return { id: rows[0].id, inserted: rows[0].inserted, score: virality.score };
}

/**
 * Jalankan pemindaian SEO untuk seluruh sumber aktif (atau satu sumber).
 */
export async function runSeoScan({ sourceId = null, client } = {}) {
  const db = client || (await pool.connect());
  const shouldRelease = !client;
  const startedAt = new Date();
  const summary = { sources: 0, items_seen: 0, items_new: 0, errors: [] };

  try {
    const params = [];
    let where = 'WHERE is_active = TRUE';
    if (sourceId) {
      params.push(sourceId);
      where += ` AND id = $${params.length}`;
    }
    const { rows: sources } = await db.query(`SELECT * FROM trend_sources ${where} ORDER BY weight DESC, id ASC`, params);

    for (const source of sources) {
      summary.sources += 1;
      try {
        const items = await fetchSourceItems(source);
        const keywords = keywordListFor(source.category);
        for (const item of items) {
          summary.items_seen += 1;
          const saved = await saveTrendItem(db, source, item, keywords);
          if (saved?.inserted) summary.items_new += 1;
        }
        await db.query('UPDATE trend_sources SET last_scanned_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1', [source.id]);
      } catch (err) {
        const message = err.message.slice(0, 500);
        summary.errors.push({ source_id: source.id, label: source.label, error: message });
        await db.query('UPDATE trend_sources SET last_scanned_at = NOW(), last_error = $2, updated_at = NOW() WHERE id = $1', [source.id, message]);
      }
    }

    // Rapikan skor historis: trend Google tanpa kecocokan kata kunci tidak boleh
    // menenggelamkan berita relevan (berlaku juga untuk item lama).
    await db.query(
      `UPDATE trend_items
       SET virality_score = LEAST(virality_score, 30)
       WHERE platform = 'google_trends'
         AND (matched_keywords IS NULL OR cardinality(matched_keywords) = 0)
         AND virality_score > 30`
    );

    const status = summary.errors.length === sources.length && sources.length > 0 ? 'error' : 'success';
    await db.query(
      `INSERT INTO agent_runs (agent, entity_id, started_at, completed_at, status, model, error_log)
       VALUES ('seo', NULL, $1, NOW(), $2, 'seo-trend-hunter-v1', $3)`,
      [startedAt, status, summary.errors.length ? JSON.stringify(summary.errors) : null]
    );

    return summary;
  } finally {
    if (shouldRelease) db.release();
  }
}

/** Daftar trend teratas untuk dashboard. */
export async function listTrends({ limit = 50, platform = null, minScore = 0 } = {}) {
  const params = [parseInt(limit, 10) || 50, parseInt(minScore, 10) || 0];
  let where = "WHERE ti.virality_score >= $2 AND ti.fetched_at > NOW() - INTERVAL '3 days'";
  if (platform) {
    params.push(platform);
    where += ` AND ti.platform = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT ti.*, ts.label AS source_label, ts.category AS source_category,
            t.id AS promoted_draft_topic_id
     FROM trend_items ti
     LEFT JOIN trend_sources ts ON ts.id = ti.trend_source_id
     LEFT JOIN topics t ON t.id = ti.promoted_topic_id
     ${where}
     ORDER BY ti.virality_score DESC, ti.fetched_at DESC
     LIMIT $1`,
    params
  );
  return rows;
}

/**
 * Naikkan satu trend menjadi topik editorial (siap dinilai Analis / diproduksi).
 */
export async function promoteTrendToTopic(trendId, client) {
  const db = client || (await pool.connect());
  const shouldRelease = !client;
  try {
    const { rows } = await db.query('SELECT * FROM trend_items WHERE id = $1', [trendId]);
    if (rows.length === 0) throw new Error('Trend tidak ditemukan');
    const trend = rows[0];

    if (trend.promoted_topic_id) {
      return { topic_id: trend.promoted_topic_id, is_existing: true };
    }

    const sourceLabel = trend.author || (trend.platform === 'x' ? 'X/Twitter' : 'Trending');
    const summaryParts = [trend.snippet, trend.engagement?.traffic_label ? `Volume pencarian: ${trend.engagement.traffic_label}` : '']
      .filter(Boolean)
      .join(' ');

    const { rows: topicRows } = await db.query(
      `INSERT INTO topics (title, summary, url, primary_source, status, source_kind, trend_score)
       VALUES ($1, $2, $3, $4, 'new', 'trend', $5)
       RETURNING id`,
      [trend.title, summaryParts || trend.title, trend.url, sourceLabel, trend.virality_score]
    );
    const topicId = topicRows[0].id;

    await db.query('UPDATE trend_items SET promoted_topic_id = $2 WHERE id = $1', [trendId, topicId]);
    await db.query(
      `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
       VALUES ('topic', $1, 'promote_trend', 'seo-agent', $2)`,
      [topicId, JSON.stringify({ trend_id: trendId, platform: trend.platform, virality_score: trend.virality_score })]
    );

    return { topic_id: topicId, is_existing: false };
  } finally {
    if (shouldRelease) db.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeoScan()
    .then((res) => {
      console.log('SEO scan complete:', JSON.stringify(res, null, 2));
      pool.end();
    })
    .catch((err) => {
      console.error('SEO scan error:', err);
      pool.end();
      process.exit(1);
    });
}
