// Written by scripts/deploy.cjs. Do not edit by hand.
import type { CitrineDeployment } from "./types";

export const deployment: CitrineDeployment = {
  "deployed": true,
  "chainId": 10143,
  "deployer": "0xd8A99C1370Dd10BB8d91D93C78c78260352ca18f",
  "deployedAt": "2026-10-02T05:49:14.745Z",
  "startBlock": 67463972,
  "oracle": {
    "provider": "RedStone",
    "dataServiceId": "redstone-primary-prod",
    "uniqueSigners": 3
  },
  "exchange": "0x3a4eBbA0b4944661C1428D84A37730b7a4119569",
  "asset": {
    "address": "0x4559De5D1052f5d95635355273839BB42BB4d2D6",
    "name": "Test USD Coin",
    "symbol": "tUSDC",
    "decimals": 6,
    "drip": "10000"
  },
  "collaterals": [
    {
      "index": 0,
      "token": "0x0000000000000000000000000000000000000000",
      "symbol": "MON",
      "name": "Monad",
      "decimals": 18,
      "feedId": "MON",
      "feed": "MON/USD",
      "native": true,
      "drip": null
    },
    {
      "index": 1,
      "token": "0xf00735aaf54fF0Aeed45dFdbA18D57D38840aAb3",
      "symbol": "tWETH",
      "name": "Test Wrapped Ether",
      "decimals": 18,
      "feedId": "ETH",
      "feed": "ETH/USD",
      "native": false,
      "drip": "5"
    },
    {
      "index": 2,
      "token": "0x9FD4372692B873B94088c9Ac831cDC27769744b6",
      "symbol": "tWBTC",
      "name": "Test Wrapped Bitcoin",
      "decimals": 8,
      "feedId": "BTC",
      "feed": "BTC/USD",
      "native": false,
      "drip": "0.25"
    }
  ],
  "transactions": {
    "tUSDC": "0x335966f6fd2aab64269245e8eda0ac9fa5b22a4d90b333b4fc1028e05199c93b",
    "tWETH": "0xc08b84388cd978f77af002d23ad9ee8253bfbfe3ced89ca925460e052eba95c3",
    "tWBTC": "0x5b89b909d8ac8fbbf30c5fac6b2bf055200d1cdcd7d06b98f443e3e90b7a2ede",
    "CitrineExchange": "0xd49c69615d4dcd00aab334cade66f2b2f9099e3fa92275a470acfa5f4b7865a9"
  }
};
