# DOKUMEN 06: DASHBOARD WEB, KALIBRASI & RUNBOOK PEMULIHAN
## Homeless Media Engine (HME) v2.0

Dokumen ini memuat spesifikasi teknis untuk pengembangan opsional **Web Review Dashboard** (Next.js 14) untuk sesi peninjauan massal (20 draf dalam < 20 menit), metodologi **Kalibrasi Mingguan Skor AI vs Performa Nyata**, serta **Runbook Pemulihan Bencana** (*Disaster Recovery*).

---

## 1. Arsitektur Web Review Dashboard (Next.js 14)

Web Dashboard disiapkan untuk melengkapi bot Telegram ketika volume draf meningkat pesat, memberikan antarmuka desktop yang cepat, nyaman, dan mendukung pintasan keyboard (*keyboard shortcuts*).

### 1.1 Tech Stack & Fitur Inti
- **Framework:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Lucide Icons.
- **Akses & Keamanan:** Dihosting di kontainer internal atau port lokal, diakses melalui Cloudflare Tunnel dengan proteksi Cloudflare Access SSO (Email OTP).
- **Fitur Kunci:**
  1. **Tampilan Kartu Draf Massal:** Grid responsif carousel preview dengan status draf dan badge skor.
  2. **Filter & Sortir:** Filter berdasarkan ambang skor (misal: `>= 80`, `70–79`), pilar topik (Data, Bursa, Hukum, Geopolitik), atau flag `needs_review`.
  3. **Inline Slide Editor:** Mengedit teks slide langsung di layar browser dan melihat pratinjau hasil render ulang dalam tempo < 3 detik via endpoint `/render/preview`.
  4. **Pintasan Keyboard (Power User):**
     - `J` / `K` : Navigasi draf berikutnya / sebelumnya.
     - `A` : Setujui (Jadwalkan Publikasi Otomatis).
     - `M` : Setujui (Mode Reminder Manual).
     - `E` : Fokus ke panel edit teks.
     - `X` : Tolak draf (buka popup cepat alasan).
  5. **Tab Kalibrasi & Topik Gugur:** Melihat topik yang ditolak oleh Analis dan menyediakan tombol *Promote Manual* jika admin ingin memproduksi topik tersebut.
  6. **Panel Metrik & FinOps:** Grafik pemakaian token LLM harian (Rupiah), rasio persetujuan mingguan, dan estimasi biaya operasional bulanan.

---

## 2. Ritual Kalibrasi Mingguan (Skor AI vs Performa Nyata)

Kunci keberhasilan HME jangka panjang adalah kalibrasi rutin agar selera scoring Agen Analis semakin mendekati penilaian manusia:

1. **Analisis Korelasi (Setiap Minggu):**
   - Bandingkan skor total Analis (0–100) dengan data analitik performa Instagram (Saves, Shares, Reach).
   - Apakah topik berskor 85+ benar-benar berkinerja tinggi di feed?
   - Apakah ada topik berskor 70 yang meledak di luar ekspektasi?
2. **Penyesuaian Parameter di `app_settings`:**
   - Jika terlalu banyak draf yang ditolak admin (rasio approve < 50%), naikkan bobot Relevansi Niche dan Kualitas Data, atau naikkan ambang skor minimal dari 70 ke 75.
   - Perbarui daftar kata kunci terlarang (`banned_words`) dan kata kunci prioritas (`niche_keywords`) di tabel `brand_settings`.

---

## 3. Runbook Pemulihan Bencana (Disaster Recovery & Restorasi)

Target pemulihan berskala rumahan:
- **Recovery Point Objective (RPO):** Kehilangan data maksimal 24 jam.
- **Recovery Time Objective (RTO):** Sistem aktif kembali di mesin baru dalam waktu < 1 jam.

### 3.1 Prosedur Restorasi di Mesin Server Bersih
Jika perangkat keras server utama mengalami kerusakan total:

1. **Persiapan Mesin Baru:**
   - Install OS Debian Linux dan Docker Engine + Docker Compose plugin.
2. **Clone Repositori Kode & Workflow:**
   ```bash
   git clone https://github.com/aryarifki/gapura.git /root/gapura
   cd /root/gapura
   cp .env.example .env # Isi kembali kredensial rahasia (API Keys, Token)
   ```
3. **Restorasi Basis Data PostgreSQL:**
   ```bash
   # Jalankan kontainer database terlebih dahulu
   docker compose up -d postgres

   # Tunggu hingga database siap menerima koneksi
   sleep 10

   # Ekstrak dan restore dump SQL terakhir dari cadangan NAS
   gunzip -c /backup/hme_latest.sql.gz | docker compose exec -T postgres psql -U postgres -d hme
   ```
4. **Deploy Seluruh Kontainer:**
   ```bash
   docker compose up -d --build
   ```
5. **Verifikasi Operasional:**
   - Buka endpoint `http://localhost:3000/health` untuk memastikan render service aktif.
   - Buka n8n editor dan pastikan workflow tersinkronisasi.
   - Kirim pesan `/ping` ke bot Telegram untuk memastikan webhook/polling aktif kembali.

---

## 4. Rencana Pengujian & Kriteria Lolos (Exit Criteria Dokumen 06)

1. [ ] **Verifikasi Web Dashboard:** Dashboard berhasil menampilkan daftar draf aktif, melakukan navigasi via keyboard, dan melakukan review 20 draf dalam waktu < 20 menit.
2. [ ] **Verifikasi Kalibrasi:** Fitur promosi manual dari tab Topik Gugur berhasil memindahkan status topik kembali ke pipeline Copywriter.
3. [ ] **Verifikasi Uji Restorasi (Clean Machine Drill):** Uji pemulihan basis data dari berkas dump SQL di kontainer baru tuntas dan seluruh riwayat draf kembali utuh tanpa kehilangan relasi.
