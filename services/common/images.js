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

export async function prepareSlideImages(slides, options) {
  return Promise.all((slides || []).map(async (slide) => {
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
