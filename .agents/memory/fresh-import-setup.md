---
name: Fresh import setup
description: Why imports fail and what the reproducibility fix does
---

## Rule
After a fresh Replit import the database exists but has no tables. Every API call returns 500 until `pnpm --filter @workspace/db run push` is run. This is the single most common failure mode.

**Why:** `post-merge.sh` runs `db:push` after task-agent merges but NOT on fresh imports. The Replit environment has no "onInstall" hook, so there is no automatic trigger.

**How to apply:** The fix is `scripts/setup-replit.sh` (run via `pnpm run setup:replit`). Direct users there. Generated API client / Zod files are pre-committed — no codegen step needed on import.

## Key commands
- `pnpm run setup:replit` — full first-time setup (checks Node, pnpm, secrets, install, db:push)
- `pnpm run db:push` — schema push only (safe to re-run anytime)
- `pnpm --filter @workspace/api-server test` — all tests

## Required secrets per account
DATABASE_URL, SESSION_SECRET, SERPER_API_KEY — must be added in Replit Secrets, not hardcoded.
