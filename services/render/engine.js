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

  // Base Slide Shell (Consistent Header & Footer for all slides)
  wrapSlide(contentNode, { slideNo, totalSlides, source, category, showSource = true }) {
    const { brand, palette, grid } = this.tokens;

    return {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '1080px',
          height: '1350px',
          backgroundColor: palette.bg || '#F8F6F0',
          padding: `${grid.margin || 72}px`,
          fontFamily: 'Inter',
          color: palette.ink || '#102B45',
        },
        children: [
          // Header Bar
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                borderBottom: `1.5px solid ${palette.border || '#DED9CC'}`,
                paddingBottom: '22px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: 'Archivo Black',
                            fontSize: '22px',
                            color: palette.ink || '#102B45',
                            letterSpacing: '1px',
                          },
                          children: 'GAPURA',
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: 'Inter',
                            fontWeight: 700,
                            fontSize: '20px',
                            color: palette.accent || '#1F7E81',
                            letterSpacing: '2px',
                          },
                          children: 'MEDIA',
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: palette.highlight || '#D79344',
                            marginLeft: '2px',
                          },
                        },
                      },
                      category
                        ? {
                            type: 'div',
                            props: {
                              style: {
                                backgroundColor: palette.accent || '#1F7E81',
                                color: '#ffffff',
                                fontSize: '13px',
                                fontFamily: 'Inter',
                                fontWeight: 700,
                                padding: '5px 14px',
                                borderRadius: '16px',
                                letterSpacing: '0.8px',
                                marginLeft: '12px',
                              },
                              children: category.toUpperCase(),
                            },
                          }
                        : null,
                    ].filter(Boolean),
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      backgroundColor: '#ede7db',
                      border: `1px solid ${palette.border || '#DED9CC'}`,
                      borderRadius: '20px',
                      padding: '5px 16px',
                      fontSize: '14px',
                      fontFamily: 'Inter',
                      fontWeight: 700,
                      color: palette.ink || '#102B45',
                      letterSpacing: '0.5px',
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
                paddingTop: '36px',
                paddingBottom: '36px',
              },
              children: [contentNode],
            },
          },

          // Footer Bar
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                borderTop: `1.5px solid ${palette.border || '#DED9CC'}`,
                paddingTop: '20px',
                fontSize: '14px',
                color: palette.muted || '#5A6B7C',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', alignItems: 'center', gap: '8px' },
                    children: [
                      {
                        type: 'span',
                        props: {
                          style: {
                            fontWeight: 700,
                            color: palette.ink || '#102B45',
                            fontSize: '12px',
                            letterSpacing: '0.5px',
                          },
                          children: 'SUMBER DATA:',
                        },
                      },
                      {
                        type: 'span',
                        props: {
                          style: { color: palette.muted || '#5A6B7C', fontSize: '13px' },
                          children: showSource && source ? source : brand.tagline || 'Data, Hukum & Ekonomi Bursa',
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 700,
                      color: palette.accent || '#1F7E81',
                      fontSize: '14px',
                      letterSpacing: '0.5px',
                    },
                    children: [
                      {
                        type: 'span',
                        props: {
                          style: { color: palette.highlight || '#D79344' },
                          children: '●',
                        },
                      },
                      {
                        type: 'span',
                        props: {
                          children: brand.handle || '@gapuramedia',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    };
  }

  // 9 Layout Resolvers
  resolveLayout(slide, slideIndex, totalSlides) {
    const layout = slide.layout || 'cover-stat';
    const { palette, typography } = this.tokens;

    switch (layout) {
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
                              children:
                                subtext ||
                                'Laporan editorial mendalam berdasarkan analisis data bursa, regulasi hukum, dan pergerakan makro ekonomi terverifikasi.',
                            },
                          },
                        ],
                      },
                    },
                // 4. Swipe prompt at bottom
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      backgroundColor: palette.accent || '#1F7E81',
                      color: '#ffffff',
                      fontSize: '15px',
                      fontFamily: 'Inter',
                      fontWeight: 700,
                      padding: '12px 28px',
                      borderRadius: '30px',
                      letterSpacing: '0.5px',
                      alignSelf: 'flex-start',
                      marginTop: '8px',
                    },
                    children: 'GESER KE KIRI UNTUK ANALISIS ➔',
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, category: category }
        );
      }

      case 'big-statement': {
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
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: 'Archivo Black',
                            fontSize: '48px',
                            color: palette.highlight || '#D79344',
                            lineHeight: '1',
                          },
                          children: '“',
                        },
                      },
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
                          children: 'PERNYATAAN RESMI',
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Inter',
                      fontSize: '32px',
                      lineHeight: '1.45',
                      fontWeight: 700,
                      color: palette.ink || '#102B45',
                    },
                    children: `“${slide.teks}”`,
                  },
                },
                slide.data?.author
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
              ].filter(Boolean),
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, category: slide.data?.category }
        );
      }

      case 'stat-grid': {
        const items = slide.data?.items || [
          { label: 'Data 1', value: '10%' },
          { label: 'Data 2', value: '25%' },
        ];
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
                      fontSize: '36px',
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
          { slideNo: slideIndex, totalSlides, source: slide.source, category: slide.data?.category }
        );
      }

      case 'chart-bar': {
        const labels = slide.data?.labels || ['A', 'B', 'C'];
        const values = slide.data?.values || [10, 20, 30];
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
                      fontSize: '34px',
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
                      const val = values[i] || 0;
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
          { slideNo: slideIndex, totalSlides, source: slide.source, category: slide.data?.category }
        );
      }

      case 'chart-line': {
        const labels = slide.data?.labels || ['Bln 1', 'Bln 2', 'Bln 3'];
        const values = slide.data?.values || [10, 15, 12];
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
                      fontSize: '34px',
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
                      const val = values[idx] || 0;
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
          { slideNo: slideIndex, totalSlides, source: slide.source, category: slide.data?.category }
        );
      }

      case 'regulasi': {
        const title = slide.data?.title || 'REGULASI / PASAL HUKUM';
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
                            fontSize: '26px',
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
          { slideNo: slideIndex, totalSlides, source: slide.source, category: 'HUKUM & REGULASI' }
        );
      }

      case 'timeline': {
        const events = slide.data?.events || [
          { date: 'Tahap 1', text: 'Peristiwa awal' },
          { date: 'Tahap 2', text: 'Perkembangan selanjutnya' },
        ];
        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '28px' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { fontFamily: 'Archivo Black', fontSize: '34px', color: palette.ink },
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
          { slideNo: slideIndex, totalSlides, source: slide.source, category: slide.data?.category }
        );
      }

      case 'comparison': {
        const left = slide.data?.left || { title: 'Sebelum', text: 'Kondisi lama' };
        const right = slide.data?.right || { title: 'Sesudah', text: 'Kondisi baru' };

        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: '28px' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { fontFamily: 'Archivo Black', fontSize: '34px', color: palette.ink },
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
                            { type: 'div', props: { style: { fontSize: '20px', lineHeight: '1.5', color: palette.ink }, children: left.text } },
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
                            { type: 'div', props: { style: { fontSize: '20px', lineHeight: '1.5', color: palette.ink }, children: right.text } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, category: slide.data?.category }
        );
      }

      case 'cta-close': {
        const headline = slide.teks || 'SIMPAN DATA INI UNTUK REFERENSI';
        const ctaText = slide.data?.cta || `Ikuti ${this.tokens.brand?.handle || '@gapuramedia'} untuk data bursa & regulasi harian.`;
        const disclaimer = slide.data?.disclaimer || 'Informasi disajikan untuk tujuan edukasi data publik dan bukan merupakan rekomendasi transaksi saham maupun nasihat hukum resmi.';

        return this.wrapSlide(
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '28px',
                width: '100%',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: '44px',
                      color: palette.ink || '#102B45',
                      lineHeight: '1.25',
                    },
                    children: headline,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '22px',
                      color: palette.accent || '#1F7E81',
                      lineHeight: '1.4',
                      fontWeight: 600,
                    },
                    children: ctaText,
                  },
                },
                // Action Grid
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      width: '100%',
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            backgroundColor: '#ffffff',
                            border: `1.5px solid ${palette.border || '#DED9CC'}`,
                            borderRadius: '12px',
                            padding: '16px 20px',
                            gap: '16px',
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  backgroundColor: palette.accent || '#1F7E81',
                                  color: '#ffffff',
                                  fontFamily: 'Archivo Black',
                                  fontSize: '13px',
                                  borderRadius: '6px',
                                  padding: '5px 12px',
                                  letterSpacing: '0.5px',
                                },
                                children: 'SIMPAN',
                              },
                            },
                            { type: 'span', props: { style: { fontSize: '17px', fontWeight: 600, color: palette.ink || '#102B45' }, children: 'Simpan postingan ini untuk rujukan data bursa & regulasi.' } },
                          ],
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            backgroundColor: '#ffffff',
                            border: `1.5px solid ${palette.border || '#DED9CC'}`,
                            borderRadius: '12px',
                            padding: '16px 20px',
                            gap: '16px',
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  backgroundColor: palette.highlight || '#D79344',
                                  color: '#ffffff',
                                  fontFamily: 'Archivo Black',
                                  fontSize: '13px',
                                  borderRadius: '6px',
                                  padding: '5px 12px',
                                  letterSpacing: '0.5px',
                                },
                                children: 'BAGIKAN',
                              },
                            },
                            { type: 'span', props: { style: { fontSize: '17px', fontWeight: 600, color: palette.ink || '#102B45' }, children: 'Bagikan ke rekan atau tim investor Anda untuk diskusi.' } },
                          ],
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            backgroundColor: '#ffffff',
                            border: `1.5px solid ${palette.border || '#DED9CC'}`,
                            borderRadius: '12px',
                            padding: '16px 20px',
                            gap: '16px',
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  backgroundColor: palette.ink || '#102B45',
                                  color: '#ffffff',
                                  fontFamily: 'Archivo Black',
                                  fontSize: '13px',
                                  borderRadius: '6px',
                                  padding: '5px 12px',
                                  letterSpacing: '0.5px',
                                },
                                children: 'DISKUSI',
                              },
                            },
                            { type: 'span', props: { style: { fontSize: '17px', fontWeight: 600, color: palette.ink || '#102B45' }, children: 'Tulis pandangan atau pertanyaan di kolom komentar.' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                // Compliance Box
                {
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
                    children: `DISCLAIMER RESMI: ${disclaimer}`,
                  },
                },
              ],
            },
          },
          { slideNo: slideIndex, totalSlides, source: slide.source, category: 'PENUTUP' }
        );
      }

      default:
        return this.renderFluidLayout(slide, slideIndex, totalSlides);
    }
  }

  // Universal Fluid Layout Renderer (Full AI Adaptive Creative Direction)
  renderFluidLayout(slide, slideIndex, totalSlides) {
    const { palette, typography } = this.tokens;
    const data = slide.data || {};
    const text = slide.teks || '';
    const title = data.title || data.headline || (data.value || data.stat || data.items || data.quote ? text : '');
    const subtitle = data.subtitle || data.subtext || '';
    const category = data.category || (slideIndex === 1 ? 'LAPORAN UTAMA' : 'ANALISIS EDITORIAL');

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
                    fontSize: '20px',
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
      const fontSize = title.length > 90 ? '34px' : title.length > 50 ? '42px' : '50px';
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
    if (data.value || data.stat) {
      const val = String(data.value || data.stat);
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
                        fontSize: val.length > 12 ? '48px' : '62px',
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
                            fontSize: '18px',
                            fontWeight: 700,
                            color: palette.accent || '#1F7E81',
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
    const items = data.items || data.cards || data.metrics || (Array.isArray(data.list) && typeof data.list[0] === 'object' ? data.list : null);
    if (Array.isArray(items) && items.length > 0) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '18px',
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
                padding: '22px',
                width: items.length === 1 ? '100%' : '440px',
                gap: '8px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: '38px',
                      color: palette.accent,
                      lineHeight: '1.1',
                    },
                    children: String(it.value || it.stat || it.number || ''),
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '18px',
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
                      children: data.left.title || 'SEBELUMNYA',
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
                      children: data.right.title || 'SAAT INI / DAMPAK',
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
    const bullets = data.bullets || data.points || (Array.isArray(data.list) && typeof data.list[0] === 'string' ? data.list : null);
    if (Array.isArray(bullets) && bullets.length > 0) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
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
                padding: '16px 20px',
                gap: '16px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      backgroundColor: palette.accent,
                      color: '#ffffff',
                      fontFamily: 'Archivo Black',
                      fontSize: '16px',
                      borderRadius: '50%',
                      width: '32px',
                      height: '32px',
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
                      fontSize: '19px',
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
    if (data.quote || data.author) {
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
                  fontSize: '26px',
                  lineHeight: '1.45',
                  fontWeight: 700,
                  color: palette.ink,
                  fontStyle: 'italic',
                },
                children: `“${data.quote || text}”`,
              },
            },
            data.author
              ? {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '19px',
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
            padding: '22px 26px',
            fontSize: '19px',
            lineHeight: '1.5',
            color: palette.ink,
            fontWeight: 500,
          },
          children: noteText,
        },
      });
    }

    // 9. Narrative Body Text (if text was not already used as title/quote)
    if (text && text !== title && !data.quote) {
      children.push({
        type: 'div',
        props: {
          style: {
            fontSize: '22px',
            lineHeight: '1.55',
            color: palette.ink,
            backgroundColor: palette.card_bg,
            border: `1px solid ${palette.border}`,
            borderRadius: '10px',
            padding: '22px 26px',
          },
          children: text,
        },
      });
    }

    // Slide 1 Swipe Indicator
    if (slideIndex === 1 && totalSlides > 1) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: palette.accent || '#1F7E81',
            color: '#ffffff',
            fontSize: '15px',
            fontFamily: 'Inter',
            fontWeight: 700,
            padding: '12px 28px',
            borderRadius: '30px',
            letterSpacing: '0.5px',
            alignSelf: 'flex-start',
            marginTop: '8px',
          },
          children: 'GESER KE KIRI UNTUK ANALISIS ➔',
        },
      });
    }

    // 10. CTA Button / Footer Action (if present or last slide)
    if (slideIndex === totalSlides && totalSlides > 1) {
      children.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
            marginTop: '8px',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#ffffff',
                  border: `1.5px solid ${palette.border || '#DED9CC'}`,
                  borderRadius: '12px',
                  padding: '14px 20px',
                  gap: '12px',
                },
                children: [
                  { type: 'span', props: { style: { fontSize: '20px' }, children: '💾' } },
                  { type: 'span', props: { style: { fontSize: '16px', fontWeight: 700, color: palette.ink || '#102B45' }, children: 'Simpan postingan ini untuk referensi bursa & regulasi.' } },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#ffffff',
                  border: `1.5px solid ${palette.border || '#DED9CC'}`,
                  borderRadius: '12px',
                  padding: '14px 20px',
                  gap: '12px',
                },
                children: [
                  { type: 'span', props: { style: { fontSize: '20px' }, children: '✈️' } },
                  { type: 'span', props: { style: { fontSize: '16px', fontWeight: 700, color: palette.ink || '#102B45' }, children: 'Bagikan ke rekan atau tim investor Anda.' } },
                ],
              },
            },
            {
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
                children: `DISCLAIMER RESMI: Seluruh data bersumber dari publikasi resmi otoritas (BPS, BI, OJK, BEI). Bukan rekomendasi investasi atau nasihat hukum individual.`,
              },
            },
          ],
        },
      });
    } else if (data.cta) {
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

    return this.wrapSlide(
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '22px',
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
    const originalTokens = this.tokens;
    if (overrideTokens && typeof overrideTokens === 'object') {
      this.tokens = {
        ...this.tokens,
        ...overrideTokens,
        brand: { ...(this.tokens.brand || {}), ...(overrideTokens.brand || {}) },
        palette: { ...(this.tokens.palette || {}), ...(overrideTokens.palette || {}) },
        typography: { ...(this.tokens.typography || {}), ...(overrideTokens.typography || {}) },
      };
    }
    try {
      const vdom = this.resolveLayout(slide, slideIndex, totalSlides);
      const svg = await satori(vdom, {
        width: 1080,
        height: 1350,
        fonts: this.fonts,
      });
      return await sharp(Buffer.from(svg)).png({ quality: 95 }).toBuffer();
    } finally {
      if (overrideTokens) {
        this.tokens = originalTokens;
      }
    }
  }

  // Batch Render Carousel to Disk
  async renderCarouselToDisk(draftId, slides, outputDir) {
    const dir = path.join(outputDir, String(draftId));
    fs.mkdirSync(dir, { recursive: true });

    const totalSlides = slides.length;
    const results = [];

    for (let i = 0; i < totalSlides; i++) {
      const slide = slides[i];
      const slideNo = slide.no || i + 1;
      const startTime = Date.now();
      const pngBuffer = await this.renderSlideToBuffer(slide, slideNo, totalSlides);
      const filePath = path.join(dir, `slide_${slideNo}.png`);
      fs.writeFileSync(filePath, pngBuffer);
      const renderTimeMs = Date.now() - startTime;

      results.push({
        slide_no: slideNo,
        layout: slide.layout || 'cover-stat',
        file_path: filePath,
        render_time_ms: renderTimeMs,
      });
    }

    return results;
  }
}
