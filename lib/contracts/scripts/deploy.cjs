// Deploys the Citrine contracts to Monad testnet and records the addresses in
// src/deployments.ts. Run with: pnpm --filter @workspace/contracts run deploy:testnet
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const { ethers, network } = hre;

// Pyth on Monad testnet: https://docs.pyth.network/price-feeds/contract-addresses/evm
const PYTH = "0x2880aB155794e7179c9eE2e38200202908C17B43";
const FEEDS = {
  MON: "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
};

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

  const pythCode = await ethers.provider.getCode(PYTH);
  if (pythCode === "0x") throw new Error(`No Pyth contract found at ${PYTH}.`);

  const tokens = {};
  for (const t of TOKENS) {
    tokens[t.key] = {
      ...t,
      ...(await deploy("FaucetToken", [t.name, t.symbol, t.decimals, ethers.parseUnits(t.drip, t.decimals)], t.symbol)),
    };
  }

  const collaterals = [
    { token: ethers.ZeroAddress, priceId: FEEDS.MON },
    { token: tokens.weth.address, priceId: FEEDS.ETH },
    { token: tokens.wbtc.address, priceId: FEEDS.BTC },
  ];
  const exchange = await deploy("CitrineExchange", [tokens.usdc.address, PYTH, collaterals], "CitrineExchange");

  const registered = await exchange.contract.collateralTypes();
  const feedNames = ["MON/USD", "ETH/USD", "BTC/USD"];
  const deployment = {
    deployed: true,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    startBlock: Math.min(...Object.values(tokens).map((t) => t.receipt.blockNumber), exchange.receipt.blockNumber),
    pyth: PYTH,
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
      return {
        index: i,
        token: c.token,
        symbol: c.symbol,
        name: token ? token.name : "Monad",
        decimals: Number(c.decimals),
        priceId: c.priceId,
        feed: feedNames[i],
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
