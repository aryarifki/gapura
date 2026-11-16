# Reset workspace desain/konten — 16 November 2026

Dilaksanakan atas permintaan owner sebelum menyusun blueprint desain dan isi
konten baru. Ini membersihkan hasil produksi lokal dan antreannya; tidak
menghapus kode/template atau akun/posting Meta.

Waktu reset: `2026-11-16T15:26:09Z` / 22:26:09 WIB.

## Hasil pembersihan

| Data hasil produksi | Sebelum | Sesudah |
| --- | ---: | ---: |
| `drafts` | 142 | 0 |
| `draft_slides` | 269 | 0 |
| `scheduled_posts` | 2 | 0 |
| `publication_targets` | 4 | 0 |
| `prompt_jobs` | 5 | 0 |
| `job_logs` | 43 | 0 |
| Berkas render/test desain | 556 | 0 |

Jumlah berkas mencakup hasil di `storage/drafts`, `storage/test_output`, dan
`storage/test_slide*.png`. Direktori `storage/drafts` dibuat kembali dalam
keadaan kosong. Storage n8n tidak disentuh dan sequence ID tidak direset.

Pipeline sempat menambah dua draf/dua slide sebelum dihentikan. Angka inventaris
awal berbeda dari snapshot final; tabel di atas mengikuti snapshot saat reset,
bukan angka awal yang dipakai untuk perkiraan.

## Backup dan verifikasi

Backup privat:

`/root/gapura-backups/editorial-redesign-reset-20261116T152609Z/`

- `hme-before.dump`: backup PostgreSQL format custom seluruh database `hme`.
- `render-assets-before.tar.gz`: arsip 556 berkas, total isi 36.616.620 byte.
- `asset-inventory.json`: path, ukuran, SHA-256 setiap aset.
- `reset.sql`: transaksi penghapusan dengan daftar tabel eksplisit, lock timeout,
  serta penolakan jika ada bukti publikasi remote/hasil tidak pasti.
- `reset-manifest.json`: jumlah sebelum/sesudah, checksum tabel dipertahankan,
  state layanan, hasil restore test dan verifikasi konfigurasi/kredensial.

Direktori backup `0700`, semua berkas `0600`; isi data/secret tidak masuk Git.
Backup berhasil dipulihkan ke database sementara. Transaksi cleanup diuji pada
hasil restore terlebih dahulu: keenam tabel produksi kosong dan checksum tabel
yang dipertahankan identik. Transaksi yang sama kemudian dijalankan di produksi.
Seluruh 556 berkas dalam arsip juga dibaca kembali dan checksum-nya cocok dengan
inventaris SHA-256, bukan hanya diperiksa keberadaan file arsipnya.

Tabel yang tetap utuh pada cutoff reset:

| Data dipertahankan | Baris |
| --- | ---: |
| Sources / trend sources | 22 / 12 |
| Topics / raw items | 1.181 / 1.174 |
| Topic scores / laporan verifikasi historis | 1.173 / 125 |
| Trend items | 982 |
| Brand settings / app settings | 1 / 5 |
| Audit log / agent runs / LLM usage | 397 / 261 / 0 |

Report verifikasi historis belum dihapus pada reset desain. Penghapusan seluruh
fitur runtime/schema Verifikator masuk tahap R5 blueprint, setelah semua
dependensinya dibersihkan; bukan menyamarkan report lama menjadi verified.
Gate R5 juga wajib membuktikan bahwa agen tidak dapat dipilih/dipanggil lewat
pipeline, Studio, API, Telegram, publisher, konfigurasi, prompt aktif, job atau
polling; produksi tidak membuat report atau panggilan LLM verifier. Enum/report
historis boleh diarsipkan selama tidak ikut query keputusan runtime.

Checksum runtime env, file kredensial Meta Unified, admin/signature secret,
provider keys, `config/`, dan `design-system/` cocok sebelum–sesudah reset.
Pemeriksaan API publik sesudah web hidup: `/api/drafts` 200 dengan array kosong,
`/api/studio/jobs` 200 dengan daftar kosong, serta `/integrations/meta/status`
tetap `connected=true`, akun `@gapuramedia` ID `17841471438781611`.
Chromium pada domain publik juga menunjukkan 0 kartu galeri dan pesan
`Tidak ada draf dalam kategori "all".`.

## Keadaan operasional selama review desain

- `gapura-pipeline.timer`: disabled/inactive.
- `gapura-publisher.timer`: disabled/inactive.
- Pipeline/publisher yang sedang berjalan dihentikan sebelum backup.
- `hme-web.service` hidup kembali dengan drop-in
  `/etc/systemd/system/hme-web.service.d/editorial-review.conf`:
  `Environment=GAPURA_DISABLE_WORKERS=true`.
- Dashboard, render service, n8n canvas, dan koneksi Meta tetap tersedia.
- Drop-in menjeda worker Studio background. Aksi manual redaktur tetap dapat
  membuat konten; tidak ada mekanisme yang menghapus ulang konten baru diam-diam.
- Publisher runtime tetap `META_PUBLISH_MODE=shadow`; tidak ada publish live
  atau penghapusan post remote selama tindakan ini.

Status ini sengaja menggantikan snapshot P2 sebelumnya yang menunjukkan timer
aktif. Unit runtime systemd tetap sumber kebenaran; template `deploy/` tidak
diubah hanya untuk jeda evaluasi sementara.

## Pemulihan / aktivasi kembali

Tidak mengaktifkan otomatisasi kembali sampai desain dan isi konten disetujui
owner. Urutan tunggalnya: **R7 sampel disetujui → R8 batch/shadow dijalankan
manual → satu publish uji mendapat persetujuan terpisah → timer diaktifkan atas
mandat eksplisit**. Operator kemudian menghapus **hanya** drop-in jeda, reload
systemd, restart web, dan enable timer. Jangan mengubah drop-in integrasi/secret
atau mengaktifkan workflow otomatis n8n sebagai pengganti.

```bash
# Hanya sesudah owner menerima sampel dan memberi mandat aktivasi.
rm /etc/systemd/system/hme-web.service.d/editorial-review.conf
systemctl daemon-reload
systemctl restart hme-web
systemctl enable --now gapura-pipeline.timer gapura-publisher.timer
systemctl list-timers --all 'gapura-*'
```

Menghidupkan timer publisher dalam mode shadow tetap tidak mempublikasikan.
Aktivasi live adalah keputusan terpisah atas draf yang direview.

Rollback isi lama dilakukan dari backup privat dengan periode pemeliharaan,
bukan restore penuh ke database aktif secara sembarang. Gunakan database
restore sementara dan pilih tabel/aset yang hendak dipulihkan agar perubahan
konfigurasi/koneksi setelah reset tidak tertimpa. Full restore test sudah lulus,
tetapi restore selektif produksi belum diperlukan/dijalankan.
