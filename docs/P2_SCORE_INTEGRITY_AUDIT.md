# P2 — Audit skor historis dan validasi constraint

Pemeriksaan produksi pada **16 November 2026, 18:23:55 WIB**
(`2026-11-16T11:23:55Z`), database `hme`, mencakup **1.062 baris**
`topic_scores` dengan ID **1–1062**. Tidak ditemukan baris yang memerlukan
perbaikan. `ALTER TABLE topic_scores VALIDATE CONSTRAINT
topic_scores_component_total` berhasil dijalankan kembali melalui migrasi yang
dapat diulang; `convalidated=true` sebelum dan sesudah pemeriksaan ini.

## Mapping dan keputusan perbaikan

Komponen tersimpan sudah berupa **poin berbobot**, bukan skor mentah yang perlu
dikalikan lagi. Mapping output Analis ke database tetap:

| Output Analis | Kolom tersimpan | Perlakuan historis |
| --- | --- | --- |
| `scores.relevance` | `score_relevance` | Pertahankan poin asli |
| `scores.credibility` | `score_credibility` | Pertahankan poin asli |
| `scores.momentum` | `score_momentum` | Pertahankan poin asli |
| `scores.engagement` | `score_engagement` | Pertahankan poin asli |
| `scores.compliance` | `score_compliance` | Pertahankan poin asli |
| `score_total` | `score_total` | Harus tepat jumlah lima komponen |
| `verdict`, model, versi prompt, reasoning, waktu | Kolom dengan nama terkait | Tidak ditulis ulang |

Bobot runtime sekarang berjumlah 100 dan dapat dikonfigurasi. Constraint rentang
database 0–100 per komponen mendukung konfigurasi tersebut; batas per-komponen
sesuai bobot aktif divalidasi Analis sebelum penyimpanan. Bobot saat ini tidak
dipakai untuk menormalisasi ulang baris historis.

Mapping tindakan hasil audit:

| Kondisi | Jumlah | Tindakan |
| --- | ---: | --- |
| Semua nilai terisi, rentang 0–100, total sama dengan jumlah komponen | 1.062 | Identitas: baris lama → baris yang sama, tanpa `UPDATE` |
| Total berbeda dari jumlah komponen | 0 | Tidak ada mapping koreksi yang perlu diterapkan |
| Nilai di luar rentang 0–100 | 0 | Tidak ada clipping/rescaling |
| Nilai kosong | 0 | Tidak ada imputasi |
| Total baris yang dipetakan untuk koreksi / ditulis ulang | **0 / 0** | Tidak ada mutasi data historis |

Jika kelak ditemukan mismatch, selisih total saja tidak membuktikan apakah
komponen atau totalnya salah. Simpan ID, semua nilai lama, nilai baru, bukti asal,
dan alasan dalam mapping yang ditinjau; terapkan `UPDATE` dengan kondisi yang
mencocokkan seluruh nilai lama dan pastikan jumlah baris sesuai mapping. Jangan
menebak skor, membulatkan, mereset verdict, atau mengubah approval demi meloloskan
constraint. Migrasi P2 menolak data bermasalah dengan SQLSTATE `23514` dan
jumlah kandidat; migrasi tidak menjalankan koreksi otomatis.

## Distribusi snapshot

| Model | Verdict | Baris | Rentang total | Mismatch |
| --- | --- | ---: | ---: | ---: |
| `fast-fail-gate` | `fast_failed` | 30 | 0–0 | 0 |
| `gemini/gemini-3.5-flash-lite` | `passed` | 412 | 76–97 | 0 |
| `gemini/gemini-3.5-flash-lite` | `rejected` | 210 | 0–75 | 0 |
| `heuristic-analis-v2` | `passed` | 22 | 75–85 | 0 |
| `heuristic-analis-v2` | `rejected` | 388 | 48–75 | 0 |

Semua baris snapshot mencatat `prompt_version=v1.0`. Adanya skor 75 pada verdict
historis `passed` dan `rejected` tidak diperlakukan sebagai pelanggaran total:
threshold dapat berubah antar-run, dan versi konfigurasi lengkap tidak direkam
per baris historis. Audit ini tidak mengarang threshold lama atau mengubah
verdict berdasarkan threshold sekarang.

## Bukti sebelum–sesudah

Snapshot lengkap hanya tersimpan secara lokal di:

`/root/gapura-backups/p2-score-integrity-20261116T112355Z/`

Direktori berizin `0700`; berkas JSON/JSONL berizin `0600`. Snapshot tidak
dikirim ke GitHub. Berkas `verification.json` memuat cutoff ID, jumlah baris,
checksum, dan status constraint. Checksum SHA-256 atas JSONB seluruh kolom baris
ID ≤1062 yang diurutkan menurut ID:

```text
sebelum: bf269355bd1755e712922075d4157ba29926d4dc12e718d84ee4a0235e85437c
sesudah: bf269355bd1755e712922075d4157ba29926d4dc12e718d84ee4a0235e85437c
```

Perbandingan memakai cutoff agar penambahan skor baru oleh timer tidak dianggap
sebagai perubahan snapshot lama. Jumlah baris yang dibandingkan tetap 1.062;
tidak ada perubahan komponen, total, verdict, reasoning, waktu, atau metadata.

## Menjalankan ulang

Gunakan koneksi PostgreSQL operator yang sudah dikonfigurasi; password tidak
boleh ditaruh di argumen, log, atau SQL. Dari root repository:

```bash
# Read-only: summary, constraint, distribusi, dan semua kandidat bermasalah.
psql -X -v ON_ERROR_STOP=1 -f database/audits/topic_scores_integrity.sql

# Jalankan setelah audit/mapping diperiksa; batas tunggu lock 5 detik,
# statement timeout 60 detik. Gagal berarti transaksi rollback.
psql -X -v ON_ERROR_STOP=1 -f database/migrations/20261116_validate_topic_scores.sql
```

Skrip audit memakai snapshot `REPEATABLE READ READ ONLY`. Migrasi validasi tetap
terpisah dari migrasi pembentukan constraint `NOT VALID` agar urutan audit dan
peninjauan historis jelas. Jalankan kembali audit sesudah validasi dan periksa
`convalidated` pada `pg_constraint`.

## Pengujian

Tes menggunakan tabel temporary pada database terisolasi, tanpa data produksi:

```bash
node services/web/test/run-isolated.mjs services/web/test/server-score-integrity.test.js
node --test services/analis/test/scoring.test.js services/web/test/scheduler.test.js
bash scripts/test_pipeline.sh
```

Empat tes migrasi/audit meliputi data historis valid dan bobot kustom, pengulangan
migrasi tanpa perubahan baris, mismatch yang ditolak sampai mapping fixture
eksplisit diterapkan, jumlah komponen >100 yang tidak dinormalisasi diam-diam,
serta audit read-only. Mapping fixture hanya untuk data sintetis di tes dan
tidak digunakan sebagai mapping produksi.
