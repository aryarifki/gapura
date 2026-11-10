// ==============================================================================
// Homeless Media Engine (HME) v2.0 - AI Design Director (Anti-Slop Guardrail)
// File: /root/gapura/services/designer/ai_director.js
// PRD Bab 7.3: Proposal terbatas perubahan tokens.yaml berbasis arahan teks
// ==============================================================================

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TOKENS_PATH = path.resolve(__dirname, '../../design-system/tokens.yaml');
const RENDER_SERVICE_URL = 'http://127.0.0.1:3000';
const RENDER_SECRET = process.env.RENDER_SECRET || 'dev_render_secret_hme';

/**
 * AI Design Director: Menerima arahan admin dan mengusulkan variasi tokens.yaml
 * yang terkunci dalam aturan anti-slop (hanya warna palet & aksen, tanpa merusak layout).
 */
export async function proposeDesignTokens(adminDirection = 'Nuansa lebih kontras dan tegas untuk tema makro ekonomi') {
  console.log(`[AI Design Director] Memproses arahan: "${adminDirection}"...`);

  const currentYaml = fs.readFileSync(TOKENS_PATH, 'utf8');
  let proposedYaml = currentYaml;

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10) {
    try {
      const prompt = `Anda adalah AI Design Director untuk @homelessmedia (media editorial data pasar saham & hukum).
Aturan Anti-Slop ketat:
1. Warna latar (bg) harus terang seperti kertas koran/financial times (#f7f5f0, #faf8f5, dsb).
2. Teks (ink) harus gelap pekat (#14202e, #0f172a, dsb).
3. Aksen (accent) harus warna berwibawa (navy, sapphire, slate, deep bronze).
4. Pasar naik (up) hijau terkendali (#1a7a4f), pasar turun (down) merah bata (#b23a48).
5. Font tetap: display "Archivo Black", text "Inter".
6. DILARANG menambah gradient ungu, stiker, 3D, atau efek dekoratif slop.

Arahan Admin: "${adminDirection}"

Tokens Saat Ini (YAML):
\`\`\`yaml
${currentYaml}
\`\`\`

Berikan HANYA berkas tokens.yaml baru yang valid sesuai arahan di atas tanpa penjelasan lain.`;

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = rawText.replace(/```yaml\n?/g, '').replace(/```\n?/g, '').trim();
        // Validasi apakah YAML valid
        yaml.load(cleaned);
        proposedYaml = cleaned;
        console.log('[AI Design Director] Proposal tokens baru berhasil digenerate via Gemini API.');
      }
    } catch (err) {
      console.warn('[AI Design Director] Gagal panggil Gemini API, menggunakan variasi preset:', err.message);
    }
  }

  // Generate preview slide contoh menggunakan /render/preview
  const parsedTokens = yaml.load(proposedYaml);
  const testSlide = {
    layout: 'cover-stat',
    text: 'Inflasi Tahunan Terjaga di 2,12%',
    data: {
      value: '2,12%',
      unit: 'YoY (BPS)',
      title: 'Inflasi Tahunan Terjaga di 2,12%',
      category: 'DATA EKONOMI',
    },
    source: 'BPS',
  };

  let previewPngBase64 = null;
  try {
    const previewRes = await fetch(`${RENDER_SERVICE_URL}/render/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Render-Secret': RENDER_SECRET,
      },
      body: JSON.stringify({
        slide: testSlide,
        tokens_override: parsedTokens,
      }),
    });
    if (previewRes.ok) {
      const buffer = await previewRes.arrayBuffer();
      previewPngBase64 = Buffer.from(buffer).toString('base64');
      console.log('[AI Design Director] Preview gambar berhasil dirender dari Render Service.');
    }
  } catch (renderErr) {
    console.error('[AI Design Director] Render preview error:', renderErr.message);
  }

  return {
    proposedYaml,
    parsedTokens,
    previewPngBase64,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  proposeDesignTokens().then((res) => {
    console.log('[AI Design Director] Selesai. Hasil proposal siap direview.');
  });
}
