# R7 — Paket audit manusia, 21 November 2026

> **SIGN-OFF OWNER — 2026-11-21.** Audit editorial dan visual manusia atas draft app **#161 (Bursa)** dan **#159 (ekonomi)** selesai dan **disetujui**. Revisi yang disetujui (hash konten saat ini):
> - Bursa #161: `1548b818b3475d4708437acc2187a08f4406463aeaac09ab3b8f5a0a2909909a` — caption 1529 karakter.
> - Ekonomi #159: `04393a19a74f62757e64d9e1b90f0045fda4f063441da588f02403f7b8c808dc` — caption 1455 karakter.
>
> Persetujuan ini menutup gate audit manusia R7. **Bukan persetujuan publikasi**: kedua draft tetap `draft`/`needs_review=true`, tanpa publication target; satu publish uji masih menunggu mandat terpisah. Kandidat koreksi di `editorial-proposals/` tidak diterapkan — revisi yang disetujui adalah isi database saat ini. Timer pipeline/publisher tetap disabled/inactive.


**Sign-off manusia R7 selesai.** Revisi database untuk draft Bursa **#161** dan ekonomi **#159** sudah disetujui owner sesuai hash pada sign-off di atas. R7 ditutup; R8 siap untuk batch shadow manual. Persetujuan publikasi tetap belum diberikan.

Revisi yang disetujui dapat diperiksa di app: `https://gapura.avenia.my.id/#view-review/draft/161` dan `https://gapura.avenia.my.id/#view-review/draft/159`. Caption artikel-mini sudah diterapkan ke kedua draft. Artikel, slide dan Threads berasal dari draft live. Status database tetap `draft`/`needs_review=true`; sign-off audit R7 tidak sama dengan persetujuan publish.

Kandidat koreksi editorial di bawah hanya bahan perbandingan. Kandidat melewati gate mekanis, validasi integrasi, pemeriksaan klaim ulang, dan audit geometri PNG, tetapi tidak diterapkan dan bukan revisi yang disetujui owner. Hasil generasi live asli tetap disimpan sebagai pembanding.

| Desk | Draft live asal | Artikel asli | Artikel kandidat | Isi slide 2 | Caption | PNG kandidat |
|---|---:|---:|---:|---:|---:|---|
| Bursa | 161 | 435 kata | 435 kata | 110 kata | 1.529 karakter / 3 paragraf | 3 × 1080 × 1350 |
| Ekonomi | 159 | 429 kata | 427 kata | 181 kata | 1.455 karakter / 3 paragraf | 3 × 1080 × 1350 |

## Bursa

Judul kandidat: **Bursa Efek Indonesia Memperkuat Reformasi Pasar Modal Menjelang Penerapan Perubahan Indeks**.

- [Artikel kandidat](editorial-proposals/bursa/article.md)
- [Caption kandidat](editorial-proposals/bursa/caption.txt) — 1529 karakter body, 3 paragraf isi; versi artikel-mini dengan hook, rincian kebijakan/kronologi dan pertanyaan pembaca.
- Caption app draft #161: 1529 karakter; hash revisi app `04cc7151dce3be7ce8e8380e4685eadad2e01fca788fa9ae41b9d769f1213ce7`; pemeriksaan klaim pada draft aktual lulus.
- [Threads kandidat](editorial-proposals/bursa/threads.txt)
- PNG: [slide 1](editorial-proposals/bursa/slide_1.png), [slide 2](editorial-proposals/bursa/slide_2.png), [slide 3](editorial-proposals/bursa/slide_3.png)
- [Pemeriksaan klaim ulang](editorial-proposals/bursa/CLAIM_REVIEW.json) — `supported: true`, tanpa temuan.
- [Audit otomatis dan koordinat teks](editorial-proposals/bursa/AUTOMATED_AUDIT.json)
- [Daftar perubahan, rujukan, dan hash](editorial-proposals/bursa/REVIEW_STATUS.json)
- [Hasil live asli draft 161](samples/bursa/article.md)

Perbaikan kandidat mengubah framing judul menjadi menjelang **implementasi perubahan**, bukan seolah pengumuman evaluasi belum terjadi; mengganti waktu relatif dengan tahun absolut atau menghapus klausa itu; menghapus sebutan sanksi administratif yang belum ditopang petikan; memakai kriteria kepemilikan terkonsentrasi alih-alih label umum emiten berisiko; serta mengganti klaim kesetaraan hasil pengawasan dengan uraian kebijakan yang diatribusikan. Caption app sekarang berupa narasi tiga paragraf yang mencakup komunikasi regulator, langkah reformasi dan urutan tanggal evaluasi/implementasi. Rujukan fakta caption ditambahkan pada blok yang relevan.

Hash revisi kandidat:

```text
83afd3594eb3d11ccfa642ce812c8d0e1aa2b30a8d312f1cb65fb34d802b0c32
```

## Ekonomi

Judul kandidat: **Bank Indonesia Menaikkan BI-Rate Sebesar 25 Basis Poin Menjadi 6 Persen**.

- [Artikel kandidat](editorial-proposals/ekonomi/article.md)
- [Caption kandidat](editorial-proposals/ekonomi/caption.txt) — 1455 karakter body, 3 paragraf isi; versi artikel-mini dengan hook, rincian kebijakan/kronologi dan pertanyaan pembaca.
- Caption app draft #159: 1455 karakter; hash revisi app `fdd63af93f6e9711fb17a0499b47afb8e60ae8fb7e7d3f26a55b2e50571b4f63`; pemeriksaan klaim pada draft aktual lulus.
- [Threads kandidat](editorial-proposals/ekonomi/threads.txt)
- PNG: [slide 1](editorial-proposals/ekonomi/slide_1.png), [slide 2](editorial-proposals/ekonomi/slide_2.png), [slide 3](editorial-proposals/ekonomi/slide_3.png)
- [Pemeriksaan klaim ulang](editorial-proposals/ekonomi/CLAIM_REVIEW.json) — `supported: true`, tanpa temuan.
- [Audit otomatis dan koordinat teks](editorial-proposals/ekonomi/AUTOMATED_AUDIT.json)
- [Daftar perubahan, rujukan, dan hash](editorial-proposals/ekonomi/REVIEW_STATUS.json)
- [Hasil live asli draft 159](samples/ekonomi/article.md)

Perbaikan kandidat membedakan **besaran pengurangan premi** dari tarif premi agar angka 40% → 45% dan 45% → 50% tidak diberi arah yang keliru. Caption app sekarang menerangkan keputusan dan fasilitas bunga, intervensi valuta asing serta instrumen lindung nilai, pengurangan premi per tenor, lalu fasilitas likuiditas dan tujuan inflasi. Penjelasan poin utama dan Threads diselaraskan serta rujukan insentif ditambahkan.

Hash revisi kandidat:

```text
c46b7a8c59ce95e477ab7290a0a09720db4fabf862e5f584c8ec216b86ce824a
```

## Keputusan Owner

| Gate | Status | Keputusan |
|---|---|---|
| Audit editorial draft database #161 dan #159 | Lulus — owner, 2026-11-21 | Hash yang disetujui tercantum pada sign-off di atas dan `REVIEW_STATUS.json`. |
| Audit visual draft database #161 dan #159 | Lulus — owner, 2026-11-21 | Kedua cover tipografis; PNG diperiksa sebagai bagian dari revisi yang disetujui. |
| Proposal koreksi artikel/slide di `editorial-proposals/` | Tidak diterapkan | Proposal bukan revisi yang disetujui dan tidak mengubah database. |
| Persetujuan publikasi | Belum diberikan | Tidak ada publication target untuk kedua sampel. Uji publish perlu mandat terpisah. |

Kedua cover yang disetujui bersifat **tipografis**. Pada ekonomi, asset bank mencatat calon foto yang relevan, tetapi foto itu tidak diterapkan pada cover. Audit visual owner atas revisi database yang disetujui telah lulus; catatan raster dan koordinat otomatis tetap tersedia pada paket.

Draft database 159 dan 161 tetap `draft`, `needs_review=true`; tidak ada publication target untuk keduanya. Pemeriksaan klaim terhadap revisi yang ditandatangani lulus tanpa temuan. R8 siap untuk batch shadow manual; kedua timer tetap disabled/inactive. Sign-off editorial/visual tidak mengizinkan publish live atau aktivasi timer.

Verifikasi kode: **471/471 tes lulus**, nol gagal dan nol skip. [Laporan teknis](REVIEW.md), [simulasi kegagalan](FAILURE_SIMULATIONS.md), dan [verifikasi ulang/rollback](recovery-resume-20261121/RECOVERY.md).
