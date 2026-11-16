# 🏛️ Gapura Media Engine (GME v2.1)
> **Sistem Otomasi Konten Instagram Data-Editorial & Regulasi Finansial**  
> Akun Instagram Resmi: **[`@gapuramedia`](https://instagram.com/gapuramedia)**  
> Portal Dashboard: **[https://gapura.avenia.my.id](https://gapura.avenia.my.id)** · Orkestrasi Workflow: **[https://n8n.avenia.my.id](https://n8n.avenia.my.id)**

---

## 📌 Ringkasan Proyek

**Gapura Media Engine (GME v2.1)** adalah platform otomasi ruang redaksi modern (*newsroom automation*) yang dirancang khusus untuk akun Instagram niche: **data pasar modal & bursa saham, regulasi hukum keuangan (OJK/BI/MK), dan indikator makro ekonomi Indonesia**.

Platform ini menggabungkan **7 agen** dengan pengawasan manusia (*Human-in-the-Loop*), mesin render deterministik berbasis SVG-to-PNG (*Satori + Sharp*), serta dashboard editorial berbasis web yang responsif. Scout dan SEO mengumpulkan serta menilai momentum secara deterministik; agen produksi memakai model sesuai konfigurasi provider.

```
   ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
   │  AGEN SCOUT  │   │   AGEN SEO   │   │ AGEN VERIFIKATOR │
   │ (Kurasi RSS) │   │(Trending/X)  │   │ (Fact-Check)     │
   └──────┬───────┘   └──────┬───────┘   └─────────┬────────┘
          │                  │                     │
          └──────────► ┌─────▼──────┐ ◄────────────┘
                       │ AGEN ANALIS│
                       │(Skor 0-100)│
                       └─────┬──────┘
                             │
                             ▼
                    ┌────────────────┐     ┌────────────────┐
                    │ AGEN DESIGNER  │ ──► │AGEN COPYWRITER │
                    │(AI Dir. Visual)│     │ (Prosa Berita) │
                    └────────────────┘     └───────┬────────┘
                                                   │
                                                   ▼
                                        ┌─────────────────────┐
                                        │ RENDER MICROSERVICE │
                                        │   (Satori + Sharp)  │
                                        └──────────┬──────────┘
                                                   │
                                                   ▼
                                        ┌─────────────────────┐
                                        │    WEB DASHBOARD    │
                                        │ (Review & Posting)  │
                                        └─────────────────────┘
```

---

## ✨ Fitur-Fitur Utama yang Telah Aktif & Siap Produksi

1. **Dashboard Review Editorial Realtime**
   - Panel pemantauan metrik kurasi: jumlah item mentah, topik lolos analisis, draf siap review, dan postingan terbit.
   - Status kesehatan layanan real-time (Web Dashboard, Render Engine, Database PostgreSQL, dan n8n).
2. **Radar Topik Niche & 1-Click Auto-Produce**
   - Agregasi berita otoritas resmi (BPS, Bank Indonesia, OJK, Mahkamah Konstitusi, JDIH, Bursa Efek Indonesia).
   - Filter topik: *Semua Topik*, *Lolos (≥76)*, *Gugur / Fast-Fail*, dan *Diproduksi*.
    - **1-Click Auto-Produce:** Produksi topik yang lolos Analis dan memiliki laporan verifikasi menjadi draf, lalu buka editor untuk review. Durasi bergantung pada model, jaringan, dan jumlah slide.
3. **Editor Draf & Pratinjau Carousel Live**
   - Menampilkan visual slide beresolusi tinggi (1080×1350 px rasio 4:5).
   - Strip thumbnail interaktif untuk navigasi cepat antar slide.
   - Editor teks narasi, pengubah layout slide, pengaturan parameter metrik angka, caption Instagram, dan tagar.
   - **Simpan & Render Ulang Seketika:** Render ulang slide tunggal dalam < 200 ms dengan pembaruan pratinjau live tanpa reload halaman.
4. **AI Creative Director (Designer Otonom)**
   - Perancangan arsitektur visual berbasis AI (`gemini-3.5-flash-lite`) yang bebas dan tidak kaku dengan template tertentu.
    - Single memakai 1 slide; carousel 3–9 slide mengikuti kecukupan bukti.
   - **Tombol Regenerate AI Instan:** Rancang ulang seluruh carousel secara adaptif dalam 1 klik tanpa dialog popup yang memblokir.
5. **Studio Desain & Pembuatan Postingan Kustom**
   - Membuat postingan mandiri on-the-fly dari form Studio Desain.
   - Pratinjau live perubahan token desain (palet warna `#102B45` Navy, `#1F7E81` Deep Teal, `#D79344` Golden Amber) di kanvas simulator ponsel.
6. **Kustomisasi Penuh 7 Agen AI & Skills.md**
   - Konfigurasi independen untuk setiap agen: Provider (Gemini / OpenAI Compatible), Endpoint, API Key, Model, dan System Prompt.
   - **Editor `skills.md` Kustom:** Setiap agen dapat disematkan berkas panduan eksekusi mandiri di `/root/gapura/config/skills/`.
7. **Manajemen Sumber Berita Niche**
   - Tambah, edit, aktifkan/nonaktifkan feed RSS dan portal sumber berita resmi secara dinamis dari dashboard.
8. **Render Microservice Deterministik (Satori + Sharp)**
   - Footprint memori sangat ringan (~65 MB RAM, tanpa Chromium headless).
   - Menghasilkan gambar PNG jernih 1080×1350 px 96 DPI dengan font resmi: `Archivo Black` dan `Inter`.
9. **Anti-Cache & CDN Bypass Architecture**
   - Header HTTP anti-stale (`Cache-Control: no-store, no-cache, must-revalidate`, `Surrogate-Control: no-store`) memastikan Cloudflare CDN dan browser tidak menyajikan skrip atau gambar usang.
   - Automatic query busting unik `?t=${Date.now()}_...` pada seluruh aset dinamis.

10. **Agen SEO — Radar Trending (Sumber X Dapat Dikustomisasi)**
    - Memindai akun X (`@handle`), query X, Google Trends geo, dan momentum Google News; daftar sumber dapat ditambah/diubah langsung dari dashboard (**Radar Trending**).
    - Skor virality menimbang bobot sumber, kesegaran, angka, dan relevansi niche; item teratas dapat dipromosikan menjadi topik editorial dengan satu klik.
    - Tanpa `X_BEARER_TOKEN`, jalur X otomatis dialihkan ke Google News dan provider yang benar-benar dipakai dicatat pada setiap item (tidak menyamar sebagai data X).

11. **Agen Verifikator — Fact-Check & Anti-Miskonsepsi**
    - Memisahkan fakta, opini, spekulasi, konten menyesatkan, dan hoaks melalui sinyal deterministik (tier sumber, klaim angka, hedge/clickbait), korroborasi lintas media (Google News RSS + kemiripan judul lokal `pg_trgm`), dan rubrik LLM.
    - Setiap laporan memuat klaim yang diuji, penjelasan mendalam, miskonsepsi yang perlu diluruskan, sinyal risiko, rujukan, dan disclaimer redaksi.
    - Status `hoax_detected` memblokir produksi dan persetujuan (HTTP 409), termasuk permintaan force; konteks verifikasi disertakan dalam draf.

12. **Katalog Provider & Model Multi-Provider**
    - Registry provider (`services/common/providers.js`) mendukung Gemini, OpenAI-compatible, dan Anthropic: MASB, 9router, OpenRouter, NVIDIA, agent router, endpoint custom, serta provider resmi.
    - Model diambil live dari `/models` tiap provider, di-cache di `config/models.cache.json`, dan dapat diuji dari dashboard tanpa menyimpan perubahan.
    - Rantai fallback global lintas provider (Gemini-first) dengan klasifikasi error `retryable`, sehingga halaman blokir/gateway rusak tidak mematikan seluruh rantai.
    - API key per provider disimpan terpisah di `/etc/gapura/provider-keys.json` (`0600`), tidak pernah dikembalikan ke browser.

13. **Publisher Multi-Platform Meta**
    - Tiga adapter terpisah: Instagram Graph (single/carousel), Facebook Pages (foto/feed), dan Threads (image/carousel).
    - State publikasi per draf/platform/akun di tabel `publication_targets`; hasil ambigu disimpan sebagai `unknown` dan tidak pernah di-retry buta.
    - Mode `shadow` (default) mencatat rencana publikasi tanpa panggilan jaringan; mode `live` hanya aktif lewat `META_PUBLISH_MODE=live`.
    - Derivatif JPEG `slide_<n>.jpg` dibuat otomatis di samping PNG dan disajikan lewat URL bertanda tangan berbatas waktu.
    - Gate editorial (`needs_review=false`, verifikasi `verified` + confidence ≥ 80) tetap wajib; publisher berjalan pada timer sendiri, bukan pada siklus intake 15 menit.

14. **Studio Prompt (v2.2)** — produksi konten dari satu prompt admin:
    - Admin menulis permintaan bebas (analisis mendalam, verifikasi fakta, perspektif alternatif, opini, dll).
    - AI menyusun rencana terstruktur (judul, sudut pandang, tujuan, poin isi) yang bisa diedit manual, di-generate ulang dengan instruksi revisi, atau langsung diproduksi.
    - Job queue berbasis Postgres (`prompt_jobs` + `job_logs` + `llm_usage`): topik -> verifikasi -> draft + render -> Telegram review.
    - Mode `review` menunggu ACC admin; publikasi terjadwal tetap mengikuti gate editorial dan persetujuan redaktur.
    - Progres real-time per langkah lewat SSE di dashboard; `hoax_detected` memblokir produksi job.

---

## 🚀 Panduan Cepat Penggunaan Aplikasi

Panduan lengkap langkah demi langkah tersedia di:  
👉 **[`docs/PANDUAN_PENGGUNAAN.md`](file:///root/gapura/docs/PANDUAN_PENGGUNAAN.md)**

### Alur Kerja Harian Redaktur:
1. Buka dashboard di browser: **`https://gapura.avenia.my.id`**.
2. (Opsional) Buka **Radar Trending** untuk memindai berita/percakapan naik daun, lalu promosikan trend menjadi topik editorial.
3. Masuk ke menu **Radar Topik**, pilih berita terverifikasi yang menarik, dan klik judulnya.
4. Sistem menjalankan Agen Verifikator, lalu AI Designer & Copywriter; draf terbuka di **Antrian Review**.
5. Periksa visual slide, gunakan tombol panah atau strip thumbnail untuk memeriksa slide 1 sampai penutup.
6. Jika ingin sudut pandang visual baru, klik **`✨ Regenerate AI (Desain Ulang)`**.
7. Sesuaikan teks jika diperlukan, lalu klik **`🔄 Simpan & Render Ulang Slide`**.
8. Salin caption melalui tombol **`📋 Salin Caption & Hashtags`** atau unduh seluruh gambar melalui **`📥 Download Semua Slide (ZIP)`**.

---

## 🛠️ Stack Teknologi

- **Backend & API Server:** Node.js v24 (ESM), Express.js
- **Render Engine:** `@vercel/satori` (JSX to SVG) + `sharp` (SVG to PNG)
- **Basis Data:** PostgreSQL 17 (Database `hme` untuk konten & `n8n` untuk orkestrasi)
- **AI Models:** Registry multi-provider (`config/providers.json` + key per provider) — Gemini, OpenAI-compatible, Anthropic; model catalog live per provider
- **Orkestrasi Alur Kerja:** Systemd timer native (`gapura-pipeline.timer` 15 menit, `gapura-publisher.timer` 10 menit); n8n Community Edition tetap berjalan sebagai kanvas/fallback manual, bukan penjadwal utama
- **Reverse Proxy & Edge:** Cloudflare Tunnel + Cloudflare Edge (`cloudflared`)
- **Process Manager:** Systemd Linux Services (`hme-web.service`, `hme-render.service`, `hme-n8n.service`)

---

## 📋 Status Pengembangan, Isu & Roadmap

Dokumen evaluasi teknis, daftar permasalahan yang telah diselesaikan, dan fitur yang belum selesai dapat dibaca di:  
👉 **[`docs/STATUS_DAN_ROADMAP_FITUR.md`](file:///root/gapura/docs/STATUS_DAN_ROADMAP_FITUR.md)**

### Ringkasan Status Fitur:
- [x] Web Review Dashboard Responsif (Desktop & Mobile)
- [x] Microservice Render Satori + Sharp (1080x1350 px)
- [x] Migrasi Identitas Penuh ke Brand Guidelines Gapura Media (`@gapuramedia`)
- [x] AI Creative Director (Agen Designer adaptif bebas template kaku)
- [x] 1-Click Auto-Produce dari Radar Topik
- [x] Eliminasi Masalah Cloudflare Cache Staling & Dialog `confirm()`
- [x] Kustomisasi Penuh 7 Agen AI & berkas `skills.md` per agen
- [x] Manajemen Sumber Berita Niche Dinamis
- [x] Agen SEO (Radar Trending) dengan sumber X/Google Trends yang dapat dikustomisasi
- [x] Agen Verifikator (fact-check, anti-miskonsepsi, gate hoaks)
- [x] Katalog Provider & Model multi-provider (registry + fallback lintas provider + uji dari dashboard)
- [x] Publisher Meta multi-platform (Instagram/Facebook/Threads) + timer `gapura-publisher.timer` *(mode shadow; publish live menunggu izin `instagram_content_publish` & `pages_manage_posts`)*
- [ ] Aktivasi publish Meta live *(menunggu izin Meta App)*
- [ ] Bot Notifikasi & Approval Telegram *(engine siap, menunggu `TELEGRAM_BOT_TOKEN`)*
- [ ] UI Kalender Konten Interaktif (Drag & Drop Scheduler)
- [ ] Sistem Autentikasi Pengguna & Hak Akses Berjenjang (Multi-Role)
- [ ] Modul Charting Saham Lanjutan (Candlestick & Volume Bandarmology)

---

## 💻 Operasional Layanan (Systemd Commands)

```bash
# Cek status layanan
systemctl status hme-web.service hme-render.service hme-n8n.service

# Restart web dashboard & render engine
systemctl restart hme-render.service && systemctl restart hme-web.service

# Live monitoring log web dashboard
journalctl -u hme-web.service -f

# Live monitoring log render service
journalctl -u hme-render.service -f

# Jadwal intake dan publisher (publisher saat ini shadow)
systemctl list-timers 'gapura-*'
journalctl -u gapura-publisher.service -n 30 --no-pager
```

Unit yang dapat dipasang ulang tersedia di [`deploy/`](deploy/). Secret runtime
berada di `/etc/gapura/runtime.env` dan `/etc/gapura/admin-token.env` (`0600`),
tidak dimasukkan ke Git. `META_PUBLISH_MODE=shadow` dan
`META_PLATFORMS=instagram,facebook` adalah konfigurasi aktif. Publikasi live
menunggu izin `instagram_content_publish` dan `pages_manage_posts`, serta satu
draf yang sudah diverifikasi dan disetujui redaktur. Threads membutuhkan token
dan user ID tersendiri.

Langkah pemberian izin, review, uji live, serta rekonsiliasi tersedia di
[`docs/META_PUBLISHING_RUNBOOK.md`](docs/META_PUBLISHING_RUNBOOK.md).

---
*© 2026 Gapura Media — Portal Data, Hukum & Ekonomi Bursa Indonesia.*
