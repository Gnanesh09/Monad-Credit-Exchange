// Verifies the deployed contracts on Sourcify (shown on the Monad explorer).
// Run with: pnpm --filter @workspace/contracts run verify:testnet
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

function readDeployment() {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "deployments.ts"), "utf8");
  const json = source.slice(source.indexOf("= {") + 2, source.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

async function verify(label, address, constructorArguments, contract) {
  try {
    await hre.run("verify:verify", { address, constructorArguments, contract });
    console.log(`Verified ${label} at ${address}`);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/already verified/i.test(message)) console.log(`${label} is already verified`);
    else console.error(`Could not verify ${label}: ${message}`);
  }
}

async function main() {
  const d = readDeployment();
  if (!d.deployed) throw new Error("Nothing to verify: src/deployments.ts has no deployment.");
  const { parseUnits } = hre.ethers;

  const asset = d.asset;
  await verify(asset.symbol, asset.address, [asset.name, asset.symbol, asset.decimals, parseUnits(asset.drip, asset.decimals)], "contracts/FaucetToken.sol:FaucetToken");
  for (const c of d.collaterals.filter((c) => !c.native)) {
    await verify(c.symbol, c.token, [c.name, c.symbol, c.decimals, parseUnits(c.drip, c.decimals)], "contracts/FaucetToken.sol:FaucetToken");
  }
  const collaterals = d.collaterals.map((c) => [c.token, c.priceId]);
  await verify("CitrineExchange", d.exchange, [asset.address, d.pyth, collaterals], "contracts/CitrineExchange.sol:CitrineExchange");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
