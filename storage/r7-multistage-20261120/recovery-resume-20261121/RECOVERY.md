# Verifikasi dan pemulihan lanjutan R7

Direktori kerja: `/root/gapura`. Perubahan belum di-commit atau di-push. Gunakan snapshot lanjutan ini untuk membatalkan perubahan pada lanjutan terbaru; folder `recovery-20261121` menyimpan fase pemulihan sebelumnya.

## Verifikasi yang telah dijalankan

```bash
node --experimental-vm-modules --experimental-test-module-mocks --test services/common/test/*.test.js services/copywriter/test/*.test.js services/render/test/*.test.js services/scout/test/article-reader.test.js services/scout/test/article-transport.test.js
```

Hasil akhir: **471 lulus, 0 gagal, 0 skip**. Log: `../debug/regression-ready-20261121.log`.

Audit paket dapat diulang tanpa generasi atau panggilan provider:

```bash
node storage/r7-multistage-20261120/audit-sample.mjs bursa /root/gapura/storage/r7-multistage-20261120/editorial-proposals/bursa
node storage/r7-multistage-20261120/audit-sample.mjs ekonomi /root/gapura/storage/r7-multistage-20261120/editorial-proposals/ekonomi
```

Hasil yang diharapkan: `candidate_checks_passed_human_review_pending`, dengan hash pemeriksaan klaim cocok dengan salinan publik kandidat. Status itu berlaku untuk proposal alternatif di `editorial-proposals/`, bukan revisi database yang ditandatangani owner. Audit owner atas revisi database #161 dan #159 telah lulus; proposal alternatif tidak diterapkan atau disetujui. Audit otomatis menguji native gate, referensi, batas kata/karakter, ukuran/hash PNG, dan koordinat teks.

Jangan menjalankan ulang `build-editorial-proposals.mjs` setelah kandidat dinilai tanpa bermaksud membuat revisi baru. Builder menghasilkan ulang metadata kandidat dan mengharuskan pemeriksaan klaim serta pencatatan hash baru. Builder tidak menulis database atau menghubungi provider. `recheck-editorial-proposals.mjs` hanya untuk pemeriksaan klaim; langkah itu menghubungi provider dan memakai kuota.

## Rollback kode dan tes

`rollback-continuation.patch` mencakup 12 berkas runtime, tes dan harness. `git apply --check` telah dijalankan terhadap workspace terakhir. `SOURCE_CHANGES.json` mencatat path dan hash sebelum/sesudah. Snapshot dua berkas paritas tahun direkonstruksi dari salinan sebelum koreksi atribusi dengan membalik perubahan rentang tahun yang tercatat; berkas sumber aktif tidak disentuh saat pembuatan patch.

```bash
git apply --check storage/r7-multistage-20261120/recovery-resume-20261121/rollback-continuation.patch
git apply storage/r7-multistage-20261120/recovery-resume-20261121/rollback-continuation.patch
```

Patch tidak menghapus artefak review, proposal, catatan audit atau draft database. Jangan memakai reset/restore repository secara menyeluruh: workspace sudah memiliki pekerjaan lain yang belum di-commit. Rollback akan mengembalikan kekurangan validasi dan perilaku router yang diperbaiki dalam lanjutan ini.

## Snapshot saat pemulihan dibuat

- Pada snapshot pemulihan ini, draft live sumber 159 (ekonomi) dan 161 (Bursa) berstatus `draft`, `needs_review=true`; caption longform sudah diterapkan, artikel/slide/Threads tidak diubah, dan pemeriksaan klaim terhadap draft aktual lulus. Sign-off owner final dicatat sesudah snapshot tersebut.
- Draft 156 tetap `rejected`; draft 157, 158 dan 160 tetap `failed`.
- Kandidat artikel/slide di `editorial-proposals/` belum diterapkan ke database. Caption longform diterapkan secara terpisah ke draft review dan backup sebelum perubahan ada di `db-caption-before-apply/`.
- Tidak ada publication target untuk 159/161. Kedua timer produksi tetap disabled/inactive. Renderer review localhost sudah berhenti; renderer produksi tidak direstart.

## Status setelah sign-off owner

Status terbaru ada di `../REVIEW_STATUS.json` dan `../REVIEW.md`. Owner menyelesaikan audit editorial dan visual R7 untuk revisi database Bursa #161 (`1548b818b3475d4708437acc2187a08f4406463aeaac09ab3b8f5a0a2909909a`) dan ekonomi #159 (`04393a19a74f62757e64d9e1b90f0045fda4f063441da588f02403f7b8c808dc`) pada 2026-11-21. R7 berstatus `human_audit_passed_r7_complete`.

Kedua draft tetap `draft`/`needs_review=true`; tidak ada publication target untuk sampel tersebut. Proposal alternatif di `editorial-proposals/` tidak diterapkan dan bukan revisi yang disetujui. R8 siap untuk batch shadow manual, tetapi batch belum dijalankan. Publikasi live belum disetujui, dan timer pipeline/publisher tetap disabled/inactive; uji publish dan aktivasi timer memerlukan mandat terpisah.
