# R7 — Editorial v2 (3-Slide Carousel) · Review

Stage: R7 · Status: **human_audit_passed_r7_complete** · Owner decision: **approved (current DB revision)** · R8: **ready — manual shadow batch**

## Sign-off manusia selesai — 2026-11-21

Owner menyelesaikan audit editorial dan visual atas draft app **#161** dan **#159** dan menyetujui revisi database saat ini. Hash yang disetujui: Bursa `1548b818b3475d4708437acc2187a08f4406463aeaac09ab3b8f5a0a2909909a`, ekonomi `04393a19a74f62757e64d9e1b90f0045fda4f063441da588f02403f7b8c808dc`. Sign-off tercatat di `audit_log` (`r7_human_audit_passed`, aktor `owner`) tanpa mengubah isi/status draft, sehingga hash revisi yang diaudit tetap utuh.

Gate audit manusia R7 **lulus**. Ini **bukan** persetujuan publikasi: draft tetap `draft`/`needs_review=true`, publication target 0, dan satu publish uji R8 tetap menunggu mandat terpisah. Kandidat koreksi `editorial-proposals/` tidak diterapkan. Timer pipeline/publisher tetap disabled/inactive. R8 dibuka untuk batch/shadow manual.

## Hasil akhir lanjutan — 21 November 2026

**Mulai dari [HUMAN_REVIEW.md](HUMAN_REVIEW.md).** Dua draft live dan dua kandidat koreksi tersedia, masing-masing dengan artikel, caption, empat post Threads, tiga PNG, hash revisi, serta laporan audit.

| Desk | Draft live | Status database | Artikel live | Artikel kandidat | Isi slide 2 | Audit kandidat |
|---|---:|---|---:|---:|---:|---|
| Bursa | 161 | `draft`, needs review | 435 kata | 435 kata | 110 kata | Gate + integrasi + klaim ulang + geometri PNG lulus |
| Ekonomi | 159 | `draft`, needs review | 429 kata | 427 kata | 181 kata | Gate + integrasi + klaim ulang + geometri PNG lulus |

Sumber hasil live tetap di `samples/<desk>/`. Paket `editorial-proposals/<desk>/` berisi alternatif koreksi untuk perbandingan; paket itu **tidak diterapkan dan bukan versi yang disetujui owner**. Revisi database #161/#159 yang ditandatangani owner tetap menjadi revisi R7 yang disetujui. Alternatif mencakup framing tanggal, penghapusan waktu relatif, objek persentase pengurangan premi, istilah yang terlalu luas, dan ketepatan rujukan. Klaim kandidat diperiksa ulang setelah koreksi: `supported=true`, tanpa temuan.

Regresi R7 **471/471 lulus**, nol gagal/skip (`debug/regression-ready-20261121.log`). Audit raster memverifikasi 1080×1350, checksum dan batas teks. Audit visual owner atas revisi database yang disetujui juga lulus pada 2026-11-21. Kedua cover aktual tipografis, termasuk ekonomi yang memiliki calon foto dari asset bank tetapi tidak menggunakannya pada cover.

Perbaikan lanjutan menjaga judul/lead yang sudah valid saat repair, memakai diagnosis field tepat, menggabungkan empat kalimat datar yang benar-benar ditulis provider, menyelaraskan rentang tahun dan pertanyaan audiens, menyamakan first-mention dengan urutan ekspor publik, serta memeriksa ulang hanya bagian klaim yang ditunjuk reviewer. Source date/limitations diteruskan sebagai konteks internal. Router membatasi dua percobaan Gemini untuk keseluruhan tahap, zero thinking S1–S3, reservasi output 4.096 token, dan titik awal worker yang bervariasi sebelum round-robin. Cache membandingkan nilai secara semantik agar perubahan urutan key JSON tidak dicatat sebagai repair palsu. Raw disimpan per run agar kegagalan transport tidak memakai respons lama sebagai bukti baru.

Revisi database draft 159/161 telah disetujui owner untuk sign-off R7, tetapi tetap `draft`/`needs_review=true` dan tidak memiliki publication target. Proposal koreksi artikel/slide tidak diterapkan dan bukan revisi yang disetujui. R8 siap untuk batch shadow manual; timer pipeline/publisher tetap **disabled/inactive**, dan renderer produksi tidak direstart. Publikasi live serta aktivasi timer memerlukan mandat terpisah.

[Verifikasi dan rollback lanjutan](recovery-resume-20261121/RECOVERY.md). Tidak ada commit/push.

## Caption artikel-mini diterapkan ke app — 21 November 2026

Masukan bahwa caption live belum terasa seperti artikel mini sudah ditangani. Caption tiga paragraf ditambah lead dan pertanyaan penutup; revisi yang ditandatangani memuat body **1.529 karakter (Bursa)** dan **1.455 karakter (ekonomi)**. Koreksi mencakup urutan kebijakan, rincian pendukung serta konteks kronologi/tujuan. Gate konten dan pemeriksaan klaim terhadap kombinasi yang benar-benar ada di database lulus tanpa temuan.

Caption diterapkan hanya pada field caption draft **161** dan **159**. Artikel, slide, Threads, cover PNG dan publication targets tidak diubah. Owner kemudian menandatangani hash revisi database saat ini setelah audit editorial dan visual. Keduanya tetap `draft`, `needs_review=true`; ini bukan persetujuan publish. Backup caption/metadata sebelum perubahan: `recovery-resume-20261121/db-caption-before-apply/<draft-id>.json`.

Audit caption terkini di app: [Bursa #161](https://gapura.avenia.my.id/#view-review/draft/161) · [Ekonomi #159](https://gapura.avenia.my.id/#view-review/draft/159). Candidate package dan hash mutakhir: [Human review](HUMAN_REVIEW.md). Pipeline/publisher timers tetap disabled/inactive.

## Riwayat pemulihan sebelum paket siap

- Registry entitas valid dipertahankan; perbaikan tidak lagi menghapus seluruh registry untuk menutupi satu entitas tidak terdukung. Duplikat dan short label diuji. Checkpoint sintesis lama dibatalkan lewat versi input hash.
- Kesetaraan tanggal Indonesia/Inggris/ISO dan satuan bps/basis poin diselaraskan antara gate Python dan JavaScript. Rujukan dibatasi jumlah fakta tersedia, bukan angka delapan yang berbeda dari gate.
- Micro-repair artikel memperbaiki rujukan metadata dan lead secara terpisah. Caption/Threads dapat memperbaiki rujukan angka/tanggal tanpa mengubah teks. Perbaikan rujukan tetap dibawa ke retry bila gate menemukan pelanggaran berikutnya.
- Gate artikel sekarang benar-benar memeriksa **setiap paragraf 40–55 kata**. CTA slide 3 wajib ada dan seluruh slide 3 hanya boleh memuat satu tanda tanya. Retry artikel hanya mengganti metadata, lead dan paragraf yang perlu diperbaiki; baris lain dipertahankan. Respons lengkap dari provider diproyeksikan ke baris repair hanya jika bentuknya identik.
- Router tahap editorial dibatasi dua key Gemini per panggilan LLM, termasuk 429/401/403/5xx. Default timeout 35.000 ms dan matriks 500/502/503/504 memiliki tes eksplisit. Dua upaya validasi per tahap tidak ditambah.
- Draft Bursa **156** pernah mencapai `VALIDATED`, menghasilkan artikel, caption, Threads dan PNG 1–3, tetapi audit tambahan menemukan paragraf sepanjang 35/36 kata. Draft ini **rejected**, bukan sampel R7 bersih. Snapshot dan PNG disimpan di `recovery-20261121/bursa-draft-156/`.
- Kegagalan integrasi pertama terpisah dari kegagalan generasi: validator JavaScript menolak notasi tanggal setara, cap rujukan delapan terlalu kecil, dan proses render produksi masih memuat kode lama. Uji menggunakan renderer terpisah `127.0.0.1:13000`; renderer produksi tidak direstart.
- Run akhir Bursa dan ekonomi masih ditolak Stage 2 (`article_headline_10_to_12_words_no_placeholder`). Bukti provider asli dan hasil materialisasi kini terpisah dalam `samples/<desk>/raw/provider_*.json` dan `stage*.json`; pemulihan tidak mengarang atau memanjangkan teks secara mekanis untuk meloloskan hitungan.
- Perintah awal untuk menandai draft 156 memakai status `revision_requested` gagal karena enum DB tidak memiliki nilai itu. Tidak ada perubahan dari perintah yang gagal. Sesudah inspeksi skema, status yang sah `rejected` berhasil ditulis dan dibaca kembali.
- Pada snapshot pemulihan sebelum sign-off final, audit visual dan editorial manusia masih **pending**. Status historis ini superseded oleh sign-off owner 2026-11-21 yang dicatat di bagian awal dokumen dan `REVIEW_STATUS.json`. Tidak ada persetujuan publikasi.

Laporan simulasi: `FAILURE_SIMULATIONS.md`. Log regresi dan run live: `debug/*20261121.log`.

Verifikasi snapshot pemulihan awal: **454/454 tes lulus**, 0 gagal, 0 skip (`debug/regression-final-20261121.log`). Audit geometri tiga PNG draft ditolak 156 lulus; audit isi tetap gagal pada dua paragraf pendek (36 dan 35 kata). Renderer review port 13000 sudah dihentikan; renderer produksi port 3000 tetap sehat. Kedua timer produksi terverifikasi **disabled/inactive**. Pada snapshot tersebut, DB memuat draft 158 (Bursa) dan 157 (ekonomi) `failed`, draft 156 `rejected`, semuanya `needs_review=true`. Status itu mendahului produksi akhir #159/#161 dan sign-off owner yang dicatat di atas.

Ulangi verifikasi dan rollback runtime: `recovery-20261121/RECOVERY.md`. Tidak ada commit atau push.

## Spesifikasi yang diuji (per mandat owner 2026-11-20)

Carousel **tepat 3 slide**, piramida terbalik:

| Slide | Layout | Isi | Aturan |
|:--|:--|:--|:--|
| 1 | `editorial-cover` | Judul berita = headline artikel | **Minimal 10 kata** (gate: 10–12), `text` kosong |
| 2 | `editorial-lead` | Inti berita | Teras berita (lead) **35–45 kata** memuat 5W+1H/ADIKSIMBA + **2–4 paragraf pendek**; total lead+paragraf **100–300 kata**; ≥3 fact berbeda |
| 3 | `editorial-close` | Ajakan | `question` = SATU pertanyaan (berakhir `?`) mengajak komentar/pendapat; `text` = ajakan **follow + share + kritik & saran**; total title+text+question ≤ 40 kata |

- Caption: aturan lama tetap — hook ≤120 char, 2–3 paragraf, satu CTA question, 5–7 hashtag (tanpa `#`); caption memuat berita utuh (body 300–1700 char).
- Artikel: 350–550 kata (sasaran 420–465), headline 10–12 kata, lead 35–55 kata, 3–4 section, tiap paragraf 40–55 kata.
- Threads: 4 post ≤420 char.
- First mention: label lengkap di artikel/caption; carousel boleh short label.
- Media: foto berlisensi + kredit dari manifest; bila tidak ada foto relevan → cover tipografis (`cover_mode: typography`).

## Gate Sebelum Aktivasi Produksi

- [x] Bursa Stage 1→4 `VALIDATED`: draft 161, ekspor dan PNG → `samples/bursa/`
- [x] Ekonomi Stage 1→4 `VALIDATED`: draft 159, ekspor dan PNG → `samples/ekonomi/`
- [x] Kandidat koreksi kedua desk dengan klaim ulang dan geometri PNG terverifikasi → `editorial-proposals/`
- [x] Audit editorial dan visual owner atas revisi database #161/#159; hash yang disetujui tercatat di `REVIEW_STATUS.json`
- [x] Simulasi kegagalan provider (429/timeout/5xx) dan sumber; failover juga teramati di log live
- [ ] Jalankan batch R8 shadow manual untuk 20 draf berturut-turut
- [ ] Dapatkan mandat terpisah sebelum satu publish uji live
- [ ] Aktifkan timer hanya setelah gate batch dan mandat aktivasi eksplisit terpenuhi

## Dimensi Audit Editorial R7

Dimensi berikut digunakan untuk menilai revisi database yang sudah ditandatangani owner; daftar ini bukan checklist yang masih tertunda.

- Slide 1: judul 10–12 kata, faktual, bukan clickbait.
- Slide 2: lead menjawab 5W+1H; detail mengikuti piramida terbalik; angka/tanggal sesuai sumber.
- Slide 3: pertanyaan mengundang komentar; CTA follow/share/kritik-saran tersedia.
- Caption: berdiri sendiri, berisi konteks dan rincian, dengan hashtag relevan.
- Threads: empat post ringkas dengan progres dan penutup.
- Artikel: headline sesuai kontrak, atribusi benar, tanpa klaim melampaui fakta.
- Media: cover tipografis yang disetujui; tidak disajikan sebagai foto kejadian.
- Tidak ada klaim/angka/tanggal di luar fakta atau meta-komentar internal.

## Hasil run

| Run | Desk | Status | Error | Catatan |
|:--|:--|:--|:--|:--|
| #1 (2026-11-20 23:39) | bursa | FAILED | `stage2_article: article_body_350_to_550_words` (2×275 kata) | Gemini timeout/503; Groq+OpenRouter fallback; prompt diperketat (paragraf wajib 40–55 kata) |
| #2 | bursa | Dibatalkan (server restart) | — | STAGE1_DONE saat restart |
| #3 (2026-11-20) | bursa | FAILED | `stage2_article: article_paragraph_relative_date_unsupported` | body naik ke 321/386 kata (prompt paragraf berhasil); "pekan ini" disalin dari sumber → larangan waktu relatif + feedback spesifik ditambahkan di semua prompt |
| #4 (2026-11-21) | bursa | FAILED | `stage2_article: acronym_first_mention_unexpanded` | body 447 kata ✓; `seo_title` pakai akronim telanjang → field SEO (seo_title/meta_description) dikeluarkan dari scan first-mention di Python + JS (di luar alur baca); prompt waktu relatif juga diperketat |
| #5 (2026-11-21) | bursa | FAILED | `stage3a_carousel: carousel_kicker_2_length_1_40` | S1–S2+S3B+S3C ✓; S3A: kicker slide 2–3 kosong + `fact_ids` 9>8 + (attempt 2) angka 20 tak dirujuk di `fact_ids` lead. Fix: kicker opsional di gate/JS/renderer (+test render 32/32), cap `fact_ids`→`len(facts)`, micro-repair deterministik `fact_repair` di `story-gate.py` (tambah fact ID penopang angka/tanggal), di-wire ke `localFactRepair` di retry path |
| #6 (2026-11-21) | bursa | FAILED | `stage3a_carousel: carousel_visual_query_3_length_1_100` | S3A: `visual_query` close kosong → opsional di gate (internal, tidak dirender); `fact_ids` paragraph ∉ lead → `fact_repair` diperluas (merge superset paragraf ke lead); first-mention akronim short==nama ("OJK") selalu gagal → `first_mentions` diperbaiki (label ≡ nama = lolos). Replay attempt 1+2 run #6: OK. Suites 22/176/32 hijau |
| #7 (2026-11-21) | bursa | FAILED | `stage3a_carousel: carousel_body_100_to_300_words` | S1–S3B ✓ (Gemini 408/429/503 → Groq/OpenRouter fallback). S3A: underflow 78 kata (lead 41 + para 20/17; prompt lama floor per-paragraf 20 tak mampu capai total 100) → prompt CAROUSEL: paragraf 30–60 kata (min 30 dilarang di bawah), total 120–250; `carouselFeedback` kini laporkan kata per-paragraf + shortfall |
| #8 (2026-11-21) | bursa | VALIDATED debug, belum bersih | Registry kosong ditemukan saat replay | Tidak menghasilkan draft/PNG; first-mention tidak efektif pada run ini |
| Live sebelum pemulihan | bursa | FAILED | `article_meta_description_date_unreferenced` | Micro-repair artikel dan raw dump ditambahkan |
| Live 2026-11-21, awal | bursa | FAILED integrasi | `original_story_section_2_2_date_unreferenced` → cap rujukan → renderer lama | S1–S4 lolos; paritas validasi dan renderer review terpisah memperbaiki integrasi |
| Live 2026-11-21, draft 156 | bursa | REJECTED setelah audit | Paragraf artikel 35/36 kata | Tiga PNG dan ekspor tersedia sebagai artefak ditolak, bukan sampel bersih |
| Live 2026-11-21, awal | ekonomi | FAILED | Paragraf carousel bernomor 3; rujukan angka caption/Threads | Normalisasi nomor paragraf dan satuan basis poin diperbaiki |
| Live 2026-11-21, strict | bursa | FAILED | `article_paragraph_40_to_55_words` | Gate yang diperketat menolak output pendek |
| Live 2026-11-21, strict | ekonomi | FAILED | CTA penutup kosong; kemudian headline/body | Gate CTA diperketat; checkpoint artikel lama tidak dipaksa diterima |
| Live 2026-11-21, targeted/fields/bounded | bursa + ekonomi | FAILED | Hitungan headline, paragraf, meta description, first-mention | Retry terfokus dan kelanjutan micro-repair diuji; lihat masing-masing log |
| Live 2026-11-21, repair-chain (akhir) | bursa | FAILED | `stage2_article: article_headline_10_to_12_words_no_placeholder` | `debug/live-review-bursa-repair-chain-20261121.log` |
| Live 2026-11-21, repair-chain (akhir) | ekonomi | FAILED | `stage2_article: article_headline_10_to_12_words_no_placeholder` | `debug/live-review-ekonomi-repair-chain-20261121.log` |
