# 📖 Panduan Penggunaan Gapura Media Engine (GME v2.0)
> **Akun Resmi:** `@gapuramedia` · **Portal Dashboard:** [https://gapura.avenia.my.id](https://gapura.avenia.my.id)  
> **Niche:** Data Pasar Modal & Bursa Saham, Hukum Regulasi Keuangan, dan Kebijakan Makro Ekonomi Indonesia.

---

## 📑 Daftar Isi
1. [Ringkasan Alur Kerja Redaksi](#1-ringkasan-alur-kerja-redaksi)
2. [Navigasi Antarmuka (Dashboard Overview)](#2-navigasi-antarmuka-dashboard-overview)
3. [Radar Topik: Menemukan & Memproduksi Berita](#3-radar-topik-menemukan--memproduksi-berita)
4. [Antrian Review & Editor Draf Carousel](#4-antrian-review--editor-draf-carousel)
5. [AI Designer: Regenerate AI & Kustomisasi Kreatif](#5-ai-designer-regenerate-ai--kustomisasi-kreatif)
6. [Studio Desain & Postingan Kustom](#6-studio-desain--postingan-kustom)
7. [Kustomisasi AI Agents & Skills.md](#7-kustomisasi-ai-agents--skillsmd)
8. [Manajemen Sumber Berita Niche](#8-manajemen-sumber-berita-niche)
9. [Operasional Server & Systemd Service](#9-operasional-server--systemd-service)

---

## 1. Ringkasan Alur Kerja Redaksi

Aplikasi ini mengotomatiskan alur kerja redaksi Instagram dari hulu ke hilir dengan prinsip **Human-in-the-Loop**:

```
[Sumber Terverifikasi] (BPS, BI, OJK, MK, IDX)
       │
       ▼ (Polling berkala / Trigger manual)
[Agen 1: SCOUT] ──► Deduplikasi SHA256 & Pencarian Keyword
       │
       ▼ (Filter Fast-Fail)
[Agen 2: ANALIS] ──► Penilaian Kredibilitas & Skor 0–100 (Threshold ≥ 76)
       │
       ▼ (1-Click Auto Produce / n8n Trigger)
[Agen 3: DESIGNER] ──► Penentuan Arsitektur Visual (3–8 Slide, Tata Letak Bebas)
       │
       ▼ (Sintesis Prosa & Narasi)
[Agen 4: COPYWRITER] ──► Caption Editorial, Verbatim Quote, Disclaimer & Hashtags
       │
       ▼
[RENDER SERVICE] ──► Deterministic Node.js (Satori + Sharp) -> 1080×1350 px PNG
       │
       ▼
[WEB DASHBOARD] ──► Review Redaktur -> Edit Teks -> Setujui / Posting / Download
```

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
   - **Diproduksi**: Berita yang telah memiliki draf carousel.
3. **Membuat Draf Otomatis (1-Click Auto-Produce):**
   - Klik langsung pada judul berita yang Anda inginkan.
   - Sistem akan langsung menjalankan Agen Designer & Copywriter untuk menyusun slide dan merender gambar PNG dalam waktu < 3 detik.
   - Dashboard akan otomatis berpindah ke **Editor Draf** untuk peninjauan langsung.

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
   - **Caption & Hashtags:** Sesuaikan caption editorial Instagram sebelum dipublikasikan.
4. **Tombol Tindakan Utama:**
   - **🔄 Simpan & Render Ulang Slide:** Merender ulang slide aktif secara seketika dan memperbarui pratinjau.
   - **✨ Regenerate AI (Desain Ulang):** Meminta AI Designer merancang ulang seluruh carousel secara adaptif.
   - **📥 Download Semua Slide:** Mengunduh seluruh slide dalam satu file ZIP untuk arsip atau posting manual.
   - **📋 Salin Caption & Hashtags:** Menyalin caption lengkap beserta tagar ke clipboard dalam satu klik.
   - **📸 Posting Sekarang / ⏱️ Setujui (Auto):** Mengubah status draf menjadi disetujui / siap dipublikasikan.

---

## 5. AI Designer: Regenerate AI & Kustomisasi Kreatif

Jika draf bawaan terasa kurang variatif atau Anda ingin sudut pandang visual baru:
1. Buka draf di **Editor Review**.
2. Klik tombol **`✨ Regenerate AI (Desain Ulang)`** di bagian atas kanan editor.
3. Tombol akan berubah status menjadi `⚡ Merancang Ulang via AI...`.
4. Dalam waktu 2–4 detik, Agen Designer (bertenaga Gemini 3.5) akan:
   - Menentukan jumlah slide optimal (antara 3 hingga 8 slide).
   - Menentukan arsitektur visual terbaik (Cover Editorial, Stat Spotlight, Dual Perspective, Takeaway Points, Regulasi, dll).
   - Meminta Render Service merender seluruh gambar PNG baru ke disk.
   - Memperbarui layar browser Anda secara otomatis tanpa perlu me-refresh halaman.

---

## 6. Studio Desain & Postingan Kustom

Menu **Studio Desain** diperuntukkan jika redaksi ingin membuat postingan khusus tanpa terpaku pada berita radar:
1. Masuk ke menu **Studio Desain**.
2. **Formulir Pembuatan Draf Kustom:**
   - Masukkan judul berita / tema postingan.
   - Masukkan ringkasan konteks data.
   - Masukkan sumber data resmi (misal: `Bank Indonesia / BPS`).
   - Tentukan preferensi jumlah slide (Otomatis AI atau tentukan angka tertentu).
3. Klik **`⚡ Generate Carousel Baru (AI Creative Director)`**.
4. Draf baru akan langsung dibuat di database, seluruh slide dirender ke PNG, dan draf langsung dimasukkan ke Antrian Review.
5. **Live Pratinjau Desain Token:**
   - Anda dapat bereksperimen mengubah warna latar (`bg`), warna teks (`ink`), aksen (`accent`), dan highlight (`#D79344`).
   - Pratinjau langsung diperbarui seketika di canvas simulator ponsel.

---

## 7. Kustomisasi AI Agents & Skills.md

Setiap agen AI memiliki kepribadian, instruksi, dan keterampilan yang dapat diubah secara bebas:
1. Masuk ke menu **AI Agents & Skills**.
2. Terdapat tab untuk keempat agen:
   - **Scout:** Pengumpul berita, interval polling, dan kata kunci fokus.
   - **Analis:** Rubrik skoring 5 komponen (Relevance, Credibility, Momentum, Engagement, Compliance), ambang batas skor, dan aturan fast-fail.
   - **Copywriter:** Tone of voice, jumlah slide default, banned words, dan teks disclaimer.
   - **Designer:** AI Creative Director, kebebasan arsitektur visual, dan tokens warna.
3. **Mengganti API Key & Model:**
   - Anda dapat memasukkan API Key Gemini / OpenAI / OpenRouter Anda sendiri.
   - Model bawaan adalah `gemini-3.5-flash-lite` (sangat cepat, hemat kuota, dan cerdas). Anda juga bisa mengganti ke `gemini-2.5-flash` atau provider OpenAI compatible lainnya.
4. **Editor `skills.md` Kustom:**
   - Di bagian bawah form agen, terdapat textarea **"Kustomisasi Skills.md"**.
   - Masukkan panduan khusus (misal: "Selalu sertakan data persentase pada slide 2", "Gunakan istilah POJK resmi").
   - Klik **`💾 Simpan Konfigurasi & Skills`**. Perubahan akan seketika berlaku untuk pemanggilan AI berikutnya.

---

## 8. Manajemen Sumber Berita Niche

Mengelola feed RSS dan portal sumber berita resmi:
1. Masuk ke menu **Sumber Topik**.
2. **Melihat Sumber Aktif:**
   - Terdapat daftar sumber seperti BPS (Badan Pusat Statistik), Bank Indonesia (Departemen Komunikasi), OJK (Siaran Pers), Mahkamah Konstitusi, JDIH Kemenkeu, dan Google News RSS.
3. **Menambah Sumber Baru:**
   - Isi form: Nama Sumber, Kategori, URL Feed / Scraping Target, Tipe Sumber (RSS / API / HTML), dan Frekuensi Polling.
   - Klik **Tambah Sumber**.
4. **Mengedit & Menonaktifkan:**
   - Klik tombol **Edit** untuk mengubah link atau bobot kredibilitas sumber.
   - Klik **Nonaktifkan** untuk mematikan sementara sumber tanpa menghapusnya dari riwayat.

---

## 9. Operasional Server & Systemd Service

Aplikasi berjalan di atas Debian Linux menggunakan service systemd:

| Nama Service | Port / Domain | Deskripsi |
| :--- | :--- | :--- |
| `hme-web.service` | `127.0.0.1:3005` (`https://gapura.avenia.my.id`) | Web Review Dashboard, API Express, Static Asset Server |
| `hme-render.service` | `127.0.0.1:3000` | Micro-Service Render Node.js (Satori + Sharp) |
| `hme-n8n.service` | `127.0.0.1:5678` (`https://n8n.avenia.my.id`) | Mesin Orkestrasi Workflow Otomatis n8n |
| `postgresql.service` | `127.0.0.1:5432` | Basis Data PostgreSQL 17 (Database `hme` & `n8n`) |

### Perintah Pemeliharaan Cepat:
```bash
# Cek status seluruh service
systemctl status hme-web.service hme-render.service hme-n8n.service

# Restart web dashboard & render engine
systemctl restart hme-render.service && systemctl restart hme-web.service

# Melihat log web dashboard secara realtime
journalctl -u hme-web.service -f

# Melihat log render service secara realtime
journalctl -u hme-render.service -f
```
