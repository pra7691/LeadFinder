import { appSettingsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const SERPER_CREDIT_STATUS_KEY = "serper_credit_status";

export interface SerperCreditStatus {
  serperCreditsExhausted: boolean;
  detectedAt: string | null;
  affectedCampaignRunId: number | null;
  message: string | null;
}

export interface SerperCreditStatusStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

const availableStatus: SerperCreditStatus = {
  serperCreditsExhausted: false,
  detectedAt: null,
  affectedCampaignRunId: null,
  message: null,
};

const databaseStore: SerperCreditStatusStore = {
  async read() {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, SERPER_CREDIT_STATUS_KEY))
      .limit(1);
    return row?.value ?? null;
  },
  async write(value) {
    await db
      .insert(appSettingsTable)
      .values({ key: SERPER_CREDIT_STATUS_KEY, value })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
  },
  async clear() {
    await db
      .delete(appSettingsTable)
      .where(eq(appSettingsTable.key, SERPER_CREDIT_STATUS_KEY));
  },
};

export function isSerperCreditExhaustionResponse(
  status: number,
  body: string,
): boolean {
  if (status !== 400 && status !== 402) return false;
  return (
    /\bnot enough credits\b/i.test(body) || /\bcredits? exhausted\b/i.test(body)
  );
}

export function parseSerperCreditStatus(
  value: string | null,
): SerperCreditStatus {
  if (!value) return { ...availableStatus };

  try {
    const parsed = JSON.parse(value) as Partial<SerperCreditStatus>;
    if (parsed.serperCreditsExhausted !== true) return { ...availableStatus };

    return {
      serperCreditsExhausted: true,
      detectedAt:
        typeof parsed.detectedAt === "string" ? parsed.detectedAt : null,
      affectedCampaignRunId:
        typeof parsed.affectedCampaignRunId === "number"
          ? parsed.affectedCampaignRunId
          : null,
      message: typeof parsed.message === "string" ? parsed.message : null,
    };
  } catch {
    return { ...availableStatus };
  }
}

export async function getSerperCreditStatus(
  store: SerperCreditStatusStore = databaseStore,
): Promise<SerperCreditStatus> {
  return parseSerperCreditStatus(await store.read());
}

export async function recordSerperCreditsExhausted(
  campaignRunId: number | null | undefined,
  message: string,
  store: SerperCreditStatusStore = databaseStore,
  detectedAt: Date = new Date(),
): Promise<void> {
  const status: SerperCreditStatus = {
    serperCreditsExhausted: true,
    detectedAt: detectedAt.toISOString(),
    affectedCampaignRunId: campaignRunId ?? null,
    message: message.slice(0, 240),
  };

  try {
    await store.write(JSON.stringify(status));
  } catch (error) {
    logger.warn(
      { err: error, campaignRunId },
      "Failed to persist Serper credit status",
    );
  }
}

export async function clearSerperCreditsExhausted(
  store: SerperCreditStatusStore = databaseStore,
): Promise<void> {
  try {
    await store.clear();
  } catch (error) {
    logger.warn(
      { err: error },
      "Failed to clear Serper credit status after successful search",
    );
  }
}
