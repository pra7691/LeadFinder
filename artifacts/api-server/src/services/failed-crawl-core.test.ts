import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isGenuineFailedCrawl,
  normalizeFailedCrawlPage,
  type FailedCrawlCandidate,
} from "./failed-crawl-core";

const valid: FailedCrawlCandidate = {
  crawlStatus: "failed",
  crawlError: "Connection timed out",
  rootDomain: "example-lab.org",
  websiteUrl: "https://example-lab.org/contact",
  leadType: "research",
  sourceType: "direct",
  hasCrawlLog: true,
};

describe("genuine failed crawl eligibility", () => {
  it("includes a failed target with an error and attempted-crawl log", () => {
    expect(isGenuineFailedCrawl(valid, new Set())).toBe(true);
  });

  it.each(["blog", "news", "feed", "docs", "community", "category", "tag", "archive", "search", "jobs", "careers"])(
    "excludes %s content URLs",
    (segment) => {
      expect(isGenuineFailedCrawl({ ...valid, websiteUrl: `https://example-lab.org/${segment}/item` }, new Set())).toBe(false);
    },
  );

  it.each(["directory", "media", "feed", "dataset", "stats_platform", "utility", "platform"])(
    "excludes non-target lead type %s",
    (leadType) => {
      expect(isGenuineFailedCrawl({ ...valid, leadType }, new Set())).toBe(false);
    },
  );

  it("excludes listicles and discovery-source records", () => {
    expect(isGenuineFailedCrawl({ ...valid, websiteUrl: "https://example.org/top-10-labs" }, new Set())).toBe(false);
    expect(isGenuineFailedCrawl({ ...valid, excludedSourceRecord: true }, new Set())).toBe(false);
  });

  it("excludes blocked domains and subdomains", () => {
    const blocked = new Set(["blocked.org"]);
    expect(isGenuineFailedCrawl({ ...valid, rootDomain: "blocked.org" }, blocked)).toBe(false);
    expect(isGenuineFailedCrawl({ ...valid, rootDomain: "lab.blocked.org" }, blocked)).toBe(false);
  });

  it("keeps a legitimate mined research target", () => {
    expect(isGenuineFailedCrawl({ ...valid, sourceType: "mined" }, new Set())).toBe(true);
  });

  it("excludes rows without an error or crawl log", () => {
    expect(isGenuineFailedCrawl({ ...valid, crawlError: "  " }, new Set())).toBe(false);
    expect(isGenuineFailedCrawl({ ...valid, hasCrawlLog: false }, new Set())).toBe(false);
  });

  it("excludes browser-pending, browser-running, and recovered leads", () => {
    expect(isGenuineFailedCrawl({ ...valid, crawlStatus: "browser_pending" }, new Set())).toBe(false);
    expect(isGenuineFailedCrawl({ ...valid, crawlStatus: "browser_crawling" }, new Set())).toBe(false);
    expect(isGenuineFailedCrawl({ ...valid, crawlStatus: "crawled" }, new Set())).toBe(false);
  });

  it("excludes malformed target URLs", () => {
    expect(isGenuineFailedCrawl({ ...valid, websiteUrl: "not-a-url" }, new Set())).toBe(false);
  });

  it("normalizes server-side pagination", () => {
    expect(normalizeFailedCrawlPage(undefined, undefined)).toEqual({ limit: 50, offset: 0 });
    expect(normalizeFailedCrawlPage(5000, -2)).toEqual({ limit: 200, offset: 0 });
    expect(normalizeFailedCrawlPage(25, 75)).toEqual({ limit: 25, offset: 75 });
  });

  it("uses one shared predicate for groups, details, and export", () => {
    const route = readFileSync("src/routes/leads.ts", "utf8");
    expect(route.match(/failedCrawlConditions\(/g)).toHaveLength(3);
    expect(route).toContain('router.get("/leads/failed-crawls/groups"');
    expect(route).toContain('router.get("/leads/failed-crawls"');
    expect(route).toContain('router.get("/leads/failed-crawls/export"');
  });
});
