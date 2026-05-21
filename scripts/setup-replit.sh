#!/usr/bin/env bash
# =============================================================================
# Lead Intelligence Platform — Replit Setup Script
#
# Run this ONCE after importing the repo into a fresh Replit account:
#
#   pnpm run setup:replit
#
# What it does:
#   1. Verifies Node.js 24+
#   2. Verifies pnpm
#   3. Checks required Replit Secrets are present
#   4. Installs dependencies (if node_modules missing)
#   5. Pushes the database schema (the most commonly missed step)
#   6. Prints a clear summary
#
# It does NOT expose secret values in output.
# =============================================================================

set -euo pipefail

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
hr()   { echo "  ──────────────────────────────────────────────"; }
nl()   { echo ""; }

hr
echo -e "  ${BOLD}Lead Intelligence Platform — Replit Setup${NC}"
hr
nl

ERRORS=0

# ── STEP 1: Node.js version ───────────────────────────────────────────────────
info "Checking Node.js version..."
NODE_RAW=$(node --version 2>/dev/null || echo "not-found")
NODE_MAJOR=$(echo "$NODE_RAW" | sed 's/v//' | cut -d. -f1)

if [ "$NODE_RAW" = "not-found" ]; then
  fail "Node.js not found. Ensure .replit contains: modules = [\"nodejs-24\", \"postgresql-16\"]"
  ERRORS=$((ERRORS + 1))
elif [ "$NODE_MAJOR" -lt 24 ] 2>/dev/null; then
  fail "Node.js 24+ required — found $NODE_RAW"
  warn "Update .replit: modules = [\"nodejs-24\", \"postgresql-16\"]"
  ERRORS=$((ERRORS + 1))
else
  ok "Node.js $NODE_RAW"
fi

# ── STEP 2: pnpm ──────────────────────────────────────────────────────────────
info "Checking pnpm..."
PNPM_VER=$(pnpm --version 2>/dev/null || echo "not-found")
if [ "$PNPM_VER" = "not-found" ]; then
  fail "pnpm not found. Replit should provide it automatically via nodejs-24 module."
  ERRORS=$((ERRORS + 1))
else
  ok "pnpm $PNPM_VER"
fi

# ── STEP 3: Required secrets ──────────────────────────────────────────────────
info "Checking required Replit Secrets..."
nl
MISSING=()

check_secret() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    fail "Secret missing: $name"
    MISSING+=("$name")
  else
    ok "Secret present: $name"
  fi
}

check_secret "DATABASE_URL"
check_secret "SESSION_SECRET"
check_secret "SERPER_API_KEY"

if [ ${#MISSING[@]} -gt 0 ]; then
  nl
  warn "Add missing secrets in Replit → Secrets (lock icon in the left sidebar)."
  warn "Required secrets:"
  warn "  DATABASE_URL    — PostgreSQL connection string"
  warn "  SESSION_SECRET  — Random 32+ char string (used to encrypt SMTP passwords)"
  warn "  SERPER_API_KEY  — Your Serper.dev API key for lead discovery"
  warn "Optional secrets (can also be set in Settings UI after setup):"
  warn "  PORT            — API server port (default: 8080)"
  warn "  NODE_ENV        — Set to 'production' in deployed envs"
  nl
  ERRORS=$((ERRORS + ${#MISSING[@]}))
fi

# ── Bail early if critical deps/secrets are missing ───────────────────────────
if [ $ERRORS -gt 0 ]; then
  nl
  hr
  fail "Cannot continue: $ERRORS problem(s) above must be resolved first."
  nl
  echo "  Fix the issues listed above then re-run:"
  echo "    pnpm run setup:replit"
  nl
  hr
  exit 1
fi

# ── STEP 4: Install dependencies ──────────────────────────────────────────────
nl
info "Installing dependencies (pnpm install --frozen-lockfile)..."
if pnpm install --frozen-lockfile 2>&1; then
  ok "Dependencies installed"
else
  fail "pnpm install failed — check pnpm-lock.yaml is up-to-date"
  ERRORS=$((ERRORS + 1))
fi

# ── STEP 5: Push database schema ──────────────────────────────────────────────
nl
info "Pushing database schema..."
info "(This is the step most often missed on fresh import)"
nl

if pnpm --filter @workspace/db run push 2>&1; then
  nl
  ok "Database schema applied successfully"
else
  nl
  fail "Schema push failed."
  fail "Check:"
  fail "  1. DATABASE_URL is correct and the database is reachable"
  fail "  2. The database user has CREATE TABLE privileges"
  fail "  3. Run manually: pnpm --filter @workspace/db run push"
  ERRORS=$((ERRORS + 1))
fi

# ── STEP 6: Final summary ─────────────────────────────────────────────────────
nl
hr

if [ $ERRORS -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}Setup complete!${NC}"
  nl
  echo "  Next steps:"
  echo "    1. Click Run (or start the workflows from the workflow panel)"
  echo "    2. Verify the API is alive:"
  echo "         GET /api/healthz        → { \"status\": \"ok\" }"
  echo "    3. Verify the schema is applied:"
  echo "         GET /api/healthz/deep   → { \"status\": \"ok\" | \"warning\" }"
  echo "    4. Open Settings → configure blocked domains, AI, and SMTP"
  echo "    5. Create a campaign and run it"
  nl
  echo "  Troubleshooting:"
  echo "    If /api/healthz/deep returns 'warning' about missing optional settings,"
  echo "    that is expected on first run — configure them in the Settings page."
  echo "    If it returns 'error' with missing tables, re-run: pnpm run db:push"
else
  fail "Setup finished with $ERRORS error(s). Review the output above and re-run."
fi

hr
