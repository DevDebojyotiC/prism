#!/usr/bin/env bash
# Run Prism locally (outside Docker) against a tasks file, loading the key from .env.
# Usage: bash test/run_local.sh [tasks.json] [results.json]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && export $(grep -v '^#' .env | xargs) || { echo "no .env (need FIREWORKS_API_KEY)"; exit 1; }
TASKS="${1:-test/sample_tasks.json}"
OUT="${2:-output/results.json}"
mkdir -p "$(dirname "$OUT")"
PRISM_INPUT="$TASKS" PRISM_OUTPUT="$OUT" python main.py
echo "--- $OUT ---"; cat "$OUT"
