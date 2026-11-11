# 📊 Status Fitur, Permasalahan, & Roadmap Pengembangan
> **Repositori:** `aryarifki/gapura` · **Aplikasi:** Gapura Media Engine (GME v2.0)  
> **Brand Identity:** `@gapuramedia` · **Portal Live:** [https://gapura.avenia.my.id](https://gapura.avenia.my.id)

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
| **Kustomisasi 4 Agen AI & Skills.md** | ✅ **Selesai & Aktif** | Pengaturan endpoint, API key, model, system prompt, dan berkas `skills.md` kustom per agen di `/root/gapura/config/skills/`. |
| **Manajemen Sumber Berita Niche** | ✅ **Selesai & Aktif** | Menambah, mengedit, melihat status, dan menonaktifkan feed RSS / portal data otoritas (BPS, BI, OJK, MK, JDIH). |
| **Bypass Cache CDN (Cloudflare)** | ✅ **Selesai & Aktif** | Middleware HTTP `no-store, no-cache`, query string bust unik `?t=...`, dan asset versioning `v=3.5.0` mencegah browser/CDN menyajikan file usang. |
| **Audit Log & Activity Tracker** | ✅ **Selesai & Aktif** | Pencatatan setiap aksi editorial (create, edit_slide, approve, reject, regenerated_ai) ke tabel `audit_log` PostgreSQL. |
| **Instagram Direct Publishing (Graph API)** | ⏳ **Belum Lengkap** | Saat ini workflow menghasilkan caption + hashtags + download PNG. Integrasi direct publish membutuhkan Meta App ID, Secret, & Long-Lived Token resmi akun Instagram Business. |
| **Telegram Approval Bot** | ⏳ **Belum Dikonfigurasi** | Engine dan kode notifikasi Telegram telah siap, namun menunggu input token Bot Telegram (`TELEGRAM_BOT_TOKEN`) dan Chat ID admin dari owner agar bot dapat aktif di polling. |
| **Kalender Konten Interaktif** | ⏳ **Belum Dikerjakan** | Tampilan kalender grid visual bulanan dengan fitur drag-and-drop jadwal postingan belum diimplementasikan (saat ini status jadwal berbasis form & n8n cron). |
| **Multi-User Role & Autentikasi Login** | ⏳ **Belum Dikerjakan** | Dashboard saat ini bersifat single-admin internal tanpa form login/otentikasi sesi JWT/OAuth. Dilindungi di level network (Cloudflare/VPN). |
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

---

## 3. Fitur yang Belum Lengkap / Belum Dikerjakan (Roadmap Sisa)

Berikut adalah rincian fungsionalitas yang masih dalam antrean pengembangan untuk fase berikutnya:

### 1. Integrasi Langsung Meta Graph API (Instagram Auto-Publish)
- **Kondisi Saat Ini:**
  Aplikasi menyediakan tombol "Download Semua Slide (ZIP)" dan "Salin Caption + Hashtags", serta tombol "Sudah Diposting Manual" untuk menandai status draf.
- **Kebutuhan untuk Penyelesaian:**
  1. Akun Instagram Bisnis yang terhubung ke Facebook Page resmi Gapura Media.
  2. Pendaftaran Meta Developer App (dengan izin `instagram_basic`, `instagram_content_publish`).
  3. Konfigurasi kredensial di `.env`:
     ```env
     META_APP_ID=...
     META_APP_SECRET=...
     META_INSTAGRAM_ACCOUNT_ID=...
     META_LONG_LIVED_ACCESS_TOKEN=...
     ```
  4. Implementasi endpoint `services/publisher/meta.js` yang mengunggah gambar ke container carousel Meta Graph API dan mempublikasikannya secara otomatis saat draf disetujui.

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
  3. Endpoint backend untuk sinkronisasi jadwal ke cron job n8n.

### 4. Sistem Autentikasi Pengguna & Hak Akses (Multi-Role Auth)
- **Kondisi Saat Ini:**
  Dashboard dapat diakses langsung oleh siapa saja yang memiliki tautan domain `https://gapura.avenia.my.id` (mengandalkan proteksi Cloudflare Access atau network firewall).
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
