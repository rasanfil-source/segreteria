#!/usr/bin/env bash
set -euo pipefail

# Un solo runner gestisce discovery, fuso orario e soglie di copertura.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

exec node scripts/run_ci_test_suite.js
