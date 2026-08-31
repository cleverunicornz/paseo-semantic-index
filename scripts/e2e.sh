#!/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE=(docker compose -f "$ROOT/test/e2e/compose.yaml")

cleanup() {
  if [[ "${KEEP_E2E:-0}" != "1" ]]; then
    "${COMPOSE[@]}" down --volumes --remove-orphans
  fi
}
trap cleanup EXIT

"${COMPOSE[@]}" down --volumes --remove-orphans
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d --wait
"${COMPOSE[@]}" exec -T paseo bash /opt/paseo-semantic-index/test/e2e/qualify.sh
