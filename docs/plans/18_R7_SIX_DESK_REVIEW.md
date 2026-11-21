# R7 — Enam sampel pipeline terbaru untuk keputusan owner/redaktur

Tanggal: 19 November 2026. Enam sampel baru telah dibuat melalui riset dan kontrak
editorial terbaru, direvisi operator, divalidasi, lalu disimpan lewat API aplikasi
dengan cover manual orisinal. Status seluruhnya `draft`, `needs_review=true`.
**R7 belum ditutup: keputusan owner dan redaktur masih `pending`.**

## Paket yang dapat ditinjau

- [Halaman review enam desk](../../storage/r7-six-desk-20261119/index.html):
  carousel, artikel, sumber, caption, Threads, serta catatan per sampel.
- [Paket ZIP](../../storage/r7-six-desk-20261119/R7_SIX_DESK_REVIEW.zip): 94 berkas,
  termasuk enam artikel dan 36 slide PNG. SHA-256
  `de553ea8431f0f256a146c501a3c95db88e652cf36e5b5ee30c27390c69760c1`.
- [Enam cover](../../storage/r7-six-desk-20261119/six-covers.png).
- [Lembar keputusan owner/redaktur](../../storage/r7-six-desk-20261119/OWNER_DECISION.json):
  memuat ID draf dan hash revisi yang ditinjau. Semua keputusan masih `pending`.
- [Bukti akhir](../../storage/r7-six-desk-20261119/verification.json) dan
  [manifest](../../storage/r7-six-desk-20261119/manifest.json).

## Sampel

| Desk | Draf/editor | Topik | Skor Analis | Fakta terpilih | Artikel (karakter) | Caption (karakter) | Slide |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Politik | [150](https://gapura.avenia.my.id/#view-review/draft/150) | Persetujuan RUU Perampasan Aset dan sorotan kontrol aparat | 89 | 9 | 1923 | 1365 | 6 |
| Sosial | [151](https://gapura.avenia.my.id/#view-review/draft/151) | PKH tahap keempat: periode dan status penerima | 84 | 7 | 1850 | 1401 | 6 |
| Hukum | [152](https://gapura.avenia.my.id/#view-review/draft/152) | Penahanan tersangka dugaan manipulasi waran | 85 | 7 | 1958 | 1445 | 6 |
| Lingkungan | [153](https://gapura.avenia.my.id/#view-review/draft/153) | Laporan operasi penanganan karhutla Way Kambas | 90 | 7 | 1805 | 1416 | 6 |
| Ekonomi | [154](https://gapura.avenia.my.id/#view-review/draft/154) | Keputusan BI-Rate dan tujuan stabilisasi rupiah | 90 | 9 | 1990 | 1411 | 6 |
| Bursa | [155](https://gapura.avenia.my.id/#view-review/draft/155) | Laporan Kontan tentang agenda reformasi BEI sebelum pengumuman MSCI | 80 | 8 | 1971 | 1398 | 6 |

Seluruh topik baru (1183–1188) melewati Analis dengan ambang asli 76. Tidak ada
skor yang dinaikkan manual. Sampel lama 144–149 dipertahankan, tidak diregenerasi
atau dihapus. Total draf produksi kini 12; seluruhnya masih review-only.

## Apa yang benar-benar dilakukan

Riset publik dan pencocokan petikan menghasilkan kandidat fakta. Operator
memeriksa sumber, memilih petikan yang relevan, menghapus metadata/cuplikannya,
serta menambahkan korroborasi politik dan ekonomi dari halaman yang benar-benar
diambil. Teks petikan dan hash body sumber tersimpan per fakta. Satu sumber yang
cukup lengkap boleh menyokong lebih dari satu fakta; jumlah sumber tidak
disamakan dengan jumlah fakta.

**Generasi otomatis awal bukan enam keberhasilan tanpa koreksi.** Lima desk
gagal karena validasi tanggal, angka, scope, caption atau timeout provider;
lingkungan lolos struktur tetapi memerlukan koreksi makna mengenai modifikasi
cuaca. Kegagalan awal tersimpan di manifest dan `generate.log`. Operator membuat
revisi editorial dengan bahan fakta yang sama, lalu seluruh naskah lulus
validator aplikasi. Sampel ini menunjukkan alur riset, penulisan, koreksi,
penyimpanan dan render; belum membuktikan target R8 berupa 20 produksi berturut
tanpa kegagalan parsing.

Review independen menilai semua artikel, caption, slide dan Threads terhadap
fact IDs. Koreksi atas kronologi, atribusi dan qualifier diterapkan. Pemeriksaan
akhir membuktikan 47 petikan cocok dengan teks sumber dan hash yang disimpan,
fact IDs valid, artikel lengkap dan caption memenuhi kontrak, serta enam
carousel masing-masing mempunyai cover dan enam PNG 1080×1350.

## Temuan editorial dan penyelesaiannya

| Desk | Temuan | Hasil koreksi / batas yang tetap perlu dinilai |
| --- | --- | --- |
| Politik | Keputusan paripurna, klaim parlemen dan kritik YLBHI berpotensi disamakan; sumber slide tidak selalu tepat | Lead diberi konteks 19 November dan atribusi BBC/ANTARA. YLBHI dan Habiburokhman tetap sebagai pihak dengan penilaian berbeda. Tidak mengklaim nomor UU, tanggal pengundangan/mulai berlaku, atau hasil penerapan; periksa dokumen DPR/JDIH sebelum publish. |
| Sosial | Riset semula memilih portal dengan angka penerima dan batas pencairan yang belum cukup kuat | Sampel memakai tujuh petikan detikSumbagsel; angka penerima, nominal, tenggat 30 hari dan tanggal cair individu tidak dimasukkan. Periode, kriteria, saluran dan pengecekan status dibedakan. |
| Hukum | Tiga penahanan dapat dibaca sebagai tiga tersangka untuk keseluruhan perkara; status dugaan dapat hilang | Tiga orang ditahan dibedakan dari empat tersangka perkara. Dugaan modus dan kerugian tetap diatribusikan kepada OJK, bukan kesimpulan pengadilan. Tanggapan tersangka/penasihat hukum belum tersedia pada bahan. |
| Lingkungan | Laporan operasi Oktober dapat tampak sebagai kondisi api terkini; generasi awal keliru menggambarkan tujuan modifikasi cuaca | Konteks peninjauan 24/10 dan dukungan penanganan dinyatakan jelas. Tidak menyimpulkan penyebab, api terkini, keberhasilan padam atau korban. |
| Ekonomi | Search mengutamakan rilis BI Oktober; prediksi dampak dapat berubah menjadi kepastian | Rilis BI November diambil dan dibandingkan dengan CNN. Kenaikan 25 bps menjadi 6 persen dibedakan dari tujuan stabilisasi/inflasi; tidak ada kepastian dampak KPR, kurs atau keuntungan. |
| Bursa | Pertemuan menanggapi pengumuman Oktober dapat tertukar dengan hasil evaluasi November | Cover dan lead menyebut laporan Kontan 10/11/2026. Pengumuman 16 Oktober dibedakan dari hasil evaluasi November yang dinantikan dalam laporan. Tidak menyatakan klasifikasi atau hasil review terkini. |

## Pemeriksaan visual

Cover berupa grafis vektor konseptual yang dibuat untuk paket ini, dengan SVG
sumber tersimpan. Credit `Grafis konseptual Gapura Media`, basis hak `own_work`;
cover dipasang melalui API manual agar descriptor UUID dan hash immutable
terikat pada draf. Grafis tidak disajikan sebagai foto kejadian atau data pasar.

Model utama sesi ini tidak mendukung pembacaan raster. Penilaian visual memakai
Gemini melalui SDK, dengan contact sheet enam slide, cover resolusi penuh dan
contoh slide isi. Pemeriksaan pertama mendeteksi tulisan kredit ganda pada tiga
cover; tulisan dalam gambar dihapus dan badge credit bawaan renderer
dipertahankan. Pemeriksaan ulang keenam desk berstatus `pass`: judul dan contoh
isi terbaca, credit terlihat, tidak ada clipping nyata pada gambar yang diperiksa.
Percobaan visual bursa sempat gagal provider dan berhasil setelah diulang;
kedua rekamannya tersedia.

Batasnya: tidak ada OCR penuh untuk setiap slide dan hasil Gemini bukan
penerimaan estetika owner. Owner masih menilai komposisi, ukuran huruf pada
perangkat sebenarnya, relevansi grafis, dan kebutuhan foto editorial.

## Keputusan yang dicatat

- Operator: **siap untuk review owner/redaktur setelah revisi**, enam desk.
- Review klaim independen: tidak ada temuan penghalang tersisa pada bagian yang
  diperiksa setelah koreksi. Batas sumber dan perspektif tetap dicatat.
- Owner: **PENDING**, tidak diberi keputusan atas namanya.
- Redaktur: **PENDING**, tidak dianggap sama dengan persetujuan publikasi.
- R7: **belum ditutup**. Keputusan harus merujuk hash revisi di lembar keputusan;
  perubahan naskah/gambar setelahnya memerlukan review kembali.

Tidak ada endpoint approve, penjadwalan, atau publisher yang dipanggil.
Verifikasi database: enam draf baru `draft/needs_review`, nol jadwal, nol target
publikasi, nol job Studio; enam draf lama tetap utuh. Timer pipeline/publisher
masih `disabled/inactive` dan worker tetap dijeda.

Backup sebelum pembuatan sampel:
`backups/hme_pre_six_desk_20261119_190332.dump` (0600, daftar pg_restore terbaca),
SHA-256 `633fd3f6f1fc928b60ad5728f1c3fb123f6eb377d22d801828b2f3aa41a5bfdb`.
Tidak ada migrasi atau perubahan kode aplikasi pada pembuatan paket ini.
