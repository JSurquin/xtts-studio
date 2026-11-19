#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

export COQUI_TOS_AGREED=1
export PYTHONUNBUFFERED=1
export XTTS_DEVICE="${XTTS_DEVICE:-cpu}"

if [[ ! -x .venv/bin/python ]]; then
  echo "L'environnement Python manque. Relance l'installation décrite dans le README."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg manque. Installe-le avec : brew install ffmpeg"
  exit 1
fi

if [[ ! -d web/node_modules ]]; then
  (cd web && pnpm install)
fi

.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --log-level info &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:8765/api/health" >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Le serveur Python s'est arrêté."
    exit 1
  fi
  sleep 0.2
done

if [[ "$ready" != 1 ]]; then
  echo "Le serveur Python ne répond pas sur http://127.0.0.1:8765"
  exit 1
fi

echo "Interface : http://127.0.0.1:5173"
echo "XTTS se charge au premier lancement. La pastille passe à Prêt quand c'est bon."
echo "Fish Speech (optionnel) : ${FISH_API_URL:-http://127.0.0.1:8080}"
cd web
pnpm dev
