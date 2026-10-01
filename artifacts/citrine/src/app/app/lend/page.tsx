"use client";

import { useState } from "react";
import { Gavel } from "lucide-react";
import { useListRequests, getListRequestsQueryKey, type LoanRequest, type ListRequestsSort } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn, EmptyState, ErrorState, LinkBtn, PageHead, Panel, Seg, SkelRows } from "@/components/citrine/primitives";
import { RequestHeaderRow, RequestRow } from "@/components/citrine/widgets";
import { BidForm } from "@/components/citrine/bid-form";
import { collaterals } from "@/lib/web3/contracts";
import { formatAmount, formatDuration } from "@/lib/format";

export default function LendPage() {
  const [col, setCol] = useState("all");
  const [sort, setSort] = useState<ListRequestsSort>("ending");
  const [bidOn, setBidOn] = useState<LoanRequest | null>(null);
  const params = { status: "open" as const, sort, collateral: col === "all" ? undefined : col, limit: 100 };
  const { data, isLoading, isError, refetch } = useListRequests(params, { query: { queryKey: getListRequestsQueryKey(params), refetchInterval: 3_000 } });
  const live = bidOn ? data?.find((r) => r.id === bidOn.id) ?? bidOn : null;

  return (
    <>
      <PageHead title="Lend" sub="Pick an auction, undercut the best rate, and earn interest on tUSDC backed by locked collateral." />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Seg value={col} onChange={setCol} options={[{ label: "All collateral", value: "all" }, ...collaterals.map((c) => ({ label: c.symbol, value: c.symbol }))]} />
        <Seg value={sort} onChange={setSort} options={[{ label: "Ending", value: "ending" }, { label: "Newest", value: "newest" }, { label: "Size", value: "principal" }, { label: "Rate", value: "rate" }]} />
      </div>
      <Panel className="pt-4">
        {isLoading ? <SkelRows rows={6} /> : isError ? <ErrorState onRetry={() => void refetch()} /> : data && data.length > 0 ? (
          <div className="pb-2">
            <RequestHeaderRow />
            {data.map((r, i) => (
              <RequestRow key={r.id} r={r} i={i} action={<Btn size="sm" disabled={r.nextBidCeilingBps === 0} onClick={() => setBidOn(r)} data-testid={`button-bid-${r.id}`}>Bid</Btn>} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Gavel className="h-5 w-5" />} title="No open auctions right now" body="New requests appear here the moment they are mined. Or post one yourself and lend to someone else later." action={<LinkBtn href="/app/borrow">Create a request</LinkBtn>} />
        )}
      </Panel>
      <Dialog open={!!bidOn} onOpenChange={(o) => !o && setBidOn(null)}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-popover">
          {live && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Bid on #{live.id}</DialogTitle>
                <DialogDescription>
                  {formatAmount(live.principal)} tUSDC for {formatDuration(live.duration)}, secured by {formatAmount(live.collateralAmount)} {live.collateralSymbol}.
                </DialogDescription>
              </DialogHeader>
              <BidForm request={live} onDone={() => setBidOn(null)} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
