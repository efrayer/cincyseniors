#!/usr/bin/env bash
#
# start-stack.sh — bring up the full webstack: Docker Compose (Caddy, Node
# app, ChromaDB) plus the standalone Python RAG service (rag_app_01), and
# report health for each. LM Studio is a separate GUI app and is only
# checked here, never launched.
#
# Usage: ./start-stack.sh [--restart]
#   --restart   force-recreate the Docker Compose services instead of
#               reusing already-running containers

set -euo pipefail
cd "$(dirname "$0")"

RESTART=false
if [[ "${1:-}" == "--restart" ]]; then
  RESTART=true
fi

RAG_LOG="/tmp/rag_app_01.log"
RAG_DIR="./rag_app_01"

info()  { printf '\033[1;34m[stack]\033[0m %s\n' "$1"; }
ok()    { printf '\033[1;32m[ ok ]\033[0m %s\n' "$1"; }
warn()  { printf '\033[1;33m[warn]\033[0m %s\n' "$1"; }
fail()  { printf '\033[1;31m[fail]\033[0m %s\n' "$1"; }

# ── 1. Docker daemon check ─────────────────────────────────────────────────
info "Checking Docker daemon..."
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon isn't responding. Open Docker Desktop and wait for it to finish starting, then re-run this script."
  exit 1
fi
ok "Docker daemon is up."

# ── 2. Docker Compose stack ────────────────────────────────────────────────
info "Starting Docker Compose stack (caddy, nodeapp, chromadb)..."
if $RESTART; then
  docker compose up -d --force-recreate
else
  docker compose up -d
fi

sleep 3
info "Compose service status:"
docker compose ps

# ── 3. Python RAG service (rag_app_01, FastAPI on :8000) ──────────────────
info "Checking rag_app_01 (FastAPI, port 8000)..."
if lsof -iTCP -sTCP:LISTEN -P 2>/dev/null | grep -q ":8000 (LISTEN)"; then
  ok "Something is already listening on port 8000 — leaving it running."
else
  if [[ ! -x "$RAG_DIR/start.sh" ]]; then
    fail "$RAG_DIR/start.sh not found or not executable."
  else
    info "Starting rag_app_01 in the background (log: $RAG_LOG)..."
    (cd "$RAG_DIR" && nohup ./start.sh --web > "$RAG_LOG" 2>&1 &)
    sleep 5
    if lsof -iTCP -sTCP:LISTEN -P 2>/dev/null | grep -q ":8000 (LISTEN)"; then
      ok "rag_app_01 is up on port 8000."
    else
      fail "rag_app_01 did not come up — check $RAG_LOG"
    fi
  fi
fi

# ── 4. LM Studio check (never auto-launched) ───────────────────────────────
info "Checking LM Studio (port 1234)..."
if lsof -iTCP -sTCP:LISTEN -P 2>/dev/null | grep -q ":1234 (LISTEN)"; then
  ok "LM Studio is running."
else
  warn "LM Studio is NOT running. Cindy chat responses will fail until you start it and load a model."
fi

# ── 5. End-to-end endpoint checks ──────────────────────────────────────────
info "Verifying endpoints through Caddy..."

check_endpoint() {
  local desc="$1" host="$2" path="$3" method="${4:-GET}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    -H "Host: ${host}" -X "${method}" "http://localhost${path}" 2>/dev/null || echo "000")
  if [[ "$status" == "200" ]]; then
    ok "$desc -> $status"
  else
    warn "$desc -> $status"
  fi
}

check_endpoint "cincyseniors.org /cindy/tts-config" "www.cincyseniors.org" "/cindy/tts-config"
check_endpoint "thinkdashboards.com /chat"           "www.thinkdashboards.com" "/chat"

info "Done. Tail logs with:"
echo "    docker compose logs -f caddy nodeapp chromadb"
echo "    tail -f $RAG_LOG"
