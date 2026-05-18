import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignKeywordsTable,
  campaignCountriesTable,
  campaignRunsTable,
  leadsTable,
  appSettingsTable,
  logsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { searchSerper, extractRootDomain } from "../services/serper";

const router = Router();

router.post("/campaigns/:id/run-discovery", async (req, res) => {
  const campaignId = Number(req.params.id);
  if (isNaN(campaignId)) {
    res.status(400).json({ error: "Invalid campaign ID" });
    return;
  }

  const apiKey = process.env["SERPER_API_KEY"];
  if (!apiKey) {
    res.status(400).json({ error: "SERPER_API_KEY is not configured" });
    return;
  }

  // Load campaign
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (!campaign.isActive) {
    res.status(400).json({ error: "Campaign is not active" });
    return;
  }

  // Load keywords + countries
  const keywords = await db
    .select()
    .from(campaignKeywordsTable)
    .where(eq(campaignKeywordsTable.campaignId, campaignId));

  const countries = await db
    .select()
    .from(campaignCountriesTable)
    .where(eq(campaignCountriesTable.campaignId, campaignId));

  // Load blocked domains
  const [blockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));

  const blockedDomains = new Set(
    (blockedSetting?.value ?? "")
      .split(/[\n,]/)
      .map((d) => d.trim().toLowerCase().replace(/^www\./, ""))
      .filter(Boolean),
  );

  // Load existing campaign domains for dedup
  const existingLeads = await db
    .select({ rootDomain: leadsTable.rootDomain })
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, campaignId));

  const existingDomains = new Set(existingLeads.map((l) => l.rootDomain));

  // ── Create a campaign_run record ──────────────────────────────
  const [campaignRun] = await db
    .insert(campaignRunsTable)
    .values({
      campaignId,
      runName: `Discovery – ${new Date().toISOString().slice(0, 10)}`,
      runType: (req.body as { runType?: string })?.runType === "scheduled"
        ? "scheduled"
        : "manual",
      status: "running",
    })
    .returning();

  // Log start
  await db.insert(logsTable).values({
    campaignId,
    type: "discovery",
    message: `Discovery run started for campaign "${campaign.name}" (${keywords.length} keywords × ${countries.length} countries)`,
    metadataJson: JSON.stringify({ keywords: keywords.length, countries: countries.length, runId: campaignRun.id }),
  });

  const summary = {
    campaignId,
    runId: campaignRun.id,
    searchesPerformed: 0,
    resultsFound: 0,
    blockedSkipped: 0,
    duplicatesSkipped: 0,
    newLeadsCreated: 0,
    queries: [] as string[],
  };

  const maxSearches = campaign.maxSearchesPerDay;
  let searchCount = 0;

  // Build query pairs: keyword × country
  outer: for (const kw of keywords) {
    for (const co of countries) {
      if (searchCount >= maxSearches) break outer;

      const query = `${kw.keyword} ${co.country}`;
      summary.queries.push(query);

      await db.insert(logsTable).values({
        campaignId,
        type: "search",
        message: `Searching: "${query}"`,
        metadataJson: JSON.stringify({ query }),
      });

      let results;
      try {
        results = await searchSerper(query, apiKey);
        searchCount++;
        summary.searchesPerformed++;
        summary.resultsFound += results.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.insert(logsTable).values({
          campaignId,
          type: "error",
          message: `Serper API error for query "${query}": ${msg}`,
          metadataJson: JSON.stringify({ query, error: msg }),
        });
        continue;
      }

      for (const result of results) {
        const rootDomain = extractRootDomain(result.link);
        if (!rootDomain) continue;

        if (blockedDomains.has(rootDomain)) {
          summary.blockedSkipped++;
          await db.insert(logsTable).values({
            campaignId,
            type: "filter",
            message: `Blocked domain skipped: ${rootDomain}`,
            metadataJson: JSON.stringify({ domain: rootDomain, reason: "blocked" }),
          });
          continue;
        }

        if (existingDomains.has(rootDomain)) {
          summary.duplicatesSkipped++;
          await db.insert(logsTable).values({
            campaignId,
            type: "filter",
            message: `Duplicate domain skipped: ${rootDomain}`,
            metadataJson: JSON.stringify({ domain: rootDomain, reason: "duplicate" }),
          });
          continue;
        }

        // Create lead — linked to this campaign run
        try {
          await db.insert(leadsTable).values({
            campaignId,
            campaignRunId: campaignRun.id,
            companyName: result.title.split(/[-|–]/, 1)[0].trim() || rootDomain,
            rootDomain,
            websiteUrl: result.link,
            leadStatus: "discovered",
            reviewStatus: "pending",
            emailStatus: "not_sent",
            relevanceScore: 0,
            relevanceReason: "",
            sourceKeyword: kw.keyword,
            sourceCountry: co.country,
            sourceQuery: query,
          });

          existingDomains.add(rootDomain);
          summary.newLeadsCreated++;

          await db.insert(logsTable).values({
            campaignId,
            type: "lead",
            message: `New lead created: ${rootDomain} (from "${query}")`,
            metadataJson: JSON.stringify({ domain: rootDomain, query, runId: campaignRun.id }),
          });
        } catch {
          // Unique constraint violation = race condition dupe; skip silently
          summary.duplicatesSkipped++;
        }
      }

      // Small delay between searches to respect rate limits
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // ── Update campaign_run with final stats ──────────────────────
  await db
    .update(campaignRunsTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      totalSearches: summary.searchesPerformed,
      totalResults: summary.resultsFound,
      totalNewLeads: summary.newLeadsCreated,
      totalDuplicates: summary.duplicatesSkipped,
      totalBlocked: summary.blockedSkipped,
      metadataJson: JSON.stringify(summary),
    })
    .where(eq(campaignRunsTable.id, campaignRun.id));

  // Log completion
  await db.insert(logsTable).values({
    campaignId,
    type: "discovery",
    message: `Discovery run completed: ${summary.searchesPerformed} searches, ${summary.newLeadsCreated} new leads, ${summary.blockedSkipped} blocked, ${summary.duplicatesSkipped} duplicates`,
    metadataJson: JSON.stringify(summary),
  });

  res.json(summary);
});

export default router;
