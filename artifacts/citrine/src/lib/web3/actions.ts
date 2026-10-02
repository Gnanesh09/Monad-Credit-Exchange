"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import {
  getPublicClient,
  readContract,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { toast } from "sonner";
import type { Abi, Address, Hash, Hex } from "viem";
import { estimateContractGas } from "viem/actions";
import type { Config } from "wagmi";
import { faucetTokenAbi } from "@workspace/contracts";
import { getPriceUpdate } from "@workspace/api-client-react";
import { formatRate } from "@/lib/format";
import { monadTestnet } from "./config";
import { asset, collateralByIndex, exchangeContract, explorerTx } from "./contracts";
import { readableError } from "./errors";

// The contract calls below are assembled at runtime from several ABIs, so the strongly
// typed wagmi signatures are widened once here.
const simulate = simulateContract as unknown as (config: Config, params: object) => Promise<{ request: object }>;
const write = writeContract as unknown as (config: Config, params: object) => Promise<Hash>;
const estimate = estimateContractGas as unknown as (client: unknown, params: object) => Promise<bigint>;

interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  /** Appended to the calldata; liquidate() reads its signed RedStone price from here. */
  dataSuffix?: Hex;
}

interface TxStep {
  title: string;
  call: ContractCall;
}

export interface TxProgress {
  label: string;
  step: number;
  total: number;
  title: string;
  phase: "wallet" | "confirming";
  hash?: Hash;
}

export interface CreateRequestInput {
  collateralIndex: number;
  /** Raw collateral amount in the collateral's smallest unit. */
  collateralAmount: bigint;
  /** Raw tUSDC amount (6 decimals). */
  principal: bigint;
  /** Loan term in seconds. */
  duration: number;
  maxRateBps: number;
  /** Auction length in seconds. */
  auctionLength: number;
}

/**
 * Wallet transactions against CitrineExchange. Each action runs its steps in order
 * (token approval first when needed), simulates before asking the wallet so reverts
 * surface as readable errors, and sets an explicit gas limit because Monad bills the limit.
 */
export function useCitrineActions() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { address, chainId } = useAccount();
  const [progress, setProgress] = useState<TxProgress | null>(null);
  // Set synchronously so a double click can't start a second flow while the first is preparing.
  const lock = useRef(false);
  const [preparing, setPreparing] = useState(false);

  const sendCall = useCallback(
    async (account: Address, call: ContractCall): Promise<Hash> => {
      const params = { ...call, account, chainId: monadTestnet.id };
      const { request } = await simulate(config, params);
      let gas: bigint | undefined;
      try {
        const client = getPublicClient(config, { chainId: monadTestnet.id });
        gas = ((await estimate(client, params)) * 115n) / 100n;
      } catch {
        gas = undefined;
      }
      return write(config, { ...request, gas });
    },
    [config],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries();
    // The indexer picks up new blocks within a few seconds.
    setTimeout(() => void queryClient.invalidateQueries(), 2_500);
    setTimeout(() => void queryClient.invalidateQueries(), 6_000);
  }, [queryClient]);

  const execute = useCallback(
    async (label: string, build: (account: Address) => Promise<TxStep[]>): Promise<Hash | undefined> => {
      if (!address) {
        toast.error("Connect a wallet first.");
        return undefined;
      }
      if (lock.current) return undefined;
      lock.current = true;
      setPreparing(true);
      const toastId = toast.loading(label, { description: "Preparing transaction" });
      try {
        if (chainId !== monadTestnet.id) {
          toast.loading(label, { id: toastId, description: "Switch to Monad Testnet in your wallet." });
          await switchChain(config, { chainId: monadTestnet.id });
        }
        const steps = await build(address);
        let lastHash: Hash | undefined;
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]!;
          const position = steps.length > 1 ? `Step ${i + 1} of ${steps.length}. ` : "";
          setProgress({ label, step: i + 1, total: steps.length, title: step.title, phase: "wallet" });
          toast.loading(step.title, { id: toastId, description: `${position}Confirm in your wallet.` });
          const hash = await sendCall(address, step.call);
          setProgress({ label, step: i + 1, total: steps.length, title: step.title, phase: "confirming", hash });
          toast.loading(step.title, { id: toastId, description: `${position}Waiting for Monad to confirm.` });
          const receipt = await waitForTransactionReceipt(config, { hash, chainId: monadTestnet.id });
          if (receipt.status !== "success") throw new Error("The transaction reverted.");
          lastHash = hash;
        }
        const finalHash = lastHash;
        toast.success(label, {
          id: toastId,
          description: "Confirmed on Monad",
          action: finalHash ? { label: "View", onClick: () => window.open(explorerTx(finalHash), "_blank", "noopener") } : undefined,
        });
        refresh();
        return finalHash;
      } catch (error) {
        toast.error(label, { id: toastId, description: readableError(error) });
        return undefined;
      } finally {
        setProgress(null);
        setPreparing(false);
        lock.current = false;
      }
    },
    [address, chainId, config, refresh, sendCall],
  );

  const approvalSteps = useCallback(
    async (token: Address, amount: bigint, symbol: string, account: Address): Promise<TxStep[]> => {
      const allowance = await readContract(config, {
        address: token,
        abi: faucetTokenAbi,
        functionName: "allowance",
        args: [account, exchangeContract.address],
        chainId: monadTestnet.id,
      });
      if (allowance >= amount) return [];
      return [
        {
          title: `Approve ${symbol}`,
          call: { address: token, abi: faucetTokenAbi, functionName: "approve", args: [exchangeContract.address, amount] },
        },
      ];
    },
    [config],
  );

  const exchangeStep = (
    title: string,
    functionName: string,
    args: readonly unknown[],
    extra: { value?: bigint; dataSuffix?: Hex } = {},
  ): TxStep => ({
    title,
    call: { address: exchangeContract.address, abi: exchangeContract.abi as Abi, functionName, args, ...extra },
  });

  const actions = useMemo(
    () => ({
      faucet: (token: Address, symbol: string) =>
        execute(`Get test ${symbol}`, async () => [
          { title: `Claim ${symbol} from the faucet`, call: { address: token, abi: faucetTokenAbi, functionName: "faucet", args: [] } },
        ]),

      createRequest: (input: CreateRequestInput) =>
        execute("Create loan request", async (account) => {
          const collateral = collateralByIndex(input.collateralIndex);
          if (!collateral) throw new Error("Unknown collateral.");
          const approve = collateral.native
            ? []
            : await approvalSteps(collateral.token, input.collateralAmount, collateral.symbol, account);
          return [
            ...approve,
            exchangeStep(
              "Post request and lock collateral",
              "createRequest",
              [input.collateralIndex, input.collateralAmount, input.principal, input.duration, input.maxRateBps, input.auctionLength],
              { value: collateral.native ? input.collateralAmount : undefined },
            ),
          ];
        }),

      bid: (id: number, rateBps: number, principal: bigint) =>
        execute(`Bid ${formatRate(rateBps)} on request #${id}`, async (account) => {
          const request = await readContract(config, { ...exchangeContract, functionName: "getRequest", args: [BigInt(id)], chainId: monadTestnet.id });
          // The leader's funds are already escrowed, so lowering their own bid moves no tokens.
          const leading = request.bestBidder.toLowerCase() === account.toLowerCase();
          return [
            ...(leading ? [] : await approvalSteps(asset.address, principal, asset.symbol, account)),
            exchangeStep(leading ? "Lower your bid" : "Place bid and escrow funds", "bid", [BigInt(id), rateBps]),
          ];
        }),

      acceptBid: (id: number) => execute("Accept best bid", async () => [exchangeStep("Accept bid and receive funds", "acceptBid", [BigInt(id)])]),

      cancelRequest: (id: number) => execute("Cancel request", async () => [exchangeStep("Cancel and unlock collateral", "cancelRequest", [BigInt(id)])]),

      settle: (id: number) => execute("Settle auction", async () => [exchangeStep("Settle auction and start loan", "settle", [BigInt(id)])]),

      expireRequest: (id: number) => execute("Close expired request", async () => [exchangeStep("Return collateral to borrower", "expireRequest", [BigInt(id)])]),

      repay: (id: number) =>
        execute("Repay loan", async (account) => {
          const [owed] = await readContract(config, {
            ...exchangeContract,
            functionName: "debtOf",
            args: [BigInt(id)],
            chainId: monadTestnet.id,
          });
          // Interest accrues every second, so approve a small buffer above the current debt.
          const allowance = owed + owed / 2_000n + 1n;
          return [
            ...(await approvalSteps(asset.address, allowance, asset.symbol, account)),
            exchangeStep("Repay and unlock collateral", "repay", [BigInt(id)]),
          ];
        }),

      list: (id: number, price: bigint) => execute("List position for sale", async () => [exchangeStep("List position", "list", [BigInt(id), price])]),

      cancelListing: (id: number) => execute("Remove listing", async () => [exchangeStep("Remove listing", "cancelListing", [BigInt(id)])]),

      buy: (id: number, price: bigint) =>
        execute(`Buy position #${id}`, async (account) => [
          ...(await approvalSteps(asset.address, price, asset.symbol, account)),
          exchangeStep("Buy position", "buy", [BigInt(id), price]),
        ]),

      claimDefault: (id: number) => execute("Claim defaulted collateral", async () => [exchangeStep("Claim collateral", "claimDefault", [BigInt(id)])]),

      liquidate: (id: number, collateralSymbol: string) =>
        execute("Liquidate loan", async () => {
          // Fetched at the last moment: the contract accepts signed prices up to two minutes old.
          const signed = await getPriceUpdate({ collateral: collateralSymbol });
          return [exchangeStep("Liquidate with a signed RedStone price", "liquidate", [BigInt(id)], { dataSuffix: signed.payload as Hex })];
        }),

      claim: (token: Address, symbol: string) => execute(`Withdraw ${symbol}`, async () => [exchangeStep(`Withdraw ${symbol}`, "claim", [token])]),
    }),
    [approvalSteps, config, execute],
  );

  return { ...actions, progress, busy: preparing || progress !== null };
}
