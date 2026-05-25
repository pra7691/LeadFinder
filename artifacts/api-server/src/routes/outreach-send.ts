import { Router } from "express";
import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import {
  outreachQueueTable,
  emailAccountsTable,
  emailTemplatesTable,
  campaignsTable,
  leadsTable,
  logsTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { decrypt, isEncrypted } from "../lib/crypto";
import {
  SendOutreachItemParams,
  RetryOutreachItemParams,
  SendTestEmailBody,
} from "@workspace/api-zod";
import { appendUnsubscribeFooter, toHtmlEmail, toTextEmail } from "../services/email-html";
import { ensureEmailTemplateAttachmentColumn } from "../lib/schema-guards";
import { buildUnsubscribeUrl, isEmailUnsubscribed } from "./unsubscribe";
import { toNodemailerAttachments } from "../services/email-template-attachments";
import {
  addTrackingToHtml,
  ensureTrackingId,
  getTrackingSettings,
  recordClick,
  recordOpen,
  syncExternalTracking,
} from "../services/email-tracking";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let batchSendRunning = false;
let batchSendCancelRequested = false;

function resetBatchSendState() {
  batchSendRunning = false;
  batchSendCancelRequested = false;
}

function interruptibleDelay(ms: number) {
  return new Promise<"done" | "cancelled">((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (batchSendCancelRequested) {
        resolve("cancelled");
        return;
      }
      if (Date.now() - startedAt >= ms) {
        resolve("done");
        return;
      }
      setTimeout(tick, Math.min(250, ms - (Date.now() - startedAt)));
    };
    tick();
  });
}

async function randomInterruptibleDelay(minMs = 2000, maxMs = 8000) {
  return interruptibleDelay(Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs);
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fromHeader(account: typeof emailAccountsTable.$inferSelect): string {
  const address = account.email || account.smtpUser;
  const displayName = account.senderName?.trim() || address;
  return `"${displayName.replace(/"/g, '\\"')}" <${address}>`;
}

async function getTransporter(account: typeof emailAccountsTable.$inferSelect) {
  let rawPassword: string;
  try {
    rawPassword = isEncrypted(account.smtpPassword)
      ? decrypt(account.smtpPassword)
      : account.smtpPassword;
  } catch {
    throw new Error(
      `SMTP password decryption failed for account "${account.smtpUser}" — ` +
      `the server encryption key has changed since the password was saved. ` +
      `Please go to Settings → Email Accounts, edit this account, re-enter the password, and save.`,
    );
  }
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.smtpUser, pass: rawPassword },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
  });
}

async function getAccountSentToday(account: typeof emailAccountsTable.$inferSelect): Promise<number> {
  // Reset counter if last send was on a different day
  if (account.lastSentAt && !isSameDay(new Date(account.lastSentAt), new Date())) {
    await db
      .update(emailAccountsTable)
      .set({ sentToday: 0 })
      .where(eq(emailAccountsTable.id, account.id));
    return 0;
  }
  return account.sentToday;
}

async function getGlobalEmailLimit(): Promise<number> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "global_max_emails_per_day"));
  return parseInt(row?.value ?? "20", 10);
}

async function getGlobalSentToday(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(and(eq(outreachQueueTable.status, "sent"), sql`${outreachQueueTable.sentAt} >= ${today.toISOString()}`));
  return count;
}

async function getCampaignSentToday(campaignId: number): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(
      and(
        eq(outreachQueueTable.campaignId, campaignId),
        eq(outreachQueueTable.status, "sent"),
        sql`${outreachQueueTable.sentAt} >= ${today.toISOString()}`,
      ),
    );
  return result[0]?.count ?? 0;
}

async function logSend(
  campaignId: number | null,
  type: "send_success" | "send_failure" | "send_skip" | "send_test",
  message: string,
  meta?: Record<string, unknown>,
) {
  await db.insert(logsTable).values({
    campaignId,
    type,
    message,
    metadataJson: meta ? JSON.stringify(meta) : null,
  });
}

async function enrichItem(item: typeof outreachQueueTable.$inferSelect) {
  const [lead] = await db
    .select({ companyName: leadsTable.companyName })
    .from(leadsTable)
    .where(eq(leadsTable.id, item.leadId));
  let campaignName: string | null = null;
  if (item.campaignId !== null) {
    const [campaign] = await db
      .select({ name: campaignsTable.name })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, item.campaignId));
    campaignName = campaign?.name ?? null;
  }
  return {
    ...item,
    companyName: lead?.companyName ?? null,
    campaignName,
  };
}

async function getTemplateAttachments(templateId: number | null) {
  if (!templateId) return [];

  await ensureEmailTemplateAttachmentColumn();
  const [template] = await db
    .select({ attachmentsJson: emailTemplatesTable.attachmentsJson })
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.id, templateId));

  return toNodemailerAttachments(template?.attachmentsJson);
}

/**
 * Core send function. Returns true on success, false on failure.
 * Updates item status in DB and logs the result.
 */
async function doSend(
  item: typeof outreachQueueTable.$inferSelect,
  account: typeof emailAccountsTable.$inferSelect,
  campaign?: typeof campaignsTable.$inferSelect,
): Promise<boolean> {
  // Skip if recipient has unsubscribed
  if (await isEmailUnsubscribed(item.recipientEmail)) {
    await db.update(outreachQueueTable)
      .set({ status: "rejected", failureReason: "skipped:unsubscribed" })
      .where(eq(outreachQueueTable.id, item.id));
    await logSend(item.campaignId, "send_skip", `Skipped: ${item.recipientEmail} is unsubscribed`, { outreachId: item.id });
    return false;
  }

  // Append unsubscribe link to body
  const unsubscribeUrl = await buildUnsubscribeUrl(item.id, item.recipientEmail);
  const bodyWithUnsub = unsubscribeUrl
    ? appendUnsubscribeFooter(item.body, `To unsubscribe from future emails, click here: ${unsubscribeUrl}`)
    : item.body;
  const fullBody = appendUnsubscribeFooter(bodyWithUnsub, campaign?.unsubscribeFooter);

  try {
    const attachments = await getTemplateAttachments(item.emailTemplateId);
    const transporter = await getTransporter(account);
    const trackingSettings = await getTrackingSettings();
    const trackingId = trackingSettings.trackerUrl ? await ensureTrackingId(item) : null;
    const html = toHtmlEmail(fullBody);
    await transporter.sendMail({
      from: fromHeader(account),
      to: item.recipientEmail,
      subject: item.subject,
      text: toTextEmail(fullBody),
      html: trackingSettings.trackerUrl && trackingId
        ? addTrackingToHtml(html, trackingSettings.trackerUrl, trackingId)
        : html,
      attachments: attachments.length ? attachments : undefined,
      headers: unsubscribeUrl ? {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      } : undefined,
    });

    const now = new Date();
    await db
      .update(outreachQueueTable)
      .set({
        status: "sent",
        sentAt: now,
        failureReason: null,
      })
      .where(eq(outreachQueueTable.id, item.id));

    // Increment account counters
    await db
      .update(emailAccountsTable)
      .set({
        sentToday: sql`${emailAccountsTable.sentToday} + 1`,
        totalSent: sql`${emailAccountsTable.totalSent} + 1`,
        lastSentAt: now,
      })
      .where(eq(emailAccountsTable.id, account.id));

    await logSend(item.campaignId, "send_success", `Email sent to ${item.recipientEmail}`, {
      outreachId: item.id,
      leadId: item.leadId,
      accountId: account.id,
      trackingId,
      trackingEnabled: Boolean(trackingSettings.trackerUrl),
    });
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const isHardBounce = /\b5[0-9]{2}\b/.test(reason) ||
      /permanent.*(failure|error)/i.test(reason) ||
      /does not exist/i.test(reason) ||
      /no such user/i.test(reason) ||
      /user unknown/i.test(reason) ||
      /invalid.*(mailbox|address|recipient)/i.test(reason) ||
      /mailbox not found/i.test(reason);
    await db
      .update(outreachQueueTable)
      .set({
        status: isHardBounce ? "bounced" : "failed",
        failureReason: reason,
        retryCount: sql`${outreachQueueTable.retryCount} + 1`,
        bouncedAt: isHardBounce ? new Date() : undefined,
      })
      .where(eq(outreachQueueTable.id, item.id));

    await logSend(item.campaignId, "send_failure", `${isHardBounce ? "Bounced" : "Failed"} sending to ${item.recipientEmail}: ${reason}`, {
      outreachId: item.id,
      leadId: item.leadId,
      accountId: account.id,
      error: reason,
      isHardBounce,
    });
    return false;
  }
}

/** Returns true if this email has previously hard-bounced. */
export async function isEmailHardBounced(email: string): Promise<boolean> {
  const [row] = await db.select({ id: outreachQueueTable.id })
    .from(outreachQueueTable)
    .where(and(eq(outreachQueueTable.recipientEmail, email.toLowerCase()), eq(outreachQueueTable.status, "bounced")))
    .limit(1);
  return Boolean(row);
}

// ── Anti-spam guard ─────────────────────────────────────────────────────────

async function antiSpamCheck(
  item: typeof outreachQueueTable.$inferSelect,
): Promise<{ ok: boolean; reason?: string }> {
  // Must be approved
  if (item.status !== "approved") {
    return { ok: false, reason: "Item is not in approved status" };
  }

  // Check lead not rejected/invalid
  const [lead] = await db
    .select({ reviewStatus: leadsTable.reviewStatus, leadStatus: leadsTable.leadStatus })
    .from(leadsTable)
    .where(eq(leadsTable.id, item.leadId));

  if (lead?.reviewStatus === "rejected" || lead?.leadStatus === "invalid") {
    return { ok: false, reason: "Lead has been rejected or marked invalid" };
  }

  // No duplicate sends — check if same lead+campaign already sent (only when campaign is set)
  if (item.campaignId !== null) {
    const duplicate = await db
      .select({ id: outreachQueueTable.id })
      .from(outreachQueueTable)
      .where(
        and(
          eq(outreachQueueTable.leadId, item.leadId),
          eq(outreachQueueTable.campaignId, item.campaignId),
          eq(outreachQueueTable.status, "sent"),
        ),
      )
      .limit(1);
    if (duplicate.length > 0 && duplicate[0].id !== item.id) {
      return { ok: false, reason: "skipped:duplicate" };
    }
  }

  return { ok: true };
}

// ── POST /outreach/send-batch ───────────────────────────────────────────────

router.post("/outreach/send-batch", async (req, res) => {
  if (batchSendRunning) {
    res.status(409).json({ error: "A batch send is already running" });
    return;
  }

  batchSendRunning = true;
  batchSendCancelRequested = false;

  const rawIds = (req.body as { ids?: unknown } | undefined)?.ids;
  const ids = Array.isArray(rawIds)
    ? rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const approvedConditions = [eq(outreachQueueTable.status, "approved")];
  if (ids.length > 0) approvedConditions.push(inArray(outreachQueueTable.id, ids));

  const approved = await db
    .select()
    .from(outreachQueueTable)
    .where(and(...approvedConditions));

  if (approved.length === 0) {
    resetBatchSendState();
    res.json({ sent: 0, failed: 0, skipped: 0, items: [] });
    return;
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let stopped = false;
  const resultItems: (typeof outreachQueueTable.$inferSelect)[] = [];

  // Cache campaigns and accounts
  const campaignCache = new Map<number, typeof campaignsTable.$inferSelect>();
  const accountCache = new Map<number, typeof emailAccountsTable.$inferSelect>();
  const accountSentToday = new Map<number, number>();

  // Global email limit
  const globalEmailLimit = await getGlobalEmailLimit();
  let globalSentToday = await getGlobalSentToday();

  // Configurable send delay
  const [delayMinRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "send_delay_min_seconds"));
  const [delayMaxRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "send_delay_max_seconds"));
  const sendDelayMinMs = Math.max(1000, (parseInt(delayMinRow?.value ?? "30", 10) || 30) * 1000);
  const sendDelayMaxMs = Math.max(sendDelayMinMs, (parseInt(delayMaxRow?.value ?? "120", 10) || 120) * 1000);

  try {
  for (const item of approved) {
    if (batchSendCancelRequested) {
      stopped = true;
      await logSend(null, "send_skip", "Batch sending stopped by user", {
        sent,
        failed,
        skipped,
        remaining: approved.length - (sent + failed + skipped),
      });
      break;
    }

    // Global daily limit check
    if (globalSentToday >= globalEmailLimit) {
      await logSend(item.campaignId, "send_skip", `Global daily email limit reached (${globalEmailLimit})`, { outreachId: item.id });
      skipped++;
      continue;
    }

    // Anti-spam checks
    const spamCheck = await antiSpamCheck(item);
    if (!spamCheck.ok) {
      // Persist structured skip reasons so the UI can show the right status
      if (spamCheck.reason?.startsWith("skipped:")) {
        await db.update(outreachQueueTable)
          .set({ status: "rejected", failureReason: spamCheck.reason })
          .where(eq(outreachQueueTable.id, item.id));
      }
      await logSend(item.campaignId, "send_skip", `Skipped: ${spamCheck.reason}`, { outreachId: item.id });
      skipped++;
      continue;
    }

    // Load campaign (optional — outreach items can exist without a campaign)
    let campaign: typeof campaignsTable.$inferSelect | undefined;
    if (item.campaignId !== null) {
      if (!campaignCache.has(item.campaignId)) {
        const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, item.campaignId));
        if (c) campaignCache.set(item.campaignId, c);
      }
      campaign = campaignCache.get(item.campaignId);
    }

    // Load email account
    const accountId = item.emailAccountId;
    if (!accountId) {
      await logSend(item.campaignId, "send_skip", "No email account assigned", { outreachId: item.id });
      skipped++;
      continue;
    }
    if (!accountCache.has(accountId)) {
      const [a] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, accountId));
      if (a) accountCache.set(accountId, a);
    }
    const account = accountCache.get(accountId);
    if (!account || !account.isActive) {
      await logSend(item.campaignId, "send_skip", "Email account not found or inactive", { outreachId: item.id });
      skipped++;
      continue;
    }

    // Account daily limit
    if (!accountSentToday.has(accountId)) {
      accountSentToday.set(accountId, await getAccountSentToday(account));
    }
    const acctSent = accountSentToday.get(accountId) ?? 0;
    if (acctSent >= account.dailySendLimit) {
      await logSend(item.campaignId, "send_skip", `Account daily limit reached (${account.dailySendLimit})`, { outreachId: item.id });
      skipped++;
      continue;
    }

    // Randomized delay between sends (skip delay before first send)
    if (sent + failed > 0) {
      const delayResult = await randomInterruptibleDelay(sendDelayMinMs, sendDelayMaxMs);
      if (delayResult === "cancelled") {
        stopped = true;
        await logSend(null, "send_skip", "Batch sending stopped by user during send delay", {
          sent,
          failed,
          skipped,
          remaining: approved.length - (sent + failed + skipped),
        });
        break;
      }
    }

    if (batchSendCancelRequested) {
      stopped = true;
      break;
    }

    const success = await doSend(item, account, campaign);

    if (success) {
      sent++;
      globalSentToday++;
      accountSentToday.set(accountId, acctSent + 1);
      // Refresh account cache counter
      const acct = accountCache.get(accountId)!;
      accountCache.set(accountId, { ...acct, sentToday: acctSent + 1 });
    } else {
      failed++;
    }

    // Fetch updated item
    const [updated] = await db.select().from(outreachQueueTable).where(eq(outreachQueueTable.id, item.id));
    if (updated) resultItems.push(updated);
  }

  res.json({ sent, failed, skipped, stopped, items: resultItems });
  } finally {
    resetBatchSendState();
  }
});

// ── POST /outreach/send-batch/cancel ───────────────────────────────────────

router.post("/outreach/send-batch/cancel", async (_req, res) => {
  if (!batchSendRunning) {
    res.json({ ok: true, running: false, message: "No batch send is currently running." });
    return;
  }

  batchSendCancelRequested = true;
  res.json({ ok: true, running: true, message: "Batch send stop requested. The current email will finish, then sending will stop." });
});

// ── POST /outreach/send-test ────────────────────────────────────────────────

router.post("/outreach/send-test", async (req, res) => {
  const body = SendTestEmailBody.parse(req.body);

  const [account] = await db
    .select()
    .from(emailAccountsTable)
    .where(eq(emailAccountsTable.id, body.emailAccountId));

  if (!account) {
    res.status(404).json({ error: "Email account not found" });
    return;
  }

  const subject = body.subject ?? "Test email from Lead Intelligence Platform";
  const emailBody = body.body ?? "This is a test email to verify your SMTP configuration is working correctly.";

  try {
    const transporter = await getTransporter(account);
    await transporter.sendMail({
      from: fromHeader(account),
      to: body.toEmail,
      subject,
      text: toTextEmail(emailBody),
      html: toHtmlEmail(emailBody),
    });

    await logSend(null, "send_test", `Test email sent to ${body.toEmail} via ${account.smtpUser}`, {
      accountId: account.id,
      toEmail: body.toEmail,
    });

    res.json({ ok: true, message: `Test email sent successfully to ${body.toEmail}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, message: `Failed to send: ${message}` });
  }
});

// ── POST /outreach/tracking-sync ───────────────────────────────────────────

router.post("/outreach/tracking-sync", async (_req, res) => {
  try {
    const result = await syncExternalTracking();
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
});

// ── GET /outreach/tracking/open/:trackingId.gif ────────────────────────────

router.get("/outreach/tracking/open/:trackingId.gif", async (req, res) => {
  const trackingId = String(req.params.trackingId ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (trackingId) await recordOpen(trackingId);

  const pixel = Buffer.from(
    "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
    "base64",
  );
  res
    .set({
      "Content-Type": "image/gif",
      "Content-Length": String(pixel.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    })
    .send(pixel);
});

// ── GET /outreach/tracking/click/:trackingId ───────────────────────────────

router.get("/outreach/tracking/click/:trackingId", async (req, res) => {
  const trackingId = String(req.params.trackingId ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  const targetUrl = String(req.query.url ?? "");
  if (!targetUrl) {
    res.status(400).send("Missing redirect URL.");
    return;
  }

  try {
    const parsed = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      res.status(400).send("Only http and https links are allowed.");
      return;
    }
    if (trackingId) await recordClick(trackingId);
    res.redirect(302, parsed.toString());
  } catch {
    res.status(400).send("Invalid redirect URL.");
  }
});

// ── GET /outreach/send-stats ────────────────────────────────────────────────

router.get("/outreach/send-stats", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const campaigns = await db.select().from(campaignsTable);
  const accounts = await db.select().from(emailAccountsTable);

  const campaignStats = await Promise.all(
    campaigns.map(async (c) => {
      const sentToday = await getCampaignSentToday(c.id);
      return {
        campaignId: c.id,
        campaignName: c.name,
        sentToday,
        dailyLimit: await getGlobalEmailLimit(),
      };
    }),
  );

  const accountStats = await Promise.all(
    accounts.map(async (a) => {
      const sentToday = await getAccountSentToday(a);
      return {
        accountId: a.id,
        smtpUser: a.smtpUser,
        sentToday,
        dailyLimit: a.dailySendLimit,
      };
    }),
  );

  res.json({ campaigns: campaignStats, accounts: accountStats });
});

// ── POST /outreach/:id/send ─────────────────────────────────────────────────

router.post("/outreach/:id/send", async (req, res) => {
  const { id } = SendOutreachItemParams.parse({ id: Number(req.params.id) });

  const [item] = await db
    .select()
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.id, id));

  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  // Anti-spam
  const spamCheck = await antiSpamCheck(item);
  if (!spamCheck.ok) {
    res.status(400).json({ error: spamCheck.reason });
    return;
  }

  // Email account
  if (!item.emailAccountId) {
    res.status(400).json({ error: "No email account assigned to this item" });
    return;
  }

  const [account] = await db
    .select()
    .from(emailAccountsTable)
    .where(eq(emailAccountsTable.id, item.emailAccountId));

  if (!account || !account.isActive) {
    res.status(400).json({ error: "Email account is not available" });
    return;
  }

  // Account daily limit
  const acctSent = await getAccountSentToday(account);
  if (acctSent >= account.dailySendLimit) {
    res.status(429).json({ error: `Account daily limit reached (${account.dailySendLimit})` });
    return;
  }

  let campaign: typeof campaignsTable.$inferSelect | undefined;
  if (item.campaignId !== null) {
    const [c] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, item.campaignId));
    campaign = c;
  }

  // Global daily limit check for single send
  const globalLimit = await getGlobalEmailLimit();
  const globalSent = await getGlobalSentToday();
  if (globalSent >= globalLimit) {
    res.status(429).json({ error: `Global daily email limit reached (${globalLimit})` });
    return;
  }

  await doSend(item, account, campaign);

  const [updated] = await db
    .select()
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.id, id));

  res.json(await enrichItem(updated!));
});

// ── POST /outreach/:id/retry ────────────────────────────────────────────────

router.post("/outreach/:id/retry", async (req, res) => {
  const { id } = RetryOutreachItemParams.parse({ id: Number(req.params.id) });

  const [item] = await db
    .select()
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.id, id));

  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  if (item.status !== "failed" && item.status !== "bounced") {
    res.status(400).json({ error: "Only failed or bounced items can be retried" });
    return;
  }

  // Reset to approved so doSend can proceed
  await db
    .update(outreachQueueTable)
    .set({ status: "approved", failureReason: null })
    .where(eq(outreachQueueTable.id, id));

  const [resetItem] = await db
    .select()
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.id, id));

  if (!resetItem) {
    res.status(500).json({ error: "Failed to reset item" });
    return;
  }

  if (!resetItem.emailAccountId) {
    res.status(400).json({ error: "No email account assigned" });
    return;
  }

  const [account] = await db
    .select()
    .from(emailAccountsTable)
    .where(eq(emailAccountsTable.id, resetItem.emailAccountId));

  if (!account || !account.isActive) {
    res.status(400).json({ error: "Email account is not available" });
    return;
  }

  let retryCampaign: typeof campaignsTable.$inferSelect | undefined;
  if (resetItem.campaignId !== null) {
    const [c] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, resetItem.campaignId));
    retryCampaign = c;
  }

  await doSend(resetItem, account, retryCampaign);

  const [updated] = await db
    .select()
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.id, id));

  res.json(await enrichItem(updated!));
});

export default router;
