// Seeds the testnet market with real onchain activity from team-controlled demo wallets:
// settled loans, a repayment, a default, secondary sales and a few live auctions.
// Every action is an ordinary transaction against the deployed exchange.
//
// Run with: pnpm --filter @workspace/contracts run seed:testnet
// Wallets are derived from DEPLOYER_PRIVATE_KEY; the deployer only funds them with gas.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const RPC_URL = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
const GAS_TOPUP = ethers.parseEther("0.6");
const MIN_GAS_BALANCE = ethers.parseEther("0.3");
const LIVE_AUCTION_HOURS = Number(process.env.SEED_AUCTION_HOURS || 24);

const artifact = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`), "utf8")).abi;
const exchangeAbi = artifact("CitrineExchange");
const tokenAbi = artifact("FaucetToken");

function loadDeployment() {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "deployments.ts"), "utf8");
  const start = source.indexOf("= {") + 2;
  const end = source.lastIndexOf("}");
  return JSON.parse(source.slice(start, end + 1));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(label, contract, method, args, overrides = {}) {
  const gas = await contract[method].estimateGas(...args, overrides);
  // Monad bills the gas limit, so keep the buffer small.
  const tx = await contract[method](...args, { ...overrides, gasLimit: (gas * 115n) / 100n });
  const receipt = await tx.wait();
  console.log(`  ${label.padEnd(44)} ${receipt.hash}`);
  return receipt;
}

async function main() {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw) throw new Error("DEPLOYER_PRIVATE_KEY must be set.");
  const deployment = loadDeployment();
  if (!deployment.deployed) throw new Error("The exchange is not deployed yet.");

  const provider = new ethers.JsonRpcProvider(RPC_URL, deployment.chainId, { staticNetwork: true });
  const funder = new ethers.Wallet(raw.startsWith("0x") ? raw : `0x${raw}`, provider);
  const wallets = [1, 2, 3, 4].map(
    (i) => new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(`${funder.privateKey}:citrine-seed:${i}`)), provider),
  );
  const [ava, ben, cleo, dev] = wallets;
  console.log("Seed wallets:", wallets.map((w) => w.address).join(", "));

  const exchangeAt = (signer) => new ethers.Contract(deployment.exchange, exchangeAbi, signer);
  const collateral = Object.fromEntries(deployment.collaterals.map((c) => [c.symbol, c]));
  const usdc = (amount) => ethers.parseUnits(String(amount), deployment.asset.decimals);
  const units = (symbol, amount) => ethers.parseUnits(String(amount), collateral[symbol].decimals);
  const tokenAt = (address, signer) => new ethers.Contract(address, tokenAbi, signer);

  console.log("Gas");
  for (const wallet of wallets) {
    if ((await provider.getBalance(wallet.address)) >= MIN_GAS_BALANCE) continue;
    const tx = await funder.sendTransaction({ to: wallet.address, value: GAS_TOPUP });
    await tx.wait();
    console.log(`  topped up ${wallet.address.slice(0, 10)}`.padEnd(46), tx.hash);
  }

  console.log("Faucets and approvals");
  const needs = [
    [ava, ["tWETH"]],
    [ben, ["tWBTC", "tWETH"]],
    [cleo, ["tWBTC", "tWETH"]],
    [dev, ["tWETH"]],
  ];
  const now = () => Math.floor(Date.now() / 1000);
  for (const [wallet, symbols] of needs) {
    const tokens = [deployment.asset.address, ...symbols.map((s) => collateral[s].token)];
    for (const address of tokens) {
      const token = tokenAt(address, wallet);
      const nextDrip = Number(await token.nextDripAt(wallet.address));
      if (nextDrip <= now()) await send(`faucet ${address.slice(0, 8)} -> ${wallet.address.slice(0, 8)}`, token, "faucet", []);
      if ((await token.allowance(wallet.address, deployment.exchange)) < ethers.MaxUint256 / 2n) {
        await send(`approve ${address.slice(0, 8)} for ${wallet.address.slice(0, 8)}`, token, "approve", [deployment.exchange, ethers.MaxUint256]);
      }
    }
  }

  const iface = new ethers.Interface(exchangeAbi);
  async function request(label, borrower, symbol, amount, principal, duration, maxRateBps, auctionLength) {
    const receipt = await send(label, exchangeAt(borrower), "createRequest", [
      collateral[symbol].index,
      units(symbol, amount),
      usdc(principal),
      duration,
      maxRateBps,
      auctionLength,
    ]);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "RequestCreated") return Number(parsed.args.id);
      } catch {
        // Logs from the token contracts.
      }
    }
    throw new Error("RequestCreated event not found");
  }
  const bid = (label, lender, id, rateBps) => send(label, exchangeAt(lender), "bid", [id, rateBps]);

  async function awaitLoan(id, settler) {
    const exchange = exchangeAt(settler);
    for (let attempt = 0; attempt < 60; attempt++) {
      const r = await exchange.getRequest(id);
      if (Number(r.status) === 2) return;
      if (Number(r.status) === 1 && Number(r.auctionEnd) + 3 <= now()) {
        try {
          await send(`settle #${id}`, exchange, "settle", [id]);
          return;
        } catch {
          // The keeper may have settled it first; check again.
        }
      }
      await sleep(5_000);
    }
    throw new Error(`Request #${id} did not settle`);
  }

  console.log("Short auctions that settle into loans");
  const day = 86_400;
  const l1 = await request("ava borrows 4,000 on 2.5 tWETH, 14d", ava, "tWETH", 2.5, 4_000, 14 * day, 1_100, 60);
  await bid(`ben bids 9.50% on #${l1}`, ben, l1, 950);
  await bid(`cleo bids 8.75% on #${l1}`, cleo, l1, 875);
  const l2 = await request("ben borrows 6,000 on 0.12 tWBTC, 30d", ben, "tWBTC", 0.12, 6_000, 30 * day, 1_400, 60);
  await bid(`ava bids 12.00% on #${l2}`, ava, l2, 1_200);
  await bid(`dev bids 11.20% on #${l2}`, dev, l2, 1_120);
  const l3 = await request("dev borrows 1,500 on 1 tWETH, 1h", dev, "tWETH", 1, 1_500, 3_600, 1_000, 60);
  await bid(`ben bids 9.00% on #${l3}`, ben, l3, 900);
  const l4 = await request("cleo borrows 300 on 0.2 tWETH, 5m", cleo, "tWETH", 0.2, 300, 300, 2_000, 60);
  await bid(`dev bids 15.00% on #${l4}`, dev, l4, 1_500);

  console.log("Waiting for the auctions to close");
  for (const id of [l1, l2, l3, l4]) await awaitLoan(id, ava);

  console.log("Repayment and secondary market");
  await send(`dev repays #${l3}`, exchangeAt(dev), "repay", [l3]);
  await send(`cleo lists #${l1} at 4,004`, exchangeAt(cleo), "list", [l1, usdc(4_004)]);
  await send(`dev lists #${l2} at 6,012`, exchangeAt(dev), "list", [l2, usdc(6_012)]);
  await send(`ava buys #${l2}`, exchangeAt(ava), "buy", [l2, usdc(6_012)]);
  console.log(`  #${l4} is left unpaid; the keeper claims the default after its grace period.`);

  console.log("Live auctions");
  const hours = Math.min(Math.max(LIVE_AUCTION_HOURS, 1), 168);
  const r5 = await request("cleo requests 2,500 on 0.06 tWBTC, 7d", cleo, "tWBTC", 0.06, 2_500, 7 * day, 950, hours * 3_600);
  await bid(`ava bids 9.00% on #${r5}`, ava, r5, 900);
  await bid(`ben bids 8.40% on #${r5}`, ben, r5, 840);
  const r6 = await request("ava requests 1,200 on 1 tWETH, 3d", ava, "tWETH", 1, 1_200, 3 * day, 1_200, Math.round(hours * 0.6) * 3_600);
  await bid(`cleo bids 11.50% on #${r6}`, cleo, r6, 1_150);
  await request("ben requests 800 on 0.5 tWETH, 1d", ben, "tWETH", 0.5, 800, day, 1_500, Math.round(hours * 0.4) * 3_600);

  console.log("Done.");
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exit(1);
});
