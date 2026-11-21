const ALLOWED_HOSTS = new Set([
  'pbs.twimg.com', 'images.unsplash.com', 'img.antaranews.com', 'cdn.antaranews.com',
  'foto.kontan.co.id', 's.kontan.co.id', 'assets.cnbcindonesia.com', 'images.cnbcindonesia.com',
  'img.bisnis.com', 'asset.kompas.com', 'images.kompas.com', 'awsimages.detik.net.id',
  'akcdn.detik.net.id', 'static.republika.co.id',
]);
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MEDIA_IMAGE_KINDS = Object.freeze(['ai_generated', 'editor_upload']);
const ASSET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;

/** Cover is slide 1 and must carry an immutable image descriptor. */
export function hasCoverImage(content) {
  let slides = content;
  if (typeof slides === 'string') {
    try { slides = JSON.parse(slides); } catch { return false; }
  }
  if (!Array.isArray(slides) && Array.isArray(slides?.slides)) slides = slides.slides;
  const data = Array.isArray(slides) ? slides[0]?.data : null;
  return Boolean(data && MEDIA_IMAGE_KINDS.includes(data.image_kind)
    && ASSET_ID.test(String(data.asset_id)) && SHA256.test(String(data.asset_sha256)));
}

export function hasEditorialCover(content) {
  if (hasCoverImage(content)) return true;
  let slides = content;
  if (typeof slides === 'string') { try { slides = JSON.parse(slides); } catch { return false; } }
  if (!Array.isArray(slides)) slides = slides?.slides;
  const cover = slides?.[0];
  return Boolean(cover?.layout === 'editorial-cover' && cover.role === 'cover'
    && cover.data?.cover_mode === 'typography' && !cover.data.asset_id && !cover.data.image_data
    && typeof cover.data.title === 'string' && cover.data.title.trim()
    && typeof cover.data.kicker === 'string' && cover.data.kicker.trim());
}

export function isAllowedImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function imageUrlToDataUri(value, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!isAllowedImageUrl(value)) return null;
  try {
    const source = new URL(value);
    const response = await fetchImpl(value, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!response.ok) return null;
    const finalUrl = new URL(response.url || value);
    if (finalUrl.origin !== source.origin || !isAllowedImageUrl(finalUrl.toString())) return null;
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) return null;
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function prepareSlideImages(slides, options = {}) {
  return Promise.all((slides || []).map(async (slide) => {
    const descriptor = slide?.data || {};
    if (descriptor.image_kind === 'editor_upload') {
      const { ASSET_ID: MANUAL_ID, readManualMedia } = await import('../designer/manual-media.js');
      if (typeof descriptor.asset_id !== 'string' || !MANUAL_ID.test(descriptor.asset_id)) throw new Error('media_id_invalid');
      if (typeof options.resolveMedia !== 'function') throw new Error('media_resolver_missing');
      const asset = await options.resolveMedia(descriptor.asset_id);
      if (!asset) throw new Error('media_not_found');
      if (descriptor.asset_sha256 && descriptor.asset_sha256 !== asset.sha256) throw new Error('media_revision_mismatch');
      const bytes = await readManualMedia(asset, options);
      const { image_url, image_data, image_disclosure, ...data } = descriptor;
      return { ...slide, data: { ...data, asset_id: asset.id, asset_sha256: asset.sha256, image_kind: 'editor_upload', credit: asset.credit, rights_basis: asset.rights_basis, image_data: `data:${asset.mime};base64,${bytes.toString('base64')}` } };
    }
    if (descriptor.asset_id || descriptor.image_kind === 'ai_generated') {
      const { ASSET_ID, readIllustrationRaster } = await import('../designer/illustrations.js');
      if (typeof descriptor.asset_id !== 'string' || !ASSET_ID.test(descriptor.asset_id)) throw new Error('illustration_id_invalid');
      if (typeof options.resolveAsset !== 'function') throw new Error('illustration_resolver_missing');
      const asset = await options.resolveAsset(descriptor.asset_id);
      if (descriptor.asset_sha256 && descriptor.asset_sha256 !== asset.sha256) throw new Error('illustration_revision_mismatch');
      const bytes = await readIllustrationRaster(asset, options);
      const { image_url, image_data, image_disclosure, ...data } = descriptor;
      return { ...slide, data: { ...data, asset_id: asset.id, asset_sha256: asset.sha256, image_kind: 'ai_generated', disclosure_version: 1, image_data: `data:${asset.mime};base64,${bytes.toString('base64')}` } };
    }
    const imageUrl = slide?.data?.image_url;
    if (!imageUrl) return slide;
    const imageData = await imageUrlToDataUri(imageUrl, options);
    if (!imageData) return slide;
    return { ...slide, data: { ...slide.data, image_data: imageData } };
  }));
}

export async function renderPayload(slides, options) {
  const prepared = await prepareSlideImages(slides, options);
  return prepared.map((slide) => {
    if (!slide?.data) return slide;
    const { image_url, ...data } = slide.data;
    return { ...slide, data };
  });
}

/** Server-selected descriptor wins over every model's image field, including fallback. */
export function applyCoverIllustration(content, descriptor) {
  if (!descriptor) return content;
  if (!Array.isArray(content?.slides) || !content.slides.length) throw new Error('illustration_cover_missing');
  const { image_url, image_data, image_disclosure, ...data } = content.slides[0].data || {};
  return { ...content, slides: content.slides.map((slide, index) => index ? slide : { ...slide, data: { ...data, ...descriptor } }) };
}
