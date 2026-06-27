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
import { eq, and, inArray, sql, asc } from "drizzle-orm";
import { decrypt, isEncrypted } from "../lib/crypto";
import {
  SendOutreachItemParams,
  RetryOutreachItemParams,
  SendTestEmailBody,
} from "@workspace/api-zod";
import { appendUnsubscribeFooter, isHtmlEmailBody, toHtmlEmail, toTextEmail } from "../services/email-html";
import { ensureEmailTemplateAttachmentColumn } from "../lib/schema-guards";
import { buildUnsubscribeUrl, isEmailUnsubscribed } from "./unsubscribe";
import { isEmailBlacklisted } from "../services/email-blacklist";
import { domainMatchesBlockedList, parseBlockedDomains } from "../services/domain-blocklist";
import { toNodemailerAttachments } from "../services/email-template-attachments";
import {
  addTrackingToHtml,
  ensureTrackingId,
  getTrackingSettings,
  recordClick,
  recordOpen,
  syncExternalTracking,
} from "../services/email-tracking";
import {
  createSingleQueueWorkerGate,
  drainManualSendQueue,
  uniqueQueueIds,
} from "./outreach-send-queue-core";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PAUSED_BY_USER_REASON = "paused_by_user";
const ACCOUNT_LIMIT_REASON = "limit:account_daily";
const GLOBAL_LIMIT_REASON = "limit:global_daily";

const activeBatches = new Set<string>();
let batchSendCancelRequested = false;
let currentBatchId: string | null = null;
const manualSendQueueWorkerGate = createSingleQueueWorkerGate();

type QueryResult<T> = { rows: T[] };

async function queryRows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as QueryResult<T>;
  return result.rows ?? [];
}

function resetBatchSendState(batchId?: string | null) {
  if (batchId) activeBatches.delete(batchId);
  batchSendCancelRequested = false;
  currentBatchId = null;
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
  const [lead] = item.leadId !== null
    ? await db.select({ companyName: leadsTable.companyName }).from(leadsTable).where(eq(leadsTable.id, item.leadId))
    : [];
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
  // Skip if recipient is on the email blacklist
  if (await isEmailBlacklisted(item.recipientEmail)) {
    await db.update(outreachQueueTable)
      .set({ status: "rejected", failureReason: "skipped:blacklisted" })
      .where(eq(outreachQueueTable.id, item.id));
    await logSend(item.campaignId, "send_skip", `Skipped: ${item.recipientEmail} is blacklisted`, { outreachId: item.id });
    return false;
  }

  // Skip if recipient has unsubscribed
  if (await isEmailUnsubscribed(item.recipientEmail)) {
    await db.update(outreachQueueTable)
      .set({ status: "rejected", failureReason: "skipped:unsubscribed" })
      .where(eq(outreachQueueTable.id, item.id));
    await logSend(item.campaignId, "send_skip", `Skipped: ${item.recipientEmail} is unsubscribed`, { outreachId: item.id });
    return false;
  }

  // Append unsubscribe link to body and headers — both controlled by the toggle
  const unsubscribeUrl = await buildUnsubscribeUrl(item.id, item.recipientEmail);
  const [unsubLinkRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "unsubscribe_link_enabled"));
  const unsubLinkEnabled = unsubLinkRow?.value !== "false";
  const unsubActive = !!(unsubscribeUrl && unsubLinkEnabled);
  const bodyWithUnsub = unsubActive
    ? appendUnsubscribeFooter(
        item.body,
        `To unsubscribe from future emails, click here: ${unsubscribeUrl}`,
        `<a href="${unsubscribeUrl}" style="color:#666;">Unsubscribe from future emails</a>`,
      )
    : item.body;
  const savedUnsubscribeFooter = item.templateSnapshot
    ? item.templateSnapshot.unsubscribeFooter
    : campaign?.unsubscribeFooter;
  const fullBody = appendUnsubscribeFooter(bodyWithUnsub, savedUnsubscribeFooter);

  try {
    const attachments = item.templateSnapshot
      ? toNodemailerAttachments(item.templateSnapshot.attachmentsJson)
      : await getTemplateAttachments(item.emailTemplateId);
    const transporter = await getTransporter(account);

    // Determine send format from the template; fall back to body-content detection
    let sendFormat: "plain_text" | "html" = item.templateSnapshot?.sendFormat ??
      (isHtmlEmailBody(fullBody) ? "html" : "plain_text");
    if (!item.templateSnapshot && item.emailTemplateId) {
      const [tmpl] = await db
        .select({ sendFormat: emailTemplatesTable.sendFormat })
        .from(emailTemplatesTable)
        .where(eq(emailTemplatesTable.id, item.emailTemplateId));
      if (tmpl?.sendFormat === "html" || tmpl?.sendFormat === "plain_text") {
        sendFormat = tmpl.sendFormat;
      }
    }

    const trackingSettings = await getTrackingSettings();
    // Tracking pixels don't render in plain-text emails — disable for plain_text mode
    const trackingActive = sendFormat === "html" && trackingSettings.trackingEnabled && !!trackingSettings.trackerUrl;
    const trackingId = trackingActive ? await ensureTrackingId(item) : null;

    if (sendFormat === "plain_text") {
      // True plain-text email: single text/plain part, no HTML wrapper
      const plainBody = toTextEmail(fullBody).replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
      await transporter.sendMail({
        from: fromHeader(account),
        to: item.recipientEmail,
        subject: item.subject,
        text: plainBody,
        attachments: attachments.length ? attachments : undefined,
        headers: unsubActive ? {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        } : undefined,
      });
    } else {
      // HTML email: multipart/alternative with text + html parts
      const html = toHtmlEmail(fullBody);
      await transporter.sendMail({
        from: fromHeader(account),
        to: item.recipientEmail,
        subject: item.subject,
        text: toTextEmail(fullBody),
        html: trackingActive && trackingId
          ? addTrackingToHtml(html, trackingSettings.trackerUrl!, trackingId)
          : html,
        attachments: attachments.length ? attachments : undefined,
        headers: unsubActive ? {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        } : undefined,
      });
    }

    const now = new Date();
    await db
      .update(outreachQueueTable)
      .set({
        status: "sent",
        sentAt: now,
        sendingStartedAt: null,
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
        sendingStartedAt: null,
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
  allowedStatuses: string[] = ["approved"],
): Promise<{ ok: boolean; reason?: string }> {
  if (!allowedStatuses.includes(item.status)) {
    return { ok: false, reason: `Item is not in ${allowedStatuses.join("/")} status` };
  }

  // Check lead not rejected/invalid
  if (item.leadId !== null) {
    const [lead] = await db
      .select({ reviewStatus: leadsTable.reviewStatus, leadStatus: leadsTable.leadStatus })
      .from(leadsTable)
      .where(eq(leadsTable.id, item.leadId));
    if (lead?.reviewStatus === "rejected" || lead?.leadStatus === "invalid") {
      return { ok: false, reason: "Lead has been rejected or marked invalid" };
    }
  }

  // Check recipient domain against blocked_domains (includes subdomain matching)
  const recipientDomain = item.recipientEmail.trim().toLowerCase().split("@")[1];
  if (recipientDomain) {
    const [domainRow] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "blocked_domains"));
    const blockedDomains = parseBlockedDomains(domainRow?.value);
    if (domainMatchesBlockedList(recipientDomain, blockedDomains)) {
      return { ok: false, reason: "skipped:blocked_domain" };
    }
  }

  // No duplicate sends — check if same recipient email already sent for this campaign.
  // A single lead can legitimately have multiple unique contact emails, so the
  // duplicate guard must be email-based rather than lead-based.
  if (item.campaignId !== null) {
    const duplicate = await db
      .select({ id: outreachQueueTable.id })
      .from(outreachQueueTable)
      .where(
        and(
          eq(outreachQueueTable.recipientEmail, item.recipientEmail),
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

type QueueSummary = {
  queued: number;
  skipped: number;
  items: (typeof outreachQueueTable.$inferSelect)[];
};

function manualQueueBatchId(item: typeof outreachQueueTable.$inferSelect): string {
  return item.batchId || `item-${item.id}`;
}

async function enqueueOutreachItems(ids: number[]): Promise<QueueSummary> {
  if (ids.length === 0) return { queued: 0, skipped: 0, items: [] };

  const uniqueIds = uniqueQueueIds(ids);
  const items: (typeof outreachQueueTable.$inferSelect)[] = [];
  let queued = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1781600995600)`);

    for (const id of uniqueIds) {
      const result = (await tx.execute(sql`
        WITH target AS (
          SELECT id
          FROM outreach_queue
          WHERE id = ${id}
            AND status IN ('approved', 'pending_review')
          FOR UPDATE
        ),
        next_position AS (
          SELECT coalesce(max(queue_position), 0) + 1 AS value
          FROM outreach_queue
        )
        UPDATE outreach_queue AS q
        SET
          status = 'queued',
          queued_at = now(),
          queue_position = (SELECT value FROM next_position),
          sending_started_at = NULL,
          failure_reason = NULL,
          updated_at = now()
        WHERE q.id IN (SELECT id FROM target)
        RETURNING q.id
      `)) as unknown as QueryResult<{ id: number }>;

      const updatedId = result.rows?.[0]?.id;
      const [updated] = updatedId
        ? await tx.select().from(outreachQueueTable).where(eq(outreachQueueTable.id, updatedId))
        : [];
      if (updated) {
        queued++;
        items.push(updated);
        continue;
      }

      const [existing] = await tx.select().from(outreachQueueTable).where(eq(outreachQueueTable.id, id));
      if (existing) {
        skipped++;
        items.push(existing);
      }
    }
  });

  startManualSendQueueWorker();
  return { queued, skipped, items };
}

async function getManualQueueStatus() {
  const rows = await queryRows<{
    queued_count: number;
    sending_count: number;
    sending_id: number | null;
    batch_id: string | null;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE status = 'queued')::int AS queued_count,
      count(*) FILTER (WHERE status = 'sending')::int AS sending_count,
      (min(id) FILTER (WHERE status = 'sending'))::int AS sending_id,
      min(batch_id) FILTER (WHERE status = 'sending') AS batch_id
    FROM outreach_queue
    WHERE status IN ('queued', 'sending')
  `);
  const row = rows[0];
  return {
    queuedCount: row?.queued_count ?? 0,
    sendingCount: row?.sending_count ?? 0,
    sendingId: row?.sending_id ?? null,
    batchId: row?.batch_id ?? null,
  };
}

async function claimNextQueuedItem(): Promise<typeof outreachQueueTable.$inferSelect | null> {
  try {
    const rows = await queryRows<{ id: number }>(sql`
      WITH next AS (
        SELECT q.id
        FROM outreach_queue AS q
        WHERE q.status = 'queued'
          AND (q.failure_reason IS NULL OR q.failure_reason != ${PAUSED_BY_USER_REASON})
          AND NOT EXISTS (
            SELECT 1
            FROM outreach_queue AS active
            WHERE active.status = 'sending'
          )
        ORDER BY q.queue_position ASC NULLS LAST, q.queued_at ASC NULLS LAST, q.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outreach_queue AS q
      SET
        status = 'sending',
        sending_started_at = now(),
        failure_reason = NULL,
        updated_at = now()
      WHERE q.id IN (SELECT id FROM next)
      RETURNING q.id
    `);
    const id = rows[0]?.id;
    if (!id) return null;
    const [item] = await db.select().from(outreachQueueTable).where(eq(outreachQueueTable.id, id));
    return item ?? null;
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      return null;
    }
    throw err;
  }
}

async function returnSendingItemToQueue(id: number, reason: string) {
  await db
    .update(outreachQueueTable)
    .set({
      status: "queued",
      failureReason: reason,
      sendingStartedAt: null,
    })
    .where(eq(outreachQueueTable.id, id));
}

async function failQueuedItem(id: number, reason: string, campaignId: number | null) {
  await db
    .update(outreachQueueTable)
    .set({
      status: "failed",
      failureReason: reason,
      retryCount: sql`${outreachQueueTable.retryCount} + 1`,
      sendingStartedAt: null,
    })
    .where(eq(outreachQueueTable.id, id));
  await logSend(campaignId, "send_failure", `Failed queued send: ${reason}`, { outreachId: id });
}

async function processClaimedQueuedItem(item: typeof outreachQueueTable.$inferSelect): Promise<"continue" | "stop"> {
  if (batchSendCancelRequested) {
    await returnSendingItemToQueue(item.id, PAUSED_BY_USER_REASON);
    return "stop";
  }

  const spamCheck = await antiSpamCheck(item, ["sending"]);
  if (!spamCheck.ok) {
    if (spamCheck.reason?.startsWith("skipped:")) {
      await db
        .update(outreachQueueTable)
        .set({ status: "rejected", failureReason: spamCheck.reason, sendingStartedAt: null })
        .where(eq(outreachQueueTable.id, item.id));
    } else {
      await failQueuedItem(item.id, spamCheck.reason ?? "Send safety check failed", item.campaignId);
    }
    await logSend(item.campaignId, "send_skip", `Skipped queued send: ${spamCheck.reason}`, { outreachId: item.id });
    return "continue";
  }

  if (!item.emailAccountId) {
    await failQueuedItem(item.id, "No email account assigned", item.campaignId);
    return "continue";
  }

  const [account] = await db
    .select()
    .from(emailAccountsTable)
    .where(eq(emailAccountsTable.id, item.emailAccountId));
  if (!account || !account.isActive) {
    await failQueuedItem(item.id, "Email account not found or inactive", item.campaignId);
    return "continue";
  }

  const globalEmailLimit = await getGlobalEmailLimit();
  const globalSentToday = await getGlobalSentToday();
  if (globalSentToday >= globalEmailLimit) {
    await returnSendingItemToQueue(item.id, GLOBAL_LIMIT_REASON);
    await logSend(item.campaignId, "send_skip", `Global daily email limit reached (${globalEmailLimit})`, {
      outreachId: item.id,
      queued: true,
    });
    return "stop";
  }

  const acctSent = await getAccountSentToday(account);
  if (acctSent >= account.dailySendLimit) {
    await returnSendingItemToQueue(item.id, ACCOUNT_LIMIT_REASON);
    await logSend(item.campaignId, "send_skip", `Account daily limit reached (${account.dailySendLimit})`, {
      outreachId: item.id,
      queued: true,
    });
    return "stop";
  }

  let campaign: typeof campaignsTable.$inferSelect | undefined;
  if (item.campaignId !== null) {
    const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, item.campaignId));
    campaign = c;
  }

  await doSend(item, account, campaign);
  return "continue";
}

function startManualSendQueueWorker(): boolean {
  return manualSendQueueWorkerGate.start(async () => {
    batchSendCancelRequested = false;
    let processed = 0;
    let stopped = false;
    try {
      const result = await drainManualSendQueue({
        shouldStop: () => batchSendCancelRequested,
        claim: claimNextQueuedItem,
        process: async (item) => {
          const batchId = manualQueueBatchId(item);
          currentBatchId = batchId;
          activeBatches.add(batchId);
          try {
            const result = await processClaimedQueuedItem(item);
            if (result === "stop") return "stop";

            const status = await getManualQueueStatus();
            if (status.queuedCount > 0 && !batchSendCancelRequested) {
              const delayResult = await randomInterruptibleDelay();
              if (delayResult === "cancelled") return "stop";
            }
            return "continue";
          } finally {
            activeBatches.delete(batchId);
            if (currentBatchId === batchId) currentBatchId = null;
          }
        },
      });
      processed = result.processed;
      stopped = result.stopped;
    } catch (err) {
      const { logger } = await import("../lib/logger");
      logger.error({ err }, "Manual outreach send queue worker failed");
    } finally {
      const status = await getManualQueueStatus().catch(() => ({ queuedCount: 0 }));
      if (!stopped && !batchSendCancelRequested && status.queuedCount > 0 && processed > 0) {
        startManualSendQueueWorker();
      }
    }
  });
}

// ── POST /outreach/send-batch ───────────────────────────────────────────────

router.post("/outreach/send-batch", async (req, res) => {
  const rawIds = (req.body as { ids?: unknown } | undefined)?.ids;
  const ids = Array.isArray(rawIds)
    ? rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  let queueIds = ids;
  if (queueIds.length === 0) {
    const approved = await db
      .select({ id: outreachQueueTable.id })
      .from(outreachQueueTable)
      .where(and(
        eq(outreachQueueTable.status, "approved"),
        sql`(${outreachQueueTable.failureReason} IS NULL OR ${outreachQueueTable.failureReason} != ${PAUSED_BY_USER_REASON})`,
      ))
      .orderBy(asc(outreachQueueTable.id));
    queueIds = approved.map((item) => item.id);
  }

  const result = await enqueueOutreachItems(queueIds);
  res.json({
    sent: 0,
    failed: 0,
    skipped: result.skipped,
    queued: result.queued,
    items: result.items,
    message: result.queued > 0 ? "Added to send queue." : "No eligible outreach items were queued.",
  });
});

// ── GET /outreach/send-batch/status ────────────────────────────────────────

router.get("/outreach/send-batch/status", async (_req, res) => {
  const status = await getManualQueueStatus();
  res.json({
    running: activeBatches.size > 0 || status.sendingCount > 0 || manualSendQueueWorkerGate.isRunning(),
    batchId: currentBatchId ?? status.batchId,
    queuedCount: status.queuedCount,
    sendingCount: status.sendingCount,
    sendingId: status.sendingId,
  });
});

// ── POST /outreach/send-batch/cancel ───────────────────────────────────────

router.post("/outreach/send-batch/cancel", async (req, res) => {
  // Mark any not-yet-processed approved items as paused so the cron auto-resume
  // won't immediately restart them. Optional batchId scopes to one batch;
  // omitting it pauses all active batches.
  const batchId = (req.body as { batchId?: unknown })?.batchId;
  const pauseConditions = [
    inArray(outreachQueueTable.status, ["approved", "queued"]),
    // Don't overwrite a real failureReason; only set on rows where it's empty
    sql`(${outreachQueueTable.failureReason} IS NULL OR ${outreachQueueTable.failureReason} = '' OR ${outreachQueueTable.failureReason} IN (${ACCOUNT_LIMIT_REASON}, ${GLOBAL_LIMIT_REASON}))`,
  ];
  if (typeof batchId === "string" && batchId.length > 0) {
    pauseConditions.push(eq(outreachQueueTable.batchId, batchId));
  }
  const pausedRows = await db
    .update(outreachQueueTable)
    .set({ failureReason: PAUSED_BY_USER_REASON })
    .where(and(...pauseConditions))
    .returning({ id: outreachQueueTable.id });

  if (activeBatches.size === 0 && !manualSendQueueWorkerGate.isRunning()) {
    res.json({
      ok: true,
      running: false,
      paused: pausedRows.length,
      message: pausedRows.length > 0
        ? `Marked ${pausedRows.length} item(s) as paused.`
        : "No batch send is currently running.",
    });
    return;
  }

  batchSendCancelRequested = true;
  res.json({
    ok: true,
    running: true,
    paused: pausedRows.length,
    message: "Batch send stop requested. The current email will finish, then sending will stop.",
  });
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

  const result = await enqueueOutreachItems([id]);
  const item = result.items[0];
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  res.json({
    ...(await enrichItem(item)),
    queued: result.queued,
    skipped: result.skipped,
    message: result.queued > 0 ? "Added to send queue." : "Already queued or not eligible to queue.",
  });
});

// ── POST /outreach/resend-batch ─────────────────────────────────────────────
// Resets all failed/pending_review items in a batch back to approved so
// the caller can immediately trigger send-batch to re-send them.

router.post("/outreach/resend-batch", async (req, res) => {
  const batchId = (req.body as { batchId?: unknown })?.batchId;
  if (!batchId || typeof batchId !== "string") {
    res.status(400).json({ error: "batchId is required" });
    return;
  }

  const resendable = await db
    .select({ id: outreachQueueTable.id })
    .from(outreachQueueTable)
    .where(and(
      eq(outreachQueueTable.batchId, batchId),
      inArray(outreachQueueTable.status, ["failed", "pending_review", "approved"]),
    ));

  if (resendable.length === 0) {
    res.json({ reset: 0, ids: [] });
    return;
  }

  const ids = resendable.map((r) => r.id);

  await db
    .update(outreachQueueTable)
    .set({ status: "approved", failureReason: null })
    .where(inArray(outreachQueueTable.id, ids));

  res.json({ reset: ids.length, ids });
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

  // Reset to approved so the manual send queue can claim it.
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

  const result = await enqueueOutreachItems([resetItem.id]);
  res.json({
    ...(await enrichItem(result.items[0] ?? resetItem)),
    queued: result.queued,
    skipped: result.skipped,
    message: result.queued > 0 ? "Added to send queue." : "Already queued or not eligible to queue.",
  });
});

// ── Exported helper: resume any stuck approved items on server startup ───────

/**
 * Auto-resumes any outreach items sitting in "approved" status.
 *
 * Called:
 *   • Once at server startup by recoverStuckState()
 *   • Every minute by the scheduler tick — so items blocked by the daily email
 *     limit automatically resume after IST midnight when the counter resets,
 *     without any user action.
 *
 * Early-exits if a batch is already running, so periodic calls are cheap.
 */
export async function resumeStuckOutreach(): Promise<void> {
  if (activeBatches.size > 0) return; // already running, nothing to do

  // Auto-resume only "stranded" items: approved AND not user-paused
  // AND belonging to a batch that has at least one already-sent sibling.
  // This prevents NEWLY APPROVED batches (no sent siblings yet) from
  // auto-starting without the user clicking Send.
  const stuckItems = await db
    .select({ id: outreachQueueTable.id })
    .from(outreachQueueTable)
    .where(and(
      eq(outreachQueueTable.status, "approved"),
      sql`(${outreachQueueTable.failureReason} IS NULL OR ${outreachQueueTable.failureReason} != ${PAUSED_BY_USER_REASON})`,
      sql`EXISTS (
        SELECT 1 FROM outreach_queue AS sib
        WHERE sib.batch_id = ${outreachQueueTable.batchId}
          AND sib.status = 'sent'
      )`,
    ))
    .orderBy(asc(outreachQueueTable.id));

  if (stuckItems.length === 0) return;

  // Fire-and-forget: don't await — the server must finish starting first.
  // Delay slightly so routes are fully registered before the first send attempt.
  setTimeout(() => {
    if (activeBatches.size > 0) return; // race guard

    const ids = stuckItems.map((r) => r.id);
    let resumeBatchId: string | null = null;

    db.select()
      .from(outreachQueueTable)
      .where(and(
        eq(outreachQueueTable.status, "approved"),
        sql`(${outreachQueueTable.failureReason} IS NULL OR ${outreachQueueTable.failureReason} != ${PAUSED_BY_USER_REASON})`,
        inArray(outreachQueueTable.id, ids),
      ))
      .orderBy(asc(outreachQueueTable.id))
      .then(async (approved) => {
        resumeBatchId = approved[0]?.batchId ?? null;
        if (approved.length === 0) { return; }
        if (resumeBatchId && activeBatches.has(resumeBatchId)) return; // race guard
        if (resumeBatchId) activeBatches.add(resumeBatchId);
        currentBatchId = resumeBatchId;
        batchSendCancelRequested = false;

        const campaignCache = new Map<number, typeof campaignsTable.$inferSelect>();
        const accountCache  = new Map<number, typeof emailAccountsTable.$inferSelect>();
        const accountSentToday = new Map<number, number>();
        const globalEmailLimit = await getGlobalEmailLimit();
        let globalSentToday = await getGlobalSentToday();

        const [delayMinRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "send_delay_min_seconds"));
        const [delayMaxRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "send_delay_max_seconds"));
        const sendDelayMinMs = Math.max(1000, (parseInt(delayMinRow?.value ?? "30", 10) || 30) * 1000);
        const sendDelayMaxMs = Math.max(sendDelayMinMs, (parseInt(delayMaxRow?.value ?? "120", 10) || 120) * 1000);

        for (const item of approved) {
          if (batchSendCancelRequested) break;
          if (globalSentToday >= globalEmailLimit) {
            await db
              .update(outreachQueueTable)
              .set({ failureReason: GLOBAL_LIMIT_REASON })
              .where(eq(outreachQueueTable.id, item.id));
            break;
          }

          const spamCheck = await antiSpamCheck(item);
          if (!spamCheck.ok) {
            if (spamCheck.reason?.startsWith("skipped:")) {
              await db.update(outreachQueueTable)
                .set({ status: "rejected", failureReason: spamCheck.reason })
                .where(eq(outreachQueueTable.id, item.id));
            }
            continue;
          }

          let campaign: typeof campaignsTable.$inferSelect | undefined;
          if (item.campaignId !== null) {
            if (!campaignCache.has(item.campaignId)) {
              const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, item.campaignId));
              if (c) campaignCache.set(item.campaignId, c);
            }
            campaign = campaignCache.get(item.campaignId);
          }

          const accountId = item.emailAccountId;
          if (!accountId) continue;
          if (!accountCache.has(accountId)) {
            const [a] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, accountId));
            if (a) accountCache.set(accountId, a);
          }
          const account = accountCache.get(accountId);
          if (!account || !account.isActive) continue;

          if (!accountSentToday.has(accountId)) accountSentToday.set(accountId, await getAccountSentToday(account));
          const acctSent = accountSentToday.get(accountId) ?? 0;
          if (acctSent >= account.dailySendLimit) {
            await db
              .update(outreachQueueTable)
              .set({ failureReason: ACCOUNT_LIMIT_REASON })
              .where(eq(outreachQueueTable.id, item.id));
            continue;
          }

          if (globalSentToday > 0) await randomInterruptibleDelay(sendDelayMinMs, sendDelayMaxMs);
          if (batchSendCancelRequested) break;

          const success = await doSend(item, account, campaign);
          if (success) { globalSentToday++; accountSentToday.set(accountId, acctSent + 1); }
        }
      })
      .catch((err) => {
        const { logger } = require("../lib/logger") as typeof import("../lib/logger");
        logger.error({ err }, "Auto-resume of stuck outreach failed");
      })
      .finally(() => resetBatchSendState(resumeBatchId));
  }, 5000); // 5s after startup

  const { logger } = await import("../lib/logger");
  logger.warn(
    { count: stuckItems.length },
    `Startup: found ${stuckItems.length} approved outreach item(s) stuck from previous run — auto-resuming in 5s`,
  );
}

export async function recoverManualOutreachSendQueueOnStartup(): Promise<{
  returnedToQueued: number;
  confirmedSent: number;
  confirmedBounced: number;
  queuedCount: number;
  workerStarted: boolean;
}> {
  const now = new Date();

  const returnedToQueuedRows = await db
    .update(outreachQueueTable)
    .set({
      status: "queued",
      sendingStartedAt: null,
      failureReason: null,
      updatedAt: now,
    })
    .where(and(
      eq(outreachQueueTable.status, "sending"),
      sql`${outreachQueueTable.sentAt} IS NULL`,
      sql`${outreachQueueTable.bouncedAt} IS NULL`,
    ))
    .returning({ id: outreachQueueTable.id });

  const confirmedSentRows = await db
    .update(outreachQueueTable)
    .set({
      status: "sent",
      sendingStartedAt: null,
      failureReason: null,
      updatedAt: now,
    })
    .where(and(
      eq(outreachQueueTable.status, "sending"),
      sql`${outreachQueueTable.sentAt} IS NOT NULL`,
    ))
    .returning({ id: outreachQueueTable.id });

  const confirmedBouncedRows = await db
    .update(outreachQueueTable)
    .set({
      status: "bounced",
      sendingStartedAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(outreachQueueTable.status, "sending"),
      sql`${outreachQueueTable.bouncedAt} IS NOT NULL`,
    ))
    .returning({ id: outreachQueueTable.id });

  const status = await getManualQueueStatus();
  const workerStarted = status.queuedCount > 0 ? startManualSendQueueWorker() : false;

  const { logger } = await import("../lib/logger");
  logger.warn(
    {
      returnedToQueued: returnedToQueuedRows.length,
      confirmedSent: confirmedSentRows.length,
      confirmedBounced: confirmedBouncedRows.length,
      queuedCount: status.queuedCount,
      workerStarted,
    },
    "Startup recovery: checked manual outreach send queue",
  );

  return {
    returnedToQueued: returnedToQueuedRows.length,
    confirmedSent: confirmedSentRows.length,
    confirmedBounced: confirmedBouncedRows.length,
    queuedCount: status.queuedCount,
    workerStarted,
  };
}

export async function resumeQueuedOutreachSendQueue(): Promise<{
  queuedCount: number;
  sendingCount: number;
  workerStarted: boolean;
}> {
  const status = await getManualQueueStatus();
  const workerStarted = status.queuedCount > 0 && status.sendingCount === 0
    ? startManualSendQueueWorker()
    : false;
  return {
    queuedCount: status.queuedCount,
    sendingCount: status.sendingCount,
    workerStarted,
  };
}

export default router;
