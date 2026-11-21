# Perbaikan kualitas editorial sebelum R8

Tanggal: 18 November 2026. Laporan ini mencatat temuan dan keadaan saat pertama
ditulis. Bagian status di bawah telah diselaraskan dengan implementasi riset web
publik yang menggantikannya pada 19 November 2026. Status deploy aktif dicatat di
[status dan roadmap](../STATUS_DAN_ROADMAP_FITUR.md).

## Temuan dan perubahan

| Gejala | Akar masalah | Perbaikan |
| --- | --- | --- |
| Isi carousel berupa kalimat pendek | Produksi menerima metadata/headline; isi artikel tidak menjadi input Copywriter | Riset web publik menelusuri beberapa rujukan dan mengubah petikan sumber yang tervalidasi menjadi fakta teratribusi. Jika bahan tidak cukup, generasi berhenti tanpa membuat berita dari headline |
| Font isi terlalu besar | Beberapa layout memakai font display dan pengali untuk menaikkan ukuran teks pendek | Body slide memakai batas tipografi lebih rendah; skala adaptif yang membesarkan teks pendek dihilangkan. Cover slide 1 tidak diubah |
| Isi menempel di atas | Wrapper body memakai `justifyContent:flex-start` | Area body flex kini menempatkan isi di tengah secara vertikal, dengan header/footer tetap terpisah |
| CTA/placeholder tampil sebagai isi | Layout menambahkan prompt swipe/CTA dan label kategori meskipun tidak diberikan redaksi | Prompt swipe default dan label kategori generik dihapus. CTA/disclaimer hanya dirender bila eksplisit. Validator menolak filler generik seperti instruksi membaca sumber dan placeholder redaksi |
| Caption tidak menjelaskan berita | Draft legacy/custom dapat dibuat dengan caption dari judul/ringkasan | Jalur simpan custom menolak konten tanpa metadata editorial lengkap; caption baru tetap harus 1.200–1.900 karakter dan current-mode wajib mencakup fakta sumber. Draft lama dengan `copy_model=studio-ai-designer` tidak dapat disetujui |
| Generate berita tampak tidak berjalan | Discovery hanya menyediakan lead dan Copywriter memerlukan bukti yang dapat diperiksa | Auto-produce dan jalur editor memanggil riset topik publik; error pencarian atau bahan tidak memadai tampil sebagai 422 dan tidak menjadi draf headline-only |

## Kontrak sumber dan riset — kebijakan terkini

- Hanya `current` dengan minimal tiga fakta substantif beratribusi yang diterima
  sebagai naskah berita. Setiap fakta harus mempunyai source name dan URL publik.
- Paragraf singkat, duplikat, navigation/byline, dan status `summary_only` tidak
  dihitung sebagai body berita. Bahan partial tetap harus lulus validasi jumlah
  kontribusi dan dicek redaktur.
- Riset mencakup web, berita, forum, dan media sosial tanpa allowlist atau
  gerbang izin tertulis per penerbit/domain.
- Reader melindungi request dengan validasi URL/IP publik, HTTPS, robots,
  redirect, ukuran respons, dan batas waktu. Ia tidak login atau melewati
  paywall. Teks sumber yang benar-benar tersedia saja boleh mendukung klaim;
  setiap artikel dan referensi tetap menunggu review redaktur.
- Firecrawl Search API key dibaca dari environment server atau secret store lokal
  berkunci berkas `0600`. Key tidak dikumpulkan lewat dashboard tanpa login.
  Tanpa key, Google Trends dan feed sosial/forum masih dapat memberi sinyal,
  tetapi pencarian web/news penuh tidak tersedia.

## Status pada saat laporan awal (18 November 2026)

- Tidak ada draf produksi yang dibuat/diedit, database produksi yang dimigrasi,
  atau service produksi yang direstart dalam pekerjaan ini.
- Draf 144–149 tetap `draft`/`needs_review`; approval/publish tidak dilakukan.
- `gapura-pipeline.timer` dan `gapura-publisher.timer` tetap inactive/disabled.
- Status historis ini mendahului perubahan riset web 19 November; gunakan matriks
  status terkini di dokumen yang ditautkan di atas.

## Gate yang dijalankan

- Unit gabungan non-render/non-API: **606 test, 605 pass, 0 fail, 1 skipped**.
- API terisolasi: **105/105 pass**.
- Render: **111/111 pass**.
- Browser Chromium: **1/1 pass**.
- `node --check` untuk modul berubah dan `git diff --check`: lulus.
- Kedua migrasi additive diuji pada restore terisolasi dan diterapkan pada produksi setelah gate.
- Perbaikan multi-query dan fallback petikan serta uji live terbaru dicatat di
  [laporan keandalan riset](17_PUBLIC_RESEARCH_RELIABILITY.md).

## Sebelum R8

1. Uji dan tinjau kandidat serta rujukannya secara manual; tandai bahan yang
   tidak dapat diakses tanpa mereka-reka isi atau sumber.
2. Redaktur menilai komposisi dan keterbacaan sampel R7.
3. Publikasi uji memerlukan persetujuan terpisah; jangan menyalakan timer hanya
   karena suite lulus.
