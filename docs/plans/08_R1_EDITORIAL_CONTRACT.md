# R1 — Kontrak editorial dan corpus penerimaan

Tanggal: 17 November 2026 · Lingkup: kontrak dan fixture offline.
Turunan dari [blueprint redesign](07_EDITORIAL_REDESIGN_BLUEPRINT.md).

**Perubahan arah owner setelah R1:** [konten orisinal dan ilustrasi
AI](10_ORIGINAL_AI_EDITORIAL.md) menjadi spesifikasi aktif untuk R3–R8. Kontrak
di bawah merekam implementasi R1 yang sudah diuji: kewajiban foto/URL sumber
dan paragraf sumber belum mendukung jalur judul saja/visual generatif baru.
Kontrak executable beserta fixture harus direvisi dengan TDD sebelum digunakan
pada sampel baru. Tidak menyatakan perubahan runtime telah dilakukan.

## Hasil dan batas tahap

R1 menetapkan bentuk input/output yang akan dipakai tahap selanjutnya. Modul
baru [editorial-contract.js](../../services/common/editorial-contract.js) belum
dipanggil oleh Scout, Studio, Designer, Copywriter, atau publisher produksi.
Penambahan kontrak ini tidak mengubah skor, prompt aktif, database, galeri,
konfigurasi provider, kredensial Meta, ataupun mode publisher.

Enam desk, default enam slide, rentang 3–9, serta sasaran caption 1.200–1.900
karakter dipakai sebagai keputusan implementasi sementara dari blueprint.
Penerimaan visual/tone oleh owner tetap dilakukan pada R7; kelulusan R1 tidak
berarti desain atau berita aktual sudah disetujui.

## 1. Satu kamus kategori

Key canonical: `politik`, `sosial`, `hukum`, `lingkungan`, `ekonomi`, `bursa`.
`normalizeCategory()` menerima key dan alias label yang dikenal, misalnya
`politik nasional`, `masyarakat`, `lingkungan hidup`, `pasar modal`. Fungsi ini
bukan classifier berita berbasis keyword. Label tidak dikenal/ambigu mendapat
`null`, bukan ditebak dari substring. `nasional` sendiri menunjukkan cakupan
geografis dan tidak dipetakan otomatis menjadi politik.

## 2. Headline publik terpisah dari jejak discovery

`normalizeHeadline(raw, { publisher, publisherAliases })` menghapus prefix
transport yang dikenali (`[X]`, `[X/RSSHub]`, Google News X fallback) dan suffix
penerbit yang cocok **persis** dengan metadata/alias eksplisit. Judul asli tidak
boleh dihapus dari penyimpanan. Nama media dalam isi judul, dash bermakna, kata
dugaan/negasi, dan bagian yang tidak cocok tidak dihapus sembarang.

Contoh:

```text
[Google News: X query fallback] DPR Membahas RUU Perlindungan Data - CNN Indonesia
→ DPR Membahas RUU Perlindungan Data
```

Contoh memakai nama lembaga/media hanya untuk menguji normalizer, bukan berita
yang telah diambil. Corpus cerita lengkap memakai penerbit/aktor fiktif.

## 3. Kontrak materi dan referensi

```js
{
  version: 1,
  paragraphs: [{
    id: 'p1',                    // unik dalam satu snapshot materi
    text: 'Isi materi...',
    source_url: 'https://example.org/artikel',
    role: 'reporting'            // reporting | document | official_statement
  }]
}
```

`materialSufficiency()` memerlukan versi yang dikenal, ID yang valid/unik,
URL sumber HTTPS publik tanpa userinfo, dan minimal tiga unit teks yang berbeda
setelah normalisasi whitespace/case/punctuation. Menggandakan kalimat lewat tiga
URL tidak menambah kontribusi. Tiga paragraf boleh berasal dari **satu sumber**;
tidak ada syarat universal dua sumber, full article, report, confidence, atau
konfirmasi resmi.

Hitungan ini adalah pemeriksaan struktur minimum. Tiga paragraf yang berbeda
belum membuktikan tiga fakta independen atau kebenaran semantik. Redaktur tetap
menilai kedalaman, konteks, kelengkapan, dan akurasi parafrasa. R2 akan memasok
materi artikel; R6 menghubungkan referensi ini ke proses menulis.

## 4. Foto, credit, dan hak penggunaan

```js
{
  id: 'asset-id',
  url: 'https://media.example.org/foto.png',
  source_url: 'https://example.org/artikel',
  credit: 'Pemilik / fotografer',
  rights_basis: 'owned',        // owned | licensed | official_reuse | editor_approved
  rights_reference: 'Catatan/dokumen izin',
  rights_approved_by: 'Redaktur yang mencatat dasar izin',
  rights_approved_at: '2026-11-17T00:00:00Z',
  status: 'downloaded',
  mime: 'image/png',            // PNG | JPEG | WebP
  width: 360,
  height: 450,
  local_path: 'media/asset.png',
  sha256: '64 karakter heksadesimal dari bytes gambar'
}
```

`editor_approved` adalah pencatatan dasar izin oleh redaktur, bukan hak baru
yang otomatis tercipta saat checkbox dicentang. `owned`, `licensed`, dan
`official_reuse` juga wajib mempunyai referensi, credit, pencatat dan tanggal.
URL publik bukan bukti lisensi. Cover tanpa foto boleh dipratinjau/diedit pada
tahap pengembangan, tetapi belum lulus kontrak produk berita siap unggah.

Validator R1 memeriksa metadata dan identitas lokal: ID, path tanpa traversal,
checksum bukan placeholder, MIME raster, dimensi minimal 320×240. Ia **tidak
membaca file atau mengunduh URL** dan tidak mengklaim memeriksa hak/relevansi
foto secara otomatis. R3 harus membandingkan bytes, MIME, dimensi dan checksum
setelah download serta menerapkan kebijakan host/DNS/redirect/batas ukuran.

Raster fixture R1 adalah bidang warna 360×450 yang disimpan base64. Pengujian
terpisah benar-benar mendekode bytes, memeriksa checksum/dimensi, memasukkan
gambar ke validator render, dan memastikan pikselnya hadir pada cover. Ini
bukan foto peristiwa dan tidak membuktikan foto live sudah siap.

## 5. Kontrak carousel berita

- `format='carousel'`, 3–9 slide bernomor berturut-turut, default enam.
- Slide pertama `role='cover'`, layout `cover-focus`, asset ID cocok dengan
  cover terpilih; asset ID dalam daftar tidak boleh ambigu.
- Isi slide tidak kosong/duplikat, headline maksimal 120 karakter dan body
  maksimal 300. Referensi `evidence_ids` tidak kosong dan menunjuk paragraf yang
  tersedia.
- Role: cover, lead, explanation, official_statement, chronology, data,
  public_impact, close. Close tidak berarti harus CTA/disclaimer.
- Layout R1 mengikuti subset renderer yang dikenal; data chart/stat/timeline/
  comparison yang hilang ditolak agar default fakta demonstrasi tidak terpakai.
- Nilai stat berupa string berisi atau angka finite, bukan objek/boolean.
  Layout `regulasi` memerlukan `data.title` eksplisit dan menggunakan `teks`
  sebagai isi aturan, sesuai kontrak renderer.
- Quote harus persis di dalam tanda kutip sumber dan speaker berada pada
  paragraf rujukan yang sama. Ini pemeriksaan literal atribusi, bukan keputusan
  LLM tentang kebenaran.
- Timeline memakai tanggal ISO valid/berurutan dan referensi per event.
  Kecocokan makna tanggal/peristiwa tetap harus ditinjau redaktur.
- `caption_evidence_ids` memetakan referensi caption ke snapshot materi.
- Penanda teknis/Verifikator tidak boleh masuk teks slide/caption atau field
  layout yang berisi teks publik.

Kontrak ini belum merupakan pengganti semua batas layout di renderer. Preview
single tetap dapat dipakai renderer lama; R6 menerapkan kontrak berita secara
terpadu pada produksi/editor/export. Ketepatan angka, satuan, periode dan
parafrasa kompleks membutuhkan pemeriksaan tambahan pada R6 serta review.

## 6. Caption body dan assembler tunggal

Simpan `caption` sebagai **body tanpa hashtags**; tags disimpan pada `hashtags`.
`assemblePublicCaption()` menggabungkannya satu kali, menolak tag yang tidak
valid, dan menghapus duplikat tag tanpa membedakan huruf besar/kecil.

```js
assemblePublicCaption('Isi berita lengkap.', ['#GapuraMedia', '#Politik']);
// Isi berita lengkap.\n\n#GapuraMedia #Politik
```

Target 1.200–1.900 karakter isi berlaku ketika materi mendukung. Bukan minimum
mutlak dan tidak memerintahkan filler. Batas akhir Instagram 2.200 termasuk
tagar; batas varian Threads 500 tanpa truncation otomatis. Versi Facebook R1
memakai batas konservatif 2.200 yang sama untuk parity pengujian; dukungan
caption Facebook lebih panjang dapat ditetapkan pada tahap varian platform.

Body dilarang berisi label fallback, `Sumber primer:`, `Status verifikasi:`,
`Belum terverifikasi otomatis`, atau instruksi internal menunggu konfirmasi
redaksi. Atribusi natural yang menjelaskan berita tetap diperbolehkan. API
key/provenance internal tidak termasuk caption publik.

## 7. Corpus enam desk

[editorial-stories.json](../../services/common/test/fixtures/editorial-stories.json)
memuat enam cerita **sintetis**. Semua peristiwa, nama, angka, dan tanggal dibuat
untuk uji; host `example.org` tidak diakses. Tidak ada cerita yang dimasukkan ke
database/galeri atau dikirim ke model/platform.

| Desk | Contoh fixture | Struktur | Paragraf / slide | Caption body |
| --- | --- | --- | ---: | ---: |
| Politik | Uji Piagam Layanan Terbuka | Statement beratribusi | 6 / 6 | 1.642 karakter |
| Sosial | Rute Klinik Keliling | Penjelasan layanan dan statement | 6 / 6 | 1.658 |
| Hukum | Jeda proses penataan pasar | Statement dan status proses | 6 / 6 | 1.544 |
| Lingkungan | Catatan perubahan muka air | Kronologi ISO berurutan | 6 / 6 | 1.572 |
| Ekonomi | Catatan keranjang pangan | Penjelasan data dan batas interpretasi | 6 / 6 | 1.704 |
| Bursa | Keterbukaan program emiten fiktif | Statement, jadwal dan pembiayaan | 6 / 6 | 1.730 |

Source ID, penerbit, raw title, timestamp, source URL, materi, slide, caption,
tags dan cover tercatat untuk tiap fixture. Corpus ini belum merupakan katalog
feed aktual; validasi adapter/query sumber nyata adalah R2/R4. Foto nyata dan
penilaian visual owner tetap R3/R7.

## 8. Acceptance dan cara uji

```bash
node --test services/common/test/editorial-contract.test.js \
  services/render/test/editorial-contract-fixtures.test.js
```

Tes meliputi enam desk, headline idempotent/penerbit exact, alias ambigu,
material ID/URL/duplikat, media rights/local identity, carousel count/sequence/
foto/evidence, quote/timeline, caption/tag assembly, JSON malformed, boilerplate
tersembunyi, serta decode raster dan render in-memory. Kasus negatif ditulis
dan dijalankan merah sebelum perubahan validator.

Hasil pemeriksaan 17 November 2026:

| Pemeriksaan | Hasil |
| --- | ---: |
| Kontrak R1 dan raster/render fixture | 24 lulus, 0 gagal |
| Seluruh unit aplikasi | 380 lulus, 0 gagal, 1 Chromium skip |
| Chromium yang dijalankan terpisah | 1 lulus |
| Database/API pada database terisolasi | 30 lulus |
| Tautan lokal README/roadmap/blueprint/kontrak R1 | 49 target valid |

Review independen menemukan dan mengoreksi input JSON yang dapat melempar
exception, nilai stat non-scalar, default judul regulasi, hashtag dalam tanda
kurung, suffix penerbit berulang, serta detail caption fixture yang tidak ada
di materi. Regresi tersebut disimpan sebagai tes; kontrak tidak diklaim mampu
menemukan seluruh kesalahan semantik secara otomatis.

Pemeriksaan read-only produksi menunjukkan `/api/drafts` dan
`/api/studio/jobs` tetap kosong, kedua timer `disabled/inactive`, dan akun
`@gapuramedia` tetap `connected=true`. Tidak ada restart/deploy, perubahan
data, panggilan model, atau publikasi yang diperlukan untuk menjalankan R1.

R1 selesai pada kontrak yang dapat dieksekusi dan corpus sintetis. Reader/snapshot
materi R2 dilanjutkan dalam [hasil R2](09_R2_ARTICLE_MATERIALS.md). Tahap lanjutan:
pemilihan/download foto live (R3), sumber/Analis (R4),
penghapusan Verifikator runtime (R5), wiring produksi (R6), penerimaan visual
owner (R7), dan batch/shadow/publish uji terkontrol (R8).

Timer intake/publisher tetap disabled dan worker Studio background tetap
dijeda. Materi R2 memisahkan body lengkap dari summary pendek, timestamp,
URL artikel, dan metadata discovery; foto siap pakai diselesaikan R3.
