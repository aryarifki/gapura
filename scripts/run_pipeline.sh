#!/usr/bin/env bash
# ==============================================================================
# Homeless Media Engine (HME) v2.1 - End-to-End Content Pipeline Runner
# File: /root/gapura/scripts/run_pipeline.sh
#
# Urutan intake: Scout -> SEO (tolerant) -> Analis -> Verifikator (tolerant) ->
#                Copywriter -> Telegram (hanya dengan opt-in delivery).
# Publikasi memakai gapura-publisher.timer, terpisah dari siklus intake.
# Langkah SEO & Verifikator bersifat tolerant: kegagalan (mis. kuota LLM atau
# sumber trending tidak tersedia) tidak menghentikan pipeline utama.
# ==============================================================================

set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${BASE_DIR}"
exec 9>"${GAPURA_PIPELINE_LOCK:-/tmp/opencode/gapura-pipeline.lock}"
if ! flock -n 9; then
  echo '[Gapura] Siklus lain masih berjalan; scan bertumpuk dilewati.'
  exit 0
fi
if [[ -r /etc/gapura/admin-token.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/gapura/admin-token.env
  set +a
fi

echo "=========================================================="
echo " [HME v2.1] Menjalankan Pipeline Konten Homeless Media    "
echo " Waktu: $(date '+%Y-%m-%d %H:%M:%S %Z')                   "
echo "=========================================================="

# 1. Agen Scout: Polling Sumber Niche & Deduplikasi
echo ""
echo ">>> [1/7] Menjalankan Agen Scout (Polling & Dedup)..."
node services/scout/scout.js

# 2. Agen SEO: Pemindaian Trending (X / Google Trends / Momentum Berita)
echo ""
echo ">>> [2/7] Menjalankan Agen SEO (Radar Trending)..."
if node services/seo/seo.js; then
  echo "[SEO] Pemindaian trending selesai."
else
  echo "[SEO] PERINGATAN: pemindaian trending gagal; pipeline dilanjutkan tanpa data trend baru."
fi

# 3. Agen Analis: Fast-Fail & Skoring 0-100
echo ""
echo ">>> [3/7] Menjalankan Agen Analis (Fast-Fail & Skoring)..."
node services/analis/analis.js

# 4. Agen Verifikator: Fact-check topik lolos Analis yang belum diverifikasi
echo ""
echo ">>> [4/7] Menjalankan Agen Verifikator (Fact-Check & Konteks)..."
if node services/verificator/verificator.js --batch 3; then
  echo "[Verifikator] Verifikasi batch selesai."
else
  echo "[Verifikator] PERINGATAN: verifikasi batch gagal; hanya topik yang memiliki laporan verifikasi dapat diproduksi."
fi

# 5. Agen Copywriter: Produksi Teks Editorial & Render Carousel
echo ""
echo ">>> [5/7] Menjalankan Agen Copywriter & Render Service..."
node services/copywriter/copywriter.js

if [[ "${GAPURA_ENABLE_DELIVERY:-false}" == "true" ]]; then
  echo '>>> [6/7] Mengirim draf review ke Telegram...'
  node -e "import('./services/telegram/bot.js').then(m => m.dispatchPendingDrafts().then(() => process.exit(0)))"
  echo '[Gapura] Publikasi terjadwal ditangani gapura-publisher.timer.'
else
  echo '[Gapura] Paket draf siap direview; pengiriman eksternal tidak diaktifkan.'
fi

echo ""
echo "=========================================================="
echo " [HME v2.1] Seluruh Tahapan Pipeline Selesai Dijalankan!   "
echo "=========================================================="
