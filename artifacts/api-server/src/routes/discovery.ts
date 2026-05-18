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
  searchQueryHistoryTable,
  searchResultHistoryTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { searchSerper, extractRootDomain } from "../services/serper";
import { classifyLeadType } from "../services/lead-classifier";

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

  // ── Work unit tracking setup ──────────────────────────────────────────────
  const totalWorkUnits = Math.min(keywords.length * countries.length, campaign.maxSearchesPerDay);
  const discoveryStartedAt = Date.now();

  try {
    await db.update(campaignRunsTable).set({ totalWorkUnits }).where(eq(campaignRunsTable.id, campaignRun.id));
  } catch { /* non-fatal */ }

  // Historical avg seconds-per-unit for better time estimation
  let avgSecsPerUnit: number | null = null;
  try {
    const historicalRuns = await db
      .select({ durationSeconds: campaignRunsTable.durationSeconds, totalWorkUnits: campaignRunsTable.totalWorkUnits })
      .from(campaignRunsTable)
      .where(and(eq(campaignRunsTable.campaignId, campaignId), eq(campaignRunsTable.status, "completed")))
      .orderBy(desc(campaignRunsTable.startedAt))
      .limit(5);
    const valid = historicalRuns.filter((r) => (r.durationSeconds ?? 0) > 0 && (r.totalWorkUnits ?? 0) > 0);
    if (valid.length > 0) {
      const avgDur = valid.reduce((s, r) => s + r.durationSeconds!, 0) / valid.length;
      const avgUnits = valid.reduce((s, r) => s + (r.totalWorkUnits ?? 0), 0) / valid.length;
      avgSecsPerUnit = avgDur / avgUnits;
    }
  } catch { /* non-fatal */ }

  const summary = {
    campaignId,
    runId: campaignRun.id,
    searchesPerformed: 0,
    searchesSkipped: 0,
    resultsFound: 0,
    resultUrlsSeenBefore: 0,
    blockedSkipped: 0,
    duplicatesSkipped: 0,
    newLeadsCreated: 0,
    queries: [] as string[],
  };

  const maxSearches = campaign.maxSearchesPerDay;
  let searchCount = 0;
  const now = new Date();
  const queryRefreshMs = (campaign.queryRefreshDays ?? 30) * 24 * 60 * 60 * 1000;

  // Build query pairs: keyword × country
  outer: for (const kw of keywords) {
    for (const co of countries) {
      if (searchCount >= maxSearches) break outer;

      const query = `${kw.keyword} ${co.country}`;
      summary.queries.push(query);

      // ── Query history skip check ──────────────────────────────────────────
      const [qhRecord] = await db
        .select({ id: searchQueryHistoryTable.id, nextRefreshAt: searchQueryHistoryTable.nextRefreshAt })
        .from(searchQueryHistoryTable)
        .where(and(
          eq(searchQueryHistoryTable.campaignId, campaignId),
          eq(searchQueryHistoryTable.query, query),
        ))
        .limit(1);

      if (qhRecord?.nextRefreshAt && qhRecord.nextRefreshAt > now) {
        summary.searchesSkipped++;
        await db.insert(logsTable).values({
          campaignId,
          type: "search",
          message: `Query skipped (recently searched): "${query}"`,
          metadataJson: JSON.stringify({ query, nextRefreshAt: qhRecord.nextRefreshAt.toISOString(), reason: "skipped_recent" }),
        });
        {
          const _cu = summary.searchesPerformed + summary.searchesSkipped;
          const _ru = Math.max(0, totalWorkUnits - _cu);
          const _el = Date.now() - discoveryStartedAt;
          const _pp = totalWorkUnits > 0 ? Math.min(100, _cu / totalWorkUnits * 100) : 0;
          let _ers: number | null = null;
          let _eca: Date | null = null;
          if (avgSecsPerUnit != null && _ru > 0) { _ers = Math.round(avgSecsPerUnit * _ru); }
          else if (_cu >= 2 && _ru > 0) { _ers = Math.round(_el / _cu / 1000 * _ru); }
          if (_ers != null) _eca = new Date(Date.now() + _ers * 1000);
          try {
            await db.update(campaignRunsTable).set({
              totalSearchesSkipped: sql`coalesce(${campaignRunsTable.totalSearchesSkipped}, 0) + 1`,
              completedWorkUnits: _cu, progressPercent: _pp,
              estimatedRemainingSeconds: _ers, estimatedCompletionAt: _eca,
            }).where(eq(campaignRunsTable.id, campaignRun.id));
          } catch { /* non-fatal */ }
        }
        continue;
      }

      await db.insert(logsTable).values({
        campaignId,
        type: "search",
        message: `Searching: "${query}"`,
        metadataJson: JSON.stringify({ query }),
      });

      let results;
      try {
        results = await searchSerper(query, apiKey, campaign.resultsPerSearch ?? 10);
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
        // Record failed query so it is not retried immediately
        try {
          await db.insert(searchQueryHistoryTable).values({
            campaignId,
            campaignRunId: campaignRun.id,
            query,
            keyword: kw.keyword,
            country: co.country,
            searchedAt: now,
            resultCount: 0,
            status: "failed",
            errorMessage: msg.slice(0, 500),
            nextRefreshAt: null,
          }).onConflictDoUpdate({
            target: [searchQueryHistoryTable.campaignId, searchQueryHistoryTable.query],
            set: {
              campaignRunId: campaignRun.id,
              searchedAt: now,
              resultCount: 0,
              status: "failed",
              errorMessage: msg.slice(0, 500),
              nextRefreshAt: null,
              updatedAt: now,
            },
          });
        } catch { /* non-fatal */ }
        continue;
      }

      // ── Upsert query history ──────────────────────────────────────────────
      const nextQueryRefreshAt = new Date(now.getTime() + queryRefreshMs);
      let queryHistoryId: number | null = null;
      try {
        const [qhRow] = await db
          .insert(searchQueryHistoryTable)
          .values({
            campaignId,
            campaignRunId: campaignRun.id,
            query,
            keyword: kw.keyword,
            country: co.country,
            searchedAt: now,
            resultCount: results.length,
            status: "completed",
            nextRefreshAt: nextQueryRefreshAt,
          })
          .onConflictDoUpdate({
            target: [searchQueryHistoryTable.campaignId, searchQueryHistoryTable.query],
            set: {
              campaignRunId: campaignRun.id,
              searchedAt: now,
              resultCount: results.length,
              status: "completed",
              nextRefreshAt: nextQueryRefreshAt,
              updatedAt: now,
            },
          })
          .returning({ id: searchQueryHistoryTable.id });
        queryHistoryId = qhRow?.id ?? null;
      } catch { /* non-fatal */ }

      let qNewLeads = 0;
      let qDups = 0;
      let qBlocked = 0;

      for (const result of results) {
        const rootDomain = extractRootDomain(result.link);
        if (!rootDomain) continue;

        const isDuplicate = existingDomains.has(rootDomain);
        const isBlocked = blockedDomains.has(rootDomain);
        const resultType = isBlocked ? "blocked" : isDuplicate ? "duplicate" : "direct";

        // ── Track result URL in history ───────────────────────────────────
        try {
          const [srhRow] = await db
            .insert(searchResultHistoryTable)
            .values({
              campaignId,
              campaignRunId: campaignRun.id,
              searchQueryHistoryId: queryHistoryId,
              query,
              resultUrl: result.link,
              rootDomain,
              resultTitle: result.title,
              resultSnippet: result.snippet,
              resultPosition: result.position,
              resultType,
              firstSeenAt: now,
              lastSeenAt: now,
              timesSeen: 1,
            })
            .onConflictDoUpdate({
              target: [searchResultHistoryTable.campaignId, searchResultHistoryTable.resultUrl],
              set: {
                resultType,
                lastSeenAt: now,
                timesSeen: sql`${searchResultHistoryTable.timesSeen} + 1`,
                updatedAt: now,
              },
            })
            .returning({ timesSeen: searchResultHistoryTable.timesSeen });
          if (srhRow && srhRow.timesSeen > 1) summary.resultUrlsSeenBefore++;
        } catch { /* non-fatal */ }

        if (isBlocked) {
          qBlocked++;
          summary.blockedSkipped++;
          await db.insert(logsTable).values({
            campaignId,
            type: "filter",
            message: `Blocked domain skipped: ${rootDomain}`,
            metadataJson: JSON.stringify({ domain: rootDomain, reason: "blocked" }),
          });
          continue;
        }

        if (isDuplicate) {
          qDups++;
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
            leadType: classifyLeadType(rootDomain, result.title),
          });

          existingDomains.add(rootDomain);
          summary.newLeadsCreated++;
          qNewLeads++;

          await db.insert(logsTable).values({
            campaignId,
            type: "lead",
            message: `New lead created: ${rootDomain} (from "${query}")`,
            metadataJson: JSON.stringify({ domain: rootDomain, query, runId: campaignRun.id }),
          });
        } catch {
          // Unique constraint violation = race condition dupe; skip silently
          summary.duplicatesSkipped++;
          qDups++;
        }
      }

      // ── Update query history with per-query lead/dup/blocked counts ───────
      if (queryHistoryId != null) {
        try {
          await db
            .update(searchQueryHistoryTable)
            .set({ newLeadsCount: qNewLeads, duplicateCount: qDups, blockedCount: qBlocked })
            .where(eq(searchQueryHistoryTable.id, queryHistoryId));
        } catch { /* non-fatal */ }
      }

      // ── Incrementally update campaign_run live counters + progress ──────────
      {
        const _cu = summary.searchesPerformed + summary.searchesSkipped;
        const _ru = Math.max(0, totalWorkUnits - _cu);
        const _el = Date.now() - discoveryStartedAt;
        const _pp = totalWorkUnits > 0 ? Math.min(100, _cu / totalWorkUnits * 100) : 0;
        let _ers: number | null = null;
        let _eca: Date | null = null;
        if (avgSecsPerUnit != null && _ru > 0) { _ers = Math.round(avgSecsPerUnit * _ru); }
        else if (_cu >= 2 && _ru > 0) { _ers = Math.round(_el / _cu / 1000 * _ru); }
        if (_ers != null) _eca = new Date(Date.now() + _ers * 1000);
        try {
          await db.update(campaignRunsTable).set({
            totalNewLeads: sql`coalesce(${campaignRunsTable.totalNewLeads}, 0) + ${qNewLeads}`,
            totalSearches: sql`coalesce(${campaignRunsTable.totalSearches}, 0) + 1`,
            totalBlocked: sql`coalesce(${campaignRunsTable.totalBlocked}, 0) + ${qBlocked}`,
            totalDuplicates: sql`coalesce(${campaignRunsTable.totalDuplicates}, 0) + ${qDups}`,
            completedWorkUnits: _cu, progressPercent: _pp,
            estimatedRemainingSeconds: _ers, estimatedCompletionAt: _eca,
          }).where(eq(campaignRunsTable.id, campaignRun.id));
        } catch { /* non-fatal */ }
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
      totalSearchesSkipped: summary.searchesSkipped,
      totalResults: summary.resultsFound,
      totalResultsSeenBefore: summary.resultUrlsSeenBefore,
      totalNewLeads: summary.newLeadsCreated,
      totalDuplicates: summary.duplicatesSkipped,
      totalBlocked: summary.blockedSkipped,
      metadataJson: JSON.stringify(summary),
      durationSeconds: Math.round((Date.now() - discoveryStartedAt) / 1000),
      progressPercent: 100,
      completedWorkUnits: summary.searchesPerformed + summary.searchesSkipped,
      estimatedRemainingSeconds: 0,
      estimatedCompletionAt: null,
    })
    .where(eq(campaignRunsTable.id, campaignRun.id));

  // Log completion
  await db.insert(logsTable).values({
    campaignId,
    type: "discovery",
    message: `Discovery run completed: ${summary.searchesPerformed} searched, ${summary.searchesSkipped} skipped, ${summary.newLeadsCreated} new leads, ${summary.blockedSkipped} blocked, ${summary.duplicatesSkipped} duplicates`,
    metadataJson: JSON.stringify(summary),
  });

  res.json(summary);
});

export default router;
