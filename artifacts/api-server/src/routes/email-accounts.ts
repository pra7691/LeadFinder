import { Router } from "express";
import { db } from "@workspace/db";
import { emailAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateEmailAccountBody,
  UpdateEmailAccountBody,
  UpdateEmailAccountParams,
  DeleteEmailAccountParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/email-accounts", async (_req, res) => {
  const accounts = await db.select().from(emailAccountsTable);
  res.json(
    accounts.map(({ smtpPassword: _pw, ...rest }) => rest),
  );
});

router.post("/email-accounts", async (req, res) => {
  const body = CreateEmailAccountBody.parse(req.body);
  const [account] = await db
    .insert(emailAccountsTable)
    .values(body)
    .returning();
  const { smtpPassword: _pw, ...rest } = account;
  res.status(201).json(rest);
});

router.patch("/email-accounts/:id", async (req, res) => {
  const { id } = UpdateEmailAccountParams.parse({ id: Number(req.params.id) });
  const body = UpdateEmailAccountBody.parse(req.body);
  const [account] = await db
    .update(emailAccountsTable)
    .set(body)
    .where(eq(emailAccountsTable.id, id))
    .returning();
  if (!account) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { smtpPassword: _pw, ...rest } = account;
  res.json(rest);
});

router.delete("/email-accounts/:id", async (req, res) => {
  const { id } = DeleteEmailAccountParams.parse({ id: Number(req.params.id) });
  await db.delete(emailAccountsTable).where(eq(emailAccountsTable.id, id));
  res.status(204).send();
});

export default router;
