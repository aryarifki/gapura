#!/usr/bin/env bash
# ==============================================================================
# Homeless Media Engine (HME) v2.0 - End-to-End Content Pipeline Runner
# File: /root/gapura/scripts/run_pipeline.sh
# ==============================================================================

set -euo pipefail

BASE_DIR="/root/gapura"
cd "${BASE_DIR}"

echo "=========================================================="
echo " [HME v2.0] Menjalankan Pipeline Konten Homeless Media    "
echo " Waktu: $(date '+%Y-%m-%d %H:%M:%S %Z')                   "
echo "=========================================================="

# 1. Agen Scout: Polling Sumber Niche & Deduplikasi
echo ""
echo ">>> [1/4] Menjalankan Agen Scout (Polling & Dedup)..."
node services/scout/scout.js

# 2. Agen Analis: Fast-Fail & Skoring 0-100
echo ""
echo ">>> [2/4] Menjalankan Agen Analis (Fast-Fail & Skoring)..."
node services/analis/analis.js

# 3. Agen Copywriter: Produksi Teks Editorial & Render Carousel
echo ""
echo ">>> [3/4] Menjalankan Agen Copywriter & Render Service..."
node services/copywriter/copywriter.js

# 4. Telegram Dispatcher: Kirim Draf Baru ke Admin
echo ""
echo ">>> [4/4] Menyiapkan Pengiriman Pratinjau Draf ke Telegram..."
node -e "import('./services/telegram/bot.js').then(m => m.dispatchPendingDrafts().then(() => process.exit(0)))"

echo ""
echo "=========================================================="
echo " [HME v2.0] Seluruh Tahapan Pipeline Selesai Dijalankan!   "
echo "=========================================================="
