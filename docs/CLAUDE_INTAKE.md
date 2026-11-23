# Claude Intake — jembatan draf programatis

Jembatan ini memungkinkan klien intake Muse (berjalan di lingkungan agen
Muse milik owner) mengirim paket konten terstruktur ke Gapura sebagai
**draf review-only**, memakai endpoint yang sama dengan Studio:
`POST /api/drafts/create-from-custom`.

Draf dari jalur ini tunduk pada kontrak editorial yang sama persis dengan
draf Studio (`services/common/original-editorial.js`), tersimpan dengan
`status='draft'` dan `needs_review=true`, dan **tidak bisa** disetujui atau
ditayangkan oleh klien intake. Persetujuan tetap tindakan manusia di
dashboard; penayangan tetap lewat alur publisher/autopilot yang ada.

## Mengaktifkan

1. Buat nilai acak yang kuat, misalnya `openssl rand -hex 32`.
2. Pasang di `/etc/gapura/runtime.env` pada server:

   ```env
   GAPURA_INTAKE_TOKEN=<nilai acak>
   ```

3. Restart `hme-web.service`. Tanpa variabel ini, guard intake tidak aktif
   dan endpoint berperilaku persis seperti sebelumnya.
4. Berikan nilai yang sama ke klien intake melalui jalur kredensial aman
   (Secure Vault), jangan lewat chat, Git, atau log.

## Cara kerja guard

Middleware `services/web/intake-guard.js` hanya terpasang pada route
`POST /api/drafts/create-from-custom`:

- Token belum diatur → guard nonaktif (perilaku lama).
- Header `X-Gapura-Intake-Token` cocok (perbandingan timing-safe) →
  permintaan ditandai; draf yang dibuat tercatat di `audit_log` dengan
  actor `claude_intake` (draf Studio tetap `studio_editor`).
- Permintaan browser dengan header `Origin` → lolos seperti biasa; guard
  origin global sudah lebih dulu memastikan origin itu milik dashboard
  sendiri, jadi UI Studio tidak berubah.
- Pemanggil non-browser tanpa token valid → `401`.

Catatan cakupan: token ini mengidentifikasi klien intake dan memungkinkan
atribusi audit. Ia tidak mengubah model akses API dashboard yang sudah ada.

## Kontrak paket

Body mengikuti kontrak `create-from-custom` + `customOriginalContent`:

- `title` (maks 240), `summary`, `primary_source`, `source_url` (HTTPS
  publik yang valid), `format` (`carousel`/`single`).
- `editorial_mode` (`explainer`/`current`) dan `editorial_input` yang
  ternormalisasi; mode harus sama di keduanya.
- `slides`: 3–9 slide carousel (atau 1 untuk `single`) dengan layout/peran
  sesuai `ORIGINAL_LAYOUTS`/`ORIGINAL_ROLES`.
- `article_body` minimal 1200 karakter; mode `current` memerlukan minimal
  3 `article_references` beratribusi.
- `caption_body` dipecah per paragraf dan `editorial_references.caption`
  harus sama panjang; `caption`, `caption_body`, dan `threads_caption`
  harus persis sama dengan hasil validasi `validateOriginalContent` —
  klien menghitungnya memakai modul validator repo ini sebelum mengirim.

Klien memvalidasi paket secara lokal dengan validator yang sama; server
tetap validator terakhir dan menolak paket yang tidak patuh dengan 422.

## Verifikasi setelah deploy

- Kirim satu paket uji → draf muncul di antrean Review dashboard.
- `audit_log` untuk draf itu ber-actor `claude_intake`.
- Permintaan tanpa header token dari non-browser ditolak 401; UI Studio
  tetap dapat membuat draf seperti biasa.
