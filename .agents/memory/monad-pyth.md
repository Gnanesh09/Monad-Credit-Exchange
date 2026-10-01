---
name: Monad and Pyth quirks
description: Behaviour of Pyth price feeds and gas billing on Monad testnet that affects keepers, liquidation and deploy scripts.
---
- Pyth Hermes (hermes.pyth.network and pyth.dourolabs.app/hermes) returns 401 without an API key since 2026-08-26. Send Authorization: Bearer PYTH_API_KEY; base URL https://pyth.dourolabs.app/hermes, same routes.
- The onchain Pyth contract on Monad testnet (0x2880aB155794e7179c9eE2e38200202908C17B43) still works but its stored prices go stale for days. getPriceUnsafe returns the stale price; getPriceNoOlderThan reverts. Empty-update fee is 0.
  **Why:** liquidation needs a fresh signed update, which needs Hermes, which needs the key.
  **How to apply:** price display may fall back to getPriceUnsafe (label it stale); liquidation must not run on stale data.
- Monad charges for the gas limit, not gas used. Keep explicit gas limits tight (estimate plus ~15%).
