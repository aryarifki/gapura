// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Agen Scout
// File: /root/gapura/services/scout/scout.js
// Niche Sources Poller with Two-Layer Deduplication Engine
// ==============================================================================

import pkg from 'pg';
const { Pool } = pkg;
import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  host: process.env.HME_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.HME_DB_PORT || '5432'),
  user: process.env.HME_DB_USER || 'hme_user',
  password: process.env.HME_DB_PASSWORD,
  database: process.env.HME_DB_NAME || 'hme',
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

// Normalisasi URL (hapus tracking query params)
function normalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl.trim());
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid'];
    trackingParams.forEach((param) => parsed.searchParams.delete(param));
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

// SHA-256 Hash URL
function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

// Bersihkan teks HTML jika ada di summary
function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>?/gm, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export async function runScout() {
  const client = await pool.connect();
  const startTime = Date.now();
  console.log('[Scout] Memulai siklus pemantauan sumber niche...');

  let totalFetched = 0;
  let totalNew = 0;
  let totalDuplicates = 0;

  try {
    // 1. Ambil daftar sumber aktif
    const { rows: sources } = await client.query('SELECT * FROM sources WHERE is_active = TRUE ORDER BY id ASC');
    console.log(`[Scout] Ditemukan ${sources.length} sumber aktif.`);

    for (const src of sources) {
      console.log(`[Scout] Polling: ${src.name} (${src.url_or_query})`);

      let feedText = '';
      try {
        const response = await fetch(src.url_or_query, {
          headers: {
            'User-Agent': 'HomelessMediaEngine/2.0 (+https://instagram.com/homelessmedia; ScoutBot)',
            Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml, text/html',
          },
          signal: AbortSignal.timeout(15000), // timeout 15 detik
        });

        if (!response.ok) {
          console.warn(`[Scout] Gagal fetch ${src.name}: HTTP ${response.status}`);
          continue;
        }

        feedText = await response.text();
      } catch (fetchErr) {
        console.warn(`[Scout] Error koneksi saat polling ${src.name}:`, fetchErr.message);
        continue;
      }

      // Parsing XML RSS / Atom
      let items = [];
      try {
        const parsed = xmlParser.parse(feedText);
        // Cek struktur RSS 2.0 (<rss><channel><item>)
        if (parsed?.rss?.channel?.item) {
          items = Array.isArray(parsed.rss.channel.item) ? parsed.rss.channel.item : [parsed.rss.channel.item];
        }
        // Cek struktur Atom (<feed><entry>)
        else if (parsed?.feed?.entry) {
          items = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
        }
      } catch (parseErr) {
        console.warn(`[Scout] Gagal parse XML dari ${src.name}:`, parseErr.message);
        continue;
      }

      for (const rawItem of items) {
        totalFetched++;

        // Ekstrak URL, Judul, Tanggal, Summary
        const rawUrl = rawItem.link?.['#text'] || rawItem.link?.['@_href'] || rawItem.link || rawItem.guid?.['#text'] || rawItem.guid || '';
        const title = rawItem.title?.['#text'] || rawItem.title || '';
        const rawContent = rawItem.description?.['#text'] || rawItem.description || rawItem.content?.['#text'] || rawItem.content || '';
        const pubDateStr = rawItem.pubDate || rawItem.published || rawItem.updated || null;

        if (!rawUrl || !title) continue;

        const cleanUrl = normalizeUrl(rawUrl);
        const urlHash = hashUrl(cleanUrl);
        const cleanTitle = stripHtml(title);
        const cleanSummary = stripHtml(rawContent).slice(0, 1000);
        let publishedAt = null;
        if (pubDateStr) {
          try {
            publishedAt = new Date(pubDateStr);
          } catch {
            publishedAt = null;
          }
        }

        // --- DEDUP LAPIS 1: Hash URL Unik ---
        const { rows: existingHash } = await client.query('SELECT id FROM raw_items WHERE url_hash = $1', [urlHash]);
        if (existingHash.length > 0) {
          totalDuplicates++;
          continue;
        }

        // --- DEDUP LAPIS 2: Kemiripan Judul Semantik (pg_trgm > 0.70 dalam 7 hari) ---
        const { rows: similarItems } = await client.query(
          `SELECT id, title, similarity(title, $1) AS sm
           FROM raw_items
           WHERE fetched_at > NOW() - INTERVAL '7 days'
             AND similarity(title, $1) > 0.70
           ORDER BY sm DESC
           LIMIT 1`,
          [cleanTitle]
        );

        if (similarItems.length > 0) {
          totalDuplicates++;
          console.log(`[Scout] Duplikat semantik terdeteksi (${Math.round(similarItems[0].sm * 100)}% mirip): "${cleanTitle}" vs "${similarItems[0].title}"`);
          continue;
        }

        // --- SIMPAN ITEM LOLOS DEDUP KE RAW_ITEMS & TOPICS ---
        const insertRaw = await client.query(
          `INSERT INTO raw_items (source_id, url, url_hash, title, content_raw, published_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [src.id, cleanUrl, urlHash, cleanTitle, cleanSummary, publishedAt]
        );

        const rawItemId = insertRaw.rows[0].id;

        await client.query(
          `INSERT INTO topics (raw_item_id, title, summary, url, primary_source, status)
           VALUES ($1, $2, $3, $4, $5, 'new')`,
          [rawItemId, cleanTitle, cleanSummary, cleanUrl, src.name]
        );

        totalNew++;
        console.log(`[Scout] [TOPIK BARU] #${rawItemId}: ${cleanTitle}`);
      }
    }

    // Catat Telemetri Agen Scout
    const durationMs = Date.now() - startTime;
    await client.query(
      `INSERT INTO agent_runs (agent, started_at, completed_at, status, model, tokens_input, tokens_output, est_cost_idr)
       VALUES ('scout', NOW(), NOW(), 'success', 'rss-poller-deterministic', 0, 0, 0.00)`
    );

    console.log(`\n[Scout] Selesai: ${totalFetched} item dipindai, ${totalDuplicates} duplikat diabaikan, ${totalNew} topik baru berhasil dimasukkan ke pipeline.`);
    return { totalFetched, totalDuplicates, totalNew, durationMs };
  } finally {
    client.release();
  }
}

// Eksekusi langsung jika dipanggil via node
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runScout()
    .then((res) => {
      console.log('Scout run complete:', res);
      pool.end();
    })
    .catch((err) => {
      console.error('Scout run error:', err);
      pool.end();
      process.exit(1);
    });
}
