import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import {
  ensureEmailAttachmentUploadDir,
  getEmailAttachmentUploadPath,
} from "../services/email-template-attachments";

const router = Router();

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function safeFilename(filename: string): string {
  const parsed = path.parse(filename);
  const name = parsed.name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "attachment";
  const ext = parsed.ext.replace(/[^\w.]/g, "").slice(0, 20);
  return `${name}${ext}`;
}

function decodeFileData(data: string): Buffer {
  const base64 = data.includes(",") ? data.split(",").pop() ?? "" : data;
  return Buffer.from(base64, "base64");
}

router.post("/email-template-attachments", async (req, res) => {
  const body = req.body as { filename?: unknown; contentType?: unknown; data?: unknown };
  const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 180) : "";
  const contentType = typeof body.contentType === "string" ? body.contentType.trim().slice(0, 120) : undefined;
  const data = typeof body.data === "string" ? body.data : "";

  if (!filename || !data) {
    res.status(400).json({ error: "Attachment filename and file data are required" });
    return;
  }

  const buffer = decodeFileData(data);

  if (buffer.byteLength === 0) {
    res.status(400).json({ error: "Attachment file is empty" });
    return;
  }

  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    res.status(413).json({ error: "Attachment is too large. Maximum size is 10 MB." });
    return;
  }

  const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeFilename(filename)}`;
  const uploadDir = ensureEmailAttachmentUploadDir();
  const target = path.join(uploadDir, storedName);
  await fs.writeFile(target, buffer);

  res.status(201).json({
    filename,
    url: `/api/email-template-attachments/files/${storedName}`,
    storageKey: storedName,
    contentType: contentType || "application/octet-stream",
    size: buffer.byteLength,
  });
});

router.get("/email-template-attachments/files/:storageKey", (req, res) => {
  const filePath = getEmailAttachmentUploadPath(req.params.storageKey);
  if (!filePath) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ error: "Attachment not found" });
    }
  });
});

export default router;
