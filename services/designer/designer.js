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

      const prompt = `Berita yang harus Anda rancang visualnya:
Judul: ${topic.title}
Ringkasan Faktual: ${topic.summary || ''}
Sumber Primer: ${topic.primary_source || ''}
URL: ${topic.url || ''}
${captionBrief ? `Konteks Editorial:\n${captionBrief}` : ''}

TUGAS ANDA SEBAGAI AI CREATIVE DIRECTOR & VISUAL ARCHITECT:
Anda memiliki KEBEBASAN PENUH (FULL AUTONOMY). JANGAN KAKU DENGAN TEMPLATE TERTENTU:
1. Tentukan sendiri jumlah slide yang paling ideal (4 hingga 9 slide) agar cerita tersampaikan secara utuh, berbobot, dan tidak terpotong.
   ATURAN UTUH: dilarang memotong teks dengan "...". Jika satu slide tidak cukup, pecah menjadi beberapa slide lanjutan.
2. ATURAN COVER (SLIDE 1) — WAJIB DIPATUHI:
   - Slide 1 adalah cover murni: HANYA berisi judul berita utama (dan boleh satu angka utama yang benar-benar ada di berita).
   - DILARANG menaruh di slide 1: tag/kategori, nomor halaman, nama sumber, ajakan swipe, bullet, disclaimer, subtitle promosi, atau keterangan tambahan apa pun.
   - Judul cover maksimal ~150 karakter; tulis sebagai headline, bukan paragraf.
3. Rancang struktur visual setiap slide isi (mulai slide 2) secara bebas dan dinamis sesuai kebutuhan esensi berita:
   - Anda bebas menamai layout atau merancang komposisi bebas (misal: "cover-editorial", "stat-spotlight", "dual-perspective", "deep-analysis", "regulatory-focus", "takeaway-points", "market-snapshot", atau nama deskriptif lainnya).
   - Anda bebas menyusun elemen visual di dalam objek "data":
     * Hero angka/stat: "value", "unit", "title", "subtitle"
     * Kotak/Kartu metrik: "items": [{ "label": "...", "value": "..." }]
     * Perbandingan dua sisi: "left": { "title": "...", "text": "..." }, "right": { "title": "...", "text": "..." }
     * Kutipan pejabat/otoritas: "quote": "...", "author": "..."
     * Poin-poin/list takeaways: "bullets": ["...", "..."]
     * Klausul hukum/catatan penting: "callout": "..." atau "regulasi": "..."
     * Ajakan diskusi / CTA: "cta": "..."
     * Verifikasi fakta: "status": "verified|mostly_verified|needs_context|unverified|opinion|speculation|misleading|hoax_detected", "claim": "...", "explanation": "...", "misconception": "...", "sources": ["..."]
   - WAJIB akhiri carousel dengan satu slide penutup ber-layout "cta-close" berisi pertanyaan diskusi + CTA + disclaimer.
4. Ekstrak data nyata, angka akurat, dan fakta langsung dari teks berita. Dilarang mengarang fakta fiktif.
5. Tulis narasi teks (prosa editorial berbobot) yang mengalir dari slide ke slide. Setiap slide isi maksimal ~300 karakter teks narasi; jika lebih, pecah menjadi slide berikutnya.

Kembalikan HANYA format JSON valid berikut tanpa markdown wrap:
{
  "slides": [
    {
      "no": 1,
      "layout": "nama-layout-bebas-pilihan-ai",
      "teks": "Teks narasi atau headline utama slide",
      "data": {
        "title": "Untuk slide 1: judul berita utama saja. Untuk slide isi: sub-topik slide.",
        "subtitle": "Keterangan ringkas (hanya untuk slide isi, tidak untuk cover)",
        "category": "Kategori Niche (hanya untuk slide isi)"
      },
      "source": "${topic.primary_source || '@gapuramedia'}"
    }
  ],
  "design_rationale": "Alasan pertimbangan visual AI mengapa memilih komposisi slide dan layout ini",
  "slide_count": 5
}`;

      const aiResponse = await callAgentLLM('designer', prompt, designerCfg.system_prompt || '', true);
      const parsed = JSON.parse(aiResponse);

      if (parsed && Array.isArray(parsed.slides) && parsed.slides.length >= 3) {
        // Normalisasi nomor slide
        parsed.slides.forEach((s, idx) => {
          s.no = idx + 1;
          if (!s.source) s.source = topic.primary_source || '@gapuramedia';
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
