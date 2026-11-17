# 📊 Status Fitur, Permasalahan, & Roadmap Pengembangan
> **Repositori:** `aryarifki/gapura` · **Diperbarui:** 17 November 2026
> **Brand Identity:** `@gapuramedia` · **Portal Live:** [https://gapura.avenia.my.id](https://gapura.avenia.my.id)

**Status terbaru: evaluasi desain/editorial.** Hasil produksi dan antrean lokal
sudah kosong, intake/publisher otomatis dijeda, dan worker Studio background
dinonaktifkan. Dashboard, render, n8n manual, sumber/config dan koneksi Instagram
tetap tersedia. [Blueprint baru](plans/07_EDITORIAL_REDESIGN_BLUEPRINT.md)
mencakup delapan permintaan owner. Reset/jeda, kontrak offline
[R1](plans/08_R1_EDITORIAL_CONTRACT.md), dan reader/snapshot materi
[R2](plans/09_R2_ARTICLE_MATERIALS.md) tersedia. Penulisan produksi belum memakai
kontrak berita baru dan Verifikator runtime belum dihapus.
[Keputusan owner terbaru](plans/10_ORIGINAL_AI_EDITORIAL.md): sumber hanya
memasok topik/judul dan metadata; naskah serta ilustrasi dibuat agen AI secara
orisinal. Blueprint/roadmap sudah diselaraskan. [R3](plans/11_R3_AI_ILLUSTRATIONS.md)
menambahkan jalur ilustrasi lokal/disclosure; naskah lama belum diganti dan
generasi gambar nyata tertahan kuota provider.
[Bukti reset dan backup](EDITORIAL_WORKSPACE_RESET_20261116.md).

---

## 1. Matriks Status Fitur (Feature Matrix)

| Modul / Fitur | Status | Deskripsi Teknis |
| :--- | :---: | :--- |
| **Web Review Dashboard** | ✅ **Selesai & Aktif** | Antarmuka web responsif dark mode (desktop & mobile) di port 3005. |
| **Micro-Service Render** | ✅ **Selesai & Aktif** | Render deterministik Satori + Sharp (1080×1350 px rasio 4:5, footprint memori ~65MB RAM). |
| **Brand Identity Gapura Media** | ✅ **Selesai & Aktif** | Sesuai Brand Guidelines resmi: Navy `#102B45`, Deep Teal `#1F7E81`, Golden Amber `#D79344`. Seluruh aset lama `@homelessmedia` telah diganti penuh ke `@gapuramedia`. |
| **Radar Topik & Auto-Produce** | ✅ **Selesai & Aktif** | Filter topik berita lolos/gugur, 1-click Auto Produce langsung menghasilkan draf dan slide PNG, serta membuka editor. |
| **AI Creative Director (Designer)** | ✅ **Selesai & Aktif** | Agen AI otonom penentu arsitektur visual (jumlah slide bebas 3–8, layout dinamis non-kaku) bertenaga `gemini-3.5-flash-lite`. |
| **Regenerate AI On-The-Fly** | ✅ **Selesai & Aktif** | Tombol rancang ulang carousel via AI tanpa dialog konfirmasi yang memblokir, dengan invalidasi cache otomatis. |
| **Slide Editor & Dynamic Layout** | ✅ **Selesai & Aktif** | Edit teks slide, ubah tata letak (cover, stat-grid, quote, dual-perspective, regulasi, takeaway), live preview, dan tombol simpan & render ulang seketika. |
| **Studio Desain & Custom Draf** | ✅ **Selesai & Aktif** | Pembuatan postingan mandiri dari form Studio Desain dengan live preview dan export langsung ke Antrian Review. |
| **Kustomisasi 7 Agen AI & Skills.md** | ✅ **Selesai & Aktif** | Pengaturan provider, endpoint, model, system prompt, dan berkas `skills.md` per agen. Pengujian sementara tidak menyimpan perubahan. |
| **Katalog Provider & Model** | ✅ **Selesai & Aktif** | Registry Gemini/OpenAI-compatible/Anthropic, katalog model live, fallback lintas provider, dan key terpisah dari konfigurasi publik. MASB dan Xingchi tercatat dengan status kegagalan chat yang teramati. |
| **Manajemen Sumber Berita Niche** | ✅ **Selesai & Aktif** | Menambah, mengedit, melihat status, dan menonaktifkan feed RSS / portal data otoritas (BPS, BI, OJK, MK, JDIH). |
| **Bypass Cache CDN (Cloudflare)** | ✅ **Selesai & Aktif** | Middleware HTTP `no-store, no-cache`, query string bust unik `?t=...`, dan asset versioning `v=3.5.0` mencegah browser/CDN menyajikan file usang. |
| **Audit Log & Activity Tracker** | ✅ **Selesai & Aktif** | Pencatatan setiap aksi editorial (create, edit_slide, approve, reject, regenerated_ai) ke tabel `audit_log` PostgreSQL. |
| **Audit skor historis & constraint (P2)** | ✅ **Selesai** | Snapshot 16 November 2026, 18:23:55 WIB: 1.062 baris hingga ID 1062; mismatch/rentang invalid/NULL masing-masing 0. Mapping identitas, 0 `UPDATE`; `convalidated=true` sebelum dan sesudah validasi eksplisit. [Laporan audit](P2_SCORE_INTEGRITY_AUDIT.md). |
| **Publisher Instagram / Facebook / Threads** | 🟡 **Dijeda untuk evaluasi** | Instagram Unified `@gapuramedia` terhubung; pemeriksaan quota publikasi berhasil sebelum reset. Publisher tetap shadow dengan timer disabled. Facebook Page dan Threads perlu pemeriksaan/koneksi tersendiri. |
| **Scheduler native (P2)** | 🟡 **Terpasang, sengaja dijeda** | Intake/publisher `disabled/inactive` selama evaluasi hasil baru. Snapshot P2 aktif di bawah tetap historis; unit runtime dan drop-in web adalah acuan keadaan terbaru. n8n tetap canvas/fallback manual. |
| **Reset draf/desain** | ✅ **Selesai** | 142 draf, 269 slide, seluruh jadwal/target/job Studio dan 556 berkas hasil dibersihkan setelah backup restore teruji. Sumber/config/token tetap utuh. |
| **Blueprint pembaruan editorial** | 🟡 **Implementasi bertahap** | Carousel-first, input topik/judul, angle/naskah orisinal dan ilustrasi AI, enam desk nasional, serta penghapusan seluruh Verifikator mengikuti R0–R8. R1/R2 selesai sebagai baseline historis; kontraknya perlu penyesuaian, acceptance visual tetap R7. |
| **R1 — Kontrak editorial** | ✅ **Offline tersedia** | Enam desk, normalizer headline, referensi materi unik, kontrak media/rights, carousel 3–9, caption/tag assembler; enam fixture sintetis berisi 36 paragraf/36 slide dan raster lokal. Belum dipasang ke produksi. [Kontrak R1](plans/08_R1_EDITORIAL_CONTRACT.md). |
| **R2 — Materi artikel** | ✅ **Reader dan snapshot tersedia** | Body feed dipertahankan, HTML/JSON-LD diekstrak terpisah dari summary, tanggal/URL/status akses eksplisit, snapshot hash idempotent dan endpoint GET/enrich manual. Migrasi tambahan tanpa backfill; galeri tetap kosong. [Hasil R2](plans/09_R2_ARTICLE_MATERIALS.md). |
| **R3 — Ilustrasi AI** | 🟡 **Kode/API/render tersedia; kuota tertahan** | Adapter Gemini text-only, versi aset immutable/idempotent, preview/editor/fallback/regenerasi dan label AI teruji. Migrasi additive terpasang, 20 tabel historis identik. Provider nyata 429 dengan Free Tier limit 0; belum ada gambar nyata atau draf produksi baru. [Hasil R3](plans/11_R3_AI_ILLUSTRATIONS.md). |
| **R4–R8 — Konten orisinal** | 🟡 **Spesifikasi diperbarui** | Proyeksi judul saja bagi seluruh agen, clustering enam desk, naskah/angle orisinal serta penghapusan Verifikator belum diterapkan. Review owner dan aktivasi mengikuti gate yang sama. [Keputusan/acceptance](plans/10_ORIGINAL_AI_EDITORIAL.md). |
| **Telegram Approval Bot** | ⏳ **Belum Dikonfigurasi** | Engine dan kode notifikasi Telegram telah siap, namun menunggu input token Bot Telegram (`TELEGRAM_BOT_TOKEN`) dan Chat ID admin dari owner agar bot dapat aktif di polling. |
| **Kalender Konten Interaktif** | ⏳ **Belum Dikerjakan** | Jadwal tersimpan di PostgreSQL; kalender visual dengan drag-and-drop belum tersedia. |
| **Multi-User Role** | ⏳ **Belum Dikerjakan** | Dashboard dibuka langsung tanpa login/token admin atas permintaan owner. Validasi Origin dan redaksi API key tetap aktif; akun pengguna dan pembagian role belum tersedia. |
| **Visual Charting Saham Lanjutan** | ⏳ **Belum Dikerjakan** | Grafik bar chart dan bar comparison sudah aktif di Satori, namun grafik teknikal candlestick bursa interaktif belum diintegrasikan. |

---

## 2. Permasalahan yang Ditemui & Penyelesaiannya (Changelog Perbaikan)

Berikut adalah riwayat kendala teknis nyata yang dihadapi dan langkah solutif yang telah diterapkan:

### 1. Masalah: "Generate Ulang Tidak Ada Perubahan"
- **Akar Masalah:**
  - Cloudflare Edge Cache menyimpan berkas `app.js?v=2.9` selama 24 jam (`cache-control: public, max-age=86400`, `age: 39743`). Browser pengguna terus memuat JavaScript versi kemarin di mana tombol *Regenerate AI* belum terdaftar.
  - Terdapat pemanggilan `window.confirm()` yang sering terblokir secara otomatis pada browser mobile atau webview tanpa menampilkan popup ke pengguna.
- **Solusi yang Diterapkan:**
  - Menambahkan middleware anti-cache global di [`services/web/server.js`](file:///root/gapura/services/web/server.js) dengan header `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `Surrogate-Control: no-store`, dan `Pragma: no-cache`.
  - Mengubah script tag di [`services/web/public/index.html`](file:///root/gapura/services/web/public/index.html) menjadi `?v=3.5.0`.
  - Menghapus dialog konfirmasi `window.confirm()` di [`services/web/public/app.js`](file:///root/gapura/services/web/public/app.js) dan menggantinya dengan status visual seketika `⚡ Merancang Ulang via AI...` serta toast notifikasi langsung.
  - Menyematkan query parameter unik anti-cache (`?t=${Date.now()}_...`) pada URL setiap gambar slide.

### 2. Masalah: "Desain Masih Sangat Jauh untuk Siap Produksi" & "Logo Menutupi Seluruh Layar"
- **Akar Masalah:**
  - Pada layout lama `cover-stat`, jika berita tidak memiliki angka singkat, seluruh teks berita (120+ karakter) dirender dengan font 76px Archivo Black tanpa pembatas kontainer kartu sehingga menutupi seluruh layar slide.
  - Pada engine lama Satori, kombinasi properti CSS `borderLeft` dengan `borderRadius` pada elemen kartu menghasilkan artefak pemotongan sudut (*corner-clipping glitch*).
  - Tidak adanya brand logotype resmi dan category pill di header slide.
- **Solusi yang Diterapkan:**
  - Memperbarui arsitektur visual di [`services/render/engine.js`](file:///root/gapura/services/render/engine.js) secara ketat mengacu pada **Brand Guidelines Gapura Media**:
    - **Header:** Logotype terstruktur `GAPURA` (Archivo Black Navy `#102B45`) + `MEDIA` (Inter Bold Deep Teal `#1F7E81`) + Titik Golden Amber (`#D79344`), Badge Kategori Pill Deep Teal, dan Slide Counter Pill `01 / 05`.
    - **Slide 1 Cover:** Menambahkan Eyebrow kicker `● LAPORAN KHUSUS · @GAPURAMEDIA`, judul adaptif (38px–52px) dengan leading yang rapi, card metrik dengan internal accent bar (menghilangkan *corner-clipping glitch*), serta tombol pengarah swipe `GESER KE KIRI UNTUK ANALISIS ➔`.
    - **Slide Isi:** Menggunakan kontainer kartu dengan border `#DED9CC`, tipografi berkontras tinggi, dan layout komparasi dua sisi (*dual-perspective*).
    - **Slide Penutup:** Mengganti emoji kecil dengan tiga Action Badge rapi (`[SIMPAN]`, `[BAGIKAN]`, `[DISKUSI]`) dan kotak Disclaimer resmi.
  - **Re-render Massal:** Menjalankan script re-render massal untuk seluruh 15 draf yang ada di database sehingga semua gambar di disk seketika terbarui ke visual baru.

### 3. Masalah: API Key Gemini Deprecated Endpoint
- **Akar Masalah:**
  - Model `gemini-2.0-flash` dan `gemini-2.5-flash` sebelumnya mengembalikan error 404 pada endpoint Google GenAI.
- **Solusi yang Diterapkan:**
  - Mengonfigurasi seluruh pipeline ke `gemini-3.5-flash-lite` dengan API key yang diambil dari environment, menghasilkan kecepatan inferensi perancangan carousel < 2 detik per draf.

### 4. Masalah: URL Endpoint Render di Copywriter Pipeline
- **Akar Masalah:**
  - Pada `produceSingleTopicDraft`, fungsi memanggil `fetch(RENDER_SERVICE_URL)` tanpa path `/render`, mengakibatkan error HTTP 404 saat memproduksi topik baru dari radar.
- **Solusi yang Diterapkan:**
  - Memperbaiki endpoint menjadi `${RENDER_SERVICE_URL}/render` sehingga produksi topik berjalan mulus.

### 5. P2 — Sumber Kebenaran Scheduler Native (Selesai)

Snapshot historis sebelum reset evaluasi. Status aktif pada tabel ini sudah
digantikan penjedaan yang tercatat di [laporan reset](EDITORIAL_WORKSPACE_RESET_20261116.md).
Tidak ada aktivasi kembali otomatis selama owner menilai desain/isi baru.

Lingkup scheduler P2 selesai diverifikasi secara read-only pada 16 November
2026. Definisi unit yang terpasang, drop-in, dan status runtime systemd menjadi
acuan operasional. Keempat berkas [`deploy/`](../deploy/) adalah template
terlacak untuk redeploy; pada pemeriksaan ini seluruhnya cocok dengan unit di
`/etc/systemd/system/` dan tidak memiliki drop-in.

| Jalur | Konfigurasi terverifikasi | Hasil pemeriksaan |
| :--- | :--- | :--- |
| Intake | `gapura-pipeline.timer`: `OnCalendar=*:0/15`, `Persistent=false`, `RandomizedDelaySec=30`. Oneshot `gapura-pipeline.service` menjalankan `scripts/run_pipeline.sh` dengan `GAPURA_ENABLE_DELIVERY=false`; `flock -n` mencegah eksekusi bertumpuk (default `/tmp/opencode/gapura-pipeline.lock`). | Timer `enabled`, `active (waiting)`; service terakhir `Result=success`, `ExecMainStatus=0`. |
| Publisher | `gapura-publisher.timer`: `OnBootSec=3min`, `OnUnitActiveSec=10min`, `AccuracySec=30s`. Oneshot `gapura-publisher.service` menjalankan worker Meta; journal pemeriksaan P2 mengonfirmasi mode runtime `shadow`, yang tidak ditetapkan oleh timer. | Timer `enabled`, `active (waiting)`; service terakhir `Result=success`, `ExecMainStatus=0`. |

`GET /api/workflow` membaca scheduler intake dari systemd melalui
[`services/web/scheduler.js`](../services/web/scheduler.js), lalu mengembalikan
status, jadwal berikutnya, pemicu terakhir, interval 15 menit, serta
`delivery_enabled=false`. Endpoint dan toggle workflow dashboard hanya mencakup
intake; status publisher diperiksa terpisah.

n8n tetap tersedia sebagai canvas/fallback manual (`hme-n8n.service` teramati
`active (running)`). `workflow.json`/ekspor workflow dan flag `active` database
n8n hanya menjadi referensi canvas/riwayat. Workflow otomatis lama
`d3j0Kr9koCQFlRIG` terverifikasi read-only pada snapshot P2 16 November 2026
dengan `active=f` dan `execution_count=0`. Flag tersebut tidak menjadi bukti
timer aktif.

Acceptance lingkup scheduler P2:

- [x] Dua timer native terverifikasi aktif; keempat unit terpasang cocok dengan template deploy.
- [x] Perintah operasional mencakup `systemctl list-timers --all 'gapura-*'`, `status`, `show`, dan `journalctl`, termasuk `NextElapseUSecMonotonic` untuk publisher; lihat [README](../README.md).
- [x] `inactive (dead)` pada service oneshot di antara eksekusi dijelaskan sebagai kondisi normal; hasil diperiksa melalui `Result`, `ExecMainStatus`, timestamp, dan journal.
- [x] Penyelesaian scheduler memakai native timer yang sudah terpasang, tanpa menambahkan cron atau mengaktifkan workflow otomatis n8n.

### 6. P2 — Audit Skor Historis & Validasi Constraint (Selesai)

[Laporan audit P2](P2_SCORE_INTEGRITY_AUDIT.md) mencatat snapshot
`2026-11-16T11:23:55Z` (18:23:55 WIB): 1.062 baris `topic_scores` hingga ID
1062, dengan mismatch total, nilai di luar rentang, dan NULL masing-masing 0.
Mapping produksi adalah identitas: seluruh nilai historis dipertahankan,
termasuk verdict `passed` dan `rejected` pada skor 75; tidak ada koreksi atau
`UPDATE` yang diterapkan.

[SQL audit read-only](../database/audits/topic_scores_integrity.sql) mendahului
[migrasi validasi eksplisit](../database/migrations/20261116_validate_topic_scores.sql)
yang dapat diulang. `VALIDATE CONSTRAINT topic_scores_component_total` berhasil;
`convalidated=true` sebelum dan sesudahnya. Migrasi menolak data invalid dengan
SQLSTATE `23514` dan tidak memperbaiki skor otomatis. Mapping, checksum
sebelum–sesudah, lokasi backup privat, dan bukti pengujian ada di laporan audit.

---

## 3. Fitur yang Belum Lengkap / Belum Dikerjakan (Roadmap Sisa)

Berikut adalah rincian fungsionalitas yang masih dalam antrean pengembangan untuk fase berikutnya:

### 1. Aktivasi Publikasi Meta Live

Adapter berada di `services/publisher/meta.js`; worker terpisah di `services/publisher/meta-worker.js`. Page Gapura Media (`102321216076547`) dan Instagram `@gapuramedia` (`17841471438781611`) dapat dibaca menggunakan Page token yang tersimpan di `/etc/gapura/runtime.env` (mode `0600`). File `.env` proyek merupakan symlink ke berkas runtime tersebut.

Mode operasional saat ini `META_PUBLISH_MODE=shadow`, `META_PLATFORMS=instagram,facebook`. Tidak ada posting live yang diuji. Dua draf historis berstatus `scheduled` belum mempunyai laporan verifikasi; empat target platformnya diblokir gate. Pengujian unit membuktikan jalur shadow dan publish menggunakan fixture, bukan publikasi nyata.

Target terikat ke `schedule_id` dan hash konten yang disetujui. Worker hanya mengklaim akun aktif dengan jadwal yang sudah jatuh tempo, satu percobaan per target per siklus. Konten dan gate diperiksa kembali dalam row lock tepat sebelum publish; timeout atau kegagalan pencatatan setelah percobaan remote menghasilkan `unknown`. Publikasi foto Facebook tunggal mengikuti aturan yang sama. Publisher legacy menyerahkan pekerjaan ketika `META_PLATFORMS` terpasang, dan tidak dipanggil dari pipeline intake.

Langkah yang masih diperlukan:

1. Berikan `instagram_content_publish` dan `pages_manage_posts` pada aplikasi/token Meta yang benar. Token saat ini tidak memiliki kedua izin tersebut; pemeriksaan `content_publishing_limit` menghasilkan code 10.
2. Redaktur meninjau dan menyetujui draf yang mempunyai laporan `verified`, confidence 80–100, serta sumber dan skor Analis yang memenuhi gate. Jangan membuat laporan verifikasi palsu atau mengubah status untuk melewati review.
3. Setelah izin dan draf uji tersedia, jalankan satu target yang disetujui; simpan `remote_id` dan permalink sebelum mengaktifkan siklus live rutin. Status `unknown`/`publishing` membutuhkan rekonsiliasi manual dan tidak boleh direset secara otomatis.
4. Threads membutuhkan `META_THREADS_USER_ID` dan `META_THREADS_ACCESS_TOKEN` tersendiri. Platform ini tetap nonaktif sampai kredensial dan akses resminya terverifikasi.

PNG tetap digunakan untuk preview dan ZIP; JPEG publikasi sudah dibuat untuk 184 slide historis. URL JPEG bertanda tangan terbukti dapat diakses dari domain publik (HTTP 200 `image/jpeg`), sedangkan URL tanpa signature ditolak 403.

Konfigurasi operasional dan unit systemd tersedia di [README](../README.md) dan direktori [deploy](../deploy/).

### 2. Aktivasi Bot Notifikasi & Approval Telegram
- **Kondisi Saat Ini:**
  Modul logika Telegram bot sudah tersedia di `services/telegram/`, namun belum aktif berjalan karena belum adanya token bot resmi.
- **Kebutuhan untuk Penyelesaian:**
  1. Membuat bot melalui `@BotFather` di Telegram untuk mendapatkan `TELEGRAM_BOT_TOKEN`.
  2. Mendapatkan `TELEGRAM_CHAT_ID` dari channel atau grup redaksi.
  3. Mengaktifkan `hme-telegram.service` agar redaktur dapat menerima notifikasi setiap ada draf baru dan melakukan review via Inline Keyboard (Setujui / Tolak / Edit) langsung dari HP.

### 3. UI Kalender Konten Interaktif (Drag & Drop Scheduler)
- **Kondisi Saat Ini:**
  Menu "Kalender" di dashboard saat ini menampilkan placeholder tampilan jadwal bulanan sederhana.
- **Kebutuhan untuk Penyelesaian:**
  1. Integrasi library kalender visual (misal FullCalendar atau custom CSS Grid schedule).
  2. Fitur drag-and-drop kartu draf ke tanggal dan slot jam posting tertentu (09:00 WIB, 12:00 WIB, 19:00 WIB).
  3. Endpoint backend untuk mengubah jadwal PostgreSQL yang dikonsumsi timer publisher.

### 4. Sistem Autentikasi Pengguna & Hak Akses (Multi-Role Auth)
- **Kondisi Saat Ini:**
  Dashboard dibuka langsung tanpa halaman login, token admin, atau cookie sesi. API dashboard dapat diakses tanpa autentikasi; validasi Origin tetap aktif dan key provider tetap disembunyikan dari respons. Multi-user dan pembagian role belum tersedia.
- **Kebutuhan untuk Penyelesaian:**
  1. Penambahan tabel `users` dan skema password hashing (bcrypt/argon2).
  2. Implementasi login berbasis sesi/JWT atau integrasi Google SSO (`sign-in-with-google`).
  3. Pembagian peran pengguna: *Editor-in-Chief* (Approval & Post), *Writer* (Edit & Generate), dan *Viewer* (Read-only).

### 5. Modul Visual Charting Saham Lanjutan (Candlestick & Technicals)
- **Kondisi Saat Ini:**
  Engine Satori mendukung `chart-bar` dan `chart-line` sederhana.
- **Kebutuhan untuk Penyelesaian:**
  1. Integrasi generator lightweight canvas/SVG untuk chart candlestick bursa (OHLC) dan volume bandarmology.
  2. Pemetaan data otomatis dari feed bursa (IDX/Yahoo Finance) ke koordinat slide carousel.
