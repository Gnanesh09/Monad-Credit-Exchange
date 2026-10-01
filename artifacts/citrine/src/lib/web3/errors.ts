import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { formatRate } from "@/lib/format";

const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  InvalidAmount: () => "Enter a valid amount.",
  InvalidDuration: () => "The loan term is outside the allowed range.",
  InvalidRate: () => "Enter a rate above 0% and at most 100%.",
  InvalidAuctionLength: () => "The auction length is outside the allowed range.",
  UnknownCollateral: () => "That collateral is not supported.",
  ValueMismatch: () => "The MON sent does not match the collateral amount.",
  NotOpen: () => "This request is no longer open.",
  AuctionClosed: () => "The auction has closed.",
  AuctionLive: () => "The auction is still running.",
  SelfBid: () => "You cannot bid on your own request.",
  RateTooHigh: (a) => `Your rate must be ${formatRate(Number(a[0]))} or lower.`,
  NoBids: () => "There are no bids yet.",
  HasBids: () => "A request with bids cannot be cancelled.",
  NotBorrower: () => "Only the borrower can do this.",
  NotActive: () => "This loan is no longer active.",
  NotDefaulted: () => "The loan is not past its grace period yet.",
  Healthy: (a) => `The loan is healthy (LTV ${formatRate(Number(a[0]))}), so it cannot be liquidated.`,
  NotPositionOwner: () => "You do not hold this position.",
  NotListed: () => "This position is not for sale.",
  PriceAboveMax: () => "The price changed. Review it and try again.",
  OwnListing: () => "You cannot buy your own listing.",
  BadPrice: () => "The oracle returned an invalid price.",
  InsufficientFee: () => "The oracle update fee was not covered.",
  NothingToClaim: () => "There is nothing to claim.",
  FaucetCoolingDown: () => "You can use the faucet once an hour.",
  ERC20InsufficientBalance: () => "Your token balance is too low.",
  ERC20InsufficientAllowance: () => "The token approval is too low.",
  StalePrice: () => "The oracle price is stale. A fresh price update is needed.",
};

/** Human readable message for a wallet, RPC or contract error. */
export function readableError(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && MESSAGES[name]) return MESSAGES[name](revert.data?.args ?? []);
      if (revert.reason) return revert.reason;
    }
    if (/insufficient funds/i.test(error.message)) return "Not enough MON to pay for gas.";
    return error.shortMessage || error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
