#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_DIR="$(mktemp -d /tmp/opencode/gapura-pipeline-test-XXXXXX)"
trap 'rm -rf "$TASK_DIR"' EXIT
mkdir -p "$TASK_DIR/bin"
cat > "$TASK_DIR/bin/node" <<'NODE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GAPURA_TEST_CALLS"
if [[ "$*" == *'services/scout/scout.js'* ]]; then
  touch "$GAPURA_TEST_ENTERED"
  while [[ ! -f "$GAPURA_TEST_RELEASE" ]]; do sleep 0.05; done
fi
NODE
chmod +x "$TASK_DIR/bin/node"
export PATH="$TASK_DIR/bin:$PATH" GAPURA_TEST_CALLS="$TASK_DIR/calls" GAPURA_TEST_ENTERED="$TASK_DIR/entered" GAPURA_TEST_RELEASE="$TASK_DIR/release" GAPURA_PIPELINE_LOCK="$TASK_DIR/pipeline.lock" GAPURA_ENABLE_DELIVERY=false
"$ROOT/scripts/run_pipeline.sh" > "$TASK_DIR/first.log" 2>&1 &
FIRST_PID=$!
for _ in $(seq 1 60); do [[ -f "$GAPURA_TEST_ENTERED" ]] && break; sleep 0.05; done
"$ROOT/scripts/run_pipeline.sh" > "$TASK_DIR/second.log" 2>&1 &
SECOND_PID=$!
sleep 0.2
touch "$GAPURA_TEST_RELEASE"
wait "$FIRST_PID"
wait "$SECOND_PID"
[[ $(grep -c 'services/scout/scout.js' "$GAPURA_TEST_CALLS") -eq 1 ]] || { echo 'FAIL: concurrent pipeline ran twice'; exit 1; }
if grep -Eq 'services/(publisher|telegram)' "$GAPURA_TEST_CALLS"; then echo 'FAIL: delivery ran without an explicit opt-in'; exit 1; fi
GAPURA_ENABLE_DELIVERY=true "$ROOT/scripts/run_pipeline.sh" > "$TASK_DIR/delivery.log" 2>&1
if grep -q 'services/publisher/' "$GAPURA_TEST_CALLS"; then echo 'FAIL: intake cycle invoked publisher outside its dedicated timer'; exit 1; fi
printf 'PASS: pipeline lock prevents overlap; delivery requires explicit opt-in\n'
