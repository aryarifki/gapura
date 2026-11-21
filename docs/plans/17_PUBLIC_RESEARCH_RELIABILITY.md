# Perbaikan pencarian dan ekstraksi tiga fakta

Tanggal: 19 November 2026. Minimum tiga fakta substantif dengan URL sumber tetap
wajib. Artikel dan carousel tetap memerlukan review redaktur sebelum approval;
timer pipeline dan publisher tidak diaktifkan.

## Masalah yang diperbaiki

- Ekstraksi memakai system prompt dan skill Copywriter yang meminta carousel,
  padahal riset memerlukan pilihan petikan. Kini tugas ekstraksi memiliki policy
  tersendiri melalui `includeAgentPolicy: false` dan tidak mewarisi instruksi
  artikel/carousel.
- Satu kueri yang panjang diganti tiga kueri: judul, kata kunci inti dan
  perkembangan, serta ringkasan/konteks dan dampak. Firecrawl menerima maksimal
  tiga kueri dengan empat hasil per jenis (`web` dan `news`): paling banyak 24
  hasil sebelum deduplikasi. Feed sosial/forum hanya diambil sekali per riset.
  Search dengan scraping dapat memakai kredit tambahan; ini batas request/hasil,
  bukan klaim biaya atau konsumsi kredit aktual.
- Konten halaman hasil pencarian dan metadata video disaring. Hasil berjenis
  `snippet` harus diambil ulang melalui reader HTTPS publik; kegagalan baca
  tidak boleh digantikan dengan deskripsi mesin pencari sebagai bukti artikel.
- URL dideduplikasi sebelum dan sesudah pembacaan. Kalimat sumber yang relevan
  ditandai ID dan disertai URL; Gemini memilih ID tersebut sehingga tidak dapat
  menciptakan teks atau tautan sumber baru. Prompt menyertakan topik riset.
- Jika pilihan AI kurang dari tiga fakta, fallback mengambil kalimat berbeda
  dari teks sumber yang sudah tersedia. URL dan exact passage tetap diperiksa.
  Satu artikel yang lengkap boleh menyediakan beberapa fakta. Perbedaan angka
  dan negasi dipertahankan; pengulangan dan petikan yang tumpang tindih dibuang.
- Generasi mempunyai maksimal tiga percobaan dengan validator yang sama.
  Perbaikan khusus panjang caption hanya mengganti `caption_blocks`; artikel,
  slide dan bahan fakta dipertahankan. Kegagalan akhir tetap menjadi error.
- Judul artikel terkait Google Trends diteruskan sebagai lead agar Analis tidak
  menerima hanya kueri umum seperti “dolar hari ini”. Tidak ada perubahan ambang
  kelulusan Analis.
- Fallback Gemini 2.5 yang mengembalikan HTTP 404 pada key server dihapus dari
  konfigurasi aktif. Model utama tetap Gemini 3.5 Flash-Lite, dengan fallback
  yang sudah dikonfigurasi dan dicoba melalui router aplikasi.

## Bukti verifikasi

Suite akhir lulus 605 tes unit dari 606 (satu skipped), 105 tes API terisolasi,
111 tes render, dan satu alur Chromium. Syntax/JSON dan `git diff --check` lulus.
Perbaikan caption terarah beserta produksi juga lulus 70 tes terfokus. Tes default
ekstraksi memeriksa policy terisolasi, topik yang dikirim, dan pemilihan ID petikan;
tes lain mencakup fallback dari satu artikel, penolakan snippets tanpa body,
angka/negasi berbeda, duplikat, URL malformed, dan konteks judul Google Trends.

Uji live memakai topik 1178 yang sudah lolos Analis (90/100). Tiga permintaan
Firecrawl mengembalikan HTTP 200; enam petikan terpilih berasal dari dua halaman
sumber yang dibaca. Masing-masing petikan dicocokkan dengan teks halaman; hash
SHA-256 body sumber dicatat pada artefak lokal. Percobaan generasi awal tertahan
oleh panjang caption. Perbaikan caption diuji kembali menggunakan petikan yang
sudah diperiksa agar tidak mengulang biaya pencarian. Output awal memiliki body
caption 994 karakter; perbaikan caption menghasilkan 1.252 karakter. Artikel
sepanjang 1.321 karakter, enam slide, dan enam referensi fakta lolos validator.
Hitungan produksi sebelum/sesudah sama: enam draf, nol jadwal, nol target publikasi,
dan nol job Studio. Tidak ada output uji yang dimasukkan ke tabel `drafts`.

Artefak berada di `storage/research-tests/verification-1795087331767/`, terpisah
dari tabel draf dan endpoint gambar publik. File laporan tidak memuat credential.
`report.json` mencatat status `passed` untuk kecocokan petikan dan validasi teknis.
`article.md` dan `content.json` adalah contoh untuk redaktur, bukan hasil yang
telah disetujui.

Layanan web dimuat ulang pada 19 November 2026 pukul 18:39:35 WIB setelah gate
terakhir lulus. `/health` mengembalikan `ok`; web dan render aktif. Endpoint
penyimpanan Firecrawl key publik mengembalikan 404, key server tetap berizin
`0600`, worker Studio dinonaktifkan, mode publisher `shadow`, dan kedua timer
pipeline/publisher tetap `disabled/inactive`. `runtime.json` mencatat hitungan
produksi setelah reload: enam draf lama untuk review, nol artikel produksi,
jadwal, target publikasi, dan job Studio. Tidak ada migrasi baru pada perbaikan ini.

Status Radar masih `stale` karena scan terakhir yang disimpan berasal dari
percobaan manual sebelumnya. Uji riset ini tidak memperbarui histori scan Radar
atau menjalankan pipeline otomatis.

## Batas verifikasi

Pencocokan petikan membuktikan isi tersedia pada sumber yang diambil; itu bukan
jaminan bahwa sumber benar atau semua kesimpulan artikel benar secara semantik.
Filter relevansi dan duplikasi bersifat heuristik. Redaktur harus menilai konteks,
tanggapan/pertentangan sumber, atribusi sosial/forum, tanggal, serta klaim di tiap
paragraf. Pada contoh live, frasa seperti rencana pengawasan ke depan dan tujuan
penyusunan peraturan harus diperiksa kembali karena tidak tersurat dalam enam
petikan yang dipilih. Contoh klaim politik dari percakapan tidak ditambahkan sebagai fakta
tanpa sumber yang mendukungnya.

Tidak ada publikasi atau persetujuan draf yang dilakukan oleh uji live.
