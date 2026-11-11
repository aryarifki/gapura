// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Publishing & Scheduling Service
// File: /root/gapura/services/publisher/publisher.js
// Meta Graph API Auto-Publishing & Manual Fallback Notifier
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

const BASE_URL = process.env.APP_BASE_URL || 'https://gapura.avenia.my.id';
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const IG_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

/**
 * 1. Menerbitkan Carousel via Meta Graph API
 */
async function publishToInstagramGraphApi(draftId, caption, slideCount) {
  if (!IG_ACCOUNT_ID || !IG_ACCESS_TOKEN) {
    throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID atau INSTAGRAM_ACCESS_TOKEN belum diset di .env');
  }

  console.log(`[Publisher] Memulai unggah ${slideCount} slide ke Meta Graph API untuk Draf #${draftId}...`);
  const itemContainerIds = [];

  // Langkah 1: Buat Media Container untuk setiap slide
  for (let i = 1; i <= slideCount; i++) {
    const imageUrl = `${BASE_URL}/storage/drafts/${draftId}/slide_${i}.png`;
    const createItemUrl = `https://graph.facebook.com/v21.0/${IG_ACCOUNT_ID}/media?image_url=${encodeURIComponent(
      imageUrl
    )}&is_carousel_item=true&access_token=${IG_ACCESS_TOKEN}`;

    const res = await fetch(createItemUrl, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`Gagal membuat item container slide ${i}: ${JSON.stringify(data.error || data)}`);
    }

    itemContainerIds.push(data.id);
    console.log(`[Publisher] Slide ${i} container dibuat: ${data.id}`);
  }

  // Langkah 2: Buat Carousel Container
  const createCarouselUrl = `https://graph.facebook.com/v21.0/${IG_ACCOUNT_ID}/media?media_type=CAROUSEL&children=${itemContainerIds.join(
    ','
  )}&caption=${encodeURIComponent(caption)}&access_token=${IG_ACCESS_TOKEN}`;

  const carouselRes = await fetch(createCarouselUrl, { method: 'POST' });
  const carouselData = await carouselRes.json();
  if (!carouselRes.ok || carouselData.error) {
    throw new Error(`Gagal membuat carousel container: ${JSON.stringify(carouselData.error || carouselData)}`);
  }

  const carouselContainerId = carouselData.id;
  console.log(`[Publisher] Carousel container dibuat: ${carouselContainerId}`);

  // Tunggu sejenak agar Meta memproses container
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Langkah 3: Publikasikan Carousel
  const publishUrl = `https://graph.facebook.com/v21.0/${IG_ACCOUNT_ID}/media_publish?creation_id=${carouselContainerId}&access_token=${IG_ACCESS_TOKEN}`;

  const publishRes = await fetch(publishUrl, { method: 'POST' });
  const publishData = await publishRes.json();
  if (!publishRes.ok || publishData.error) {
    throw new Error(`Gagal menerbitkan carousel: ${JSON.stringify(publishData.error || publishData)}`);
  }

  console.log(`[Publisher] Berhasil tayang di Instagram! Post ID: ${publishData.id}`);
  return publishData.id;
}

/**
 * 2. Notifikasi Reminder Telegram untuk Jalur Manual
 */
async function sendManualPublishReminder(draftId, caption, slideCount) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
    console.log(`[Publisher] Telegram credentials belum diset untuk reminder manual Draf #${draftId}`);
    return false;
  }

  try {
    const text = `⏰ <b>JADWAL TAYANG TIBA (Jalur Manual)</b>\n\nDraf <b>#${draftId}</b> siap diposting ke Instagram @gapuramedia!\n\n📸 <b>Aset Slide:</b> ${slideCount} slide (1080x1350 PNG)\n🔗 <b>Buka Draf di Dashboard:</b> ${BASE_URL}\n\n📝 <b>Caption Siap Salin:</b>\n<pre>${caption.slice(
      0,
      1000
    )}...</pre>`;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_ADMIN_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });
    return true;
  } catch (err) {
    console.error('[Publisher] Gagal kirim reminder Telegram:', err.message);
    return false;
  }
}

/**
 * 3. Polling & Eksekusi Antrean Jadwal (Scheduled Posts Runner)
 */
export async function runPublisher() {
  const client = await pool.connect();
  console.log('[Publisher] Memeriksa antrean postingan terjadwal...');

  try {
    // Cari scheduled posts yang pending dan waktunya sudah tiba (scheduled_at <= NOW())
    const { rows: duePosts } = await client.query(
      `SELECT sp.*, d.caption, d.slides, d.topic_id
       FROM scheduled_posts sp
       JOIN drafts d ON sp.draft_id = d.id
       WHERE sp.status = 'pending' AND sp.scheduled_at <= NOW()
       ORDER BY sp.scheduled_at ASC`
    );

    console.log(`[Publisher] Ditemukan ${duePosts.length} postingan yang siap diproses.`);

    for (const post of duePosts) {
      console.log(`\n[Publisher] Memproses postingan ID #${post.id} (Draf #${post.draft_id}, Mode: ${post.mode})...`);

      // Update status ke 'publishing'
      await client.query("UPDATE scheduled_posts SET status = 'publishing' WHERE id = $1", [post.id]);

      const slides = typeof post.slides === 'string' ? JSON.parse(post.slides) : post.slides;
      const slideCount = Array.isArray(slides) ? slides.length : 5;

      if (post.mode === 'auto') {
        if (!IG_ACCOUNT_ID || !IG_ACCESS_TOKEN) {
          console.warn(
            `[Publisher] Kredensial Meta Graph API belum tersedia di .env. Mengalihkan Draf #${post.draft_id} ke antrean manual/reminder.`
          );

          await sendManualPublishReminder(post.draft_id, post.caption, slideCount);
          await client.query(
            "UPDATE scheduled_posts SET status = 'pending', error_message = 'Menunggu kredensial Meta Graph API di .env' WHERE id = $1",
            [post.id]
          );
          continue;
        }

        try {
          const igPostId = await publishToInstagramGraphApi(post.draft_id, post.caption, slideCount);

          // Update status berhasil
          await client.query(
            "UPDATE scheduled_posts SET status = 'success', published_at = NOW(), ig_post_id = $1 WHERE id = $2",
            [igPostId, post.id]
          );
          await client.query("UPDATE drafts SET status = 'published', updated_at = NOW() WHERE id = $1", [
            post.draft_id,
          ]);

          await client.query(
            `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
             VALUES ('draft', $1, 'published_auto', 'publisher_engine', $2)`,
            [post.draft_id, JSON.stringify({ ig_post_id: igPostId })]
          );
        } catch (publishErr) {
          console.error(`[Publisher] Gagal menerbitkan Draf #${post.draft_id}:`, publishErr.message);

          await client.query(
            "UPDATE scheduled_posts SET status = 'failed', error_message = $1 WHERE id = $2",
            [publishErr.message, post.id]
          );
          await client.query("UPDATE drafts SET status = 'failed', updated_at = NOW() WHERE id = $1", [
            post.draft_id,
          ]);

          await client.query(
            `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
             VALUES ('draft', $1, 'publish_failed', 'publisher_engine', $2)`,
            [post.draft_id, JSON.stringify({ error: publishErr.message })]
          );
        }
      } else {
        // Mode Manual
        await sendManualPublishReminder(post.draft_id, post.caption, slideCount);
        await client.query(
          "UPDATE scheduled_posts SET status = 'success', published_at = NOW() WHERE id = $1",
          [post.id]
        );
        await client.query("UPDATE drafts SET status = 'published', updated_at = NOW() WHERE id = $1", [
          post.draft_id,
        ]);
        console.log(`[Publisher] Draf #${post.draft_id} telah dikirim ke reminder Telegram untuk publikasi manual.`);
      }
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPublisher()
    .then(() => {
      console.log('[Publisher] Selesai.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Publisher] Fatal Error:', err);
      process.exit(1);
    });
}
