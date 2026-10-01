"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Briefcase, Droplets, Link2, Unlink } from "lucide-react";
import { useGetPortfolio, getGetPortfolioQueryKey, type Loan } from "@workspace/api-client-react";
import { AnimatedNumber, Btn, Countdown, EmptyState, ErrorState, LinkBtn, PageHead, Panel, PanelHeader, Seg, Skel, SkelRows, StatusPill } from "@/components/citrine/primitives";
import { ActivityList } from "@/components/citrine/activity";
import { RequestRow } from "@/components/citrine/widgets";
import { Faucet, WalletGate } from "@/components/citrine/wallet";
import { TxStatus } from "@/components/citrine/tx-status";
import { useCitrineActions } from "@/lib/web3/actions";
import { useWalletState } from "@/lib/web3/reads";
import { useSession } from "@/lib/session";
import { LIVE, liveOwed, sameAddr } from "@/lib/market";
import { apiErrorMessage } from "@/lib/api-error";
import { displayName, formatAmount, formatRate, formatUsd, shortAddress } from "@/lib/format";
import { useNow } from "@/hooks/use-now";

function LoanLine({ l, role }: { l: Loan; role: "borrower" | "holder" }) {
  const now = useNow();
  const owed = l.status === "active" ? liveOwed(l.principal, l.rateBps, l.startTime, now) : l.owedNow;
  return (
    <Link href={`/app/loans/${l.id}`} className="grid grid-cols-2 items-center gap-3 border-t border-border px-5 py-3.5 first:border-t-0 hover:bg-accent/40 md:grid-cols-[64px_1.3fr_1fr_1fr_auto]">
      <span className="num text-sm text-muted-foreground">#{l.id}</span>
      <div>
        <p className="num text-[15px]">{formatAmount(owed, 4)} <span className="text-xs text-muted-foreground">tUSDC {role === "borrower" ? "owed" : "due to you"}</span></p>
        <p className="text-xs text-muted-foreground">{formatAmount(l.collateralAmount)} {l.collateralSymbol} · {role === "borrower" ? `lender ${displayName(l.holder ?? l.lender, l.holderName ?? l.lenderName)}` : `borrower ${displayName(l.borrower, l.borrowerName)}`}</p>
      </div>
      <span className="num text-sm text-primary">{formatRate(l.rateBps)}</span>
      <span className="text-sm"><Countdown to={l.maturity} endedLabel="Matured" /></span>
      <span className="flex justify-end">{l.listing ? <StatusPill status="listed" /> : <StatusPill status={l.status} />}</span>
    </Link>
  );
}

function IdentityCard() {
  const { user, linkWallet, unlinkWallet } = useSession();
  const { address } = useAccount();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const linked = !!user.wallet;
  const matches = sameAddr(user.wallet, address);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(apiErrorMessage(e, "That did not go through."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="p-5">
      <p className="text-xs text-muted-foreground">Identity</p>
      <p className="mt-1 font-display text-2xl font-semibold">@{user.username}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {linked ? <>Linked to <span className="num text-foreground">{shortAddress(user.wallet)}</span>{!matches && address ? ". Your connected wallet is different." : "."}</> : "Link your wallet so your name appears next to your bids and loans."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {(!linked || (!matches && address)) && (
          <Btn size="sm" disabled={busy || !address} onClick={() => void run(linkWallet, "Wallet linked")}>
            <Link2 className="h-3.5 w-3.5" /> {address ? `Link ${shortAddress(address)}` : "Connect a wallet to link"}
          </Btn>
        )}
        {linked && (
          <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void run(unlinkWallet, "Wallet unlinked")}>
            <Unlink className="h-3.5 w-3.5" /> Unlink
          </Btn>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Linking asks your wallet to sign a message. It costs no gas.</p>
    </Panel>
  );
}

function Claimable() {
  const w = useWalletState();
  const { claim, progress, busy } = useCitrineActions();
  return (
    <Panel>
      <PanelHeader title="Withdraw from exchange" hint="Refunded bids, repayments and sale proceeds" />
      <div className="px-5 pb-5">
        {w.loading ? <Skel className="h-12" /> : w.claimable.length === 0 ? (
          <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">Nothing to withdraw. When you are outbid or repaid, funds wait here.</p>
        ) : (
          <div className="space-y-2">
            {w.claimable.map((c) => (
              <div key={c.token} className="flex items-center justify-between rounded-xl bg-primary/8 px-4 py-3 ring-1 ring-inset ring-primary/20">
                <span className="num">{formatAmount(c.value)} {c.symbol}</span>
                <Btn size="sm" disabled={busy} onClick={() => void claim(c.token, c.symbol)}>Withdraw</Btn>
              </div>
            ))}
          </div>
        )}
        <TxStatus progress={progress} className="mt-3" />
      </div>
    </Panel>
  );
}

type Tab = "requests" | "bids" | "borrowings" | "positions" | "listings" | "history";

function PortfolioBody({ address }: { address: string }) {
  const [tab, setTab] = useState<Tab>("borrowings");
  const { data, isLoading, isError, refetch } = useGetPortfolio(address, { query: { queryKey: getGetPortfolioQueryKey(address), refetchInterval: LIVE } });
  if (isError) return <Panel><ErrorState onRetry={() => void refetch()} /></Panel>;
  const s = data?.summary;
  const cards = [
    ["Debt outstanding", s?.debtOutstanding, true],
    ["Collateral locked", s?.collateralLockedUsd, true],
    ["Positions face value", s?.positionsFaceValue, false],
    ["Escrowed in bids", s?.escrowedInBids, false],
    ["Interest earned", s?.interestEarned, false],
    ["Interest paid", s?.interestPaid, false],
  ] as const;
  const counts: Record<Tab, number> = {
    requests: data?.requests.length ?? 0,
    bids: data?.bids.length ?? 0,
    borrowings: data?.borrowings.length ?? 0,
    positions: data?.positions.length ?? 0,
    listings: data?.listings.length ?? 0,
    history: data?.history.length ?? 0,
  };
  const empty = (title: string, body: string, href: string, cta: string) => <EmptyState icon={<Briefcase className="h-5 w-5" />} title={title} body={body} action={<LinkBtn href={href}>{cta}</LinkBtn>} />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([k, v]) => (
          <Panel key={k} className="p-4">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-1.5 text-xl">{isLoading || v === undefined ? <Skel className="h-6 w-20" /> : <AnimatedNumber value={v} format={(n) => formatUsd(n)} />}</p>
          </Panel>
        ))}
      </div>
      <Panel>
        <div className="px-5 pt-4 pb-2">
          <Seg
            value={tab}
            onChange={setTab}
            options={(["borrowings", "positions", "requests", "bids", "listings", "history"] as Tab[]).map((t) => ({ label: `${t.charAt(0).toUpperCase() + t.slice(1)} ${counts[t] ? counts[t] : ""}`.trim(), value: t }))}
          />
        </div>
        {isLoading || !data ? <SkelRows /> : (
          <div className="pb-2">
            {tab === "borrowings" && (data.borrowings.length ? data.borrowings.map((l) => <LoanLine key={l.id} l={l} role="borrower" />) : empty("No loans as borrower", "Post a request and accept a bid to borrow tUSDC.", "/app/borrow", "Borrow"))}
            {tab === "positions" && (data.positions.length ? data.positions.map((l) => <LoanLine key={l.id} l={l} role="holder" />) : empty("No positions held", "Win an auction or buy a listed position to start earning.", "/app/lend", "Lend"))}
            {tab === "requests" && (data.requests.length ? data.requests.map((r, i) => <RequestRow key={r.id} r={r} i={i} action={<StatusPill status={r.status} />} />) : empty("No open requests", "Your open asks for credit show up here.", "/app/borrow", "Create a request"))}
            {tab === "bids" && (data.bids.length ? data.bids.map((r, i) => <RequestRow key={r.id} r={r} i={i} action={<span className="text-xs text-positive">Leading</span>} />) : empty("No leading bids", "Auctions where you hold the best bid appear here.", "/app/lend", "Browse auctions"))}
            {tab === "listings" && (data.listings.length ? data.listings.map((x) => (
              <Link key={x.loanId} href={`/app/loans/${x.loanId}`} className="flex items-center justify-between border-t border-border px-5 py-3.5 first:border-t-0 hover:bg-accent/40">
                <span className="num text-sm">#{x.loanId} · {formatAmount(x.price)} tUSDC</span>
                <span className="num text-sm text-primary">{formatRate(x.yieldToMaturityBps)} YTM</span>
              </Link>
            )) : empty("Nothing listed", "List a position from its loan page to sell it before maturity.", "/app/trade", "Trade desk"))}
            {tab === "history" && (data.history.length ? <ActivityList events={data.history} /> : empty("No history yet", "Every action you take onchain is recorded here.", "/app", "Market"))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function PortfolioPage() {
  const { address } = useAccount();
  return (
    <>
      <PageHead title="Portfolio" sub="Everything your wallet owes, holds, and can withdraw." />
      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div>
          <WalletGate title="Connect to see your portfolio" body="Requests, loans and positions are tied to your wallet address on Monad.">
            {address && <PortfolioBody address={address} />}
          </WalletGate>
        </div>
        <div className="space-y-3">
          <IdentityCard />
          <Claimable />
          <Panel id="faucet" className="scroll-mt-24">
            <PanelHeader title="Test token faucet" hint="Free testnet tokens, once per cooldown" right={<Droplets className="h-4 w-4 text-primary" />} />
            <Faucet />
          </Panel>
        </div>
      </div>
    </>
  );
}
