import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { MONAD_TESTNET } from "@workspace/contracts";

export const monadTestnet = defineChain({
  id: MONAD_TESTNET.id,
  name: MONAD_TESTNET.name,
  nativeCurrency: MONAD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [MONAD_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "Monad Explorer", url: MONAD_TESTNET.explorerUrl } },
  testnet: true,
});

// Injected wallets are discovered through EIP-6963 (MetaMask, Rabby, Phantom, Backpack, ...).
export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [monadTestnet.id]: http(MONAD_TESTNET.rpcUrl, { batch: true }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
