import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

type StoredTemplateAttachment = {
  filename: string;
  url?: string;
  storageKey?: string;
  contentType?: string;
  size?: number;
};

const UPLOAD_DIR = process.env.LEADFINDER_UPLOAD_DIR
  ? path.resolve(process.env.LEADFINDER_UPLOAD_DIR)
  : path.resolve(process.cwd(), "uploads", "email-template-attachments");

function isSafeStorageKey(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,220}$/.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function ensureEmailAttachmentUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  return UPLOAD_DIR;
}

export function getEmailAttachmentUploadPath(storageKey: string): string | null {
  if (!isSafeStorageKey(storageKey)) return null;
  const uploadDir = ensureEmailAttachmentUploadDir();
  const resolved = path.resolve(uploadDir, storageKey);
  return resolved.startsWith(`${uploadDir}${path.sep}`) ? resolved : null;
}

export function parseTemplateAttachments(value: string | null | undefined): StoredTemplateAttachment[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => ({
        filename: String(item?.filename ?? "").trim(),
        url: String(item?.url ?? "").trim() || undefined,
        storageKey: String(item?.storageKey ?? "").trim() || undefined,
        contentType: String(item?.contentType ?? "").trim() || undefined,
        size: Number.isFinite(Number(item?.size)) ? Number(item.size) : undefined,
      }))
      .filter((item) => item.filename && ((item.url && isHttpUrl(item.url)) || (item.storageKey && isSafeStorageKey(item.storageKey))))
      .slice(0, 10);
  } catch {
    return [];
  }
}

export function normalizeTemplateAttachmentsJson(value: string | null | undefined): string | null {
  const attachments = parseTemplateAttachments(value);
  return attachments.length ? JSON.stringify(attachments) : null;
}

export function toNodemailerAttachments(value: string | null | undefined) {
  const attachments = parseTemplateAttachments(value);
  return attachments.flatMap((attachment) => {
    const attachmentPath = attachment.storageKey ? getEmailAttachmentUploadPath(attachment.storageKey) : attachment.url;
    if (!attachmentPath) return [];
    return {
      filename: attachment.filename,
      path: attachmentPath,
      contentType: attachment.contentType,
    };
  });
}
