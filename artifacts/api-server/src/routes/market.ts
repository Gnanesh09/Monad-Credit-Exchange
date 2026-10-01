import { Router, type IRouter } from "express";
import { isAddress } from "viem";
import type { Filter, Sort } from "mongodb";
import { getCollections, type EventDoc, type LoanDoc, type RequestDoc } from "@workspace/db";
import { deployment } from "@workspace/contracts";
import {
  GetLeaderboardResponse,
  GetLoanParams,
  GetLoanResponse,
  GetMarketStatsResponse,
  GetRateCurveResponse,
  GetRequestParams,
  GetRequestResponse,
  ListActivityQueryParams,
  ListActivityResponse,
  ListListingsQueryParams,
  ListListingsResponse,
  ListLoansQueryParams,
  ListLoansResponse,
  ListRatesQueryParams,
  ListRatesResponse,
  ListRequestsQueryParams,
  ListRequestsResponse,
} from "@workspace/api-zod";
import { badRequest, handler, notFound, zodMessage } from "../lib/http";
import { priceOf } from "../lib/prices";
import {
  assetDecimals,
  checksum,
  collateralOf,
  display,
  eventAddresses,
  loadNames,
  loanAddresses,
  requestAddresses,
  serializeEvent,
  serializeListing,
  serializeLoan,
  serializeRequest,
} from "../lib/serialize";

const router: IRouter = Router();

const DEFAULT_LIMIT = 50;
const DAY_MS = 86_400_000;

const CURVE_BUCKETS = [
  { label: "1 hour", maxDuration: 3_600 },
  { label: "1 day", maxDuration: 86_400 },
  { label: "1 week", maxDuration: 604_800 },
  { label: "1 month", maxDuration: 2_592_000 },
  { label: "3 months", maxDuration: 7_776_000 },
  { label: "1 year", maxDuration: 31_536_000 },
];

/** Resolves a collateral symbol filter to its index; throws 400 on unknown symbols. */
export function collateralIndexFor(symbol: string | undefined): number | undefined {
  if (!symbol) return undefined;
  const collateral = deployment.collaterals.find((c) => c.symbol.toLowerCase() === symbol.toLowerCase());
  if (!collateral) throw badRequest("Unknown collateral.");
  return collateral.index;
}

export function addressFilter(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  if (!isAddress(value)) throw badRequest(`${label} is not a valid address.`);
  return value.toLowerCase();
}

const usdc = (raw: string) => display(raw, assetDecimals);
const durationOf = (loan: LoanDoc) => Math.round((loan.maturity.getTime() - loan.startTime.getTime()) / 1000);

/** Principal-weighted average rate, or null for no loans. */
function weightedRate(loans: LoanDoc[]): number | null {
  let weight = 0;
  let sum = 0;
  for (const loan of loans) {
    const principal = usdc(loan.principal);
    weight += principal;
    sum += principal * loan.rateBps;
  }
  return weight > 0 ? Math.round(sum / weight) : null;
}

router.get(
  "/market/stats",
  handler(async (_req, res) => {
    const { requests, loans, events } = await getCollections();
    const [allRequests, allLoans, sales] = await Promise.all([
      requests.find({}, { projection: { status: 1, borrower: 1, collateralIndex: 1, collateralAmount: 1 } }).toArray(),
      loans.find({}).toArray(),
      events.find({ kind: "position_sold" }, { projection: { amount: 1, timestamp: 1 } }).toArray(),
    ]);
    const now = Date.now();
    const active = allLoans.filter((l) => l.status === "active");
    const lockedValue = (index: number, raw: string) => {
      const collateral = collateralOf(index);
      const price = priceOf(collateral.symbol);
      return price === null ? 0 : display(raw, collateral.decimals) * price;
    };
    const openRequests = allRequests.filter((r) => r.status === "open");
    const recentOrigination = allLoans
      .filter((l) => now - l.startTime.getTime() < DAY_MS)
      .reduce((sum, l) => sum + usdc(l.principal), 0);
    const recentSales = sales.filter((s) => now - s.timestamp.getTime() < DAY_MS).reduce((sum, s) => sum + usdc(s.amount ?? "0"), 0);

    res.json(
      GetMarketStatsResponse.parse({
        openRequests: openRequests.length,
        activeLoans: active.length,
        activeListings: active.filter((l) => l.listing).length,
        totalOriginated: allLoans.reduce((sum, l) => sum + usdc(l.principal), 0),
        outstandingPrincipal: active.reduce((sum, l) => sum + usdc(l.principal), 0),
        collateralLockedUsd:
          openRequests.reduce((sum, r) => sum + lockedValue(r.collateralIndex, r.collateralAmount), 0) +
          active.reduce((sum, l) => sum + lockedValue(l.collateralIndex, l.collateralAmount), 0),
        totalRepaid: allLoans.reduce((sum, l) => sum + (l.repaidAmount ? usdc(l.repaidAmount) : 0), 0),
        secondaryVolume: sales.reduce((sum, s) => sum + usdc(s.amount ?? "0"), 0),
        volume24h: recentOrigination + recentSales,
        averageRateBps: weightedRate(allLoans),
        loansFunded: allLoans.length,
        loansRepaid: allLoans.filter((l) => l.status === "repaid").length,
        loansDefaulted: allLoans.filter((l) => l.status === "defaulted").length,
        loansLiquidated: allLoans.filter((l) => l.status === "liquidated").length,
        uniqueBorrowers: new Set(allRequests.map((r) => r.borrower)).size,
        uniqueLenders: new Set(allLoans.map((l) => l.lender)).size,
      }),
    );
  }),
);

router.get(
  "/market/requests",
  handler(async (req, res) => {
    const parsed = ListRequestsQueryParams.safeParse(req.query);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { status = "open", collateral, borrower, sort = "ending", limit = DEFAULT_LIMIT } = parsed.data;
    const filter: Filter<RequestDoc> = {};
    if (status !== "all") filter.status = status;
    const collateralIndex = collateralIndexFor(collateral);
    if (collateralIndex !== undefined) filter.collateralIndex = collateralIndex;
    const borrowerKey = addressFilter(borrower, "borrower");
    if (borrowerKey) filter.borrower = borrowerKey;

    const { requests } = await getCollections();
    let docs = await requests.find(filter).toArray();
    const now = Date.now();
    const sorters: Record<string, (a: RequestDoc, b: RequestDoc) => number> = {
      // Live auctions first, soonest ending first.
      ending: (a, b) => {
        const aLive = a.auctionEnd.getTime() > now ? 0 : 1;
        const bLive = b.auctionEnd.getTime() > now ? 0 : 1;
        return aLive - bLive || (aLive === 0 ? a.auctionEnd.getTime() - b.auctionEnd.getTime() : b.auctionEnd.getTime() - a.auctionEnd.getTime());
      },
      newest: (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b._id - a._id,
      principal: (a, b) => usdc(b.principal) - usdc(a.principal),
      rate: (a, b) => (b.bestRateBps ?? b.maxRateBps) - (a.bestRateBps ?? a.maxRateBps),
    };
    docs = docs.sort(sorters[sort] ?? sorters.ending).slice(0, limit);
    const names = await loadNames(docs.flatMap(requestAddresses));
    res.json(ListRequestsResponse.parse(docs.map((d) => serializeRequest(d, names, now))));
  }),
);

router.get(
  "/market/requests/:id",
  handler(async (req, res) => {
    const parsed = GetRequestParams.safeParse(req.params);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { requests, events } = await getCollections();
    const doc = await requests.findOne({ _id: parsed.data.id });
    if (!doc) throw notFound(`Request #${parsed.data.id} does not exist.`);
    const bids = await events.find({ kind: "bid_placed", loanId: doc._id }).sort({ blockNumber: -1, logIndex: -1 }).toArray();
    const names = await loadNames([...requestAddresses(doc), ...bids.map((b) => b.actor)]);
    res.json(
      GetRequestResponse.parse({
        ...serializeRequest(doc, names, Date.now()),
        bids: bids.map((b) => ({
          bidder: checksum(b.actor),
          bidderName: names.get(b.actor) ?? null,
          rateBps: b.rateBps ?? 0,
          auctionEnd: b.auctionEnd ?? doc.auctionEnd,
          timestamp: b.timestamp,
          txHash: b.txHash,
        })),
      }),
    );
  }),
);

router.get(
  "/market/loans",
  handler(async (req, res) => {
    const parsed = ListLoansQueryParams.safeParse(req.query);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { status = "all", collateral, holder, borrower, limit = DEFAULT_LIMIT } = parsed.data;
    const filter: Filter<LoanDoc> = {};
    if (status === "closed") filter.status = { $in: ["repaid", "defaulted", "liquidated"] };
    else if (status !== "all") filter.status = status;
    const collateralIndex = collateralIndexFor(collateral);
    if (collateralIndex !== undefined) filter.collateralIndex = collateralIndex;
    const holderKey = addressFilter(holder, "holder");
    if (holderKey) filter.holder = holderKey;
    const borrowerKey = addressFilter(borrower, "borrower");
    if (borrowerKey) filter.borrower = borrowerKey;

    const { loans } = await getCollections();
    const docs = await loans.find(filter).sort({ startTime: -1, _id: -1 }).limit(limit).toArray();
    const names = await loadNames(docs.flatMap(loanAddresses));
    const now = Date.now();
    res.json(ListLoansResponse.parse(docs.map((d) => serializeLoan(d, names, now))));
  }),
);

router.get(
  "/market/loans/:id",
  handler(async (req, res) => {
    const parsed = GetLoanParams.safeParse(req.params);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { loans, events } = await getCollections();
    const doc = await loans.findOne({ _id: parsed.data.id });
    if (!doc) throw notFound(`Loan #${parsed.data.id} does not exist.`);
    const timeline = await events.find({ loanId: doc._id }).sort({ blockNumber: 1, logIndex: 1 }).toArray();
    const names = await loadNames([...loanAddresses(doc), ...timeline.flatMap(eventAddresses)]);
    res.json(
      GetLoanResponse.parse({
        ...serializeLoan(doc, names, Date.now()),
        maxRateBps: doc.maxRateBps,
        bidCount: doc.bidCount,
        timeline: timeline.map((e) => serializeEvent(e, names)),
      }),
    );
  }),
);

router.get(
  "/market/listings",
  handler(async (req, res) => {
    const parsed = ListListingsQueryParams.safeParse(req.query);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { collateral, sort = "yield", limit = DEFAULT_LIMIT } = parsed.data;
    const filter: Filter<LoanDoc> = { status: "active", listing: { $ne: null } };
    const collateralIndex = collateralIndexFor(collateral);
    if (collateralIndex !== undefined) filter.collateralIndex = collateralIndex;
    const { loans } = await getCollections();
    const docs = await loans.find(filter).toArray();
    const names = await loadNames(docs.flatMap(loanAddresses));
    const now = Date.now();
    const listings = docs.map((d) => serializeListing(d, names, now));
    const sorters: Record<string, (a: (typeof listings)[number], b: (typeof listings)[number]) => number> = {
      yield: (a, b) => (b.yieldToMaturityBps ?? -Infinity) - (a.yieldToMaturityBps ?? -Infinity),
      price: (a, b) => a.price - b.price,
      maturity: (a, b) => a.loan.maturity.getTime() - b.loan.maturity.getTime(),
      newest: (a, b) => b.listedAt.getTime() - a.listedAt.getTime(),
    };
    listings.sort(sorters[sort] ?? sorters.yield);
    res.json(ListListingsResponse.parse(listings.slice(0, limit)));
  }),
);

router.get(
  "/market/activity",
  handler(async (req, res) => {
    const parsed = ListActivityQueryParams.safeParse(req.query);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { address, loanId, limit = 30 } = parsed.data;
    const filter: Filter<EventDoc> = {};
    const addressKey = addressFilter(address, "address");
    if (addressKey) filter.$or = [{ actor: addressKey }, { counterparty: addressKey }];
    if (loanId !== undefined) filter.loanId = loanId;
    const { events } = await getCollections();
    const sort: Sort = { blockNumber: -1, logIndex: -1 };
    const docs = await events.find(filter).sort(sort).limit(limit).toArray();
    const names = await loadNames(docs.flatMap(eventAddresses));
    res.json(ListActivityResponse.parse(docs.map((d) => serializeEvent(d, names))));
  }),
);

router.get(
  "/market/rates",
  handler(async (req, res) => {
    const parsed = ListRatesQueryParams.safeParse(req.query);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { collateral, limit = 100 } = parsed.data;
    const filter: Filter<LoanDoc> = {};
    const collateralIndex = collateralIndexFor(collateral);
    if (collateralIndex !== undefined) filter.collateralIndex = collateralIndex;
    const { loans } = await getCollections();
    const docs = await loans.find(filter).sort({ startTime: -1, _id: -1 }).limit(limit).toArray();
    res.json(
      ListRatesResponse.parse(
        docs.reverse().map((l) => ({
          loanId: l._id,
          rateBps: l.rateBps,
          duration: durationOf(l),
          principal: usdc(l.principal),
          collateralSymbol: collateralOf(l.collateralIndex).symbol,
          timestamp: l.startTime,
        })),
      ),
    );
  }),
);

router.get(
  "/market/curve",
  handler(async (_req, res) => {
    const { loans } = await getCollections();
    const docs = await loans.find({}).toArray();
    const buckets = CURVE_BUCKETS.map((b) => ({ ...b, loans: [] as LoanDoc[] }));
    for (const loan of docs) {
      const duration = durationOf(loan);
      const bucket = buckets.find((b) => duration <= b.maxDuration) ?? buckets[buckets.length - 1]!;
      bucket.loans.push(loan);
    }
    res.json(
      GetRateCurveResponse.parse(
        buckets.map((b) => ({
          label: b.label,
          maxDuration: b.maxDuration,
          averageRateBps: weightedRate(b.loans),
          minRateBps: b.loans.length ? Math.min(...b.loans.map((l) => l.rateBps)) : null,
          maxRateBps: b.loans.length ? Math.max(...b.loans.map((l) => l.rateBps)) : null,
          loans: b.loans.length,
          volume: b.loans.reduce((sum, l) => sum + usdc(l.principal), 0),
        })),
      ),
    );
  }),
);

router.get(
  "/market/leaderboard",
  handler(async (_req, res) => {
    const { loans } = await getCollections();
    const docs = await loans.find({}).toArray();
    const rank = (key: "lender" | "borrower") => {
      const groups = new Map<string, LoanDoc[]>();
      for (const loan of docs) groups.set(loan[key], [...(groups.get(loan[key]) ?? []), loan]);
      return [...groups.entries()]
        .map(([address, group]) => ({
          address,
          volume: group.reduce((sum, l) => sum + usdc(l.principal), 0),
          loans: group.length,
          averageRateBps: weightedRate(group),
        }))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 10);
    };
    const lenders = rank("lender");
    const borrowers = rank("borrower");
    const names = await loadNames([...lenders, ...borrowers].map((e) => e.address));
    const withNames = (entries: typeof lenders) =>
      entries.map((e) => ({ ...e, address: checksum(e.address), name: names.get(e.address) ?? null }));
    res.json(GetLeaderboardResponse.parse({ lenders: withNames(lenders), borrowers: withNames(borrowers) }));
  }),
);

export default router;
