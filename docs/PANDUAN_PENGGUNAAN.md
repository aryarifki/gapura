# 📖 Panduan Penggunaan Gapura Media Engine (GME v2.1)
> **Akun Resmi:** `@gapuramedia` · **Portal Dashboard:** [https://gapura.avenia.my.id](https://gapura.avenia.my.id)  
> **Fokus editorial:** Politik, sosial, hukum, lingkungan, ekonomi nasional, dan bursa saham Indonesia.

**Status 17 November 2026:** R4 discovery enam desk dan R5 penghapusan
Verifikator selesai; unit/DB/API/browser/render serta DOM layanan aktif lulus.
R6 (naskah orisinal dua mode, tanpa body/summary penerbit,
carousel-first enam slide dan caption isi 1.200–1.900 karakter) belum diterapkan.
Timer intake/publisher tetap `disabled/inactive`, worker background
`GAPURA_DISABLE_WORKERS=true`, dan tidak ada publikasi nyata. Raster AI nyata
masih tertahan quota 0; tidak ada permintaan ulang atau perpindahan provider gambar.

---

## 📑 Daftar Isi
1. [Ringkasan Alur Kerja Redaksi](#1-ringkasan-alur-kerja-redaksi)
2. [Navigasi Antarmuka (Dashboard Overview)](#2-navigasi-antarmuka-dashboard-overview)
3. [Radar Topik: Menemukan & Memproduksi Berita](#3-radar-topik-menemukan--memproduksi-berita)
4. [Antrian Review & Editor Draf Carousel](#4-antrian-review--editor-draf-carousel)
5. [AI Designer: Regenerate AI & Kustomisasi Kreatif](#5-ai-designer-regenerate-ai--kustomisasi-kreatif)
6. [Studio Desain & Postingan Kustom](#6-studio-desain--postingan-kustom)
7. [Kustomisasi AI Agents & Skills.md](#7-kustomisasi-ai-agents--skillsmd)
8. [Manajemen Sumber Discovery Enam Desk](#8-manajemen-sumber-discovery-enam-desk)
9. [Operasional Server & Systemd Service](#9-operasional-server--systemd-service)

---

## 1. Ringkasan Alur Kerja Redaksi

Aplikasi ini menyiapkan alur kerja redaksi Instagram dengan prinsip
**Human-in-the-Loop**. Enam agen aktif adalah **Scout, Analis, Copywriter,
Designer, SEO, dan Studio**:

```
[Sumber Resmi & Feed Discovery] (BPS, BI, OJK, MK, IDX, media nasional)
       │
       ▼ (Pemicu manual; polling otomatis sedang dijeda)
[SCOUT] ──► Deduplikasi, desk dan metadata discovery
       │
       ◄── [SEO: momentum isu dan promosi topik]
       │
       ▼
[ANALIS] ──► Skor 0–100 dan Fast-Fail (ambang mengikuti konfigurasi)
       │
       ├── [STUDIO: prompt dan rencana editorial untuk topik terpilih]
       │
       ▼ (Buat draf review)
[DESIGNER + COPYWRITER] ──► Visual, naskah, caption dan hashtags
       │
       ▼
[RENDER SERVICE] ──► Deterministic Node.js (Satori + Sharp) -> 1080×1350 px PNG
       │
       ▼
[WEB DASHBOARD] ──► Review revisi terkini -> Edit / Unduh / Persetujuan jadwal
```

Produksi/review tidak meminta laporan mesin. API/UI/config/skill Verifikator
telah dilepas pada R5; tabel dan kolom historis tetap diarsipkan. Jalur naskah
legacy masih digunakan sampai R6, sehingga proyeksi discovery R4 tidak berarti
seluruh input penulisan sudah bebas body/summary penerbit.

---

## 2. Navigasi Antarmuka (Dashboard Overview)

Akses dashboard melalui browser: **`https://gapura.avenia.my.id`**

Tampilan dirancang dalam gaya *Dark Studio Editorial* yang elegan dan responsif:
- **Sidebar Navigasi (Kiri):**
  - **Menu Utama:** Overview, Antrian Review, Radar Topik, Kalender, Analitik, Audit Log.
  - **Menu Konfigurasi:** AI Agents & Skills, Sumber Topik, Studio Desain, Token Desain.
- **Header Top Bar:**
  - Status koneksi database & render service (Indikator Hijau).
  - Profil pengguna: `Redaktur Gapura Media`.
- **Panel Statistik Ringkas:**
  - Menampilkan jumlah item mentah masuk, topik lolos kurasi, draf siap review, dan postingan terbit.

---

## 3. Radar Topik: Menemukan & Memproduksi Berita

Menu **Radar Topik** menampilkan hasil pemantauan berita dari sumber-sumber otoritas resmi:
1. Masuk ke menu **Radar Topik**.
2. Anda dapat memfilter berdasarkan status:
   - **Semua Topik**: Seluruh data yang berhasil dijaring oleh Agen Scout.
   - **Lolos (≥76)**: Topik berbobot tinggi yang direkomendasikan Agen Analis.
   - **Gugur / Fast-Fail**: Berita yang gugur karena mengandung clickbait/gimmick dilarang.
   - **Diproduksi**: Topik yang telah memiliki draf.
   - Filter **Desk** memilih Politik, Sosial, Hukum, Lingkungan, Ekonomi Nasional,
     atau Bursa Saham. Badge kartu menunjukkan desk yang tersimpan; topik arsip
     tanpa desk belum di-backfill dan dapat tidak muncul pada filter tertentu.
3. **Membuat Draf Otomatis (1-Click Auto-Produce):**
   - Pilih topik yang lolos Analis dan klik **Buat draf review**.
   - Designer & Copywriter menyiapkan draf tanpa laporan Verifikator. Durasi
     bergantung pada provider, jaringan, jumlah slide dan kesiapan aset.
   - Dashboard akan otomatis berpindah ke **Editor Draf** untuk peninjauan langsung.

Pada **Radar Trending**, kategori sumber mencakup enam desk serta pilihan umum/
lintas isu. Skor momentum dan lolos Analis hanya membantu kurasi; keduanya tidak
memberi izin publikasi tanpa review manusia.

---

## 4. Antrian Review & Editor Draf Carousel

Menu **Antrian Review** adalah meja kerja utama redaktur:
1. **Mode Galeri (Review Queue):**
   - Menampilkan kartu draf lengkap dengan cover thumbnail, skor kelayakan, jumlah slide (misal `1/5`), dan tautan sumber resmi.
   - Klik pada draf mana saja untuk masuk ke **Deep Review & Slide Editor Mode**.
2. **Pratinjau Carousel (Tengah):**
   - Menampilkan visual slide beresolusi tinggi 1080×1350 px rasio 4:5.
   - Gunakan tombol panah `← Sebelumnya` dan `Berikutnya →` atau klik langsung pada strip thumbnail di bawah gambar untuk berpindah slide.
3. **Panel Kontrol Editorial (Kanan):**
   - **Isi Teks / Narasi:** Edit teks slide secara langsung.
   - **Pemilihan Layout Slide:** Pilih layout baku atau pilih `custom` untuk tata letak bebas.
   - **Parameter Layout:** Mengatur nilai angka besar, unit metrik, author kutipan, atau perbandingan kolom.
   - **Caption & Hashtags:** Sesuaikan caption editorial Instagram sebelum
     disetujui. Disclaimer hukum atau investasi hanya dipakai bila relevan dengan
     konteks hukum/bursa; tidak wajib untuk setiap desk.
4. **Tombol Tindakan Utama:**
   - **🔄 Simpan & Render Ulang Slide:** Merender ulang slide aktif secara seketika dan memperbarui pratinjau.
   - **✨ Regenerate AI (Desain Ulang):** Meminta AI Designer merancang ulang seluruh carousel secara adaptif.
   - **📥 Download Semua Slide:** Mengunduh seluruh slide dalam satu file ZIP untuk arsip atau posting manual.
   - **📋 Salin Caption & Hashtags:** Menyalin caption lengkap beserta tagar ke clipboard dalam satu klik.
   - **⏱️ Setujui (Auto):** Memerlukan konfirmasi review dan revisi yang sedang
     dilihat. Persetujuan mencatat hash isi pada audit; perubahan konten
     membatalkan approval/jadwal dan memerlukan review baru.
   - **📸 Posting Sekarang:** Mode manual mencatat status posting manual pada
     aplikasi; itu bukan bukti panggilan publish ke Meta. Selama evaluasi ini
     jangan menjalankan publikasi nyata.

Jika persetujuan ditolak karena draf berubah, muat ulang dan tinjau kembali
seluruh slide/caption. Publisher Meta dan legacy memeriksa audit approval
manusia dan hash revisi terkini, `needs_review=false`, serta prasyarat
jadwal/akun/aset. Meta juga memeriksa sumber dan skor Analis. Pemeriksaan ulang
dilakukan dalam row lock sebelum panggilan publikasi akhir; hasil ambigu perlu
rekonsiliasi manual, tanpa retry buta.

---

## 5. AI Designer: Regenerate AI & Kustomisasi Kreatif

Jika draf bawaan terasa kurang variatif atau Anda ingin sudut pandang visual baru:
1. Buka draf di **Editor Review**.
2. Klik tombol **`✨ Regenerate AI (Desain Ulang)`** di bagian atas kanan editor.
3. Tombol akan berubah status menjadi `⚡ Merancang Ulang via AI...`.
4. Jika model/provider tersedia, Agen Designer akan:
   - Menentukan format dan jumlah slide menurut konfigurasi legacy: single 1
     slide atau carousel 3–9 slide.
   - Menentukan arsitektur visual terbaik (Cover Editorial, Stat Spotlight, Dual Perspective, Takeaway Points, Regulasi, dll).
   - Meminta Render Service merender seluruh gambar PNG baru ke disk.
   - Memperbarui layar browser Anda secara otomatis tanpa perlu me-refresh halaman.

Regenerasi layout/naskah berbeda dari permintaan raster ilustrasi AI. Quota
gambar nyata masih **0**, sehingga keberhasilan fixture/render lokal tidak
membuktikan generasi gambar provider atau penerimaan visual owner. Permintaan
gambar tidak diulang dan provider tidak diganti. Default enam slide
carousel-first dan caption isi 1.200–1.900 karakter menunggu implementasi R6.

---

## 6. Studio Desain & Postingan Kustom

Menu **Studio Desain** diperuntukkan jika redaksi ingin membuat postingan khusus tanpa terpaku pada berita radar:
1. Masuk ke menu **Studio Desain**.
2. **Formulir Pembuatan Draf Kustom:**
   - Masukkan judul berita / tema postingan.
   - Masukkan ringkasan konteks data.
   - Masukkan sumber data resmi (misal: `Bank Indonesia / BPS`).
   - Tentukan preferensi jumlah slide; jalur legacy masih mendukung single atau
     carousel sesuai konfigurasi.
3. Klik **`⚡ Generate Carousel Baru (AI Creative Director)`**.
4. Bila input dan aset siap, draf dan render PNG dibuat untuk **Antrian Review**.
   Missing media atau kegagalan generator tetap ditampilkan; tidak ada tahap
   Verifikator atau persetujuan publikasi otomatis.
5. **Live Pratinjau Desain Token:**
   - Anda dapat bereksperimen mengubah warna latar (`bg`), warna teks (`ink`), aksen (`accent`), dan highlight (`#D79344`).
   - Pratinjau langsung diperbarui seketika di canvas simulator ponsel.

**Studio Prompt** menyusun rencana dari prompt dan topik yang lolos Analis,
lalu menyerahkan hasil ke alur draf/review. Worker background saat ini dijeda
dengan `GAPURA_DISABLE_WORKERS=true`; jangan menganggap job akan diproses otomatis.

---

## 7. Kustomisasi AI Agents & Skills.md

Konfigurasi aktif mencakup **Scout, Analis, Copywriter, Designer, SEO, dan
Studio**; tidak ada tab/config/skill Verifikator:
1. Masuk ke menu **AI Agents & Skills**.
2. Terdapat tab untuk keenam agen:
   - **Scout:** Pengumpul berita, interval polling, dan kata kunci fokus.
   - **Analis:** Rubrik skoring 5 komponen (Relevance, Credibility, Momentum, Engagement, Compliance), ambang batas skor, dan aturan fast-fail.
   - **Copywriter:** Tone of voice, jumlah slide legacy, banned words, dan
     disclaimer hukum/bursa yang opsional.
   - **Designer:** AI Creative Director, kebebasan arsitektur visual, dan tokens warna.
   - **SEO:** Pengumpulan dan skor momentum, kategori enam desk, serta promosi topik.
   - **Studio:** Prompt, rencana editorial, dan format keluaran draf.
3. **Mengganti API Key & Model:**
   - Anda dapat memasukkan API Key Gemini / OpenAI / OpenRouter Anda sendiri.
   - Pilih model/provider dari katalog runtime. Pengaturan model chat tidak
     mengatasi quota gambar 0. Perubahan provider gambar tidak dilakukan dalam
     evaluasi ini; jangan menaruh key di dokumen atau Git.
4. **Editor `skills.md` Kustom:**
   - Di bagian bawah form agen, terdapat textarea **"Kustomisasi Skills.md"**.
   - Masukkan panduan khusus (misal: "Selalu sertakan konteks kebijakan pada slide 2", "Sebutkan dasar hukum hanya jika tersedia").
   - Klik **`💾 Simpan Konfigurasi & Skills`**. Perubahan akan seketika berlaku untuk pemanggilan AI berikutnya.

---

## 8. Manajemen Sumber Discovery Enam Desk

Mengelola feed RSS dan sumber resmi lintas enam desk. Proyeksi discovery hanya
meneruskan topik/judul dan metadata ke Analis/cluster; pemisahan seluruh input
penulisan/desain dari body/summary penerbit menunggu R6:
1. Masuk ke menu **Sumber Topik**.
2. **Melihat Sumber Aktif:**
   - Terdapat sumber resmi (BPS, Bank Indonesia, OJK, Mahkamah Konstitusi, JDIH Kemenkeu) dan feed discovery untuk politik, sosial, hukum, lingkungan, ekonomi, serta bursa. Setiap sumber dapat memiliki **Desk Editorial** eksplisit atau dibiarkan kosong agar desk disimpulkan dari kategori/judul.
3. **Menambah Sumber Baru:**
   - Isi form: Nama Sumber, Kategori registry (default `umum`, **Berita Umum /
     Lintas Isu**), Desk Editorial, URL Feed, Tipe Sumber, dan Frekuensi Polling.
   - Klik **Tambah Sumber**.
4. **Mengedit & Menonaktifkan:**
   - Klik tombol **Edit** untuk mengubah data sumber. Field kategori yang tidak
     dikirim saat PUT dipertahankan; kategori kosong/invalid ditolak. Desk yang
     tidak dikirim juga dipertahankan; `null`/kosong pada desk memilih inferensi
     otomatis. `umum` tidak berarti Ekonomi atau Bursa.
   - Klik **Nonaktifkan** untuk mematikan sementara sumber tanpa menghapusnya dari riwayat.

---

## 9. Operasional Server & Systemd Service

Aplikasi berjalan di atas Debian Linux menggunakan service systemd. Timer
intake/publisher tetap `disabled/inactive`, worker background tetap
`GAPURA_DISABLE_WORKERS=true`, publisher tetap `shadow`, dan tidak ada publish
nyata. Web/render telah dimuat ulang dengan identitas enam desk; publikasi tetap dijeda.

| Nama Service | Port / Domain | Deskripsi |
| :--- | :--- | :--- |
| `hme-web.service` | `127.0.0.1:3005` (`https://gapura.avenia.my.id`) | Web Review Dashboard, API Express, Static Asset Server |
| `hme-render.service` | `127.0.0.1:3000` | Micro-Service Render Node.js (Satori + Sharp) |
| `hme-n8n.service` | `127.0.0.1:5678` (`https://n8n.avenia.my.id`) | Canvas / fallback manual n8n |
| `postgresql.service` | `127.0.0.1:5432` | Basis Data PostgreSQL 17 (Database `hme` & `n8n`) |

### Perintah Pemeliharaan Cepat:
```bash
# Cek status seluruh service
systemctl status hme-web.service hme-render.service hme-n8n.service

# Melihat log web dashboard secara realtime
journalctl -u hme-web.service -f

# Melihat log render service secara realtime
journalctl -u hme-render.service -f

# Periksa timer yang sengaja dijeda dan lokasi drop-in worker
systemctl status gapura-pipeline.timer gapura-publisher.timer --no-pager
systemctl show hme-web.service --property=DropInPaths
```

Aktivasi tetap menunggu R7 review owner, R8 batch/shadow dan mandat eksplisit
untuk uji publish/otomatisasi. Tabel/kolom historis Verifikator dipertahankan;
tidak ada schema removal, purge, atau backfill pada R5. Detail implementasi dan
hasil gate ada di [laporan R5](plans/13_R5_REMOVE_VERIFICATOR.md).
