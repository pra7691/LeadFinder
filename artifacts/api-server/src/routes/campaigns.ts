import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignKeywordsTable,
  campaignCountriesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateCampaignBody,
  UpdateCampaignBody,
  UpdateCampaignParams,
  GetCampaignParams,
  DeleteCampaignParams,
} from "@workspace/api-zod";

const router = Router();

async function getCampaignWithRelations(id: number) {
  const campaign = await db.query.campaignsTable.findFirst({
    where: eq(campaignsTable.id, id),
  });
  if (!campaign) return null;
  const keywords = await db
    .select()
    .from(campaignKeywordsTable)
    .where(eq(campaignKeywordsTable.campaignId, id));
  const countries = await db
    .select()
    .from(campaignCountriesTable)
    .where(eq(campaignCountriesTable.campaignId, id));
  return {
    ...campaign,
    keywords: keywords.map((k) => k.keyword),
    countries: countries.map((c) => c.country),
  };
}

router.get("/campaigns", async (req, res) => {
  const campaigns = await db.select().from(campaignsTable);
  const results = await Promise.all(
    campaigns.map((c) => getCampaignWithRelations(c.id)),
  );
  res.json(results.filter(Boolean));
});

router.post("/campaigns", async (req, res) => {
  const body = CreateCampaignBody.parse(req.body);
  const { keywords = [], countries = [], ...campaignData } = body;

  const [campaign] = await db
    .insert(campaignsTable)
    .values(campaignData)
    .returning();

  if (keywords.length > 0) {
    await db
      .insert(campaignKeywordsTable)
      .values(keywords.map((k) => ({ campaignId: campaign.id, keyword: k })));
  }
  if (countries.length > 0) {
    await db
      .insert(campaignCountriesTable)
      .values(countries.map((c) => ({ campaignId: campaign.id, country: c })));
  }

  const result = await getCampaignWithRelations(campaign.id);
  res.status(201).json(result);
});

router.get("/campaigns/:id", async (req, res) => {
  const { id } = GetCampaignParams.parse({ id: Number(req.params.id) });
  const campaign = await getCampaignWithRelations(id);
  if (!campaign) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(campaign);
});

router.patch("/campaigns/:id", async (req, res) => {
  const { id } = UpdateCampaignParams.parse({ id: Number(req.params.id) });
  const body = UpdateCampaignBody.parse(req.body);
  const { keywords, countries, ...campaignData } = body;

  if (Object.keys(campaignData).length > 0) {
    await db
      .update(campaignsTable)
      .set(campaignData)
      .where(eq(campaignsTable.id, id));
  }

  if (keywords !== undefined) {
    await db
      .delete(campaignKeywordsTable)
      .where(eq(campaignKeywordsTable.campaignId, id));
    if (keywords.length > 0) {
      await db
        .insert(campaignKeywordsTable)
        .values(keywords.map((k) => ({ campaignId: id, keyword: k })));
    }
  }

  if (countries !== undefined) {
    await db
      .delete(campaignCountriesTable)
      .where(eq(campaignCountriesTable.campaignId, id));
    if (countries.length > 0) {
      await db
        .insert(campaignCountriesTable)
        .values(countries.map((c) => ({ campaignId: id, country: c })));
    }
  }

  const result = await getCampaignWithRelations(id);
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

router.delete("/campaigns/:id", async (req, res) => {
  const { id } = DeleteCampaignParams.parse({ id: Number(req.params.id) });
  await db.delete(campaignsTable).where(eq(campaignsTable.id, id));
  res.status(204).send();
});

export default router;
