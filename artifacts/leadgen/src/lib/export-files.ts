export type SavedExport = {
  saved: boolean;
  filename: string;
  path: string;
  relativePath: string;
  rows?: number;
};

export function withSaveParam(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}save=1`;
}

export async function saveExportToServer(url: string): Promise<SavedExport> {
  const response = await fetch(withSaveParam(url));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Export failed (${response.status})`);
  }
  return response.json() as Promise<SavedExport>;
}

export async function saveTextExportToServer(filename: string, content: string): Promise<SavedExport> {
  const response = await fetch("/api/exports/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Export failed (${response.status})`);
  }
  return response.json() as Promise<SavedExport>;
}
