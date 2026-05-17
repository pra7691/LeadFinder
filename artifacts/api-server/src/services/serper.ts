export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

export interface SerperResponse {
  organic: SerperOrganicResult[];
}

export async function searchSerper(
  query: string,
  apiKey: string,
): Promise<SerperOrganicResult[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 10 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Serper API error ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as SerperResponse;
  return data.organic ?? [];
}

export function extractRootDomain(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./, "");
    // Basic validation — must contain a dot and no spaces
    if (!host.includes(".") || host.includes(" ")) return null;
    return host.toLowerCase();
  } catch {
    return null;
  }
}
