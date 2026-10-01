import { deployment, PROTOCOL, type CollateralInfo } from "@workspace/contracts";
import { errorSummary, publicClient } from "./chain";
import { logger } from "./logger";

const HERMES_URL = (process.env.PYTH_HERMES_URL || "https://pyth.dourolabs.app/hermes").replace(/\/$/, "");
const HERMES_INTERVAL_MS = 10_000;
const ONCHAIN_INTERVAL_MS = 30_000;
/** Hermes counts as live if its last successful response is this recent. */
const LIVE_WINDOW_MS = 60_000;

const pythAbi = [
  {
    type: "function",
    name: "getPriceUnsafe",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export interface Quote {
  symbol: string;
  feed: string;
  priceId: string;
  price: number;
  confidence: number;
  publishTime: Date;
  source: "hermes" | "onchain";
  stale: boolean;
}

export interface SignedUpdate {
  symbol: string;
  priceId: string;
  price: number;
  publishTime: Date;
  updateData: string[];
}

interface HermesResponse {
  binary: { encoding: string; data: string[] };
  parsed?: Array<{ id: string; price: { price: string; conf: string; expo: number; publish_time: number } }>;
}

export class PricesUnavailableError extends Error {}

const quotes = new Map<string, Quote>();
let lastHermesSuccess = 0;
let timer: NodeJS.Timeout | null = null;

const strip = (id: string) => id.toLowerCase().replace(/^0x/, "");

function apiKey(): string | null {
  return process.env.PYTH_API_KEY || null;
}

function scaled(value: string | bigint, expo: number): number {
  return Number(value) * 10 ** expo;
}

function isStale(publishTime: Date): boolean {
  return Date.now() - publishTime.getTime() > PROTOCOL.MAX_PRICE_AGE * 1000;
}

async function fetchHermes(priceIds: string[]): Promise<HermesResponse> {
  const key = apiKey();
  if (!key) throw new PricesUnavailableError("Live Pyth prices are not configured.");
  const params = new URLSearchParams();
  for (const id of priceIds) params.append("ids[]", id);
  params.set("parsed", "true");
  params.set("encoding", "hex");
  const response = await fetch(`${HERMES_URL}/v2/updates/price/latest?${params.toString()}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new PricesUnavailableError(`Hermes responded with ${response.status}`);
  return (await response.json()) as HermesResponse;
}

function quoteFromHermes(collateral: CollateralInfo, data: HermesResponse): Quote | null {
  const entry = data.parsed?.find((p) => strip(p.id) === strip(collateral.priceId));
  if (!entry) return null;
  const publishTime = new Date(entry.price.publish_time * 1000);
  return {
    symbol: collateral.symbol,
    feed: collateral.feed,
    priceId: collateral.priceId,
    price: scaled(entry.price.price, entry.price.expo),
    confidence: scaled(entry.price.conf, entry.price.expo),
    publishTime,
    source: "hermes",
    stale: isStale(publishTime),
  };
}

async function refreshFromHermes(): Promise<boolean> {
  try {
    const data = await fetchHermes(deployment.collaterals.map((c) => c.priceId));
    for (const collateral of deployment.collaterals) {
      const quote = quoteFromHermes(collateral, data);
      if (quote) quotes.set(collateral.symbol, quote);
    }
    lastHermesSuccess = Date.now();
    return true;
  } catch (error) {
    logger.warn({ err: errorSummary(error) }, "Hermes price refresh failed");
    return false;
  }
}

async function refreshFromChain(): Promise<void> {
  await Promise.all(
    deployment.collaterals.map(async (collateral) => {
      try {
        const p = await publicClient.readContract({
          address: deployment.pyth,
          abi: pythAbi,
          functionName: "getPriceUnsafe",
          args: [collateral.priceId],
        });
        const publishTime = new Date(Number(p.publishTime) * 1000);
        quotes.set(collateral.symbol, {
          symbol: collateral.symbol,
          feed: collateral.feed,
          priceId: collateral.priceId,
          price: scaled(p.price, p.expo),
          confidence: scaled(p.conf, p.expo),
          publishTime,
          source: "onchain",
          stale: isStale(publishTime),
        });
      } catch (error) {
        logger.warn({ symbol: collateral.symbol, err: errorSummary(error) }, "Onchain price read failed");
      }
    }),
  );
}

async function refresh(): Promise<void> {
  const live = apiKey() ? await refreshFromHermes() : false;
  if (!live) await refreshFromChain();
}

export async function startPriceService(): Promise<void> {
  await refresh();
  const loop = () => {
    timer = setTimeout(async () => {
      await refresh();
      loop();
    }, apiKey() ? HERMES_INTERVAL_MS : ONCHAIN_INTERVAL_MS);
  };
  loop();
  logger.info({ source: livePricesAvailable() ? "hermes" : "onchain", quotes: quotes.size }, "Price service started");
}

export function stopPriceService(): void {
  if (timer) clearTimeout(timer);
}

/** Staleness depends on the publish time, so it is recomputed whenever a quote is read. */
function current(quote: Quote | undefined): Quote | null {
  return quote ? { ...quote, stale: isStale(quote.publishTime) } : null;
}

/** True when Hermes answered recently and at least one of its prices is fresh. */
export function livePricesAvailable(): boolean {
  if (!apiKey() || Date.now() - lastHermesSuccess >= LIVE_WINDOW_MS) return false;
  return [...quotes.values()].some((q) => q.source === "hermes" && !isStale(q.publishTime));
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
 * Signed updates are shared so bursts of requests make one Hermes call: a pending request is
 * always reused, and a resolved one for a few seconds after it arrived.
 */
const UPDATE_SHARE_MS = 3_000;
const sharedUpdates = new Map<string, { resolvedAt: number | null; promise: Promise<SignedUpdate> }>();

/** Fresh signed update for one collateral feed, to pass to liquidate(). */
export function signedUpdate(collateral: CollateralInfo): Promise<SignedUpdate> {
  const key = collateral.priceId;
  const shared = sharedUpdates.get(key);
  if (shared && (shared.resolvedAt === null || Date.now() - shared.resolvedAt < UPDATE_SHARE_MS)) return shared.promise;
  const entry: { resolvedAt: number | null; promise: Promise<SignedUpdate> } = { resolvedAt: null, promise: fetchSignedUpdate(collateral) };
  sharedUpdates.set(key, entry);
  entry.promise.then(
    () => {
      entry.resolvedAt = Date.now();
    },
    () => {
      if (sharedUpdates.get(key) === entry) sharedUpdates.delete(key);
    },
  );
  return entry.promise;
}

async function fetchSignedUpdate(collateral: CollateralInfo): Promise<SignedUpdate> {
  const data = await fetchHermes([collateral.priceId]);
  const quote = quoteFromHermes(collateral, data);
  if (!quote || !data.binary?.data?.length) throw new PricesUnavailableError("Hermes returned no update for this feed.");
  lastHermesSuccess = Date.now();
  quotes.set(collateral.symbol, quote);
  return {
    symbol: collateral.symbol,
    priceId: collateral.priceId,
    price: quote.price,
    publishTime: quote.publishTime,
    updateData: data.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`)),
  };
}
