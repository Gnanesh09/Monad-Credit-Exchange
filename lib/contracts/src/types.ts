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
  /** Pyth price feed id. */
  priceId: Hex;
  feed: string;
  native: boolean;
  /** Faucet drip in display units, or null for native MON. */
  drip: string | null;
}

export interface CitrineDeployment {
  deployed: boolean;
  chainId: number;
  deployer: Address;
  deployedAt: string;
  /** First block to index from. */
  startBlock: number;
  pyth: Address;
  exchange: Address;
  asset: AssetInfo;
  collaterals: CollateralInfo[];
  transactions: Record<string, Hex>;
}
