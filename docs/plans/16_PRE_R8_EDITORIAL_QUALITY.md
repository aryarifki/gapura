# Perbaikan kualitas editorial sebelum R8

Tanggal: 18 November 2026. Laporan ini mencatat perbaikan yang dilakukan setelah
review terhadap enam sampel R7. **R8 belum dimulai**: draf tetap draft/review,
publisher timer tetap nonaktif, dan tidak ada publikasi.

## Temuan dan perubahan

| Gejala | Akar masalah | Perbaikan |
| --- | --- | --- |
| Isi carousel berupa kalimat pendek | Produksi menerima metadata/headline; isi artikel tidak menjadi input Copywriter | Loader memuat snapshot R2 atau membaca artikel melalui reader HTTPS yang dibatasi; paragraf disulap menjadi fakta teratribusi sebelum prompt. Jika bahan tidak cukup, generasi berhenti tanpa membuat berita dari headline |
| Font isi terlalu besar | Beberapa layout memakai font display dan pengali untuk menaikkan ukuran teks pendek | Body slide memakai batas tipografi lebih rendah; skala adaptif yang membesarkan teks pendek dihilangkan. Cover slide 1 tidak diubah |
| Isi menempel di atas | Wrapper body memakai `justifyContent:flex-start` | Area body flex kini menempatkan isi di tengah secara vertikal, dengan header/footer tetap terpisah |
| CTA/placeholder tampil sebagai isi | Layout menambahkan prompt swipe/CTA dan label kategori meskipun tidak diberikan redaksi | Prompt swipe default dan label kategori generik dihapus. CTA/disclaimer hanya dirender bila eksplisit. Validator menolak filler generik seperti instruksi membaca sumber dan placeholder redaksi |
| Caption tidak menjelaskan berita | Draft legacy/custom dapat dibuat dengan caption dari judul/ringkasan | Jalur simpan custom menolak konten tanpa metadata editorial lengkap; caption baru tetap harus 1.200–1.900 karakter dan current-mode wajib mencakup fakta sumber. Draft lama dengan `copy_model=studio-ai-designer` tidak dapat disetujui |
| Generate berita tampak tidak berjalan | R2 reader tersedia terpisah dan Copywriter tidak pernah memanggilnya; failure material tidak tampak sebagai failure generasi | Auto-produce, Studio, regenerate legacy, dan generator topik menghubungkan loader R2. Error akses/izin/materi tidak cukup tampil sebagai 422 dan tidak mengubah topic menjadi draft sukses |

## Kontrak sumber dan izin

- Hanya `current` dengan minimal tiga fakta substantif beratribusi yang diterima
  sebagai naskah berita. Setiap fakta harus mempunyai source name dan URL publik.
- Paragraf singkat, duplikat, navigation/byline, dan status `summary_only` tidak
  dihitung sebagai body berita. Bahan partial tetap harus lulus validasi jumlah
  kontribusi dan dicek redaktur.
- Reader hanya menggunakan kebijakan HTTPS/robots/redirect/ukuran dan selector
  artikel spesifik bila tersedia; tidak mengeksekusi JavaScript, login, atau
  melewati paywall.
- Pembacaan otomatis fail-closed kecuali exact hostname tercantum dalam
  `GAPURA_AI_MATERIAL_HOSTS` di environment runtime, setelah redaksi mendapat
  izin tertulis untuk pemrosesan AI. Variabel ini belum dipasang ke produksi;
  tidak ada domain yang diberi izin secara implisit.
- ANTARA menyatakan pada halaman berita yang diperiksa bahwa crawling atau
  pengindeksan otomatis untuk AI memerlukan izin tertulis. Karena itu ANTARA
  tidak boleh dimasukkan ke allowlist tanpa izin tersebut. Artikel yang tidak
  dapat dibaca dapat dilengkapi melalui catatan fakta yang dikurasi redaksi dan
  rujukan yang diizinkan.
- Perubahan ini tidak menyimpan atau memakai teks artikel ANTARA yang diperiksa
  saat investigasi. Tidak dilakukan bulk enrichment, backfill, atau fetch ulang
  pada topik produksi.

## Status produksi dan keselamatan

- Tidak ada draf produksi yang dibuat/diedit, database produksi yang dimigrasi,
  atau service produksi yang direstart dalam pekerjaan ini.
- Draf 144–149 tetap `draft`/`needs_review`; approval/publish tidak dilakukan.
- `gapura-pipeline.timer` dan `gapura-publisher.timer` tetap inactive/disabled.
- Browser test belum dapat dijalankan karena Playwright yang sebelumnya berada
  di `/tmp/opencode/gapura-browser` tidak tersedia setelah restart sesi.

## Gate yang dijalankan

- Unit gabungan non-render/non-API: **586 test, 585 pass, 0 fail, 1 skipped**.
- Render: **111/111 pass**.
- Copywriter production: **53/53 pass**.
- Scout article/enrichment: **50/50 pass**.
- Studio + copywriter: **78/78 pass**.
- API terisolasi setelah perubahan: **104/104 pass**.
- Browser Chromium: **belum dijalankan**, Playwright tidak tersedia.
- `node --check` untuk modul berubah dan `git diff --check`: lulus.

## Sebelum R8

1. Pemilik memutuskan sumber mana yang memiliki izin tertulis pemrosesan AI; baru
   setelah itu domain spesifik boleh ditambahkan ke `GAPURA_AI_MATERIAL_HOSTS`.
2. Redaktur menilai komposisi dan keterbacaan sampel R7.
3. Uji 20 kandidat secara manual/shadow, laporkan kandidat, sukses, tertahan
   bahan/izin, gagal teknis, dan ditolak redaktur secara terpisah.
4. Publish uji memerlukan persetujuan terpisah; jangan menyalakan timer hanya
   karena suite lulus.
