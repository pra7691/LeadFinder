import { Router } from "express";
import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import {
  outreachQueueTable,
  emailAccountsTable,
  campaignsTable,
  leadsTable,
  logsTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { decrypt, isEncrypted } from "../lib/crypto";
import {
  SendOutreachItemParams,
  RetryOutreachItemParams,
  SendTestEmailBody,
} from "@workspace/api-zod";
import { appendUnsubscribeFooter, toHtmlEmail, toTextEmail } from "../services/email-html";

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
  const rawPassword = isEncrypted(account.smtpPassword)
    ? decrypt(account.smtpPassword)
    : account.smtpPassword;
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

/**
 * Core send function. Returns true on success, false on failure.
 * Updates item status in DB and logs the result.
 */
async function doSend(
  item: typeof outreachQueueTable.$inferSelect,
  account: typeof emailAccountsTable.$inferSelect,
  campaign?: typeof campaignsTable.$inferSelect,
): Promise<boolean> {
  const fullBody = appendUnsubscribeFooter(item.body, campaign?.unsubscribeFooter);

  try {
    const transporter = await getTransporter(account);
    await transporter.sendMail({
      from: fromHeader(account),
      to: item.recipientEmail,
      subject: item.subject,
      text: toTextEmail(fullBody),
      html: toHtmlEmail(fullBody),
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
    });
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(outreachQueueTable)
      .set({
        status: "failed",
        failureReason: reason,
        retryCount: sql`${outreachQueueTable.retryCount} + 1`,
      })
      .where(eq(outreachQueueTable.id, item.id));

    await logSend(item.campaignId, "send_failure", `Failed to send to ${item.recipientEmail}: ${reason}`, {
      outreachId: item.id,
      leadId: item.leadId,
      accountId: account.id,
      error: reason,
    });
    return false;
  }
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
      return { ok: false, reason: "Email already sent to this lead for this campaign" };
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

  const approved = await db
    .select()
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.status, "approved"));

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
  const campaignSentToday = new Map<number, number>();
  const accountSentToday = new Map<number, number>();

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

    // Anti-spam checks
    const spamCheck = await antiSpamCheck(item);
    if (!spamCheck.ok) {
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

      // Campaign daily limit (only when campaign exists)
      if (campaign) {
        if (!campaignSentToday.has(item.campaignId)) {
          campaignSentToday.set(item.campaignId, await getCampaignSentToday(item.campaignId));
        }
        const campSent = campaignSentToday.get(item.campaignId) ?? 0;
        if (campSent >= campaign.maxEmailsPerDay) {
          await logSend(item.campaignId, "send_skip", `Campaign daily limit reached (${campaign.maxEmailsPerDay})`, { outreachId: item.id });
          skipped++;
          continue;
        }
      }
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
      const delayResult = await randomInterruptibleDelay(2000, 8000);
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
      if (item.campaignId !== null) {
        const campSent = campaignSentToday.get(item.campaignId) ?? 0;
        campaignSentToday.set(item.campaignId, campSent + 1);
      }
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
        dailyLimit: c.maxEmailsPerDay,
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
    if (campaign) {
      const campSent = await getCampaignSentToday(item.campaignId);
      if (campSent >= campaign.maxEmailsPerDay) {
        res.status(429).json({ error: `Campaign daily limit reached (${campaign.maxEmailsPerDay})` });
        return;
      }
    }
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
