import { getAddress, parseEventLogs, zeroAddress, type Log } from "viem";
import { MongoServerError } from "mongodb";
import { getCollections, type EventDoc, type EventKind, type LoanDoc, type ListingDoc } from "@workspace/db";
import { citrineExchangeAbi, deployment, gracePeriod, LOAN_STATUSES, REQUEST_STATUSES } from "@workspace/contracts";
import { errorSummary, exchange, publicClient, sleep } from "./chain";
import { isLeader } from "./leader";
import { logger } from "./logger";

/** Monad's RPC limits eth_getLogs to 100 blocks per call. */
const CHUNK = 100;
const PARALLEL_RANGES = 8;
const POLL_MS = 1_500;
const RECONCILE_MS = 60_000;
/**
 * Index up to the finalized block, which cannot reorg, minus a small margin. The public RPC
 * is load-balanced and its nodes can trail each other by a few blocks; the margin keeps the
 * range inside what every node has, so getLogs never silently misses a block.
 */
const HEAD_MARGIN = 3;
const META_ID = "indexer";

const exchangeKey = deployment.exchange.toLowerCase();
const assetSymbol = deployment.asset.symbol;
const assetDecimals = deployment.asset.decimals;

type ParsedLog = ReturnType<typeof parseEventLogs<typeof citrineExchangeAbi>>[number];

interface IndexerState {
  lastBlock: number;
  headBlock: number;
  updatedAt: Date | null;
  running: boolean;
}

const state: IndexerState = { lastBlock: deployment.startBlock - 1, headBlock: 0, updatedAt: null, running: false };

export function indexerStatus() {
  return {
    lastBlock: state.lastBlock,
    headBlock: state.headBlock,
    lagBlocks: Math.max(0, state.headBlock - state.lastBlock),
    updatedAt: state.updatedAt,
  };
}

/** True once the index has caught up with the chain head. */
export function indexerSynced(maxLag = 30): boolean {
  return state.updatedAt !== null && state.headBlock - state.lastBlock <= maxLag;
}

const lower = (address: string) => address.toLowerCase();
const orNull = (address: string) => (address === zeroAddress ? null : lower(address));

function collateralFor(index: number) {
  return deployment.collaterals.find((c) => c.index === index) ?? null;
}

interface RequestInfo {
  borrower: string;
  principal: bigint;
  collateralIndex: number;
}

/** Thrown when this instance lost the worker lease mid-batch, so the batch stops before writing. */
class LeaseLost extends Error {
  constructor() {
    super("Worker lease lost");
  }
}

/**
 * Called after every awaited RPC read and before the writes that depend on it, with no RPC call
 * in between. A slow read can outlast the lease, so checking once per batch is not enough.
 */
function fence(): void {
  if (!isLeader()) throw new LeaseLost();
}

/** Request basics needed to describe later events, cached per batch. */
async function requestInfo(id: number, cache: Map<number, RequestInfo>): Promise<RequestInfo> {
  const cached = cache.get(id);
  if (cached) return cached;
  const { requests } = await getCollections();
  const doc = await requests.findOne({ _id: id }, { projection: { borrower: 1, principal: 1, collateralIndex: 1 } });
  let info: RequestInfo;
  if (doc) {
    info = { borrower: doc.borrower, principal: BigInt(doc.principal), collateralIndex: doc.collateralIndex };
  } else {
    const r = await publicClient.readContract({ ...exchange, functionName: "getRequest", args: [BigInt(id)] });
    fence();
    info = { borrower: lower(r.borrower), principal: r.principal, collateralIndex: r.collateralType };
  }
  cache.set(id, info);
  return info;
}

async function blockTimes(logs: ParsedLog[]): Promise<Map<bigint, Date>> {
  const times = new Map<bigint, Date>();
  for (const log of logs) {
    const ts = (log as Log & { blockTimestamp?: bigint | string }).blockTimestamp;
    if (ts !== undefined && ts !== null) times.set(log.blockNumber, new Date(Number(BigInt(ts)) * 1000));
  }
  const missing = [...new Set(logs.map((l) => l.blockNumber))].filter((b) => !times.has(b));
  await Promise.all(
    missing.map(async (blockNumber) => {
      const block = await publicClient.getBlock({ blockNumber });
      times.set(blockNumber, new Date(Number(block.timestamp) * 1000));
    }),
  );
  return times;
}

async function processLogs(rawLogs: Log[], atBlock: bigint): Promise<void> {
  const logs = parseEventLogs({ abi: citrineExchangeAbi, logs: rawLogs }).sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  if (!logs.length) return;
  const { events, requests, loans } = await getCollections();
  const times = await blockTimes(logs);
  fence();
  const cache = new Map<number, RequestInfo>();
  const dirty = new Set<number>();
  // Sales also emit an ERC-721 Transfer; the sale event already describes them.
  const sales = new Set(
    logs.filter((l) => l.eventName === "PositionSold").map((l) => `${l.transactionHash}:${(l.args as { id: bigint }).id}`),
  );

  for (const log of logs) {
    const timestamp = times.get(log.blockNumber)!;
    const base = {
      timestamp,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      txHash: lower(log.transactionHash),
    };
    const record = async (
      kind: EventKind,
      loanId: number,
      actor: string,
      fields: Partial<Pick<EventDoc, "counterparty" | "amount" | "symbol" | "decimals" | "rateBps" | "auctionEnd">> = {},
    ) => {
      const doc: EventDoc = {
        _id: `${base.txHash}-${base.logIndex}`,
        kind,
        loanId,
        actor: lower(actor),
        counterparty: fields.counterparty ?? null,
        amount: fields.amount ?? null,
        symbol: fields.symbol ?? null,
        decimals: fields.decimals ?? null,
        rateBps: fields.rateBps ?? null,
        ...(fields.auctionEnd ? { auctionEnd: fields.auctionEnd } : {}),
        ...base,
      };
      await events.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
      dirty.add(loanId);
    };
    const usdc = (amount: bigint) => ({ amount: amount.toString(), symbol: assetSymbol, decimals: assetDecimals });

    switch (log.eventName) {
      case "RequestCreated": {
        const a = log.args;
        const id = Number(a.id);
        cache.set(id, { borrower: lower(a.borrower), principal: a.principal, collateralIndex: a.collateralType });
        await requests.updateOne(
          { _id: id },
          {
            $set: { txHash: base.txHash, blockNumber: base.blockNumber },
            $setOnInsert: {
              status: "open",
              borrower: lower(a.borrower),
              collateralIndex: a.collateralType,
              collateralAmount: a.collateral.toString(),
              principal: a.principal.toString(),
              duration: Number(a.duration),
              maxRateBps: a.maxRateBps,
              bestRateBps: null,
              bestBidder: null,
              bidCount: 0,
              createdAt: timestamp,
              auctionEnd: new Date(Number(a.auctionEnd) * 1000),
            },
          },
          { upsert: true },
        );
        await record("request_created", id, a.borrower, { ...usdc(a.principal), rateBps: a.maxRateBps });
        break;
      }
      case "BidPlaced": {
        const a = log.args;
        const id = Number(a.id);
        const info = await requestInfo(id, cache);
        await record("bid_placed", id, a.bidder, {
          ...usdc(info.principal),
          counterparty: orNull(a.previousBidder),
          rateBps: a.rateBps,
          auctionEnd: new Date(Number(a.auctionEnd) * 1000),
        });
        break;
      }
      case "RequestCancelled":
      case "RequestExpired": {
        const id = Number(log.args.id);
        const info = await requestInfo(id, cache);
        await record(log.eventName === "RequestCancelled" ? "request_cancelled" : "request_expired", id, info.borrower, usdc(info.principal));
        break;
      }
      case "LoanStarted": {
        const a = log.args;
        const id = Number(a.id);
        const info = await requestInfo(id, cache);
        const startTime = Number(a.startTime);
        const maturity = Number(a.maturity);
        const loanDefaults: Omit<LoanDoc, "_id" | "txHash" | "blockNumber"> = {
          status: "active",
          borrower: lower(a.borrower),
          lender: lower(a.lender),
          holder: lower(a.lender),
          collateralIndex: info.collateralIndex,
          collateralAmount: a.collateral.toString(),
          principal: a.principal.toString(),
          rateBps: a.rateBps,
          maxRateBps: a.rateBps,
          bidCount: 1,
          startTime: new Date(startTime * 1000),
          maturity: new Date(maturity * 1000),
          defaultAt: new Date((maturity + gracePeriod(maturity - startTime)) * 1000),
          closedAt: null,
          repaidAmount: null,
          interestPaid: null,
          listing: null,
        };
        await loans.updateOne(
          { _id: id },
          { $set: { txHash: base.txHash, blockNumber: base.blockNumber }, $setOnInsert: loanDefaults },
          { upsert: true },
        );
        await record("loan_started", id, a.lender, { ...usdc(a.principal), counterparty: lower(a.borrower), rateBps: a.rateBps });
        break;
      }
      case "LoanRepaid": {
        const a = log.args;
        const id = Number(a.id);
        await loans.updateOne(
          { _id: id },
          { $set: { repaidAmount: a.amount.toString(), interestPaid: a.interest.toString(), listing: null } },
        );
        await record("loan_repaid", id, a.payer, { ...usdc(a.amount), counterparty: lower(a.holder) });
        break;
      }
      case "LoanDefaulted": {
        const a = log.args;
        const id = Number(a.id);
        const collateral = collateralFor((await requestInfo(id, cache)).collateralIndex);
        await loans.updateOne({ _id: id }, { $set: { listing: null } });
        await record("loan_defaulted", id, a.caller, {
          counterparty: lower(a.holder),
          amount: a.collateral.toString(),
          symbol: collateral?.symbol ?? null,
          decimals: collateral?.decimals ?? null,
        });
        break;
      }
      case "LoanLiquidated": {
        const a = log.args;
        const id = Number(a.id);
        const collateral = collateralFor((await requestInfo(id, cache)).collateralIndex);
        await loans.updateOne({ _id: id }, { $set: { listing: null } });
        await record("loan_liquidated", id, a.caller, {
          counterparty: lower(a.holder),
          amount: a.seized.toString(),
          symbol: collateral?.symbol ?? null,
          decimals: collateral?.decimals ?? null,
        });
        break;
      }
      case "Listed": {
        const a = log.args;
        const id = Number(a.id);
        const listing: ListingDoc = { seller: lower(a.seller), price: a.price.toString(), listedAt: timestamp, txHash: base.txHash };
        await loans.updateOne({ _id: id }, { $set: { listing } });
        await record("listed", id, a.seller, usdc(a.price));
        break;
      }
      case "ListingCancelled": {
        const id = Number(log.args.id);
        const loan = await loans.findOne({ _id: id }, { projection: { listing: 1, holder: 1 } });
        await loans.updateOne({ _id: id }, { $set: { listing: null } });
        await record("listing_cancelled", id, loan?.listing?.seller ?? loan?.holder ?? zeroAddress, {});
        break;
      }
      case "PositionSold": {
        const a = log.args;
        const id = Number(a.id);
        await loans.updateOne({ _id: id }, { $set: { listing: null, holder: lower(a.buyer) } });
        await record("position_sold", id, a.buyer, { ...usdc(a.price), counterparty: lower(a.seller) });
        break;
      }
      case "Transfer": {
        const a = log.args as { from: string; to: string; tokenId: bigint };
        const id = Number(a.tokenId);
        if (a.from === zeroAddress || a.to === zeroAddress) {
          dirty.add(id);
          break;
        }
        await loans.updateOne({ _id: id }, { $set: { holder: lower(a.to), listing: null } });
        if (sales.has(`${log.transactionHash}:${a.tokenId}`)) {
          dirty.add(id);
          break;
        }
        await record("position_transferred", id, a.from, { counterparty: lower(a.to) });
        break;
      }
      default:
        break;
    }
  }

  await refreshState([...dirty], atBlock);
}

/** Ids whose state read failed; retried on the next tick. */
const staleIds = new Set<number>();
let lastReconcile = 0;

/**
 * Re-reads the onchain state of the given ids as of `atBlock`. Events describe what happened;
 * the contract remains the source of truth for status, bids and ownership. Reads are pinned to
 * the indexed block because the public RPC is load-balanced and a lagging node would otherwise
 * answer "latest" with state from before the events we just processed.
 */
async function refreshState(ids: number[], atBlock: bigint): Promise<void> {
  const { requests, loans } = await getCollections();
  await Promise.all(
    ids.map(async (id) => {
      const key = BigInt(id);
      const at = { blockNumber: atBlock } as const;
      const [req, loan, listing, owner] = await Promise.allSettled([
        publicClient.readContract({ ...exchange, functionName: "getRequest", args: [key], ...at }),
        publicClient.readContract({ ...exchange, functionName: "getLoan", args: [key], ...at }),
        publicClient.readContract({ ...exchange, functionName: "getListing", args: [key], ...at }),
        publicClient.readContract({ ...exchange, functionName: "ownerOf", args: [key], ...at }),
      ]);
      fence();
      if (req.status !== "fulfilled" || loan.status !== "fulfilled" || listing.status !== "fulfilled") {
        staleIds.add(id);
        logger.debug({ id }, "Could not refresh state; retrying next tick");
        return;
      }
      staleIds.delete(id);
      const r = req.value;
      if (r.borrower === zeroAddress) return;
      const hasBids = r.bidCount > 0;
      await requests.updateOne(
        { _id: id },
        {
          $set: {
            status: REQUEST_STATUSES[r.status] as "open" | "funded" | "cancelled" | "expired",
            borrower: lower(r.borrower),
            collateralIndex: r.collateralType,
            collateralAmount: r.collateral.toString(),
            principal: r.principal.toString(),
            duration: Number(r.duration),
            maxRateBps: r.maxRateBps,
            bestRateBps: hasBids ? r.bestRateBps : null,
            bestBidder: hasBids ? orNull(r.bestBidder) : null,
            bidCount: r.bidCount,
            createdAt: new Date(Number(r.createdAt) * 1000),
            auctionEnd: new Date(Number(r.auctionEnd) * 1000),
          },
          $setOnInsert: { txHash: "", blockNumber: 0 },
        },
        { upsert: true },
      );

      const l = loan.value;
      if (l.status === 0) return;
      const startTime = Number(l.startTime);
      const maturity = Number(l.maturity);
      const active = LOAN_STATUSES[l.status] === "active";
      // A closed loan's position is burned, so ownerOf reverts and there is no holder. For an
      // active loan a failed read is an RPC error: keep the last known holder and retry.
      const ownerUnknown = owner.status !== "fulfilled" && active;
      if (ownerUnknown) staleIds.add(id);
      const existing = await loans.findOne({ _id: id }, { projection: { listing: 1 } });
      const chainListing = listing.value;
      let nextListing: ListingDoc | null = null;
      if (chainListing.seller !== zeroAddress) {
        const prior = existing?.listing;
        nextListing =
          prior && prior.seller === lower(chainListing.seller) && prior.price === chainListing.price.toString()
            ? prior
            : { seller: lower(chainListing.seller), price: chainListing.price.toString(), listedAt: new Date(), txHash: "" };
      }
      await loans.updateOne(
        { _id: id },
        {
          $set: {
            status: LOAN_STATUSES[l.status] as LoanDoc["status"],
            borrower: lower(l.borrower),
            lender: lower(l.lender),
            ...(owner.status === "fulfilled" ? { holder: lower(owner.value) } : ownerUnknown ? {} : { holder: null }),
            collateralIndex: l.collateralType,
            collateralAmount: l.collateral.toString(),
            principal: l.principal.toString(),
            rateBps: l.rateBps,
            maxRateBps: r.maxRateBps,
            bidCount: r.bidCount,
            startTime: new Date(startTime * 1000),
            maturity: new Date(maturity * 1000),
            defaultAt: new Date((maturity + gracePeriod(maturity - startTime)) * 1000),
            closedAt: Number(l.closedAt) > 0 ? new Date(Number(l.closedAt) * 1000) : null,
            listing: nextListing,
          },
          $setOnInsert: {
            repaidAmount: null,
            interestPaid: null,
            txHash: "",
            blockNumber: 0,
            ...(ownerUnknown ? { holder: null } : {}),
          },
        },
        { upsert: true },
      );
    }),
  );
}

async function tick(): Promise<void> {
  const { meta } = await getCollections();
  const finalized = await publicClient.getBlock({ blockTag: "finalized" });
  const head = Number(finalized.number) - HEAD_MARGIN;
  state.headBlock = head;
  let from = state.lastBlock + 1;
  while (from <= head) {
    fence();
    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < PARALLEL_RANGES && from <= head; i++) {
      const to = Math.min(from + CHUNK - 1, head);
      ranges.push([from, to]);
      from = to + 1;
    }
    const results = await Promise.all(
      ranges.map(([a, b]) => publicClient.getLogs({ address: exchange.address, fromBlock: BigInt(a), toBlock: BigInt(b) })),
    );
    const to = ranges[ranges.length - 1]![1];
    fence();
    await processLogs(results.flat(), BigInt(to));
    fence();
    const updatedAt = new Date();
    try {
      // The cursor only moves forward, so a worker that lost its lease can never rewind it.
      await meta.updateOne(
        { _id: META_ID, lastBlock: { $lt: to } },
        { $set: { lastBlock: to, headBlock: head, updatedAt, exchange: exchangeKey } },
        { upsert: true },
      );
    } catch (error) {
      // The filter missed because the stored cursor is already ahead: another leader indexed past us.
      if (error instanceof MongoServerError && error.code === 11000) throw new LeaseLost();
      throw error;
    }
    state.lastBlock = to;
    state.updatedAt = updatedAt;
  }
  fence();
  await reconcile();
  state.updatedAt = new Date();
}

/**
 * Retries failed state reads, and once a minute re-reads everything still live (open
 * requests, active loans) so the index heals itself from any missed or stale read.
 */
async function reconcile(): Promise<void> {
  const ids = new Set(staleIds);
  if (Date.now() - lastReconcile >= RECONCILE_MS) {
    lastReconcile = Date.now();
    const { requests, loans } = await getCollections();
    const [open, active] = await Promise.all([
      requests.find({ status: "open" }, { projection: { _id: 1 } }).toArray(),
      loans.find({ status: "active" }, { projection: { _id: 1 } }).toArray(),
    ]);
    for (const doc of [...open, ...active]) ids.add(doc._id);
  }
  if (ids.size) await refreshState([...ids], BigInt(state.lastBlock));
}

/**
 * Loads the durable cursor. Followers call it every poll to mirror the leader, so their status
 * stays accurate; a new leader calls it once before indexing. Only the leader may reset the
 * index when the exchange address changed, since a follower may be an older deploy.
 */
async function restore(asLeader: boolean): Promise<void> {
  const { meta, requests, loans, events } = await getCollections();
  const doc = await meta.findOne({ _id: META_ID });
  if (doc && doc.exchange && doc.exchange !== exchangeKey) {
    if (!asLeader) return;
    logger.warn({ previous: doc.exchange, current: exchangeKey }, "Exchange address changed; rebuilding the index");
    await Promise.all([requests.deleteMany({}), loans.deleteMany({}), events.deleteMany({}), meta.deleteOne({ _id: META_ID })]);
    state.lastBlock = deployment.startBlock - 1;
    state.headBlock = 0;
    return;
  }
  if (doc) {
    state.lastBlock = Math.max(doc.lastBlock, deployment.startBlock - 1);
    state.headBlock = doc.headBlock;
    state.updatedAt = doc.updatedAt;
  }
}

let leading = false;
let inflight: Promise<boolean> | null = null;

/** One indexer step. Resolves false when it failed, so the loop can back off. */
async function step(): Promise<boolean> {
  try {
    if (isLeader()) {
      if (!leading) {
        await restore(true);
        leading = true;
        logger.info({ fromBlock: state.lastBlock + 1 }, "Indexing as leader");
      }
      await tick();
    } else {
      leading = false;
      await restore(false);
    }
    return true;
  } catch (error) {
    if (error instanceof LeaseLost) {
      leading = false;
      logger.info("Lost the worker lease mid-batch; stopped before writing");
      return true;
    }
    logger.warn({ err: errorSummary(error) }, "Indexer tick failed");
    return false;
  }
}

export async function startIndexer(): Promise<void> {
  if (state.running) return;
  state.running = true;
  await restore(false);
  logger.info({ exchange: getAddress(deployment.exchange), fromBlock: state.lastBlock + 1 }, "Indexer starting");
  void (async () => {
    let failures = 0;
    while (state.running) {
      inflight = step();
      const ok = await inflight;
      inflight = null;
      failures = ok ? 0 : failures + 1;
      await sleep(ok ? POLL_MS : Math.min(30_000, 2_000 * failures));
    }
  })();
}

/** Stops polling and resolves once the step in progress has finished writing. */
export function stopIndexer(): Promise<void> {
  state.running = false;
  return inflight ? inflight.then(() => undefined) : Promise.resolve();
}
