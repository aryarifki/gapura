#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PYTHON="${PYTHON:-python3}"
VENV="${GAPURA_PYTHON_VENV:-$ROOT/.venv-editorial}"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null || fail 'Node.js 24 is required.'
command -v npm >/dev/null || fail 'npm is required.'
command -v "$PYTHON" >/dev/null || fail 'Python 3 is required.'

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" == 24 ]] || fail "Expected Node.js 24.x; found $(node --version)."
"$PYTHON" -c 'import sys; assert sys.version_info >= (3, 10), sys.version' \
  || fail 'Python 3.10 or newer is required.'

mapfile -t PACKAGES < <(find "$ROOT/services" -mindepth 2 -maxdepth 2 -name package.json -printf '%h\n' | LC_ALL=C sort)
for directory in "${PACKAGES[@]}"; do
  service="${directory#"$ROOT/services/"}"
  package="$directory/package.json"
  lock="$directory/package-lock.json"
  [[ -f "$package" ]] || fail "Missing package manifest: $package"
  [[ -f "$lock" ]] || fail "Missing lockfile: $lock"
  printf '\n== Installing services/%s ==\n' "$service"
  (cd "$directory" && npm ci --no-audit --no-fund)
done

if [[ ! -x "$VENV/bin/python" ]]; then
  "$PYTHON" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --disable-pip-version-check -r "$ROOT/services/copywriter/requirements.txt"
"$VENV/bin/python" -c 'import pydantic, json_repair; print("Editorial Python dependencies: OK")'
node --input-type=module -e \
  "import sharp from './services/render/node_modules/sharp/lib/index.js'; console.log('Sharp native binary:', sharp.versions.sharp)"

cat <<EOF

Dependencies installed.
Python environment: $VENV
Next: copy .env.example to .env, configure credentials/paths, create a dedicated
gapura_* PostgreSQL database, then read docs/SELF_HOSTING.md before migrations.
No database, system service, timer, or publisher mode was changed.
EOF
