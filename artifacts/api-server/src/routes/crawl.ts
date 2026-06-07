import { Router } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  logsTable,
  campaignsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { crawlWebsite } from "../services/crawler";

const router = Router();

// ── Single lead crawl ──────────────────────────────────────────────────────

router.post("/leads/:id/run-crawl", async (req, res) => {
  const leadId = Number(req.params.id);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, leadId));

  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  // Mark as in-progress (reuse crawl_status = "pending" means not yet started,
  // so we immediately flip to crawled/failed when done)

  await db.insert(logsTable).values({
    campaignId: lead.campaignId,
    type: "crawl",
    message: `Crawl started for ${lead.rootDomain}`,
    metadataJson: JSON.stringify({ leadId, url: lead.websiteUrl }),
  });

  // Load campaign so we can pass its crawler configuration through
  const [campaign] = lead.campaignId != null
    ? await db.select().from(campaignsTable).where(eq(campaignsTable.id, lead.campaignId))
    : [undefined];

  try {
    const data = await crawlWebsite(lead.websiteUrl, lead.rootDomain, campaign ? {
      crawlPaths: campaign.crawlPaths,
      internalLinkKeywords: campaign.internalLinkKeywords,
      maxPagesPerDomain: campaign.maxPagesPerDomain,
      maxCrawlDepth: campaign.maxCrawlDepth,
    } : undefined);

    if (data.pagesSucceeded === 0) {
      await db
        .update(leadsTable)
        .set({ crawlStatus: "failed", crawlError: "All pages returned no content" })
        .where(eq(leadsTable.id, leadId));

      await db.insert(logsTable).values({
        campaignId: lead.campaignId,
        type: "crawl",
        message: `Crawl failed for ${lead.rootDomain}: no pages loaded`,
        metadataJson: JSON.stringify({ leadId }),
      });

      res.json({
        leadId,
        success: false,
        pagesAttempted: data.pagesAttempted,
        pagesSucceeded: 0,
        error: "All pages returned no content",
      });
      return;
    }

    // Build update — only overwrite fields that were actually found
    const updates: Record<string, unknown> = {
      crawlStatus: "crawled",
      crawlError: null,
      rawText: data.rawText,
    };
    if (data.companyName) updates.companyName = data.companyName;
    if (data.emails) updates.emails = data.emails;
    if (data.emailDomainStatus) updates.emailDomainStatus = data.emailDomainStatus;
    if (data.phoneNumbers) updates.phoneNumbers = data.phoneNumbers;
    if (data.address) updates.address = data.address;
    if (data.country) updates.country = data.country;
    if (data.linkedinUrl) updates.linkedinUrl = data.linkedinUrl;

    await db
      .update(leadsTable)
      .set(updates)
      .where(eq(leadsTable.id, leadId));

    await db.insert(logsTable).values({
      campaignId: lead.campaignId,
      type: "crawl",
      message: `Crawl completed for ${lead.rootDomain}: ${data.pagesSucceeded}/${data.pagesAttempted} pages, ${data.emails ? data.emails.split(",").length : 0} emails`,
      metadataJson: JSON.stringify({
        leadId,
        pagesAttempted: data.pagesAttempted,
        pagesSucceeded: data.pagesSucceeded,
        emailsFound: data.emails?.split(",").length ?? 0,
        phonesFound: data.phoneNumbers?.split(",").length ?? 0,
      }),
    });

    res.json({
      leadId,
      success: true,
      companyName: data.companyName,
      emails: data.emails,
      phoneNumbers: data.phoneNumbers,
      address: data.address,
      country: data.country,
      linkedinUrl: data.linkedinUrl,
      pagesAttempted: data.pagesAttempted,
      pagesSucceeded: data.pagesSucceeded,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .update(leadsTable)
      .set({ crawlStatus: "failed", crawlError: message.slice(0, 500) })
      .where(eq(leadsTable.id, leadId));

    await db.insert(logsTable).values({
      campaignId: lead.campaignId,
      type: "crawl",
      message: `Crawl error for ${lead.rootDomain}: ${message.slice(0, 200)}`,
      metadataJson: JSON.stringify({ leadId, error: message }),
    });

    res.json({
      leadId,
      success: false,
      pagesAttempted: 0,
      pagesSucceeded: 0,
      error: message,
    });
  }
});

// ── Bulk crawl ─────────────────────────────────────────────────────────────

router.post("/leads/bulk-crawl", async (req, res) => {
  const { leadIds, campaignId } = req.body as {
    leadIds?: number[];
    campaignId?: number;
  };

  let targetLeads;

  if (Array.isArray(leadIds) && leadIds.length > 0) {
    targetLeads = await db
      .select()
      .from(leadsTable)
      .where(inArray(leadsTable.id, leadIds));
  } else if (typeof campaignId === "number") {
    targetLeads = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.campaignId, campaignId));
  } else {
    res.status(400).json({ error: "Provide leadIds array or campaignId" });
    return;
  }

  if (targetLeads.length === 0) {
    res.json({ attempted: 0, succeeded: 0, failed: 0, results: [] });
    return;
  }

  const CAP = 20;
  const toProcess = targetLeads.slice(0, CAP);

  // Pre-load campaign configs for all unique campaign IDs in this batch
  const uniqueCampaignIds = Array.from(
    new Set(toProcess.map((l) => l.campaignId).filter((id): id is number => id != null)),
  );
  const campaignList = uniqueCampaignIds.length > 0
    ? await db.select().from(campaignsTable).where(inArray(campaignsTable.id, uniqueCampaignIds))
    : [];
  const campaignById = new Map(campaignList.map((c) => [c.id, c] as const));

  const results: Array<{
    leadId: number;
    success: boolean;
    pagesSucceeded: number;
    error: string | null;
  }> = [];

  let succeeded = 0;
  let failed = 0;

  for (const lead of toProcess) {
    await db.insert(logsTable).values({
      campaignId: lead.campaignId,
      type: "crawl",
      message: `Bulk crawl: starting ${lead.rootDomain}`,
      metadataJson: JSON.stringify({ leadId: lead.id }),
    });

    try {
      const campaign = lead.campaignId != null ? campaignById.get(lead.campaignId) : undefined;
      const data = await crawlWebsite(lead.websiteUrl, lead.rootDomain, campaign ? {
        crawlPaths: campaign.crawlPaths,
        internalLinkKeywords: campaign.internalLinkKeywords,
        maxPagesPerDomain: campaign.maxPagesPerDomain,
        maxCrawlDepth: campaign.maxCrawlDepth,
      } : undefined);
      const ok = data.pagesSucceeded > 0;

      const updates: Record<string, unknown> = {
        crawlStatus: ok ? "crawled" : "failed",
        crawlError: ok ? null : "No pages returned content",
        rawText: data.rawText || null,
      };
      if (ok) {
        if (data.companyName) updates.companyName = data.companyName;
        if (data.emails) updates.emails = data.emails;
        if (data.emailDomainStatus) updates.emailDomainStatus = data.emailDomainStatus;
        if (data.phoneNumbers) updates.phoneNumbers = data.phoneNumbers;
        if (data.address) updates.address = data.address;
        if (data.country) updates.country = data.country;
        if (data.linkedinUrl) updates.linkedinUrl = data.linkedinUrl;
      }

      await db.update(leadsTable).set(updates).where(eq(leadsTable.id, lead.id));

      await db.insert(logsTable).values({
        campaignId: lead.campaignId,
        type: "crawl",
        message: `Bulk crawl ${ok ? "completed" : "failed"}: ${lead.rootDomain} (${data.pagesSucceeded}/${data.pagesAttempted} pages)`,
        metadataJson: JSON.stringify({
          leadId: lead.id,
          pagesAttempted: data.pagesAttempted,
          pagesSucceeded: data.pagesSucceeded,
        }),
      });

      ok ? succeeded++ : failed++;
      results.push({
        leadId: lead.id,
        success: ok,
        pagesSucceeded: data.pagesSucceeded,
        error: ok ? null : "No pages returned content",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(leadsTable)
        .set({ crawlStatus: "failed", crawlError: message.slice(0, 500) })
        .where(eq(leadsTable.id, lead.id));

      await db.insert(logsTable).values({
        campaignId: lead.campaignId,
        type: "crawl",
        message: `Bulk crawl error: ${lead.rootDomain}: ${message.slice(0, 150)}`,
        metadataJson: JSON.stringify({ leadId: lead.id, error: message }),
      });

      failed++;
      results.push({ leadId: lead.id, success: false, pagesSucceeded: 0, error: message });
    }
  }

  res.json({
    attempted: toProcess.length,
    succeeded,
    failed,
    capped: targetLeads.length > CAP ? targetLeads.length : null,
    results,
  });
});

export default router;
