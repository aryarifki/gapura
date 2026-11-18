# R6 — Naskah orisinal dua mode, carousel-first dan caption panjang

Tanggal: 18 November 2026. Mengikuti [blueprint editorial](07_EDITORIAL_REDESIGN_BLUEPRINT.md),
[keputusan konten orisinal](10_ORIGINAL_AI_EDITORIAL.md), [R4](12_R4_SOURCES_DESKS.md)
dan [R5](13_R5_REMOVE_VERIFICATOR.md).

**Status: R6 selesai dan gate teknis lulus.** Naskah serta desain produksi kini
memakai input eksplisit tanpa body/ringkasan/foto penerbit, berformat carousel
3–9 slide dengan default enam, dan caption isi 1.200–1.900 karakter. Migrasi
additive sudah diterapkan ke produksi setelah backup/restore test; web dan render
dimuat ulang. Timer intake/publisher tetap `disabled/inactive`, worker background
dijeda, tidak ada publish nyata dan tidak ada panggilan model/gambar nyata dalam
gate ini. Quota raster AI tetap 0; penerimaan visual tetap R7.

## 1. Perubahan utama

| Area | Perubahan R6 |
| --- | --- |
| Input generasi | Copywriter hanya menerima proyeksi discovery (judul, sumber, URL, desk) dan `editorial_input` eksplisit. Summary/body/foto penerbit, snapshot materi dan metadata media tidak masuk brief default, fallback, maupun regenerasi |
| Dua mode | `explainer` menjelaskan mekanisme/konteks umum dari judul tanpa klaim aktual; `current` wajib memakai catatan fakta teratribusi yang disediakan redaksi |
| Struktur keluaran | Selalu `carousel`; 3–9 slide, default 6; peran, purpose dan kontribusi tiap slide berbeda; tidak ada downgrade diam-diam ke single, filler, CTA atau penutup wajib |
| Caption | `caption_body` 1.200–1.900 karakter, final Instagram maksimal 2.200 termasuk tagar, Threads maksimal 500 karakter termasuk tagar |
| Validasi | Angka/satuan/tanda, tanggal, kutipan dan atribusi diikat ke `fact_ids`; qualifier dugaan/negasi dipertahankan; metadata internal dan URL dilarang di teks publik |
| Layout | Designer hanya memilih layout dari naskah yang sudah valid; tidak boleh mengubah teks, urutan, data, jumlah slide atau menambah foto penerbit |
| Renderer | Default angka/tanggal demonstrasi dan CTA otomatis dihapus; layout data tanpa data lengkap ditolak dengan 400 yang jelas |
| Persistensi | Tujuh kolom nullable baru menyimpan input, mode, caption isi, Threads, angle, batas klaim dan peta referensi; hash revisi mencakup semuanya |
| Review/publish | Approval manusia dan hash tetap satu-satunya gate; Threads R6 wajib memiliki teks sendiri; publisher Meta dan legacy memeriksa ulang metadata dalam row lock |
| Verbatim | Validator petikan sumber dan fallback salin ringkasan dihapus. Kegagalan generasi menjadi error `original_generation_failed`/422, bukan draf salinan |

## 2. Kontrak input editorial

Modul bersama: [original-editorial.js](../../services/common/original-editorial.js).

Ekspor utama:

- `normalizeEditorialInput`
- `buildEditorialBrief`
- `validateOriginalContent`
- `validateOriginalDesign`
- konstanta versi, mode, format, rentang slide, layout, role dan claim type.

Allowlist input bersifat tertutup:

```json
{
  "version": 1,
  "mode": "explainer | current",
  "facts": [
    {
      "id": "f1",
      "text": "catatan fakta eksplisit",
      "source_url": "https://sumber-publik.example/rilis",
      "source_name": "Nama Lembaga",
      "quote": { "text": "kutipan persis", "speaker": "Nama Pembicara" }
    }
  ]
}
```

Aturan:

- `explainer` wajib `facts: []`; `current` wajib minimal satu fakta.
- ID `/^[a-z][a-z0-9_-]{0,39}$/i`, unik, maksimal 30 fakta dan total teks
  30.000 karakter; satu fakta maksimal 4.000 karakter.
- `source_url` wajib HTTPS publik tanpa kredensial, host lokal/internal atau IP
  privat; memakai validator sumber yang sudah ada.
- `quote` opsional; bila ada, teks kutipan harus persis berada di fakta dan
  speaker harus tertulis di fakta.
- Teks berupa URL saja bukan catatan fakta.
- Field asing, tipe salah, input kosong ganda dan metadata tambahan ditolak.

Brief yang diteruskan ke Copywriter berbentuk:

```json
{
  "version": 1,
  "discovery": { "judul dan metadata discovery yang diizinkan": true },
  "mode": "explainer",
  "facts": [],
  "directions": {
    "prompt": "arahan redaksi (maksimal 5.001 karakter)",
    "title": "judul arahan opsional",
    "angle": "angle opsional",
    "sections": ["2–6 fokus, masing-masing maksimal 600 karakter"],
    "caption_tone": "tone opsional"
  },
  "slide_count": 6
}
```

`directions` adalah arahan, bukan bukti. `slide_count` dibatasi 3–9; nilai
default 6 diambil dari konfigurasi Copywriter. Rencana Studio tidak boleh
menyisipkan summary atau body penerbit ke brief.

## 3. Validasi naskah dan caption

Keluaran Copywriter divalidasi sebelum Designer dipanggil. Pemeriksaan utama:

- `format` harus `carousel`; jumlah slide 3–9 dan nomor berurutan.
- Role, claim type dan layout berasal dari allowlist.
- Cover maksimal 120 karakter; slide isi maksimal 500 karakter; purpose wajib
  berbeda dan tidak boleh mengulang judul sebagai filler.
- `explainer` tidak boleh memuat angka, tanggal, nominal, kutipan, atribusi
  bersuara atau klaim peristiwa baru. Kata kondisional seperti "dapat",
  "jika", "mekanisme" tetap boleh untuk penjelasan umum.
- `current` wajib benar-benar memakai minimal satu fakta, baik pada slide
  maupun caption. Setiap klaim `fact` wajib memiliki `fact_ids` yang valid.
- Angka dibandingkan sebagai kuantitas bertanda lengkap dengan mata uang/satuan;
  `2%` tidak sama dengan `-2%`, `2 juta` tidak sama dengan `2` atau `2%`.
- Tanggal ISO dan tanggal Indonesia harus muncul di fakta yang dirujuk.
  Tanggal relatif ("hari ini", "kemarin", "besok") ditolak.
- Kutipan langsung harus persis berasal dari `quote.text`; speaker yang
  mengikuti `kata/ujar/tutur` harus sama dengan `quote.speaker`. Setiap
  "menurut Nama" harus cocok dengan `source_name` fakta yang dirujuk.
- Bila fakta memuat qualifier (`diduga`, `belum`, `berpotensi`, dan sejenisnya),
  klaim turunannya harus mempertahankan qualifier tersebut.
- Teks publik tidak boleh memuat `Sumber primer:`, `Status verifikasi:`,
  `needs_review`, nama field schema internal, URL, `www.`, kata verifikator
  atau tagar di dalam body.
- Struktur data (`stat-grid`, `chart-bar`, `chart-line`, `timeline`,
  `comparison`, `regulasi`) hanya boleh memakai label, nilai, unit, tanggal dan
  referensi yang berasal dari fakta yang dirujuk. Angka dan label dipasangkan
  ke fakta yang sama.
- Peta referensi keluaran: `{ caption: [{kind, fact_ids}], threads: [fact_ids] }`.
  Peta ini disimpan untuk review dan tidak menduplikasi teks publik.

Batas platform:

- `caption_body` 1.200–1.900 karakter.
- Caption Instagram final (isi + tagar + disclaimer relevan) maksimal 2.200.
- `threads_body` maksimal 500 karakter termasuk tagar; tidak memotong caption
  Instagram dan tidak memakai fallback caption pendek.
- Tagar dinormalisasi, unik dan dirakit sekali pada consumer.

Validator ini bersifat struktural/leksikal untuk menangkap kesalahan yang dapat
dibuktikan dari input. Validator tidak membuktikan kebenaran semantik, kualitas
angle, atau orisinalitas gaya; review manusia tetap wajib dan dapat menolak
naskah yang lolos pemeriksaan otomatis.

## 4. Layout dan renderer

`validateOriginalDesign` hanya menerima pilihan layout dengan nomor slide yang
sama. Teks, data, fact_ids, role, purpose dan urutan tidak dapat diubah oleh
Designer. Layout data hanya boleh dipilih bila naskah sudah membawa data lengkap.

Renderer [engine.js](../../services/render/engine.js) dan
[validation.js](../../services/render/validation.js) tidak lagi mengisi angka,
tanggal, label, teks perbandingan, timeline atau CTA contoh. Data kosong/tidak
lengkap menghasilkan 400 yang dapat ditindaklanjuti, termasuk pada preview,
batch dan resolusi layout langsung. Layout arsip dengan data nyata tetap dapat
dirender. Ilustrasi AI lokal, hidrasi raster, ukuran 1080×1350 dan disclosure
`Ilustrasi AI · Gapura Media` tidak berubah.

Modul lama `common/carousel.js` beserta tesnya dihapus karena tidak lagi memiliki
pemanggil runtime; heuristic `summary → single` tidak dipakai lagi.

## 5. Persistensi, hash dan publikasi

Migrasi [20261117_original_editorial.sql](../../database/migrations/20261117_original_editorial.sql)
menambahkan kolom nullable:

| Kolom | Tipe | Isi |
| --- | --- | --- |
| `editorial_input` | JSONB | versi, mode dan fakta terkurasi |
| `editorial_mode` | VARCHAR(20) | `explainer`/`current` dengan check constraint |
| `caption_body` | TEXT | isi caption 1.200–1.900 karakter |
| `threads_caption` | TEXT | teks Threads ≤500 |
| `angle` | TEXT | angle editorial |
| `scope_note` | TEXT | batas klaim |
| `editorial_references` | JSONB | peta referensi caption/Threads |

Hash revisi [draft-revision.js](../../services/common/draft-revision.js)
memperluas cakupan hanya bila field editorial terisi, sehingga hash draf legacy
tidak berubah. Untuk draf R6, hash mencakup tujuh field di atas termasuk fakta
terkurasi, `fact_ids` slide, urutan referensi paragraf caption dan referensi
Threads. Perubahan satu field membatalkan approval/jadwal dan memerlukan review
baru.

Editor web menolak R6 yang disusutkan menjadi 1–2 slide sebelum pin, render atau
penulisan. Draf legacy single tetap dapat diedit. Edit caption memperbarui body
dan menghapus peta referensi caption yang tidak lagi mewakili teks; edit slide
mempertahankan metadata asli dan mengabaikan percobaan mengganti field read-only.

Publisher Meta dan legacy memproyeksikan serta memeriksa ulang ketujuh field
dalam query terkunci sebelum panggilan keluar. Threads R6 tanpa `threads_caption`
nonblank ≤500 diblokir, tanpa fallback ke caption Instagram. Mode shadow memakai
row, hash dan gate yang sama dengan live.

## 6. Studio, API dan UI

- Job Studio menyimpan input editorial awal di `plan.editorial_input`; deteksi
  rencana penuh memakai `plan.title` dan `plan.sections`, bukan truthy check.
- Gate `plan_review` dipertahankan. Mode dan fakta tidak boleh diubah oleh model
  perencana; revisi redaktur tidak menjadi fakta baru.
- Produksi normal, kustom dan regenerasi menerima input editorial eksplisit.
  Penyimpanan kustom memvalidasi konten, peta referensi dan aset ilustrasi yang
  dipin; field foto penerbit ditolak.
- Kegagalan kontrak mengembalikan 422 dengan pesan mode/fakta; kebutuhan
  ilustrasi mengembalikan 409 `needs_media`. Tidak ada draf salinan sumber.
- UI editor menyediakan pilihan mode `explainer`/`current`, catatan fakta JSON,
  tampilan read-only mode/angle/scope/referensi, serta error edit yang jelas.
- Default editor tidak lagi menawarkan metrik, tanggal, label perbandingan atau
  CTA contoh. Placeholder menjelaskan bahwa isian berasal dari naskah/fakta.

## 7. Konfigurasi, prompt dan skill

- `config/agents.json`: `copywriter.slide_count` menjadi 6; validasi menerima
  3–9.
- Prompt Copywriter meminta naskah orisinal dua mode, `fact_ids`, caption
  1.200–1.900, Threads ≤500 dan default enam slide tanpa fallback salin.
- Prompt Designer hanya meminta `{slides:[{no,layout}]}` dari naskah valid.
- Prompt Studio menjelaskan input eksplisit, dua mode, carousel-first dan
  larangan memakai body/summary penerbit.
- `config/skills/{copywriter,designer,studio}.skills.md` ditulis ulang; tidak ada
  lagi kewajiban petikan verbatim, fallback ringkasan, single default atau CTA.
- Seluruh agen tetap menandai konten eksternal sebagai data, bukan instruksi.

## 8. Migrasi produksi dan bukti layanan

Backup dan restore test:

- Direktori: `/root/gapura-backups/r6-original-editorial-20261118T095830+0700`
- Dump: `hme-before-r6.dump` (pg_dump custom, 1,3 MB)
- Restore ke database uji berhasil: `drafts=0`, `topics=1181`,
  `trend_sources=18`.
- Log migrasi pertama/kedua, kolom, constraint, dan hitungan sebelum/sesudah
  tersimpan di direktori yang sama.

Migrasi produksi:

- Tujuh kolom nullable dan `drafts_editorial_mode_check` terpasang.
- Migrasi dijalankan dua kali; run kedua hanya menghasilkan `NOTICE ... already
  exists` dan tidak mengubah data.
- Jumlah baris sebelum/sesudah sama: `drafts=0`, `topics=1181`,
  `trend_sources=18`, `audit_log=442`, `scheduled_posts=0`,
  `publication_targets=0`; total 23 tabel basis tetap.
- `hme-render` dan `hme-web` dimuat ulang dan aktif; health lokal maupun publik
  `ok`.

Verifikasi publik `https://gapura.avenia.my.id`:

- Halaman utama HTTP 200 dan memuat tagline enam desk.
- `/api/agents/config` HTTP 200 dengan enam agen; tidak ada kredensial yang
  dikembalikan.
- `/api/trend-sources` HTTP 200, 18 sumber.
- `/api/workflow` menunjukkan pipeline systemd nonaktif dan delivery disabled.
- `/api/drafts` HTTP 200, 0 draf.
- Endpoint lama `/api/verifications` HTTP 404.
- `gapura-pipeline.timer` dan `gapura-publisher.timer` tetap
  `inactive/disabled`; `GAPURA_DISABLE_WORKERS=true` tetap berlaku.

## 9. Gate pengujian

| Gate | Hasil |
| --- | --- |
| Unit gabungan | **676 tes: 675 lulus, 0 gagal, 1 skip** (skip Chromium terpisah) |
| DB/API terisolasi | **89/89 lulus** |
| Renderer | **105/105 lulus** |
| Chromium end-to-end | **1/1 lulus** |
| Corpus enam desk | **24/24 lulus** (12 korpus + 12 kontrak inti, termasuk dalam unit) |
| Sintaks | `node --check` untuk modul utama dan `bash -n scripts/run_pipeline.sh` lulus |
| Whitespace | `git diff --check` bersih |

Perintah utama:

```bash
mapfile -t unit_files < <(find services -path '*/test/*.test.js' -type f | sort | grep -v '^services/web/test/server-')
NODE_ENV=test node --experimental-vm-modules --experimental-test-module-mocks --test "${unit_files[@]}"

node services/web/test/run-isolated.mjs services/web/test/server-db.test.js \
  services/web/test/server-providers.test.js services/web/test/server-meta-publisher.test.js \
  services/web/test/server-score-integrity.test.js services/web/test/server-material-store.test.js \
  services/web/test/server-illustrations.test.js services/web/test/server-clusters.test.js \
  services/web/test/server-original-editorial.test.js services/web/test/server-original-metadata.test.js

cd services/render && node --import ./test/helpers/offline.js --test test/*.test.js
```

Tidak ada panggilan model LLM, gambar provider, database produksi saat tes, commit
atau publish di dalam gate otomatis; migrasi produksi dilakukan terpisah setelah
backup/restore test.

## 10. Batas yang belum diklaim

- Tidak ada raster/gambar AI nyata; quota provider tetap 0 dan tidak ada
  permintaan ulang atau perpindahan provider.
- Tidak ada penerimaan visual/owner; sampel enam desk dengan ilustrasi nyata
  tetap R7.
- Validator tidak menjamin kebenaran semantik atau orisinalitas; review manusia
  dan atribusi sumber tetap wajib.
- Tidak ada publish live, aktivasi timer, batch produksi, atau perubahan
  kredensial Meta.
- Backfill desk untuk topik arsip tetap keputusan owner yang tertunda.

## 11. Langkah berikutnya

1. R7: siapkan satu carousel per desk dengan naskah orisinal dan ilustrasi AI
   nyata bila quota tersedia; owner menilai orisinalitas, style, kedalaman dan
   disclosure sebelum batch.
2. R8: batch 20 draf berurutan, shadow, lalu satu publish uji dengan persetujuan
   terpisah setelah izin Meta dan sampel disetujui.
3. Jangan mengaktifkan timer atau worker hanya karena gate teknis hijau.
