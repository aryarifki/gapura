# Claude Intake — jembatan draf programatis

Jembatan ini memungkinkan klien intake Muse (berjalan di lingkungan agen
Muse milik owner) mengirim paket konten terstruktur ke Gapura sebagai
**draf review-only**, memakai endpoint yang sama dengan Studio:
`POST /api/drafts/create-from-custom`.

**Status: LIVE di produksi sejak 2026-11-23.** Sejak **2026-11-24** Muse
adalah redaksi tunggal Gapura (keputusan owner): pemindaian topik, analisis,
penyusunan konten, dan publikasi semuanya dijalankan Muse lewat jalur
intake ini. Pipeline internal server (Scout/Analis/Copywriter/Designer/SEO/
Studio) dinonaktifkan — timer `gapura-pipeline` dan `gapura-publisher`
dimatikan (unit dipertahankan, reversibel) — sehingga intake adalah
satu-satunya jalur produksi konten aktif. Empat edisi otomatis harian
(slot terbit ±07:30/12:15/15:30/19:00 WIB, batas total 6 konten/hari)
berjalan lewat jalur ini, di samping draf manual owner dari dashboard dan
Space "Ruang Produksi Gapura".

Draf dari jalur ini tunduk pada kontrak editorial yang sama persis dengan
draf Studio (`services/common/original-editorial.js`), tersimpan dengan
`status='draft'` dan `needs_review=true`. Penayangan draf intake dilakukan
lewat endpoint publish-now (lihat di bawah) setelah verifikasi draf;
persetujuan manual owner lewat dashboard juga tetap tersedia.

## Mengaktifkan

1. Buat nilai acak yang kuat, misalnya `openssl rand -hex 32`.
2. Pasang di `/etc/gapura/runtime.env` pada server:

   ```env
   GAPURA_INTAKE_TOKEN=<nilai acak>
   ```

3. Restart `hme-web.service`. Tanpa variabel ini, guard intake tidak aktif
   dan endpoint berperilaku persis seperti sebelumnya.
4. Berikan nilai yang sama ke klien intake melalui jalur kredensial aman
   (Secure Vault), jangan lewat chat, Git, atau log.

## Cara kerja guard

Middleware `services/web/intake-guard.js` hanya terpasang pada route
`POST /api/drafts/create-from-custom`:

- Token belum diatur → guard nonaktif (perilaku lama).
- Header `X-Gapura-Intake-Token` cocok (perbandingan timing-safe) →
  permintaan ditandai; draf yang dibuat tercatat di `audit_log` dengan
  actor `claude_intake` (draf Studio tetap `studio_editor`).
- Permintaan browser dengan header `Origin` → lolos seperti biasa; guard
  origin global sudah lebih dulu memastikan origin itu milik dashboard
  sendiri, jadi UI Studio tidak berubah.
- Pemanggil non-browser tanpa token valid → `401`.

Catatan cakupan: token ini mengidentifikasi klien intake dan memungkinkan
atribusi audit. Ia tidak mengubah model akses API dashboard yang sudah ada.

## Kontrak paket

Body mengikuti kontrak `create-from-custom` + `customOriginalContent`:

- `title` (maks 240), `summary`, `primary_source`, `source_url` (HTTPS
  publik yang valid), `format` (`carousel`/`single`).
- `editorial_mode` (`explainer`/`current`) dan `editorial_input` yang
  ternormalisasi; mode harus sama di keduanya.
- `slides`: 3–9 slide carousel (atau 1 untuk `single`) dengan layout/peran
  sesuai `ORIGINAL_LAYOUTS`/`ORIGINAL_ROLES`.
- `article_body` minimal 1200 karakter; mode `current` memerlukan minimal
  3 `article_references` beratribusi.
- `caption_body` dipecah per paragraf dan `editorial_references.caption`
  harus sama panjang; `caption`, `caption_body`, dan `threads_caption`
  harus persis sama dengan hasil validasi `validateOriginalContent` —
  klien menghitungnya memakai modul validator repo ini sebelum mengirim.

Klien memvalidasi paket secara lokal dengan validator yang sama; server
tetap validator terakhir dan menolak paket yang tidak patuh dengan 422.

### Format story mode ganda (berlaku sejak 2026-11-24)

Paket story memakai dua format, dipilih dari kompleksitas fakta:

- **Quick News — 3 slide** (cover → brief → penutup) untuk berita lugas
  satu peristiwa.
- **Deep Explainer — 5 slide** (cover → 3 slide isi → penutup) untuk
  berita berproses (multi-tanggal, ≥2 aktor/institusi kunci, regulasi
  penentu, atau ≥6 fakta). Slide isi memilih layout `editorial-breakdown`,
  `editorial-timeline`, `editorial-impact`, atau `editorial-lead`.

Kontrak ketat mode `current`: fakta dari minimal 3 penerbit berbeda;
setiap angka/tanggal/kutipan wajib didukung fakta yang dirujuk lewat
`fact_ids`; dilarang kata tanggal relatif ("kemarin", "hari ini", dsb.) —
tanggal ditulis eksplisit; kutipan langsung hanya sah bila terdaftar
sebagai `fact.quote`; tanggal peristiwa linimasa wajib muncul **persis**
di teks fakta rujukannya.

### Batas validator terkini (deploy 2026-11-25, branch `fix/validator-hashtag-30`)

- Hashtag mode story: **5–30 tag unik**; mode lain: **maksimal 30**.
  Aturan editorialnya lebih ketat dari batas ini: hashtag selalu **tepat
  30**, tersusun berlapis (umum + set tetap per desk + spesifik topik +
  lokasi + jangkauan luas).
- Item per slide `editorial-breakdown`/`editorial-impact`: **maksimal 6**.
- Linimasa (`editorial-timeline`): **maksimal 5 peristiwa**.
- Takeaways mode story: **2–4 butir**; bagian artikel 2–6.
- `caption_body`: story 300–1.700 karakter, non-story 1.200–1.900
  karakter; **total caption termasuk hashtag maksimal 2.200 karakter**.
- Caption Threads: **maksimal 500 karakter**; validator otomatis hanya
  memuat hashtag sebanyak yang muat menurut urutan prioritas (seluruh
  hashtag tetap dipakai di Instagram/Facebook).
- Anggaran kata slide dan batas hook caption 125 karakter sudah dihapus
  dari validator (keputusan owner 2026-11-24); kepadatan slide diatur
  aturan editorial di README klien intake, bukan penolakan otomatis.

### Aturan caption (mengikat untuk semua paket)

- Caption **wajib berparagraf**: baris kosong (`\n\n`) antarparagraf —
  paragraf hook, 1–3 paragraf isi, paragraf penutup — dan blok hashtag
  pada baris tersendiri. Caption satu blok teks menyambung dilarang.
- Hook tidak menyalin judul cover; konteks pemicu wajib muncul di slide
  lead dan caption; caption ditutup pertanyaan diskusi spesifik-topik +
  arahan "Baca versi lengkapnya di gapuramedia.my.id" + CTA
  simpan/bagikan, semuanya **sebelum** hashtag.
- Semua headline di semua kanal memakai **sentence case**; kicker sampul
  maksimal 20 karakter.

Aturan konten lengkap (komposisi sampul multi-elemen, gaya komposit foto
realistis, kehomogenan daftar bernomor, dsb.) hidup di README klien
intake (`~/workspace/gapura-intake/README.md` di lingkungan Muse) dan
mengikat setiap paket.

## Render dan penerbitan

- **Render terjadi satu kali saat intake**: `create-from-custom` memanggil
  layanan render dan menyimpan slide draf. Endpoint publish **tidak**
  me-render ulang.
- Render ulang draf yang sudah ada (mis. setelah perbaikan renderer):
  `POST /api/drafts/:id/edit-slide` dengan body `{slide_no}` — me-render
  ulang seluruh carousel tanpa mengubah isi. Ditolak untuk draf yang
  sudah terbit atau sudah pernah dicoba publish ke Meta.
- **Publish-now**: `POST /api/drafts/:id/publish-now` dengan body
  `{"reviewed": true, "expected_revision": "<nilai field revision dari
  GET /api/drafts/:id>"}`. Status draf harus `draft` atau `scheduled`;
  target yang sedang `publishing`/`unknown` membuat publish ditolak.
  Gerbang verdict analis **sudah dihapus** dari jalur ini (2026-11-23) —
  tidak ada syarat verdict untuk menerbitkan.
- Draf yang sudah terbit **tidak bisa diterbitkan ulang**; repost selalu
  berarti draf intake baru.
- Hasil publish tercatat per platform di `publication_targets`
  (permalink Instagram/Facebook). Kegagalan publish tidak pernah dicoba
  ulang secara buta; draf yang gagal tetap menunggu di dashboard.

## Verifikasi setelah deploy

- Kirim satu paket uji → draf muncul di antrean Review dashboard.
- `audit_log` untuk draf itu ber-actor `claude_intake`.
- Permintaan tanpa header token dari non-browser ditolak 401; UI Studio
  tetap dapat membuat draf seperti biasa.
- `node intake.mjs <paket.json> --dry-run` di sisi klien harus lolos
  sebelum pengiriman; dry-run memakai validator repo ini.
