export function normalizeDomainToken(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";

  let host = raw;
  try {
    host = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname;
  } catch {
    host = raw.split(/[/?#]/)[0] ?? raw;
  }

  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/^\.+|\.+$/g, "");
}

export function parseBlockedDomains(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\n,]/)
      .map(normalizeDomainToken)
      .filter(Boolean),
  );
}

export function domainMatchesBlockedList(domain: string | null | undefined, blockedDomains: Set<string>): boolean {
  const normalized = normalizeDomainToken(domain);
  if (!normalized) return false;

  for (const blocked of blockedDomains) {
    if (normalized === blocked || normalized.endsWith(`.${blocked}`)) return true;
    if (!blocked.includes(".") && normalized.startsWith(`${blocked}.`)) return true;
  }

  return false;
}
