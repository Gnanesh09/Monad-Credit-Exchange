import { Router, type IRouter } from "express";
import { isAddress } from "viem";
import { getCollections } from "@workspace/db";
import { GetPortfolioParams, GetPortfolioResponse } from "@workspace/api-zod";
import { badRequest, handler, zodMessage } from "../lib/http";
import {
  assetDecimals,
  checksum,
  display,
  eventAddresses,
  loadNames,
  loanAddresses,
  requestAddresses,
  serializeEvent,
  serializeListing,
  serializeLoan,
  serializeRequest,
} from "../lib/serialize";

const router: IRouter = Router();

const statusOrder = { active: 0, repaid: 1, defaulted: 2, liquidated: 3 } as const;

router.get(
  "/portfolio/:address",
  handler(async (req, res) => {
    const parsed = GetPortfolioParams.safeParse(req.params);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    if (!isAddress(parsed.data.address)) throw badRequest("That is not a valid wallet address.");
    const address = parsed.data.address.toLowerCase();
    const { requests, loans, events } = await getCollections();

    const [ownRequests, leadingBids, borrowings, positions, listings, history, repaidToHolder] = await Promise.all([
      requests.find({ borrower: address, status: "open" }).sort({ auctionEnd: 1 }).toArray(),
      requests.find({ bestBidder: address, status: "open" }).sort({ auctionEnd: 1 }).toArray(),
      loans.find({ borrower: address }).sort({ startTime: -1 }).toArray(),
      loans.find({ holder: address, status: "active" }).sort({ maturity: 1 }).toArray(),
      loans.find({ "listing.seller": address, status: "active" }).toArray(),
      events
        .find({ $or: [{ actor: address }, { counterparty: address }] })
        .sort({ blockNumber: -1, logIndex: -1 })
        .limit(50)
        .toArray(),
      events.find({ kind: "loan_repaid", counterparty: address }, { projection: { loanId: 1 } }).toArray(),
    ]);
    borrowings.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const repaidLoanIds = repaidToHolder.map((e) => e.loanId);
    const earnedFrom = repaidLoanIds.length
      ? await loans.find({ _id: { $in: repaidLoanIds } }, { projection: { interestPaid: 1 } }).toArray()
      : [];

    const names = await loadNames([
      address,
      ...ownRequests.flatMap(requestAddresses),
      ...leadingBids.flatMap(requestAddresses),
      ...borrowings.flatMap(loanAddresses),
      ...positions.flatMap(loanAddresses),
      ...listings.flatMap(loanAddresses),
      ...history.flatMap(eventAddresses),
    ]);
    const now = Date.now();
    const borrowed = borrowings.map((l) => serializeLoan(l, names, now));
    const held = positions.map((l) => serializeLoan(l, names, now));
    const open = ownRequests.map((r) => serializeRequest(r, names, now));
    const bids = leadingBids.map((r) => serializeRequest(r, names, now));
    const activeBorrowed = borrowed.filter((l) => l.status === "active");

    res.json(
      GetPortfolioResponse.parse({
        address: checksum(address),
        name: names.get(address) ?? null,
        summary: {
          debtOutstanding: activeBorrowed.reduce((sum, l) => sum + l.owedNow, 0),
          collateralLockedUsd:
            activeBorrowed.reduce((sum, l) => sum + (l.collateralValueUsd ?? 0), 0) +
            open.reduce((sum, r) => sum + (r.collateralValueUsd ?? 0), 0),
          positionsFaceValue: held.reduce((sum, l) => sum + l.owedNow, 0),
          escrowedInBids: bids.reduce((sum, r) => sum + r.principal, 0),
          interestEarned: earnedFrom.reduce((sum, l) => sum + display(l.interestPaid, assetDecimals), 0),
          interestPaid: borrowings
            .filter((l) => l.status === "repaid")
            .reduce((sum, l) => sum + display(l.interestPaid, assetDecimals), 0),
        },
        requests: open,
        bids,
        borrowings: borrowed,
        positions: held,
        listings: listings.map((l) => serializeListing(l, names, now)),
        history: history.map((e) => serializeEvent(e, names)),
      }),
    );
  }),
);

export default router;
