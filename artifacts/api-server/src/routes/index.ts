import { Router, type IRouter } from "express";
import healthRouter from "./health";
import campaignsRouter from "./campaigns";
import leadsRouter from "./leads";
import emailAccountsRouter from "./email-accounts";
import outreachRouter from "./outreach";
import logsRouter from "./logs";
import settingsRouter from "./settings";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(campaignsRouter);
router.use(leadsRouter);
router.use(emailAccountsRouter);
router.use(outreachRouter);
router.use(logsRouter);
router.use(settingsRouter);

export default router;
