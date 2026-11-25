# Mengaktifkan publikasi Meta

Status 25 November 2026: **publikasi LIVE di produksi.** Instagram
`@gapuramedia` (ID `17841471438781611`) dan Facebook Page "Gapura Media"
(ID `102321216076547`) menerima terbitan nyata lewat Graph API **v27.0**
(Meta app `1123019133826199`). Izin publish terverifikasi penuh — Instagram
SUAT mencakup seluruh izin termasuk `instagram_content_publish` dan
`pages_manage_posts`; Page token berlaku tanpa kedaluwarsa. Uji live
pertama berhasil 2026-11-23 dan sejak itu penerbitan berjalan setiap hari.

Jalur penerbitan aktif adalah **publish-now** dari `hme-web`:
`POST /api/drafts/:id/publish-now` dengan body
`{"reviewed": true, "expected_revision": "<revision draf>"}` — dipakai
Claude Intake (edisi harian Muse), dashboard, dan Space Ruang Produksi.
Gerbang verdict analis sudah **dihapus** dari `publish-now.js` dan
`meta-worker.js` pada 2026-11-23; tidak ada syarat verdict, skor, atau
confidence untuk menerbitkan. Timer `gapura-publisher` nonaktif sejak
2026-11-24 (sentralisasi redaksi ke Muse); worker Meta tetap dipakai
publish-now secara sinkron. Bagian Unified Login di bawah tetap berlaku
sebagai dokumentasi koneksi akun yang sedang berjalan; bagian "Review dan
jadwal" serta "Menyiapkan satu uji live" sudah digantikan alur publish-now
pada bagian "Alur penerbitan saat ini".

## Unified Login untuk app baru

Meta merekomendasikan Instagram API with Unified Login untuk integrasi baru.
Konfigurasi Gapura yang diberikan owner:

```env
META_APP_ID=1123019133826199
META_UNIFIED_CONFIG_ID=1848852586267233
META_UNIFIED_REDIRECT_URI=https://gapura.avenia.my.id/integrations/meta/callback
META_UNIFIED_GRAPH_VERSION=v27.0
```

`META_APP_SECRET` adalah secret **Meta app** tersebut dan harus dipasang di
`/etc/gapura/runtime.env` (`0600`) oleh operator. Jangan memakai Instagram App
Secret atau Threads App Secret, dan jangan memasukkan secret dalam Git, URL,
form dashboard publik, atau pesan. App ID dan config ID sendiri bukan secret.

Setelah secret dipasang, restart `hme-web.service` dan buka
`https://gapura.avenia.my.id/integrations/meta/`, lalu klik **Hubungkan Instagram**.
Halaman ini adalah koneksi akun Meta, bukan halaman login dashboard.
Jika konfigurasi belum lengkap, halaman menjelaskan prasyarat dan endpoint
`/integrations/meta/connect` menolak dengan 503 tanpa mengirim pengguna ke Meta.

Jangan membuka langsung URL template Meta dengan `state=<STATE>`. Gapura
membuat state acak dan nonce cookie terpisah (`HttpOnly`, `Secure`,
`SameSite=Lax`), berlaku 10 menit dan sekali pakai. Callback memvalidasi keduanya
sebelum menukar code di server. Browser menerima konfirmasi tanpa token/code;
header `no-referrer` dan `no-store` berlaku pada semua respons integrasi.
Restart web membatalkan state yang masih berjalan; mulai ulang koneksi setelah
restart. Rate limit koneksi 10 permintaan per 10 menit per alamat klien.
Header `CF-Connecting-IP` yang valid hanya dipercaya dari peer loopback
cloudflared; koneksi lain memakai alamat socket tanpa mempercayai header itu.

Hasil Unified Login adalah **Business Integration System User Access Token**
(SUAT), bukan Page token. Akun ditemukan melalui
`GET /me/assigned_instagram_accounts?fields=id,username` dan business portfolio
melalui `GET /me?fields=client_business_id`. Koneksi harus mencakup Instagram
yang cocok dengan `META_INSTAGRAM_ACCOUNT_ID`; jika ID tidak diatur, hanya satu
akun yang dibagikan dapat dipilih otomatis. Daftar akun yang terpotong karena
paginasi tidak akan menyebabkan pemilihan akun lain; ulangi onboarding dengan
akun tujuan yang benar jika akun tidak ditemukan.

Koneksi disimpan terpisah di `/etc/gapura/meta-unified.json` (`0600`), berisi
token, app/config ID, client business ID, akun/username Instagram, versi API,
waktu koneksi, serta waktu kedaluwarsa bila Meta memberikannya. File tersebut
tidak pernah disajikan oleh web atau dimasukkan ke Git. Endpoint
`/integrations/meta/status` hanya mengembalikan metadata non-secret dan status.

Worker Instagram memakai koneksi Unified yang cocok dengan app/config/account;
Facebook tetap menggunakan Page token tersendiri, Threads menggunakan token
Threads. Koneksi Unified yang kedaluwarsa menonaktifkan Instagram dan harus
diotorisasi ulang; implementasi ini belum melakukan refresh otomatis SUAT.
Menyambungkan akun tidak dengan sendirinya mengaktifkan platform baru atau
mengubah mode publikasi runtime.

### Jika Finish menghasilkan error

Pertukaran kode harus mengirim `redirect_uri` yang sama persis dengan URL pada
awal login. Gapura mengirimnya kembali bersama Meta App ID, App Secret, dan
kode otorisasi. Kode sekali pakai tidak boleh dicoba ulang setelah exchange;
mulai koneksi baru melalui halaman `/integrations/meta/`.

Kegagalan callback yang sudah ditangani memakai HTTP 400 agar pesan aplikasi
tidak digantikan halaman Bad Gateway 502 dari proxy. Pesan menampilkan tahap
tetap dan kode numerik Meta jika tersedia:

| Tahap | Pemeriksaan |
| --- | --- |
| `token_exchange` | App Secret milik app yang benar, kode baru, redirect cocok persis |
| `business_discovery` | Token hasil Unified Login/SUAT dan business portfolio |
| `instagram_discovery` | Izin `instagram_basic` dan akun yang dibagikan |
| `account_selection` | Instagram yang dibagikan cocok dengan akun Gapura yang dikonfigurasi |
| `connection_storage` | File koneksi privat dapat ditulis oleh service |

Journal mencatat tahap, HTTP status upstream, kode/subkode numerik, serta trace
ID Meta yang valid. Pesan mentah upstream, request URL, kode login, token, dan
App Secret tidak dicatat. Periksa dengan
`journalctl -u hme-web --since '-10 min' --no-pager`; jangan membagikan URL
callback lengkap karena query-nya dapat berisi kode otorisasi.

## Jalur lama: Facebook Login dan Page token

Jalur ini adalah jalur yang benar-benar memasok Page token produksi saat
ini (token Page tersimpan di runtime server dan berlaku tanpa
kedaluwarsa); Unified Login di atas memasok koneksi Instagram (SUAT).
Langkahnya dicatat sebagai referensi perawatan:

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
   berhasil diberikan.

App yang melayani akun di luar role/tester aplikasi dapat membutuhkan advanced
access dan App Review. Ikuti hasil pemeriksaan dashboard Meta; jangan menganggap
keberhasilan baca akun membuktikan izin publish. (Di produksi, kedua izin
publish sudah terverifikasi diberikan — lihat status di awal dokumen.)

## Alur penerbitan saat ini (publish-now)

Penerbitan produksi berjalan sinkron lewat `hme-web`:

1. Draf dibuat lewat Claude Intake (`create-from-custom`, review-only)
   atau dashboard/Studio. **Render carousel terjadi satu kali pada saat
   draf dibuat**; tidak ada render ulang pada saat publish.
2. Pemanggil mengambil `revision` terkini dari `GET /api/drafts/:id`.
3. `POST /api/drafts/:id/publish-now` dengan body
   `{"reviewed": true, "expected_revision": "<revision>"}`. Syaratnya:
   status draf `draft` atau `scheduled`, dan tidak ada target yang sedang
   `publishing`/`unknown`. Selain itu tidak ada gate lain — gerbang
   verdict analis, skor Analis, dan laporan verifikasi **bukan** syarat
   (dihapus 2026-11-23).
4. Worker Meta menerbitkan ke Instagram dan Facebook; hasil per platform
   tercatat di `publication_targets` beserta `remote_id`, `container_id`,
   dan permalink. Status akhir draf `published` (atau `partial` bila
   hanya sebagian platform berhasil).
5. Draf yang sudah terbit **tidak bisa diterbitkan ulang**; repost selalu
   berarti draf intake baru.
6. Bila isi/render draf lama perlu diperbaiki sebelum terbit, render ulang
   lewat `POST /api/drafts/:id/edit-slide` `{slide_no}` — ditolak untuk
   draf yang sudah terbit atau sudah pernah dicoba publish.

Penjadwalan dari Space Ruang Produksi dan dashboard memakai mekanisme yang
sama: draf berstatus `scheduled` diterbitkan publish-now saat waktunya tiba.

Untuk konteks operasional harian: empat edisi otomatis Muse menerbitkan
dengan alur ini setiap hari (batas total 6 konten/hari), dan setiap draf
terbit menjadi artikel di gapuramedia.my.id. Kegagalan publish tidak
pernah dicoba ulang secara buta; draf gagal tetap menunggu di dashboard
untuk diterbitkan manual.

## Hasil tak pasti dan rekonsiliasi

Timeout pada langkah publish dapat berarti posting sudah tayang. Worker menyimpan
`unknown` beserta remote/container ID yang diketahui dan tidak mengirim ulang.
Klaim yang ditinggalkan proses sebagai `publishing` juga tidak direset otomatis.
Periksa container/status dan posting pada akun Meta, lalu catat hasilnya sebelum
operator memutuskan retry. Pengeditan aset draf diblokir setelah publish dicoba.

```bash
systemctl list-timers 'gapura-*'
journalctl -u hme-web.service -n 40 --no-pager
```

## Catatan operasional tunnel

Dashboard/API menjangkau publik lewat Cloudflare Tunnel dari server.
Selama November 2026 terjadi gangguan berulang yang terdiagnosis sebagai
**pemfilteran SNI `h2.cftunnel.com` di jaringan upstream**: koneksi tunnel
berfluktuasi (turun-naik) dan health endpoint sesekali menjawab 503/1033.
Watchdog cloudflared di server memulihkan koneksi secara otomatis dan
edisi harian yang gagal health check ditutup edisi berikutnya lewat
aturan susulan. Gangguan ini **belum dinyatakan teratasi permanen**;
perlakukan 503 sesaat sebagai kondisi yang dikenal, bukan kerusakan
aplikasi — periksa status tunnel dan watchdog sebelum mengutak-atik
service aplikasi.

## Threads

Threads memakai `https://graph.threads.com/v1.0`, `META_THREADS_USER_ID`, dan
`META_THREADS_ACCESS_TOKEN` tersendiri dengan `threads_basic` serta
`threads_content_publish`. Page token Facebook tidak dipakai sebagai fallback.
Tanpa advanced access, dokumentasi Meta membatasi publish pada Threads tester
aplikasi. Platform Threads **belum aktif di produksi** sampai kredensial dan
aksesnya disiapkan dan diuji; kode publisher dan validasi caption-nya sudah
mendukung (caption Threads divalidasi maksimal 500 karakter, dengan hashtag
yang dimuat sebanyak yang muat menurut urutan prioritas).

Instagram memerlukan JPEG; Threads mendukung JPEG dan PNG. Gapura menggunakan
JPEG turunan yang sama untuk seluruh adapter.

## Referensi resmi

Diakses 16 November 2026 (konfigurasi koneksi diverifikasi ulang 23–25
November 2026 saat publikasi live diaktifkan):

- [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/)
- [Unified Login setup](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started)
- [Unified Login authentication dan SUAT](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication)
- [Facebook Page posts dan photos](https://developers.facebook.com/docs/pages-api/posts/)
- [Threads posts, permission, dan media specification](https://developers.facebook.com/docs/threads/posts/)
