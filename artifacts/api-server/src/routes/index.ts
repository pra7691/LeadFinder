import { Router, type IRouter } from "express";
import healthRouter from "./health";
import campaignsRouter from "./campaigns";
import campaignRunsRouter from "./campaign-runs";
import listsRouter from "./lists";
import emailTemplatesRouter from "./email-templates";
import emailTemplateAttachmentsRouter from "./email-template-attachments";
import leadsRouter from "./leads";
import emailAccountsRouter from "./email-accounts";
import outreachSendRouter from "./outreach-send";
import outreachRouter from "./outreach";
import logsRouter from "./logs";
import settingsRouter from "./settings";
import dashboardRouter from "./dashboard";
import discoveryRouter from "./discovery";
import crawlRouter from "./crawl";
import scoreRouter from "./score";
import leadWorkflowRouter from "./lead-workflow";
import schedulerRouter from "./scheduler";
import exportRouter from "./export";
import fileExportsRouter from "./file-exports";
import adminRouter from "./admin";
import { ensureOutreachTrackingColumns } from "../lib/schema-guards";

const router: IRouter = Router();

// Run once at module load — fire-and-forget so a transient DB hiccup
// never blocks every subsequent request.  The promise resets itself on
// failure (see schema-guards.ts) so the next request retries automatically.
ensureOutreachTrackingColumns().catch(() => {
  // Columns will be retried on the next request that needs them.
});

router.use(healthRouter);
router.use(dashboardRouter);
router.use(schedulerRouter);
router.use(exportRouter);
router.use(fileExportsRouter);
router.use(campaignsRouter);
router.use(campaignRunsRouter);
router.use(listsRouter);
router.use(emailTemplateAttachmentsRouter);
router.use(emailTemplatesRouter);
router.use(discoveryRouter);
router.use(leadWorkflowRouter);
router.use(scoreRouter);
router.use(crawlRouter);
router.use(leadsRouter);
router.use(emailAccountsRouter);
router.use(outreachSendRouter);
router.use(outreachRouter);
router.use(logsRouter);
router.use(settingsRouter);
router.use(adminRouter);

export default router;
