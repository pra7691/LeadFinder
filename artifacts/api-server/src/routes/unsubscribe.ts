import { Router } from "express";
import { randomUUID } from "crypto";
import { db, appSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { ensureUnsubscribeSchema } from "../lib/schema-guards";

const router = Router();

// ── Raw SQL helper (db.execute returns a QueryResult, not an array) ───────────

type QueryResult<T> = { rows: T[] };

async function queryRows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as QueryResult<T>;
  return result.rows ?? [];
}

// ── Settings helpers ─────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  const val = (row?.value ?? "").trim();
  return val || null;
}

// ── Token management ─────────────────────────────────────────────────────────

/** Generate or reuse an unsubscribe token for an outreach queue item. */
export async function ensureUnsubscribeToken(outreachId: number): Promise<string> {
  await ensureUnsubscribeSchema();
  const rows = await queryRows<{ unsubscribe_token: string | null }>(
    sql`SELECT unsubscribe_token FROM outreach_queue WHERE id = ${outreachId}`,
  );
  const existing = rows[0];
  if (existing?.unsubscribe_token) return existing.unsubscribe_token;
  const token = randomUUID();
  await db.execute(sql`UPDATE outreach_queue SET unsubscribe_token = ${token} WHERE id = ${outreachId}`);
  return token;
}

/**
 * Build the unsubscribe URL to embed in an email.
 *
 * Priority:
 *   1. unsubscribe_page_url (PHP file on FTP)  →  {url}?t={token}&e={email}&n={company}
 *   2. app_base_url (self-hosted API server)    →  {base}/api/unsubscribe/{token}
 *   3. Neither set                              →  null (no link added)
 */
export async function buildUnsubscribeUrl(
  outreachId: number,
  recipientEmail: string,
  companyName?: string | null,
): Promise<string | null> {
  await ensureUnsubscribeSchema();
  const token = await ensureUnsubscribeToken(outreachId);

  // Option 1: PHP file on FTP hosting
  const phpUrl = await getSetting("unsubscribe_page_url");
  if (phpUrl) {
    const url = new URL(phpUrl);
    url.searchParams.set("t", token);
    url.searchParams.set("e", recipientEmail);
    if (companyName) url.searchParams.set("n", companyName);
    return url.toString();
  }

  // Option 2: API server (self-hosted)
  const base = await getSetting("app_base_url");
  if (base) {
    return `${base.replace(/\/$/, "")}/api/unsubscribe/${token}`;
  }

  return null;
}

/** Check if an email address is on the unsubscribe list. */
export async function isEmailUnsubscribed(email: string): Promise<boolean> {
  await ensureUnsubscribeSchema();
  const rows = await queryRows<{ id: number }>(
    sql`SELECT id FROM unsubscribes WHERE lower(email) = lower(${email}) LIMIT 1`,
  );
  return rows.length > 0;
}

// ── GET /api/unsubscribe/:token  (HTML page — used when app_base_url mode) ───
router.get("/unsubscribe/:token", async (req, res) => {
  try {
    await ensureUnsubscribeSchema();
    const token = String(req.params.token ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
    if (!token) { res.status(400).send("Invalid token"); return; }

    const outreachRows = await queryRows<{
      id: number; recipient_email: string; lead_id: number;
    }>(sql`SELECT id, recipient_email, lead_id FROM outreach_queue WHERE unsubscribe_token = ${token} LIMIT 1`);

    if (!outreachRows[0]) {
      res.status(404).send("<h2 style='font-family:sans-serif;padding:40px'>Invalid or expired unsubscribe link.</h2>");
      return;
    }
    const outreachRow = outreachRows[0];

    const leadRows = await queryRows<{ company_name: string | null }>(
      sql`SELECT company_name FROM leads WHERE id = ${outreachRow.lead_id} LIMIT 1`,
    );
    const unsubRows = await queryRows<{ id: number }>(
      sql`SELECT id FROM unsubscribes WHERE lower(email) = lower(${outreachRow.recipient_email}) LIMIT 1`,
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildHtmlPage({
      token,
      recipientEmail: outreachRow.recipient_email,
      companyName: leadRows[0]?.company_name ?? null,
      alreadyUnsubscribed: unsubRows.length > 0,
    }));
  } catch (err) {
    console.error("Unsubscribe page error:", err);
    res.status(500).send("An error occurred. Please try again later.");
  }
});

// ── POST /api/unsubscribe/:token  (record unsubscribe — app_base_url mode) ───
router.post("/unsubscribe/:token", async (req, res) => {
  try {
    await ensureUnsubscribeSchema();
    const token = String(req.params.token ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
    if (!token) { res.status(400).json({ error: "Invalid token" }); return; }

    const outreachRows = await queryRows<{
      id: number; recipient_email: string; lead_id: number;
    }>(sql`SELECT id, recipient_email, lead_id FROM outreach_queue WHERE unsubscribe_token = ${token} LIMIT 1`);

    if (!outreachRows[0]) { res.status(404).json({ error: "Invalid or expired link" }); return; }
    const outreachRow = outreachRows[0];
    const email = outreachRow.recipient_email.toLowerCase();

    const existing = await queryRows<{ id: number }>(
      sql`SELECT id FROM unsubscribes WHERE lower(email) = ${email} LIMIT 1`,
    );
    if (existing.length === 0) {
      const leadRows = await queryRows<{ company_name: string | null }>(
        sql`SELECT company_name FROM leads WHERE id = ${outreachRow.lead_id} LIMIT 1`,
      );
      await db.execute(
        sql`INSERT INTO unsubscribes (email, token, outreach_id, company_name, unsubscribed_at, created_at)
            VALUES (${email}, ${token}, ${outreachRow.id}, ${leadRows[0]?.company_name ?? null}, now(), now())
            ON CONFLICT (email) DO NOTHING`,
      );
      // Mark the outreach item (and any others for this email) as unsubscribed
      await db.execute(
        sql`UPDATE outreach_queue SET failure_reason = 'unsubscribed' WHERE unsubscribe_token = ${token}`,
      );
    }
    res.json({ unsubscribed: true, email });
  } catch (err) {
    console.error("Unsubscribe POST error:", err);
    res.status(500).json({ error: "Failed to process unsubscribe" });
  }
});

// ── GET /api/unsubscribes  (dashboard list) ───────────────────────────────────
router.get("/unsubscribes", async (_req, res) => {
  try {
    await ensureUnsubscribeSchema();
    const rows = await queryRows<{
      id: number; email: string; company_name: string | null; unsubscribed_at: string;
    }>(sql`SELECT id, email, company_name, unsubscribed_at FROM unsubscribes ORDER BY unsubscribed_at DESC`);
    res.json(rows);
  } catch (err) {
    console.error("List unsubscribes error:", err);
    res.status(500).json({ error: "Failed to fetch unsubscribes" });
  }
});

// ── POST /api/unsubscribes/sync  (pull from PHP file on FTP) ─────────────────
router.post("/unsubscribes/sync", async (_req, res) => {
  try {
    await ensureUnsubscribeSchema();

    const phpUrl = await getSetting("unsubscribe_page_url");
    const adminSecret = await getSetting("unsubscribe_admin_secret");

    if (!phpUrl) {
      res.status(400).json({ error: "Unsubscribe Page URL is not configured in Settings → Email Tracking." });
      return;
    }

    // If admin secret is set, append it as ?admin=SECRET (PHP handler mode).
    // If no secret, fetch the URL directly — used when pointing at unsubscribes.json.
    const fetchUrl = adminSecret
      ? (() => { const u = new URL(phpUrl); u.searchParams.set("admin", adminSecret); return u.toString(); })()
      : phpUrl;

    let remoteRows: Array<{ email: string; company_name: string | null; token: string; unsubscribed_at: string }>;
    try {
      const fetchRes = await fetch(fetchUrl);
      if (!fetchRes.ok) throw new Error(`Server returned ${fetchRes.status}`);
      remoteRows = await fetchRes.json();
      if (!Array.isArray(remoteRows)) throw new Error("Unexpected response format — expected a JSON array");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({ error: `Could not fetch unsubscribes: ${msg}` });
      return;
    }

    let imported = 0;
    for (const row of remoteRows) {
      const email = (row.email ?? "").trim().toLowerCase();
      if (!email) continue;
      const token = (row.token ?? randomUUID()).trim();
      const companyName = row.company_name ?? null;
      const unsubscribedAt = row.unsubscribed_at ? new Date(row.unsubscribed_at) : new Date();
      // Returns the number of rows affected (0 if already existed)
      const insertResult = await db.execute(
        sql`INSERT INTO unsubscribes (email, token, company_name, unsubscribed_at, created_at)
            VALUES (${email}, ${token}, ${companyName}, ${unsubscribedAt.toISOString()}, now())
            ON CONFLICT (email) DO NOTHING`,
      ) as unknown as { rowCount: number };
      if ((insertResult?.rowCount ?? 1) > 0) {
        // Mark the corresponding outreach queue item as unsubscribed
        await db.execute(
          sql`UPDATE outreach_queue SET failure_reason = 'unsubscribed' WHERE unsubscribe_token = ${token}`,
        );
        imported++;
      }
    }

    res.json({ synced: imported, total: remoteRows.length });
  } catch (err) {
    console.error("Sync unsubscribes error:", err);
    res.status(500).json({ error: "Sync failed" });
  }
});

// ── DELETE /api/unsubscribes/:email  (remove from list) ─────────────────────
router.delete("/unsubscribes/:email", async (req, res) => {
  try {
    await ensureUnsubscribeSchema();
    const email = decodeURIComponent(req.params.email ?? "").trim().toLowerCase();
    if (!email) { res.status(400).json({ error: "Invalid email" }); return; }
    await db.execute(sql`DELETE FROM unsubscribes WHERE lower(email) = ${email}`);
    res.status(204).send();
  } catch (err) {
    console.error("Delete unsubscribe error:", err);
    res.status(500).json({ error: "Failed to remove from unsubscribe list" });
  }
});

// ── HTML page builder (for app_base_url mode) ────────────────────────────────

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}${domain}`;
}

function buildHtmlPage(opts: {
  token: string;
  recipientEmail: string;
  companyName: string | null;
  alreadyUnsubscribed: boolean;
}): string {
  const { token, recipientEmail, companyName, alreadyUnsubscribed } = opts;
  const masked = maskEmail(recipientEmail);

  const iconCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`;
  const iconMail  = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Unsubscribe — Verbose Tech Labs</title>
<style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f4f4f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#fff;border-radius:20px;box-shadow:0 4px 32px rgba(0,0,0,.08);max-width:480px;width:100%;padding:48px 40px 40px;text-align:center}.logo-wrap{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:36px}.logo-img{width:40px;height:40px;border-radius:8px}.logo-text{font-size:18px;font-weight:700;color:#111827}.logo-sub{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;margin-top:2px}.icon-wrap{width:72px;height:72px;border-radius:50%;background:#fef2f2;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;color:#ef4444}.icon-ok{background:#f0fdf4!important;color:#22c55e!important}h1{font-size:22px;font-weight:700;color:#111827;margin-bottom:12px;line-height:1.35}.sub{font-size:15px;color:#6b7280;line-height:1.65;margin-bottom:8px}.chip{display:inline-block;background:#f3f4f6;color:#374151;font-size:13px;font-weight:500;font-family:monospace;padding:5px 16px;border-radius:100px;margin-bottom:28px;margin-top:4px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px 24px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;border:none;background:#ef4444;color:#fff;transition:background .15s}.btn:hover:not(:disabled){background:#dc2626}.btn:disabled{opacity:.55;cursor:not-allowed}.err{display:none;color:#ef4444;font-size:13px;margin-top:12px}.note{margin-top:28px;font-size:12px;color:#9ca3af}#ok{display:none}@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin .75s linear infinite}</style>
</head><body><div class="card">
<div class="logo-wrap"><img class="logo-img" src="https://verbosetech.com/favicon.ico" onerror="this.style.display='none'" alt="VTL"/><div><div class="logo-text">Verbose Tech Labs</div><div class="logo-sub">B2B Data Provider</div></div></div>
<div id="main">
${alreadyUnsubscribed
  ? `<div class="icon-wrap icon-ok">${iconCheck}</div><h1>Already Unsubscribed</h1><p class="sub">You're already off our mailing list.</p><div class="chip">${masked}</div><p class="sub" style="font-size:13px;margin-top:2px">You won't receive any more outreach emails from us.</p>`
  : `<div class="icon-wrap">${iconMail}</div><h1>Are you sure you don't want to receive our emails?</h1><p class="sub">${companyName ? `We've been reaching out to <strong>${companyName}</strong> about B2B data solutions from Verbose Tech Labs.` : "We send carefully curated B2B data and intelligence emails."}</p><div class="chip">${masked}</div><button class="btn" id="btn" onclick="doUnsub()"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>Unsubscribe</button><div class="err" id="err">Something went wrong. Please try again.</div>`
}
</div>
<div id="ok"><div class="icon-wrap icon-ok">${iconCheck}</div><h1>Successfully Unsubscribed</h1><p class="sub">You've been removed from our mailing list.</p><div class="chip">${masked}</div><p class="sub" style="font-size:13px;margin-top:2px">We respect your choice. You won't hear from us again.</p></div>
<p class="note">Verbose Tech Labs &mdash; B2B Data Intelligence</p>
</div>
<script>async function doUnsub(){const b=document.getElementById('btn'),e=document.getElementById('err');b.disabled=true;b.innerHTML='<svg class="spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Processing…';try{const r=await fetch('/api/unsubscribe/${token}',{method:'POST',headers:{'Content-Type':'application/json'}});if(!r.ok)throw new Error();document.getElementById('main').style.display='none';document.getElementById('ok').style.display='block';}catch{b.disabled=false;b.innerHTML='Unsubscribe';e.style.display='block';}}</script>
</body></html>`;
}

export default router;
