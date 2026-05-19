# Lead Intelligence Platform — Production Deployment Guide

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
| AI scoring | OpenAI API (GPT-4o-mini) |
| Lead discovery | Serper.dev Search API |

---

## 2. Folder Structure

```
.
├── artifacts/
│   ├── api-server/               # Express backend
│   │   ├── src/
│   │   │   ├── routes/           # API route handlers
│   │   │   ├── scheduler/        # Cron engine + pipeline
│   │   │   ├── services/         # Crawler, scorer, Serper client
│   │   │   └── lib/              # Logger, crypto
│   │   └── dist/
│   │       └── index.mjs         # ← production build output
│   │
│   └── leadgen/                  # React / Vite frontend
│       ├── src/
│       │   ├── pages/            # All 9 UI pages
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
│   └── integrations-openai-ai-server/   # OpenAI client wrapper
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

> **Warning:** `push` is a direct schema sync. In production, review the changes drizzle-kit plans to make before confirming. Run `drizzle-kit push --config lib/db/drizzle.config.ts` interactively the first time.

### Seed / reset

There is no seed script. The app populates data through normal usage (campaigns, leads, etc.).

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
BASE_PATH=/ pnpm -r --if-present run build
```

Or step-by-step for more control:

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
- Starts the cron scheduler automatically on startup
- Handles all `/api/*` routes

### Frontend

The frontend is a **pure static site**. Serve the directory `artifacts/leadgen/dist/public/` via any static file server (Nginx, Caddy, etc.) or a CDN.

**It must be served with a SPA fallback** — all paths (e.g. `/campaigns`, `/leads`) must fall back to `index.html`.

The frontend connects to the backend at the same origin under the `/api` prefix. No separate API URL configuration is required if both are served from the same domain (e.g. Nginx proxies `/api` to the Node process and serves `/` as static files).

---

## 7. Does the API server serve the frontend?

**No.** They are two separate services:

- The **API server** (`artifacts/api-server/dist/index.mjs`) handles only `/api/*` routes.
- The **frontend** (`artifacts/leadgen/dist/public/`) is served as static files — by Nginx or equivalent.

The recommended setup is Nginx acting as a reverse proxy:
- `location /api` → proxy to Node.js process on port 8080
- `location /` → serve `artifacts/leadgen/dist/public/` as static files with `try_files $uri /index.html`

---

## 8. Environment Variables

Set these on the server (e.g. in `/etc/environment`, a `.env` file loaded by PM2, or your process manager).

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | Port the API server listens on (e.g. `8080`) |
| `SESSION_SECRET` | Arbitrary secret string used to encrypt SMTP passwords at rest (AES-256-GCM). **Must not change after initial setup** — changing it makes stored SMTP passwords unreadable. Use a long random string (32+ chars). |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Your OpenAI API key (e.g. `sk-...`) |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI API base URL. For direct OpenAI: `https://api.openai.com/v1` |
| `SERPER_API_KEY` | Your Serper.dev API key for lead discovery |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | — | Set to `production` for production deployments |
| `LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error` |

### Frontend environment variables

The frontend has **no runtime environment variables**. It is compiled at build time. The only build-time variable required is:

| Variable | Value | Description |
|----------|-------|-------------|
| `BASE_PATH` | `/` | Vite base path. Must be set at build time. |

---

## 9. Where API keys and credentials are stored

| Credential | Storage method |
|-----------|---------------|
| `SERPER_API_KEY` | Server environment variable |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Server environment variable |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Server environment variable |
| SMTP host, port, username | Stored in the `email_accounts` table in PostgreSQL (plaintext) |
| SMTP password | Stored encrypted in the `email_accounts` table using AES-256-GCM, keyed from `SESSION_SECRET` |
| Blocked domains / app settings | Stored in the `app_settings` table in PostgreSQL, managed via the Settings page in the UI |

---

## 10. Playwright in production?

**No.** The crawler uses **Cheerio** (an HTML parser) with standard HTTP `fetch` calls. There is no headless browser, no Playwright, and no Puppeteer. No special system dependencies are required for crawling.

---

## 11. CSV / XLSX file generation

Both CSV and XLSX exports are **generated in-memory and streamed directly** to the HTTP response. No files are written to disk, and no writable directories are required for exports.

---

## 12. Background jobs

The cron-based pipeline scheduler runs **inside the API server process**. No separate worker process is needed.

- The scheduler starts automatically when the server starts
- It ticks every minute using `node-cron`
- On each tick it checks which campaigns are due and runs their pipeline (discovery → crawl → score → email queue)
- Pipeline runs are non-blocking — they run in the background and do not block incoming API requests
- A single campaign pipeline can run for several minutes depending on the number of leads and crawl targets

**Recommended timeout settings for Nginx (if proxying):**

```nginx
proxy_read_timeout 120s;
proxy_connect_timeout 10s;
proxy_send_timeout 30s;
```

The manually triggered pipeline endpoint (`POST /api/campaigns/:id/trigger`) can take over a minute to respond. If you need long-running request support, increase `proxy_read_timeout` accordingly.

---

## 13. Health check endpoint

```
GET /api/healthz
```

Returns `200 OK` with `{ "status": "ok" }` when the server is running. Use this for load balancer and uptime monitor checks.

---

## 14. Recommended deployment commands

### VPS with PM2 + Nginx

**Step 1 — Install Node.js 24 and pnpm**

```bash
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24
fnm use 24
npm install -g pnpm pm2
```

**Step 2 — Clone and install**

```bash
git clone https://github.com/your-org/your-repo.git /var/www/leadgen
cd /var/www/leadgen
pnpm install
```

**Step 3 — Set environment variables**

Create `/var/www/leadgen/.env.production`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/leadgen
PORT=8080
NODE_ENV=production
SESSION_SECRET=replace-with-a-long-random-string
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
SERPER_API_KEY=your-serper-key
```

**Step 4 — Push database schema**

```bash
source /var/www/leadgen/.env.production
pnpm --filter @workspace/db run push
```

**Step 5 — Build**

```bash
cd /var/www/leadgen
BASE_PATH=/ pnpm --filter @workspace/leadgen run build
pnpm --filter @workspace/api-server run build
```

**Step 6 — Start with PM2**

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

**Step 7 — Nginx config**

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Serve frontend static files
    root /var/www/leadgen/artifacts/leadgen/dist/public;
    index index.html;

    # SPA fallback for frontend routes
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

Then reload Nginx:

```bash
nginx -t
systemctl reload nginx
```

---

### Replit deployment

1. Ensure all required environment variables are set in Replit's Secrets panel (sidebar → Secrets)
2. The frontend is automatically built and served as a static site
3. The API server is built and run using the commands in `artifacts/api-server/.replit-artifact/artifact.toml`
4. Click **Publish** in the Replit UI — no manual build steps required

---

## 15. Post-deployment verification

### Run backend tests

```bash
DATABASE_URL=your_connection_string pnpm --filter @workspace/api-server test
```

This runs 23 integration tests covering route handlers, schema validation, and pipeline logic.

### Manual checklist after deployment

```
[ ] GET https://yourdomain.com/api/healthz returns 200 { "status": "ok" }
[ ] Frontend loads at https://yourdomain.com/
[ ] Dashboard page shows stats (confirms DB is connected and seeded)
[ ] Navigate to /campaigns — page loads without error
[ ] Navigate to /leads — leads table renders (may be empty on first deploy)
[ ] Create a test campaign with one keyword and one country
[ ] Manually trigger the campaign pipeline — confirm it runs without error
[ ] Check /activity-logs — pipeline log entries should appear
[ ] Navigate to /email-accounts — add a test SMTP account and run the SMTP test
[ ] Confirm SMTP test sends successfully (validates SESSION_SECRET + encryption)
[ ] Export leads as CSV and XLSX — confirm file downloads work
[ ] Check server logs: no ERROR-level entries at startup
```

---

## 16. Known deployment limitations and risks

| Risk | Detail |
|------|--------|
| **Long-running pipeline requests** | The manual pipeline trigger can take 1–5+ minutes. Nginx default `proxy_read_timeout` of 60s will terminate these. Set it to at least `120s`. |
| **Crawler rate limits** | The crawler makes sequential HTTP requests to external sites. If you run many large campaigns simultaneously, external sites may rate-limit or block your server IP. There is no built-in proxy rotation. |
| **Single-process scheduler** | The cron scheduler is embedded in the API server process. If the process restarts mid-pipeline, the in-progress run is orphaned and must be re-triggered manually. PM2's `autorestart` mitigates downtime but not mid-run crashes. |
| **SESSION_SECRET must not change** | If `SESSION_SECRET` is rotated after SMTP credentials have been saved, all stored SMTP passwords become permanently unreadable. All email accounts will need to be re-entered. |
| **No authentication layer** | The app has no login or access control — all routes are open. Do not expose the app publicly without adding network-level protection (e.g. VPN, IP allowlist, or HTTP Basic Auth in Nginx). |
| **Database migrations** | `drizzle-kit push` applies changes directly without a migration history. Before pushing schema changes to production, verify the planned SQL with `drizzle-kit push --verbose` and back up the database first. |
| **CORS** | The API server applies permissive CORS (`cors()` with defaults). If frontend and backend are on different origins, this is intentional. If you want to restrict origins, add `origin` config to the `cors()` call in `artifacts/api-server/src/app.ts`. |
| **No disk writes required** | CSV and XLSX exports are streamed in-memory. No writable directories are needed beyond standard OS temp. |
| **OpenAI API costs** | Each lead scored via AI makes one GPT-4o-mini call. Large campaigns (hundreds of leads) will incur meaningful API costs. Monitor usage in your OpenAI dashboard. |
| **Serper API quota** | Each keyword × country search consumes Serper credits. Check your Serper plan limits before scheduling high-frequency campaigns. |
