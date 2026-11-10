// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Agen Designer (Full AI Creative Director)
// File: /root/gapura/services/designer/designer.js
// Bertanggung jawab menentukan struktur visual, layout, dan hierarki per carousel
// ==============================================================================

import { callAgentLLM, loadAgentsConfig, loadAgentSkills } from '../common/llm.js';
import { buildDeterministicCarouselSlides } from '../copywriter/copywriter.js';

/**
 * AI Designer: Merancang struktur visual carousel Instagram secara dinamis berbasis AI
 * @param {object} topic
 * @param {string} captionBrief
 */
export async function designCarouselSlides(topic, captionBrief = '') {
  const cfg = loadAgentsConfig();
  const designerCfg = cfg.designer || {};
  const copyCfg = cfg.copywriter || {};

  const apiKey = designerCfg.api_key || copyCfg.api_key || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';

  if (apiKey && apiKey.trim().length > 0) {
    try {
      console.log(`[AI Designer] Merancang arsitektur visual carousel untuk #${topic.id}: "${topic.title}" via AI LLM (${designerCfg.model || 'gemini-2.0-flash'})...`);

      const prompt = `Berita yang harus dirancang:
Judul: ${topic.title}
Ringkasan Faktual: ${topic.summary || ''}
Sumber Primer: ${topic.primary_source || ''}
URL: ${topic.url || ''}
${captionBrief ? `Konteks Editorial:\n${captionBrief}` : ''}

TUGAS ANDA SEBAGAI AI CREATIVE DIRECTOR & DESIGNER:
Tentukan sendiri arsitektur visual carousel Instagram secara cerdas tanpa template kaku:
1. Tentukan jumlah slide yang paling ideal (antara 4 sampai 7 slide) agar berita tersampaikan secara utuh dan padat fakta.
2. Tentukan layout yang paling pas untuk SETIAP slide dari 7 layout kanvas berikut:
   - "cover-stat": Hook angka/persen tajam di cover (data: { value: "...", unit: "...", title: "...", category: "..." })
   - "big-statement": Kutipan besar pejabat/otoritas atau pernyataan kunci (data: { author: "...", category: "..." })
   - "stat-grid": 2-4 kotak metrik data/indikator terpisah (data: { items: [{ label: "...", value: "..." }], category: "..." })
   - "regulasi": Kotak klausul pasal POJK/UU/hukum (data: { title: "Nama Regulasi/Pasal" })
   - "comparison": Perbandingan sebelum vs sesudah atau katalis vs dampak (data: { left: { title: "...", text: "..." }, right: { title: "...", text: "..." }, category: "..." })
   - "timeline": Urutan tahapan peristiwa atau kronologi (data: { events: [{ date: "...", text: "..." }] })
   - "cta-close": Slide penutup berisi pertanyaan reflektif & CTA (data: { cta: "...", disclaimer: "..." })
3. Ekstrak data dan angka nyata langsung dari teks berita. Dilarang mengarang angka fiktif.
4. Tulis narasi teks yang mengalir dari slide ke slide (kohesif dan mudah dibaca di smartphone).

Kembalikan HANYA format JSON valid berikut tanpa markdown wrap:
{
  "slides": [
    {
      "no": 1,
      "layout": "cover-stat",
      "teks": "Judul/Hook di Cover",
      "data": {
        "value": "Angka/Statistik Besar",
        "unit": "Unit/Keterangan",
        "title": "Subjudul",
        "category": "Kategori Niche"
      },
      "source": "${topic.primary_source || '@homelessmedia'}"
    }
  ],
  "design_rationale": "Alasan singkat pemilihan arsitektur layout",
  "slide_count": 5
}`;

      const aiResponse = await callAgentLLM('designer', prompt, designerCfg.system_prompt || '', true);
      const parsed = JSON.parse(aiResponse);

      if (parsed && Array.isArray(parsed.slides) && parsed.slides.length >= 3) {
        // Normalisasi nomor slide
        parsed.slides.forEach((s, idx) => {
          s.no = idx + 1;
          if (!s.source) s.source = topic.primary_source || '@homelessmedia';
        });
        console.log(`[AI Designer] Sukses merancang ${parsed.slides.length} slide carousel adaptif via AI!`);
        return parsed.slides;
      }
    } catch (llmErr) {
      console.warn('[AI Designer] Gagal merancang via LLM, menggunakan fallback cerdas adaptif:', llmErr.message);
    }
  }

  // Fallback ke generator deterministik cerdas
  const fallback = buildDeterministicCarouselSlides(topic);
  return fallback.slides;
}
