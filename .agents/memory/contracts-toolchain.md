---
name: Contracts toolchain
description: Hardhat 2 gotchas for the Solidity package (test matchers, receipt log parsing, deploy key reuse).
---
- hardhat-chai-matchers 2.x refuses to chain async matchers (emit + changeTokenBalance). Send the tx once and run separate expects on it.
- ERC-20 and ERC-721 Transfer events share topic0; when parsing receipt logs with the exchange interface, skip logs that fail to parse.
- The deployer key is also the API keeper's signing key.
  **Why:** one funded testnet wallet runs both.
  **How to apply:** never send transactions from scripts (seed, deploy) while the API is running, or the two race on the nonce. Stop the API workflow first.
