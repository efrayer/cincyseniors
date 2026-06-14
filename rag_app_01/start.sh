#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"
source venv/bin/activate

# Load .env if it exists
if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
fi

case "${1:-cli}" in
  --web|web)
    echo "Starting RAG Chat web server on http://0.0.0.0:8000/ragchat"
    python -m app.api
    ;;
  *)
    python -m app.main
    ;;
esac
