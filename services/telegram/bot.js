// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Telegram Approval Bot
// File: /root/gapura/services/telegram/bot.js
// One-Door Review & Approval State Machine
// ==============================================================================

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Helper pengiriman pesan teks
async function sendMessage(chatId, text, replyMarkup = null) {
  if (!BOT_TOKEN) return false;
  try {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await resp.json();
  } catch (err) {
    console.error('[Telegram] Error sendMessage:', err.message);
    return false;
  }
}

// Helper pengiriman album foto (Media Group)
async function sendMediaGroup(chatId, imagePaths) {
  if (!BOT_TOKEN) return false;
  try {
    const formData = new FormData();
    formData.append('chat_id', chatId);

    const mediaList = [];
    imagePaths.forEach((imgPath, idx) => {
      const attachName = `photo_${idx}`;
      mediaList.push({
        type: 'photo',
        media: `attach://${attachName}`,
      });
      const fileBuffer = fs.readFileSync(imgPath);
      formData.append(attachName, new Blob([fileBuffer]), path.basename(imgPath));
    });

    formData.append('media', JSON.stringify(mediaList));

    const resp = await fetch(`${TELEGRAM_API}/sendMediaGroup`, {
      method: 'POST',
      body: formData,
    });
    return await resp.json();
  } catch (err) {
    console.error('[Telegram] Error sendMediaGroup:', err.message);
    return false;
  }
}

// 1. Dispatch Draf ke Telegram Admin
export async function dispatchDraftToTelegram(draftId) {
  const client = await pool.connect();
  try {
    const { rows: drafts } = await client.query(
      `SELECT d.*, t.title, t.primary_source, ts.score_total, ts.reasoning
       FROM drafts d
       JOIN topics t ON d.topic_id = t.id
       LEFT JOIN topic_scores ts ON t.id = ts.topic_id
       WHERE d.id = $1`,
      [draftId]
    );

    if (drafts.length === 0) {
      console.warn(`[Telegram] Draf #${draftId} tidak ditemukan.`);
      return false;
    }

    const d = drafts[0];
    const { rows: slides } = await client.query(
      'SELECT render_path, slide_no FROM draft_slides WHERE draft_id = $1 ORDER BY slide_no ASC',
      [draftId]
    );

    const imagePaths = slides.map((s) => s.render_path).filter((p) => fs.existsSync(p));

    console.log(`[Telegram] Menyiapkan dispatch draf #${draftId} (${imagePaths.length} gambar slide)...`);

    if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
      console.log(`[Telegram SIMULASI] Token atau ADMIN_CHAT_ID belum diisi di .env.`);
      console.log(`--- DETAIL DRAF #${d.id} ---`);
      console.log(`📌 Judul: ${d.title}`);
      console.log(`📊 Skor Analis: ${d.score_total}/100`);
      console.log(`🏛️ Sumber: ${d.primary_source}`);
      console.log(`📝 Caption:\n${d.caption.slice(0, 200)}...`);
      console.log(`🖼️ File Slide:`);
      imagePaths.forEach((p, idx) => console.log(`   Slide ${idx + 1}: ${p}`));
      console.log(`-----------------------------`);
      return true;
    }

    // Kirim Media Group (5 Slide)
    if (imagePaths.length > 0) {
      await sendMediaGroup(ADMIN_CHAT_ID, imagePaths);
    }

    // Kirim Pesan Deskripsi + Inline Keyboard
    const messageText = `
📌 <b>DRAF CAROUSEL BARU #${d.id}</b>
───────────────────
<b>Judul:</b> ${d.title}
<b>Sumber:</b> ${d.primary_source}
<b>Skor Analis:</b> ${d.score_total}/100
<b>Alasan:</b> <i>${d.reasoning || '-'}</i>

📝 <b>CAPTION:</b>
${d.caption}

🏷️ <b>HASHTAGS:</b>
${(d.hashtags || []).join(' ')}
    `.trim();

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Setujui (Auto)', callback_data: `approve_auto:${d.id}` },
          { text: '📲 Setujui (Manual)', callback_data: `approve_manual:${d.id}` },
        ],
        [
          { text: '❌ Tolak Draf', callback_data: `reject:${d.id}` },
        ],
      ],
    };

    await sendMessage(ADMIN_CHAT_ID, messageText, inlineKeyboard);
    console.log(`[Telegram] Draf #${draftId} berhasil dikirim ke Telegram admin!`);
    return true;
  } finally {
    client.release();
  }
}

// 2. Eksekusi Transisi Status (Approval State Machine)
export async function handleApprovalAction(action, draftId, actor = 'admin') {
  const client = await pool.connect();
  try {
    if (action === 'approve_auto') {
      // Setujui draf dan masukkan ke antrean jadwal optimal
      await client.query("UPDATE drafts SET status = 'approved', updated_at = NOW() WHERE id = $1", [draftId]);

      // Tentukan jadwal tayang berikutnya (misal +3 jam dari sekarang)
      const scheduledAt = new Date(Date.now() + 3 * 3600 * 1000);
      await client.query(
        `INSERT INTO scheduled_posts (draft_id, mode, scheduled_at, status)
         VALUES ($1, 'auto', $2, 'pending')`,
        [draftId, scheduledAt]
      );

      await client.query("UPDATE drafts SET status = 'scheduled', updated_at = NOW() WHERE id = $1", [draftId]);

      await client.query(
        `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
         VALUES ('draft', $1, 'approved_auto', $2, $3)`,
        [draftId, actor, JSON.stringify({ scheduled_at: scheduledAt })]
      );

      console.log(`[State Machine] Draf #${draftId} DISETUJUI & DIJADWALKAN untuk ${scheduledAt.toISOString()}`);
      return { status: 'scheduled', scheduled_at: scheduledAt };
    } else if (action === 'approve_manual') {
      await client.query("UPDATE drafts SET status = 'approved', updated_at = NOW() WHERE id = $1", [draftId]);

      await client.query(
        `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
         VALUES ('draft', $1, 'approved_manual', $2, '{}')`,
        [draftId, actor]
      );

      console.log(`[State Machine] Draf #${draftId} DISETUJUI untuk penerbitan manual.`);
      return { status: 'approved' };
    } else if (action === 'reject') {
      await client.query("UPDATE drafts SET status = 'rejected', updated_at = NOW() WHERE id = $1", [draftId]);

      await client.query(
        `INSERT INTO audit_log (entity, entity_id, action, actor, payload)
         VALUES ('draft', $1, 'rejected', $2, '{}')`,
        [draftId, actor]
      );

      console.log(`[State Machine] Draf #${draftId} DITOLAK oleh ${actor}.`);
      return { status: 'rejected' };
    }
  } finally {
    client.release();
  }
}

// 3. Dispatch Semua Draf Menunggu
export async function dispatchPendingDrafts() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT id FROM drafts WHERE status = 'draft' ORDER BY id ASC");
    console.log(`[Telegram Dispatcher] Ditemukan ${rows.length} draf siap review.`);
    for (const r of rows) {
      await dispatchDraftToTelegram(r.id);
    }
  } finally {
    client.release();
  }
}

// 4. Polling Callback dari Telegram
export async function startBotPolling() {
  if (!BOT_TOKEN) {
    console.log('[Telegram Bot] BOT_TOKEN tidak diset. Polling dinonaktifkan.');
    return;
  }

  console.log('[Telegram Bot] Memulai polling update dari Telegram...');
  let offset = 0;

  setInterval(async () => {
    try {
      const resp = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=10`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data.result || data.result.length === 0) return;

      for (const update of data.result) {
        offset = update.update_id + 1;

        // Callback Query dari Tombol Inline
        if (update.callback_query) {
          const cb = update.callback_query;
          const fromId = String(cb.from.id);

          // Cek Whitelist
          if (ADMIN_CHAT_ID && fromId !== ADMIN_CHAT_ID) {
            console.warn(`[Telegram Security] Akses ditolak dari chat_id: ${fromId}`);
            continue;
          }

          const [action, draftIdStr] = (cb.data || '').split(':');
          const draftId = parseInt(draftIdStr);

          if (draftId && (action === 'approve_auto' || action === 'approve_manual' || action === 'reject')) {
            const res = await handleApprovalAction(action, draftId, `telegram:${fromId}`);
            const replyText =
              action === 'approve_auto'
                ? `✅ Draf #${draftId} DISETUJUI & Masuk Antrean Auto-Publish!`
                : action === 'approve_manual'
                ? `📲 Draf #${draftId} DISETUJUI untuk Publikasi Manual!`
                : `❌ Draf #${draftId} DITOLAK.`;

            await sendMessage(fromId, replyText);
          }
        }
      }
    } catch (pollErr) {
      // Abaikan transient network error
    }
  }, 3000);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dispatchPendingDrafts().then(() => {
    startBotPolling();
  });
}
