# R4 — Sumber discovery, enam desk dan cluster topik

Tanggal: 17 November 2026. Mengikuti [keputusan konten
orisinal](10_ORIGINAL_AI_EDITORIAL.md), [blueprint](07_EDITORIAL_REDESIGN_BLUEPRINT.md),
dan [R3](11_R3_AI_ILLUSTRATIONS.md).

**Status:** implementasi, migrasi, API, UI dan konfigurasi terpasang di produksi.
Uji unit, DB/API terisolasi, akses, Chromium dan renderer lulus. R4 **tidak**
menghapus Verifikator, **tidak** menulis ulang naskah orisinal dua mode, dan
**tidak** melakukan backfill desk untuk 1.181 topik lama.

## 1. Lingkup dan batas

R4 memindahkan batas input agen dari “artikel beserta ringkasan/foto penerbit”
menjadi **topik/judul dan metadata discovery saja**, lalu memberi registry
sumber dan topik sebuah desk editorial yang eksplisit. Tahap ini juga
menambahkan cluster peristiwa lintas URL sebagai alat kurasi.

Yang termasuk R4:

- Proyeksi allowlist metadata discovery untuk prompt Analis dan endpoint cluster.
- Enam desk resmi: `politik`, `sosial`, `hukum`, `lingkungan`, `ekonomi`
  (ekonomi nasional), `bursa`.
- Kolom `sources.desk`, `topics.source_id`, `topics.desk`,
  `topics.topic_keywords`, `topics.cluster_id`, dan tabel `topic_clusters`.
- Inferensi desk dari kategori sumber lama atau judul; desk eksplisit menang.
- Cluster judul lintas URL dengan jendela 72 jam dan ambang kemiripan 0,62.
- Filter `desk` pada API topik, endpoint cluster, dan pengelolaan desk sumber.
- Prompt/config/SEO/UI yang menyebut enam desk, bukan niche finansial tunggal.

Yang **belum** termasuk R4 dan tidak diklaim selesai:

- Penghapusan runtime/API/UI Verifikator → R5.
- Naskah/caption orisinal dua mode dan penghapusan validator verbatim → R6.
- Backfill desk untuk 1.181 topik lama; saat ini `topics.desk` masih `NULL`.
- Backfill cluster untuk topik lama; cluster hanya dibuat saat ingest baru.
- Polling produksi untuk 12 feed baru: worker masih dijeda, feed diverifikasi
  di luar jalur worker.
- Jalur Copywriter lama masih membaca `topics.summary`/material sampai R6.
  Jaminan “body tidak masuk payload” pada R4 berlaku untuk prompt Analis dan
  endpoint cluster, bukan seluruh pipeline lama.

## 2. Proyeksi metadata discovery

[discovery.js](../../services/common/discovery.js) menetapkan allowlist tepat
sembilan field:

`source_id`, `source_name`, `source_url`, `raw_title`, `normalized_title`,
`published_at`, `discovered_at`, `desk`, `topic_keywords`.

`projectDiscoveryTopic()` membangun objek baru; ia tidak meneruskan row database
apa adanya. Kunci terlarang (`summary`, `content*`, `body`, `description`,
`image_url(s)`, `publisher_url`, `material`, `paragraphs`, `snapshot`) dideteksi
oleh `containsForbiddenDiscoveryContent()` dan tidak pernah menjadi bagian
proyeksi. URL sumber divalidasi dengan aturan sumber publik yang sudah ada;
tanggal dinormalisasi ke ISO; kata kunci dibatasi delapan token.

Normalisasi judul memakai `normalizeHeadline()` dari kontrak R1, sehingga prefix
fallback dan suffix penerbit tidak masuk `normalized_title`. Judul mentah tetap
tersedia terpisah.

## 3. Enam desk dan inferensi

Urutan penentuan desk:

1. **Desk eksplisit** pada `sources.desk` (dari UI/API) → dipakai apa adanya.
2. **Kategori sumber lama** yang sudah terpetakan:
   `news_pasar→bursa`, `ojk_regulasi`/`bi_moneter`/`data_bps`→ekonomi,
   `jdih_hukum→hukum`.
3. **Inferensi judul** dengan daftar istilah per desk. Skor adalah jumlah istilah
   yang cocok sebagai kata utuh. Jika dua desk memiliki skor tertinggi yang sama,
   hasilnya `NULL` (auto), bukan tebakan.

Daftar istilah mencakup institusi dan isu khas tiap desk, misalnya DPR/pemilu
(politik), pendidikan/kesehatan/bansos (sosial), putusan/KPK (hukum),
iklim/banjir/BMKG (lingkungan), inflasi/APBN/rupiah (ekonomi), dan
IHSG/emiten/pasar modal (bursa).

`topicKeywords()` mengambil token judul ≥3 karakter, membuang stopword bahasa
Indonesia, unik, maksimal delapan. Kata kunci ini hanya metadata; bukan ringkasan
berita dan tidak boleh dipromosikan menjadi klaim fakta.

## 4. Registry sumber

[Migrasi additive](../../database/migrations/20261117_topic_desks_clusters.sql)
menambahkan kolom desk dan metadata topik, lalu constraint `CHECK` untuk enam
desk pada `sources`, `topics` dan `topic_clusters`. Migrasi idempotent dan aman
diulang pada restore.

Dua belas feed discovery ditambahkan ke produksi:

| Sumber | Desk | Hasil parse |
| --- | --- | --- |
| ANTARA Politik | politik | 20 item |
| ANTARA Hukum | hukum | 20 item |
| ANTARA Ekonomi | ekonomi | 20 item |
| CNN Indonesia Nasional | auto | 100 item |
| CNN Indonesia Ekonomi | ekonomi | 100 item |
| Tempo Nasional | auto | 50 item |
| Tempo Bisnis | ekonomi | 50 item |
| BBC News Indonesia | auto | 21 item |
| Sekretariat Kabinet RI | politik | 10 item |
| Mongabay Indonesia | lingkungan | 20 item |
| CNBC Indonesia News | auto | 100 item |
| IDX Channel | bursa | 10 item |

Dua puluh dua sumber lama di-backfill desk dari kategori registry lama dengan
satu entri audit `backfill_source_desks` (id 412, aktor `migration_r4`).
Distribusi akhir 34 sumber: ekonomi 12, bursa 11, hukum 3, politik 2,
lingkungan 1, auto 5.

Catatan `robots.txt` yang diperiksa saat seleksi:

- ANTARA dan Tempo mengizinkan jalur RSS untuk `*`, tetapi melarang
  `ClaudeBot`, `CCBot`, dan `GPTBot`. Gapura memakai pembaca feed dengan
  User-Agent `GapuraMediaBot`, bukan crawler AI; pembatasan ini tetap dicatat
  agar volume dan penggunaan ulang konten tidak melampaui izin.
- CNN Indonesia dan IDX Channel memberi `Allow: /` untuk `*` dengan pengecualian
  jalur non-RSS.
- BBC membatasi sejumlah jalur lama pada host feed; jalur RSS Indonesia tidak
  termasuk.
- Mongabay tidak menyajikan aturan robots (respons kosong).
- `setkab.go.id/robots.txt` merespons 200 tetapi berisi halaman HTML
  “Akses Dibatasi”, bukan sintaks robots. Feed RSS merespons 200 dan diparse;
  status ini dicatat sebagai risiko yang perlu ditinjau sebelum volume naik.

## 5. Cluster peristiwa lintas URL

[clusters.js](../../services/scout/clusters.js) memakai kemiripan Dice atas
himpunan token judul (token ≥3 karakter, stopword dibuang). `assignTopicCluster()`
hanya membandingkan topik **satu desk** dalam jendela 72 jam, maksimal 200
kandidat, dan memilih skor tertinggi di atas 0,62.

Jika tidak ada kandidat, topik menjadi representatif cluster baru. Jika ada,
topik bergabung ke cluster kandidat; kandidat yang belum punya cluster dibuatkan
lebih dulu. Cluster menyimpan `desk`, `representative_topic_id`, `title_key`,
dan waktu.

Clustering bersifat **best-effort** saat ingest: kegagalan cluster tidak
membatalkan topik yang sudah masuk. Diagnostik sumber mencatat
`clusters`/`cluster_errors`.

[Endpoint](../../services/web/clusters.js) `GET /api/topics/:id/cluster`
mengembalikan proyeksi metadata topic, ringkasan cluster (id/desk/representatif)
dan anggota. Endpoint tidak mengembalikan `summary`, body, HTML, foto atau URL
penerbit. ID tidak valid → 400; topik tidak ada → 404; kegagalan baca →
503. Topik lama tanpa cluster mengembalikan `cluster: null` dan satu anggota.

## 6. Analis, Scout dan SEO

**Scout** menyimpan `source_id`, `desk`, dan `topic_keywords` pada topik baru,
lalu memanggil clustering. Desk diambil dari sumber atau inferensi judul.
Diagnostik ingest mendapat field cluster tanpa mengubah arti field lama.

**Analis** kini:

- membangun `projectDiscoveryTopic(topic)` dan mengirim
  `DATA_DISCOVERY_JSON` sebagai satu-satunya payload data ke LLM;
- tidak lagi mengirim `topic.summary` ke prompt;
- memakai heuristik yang sadar desk dan hanya membaca judul + nama sumber;
- menyimpan desk hasil proyeksi dengan `COALESCE(desk, $3)` sehingga desk yang
  sudah ada tidak ditimpa;
- mempertahankan fast-fail, bobot, threshold dan aturan “lolos scoring bukan izin
  publikasi”.

**SEO** menambahkan kata kunci dan kategori enam desk. Kategori lama
(`pasar_modal`, `regulasi`, `moneter`, dan seterusnya) tetap dipertahankan agar
data tren lama tidak kehilangan pemetaan; keberadaannya bukan klaim identitas
niche baru.

Konfigurasi produksi `config/agents.json` dan
`config/skills/analis.skills.md` diperbarui: kata kunci Scout lintas enam desk,
system prompt Analis menolak membaca/mengarang body, dan skill Analis menjelaskan
bahwa input hanya metadata discovery.

## 7. API dan UI

| Perubahan | Perilaku |
| --- | --- |
| `GET /api/topics?desk=` | Nilai enam desk memfilter; nilai lain 400; tanpa parameter tetap semua |
| `GET /api/topics/:id/cluster` | Metadata cluster; 400/404/503 gagal tertutup |
| `POST /api/sources` | Menerima `desk` opsional; validasi enam desk |
| `PUT /api/sources/:id` | `desk` yang tidak dikirim dipertahankan; `null`/kosong menghapusnya |

UI sumber menambahkan pilihan **Desk Editorial** dengan bantuan “kosongkan agar
ditentukan otomatis”, badge desk pada daftar sumber, dan statistik yang dihitung
dari desk (bukan kategori finansial lama). Placeholder, meta description,
contoh Studio, prompt awal settings, dan teks CTA/disclaimer renderer
dinetralkan ke enam desk. Default hashtag menjadi
`#GapuraMedia #BeritaNasional #IsuPublik #Indonesia`.

README, PANDUAN, dan STATUS diperbarui. Dokumen desain historis
(`docs/plans/00`, `02`, `03`, `04`, `06`) sengaja tidak ditulis ulang; dokumen
itu tetap catatan sejarah dan tidak menjadi kontrak aktif.

## 8. Migrasi dan bukti produksi

Backup privat: `/root/gapura-backups/r4-desks-clusters-20261117T033834Z`
(0700/0600) berisi `hme-before.dump`, `before.json`, `after-production.json`,
`after-scratch.json`, `migration.sql`, `feed-probe.json`, dan
`verification.json`.

Langkah yang dijalankan:

1. Dump PostgreSQL production sebelum perubahan.
2. Restore dump ke database scratch sementara.
3. Jalankan migrasi **dua kali** pada scratch: sukses dan idempotent.
4. Bandingkan 22 tabel historis memakai jumlah baris + SHA-256 JSON terurut
   dengan kolom legacy (kolom R4 dikecualikan dari perbandingan): **tidak ada
   mismatch**.
5. Pastikan tabel baru `topic_clusters` kosong, lima kolom baru ada, tiga
   constraint ada, dan insert desk tidak valid ditolak.
6. Terapkan migrasi ke production; `topics.source_id` terisi untuk 1.174 topik
   dari `raw_items`, `topic_clusters` tetap 0 baris.
7. Bandingkan ulang 22 tabel historis production: **tidak ada mismatch**.
8. Periksa checksum `/etc/gapura/runtime.env`, `/etc/gapura/meta-unified.json`,
   `/etc/gapura/admin-token.env`, dan `config/providers.json`: tidak berubah.
9. Tambah 12 sumber via API production, lalu backfill 22 sumber lama dengan
   audit log; 34 sumber tanpa duplikat URL.

Setelah restart, `hme-web` (3005) dan `hme-render` (3000) sehat. Timer
`gapura-intake.timer` dan `gapura-publisher.timer` tetap inactive; drop-in
worker tetap `GAPURA_DISABLE_WORKERS=true`. Tidak ada publish, timer, atau batch
produksi yang dijalankan.

Pemeriksaan API production:

- `GET /api/topics?limit=1` → 200.
- `GET /api/topics?desk=bursa` → 200 `[]` (topik lama belum berdesk).
- `GET /api/topics?desk=hiburan` → 400.
- `GET /api/topics/1181/cluster` → 200 dengan `cluster: null` dan satu anggota.
- `GET /api/sources` → 34 sumber dengan distribusi desk di atas.
- Meta description halaman utama sudah enam desk.

## 9. Pengujian

Perintah dan hasil final (log di `/tmp/opencode/`):

- Unit: **587 tes, 586 lulus, 1 skip** — `gapura-r4-unit-final.log`.
- DB/API terisolasi: **52 lulus** — `gapura-r4-api-final.log`; diulang untuk
  stabilitas — `gapura-r4-api-repeat.log`.
- Akses/Origin/signature: **9 lulus** — `gapura-r4-access-final.log`.
- Chromium desktop/mobile: **1 lulus** — `gapura-r4-browser-final.log`.
- Renderer 9 layout: **1 tes, 9 layout lulus** —
  `gapura-r4-render-final.log`.
- `node --check services/web/public/app.js` dan
  `node --check services/render/engine.js` lulus.

Catatan kegagalan yang ditemukan dan diperbaiki: menjalankan seluruh file tes
DB/API secara paralel membuat satu tes migrasi R4 mengalami **deadlock PostgreSQL**
(`40P01`) karena `ALTER TABLE topics` bersaing dengan pembacaan `topics` oleh
server tes. Harness [run-isolated.mjs](../../services/web/test/run-isolated.mjs)
kini menjalankan file tes dengan `--test-concurrency=1`; suite lulus dua kali
berturut-turut setelah perubahan. Tidak ada perubahan produksi dari perbaikan
ini.

Tes baru R4 mencakup: allowlist/field terlarang, inferensi enam desk dan
tie-break, keyword extraction, migrasi idempotent + constraint, API sumber
(desk dipertahankan saat update parsial), filter topik, cluster lintas URL tanpa
body/summary, endpoint 400/404, dan payload prompt Analis yang tidak memuat
body/foto.

## 10. Batas yang diketahui

1. **Arsip topik belum berdesk.** 1.181 topik lama memiliki `desk NULL`. Analisis
   read-only dengan aturan inferensi yang sama menunjukkan 1.176 topik dapat
   dipetakan (905 bursa, 160 ekonomi, 109 hukum, 2 politik) dan 5 topik uji tidak
   cocok. Backfill **belum dijalankan** karena menampilkan arsip lama di filter
   desk adalah keputusan produk owner, bukan keputusan teknis: arsip itu memang
   didominasi konten pasar lama. Angka dan sampelnya disimpan di
   `desk-feasibility.json` agar keputusan dapat diambil tanpa menebak.
2. **Cluster hanya untuk ingest baru.** Belum ada backfill cluster; endpoint
   untuk topik lama mengembalikan `cluster: null`.
3. **Feed baru belum dipolling produksi.** Worker dijeda; validasi memakai
   parser produksi (`fetchFeed` + `normalizeFeedItem`) di luar worker.
4. **Jalur Copywriter lama belum berubah.** Body/ringkasan masih tersedia di
   database dan dipakai jalur naskah lama sampai R6. R4 tidak mengklaim seluruh
   pipeline sudah bebas body penerbit.
5. **Kuota gambar R3 masih 0.** Tidak ada generasi gambar nyata pada R4.
6. **Robots Setkab ambigu.** Halaman robots tidak valid; feed 200. Perlu
   ditinjau sebelum frekuensi polling dinaikkan.
7. **Penerimaan visual/style tetap R7.** R4 tidak menggantikan review owner.

R5 (penghapusan Verifikator) dan R6 (naskah orisinal dua mode) tetap pekerjaan
berikutnya. R4 tidak menyalakan timer/publisher, tidak menerbitkan posting, dan
tidak membuat batch produksi.
