import path from 'node:path';
import { renderPayload } from '../common/images.js';
import { pinIllustrationSlides, loadIllustration } from '../designer/illustration-store.js';
import { loadManualMedia } from '../designer/manual-media.js';

export class DraftError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

export function validateSlides(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 9) throw new DraftError('Draf harus memiliki 1-9 slide.');
  return input.map((value, index) => {
    if (!value || typeof value !== 'object' || typeof value.teks !== 'string'
        || (!value.teks.trim() && !(String(value.layout).startsWith('editorial-') && value.data?.title))
        || value.teks.length > 3000) throw new DraftError('Teks setiap slide wajib diisi (maksimal 3000 karakter).');
    if (!/^[a-z0-9-]{1,50}$/i.test(value.layout || '')) throw new DraftError('Layout slide tidak valid.');
    const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? { ...value.data } : {};
    delete data.image_data;
    if (JSON.stringify(data).length > 20000) throw new DraftError('Data slide terlalu besar.');
    return { ...value, no: index + 1, data, teks: value.teks.trim() };
  });
}

/** Editing invalidates all queued publication decisions, inside the same row lock. */
export async function editDraft(draftId, change, { pool, renderUrl, renderSecret, storagePath, fetchImpl = fetch, replaceIllustration = false }) {
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
    let slides = validateSlides(next.slides ?? draft.slides);
    const original = draft.editorial_input != null || draft.editorial_mode != null;
    if (original && slides.length < 3) throw new DraftError('Draf editorial R6 harus mempertahankan carousel 3-9 slide.');
    // Body slides can move: only the single-slide edit route restores omitted body
    // metadata. The cover stays pinned during ordinary full/text/structure edits.
    const preserve = replaceIllustration ? [] : next.preserveIllustrations ? draft.slides : [draft.slides[0]];
    try { slides = await pinIllustrationSlides(slides, { client, topic_id: draft.topic_id, preserveSlides: preserve }); }
    catch (error) { throw new DraftError(error.message, 409); }
    const caption = next.caption ?? draft.caption;
    const hashtags = next.hashtags ?? draft.hashtags;
    const metadata = Object.fromEntries(['editorial_input', 'editorial_mode', 'caption_body', 'threads_caption', 'angle', 'scope_note', 'editorial_references', 'article_body', 'article_references', 'article_metadata'].map((field) => [field, draft[field]]));
    // Generation metadata is read-only here. Keep the editor's exact caption as
    // its new body; hashtag boundaries cannot be inferred from arbitrary prose.
    if (original && caption !== draft.caption) {
      metadata.caption_body = caption;
      metadata.editorial_references = { ...draft.editorial_references, caption: [] };
    }
    if (typeof caption !== 'string' || !Array.isArray(hashtags) || hashtags.some((tag) => typeof tag !== 'string')) throw new DraftError('Caption atau hashtag tidak valid.');
    if ((original ? caption : [caption, hashtags.join(' ')].join('\n\n')).length > 2200) throw new DraftError('Caption dan hashtag maksimal 2200 karakter.');
    if (next.render !== false) {
      let response;
      try {
        const assets = new Map();
        const media = new Map();
        for (const slide of slides) {
          const id = slide.data?.asset_id;
          if (!id) continue;
          if (slide.data.image_kind === 'editor_upload') {
            if (!media.has(id)) media.set(id, await loadManualMedia(client, id, { topic_id: draft.topic_id }));
          } else if (!assets.has(id)) assets.set(id, await loadIllustration(client, id, { topic_id: draft.topic_id }));
        }
        response = await fetchImpl(`${renderUrl}/render`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-Secret': renderSecret },
          body: JSON.stringify({ draft_id: Number(draftId), slides: await renderPayload(slides, { storagePath, resolveAsset: (id) => assets.get(id), resolveMedia: (id) => media.get(id) }) }),
          signal: AbortSignal.timeout(30000),
        });
      } catch { throw new DraftError('Renderer tidak dapat dihubungi. Draf sebelumnya dipertahankan.', 502); }
      if (!response.ok) throw new DraftError('Render gagal. Draf sebelumnya dipertahankan.', 502);
      const result = await response.json();
      if (!Array.isArray(result.rendered_slides) || result.rendered_slides.length !== slides.length) throw new DraftError('Hasil renderer tidak lengkap.', 502);
    }
    await client.query("UPDATE scheduled_posts SET status = 'failed', error_message = 'Dibatalkan karena draf diedit; perlu review ulang' WHERE draft_id = $1 AND status = 'pending'", [draftId]);
    await client.query(
      "UPDATE drafts SET slides=$2, content_format=$3, caption=$4, hashtags=$5, caption_body=$6, editorial_references=$7, status='draft', needs_review=TRUE, telegram_dispatched_at=NULL, updated_at=NOW() WHERE id=$1",
      [draftId, JSON.stringify(slides), slides.length === 1 ? 'single' : 'carousel', caption, hashtags, metadata.caption_body ?? null, metadata.editorial_references == null ? null : JSON.stringify(metadata.editorial_references)]
    );
    await client.query('DELETE FROM draft_slides WHERE draft_id=$1', [draftId]);
    for (const slide of slides) await client.query(
      `INSERT INTO draft_slides(draft_id,slide_no,layout,render_path,text_snapshot,data_snapshot)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [draftId, slide.no, slide.layout, path.join(storagePath, 'drafts', String(draftId), `slide_${slide.no}.png`), slide.teks, JSON.stringify(slide.data)]
    );
    await client.query("INSERT INTO audit_log(entity,entity_id,action,actor,payload) VALUES('draft',$1,'edited_review_required','web_admin',$2)", [draftId, JSON.stringify({ slides_count: slides.length })]);
    await client.query('COMMIT');
    return { ...draft, ...next, ...metadata, slides, caption, hashtags, content_format: slides.length === 1 ? 'single' : 'carousel', status: 'draft', needs_review: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
