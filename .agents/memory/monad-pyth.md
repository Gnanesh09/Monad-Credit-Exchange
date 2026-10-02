---
name: Monad oracles and gas
description: Which price oracles work on Monad testnet without an API key, plus gas billing that affects keepers and deploy scripts.
---
- Pyth Hermes returns 401 without an API key on every signed-update route (hermes.pyth.network, hermes-beta, pyth.dourolabs.app/hermes, benchmarks latest and by timestamp); only /v2/price_feeds metadata is public. Free accounts cannot get a key (user, 2026-10-02).
- The onchain Pyth contract on Monad testnet (0x2880aB155794e7179c9eE2e38200202908C17B43) works but its stored prices are days old: getPriceUnsafe returns them, getPriceNoOlderThan reverts.
  **Why:** liquidation needs a fresh price, so Pyth without a key means liquidations cannot run.
- Keyless options checked 2026-10-02:
  - RedStone pull: gateways oracle-gateway-1/-2.a.redstone.finance, /data-packages/latest/redstone-primary-prod, no key, ~10 s old, 5 signers, has MON, ETH, BTC, USDC. evm-connector and sdk are MIT.
  - Chainlink push feeds are live on Monad testnet (ETH/USD, BTC/USD, USDC/USD; 8 decimals, 24 h heartbeat, 0.5% deviation) but there is no MON/USD. Addresses come from reference-data-directory.vercel.app/feeds-monad-testnet.json.
  - RedStone push ("Bolt") testnet feeds revert in latestRoundData with InvalidLastUpdateDetails: unusable. Stork needs a key.
- Monad charges for the gas limit, not gas used. Keep explicit gas limits tight (estimate plus ~15%).
