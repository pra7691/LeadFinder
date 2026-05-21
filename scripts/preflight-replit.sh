#!/usr/bin/env bash
# =============================================================================
# Lead Intelligence Platform — Replit Preflight Script
#
# This script is called automatically before every dev/start command.
# It ensures dependencies are installed so fresh imports never see
# "vite: not found" or "esbuild: not found" errors.
#
# Usage (from artifact package.json):
#   "dev": "bash ../../scripts/preflight-replit.sh vite --config vite.config.ts --host 0.0.0.0"
#
# The script:
#   1. Checks if node_modules exists
#   2. If missing, runs pnpm install --frozen-lockfile
#   3. Checks required secrets exist (warns only — does not block)
#   4. Execs the remaining arguments (the real dev command)
# =============================================================================

set -uo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "  ${RED}✗${NC}  $1"; }
info() { echo -e "  ${BLUE}→${NC}  $1"; }

# ── Step 1: Ensure pnpm exists ──────────────────────────────────────────────
if ! command -v pnpm &> /dev/null; then
  echo -e "${RED}pnpm not found.${NC} Replit should provide it via the nodejs-24 module."
  exit 1
fi

# ── Step 2: Auto-install if node_modules missing ──────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "${ROOT_DIR}/node_modules" ]; then
  echo ""
  info "Dependencies missing. Running pnpm install --frozen-lockfile..."
  echo ""
  if (cd "${ROOT_DIR}" && pnpm install --frozen-lockfile 2>&1); then
    echo ""
    ok "Dependencies installed successfully."
    echo ""
  else
    echo ""
    fail "pnpm install failed. Check pnpm-lock.yaml is valid."
    exit 1
  fi
fi

# ── Step 3: Check required secrets (warn only) ──────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  warn "DATABASE_URL secret is missing."
  warn "  → Add it in Replit → Secrets, or provision a PostgreSQL database."
fi

if [ -z "${SESSION_SECRET:-}" ]; then
  warn "SESSION_SECRET is missing."
  warn "  → Add it in Replit → Secrets (generate: openssl rand -hex 32)"
fi

# ── Step 4: Pass through to the real command ─────────────────────────────────
exec "$@"
