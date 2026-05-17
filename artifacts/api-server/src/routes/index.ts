import { Router, type IRouter } from "express";
import healthRouter from "./health";
import campaignsRouter from "./campaigns";
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

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(campaignsRouter);
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

export default router;
