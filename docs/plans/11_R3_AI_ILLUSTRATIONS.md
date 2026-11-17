# R3 — Ilustrasi AI, aset lokal dan disclosure

Tanggal: 17 November 2026. Mengikuti [keputusan konten
orisinal](10_ORIGINAL_AI_EDITORIAL.md) dan [blueprint](07_EDITORIAL_REDESIGN_BLUEPRINT.md).

**Status:** implementasi, migrasi dan API terpasang; pengujian terisolasi tersedia. Generasi provider
nyata **tertahan kuota**; belum ada ilustrasi nyata hasil provider yang berhasil
dibuat. Kelulusan fixture tidak dinyatakan sebagai penerimaan visual R7.

## 1. Lingkup dan batas

R3 mengganti jalur foto sumber yang direncanakan sebelumnya dengan ilustrasi AI
orisinal. Agen Designer memiliki konfigurasi gambar terpisah dari model chat,
dan memakai prompt editorial konseptual berdasarkan judul topik. Body, summary,
HTML dan URL foto penerbit tidak masuk permintaan generator gambar.

Tahap ini belum mengganti prompt/validator naskah verbatim atau menghapus
Verifikator runtime. Proyeksi judul saja bagi seluruh agen/naskah orisinal
tetap pekerjaan R4–R6. Jalur lama yang belum diubah tidak diklaim sudah memenuhi
produk orisinal end-to-end. Reader/snapshot R2 tetap terpisah.

Produksi draf baru ketika fitur gambar aktif memerlukan ilustrasi yang siap.
Gagal/missing image menahan produksi dengan `needs_media`, bukan draf sukses
tanpa cover. Mematikan opsi generasi mempertahankan kompatibilitas fitur lama;
bukan bukti bahwa jalur teks lama sudah memenuhi spesifikasi orisinal.

## 2. Adapter gambar

[illustrations.js](../../services/designer/illustrations.js) memakai REST Gemini
Developer API `models/{model}:generateContent` dengan `responseModalities: ["IMAGE"]`
dan rasio gambar `4:3`. Default yang dicatat pada pengaturan adalah
`gemini-3.1-flash-lite-image`, dengan timeout 90 detik (batas konfigurasi
1–120 detik). Tidak memasang SDK/dependensi baru.

Referensi resmi yang diambil langsung karena MCP Developer Knowledge memberi
403 dan credential REST tidak tersedia pada environment sesi:

- [Panduan image generation](https://ai.google.dev/gemini-api/docs/image-generation).
- [GenerateContent REST request](https://aistudio.google.com/api-reference/generate-content/generate-content).
- [Content/inlineData dan finishReason](https://ai.google.dev/api/generate-content).
- [Ketentuan Gemini API](https://ai.google.dev/gemini-api/terms).

Adapter menerima provider Gemini native yang aktif dan origin resmi
`generativelanguage.googleapis.com`. Key diambil dari secret store/environment
provider atau key Designer bila provider-nya sama. Key model chat provider lain
tidak dikirim ke Gemini. HTTP lokal hanya tersedia pada fixture `NODE_ENV=test`.
Tidak ada redirect endpoint atau fallback ke foto sumber.

Input hanya teks judul/desk. Prompt mengarahkan ilustrasi konseptual/stilisasi,
palet Gapura, tanpa tulisan/data/quote, wajah tokoh nyata atau reka foto
dokumentasi kejadian. Tidak mengaktifkan pencarian gambar atau mengirim foto
sebagai reference input. Ini arahan prompt, bukan jaminan otomatis bahwa setiap
hasil model patut diterbitkan; hasil tetap perlu review.

Respons dibatasi 6 MiB JSON, satu gambar inline raster maksimal 4 MiB,
base64 canonical dan hasil `STOP`. Safety block, output thought saja, teks saja,
MIME lain, output terpotong, respons malformed, 401/429/timeouts menghasilkan
error eksplisit yang tidak menyalin raw upstream/key ke API/log aplikasi.

## 3. Aset dan permintaan idempotent

[Migrasi additive](../../database/migrations/20261117_ai_illustrations.sql)
menambahkan `media_assets` dan `illustration_requests`; tabel historis tidak
ditulis ulang. Status aset `generating`, `ready`, `failed` terpisah dari enum
status draf/topik yang sudah ada.

Catatan aset menyimpan UUID, topic ID, provider/model/version, prompt, generation
ID bila tersedia, waktu, dasar penggunaan provider, credit Gapura, disclosure
version, path lokal, MIME/dimensi/byte size dan SHA-256. `rights_basis=ai_generated`
merekam asal generasi, bukan janji hak eksklusif. Tidak memerlukan URL foto
sumber fiktif agar validator menerima aset baru.

File berada di `storage/media/<asset-uuid>.<png|jpg|webp>`, di luar folder render
draf. Nama aset immutable dipasang atomik dan gagal bila sudah ada. Bytes asli
disimpan utuh, termasuk provenance/watermark yang mungkin ditambahkan provider.
Sharp memeriksa decode sebenarnya, satu frame, tipe raster sesuai MIME, batas
320×240 sampai 4096×4096 dan batas pixel; data SVG atau gambar rusak ditolak.
Pembacaan memeriksa path, symlink dan checksum sebelum hydration.

[illustration-store.js](../../services/designer/illustration-store.js) memegang
session advisory lock per topik selama request berbayar. Request serentak
ditolak `illustration_busy`; lock dilepas saat selesai/koneksi berakhir.
Request ID dipetakan ke asset ID untuk **setiap** permintaan, termasuk ketika
menggunakan kembali pilihan yang sudah ada. Mengulang request yang sama setelah
pilihan topik berubah tetap mengembalikan aset semula.

Generasi ulang membuat ID baru. Pilihan sebelumnya baru diganti setelah raster
baru valid dan catatannya berstatus ready; kegagalan tidak menghapus pilihan
yang berhasil. Proses terputus ditandai failed/interrupted pada request berikut
yang berhasil memegang lock; tidak dicoba ulang otomatis dengan biaya baru.

Versi lama dipertahankan untuk draf/audit. Script
[audit_illustration_storage.mjs](../../scripts/audit_illustration_storage.mjs)
hanya menginventaris file UUID raster tanpa referensi DB yang berumur ≥24 jam,
`deleted: 0`. Tidak ada cron/purge otomatis. Penghapusan versi ber-referensi
memerlukan pemeriksaan lifecycle terpisah.

## 4. API dan UI manual

| Endpoint | Fungsi |
| --- | --- |
| GET `/api/topics/:id/illustration` | Daftar versi, pilihan saat ini dan status konfigurasi; tidak memanggil model |
| POST `/api/topics/:id/illustration/generate` | `{request_id: UUID, regenerate?: boolean}`; hanya menghasilkan aset/topik, tidak membuat draf |
| GET `/api/media/assets/:assetId` | Raster lokal hasil lookup UUID, checksum dan MIME; `nosniff`, tanpa URL/path bebas |
| POST `/api/drafts/:id/illustration` | `{asset_id: UUID}`; pasang cover dari topik yang sama melalui transaksi edit, render ulang dan wajib review baru |

POST generasi memiliki batas dua request aktif/proses dan lima request per
alamat per 10 menit, map maksimal 1.000 alamat. Header IP Cloudflare hanya
dipercaya dari peer loopback dan setelah format IP valid. Origin validation dan
redaksi secret tetap mengikuti keputusan dashboard terbuka.

Radar mempunyai kontrol **Buat ilustrasi AI**, **Lihat ilustrasi**, dan **Buat
ulang ilustrasi AI**, dengan status dan preview yang ditampilkan setelah
interaksi. Memuat Radar tidak mengambil/menghasilkan gambar otomatis. Retry
transport mempertahankan request ID. Pengaturan Designer memisahkan pilihan
model/timeout/ketentuan ilustrasi dari model chat; provider awal hanya Gemini.

Editor menyediakan **Pakai ilustrasi topik**. Pilihan topik yang baru tidak
diam-diam mengganti cover draf lama; redaktur menerapkannya secara eksplisit,
kemudian approval lama dibatalkan. Desain custom dapat memakai `topic_id`
Radar yang memiliki ilustrasi siap; aset dari topik lain ditolak sebelum draf
ditulis. Desain custom dibuat dalam transaksi agar error aset/render tidak
meninggalkan draf setengah jadi.

## 5. Normal, fallback, edit dan regenerasi

Pilihan cover diambil dari server, ditempelkan sesudah output Designer
divalidasi; model tidak menentukan ID aset. Fallback yang masih digunakan
penulis lama mempertahankan descriptor ilustrasi yang sama.

`slides[].data` memuat `asset_id`, `asset_sha256`, `image_kind=ai_generated`
dan `disclosure_version=1`, bukan base64. Descriptor otomatis ikut
`draftContentHash`, dan pembacaan bytes harus cocok dengan checksum pinned.

[images.js](../../services/common/images.js) melakukan lookup aset lokal dan
hydration menjadi embedded raster pada transit tepercaya ke renderer; URL atau
disclosure dari browser tidak mengganti provenance aset. Edit slide biasa
mempertahankan asetnya; edit struktur tidak menyalin aset berdasarkan index
lama ke slide yang berbeda. Cover yang memiliki ilustrasi tidak dihapus lewat
kontrol delete biasa. Regenerasi teks memakai aset pinned pada draf lama,
walaupun pilihan topik sudah berubah.

Preview, edit, produksi/regenerasi dan desain custom memakai resolver yang
sama. Ganti aset eksplisit melewati `editDraft`: row lock, pembatalan schedule,
review/hash baru, serta larangan mengedit saat publish/unknown atau sudah ada
percobaan remote tetap dipertahankan. ZIP membaca render lokal; JPEG publisher
tetap memakai signature dan proses rekonsiliasi yang sudah ada.

## 6. Disclosure dan renderer

[Renderer](../../services/render/engine.js) menempatkan literal **Ilustrasi AI ·
Gapura Media** dengan warna/kontras tetap di area gambar. Teks credit dari
browser, `showSource=false` dan token brand tidak dapat mengubah label ini.
Layout `illustration` mendukung gambar isi; cover dan fallback juga memakai
gambar yang sama. Renderer tetap tidak fetch internet.

Tes memeriksa tree dan piksel: fixture bidang warna benar-benar mengisi area
gambar, tinta label ada di dalam area tersebut, dan keduanya bertahan pada
PNG/JPEG yang ditulis ke disk. Fixture warna adalah data sintetis untuk menguji
render; tidak disebut ilustrasi nyata dari model.

## 7. Verifikasi dan batas yang diketahui

Tes perilaku baru dijalankan merah sebelum implementasi untuk adapter, storage,
config, kontrak visual, hydration, API/draf/regenerasi, browser dan renderer.
Review independen mereproduksi tiga regresi yang diperbaiki: missing-media
tetap membuat draf, request reuse berganti versi pada retry, serta aset salah
slide sesudah delete. Log berada di `/tmp/opencode/gapura-r3-*-red.log` dan
`/tmp/opencode/gapura-r3-review-regressions-green.log`.

Hasil final: **570 unit lulus**, nol gagal, satu browser skip yang dijalankan
terpisah; **49 DB/API terisolasi lulus**; **9 akses/Origin/signature lulus**;
**1 Chromium desktop/mobile lulus**. Unit mencakup 38 pemeriksaan renderer
ilustrasi; 59 pemeriksaan renderer/regresi juga dijalankan terpisah. Log final:
`/tmp/opencode/gapura-r3-{unit,api,browser}-final.log`.

Backup privat `/root/gapura-backups/r3-ai-illustrations-20261117T024620Z`
memuat dump PostgreSQL, SQL migrasi dan `verification.json`. Restore seluruh
dump cocok; migrasi pada restore diulang dua kali. Penerapan produksi memakai
lock timeout 5 detik dan statement timeout 60 detik. **20 tabel historis identik**
berdasarkan jumlah baris dan hash JSON terurut, checksum file kredensial tetap
sama, kedua tabel baru nol baris.

Setelah restart web/render, GET health dan daftar ilustrasi memberi 200 secara
lokal dan melalui domain publik; konfigurasi API tidak mengekspos key. Jumlah
draf, Studio jobs, `topic_materials`, `media_assets` dan `illustration_requests`
tetap nol; 20 hash tabel historis tetap identik pada pemeriksaan akhir di
`/tmp/opencode/gapura-r3-production-final.json`. Kedua timer disabled/inactive,
drop-in worker tetap `GAPURA_DISABLE_WORKERS=true`. Tidak membuat draf/aset DB
untuk smoke produksi.

Screenshot disimpan oleh Chromium pada `/tmp/opencode/gapura-evidence/`.
Kemampuan sesi ini tidak dapat membaca screenshot sebagai gambar; evaluasi
visual manusia tidak diklaim. Tes DOM, raster pixels dan disclosure PNG/JPEG
memberi bukti teknis, bukan penerimaan style owner.

Uji provider nyata memakai judul sintetis yang umum, tanpa foto/body penerbit,
dan menyimpan hasil di `/tmp/opencode/gapura-r3-live/verification.json`.
Hasil **429 RESOURCE_EXHAUSTED**, metric free-tier requests untuk
`gemini-3.1-flash-lite-image` mempunyai **limit 0**. Tidak mengulang request
berbayar, mengubah billing/key, atau mengganti diam-diam ke provider lain.
Tidak ada raster nyata berhasil dibuat dan tidak ada baris produksi dari uji
tersebut. Mengaktifkan kuota/provider yang sesuai tetap diperlukan sebelum
sampel generatif nyata dapat diterima owner.

R4–R6 tetap diperlukan untuk input judul saja pada seluruh agen, clustering
enam desk, penghapusan Verifikator dan naskah orisinal. R3 tidak menyalakan
timer/publisher, tidak membuat batch produksi dan tidak menerbitkan posting.
