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
import { EDITORIAL_LAYOUTS, validateDraftId, validateSlides, validatePreview, validateLayoutData } from './validation.js';

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
// The editorial family has its own shared art direction; legacy token palettes
// and layout behavior stay available to existing drafts.
const EDITORIAL = Object.freeze({
  navy: '#102B45', teal: '#167D86', mint: '#66D9CA', amber: '#EDB96C',
  paper: '#F5F3ED', mist: '#EDF4F4', muted: '#546A7B', light: '#C8D9E1',
  line: '#CEDADC', darkLine: '#345064',
});
// Alamat situs yang dicetak pada desain slide (ditetapkan pemilik media).
const SITE_URL_LABEL = 'GAPURAMEDIA.MY.ID';
const BAR_BG = '#08131C';

// Lockup merek GAPURA MEDIA (batang aksen + wordmark) untuk permukaan gelap
// maupun terang; dipakai header editorial, bar bawah, dan sampul.
const editorialLockup = ({ dark = false } = {}) => editorialNode({ alignItems: 'center', gap: '10px' }, [
  editorialNode({ width: '8px', height: '26px', backgroundColor: dark ? EDITORIAL.teal : EDITORIAL.mint }),
  editorialText('GAPURA', { fontFamily: 'Archivo Black', fontSize: '24px', letterSpacing: '1px', lineHeight: '1', color: dark ? EDITORIAL.navy : '#FFFFFF' }),
  editorialText('MEDIA', { fontWeight: 700, color: dark ? EDITORIAL.teal : EDITORIAL.mint, fontSize: '17px', letterSpacing: '4px' }),
]);

// Bar bawah gelap ala wireframe media berita: alamat situs mikro di kiri,
// ajakan geser di kanan. Menempel ke tepi bawah kanvas (absolute),
// menggantikan footer sumber pada halaman artikel dan penutup. Lockup
// merek hanya tampil satu kali di header slide (audit 2026-11-24), dan
// panah geser hanya tampil bila masih ada slide berikutnya — di slide
// terakhir sisi kanan diisi handle akun.
const editorialBottomBar = ({ last = false } = {}) => editorialNode({
  position: 'absolute', left: 0, right: 0, bottom: 0, height: '84px',
  backgroundColor: BAR_BG, alignItems: 'center', justifyContent: 'space-between', padding: '0 72px',
}, [
  editorialText(SITE_URL_LABEL, { fontSize: '14px', fontWeight: 700, letterSpacing: '2px', color: 'rgba(255,255,255,0.85)' }),
  last
    ? editorialText('@gapuramedia', { fontSize: '16px', fontWeight: 700, letterSpacing: '1px', color: EDITORIAL.mint })
    : editorialText('GESER →', { fontSize: '18px', fontWeight: 700, letterSpacing: '1px', color: EDITORIAL.mint }),
]);

const editorialNode = (style, children = []) => ({ type: 'div', props: { style: { display: 'flex', flexShrink: 0, ...style }, children } });
const editorialText = (text, style = {}) => editorialNode({ fontFamily: 'Inter', lineHeight: '1.4', ...style }, String(text ?? ''));

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

// Archivo Black jauh lebih lebar daripada rasio display rata-rata, dan kata
// terpanjang tidak dapat dipenggal Satori: ukuran font display harus lolos
// uji kata terpanjang juga, bukan hanya perkiraan jumlah baris.
function fitDisplaySize(text, { max = 78, min = 30, width = CONTENT_WIDTH, maxLines = 3 } = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const longest = clean.split(' ').reduce((acc, word) => Math.max(acc, word.length), 0);
  for (let size = max; size > min; size -= 1) {
    if (longest * size * 0.8 > width) continue;
    if (estimateLineCount(clean, size, width, 0.8) <= maxLines) return size;
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
  renderImage(data, { width = CONTENT_WIDTH, height = 390, cover = false, bare = false } = {}) {
    if (!data?.image_data) return null;
    const image = {
      type: 'img',
      props: {
        src: data.image_data,
        width,
        height,
        style: { width: `${width}px`, height: `${height}px`, objectFit: 'cover', borderRadius: cover ? '0px' : '4px' },
      },
    };
    // bare: hanya node gambar; pemanggil menggambar scrim dan label
    // kredit/disclosure sendiri (dipakai sampul full-bleed).
    if (bare) return image;
    if (!isMediaImage(data) && !cover) return image;
    const manual = data.image_kind === 'editor_upload';
    return {
      type: 'div',
      props: {
        style: { display: 'flex', position: 'relative', width: `${width}px`, height: `${height}px`, flexShrink: 0, borderRadius: cover ? '0px' : '4px', overflow: 'hidden' },
        children: [
          image,
          ...(cover ? [editorialNode({
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            backgroundImage: 'linear-gradient(180deg, rgba(16,43,69,0.8) 0%, rgba(16,43,69,0.08) 30%, rgba(16,43,69,0.4) 62%, #102B45 100%)',
          })] : []),
          ...(isMediaImage(data) ? [{
            type: 'div',
            props: {
              style: cover
                ? { display: 'flex', position: 'absolute', top: '146px', right: '72px', padding: '10px 14px', backgroundColor: EDITORIAL.navy, color: '#ffffff', fontFamily: 'Inter', fontWeight: 700, fontSize: '18px', lineHeight: '1.3', maxWidth: '700px' }
                : manual
                ? { display: 'flex', position: 'absolute', bottom: '14px', left: '14px', padding: '8px 12px', backgroundColor: '#12241b', color: '#ffffff', fontFamily: 'Inter', fontWeight: 600, fontSize: '16px', lineHeight: '1.3', borderRadius: '4px', maxWidth: '620px' }
                : { display: 'flex', position: 'absolute', bottom: '14px', left: '14px', padding: '10px 14px', backgroundColor: '#12241b', color: '#ffffff', fontFamily: 'Inter', fontWeight: 700, fontSize: '20px', lineHeight: '1.2', borderRadius: '4px' },
              children: manual ? `Gambar: ${data.credit}` : AI_IMAGE_DISCLOSURE,
            },
          }] : []),
        ],
      },
    };
  }

  // Editorial layouts use a top-aligned reading rhythm and the same source
  // footer on every page, including the cover. Image credit stays on the image.
  wrapEditorial(content, slide, slideIndex, totalSlides, { dark = false, background = EDITORIAL.paper, photo = null, bar = false } = {}) {
    const ink = dark ? '#FFFFFF' : EDITORIAL.navy;
    const accent = dark ? EDITORIAL.mint : EDITORIAL.teal;
    const line = dark ? EDITORIAL.darkLine : EDITORIAL.line;
    const source = slide.source || '';
    return editorialNode({
      position: 'relative', width: '1080px', height: '1350px', padding: '72px',
      flexDirection: 'column', backgroundColor: dark ? EDITORIAL.navy : background,
      color: ink, fontFamily: 'Inter', overflow: 'hidden',
    }, [
      ...(photo ? [editorialNode({ position: 'absolute', top: 0, left: 0 }, [photo])] : []),
      editorialNode({ position: 'relative', width: '100%', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${line}`, paddingBottom: '24px' }, [
        editorialNode({ alignItems: 'center', gap: '10px' }, [
          editorialNode({ width: '8px', height: '26px', backgroundColor: accent }),
          editorialText('GAPURA', { fontFamily: 'Archivo Black', fontSize: '24px', letterSpacing: '1px', lineHeight: '1' }),
          editorialText('MEDIA', { fontWeight: 700, color: accent, fontSize: '17px', letterSpacing: '4px' }),
        ]),
        editorialText(`${String(slideIndex).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}`, { fontWeight: 700, fontSize: '16px', letterSpacing: '2px', color: dark ? EDITORIAL.light : EDITORIAL.muted }),
      ]),
      editorialNode({ position: 'relative', flex: 1, minHeight: 0, width: '100%', flexDirection: 'column', justifyContent: 'flex-start', paddingTop: '56px', paddingBottom: bar ? '124px' : '40px' }, [content]),
      ...(bar ? [editorialBottomBar({ last: slideIndex >= totalSlides })] : [editorialNode({ position: 'relative', width: '100%', alignItems: 'center', gap: '24px', paddingTop: '20px', borderTop: `1px solid ${line}` }, [
        editorialText(source, { flex: 1, flexShrink: 1, maxWidth: '700px', fontSize: `${fitFontSize(source, { max: 16, min: 10, width: 700, ratio: CHAR_RATIO.body, maxLines: 3, step: 1 })}px`, lineHeight: '1.4', color: dark ? EDITORIAL.light : EDITORIAL.muted }),
        editorialText(this.tokens.brand.handle || '@gapuramedia', { fontSize: '15px', fontWeight: 700, color: accent, marginLeft: 'auto' }),
      ])]),
    ]);
  }

  // Sampul gaya media berita (photo-led): visual full-bleed dengan scrim
  // navy, masthead + pil tanggal di atas, judul putih besar di kiri bawah,
  // dan strip bawah berisi alamat situs + ajakan geser. Kredit foto atau
  // disclosure ilustrasi tampil mikro di atas strip bawah.
  renderEditorialCover(slide, slideIndex, totalSlides) {
    const { data } = slide;
    const photo = data.image_data ? this.renderImage(data, { width: 1080, height: 1350, cover: true, bare: true }) : null;
    const headlineSize = fitDisplaySize(data.title, { max: 76, min: 34, width: CONTENT_WIDTH, maxLines: 4 });
    const coverSource = String(slide.source || '').trim();
    const supporting = slide.teks && slide.teks !== data.title ? slide.teks : '';
    const manual = data.image_kind === 'editor_upload';
    const creditLabel = isMediaImage(data)
      ? (manual ? (data.credit ? `Gambar: ${data.credit}` : '') : AI_IMAGE_DISCLOSURE)
      : '';
    const dateLabel = typeof data.date_label === 'string' && data.date_label.trim().length > 0 && data.date_label.trim().length <= 30
      ? data.date_label.trim() : '';
    return editorialNode({
      position: 'relative', width: '1080px', height: '1350px', backgroundColor: EDITORIAL.navy,
      flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter', color: '#FFFFFF',
    }, [
      ...(photo ? [editorialNode({ position: 'absolute', top: 0, left: 0 }, [photo])] : []),
      editorialNode({ position: 'absolute', top: 0, left: 0, width: '1080px', height: '1350px', backgroundImage: 'linear-gradient(to top, rgba(6,17,28,0.95) 0%, rgba(6,17,28,0.62) 36%, rgba(6,17,28,0.05) 58%, rgba(6,17,28,0.38) 78%, rgba(6,17,28,0.62) 100%)' }),
      editorialNode({ position: 'relative', flex: 1, flexDirection: 'column', justifyContent: 'space-between', padding: '72px' }, [
        editorialNode({ justifyContent: 'space-between', alignItems: 'center' }, [
          editorialLockup(),
          ...(dateLabel ? [editorialNode({ backgroundColor: '#FFFFFF', borderRadius: '999px', padding: '9px 16px' }, [
            editorialText(dateLabel, { fontSize: '15px', fontWeight: 700, letterSpacing: '1px', color: EDITORIAL.navy }),
          ])] : [editorialNode({ width: '1px', height: '1px' })]),
        ]),
        editorialNode({ flexDirection: 'column' }, [
          ...(data.kicker ? [editorialNode({ alignItems: 'center', gap: '14px' }, [
            editorialNode({ width: '38px', height: '5px', backgroundColor: EDITORIAL.mint }),
            editorialText(data.kicker, { fontSize: '17px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: EDITORIAL.mint }),
          ])] : []),
          editorialText(data.title, {
            fontFamily: 'Archivo Black', fontSize: `${headlineSize}px`,
            lineHeight: '1.1', letterSpacing: '-1px', color: '#FFFFFF', marginTop: '24px', maxWidth: `${CONTENT_WIDTH}px`,
          }),
          ...(supporting ? [editorialText(supporting, {
            fontSize: `${fitFontSize(supporting, { max: 24, min: 19, width: 900, ratio: CHAR_RATIO.body, maxLines: 3, step: 1 })}px`,
            lineHeight: '1.45', color: EDITORIAL.light, marginTop: '20px', maxWidth: '900px',
          })] : []),
          ...(creditLabel ? [editorialText(creditLabel, { fontSize: '13px', color: 'rgba(255,255,255,0.72)', marginTop: '18px' })] : []),
          ...(coverSource ? [editorialText(coverSource, {
            fontSize: `${fitFontSize(coverSource, { max: 13, min: 11, width: CONTENT_WIDTH, ratio: CHAR_RATIO.body, maxLines: 2, step: 1 })}px`,
            lineHeight: '1.4', color: 'rgba(255,255,255,0.78)', marginTop: '26px', maxWidth: `${CONTENT_WIDTH}px`,
          })] : []),
          editorialNode({ justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.35)', paddingTop: '20px', marginTop: '26px' }, [
            editorialText(SITE_URL_LABEL, { fontSize: '14px', fontWeight: 700, letterSpacing: '2px', color: 'rgba(255,255,255,0.85)' }),
            editorialText('GESER →', { fontSize: '18px', fontWeight: 700, letterSpacing: '1px', color: EDITORIAL.mint }),
          ]),
        ]),
      ]),
    ]);
  }

  renderEditorial(slide, slideIndex, totalSlides) {
    const { layout, data } = slide;
    if (layout === 'editorial-cover') return this.renderEditorialCover(slide, slideIndex, totalSlides);
    const quote = layout === 'editorial-quote';
    const close = layout === 'editorial-close';
    const dark = quote || close;
    const accent = dark ? EDITORIAL.mint : EDITORIAL.teal;
    const secondary = dark ? EDITORIAL.light : EDITORIAL.muted;
    const headlineMax = quote || close ? 44 : 68;
    const headlineSize = fitFontSize(data.title, { max: headlineMax, min: 34, maxLines: 3 });
    const children = [];
    // Halaman artikel menata judul beritanya sendiri dan halaman penutup
    // memakai label + pertanyaan; layout lain memakai kicker + judul di sini.
    if (layout !== 'editorial-lead' && layout !== 'editorial-close') {
      if (data.kicker) children.push(editorialNode({ alignItems: 'center', gap: '14px' }, [
        editorialNode({ width: '38px', height: '5px', backgroundColor: EDITORIAL.amber }),
        editorialText(data.kicker, { fontSize: '19px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: accent }),
      ]));
      children.push(editorialText(data.title, {
        fontFamily: 'Archivo Black', fontSize: `${headlineSize}px`,
        lineHeight: '1.12', letterSpacing: '-1.5px', marginTop: '28px', maxWidth: `${CONTENT_WIDTH}px`,
      }));
    }
    const supporting = slide.teks && slide.teks !== data.title && slide.teks !== data.quote && slide.teks !== data.question ? slide.teks : '';
    const body = (size = 36, width = CONTENT_WIDTH) => supporting ? editorialText(supporting, {
      fontSize: `${fitFontSize(supporting, { max: size, min: 24, width, ratio: CHAR_RATIO.body, maxLines: 5, step: 1 })}px`,
      lineHeight: '1.5', color: secondary, marginTop: '28px', maxWidth: `${width}px`,
    }) : null;

    switch (layout) {
      case 'editorial-lead': {
        // Halaman isi gaya media berita: judul asli tampil tebal navy di
        // atas, garis aksen teal, lalu isi artikel lengkap dalam SATU
        // ukuran font seragam yang diturunkan sampai total tinggi
        // perkiraan muat di area konten — tidak ada blok beda ukuran dan
        // tidak ada teks yang menabrak bar bawah. Baris sumber menutup
        // halaman tepat di atas bar.
        const leadHeadlineSize = fitDisplaySize(data.title, { max: 52, min: 30, maxLines: 3 });
        const leadHeadlineLines = estimateLineCount(data.title, leadHeadlineSize, CONTENT_WIDTH, 0.8);
        const blocks = [supporting, ...(data.paragraphs || []).map((paragraph) => paragraph.text)]
          .map((text) => String(text || '').trim()).filter(Boolean);
        const sourceLine = String(slide.source || '').trim();
        // Wilayah anak: 1350 - padding akar 144 - header 51 - paddingTop
        // konten 56 - ruang bar bawah 124 = 975.
        const headlineBlock = leadHeadlineLines * leadHeadlineSize * 1.12 + 24 + 6 + 28;
        const articleBudget = Math.max(300, 975 - headlineBlock - (sourceLine ? 49 : 0));
        const articleHeight = (size) => blocks.reduce((total, text, index) =>
          total + (index ? 22 : 0) + estimateLineCount(text, size, CONTENT_WIDTH, 0.56) * size * 1.45, 8);
        let articleSize = 20;
        for (let size = 32; size >= 20; size -= 1) {
          if (articleHeight(size) <= articleBudget) { articleSize = size; break; }
        }
        children.push(
          editorialText(data.title, {
            fontFamily: 'Archivo Black', fontSize: `${leadHeadlineSize}px`,
            lineHeight: '1.12', letterSpacing: '-1px', color: EDITORIAL.navy, maxWidth: `${CONTENT_WIDTH}px`,
          }),
          editorialNode({ width: '64px', height: '6px', backgroundColor: EDITORIAL.teal, marginTop: '24px' }),
          editorialNode({ flexDirection: 'column', gap: '22px', marginTop: '28px' }, blocks.map((text) => editorialText(text, {
            fontSize: `${articleSize}px`, lineHeight: '1.45', color: '#2B3A47', maxWidth: `${CONTENT_WIDTH}px`,
          }))),
        );
        if (sourceLine) children.push(
          editorialNode({ flex: 1 }),
          editorialText(sourceLine, { fontSize: '15px', lineHeight: '1.4', color: EDITORIAL.muted, marginTop: '28px', maxWidth: `${CONTENT_WIDTH}px` }),
        );
        break;
      }

      case 'editorial-breakdown': {
        // Baris item memakai tangga auto-fit seperti editorial-impact:
        // ukuran nilai diturunkan bertahap, lalu label, padding baris, dan
        // jarak atas ikut mengecil, sampai seluruh tumpukan (judul + teks
        // pendukung + semua item) muat di wilayah konten (±1000px). Tanpa
        // tangga ini daftar panjang — mis. enam nama tersangka — tumpah
        // keluar batas bawah dan item terakhir terpotong; dengan tangga ini
        // daftar tetap SATU slide dengan penomoran berurutan. Anak tangga
        // pertama identik dengan tampilan lama, jadi slide pendek tidak
        // berubah sama sekali.
        const items = Array.isArray(data.items) ? data.items : [];
        const bodyFit = supporting ? fitFontSize(supporting, { max: 30, min: 24, width: CONTENT_WIDTH, ratio: CHAR_RATIO.body, maxLines: 5, step: 1 }) : 0;
        const headH = (data.kicker ? 27 : 0) + 28
          + estimateLineCount(data.title, headlineSize, CONTENT_WIDTH) * headlineSize * 1.12;
        const bodyH = supporting ? 28 + estimateLineCount(supporting, bodyFit, CONTENT_WIDTH, CHAR_RATIO.body) * bodyFit * 1.5 : 0;
        const candidates = [];
        for (let cap = 34; cap >= 24; cap -= 1) candidates.push({ cap, min: 24, maxLines: 3, label: 23, pad: 28, top: 38 });
        candidates.push(
          { cap: 24, min: 20, maxLines: 2, label: 23, pad: 28, top: 38 },
          { cap: 22, min: 19, maxLines: 2, label: 21, pad: 20, top: 32 },
          { cap: 20, min: 18, maxLines: 2, label: 20, pad: 16, top: 28 },
          { cap: 19, min: 17, maxLines: 2, label: 19, pad: 12, top: 24 },
        );
        const itemsHeight = (rung) => items.reduce((total, item) => {
          const size = fitFontSize(item.value, { max: rung.cap, min: rung.min, width: 840, ratio: CHAR_RATIO.body, maxLines: rung.maxLines, step: 1 });
          return total + rung.pad * 2 + rung.label * 1.4 + 10
            + estimateLineCount(item.value, size, 840, CHAR_RATIO.body) * size * 1.35;
        }, items.length ? rung.top : 0);
        let rung = candidates[candidates.length - 1];
        if (items.length) {
          for (const candidate of candidates) {
            if (headH + bodyH + itemsHeight(candidate) <= 1000) { rung = candidate; break; }
          }
        }
        children.push(body(30), editorialNode({ flexDirection: 'column', marginTop: `${rung.top}px` }, items.map((item, index) =>
          editorialNode({ alignItems: 'flex-start', gap: '28px', padding: `${rung.pad}px 0`, borderTop: `1px solid ${EDITORIAL.line}` }, [
            editorialText(String(index + 1).padStart(2, '0'), { width: '64px', fontFamily: 'Archivo Black', fontSize: '38px', lineHeight: '1.2', color: EDITORIAL.teal }),
            editorialNode({ flex: 1, flexDirection: 'column', gap: '10px' }, [
              editorialText(item.label, { fontSize: `${rung.label}px`, fontWeight: 700, color: EDITORIAL.teal }),
              editorialText(item.value, { fontSize: `${fitFontSize(item.value, { max: rung.cap, min: rung.min, width: 840, ratio: CHAR_RATIO.body, maxLines: rung.maxLines, step: 1 })}px`, lineHeight: '1.35' }),
            ]),
          ]))));
        break;
      }

      case 'editorial-timeline': {
        // Linimasa memakai tangga penyesuaian tinggi seperti
        // editorial-breakdown: ukuran teks peristiwa diturunkan bertahap,
        // lalu ukuran tanggal, jarak dalam peristiwa, jarak antar-peristiwa,
        // dan jarak atas blok ikut mengecil, sampai seluruh tumpukan (judul
        // + teks pendukung + semua peristiwa) muat di wilayah konten
        // (±1000px, zona footer sumber dicadangkan). Tanpa tangga ini
        // linimasa padat — mis. lima peristiwa Candiru pada draf #39 —
        // tumpah keluar batas bawah: teks peristiwa keempat menabrak baris
        // sumber dan peristiwa terakhir jatuh di luar kanvas, padahal
        // pratinjau Space menampilkannya utuh satu slide. Anak tangga
        // pertama identik dengan tampilan lama, jadi linimasa pendek
        // (≤3 peristiwa) tidak berubah sama sekali. Teks peristiwa tidak
        // pernah dipendekkan — hanya ukuran dan jarak yang menyesuaikan.
        const events = Array.isArray(data.events) ? data.events : [];
        const bodyFit = supporting ? fitFontSize(supporting, { max: 30, min: 24, width: CONTENT_WIDTH, ratio: CHAR_RATIO.body, maxLines: 5, step: 1 }) : 0;
        const headH = (data.kicker ? 27 : 0) + 28
          + estimateLineCount(data.title, headlineSize, CONTENT_WIDTH) * headlineSize * 1.12;
        const bodyH = supporting ? 28 + estimateLineCount(supporting, bodyFit, CONTENT_WIDTH, CHAR_RATIO.body) * bodyFit * 1.5 : 0;
        const candidates = [];
        for (let cap = 34; cap >= 24; cap -= 1) candidates.push({ cap, min: 24, maxLines: 3, date: 22, gap: 8, pad: 30, top: 40 });
        candidates.push(
          { cap: 24, min: 20, maxLines: 2, date: 22, gap: 8, pad: 30, top: 40 },
          { cap: 22, min: 19, maxLines: 2, date: 21, gap: 6, pad: 20, top: 32 },
          { cap: 20, min: 18, maxLines: 2, date: 20, gap: 6, pad: 16, top: 28 },
          { cap: 19, min: 17, maxLines: 2, date: 19, gap: 4, pad: 12, top: 24 },
        );
        const eventsHeight = (rung) => events.reduce((total, event, index) => {
          const size = fitFontSize(event.text, { max: rung.cap, min: rung.min, width: 886, ratio: CHAR_RATIO.body, maxLines: rung.maxLines, step: 1 });
          return total + rung.date * 1.4 + rung.gap
            + estimateLineCount(event.text, size, 886, CHAR_RATIO.body) * size * 1.35
            + (index === events.length - 1 ? 0 : rung.pad);
        }, events.length ? rung.top : 0);
        let rung = candidates[candidates.length - 1];
        if (events.length) {
          for (const candidate of candidates) {
            if (headH + bodyH + eventsHeight(candidate) <= 1000) { rung = candidate; break; }
          }
        }
        children.push(body(30), editorialNode({ flexDirection: 'column', marginTop: `${rung.top}px` }, events.map((event, index) =>
          editorialNode({ position: 'relative', gap: '28px', paddingBottom: index === events.length - 1 ? 0 : `${rung.pad}px` }, [
            editorialNode({ position: 'relative', width: '22px', alignSelf: 'stretch', justifyContent: 'center' }, [
              ...(index < events.length - 1 ? [editorialNode({ position: 'absolute', width: '2px', top: '14px', bottom: '-16px', backgroundColor: EDITORIAL.line })] : []),
              editorialNode({ width: '18px', height: '18px', borderRadius: '9px', marginTop: '9px', backgroundColor: index === 0 ? EDITORIAL.teal : EDITORIAL.amber }),
            ]),
            editorialNode({ flex: 1, flexDirection: 'column', gap: `${rung.gap}px` }, [
              editorialText(event.date, { fontSize: `${rung.date}px`, fontWeight: 700, color: EDITORIAL.teal }),
              editorialText(event.text, { fontSize: `${fitFontSize(event.text, { max: rung.cap, min: rung.min, width: 886, ratio: CHAR_RATIO.body, maxLines: rung.maxLines, step: 1 })}px`, lineHeight: '1.35' }),
            ]),
          ]))));
        break;
      }

      case 'editorial-quote':
        children.push(
          editorialText('“', { fontFamily: 'Archivo Black', fontSize: '132px', lineHeight: '0.8', color: EDITORIAL.mint, marginTop: '42px' }),
          editorialText(data.quote, { fontSize: `${fitFontSize(data.quote, { max: 64, min: 30, ratio: CHAR_RATIO.body, maxLines: 6, step: 1 })}px`, fontWeight: 700, lineHeight: '1.25', marginTop: '10px' }),
          editorialNode({ flexDirection: 'column', borderLeft: `5px solid ${EDITORIAL.amber}`, paddingLeft: '24px', marginTop: '36px', gap: '8px' }, [
            editorialText(data.author, { fontWeight: 700, fontSize: '28px' }),
            editorialText(data.role_label, { fontSize: '23px', color: EDITORIAL.light }),
          ]), body(28),
        );
        break;

      case 'editorial-impact': {
        const value = data.value ?? data.stat;
        // A number is emphasized only when explicitly supplied, never inferred
        // from the prose or from the slide's position in the carousel.
        const numeric = (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /\d/u.test(value));
        const hasStat = value !== undefined && value !== null && String(value).trim();
        const statSize = hasStat ? fitFontSize(String(value), { max: numeric ? 156 : 44, min: 30, maxLines: 2 }) : 0;
        if (hasStat) {
          children.push(editorialText(value, {
            fontFamily: numeric ? 'Archivo Black' : 'Inter', fontWeight: numeric ? 400 : 700,
            fontSize: `${statSize}px`,
            color: EDITORIAL.teal, lineHeight: '1.15', letterSpacing: numeric ? '-3px' : 0, marginTop: '44px',
          }));
          if (data.unit || data.label) children.push(editorialText(data.unit || data.label, { fontSize: '24px', fontWeight: 700, color: EDITORIAL.teal, marginTop: '16px' }));
        }
        // Item tampil sebagai baris bernomor yang sama persis dengan
        // editorial-breakdown (label teal + nilai reguler), bukan lagi bilah
        // tepi dengan nilai tebal yang membesar bila mengandung angka —
        // gaya lama membuat slide dampak tidak seragam dengan slide isi
        // lain. Ukuran nilai diturunkan bertahap sampai seluruh tumpukan
        // muat di wilayah konten (±1000px), meniru anggaran tinggi
        // editorial-lead, supaya teks tidak pernah keluar batas bawah.
        const items = Array.isArray(data.items) ? data.items : [];
        const bodyMax = numeric || items.length ? 34 : 44;
        const bodyFit = supporting ? fitFontSize(supporting, { max: bodyMax, min: 24, width: 870, ratio: CHAR_RATIO.body, maxLines: 5, step: 1 }) : 0;
        const headH = (data.kicker ? 27 : 0) + 28
          + estimateLineCount(data.title, headlineSize, CONTENT_WIDTH) * headlineSize * 1.12;
        const statH = hasStat ? 44 + estimateLineCount(String(value), statSize, CONTENT_WIDTH, numeric ? CHAR_RATIO.display : CHAR_RATIO.body) * statSize * 1.15
          + ((data.unit || data.label) ? 50 : 0) : 0;
        const bodyH = supporting ? 28 + estimateLineCount(supporting, bodyFit, 870, CHAR_RATIO.body) * bodyFit * 1.5 : 0;
        const calloutH = data.callout ? 68 : 0;
        const itemsHeight = (cap, min, maxLines) => items.reduce((total, item) => {
          const size = fitFontSize(item.value, { max: cap, min, width: 840, ratio: CHAR_RATIO.body, maxLines, step: 1 });
          return total + 56 + 32 + 10 + estimateLineCount(item.value, size, 840, CHAR_RATIO.body) * size * 1.35;
        }, items.length ? 38 : 0);
        let itemCap = 34; let itemMin = 24; let itemLines = 3;
        if (items.length) {
          let fits = false;
          for (let cap = 34; cap >= 24; cap -= 1) {
            if (headH + statH + bodyH + calloutH + itemsHeight(cap, 24, 3) <= 1000) { itemCap = cap; fits = true; break; }
          }
          if (!fits) { itemCap = 24; itemMin = 20; itemLines = 2; }
        }
        children.push(body(bodyMax, 870));
        if (items.length) children.push(editorialNode({ flexDirection: 'column', marginTop: '38px' }, items.map((item, index) =>
          editorialNode({ alignItems: 'flex-start', gap: '28px', padding: '28px 0', borderTop: `1px solid ${EDITORIAL.line}` }, [
            editorialText(String(index + 1).padStart(2, '0'), { width: '64px', fontFamily: 'Archivo Black', fontSize: '38px', lineHeight: '1.2', color: EDITORIAL.teal }),
            editorialNode({ flex: 1, flexDirection: 'column', gap: '10px' }, [
              editorialText(item.label, { fontSize: '23px', fontWeight: 700, color: EDITORIAL.teal }),
              editorialText(item.value, { fontSize: `${fitFontSize(item.value, { max: itemCap, min: itemMin, width: 840, ratio: CHAR_RATIO.body, maxLines: itemLines, step: 1 })}px`, lineHeight: '1.35' }),
            ]),
          ]))));
        if (data.callout) children.push(editorialText(data.callout, { fontSize: '26px', color: EDITORIAL.teal, fontWeight: 700, marginTop: '32px' }));
        break;
      }

      case 'editorial-close': {
        // Satori tidak memenggal baris pada token yang diawali '@' (handle
        // akun), sehingga pertanyaan sepanjang apa pun akan digambar satu
        // baris dan tumpah keluar kanvas. Karena itu pertanyaan ditata
        // manual menjadi baris berimbang pada ukuran terpilih lebih dulu.
        const questionSize = fitDisplaySize(data.question, { max: 84, min: 30, maxLines: 3 });
        const balancedQuestion = balanceLines(data.question, { fontSize: questionSize, ratio: 0.8, maxLines: 3 });
        const questionLines = balancedQuestion ? balancedQuestion.split('\n') : [data.question];
        const closeLabel = data.kicker?.trim() || 'TETAP TERHUBUNG';
        // Judul slide tetap digambar sebagai tajuk kecil di bawah label,
        // kecuali bila isinya sama dengan label (menghindari pengulangan).
        const closeTitle = data.title?.trim() && data.title.trim().toUpperCase() !== closeLabel.toUpperCase()
          ? editorialText(data.title, {
            fontFamily: 'Archivo Black', fontSize: `${fitFontSize(data.title, { max: 30, min: 24, maxLines: 2 })}px`,
            lineHeight: '1.15', letterSpacing: '-0.5px', color: '#FFFFFF', marginTop: '20px', maxWidth: `${CONTENT_WIDTH}px`,
          })
          : null;
        const closeSource = String(slide.source || '').trim();
        // Blok utama penutup (label, tajuk kecil, pertanyaan, teks follow,
        // baris simpan) terpusat vertikal di wilayah konten — dibungkus
        // kolom flex:1 dengan justifyContent center, bukan lagi menempel
        // ke atas (audit owner 2026-11-24). Elemen, warna, dan teks tidak
        // berubah; baris sumber tetap duduk di dasar wilayah konten, di
        // bawah blok yang terpusat, dan header serta bar bawah tidak
        // bergeser.
        const closeBlock = editorialNode({ flex: 1, flexDirection: 'column', justifyContent: 'center' }, [
          editorialText(closeLabel, { fontSize: '17px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: EDITORIAL.mint, marginTop: '16px' }),
          closeTitle,
          editorialNode({ flexDirection: 'column', marginTop: '30px' }, questionLines.map((line) =>
            editorialText(line, { fontFamily: 'Archivo Black', fontSize: `${questionSize}px`, lineHeight: '1.15', letterSpacing: '-1px', color: EDITORIAL.mint, maxWidth: `${CONTENT_WIDTH}px` }))),
          body(34),
          editorialNode({ gap: '20px', alignItems: 'center', paddingTop: '30px', borderTop: `1px solid ${EDITORIAL.darkLine}`, marginTop: '56px' }, [
            { type: 'svg', props: { width: 28, height: 34, viewBox: '0 0 28 34', children: { type: 'path', props: { d: 'M4 2H24V31L14 24L4 31Z', fill: 'none', stroke: EDITORIAL.amber, strokeWidth: 2.5 } } } },
            editorialText(data.cta?.trim() || 'Simpan untuk dibaca lagi', { flex: 1, fontSize: '24px', fontWeight: 700, color: EDITORIAL.amber }),
          ]),
        ].filter(Boolean));
        children.push(closeBlock);
        if (closeSource) children.push(editorialText(closeSource, { fontSize: '15px', lineHeight: '1.4', color: EDITORIAL.light, marginTop: '20px', maxWidth: `${CONTENT_WIDTH}px` }));
        break;
      }
    }
    return this.wrapEditorial(editorialNode({ flexDirection: 'column', width: '100%', flex: 1 }, children.filter(Boolean)), slide, slideIndex, totalSlides, {
      dark, background: layout === 'editorial-timeline' ? EDITORIAL.mist : EDITORIAL.paper,
      bar: layout === 'editorial-lead' || layout === 'editorial-close',
    });
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

    if (EDITORIAL_LAYOUTS.includes(layout)) return this.renderEditorial(slide, slideIndex, totalSlides);

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
