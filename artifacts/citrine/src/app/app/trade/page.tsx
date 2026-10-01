"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { motion } from "framer-motion";
import { Store } from "lucide-react";
import { useListListings, getListListingsQueryKey, type Listing, type ListListingsSort } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn, Countdown, EmptyState, ErrorState, KV, LinkBtn, PageHead, Panel, Seg, SkelRows } from "@/components/citrine/primitives";
import { TxStatus } from "@/components/citrine/tx-status";
import { WalletGate } from "@/components/citrine/wallet";
import { useCitrineActions } from "@/lib/web3/actions";
import { useWalletState } from "@/lib/web3/reads";
import { liveOwed, sameAddr, toRaw } from "@/lib/market";
import { collaterals } from "@/lib/web3/contracts";
import { displayName, formatAmount, formatRate } from "@/lib/format";
import { useNow } from "@/hooks/use-now";

function BuyDialog({ listing, onClose }: { listing: Listing | null; onClose: () => void }) {
  const { buy, progress, busy } = useCitrineActions();
  const w = useWalletState();
  const now = useNow();
  if (!listing) return null;
  const l = listing.loan;
  const owed = liveOwed(l.principal, l.rateBps, l.startTime, now);
  const usdc = w.balances.tUSDC?.value ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-2xl border-border bg-popover">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Buy position #{listing.loanId}</DialogTitle>
          <DialogDescription>You become the lender. Repayment at maturity goes to you.</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border rounded-xl bg-muted/30 px-4">
          <KV k="Price" v={<span className="num">{formatAmount(listing.price)} tUSDC</span>} />
          <KV k="Owed now" v={<span className="num">{formatAmount(owed, 4)}</span>} />
          <KV k="Repays at maturity" v={<span className="num">{formatAmount(l.owedAtMaturity, 4)}</span>} />
          <KV k="Yield to maturity" v={<span className="num text-primary">{formatRate(listing.yieldToMaturityBps)}</span>} />
          <KV k="Matures in" v={<Countdown to={l.maturity} />} />
          <KV k="Collateral" v={<span className="num">{formatAmount(l.collateralAmount)} {l.collateralSymbol}</span>} />
        </div>
        <WalletGate title="Connect to buy" body="Buying transfers the position NFT to your wallet.">
          <Btn size="lg" className="w-full" disabled={busy || usdc < listing.price || sameAddr(w.address, listing.seller)} onClick={() => void buy(listing.loanId, toRaw(listing.price, 6)).then((h) => h && onClose())}>
            {sameAddr(w.address, listing.seller) ? "This is your listing" : usdc < listing.price ? "Not enough tUSDC" : `Buy for ${formatAmount(listing.price)} tUSDC`}
          </Btn>
          <TxStatus progress={progress} className="mt-3" />
        </WalletGate>
      </DialogContent>
    </Dialog>
  );
}

export default function TradePage() {
  const { address } = useAccount();
  const [col, setCol] = useState("all");
  const [sort, setSort] = useState<ListListingsSort>("yield");
  const [buying, setBuying] = useState<Listing | null>(null);
  const params = { sort, collateral: col === "all" ? undefined : col, limit: 100 };
  const { data, isLoading, isError, refetch } = useListListings(params, { query: { queryKey: getListListingsQueryKey(params), refetchInterval: 4_000 } });

  return (
    <>
      <PageHead title="Trade" sub="Buy loan positions from lenders who want out early. Yield shown assumes repayment in full at maturity." />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Seg value={col} onChange={setCol} options={[{ label: "All collateral", value: "all" }, ...collaterals.map((c) => ({ label: c.symbol, value: c.symbol }))]} />
        <Seg value={sort} onChange={setSort} options={[{ label: "Yield", value: "yield" }, { label: "Price", value: "price" }, { label: "Maturity", value: "maturity" }, { label: "Newest", value: "newest" }]} />
      </div>
      <Panel className="pt-3">
        {isLoading ? <SkelRows rows={5} /> : isError ? <ErrorState onRetry={() => void refetch()} /> : data && data.length > 0 ? (
          <div className="pb-2">
            <div className="hidden grid-cols-[64px_1.2fr_1fr_1fr_1fr_auto] gap-4 border-b border-border px-5 pb-2 text-xs text-muted-foreground md:grid">
              <span>Id</span><span>Price</span><span>Yield to maturity</span><span>Loan rate</span><span>Matures</span><span className="w-16" />
            </div>
            {data.map((x, i) => (
              <motion.div key={x.loanId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="grid grid-cols-2 items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3.5 first:border-t-0 hover:bg-accent/40 md:grid-cols-[64px_1.2fr_1fr_1fr_1fr_auto]">
                <Link href={`/app/loans/${x.loanId}`} className="num text-sm text-muted-foreground hover:text-primary">#{x.loanId}</Link>
                <div>
                  <p className="num text-[15px]">{formatAmount(x.price)} <span className="text-xs text-muted-foreground">tUSDC</span></p>
                  <p className="text-xs text-muted-foreground">by {displayName(x.seller, x.sellerName)}</p>
                </div>
                <p className="num text-lg text-primary">{formatRate(x.yieldToMaturityBps)}</p>
                <div>
                  <p className="num text-sm">{formatRate(x.loan.rateBps)}</p>
                  <p className="text-xs text-muted-foreground">{formatAmount(x.loan.collateralAmount)} {x.loan.collateralSymbol}</p>
                </div>
                <p className="text-sm"><Countdown to={x.loan.maturity} endedLabel="Matured" /></p>
                <div className="col-span-2 flex justify-end md:col-span-1">
                  {sameAddr(address, x.seller) ? <LinkBtn href={`/app/loans/${x.loanId}`} variant="secondary" className="h-8 px-3.5 text-[13px]">Manage</LinkBtn> : <Btn size="sm" onClick={() => setBuying(x)} data-testid={`button-buy-${x.loanId}`}>Buy</Btn>}
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Store className="h-5 w-5" />} title="No positions for sale" body="When a lender lists a position it shows up here with its yield to maturity. Holding one? List it from the loan page." action={<LinkBtn href="/app/portfolio">Your positions</LinkBtn>} />
        )}
      </Panel>
      <BuyDialog listing={buying} onClose={() => setBuying(null)} />
    </>
  );
}
