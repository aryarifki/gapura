const COMPLEXITY = /regulasi|peraturan|pasal|putusan|sanksi|dampak|analisis|mekanisme|kronologi|perbandingan|triliun|triwulan|kuartal|dibanding|sementara itu/i;

export function chooseFormat({ title = '', summary = '', trendScore = 0 } = {}) {
  const text = `${title} ${summary}`.trim();
  const sentences = (String(summary).match(/[.!?](?:\s|$)/g) || []).length;
  const compact = text.length <= 230 && sentences <= 2 && !COMPLEXITY.test(text);
  return compact && Number(trendScore) < 80 ? 'single' : 'carousel';
}

export function normalizeDesign(raw, topic, fallbackSlides = []) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const sourceSlides = Array.isArray(input.slides) && input.slides.length ? input.slides : fallbackSlides;
  const format = input.format === 'single' || input.format === 'carousel'
    ? input.format
    : chooseFormat(topic || {});
  const slides = sourceSlides.map((slide, index) => ({
    ...slide,
    no: index + 1,
    data: {
      ...(slide?.data || {}),
      ...(slide?.data?.image_url && slide.data.image_url !== topic?.image_url ? { image_url: undefined } : {}),
    },
    source: slide?.source || topic?.primary_source || '@gapuramedia',
  }));

  if (format === 'single') {
    const cover = slides[0] || { teks: topic?.title || '', data: {} };
    cover.layout = 'cover-focus';
    cover.data.title ||= topic?.title || cover.teks || '';
    return { ...input, format, slides: [cover] };
  }

  if (slides.length < 3 && fallbackSlides.length >= 3) return { ...input, format, slides: fallbackSlides };
  return { ...input, format, slides };
}

export function validateDesignOutput(raw, topic, fallbackSlides = []) {
  const normalized = normalizeDesign(raw, topic, fallbackSlides);
  if (!normalized.slides.length || normalized.slides.length > 9) throw new Error('Jumlah slide harus 1-9.');
  if (normalized.format === 'single' && normalized.slides.length !== 1) throw new Error('Format single wajib berisi tepat satu slide.');
  if (normalized.format === 'carousel' && normalized.slides.length < 3) throw new Error('Format carousel minimal berisi tiga slide.');
  return normalized;
}
