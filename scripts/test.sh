#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p /tmp/opencode

mapfile -t TESTS < <(find services -mindepth 3 -maxdepth 3 -type f -name '*.test.js' \
  ! -name 'server-*.test.js' | LC_ALL=C sort)
node --experimental-vm-modules --experimental-test-module-mocks \
  --test-concurrency=1 --test "${TESTS[@]}"

if [[ "${1:-}" == "--integration" ]]; then
  command -v psql >/dev/null || { echo 'psql is required for integration tests.' >&2; exit 1; }
  command -v runuser >/dev/null || { echo 'runuser is required by the disposable-PostgreSQL test harness.' >&2; exit 1; }
  mapfile -t SERVER_TESTS < <(find services/web/test -maxdepth 1 -type f -name 'server-*.test.js' -print | LC_ALL=C sort)
  node services/web/test/run-isolated.mjs "${SERVER_TESTS[@]}"
  bash services/web/test/run-server-tests.sh
fi
