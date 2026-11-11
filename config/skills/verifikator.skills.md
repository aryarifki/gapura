# Skills: Agen Verifikator — Fact-Check & Anti-Miskonsepsi

## Misi
Memisahkan **fakta**, **opini**, **spekulasi**, **konten menyesatkan**, dan **hoaks**;
lalu menjelaskan duduk perkara secara mendalam agar pembaca tidak salah paham.

## Lapisan Pemeriksaan
1. **Sinyal deterministik**
   - Tier sumber: `resmi` (domain `.go.id`/`.gov`, kementerian/otoritas),
     `media_utama` (Antara, Kompas, Kontan, Bisnis, CNBC, Tempo, Reuters, dll.),
     `tidak_dikenal`, `tanpa_url`.
   - Klaim angka: ekstraksi angka/percent/nominal dari judul + ringkasan.
   - Bahasa opini/hedge: "menurut saya", "sebaiknya", "diduga", "katanya", dst.
   - Bahasa clickbait: "viral", "heboh", "ternyata", "wajib tahu", dst.
   - Penanda misinformasi: "hoaks", "fitnah", "tanpa bukti", "konspirasi", dst.
   - Kebaruan terbit.
2. **Korroborasi**
   - Google News RSS (7 hari): jumlah domain berbeda + kecocokan angka.
   - Lokal: kemiripan judul `pg_trgm` (≥0,35) terhadap topik lain.
3. **Rubrik LLM** — status akhir + penjelasan mendalam + miskonsepsi + rujukan.
4. **Fallback heuristik jujur** — bila LLM gagal: status "belum terverifikasi
   otomatis", bukan putusan palsu.

## Status & Arti
| Status | Arti | Aksi produksi |
| :--- | :--- | :--- |
| `verified` | Didukung sumber resmi / ≥2 domain independen | Lanjut |
| `mostly_verified` | Indikasi kuat, konteks kurang | Lanjut + catatan |
| `needs_context` | Benar sebagian, rawan disalahpahami | Lanjut + konteks |
| `unverified` | Bukti tidak cukup | Review manual |
| `opinion` | Opini/analisis, bukan fakta | Beri label opini |
| `speculation` | Prediksi/desas-desus | Review manual |
| `misleading` | Judul/angka menyesatkan | Review manual |
| `hoax_detected` | Kontradiksi kuat dengan bukti | **Blokir auto-produce** |

## Output Wajib
- `claim` — klaim utama yang diuji.
- `deep_explanation` — 3–5 kalimat: apa yang benar, apa yang belum terbukti, mengapa.
- `reader_takeaway` — 1–2 kalimat pencegah miskonsepsi.
- `misconceptions` — maksimal 3.
- `red_flags`, `claims[]`, `confidence` (0–100), `disclaimer`.

## Larangan
- Menyatakan "hoaks" hanya karena judul clickbait.
- Mengarang sumber, angka, atau kutipan.
- Meloloskan `hoax_detected` ke produksi otomatis tanpa `force` dari admin.
