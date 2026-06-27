export type CrawlFailureCategory =
  | "invalid_url"
  | "dns_not_found"
  | "connection_refused"
  | "domain_unavailable"
  | "not_found"
  | "gone"
  | "unsupported_file"
  | "blocked_domain"
  | "skipped_source"
  | "duplicate"
  | "cancelled"
  | "http_access"
  | "timeout"
  | "javascript_shell"
  | "empty_content"
  | "navigation_error"
  | "unknown";

export interface CrawlFailure {
  category: CrawlFailureCategory;
  message: string;
  statusCode?: number;
}

const RETRYABLE_BROWSER_FAILURES = new Set<CrawlFailureCategory>([
  "http_access",
  "timeout",
  "javascript_shell",
  "empty_content",
  "navigation_error",
]);

const UNSUPPORTED_FILE_PATTERN = /\.(?:pdf|zip|rar|7z|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|webp|mp[34]|avi|mov)(?:[?#].*)?$/i;

export function classifyHttpStatus(statusCode: number): CrawlFailure {
  if (statusCode === 404) return { category: "not_found", message: "HTTP 404 Not Found", statusCode };
  if (statusCode === 410) return { category: "gone", message: "HTTP 410 Gone", statusCode };
  if (statusCode === 408 || statusCode === 504) {
    return { category: "timeout", message: `HTTP ${statusCode} timeout`, statusCode };
  }
  if (statusCode === 403 || statusCode === 405 || statusCode === 406 || statusCode === 429) {
    return { category: "http_access", message: `HTTP ${statusCode} may require browser rendering`, statusCode };
  }
  return { category: "domain_unavailable", message: `HTTP ${statusCode}`, statusCode };
}

export function classifyNetworkFailure(error: unknown): CrawlFailure {
  const err = error as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = err?.code ?? err?.cause?.code ?? "";
  const message = err?.message ?? err?.cause?.message ?? String(error);
  if (err?.name === "AbortError" || /timed?\s*out|timeout|aborted/i.test(message)) {
    return { category: "timeout", message };
  }
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code) || /getaddrinfo|host not found|dns/i.test(message)) {
    return { category: "dns_not_found", message };
  }
  if (code === "ECONNREFUSED" || /connection refused/i.test(message)) {
    return { category: "connection_refused", message };
  }
  if (/invalid url|failed to parse url|malformed/i.test(message)) {
    return { category: "invalid_url", message };
  }
  return { category: "navigation_error", message };
}

export function classifyUrlBeforeCrawl(url: string): CrawlFailure | null {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      return { category: "invalid_url", message: "Only HTTP(S) website URLs are supported" };
    }
    if (UNSUPPORTED_FILE_PATTERN.test(parsed.pathname)) {
      return { category: "unsupported_file", message: "Unsupported file URL" };
    }
    return null;
  } catch {
    return { category: "invalid_url", message: "Invalid website URL" };
  }
}

export function shouldQueueBrowserRetry(input: {
  failure: CrawlFailure;
  blocked?: boolean;
  duplicate?: boolean;
  skippedSource?: boolean;
  cancelled?: boolean;
}): boolean {
  if (input.blocked || input.duplicate || input.skippedSource || input.cancelled) return false;
  return RETRYABLE_BROWSER_FAILURES.has(input.failure.category);
}
