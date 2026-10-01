"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowUpRight, FileWarning } from "lucide-react";
import {
  useGetLoan,
  getGetLoanQueryKey,
  useGetProtocol,
  getGetProtocolQueryKey,
  useGetPriceUpdate,
  getGetPriceUpdateQueryKey,
} from "@workspace/api-client-react";
import { PROTOCOL } from "@workspace/contracts";
import { Btn, Countdown, EmptyState, KV, LinkBtn, Panel, PanelHeader, Skel, StatusPill, TxLink } from "@/components/citrine/primitives";
import { ActivityList } from "@/components/citrine/activity";
import { TxStatus } from "@/components/citrine/tx-status";
import { WalletGate } from "@/components/citrine/wallet";
import { useCitrineActions } from "@/lib/web3/actions";
import { exchangeContract, explorerToken } from "@/lib/web3/contracts";
import { liquidationPrice, liveOwed, sameAddr, toRaw, usePriceMap } from "@/lib/market";
import { displayName, formatAmount, formatDuration, formatRate, formatUsd } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

function Artwork({ id }: { id: number }) {
  const { data, isLoading, isError } = useReadContract({ ...exchangeContract, functionName: "tokenURI", args: [BigInt(id)], query: { refetchInterval: 15_000 } });
  const meta = useMemo(() => {
    if (typeof data !== "string") return null;
    try {
      const json = data.startsWith("data:application/json;base64,") ? atob(data.split(",")[1] ?? "") : data.replace(/^data:application\/json[^,]*,/, "");
      return JSON.parse(json) as { name?: string; image?: string; description?: string };
    } catch {
      return null;
    }
  }, [data]);
  return (
    <Panel className="overflow-hidden p-3">
      {isLoading ? (
        <Skel className="aspect-square w-full rounded-xl" />
      ) : meta?.image ? (
        <motion.img initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} src={meta.image} alt={meta.name ?? `Position ${id}`} className="w-full rounded-xl" />
      ) : (
        <div className="grid aspect-square place-items-center rounded-xl bg-muted text-center text-sm text-muted-foreground">
          {isError ? "Artwork unavailable. The position may have closed." : "No artwork"}
        </div>
      )}
      <div className="flex items-center justify-between px-2 pt-3 text-xs text-muted-foreground">
        <span>{meta?.name ?? `Position #${id}`} · read from tokenURI</span>
        <a href={explorerToken(exchangeContract.address, id)} target="_blank" rel="noopener noreferrer" className="hover:text-primary">Explorer <ArrowUpRight className="inline h-3 w-3" /></a>
      </div>
    </Panel>
  );
}

export default function LoanPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const now = useNow();
  const { address } = useAccount();
  const actions = useCitrineActions();
  const { map } = usePriceMap();
  const protocol = useGetProtocol({ query: { queryKey: getGetProtocolQueryKey(), refetchInterval: 10_000 } });
  const q = useGetLoan(id, { query: { queryKey: getGetLoanQueryKey(id), enabled: Number.isFinite(id) && id >= 0, refetchInterval: 3_000 } });
  const l = q.data;
  const [price, setPrice] = useState("");
  const active = l?.status === "active";
  const update = useGetPriceUpdate({ collateral: l?.collateralSymbol ?? "" }, { query: { queryKey: getGetPriceUpdateQueryKey({ collateral: l?.collateralSymbol ?? "" }), enabled: !!l && active && !!protocol.data?.livePrices, refetchInterval: 15_000, retry: false } });

  if (q.isLoading) return <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]"><Skel className="h-[420px]" /><Skel className="h-[420px]" /></div>;
  if (!l) {
    return (
      <Panel>
        <EmptyState icon={<FileWarning className="h-5 w-5" />} title={`Loan #${params?.id} was not found`} body="Loans appear once an auction is settled or accepted. If you just did that, wait a few seconds." action={<div className="flex gap-2"><Btn variant="secondary" onClick={() => void q.refetch()}>Retry</Btn><LinkBtn href="/app">Market</LinkBtn></div>} />
      </Panel>
    );
  }

  const owed = active ? liveOwed(l.principal, l.rateBps, l.startTime, now) : l.owedNow;
  const interest = owed - l.principal;
  const startMs = new Date(l.startTime).getTime();
  const matMs = new Date(l.maturity).getTime();
  const defMs = new Date(l.defaultAt).getTime();
  const elapsed = Math.min(1, Math.max(0, (now - startMs) / Math.max(1, matMs - startMs)));
  const p = map[l.collateralSymbol];
  const colValue = p ? p.price * l.collateralAmount : l.collateralValueUsd;
  const ltv = colValue ? owed / colValue : null;
  const liqLtv = PROTOCOL.LIQUIDATION_LTV_BPS / PROTOCOL.BPS;
  const health = ltv === null ? null : ltv / liqLtv;
  const liq = liquidationPrice(owed, l.collateralAmount);
  const isBorrower = sameAddr(address, l.borrower);
  const isHolder = sameAddr(address, l.holder);
  const overdue = active && now > matMs;
  const defaultable = active && now > defMs;
  const liquidatable = active && ltv !== null && ltv >= liqLtv;
  // Liquidation needs a fresh price: a signed Hermes update, or an onchain Pyth price that is current.
  const onchainFresh = !!p && p.source === "onchain" && !p.stale;
  const canLiquidate = !!update.data || onchainFresh;
  const priceBps = Math.round(Number(price) * 1e6);

  return (
    <>
      <Link href="/app" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Market</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold md:text-4xl">Loan #{l.id}</h1>
        <StatusPill status={defaultable ? "defaulted" : overdue ? "overdue" : l.status} />
        {l.listing && <StatusPill status="listed" />}
        {isBorrower && <span className="text-sm text-primary">You borrowed</span>}
        {isHolder && <span className="text-sm text-primary">You hold this position</span>}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <Panel className="relative overflow-hidden p-6">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
            <p className="relative text-xs text-muted-foreground">{active ? "Owed right now" : "Settled amount"}</p>
            <p className="num relative mt-1 text-5xl md:text-6xl">
              {formatAmount(owed, 6)} <span className="text-xl text-muted-foreground">tUSDC</span>
            </p>
            <p className="relative mt-2 text-sm text-muted-foreground">
              <span className="num text-positive">+{formatAmount(interest, 6)}</span> interest at <span className="num text-primary">{formatRate(l.rateBps)}</span> APR on {formatAmount(l.principal)} principal
            </p>
            <div className="relative mt-6">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Started {new Date(l.startTime).toLocaleString()}</span>
                <span>{active ? <>Matures in <Countdown to={l.maturity} endedLabel="matured" className="text-foreground" /></> : `Closed ${l.closedAt ? new Date(l.closedAt).toLocaleString() : ""}`}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div className={cn("h-full rounded-full", overdue ? "bg-warning" : "bg-primary")} animate={{ width: `${elapsed * 100}%` }} transition={{ ease: "linear", duration: 1 }} />
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span className="num">Term {formatDuration((matMs - startMs) / 1000)}</span>
                <span className="num">At maturity {formatAmount(l.owedAtMaturity, 4)} tUSDC</span>
              </div>
            </div>
          </Panel>

          {active && (
            <Panel className="p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Health</p>
                <span className={cn("num text-sm", health === null ? "text-muted-foreground" : health < 0.7 ? "text-positive" : health < 1 ? "text-warning" : "text-destructive")}>
                  LTV {ltv === null ? "—" : `${(ltv * 100).toFixed(2)}%`} of {(liqLtv * 100).toFixed(0)}% limit
                </span>
              </div>
              <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-positive via-warning to-destructive" animate={{ width: `${Math.min(100, (health ?? 0) * 100)}%` }} />
              </div>
              <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
                <KV k={`${l.collateralSymbol} price`} v={<span className={cn("num", p?.stale && "text-warning")}>{p ? formatUsd(p.price) : "—"}{p?.stale ? " · stale" : ""}</span>} />
                <KV k="Liquidation price" v={<span className="num">{liq ? formatUsd(liq) : "—"}</span>} />
                <KV k="Collateral value" v={<span className="num">{formatUsd(colValue)}</span>} />
                <KV k="Price source" v={p ? `Pyth ${p.source === "hermes" ? "Hermes" : "onchain"}` : "—"} />
              </div>
            </Panel>
          )}

          <Panel>
            <PanelHeader title="Timeline" hint="Every onchain event for this loan" />
            {l.timeline.length > 0 ? <ActivityList events={l.timeline} link={false} /> : <p className="px-5 pb-5 text-sm text-muted-foreground">No events indexed yet.</p>}
          </Panel>

          <Panel className="p-5">
            <div className="grid gap-x-8 sm:grid-cols-2">
              <KV k="Borrower" v={displayName(l.borrower, l.borrowerName)} />
              <KV k="Original lender" v={displayName(l.lender, l.lenderName)} />
              <KV k="Current holder" v={l.holder ? displayName(l.holder, l.holderName) : "Closed"} />
              <KV k="Collateral" v={<span className="num">{formatAmount(l.collateralAmount)} {l.collateralSymbol}</span>} />
              <KV k="Auction" v={<span className="num">{l.bidCount} bids, max {formatRate(l.maxRateBps)}</span>} />
              <KV k="Default after" v={new Date(l.defaultAt).toLocaleString()} />
            </div>
          </Panel>
        </div>

        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <Artwork id={l.id} />
          {active && (
            <Panel className="space-y-3 p-5">
              <p className="text-sm font-medium">Actions</p>
              <WalletGate title="Connect to act" body="Repay, list, buy or liquidate with your wallet.">
                <div className="space-y-3">
                  {isBorrower && (
                    <Btn size="lg" className="w-full" disabled={actions.busy} onClick={() => void actions.repay(l.id)} data-testid="button-repay">
                      Repay {formatAmount(owed, 4)} tUSDC
                    </Btn>
                  )}
                  {isHolder && !l.listing && !defaultable && (
                    <div className="space-y-2">
                      <div className="flex items-center rounded-xl bg-muted/60 px-3 ring-1 ring-inset ring-border focus-within:ring-primary/60">
                        <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={formatAmount(owed, 2)} className="num h-11 w-full bg-transparent outline-none" data-testid="input-list-price" />
                        <span className="text-xs text-muted-foreground">tUSDC</span>
                      </div>
                      <Btn variant="secondary" className="w-full" disabled={actions.busy || priceBps <= 0} onClick={() => void actions.list(l.id, toRaw(Number(price), 6)).then(() => setPrice(""))} data-testid="button-list">
                        List position for sale
                      </Btn>
                      <p className="text-xs text-muted-foreground">Repays {formatAmount(l.owedAtMaturity, 2)} at maturity. Price below that to give buyers a yield.</p>
                    </div>
                  )}
                  {isHolder && l.listing && (
                    <Btn variant="secondary" className="w-full" disabled={actions.busy} onClick={() => void actions.cancelListing(l.id)} data-testid="button-delist">
                      Remove listing at {formatAmount(l.listing.price)} tUSDC
                    </Btn>
                  )}
                  {!isHolder && l.listing && (
                    <Btn size="lg" className="w-full" disabled={actions.busy} onClick={() => void actions.buy(l.id, toRaw(l.listing!.price, 6))} data-testid="button-buy">
                      Buy position for {formatAmount(l.listing.price)} tUSDC
                    </Btn>
                  )}
                  {isHolder && defaultable && (
                    <Btn size="lg" className="w-full" disabled={actions.busy} onClick={() => void actions.claimDefault(l.id)} data-testid="button-claim-default">
                      Claim {formatAmount(l.collateralAmount)} {l.collateralSymbol} collateral
                    </Btn>
                  )}
                  {liquidatable && (
                    <>
                      <Btn variant="danger" className="w-full" disabled={actions.busy || !canLiquidate} onClick={() => void actions.liquidate(l.id, l.collateralSymbol)} data-testid="button-liquidate">
                        Liquidate loan
                      </Btn>
                      <p className="text-xs text-muted-foreground">
                        {update.data
                          ? `Fresh Pyth price ready: ${formatUsd(update.data.price)}. Liquidators earn a ${formatRate(PROTOCOL.LIQUIDATOR_BOUNTY_BPS)} bounty.`
                          : onchainFresh
                            ? `The onchain Pyth price is current at ${formatUsd(p.price)}. Liquidators earn a ${formatRate(PROTOCOL.LIQUIDATOR_BOUNTY_BPS)} bounty.`
                            : "No fresh Pyth price is available, so liquidation is paused."}
                      </p>
                    </>
                  )}
                  {!isBorrower && !isHolder && !l.listing && !liquidatable && (
                    <p className="text-sm text-muted-foreground">Nothing to do here. The holder can list this position on the Trade desk.</p>
                  )}
                  {overdue && !defaultable && <p className="text-xs text-warning">Past maturity. In grace until {new Date(l.defaultAt).toLocaleTimeString()}, <Countdown to={l.defaultAt} /> left.</p>}
                  <TxStatus progress={actions.progress} />
                </div>
              </WalletGate>
            </Panel>
          )}
          {!active && (
            <Panel className="p-5">
              <p className="font-medium">This loan is {l.status}.</p>
              <p className="mt-1 text-sm text-muted-foreground">{l.status === "repaid" ? "The borrower repaid in full and got their collateral back." : l.status === "liquidated" ? "Collateral was sold to cover the debt." : "The holder claimed the collateral after the grace period."}</p>
              {l.timeline.length > 0 && <TxLink hash={l.timeline[l.timeline.length - 1]!.txHash} className="mt-3 text-sm" />}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
