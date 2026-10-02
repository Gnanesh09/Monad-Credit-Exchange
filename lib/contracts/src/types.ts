export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface AssetInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  /** Amount handed out per faucet call, in display units. */
  drip: string;
}

export interface CollateralInfo {
  /** Collateral type id used by the exchange. */
  index: number;
  /** Token address, or the zero address for native MON. */
  token: Address;
  symbol: string;
  name: string;
  decimals: number;
  /** RedStone data feed that prices the collateral in USD, such as "ETH". */
  feedId: string;
  /** Display name of the feed, such as "ETH/USD". */
  feed: string;
  native: boolean;
  /** Faucet drip in display units, or null for native MON. */
  drip: string | null;
}

export interface OracleInfo {
  provider: "RedStone";
  /** RedStone data service whose nodes the exchange trusts. */
  dataServiceId: string;
  /** Distinct trusted signers required for each price. */
  uniqueSigners: number;
}

export interface CitrineDeployment {
  deployed: boolean;
  chainId: number;
  deployer: Address;
  deployedAt: string;
  /** First block to index from. */
  startBlock: number;
  oracle: OracleInfo;
  exchange: Address;
  asset: AssetInfo;
  collaterals: CollateralInfo[];
  transactions: Record<string, Hex>;
}
