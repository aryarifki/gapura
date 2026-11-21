# R7 — Unggah gambar manual sebagai jalur utama, cover slide 1 wajib bergambar

**Pembaruan 19 November 2026:** enam sampel pipeline terbaru yang mencakup seluruh
desk sudah disiapkan sebagai draf 150–155, lengkap artikel, petikan fakta,
referensi, caption dan cover. Catatan koreksi, visual serta keputusan owner yang
masih `pending` ada di [paket review enam desk](18_R7_SIX_DESK_REVIEW.md).
Sampel 144–149 di laporan awal tetap dipertahankan. R7 belum ditutup secara
editorial; batch/shadow R8 belum dijalankan.

Tanggal: 18 November 2026. Mengikuti [blueprint editorial](07_EDITORIAL_REDESIGN_BLUEPRINT.md),
[R3 ilustrasi](11_R3_AI_ILLUSTRATIONS.md) dan [R6 naskah/desain](14_R6_ORIGINAL_EDITORIAL.md).

**Status: R7 selesai dan gate teknis lulus.** Unggah gambar manual menjadi metode
utama; ilustrasi AI tetap tersedia sebagai opsi. Cover didefinisikan sebagai
**slide nomor 1** dan wajib memiliki gambar sebelum approval/publish, sedangkan
slide isi boleh tanpa gambar. Migrasi additive sudah diterapkan ke produksi
setelah backup/restore test; web dan render dimuat ulang. Enam sampel carousel
(draf 144–149) dibuat dengan cover manual, semuanya masih `draft` dan
`needs_review`, tanpa approval atau publish. Timer intake/publisher tetap
`disabled/inactive`; tidak ada publikasi nyata. Kuota gambar AI tetap
`429 Free Tier limit 0`, sehingga tidak ada raster AI yang dibuat atau disimpan.

## 1. Perubahan utama

| Area | Perubahan R7 |
| --- | --- |
| Sumber gambar | Unggah manual redaksi adalah jalur default. Jalur AI tetap ada dan tidak dihapus, tetapi bukan prasyarat draf |
| Definisi cover | Cover = slide nomor 1, apa pun nama layout-nya. Wajib bergambar sebelum approval/publish |
| Slide isi | Boleh tanpa gambar. Bila diberi gambar manual, layout dipaksa `illustration` |
| Aset manual | Tabel baru `manual_media_assets`; setiap berkas immutable dan dialamatkan oleh UUID + SHA-256 |
| Provenance | Descriptor `{asset_id, asset_sha256, image_kind:'editor_upload', credit, rights_basis}` disimpan di `draft_slides.data_snapshot` |
| Hak gambar | `rights_basis` wajib salah satu dari `own_work`, `licensed_stock`, `agency_license`; unggahan wajib menyertakan atestasi `rights_attested:true` |
| Pemrosesan | `sharp`: rotate, resize maksimal 1600 px, flatten putih, JPEG kualitas 82; EXIF/profil warna dibuang; input 12 MB, output 4 MB |
| Gate awal | `create-from-custom` tidak lagi menolak draf tanpa gambar; gate gambar dipindah ke approval/publish |
| Gate approval | Route approval web menolak draf tanpa cover bergambar dengan HTTP 409 |
| Gate publisher | `gateAllows` menolak draf tanpa cover sebelum panggilan Meta; hash dan locked recheck tetap |
| Editor | Kartu unggah manual (berkas, credit, dasar hak, rujukan, atestasi), status cover, daftar aset topik, dan tombol pasang |
| Renderer | Descriptor manual diterima validator; overlay memakai `Gambar: <credit>`; ilustrasi AI tetap memakai disclosure `Ilustrasi AI · Gapura Media` |

## 2. Kontrak unggah, daftar, dan pasang

Modul pemrosesan: [manual-media.js](../../services/designer/manual-media.js).
Route: [server.js](../../services/web/server.js).

### 2.1 Unggah

`POST /api/topics/:id/media`

Body hanya menerima enam field:

```json
{
  "filename": "cover.jpg",
  "data_uri": "data:image/jpeg;base64,...",
  "credit": "Nama / Dokumentasi Gapura",
  "rights_basis": "own_work",
  "rights_reference": "URL lisensi atau nomor invoice (opsional)",
  "rights_attested": true
}
```

Balasan `201`:

```json
{
  "asset": {
    "id": "UUID", "topic_id": 1135, "kind": "editor_upload",
    "credit": "...", "rights_basis": "own_work", "rights_reference": null,
    "mime": "image/jpeg", "byte_size": 101333, "width": 1080, "height": 1350,
    "sha256": "64 hex", "original_name": "cover.jpg", "created_at": "...",
    "url": "/api/media/manual/UUID"
  },
  "descriptor": {
    "asset_id": "UUID", "asset_sha256": "64 hex", "image_kind": "editor_upload",
    "credit": "...", "rights_basis": "own_work"
  }
}
```

Aturan dan batas:

- `data_uri` wajib JPEG/PNG/WebP base64 yang valid; hasil decode harus identik
  dengan string base64 yang dikirim.
- Input maksimal 12 MB sebelum diproses; hasil simpan maksimal 4 MB.
- Dimensi hasil minimal 320×240 dan maksimal 4096×4096; gambar diperkecil ke
  maksimal 1600 px pada sisi terpanjang tanpa memperbesar.
- Hanya raster satu halaman. SVG, GIF, multi-page TIFF/PDF, dan data rusak
  ditolak.
- Rate limit 10 unggahan per 10 menit per alamat IP (map in-memory per proses).
- Field asing, `credit` kosong/>200 karakter, `rights_basis` tidak dikenal,
  `rights_reference` >500 karakter, atau `rights_attested !== true` → `400`.
- Topik tidak ada → `404`. Batas unggahan → `429`. Kegagalan penyimpanan → `500`.

Berkas ditulis lebih dulu ke nama sementara `0600`, lalu `link()` atomik ke
`storage/media/manual/<uuid>.jpg`. Bila insert database gagal, berkas yang baru
ditulis dihapus kembali. Keberhasilan insert menulis audit
`manual_media_uploaded` pada entitas topik.

### 2.2 Daftar dan baca

- `GET /api/topics/:id/media` → `{assets:[...]}` maksimal 100 aset terbaru.
- `GET /api/media/manual/:assetId` → byte JPEG dengan `X-Content-Type-Options:
  nosniff`. Pembacaan memverifikasi UUID, `kind`, `mime`, bentuk `local_path`,
  bukan symlink, `realpath` berada di direktori media, ukuran ≤4 MB, dan
  SHA-256 byte sama dengan `manual_media_assets.sha256`. Ketidakcocokan → `404`.

Tidak ada route hapus/rotasi. Aset bersifat immutable; menghapus topik
menghapus baris lewat `ON DELETE CASCADE`, tetapi berkas di disk tidak ikut
dihapus dan menjadi orphan sampai dibersihkan manual.

### 2.3 Pasang ke slide

`POST /api/drafts/:id/slide-media`

```json
{ "slide_no": 1, "asset_id": "UUID" }
```

- Hanya dua field; `slide_no` bilangan bulat 1–9.
- Aset harus milik topik draf yang sama; aset topik lain → `409`.
- Descriptor pada slide diganti seluruhnya; field gambar lama (`image_url`,
  `image_data`, `image_kind`, `asset_id`, `asset_sha256`, `credit`,
  `rights_basis`) dibuang lebih dulu agar tidak ada sisa provenance.
- Slide isi (`slide_no > 1`) dipaksa memakai layout `illustration`.
- Respons memuat `status`, `draftId`, `slide_no`, `asset_id`, `layout`,
  `image_url` ber-cache-buster, dan `needs_review:true`.
- Render ulang dilakukan oleh `editDraft`; kegagalan renderer menghasilkan `502`
  dan draf sebelumnya dipertahankan.

## 3. Gate cover: approval dan publisher

Definisi tunggal di [images.js](../../services/common/images.js):

```js
hasCoverImage(content) === true
```

hanya bila `slides[0].data` memiliki `image_kind` yang dikenal
(`ai_generated`/`editor_upload`), `asset_id` UUID, dan `asset_sha256` 64 hex.

- **Approval web**: draf tanpa cover bergambar ditolak `409` dengan pesan
  `Cover (slide 1) wajib memiliki gambar sebelum disetujui.`
- **Publisher Meta**: `gateAllows` menambahkan `!hasCoverImage(row.slides)`
  sebagai syarat gagal, setara dengan hash tidak cocok atau sumber tidak valid.
  Draf tanpa cover tidak pernah masuk antrean publish.
- **`create-from-custom`**: gate `needs_media` dihapus. Draf boleh dibuat tanpa
  gambar untuk diedit, tetapi tidak dapat disetujui sampai cover dipasang.
- **Tes lama**: fixture approval/publish yang sebelumnya tidak bergambar kini
  memakai descriptor cover. Tes render menyuntikkan descriptor setelah render
  agar tidak memicu resolusi aset palsu.

## 4. Penyimpanan immutable dan hak gambar

Migrasi [20261118_manual_media.sql](../../database/migrations/20261118_manual_media.sql):

| Kolom | Tipe | Aturan |
| --- | --- | --- |
| `id` | UUID | primary key |
| `topic_id` | BIGINT | `REFERENCES topics(id) ON DELETE CASCADE` |
| `kind` | TEXT | hanya `editor_upload` |
| `rights_basis` | TEXT | `own_work`/`licensed_stock`/`agency_license` |
| `credit` | TEXT | 1–200 karakter setelah trim |
| `rights_reference` | TEXT | null atau ≤500 karakter |
| `local_path` | TEXT | `media/manual/<uuid>.jpg` |
| `mime` | TEXT | `image/jpeg`/`image/png`/`image/webp` |
| `byte_size` | INT | 1–4.194.304 |
| `width`, `height` | INT | 320–4096 / 240–4096 |
| `sha256` | CHAR(64) | 64 hex |
| `original_name` | TEXT | null atau ≤255 karakter |
| `uploaded_by` | TEXT | default `web_admin` |
| `created_at` | TIMESTAMPTZ | default `CURRENT_TIMESTAMP` |

Indeks `manual_media_assets_topic_history(topic_id, created_at DESC)` melayani
daftar aset per topik.

Atestasi hak bersifat deklaratif: sistem mencatat dasar hak, credit, dan
rujukan opsional, tetapi tidak memverifikasi lisensi atau kepemilikan. Review
manusia tetap bertanggung jawab atas kebenaran klaim hak. Metadata EXIF dan
profil warna tidak disimpan karena seluruh raster ditulis ulang sebagai JPEG
baru; ini juga menghapus GPS/kamera yang tidak diperlukan.

## 5. Persistensi, hash, dan review

- Descriptor manual tinggal di dalam `slides`, sehingga `draftContentHash` sudah
  mencakupnya. Mengganti cover membatalkan approval dan jadwal lama.
- `editDraft` menetapkan `status='draft'`, `needs_review=TRUE`, dan
  `scheduled_posts` pending menjadi `failed`; approval lama tidak berlaku.
- `pinIllustrationSlides` bercabang: `editor_upload` memuat aset dari
  `manual_media_assets` dan memakai `manualMediaDescriptor`; descriptor lama
  tanpa `image_kind` tetap memakai `media_assets` AI. Ini mempertahankan draf
  arsip tanpa migrasi ulang.
- `prepareSlideImages` menghidrasi manual dari berkas lokal dengan verifikasi
  SHA-256, bukan dari URL penerbit. `image_url`/`image_data` dari klien ditolak
  atau dibuang sebelum render.
- Publisher memproyeksikan dan memeriksa ulang cover di dalam row lock yang sama
  dengan hash, sumber, dan approval.

## 6. Renderer, UI, dan tes browser

Renderer [engine.js](../../services/render/engine.js) dan
[validation.js](../../services/render/validation.js):

- `image_kind` yang diterima: `ai_generated` atau `editor_upload`.
- Untuk `editor_upload`, `asset_id` UUID, `asset_sha256` opsional 64 hex,
  `image_data` wajib ada setelah hidrasi, `credit` wajib 1–200 karakter, dan
  `rights_basis` wajib dikenal.
- `isMediaImage` menganggap gambar ada hanya bila `image_data` dan `image_kind`
  valid. Slide manual memakai jalur `renderIllustration`.
- Overlay manual: `Gambar: <credit>`. Overlay AI tidak berubah:
  `Ilustrasi AI · Gapura Media`.
- Ukuran kanvas tetap 1080×1350.

UI [index.html](../../services/web/public/index.html) dan
[app.js](../../services/web/public/app.js):

- Kartu **Gambar Slide · Unggah Manual** di editor draf: input berkas, credit,
  dasar hak, rujukan hak, atestasi, tombol unggah, dan tombol pasang.
- Status cover (`Cover siap` / `Cover belum bergambar`) dihitung dari slide 1.
- Daftar aset topik dimuat saat draf dibuka; setiap aset dapat dipasang ke slide
  yang sedang aktif. State aset, berkas, dan pesan direset saat membuka draf
  lain agar aset topik sebelumnya tidak terbawa.
- Setelah pasang, editor mengambil draf terbaru, merender ulang slide dan
  thumbnail, serta mencabut centang review.

Tes browser menambahkan alur unggah → pasang: berkas, credit, dasar hak,
atestasi, payload `data_uri`, `slide_no`, `asset_id`, status cover, dan
`needs_review`.

## 7. Migrasi produksi dan bukti layanan

Backup dan restore test:

- Dump: `backups/hme_pre_r7_20261118.dump` (pg_dump custom, 1,3 MB).
- SHA-256: `414802e91b778889a3c65c246cddc26dac8771a70dd713d5d257681d7c54be86`.
- Restore ke `hme_r7_restore_test` berhasil; migrasi dijalankan dua kali dan
  run kedua hanya menghasilkan `NOTICE ... already exists`.
- Setelah restore+migrasi: `media_assets=0`, `manual_media_assets=0`, tabel ada.
- Database scratch dihapus setelah uji.

Migrasi produksi:

- Dijalankan dalam transaksi `-1`; `manual_media_assets` dan indeksnya terpasang.
- Sebelum sampel: `media_assets=0`, `manual_media_assets=0`.
- `hme-web` (port 3005) dan `hme-render` (port 3000) dimuat ulang; health keduanya
  `ok`.
- Catatan operasional: percobaan sampel pertama gagal `502` karena `hme-render`
  masih memakai kode lama yang menolak `editor_upload`. Restart render
  menyelesaikan masalah; renderer wajib dimuat ulang setelah perubahan kontrak
  gambar.

Keadaan otomatisasi:

- `gapura-pipeline.timer` dan `gapura-publisher.timer`: `inactive`, `disabled`.
- `GAPURA_DISABLE_WORKERS=true` pada `hme-web`.
- `run_daily.sh` tetap dijalankan manual oleh operator; tidak ada cron 22:00 dan
  itu keputusan sengaja.

## 8. Enam sampel carousel

Sampel dibuat lewat API produksi dengan cover manual. Semua memakai grafis
abstrak yang dibuat sendiri (gradien/garis, bukan foto editorial), credit
`Grafis Gapura Media`, `rights_basis=own_work`.

| # | Draft | Topik | Sumber | Judul | Layout cover | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 144 | 1135 | CNBC Indonesia Market | OJK Ungkap 3 Tersangka Manipulasi Saham, Dugaan Kerugian Rp6,97 M | `cover-editorial` | `draft`, `needs_review` |
| 2 | 145 | 1137 | Antara News Ekonomi & Finansial | OJK: Kredit konsumsi moderat cerminkan tantangan "demand" rumah tangga | `cover-editorial` | `draft`, `needs_review` |
| 3 | 146 | 1165 | CNBC Indonesia Market | BSSN Ungkap Bank-Asuransi Rentan, Sebulan 753 Ribu Seragan Siber | `cover-editorial` | `draft`, `needs_review` |
| 4 | 147 | 1176 | Kontan Investasi & Pasar Modal | Saham VISI Melemah Usai Akuisisi Hasna Medika, Direktur Tambah Kepemilikan | `cover-editorial` | `draft`, `needs_review` |
| 5 | 148 | 1177 | Antara News Ekonomi & Finansial | OJK: Pembiayaan syariah dorong pertumbuhan kredit di Sumatera Barat | `cover-editorial` | `draft`, `needs_review` |
| 6 | 149 | 1178 | Antara News Ekonomi & Finansial | OJK Sumbar tegaskan larangan Perbankan meminta agunan KUR | `cover-editorial` | `draft`, `needs_review` |

Bukti:

- `manual_media_assets=6`; `media_assets=0`.
- Setiap `draft_slides` slide 1 memuat `image_kind='editor_upload'`, `asset_id`,
  `asset_sha256`, `credit`, dan `rights_basis`.
- `storage/drafts/{144..149}/slide_1.png` berukuran 1080×1350.
- Tidak ada baris `approved_auto`, `approved_human`, `published`, atau
  `published_manual` untuk keenam draf.
- Manifest kerja: `/tmp/opencode/r7-samples.json` (draft, topik, asset, hash,
  revisi).

Catatan: judul draf 146 dikutip apa adanya dari sumber ("Seragan"), termasuk
ejaan pada slug URL CNBC; tidak ada perubahan judul manual pada sampel.

Keterbatasan sampel: keenam topik berasal dari desk ekonomi/pasar modal, bukan
satu per desk. Sampel membuktikan alur teknis dan tampilan cover manual, bukan
variasi enam desk atau penerimaan estetika owner. Sumber hak foto editorial
nyata masih menunggu keputusan owner; enum tiga basis dan atestasi sudah siap.

## 9. Kuota Gemini dan batas gambar AI

Diuji 18 November 2026 dengan kredensial Gemini yang terpasang:

- Kunci API tersedia; daftar model HTTP `200`.
- Teks `gemini-3.5-flash-lite` HTTP `200`.
- Gambar `gemini-3.1-flash-lite-image` HTTP `429` dengan pesan Free Tier limit 0.
- Tidak ada raster AI yang disimpan; `media_assets=0`.

Karena itu jalur manual adalah satu-satunya jalur gambar yang dapat dipakai
sekarang. Jalur AI tetap dipertahankan dan diuji dengan raster sintetis; bila
kuota diaktifkan, kontrak `ai_generated` yang ada tetap berlaku tanpa perubahan
skema.

## 10. Gate pengujian

| Gate | Hasil |
| --- | --- |
| Unit non-overlap (tanpa tes render/server) | **575 tes: 574 lulus, 0 gagal, 1 skip** |
| Renderer | **109/109 lulus** |
| DB/API terisolasi (11 file `server-*.test.js`) | **102/102 lulus** |
| Chromium end-to-end | **1/1 lulus** |
| Sintaks | `node --check` untuk modul utama lulus |
| Whitespace | `git diff --check` bersih |

Perintah:

```bash
mapfile -t unit_files < <(find services -path '*/test/*.test.js' -type f | sort \
  | grep -v '^services/web/test/server-' | grep -v '^services/render/test/')
NODE_ENV=test node --experimental-vm-modules --experimental-test-module-mocks \
  --test "${unit_files[@]}"

cd services/render && node --import ./test/helpers/offline.js --test test/*.test.js

node services/web/test/run-isolated.mjs $(ls services/web/test/server-*.test.js | tr '\n' ' ')

PLAYWRIGHT_PATH=/tmp/opencode/gapura-browser/node_modules/playwright/index.mjs \
  CHROMIUM_PATH=/usr/bin/chromium node --test services/web/test/browser.test.js
```

Catatan transparansi: satu run gabungan yang menduplikasi tes render bersama
seluruh unit mengalami satu kegagalan level-file pada
`ai-illustration.test.js` karena beban paralel. File tersebut lulus `41/41` saat
dijalankan sendiri dan lulus di dalam suite render `109/109`. Gate di atas
memakai suite non-overlap agar angka tidak dihitung ganda.

## 11. Batas yang belum diklaim

- Tidak ada penerimaan visual/estetika oleh owner. Agen tidak dapat menilai
  legibilitas atau kualitas komposisi screenshot.
- Tidak ada OCR (`tesseract` tidak tersedia), sehingga teks credit pada PNG
  tidak diverifikasi secara mesin; yang diverifikasi adalah descriptor dan teks
  yang diberikan ke renderer.
- Tidak ada foto editorial nyata; enam sampel memakai grafis abstrak `own_work`.
  Keputusan sumber hak foto (lisensi stok/agensi) tetap milik owner.
- Tidak ada raster AI nyata; kuota gambar tetap 0.
- Tidak ada publish live, aktivasi timer, batch produksi, atau perubahan
  kredensial/izin Meta.
- Rate limit unggahan bersifat in-memory per proses, bukan kuota terdistribusi.
- Aset immutable tidak memiliki route hapus; berkas dapat menjadi orphan bila
  topik dihapus.
- Validasi hak bersifat deklaratif dan tidak membuktikan kepemilikan/lisensi.

## 12. Langkah berikutnya

1. Owner menilai enam sampel: komposisi cover, keterbacaan credit, kesesuaian
   judul, dan apakah grafis abstrak cukup untuk kanal atau perlu foto editorial.
2. Owner memutuskan sumber hak foto: karya redaksi, lisensi stok berbayar, atau
   lisensi agensi; isi `rights_reference` bila memakai lisensi.
3. Bila kuota AI diaktifkan, uji jalur `ai_generated` berdampingan dengan manual
   tanpa mengubah gate cover.
4. R8: batch 20 draf, shadow, lalu satu publish uji dengan persetujuan terpisah
   setelah sampel disetujui dan izin Meta diperiksa ulang.
5. Jangan mengaktifkan timer atau worker hanya karena gate teknis hijau.
