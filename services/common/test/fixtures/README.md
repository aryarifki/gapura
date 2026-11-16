# Fixture editorial R1

`editorial-stories.json` adalah corpus offline untuk menguji kontrak editorial
R1. Isinya enam berita sintetis berbahasa Indonesia, satu untuk setiap desk:
`politik`, `sosial`, `hukum`, `lingkungan`, `ekonomi`, dan `bursa`.

Semua nama badan, orang, penerbit, lokasi, angka, jadwal, dan peristiwa di
corpus ini dibuat khusus untuk pengujian. Metadata `synthetic: true` ada di
root JSON dan pada setiap story agar fixture tidak dibaca sebagai berita nyata.
URL sumber memakai `example.org`, sedangkan URL media memakai
`media.example.org`; keduanya hanya alamat cadangan untuk contoh dan tidak
perlu diakses.

Setiap story memiliki enam paragraf materi `p1` sampai `p6`. Draft-nya selalu
berformat carousel enam slide, memiliki rujukan evidence, caption body tanpa
boilerplate internal, dan tagar yang disimpan terpisah dari caption. Fixture
politik memuat kutipan dengan speaker yang dapat dicocokkan persis. Fixture
lingkungan memuat event timeline dengan tanggal ISO berurutan.

Asset cover juga sintetis: `editorial-cover.png.base64` menyimpan PNG raster
360×450 satu warna untuk pemeriksaan MIME, dimensi, checksum dan jalur embedded.
Checksum yang dicatat adalah SHA-256 **byte PNG setelah base64 didekode**, bukan
checksum file teks. File ini dibuat secara deterministik sebagai raster uji,
bukan generasi foto atau representasi kejadian nyata. Nilai `status: "downloaded"`,
dasar `owned`, dan URI `fixture://` hanya menjelaskan kepemilikan raster tes,
bukan pernyataan hak terhadap foto dari penerbit.

Fixture ini tidak membuktikan feed, resolver, URL gambar, download, lisensi,
atau media live. Acceptance foto nyata dan hak penggunaan dilakukan pada R3/R7.
Memuat file ini tidak menjalankan runtime, tidak mengisi database, tidak
mengaktifkan timer, dan tidak menambah isi galeri.
