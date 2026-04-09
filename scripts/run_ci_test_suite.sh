#!/usr/bin/env bash
set -euo pipefail

# Suite CI completa eseguibile in ambiente Node (senza servizi Google reali)
# Comprende:
# 1) smoke tests
# 2) suite unitaria principale
# 3) test modulari in tests/test_*.js

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> [1/3] Smoke tests"
node scripts/ci_smoke_tests.js

echo "==> [2/3] Unit test suite"
node gas_unit_tests.js

echo "==> [3/3] Modular Node tests (tests/test_*.js)"
shopt -s nullglob
test_files=(tests/test_*.js)
if [[ ${#test_files[@]} -eq 0 ]]; then
  echo "❌ Nessun file tests/test_*.js trovato"
  exit 1
fi

passed=0
failed=0

for test_file in "${test_files[@]}"; do
  echo "---- RUN ${test_file}"
  if node "$test_file"; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
  fi
done

echo "==> Modular tests summary: passed=${passed}, failed=${failed}, total=${#test_files[@]}"
if [[ "$failed" -ne 0 ]]; then
  echo "❌ Alcuni test modulari sono falliti"
  exit 1
fi

echo "✅ CI Node suite completata con successo"
