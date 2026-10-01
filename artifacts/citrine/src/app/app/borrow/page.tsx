"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { motion } from "framer-motion";
import { formatUnits } from "viem";
import { FileText } from "lucide-react";
import { useListRequests, getListRequestsQueryKey, useGetProtocol, getGetProtocolQueryKey } from "@workspace/api-client-react";
import { PROTOCOL, quoteInterest } from "@workspace/contracts";
import { Btn, EmptyState, KV, LinkBtn, PageHead, Panel, PanelHeader, Seg, SkelRows, StatusPill } from "@/components/citrine/primitives";
import { RequestRow } from "@/components/citrine/widgets";
import { TxStatus } from "@/components/citrine/tx-status";
import { WalletGate } from "@/components/citrine/wallet";
import { useCitrineActions } from "@/lib/web3/actions";
import { useWalletState } from "@/lib/web3/reads";
import { collaterals } from "@/lib/web3/contracts";
import { AUCTION_PRESETS, LIVE, TERM_PRESETS, liquidationPrice, toRaw, usePriceMap } from "@/lib/market";
import { formatAmount, formatDuration, formatRate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

function Field({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function AmountInput({ value, onChange, suffix, testId }: { value: string; onChange: (v: string) => void; suffix: string; testId: string }) {
  return (
    <div className="flex items-center rounded-2xl bg-muted/60 px-4 ring-1 ring-inset ring-border focus-within:ring-primary/60">
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0" className="num h-14 w-full bg-transparent text-2xl outline-none placeholder:text-muted-foreground/40" data-testid={testId} />
      <span className="text-sm text-muted-foreground">{suffix}</span>
    </div>
  );
}

function CreateForm() {
  const router = useRouter();
  const w = useWalletState();
  const { map } = usePriceMap();
  const protocol = useGetProtocol({ query: { queryKey: getGetProtocolQueryKey() } });
  const { createRequest, progress, busy } = useCitrineActions();
  const [colIdx, setColIdx] = useState(collaterals[0]?.index ?? 0);
  const [amount, setAmount] = useState("");
  const [principal, setPrincipal] = useState("");
  const [term, setTerm] = useState(3_600);
  const [maxRate, setMaxRate] = useState(12);
  const [auction, setAuction] = useState(180);

  const col = collaterals.find((c) => c.index === colIdx) ?? collaterals[0]!;
  const price = map[col.symbol];
  const amt = Number(amount) || 0;
  const prin = Number(principal) || 0;
  const value = price ? amt * price.price : null;
  const ltv = value ? prin / value : null;
  const bal = w.balances[col.symbol]?.value ?? 0;
  const maxBps = Math.round(maxRate * 100);
  const worstInterest = prin > 0 ? Number(formatUnits(quoteInterest(toRaw(prin, 6), maxBps, term), 6)) : 0;
  const liq = liquidationPrice(prin, amt);
  const liqLtv = (protocol.data?.parameters.liquidationLtvBps ?? PROTOCOL.LIQUIDATION_LTV_BPS) / PROTOCOL.BPS;

  const errors: string[] = [];
  if (amount && amt <= 0) errors.push("Enter a collateral amount.");
  if (amt > bal && w.connected) errors.push(`You have ${formatAmount(bal)} ${col.symbol}.`);
  if (principal && prin < 1) errors.push("The minimum loan is 1 tUSDC.");
  if (ltv !== null && ltv >= liqLtv) errors.push("That loan would be liquidatable immediately. Add collateral or borrow less.");
  if (maxBps < 5 || maxBps > PROTOCOL.MAX_RATE_BPS) errors.push("Max rate must be between 0.05% and 100%.");
  const ready = amt > 0 && prin >= 1 && errors.length === 0;

  const ltvTone = ltv === null ? "" : ltv < 0.5 ? "text-positive" : ltv < 0.7 ? "text-warning" : "text-destructive";

  const submit = async () => {
    const hash = await createRequest({
      collateralIndex: col.index,
      collateralAmount: toRaw(amt, col.decimals),
      principal: toRaw(prin, 6),
      duration: term,
      maxRateBps: maxBps,
      auctionLength: auction,
    });
    if (hash) {
      setAmount("");
      setPrincipal("");
      router.refresh();
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
      <Panel className="space-y-6 p-6">
        <Field label="Collateral">
          <div className="grid grid-cols-3 gap-2">
            {collaterals.map((c) => (
              <button key={c.index} onClick={() => setColIdx(c.index)} className={cn("rounded-2xl px-4 py-3 text-left ring-1 ring-inset transition-colors", c.index === colIdx ? "bg-primary/10 ring-primary/50" : "bg-muted/40 ring-border hover:bg-accent")}>
                <p className="font-medium">{c.symbol}</p>
                <p className="num text-xs text-muted-foreground">{map[c.symbol] ? formatUsd(map[c.symbol]!.price) : "—"}</p>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Collateral amount" right={<button className="hover:text-primary" onClick={() => setAmount(String(col.native ? Math.max(0, bal - 0.5) : bal))}>Balance <span className="num">{formatAmount(bal)}</span></button>}>
          <AmountInput value={amount} onChange={setAmount} suffix={col.symbol} testId="input-collateral-amount" />
          {col.native && <p className="mt-1.5 text-xs text-muted-foreground">Max leaves 0.5 MON for gas.</p>}
        </Field>
        <Field label="Borrow" right={value ? <button className="hover:text-primary" onClick={() => setPrincipal((value * 0.5).toFixed(2))}>50% LTV <span className="num">{formatAmount(value * 0.5, 2)}</span></button> : null}>
          <AmountInput value={principal} onChange={setPrincipal} suffix="tUSDC" testId="input-principal" />
        </Field>
        <Field label="Loan term">
          <Seg value={term} onChange={setTerm} options={TERM_PRESETS.map((p) => ({ label: p.label, value: p.s }))} />
        </Field>
        <Field label="Maximum rate you will pay (APR)" right={<span className="num text-base text-primary">{maxRate.toFixed(2)}%</span>}>
          <input type="range" min={0.5} max={100} step={0.05} value={maxRate} onChange={(e) => setMaxRate(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" data-testid="input-max-rate" />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>0.5%</span><span>Lenders bid down from here</span><span>100%</span></div>
        </Field>
        <Field label="Auction length">
          <Seg value={auction} onChange={setAuction} options={AUCTION_PRESETS.map((p) => ({ label: p.label, value: p.s }))} />
        </Field>
      </Panel>

      <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
        <Panel className="relative overflow-hidden p-6">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
          <p className="relative text-xs text-muted-foreground">Loan to value</p>
          <motion.p key={ltv === null ? "x" : Math.round(ltv * 1000)} initial={{ opacity: 0.5 }} animate={{ opacity: 1 }} className={cn("num relative mt-1 text-5xl", ltvTone)}>
            {ltv === null ? "—" : `${(ltv * 100).toFixed(1)}%`}
          </motion.p>
          <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-positive via-warning to-destructive" animate={{ width: `${Math.min(100, ((ltv ?? 0) / liqLtv) * 100)}%` }} />
          </div>
          <p className="relative mt-1.5 text-right text-xs text-muted-foreground">Liquidation at {(liqLtv * 100).toFixed(0)}%</p>
          <div className="relative mt-4 divide-y divide-border">
            <KV k="Collateral value" v={<span className="num">{formatUsd(value)}</span>} />
            <KV k={`${col.symbol} price`} v={<span className={cn("num", price?.stale && "text-warning")}>{price ? `${formatUsd(price.price)}${price.stale ? " · stale" : ""}` : "Unavailable"}</span>} />
            <KV k={`Liquidation price`} v={<span className="num">{liq ? formatUsd(liq) : "—"}</span>} />
            <KV k={`Worst case interest (${formatDuration(term)})`} v={<span className="num">{formatAmount(worstInterest, 4)} tUSDC</span>} />
            <KV k="Repay at most" v={<span className="num">{prin ? `${formatAmount(prin + worstInterest, 4)} tUSDC` : "—"}</span>} />
            <KV k="Grace after maturity" v={formatDuration(Math.min(Math.floor(term / 10), PROTOCOL.MAX_GRACE))} />
          </div>
        </Panel>
        <Panel className="p-5">
          <WalletGate title="Connect to borrow" body="Your collateral is locked by the exchange contract until you repay.">
            {errors.length > 0 && <div className="mb-3 space-y-1">{errors.map((e) => <p key={e} className="text-sm text-destructive">{e}</p>)}</div>}
            <Btn size="lg" className="w-full" disabled={!ready || busy} onClick={() => void submit()} data-testid="button-create-request">
              Post request for {prin ? `${formatAmount(prin)} tUSDC` : "tUSDC"}
            </Btn>
            <p className="mt-3 text-xs text-muted-foreground">You can cancel any time before the first bid. With bids, accept the best one or let the auction settle.</p>
            <TxStatus progress={progress} className="mt-3" />
          </WalletGate>
        </Panel>
      </div>
    </div>
  );
}

function MyRequests() {
  const { address } = useAccount();
  const params = { borrower: address, status: "all" as const, sort: "newest" as const, limit: 50 };
  const { data, isLoading } = useListRequests(params, { query: { queryKey: getListRequestsQueryKey(params), enabled: !!address, refetchInterval: LIVE } });
  if (!address) return null;
  return (
    <Panel className="mt-3">
      <PanelHeader title="Your requests" live />
      {isLoading ? <SkelRows rows={3} /> : data && data.length > 0 ? (
        <div className="pb-2">
          {data.map((r, i) => <RequestRow key={r.id} r={r} i={i} action={<StatusPill status={r.status} />} />)}
        </div>
      ) : (
        <EmptyState icon={<FileText className="h-5 w-5" />} title="No requests yet" body="Fill in the form above. Short presets like a 3 minute auction and a 1 hour term make for a fast first loan." action={<LinkBtn href="/app/portfolio#faucet" variant="secondary">Get test collateral</LinkBtn>} />
      )}
    </Panel>
  );
}

export default function BorrowPage() {
  return (
    <>
      <PageHead title="Borrow" sub="Lock collateral, set the highest rate you would pay, and let lenders compete to fund you." />
      <CreateForm />
      <MyRequests />
    </>
  );
}
