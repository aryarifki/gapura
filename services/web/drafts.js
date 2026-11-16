import path from 'node:path';
import { renderPayload } from '../common/images.js';

export class DraftError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

export function validateSlides(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 9) throw new DraftError('Draf harus memiliki 1-9 slide.');
  return input.map((value, index) => {
    if (!value || typeof value !== 'object' || typeof value.teks !== 'string' || !value.teks.trim() || value.teks.length > 3000) throw new DraftError('Teks setiap slide wajib diisi (maksimal 3000 karakter).');
    if (!/^[a-z0-9-]{1,50}$/i.test(value.layout || '')) throw new DraftError('Layout slide tidak valid.');
    const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? { ...value.data } : {};
    delete data.image_data;
    if (JSON.stringify(data).length > 20000) throw new DraftError('Data slide terlalu besar.');
    return { ...value, no: index + 1, data, teks: value.teks.trim() };
  });
}

/** Editing invalidates all queued publication decisions, inside the same row lock. */
export async function editDraft(draftId, change, { pool, renderUrl, renderSecret, storagePath, fetchImpl = fetch }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [draft] } = await client.query('SELECT * FROM drafts WHERE id = $1 FOR UPDATE', [draftId]);
    if (!draft) throw new DraftError('Draf tidak ditemukan.', 404);
    if (draft.status === 'published') throw new DraftError('Draf sudah terbit. Buat pembaruan terpisah.', 409);
    const { rows: busy } = await client.query("SELECT 1 FROM scheduled_posts WHERE draft_id = $1 AND status = 'publishing' LIMIT 1", [draftId]);
    if (busy.length) throw new DraftError('Draf sedang dikirim oleh publisher. Coba setelah status dipastikan.', 409);
    const { rows: metaBusy } = await client.query(
      `SELECT 1 FROM publication_targets WHERE draft_id = $1
       AND (status IN ('publishing','unknown','published') OR publish_attempted_at IS NOT NULL OR remote_id IS NOT NULL) LIMIT 1`, [draftId],
    );
    if (metaBusy.length) throw new DraftError('Publikasi Meta sudah dicoba. Rekonsiliasi hasil sebelum mengubah aset draf.', 409);
    const next = await change(structuredClone(draft), client);
    const slides = validateSlides(next.slides ?? draft.slides);
    const caption = next.caption ?? draft.caption;
    const hashtags = next.hashtags ?? draft.hashtags;
    if (typeof caption !== 'string' || !Array.isArray(hashtags) || hashtags.some((tag) => typeof tag !== 'string')) throw new DraftError('Caption atau hashtag tidak valid.');
    if ([caption, hashtags.join(' ')].join('\n\n').length > 2200) throw new DraftError('Caption dan hashtag maksimal 2200 karakter.');
    if (next.render !== false) {
      let response;
      try {
        response = await fetchImpl(`${renderUrl}/render`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-Secret': renderSecret },
          body: JSON.stringify({ draft_id: Number(draftId), slides: await renderPayload(slides) }),
          signal: AbortSignal.timeout(30000),
        });
      } catch { throw new DraftError('Renderer tidak dapat dihubungi. Draf sebelumnya dipertahankan.', 502); }
      if (!response.ok) throw new DraftError('Render gagal. Draf sebelumnya dipertahankan.', 502);
      const result = await response.json();
      if (!Array.isArray(result.rendered_slides) || result.rendered_slides.length !== slides.length) throw new DraftError('Hasil renderer tidak lengkap.', 502);
    }
    await client.query("UPDATE scheduled_posts SET status = 'failed', error_message = 'Dibatalkan karena draf diedit; perlu review ulang' WHERE draft_id = $1 AND status = 'pending'", [draftId]);
    await client.query(
      "UPDATE drafts SET slides=$2, content_format=$3, caption=$4, hashtags=$5, status='draft', needs_review=TRUE, telegram_dispatched_at=NULL, updated_at=NOW() WHERE id=$1",
      [draftId, JSON.stringify(slides), slides.length === 1 ? 'single' : 'carousel', caption, hashtags]
    );
    await client.query('DELETE FROM draft_slides WHERE draft_id=$1', [draftId]);
    for (const slide of slides) await client.query(
      `INSERT INTO draft_slides(draft_id,slide_no,layout,render_path,text_snapshot,data_snapshot)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [draftId, slide.no, slide.layout, path.join(storagePath, 'drafts', String(draftId), `slide_${slide.no}.png`), slide.teks, JSON.stringify(slide.data)]
    );
    await client.query("INSERT INTO audit_log(entity,entity_id,action,actor,payload) VALUES('draft',$1,'edited_review_required','web_admin',$2)", [draftId, JSON.stringify({ slides_count: slides.length })]);
    await client.query('COMMIT');
    return { ...draft, ...next, slides, caption, hashtags, content_format: slides.length === 1 ? 'single' : 'carousel', status: 'draft', needs_review: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
