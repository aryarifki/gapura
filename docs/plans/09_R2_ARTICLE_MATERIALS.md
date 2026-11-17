# R2 — Pengambilan dan snapshot materi artikel

Tanggal: 17 November 2026. Turunan dari
[blueprint](07_EDITORIAL_REDESIGN_BLUEPRINT.md) dan
[kontrak R1](08_R1_EDITORIAL_CONTRACT.md).

**Keputusan produk terbaru:** owner memilih [konten orisinal dan ilustrasi
AI](10_ORIGINAL_AI_EDITORIAL.md). Jalur default R3–R8 memakai RSS untuk
topik/judul dan metadata saja; body/foto penerbit tidak masuk payload agen.
Reader/snapshot R2 di bawah tetap kemampuan terpisah yang sudah tersedia,
bukan kewajiban melakukan enrichment sebelum generasi. Catatan R2 mengenai
kelanjutan pengambilan foto/sindikasi adalah rencana historis yang diganti.

## 1. Tujuan dan batas tahap

R2 memisahkan **materi sumber yang benar-benar tersedia** dari ringkasan Radar
dan metadata discovery. Perubahan ini menyelesaikan kehilangan body feed,
menyediakan pembacaan artikel HTML/JSON-LD yang dibatasi, dan menyimpan snapshot
versi materi tanpa menulis ulang riwayat.

R2 tidak memanggil model, tidak menghasilkan carousel/caption baru, tidak
menilai kebenaran berita, tidak membuat laporan Verifikator, tidak mengunduh
foto, dan tidak mengaktifkan sumber atau timer. Koneksi Meta, galeri kosong,
serta mode evaluasi editorial tetap dipertahankan. Consumer penulisan lama
masih memakai kontraknya sampai R5/R6; tersedianya materi bukan bukti penulisan
baru sudah aktif.

## 2. Perubahan feed dan discovery

- [rss.js](../../services/common/rss.js) dan
  [sources.js](../../services/scout/sources.js) mempertahankan explicit
  `content:encoded`/`content` yang tersedia, terpisah dari description/summary
  Radar maksimal 1.000 karakter. Body sumber tidak dipotong menjadi 1.000.
- Metadata tambahan: `raw_title`, `content_html`, `content_kind`, publication
  timestamp, update timestamp, dan kandidat gambar. HTML disimpan sebagai data
  sumber, bukan markup tepercaya untuk ditampilkan langsung pada web.
- RSS/Atom CDATA, content HTML/XHTML, source attribution, URL alternate dan
  metadata tren tetap dapat dibaca. Entity/code point invalid tidak menyebabkan
  parser crash. Body item >100.000 karakter ditolak eksplisit, tidak dipotong
  diam-diam.
- Scout membaca body dari XML asli agar urutan campuran paragraf/heading Atom
  tidak berubah. Mode `parseFeed(xml, {isolateErrors:true})` mempertahankan slot
  item gagal untuk batas/jumlah item; perilaku default parser tetap melempar
  error ukuran. Item HTTP ditolak tanpa mengubahnya diam-diam menjadi HTTPS.
- Kesalahan satu item tidak menghentikan item/sumber berikutnya. Diagnostik
  mencatat `invalid`, `errors`, dan status `partial` bila hasil sumber campuran;
  transaksi item gagal di-rollback. Kegagalan menyimpan diagnostik sumber juga
  tidak menghentikan sumber berikutnya.
- `content_html` mempertahankan stylesheet sebagai data sumber hingga pruning
  visibility; script dibuang. Body/paragraf snapshot disusun dari teks yang
  tersisa setelah pruning, bukan plain text yang masih memuat bagian hidden.
- Judul publik memakai normalizer R1. Prefix `[X]`, `[X/RSSHub]`, dan fallback
  Google News tidak lagi ditambahkan oleh adapter; provider tetap tercatat pada
  metadata. Raw title tetap disimpan untuk audit.
- [Scout](../../services/scout/scout.js) menyimpan source body pada raw item,
  summary singkat pada topik, dan snapshot materi pada transaksi yang sama.
- [SEO](../../services/seo/seo.js) membawa body/kandidat gambar/tanggal dari
  sumber, menyimpannya pada `trend_items`, dan mentransfernya saat promotion.
  `Volume pencarian` tetap engagement metadata dan tidak menjadi teks berita.
  Topic + material + promoted-topic linkage disimpan atomik dengan lock trend.
- Timestamp RSS/ISO yang eksplisit diterima; tanggal invalid, rollover dan
  string ambigu menjadi `null`. Waktu fetched/retrieved tidak digunakan untuk
  mengarang tanggal terbit.

`rss_full` berarti field full-content secara eksplisit tersedia dari feed;
hal itu tidak membuktikan penerbit tidak mengirim teaser. Description-only
tetap `feed_summary`/`summary_only`, betapa pun panjangnya. Pemeriksaan redaktur
dan pengujian adapter nyata tetap dibutuhkan.

## 3. Parser artikel

[article.js](../../services/scout/article.js) memakai **Cheerio 1.2.0** yang
dipin di package/lock Scout. Parser hanya menerima bytes/string yang sudah
diambil, tidak menjalankan script, membuka URL, atau mengunduh gambar.

Urutan sumber materi:

1. JSON-LD `Article`/`NewsArticle` yang cocok dengan identitas URL/headline
   dokumen, termasuk `@graph` serta reference image/publisher yang relevan.
2. Body artikel yang ditandai `itemprop=articleBody`, selector penerbit eksplisit
   bila dikonfigurasi, atau elemen `article`.
3. Bila hanya meta description/teaser tersedia, status jujur tanpa body buatan.

Navigasi, iklan, related stories, share widgets, form, script/style, hidden
elements dan template dikeluarkan. Tidak menggunakan seluruh text `body`/`main`
sebagai fallback artikel. JSON-LD traversal dibatasi kedalaman/node; input
dibatasi 2 MiB, teks hasil maksimal 100.000 karakter. Batas terlampaui menjadi
`parse_failed`, bukan sukses yang isinya dipotong.

Visibility mencakup atribut hidden/inert/aria-hidden, inline style, serta
declaration stylesheet statis `display:none`, `visibility:hidden`, dan
`content-visibility:hidden`. Ini bukan CSS engine browser: rule conditional
diperlakukan konservatif dan stylesheet eksternal tidak diambil. Variasi CSS
lain/JavaScript tetap memerlukan pengujian adapter nyata.

Metadata terpisah: judul bersih, penerbit, URL kanonis, `published_at`,
`updated_at`, paragraf dengan ID/source reference, dan kandidat foto dengan
alt/credit/dimensi bila sumber menyediakannya. Charset Buffer di-sniff oleh
parser; HTTP charset dapat diberikan secara eksplisit.

Canonical hanya diterima pada origin artikel yang sama. Canonical lintas-origin,
URL privat/userinfo, atau homepage yang akan menggantikan artikel dipertahankan
sebagai diagnostik; URL artikel semula tetap menjadi identitas sumber.
Kutipan dalam artikel belum diubah menjadi claim/truth verdict.

Metadata paid (`isAccessibleForFree=false`), notice login/paywall yang jelas,
dan halaman challenge/access denied menolak ekstraksi. Body tersembunyi di
JSON-LD tidak diekstrak untuk melewati paywall. Detector ini memakai sinyal
eksplisit yang teruji pada fixture; bukan klaim bahwa seluruh variasi paywall
semua penerbit sudah dikenali.

## 4. Reader HTTP yang dibatasi

[article-reader.js](../../services/scout/article-reader.js) menggunakan
`node:https`, bukan `cheerio.fromURL` atau browser headless:

- Hanya HTTPS tanpa userinfo, port default 443; literal/DNS privat, link-local,
  loopback, documentation/multicast/transition ranges ditolak. Jawaban DNS
  campuran public/private ditolak seluruhnya.
- DNS address yang sudah diperiksa dipin pada lookup socket. Hostname asli
  tetap dipakai untuk TLS; tidak mengandalkan validasi sebelum request lalu
  melakukan resolusi DNS baru tanpa pemeriksaan.
- Setiap redirect diperiksa ulang dan origin tujuan melewati robots sendiri.
  Maksimal tiga perpindahan (redirect/resolver). Redirect artikel ke homepage
  tanpa query berhenti sebagai `redirect_homepage` sebelum homepage diambil.
- `robots.txt` diperiksa sebelum artikel. 404/410 berarti tidak ada policy;
  directive yang sesuai agent, path terpanjang, wildcard dan allow exception
  diperhitungkan. Percent-encoded unreserved characters dinormalisasi tanpa
  mendekode path separator. Denial/error pengambilan robots menahan pembacaan.
- Header bot eksplisit dan `Accept-Encoding: identity`, tanpa Cookie,
  Authorization, atau kredensial pembaca. Respons compressed yang tetap
  dikirim penerbit ditolak pada versi ini.
- Stream dibatasi 2 MiB (robots 64 KiB), termasuk ketika `Content-Length`
  hilang/salah. Stream aborted/close dini tidak dianggap artikel lengkap.
- Timeout setiap operasi maksimal 12 detik dan budget read total 45 detik,
  termasuk DNS/robots/redirect; error tidak menyalin raw URL/pesan upstream ke
  respons diagnostik.
- Cache memory maksimal 100 dokumen/100 robots entry, TTL 15 menit, clone hasil
  untuk mencegah pemanggil mengubah cache. `refresh=true` mengabaikan cache
  dokumen tanpa mengabaikan policy robots.

Google News hanya diikuti melalui redirect HTTP biasa atau **satu anchor artikel
eksplisit** yang cocok dengan host penerbit metadata. Homepage, beberapa artikel
ambigu, atau artikel penerbit lain tidak dipilih. Opaque IDs tidak didekode
melalui endpoint internal, login, atau anti-bot bypass. Jika tidak tersedia
jalur eksplisit yang aman, hasil `aggregator_unresolved`; input redaktur/sumber
alternatif yang sah diperlukan pada tahap workflow berikutnya.

## 5. Snapshot dan schema

[Migrasi R2](../../database/migrations/20261117_article_materials.sql) bersifat
additive, nullable, dan dapat diulang:

| Objek | Tambahan |
| --- | --- |
| `raw_items` | `source_material JSONB` |
| `trend_items` | `source_material JSONB` |
| `topics` | `raw_title`, `normalized_title`, `source_published_at`, `source_updated_at`, `material_status` |
| `topic_materials` | Snapshot `material`, hash isi, created/last-seen timestamps; unique `(topic_id,content_hash)` |

Tidak ada backfill/default metadata pada baris historis. Snapshot lama tidak
diubah ketika observed kembali; hanya `last_seen_at` diperbarui. Hash canonical
mengurutkan object keys dan mempertahankan array order/seluruh metadata,
kecuali top-level `retrieved_at`, agar waktu retrieval baru tidak membuat
duplikat materi identik. Versi/body/tanggal/attribution/status baru menghasilkan
snapshot baru.

[material-store.js](../../services/scout/material-store.js) menolak malformed
JSON, URL/tanggal/ID paragraf invalid, body >100.000 karakter dan status palsu.
Materi parsial/summary/gagal tetap boleh disimpan; storage tidak memberlakukan
syarat tiga kontribusi untuk mendapatkan hasil pengambilan. Tidak ada report
Verifikator atau nilai confidence baru dalam kontrak ini.

### Status materi

| Status | Arti |
| --- | --- |
| `full` | Field full-content/artikel menghasilkan sedikitnya tiga blok; tetap perlu review isi dan kecukupan kontribusi |
| `partial` | Isi artikel tersedia tetapi terbatas |
| `summary_only` | Ringkasan/metadata saja; tidak disamakan dengan artikel penuh |
| `paywall` | Materi memerlukan login/berlangganan |
| `access_denied` | URL/akses tidak diizinkan atau challenge |
| `robots_disallowed` | Policy robots atau pengambilannya menahan pembacaan |
| `rate_limited` | Upstream 429 |
| `parse_failed` | Format, ukuran, encoding, resolver atau ekstraksi gagal |
| `unavailable` | Timeout, koneksi terputus, HTTP unavailable atau masalah transport |

Status ini menjelaskan akses/pemrosesan, **bukan benar/salahnya berita**.

## 6. API manual tanpa produksi draf

```text
GET  /api/topics/:id/material
POST /api/topics/:id/material/enrich
```

GET mengembalikan `{topic,material,material_id,content_hash,warnings}`. Topik
tanpa snapshot tetap mempunyai `material=null`; ringkasan historis tidak dibuat
menjadi body artikel. Warnings hanya informasi internal tentang materi, Analis
dan produksi draf, bukan caption publik atau report Verifikator. GET tidak
mengubah snapshot, last-seen, judul/summary, atau status produksi.

POST hanya menerima `{}` atau `{"refresh":true}`. URL mengikuti topik tersimpan;
caller tidak dapat mengirim URL/selector/destination bebas melalui endpoint.
Materi full yang sudah tersimpan dipakai kembali bila tidak refresh. Hasil
pengambilan disimpan atomik beserta `topics.material_status`; judul/summary,
`topics.updated_at`, approval, draf dan target publikasi tidak ditulis ulang.
Kegagalan akses normal dikembalikan sebagai hasil materi berstatus jujur,
bukan disamarkan menjadi caption sukses.

Endpoint mengikuti akses dashboard yang terbuka atas permintaan owner, dengan
validasi Origin. Batas pengayaan 10 per alamat per 10 menit dan maksimal dua
request aktif per proses web; map rate limit maksimal 1.000 alamat. Header IP
Cloudflare hanya dipercaya dari peer loopback setelah validasi `isIP`.
Tidak ada tombol/polling otomatis baru di UI R2.
Gunakan API hanya untuk topik pilihan; tidak ada batch backfill atau panggilan
artikel saat startup.

## 7. Pengujian dan keterbatasan

Fixture mencakup RSS/Atom kaya vs summary, HTML body, JSON-LD graph/references,
artikel terkait yang salah, waktu publish/update, charset/entities, canonical
tidak aman, gambar relatif, paywall/challenge, parsing/size failure, private
DNS dan DNS pinning, robots, redirect, timeout/abort, snapshot dedup/concurrency,
upgrade metadata null, dan API tidak membuat draf.

Perintah suite:

```bash
NODE_ENV=test node --experimental-vm-modules --experimental-test-module-mocks \
  --test $(find services -path '*/test/*.test.js' | sort | grep -v 'services/web/test/server-')

node services/web/test/run-isolated.mjs \
  services/web/test/server-db.test.js \
  services/web/test/server-providers.test.js \
  services/web/test/server-meta-publisher.test.js \
  services/web/test/server-score-integrity.test.js \
  services/web/test/server-material-store.test.js

bash services/web/test/run-server-tests.sh

PLAYWRIGHT_PATH=/tmp/opencode/gapura-browser/node_modules/playwright/index.mjs \
  CHROMIUM_PATH=/usr/bin/chromium NODE_ENV=test \
  node --test services/web/test/browser.test.js
```

Hasil final 17 November 2026:

| Pemeriksaan | Hasil |
| --- | ---: |
| Semua unit aplikasi | 516 lulus, 0 gagal; 1 Chromium dilewati dan dijalankan terpisah |
| Database/API PostgreSQL terisolasi | 41 lulus, 0 gagal |
| Akses server/Origin/media signature | 9 lulus, 0 gagal |
| Chromium desktop/mobile, review revision, navigasi SPA | 1 lulus, 0 gagal |
| Subset feed/Scout/SEO/material setelah isolasi item | 101 lulus, 0 gagal; tercakup dalam suite unit |

Log perintah final tersimpan di `/tmp/opencode/gapura-r2-{unit,isolated,access,browser}-final.log`.
Regresi red→green mereproduksi hidden body, redirect homepage, tanggal rollover
pada feed maupun X,
item HTTP/oversized yang memutus sumber, urutan Atom campuran, dan path robots
terenkode. Tes transport native mencakup DNS pinning/TLS hostname, byte ceiling,
encoding, aborted stream, dan deadline. Recovery transaksi Scout diuji dengan
mock; suite PostgreSQL menguji migrasi, snapshot, konkurensi dan API, belum
injeksi kegagalan transaksi ingest Scout pada PostgreSQL nyata.

Tes unit memakai fixture/mock, API memakai database sementara. Katalog feed
publik, hak penggunaan body/foto, dan keberhasilan semua penerbit nyata belum
divalidasi oleh hasil tes ini. Ekstraksi PDF, halaman yang memerlukan JavaScript,
paywall/login, dan decoding opaque Google News tidak didukung. Data source yang
tersedia di registry/RSS tidak otomatis memberi izin mengutip/menggunakan
seluruh body atau gambar; pemilihan sumber dan aset sah dilanjutkan R3/R4.

R2 membangun input yang diperlukan R6. Penulisan semantik/quote/angka, komposisi
visual yang disetujui owner, serta penghapusan Verifikator aktif masih tahap
R5/R6/R7; tidak diklaim selesai oleh modul materi.

## 8. Migrasi produksi dan pemulihan

Migrasi sudah diterapkan setelah web dijeda singkat untuk snapshot konsisten;
pipeline/publisher tetap inactive dan disabled. Backup privat:
`/root/gapura-backups/r2-article-materials-20261116T192441Z/` (direktori `0700`,
berkas `0600`). Nama folder memakai waktu UTC; pelaksanaan berlangsung
17 November 2026 waktu lokal.

`verification.json` mencatat restore penuh berhasil, migrasi pada hasil restore
diulang dua kali, dan **19 tabel historis identik** berdasarkan row count/hash
JSON terurut. Checksum file kredensial tidak berubah. Kolom metadata pada baris
lama tetap `null`, `topic_materials` tetap nol, tidak ada backfill. Migrasi
memakai lock timeout 5 detik dan statement timeout 60 detik.

Backup memuat `hme-before.dump`, salinan SQL migrasi, `before.json`, dan hasil
verifikasi. Pemulihan hanya dijalankan untuk insiden yang membutuhkan restore;
restart web biasa menggunakan schema additive yang sudah tersedia.

## 9. Smoke produksi setelah pemasangan

Pemeriksaan GET/read-only pada dashboard produksi memberikan health 200,
endpoint materi topik historis 200 dengan `material=null` dan metadata sumber
lama tetap null, nol draf/Studio job, serta Meta connected untuk `gapuramedia`.
Intake/publisher tetap `inactive`/`disabled`; drop-in worker Studio tetap memuat
`GAPURA_DISABLE_WORKERS=true`.

Pemeriksaan PostgreSQL read-only terakhir membandingkan ulang 19 tabel lama
dengan backup: tidak ada tabel berubah. Jumlah material, draf, slide, Studio
job, schedule dan publication target semuanya nol; metadata topik baru juga
tetap nol. Hasil tersimpan di
`/tmp/opencode/gapura-r2-production-db-final.json`.

Tidak ada fetch artikel/panggilan model live, backfill, draf, download foto,
atau publikasi yang dijalankan untuk smoke R2. Hak/ketersediaan sumber nyata
dan asset foto end-to-end tetap gate R3/R4. Seluruh PR sebelumnya tetap
terpisah; R2 disiapkan sebagai PR bertumpuk di atas branch kontrak R1.
