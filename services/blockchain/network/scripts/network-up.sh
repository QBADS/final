#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d crypto-config ]; then
  ./scripts/generate.sh
fi

docker compose up -d
echo "Waiting for orderers and peers to be healthy..."
sleep 8
docker compose ps
