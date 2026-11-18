// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Deterministic Render Engine
// File: /root/gapura/services/render/engine.js
// Powered by Satori + Sharp (No Chromium, ~30MB RAM footprint)
// ==============================================================================

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import satori from 'satori';
import sharp from 'sharp';
import { validateDraftId, validateSlides, validatePreview, validateLayoutData } from './validation.js';

// ponytail: this queue coordinates one process; multiple workers still need the
// database draft lock held by the web boundary.
const draftRenders = new Map();

const JPEG_OPTIONS = Object.freeze({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true });
const AI_IMAGE_DISCLOSURE = 'Ilustrasi AI · Gapura Media';
const MEDIA_IMAGE_KINDS = new Set(['ai_generated', 'editor_upload']);
const isMediaImage = (data) => Boolean(data?.image_data) && MEDIA_IMAGE_KINDS.has(data?.image_kind);

/**
 * Writes slide_<n>.jpg beside every slide_<n>.png inside one draft directory.
 * Instagram requires JPEG; other adapters reuse the derivative. Existing files are never
 * rewritten, and a corrupt PNG never blocks the rest of the batch.
 */
export async function deriveJpegsInDir(dirPath) {
  let files;
  try {
    files = await fs.promises.readdir(dirPath);
  } catch {
    return 0;
  }
  let created = 0;
  for (const file of files) {
    const match = /^slide_(\d+)\.png$/.exec(file);
    if (!match) continue;
    const jpegName = `slide_${match[1]}.jpg`;
    if (files.includes(jpegName)) continue;
    try {
      const buffer = await fs.promises.readFile(path.join(dirPath, file));
      await sharp(buffer).jpeg(JPEG_OPTIONS).toFile(path.join(dirPath, jpegName));
      created += 1;
    } catch {
      // A corrupt or partially written PNG must not stop the backfill.
    }
  }
  return created;
}

/** Backfills JPEG derivatives for every draft that predates them. */
export async function ensureJpegDerivatives(draftsRoot) {
  let entries;
  try {
    entries = await fs.promises.readdir(draftsRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  let created = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    created += await deriveJpegsInDir(path.join(draftsRoot, entry.name));
  }
  return created;
}

// ------------------------------------------------------------------------------
// Auto-fit typography helpers.
// Satori tidak melakukan auto-shrink: ukuran font harus dihitung manual agar
// tidak ada teks yang terpotong/overflow keluar kanvas 1080x1350.
// ------------------------------------------------------------------------------
const CONTENT_WIDTH = 936; // 1080 - (2 x margin 72)
const CHAR_RATIO = { display: 0.63, body: 0.52 };

function estimateLineCount(text, fontSize, widthPx, ratio = CHAR_RATIO.display) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 1;
  const maxChars = Math.max(1, Math.floor(widthPx / (fontSize * ratio)));
  let lines = 1;
  let cursor = 0;
  for (const word of clean.split(' ')) {
    let len = word.length;
    if (cursor > 0) {
      if (cursor + 1 + len <= maxChars) {
        cursor += 1 + len;
        continue;
      }
      lines += 1;
      cursor = 0;
    }
    while (len > maxChars) {
      lines += 1;
      len -= maxChars;
    }
    cursor = len;
  }
  return lines;
}

function fitFontSize(text, { max = 72, min = 22, width = CONTENT_WIDTH, ratio = CHAR_RATIO.display, maxLines = 4, step = 2 } = {}) {
  for (let size = max; size > min; size -= step) {
    if (estimateLineCount(text, size, width, ratio) <= maxLines) return size;
  }
  return min;
}

// Pemenggalan baris berimbang (dynamic programming) untuk headline cover.
// Tujuan: hindari baris terakhir yang hanya berisi satu kata (widow), yang
// membuat cover terlihat tidak rapi. Mengembalikan null bila tidak feasible.
function balanceLines(text, { fontSize, width = CONTENT_WIDTH, ratio = CHAR_RATIO.display, maxLines = 4 } = {}) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const n = words.length;
  if (n < 2) return null;

  const maxChars = Math.max(1, Math.floor(width / (fontSize * ratio)));
  const total = words.reduce((a, w) => a + w.length, 0) + (n - 1);
  const lines = Math.min(maxLines, Math.ceil(total / maxChars));
  if (lines < 2) return null;

  const prefix = [0];
  words.forEach((w) => prefix.push(prefix[prefix.length - 1] + w.length));
  const lenOf = (i, j) => prefix[j] - prefix[i] + (j - i - 1);
  const avg = total / lines;

  const dp = Array.from({ length: lines + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: lines + 1 }, () => new Array(n + 1).fill(-1));
  dp[0][0] = 0;
  for (let k = 1; k <= lines; k += 1) {
    for (let j = k; j <= n; j += 1) {
      for (let i = k - 1; i < j; i += 1) {
        if (dp[k - 1][i] === Infinity) continue;
        const len = lenOf(i, j);
        if (len > maxChars) continue;
        const slack = len - avg;
        const cost = dp[k - 1][i] + slack * slack;
        if (cost < dp[k][j]) { dp[k][j] = cost; cut[k][j] = i; }
      }
    }
  }
  if (dp[lines][n] === Infinity) return null;

  const out = [];
  let j = n;
  for (let k = lines; k >= 1; k -= 1) {
    const i = cut[k][j];
    out.unshift(words.slice(i, j).join(' '));
    j = i;
  }
  return out.join('\n');
}

export class RenderEngine {
  constructor(designSystemPath) {
    this.designSystemPath = designSystemPath || '/root/gapura/design-system';
    this.tokensPath = path.join(this.designSystemPath, 'tokens.yaml');
    this.fontsPath = path.join(this.designSystemPath, 'fonts');
    this.tokens = null;
    this.fonts = [];
    this.reloadTokens();
    this.loadFonts();
  }

  reloadTokens() {
    try {
      const fileContent = fs.readFileSync(this.tokensPath, 'utf8');
      this.tokens = yaml.load(fileContent);
      console.log(`[RenderEngine] Tokens loaded successfully from ${this.tokensPath}`);
      return true;
    } catch (err) {
      console.error('[RenderEngine] Error loading tokens.yaml:', err);
      throw err;
    }
  }

  loadFonts() {
    try {
      const archivoBlackBuf = fs.readFileSync(path.join(this.fontsPath, 'ArchivoBlack-Regular.ttf'));
      const interRegularBuf = fs.readFileSync(path.join(this.fontsPath, 'Inter-Regular.otf'));
      const interBoldBuf = fs.readFileSync(path.join(this.fontsPath, 'Inter-Bold.otf'));

      this.fonts = [
        {
          name: 'Archivo Black',
          data: archivoBlackBuf,
          weight: 400,
          style: 'normal',
        },
        {
          name: 'Inter',
          data: interRegularBuf,
          weight: 400,
          style: 'normal',
        },
        {
          name: 'Inter',
          data: interBoldBuf,
          weight: 700,
          style: 'normal',
        },
      ];
      console.log('[RenderEngine] Fonts loaded: Archivo Black, Inter (Regular, Bold)');
    } catch (err) {
      console.error('[RenderEngine] Error loading fonts:', err);
      throw err;
    }
  }

  // Base Slide Shell — dua varian:
  //  - "cover" : murni masthead + konten utama (tanpa kategori, counter, sumber, CTA)
  //  - "body"  : header/footer minimalis untuk slide isi
  wrapSlide(contentNode, { slideNo, totalSlides, source, showSource = true, variant = 'body', imageData }) {
    const { brand, palette, grid } = this.tokens;
    const margin = grid.margin || 72;

    const shell = {
      width: '1080px',
      height: '1350px',
      backgroundColor: variant === 'cover' ? (palette.cover_bg || palette.ink || '#12241B') : (palette.bg || '#F8F6F0'),
      fontFamily: 'Inter',
      color: variant === 'cover' ? (palette.cover_ink || '#F3F4E9') : (palette.ink || '#102B45'),
    };

    const wordmark = {
      type: 'div',
      props: {
        style: { display: 'flex', alignItems: 'center', gap: '8px' },
        children: [
          {
            type: 'div',
            props: {
              style: { fontFamily: 'Archivo Black', fontSize: '22px', letterSpacing: '1.5px', color: variant === 'cover' ? (palette.cover_ink || '#F3F4E9') : (palette.ink || '#102B45') },
              children: 'GAPURA',
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontFamily: 'Inter',
                fontWeight: 700,
                fontSize: '17px',
                letterSpacing: '4px',
                color: variant === 'cover' ? (palette.cover_accent || '#A6CE69') : (palette.accent || '#1F7E81'),
                paddingTop: '3px',
              },
              children: 'MEDIA',
            },
          },
        ],
      },
    };

    if (variant === 'cover') {
      return {
        type: 'div',
        props: {
          style: { ...shell, display: 'flex', flexDirection: 'column', padding: `${margin}px` },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  paddingBottom: '26px',
                  borderBottom: `1px solid ${palette.border || '#DED9CC'}`,
                },
                children: [wordmark],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  flex: 1,
                  width: '100%',
                  paddingBottom: '24px',
                },
                children: [contentNode],
              },
            },
          ],
        },
      };
    }

    return {
      type: 'div',
      props: {
        style: {
          ...shell,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: `${margin}px`,
        },
        children: [
          // Header minimalis: wordmark + nomor halaman. Tanpa pill kategori.
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                paddingBottom: '18px',
                borderBottom: `1px solid ${palette.border || '#DED9CC'}`,
              },
              children: [
                wordmark,
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '13px',
                      fontWeight: 700,
                      letterSpacing: '2px',
                      color: palette.muted || '#5A6B7C',
                    },
                    children: totalSlides
                      ? `${String(slideNo).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}`
                      : brand.handle || '@gapuramedia',
                  },
                },
              ],
            },
          },

          // Body Content
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                justifyContent: 'center',
                paddingTop: '40px',
                paddingBottom: '32px',
              },
              children: isMediaImage(imageData)
                ? [this.renderImage(imageData), { type: 'div', props: { style: { height: '28px', flexShrink: 0 } } }, contentNode]
                : [contentNode],
            },
          },

          // Footer minimalis: sumber sebagai teks biasa (tanpa label) + handle.
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                gap: '24px',
                paddingTop: '16px',
                borderTop: `1px solid ${palette.border || '#DED9CC'}`,
                fontSize: '12px',
                color: palette.muted || '#5A6B7C',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flex: 1, maxWidth: '640px', lineHeight: '1.35' },
                    children: showSource && source ? source : '',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontWeight: 700, color: palette.accent || '#1F7E81', letterSpacing: '0.5px' },
                    children: brand.handle || '@gapuramedia',
                  },
                },
              ],
            },
          },
        ],
      },
    };
  }

  // Disclosure is part of the image itself, independent of source visibility or
  // client credit text. Fixed contrast keeps it readable under token overrides.
  renderImage(data) {
    if (!data?.image_data) return null;
    const image = {
      type: 'img',
      props: {
        src: data.image_data,
        width: CONTENT_WIDTH,
        height: 390,
        style: { width: `${CONTENT_WIDTH}px`, height: '390px', objectFit: 'cover', borderRadius: '4px' },
      },
    };
    if (!isMediaImage(data)) return image;
    const manual = data.image_kind === 'editor_upload';
    return {
      type: 'div',
      props: {
        style: { display: 'flex', position: 'relative', width: `${CONTENT_WIDTH}px`, height: '390px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden' },
        children: [
          image,
          {
            type: 'div',
            props: {
              style: manual
                ? { display: 'flex', position: 'absolute', bottom: '14px', left: '14px', padding: '8px 12px', backgroundColor: '#12241b', color: '#ffffff', fontFamily: 'Inter', fontWeight: 600, fontSize: '16px', lineHeight: '1.3', borderRadius: '4px', maxWidth: '620px' }
                : { display: 'flex', position: 'absolute', bottom: '14px', left: '14px', padding: '10px 14px', backgroundColor: '#12241b', color: '#ffffff', fontFamily: 'Inter', fontWeight: 700, fontSize: '20px', lineHeight: '1.2', borderRadius: '4px' },
              children: manual ? `Gambar: ${data.credit}` : AI_IMAGE_DISCLOSURE,
            },
          },
        ],
      },
    };
  }

  renderIllustration(slide, slideIndex, totalSlides) {
    const data = slide.data || {};
    const { palette } = this.tokens;
    const headline = data.title || data.headline || '';
    const body = slide.teks === headline ? '' : slide.teks;
    return this.wrapSlide({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' },
        children: [
          this.renderImage(data),
          headline ? {
            type: 'div',
            props: {
              style: { fontFamily: 'Archivo Black', fontSize: `${fitFontSize(headline, { max: 32, min: 22, maxLines: 3 })}px`, lineHeight: '1.2', color: palette.ink || '#102B45' },
              children: headline,
            },
          } : null,
          body ? {
            type: 'div',
            props: {
              style: { fontSize: `${fitFontSize(body, { max: 26, min: 18, ratio: CHAR_RATIO.body, maxLines: 10, step: 1 })}px`, lineHeight: '1.5', color: palette.ink || '#102B45' },
              children: body,
            },
          } : null,
          ...['cta', 'disclaimer'].filter((field) => data[field]?.trim()).map((field) => ({
            type: 'div',
            props: {
              style: { fontSize: field === 'cta' ? '20px' : '14px', lineHeight: '1.45', color: field === 'cta' ? palette.accent : palette.muted },
              children: data[field],
            },
          })),
        ].filter(Boolean),
      },
    }, { slideNo: slideIndex, totalSlides, source: slide.source });
  }

  // Cover murni: masthead kecil + (opsional) angka utama + headline auto-fit.
  renderCover(slide, slideIndex, totalSlides) {
    const { palette } = this.tokens;
    const data = slide.data || {};
    const headline = String(data.title || data.headline || slide.teks || '')
      .replace(/\s+/g, ' ')
      .trim();
    const body = String(slide.teks || '').replace(/\s+/g, ' ').trim();
    const rawStat = String(data.value ?? data.stat ?? '').trim();
    // Label generik ("DATA UTAMA", "PASAR MODAL") bukan informasi: jangan tampil di cover.
    const statVal = /\d/.test(rawStat) ? rawStat : '';
    const statLabel = String(data.subtext || data.unit || data.label || '')
      .replace(/\s+/g, ' ')
      .trim();
    const hasStat = Boolean(statVal);
    const hasPhoto = Boolean(data.image_data);

    const headlineSize = fitFontSize(headline, {
      max: hasStat ? 64 : hasPhoto ? 74 : 104,
      min: 32,
      width: CONTENT_WIDTH,
      ratio: CHAR_RATIO.display,
      maxLines: hasPhoto ? (hasStat ? 4 : 5) : 6,
      step: 2,
    });
    const balancedHeadline = balanceLines(headline, {
      fontSize: headlineSize,
      width: CONTENT_WIDTH,
      ratio: CHAR_RATIO.display,
      maxLines: hasPhoto ? (hasStat ? 4 : 5) : 6,
    });
    const headlineLines = balancedHeadline ? balancedHeadline.split('\n') : [headline];

    return this.wrapSlide(
      {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'column', gap: hasStat ? '32px' : '28px', width: '100%' },
          children: [
            this.renderImage(data),
            {
              type: 'div',
              props: {
                style: {
                  width: '72px',
                  height: '8px',
                  backgroundColor: palette.cover_accent || '#A6CE69',
                },
              },
            },
            headline
              ? {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      fontFamily: 'Archivo Black',
                      fontSize: `${headlineSize}px`,
                      lineHeight: '1.14',
                      letterSpacing: '-1px',
                      color: palette.cover_ink || '#F3F4E9',
                    },
                      children: headlineLines.map((line, index) => ({
                        type: 'div',
                        props: {
                          style: { display: 'flex' },
                          children: line,
                        },
                      })),
                  },
                }
              : null,
            hasStat
              ? {
                  type: 'div',
                  props: {
                    style: { display: 'flex', alignItems: 'flex-end', gap: '18px', marginTop: '4px' },
                    children: [
                      {
                            type: 'div',
                        props: {
                          style: {
                            fontFamily: 'Archivo Black',
                            fontSize: statVal.length > 12 ? '62px' : '82px',
                            lineHeight: '1',
                            color: palette.cover_accent || '#A6CE69',
                          },
                          children: statVal,
                        },
                      },
                      statLabel
                        ? {
                            type: 'div',
                            props: {
                              style: {
                                fontSize: '19px',
                                fontWeight: 700,
                                letterSpacing: '0.8px',
                                color: palette.cover_ink || '#F3F4E9',
                                paddingBottom: '10px',
                                maxWidth: '380px',
                                lineHeight: '1.3',
                              },
                              children: statLabel,
                            },
                          }
                        : null,
                    ].filter(Boolean),
                  },
                }
              : null,
            body && body !== headline ? {
              type: 'div',
              props: {
                style: { fontSize: `${fitFontSize(body, { max: 30, min: 18, ratio: CHAR_RATIO.body, maxLines: 8, step: 1 })}px`, lineHeight: '1.5', color: palette.cover_ink || '#F3F4E9' },
                children: body,
              },
            } : null,
          ].filter(Boolean),
        },
      },
      { slideNo: slideIndex, totalSlides, source: slide.source, variant: 'cover' }
    );
  }

  // 9 Layout Resolvers
  resolveLayout(slide, slideIndex, totalSlides) {
    const layout = slide.layout || 'cover-stat';
    const { palette } = this.tokens;
    validateLayoutData(layout, slide.data ?? {});

    // Slide pertama — atau layout apa pun yang menyebut "cover" — selalu cover murni.
    if (slideIndex === 1 || /cover/i.test(layout)) {
      return this.renderCover(slide, slideIndex, totalSlides);
    }

    switch (layout) {
      case 'illustration':
        return this.renderIllustration(slide, slideIndex, totalSlides);

      case 'cover-stat': {
        const hasStat = Boolean(slide.data?.value || slide.data?.stat);
        const statVal = hasStat ? String(slide.data?.value || slide.data?.stat) : '';
        const subtext = slide.data?.subtext || slide.data?.unit || '';
        const headline = slide.data?.title || slide.teks;
        const category = slide.data?.category || 'LAPORAN UTAMA';

        const headlineFontSize = headline.length > 80 ? '38px' : headline.length > 50 ? '46px' : '52px';

        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '32px', width: '100%' },
              children: [
                // 1. Eyebrow Tag
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', alignItems: 'center', gap: '10px' },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: palette.highlight || '#D79344',
                          },
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: 'Inter',
                            fontSize: '16px',
                            fontWeight: 700,
                            color: palette.accent || '#1F7E81',
                            letterSpacing: '1.5px',
                            textTransform: 'uppercase',
                          },
                          children: 'LAPORAN KHUSUS · @GAPURAMEDIA',
                        },
                      },
                    ],
                  },
                },
                // 2. Main Headline
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: headlineFontSize,
                      lineHeight: '1.28',
                      color: palette.ink || '#102B45',
                      letterSpacing: '-0.5px',
                    },
                    children: headline,
                  },
                },
                // 3. Focal Element (Stat Card or Summary Box)
                hasStat
                  ? {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          backgroundColor: '#ffffff',
                          border: `1.5px solid ${palette.border || '#DED9CC'}`,
                          borderRadius: '16px',
                          padding: '24px 32px',
                          gap: '24px',
                        },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: {
                                width: '8px',
                                height: '76px',
                                backgroundColor: palette.highlight || '#D79344',
                                borderRadius: '4px',
                              },
                            },
                          },
                          {
                            type: 'div',
                            props: {
                              style: { display: 'flex', flexDirection: 'column', gap: '6px' },
                              children: [
                                {
                                  type: 'div',
                                  props: {
                                    style: {
                                      fontFamily: 'Archivo Black',
                                      fontSize: statVal.length > 10 ? '48px' : '62px',
                                      color: palette.ink || '#102B45',
                                      lineHeight: '1.1',
                                    },
                                    children: statVal,
                                  },
                                },
                                subtext
                                  ? {
                                      type: 'div',
                                      props: {
                                        style: {
                                          fontSize: '18px',
                                          fontFamily: 'Inter',
                                          fontWeight: 700,
                                          color: palette.accent || '#1F7E81',
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.8px',
                                        },
                                        children: subtext,
                                      },
                                    }
                                  : null,
                              ].filter(Boolean),
                            },
                          },
                        ],
                      },
                    }
                  : {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          backgroundColor: '#ffffff',
                          border: `1.5px solid ${palette.border || '#DED9CC'}`,
                          borderRadius: '16px',
                          padding: '24px 32px',
                          gap: '24px',
                        },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: {
                                width: '8px',
                                height: '76px',
                                backgroundColor: palette.accent || '#1F7E81',
                                borderRadius: '4px',
                              },
                            },
                          },
                          {
                            type: 'div',
                            props: {
                              style: {
                                fontSize: '22px',
                                fontFamily: 'Inter',
                                fontWeight: 500,
                                lineHeight: '1.5',
                                color: palette.ink || '#102B45',
                              },
                              children: subtext,
                            },
                          },
                        ],
                      },
                    },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: category }
        );
      }

      case 'big-statement': {
        const statementSize = fitFontSize(slide.teks, {
          max: 32,
          min: 20,
          width: CONTENT_WIDTH - 80,
          ratio: CHAR_RATIO.body,
          maxLines: 7,
          step: 1,
        });
        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
                backgroundColor: '#ffffff',
                border: `1.5px solid ${palette.border || '#DED9CC'}`,
                borderRadius: '16px',
                padding: '36px 40px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    },
                    children: [
                      slide.data?.quote ? {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: 'Archivo Black',
                            fontSize: '48px',
                            color: palette.accent || '#1F7E81',
                            lineHeight: '1',
                          },
                          children: '“',
                        },
                      } : null,
                      {
                        type: 'div',
                        props: {
                          style: {
                            backgroundColor: palette.accent || '#1F7E81',
                            color: '#ffffff',
                            fontSize: '13px',
                            fontFamily: 'Inter',
                            fontWeight: 700,
                            padding: '4px 12px',
                            borderRadius: '12px',
                            letterSpacing: '0.8px',
                            textTransform: 'uppercase',
                          },
                          children: slide.data?.quote ? 'KUTIPAN SUMBER' : (slide.data?.title || 'KONTEKS'),
                        },
                      },
                    ].filter(Boolean),
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Inter',
                      fontSize: `${statementSize}px`,
                      lineHeight: '1.45',
                      fontWeight: 700,
                      color: palette.ink || '#102B45',
                    },
                    children: slide.data?.quote ? `“${slide.data.quote}”` : slide.teks,
                  },
                },
                slide.data?.quote && slide.data?.author
                  ? {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '20px',
                          color: palette.accent || '#1F7E81',
                          fontWeight: 700,
                          letterSpacing: '0.5px',
                        },
                        children: `— ${slide.data.author}`,
                      },
                    }
                  : null,
                slide.data?.quote && slide.teks && slide.teks !== slide.data.quote ? {
                  type: 'div',
                  props: {
                    style: { fontSize: `${fitFontSize(slide.teks, { max: 30, min: 18, width: CONTENT_WIDTH - 80, ratio: CHAR_RATIO.body, maxLines: 8, step: 1 })}px`, lineHeight: '1.5', color: palette.ink || '#102B45' },
                    children: slide.teks,
                  },
                } : null,
              ].filter(Boolean),
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: slide.data?.category }
        );
      }

      case 'stat-grid': {
        const gridTitleSize = fitFontSize(slide.teks, {
          max: 32,
          min: 20,
          width: CONTENT_WIDTH,
          ratio: CHAR_RATIO.display,
          maxLines: 4,
        });
        const items = slide.data.items;
        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: `${gridTitleSize}px`,
                      lineHeight: '1.3',
                      color: palette.ink || '#102B45',
                    },
                    children: slide.teks,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '20px',
                      width: '100%',
                    },
                    children: items.slice(0, 4).map((item) => ({
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          backgroundColor: '#ffffff',
                          border: `1.5px solid ${palette.border || '#DED9CC'}`,
                          borderRadius: '14px',
                          padding: '24px 28px',
                          width: items.length === 1 ? '100%' : '440px',
                          gap: '8px',
                        },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: {
                                fontFamily: 'Archivo Black',
                                fontSize: '48px',
                                color: palette.accent || '#1F7E81',
                                lineHeight: '1.1',
                              },
                              children: item.value,
                            },
                          },
                          {
                            type: 'div',
                            props: {
                              style: {
                                fontSize: '18px',
                                color: palette.muted || '#5A6B7C',
                                fontWeight: 600,
                                lineHeight: '1.4',
                              },
                              children: item.label,
                            },
                          },
                        ],
                      },
                    })),
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: slide.data?.category }
        );
      }

      case 'chart-bar': {
        const barTitleSize = fitFontSize(slide.teks, { max: 32, min: 20, maxLines: 3 });
        const { labels, values } = slide.data;
        const maxVal = Math.max(...values, 1);

        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: `${barTitleSize}px`,
                      color: palette.ink,
                    },
                    children: slide.teks,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' },
                    children: labels.map((lbl, i) => {
                      const val = values[i];
                      const pct = Math.round((val / maxVal) * 100);
                      return {
                        type: 'div',
                        props: {
                          style: { display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: { display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 700 },
                                children: [
                                  { type: 'span', props: { children: lbl } },
                                  { type: 'span', props: { style: { color: palette.accent }, children: String(val) } },
                                ],
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                style: {
                                  display: 'flex',
                                  width: '100%',
                                  height: '24px',
                                  backgroundColor: '#e6e2d8',
                                  borderRadius: '4px',
                                  overflow: 'hidden',
                                },
                                children: [
                                  {
                                    type: 'div',
                                    props: {
                                      style: {
                                        width: `${pct}%`,
                                        height: '100%',
                                        backgroundColor: palette.accent,
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      };
                    }),
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: slide.data?.category }
        );
      }

      case 'chart-line': {
        const lineTitleSize = fitFontSize(slide.teks, { max: 32, min: 20, maxLines: 3 });
        const { labels, values } = slide.data;
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = maxVal - minVal || 1;

        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: `${lineTitleSize}px`,
                      color: palette.ink,
                    },
                    children: slide.teks,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-end',
                      height: '340px',
                      padding: '24px',
                      backgroundColor: palette.card_bg,
                      border: `1px solid ${palette.border}`,
                      borderRadius: '8px',
                    },
                    children: labels.map((lbl, idx) => {
                      const val = values[idx];
                      const barH = Math.max(20, Math.round(((val - minVal) / range) * 240));
                      const isUp = idx > 0 ? val >= values[idx - 1] : true;
                      return {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '12px',
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  fontSize: '16px',
                                  fontWeight: 700,
                                  color: isUp ? palette.up : palette.down,
                                },
                                children: String(val),
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                style: {
                                  width: '36px',
                                  height: `${barH}px`,
                                  backgroundColor: isUp ? palette.up : palette.down,
                                  borderRadius: '4px',
                                },
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                style: { fontSize: '14px', color: palette.muted },
                                children: lbl,
                              },
                            },
                          ],
                        },
                      };
                    }),
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: slide.data?.category }
        );
      }

      case 'regulasi': {
        const title = slide.data?.title || 'REGULASI / PASAL HUKUM';
        const clauseSize = fitFontSize(slide.teks, {
          max: 27,
          min: 17,
          width: CONTENT_WIDTH - 76,
          ratio: CHAR_RATIO.body,
          maxLines: 10,
          step: 1,
        });
        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '24px' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '18px',
                      fontWeight: 700,
                      color: palette.accent,
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                    },
                    children: title,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      backgroundColor: palette.card_bg,
                      border: `2px solid ${palette.border}`,
                      borderRadius: '8px',
                      padding: '36px',
                      gap: '16px',
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: `${clauseSize}px`,
                            lineHeight: '1.6',
                            fontWeight: 500,
                            color: palette.ink,
                          },
                          children: slide.teks,
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: 'HUKUM & REGULASI' }
        );
      }

      case 'timeline': {
        const timelineTitleSize = fitFontSize(slide.teks, { max: 32, min: 20, maxLines: 3 });
        const events = slide.data.events;
        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '28px' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { fontFamily: 'Archivo Black', fontSize: `${timelineTitleSize}px`, color: palette.ink },
                    children: slide.teks,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', gap: '20px' },
                    children: events.slice(0, 5).map((ev) => ({
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '20px',
                          borderLeft: `4px solid ${palette.accent}`,
                          paddingLeft: '20px',
                        },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: { width: '140px', fontWeight: 700, color: palette.accent, fontSize: '18px' },
                              children: ev.date,
                            },
                          },
                          {
                            type: 'div',
                            props: {
                              style: { flex: 1, fontSize: '18px', color: palette.ink, lineHeight: '1.4' },
                              children: ev.text,
                            },
                          },
                        ],
                      },
                    })),
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: slide.data?.category }
        );
      }

      case 'comparison': {
        const compareTitleSize = fitFontSize(slide.teks, { max: 32, min: 20, maxLines: 3 });
        const { left, right } = slide.data;

        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '28px' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { fontFamily: 'Archivo Black', fontSize: `${compareTitleSize}px`, color: palette.ink },
                    children: slide.teks,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', gap: '24px', width: '100%' },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            flex: 1,
                            backgroundColor: palette.card_bg,
                            border: `1px solid ${palette.border}`,
                            borderRadius: '8px',
                            padding: '28px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          },
                          children: [
                            { type: 'div', props: { style: { fontWeight: 700, fontSize: '20px', color: palette.muted }, children: left.title } },
                            { type: 'div', props: { style: { fontSize: `${fitFontSize(left.text, { max: 20, min: 14, width: 372, ratio: CHAR_RATIO.body, maxLines: 11, step: 1 })}px`, lineHeight: '1.5', color: palette.ink }, children: left.text } },
                          ],
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            flex: 1,
                            backgroundColor: palette.card_bg,
                            border: `2px solid ${palette.accent}`,
                            borderRadius: '8px',
                            padding: '28px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          },
                          children: [
                            { type: 'div', props: { style: { fontWeight: 700, fontSize: '20px', color: palette.accent }, children: right.title } },
                            { type: 'div', props: { style: { fontSize: `${fitFontSize(right.text, { max: 20, min: 14, width: 372, ratio: CHAR_RATIO.body, maxLines: 11, step: 1 })}px`, lineHeight: '1.5', color: palette.ink }, children: right.text } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: slide.data?.category }
        );
      }

      case 'cta-close': {
        const headline = slide.teks || slide.data?.title || slide.data?.headline;
        const ctaHeadlineSize = fitFontSize(headline, { max: 34, min: 22, maxLines: 4 });
        const ctaText = slide.data?.cta;
        const disclaimer = slide.data?.disclaimer;

        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '34px',
                width: '100%',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: `${ctaHeadlineSize}px`,
                      color: palette.ink || '#102B45',
                      lineHeight: '1.25',
                    },
                    children: headline,
                  },
                },
                ctaText?.trim() ? {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '24px',
                      color: palette.accent || '#1F7E81',
                      lineHeight: '1.45',
                      fontWeight: 600,
                    },
                    children: ctaText,
                  },
                } : null,
                // Explicit editorial disclaimer, when supplied.
                ...(disclaimer?.trim() ? [{
                  type: 'div',
                  props: {
                    style: {
                      backgroundColor: '#ffffff',
                      border: `1px solid ${palette.border || '#DED9CC'}`,
                      borderRadius: '10px',
                      padding: '16px 20px',
                      fontSize: '14px',
                      lineHeight: '1.45',
                      color: palette.muted || '#5A6B7C',
                    },
                    children: disclaimer,
                  },
                }] : []),
              ].filter(Boolean),
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, imageData: slide.data, category: 'PENUTUP' }
        );
      }

      default:
        return this.renderFluidLayout(slide, slideIndex, totalSlides);
    }
  }

  // Universal Fluid Layout Renderer (Full AI Adaptive Creative Direction)
  renderFluidLayout(slide, slideIndex, totalSlides) {
    if (isMediaImage(slide.data)) return this.renderIllustration(slide, slideIndex, totalSlides);
    const { palette } = this.tokens;
    const data = slide.data || {};
    const text = slide.teks || '';
    const value = data.value ?? data.stat;
    const hasValue = value !== undefined && value !== null && value !== '';
    const title = data.title || data.headline || (hasValue || data.items || data.quote ? text : '');
    const subtitle = data.subtitle || data.subtext || '';
    const category = data.category || '';

    const items = data.items || data.cards || data.metrics || (Array.isArray(data.list) && typeof data.list[0] === 'object' ? data.list : null);
    const bullets = data.bullets || data.points || (Array.isArray(data.list) && typeof data.list[0] === 'string' ? data.list : null);
    const px = (v) => `${v}px`;

    const children = [];

    // 1. Accent Bar & Subtitle Tag
    children.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                width: '44px',
                height: '6px',
                backgroundColor: palette.accent,
                borderRadius: '3px',
              },
            },
          },
          subtitle
            ? {
                type: 'div',
                props: {
                  style: {
                    fontSize: px(20),
                    fontWeight: 700,
                    color: palette.accent,
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                  },
                  children: subtitle,
                },
              }
            : null,
        ].filter(Boolean),
      },
    });

    // 2. Title / Main Statement
    if (title) {
      const fontSize = `${fitFontSize(title, { max: 34, min: 24, maxLines: 4 })}px`;
      children.push({
        type: 'div',
        props: {
          style: {
            fontFamily: 'Archivo Black',
            fontSize,
            lineHeight: '1.2',
            color: palette.ink,
            letterSpacing: '-0.5px',
          },
          children: title,
        },
      });
    }

    // 3. Hero Stat (if present)
    if (hasValue) {
      const val = String(value);
      const unit = data.unit || data.label || '';
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            alignItems: 'center',
            backgroundColor: '#ffffff',
            border: `1.5px solid ${palette.border || '#DED9CC'}`,
            borderRadius: '16px',
            padding: `${px(24)} ${px(32)}`,
            gap: px(24),
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  width: '8px',
                  height: px(76),
                  backgroundColor: palette.highlight || '#D79344',
                  borderRadius: '4px',
                },
              },
            },
            {
              type: 'div',
              props: {
                style: { display: 'flex', flexDirection: 'column', gap: '6px' },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontFamily: 'Archivo Black',
                        fontSize: px(val.length > 12 ? 48 : 62),
                        color: palette.ink || '#102B45',
                        lineHeight: '1.1',
                      },
                      children: val,
                    },
                  },
                  unit
                    ? {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: px(18),
                            fontWeight: 700,
                            color: palette.cover_accent || palette.accent || '#A6CE69',
                            textTransform: 'uppercase',
                            letterSpacing: '0.8px',
                          },
                          children: unit,
                        },
                      }
                    : null,
                ].filter(Boolean),
              },
            },
          ],
        },
      });
    }

    // 4. Metric Items / Cards Grid (if present)
    if (Array.isArray(items) && items.length > 0) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: px(18),
            width: '100%',
          },
          children: items.slice(0, 4).map((it) => ({
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: palette.card_bg,
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                padding: px(22),
                width: items.length === 1 ? '100%' : '440px',
                gap: px(8),
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: px(38),
                      color: palette.accent,
                      lineHeight: '1.1',
                    },
                    children: String(it.value ?? it.stat ?? it.number ?? ''),
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: px(18),
                      color: palette.muted,
                      lineHeight: '1.4',
                      fontWeight: 600,
                    },
                    children: String(it.label || it.title || it.text || ''),
                  },
                },
              ],
            },
          })),
        },
      });
    }

    // 5. Comparison / Split Columns (if present)
    if (data.left && data.right) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            gap: '20px',
            width: '100%',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  flex: 1,
                  backgroundColor: palette.card_bg,
                  border: `1px solid ${palette.border}`,
                  borderTop: `6px solid ${palette.accent}`,
                  borderRadius: '10px',
                  padding: '22px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontFamily: 'Archivo Black',
                        fontSize: '22px',
                        color: palette.ink,
                      },
                      children: data.left.title || '',
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: '18px',
                        lineHeight: '1.5',
                        color: palette.ink_secondary || palette.muted,
                      },
                      children: data.left.text || data.left.content || '',
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  flex: 1,
                  backgroundColor: palette.card_bg,
                  border: `1px solid ${palette.border}`,
                  borderTop: `6px solid ${palette.highlight}`,
                  borderRadius: '10px',
                  padding: '22px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontFamily: 'Archivo Black',
                        fontSize: '22px',
                        color: palette.ink,
                      },
                      children: data.right.title || '',
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: '18px',
                        lineHeight: '1.5',
                        color: palette.ink_secondary || palette.muted,
                      },
                      children: data.right.text || data.right.content || '',
                    },
                  },
                ],
              },
            },
          ],
        },
      });
    }

    // 6. Bullets / Key Points (if present)
    if (Array.isArray(bullets) && bullets.length > 0) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: px(12),
            width: '100%',
          },
          children: bullets.slice(0, 5).map((pt, idx) => ({
            type: 'div',
            props: {
              style: {
                display: 'flex',
                alignItems: 'flex-start',
                backgroundColor: palette.card_bg,
                border: `1px solid ${palette.border}`,
                borderRadius: '8px',
                padding: `${px(16)} ${px(20)}`,
                gap: px(16),
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      backgroundColor: palette.accent,
                      color: '#ffffff',
                      fontFamily: 'Archivo Black',
                      fontSize: px(16),
                      borderRadius: '50%',
                      width: px(32),
                      height: px(32),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    },
                    children: String(idx + 1),
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: px(19),
                      lineHeight: '1.45',
                      color: palette.ink,
                      fontWeight: 500,
                    },
                    children: pt,
                  },
                },
              ],
            },
          })),
        },
      });
    }

    // 7. Quote / Statement Box (if present)
    if (data.quote) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            paddingLeft: '24px',
            borderLeft: `6px solid ${palette.accent}`,
            margin: '8px 0',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  fontSize: px(26),
                  lineHeight: '1.45',
                  fontWeight: 700,
                  color: palette.ink,
                  fontStyle: 'italic',
                },
                children: `“${data.quote}”`,
              },
            },
            data.author
              ? {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: px(19),
                      color: palette.muted,
                      fontWeight: 600,
                    },
                    children: `— ${data.author}`,
                  },
                }
              : null,
          ].filter(Boolean),
        },
      });
    }

    // 8. Callout Box / Regulatory clause (if present)
    if (data.callout || data.regulasi || data.note) {
      const noteText = data.callout || data.regulasi || data.note;
      children.push({
        type: 'div',
        props: {
          style: {
            backgroundColor: '#ffffff',
            border: `2px solid ${palette.border}`,
            borderTop: `6px solid ${palette.highlight}`,
            borderRadius: '10px',
            padding: `${px(22)} ${px(26)}`,
            fontSize: px(19),
            lineHeight: '1.5',
            color: palette.ink,
            fontWeight: 500,
          },
          children: noteText,
        },
      });
    }

    // 9. Narrative Body Text (if text was not already used as title/quote)
    if (text && text !== title && text !== data.quote) {
      children.push({
        type: 'div',
        props: {
          style: {
            fontSize: px(22),
            lineHeight: '1.55',
            color: palette.ink,
            backgroundColor: palette.card_bg,
            border: `1px solid ${palette.border}`,
            borderRadius: '10px',
            padding: `${px(22)} ${px(26)}`,
          },
          children: text,
        },
      });
    }

    // 10. An explicit action is optional on every slide, including the last.
    if (data.cta?.trim()) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.accent || '#1F7E81',
            color: '#ffffff',
            fontSize: '18px',
            fontWeight: 700,
            padding: '14px 24px',
            borderRadius: '8px',
            marginTop: '8px',
            textAlign: 'center',
          },
          children: data.cta,
        },
      });
    }

    if (data.disclaimer?.trim()) {
      children.push({
        type: 'div',
        props: {
          style: {
            backgroundColor: '#ffffff',
            border: `1px solid ${palette.border || '#DED9CC'}`,
            borderRadius: '10px',
            padding: '14px 18px',
            fontSize: '13px',
            lineHeight: '1.45',
            color: palette.muted || '#5A6B7C',
          },
          children: data.disclaimer,
        },
      });
    }

    return this.wrapSlide(
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: px(22),
            width: '100%',
          },
          children,
        },
      },
      { slideNo: slideIndex, totalSlides, source: slide.source, category }
    );
  }

  // Render Single Slide to PNG Buffer (supports overrideTokens for live realtime preview)
  async renderSlideToBuffer(slide, slideIndex, totalSlides, overrideTokens = null) {
    validatePreview(slide, slideIndex, totalSlides, overrideTokens);
    if (isMediaImage(slide.data)) {
      try {
        const bytes = Buffer.from(slide.data.image_data.split(',')[1], 'base64');
        const metadata = await sharp(bytes, { failOn: 'warning', limitInputPixels: 16 * 1024 * 1024 }).metadata();
        if ((metadata.pages || 1) !== 1 || metadata.width > 4096 || metadata.height > 4096) throw new Error('image dimensions');
        await sharp(bytes, { failOn: 'warning', limitInputPixels: 16 * 1024 * 1024 }).stats();
      } catch {
        throw Object.assign(new Error('Invalid payload: slide.data.image_data must contain a decodable raster'), { status: 400 });
      }
    }
    // Layout methods read this.tokens synchronously. A private context keeps a
    // preview's overrides out of other renders and token reloads across awaits.
    const context = Object.create(this);
    context.tokens = overrideTokens
      ? {
        ...this.tokens,
        ...overrideTokens,
        brand: { ...(this.tokens.brand || {}), ...(overrideTokens.brand || {}) },
        palette: { ...(this.tokens.palette || {}), ...(overrideTokens.palette || {}) },
        typography: { ...(this.tokens.typography || {}), ...(overrideTokens.typography || {}) },
      }
      : this.tokens;
    const vdom = context.resolveLayout(slide, slideIndex, totalSlides);
    const svg = await satori(vdom, {
      width: 1080,
      height: 1350,
      fonts: this.fonts,
    });
    return sharp(Buffer.from(svg)).png({ quality: 95 }).toBuffer();
  }

  // Batch Render Carousel to Disk
  async renderCarouselToDisk(draftId, slides, outputDir) {
    const id = validateDraftId(draftId);
    validateSlides(slides);
    const root = path.resolve(outputDir);
    const dir = path.join(root, id);
    const previous = draftRenders.get(dir) || Promise.resolve();
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    draftRenders.set(dir, turn);
    await previous;

    let staging;
    let backup;
    let savedPrevious = false;
    try {
      fs.mkdirSync(root, { recursive: true });
      staging = fs.mkdtempSync(path.join(root, `.${id}.render-`));
      backup = `${staging}.previous`;
      const results = [];
      for (let i = 0; i < slides.length; i++) {
        const entry = slides[i];
        const slideNo = i + 1;
        const startTime = Date.now();
        const pngBuffer = await this.renderSlideToBuffer(entry, slideNo, slides.length);
        fs.writeFileSync(path.join(staging, `slide_${slideNo}.png`), pngBuffer);
        results.push({
          slide_no: slideNo,
          layout: entry.layout || 'cover-stat',
          file_path: path.join(dir, `slide_${slideNo}.png`),
          render_time_ms: Date.now() - startTime,
        });
      }
      // Synchronous renames keep the publish/rollback window free of other
      // in-process requests. No final file is touched before every slide exists.
      if (fs.existsSync(dir)) {
        fs.renameSync(dir, backup);
        savedPrevious = true;
      }
      try {
        fs.renameSync(staging, dir);
      } catch (error) {
        if (savedPrevious) {
          fs.renameSync(backup, dir);
          savedPrevious = false;
        }
        throw error;
      }
      if (savedPrevious) {
        fs.rmSync(backup, { recursive: true, force: true });
        savedPrevious = false;
      }
      // JPEG derivatives are generated after promotion from the PNG files, so a
      // conversion problem can never abort a render that already succeeded.
      await deriveJpegsInDir(dir);
      return results;
    } finally {
      try {
        if (staging) fs.rmSync(staging, { recursive: true, force: true });
      } finally {
        release();
        if (draftRenders.get(dir) === turn) draftRenders.delete(dir);
      }
    }
  }
}
