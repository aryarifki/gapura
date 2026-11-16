// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Agen Scout
// File: /root/gapura/services/scout/scout.js
// Niche Sources Poller with Two-Layer Deduplication Engine
// ==============================================================================

import pkg from 'pg';
const { Pool } = pkg;
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { cleanText, fetchXAccount, fetchXQuery, normalizeArticleUrl, normalizeFeedItem, safeDate } from './sources.js';
import { mapLimit } from '../common/concurrency.js';
import { parseFeed } from '../common/rss.js';
import { loadAgentsConfig } from '../common/llm.js';
import { createMaterial } from './material.js';
import { persistTopicMaterial } from './material-store.js';
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

// SHA-256 Hash URL
function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

export async function runScout({ force = false, client: suppliedClient, config = loadAgentsConfig() } = {}) {
  const client = suppliedClient || await pool.connect();
  const startTime = Date.now();
  console.log('[Scout] Memulai siklus pemantauan sumber niche...');
  const cfg = config.scout || {};
  const configuredMax = Number(cfg.max_items_per_source ?? 15);
  const maxItems = Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 1000 ? configuredMax : 15;
  const configuredDedup = Number(cfg.dedup_similarity_threshold ?? 0.7);
  const dedupThreshold = Number.isFinite(configuredDedup) && configuredDedup >= 0 && configuredDedup <= 1 ? configuredDedup : 0.7;
  let totalFetched = 0;
  let totalNew = 0;
  let totalDuplicates = 0;
  const sourceResults = [];

  try {
    // 1. Ambil daftar sumber aktif
    const { rows: sources } = await client.query(
      `SELECT * FROM sources
       WHERE is_active = TRUE
         AND ($1::boolean OR last_scanned_at IS NULL
              OR last_scanned_at < NOW() - make_interval(mins => COALESCE(poll_interval_mins, 30)))
       ORDER BY id ASC`, [force]
    );
    console.log(`[Scout] Ditemukan ${sources.length} sumber aktif.`);

    const fetchedBySource = await mapLimit(sources, 4, async (src) => {
      try {
        if (src.type === 'x_account') return { src, items: await fetchXAccount(src.url_or_query, { isolateErrors: true }), error: null };
        if (src.type === 'x_query') return { src, items: await fetchXQuery(src.url_or_query, { isolateErrors: true }), error: null };
        if (src.type !== 'rss') throw new Error(`Tipe sumber ${src.type} belum didukung; gunakan rss, x_account, atau x_query.`);
        const response = await fetch(src.url_or_query, {
          headers: {
            'User-Agent': 'GapuraMediaScout/3.0 (+https://gapura.avenia.my.id)',
            Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml',
          },
          signal: AbortSignal.timeout(12000),
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const xml = await response.text();
        if (XMLValidator.validate(xml) !== true) throw new Error('XML feed tidak valid.');
        const parsed = xmlParser.parse(xml);
        if (!parsed || (!Object.hasOwn(parsed, 'rss') && !Object.hasOwn(parsed, 'feed'))) throw new Error('Respons bukan RSS/Atom.');
        return { src, items: parseFeed(xml, { isolateErrors: true }), error: null };
      } catch (error) {
        return { src, items: [], error };
      }
    });

    for (const result of fetchedBySource) {
      const src = result.src;
      console.log(`[Scout] Polling: ${src.name} (${src.url_or_query})`);
      const diagnostic = { source_id: src.id, status: 'success', seen: 0, inserted: 0, duplicates: 0, invalid: 0, errors: 0, providers: [], error: null };
      const reportError = (error, invalid = false) => {
        diagnostic[invalid ? 'invalid' : 'errors']++;
        diagnostic.error = String(error?.message || error).slice(0, 500);
        console.warn(`[Scout] Sumber ${src.name}: ${diagnostic.error}`);
      };
      const updateStatus = () => {
        if (diagnostic.error) diagnostic.status = diagnostic.inserted || diagnostic.duplicates ? 'partial' : 'error';
      };
      try {
        if (result.error) throw result.error;
        for (const rawItem of result.items.slice(0, maxItems)) {
          totalFetched++;
          diagnostic.seen++;
          if (rawItem?.error) { reportError(rawItem.error, true); continue; }
          let item;
          let material;
          let url;
          try {
            item = src.type === 'rss' ? normalizeFeedItem(rawItem) : rawItem;
            if (item?.type && !diagnostic.providers.includes(item.type)) diagnostic.providers.push(item.type);
            url = normalizeArticleUrl(item?.url);
            if (!url || !cleanText(item?.title)) { reportError(new Error('Feed item URL/title tidak valid; artikel harus HTTPS.'), true); continue; }
            material = createMaterial({ ...item, url, source: cleanText(item.source || src.name) });
          } catch (error) {
            reportError(error, true);
            continue;
          }
          try {
            const title = material.headline;
            const hash = hashUrl(url);
            const existing = await client.query('SELECT id FROM raw_items WHERE url_hash = $1', [hash]);
            const similar = existing.rows.length ? existing : await client.query(
              `SELECT id FROM raw_items WHERE fetched_at > NOW() - INTERVAL '7 days'
                 AND similarity(title, $1) > $2 LIMIT 1`, [title, dedupThreshold]
            );
            if (similar.rows.length) { totalDuplicates++; diagnostic.duplicates++; continue; }
            const content = material.body;
            const summary = cleanText(item.summary || item.description || item.content).slice(0, 1000);
            const publisherUrl = normalizeArticleUrl(item.publisher_url);
            await client.query('BEGIN');
            try {
              const raw = await client.query(
                `INSERT INTO raw_items (source_id, url, url_hash, title, content_raw, published_at, image_url, publisher_url, source_material)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (url_hash) DO NOTHING RETURNING id`,
                [src.id, url, hash, material.raw_title, content, safeDate(item.published_at), item.image_url || null, publisherUrl, JSON.stringify(material)]
              );
              if (raw.rows.length) {
                const { rows: topicRows } = await client.query(
                  `INSERT INTO topics (raw_item_id, title, summary, url, primary_source, status, source_kind, image_url, publisher_url,
                     raw_title, normalized_title, source_published_at, source_updated_at, material_status)
                   VALUES ($1,$2,$3,$4,$5,'new',$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
                  [raw.rows[0].id, title, summary, url, material.publisher.slice(0, 100), item.type === 'x_api' ? 'x' : item.type || 'rss', item.image_url || null, publisherUrl,
                    material.raw_title, material.headline, material.published_at, material.updated_at, material.extraction.status]
                );
                await persistTopicMaterial(client, topicRows[0].id, material);
              }
              await client.query('COMMIT');
              if (raw.rows.length) { totalNew++; diagnostic.inserted++; }
              else { totalDuplicates++; diagnostic.duplicates++; }
            } catch (err) {
              await client.query('ROLLBACK');
              throw err;
            }
          } catch (error) {
            reportError(error);
          }
        }
      } catch (err) {
        reportError(err);
      }
      updateStatus();
      sourceResults.push(diagnostic);
      try {
        await client.query(
          `UPDATE sources SET last_scanned_at = NOW(), last_error = $2,
             last_success_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE last_success_at END,
             last_scan_diagnostics = $3::jsonb, updated_at = NOW() WHERE id = $1`,
          [src.id, diagnostic.error, JSON.stringify(diagnostic)]
        );
      } catch (error) {
        reportError(error);
        updateStatus();
      }
    }

    // Catat Telemetri Agen Scout
    const durationMs = Date.now() - startTime;
    await client.query(
      `INSERT INTO agent_runs (agent, started_at, completed_at, status, model, tokens_input, tokens_output, est_cost_idr)
       VALUES ('scout', NOW(), NOW(), $1, 'rss-poller-deterministic', 0, 0, 0.00)`,
      [sourceResults.some((source) => source.status !== 'success') ? 'error' : 'success']
    );

    console.log(`\n[Scout] Selesai: ${totalFetched} item dipindai, ${totalDuplicates} duplikat diabaikan, ${totalNew} topik baru berhasil dimasukkan ke pipeline.`);
    return { totalFetched, totalDuplicates, totalNew, durationMs, sourceResults };
  } finally {
    if (!suppliedClient) client.release();
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
