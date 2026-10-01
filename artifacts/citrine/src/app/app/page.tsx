"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Activity, ArrowRight, Gavel, LineChart, Trophy } from "lucide-react";
import {
  useGetMarketStats,
  getGetMarketStatsQueryKey,
  useListRates,
  getListRatesQueryKey,
  useGetRateCurve,
  getGetRateCurveQueryKey,
  useListRequests,
  getListRequestsQueryKey,
  useListActivity,
  getListActivityQueryKey,
  useGetLeaderboard,
  getGetLeaderboardQueryKey,
  useListLoans,
  getListLoansQueryKey,
} from "@workspace/api-client-react";
import { AnimatedNumber, EmptyState, ErrorState, LinkBtn, Panel, PanelHeader, Seg, Skel, SkelRows, StatusPill, fadeUp } from "@/components/citrine/primitives";
import { ActivityList } from "@/components/citrine/activity";
import { RateCurveChart, RateHistoryChart, RequestHeaderRow, RequestRow } from "@/components/citrine/widgets";
import { LIVE } from "@/lib/market";
import { useSession } from "@/lib/session";
import { displayName, formatAmount, formatDuration, formatRate, formatUsd } from "@/lib/format";
import { collaterals } from "@/lib/web3/contracts";

function Stats() {
  const { data, isLoading, isError, refetch } = useGetMarketStats({ query: { queryKey: getGetMarketStatsQueryKey(), refetchInterval: LIVE } });
  if (isError) return <Panel><ErrorState onRetry={() => void refetch()} /></Panel>;
  const big = [
    { label: "Outstanding credit", v: data?.outstandingPrincipal, f: (n: number) => formatUsd(n, true), sub: data ? `${data.activeLoans} active loans` : "" },
    { label: "7 day clearing rate", v: data?.averageRateBps ?? undefined, f: formatRate, sub: "principal weighted", accent: true },
    { label: "Collateral locked", v: data?.collateralLockedUsd, f: (n: number) => formatUsd(n, true), sub: "valued by Pyth" },
    { label: "24h volume", v: data?.volume24h, f: (n: number) => formatUsd(n, true), sub: data ? `${formatUsd(data.secondaryVolume, true)} traded secondary` : "" },
  ];
  const small = data
    ? [
        ["Open auctions", data.openRequests],
        ["Listings", data.activeListings],
        ["Originated", formatUsd(data.totalOriginated, true)],
        ["Repaid", formatUsd(data.totalRepaid, true)],
        ["Funded / repaid", `${data.loansFunded} / ${data.loansRepaid}`],
        ["Defaults / liquidations", `${data.loansDefaulted} / ${data.loansLiquidated}`],
        ["Borrowers / lenders", `${data.uniqueBorrowers} / ${data.uniqueLenders}`],
      ]
    : [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {big.map((s, i) => (
          <motion.div key={s.label} variants={fadeUp} initial="hidden" animate="show" custom={i}>
            <Panel className="relative overflow-hidden p-5">
              {s.accent && <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/15 blur-2xl" />}
              <p className="relative text-xs text-muted-foreground">{s.label}</p>
              <p className={`relative mt-2 text-[28px] leading-tight ${s.accent ? "text-primary" : ""}`}>
                {isLoading ? <Skel className="h-8 w-28" /> : s.v === undefined ? <span className="num text-muted-foreground">—</span> : <AnimatedNumber value={s.v} format={s.f} />}
              </p>
              <p className="relative mt-1 text-xs text-muted-foreground">{s.sub}</p>
            </Panel>
          </motion.div>
        ))}
      </div>
      {small.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-2xl border border-border px-5 py-3 text-xs">
          {small.map(([k, v]) => (
            <span key={k as string} className="text-muted-foreground">
              {k} <span className="num ml-1 text-foreground">{v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RateHistory() {
  const [col, setCol] = useState<string>("all");
  const params = { collateral: col === "all" ? undefined : col, limit: 120 };
  const { data, isLoading } = useListRates(params, { query: { queryKey: getListRatesQueryKey(params), refetchInterval: LIVE } });
  return (
    <Panel className="lg:col-span-2">
      <PanelHeader
        title="Clearing rates"
        hint="Every funded loan, by the rate it cleared at"
        live
        right={<Seg value={col} onChange={setCol} options={[{ label: "All", value: "all" }, ...collaterals.map((c) => ({ label: c.symbol, value: c.symbol }))]} />}
      />
      <div className="px-3 pb-4">
        {isLoading ? <Skel className="mx-2 h-[240px]" /> : data && data.length > 0 ? <RateHistoryChart points={data} /> : (
          <EmptyState icon={<LineChart className="h-5 w-5" />} title="No loans have cleared yet" body="The first funded loan draws the first point on this chart." action={<LinkBtn href="/app/borrow">Post a request</LinkBtn>} />
        )}
      </div>
    </Panel>
  );
}

function Curve() {
  const { data, isLoading } = useGetRateCurve({ query: { queryKey: getGetRateCurveQueryKey(), refetchInterval: 8_000 } });
  const has = data?.some((d) => d.loans > 0);
  return (
    <Panel>
      <PanelHeader title="Rate by term" hint="Average APR per term bucket" />
      <div className="px-3 pb-4">
        {isLoading ? <Skel className="mx-2 h-[240px]" /> : has && data ? <RateCurveChart points={data} height={240} /> : <p className="grid h-[240px] place-items-center text-sm text-muted-foreground">Waiting for funded loans</p>}
      </div>
    </Panel>
  );
}

function EndingSoon() {
  const params = { status: "open" as const, sort: "ending" as const, limit: 6 };
  const { data, isLoading, isError, refetch } = useListRequests(params, { query: { queryKey: getListRequestsQueryKey(params), refetchInterval: 3_000 } });
  return (
    <Panel className="lg:col-span-2">
      <PanelHeader title="Auctions ending soon" live right={<Link href="/app/lend" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">All auctions <ArrowRight className="h-3.5 w-3.5" /></Link>} />
      {isLoading ? <SkelRows /> : isError ? <ErrorState onRetry={() => void refetch()} /> : data && data.length > 0 ? (
        <div className="pb-2">
          <RequestHeaderRow />
          {data.map((r, i) => (
            <RequestRow key={r.id} r={r} i={i} action={<LinkBtn href={`/app/requests/${r.id}`} variant="secondary" className="h-8 px-3.5 text-[13px]">Bid</LinkBtn>} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Gavel className="h-5 w-5" />} title="No open auctions" body="Be the first borrower. Lock collateral and let lenders compete for your loan." action={<LinkBtn href="/app/borrow">Create a request</LinkBtn>} />
      )}
    </Panel>
  );
}

function Feed() {
  const { data, isLoading } = useListActivity({ limit: 14 }, { query: { queryKey: getListActivityQueryKey({ limit: 14 }), refetchInterval: 3_000 } });
  return (
    <Panel className="lg:row-span-2">
      <PanelHeader title="Activity" live />
      {isLoading ? <SkelRows rows={6} /> : data && data.length > 0 ? <ActivityList events={data} /> : (
        <EmptyState icon={<Activity className="h-5 w-5" />} title="Nothing yet" body="Contract events stream here as they land on Monad." />
      )}
    </Panel>
  );
}

function RecentLoans() {
  const params = { status: "active" as const, limit: 6 };
  const { data, isLoading } = useListLoans(params, { query: { queryKey: getListLoansQueryKey(params), refetchInterval: LIVE } });
  return (
    <Panel>
      <PanelHeader title="Active loans" hint="Live positions on the book" />
      {isLoading ? <SkelRows rows={3} /> : data && data.length > 0 ? (
        <div className="px-3 pb-3">
          {data.map((l) => (
            <Link key={l.id} href={`/app/loans/${l.id}`} className="flex items-center justify-between rounded-xl px-2 py-2.5 hover:bg-accent/50">
              <div>
                <p className="num text-sm">{formatAmount(l.principal)} tUSDC <span className="text-muted-foreground">#{l.id}</span></p>
                <p className="text-xs text-muted-foreground">{formatDuration((new Date(l.maturity).getTime() - new Date(l.startTime).getTime()) / 1000)} · {l.collateralSymbol}</p>
              </div>
              <div className="text-right">
                <p className="num text-sm text-primary">{formatRate(l.rateBps)}</p>
                {l.listing ? <StatusPill status="listed" /> : <p className="text-xs text-muted-foreground">LTV {formatRate(l.ltvBps)}</p>}
              </div>
            </Link>
          ))}
        </div>
      ) : <p className="px-5 pb-6 text-sm text-muted-foreground">No active loans yet.</p>}
    </Panel>
  );
}

function Leaders() {
  const [side, setSide] = useState<"lenders" | "borrowers">("lenders");
  const { data, isLoading } = useGetLeaderboard({ query: { queryKey: getGetLeaderboardQueryKey(), refetchInterval: 10_000 } });
  const rows = data?.[side] ?? [];
  return (
    <Panel>
      <PanelHeader title="Leaderboard" right={<Seg value={side} onChange={setSide} options={[{ label: "Lenders", value: "lenders" }, { label: "Borrowers", value: "borrowers" }]} />} />
      {isLoading ? <SkelRows rows={4} /> : rows.length > 0 ? (
        <div className="px-3 pb-3">
          {rows.slice(0, 8).map((e, i) => (
            <div key={e.address} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent/50">
              <span className={`num w-5 text-sm ${i < 3 ? "text-primary" : "text-muted-foreground"}`}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{displayName(e.address, e.name)}</span>
              <span className="text-right">
                <span className="num block text-sm">{formatUsd(e.volume, true)}</span>
                <span className="block text-xs text-muted-foreground">{e.loans} loans · {formatRate(e.averageRateBps)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Trophy className="h-5 w-5" />} title="No ranks yet" body="Fund or take a loan to claim the first spot." />
      )}
    </Panel>
  );
}

export default function MarketPage() {
  const { user } = useSession();
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Good to see you, @{user?.username}</p>
          <h1 className="font-display text-3xl font-semibold md:text-[34px]">Market</h1>
        </div>
        <div className="flex gap-2">
          <LinkBtn href="/app/lend" variant="secondary">Lend</LinkBtn>
          <LinkBtn href="/app/borrow">Borrow</LinkBtn>
        </div>
      </div>
      <Stats />
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <RateHistory />
        <Curve />
        <EndingSoon />
        <Feed />
        <div className="grid gap-3 lg:col-span-2 lg:grid-cols-2">
          <RecentLoans />
          <Leaders />
        </div>
      </div>
    </>
  );
}
