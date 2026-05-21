# Lead Intelligence Platform — Fresh Replit Import Guide

This document explains how to get the project running in a brand-new Replit account
after importing from GitHub. Follow every step in order.

---

## Why a setup step is needed

Replit creates a new PostgreSQL database for each import. The database is empty —
no tables exist yet. The app starts but every API call returns a 500 error until
the schema is applied. The setup script handles this automatically.

---

## Quick start (3 commands)

```bash
# 1. Add your secrets first (see Section 2)

# 2. Install and apply schema in one command
pnpm run setup:replit

# 3. Click Run (or start workflows from the panel)
```

That's it. The rest of this document explains each step in detail and covers
troubleshooting for common failure cases.

---

## Section 1 — Import the repository

1. Log in to [replit.com](https://replit.com)
2. Click **+ Create Repl** → **Import from GitHub**
3. Paste the repository URL and click **Import**
4. Wait for the import and initial package installation to complete
5. **Do not click Run yet** — the database schema has not been applied

---

## Section 2 — Add required Replit Secrets

In the left sidebar, click the **lock icon (Secrets)**. Add the following:

| Secret name | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string — Replit adds this automatically when you provision a database | `postgresql://user:pass@host:5432/db` |
| `SESSION_SECRET` | **Yes** | Random 32+ char string used to encrypt SMTP passwords. Generate: `openssl rand -hex 32` | `a1b2c3d4e5...` |
| `SERPER_API_KEY` | Optional | Fallback if the Settings UI key is not set. **Preferred: configure in Settings → Search API Settings after setup.** | `abc123...` |

> **DATABASE_URL**: In Replit, go to **Tools → Database** and add a PostgreSQL
> database. Replit automatically adds `DATABASE_URL` as a Secret.

> **SESSION_SECRET warning**: Once campaigns have saved SMTP accounts, never
> change `SESSION_SECRET`. Rotating it makes all stored SMTP passwords permanently
> unreadable and you will need to re-enter them.

### Optional secrets (can also be configured in the Settings UI)

| Secret | Default | Notes |
|---|---|---|
| `PORT` | `8080` | Set automatically by the artifact config — no action needed |
| `NODE_ENV` | `development` | Set to `production` for deployed environments |

> **Serper API key**: Configured in **Settings → Search API Settings**. No
> environment variable needed — the key is stored in the database. The
> `SERPER_API_KEY` env var still works as a fallback for server/CI deployments.

> **OpenAI API key**: Configured in **Settings → AI Settings**. Do not add as a Secret.

---

## Section 3 — Run setup

In the Replit Shell tab, run:

```bash
pnpm run setup:replit
```

This single command:
1. Verifies Node.js 24+ and pnpm are available
2. Confirms all required secrets are present (fails fast if not)
3. Runs `pnpm install --frozen-lockfile` to install dependencies
4. Runs `pnpm --filter @workspace/db run push` to apply the database schema

You should see output ending with:

```
  ✓  Setup complete!
```

If it fails, read the error output carefully — each step prints exactly what went wrong.

---

## Section 4 — Start the app

Click **Run** in Replit, or start the individual workflows:

- **API Server** — `pnpm --filter @workspace/api-server run dev`
- **Frontend (web)** — `pnpm --filter @workspace/leadgen run dev`

---

## Section 5 — Verify the setup

### Check the API is alive

```
GET /api/healthz
```

Expected response:
```json
{ "status": "ok" }
```

### Check the database schema

```
GET /api/healthz/deep
```

Expected response on a healthy fresh install:
```json
{
  "status": "warning",
  "database": {
    "connected": true,
    "missingTables": [],
    "missingColumns": [],
    "warnings": [
      "Optional setting \"blocked_domains\" is not configured — set it in Settings",
      "Optional setting \"ai_enabled\" is not configured — set it in Settings",
      "Optional setting \"ai_scoring_enabled\" is not configured — set it in Settings",
      "Optional setting \"openai_model\" is not configured — set it in Settings"
    ]
  },
  "message": "Database connected but some optional settings are not configured"
}
```

`status: "warning"` is **correct and expected** on first run — it means the database
and schema are healthy, and only the optional UI-configured settings are missing.
Configure them in **Settings** after you start the app.

If `status` is `"error"`, see the troubleshooting section below.

### Quick end-to-end check

```bash
# API alive
curl http://localhost:8080/api/healthz

# Schema status
curl http://localhost:8080/api/healthz/deep

# Campaigns list (should return [])
curl http://localhost:8080/api/campaigns
```

---

## Section 6 — First-time configuration

After setup, configure the app in the **Settings** page:

1. **Blocked Domains** — Add common spam/directory domains you never want as leads:
   ```
   linkedin.com
   google.com
   facebook.com
   glassdoor.com
   indeed.com
   twitter.com
   ```

2. **AI Settings** — Add your OpenAI API key and select a model (GPT-4o Mini recommended)

3. **Email Accounts** — Add your SMTP account(s) for outreach

---

## Section 7 — Troubleshooting

### `relation "campaigns" does not exist`

**Cause**: The database schema was never applied.

**Fix**:
```bash
pnpm run db:push
# or the full command:
pnpm --filter @workspace/db run push
```

Then verify with `GET /api/healthz/deep`.

---

### `DATABASE_URL is not configured`

**Cause**: The `DATABASE_URL` secret is missing.

**Fix**: Go to Replit → Secrets → add `DATABASE_URL`.

In Replit, the easiest way is to add a PostgreSQL database via **Tools → Database** —
Replit then automatically injects `DATABASE_URL`.

---

### `Could not find run command`

**Cause**: The `artifact.toml` build/run config was broken in an earlier version.

**Fix**: Verify `artifacts/api-server/.replit-artifact/artifact.toml` contains:
```toml
[services.production]
build = ["pnpm", "--filter", "@workspace/api-server", "run", "build"]
run   = ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
```

The current version of this file is correct. If it is wrong, ensure you are on
the latest commit.

---

### Frontend loads but API calls fail (network errors or 500s)

Checklist:
- [ ] Is the API server workflow running? Check the workflow panel.
- [ ] Does `GET /api/healthz` return `{ "status": "ok" }`?
- [ ] Does `GET /api/healthz/deep` show `missingTables: []`?
- [ ] Is `DATABASE_URL` set correctly?
- [ ] Was `pnpm run db:push` run after the database was provisioned?

---

### Schema push fails with `password authentication failed`

The `DATABASE_URL` value is wrong. In Replit, go to **Tools → Database** and copy
the exact connection string shown there. Do not edit it manually.

---

### Schema push fails with `minimumReleaseAge` error

This means a new package version is being pulled that has not been available for
24 hours yet (the supply-chain protection in `pnpm-workspace.yaml`).

**Fix**: Use `--frozen-lockfile` (which the setup script does by default):
```bash
pnpm install --frozen-lockfile
```

---

### `SESSION_SECRET` missing warnings after SMTP setup

If you see SMTP authentication errors after rotating or losing `SESSION_SECRET`,
you must re-add all SMTP accounts in **Email Accounts** — the stored passwords
cannot be decrypted with a different secret.

---

## Section 8 — What is in Git vs what must be configured per account

### Committed to Git (portable across all accounts)

| Item | Location |
|---|---|
| Full application source code | `artifacts/`, `lib/` |
| Pre-generated API client and Zod schemas | `lib/api-client-react/`, `lib/api-zod/` |
| Database schema definitions | `lib/db/src/schema/` |
| Build and run configuration | `artifact.toml` files |
| Replit environment config | `.replit` |
| Post-merge automation | `scripts/post-merge.sh` |
| This setup guide | `REPLIT_IMPORT.md` |
| Setup script | `scripts/setup-replit.sh` |

### Must be configured per Replit account (never in Git)

| Item | Where to set |
|---|---|
| `DATABASE_URL` | Replit → Secrets |
| `SESSION_SECRET` | Replit → Secrets |
| Serper API key | App → **Settings → Search API Settings** (preferred) or `SERPER_API_KEY` Secret (fallback) |
| OpenAI API key | App → Settings → AI Settings |
| SMTP account credentials | App → Email Accounts |
| Blocked domain list | App → Settings → Global Filters |

---

## Section 9 — Available setup commands

```bash
# Full setup (recommended for fresh import)
pnpm run setup:replit

# Push database schema only (safe to re-run)
pnpm run db:push

# Build everything (libs → frontend → backend)
pnpm run build

# Run all tests
pnpm --filter @workspace/api-server test

# Typecheck everything
pnpm run typecheck
```

---

## Section 10 — Post-merge automation

`scripts/post-merge.sh` runs automatically when task-agent changes are merged
into the main branch. It runs:

```bash
pnpm install --frozen-lockfile
pnpm --filter db push
```

This means schema changes from merged tasks are applied automatically. You do not
need to run `db:push` manually after a merge — only after a fresh import.
