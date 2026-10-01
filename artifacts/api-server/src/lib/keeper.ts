import { encodeFunctionData, type Hash, type Hex } from "viem";
import { getCollections } from "@workspace/db";
import { deployment, PROTOCOL } from "@workspace/contracts";
import { errorSummary, exchange, keeperAccount, publicClient, sleep, walletClient } from "./chain";
import { indexerSynced } from "./indexer";
import { logger } from "./logger";
import { isLeader } from "./leader";
import { freshQuote, signedUpdate } from "./prices";
import { collateralOf, display, owedRaw, assetDecimals } from "./serialize";

const TICK_MS = 10_000;
const RETRY_AFTER_MS = 20_000;
const BATCH = 10;

const pythFeeAbi = [
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
] as const;

type KeeperCall =
  | { functionName: "settle" | "expireRequest" | "claimDefault"; args: readonly [bigint]; value?: undefined }
  | { functionName: "liquidate"; args: readonly [bigint, readonly Hex[]]; value: bigint };

// The exchange calls are a small union; viem's per-function generics are widened once here.
const simulate = publicClient.simulateContract as unknown as (params: object) => Promise<{ request: object }>;
const estimate = publicClient.estimateContractGas as unknown as (params: object) => Promise<bigint>;
const encode = encodeFunctionData as unknown as (params: { abi: typeof exchange.abi; functionName: string; args: readonly unknown[] }) => Hex;

const retryAt = new Map<string, number>();
let running = false;
let inflight: Promise<void> | null = null;

async function send(call: KeeperCall): Promise<Hash | null> {
  if (!walletClient || !keeperAccount) return null;
  const id = call.args[0];
  const key = `${call.functionName}:${id}`;
  if ((retryAt.get(key) ?? 0) > Date.now()) return null;
  const params = { ...exchange, ...call, account: keeperAccount };
  try {
    await simulate(params);
    const gas = ((await estimate(params)) * 115n) / 100n;
    // Prepare and sign first, then check the lease right before the raw send. writeContract
    // would await nonce and fee lookups after any earlier check, and those can outlast the lease.
    const prepared = await walletClient.prepareTransactionRequest({
      account: keeperAccount,
      to: exchange.address,
      data: encode({ abi: exchange.abi, functionName: call.functionName, args: call.args }),
      value: call.value ?? 0n,
      gas,
    });
    const serializedTransaction = await walletClient.signTransaction(prepared);
    if (!isLeader()) return null;
    const hash = await walletClient.sendRawTransaction({ serializedTransaction });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    logger.info({ action: call.functionName, id: Number(id), hash, status: receipt.status }, "Keeper transaction");
    retryAt.delete(key);
    return hash;
  } catch (error) {
    retryAt.set(key, Date.now() + RETRY_AFTER_MS);
    logger.debug({ action: call.functionName, id: Number(id), err: errorSummary(error) }, "Keeper call skipped");
    return null;
  }
}

async function liquidations(nowMs: number): Promise<void> {
  const { loans } = await getCollections();
  const active = await loans.find({ status: "active" }).toArray();
  for (const loan of active) {
    const collateral = collateralOf(loan.collateralIndex);
    // Only fresh prices are actionable; the contract rejects anything older than MAX_PRICE_AGE.
    const quote = freshQuote(collateral.symbol);
    if (!quote) continue;
    const value = display(loan.collateralAmount, collateral.decimals) * quote.price;
    const owed = display(owedRaw(loan, nowMs), assetDecimals);
    // Contract checks with its own fresh price; leave a little headroom below the threshold.
    if (value <= 0 || (owed / value) * PROTOCOL.BPS < PROTOCOL.LIQUIDATION_LTV_BPS - 100) continue;
    try {
      if (quote.source === "onchain") {
        // This feed's onchain Pyth price is itself fresh, so the contract can use it as stored.
        await send({ functionName: "liquidate", args: [BigInt(loan._id), []], value: 0n });
        continue;
      }
      // A Hermes quote says nothing about the onchain price, so post its signed update with the call.
      const update = await signedUpdate(collateral);
      const updateData = update.updateData as Hex[];
      const fee = await publicClient.readContract({
        address: deployment.pyth,
        abi: pythFeeAbi,
        functionName: "getUpdateFee",
        args: [updateData],
      });
      await send({ functionName: "liquidate", args: [BigInt(loan._id), updateData], value: fee });
    } catch (error) {
      logger.warn({ id: loan._id, err: errorSummary(error) }, "Liquidation check failed");
    }
  }
}

async function tick(): Promise<void> {
  // One instance sends keeper transactions, so replicas never race on the signer's nonce.
  if (!isLeader()) return;
  // Acting on a stale index would only produce reverted simulations.
  if (!indexerSynced()) return;
  const now = Date.now();
  const { requests, loans } = await getCollections();

  const ended = await requests
    .find({ status: "open", auctionEnd: { $lte: new Date(now - 1_000) } })
    .sort({ auctionEnd: 1 })
    .limit(BATCH)
    .toArray();
  for (const request of ended) {
    await send({ functionName: request.bidCount > 0 ? "settle" : "expireRequest", args: [BigInt(request._id)] });
  }

  const overdue = await loans
    .find({ status: "active", defaultAt: { $lte: new Date(now - 1_000) } })
    .sort({ defaultAt: 1 })
    .limit(BATCH)
    .toArray();
  for (const loan of overdue) {
    await send({ functionName: "claimDefault", args: [BigInt(loan._id)] });
  }

  await liquidations(now);
}

/**
 * Closes auctions, returns collateral from expired requests, and enforces defaults and
 * liquidations. Every action is permissionless onchain; the keeper just makes sure
 * nothing waits on a person to press a button.
 */
export function startKeeper(): void {
  if (!walletClient || !keeperAccount) {
    logger.info("Keeper disabled: no keeper key configured");
    return;
  }
  if (process.env.KEEPER_ENABLED === "false") {
    logger.info("Keeper disabled by KEEPER_ENABLED=false");
    return;
  }
  if (running) return;
  running = true;
  logger.info({ keeper: keeperAccount.address }, "Keeper started");
  void (async () => {
    while (running) {
      inflight = tick().catch((error: unknown) => logger.warn({ err: errorSummary(error) }, "Keeper tick failed"));
      await inflight;
      inflight = null;
      await sleep(TICK_MS);
    }
  })();
}

/** Stops the loop and resolves once any transaction in progress has been sent and confirmed. */
export function stopKeeper(): Promise<void> {
  running = false;
  return inflight ?? Promise.resolve();
}
