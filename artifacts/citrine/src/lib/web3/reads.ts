"use client";

import { useMemo } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { faucetTokenAbi } from "@workspace/contracts";
import { monadTestnet } from "./config";
import { asset, collaterals, exchangeContract, faucetTokens, NATIVE } from "./contracts";

export interface TokenAmount {
  symbol: string;
  token: Address;
  decimals: number;
  raw: bigint;
  value: number;
}

/** Tokens the exchange can owe an account: the loan asset plus every collateral. */
const claimTokens = [
  { token: asset.address, symbol: asset.symbol, decimals: asset.decimals },
  ...collaterals.map((c) => ({ token: c.token, symbol: c.symbol, decimals: c.decimals })),
];

function amount(token: Address, symbol: string, decimals: number, raw: bigint): TokenAmount {
  return { token, symbol, decimals, raw, value: Number(formatUnits(raw, decimals)) };
}

/**
 * Live onchain state for the connected wallet: balances, amounts claimable from the
 * exchange and faucet cooldowns. Refreshes every few seconds and after every transaction.
 */
export function useWalletState() {
  const { address } = useAccount();
  const enabled = !!address;

  const native = useBalance({ address, chainId: monadTestnet.id, query: { enabled, refetchInterval: 6_000 } });

  const contracts = useMemo(() => {
    if (!address) return [];
    return [
      ...faucetTokens.map((t) => ({ address: t.address, abi: faucetTokenAbi, functionName: "balanceOf" as const, args: [address] as const, chainId: monadTestnet.id })),
      ...faucetTokens.map((t) => ({ address: t.address, abi: faucetTokenAbi, functionName: "nextDripAt" as const, args: [address] as const, chainId: monadTestnet.id })),
      ...claimTokens.map((t) => ({ ...exchangeContract, functionName: "claimable" as const, args: [t.token, address] as const, chainId: monadTestnet.id })),
    ];
  }, [address]);

  const reads = useReadContracts({ contracts, allowFailure: true, query: { enabled, refetchInterval: 6_000 } });

  return useMemo(() => {
    const results = reads.data ?? [];
    const valueAt = (i: number): bigint => {
      const r = results[i];
      return r && r.status === "success" ? (r.result as bigint) : 0n;
    };
    const n = faucetTokens.length;
    const balances: Record<string, TokenAmount> = {};
    balances.MON = amount(NATIVE, "MON", 18, native.data?.value ?? 0n);
    faucetTokens.forEach((t, i) => {
      balances[t.symbol] = amount(t.address, t.symbol, t.decimals, valueAt(i));
    });
    const nextDripAt: Record<string, number> = {};
    faucetTokens.forEach((t, i) => {
      nextDripAt[t.symbol] = Number(valueAt(n + i)) * 1000;
    });
    const claimable = claimTokens
      .map((t, i) => amount(t.token, t.symbol, t.decimals, valueAt(2 * n + i)))
      .filter((c) => c.raw > 0n);
    return {
      address,
      connected: enabled,
      loading: enabled && (native.isLoading || reads.isLoading),
      balances,
      nextDripAt,
      claimable,
      refetch: () => {
        void native.refetch();
        void reads.refetch();
      },
    };
  }, [address, enabled, native, reads]);
}
