---
name: Monad oracles and gas
description: Which price oracles work on Monad testnet without an API key, why Citrine uses RedStone pull, RedStone licensing, and gas billing that affects keepers and deploy scripts.
---
- Citrine uses RedStone pull (`redstone-primary-prod`, 3 unique signers). Pyth was dropped because Hermes signed updates need an API key, which free accounts cannot get (user, 2026-10-02).
  **Why:** liquidation needs a fresh signed price; RedStone gateways are keyless and publish MON, ETH and BTC.
- RedStone licensing: package.json says MIT, but the npm packages (evm-connector, sdk, protocol) ship a BUSL-1.1 LICENSE and the core consumer contracts carry BUSL-1.1 headers; libs/ and mocks/ are MIT. BUSL allows non-production use only.
  **How to apply:** keep the README attribution accurate; a mainnet launch needs RedStone's permission.
- RedStone gotchas: pin 0.9.0 (evm-connector 1.0.0 on npm is broken). The gateway returns every feed (~400 KB gzipped) even when one is requested, so fetch signed packages only when needed and use api.redstone.finance/prices for display. `convertDataPackagesResponse(res, "hex")` returns hex without 0x.
- Other keyless options checked 2026-10-02: Chainlink push feeds exist on Monad testnet (ETH, BTC, USDC; 24 h heartbeat) but there is no MON/USD. RedStone push ("Bolt") testnet feeds revert with InvalidLastUpdateDetails. Stork needs a key. The onchain Pyth contract on Monad testnet has days-old prices.
- Monad charges for the gas limit, not gas used. Keep explicit gas limits tight (estimate plus ~15%).
