#!/usr/bin/env bash
set -euo pipefail

# Verifica sintassi su TUTTI i file .js tracciati nel repo
# (esclude automaticamente artefatti non tracciati / node_modules non versionati)
files=$(git ls-files '*.js')

if [ -z "$files" ]; then
  echo "Nessun file .js trovato"
  exit 0
fi

while IFS= read -r f; do
  [ -z "$f" ] && continue
  node --check "$f"
  echo "✅ syntax: $f"
done <<< "$files"
