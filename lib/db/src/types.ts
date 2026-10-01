// Stored documents. Addresses are lowercase hex. Token amounts are raw integer
// strings in the token's smallest unit so no precision is lost.

export interface GuestDoc {
  _id: string;
  username: string;
  usernameLower: string;
  wallet: string | null;
  /** Issue time of the last accepted wallet-link message; older messages are rejected. */
  walletProofAt?: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface SessionDoc {
  /** SHA-256 of the bearer token. The token itself is never stored. */
  _id: string;
  guestId: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export type RequestStatusValue = "open" | "funded" | "cancelled" | "expired";
export type LoanStatusValue = "active" | "repaid" | "defaulted" | "liquidated";

export interface RequestDoc {
  _id: number;
  status: RequestStatusValue;
  borrower: string;
  collateralIndex: number;
  collateralAmount: string;
  principal: string;
  duration: number;
  maxRateBps: number;
  bestRateBps: number | null;
  bestBidder: string | null;
  bidCount: number;
  createdAt: Date;
  auctionEnd: Date;
  txHash: string;
  blockNumber: number;
}

export interface ListingDoc {
  seller: string;
  price: string;
  listedAt: Date;
  txHash: string;
}

export interface LoanDoc {
  _id: number;
  status: LoanStatusValue;
  borrower: string;
  lender: string;
  /** Current position owner; null after the position is burned. */
  holder: string | null;
  collateralIndex: number;
  collateralAmount: string;
  principal: string;
  rateBps: number;
  maxRateBps: number;
  bidCount: number;
  startTime: Date;
  maturity: Date;
  defaultAt: Date;
  closedAt: Date | null;
  /** Amount paid to the holder on repayment (principal plus interest). */
  repaidAmount: string | null;
  interestPaid: string | null;
  listing: ListingDoc | null;
  txHash: string;
  blockNumber: number;
}

export type EventKind =
  | "request_created"
  | "bid_placed"
  | "request_cancelled"
  | "request_expired"
  | "loan_started"
  | "loan_repaid"
  | "loan_defaulted"
  | "loan_liquidated"
  | "listed"
  | "listing_cancelled"
  | "position_sold"
  | "position_transferred";

export interface EventDoc {
  /** txHash-logIndex */
  _id: string;
  kind: EventKind;
  loanId: number;
  actor: string;
  counterparty: string | null;
  /** Raw amount in the units of `symbol`. */
  amount: string | null;
  symbol: string | null;
  decimals: number | null;
  rateBps: number | null;
  /** Auction end after a bid, for bid history. */
  auctionEnd?: Date;
  timestamp: Date;
  blockNumber: number;
  logIndex: number;
  txHash: string;
}

/** Expiring lease that elects one instance to run the indexer and keeper. */
export interface LeaseDoc {
  _id: string;
  holder: string;
  expiresAt: Date;
}

export interface MetaDoc {
  _id: string;
  /** Exchange address the cursor belongs to; a redeploy resets the index. */
  exchange?: string;
  lastBlock: number;
  headBlock: number;
  updatedAt: Date;
}
