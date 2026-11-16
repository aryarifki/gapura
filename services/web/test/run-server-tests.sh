#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PORT=3317
TEST_TOKEN="$(openssl rand -hex 32)"
GAPURA_DISABLE_WORKERS=true \
GAPURA_ADMIN_TOKEN="$TEST_TOKEN" \
PORT="$PORT" \
NODE_ENV=test \
node "$ROOT/services/web/server.js" > /tmp/gapura-web-test.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

GAPURA_ADMIN_TOKEN="$TEST_TOKEN" PORT="$PORT" \
  node --test "$ROOT/services/web/test/server-access.test.js"
curl -fsS -X POST "http://127.0.0.1:$PORT/__test/shutdown" >/dev/null
wait "$SERVER_PID" || true
trap - EXIT
