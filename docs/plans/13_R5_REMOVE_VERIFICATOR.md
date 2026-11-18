# R5 — Lepas Verifikator dan koreksi identitas enam desk

Tanggal: 17 November 2026. Mengikuti [blueprint editorial](07_EDITORIAL_REDESIGN_BLUEPRINT.md),
[keputusan konten orisinal](10_ORIGINAL_AI_EDITORIAL.md), dan
[hasil R4](12_R4_SOURCES_DESKS.md).

**Status: R5 selesai dan gate implementasi lulus.** Web/render telah dimuat
ulang; API serta DOM layanan aktif memuat identitas enam desk. Domain publik
terverifikasi HTTP 200 setelah gangguan sementara Cloudflare Error 1033.
Timer intake/publisher tetap nonaktif dan worker background dijeda. Tidak ada
generasi raster AI provider nyata, batch produksi atau publikasi nyata.

## 1. Lingkup perubahan

Enam agen aktif yang tersisa:

| Agen | Fungsi |
| --- | --- |
| Scout | Discovery sumber, deduplikasi, desk dan metadata topik |
| Analis | Kurasi/skor editorial dari proyeksi metadata discovery |
| Copywriter | Naskah/caption pada jalur produksi; penggantian kontrak legacy menjadi orisinal dua mode tetap R6 |
| Designer | Rencana visual, brief ilustrasi dan layout |
| SEO | Discovery serta penilaian momentum isu, kemudian promosi topik |
| Studio | Prompt dan rencana editorial untuk produksi draf yang direview manusia |

R5 melepas layanan/skill/config Verifikator, pemanggilan pipeline, import dan
consumer report aktif. Produksi, Studio dan review tidak membuat atau meminta
laporan mesin. Tidak ada agen penilai kebenaran pengganti.

| Permukaan | Perubahan R5 |
| --- | --- |
| Produksi | Lepas syarat report dan query/recheck report sebelum maupun sesudah render; draf tetap untuk review manusia |
| Studio | Lepas tahap/progres `verifying`, permintaan dan ID report dari jalur job aktif |
| Web/API | Lepas halaman, badge, tombol, polling dan endpoint Verifikator; URL API lama harus 404 |
| Agen/settings | Hanya Scout, Analis, Copywriter, Designer, SEO dan Studio dapat dikonfigurasi; tab/skill/prompt Verifikator dilepas |
| Caption/desain | Lepas status mesin/confidence dan layout verifikasi dari keluaran publik serta pilihan layout aktif |
| Publisher/Telegram | Lepas pembacaan report/status/confidence; gunakan persetujuan manusia dan hash revisi konten |
| Schema/riwayat | Pertahankan tabel, kolom, enum dan report historis sebagai arsip tanpa menjadi input gate aktif |

## 2. Persetujuan manusia dan penjagaan publikasi

Penghapusan Verifikator tidak menghapus review manusia. Pada endpoint
`POST /api/drafts/:id/approve`, server mengunci draf, mencocokkan
`expected_revision` dengan hash konten terkini dan memerlukan `reviewed=true`.
Revisi stale atau konfirmasi review yang hilang ditolak. Mengubah konten
membatalkan approval/jadwal dan memerlukan review baru.

Hash dari [draft-revision.js](../../services/common/draft-revision.js) mencakup
`slides`, `caption`, `hashtags` dan `content_format`; descriptor aset di dalam
slide ikut tercakup. Perluasan hash materi untuk mode R6 belum diklaim selesai.

Publisher otomatis menggunakan bukti berikut:

1. Draf berada pada status dan mode publikasi yang sah serta
   `needs_review=false`.
2. `audit_log` mempunyai aksi manusia `approved_auto` dari aktor web/Telegram
   yang diizinkan, berlaku pada revisi terkini. `payload.content_hash` harus
   sama dengan hash isi draf sekarang; perubahan status database saja tidak
   memenuhi gate.
3. Worker Meta mencocokkan hash target dengan hash approval, jadwal yang jatuh
   tempo, akun aktif, sumber publik dan skor Analis yang memenuhi gate. Aset
   dan format harus siap.
4. Konten dan gate diperiksa ulang dalam row lock sebelum panggilan publikasi
   akhir. Hasil `unknown` atau `publishing` ambigu memerlukan rekonsiliasi
   manual, tanpa retry buta.

[Worker Meta](../../services/publisher/meta-worker.js) dan
[publisher legacy](../../services/publisher/publisher.js) sama-sama memerlukan
audit hash manusia untuk publish otomatis dan melakukan locked recheck.
Pemeriksaan R5 menemukan jalur legacy belum membandingkan hash audit approval;
celah itu diperbaiki agar audit yang hilang/salah atau revisi stale tidak cukup
untuk melanjutkan publish. Publisher legacy tetap menyerahkan pekerjaan ketika
konfigurasi Meta multi-platform aktif dan tidak dijalankan oleh pipeline intake.

Telegram mempertahankan otorisasi callback, audit hash dan gate review, tanpa report mesin.
Konfigurasi/pengaktifan bot tetap pekerjaan tersendiri; ini tidak menyatakan
notifikasi atau approval Telegram nyata telah dijalankan.

Ketentuan ini menggantikan syarat report `verified`/confidence pada runbook lama.
Keberadaan report historis tidak menjadi persetujuan manusia dan tidak memberi
izin publikasi.

## 3. Koreksi niche yang ditemukan

Niche Gapura adalah **politik, sosial, hukum, lingkungan, ekonomi nasional
termasuk bursa saham**, dengan enam desk `politik`, `sosial`, `hukum`,
`lingkungan`, `ekonomi`, dan `bursa`. Sisa identitas finance-first muncul dari
tiga sumber konkret:

- Tagline persisten pada token desain masih memakai wording lama meskipun teks
  halaman sudah menyebut enam desk.
- Kategori registry `umum` jatuh ke label Ekonomi pada UI.
- Form/API sumber baru memakai default `news_pasar` sehingga sumber lintas isu
  dapat tampak sebagai sumber pasar.

Koreksi menyelaraskan token tagline, header/footer/teks aktif,
label kategori dan default sumber. Kategori baru default **`umum` — Umum /
Lintas Isu**, terpisah dari Desk Editorial. PUT sumber yang tidak mengirim
kategori mempertahankan nilai sebelumnya; kategori kosong/invalid ditolak.
Desk yang tidak dikirim dipertahankan, sementara desk `null`/kosong memilih
inferensi otomatis. Tidak ada reklasifikasi massal atau backfill arsip.

Radar Topik mendapat filter dan badge keenam desk, sedangkan dropdown sumber
tren mencakup keenam desk serta pilihan umum. Enam query discovery per desk
ditambahkan melalui seed idempotent
`database/migrations/20261117_trending_national_desks.sql`: 12 sumber Trending
lama menjadi 18 tanpa menimpa pilihan operator. Query belum dipindai; penambahan
registry tidak menjalankan scan. Tidak ada klaim feed baru menghasilkan konten.

Disclaimer hukum/investasi hanya dipilih pada desk hukum/bursa yang relevan;
isu sosial/politik/lingkungan dan ekonomi umum tidak memperoleh boilerplate
generik. Renderer menampilkan disclaimer hanya jika teksnya disediakan secara
eksplisit. Sampel Studio menjadi enam contoh desk, tanpa angka berita buatan.
Route `#view-verifications` yang sudah tidak berlaku kembali ke Overview.

## 4. Data dan keadaan operasional yang dipertahankan

- `verification_reports`, `topics.verification_status`,
  `prompt_jobs.verification_id`, enum lama dan audit historis dipertahankan.
  Tidak ada schema removal, migrasi DROP, rewrite report, purge atau backfill.
  Referensi pada schema/migrasi/fixture arsip adalah sejarah, bukan consumer
  keputusan runtime.
- Rencana R1–R4, migrasi historis dan hasil pengujian tahap sebelumnya tetap
  dicatat sesuai waktunya. Koreksi status aktif berada pada README, panduan,
  status/roadmap, blueprint dan laporan ini.
- Timer intake `gapura-pipeline.timer` dan publisher `gapura-publisher.timer`
  tetap `disabled/inactive`; worker background tetap
  `GAPURA_DISABLE_WORKERS=true`. n8n adalah canvas/fallback manual.
- Publisher tetap mode `shadow`. Tidak ada publish nyata, aktivasi timer atau
  batch produksi dalam penyelesaian R5.
- Kredensial/koneksi Meta dan provider tidak dibuka ke dokumen atau browser.
  Tidak ada perubahan billing/key/provider gambar.
- Raster AI nyata tetap tertahan **429/Free Tier quota 0**. Tidak ada
  permintaan gambar tambahan atau perpindahan provider untuk melewati kendala
  tersebut. Fixture raster tidak dinyatakan sebagai hasil model nyata.

Backup sebelum seed berada di
`/root/gapura-backups/r5-trending-sources-20261117T221335+0700`:
dump custom PostgreSQL, checksum, fingerprint before/after dan bukti restore
scratch. Restore menghasilkan tepat 12 sumber lama, semuanya aktif, bobot total
184. Sesudah seed, 22 tabel lain identik, seluruh 12 baris Trending lama identik,
dan tepat enam baris baru ditambahkan. Eksekusi migrasi kedua memasukkan nol
baris. `topics` tetap 1.181, `verification_reports` 125, `drafts` nol.

## 5. Validasi dan bukti

Pengujian terarah publisher/Telegram **63 lulus** setelah koreksi audit hash
legacy. Hasil akhir lintas modul berikut mencakup tes yang saling beririsan;
angkanya tidak dijumlahkan sebagai total tes unik.

| Gate akhir R5 | Hasil final | Bukti/log final |
| --- | --- | --- |
| Unit penuh tanpa harness `server-*` | **606 lulus, 0 gagal, 1 skip** | `gapura-r5-unit-final.log`; Chromium yang skip dijalankan terpisah |
| DB/API PostgreSQL terisolasi | **56 lulus, 0 gagal** | `gapura-r5-api-final.log`; termasuk produksi dan regenerasi tanpa report |
| Akses/Origin/signature | **10 lulus, 0 gagal** | `gapura-r5-access-final.log` |
| Chromium desktop/mobile dengan API fixture | **1 lulus, 0 gagal** | `gapura-r5-browser-final2.log`; tagline, enam desk, sumber, review hash, Back |
| Renderer dan koreksi disclaimer | **84 lulus, 0 gagal** | `npm test` di `services/render`; enam desk, PNG/JPEG, disclosure AI |
| DOM layanan aktif | **Lulus** | `gapura-r5-live.log`; preview nyata 1080×1350, enam agen/desk, 18 sumber, mobile tanpa overflow, tanpa page error |
| Consumer Verifikator aktif | **Lulus** | Pencarian source runtime tanpa test/node_modules: nol consumer; endpoint lama 404 |
| Sintaks dan whitespace | **Lulus** | `node --check`, `bash -n`, `git diff --check` |
| Preservation dan backup | **Lulus** | 22 tabel dan 12 sumber Trending lama identik; restore scratch lulus |

Log disalin ke direktori `validation/` pada backup R5 di atas. Screenshot DOM
layanan aktif tersimpan di direktori `evidence/` pada backup yang sama. Ini
membuktikan render/alur teknis, bukan penerimaan style owner R7. API publik
`/`, `/api/tokens`, `/api/agents/config`, `/api/trend-sources`, dan `/api/workflow`
teramati HTTP 200 melalui curl; endpoint Verifikator lama HTTP 404. Salah satu
client Python sempat mendapat 403 edge, dan domain sempat 503/1033 ketika tunnel
belum aktif; hasil tersebut tidak dianggap kegagalan atau kelulusan Origin app.

Smoke DOM layanan aktif memakai origin publik dengan transport langsung ke
web lokal agar validasi Origin deployment tetap berlaku. Membuka layanan dengan
origin localhost membuat POST preview ditolak 403 sesuai kebijakan; validasi
tersebut tidak dilonggarkan untuk pengujian.

## 6. Batas dan langkah berikutnya

**R6 belum diterapkan.** Proyeksi discovery R4 untuk Analis/cluster tidak
menyatakan seluruh prompt Copywriter/Designer/Studio sudah bebas body/summary
penerbit. Jalur naskah legacy masih memerlukan penggantian validator verbatim
dan fallback salin sumber.

R6 harus menerapkan dua mode orisinal: penjelasan isu umum dari judul dengan
batas klaim, serta pembahasan aktual yang mempunyai catatan fakta/referensi.
Default enam slide carousel-first, rentang 3–9 yang bermakna dan caption isi
1.200–1.900 karakter juga belum diklaim aktif. Angka, kutipan dan detail aktual
tidak boleh dikarang untuk memenuhi panjang.

Urutan berikutnya: implementasikan R6 → review
sampel nyata enam desk pada R7 → batch/shadow R8 → satu uji publish dengan
persetujuan terpisah. Aktivasi otomatisasi tetap memerlukan mandat eksplisit
owner; unit test hijau tidak mengaktifkan timer. Quota gambar 0 tetap penghalang
sampel generatif nyata dan penerimaan visual owner.

---

## 7. Pembaruan setelah R5 (18 November 2026)

Bagian 6 di atas adalah keadaan saat R5 ditutup. R6 kemudian selesai dan
dimigrasikan ke produksi; lihat
[laporan R6](14_R6_ORIGINAL_EDITORIAL.md). Dua mode naskah orisinal
(`explainer`/`current`), input tanpa body/summary/foto penerbit, carousel 3–9
default enam, caption isi 1.200–1.900 karakter dan Threads ≤500 sudah
terpasang. R5 tetap tidak mengklaim raster AI nyata, sampel visual R7 atau
publish R8; timer dan worker masih dijeda.
