// Written by scripts/deploy.cjs. Do not edit by hand.
import type { CitrineDeployment } from "./types";

export const deployment: CitrineDeployment = {
  "deployed": true,
  "chainId": 10143,
  "deployer": "0xd8A99C1370Dd10BB8d91D93C78c78260352ca18f",
  "deployedAt": "2026-10-01T19:35:07.267Z",
  "startBlock": 67341995,
  "pyth": "0x2880aB155794e7179c9eE2e38200202908C17B43",
  "exchange": "0x13fF594bDe49d0c15d957770D20B117C12B8B008",
  "asset": {
    "address": "0x4ea7743b9D44ed04273293C34ccED14dD70e52f7",
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
      "priceId": "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1",
      "feed": "MON/USD",
      "native": true,
      "drip": null
    },
    {
      "index": 1,
      "token": "0xC58f71ea5030C8D01B1c343aE40430087B05e9a2",
      "symbol": "tWETH",
      "name": "Test Wrapped Ether",
      "decimals": 18,
      "priceId": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
      "feed": "ETH/USD",
      "native": false,
      "drip": "5"
    },
    {
      "index": 2,
      "token": "0x470290C58748e56835362052387F9d94EB17f1fd",
      "symbol": "tWBTC",
      "name": "Test Wrapped Bitcoin",
      "decimals": 8,
      "priceId": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
      "feed": "BTC/USD",
      "native": false,
      "drip": "0.25"
    }
  ],
  "transactions": {
    "tUSDC": "0x8ed4a9efdcdca0d663d7868fe10c5e4f7378221d5d74cb66823d9903ff65498c",
    "tWETH": "0xda84dac802bea9ad728a97c89bb0e5f5290eb24eaf946d14084b3a7da1512831",
    "tWBTC": "0xebcb1ed47c376b4ec653d3db7206409b683769fd4cf3728549efd480b77a5613",
    "CitrineExchange": "0x58f161e8c51107d0ace991bfd4d5ab5ad69d8404f45780d5b6cfdb186ec850ba"
  }
};
