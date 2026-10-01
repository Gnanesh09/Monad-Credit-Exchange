const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const MON_FEED = "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1";
const ETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

const usd = (n) => ethers.parseUnits(String(n), 6);
const mon = (n) => ethers.parseEther(String(n));
const DAY = 24 * 60 * 60;
const MON = 0; // collateral type ids, in constructor order
const WETH = 1;

const RequestStatus = { Open: 1n, Funded: 2n, Cancelled: 3n, Expired: 4n };
const LoanStatus = { Active: 1n, Repaid: 2n, Defaulted: 3n, Liquidated: 4n };

let exchangeInterface;
function findEvent(receipt, name) {
  for (const log of receipt.logs) {
    try {
      const parsed = exchangeInterface.parseLog(log);
      if (parsed && parsed.name === name) return parsed;
    } catch {
      // log from another contract
    }
  }
  throw new Error(`event ${name} not found`);
}

async function deployFixture() {
  const [deployer, borrower, lender1, lender2, buyer, keeper] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("FaucetToken");
  const usdc = await Token.deploy("Test USD Coin", "tUSDC", 6, usd(10_000));
  const weth = await Token.deploy("Test Wrapped Ether", "tWETH", 18, mon(5));
  const pyth = await (await ethers.getContractFactory("MockPyth")).deploy(60, 1);

  const exchange = await (await ethers.getContractFactory("CitrineExchange")).deploy(
    await usdc.getAddress(),
    await pyth.getAddress(),
    [
      { token: ethers.ZeroAddress, priceId: MON_FEED },
      { token: await weth.getAddress(), priceId: ETH_FEED },
    ],
  );
  const exchangeAddress = await exchange.getAddress();
  exchangeInterface = exchange.interface;

  for (const s of [borrower, lender1, lender2, buyer, keeper]) {
    await usdc.connect(s).faucet();
    await usdc.connect(s).approve(exchangeAddress, ethers.MaxUint256);
  }
  await weth.connect(borrower).faucet();
  await weth.connect(borrower).approve(exchangeAddress, ethers.MaxUint256);

  async function setPrice(feed, dollars) {
    const now = await time.latest();
    const data = await pyth.createPriceFeedUpdateData(
      feed, BigInt(Math.round(dollars * 1e8)), 100_000n, -8, BigInt(Math.round(dollars * 1e8)), 100_000n, now, now - 1,
    );
    return data;
  }

  async function pushPrice(feed, dollars) {
    const data = await setPrice(feed, dollars);
    await pyth.updatePriceFeeds([data], { value: 1 });
  }

  // Opens a MON-backed request: 1,000 tUSDC for 30 days at up to 12% APR against 800 MON.
  async function openRequest(overrides = {}) {
    const o = {
      kind: MON, collateral: mon(800), principal: usd(1_000), duration: 30 * DAY, maxRate: 1_200, auction: 3_600,
      ...overrides,
    };
    const value = o.kind === MON ? o.collateral : 0n;
    const tx = await exchange
      .connect(borrower)
      .createRequest(o.kind, o.collateral, o.principal, o.duration, o.maxRate, o.auction, { value });
    const receipt = await tx.wait();
    return findEvent(receipt, "RequestCreated").args.id;
  }

  async function fundedLoan(rate = 900) {
    const id = await openRequest();
    await exchange.connect(lender1).bid(id, rate);
    await exchange.connect(borrower).acceptBid(id);
    return id;
  }

  return {
    exchange, usdc, weth, pyth, deployer, borrower, lender1, lender2, buyer, keeper,
    openRequest, fundedLoan, setPrice, pushPrice,
  };
}

describe("CitrineExchange", function () {
  describe("deployment", function () {
    it("registers native MON and token collaterals", async function () {
      const { exchange, weth } = await loadFixture(deployFixture);
      const types = await exchange.collateralTypes();
      expect(types.length).to.equal(2);
      expect(types[0].token).to.equal(ethers.ZeroAddress);
      expect(types[0].symbol).to.equal("MON");
      expect(types[0].decimals).to.equal(18n);
      expect(types[1].token).to.equal(await weth.getAddress());
      expect(types[1].symbol).to.equal("tWETH");
      expect(await exchange.minPrincipal()).to.equal(usd(1));
    });

    it("rejects an empty collateral list", async function () {
      const { usdc, pyth } = await loadFixture(deployFixture);
      const Exchange = await ethers.getContractFactory("CitrineExchange");
      await expect(Exchange.deploy(await usdc.getAddress(), await pyth.getAddress(), [])).to.be.revertedWithCustomError(
        Exchange,
        "InvalidCollateralConfig",
      );
    });
  });

  describe("requests", function () {
    it("locks native MON collateral", async function () {
      const { exchange, borrower, openRequest } = await loadFixture(deployFixture);
      const before = await ethers.provider.getBalance(await exchange.getAddress());
      const id = await openRequest();
      const r = await exchange.getRequest(id);
      expect(r.borrower).to.equal(borrower.address);
      expect(r.status).to.equal(RequestStatus.Open);
      expect(r.collateral).to.equal(mon(800));
      expect(r.collateralType).to.equal(MON);
      expect(await ethers.provider.getBalance(await exchange.getAddress())).to.equal(before + mon(800));
    });

    it("pulls token collateral", async function () {
      const { exchange, weth, borrower, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest({ kind: WETH, collateral: mon(1) });
      expect((await exchange.getRequest(id)).collateral).to.equal(mon(1));
      expect(await weth.balanceOf(await exchange.getAddress())).to.equal(mon(1));
      expect(await weth.balanceOf(borrower.address)).to.equal(mon(4));
    });

    it("validates parameters", async function () {
      const { exchange, borrower } = await loadFixture(deployFixture);
      const c = exchange.connect(borrower);
      await expect(c.createRequest(MON, mon(1), usd(1), 3600, 1000, 600, { value: mon(2) })).to.be.revertedWithCustomError(
        exchange,
        "ValueMismatch",
      );
      await expect(c.createRequest(WETH, mon(1), usd(1), 3600, 1000, 600, { value: 1 })).to.be.revertedWithCustomError(
        exchange,
        "ValueMismatch",
      );
      await expect(c.createRequest(7, mon(1), usd(1), 3600, 1000, 600)).to.be.revertedWithCustomError(exchange, "UnknownCollateral");
      await expect(c.createRequest(MON, mon(1), usd(0.5), 3600, 1000, 600, { value: mon(1) })).to.be.revertedWithCustomError(
        exchange,
        "InvalidAmount",
      );
      await expect(c.createRequest(MON, mon(1), usd(10), 60, 1000, 600, { value: mon(1) })).to.be.revertedWithCustomError(
        exchange,
        "InvalidDuration",
      );
      await expect(c.createRequest(MON, mon(1), usd(10), 3600, 10_001, 600, { value: mon(1) })).to.be.revertedWithCustomError(
        exchange,
        "InvalidRate",
      );
      await expect(c.createRequest(MON, mon(1), usd(10), 3600, 1000, 30, { value: mon(1) })).to.be.revertedWithCustomError(
        exchange,
        "InvalidAuctionLength",
      );
    });

    it("lets the borrower cancel before any bid", async function () {
      const { exchange, borrower, lender1, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest();
      await expect(exchange.connect(lender1).cancelRequest(id)).to.be.revertedWithCustomError(exchange, "NotBorrower");
      await expect(exchange.connect(borrower).cancelRequest(id)).to.changeEtherBalance(borrower, mon(800));
      expect((await exchange.getRequest(id)).status).to.equal(RequestStatus.Cancelled);

      const id2 = await openRequest();
      await exchange.connect(lender1).bid(id2, 1000);
      await expect(exchange.connect(borrower).cancelRequest(id2)).to.be.revertedWithCustomError(exchange, "HasBids");
    });

    it("expires a request without bids after the auction", async function () {
      const { exchange, weth, borrower, keeper, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest({ kind: WETH, collateral: mon(2) });
      await expect(exchange.connect(keeper).expireRequest(id)).to.be.revertedWithCustomError(exchange, "AuctionLive");
      await time.increase(3_601);
      const tx = await exchange.connect(keeper).expireRequest(id);
      await expect(tx).to.emit(exchange, "RequestExpired").withArgs(id);
      await expect(tx).to.changeTokenBalance(weth, borrower, mon(2));
      expect((await exchange.getRequest(id)).status).to.equal(RequestStatus.Expired);
    });
  });

  describe("rate auction", function () {
    it("requires each bid to undercut the best rate and refunds the outbid lender", async function () {
      const { exchange, usdc, lender1, lender2, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest();

      await expect(exchange.connect(lender1).bid(id, 1_201)).to.be.revertedWithCustomError(exchange, "RateTooHigh").withArgs(1_200);
      await expect(exchange.connect(lender1).bid(id, 1_100)).to.changeTokenBalance(usdc, lender1, -usd(1_000));

      await expect(exchange.connect(lender2).bid(id, 1_096)).to.be.revertedWithCustomError(exchange, "RateTooHigh").withArgs(1_095);
      const tx = await exchange.connect(lender2).bid(id, 1_095);
      await expect(tx).to.emit(exchange, "BidPlaced").withArgs(id, lender2.address, 1_095, anyValue, lender1.address);
      await expect(tx).to.changeTokenBalances(usdc, [lender1, lender2], [usd(1_000), -usd(1_000)]);

      const r = await exchange.getRequest(id);
      expect(r.bestBidder).to.equal(lender2.address);
      expect(r.bestRateBps).to.equal(1_095n);
      expect(r.bidCount).to.equal(2n);
    });

    it("does not escrow twice when the best bidder improves its own rate", async function () {
      const { exchange, usdc, lender1, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest();
      await exchange.connect(lender1).bid(id, 1_000);
      await expect(exchange.connect(lender1).bid(id, 900)).to.changeTokenBalance(usdc, lender1, 0);
      expect(await usdc.balanceOf(await exchange.getAddress())).to.equal(usd(1_000));
    });

    it("blocks self-bids and bids after the close", async function () {
      const { exchange, borrower, lender1, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest();
      await expect(exchange.connect(borrower).bid(id, 1_000)).to.be.revertedWithCustomError(exchange, "SelfBid");
      await time.increase(3_601);
      await expect(exchange.connect(lender1).bid(id, 1_000)).to.be.revertedWithCustomError(exchange, "AuctionClosed");
    });

    it("extends the auction when a bid lands in the final minute", async function () {
      const { exchange, lender1, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest();
      const end = (await exchange.getRequest(id)).auctionEnd;
      await time.setNextBlockTimestamp(end - 30n);
      await exchange.connect(lender1).bid(id, 1_000);
      expect((await exchange.getRequest(id)).auctionEnd).to.equal(end - 30n + 60n);
    });

    it("settles after the auction and mints the position to the winner", async function () {
      const { exchange, usdc, borrower, lender1, keeper, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest();
      await exchange.connect(lender1).bid(id, 1_000);
      await expect(exchange.connect(keeper).settle(id)).to.be.revertedWithCustomError(exchange, "AuctionLive");
      await time.increase(3_601);
      const tx = await exchange.connect(keeper).settle(id);
      await expect(tx).to.emit(exchange, "LoanStarted");
      await expect(tx).to.changeTokenBalance(usdc, borrower, usd(1_000));

      expect(await exchange.ownerOf(id)).to.equal(lender1.address);
      const loan = await exchange.getLoan(id);
      expect(loan.status).to.equal(LoanStatus.Active);
      expect(loan.rateBps).to.equal(1_000n);
      expect(loan.maturity - loan.startTime).to.equal(BigInt(30 * DAY));
      expect((await exchange.getRequest(id)).status).to.equal(RequestStatus.Funded);
    });

    it("lets the borrower accept the best bid early", async function () {
      const { exchange, borrower, lender1, openRequest } = await loadFixture(deployFixture);
      const id = await openRequest();
      await expect(exchange.connect(borrower).acceptBid(id)).to.be.revertedWithCustomError(exchange, "NoBids");
      await exchange.connect(lender1).bid(id, 1_000);
      await expect(exchange.connect(lender1).acceptBid(id)).to.be.revertedWithCustomError(exchange, "NotBorrower");
      await exchange.connect(borrower).acceptBid(id);
      expect(await exchange.ownerOf(id)).to.equal(lender1.address);
    });
  });

  describe("repayment", function () {
    it("charges simple interest and pays the current holder", async function () {
      const { exchange, usdc, borrower, lender1, fundedLoan } = await loadFixture(deployFixture);
      const id = await fundedLoan(1_000);
      const loan = await exchange.getLoan(id);
      const repayAt = loan.startTime + BigInt(10 * DAY);
      const expectedInterest = await exchange.quoteInterest(usd(1_000), 1_000, 10 * DAY);
      expect(expectedInterest).to.equal(2_739_727n); // 1,000 * 10% * 10/365, rounded up

      await time.setNextBlockTimestamp(repayAt);
      const tx = await exchange.connect(borrower).repay(id);
      const owed = usd(1_000) + expectedInterest;
      await expect(tx)
        .to.emit(exchange, "LoanRepaid")
        .withArgs(id, borrower.address, lender1.address, owed, expectedInterest);
      await expect(tx).to.changeTokenBalances(usdc, [borrower, lender1], [-owed, owed]);
      await expect(tx).to.changeEtherBalance(borrower, mon(800), { includeFee: false });

      expect((await exchange.getLoan(id)).status).to.equal(LoanStatus.Repaid);
      await expect(exchange.ownerOf(id)).to.be.revertedWithCustomError(exchange, "ERC721NonexistentToken");
      await expect(exchange.connect(borrower).repay(id)).to.be.revertedWithCustomError(exchange, "NotActive");
    });
  });

  describe("secondary market", function () {
    it("sells a position and routes the repayment to the buyer", async function () {
      const { exchange, usdc, borrower, lender1, buyer, fundedLoan } = await loadFixture(deployFixture);
      const id = await fundedLoan(1_000);

      await expect(exchange.connect(buyer).list(id, usd(1_001))).to.be.revertedWithCustomError(exchange, "NotPositionOwner");
      await exchange.connect(lender1).list(id, usd(1_002));
      await expect(exchange.connect(lender1).buy(id, usd(1_002))).to.be.revertedWithCustomError(exchange, "OwnListing");
      await expect(exchange.connect(buyer).buy(id, usd(1_001))).to.be.revertedWithCustomError(exchange, "PriceAboveMax");

      const tx = await exchange.connect(buyer).buy(id, usd(1_002));
      await expect(tx).to.emit(exchange, "PositionSold").withArgs(id, lender1.address, buyer.address, usd(1_002));
      await expect(tx).to.changeTokenBalances(usdc, [buyer, lender1], [-usd(1_002), usd(1_002)]);
      expect(await exchange.ownerOf(id)).to.equal(buyer.address);
      expect((await exchange.getListing(id)).seller).to.equal(ethers.ZeroAddress);

      const before = await usdc.balanceOf(buyer.address);
      await exchange.connect(borrower).repay(id);
      expect(await usdc.balanceOf(buyer.address)).to.be.greaterThan(before + usd(1_000));
    });

    it("clears a listing when the position moves", async function () {
      const { exchange, lender1, lender2, buyer, fundedLoan } = await loadFixture(deployFixture);
      const id = await fundedLoan();
      await exchange.connect(lender1).list(id, usd(990));
      await expect(exchange.connect(lender1).transferFrom(lender1.address, lender2.address, id)).to.emit(
        exchange,
        "ListingCancelled",
      );
      await expect(exchange.connect(buyer).buy(id, usd(990))).to.be.revertedWithCustomError(exchange, "NotListed");
    });

    it("lets the seller cancel a listing", async function () {
      const { exchange, lender1, buyer, fundedLoan } = await loadFixture(deployFixture);
      const id = await fundedLoan();
      await exchange.connect(lender1).list(id, usd(990));
      await expect(exchange.connect(buyer).cancelListing(id)).to.be.revertedWithCustomError(exchange, "NotPositionOwner");
      await exchange.connect(lender1).cancelListing(id);
      await expect(exchange.connect(buyer).buy(id, usd(990))).to.be.revertedWithCustomError(exchange, "NotListed");
    });
  });

  describe("defaults", function () {
    it("hands the collateral to the holder after maturity and grace, with a keeper bounty", async function () {
      const { exchange, lender1, keeper, fundedLoan } = await loadFixture(deployFixture);
      const id = await fundedLoan();
      const due = await exchange.defaultAt(id);
      const loan = await exchange.getLoan(id);
      expect(due).to.equal(loan.maturity + BigInt(DAY)); // grace is capped at one day

      await time.setNextBlockTimestamp(due - 1n);
      await expect(exchange.connect(keeper).claimDefault(id)).to.be.revertedWithCustomError(exchange, "NotDefaulted");

      const bounty = (mon(800) * 50n) / 10_000n;
      const tx = await exchange.connect(keeper).claimDefault(id);
      await expect(tx).to.emit(exchange, "LoanDefaulted").withArgs(id, lender1.address, keeper.address, mon(800) - bounty, bounty);
      await expect(tx).to.changeEtherBalances([lender1, keeper], [mon(800) - bounty, bounty], { includeFee: false });
      expect((await exchange.getLoan(id)).status).to.equal(LoanStatus.Defaulted);
    });

    it("pays no bounty when the holder claims", async function () {
      const { exchange, lender1, fundedLoan } = await loadFixture(deployFixture);
      const id = await fundedLoan();
      await time.increaseTo(await exchange.defaultAt(id));
      await expect(exchange.connect(lender1).claimDefault(id)).to.changeEtherBalance(lender1, mon(800), {
        includeFee: false,
      });
    });
  });

  describe("liquidation", function () {
    it("reverts while the loan is healthy", async function () {
      const { exchange, keeper, fundedLoan, setPrice } = await loadFixture(deployFixture);
      const id = await fundedLoan();
      const update = await setPrice(MON_FEED, 1.6); // 800 MON = $1,280 against ~$1,000 of debt
      await expect(exchange.connect(keeper).liquidate(id, [update], { value: 1 })).to.be.revertedWithCustomError(
        exchange,
        "Healthy",
      );
    });

    it("rejects stale prices", async function () {
      const { exchange, keeper, fundedLoan, pushPrice } = await loadFixture(deployFixture);
      const id = await fundedLoan();
      await pushPrice(MON_FEED, 1.0);
      await time.increase(121);
      await expect(exchange.connect(keeper).liquidate(id, [])).to.be.reverted;
    });

    it("seizes debt plus penalty for the holder and returns the rest to the borrower", async function () {
      const { exchange, keeper, fundedLoan, setPrice } = await loadFixture(deployFixture);
      const id = await fundedLoan(1_000);
      const update = await setPrice(MON_FEED, 1.4); // 800 MON = $1,120, LTV about 89%

      const tx = exchange.connect(keeper).liquidate(id, [update], { value: 10 });
      await expect(tx).to.emit(exchange, "LoanLiquidated");
      const receipt = await (await tx).wait();
      const { seized, bounty, returned, ltvBps } = findEvent(receipt, "LoanLiquidated").args;

      expect(ltvBps).to.be.greaterThanOrEqual(8_500n);
      expect(ltvBps).to.be.lessThan(9_000n);
      // seized + bounty + returned accounts for all collateral
      expect(seized + bounty + returned).to.equal(mon(800));
      // holder receives about debt * 1.05 / price worth of MON (~750 MON)
      expect(seized + bounty).to.be.closeTo(mon(750), mon(1));
      expect(bounty).to.equal(((seized + bounty) * 50n) / 10_000n);
      expect(returned).to.be.closeTo(mon(50), mon(1));
      expect((await exchange.getLoan(id)).status).to.equal(LoanStatus.Liquidated);
    });

    it("gives all collateral to the holder when the loan is underwater", async function () {
      const { exchange, lender1, fundedLoan, setPrice } = await loadFixture(deployFixture);
      const id = await fundedLoan(1_000);
      const update = await setPrice(MON_FEED, 0.5);
      await expect(exchange.connect(lender1).liquidate(id, [update], { value: 1 })).to.changeEtherBalance(lender1, mon(800) - 1n, {
        includeFee: false,
      });
    });

    it("values token collateral with its own feed", async function () {
      const { exchange, borrower, lender1, keeper, openRequest, setPrice } = await loadFixture(deployFixture);
      // 2 tWETH at $3,000 backing 4,000 tUSDC is 67% LTV
      const id = await openRequest({ kind: WETH, collateral: mon(2), principal: usd(4_000) });
      await exchange.connect(lender1).bid(id, 800);
      await exchange.connect(borrower).acceptBid(id);

      await expect(
        exchange.connect(keeper).liquidate(id, [await setPrice(ETH_FEED, 3_000)], { value: 1 }),
      ).to.be.revertedWithCustomError(exchange, "Healthy");
      await expect(exchange.connect(keeper).liquidate(id, [await setPrice(ETH_FEED, 2_300)], { value: 1 })).to.emit(
        exchange,
        "LoanLiquidated",
      );
    });
  });

  describe("deferred payouts", function () {
    it("credits a recipient that rejects native transfers and lets it claim later", async function () {
      const { exchange } = await loadFixture(deployFixture);
      const borrowerContract = await (await ethers.getContractFactory("RejectingBorrower")).deploy(await exchange.getAddress());
      await borrowerContract.open(usd(10), 3_600, 1_000, 600, { value: mon(5) });
      const id = (await exchange.nextId()) - 1n;

      await expect(borrowerContract.cancel(id))
        .to.emit(exchange, "PayoutDeferred")
        .withArgs(await borrowerContract.getAddress(), ethers.ZeroAddress, mon(5));
      expect(await exchange.claimable(ethers.ZeroAddress, await borrowerContract.getAddress())).to.equal(mon(5));

      await borrowerContract.setAccepting(true);
      await expect(borrowerContract.claim()).to.changeEtherBalance(borrowerContract, mon(5));
      await expect(borrowerContract.claim()).to.be.revertedWithCustomError(exchange, "NothingToClaim");
    });
  });

  describe("metadata", function () {
    it("renders onchain JSON with an SVG image", async function () {
      const { exchange, fundedLoan } = await loadFixture(deployFixture);
      const id = await fundedLoan(1_000);
      const uri = await exchange.tokenURI(id);
      expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
      const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
      expect(json.name).to.equal(`Citrine position #${id}`);
      expect(json.image.startsWith("data:image/svg+xml;base64,")).to.equal(true);
      const svg = Buffer.from(json.image.split(",")[1], "base64").toString();
      expect(svg).to.contain("1000.00");
      expect(svg).to.contain("10.00% APR");
      expect(svg).to.contain("800.0000 MON");
      expect(json.attributes.find((a) => a.trait_type === "Collateral").value).to.equal("MON");
    });
  });
});
