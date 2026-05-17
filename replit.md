# Lead Intelligence Platform

A single-operator internal tool for AI-powered lead discovery, qualification, and email outreach. Discovers companies via Serper web search, crawls their websites for contact data, scores them with keyword-based relevance, and manages the full outreach workflow through SMTP.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080 → proxied at `/api`)
- `pnpm --filter @workspace/leadgen run dev` — run the React frontend (proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages (build libs first, then leaf checks)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only, never production)
- `pnpm --filter @workspace/api-server test` — run the 23 integration tests (Vitest)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- **Monorepo**: pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend**: React 18 + Vite 7, Wouter (routing), TanStack Query v5, Tailwind CSS v4, Shadcn UI
- **API**: Express 5, Pino logger, Zod validation
- **DB**: PostgreSQL + Drizzle ORM (`lib/db`)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API contract**: OpenAPI 3.1 spec in `lib/api-spec/openapi.yaml` → Orval codegen
- **Generated client**: `lib/api-client-react` (React Query hooks + Zod schemas)
- **Build**: esbuild (CJS bundle for API server)
- **Scheduling**: `node-cron` (every-minute tick, campaign-level daily/weekly schedules)
- **Email**: `nodemailer` with AES-256-GCM encrypted SMTP credentials
- **Export**: `exceljs` for styled XLSX, native CSV generation

## Where things live

| Area | Path |
|------|------|
| DB schema (source of truth) | `lib/db/src/schema/` |
| OpenAPI spec | `lib/api-spec/openapi.yaml` |
| Generated React hooks | `lib/api-client-react/src/generated/api.ts` |
| API routes | `artifacts/api-server/src/routes/` |
| Scheduler (cron worker) | `artifacts/api-server/src/scheduler/index.ts` |
| Pipeline (discover→crawl→score→email) | `artifacts/api-server/src/scheduler/pipeline.ts` |
| Frontend pages | `artifacts/leadgen/src/pages/` |
| Frontend components | `artifacts/leadgen/src/components/` |
| Global styles + glass-card | `artifacts/leadgen/src/index.css` |

## Architecture decisions

- **Contract-first API**: OpenAPI spec is the single source of truth. Never edit generated files in `lib/api-client-react/src/generated/` directly — always edit the spec and re-run codegen.
- **Scheduler runs in-process**: `node-cron` fires every minute inside the Express server process. Each campaign stores `next_run_at`; the tick checks if any campaign is due. This avoids an external job queue for a single-user tool.
- **Express 5 early-return pattern**: Routes use `res.status(X).json({ ... }); return;` — never `return res.json()` (Express 5 broke that pattern).
- **AES-256-GCM for SMTP passwords**: Credentials are encrypted at rest using a key derived from `SESSION_SECRET`. The `smtpPassword` column stores `iv:authTag:ciphertext` as hex.
- **Glassmorphic dark/light UI**: The `glass-card` utility class in `index.css` applies `backdrop-blur`, semi-transparent backgrounds, and subtle border — the design language throughout the app. Error boundaries wrap the entire `<Switch>` to prevent blank screens.
- **Single-tenant**: No auth layer — all routes are open. Designed for internal / localhost use by a single operator.

## Product

Eight feature areas, each a dedicated page:

1. **Overview (Dashboard)** — Stats tiles (campaigns, leads, emails), scheduler status per campaign, recent activity feed.
2. **Campaigns** — Create / configure discovery campaigns with keywords, countries, limits, email templates, and daily/weekly cron schedules.
3. **Campaign Detail** — Full settings: objective, keywords, countries, lead/email limits, outreach templates, scheduler config, and manual pipeline trigger.
4. **Leads Queue** — Master lead table with 8 quick-filter tabs, per-row Crawl/Score actions, bulk operations (approve/reject/archive/queue for outreach), and Export (CSV or XLSX).
5. **Lead Drawer** — Slide-over with full lead detail: contact info, notes, status history, inline edit.
6. **Email Accounts** — SMTP account management with per-account STARTTLS/SSL config, daily send limits, live SMTP test, and campaign assignment.
7. **Outreach Queue** — Review draft emails, approve/edit/send individually or batch-send all approved items, retry failed sends, preview panel, send-test dialog.
8. **Activity Logs** — Full audit trail with type-filtered pills (Discovery, Crawl, Score, Export, Filter, Workflow…), search, and event count.
9. **Settings** — Global blocked-domains list applied at discovery time.

## User preferences

- Single-user internal tool — no auth layer required.
- Glassmorphic Apple-style design: `glass-card`, `rounded-2xl`, `backdrop-blur`, soft shadows.
- All tables have skeleton loading states (pulsing rows/cards) and illustrated empty states.
- Error boundaries wrap all routes so crashes are isolated and recoverable.
- Express 5 early-return pattern must be followed in all route handlers.

## Gotchas

- **Do not run `pnpm dev` at workspace root** — use workflows or `--filter`.
- **Always run codegen after editing `openapi.yaml`** — stale generated types cause silent runtime failures.
- **`cron` import**: must be `import * as cron from "node-cron"` (not default import).
- **`Sheet` icon does not exist in lucide-react** — use `FileSpreadsheet` instead.
- **DB push is dev-only** — for production, write a proper migration script.
- **SMTP passwords** are encrypted; if `SESSION_SECRET` changes, existing stored passwords become unreadable.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- See `lib/api-spec/openapi.yaml` for the full API contract (all endpoints, request/response schemas).
- See `lib/db/src/schema/index.ts` for the canonical DB schema barrel.
