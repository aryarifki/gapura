const ALLOWED_HOSTS = new Set([
  'pbs.twimg.com', 'images.unsplash.com', 'img.antaranews.com', 'cdn.antaranews.com',
  'foto.kontan.co.id', 's.kontan.co.id', 'assets.cnbcindonesia.com', 'images.cnbcindonesia.com',
  'img.bisnis.com', 'asset.kompas.com', 'images.kompas.com', 'awsimages.detik.net.id',
  'akcdn.detik.net.id', 'static.republika.co.id',
]);
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
