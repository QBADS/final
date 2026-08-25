#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose down -v
echo "Network stopped and volumes removed."
