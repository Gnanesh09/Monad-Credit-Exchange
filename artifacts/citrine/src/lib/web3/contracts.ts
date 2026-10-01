import { zeroAddress, type Address } from "viem";
import { citrineExchangeAbi, deployment, faucetTokenAbi, MONAD_TESTNET, type CollateralInfo } from "@workspace/contracts";

export const isDeployed = deployment.deployed;

export const exchangeContract = { address: deployment.exchange, abi: citrineExchangeAbi } as const;

export const asset = deployment.asset;
export const collaterals: CollateralInfo[] = deployment.collaterals;

/** Tokens with a public faucet: the loan asset and the token collaterals. */
export const faucetTokens = [
  { address: asset.address, symbol: asset.symbol, name: asset.name, decimals: asset.decimals, drip: asset.drip },
  ...collaterals
    .filter((c) => !c.native)
    .map((c) => ({ address: c.token, symbol: c.symbol, name: c.name, decimals: c.decimals, drip: c.drip ?? "0" })),
];

export function collateralByIndex(index: number): CollateralInfo | undefined {
  return collaterals.find((c) => c.index === index);
}

export function collateralBySymbol(symbol: string): CollateralInfo | undefined {
  return collaterals.find((c) => c.symbol === symbol);
}

export function tokenContract(address: Address) {
  return { address, abi: faucetTokenAbi } as const;
}

export const NATIVE = zeroAddress;

export function explorerTx(hash: string): string {
  return `${MONAD_TESTNET.explorerUrl}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${MONAD_TESTNET.explorerUrl}/address/${address}`;
}

export function explorerToken(address: string, id?: number): string {
  return id === undefined
    ? `${MONAD_TESTNET.explorerUrl}/token/${address}`
    : `${MONAD_TESTNET.explorerUrl}/nft/${address}/${id}`;
}
