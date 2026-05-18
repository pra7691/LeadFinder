/**
 * Admin utilities — single-operator internal tools.
 *
 * POST /api/admin/reclassify-leads
 *   Scans existing leads for listicle / directory pages that were incorrectly
 *   saved as company leads (pre-classification-logic era) and marks them rejected.
 *   Optionally mines those pages for real company links.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { eq, isNull, or } from "drizzle-orm";
import { classifyLeadType, isBadCompanyName, domainToCompanyName } from "../services/lead-classifier";

const router = Router();

const DIRECTORY_DOMAINS = new Set([
  "clutch.co", "goodfirms.co", "designrush.com", "themanifest.com",
  "businessofapps.com", "buildfire.com", "g2.com", "capterra.com",
  "softwareworld.co", "appdevelopmentcompanies.co", "topdevelopers.co",
  "selectedfirms.co", "techreviewer.co", "appfutura.com",
  "guru.com", "sortlist.com", "upcity.com", "expertise.com",
  "itfirms.co", "agencyspotter.com", "semrush.com", "similarweb.com",
  "trustpilot.com", "yelp.com", "bark.com", "thumbtack.com",
]);

const LISTICLE_TITLE_PATTERNS = [
  /\btop\s+\d+\b/i, /\bbest\b.*\bcompan/i, /\bbest\b.*\bagenc/i,
  /\blist\s+of\b/i, /\branking/i, /\bdirector(y|ies)\b/i,
  /\bcompanies\s+in\b/i, /\bagencies\s+in\b/i,
  /\bin\s+20\d{2}\b/i, /\b\d+\s+(?:top|best)\b/i,
];

const LISTICLE_URL_PATTERNS = [
  /\/top[-_\d]/i, /\/best[-_]/i, /\/\d+-(?:top|best)/i,
  /\/list\b/i, /\/rankings?\b/i, /\/compare\b/i, /\/alternatives\b/i,
];

function looksLikeListicle(lead: { rootDomain: string; websiteUrl: string; companyName: string }): boolean {
  const domain = lead.rootDomain.toLowerCase();
  if (DIRECTORY_DOMAINS.has(domain)) return true;

  for (const pat of LISTICLE_TITLE_PATTERNS) {
    if (pat.test(lead.companyName)) return true;
  }

  try {
    const { pathname } = new URL(lead.websiteUrl);
    for (const pat of LISTICLE_URL_PATTERNS) {
      if (pat.test(pathname)) return true;
    }
  } catch {
    // ignore
  }

  return false;
}

router.post("/admin/reclassify-leads", async (req, res) => {
  const dryRun = req.query.dryRun === "true";

  // Load all unqualified leads that haven't been crawled yet
  const candidates = await db
    .select({
      id: leadsTable.id,
      rootDomain: leadsTable.rootDomain,
      websiteUrl: leadsTable.websiteUrl,
      companyName: leadsTable.companyName,
      qualificationStatus: leadsTable.qualificationStatus,
      sourceType: leadsTable.sourceType,
    })
    .from(leadsTable)
    .where(
      or(
        eq(leadsTable.sourceType, "direct"),
        isNull(leadsTable.sourceType),
      ),
    );

  const flagged: typeof candidates = [];
  for (const lead of candidates) {
    if (looksLikeListicle(lead)) {
      flagged.push(lead);
    }
  }

  if (!dryRun && flagged.length > 0) {
    for (const lead of flagged) {
      await db
        .update(leadsTable)
        .set({
          qualificationStatus: "rejected",
          notes: "Auto-rejected: detected as a listicle/directory page, not a company.",
        })
        .where(eq(leadsTable.id, lead.id));
    }
  }

  res.json({
    scanned: candidates.length,
    flagged: flagged.length,
    dryRun,
    examples: flagged.slice(0, 10).map((l) => ({
      id: l.id,
      companyName: l.companyName,
      rootDomain: l.rootDomain,
      websiteUrl: l.websiteUrl,
    })),
    message: dryRun
      ? `Dry run: would reject ${flagged.length} listicle/directory leads.`
      : `Rejected ${flagged.length} listicle/directory leads and marked them with a note.`,
  });
  return;
});

/**
 * POST /admin/cleanup
 * Detects and optionally fixes data quality issues:
 * - Fields erroneously set to "20" (notes, country, emails, phones)
 * - Bad company names (logo/header/phone artifacts)
 * - Non-company lead types (directories, media, events, etc.)
 *
 * Default: dryRun=true (safe preview). Set ?dryRun=false to commit changes.
 */
router.post("/admin/cleanup", async (req, res) => {
  const dryRun = req.query.dryRun !== "false";

  const allLeads = await db
    .select({
      id: leadsTable.id,
      rootDomain: leadsTable.rootDomain,
      companyName: leadsTable.companyName,
      notes: leadsTable.notes,
      country: leadsTable.country,
      emails: leadsTable.emails,
      phoneNumbers: leadsTable.phoneNumbers,
      leadType: leadsTable.leadType,
    })
    .from(leadsTable);

  const badNotes: typeof allLeads = [];
  const badCountry: typeof allLeads = [];
  const badEmails: typeof allLeads = [];
  const badPhones: typeof allLeads = [];
  const badNames: typeof allLeads = [];
  const nonCompany: typeof allLeads = [];

  for (const lead of allLeads) {
    if (lead.notes === "20") badNotes.push(lead);
    if (lead.country === "20") badCountry.push(lead);
    if (lead.emails === "20") badEmails.push(lead);
    if (lead.phoneNumbers === "20") badPhones.push(lead);
    if (isBadCompanyName(lead.companyName)) badNames.push(lead);
    const lt = classifyLeadType(lead.rootDomain, lead.companyName);
    if (lt !== "company" && (!lead.leadType || lead.leadType === "company")) {
      nonCompany.push(lead);
    }
  }

  if (!dryRun) {
    for (const lead of badNotes) {
      await db.update(leadsTable).set({ notes: null }).where(eq(leadsTable.id, lead.id));
    }
    for (const lead of badCountry) {
      await db.update(leadsTable).set({ country: null }).where(eq(leadsTable.id, lead.id));
    }
    for (const lead of badEmails) {
      await db.update(leadsTable).set({ emails: null }).where(eq(leadsTable.id, lead.id));
    }
    for (const lead of badPhones) {
      await db.update(leadsTable).set({ phoneNumbers: null }).where(eq(leadsTable.id, lead.id));
    }
    for (const lead of badNames) {
      await db.update(leadsTable)
        .set({ companyName: domainToCompanyName(lead.rootDomain) })
        .where(eq(leadsTable.id, lead.id));
    }
    for (const lead of nonCompany) {
      const lt = classifyLeadType(lead.rootDomain, lead.companyName);
      await db.update(leadsTable)
        .set({
          leadType: lt,
          qualificationStatus: "rejected",
          notes: `Auto-classified as ${lt} — not eligible for outreach.`,
        })
        .where(eq(leadsTable.id, lead.id));
    }
  }

  const total = badNotes.length + badCountry.length + badEmails.length +
    badPhones.length + badNames.length + nonCompany.length;

  res.json({
    dryRun,
    summary: {
      badNotes: badNotes.length,
      badCountry: badCountry.length,
      badEmails: badEmails.length,
      badPhones: badPhones.length,
      badCompanyNames: badNames.length,
      nonCompanyLeads: nonCompany.length,
      totalIssues: total,
      scanned: allLeads.length,
    },
    examples: {
      badNotes: badNotes.slice(0, 5).map((l) => ({ id: l.id, domain: l.rootDomain })),
      badCompanyNames: badNames.slice(0, 10).map((l) => ({ id: l.id, domain: l.rootDomain, name: l.companyName })),
      nonCompanyLeads: nonCompany.slice(0, 10).map((l) => ({
        id: l.id,
        domain: l.rootDomain,
        detectedType: classifyLeadType(l.rootDomain, l.companyName),
      })),
    },
    message: dryRun
      ? `Dry run: found ${total} issue(s) across ${allLeads.length} leads. Set ?dryRun=false to apply fixes.`
      : `Fixed ${total} issue(s) across ${allLeads.length} leads.`,
  });
  return;
});

export default router;
