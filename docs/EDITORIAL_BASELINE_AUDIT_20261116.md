# Baseline reproduksi editorial — 16 November 2026

Pemeriksaan menggunakan kode pada commit `58c11c5` sebagai baseline runtime
sebelum perubahan desain baru. Data berikut adalah **fixture sintetis**, bukan
berita aktual, hasil pengambilan artikel, atau pengukuran feed live. Tidak ada
panggilan model/API/database produksi pada reproduksi ini.

## Hasil teramati

```json
{
  "fixture_only": true,
  "normalized_feed_length": 17,
  "normalized_feed_content": "Ringkasan pendek.",
  "available_rich_body_length": 2640,
  "requested_format": "carousel",
  "actual_format": "single",
  "slide_count": 1,
  "output_headline": "[Google News: X query fallback] Lembaga menerbitkan aturan baru - CNN Indonesia",
  "cover_keeps_existing_image": false,
  "public_caption_has_source_boilerplate": true,
  "paraphrase_accepted": false,
  "trend_score_format": "single",
  "trendScore_format": "carousel"
}
```

Implikasi: bahan pendek dipilih lebih dulu daripada full-content feed; fallback
menurunkan format dan tidak membawa foto walau URL lolos kebijakan host;
pembersihan title dan cara validasi penulisan harus diubah bersama. Hitungan ini
tidak membuktikan keandalan download foto, relevansi fotonya, atau hak pakai.
Perbedaan `trend_score` dan `trendScore` juga mereproduksi kontrak data yang
tidak konsisten.

## Reproduksi mandiri

Jalankan dari root repository pada baseline di atas. Setelah implementasi baru,
hasil yang berbeda memang diharapkan; simpan fixture ini sebagai pembanding,
bukan tes penerimaan perilaku lama.

```bash
node --input-type=module <<'JS'
import { normalizeFeedItem } from './services/scout/sources.js';
import { buildEvidenceBasedContent, groundedCaptionBody } from './services/copywriter/editorial.js';
import { chooseFormat } from './services/common/carousel.js';

const richBody = 'Paragraf lengkap dari sumber sintetis yang seharusnya tersedia untuk penjelasan berita. '.repeat(30);
const feed = normalizeFeedItem({
  title: 'Judul fixture', link: 'https://example.org/berita',
  description: 'Ringkasan pendek.', 'content:encoded': richBody,
});
const topic = {
  title: '[Google News: X query fallback] Lembaga menerbitkan aturan baru - CNN Indonesia',
  summary: 'Aturan mulai berlaku pada Senin.',
  primary_source: 'CNN Indonesia', url: 'https://example.org/berita',
  image_url: 'https://img.antaranews.com/fixture.jpg', format: 'carousel',
};
const content = buildEvidenceBasedContent(topic, 'carousel');
console.log({
  normalized_feed_length: feed.content.length,
  available_rich_body_length: richBody.length,
  requested_format: 'carousel', actual_format: content.format,
  slide_count: content.slides.length,
  output_headline: content.slides[0].teks,
  cover_keeps_existing_image: Boolean(content.slides[0].data.image_url),
  public_caption_has_source_boilerplate: content.caption.includes('Sumber primer:'),
  paraphrase_accepted: groundedCaptionBody(
    'Pada Oktober, inflasi tahunan tercatat 2,1%.',
    { title: 'Inflasi Oktober', summary: 'Inflasi tahunan Oktober tercatat 2,1%.' },
  ),
  trend_score_format: chooseFormat({ title: 'Pembaruan singkat', summary: 'Informasi baru.', trend_score: 95 }),
  trendScore_format: chooseFormat({ title: 'Pembaruan singkat', summary: 'Informasi baru.', trendScore: 95 }),
});
JS
```

## Tes baseline yang dijalankan

```bash
node --test \
  services/common/test/carousel.test.js \
  services/common/test/images.test.js \
  services/copywriter/test/editorial-content.test.js \
  services/scout/test/sources.test.js
```

Hasil: **30 passed, 0 failed, 0 skipped**. Tes ini mengonfirmasi perilaku lama
dan memberi batas regresi yang perlu ditinjau. Beberapa ekspektasinya sengaja
mengizinkan single atau caption metadata lama; tes tersebut akan diperbarui
melalui TDD ketika blueprint diterapkan.

Inventaris produksi, pembersihan, dan restore backup dilaporkan terpisah dalam
[laporan reset](EDITORIAL_WORKSPACE_RESET_20261116.md). Rencana output baru dan
matriks penerimaan terdapat di [blueprint](plans/07_EDITORIAL_REDESIGN_BLUEPRINT.md).
