# Mengaktifkan publikasi Meta

Status 16 November 2026: worker dan `gapura-publisher.timer` terpasang, mode
`shadow`, platform `instagram,facebook`. Belum ada uji posting live. Akses baca
Page Gapura Media dan Instagram sudah berhasil, tetapi token belum memiliki
`instagram_content_publish` dan `pages_manage_posts`.

## Izin dan token

1. Buka aplikasi yang benar di [Meta for Developers](https://developers.facebook.com/apps/).
   Pastikan akun operator mempunyai akses ke Page Gapura Media dan Instagram
   profesional terhubung ke Page tersebut.
2. Konfigurasikan login dan permission sesuai jalur **Instagram API with Facebook
   Login**. Jalur ini menggunakan Facebook Page token pada `graph.facebook.com`.
   Jangan mencampurnya dengan scope `instagram_business_*` milik Instagram Login.
3. Minta akses `instagram_basic`, `instagram_content_publish`,
   `pages_show_list`, `pages_read_engagement`, dan `pages_manage_posts` yang
   diperlukan untuk penemuan akun/publikasi ini. Ikuti persyaratan tugas Page,
   access level, dan App Review yang ditampilkan Meta untuk aplikasi tersebut.
   Menambahkan nama permission di konfigurasi lokal tidak memberikan izin.
4. Selesaikan login/consent kembali melalui aplikasi yang benar. Verifikasi
   `GET /me/permissions` pada **User token**, lalu ambil **Page token** Gapura
   Media melalui `GET /me/accounts`. Jangan menempel token dalam Git, URL,
   screenshot, log, atau deskripsi PR.
5. Simpan Page token di `META_PAGE_ACCESS_TOKEN` pada
   `/etc/gapura/runtime.env` (`0600`). ID yang sudah dikonfigurasi:
   `META_PAGE_ID=102321216076547` dan
   `META_INSTAGRAM_ACCOUNT_ID=17841471438781611`.
6. Ulangi pemeriksaan baca Page/IG dan
   `GET /17841471438781611/content_publishing_limit` dengan header bearer.
   Code 10 yang masih meminta `instagram_content_publish` berarti izin belum
   berhasil diberikan; pertahankan mode shadow.

App yang melayani akun di luar role/tester aplikasi dapat membutuhkan advanced
access dan App Review. Ikuti hasil pemeriksaan dashboard Meta; jangan menganggap
keberhasilan baca akun membuktikan izin publish.

## Review dan jadwal

Redaktur membuka detail draf terbaru, meninjau sumber, skor Analis, laporan
verifikasi, caption, tagar, dan slide, lalu mencentang konfirmasi review.
Persetujuan menyimpan hash konten dan menjadwalkan tayang +3 jam. Tab dengan
konten/revision lama menerima HTTP 409 dan harus dimuat ulang sebelum ditinjau.

Worker memerlukan sumber HTTPS publik, hasil Analis terbaru `passed`, laporan
`verified` dengan confidence 80–100, `needs_review=false`, bukti persetujuan
manusia, hash konten yang cocok, akun tujuan aktif, dan jadwal jatuh tempo.
Draf historis tanpa bukti ini tetap diblokir. Jangan membuat verifikasi palsu
atau memindahkan status secara langsung untuk menguji publisher.

`shadow` mencatat target yang lolos tanpa menghubungi Meta. Status `blocked`
berarti gate menolak. Setelah perubahan konten, redaktur wajib meninjau ulang;
jadwal baru dapat mengaktifkan kembali target yang belum pernah mencoba publish.

## Menyiapkan satu uji live

Hentikan timer publisher selama persiapan uji agar perubahan mode tidak mengirim
antrean secara tidak sengaja:

```bash
systemctl stop gapura-publisher.timer
```

Periksa semua target dan jadwal yang jatuh tempo sebelum memilih akun tester
dan draf yang telah disetujui. Mengubah `META_PUBLISH_MODE=live` mengaktifkan
pemrosesan **semua** target eligible pada platform aktif; jangan mengaktifkannya
untuk uji satu draf jika antrean masih memuat draf lain yang siap kirim.

Setelah izin, akun, dan antrean uji sudah benar, jalankan service secara manual.
Target berstatus `shadow` memerlukan reset shadow eksplisit; reset tidak boleh
mengenai `unknown`, `publishing`, atau `published`. Periksa `remote_id`,
`container_id`, permalink, audit log, dan posting di akun Meta sebelum
mengaktifkan siklus live rutin. Bila hasil belum pasti, kembalikan mode ke
shadow dan rekonsiliasi terlebih dahulu.

Jadwal dinyatakan selesai hanya setelah seluruh targetnya `published`.
Publisher legacy menyerahkan pekerjaan bila `META_PLATFORMS` terpasang dan tidak
dipanggil dari pipeline intake.

## Hasil tak pasti dan rekonsiliasi

Timeout pada langkah publish dapat berarti posting sudah tayang. Worker menyimpan
`unknown` beserta remote/container ID yang diketahui dan tidak mengirim ulang.
Klaim yang ditinggalkan proses sebagai `publishing` juga tidak direset otomatis.
Periksa container/status dan posting pada akun Meta, lalu catat hasilnya sebelum
operator memutuskan retry. Pengeditan aset draf diblokir setelah publish dicoba.

```bash
systemctl list-timers 'gapura-*'
journalctl -u gapura-publisher.service -n 40 --no-pager
```

## Threads

Threads memakai `https://graph.threads.com/v1.0`, `META_THREADS_USER_ID`, dan
`META_THREADS_ACCESS_TOKEN` tersendiri dengan `threads_basic` serta
`threads_content_publish`. Page token Facebook tidak dipakai sebagai fallback.
Tanpa advanced access, dokumentasi Meta membatasi publish pada Threads tester
aplikasi. Platform Threads tetap nonaktif sampai kredensial dan aksesnya diuji.

Instagram memerlukan JPEG; Threads mendukung JPEG dan PNG. Gapura menggunakan
JPEG turunan yang sama untuk seluruh adapter. Threads membatasi teks 500
karakter; caption terlalu panjang ditolak untuk review versi khusus, bukan
dipotong diam-diam.

## Referensi resmi

Diakses 16 November 2026:

- [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/)
- [Facebook Page posts dan photos](https://developers.facebook.com/docs/pages-api/posts/)
- [Threads posts, permission, dan media specification](https://developers.facebook.com/docs/threads/posts/)
