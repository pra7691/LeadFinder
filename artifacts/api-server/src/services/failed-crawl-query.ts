import { leadCrawlAttemptsTable, leadsTable } from "@workspace/db";
import { and, eq, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import {
  FAILED_CRAWL_EXCLUDED_LEAD_TYPES,
  FAILED_CRAWL_NON_TARGET_PATH_PATTERN,
  FAILED_CRAWL_NON_TARGET_SUBDOMAIN_PATTERN,
} from "./failed-crawl-core";
import { SKIP_CRAWL_PATH_SQL_PATTERN } from "./crawler";

export interface FailedCrawlFilters {
  campaignId?: number;
  campaignRunId?: number;
}

function blockedDomainExclusions(blockedDomains: Set<string>): SQL[] {
  return Array.from(blockedDomains).map((blocked) => {
    const normalizedRootDomain = sql<string>`lower(regexp_replace(${leadsTable.rootDomain}, '^www\\.', ''))`;
    if (blocked.includes(".")) {
      return sql`${normalizedRootDomain} <> ${blocked} and ${normalizedRootDomain} not like ${`%.${blocked}`}`;
    }
    return sql`split_part(${normalizedRootDomain}, '.', 1) <> ${blocked}`;
  });
}

export function failedCrawlConditions(
  filters: FailedCrawlFilters,
  blockedDomains: Set<string>,
): SQL[] {
  const urlPath = sql<string>`lower(regexp_replace(${leadsTable.websiteUrl}, '^[a-z][a-z0-9+.-]*://[^/]+', ''))`;
  const conditions: SQL[] = [
    eq(leadsTable.crawlStatus, "failed"),
    sql`nullif(btrim(${leadsTable.crawlError}), '') is not null`,
    sql`(
      not exists (
        select 1 from ${leadCrawlAttemptsTable} attempt
        where attempt.lead_id = ${leadsTable.id}
      )
      or exists (
        select 1 from ${leadCrawlAttemptsTable} attempt
        where attempt.lead_id = ${leadsTable.id}
          and attempt.http_status = 'failed'
          and attempt.browser_status in ('not_needed', 'failed')
          and attempt.final_status = 'failed'
      )
    )`,
    sql`exists (
      select 1 from logs crawl_log
      where crawl_log.campaign_id = ${leadsTable.campaignId}
        and lower(crawl_log.message) like '%crawl%'
        and nullif(crawl_log.metadata_json, '') is not null
        and (crawl_log.metadata_json::jsonb ->> 'leadId') ~ '^[0-9]+$'
        and (crawl_log.metadata_json::jsonb ->> 'leadId')::int = ${leadsTable.id}
    )`,
    or(
      isNull(leadsTable.leadType),
      notInArray(leadsTable.leadType, Array.from(FAILED_CRAWL_EXCLUDED_LEAD_TYPES)),
    )!,
    sql`${leadsTable.websiteUrl} ~* '^https?://[^/[:space:]]+'`,
    sql`lower(regexp_replace(${leadsTable.rootDomain}, '^www\\.', '')) !~ ${FAILED_CRAWL_NON_TARGET_SUBDOMAIN_PATTERN}`,
    sql`${urlPath} !~ ${SKIP_CRAWL_PATH_SQL_PATTERN}`,
    sql`${urlPath} !~ ${FAILED_CRAWL_NON_TARGET_PATH_PATTERN}`,
    sql`not exists (
      select 1 from search_result_history source_history
      where source_history.campaign_id = ${leadsTable.campaignId}
        and lower(source_history.result_url) = lower(${leadsTable.websiteUrl})
        and source_history.result_type in ('blocked', 'discovery_source')
    )`,
    sql`not exists (
      select 1 from campaign_run_results run_result
      where run_result.campaign_run_id = ${leadsTable.campaignRunId}
        and lower(coalesce(run_result.url, '')) = lower(${leadsTable.websiteUrl})
        and run_result.result_status in ('blocked', 'duplicate', 'rejected', 'skipped_recent')
    )`,
    ...blockedDomainExclusions(blockedDomains),
  ];

  if (filters.campaignRunId !== undefined) {
    conditions.push(eq(leadsTable.campaignRunId, filters.campaignRunId));
  } else if (filters.campaignId !== undefined) {
    conditions.push(eq(leadsTable.campaignId, filters.campaignId));
  }
  return conditions;
}
