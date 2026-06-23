import { Router } from "express";
import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import { emailAccountsTable, campaignEmailAccountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateEmailAccountBody,
  UpdateEmailAccountBody,
  UpdateEmailAccountParams,
  DeleteEmailAccountParams,
  TestEmailAccountParams,
  AssignCampaignEmailAccountParams,
  AssignCampaignEmailAccountBody,
  UnassignCampaignEmailAccountParams,
  ListCampaignEmailAccountsParams,
} from "@workspace/api-zod";
import { encrypt, decrypt, isEncrypted } from "../lib/crypto";
import { resumeQueuedOutreachSendQueue } from "./outreach-send";
import { logger } from "../lib/logger";

const router = Router();

function stripPassword<T extends { smtpPassword: string }>(
  account: T,
): Omit<T, "smtpPassword"> {
  const { smtpPassword: _pw, ...rest } = account;
  return rest;
}

router.get("/email-accounts", async (_req, res) => {
  const accounts = await db.select().from(emailAccountsTable);
  res.json(accounts.map(stripPassword));
});

router.post("/email-accounts", async (req, res) => {
  const body = CreateEmailAccountBody.parse(req.body);
  const encryptedPassword = encrypt(body.smtpPassword);
  const [account] = await db
    .insert(emailAccountsTable)
    .values({ ...body, smtpPassword: encryptedPassword })
    .returning();
  res.status(201).json(stripPassword(account));
});

router.patch("/email-accounts/:id", async (req, res) => {
  const { id } = UpdateEmailAccountParams.parse({ id: Number(req.params.id) });
  const body = UpdateEmailAccountBody.parse(req.body);

  const updates: Record<string, unknown> = { ...body };
  if (typeof updates.smtpPassword === "string" && updates.smtpPassword) {
    updates.smtpPassword = encrypt(updates.smtpPassword as string);
  }

  const [account] = await db
    .update(emailAccountsTable)
    .set(updates)
    .where(eq(emailAccountsTable.id, id))
    .returning();
  if (!account) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if ("dailySendLimit" in body || "isActive" in body) {
    resumeQueuedOutreachSendQueue().catch((err) =>
      logger.error({ err }, "Failed to resume queued outreach after email account update"),
    );
  }
  res.json(stripPassword(account));
});

router.delete("/email-accounts/:id", async (req, res) => {
  const { id } = DeleteEmailAccountParams.parse({ id: Number(req.params.id) });
  await db.delete(emailAccountsTable).where(eq(emailAccountsTable.id, id));
  res.status(204).send();
});

router.post("/email-accounts/:id/test", async (req, res) => {
  const { id } = TestEmailAccountParams.parse({ id: Number(req.params.id) });
  const [account] = await db
    .select()
    .from(emailAccountsTable)
    .where(eq(emailAccountsTable.id, id));

  if (!account) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const rawPassword = isEncrypted(account.smtpPassword)
    ? decrypt(account.smtpPassword)
    : account.smtpPassword;

  const testedAt = new Date().toISOString();
  let success = false;
  let message = "";

  try {
    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: { user: account.smtpUser, pass: rawPassword },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
    await transporter.verify();
    success = true;
    message =
      "Connection successful — SMTP server is reachable and credentials are valid.";
  } catch (err) {
    message = `Connection failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  const testResult = success ? "success" : `failed: ${message}`;
  await db
    .update(emailAccountsTable)
    .set({ lastTestedAt: new Date(), lastTestResult: testResult })
    .where(eq(emailAccountsTable.id, id));

  res.json({ success, message, testedAt });
});

router.get("/campaigns/:id/email-accounts", async (req, res) => {
  const { id } = ListCampaignEmailAccountsParams.parse({
    id: Number(req.params.id),
  });
  const rows = await db
    .select({ account: emailAccountsTable })
    .from(campaignEmailAccountsTable)
    .innerJoin(
      emailAccountsTable,
      eq(campaignEmailAccountsTable.emailAccountId, emailAccountsTable.id),
    )
    .where(eq(campaignEmailAccountsTable.campaignId, id));

  res.json(rows.map((r) => stripPassword(r.account)));
});

router.post("/campaigns/:id/email-accounts", async (req, res) => {
  const { id } = AssignCampaignEmailAccountParams.parse({
    id: Number(req.params.id),
  });
  const body = AssignCampaignEmailAccountBody.parse(req.body);

  const existing = await db
    .select()
    .from(campaignEmailAccountsTable)
    .where(
      and(
        eq(campaignEmailAccountsTable.campaignId, id),
        eq(campaignEmailAccountsTable.emailAccountId, body.emailAccountId),
      ),
    );
  if (existing.length > 0) {
    res.status(409).json({ error: "Already assigned" });
    return;
  }

  const [row] = await db
    .insert(campaignEmailAccountsTable)
    .values({ campaignId: id, emailAccountId: body.emailAccountId })
    .returning();
  res.status(201).json(row);
});

router.delete(
  "/campaigns/:id/email-accounts/:accountId",
  async (req, res) => {
    const { id, accountId } = UnassignCampaignEmailAccountParams.parse({
      id: Number(req.params.id),
      accountId: Number(req.params.accountId),
    });
    await db
      .delete(campaignEmailAccountsTable)
      .where(
        and(
          eq(campaignEmailAccountsTable.campaignId, id),
          eq(campaignEmailAccountsTable.emailAccountId, accountId),
        ),
      );
    res.status(204).send();
  },
);

export default router;
