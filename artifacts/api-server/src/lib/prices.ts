import { convertDataPackagesResponse, getSignersForDataServiceId, requestDataPackages } from "@redstone-finance/sdk";
import type { Hex } from "viem";
import { deployment, PROTOCOL, type CollateralInfo } from "@workspace/contracts";
import { errorSummary } from "./chain";
import { logger } from "./logger";

/**
 * Collateral prices come from RedStone's primary production data service, the same nodes the
 * exchange trusts onchain. Display quotes are read from RedStone's light prices API every few
 * seconds. Liquidations need signed data packages instead: those are fetched on demand from the
 * RedStone gateways and appended to the liquidate calldata, where the contract verifies the
 * signatures and takes the median.
 */
const PRICES_URL = (process.env.REDSTONE_PRICES_URL || "https://api.redstone.finance/prices").replace(/\/$/, "");
const REFRESH_MS = 10_000;
/** Prices count as live if the last successful refresh is this recent. */
const LIVE_WINDOW_MS = 60_000;

const { dataServiceId, uniqueSigners } = deployment.oracle;
const authorizedSigners = getSignersForDataServiceId(dataServiceId as Parameters<typeof getSignersForDataServiceId>[0]);

export interface Quote {
  symbol: string;
  feed: string;
  feedId: string;
  price: number;
  publishTime: Date;
  source: "redstone";
  stale: boolean;
}

export interface SignedPrice {
  symbol: string;
  feedId: string;
  /** Median of the signed values, which is what the contract uses. */
  price: number;
  publishTime: Date;
  signers: string[];
  /** RedStone payload to append to the liquidate calldata. */
  payload: Hex;
}

interface PricesApiEntry {
  value?: unknown;
  timestamp?: unknown;
}

export class PricesUnavailableError extends Error {}

const quotes = new Map<string, Quote>();
let lastSuccess = 0;
let timer: NodeJS.Timeout | null = null;

function isStale(publishTime: Date): boolean {
  return Date.now() - publishTime.getTime() > PROTOCOL.MAX_PRICE_AGE * 1000;
}

/** Keeps the newest price seen for a collateral, from either source. */
function remember(collateral: CollateralInfo, price: number, publishTime: Date): void {
  const known = quotes.get(collateral.symbol);
  if (known && known.publishTime > publishTime) return;
  quotes.set(collateral.symbol, {
    symbol: collateral.symbol,
    feed: collateral.feed,
    feedId: collateral.feedId,
    price,
    publishTime,
    source: "redstone",
    stale: isStale(publishTime),
  });
}

/** Same aggregation as the RedStone contracts: the middle value, or the mean of the middle two. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function refreshFromPricesApi(): Promise<boolean> {
  const symbols = deployment.collaterals.map((c) => c.feedId).join(",");
  const response = await fetch(`${PRICES_URL}?symbols=${encodeURIComponent(symbols)}&provider=${dataServiceId}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`RedStone prices API responded with ${response.status}`);
  const data = (await response.json()) as Record<string, PricesApiEntry | undefined>;
  let updated = 0;
  for (const collateral of deployment.collaterals) {
    const entry = data[collateral.feedId];
    if (typeof entry?.value !== "number" || !(entry.value > 0) || typeof entry.timestamp !== "number") continue;
    remember(collateral, entry.value, new Date(entry.timestamp));
    updated++;
  }
  return updated > 0;
}

async function refresh(): Promise<void> {
  try {
    if (await refreshFromPricesApi()) {
      lastSuccess = Date.now();
      return;
    }
    logger.warn("RedStone prices API returned no usable prices");
  } catch (error) {
    logger.warn({ err: errorSummary(error) }, "RedStone price refresh failed");
  }
  // Fall back to the signed packages, which carry the same prices.
  await Promise.allSettled(deployment.collaterals.map((c) => signedPrice(c)));
}

export async function startPriceService(): Promise<void> {
  await refresh();
  const loop = () => {
    timer = setTimeout(async () => {
      await refresh();
      loop();
    }, REFRESH_MS);
  };
  loop();
  logger.info({ source: "redstone", dataServiceId, quotes: quotes.size, live: livePricesAvailable() }, "Price service started");
}

export function stopPriceService(): void {
  if (timer) clearTimeout(timer);
}

/** Staleness depends on the publish time, so it is recomputed whenever a quote is read. */
function current(quote: Quote | undefined): Quote | null {
  return quote ? { ...quote, stale: isStale(quote.publishTime) } : null;
}

/** True when RedStone answered recently and at least one of its prices is fresh. */
export function livePricesAvailable(): boolean {
  if (Date.now() - lastSuccess >= LIVE_WINDOW_MS) return false;
  return [...quotes.values()].some((q) => !isStale(q.publishTime));
}

export function allQuotes(): Quote[] {
  return deployment.collaterals.map((c) => current(quotes.get(c.symbol))).filter((q): q is Quote => !!q);
}

/** USD price of a collateral symbol for display, or null when no quote is available. */
export function priceOf(symbol: string): number | null {
  return quotes.get(symbol)?.price ?? null;
}

/** Quote young enough for the contract to accept (MAX_PRICE_AGE), or null. */
export function freshQuote(symbol: string): Quote | null {
  const quote = current(quotes.get(symbol));
  return quote && !quote.stale ? quote : null;
}

/**
 * Signed prices are shared so bursts of requests make one gateway call: a pending request is
 * always reused, and a resolved one for a few seconds after it arrived.
 */
const SHARE_MS = 3_000;
const shared = new Map<string, { resolvedAt: number | null; promise: Promise<SignedPrice> }>();

/** Fresh signed price for one collateral feed, ready to append to liquidate(). */
export function signedPrice(collateral: CollateralInfo): Promise<SignedPrice> {
  const key = collateral.feedId;
  const known = shared.get(key);
  if (known && (known.resolvedAt === null || Date.now() - known.resolvedAt < SHARE_MS)) return known.promise;
  const entry: { resolvedAt: number | null; promise: Promise<SignedPrice> } = { resolvedAt: null, promise: fetchSignedPrice(collateral) };
  shared.set(key, entry);
  entry.promise.then(
    () => {
      entry.resolvedAt = Date.now();
    },
    () => {
      if (shared.get(key) === entry) shared.delete(key);
    },
  );
  return entry.promise;
}

function numericValue(point: { toObj(): unknown }): number {
  const value = (point.toObj() as { value?: unknown }).value;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new PricesUnavailableError("RedStone returned a price that is not a positive number.");
  return n;
}

async function fetchSignedPrice(collateral: CollateralInfo): Promise<SignedPrice> {
  let response: Awaited<ReturnType<typeof requestDataPackages>>;
  try {
    response = await requestDataPackages({
      dataServiceId,
      dataPackagesIds: [collateral.feedId],
      uniqueSignersCount: uniqueSigners,
      authorizedSigners,
    });
  } catch (error) {
    throw new PricesUnavailableError(`RedStone gateways returned no signed ${collateral.feedId} price: ${errorSummary(error)}`);
  }
  const packages = response[collateral.feedId];
  if (!packages || packages.length < uniqueSigners) {
    throw new PricesUnavailableError(`RedStone returned too few signed ${collateral.feedId} prices.`);
  }
  const price = median(packages.map((p) => numericValue(p.dataPackage.dataPoints[0])));
  const publishTime = new Date(Math.min(...packages.map((p) => p.dataPackage.timestampMilliseconds)));
  remember(collateral, price, publishTime);
  lastSuccess = Date.now();
  const hex = convertDataPackagesResponse(response, "hex");
  return {
    symbol: collateral.symbol,
    feedId: collateral.feedId,
    price,
    publishTime,
    signers: packages.map((p) => p.recoverSignerAddress()),
    payload: (hex.startsWith("0x") ? hex : `0x${hex}`) as Hex,
  };
}
