// Deploys the Citrine contracts to Monad testnet and records the addresses in
// src/deployments.ts. Run with: pnpm --filter @workspace/contracts run deploy:testnet
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const { ethers, network } = hre;

// Liquidations use RedStone prices delivered in calldata, signed by the primary production
// nodes that CitrineExchange trusts (PrimaryProdDataServiceConsumerBase).
const ORACLE = { provider: "RedStone", dataServiceId: "redstone-primary-prod", uniqueSigners: 3 };
const FEEDS = { MON: "MON", ETH: "ETH", BTC: "BTC" };
const PRICES_URL = "https://api.redstone.finance/prices";

const TOKENS = [
  { key: "usdc", name: "Test USD Coin", symbol: "tUSDC", decimals: 6, drip: "10000" },
  { key: "weth", name: "Test Wrapped Ether", symbol: "tWETH", decimals: 18, drip: "5" },
  { key: "wbtc", name: "Test Wrapped Bitcoin", symbol: "tWBTC", decimals: 8, drip: "0.25" },
];

const MIN_BALANCE = ethers.parseEther("1.5");
const OUT = path.join(__dirname, "..", "src", "deployments.ts");

async function deploy(factoryName, args, label) {
  const factory = await ethers.getContractFactory(factoryName);
  const tx = await factory.getDeployTransaction(...args);
  const estimate = await ethers.provider.estimateGas({ ...tx, from: (await ethers.getSigners())[0].address });
  // Monad bills the gas limit, so keep the headroom small.
  const gasLimit = (estimate * 115n) / 100n;
  const contract = await factory.deploy(...args, { gasLimit });
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  console.log(`  ${label.padEnd(18)} ${address}  block ${receipt.blockNumber}  gas ${receipt.gasUsed}`);
  return { contract, address, receipt };
}

// Refuses to deploy against a feed RedStone does not currently publish.
async function checkFeeds() {
  const symbols = Object.values(FEEDS).join(",");
  const response = await fetch(`${PRICES_URL}?symbols=${symbols}&provider=${ORACLE.dataServiceId}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`RedStone prices API responded with ${response.status}.`);
  const prices = await response.json();
  for (const feed of Object.values(FEEDS)) {
    const p = prices[feed];
    if (!p || !(p.value > 0)) throw new Error(`RedStone publishes no ${feed} price on ${ORACLE.dataServiceId}.`);
    console.log(`  ${`${feed}/USD`.padEnd(18)} $${p.value}  ${Math.round((Date.now() - p.timestamp) / 1000)} s old`);
  }
}

async function main() {
  if (network.name !== "monadTestnet") {
    throw new Error(`Refusing to write deployments for network "${network.name}". Use --network monadTestnet.`);
  }
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("DEPLOYER_PRIVATE_KEY is missing or is not a 32-byte hex private key.");
  }
  const deployer = signers[0];
  const { chainId } = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer ${deployer.address} on chain ${chainId}, balance ${ethers.formatEther(balance)} MON`);
  if (balance < MIN_BALANCE) {
    throw new Error(`Deployer needs at least ${ethers.formatEther(MIN_BALANCE)} MON for gas.`);
  }

  console.log("RedStone feeds");
  await checkFeeds();

  const tokens = {};
  for (const t of TOKENS) {
    tokens[t.key] = {
      ...t,
      ...(await deploy("FaucetToken", [t.name, t.symbol, t.decimals, ethers.parseUnits(t.drip, t.decimals)], t.symbol)),
    };
  }

  const collaterals = [
    { token: ethers.ZeroAddress, feedId: ethers.encodeBytes32String(FEEDS.MON) },
    { token: tokens.weth.address, feedId: ethers.encodeBytes32String(FEEDS.ETH) },
    { token: tokens.wbtc.address, feedId: ethers.encodeBytes32String(FEEDS.BTC) },
  ];
  const exchange = await deploy("CitrineExchange", [tokens.usdc.address, collaterals], "CitrineExchange");

  const registered = await exchange.contract.collateralTypes();
  const deployment = {
    deployed: true,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    startBlock: Math.min(...Object.values(tokens).map((t) => t.receipt.blockNumber), exchange.receipt.blockNumber),
    oracle: ORACLE,
    exchange: exchange.address,
    asset: {
      address: tokens.usdc.address,
      name: tokens.usdc.name,
      symbol: tokens.usdc.symbol,
      decimals: tokens.usdc.decimals,
      drip: tokens.usdc.drip,
    },
    collaterals: registered.map((c, i) => {
      const token = Object.values(tokens).find((t) => t.address === c.token);
      const feedId = ethers.decodeBytes32String(c.feedId);
      return {
        index: i,
        token: c.token,
        symbol: c.symbol,
        name: token ? token.name : "Monad",
        decimals: Number(c.decimals),
        feedId,
        feed: `${feedId}/USD`,
        native: c.token === ethers.ZeroAddress,
        drip: token ? token.drip : null,
      };
    }),
    transactions: {
      tUSDC: tokens.usdc.receipt.hash,
      tWETH: tokens.weth.receipt.hash,
      tWBTC: tokens.wbtc.receipt.hash,
      CitrineExchange: exchange.receipt.hash,
    },
  };

  const body = `// Written by scripts/deploy.cjs. Do not edit by hand.\nimport type { CitrineDeployment } from "./types";\n\nexport const deployment: CitrineDeployment = ${JSON.stringify(deployment, null, 2)};\n`;
  fs.writeFileSync(OUT, body);
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);

  const spent = balance - (await ethers.provider.getBalance(deployer.address));
  console.log(`Spent ${ethers.formatEther(spent)} MON`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
