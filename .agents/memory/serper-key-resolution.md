---
name: Serper API key resolution
description: How the Serper key is resolved and stored — DB-first, env fallback, never hardcoded
---

## Rule
`getSerperApiKey()` in `artifacts/api-server/src/services/serper-key.ts` is the single source of truth for the Serper API key.

Lookup order:
1. `app_settings` table, key `serper_api_key` — set via Settings → Search API Settings UI
2. `SERPER_API_KEY` environment variable — legacy/CI fallback

Returns `null` if both are absent; callers must surface a clear user-facing error.

**Why:** The key was previously hardcoded in `.replit [userenv.shared]`, which committed it to git and made the project non-portable. Moving it to app_settings means any new Replit account can configure it post-import without ever touching env vars.

**How to apply:**
- Always import from `../services/serper-key` (not from env directly) in routes and pipeline
- Mask `serper_api_key` in GET /settings responses (same pattern as `openai_api_key`)
- Guard against overwriting masked value in PUT /settings/:key
- SERPER_API_KEY is optional in setup-replit.sh (warning, not failure)
- `POST /api/settings/test-serper` tests the resolved key
