# Analisis Mendalam Gapura Media

## Ringkasan

Gapura Media adalah pipeline editorial otomatis yang mengubah topik berita menjadi carousel visual, caption, dan publikasi Telegram. Perubahan v2.1 menambah dua tahap penting: **Radar Trending/SEO** untuk menemukan isu yang sedang naik, dan **Verifikator** untuk menilai klaim sebelum diproduksi.

## Arsitektur runtime

```text
RSS / X / Google News / Trends
              │
              ▼
        SEO Agent (trend_items)
              │ promote
              ▼
 Scout → Analis → Verifikator → Copywriter → Designer/Render → Telegram
                         │              │
                         └─ gate hoax ──┘
```

- `services/seo/seo.js`: provider chain `x_api` → `rsshub` → `google_news_proxy`; Google Trends dipakai sebagai sinyal tambahan.
- `services/verificator/verificator.js`: sinyal deterministik, koroborasi berita, dan rubric LLM; fallback heuristik tetap menandai keterbatasan.
- `services/copywriter/copywriter.js`: memecah teks panjang ke slide lanjutan, menyisipkan slide verifikasi, dan memastikan penutup `cta-close` selalu ada.
- `services/render/engine.js`: shell cover/body terpisah, auto-fit tipografi, layout `verifikasi`, dan render 1080×1350.
- `services/web/server.js`: API dashboard, konfigurasi sumber trending, scan, promote, dan verifikasi manual.

## Model data

Migrasi `database/migrations/20261111_seo_verifikator.sql` menambahkan:

- `trend_sources`: sumber yang dapat dikustomisasi pengguna.
- `trend_items`: hasil radar, provider, skor, dan deduplikasi URL.
- `verification_reports`: status, skor, alasan, koroborasi, dan sumber rujukan.
- atribut topik `source_kind`, `trend_score`, dan `verification_status`.
- tipe agen `seo` dan `verifikator`.

Migrasi bersifat idempotent. `database/schema.sql` dipertahankan paralel sebagai schema bootstrap.

## Aturan editorial dan visual

1. Cover hanya memuat masthead, accent bar, dan headline utama; tidak memuat kategori, sumber, counter, atau CTA.
2. Slide isi menggunakan header wordmark + counter dan footer sumber polos.
3. Teks tidak dipotong dengan ellipsis. Copywriter melakukan chunking ke slide baru.
4. Carousel selalu berakhir dengan `cta-close`; slide verifikasi ditempatkan sebelum penutup.
5. Klaim `hoax_detected` memblokir auto-produce kecuali operator mengirim `force=true`.
6. Status yang belum cukup bukti tidak boleh dipresentasikan sebagai kepastian; caption membawa catatan verifikasi dan `needs_review`.

## Operasional

Pipeline tujuh langkah berada di `scripts/run_pipeline.sh`:

1. Scout
2. SEO scan (toleran terhadap provider gagal)
3. Analis
4. Verifikator batch (toleran terhadap kegagalan parsial)
5. Copywriter
6. Telegram
7. Publisher

Tanpa `X_BEARER_TOKEN`, sistem menggunakan fallback yang tercatat jujur sebagai provider non-X. Sumber akun X dapat dikelola dari dashboard melalui menu **Radar Trending**.

## Endpoint utama

- `GET /api/seo/trends`
- `POST /api/seo/scan`
- `GET|POST|PUT|DELETE /api/trend-sources[/:id]`
- `POST /api/seo/trends/:id/promote`
- `POST /api/topics/:id/verify`
- `GET /api/topics/:id/verification`
- `GET /api/verifications`

## Validasi yang dilakukan

- `node --check services/render/engine.js`: lulus.
- `node services/render/test/render.test.js`: 9 layout lulus, seluruhnya 1080×1350.
- Smoke endpoint dashboard/SEO/verifikasi dan E2E topik #445 menghasilkan draft #16 dengan urutan `cover-focus → stat-spotlight → takeaway-points → verifikasi → cta-close`.
- Render ulang draft #16 berhasil setelah perubahan engine; cover tetap bebas noise dan seluruh teks tampil tanpa truncation.

## Risiko dan tindak lanjut

- Provider X dan RSSHub bergantung pada konfigurasi eksternal; fallback Google News harus tetap dipantau kualitas dan freshness-nya.
- Verifikasi LLM adalah bantuan editorial, bukan pengganti pemeriksaan sumber primer.
- Sebelum commit, perubahan sebaiknya dipisah per item: engine/editorial, agen SEO, agen verifikator, dashboard, dan dokumentasi/migrasi.
