import { createSignedStorageUrl } from '../common/storage-signature.js';

export function publishFormat(contentFormat, slideCount) {
  if (!['single', 'carousel'].includes(contentFormat)) throw new Error('Format media tidak didukung.');
  if (!Number.isSafeInteger(slideCount) || slideCount < 1 || slideCount > 10) {
    throw new Error('Jumlah slide harus 1 sampai 10.');
  }
  return slideCount === 1 ? 'single' : 'carousel';
}

export function signedPublishImageUrl({ baseUrl, draftId, slideNo, signingSecret, nowSeconds, extension = 'png' }) {
  if (!Number.isSafeInteger(Number(draftId)) || !Number.isSafeInteger(Number(slideNo)) || Number(draftId) < 1 || Number(slideNo) < 1) {
    throw new Error('Draft ID dan nomor slide harus bilangan bulat positif.');
  }
  const format = extension === 'jpg' ? 'jpg' : 'png';
  const signed = new URL(createSignedStorageUrl(
    baseUrl,
    `/storage/drafts/${Number(draftId)}/slide_${Number(slideNo)}.${format}`,
    signingSecret,
    { ttlSeconds: 1800, nowSeconds },
  ));
  signed.pathname = `/media/drafts/${Number(draftId)}/slide_${Number(slideNo)}.${format}`;
  return signed.toString();
}

/** JPEG URLs for the platforms that reject PNG; one signed URL per slide. */
export function signedPublishImageUrls({ baseUrl, draftId, slideCount, signingSecret, nowSeconds, extension = 'jpg' }) {
  if (!Number.isSafeInteger(Number(slideCount)) || Number(slideCount) < 1) throw new Error('Jumlah slide harus bilangan bulat positif.');
  return Array.from({ length: Number(slideCount) }, (_, index) => signedPublishImageUrl({
    baseUrl, draftId, slideNo: index + 1, signingSecret, nowSeconds, extension,
  }));
}
