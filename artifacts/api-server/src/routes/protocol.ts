import { Router, type IRouter } from "express";
import { getAddress } from "viem";
import { deployment, MONAD_TESTNET, PROTOCOL } from "@workspace/contracts";
import { GetPricesResponse, GetPriceUpdateQueryParams, GetPriceUpdateResponse, GetProtocolResponse } from "@workspace/api-zod";
import { indexerStatus } from "../lib/indexer";
import { badRequest, handler, HttpError, notFound, zodMessage } from "../lib/http";
import { allQuotes, livePricesAvailable, PricesUnavailableError, signedUpdate } from "../lib/prices";

const router: IRouter = Router();

router.get("/protocol", (_req, res) => {
  res.json(
    GetProtocolResponse.parse({
      deployed: deployment.deployed,
      chainId: deployment.chainId,
      chainName: MONAD_TESTNET.name,
      rpcUrl: MONAD_TESTNET.rpcUrl,
      explorerUrl: MONAD_TESTNET.explorerUrl,
      exchange: getAddress(deployment.exchange),
      pyth: getAddress(deployment.pyth),
      startBlock: deployment.startBlock,
      asset: deployment.asset,
      collaterals: deployment.collaterals,
      parameters: {
        maxRateBps: PROTOCOL.MAX_RATE_BPS,
        minBidStepBps: PROTOCOL.MIN_BID_STEP_BPS,
        minDuration: PROTOCOL.MIN_DURATION,
        maxDuration: PROTOCOL.MAX_DURATION,
        minAuction: PROTOCOL.MIN_AUCTION,
        maxAuction: PROTOCOL.MAX_AUCTION,
        extensionWindow: PROTOCOL.EXTENSION_WINDOW,
        maxGrace: PROTOCOL.MAX_GRACE,
        liquidationLtvBps: PROTOCOL.LIQUIDATION_LTV_BPS,
        liquidationPenaltyBps: PROTOCOL.LIQUIDATION_PENALTY_BPS,
        liquidatorBountyBps: PROTOCOL.LIQUIDATOR_BOUNTY_BPS,
        maxPriceAge: PROTOCOL.MAX_PRICE_AGE,
      },
      indexer: indexerStatus(),
      livePrices: livePricesAvailable(),
    }),
  );
});

router.get("/prices", (_req, res) => {
  res.json(GetPricesResponse.parse(allQuotes()));
});

router.get(
  "/prices/update",
  handler(async (req, res) => {
    const parsed = GetPriceUpdateQueryParams.safeParse(req.query);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const collateral = deployment.collaterals.find((c) => c.symbol.toLowerCase() === parsed.data.collateral.toLowerCase());
    if (!collateral) throw notFound("Unknown collateral.");
    try {
      res.json(GetPriceUpdateResponse.parse(await signedUpdate(collateral)));
    } catch (error) {
      if (error instanceof PricesUnavailableError) throw new HttpError(503, "Live Pyth prices are unavailable right now.");
      throw error;
    }
  }),
);

export default router;
