"use client";

import { formatUnits, parseUnits } from "viem";
import { owedAt, PROTOCOL } from "@workspace/contracts";
import { useGetPrices, getGetPricesQueryKey, type PriceQuote } from "@workspace/api-client-react";
import { collaterals, collateralBySymbol } from "@/lib/web3/contracts";

export const LIVE = 4_000;

/** Display number to raw units without float noise. */
export function toRaw(value: number | string, decimals: number): bigint {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return parseUnits(n.toFixed(Math.min(decimals, 8)), decimals);
}

/** Debt accruing to the second, as the contract computes it. */
export function liveOwed(principal: number, rateBps: number, startIso: string, nowMs: number, capIso?: string): number {
  const start = Math.floor(new Date(startIso).getTime() / 1000);
  let now = Math.floor(nowMs / 1000);
  if (capIso) now = Math.min(now, Math.floor(new Date(capIso).getTime() / 1000));
  return Number(formatUnits(owedAt(toRaw(principal, 6), rateBps, start, now), 6));
}

export function liquidationPrice(owed: number, collateralAmount: number): number | null {
  if (!collateralAmount) return null;
  return owed / ((PROTOCOL.LIQUIDATION_LTV_BPS / PROTOCOL.BPS) * collateralAmount);
}

export function usePriceMap() {
  const q = useGetPrices({ query: { queryKey: getGetPricesQueryKey(), refetchInterval: LIVE } });
  const map: Record<string, PriceQuote | undefined> = {};
  for (const c of collaterals) {
    map[c.symbol] =
      q.data?.find((p) => p.feedId === c.feedId) ?? q.data?.find((p) => p.symbol === c.symbol);
  }
  return { ...q, map };
}

export function collateralDecimals(symbol: string): number {
  return collateralBySymbol(symbol)?.decimals ?? 18;
}

export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const TERM_PRESETS = [
  { label: "5 min", s: 300 },
  { label: "15 min", s: 900 },
  { label: "1 hour", s: 3_600 },
  { label: "1 day", s: 86_400 },
  { label: "7 days", s: 604_800 },
  { label: "30 days", s: 2_592_000 },
  { label: "90 days", s: 7_776_000 },
  { label: "1 year", s: 31_536_000 },
];

export const AUCTION_PRESETS = [
  { label: "1 min", s: 60 },
  { label: "3 min", s: 180 },
  { label: "10 min", s: 600 },
  { label: "1 hour", s: 3_600 },
  { label: "1 day", s: 86_400 },
  { label: "7 days", s: 604_800 },
];
