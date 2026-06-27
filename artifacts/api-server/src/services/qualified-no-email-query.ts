import { campaignsTable, leadListItemsTable, leadsTable } from "@workspace/db";
import { eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { QUALIFIED_NO_EMAIL_SCORING_METHOD } from "./qualified-no-email-core";

export interface QualifiedNoEmailFilters {
  campaignId?: number;
  campaignRunId?: number;
  search?: string;
  hasPhone?: boolean;
  notInList?: boolean;
}

export function qualifiedNoEmailConditions(filters: QualifiedNoEmailFilters = {}): SQL[] {
  const conditions: SQL[] = [
    eq(leadsTable.crawlStatus, "crawled"),
    eq(leadsTable.qualificationStatus, "qualified"),
    eq(leadsTable.scoringMethod, QUALIFIED_NO_EMAIL_SCORING_METHOD),
    sql`${leadsTable.relevanceScore} IS NOT NULL`,
    sql`${leadsTable.relevanceScore} >= ${campaignsTable.minRelevanceScore}`,
    sql`(${leadsTable.emails} IS NULL OR btrim(${leadsTable.emails}) = '')`,
  ];

  if (filters.campaignId !== undefined) {
    conditions.push(eq(leadsTable.campaignId, filters.campaignId));
  }
  if (filters.campaignRunId !== undefined) {
    conditions.push(eq(leadsTable.campaignRunId, filters.campaignRunId));
  }
  const search = filters.search?.trim();
  if (search) {
    conditions.push(or(
      ilike(leadsTable.companyName, `%${search}%`),
      ilike(leadsTable.rootDomain, `%${search}%`),
    )!);
  }
  if (filters.hasPhone) {
    conditions.push(sql`${leadsTable.phoneNumbers} IS NOT NULL AND btrim(${leadsTable.phoneNumbers}) <> ''`);
  }
  if (filters.notInList) {
    conditions.push(sql`NOT EXISTS (
      SELECT 1 FROM ${leadListItemsTable}
      WHERE ${leadListItemsTable.leadId} = ${leadsTable.id}
    )`);
  }

  return conditions;
}
