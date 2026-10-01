import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import portfolioRouter from "./portfolio";
import protocolRouter from "./protocol";
import sessionRouter from "./session";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionRouter);
router.use(protocolRouter);
router.use(marketRouter);
router.use(portfolioRouter);

export default router;
