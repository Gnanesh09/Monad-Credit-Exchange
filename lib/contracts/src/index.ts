export { citrineExchangeAbi, faucetTokenAbi } from "./generated/abis";
export { deployment } from "./deployments";
export type { Address, AssetInfo, CitrineDeployment, CollateralInfo, Hex } from "./types";

export const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadexplorer.com",
} as const;

/** Pyth USD price feeds used to value collateral. */
export const PRICE_FEEDS = {
  MON: "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
} as const;

/** Mirrors the constants in CitrineExchange.sol. Times are in seconds. */
export const PROTOCOL = {
  BPS: 10_000,
  YEAR: 31_536_000,
  MAX_RATE_BPS: 10_000,
  MIN_BID_STEP_BPS: 5,
  MIN_DURATION: 300,
  MAX_DURATION: 31_536_000,
  MIN_AUCTION: 60,
  MAX_AUCTION: 604_800,
  EXTENSION_WINDOW: 60,
  MAX_GRACE: 86_400,
  LIQUIDATION_LTV_BPS: 8_500,
  LIQUIDATION_PENALTY_BPS: 500,
  LIQUIDATOR_BOUNTY_BPS: 50,
  MAX_PRICE_AGE: 120,
} as const;

/** Index order matches the Solidity enums. */
export const REQUEST_STATUSES = ["none", "open", "funded", "cancelled", "expired"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const LOAN_STATUSES = ["none", "active", "repaid", "defaulted", "liquidated"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

const BPS = BigInt(PROTOCOL.BPS);
const YEAR = BigInt(PROTOCOL.YEAR);

/** Simple interest rounded up, exactly as the contract computes it. */
export function quoteInterest(principal: bigint, rateBps: number | bigint, elapsedSeconds: number | bigint): bigint {
  const elapsed = BigInt(elapsedSeconds);
  if (elapsed <= 0n) return 0n;
  const numerator = principal * BigInt(rateBps) * elapsed;
  const denominator = BPS * YEAR;
  return (numerator + denominator - 1n) / denominator;
}

/** Amount owed on a loan at `nowSeconds`. */
export function owedAt(principal: bigint, rateBps: number, startTime: number, nowSeconds: number): bigint {
  return principal + quoteInterest(principal, rateBps, Math.max(0, nowSeconds - startTime));
}

export function gracePeriod(durationSeconds: number): number {
  return Math.min(Math.floor(durationSeconds / 10), PROTOCOL.MAX_GRACE);
}

/** Highest rate the next bid may carry, or 0 if no further bid is possible. */
export function nextBidCeiling(maxRateBps: number, bestRateBps: number, hasBids: boolean): number {
  if (!hasBids) return maxRateBps;
  return bestRateBps > PROTOCOL.MIN_BID_STEP_BPS ? bestRateBps - PROTOCOL.MIN_BID_STEP_BPS : 0;
}
