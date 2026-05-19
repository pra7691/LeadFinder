# Lead Intelligence Platform — Production Deployment Guide

---

## CRITICAL: First-Time Database Setup

> **If you skip this step, every API call will fail with:**
> ```
> error: relation "campaigns" does not exist
> ```

After configuring `DATABASE_URL`, you **must** push the schema before starting the server:

```bash
pnpm --filter @workspace/db run push
```

This applies all 18 table definitions to your PostgreSQL database. There are no migration files — the schema in `lib/db/src/schema/` is the source of truth and `drizzle-kit push` syncs it directly.

Run this command:
- On every fresh database (new install, new environment, new Replit import)
- After any schema change (new columns, new tables)

The server will not start erroring immediately — it starts fine but returns 500 errors on every route that touches the database until the schema is applied.

> This step is also shown in Section 4 (Database Setup) and Section 14 (Step 4) of the deployment walkthrough below.

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18 + Vite 7 |
| Routing | Wouter 3 |
| State / data fetching | TanStack Query v5 |
| Styling | Tailwind CSS v4 + Shadcn UI |
| Backend framework | Express 5 |
| Language | TypeScript 5.9 (compiled via esbuild) |
| Database | PostgreSQL 16 |
| ORM / schema push | Drizzle ORM + drizzle-kit |
| Package manager | pnpm (workspace) |
| Node.js version | **24** (required) |
| Web scraping | Cheerio (no Playwright / Puppeteer) |
| Email | Nodemailer (STARTTLS / SSL via SMTP) |
| AI scoring & personalization | OpenAI API — key configured in Settings UI |
| Lead discovery | Serper.dev Search API — key via env var |

---

## 2. Folder Structure

```
.
├── artifacts/
│   ├── api-server/               # Express backend
│   │   ├── src/
│   │   │   ├── routes/           # API route handlers
│   │   │   ├── scheduler/        # Cron engine + Campaign Run pipeline
│   │   │   ├── services/         # Crawler, scorer, Serper client, AI settings
│   │   │   └── lib/              # Logger, crypto
│   │   └── dist/
│   │       └── index.mjs         # ← production build output
│   │
│   └── leadgen/                  # React / Vite frontend
│       ├── src/
│       │   ├── pages/            # All UI pages
│       │   └── components/       # Shared UI components
│       └── dist/
│           └── public/           # ← production static build output
│
├── lib/
│   ├── db/                       # Drizzle schema + DB client
│   │   └── src/schema/           # 15+ table definitions (source of truth)
│   ├── api-spec/
│   │   └── openapi.yaml          # OpenAPI 3.1 spec
│   ├── api-client-react/         # Auto-generated TanStack Query hooks
│   ├── api-zod/                  # Auto-generated Zod validation schemas
│   └── integrations-openai-ai-server/   # OpenAI client wrapper (unused in prod)
│
├── scripts/                      # Utility scripts
├── pnpm-workspace.yaml
└── package.json
```

---

## 3. Install Commands

```bash
# Install all workspace dependencies (run from repo root)
pnpm install
```

> pnpm **must** be used. The root `package.json` blocks npm and yarn via a `preinstall` guard.
> Install pnpm if needed: `npm install -g pnpm`

---

## 4. Database Setup

**Requirement:** PostgreSQL 16 (or compatible)

### DATABASE_URL format

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
```

Examples:
```
DATABASE_URL=postgresql://leadgen:secret@localhost:5432/leadgen_prod
DATABASE_URL=postgresql://user:pass@db.example.com:5432/leadgen?sslmode=require
```

### Push schema to database (first-time setup or after schema changes)

```bash
DATABASE_URL=your_connection_string pnpm --filter @workspace/db run push
```

This uses `drizzle-kit push` which introspects the schema and applies all table definitions directly. There are **no separate migration files** — the schema in `lib/db/src/schema/` is the source of truth.

> **Warning:** `push` is a direct schema sync. In production, run `drizzle-kit push --config lib/db/drizzle.config.ts` interactively the first time to review the planned SQL before confirming.

### Seed / reset

There is no seed script. The app populates data through normal usage (campaigns, leads, etc.). AI and domain settings are configured post-deploy via the Settings page.

To reset all data:
```sql
-- Connect to your DB and run:
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
-- Then re-run the push command above
```

---

## 5. Build Commands

All commands run from the **repo root**.

### Build shared libraries (required first)

```bash
pnpm run typecheck:libs
```

### Build frontend only

```bash
BASE_PATH=/ pnpm --filter @workspace/leadgen run build
```

Output: `artifacts/leadgen/dist/public/`

### Build backend only

```bash
pnpm --filter @workspace/api-server run build
```

Output: `artifacts/api-server/dist/index.mjs`

### Full monorepo build (libs → frontend → backend)

```bash
pnpm run typecheck:libs
BASE_PATH=/ pnpm --filter @workspace/leadgen run build
pnpm --filter @workspace/api-server run build
```

---

## 6. Production Run Commands

### Backend (API server)

```bash
PORT=8080 NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs
```

The API server:
- Listens on `PORT` (required env var — the server will throw if not set)
- Starts the cron scheduler automatically on startup (checks every minute which campaigns are due)
- Handles all `/api/*` routes

### Frontend

The frontend is a **pure static site**. Serve the directory `artifacts/leadgen/dist/public/` via any static file server (Nginx, Caddy, etc.) or a CDN.

**It must be served with a SPA fallback** — all paths (e.g. `/campaigns`, `/settings`) must fall back to `index.html`.

The frontend connects to the backend at the same origin under the `/api` prefix. No separate API URL configuration is required when both are served from the same domain via Nginx (see Section 14).

---

## 7. Does the API server serve the frontend?

**No.** They are two separate services:

- The **API server** (`artifacts/api-server/dist/index.mjs`) handles only `/api/*` routes.
- The **frontend** (`artifacts/leadgen/dist/public/`) is served as static files — by Nginx or equivalent.

The recommended setup is Nginx acting as a reverse proxy:
- `location /api` → proxy to Node.js process on port 8080
- `location /` → serve `artifacts/leadgen/dist/public/` as static files with SPA fallback

---

## 8. Environment Variables

### Required (server-side)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | Port the API server listens on (e.g. `8080`) |
| `SESSION_SECRET` | Arbitrary secret string used to encrypt SMTP passwords at rest (AES-256-GCM). **Must not change after initial setup** — rotating it makes all stored SMTP passwords permanently unreadable. Use a long random string (32+ chars). |
| `SERPER_API_KEY` | Your Serper.dev API key, used by the discovery step of every Campaign Run |
| `NODE_ENV` | Set to `production` |

### Optional (server-side)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error` |

### UI-configured settings (stored in the `app_settings` DB table)

These are **not** environment variables. They are configured in the app's **Settings** page after deployment and persisted in the database.

| Setting key | Where to set | Description |
|-------------|-------------|-------------|
| OpenAI API key | Settings → AI Settings | Your OpenAI API key (`sk-...`). Stored masked in the DB. |
| OpenAI model | Settings → AI Settings | Model used for scoring and personalization (default: `gpt-4o-mini`) |
| AI email personalization | Settings → AI Settings | Toggle to enable AI-written personalised outreach emails |
| AI lead scoring | Settings → AI Settings | Toggle to enable AI relevance scoring (vs keyword-only scoring) |
| Blocked domains | Settings → Discovery Filters | Newline-separated list of domains excluded from all Campaign Runs |
| SMTP accounts | Email Accounts page | Add/edit/test SMTP accounts used for outreach; passwords encrypted at rest |

> The `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` environment variables from the Replit AI integration are **not used** in production. OpenAI credentials are managed exclusively through the Settings UI.

### Frontend environment variables

The frontend has **no runtime environment variables**. It is compiled at build time. The only build-time variable required is:

| Variable | Value | Description |
|----------|-------|-------------|
| `BASE_PATH` | `/` | Vite base path. Must be set at build time. |

---

## 9. Where credentials are stored

| Credential | Storage method |
|-----------|---------------|
| `SERPER_API_KEY` | Server environment variable |
| OpenAI API key | `app_settings` DB table (`openai_api_key` row), stored masked |
| OpenAI model | `app_settings` DB table (`openai_model` row) |
| AI toggles | `app_settings` DB table (`ai_enabled`, `ai_scoring_enabled` rows) |
| Blocked domains | `app_settings` DB table (`blocked_domains` row) |
| SMTP host, port, username | `email_accounts` table in PostgreSQL (plaintext) |
| SMTP password | `email_accounts` table, encrypted with AES-256-GCM keyed from `SESSION_SECRET` |

---

## 10. Playwright in production?

**No.** The crawler uses **Cheerio** (an HTML parser) with standard HTTP `fetch` calls. There is no headless browser, no Playwright, and no Puppeteer. No special system dependencies are required for crawling.

---

## 11. CSV / XLSX file generation

Both CSV and XLSX exports are **generated in-memory and streamed directly** to the HTTP response. No files are written to disk, and no writable directories are required for exports.

---

## 12. Background jobs — Campaign Runs

The scheduler that fires Campaign Runs runs **inside the API server process**. No separate worker process is needed.

- The scheduler starts automatically when the server starts
- It ticks every minute using `node-cron`
- On each tick it checks which campaigns are due and starts their Campaign Run (discovery → crawl → score → email queue)
- Campaign Runs are non-blocking — they execute in the background and do not block incoming API requests
- A single Campaign Run can take several minutes depending on lead count and crawl targets
- If the server process restarts mid-run, the in-progress Campaign Run is orphaned (status stays `running`) and must be re-triggered manually from the Campaign Detail page

**Recommended timeout settings for Nginx:**

```nginx
proxy_read_timeout 120s;
proxy_connect_timeout 10s;
proxy_send_timeout 30s;
```

The manual Campaign Run trigger (`POST /api/campaigns/:id/runs`) and cancellation endpoint can involve multi-minute operations — set `proxy_read_timeout` to at least `120s`.

---

## 13. Health check endpoint

```
GET /api/healthz
```

Returns `200 OK` with `{ "status": "ok" }` when the server is running. Use this for load balancer and uptime monitor health checks.

---

## 14. Recommended deployment — VPS with PM2 + Nginx

### Step 1 — Install Node.js 24 and pnpm

```bash
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24
fnm use 24
npm install -g pnpm pm2
```

### Step 2 — Clone and install

```bash
git clone https://github.com/your-org/your-repo.git /var/www/leadgen
cd /var/www/leadgen
pnpm install
```

### Step 3 — Set environment variables

Create `/var/www/leadgen/.env.production`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/leadgen
PORT=8080
NODE_ENV=production
SESSION_SECRET=replace-with-a-long-random-string-32-chars-minimum
SERPER_API_KEY=your-serper-key
LOG_LEVEL=info
```

### Step 4 — Push database schema

```bash
source /var/www/leadgen/.env.production
pnpm --filter @workspace/db run push
```

### Step 5 — Build

```bash
cd /var/www/leadgen
pnpm run typecheck:libs
BASE_PATH=/ pnpm --filter @workspace/leadgen run build
pnpm --filter @workspace/api-server run build
```

### Step 6 — Start with PM2

Create `/var/www/leadgen/ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "leadgen-api",
      script: "node",
      args: "--enable-source-maps artifacts/api-server/dist/index.mjs",
      cwd: "/var/www/leadgen",
      env_file: "/var/www/leadgen/.env.production",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
    },
  ],
};
```

```bash
pm2 start /var/www/leadgen/ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

### Step 7 — Nginx config (with access restriction)

The app has **no login system**. You must restrict access at the Nginx level using either HTTP Basic Auth or an IP allowlist. Choose one of the two options below.

#### Option A — IP allowlist (recommended for single-operator use)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Allow only specific IPs — add your static IP(s) here
    allow 203.0.113.10;       # your office IP
    allow 198.51.100.25;      # your home IP
    deny all;

    # Serve frontend static files with SPA fallback
    root /var/www/leadgen/artifacts/leadgen/dist/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to Node.js
    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
    }
}
```

#### Option B — HTTP Basic Auth

```bash
# Install apache2-utils to create the password file
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd your-username
```

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # HTTP Basic Auth
    auth_basic "Lead Intelligence Platform";
    auth_basic_user_file /etc/nginx/.htpasswd;

    root /var/www/leadgen/artifacts/leadgen/dist/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
    }
}
```

Reload Nginx after either option:

```bash
nginx -t && systemctl reload nginx
```

---

## 15. Post-deployment verification

### Run backend tests

```bash
DATABASE_URL=your_connection_string pnpm --filter @workspace/api-server test
```

There are **36 tests** across the test suite. All 36 pass when the database schema has been pushed correctly (`pnpm --filter @workspace/db run push`). If tests fail with a `42P01` error (relation does not exist), the schema has not been applied to the test database.

### Manual checklist after deployment

**Infrastructure**
```
[ ] GET https://yourdomain.com/api/healthz → 200 { "status": "ok" }
[ ] Frontend loads at https://yourdomain.com/
[ ] Access restriction is working (IP allowlist or Basic Auth blocks unauthorised access)
[ ] PM2 process is running: pm2 status
[ ] PM2 is configured to restart on reboot: pm2 startup
```

**Pages & navigation**
```
[ ] /              — Dashboard loads, stats tiles visible
[ ] /campaigns     — Campaigns list renders without error
[ ] /lists         — Lists page renders
[ ] /outreach-review — Outreach Review page renders
[ ] /settings      — Settings page loads with all sections
```

**Serper API key verification**
```
[ ] Go to Campaigns → create a test campaign with one keyword and one country
[ ] Click "Run Campaign" from Campaign Detail
[ ] Verify the Campaign Run appears and status changes from "running" → "success"
[ ] Go to Activity Logs — Discovery log entries should appear
[ ] If the run fails immediately, check server logs for SERPER_API_KEY errors
```

**OpenAI connection test**
```
[ ] Go to Settings → AI Settings
[ ] Enter your OpenAI API key and select a model
[ ] Toggle "AI Lead Scoring" on and save
[ ] Click "Test AI Connection" — should return a success response
[ ] If it fails, verify the key is correct and has billing enabled on the OpenAI dashboard
```

**SMTP account test**
```
[ ] Go to Email Accounts → Add an SMTP account
[ ] Fill in host, port, username, password, TLS settings
[ ] Click "Test Connection" — should report success
[ ] If it fails, check port/TLS settings and that the SMTP server allows the connection from your server IP
```

**Campaign Run creation and stop**
```
[ ] Go to Campaigns → open a campaign → click "Run Campaign"
[ ] Verify a Campaign Run row appears in the Campaign Runs list with status "running"
[ ] Open the Campaign Run Detail — verify live counters update (discovered, crawled, scored)
[ ] Click "Stop" / cancel the run — verify status changes to "cancelled" or "stopped"
[ ] Verify a completed run shows summary counts
```

**Exports**
```
[ ] Go to a Campaign Detail or Leads section
[ ] Export as CSV — file downloads with correct filename and content
[ ] Export as XLSX — file downloads and opens correctly in Excel/Sheets
```

**End-to-end Campaign Run**
```
[ ] Run a full campaign to completion (small: 1 keyword, 1 country, low lead limit)
[ ] Verify leads appear in Campaign Run Detail
[ ] Verify scored leads show a relevance score
[ ] Verify outreach queue items appear in Outreach Review if email templates are configured
```

---

## 16. Known deployment limitations and risks

| Risk | Detail |
|------|--------|
| **No authentication layer** | The app has no login or access control. All routes are open. You must protect it at the Nginx level using an IP allowlist or HTTP Basic Auth (see Section 14). |
| **Long-running Campaign Runs** | A Campaign Run can take 1–5+ minutes. Nginx's default `proxy_read_timeout` of 60s will terminate the manual trigger request. Set it to at least `120s`. The run itself continues in the background regardless of the HTTP timeout. |
| **Orphaned runs on server restart** | If the API server process crashes or is restarted during an active Campaign Run, the run is left in `running` status. Re-trigger it manually from the Campaign Detail page. |
| **Crawler rate limits** | The crawler makes sequential HTTP requests to external sites. High-volume campaigns may trigger rate limiting or IP blocks on target sites. There is no built-in proxy rotation. |
| **SESSION_SECRET must not change** | If `SESSION_SECRET` is rotated after SMTP credentials have been saved, all stored SMTP passwords become permanently unreadable. All email accounts will need to be re-entered. |
| **Database migrations** | `drizzle-kit push` applies changes directly without a migration history. Before pushing schema changes to production, back up the database and review planned SQL with `drizzle-kit push --verbose`. |
| **CORS** | The API server applies permissive CORS by default. If you need to restrict origins, add an `origin` option to the `cors()` call in `artifacts/api-server/src/app.ts`. |
| **OpenAI API costs** | Each lead scored via AI makes one GPT-4o-mini call. Large Campaign Runs (hundreds of leads) will incur meaningful API costs. Monitor usage in your OpenAI dashboard. |
| **Serper API quota** | Each keyword × country search consumes Serper credits. Check your plan limits before scheduling high-frequency campaigns. |
| **Single-instance only** | The cron scheduler uses in-process state. Do not run more than one instance of the API server against the same database — it will cause duplicate Campaign Runs. |
