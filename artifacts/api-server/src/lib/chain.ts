import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { citrineExchangeAbi, deployment, MONAD_TESTNET } from "@workspace/contracts";
import { logger } from "./logger";

export const monadTestnet = defineChain({
  id: MONAD_TESTNET.id,
  name: MONAD_TESTNET.name,
  nativeCurrency: MONAD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [MONAD_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "Monad Explorer", url: MONAD_TESTNET.explorerUrl } },
  testnet: true,
});

const rpcUrl = process.env.MONAD_RPC_URL || MONAD_TESTNET.rpcUrl;

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(rpcUrl, { batch: { batchSize: 25, wait: 10 }, retryCount: 4, retryDelay: 500, timeout: 20_000 }),
});

export const exchange = { address: deployment.exchange, abi: citrineExchangeAbi } as const;

function loadKeeperAccount(): PrivateKeyAccount | null {
  const raw = process.env.KEEPER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  try {
    return privateKeyToAccount(key);
  } catch {
    logger.warn("Keeper key is not a valid private key; the keeper is disabled");
    return null;
  }
}

export const keeperAccount = loadKeeperAccount();

export const walletClient = keeperAccount
  ? createWalletClient({ account: keeperAccount, chain: monadTestnet, transport: http(rpcUrl, { retryCount: 2, timeout: 20_000 }) })
  : null;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Short description of an RPC or contract error for logs. */
export function errorSummary(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { shortMessage?: string; message?: string };
    return e.shortMessage || e.message || String(error);
  }
  return String(error);
}
