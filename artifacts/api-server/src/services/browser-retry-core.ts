export type BrowserRetryStatus = "not_needed" | "pending" | "running" | "succeeded" | "failed" | "setup_required";

export function recoverBrowserRetryStatus(status: BrowserRetryStatus): BrowserRetryStatus {
  return status === "running" || status === "setup_required" ? "pending" : status;
}

export function isBrowserRetryRunnable(runStatus: string | null | undefined): boolean {
  return runStatus === "running";
}

export function mergeRecoveredEmailLists(existing: string[], recovered: string[]): string[] {
  return [...new Set([...existing, ...recovered].map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

export function finalBrowserCrawlStatus(pagesSucceeded: number): "crawled" | "failed" {
  return pagesSucceeded > 0 ? "crawled" : "failed";
}

export function hasDurableBrowserRetry(status: BrowserRetryStatus): boolean {
  return status === "pending" || status === "running" || status === "setup_required" || status === "succeeded";
}

export function browserSuccessUpdate(existingEmails: string[], recoveredEmails: string[]) {
  return {
    crawlStatus: "crawled" as const,
    crawlError: null,
    emails: mergeRecoveredEmailLists(existingEmails, recoveredEmails),
  };
}

export function browserFailureUpdate(message: string) {
  return {
    crawlStatus: "failed" as const,
    crawlError: message.slice(0, 500),
  };
}

export function createSingleFlightDrain(drain: () => Promise<void>) {
  let active: Promise<void> | null = null;
  let requested = false;

  return {
    kick(): Promise<void> {
      requested = true;
      if (!active) {
        active = (async () => {
          while (requested) {
            requested = false;
            await drain();
          }
        })().finally(() => {
          active = null;
        });
      }
      return active;
    },
    isActive(): boolean {
      return active !== null;
    },
  };
}
