import { formatUnits, getAddress } from "viem";
import { getCollections, type EventDoc, type LoanDoc, type RequestDoc } from "@workspace/db";
import { deployment, nextBidCeiling, owedAt, PROTOCOL, type CollateralInfo } from "@workspace/contracts";
import type { ActivityEvent, Listing, Loan, LoanRequest } from "@workspace/api-zod";
import { priceOf } from "./prices";

export const assetDecimals = deployment.asset.decimals;

export type NameMap = Map<string, string>;

export function display(raw: string | bigint | null | undefined, decimals: number): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  return Number(formatUnits(BigInt(raw), decimals));
}

export function collateralOf(index: number): CollateralInfo {
  const collateral = deployment.collaterals.find((c) => c.index === index);
  if (!collateral) throw new Error(`Unknown collateral index ${index}`);
  return collateral;
}

export function checksum(address: string): string;
export function checksum(address: string | null): string | null;
export function checksum(address: string | null): string | null {
  return address ? getAddress(address) : null;
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Maps linked wallets (lowercase) to guest usernames. */
export async function loadNames(addresses: Iterable<string | null | undefined>): Promise<NameMap> {
  const list = [...new Set([...addresses].filter((a): a is string => !!a).map((a) => a.toLowerCase()))];
  if (!list.length) return new Map();
  const { guests } = await getCollections();
  const docs = await guests.find({ wallet: { $in: list } }, { projection: { wallet: 1, username: 1 } }).toArray();
  return new Map(docs.map((d) => [d.wallet!, d.username]));
}

export function requestAddresses(doc: RequestDoc): Array<string | null> {
  return [doc.borrower, doc.bestBidder];
}

export function loanAddresses(doc: LoanDoc): Array<string | null> {
  return [doc.borrower, doc.lender, doc.holder, doc.listing?.seller ?? null];
}

export function eventAddresses(doc: EventDoc): Array<string | null> {
  return [doc.actor, doc.counterparty];
}

function collateralValue(collateral: CollateralInfo, amount: number): number | null {
  const price = priceOf(collateral.symbol);
  return price === null ? null : amount * price;
}

export function serializeRequest(doc: RequestDoc, names: NameMap, nowMs: number): LoanRequest {
  const collateral = collateralOf(doc.collateralIndex);
  const collateralAmount = display(doc.collateralAmount, collateral.decimals);
  const collateralValueUsd = collateralValue(collateral, collateralAmount);
  const principal = display(doc.principal, assetDecimals);
  const biddable = doc.status === "open" && doc.auctionEnd.getTime() > nowMs;
  return {
    id: doc._id,
    status: doc.status,
    borrower: checksum(doc.borrower),
    borrowerName: names.get(doc.borrower) ?? null,
    collateralIndex: doc.collateralIndex,
    collateralSymbol: collateral.symbol,
    collateralAmount,
    collateralValueUsd,
    principal,
    duration: doc.duration,
    maxRateBps: doc.maxRateBps,
    bestRateBps: doc.bestRateBps,
    bestBidder: checksum(doc.bestBidder),
    bestBidderName: doc.bestBidder ? (names.get(doc.bestBidder) ?? null) : null,
    nextBidCeilingBps: biddable ? nextBidCeiling(doc.maxRateBps, doc.bestRateBps ?? 0, doc.bidCount > 0) : 0,
    bidCount: doc.bidCount,
    ltvBps: collateralValueUsd ? Math.round((principal / collateralValueUsd) * PROTOCOL.BPS) : null,
    createdAt: doc.createdAt,
    auctionEnd: doc.auctionEnd,
    txHash: doc.txHash,
  };
}

/** Raw amount owed now, or the amount settled for closed loans. */
export function owedRaw(doc: LoanDoc, nowMs: number): bigint {
  const principal = BigInt(doc.principal);
  const start = seconds(doc.startTime);
  if (doc.status === "active") return owedAt(principal, doc.rateBps, start, Math.floor(nowMs / 1000));
  if (doc.status === "repaid" && doc.repaidAmount) return BigInt(doc.repaidAmount);
  const end = doc.closedAt ? seconds(doc.closedAt) : Math.floor(nowMs / 1000);
  return owedAt(principal, doc.rateBps, start, end);
}

export function serializeLoan(doc: LoanDoc, names: NameMap, nowMs: number): Loan {
  const collateral = collateralOf(doc.collateralIndex);
  const collateralAmount = display(doc.collateralAmount, collateral.decimals);
  const collateralValueUsd = collateralValue(collateral, collateralAmount);
  const owedNow = display(owedRaw(doc, nowMs), assetDecimals);
  const owedAtMaturity = display(
    owedAt(BigInt(doc.principal), doc.rateBps, seconds(doc.startTime), seconds(doc.maturity)),
    assetDecimals,
  );
  return {
    id: doc._id,
    status: doc.status,
    borrower: checksum(doc.borrower),
    borrowerName: names.get(doc.borrower) ?? null,
    lender: checksum(doc.lender),
    lenderName: names.get(doc.lender) ?? null,
    holder: checksum(doc.holder),
    holderName: doc.holder ? (names.get(doc.holder) ?? null) : null,
    collateralIndex: doc.collateralIndex,
    collateralSymbol: collateral.symbol,
    collateralAmount,
    collateralValueUsd,
    principal: display(doc.principal, assetDecimals),
    rateBps: doc.rateBps,
    startTime: doc.startTime,
    maturity: doc.maturity,
    defaultAt: doc.defaultAt,
    closedAt: doc.closedAt,
    owedNow,
    owedAtMaturity,
    ltvBps:
      doc.status === "active" && collateralValueUsd ? Math.round((owedNow / collateralValueUsd) * PROTOCOL.BPS) : null,
    listing: doc.listing
      ? { seller: checksum(doc.listing.seller), price: display(doc.listing.price, assetDecimals), listedAt: doc.listing.listedAt }
      : null,
  };
}

export function serializeListing(doc: LoanDoc, names: NameMap, nowMs: number): Listing {
  const loan = serializeLoan(doc, names, nowMs);
  const price = display(doc.listing!.price, assetDecimals);
  const remaining = seconds(doc.maturity) - Math.floor(nowMs / 1000);
  const yieldToMaturityBps =
    remaining > 0 && price > 0
      ? Math.round(((loan.owedAtMaturity - price) / price) * (PROTOCOL.YEAR / remaining) * PROTOCOL.BPS)
      : null;
  return {
    loanId: doc._id,
    seller: checksum(doc.listing!.seller),
    sellerName: names.get(doc.listing!.seller) ?? null,
    price,
    listedAt: doc.listing!.listedAt,
    yieldToMaturityBps,
    loan,
  };
}

export function serializeEvent(doc: EventDoc, names: NameMap): ActivityEvent {
  return {
    id: doc._id,
    kind: doc.kind,
    loanId: doc.loanId,
    actor: checksum(doc.actor),
    actorName: names.get(doc.actor) ?? null,
    counterparty: checksum(doc.counterparty),
    counterpartyName: doc.counterparty ? (names.get(doc.counterparty) ?? null) : null,
    amount: doc.amount !== null && doc.decimals !== null ? display(doc.amount, doc.decimals) : null,
    symbol: doc.symbol,
    rateBps: doc.rateBps,
    timestamp: doc.timestamp,
    blockNumber: doc.blockNumber,
    txHash: doc.txHash,
  };
}
