import * as cheerio from "cheerio";
import { db, appSettingsTable, outreachQueueTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const TRACKER_URL_KEY = "email_tracker_url";
const TRACKER_SECRET_KEY = "email_tracker_admin_secret";

export type TrackingSettings = {
  trackerUrl: string | null;
  adminSecret: string | null;
};

export async function getTrackingSettings(): Promise<TrackingSettings> {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [TRACKER_URL_KEY, TRACKER_SECRET_KEY]));

  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    trackerUrl: normalizeTrackerUrl(values.get(TRACKER_URL_KEY) || process.env.EMAIL_TRACKER_URL || ""),
    adminSecret: values.get(TRACKER_SECRET_KEY) || process.env.EMAIL_TRACKER_ADMIN_SECRET || null,
  };
}

export function createTrackingId(itemId: number): string {
  return `outreach-${itemId}`;
}

export function normalizeTrackerUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function buildTrackerUrl(baseUrl: string, type: "open" | "click", trackingId: string, targetUrl?: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("t", type);
  url.searchParams.set("id", trackingId);
  if (targetUrl) url.searchParams.set("url", targetUrl);
  return url.toString();
}

function shouldTrackHref(href: string, trackerUrl: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  if (/^(mailto|tel|sms|javascript):/i.test(trimmed)) return false;

  try {
    const hrefUrl = new URL(trimmed);
    const tracker = new URL(trackerUrl);
    return hrefUrl.href !== tracker.href && hrefUrl.origin !== tracker.origin;
  } catch {
    return false;
  }
}

function linkifyPlainText(value: string, trackerUrl: string, trackingId: string): string {
  const pattern = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?)/gi;
  return value.replace(pattern, (match: string) => {
    const trimmed = match.replace(/[),.;:!?]+$/, "");
    const trailing = match.slice(trimmed.length);
    if (!trimmed || trimmed.includes("@")) return match;

    const targetUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(targetUrl);
      if (!shouldTrackHref(parsed.toString(), trackerUrl)) return match;
      const trackedUrl = buildTrackerUrl(trackerUrl, "click", trackingId, parsed.toString());
      return `<a href="${trackedUrl}">${trimmed}</a>${trailing}`;
    } catch {
      return match;
    }
  });
}

export function addTrackingToHtml(html: string, trackerUrl: string, trackingId: string): string {
  const $ = cheerio.load(html);

  $("body, body *").contents().each((_, node) => {
    if (node.type !== "text") return;
    const parent = node.parent;
    if (parent && "name" in parent && ["a", "script", "style"].includes(String(parent.name).toLowerCase())) return;
    const value = node.data ?? "";
    if (!value.trim()) return;
    const linked = linkifyPlainText(value, trackerUrl, trackingId);
    if (linked !== value) {
      $(node).replaceWith(linked);
    }
  });

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || !shouldTrackHref(href, trackerUrl)) return;
    $(element).attr("href", buildTrackerUrl(trackerUrl, "click", trackingId, href));
  });

  const openPixel = `<img src="${buildTrackerUrl(
    trackerUrl,
    "open",
    trackingId,
  )}" width="1" height="1" alt="" style="width:1px;height:1px;opacity:0;border:0;margin:0;padding:0;" />`;

  if ($("body").length > 0) {
    $("body").append(openPixel);
  } else {
    $.root().append(openPixel);
  }

  return $.html();
}

export async function ensureTrackingId(item: typeof outreachQueueTable.$inferSelect): Promise<string> {
  if (item.trackingId) return item.trackingId;

  const trackingId = createTrackingId(item.id);
  await db
    .update(outreachQueueTable)
    .set({ trackingId })
    .where(eq(outreachQueueTable.id, item.id));
  return trackingId;
}

export async function recordOpen(trackingId: string): Promise<void> {
  const now = new Date();
  await db
    .update(outreachQueueTable)
    .set({
      openCount: sql`${outreachQueueTable.openCount} + 1`,
      firstOpenedAt: sql`coalesce(${outreachQueueTable.firstOpenedAt}, ${now.toISOString()})`,
      lastOpenedAt: now,
    })
    .where(eq(outreachQueueTable.trackingId, trackingId));
}

export async function recordClick(trackingId: string): Promise<void> {
  await db
    .update(outreachQueueTable)
    .set({
      clickCount: sql`${outreachQueueTable.clickCount} + 1`,
      lastClickedAt: new Date(),
    })
    .where(eq(outreachQueueTable.trackingId, trackingId));
}

type TrackerSummaryRow = {
  trackingId: string;
  opens: number;
  clicks: number;
  firstOpen: string | null;
  lastOpen: string | null;
  lastClick: string | null;
};

function parseTrackerTime(value: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTrackerAdminHtml(html: string): TrackerSummaryRow[] {
  const $ = cheerio.load(html);
  const rows: TrackerSummaryRow[] = [];

  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td").map((__, cell) => $(cell).text().trim()).get();
    if (cells.length < 6) return;
    const [trackingId, opens, clicks, firstOpen, lastOpen, lastClick] = cells;
    if (!trackingId) return;
    rows.push({
      trackingId,
      opens: Number.parseInt(opens || "0", 10) || 0,
      clicks: Number.parseInt(clicks || "0", 10) || 0,
      firstOpen: firstOpen || null,
      lastOpen: lastOpen || null,
      lastClick: lastClick || null,
    });
  });

  return rows;
}

export async function syncExternalTracking(): Promise<{ synced: number; events: number }> {
  const settings = await getTrackingSettings();
  if (!settings.trackerUrl) {
    throw new Error("Email tracker URL is not configured.");
  }
  if (!settings.adminSecret) {
    throw new Error("Email tracker admin secret is not configured.");
  }

  const adminUrl = new URL(settings.trackerUrl);
  adminUrl.searchParams.set("admin", settings.adminSecret);

  const response = await fetch(adminUrl);
  if (!response.ok) {
    throw new Error(`Tracker returned ${response.status}. Check the admin secret.`);
  }

  const rows = parseTrackerAdminHtml(await response.text());
  let synced = 0;
  for (const row of rows) {
    const firstOpenedAt = parseTrackerTime(row.firstOpen);
    const lastOpenedAt = parseTrackerTime(row.lastOpen);
    const lastClickedAt = parseTrackerTime(row.lastClick);

    const updated = await db
      .update(outreachQueueTable)
      .set({
        openCount: row.opens,
        clickCount: row.clicks,
        firstOpenedAt,
        lastOpenedAt,
        lastClickedAt,
      })
      .where(eq(outreachQueueTable.trackingId, row.trackingId))
      .returning({ id: outreachQueueTable.id });

    if (updated.length > 0) synced += updated.length;
  }

  return { synced, events: rows.length };
}
