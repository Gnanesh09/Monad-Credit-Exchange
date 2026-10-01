"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Gavel } from "lucide-react";
import { useGetRequest, getGetRequestQueryKey } from "@workspace/api-client-react";
import { Btn, Countdown, EmptyState, KV, LinkBtn, Panel, PanelHeader, Skel, StatusPill, TxLink } from "@/components/citrine/primitives";
import { BidForm } from "@/components/citrine/bid-form";
import { TxStatus } from "@/components/citrine/tx-status";
import { useCitrineActions } from "@/lib/web3/actions";
import { isUnauthorized } from "@/lib/api-error";
import { liquidationPrice, sameAddr } from "@/lib/market";
import { displayName, formatAmount, formatDuration, formatRate, formatRelative, formatUsd } from "@/lib/format";
import { explorerAddress } from "@/lib/web3/contracts";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

export default function RequestPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const now = useNow();
  const { address } = useAccount();
  const actions = useCitrineActions();
  const q = useGetRequest(id, { query: { queryKey: getGetRequestQueryKey(id), enabled: Number.isFinite(id) && id >= 0, refetchInterval: 2_500 } });
  const r = q.data;

  if (q.isLoading) {
    return <div className="space-y-3"><Skel className="h-10 w-64" /><div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]"><Skel className="h-96" /><Skel className="h-96" /></div></div>;
  }
  if (!r) {
    return (
      <Panel>
        <EmptyState icon={<Gavel className="h-5 w-5" />} title={q.isError && !isUnauthorized(q.error) ? `Request #${params?.id} was not found` : "Request unavailable"} body="It may not be indexed yet if you just created it. Give it a few seconds." action={<div className="flex gap-2"><Btn variant="secondary" onClick={() => void q.refetch()}>Retry</Btn><LinkBtn href="/app/lend">Open auctions</LinkBtn></div>} />
      </Panel>
    );
  }

  const endMs = new Date(r.auctionEnd).getTime();
  const startMs = new Date(r.createdAt).getTime();
  const ended = endMs <= now;
  const isBorrower = sameAddr(address, r.borrower);
  const hasBids = r.bidCount > 0;
  const progress = Math.min(1, Math.max(0, (now - startMs) / Math.max(1, endMs - startMs)));
  const liq = liquidationPrice(r.principal, r.collateralAmount);

  return (
    <>
      <Link href="/app/lend" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Auctions</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold md:text-4xl">{formatAmount(r.principal)} tUSDC <span className="text-muted-foreground">for {formatDuration(r.duration)}</span></h1>
        <StatusPill status={r.status} />
        <span className="num text-sm text-muted-foreground">#{r.id}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <Panel className="relative overflow-hidden p-6">
            <div className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">{hasBids ? "Best rate" : "Ceiling"}</p>
                <AnimatePresence mode="popLayout">
                  <motion.p key={r.bestRateBps ?? "none"} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} className="num mt-1 text-5xl text-primary">
                    {formatRate(r.bestRateBps ?? r.maxRateBps)}
                  </motion.p>
                </AnimatePresence>
                <p className="mt-1 text-xs text-muted-foreground">{hasBids ? `by ${displayName(r.bestBidder, r.bestBidderName)}` : "waiting for the first bid"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{r.status === "open" ? (ended ? "Auction" : "Ends in") : "Auction"}</p>
                <p className="mt-1 text-5xl"><Countdown to={r.auctionEnd} /></p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(r.auctionEnd).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Next bid ceiling</p>
                <p className="num mt-1 text-5xl">{r.nextBidCeilingBps ? formatRate(r.nextBidCeilingBps) : "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{r.bidCount} bid{r.bidCount === 1 ? "" : "s"} so far</p>
              </div>
            </div>
            <div className="relative mt-6 h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div className={cn("h-full rounded-full", ended ? "bg-muted-foreground" : "bg-primary")} animate={{ width: `${progress * 100}%` }} transition={{ ease: "linear", duration: 1 }} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Bid history" hint="Newest first" live={r.status === "open"} />
            {r.bids.length === 0 ? (
              <p className="px-5 pb-6 text-sm text-muted-foreground">No bids yet. The first bid can be anywhere up to {formatRate(r.maxRateBps)}.</p>
            ) : (
              <div className="px-3 pb-3">
                <AnimatePresence initial={false}>
                  {r.bids.map((b, i) => (
                    <motion.div key={b.txHash} layout initial={{ opacity: 0, backgroundColor: "hsl(56 96% 58% / .15)" }} animate={{ opacity: 1, backgroundColor: "hsl(56 96% 58% / 0)" }} transition={{ duration: 1.2 }} className="grid grid-cols-[80px_1fr_auto_auto] items-center gap-4 rounded-xl px-2 py-2.5 text-sm">
                      <span className={cn("num", i === 0 ? "text-primary" : "text-muted-foreground line-through decoration-muted-foreground/40")}>{formatRate(b.rateBps)}</span>
                      <span className="truncate">{displayName(b.bidder, b.bidderName)}{sameAddr(b.bidder, address) && <span className="ml-2 text-xs text-primary">you</span>}</span>
                      <span className="text-xs text-muted-foreground">{formatRelative(b.timestamp, now)}</span>
                      <TxLink hash={b.txHash} className="text-xs" />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </Panel>

          <Panel className="p-5">
            <div className="grid gap-x-8 sm:grid-cols-2">
              <KV k="Borrower" v={<a className="hover:text-primary" href={explorerAddress(r.borrower)} target="_blank" rel="noopener noreferrer">{displayName(r.borrower, r.borrowerName)}</a>} />
              <KV k="Collateral" v={<span className="num">{formatAmount(r.collateralAmount)} {r.collateralSymbol}</span>} />
              <KV k="Collateral value" v={<span className="num">{formatUsd(r.collateralValueUsd)}</span>} />
              <KV k="LTV now" v={<span className="num">{formatRate(r.ltvBps)}</span>} />
              <KV k="Liquidation price at start" v={<span className="num">{liq ? formatUsd(liq) : "—"}</span>} />
              <KV k="Max rate" v={<span className="num">{formatRate(r.maxRateBps)}</span>} />
              <KV k="Created" v={formatRelative(r.createdAt, now)} />
              <KV k="Transaction" v={<TxLink hash={r.txHash} />} />
            </div>
          </Panel>
        </div>

        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          {r.status === "funded" && (
            <Panel className="p-6">
              <p className="font-medium">This auction cleared at {formatRate(r.bestRateBps)}.</p>
              <p className="mt-1 text-sm text-muted-foreground">The loan is live and the lender holds the position.</p>
              <LinkBtn href={`/app/loans/${r.id}`} className="mt-4">View loan <ArrowRight className="h-4 w-4" /></LinkBtn>
            </Panel>
          )}
          {r.status === "open" && (
            <>
              {(isBorrower || ended) && (
                <Panel className="space-y-3 p-5">
                  <p className="text-sm font-medium">{isBorrower ? "Your request" : "Auction ended"}</p>
                  {isBorrower && !ended && hasBids && (
                    <Btn size="lg" className="w-full" disabled={actions.busy} onClick={() => void actions.acceptBid(r.id)} data-testid="button-accept">
                      Accept {formatRate(r.bestRateBps)} and receive {formatAmount(r.principal)} tUSDC
                    </Btn>
                  )}
                  {isBorrower && !hasBids && (
                    <Btn variant="danger" className="w-full" disabled={actions.busy} onClick={() => void actions.cancelRequest(r.id)} data-testid="button-cancel">
                      Cancel and unlock collateral
                    </Btn>
                  )}
                  {ended && hasBids && (
                    <Btn size="lg" className="w-full" disabled={actions.busy} onClick={() => void actions.settle(r.id)} data-testid="button-settle">
                      Settle at {formatRate(r.bestRateBps)} and start the loan
                    </Btn>
                  )}
                  {ended && !hasBids && (
                    <Btn variant="secondary" className="w-full" disabled={actions.busy} onClick={() => void actions.expireRequest(r.id)} data-testid="button-expire">
                      Close and return collateral to borrower
                    </Btn>
                  )}
                  {isBorrower && !ended && hasBids && <p className="text-xs text-muted-foreground">Waiting may get you a lower rate. Requests with bids cannot be cancelled.</p>}
                  {ended && <p className="text-xs text-muted-foreground">Anyone can do this. It costs a little gas.</p>}
                  <TxStatus progress={actions.progress} />
                </Panel>
              )}
              {!isBorrower && !ended && (
                <Panel className="p-5">
                  <p className="mb-4 text-sm font-medium">Place a bid</p>
                  <BidForm request={r} />
                </Panel>
              )}
            </>
          )}
          {(r.status === "cancelled" || r.status === "expired") && (
            <Panel className="p-6">
              <p className="font-medium">This request is {r.status}.</p>
              <p className="mt-1 text-sm text-muted-foreground">The collateral went back to the borrower.</p>
              <LinkBtn href="/app/lend" variant="secondary" className="mt-4">Find another auction</LinkBtn>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
