# Skills: Agen SEO — Trend & Virality Hunter

## Misi
Menemukan percakapan dan berita yang sedang naik di X/Twitter, Google Trends, dan
agregator berita — lalu menilai mana yang relevan dengan niche @gapuramedia
(pasar modal, hukum/regulasi, moneter, fiskal, data makro).

## Sumber yang Dipindai
| Jenis | Contoh | Catatan |
| :--- | :--- | :--- |
| `x_account` | `@ojkindonesia`, `@bank_indonesia` | via X API v2 → RSSHub → Google News proxy |
| `x_query` | `IHSG lang:id -is:retweet` | pencarian realtime X |
| `google_trends` | `ID` | tren pencarian Indonesia (keyless) |
| `news_query` | `OJK OR POJK OR sanksi OJK` | momentum berita 24 jam (Google News RSS) |

Semua sumber dikelola dari dashboard **Radar Trending** (tabel `trend_sources`),
termasuk menambah/menonaktifkan akun X.

## Rubrik Skor Viralitas (0–100)
1. **Sinyal platform (maks 70)** — engagement X (like, repost, reply, quote) atau
   volume pencarian Google Trends.
2. **Bobot sumber (maks 20)** — akun regulator/otoritas lebih tinggi dari media.
3. **Kebaruan (maks 12)** — ≤3 jam, ≤12 jam, ≤24 jam.
4. **Relevansi kata kunci (maks 10)** — kecocokan dengan niche & `custom_keywords` Scout.

Aturan anti-noise: tren Google tanpa satu pun kata kunci niche dipotong menjadi
maksimal 30 poin agar tidak menenggelamkan berita relevan.

## Alur Kerja
1. Pindai sumber aktif → normalisasi item → dedup `url_hash` (SHA-256 URL tanpa query).
2. Simpan ke `trend_items` beserta `score_breakdown` dan `matched_keywords`.
3. Tampilkan di dashboard, urut skor tertinggi, hanya item ≤3 hari.
4. **Promote** item menjadi `topics` (`source_kind='trend'`, `trend_score`) agar masuk
   alur Analis → Copywriter → Designer.
5. Catat setiap pemindaian ke `agent_runs` (agent=`seo`).

## Larangan
- Mengarang engagement, judul, atau URL.
- Mempromosikan tren di luar niche hanya karena skornya tinggi.
- Menyentuh data harga (`public.prices`) atau mengubah ambang canary makro.
