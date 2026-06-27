export const PLAYWRIGHT_CHROMIUM_INSTALL_COMMAND =
  "pnpm --filter @workspace/api-server exec playwright install chromium";

export type BrowserAttemptStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "setup_required";

export type BrowserAttemptPresentation = {
  label: string;
  tone: "warning" | "progress" | "success" | "error";
  description?: string;
  showSetupCommand: boolean;
};

export function getBrowserAttemptPresentation(
  status: string | null | undefined,
): BrowserAttemptPresentation | null {
  switch (status) {
    case "pending":
      return { label: "Browser retry queued", tone: "warning", showSetupCommand: false };
    case "running":
      return { label: "Browser retry in progress", tone: "progress", showSetupCommand: false };
    case "succeeded":
      return { label: "Recovered by browser crawler", tone: "success", showSetupCommand: false };
    case "failed":
      return { label: "Browser retry failed", tone: "error", showSetupCommand: false };
    case "setup_required":
      return {
        label: "Browser setup required",
        tone: "warning",
        description: "Playwright Chromium is not installed.",
        showSetupCommand: true,
      };
    default:
      return null;
  }
}
