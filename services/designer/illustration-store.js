import { randomUUID } from 'node:crypto';
import { generateIllustration, buildIllustrationPrompt, saveIllustrationRaster, readIllustrationRaster, ASSET_ID } from './illustrations.js';
import { MEDIA_KIND, loadManualMedia, manualMediaDescriptor } from './manual-media.js';

function topicId(value) {
  if (!/^[1-9]\d*$/u.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('topic_id_invalid');
  return Number(value);
}

export async function loadIllustration(client, id, { topic_id } = {}) {
  if (typeof id !== 'string' || !ASSET_ID.test(id)) throw new Error('illustration_id_invalid');
  const { rows: [asset] } = await client.query('SELECT * FROM media_assets WHERE id=$1', [id]);
  if (!asset || (topic_id !== undefined && String(topic_id) !== String(asset.topic_id))) throw new Error('illustration_not_found');
  return asset;
}

export async function selectedIllustration(client, id) {
  const { rows: [asset] } = await client.query("SELECT * FROM media_assets WHERE topic_id=$1 AND selected AND status='ready'", [id]);
  return asset || null;
}

export function illustrationDescriptor(asset) {
  if (asset?.status !== 'ready' || asset.kind !== 'ai_generated') throw new Error('illustration_not_ready');
  return { asset_id: asset.id, asset_sha256: asset.sha256, image_kind: 'ai_generated', disclosure_version: 1 };
}

export async function pinIllustrationSlides(slides, { client, topic_id, preserveSlides = [] } = {}) {
  const output = structuredClone(slides);
  for (const [index, slide] of output.entries()) {
    const prior = preserveSlides[index]?.data;
    const requested = slide?.data?.asset_id;
    if (prior?.asset_id && requested && requested !== prior.asset_id) throw new Error('illustration_replace_required');
    const id = requested || prior?.asset_id;
    // Manual uploads keep their own table and provenance; legacy/AI descriptors
    // without a kind stay on the immutable media_assets path.
    const kind = slide?.data?.image_kind || prior?.image_kind || 'ai_generated';
    if (!id) {
      if (slide?.data?.image_kind) throw new Error('illustration_id_invalid');
      continue;
    }
    if (kind === MEDIA_KIND) {
      const asset = await loadManualMedia(client, id, { topic_id });
      if (slide.data?.asset_sha256 && slide.data.asset_sha256 !== asset.sha256) throw new Error('media_revision_mismatch');
      const { image_url, image_data, image_disclosure, ...data } = slide.data || {};
      slide.data = { ...data, ...manualMediaDescriptor(asset) };
      continue;
    }
    const asset = await loadIllustration(client, id, { topic_id });
    if (slide.data?.asset_sha256 && slide.data.asset_sha256 !== asset.sha256) throw new Error('illustration_revision_mismatch');
    const { image_url, image_data, image_disclosure, ...data } = slide.data || {};
    slide.data = { ...data, ...illustrationDescriptor(asset) };
  }
  return output;
}

/** A session lock covers the billable request; rows survive failure/process restarts. */
export function createIllustrationService({ pool, storagePath, generate = generateIllustration, generationOptions = {} } = {}) {
  async function list(id) {
    const numeric = topicId(id);
    const { rows } = await pool.query('SELECT id FROM topics WHERE id=$1', [numeric]);
    if (!rows.length) throw new Error('topic_not_found');
    const { rows: assets } = await pool.query('SELECT * FROM media_assets WHERE topic_id=$1 ORDER BY created_at DESC,id', [numeric]);
    return { assets, selected: assets.find((asset) => asset.selected) || null };
  }

  async function generateForTopic(id, { request_id, regenerate = false } = {}) {
    const numeric = topicId(id);
    if (!ASSET_ID.test(String(request_id)) || typeof regenerate !== 'boolean') throw new Error('illustration_request_invalid');
    const client = await pool.connect();
    const key = `gapura:illustration:${numeric}`;
    let locked = false;
    try {
      const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key]);
      locked = lock.locked;
      if (!locked) throw new Error('illustration_busy');
      // Read a projection, not t.*: full article/summary/photo never reach the generator.
      const { rows: [topic] } = await client.query('SELECT id,title,normalized_title FROM topics WHERE id=$1', [numeric]);
      if (!topic) throw new Error('topic_not_found');
      // If no session holds the lock, an old generating row belongs to an interrupted process.
      await client.query("UPDATE media_assets SET status='failed',error_code='illustration_interrupted' WHERE topic_id=$1 AND status='generating'", [numeric]);
      const { rows: [previous] } = await client.query('SELECT a.* FROM illustration_requests r JOIN media_assets a ON a.id=r.asset_id WHERE r.topic_id=$1 AND r.request_id=$2', [numeric, request_id]);
      if (previous) return { asset: previous, is_existing: true };
      const selected = await selectedIllustration(client, numeric);
      if (selected && !regenerate) {
        await client.query('INSERT INTO illustration_requests(topic_id,request_id,asset_id) VALUES($1,$2,$3)', [numeric, request_id, selected.id]);
        return { asset: selected, is_existing: true };
      }
      const assetId = randomUUID();
      await client.query('BEGIN');
      try {
        await client.query("INSERT INTO media_assets(id,topic_id,request_id,status,prompt) VALUES($1,$2,$3,'generating',$4)", [assetId, numeric, request_id, buildIllustrationPrompt(topic)]);
        await client.query('INSERT INTO illustration_requests(topic_id,request_id,asset_id) VALUES($1,$2,$3)', [numeric, request_id, assetId]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      try {
        const generated = await generate(topic, generationOptions);
        const raster = await saveIllustrationRaster(assetId, generated, { storagePath });
        await client.query('BEGIN');
        try {
          await client.query('UPDATE media_assets SET selected=FALSE WHERE topic_id=$1 AND selected', [numeric]);
          const { rows: [asset] } = await client.query(
            `UPDATE media_assets SET status='ready',selected=TRUE,provider=$2,model=$3,model_version=$4,prompt=$5,
             rights_reference=$6,generation_id=$7,generated_at=NOW(),local_path=$8,mime=$9,byte_size=$10,width=$11,height=$12,sha256=$13
             WHERE id=$1 RETURNING *`,
            [assetId, generated.provider, generated.model, generated.model_version || null, generated.prompt, generated.rights_reference,
              generated.generation_id || null, raster.local_path, raster.mime, raster.byte_size, raster.width, raster.height, raster.sha256]);
          await client.query('COMMIT');
          return { asset, is_existing: false };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      } catch (error) {
        const allowed = /^illustration_(?:not_configured|key_missing|provider_endpoint_invalid|provider_unavailable|provider_http_\d{3}|blocked|no_image|response_invalid|raster_invalid|dimensions_invalid)$/u;
        const code = allowed.test(error.message) ? error.message : 'illustration_generation_failed';
        const { rows: [asset] } = await client.query("UPDATE media_assets SET status='failed',error_code=$2 WHERE id=$1 RETURNING *", [assetId, code]);
        return { asset, is_existing: false };
      }
    } finally {
      try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); }
      finally { client.release(); }
    }
  }

  async function raster(id) {
    const asset = await loadIllustration(pool, id);
    return { asset, bytes: await readIllustrationRaster(asset, { storagePath }) };
  }
  return { list, generate: generateForTopic, raster };
}
