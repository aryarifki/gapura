# Homeless Media Engine (HME) v2.0
> Sistem otomasi konten Instagram self-hosted untuk akun niche data, hukum regulasi, dan ekonomi bursa saham Indonesia (`@homelessmedia`). Empat agen AI bekerja secara estafet di atas orkestrasi hybrid n8n Community + micro-service render Node.js (Satori + Sharp).

---

## 📌 Status Repositori & Rencana Pengembangan

Repositori ini telah dianalisis berdasarkan dokumen produk resmi [`PRD_Homeless_Media_Engine.pdf`](file:///root/gapura/docs/PRD_Homeless_Media_Engine.pdf). Rencana implementasi telah disusun secara komprehensif, terstruktur, dan dipecah menjadi beberapa dokumen panduan kerja modular di direktori [`docs/plans/`](file:///root/gapura/docs/plans/):

| No | Dokumen Panduan Kerja | Ruang Lingkup & Tanggung Jawab | Status |
| :-: | :--- | :--- | :-: |
| 00 | [`00_MASTER_BLUEPRINT.md`](file:///root/gapura/docs/plans/00_MASTER_BLUEPRINT.md) | Visi, arsitektur hybrid, prinsip anti-slop, dan roadmap orkestrasi induk | 📑 Siap |
| 01 | [`01_PHASE_0_FOUNDATION_INFRASTRUCTURE.md`](file:///root/gapura/docs/plans/01_PHASE_0_FOUNDATION_INFRASTRUCTURE.md) | Docker Compose (4 kontainer), DDL PostgreSQL 16 (12 tabel), Cloudflare Tunnel & Telegram Bot setup | 📑 Siap |
| 02 | [`02_PHASE_0_RENDER_SERVICE_DESIGN_SYSTEM.md`](file:///root/gapura/docs/plans/02_PHASE_0_RENDER_SERVICE_DESIGN_SYSTEM.md) | Micro-service render Node.js (Satori + Sharp), `tokens.yaml`, 9 template JSX, auto-fit text & chart generator | 📑 Siap |
| 03 | [`03_PHASE_1_SCOUT_AND_ANALIS_ENGINE.md`](file:///root/gapura/docs/plans/03_PHASE_1_SCOUT_AND_ANALIS_ENGINE.md) | Polling sumber niche (BPS, BI, IDX, OJK, JDIH), dedup URL SHA256 & `pg_trgm`, fast-fail, dan skoring 0-100 | 📑 Siap |
| 04 | [`04_PHASE_2_COPYWRITER_AND_CAROUSEL_PIPELINE.md`](file:///root/gapura/docs/plans/04_PHASE_2_COPYWRITER_AND_CAROUSEL_PIPELINE.md) | Penulisan data-editorial, skema JSON carousel 5-8 slide, disclaimer otomatis, integrasi render & notifikasi Telegram | 📑 Siap |
| 05 | [`05_PHASE_3_APPROVAL_PUBLISHING_OPERATIONS.md`](file:///root/gapura/docs/plans/05_PHASE_3_APPROVAL_PUBLISHING_OPERATIONS.md) | Telegram approval bot (Setujui/Edit/Tolak), state machine draf, publikasi Meta API + manual, error workflow & backup | 📑 Siap |
| 06 | [`06_PHASE_4_DASHBOARD_AND_MAINTENANCE.md`](file:///root/gapura/docs/plans/06_PHASE_4_DASHBOARD_AND_MAINTENANCE.md) | Web review dashboard (Next.js 14 mass review 20 draf < 20 menit), ritual kalibrasi mingguan, disaster recovery runbook | 📑 Siap |

---

## 🏛️ Arsitektur Singkat (Opsi B: Hybrid n8n)

- **Orkestrasi:** n8n Community (Self-Hosted)
- **Render Engine:** Micro-service Node.js (`satori` + `sharp`, kanvas 1080×1350 px rasio 4:5, penggunaan memori ~30 MB)
- **Basis Data:** PostgreSQL 16 (`hme` untuk domain & `n8n` untuk log internal)
- **Human-in-the-Loop Door:** Bot Telegram (Inline Keyboard review mobile)
- **Akses Aman:** Cloudflare Tunnel + Cloudflare Access SSO (Zero Open Ports)
