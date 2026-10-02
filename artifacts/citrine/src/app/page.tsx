"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight, ArrowUpRight, Clock3, Gavel, Layers, Lock, Repeat2, ShieldCheck, Zap } from "lucide-react";
import {
  useGetMarketStats,
  getGetMarketStatsQueryKey,
  useListActivity,
  getListActivityQueryKey,
  useListRequests,
  getListRequestsQueryKey,
  useGetRequest,
  getGetRequestQueryKey,
  useGetRateCurve,
  getGetRateCurveQueryKey,
} from "@workspace/api-client-react";
import { deployment } from "@workspace/contracts";
import { AnimatedNumber, Countdown, LiveDot, Logo, Skel } from "@/components/citrine/primitives";
import { ActivityList, describe } from "@/components/citrine/activity";
import { RateCurveChart } from "@/components/citrine/widgets";
import { LIVE } from "@/lib/market";
import { displayName, formatAmount, formatDuration, formatRate, formatRelative, formatUsd, shortAddress } from "@/lib/format";
import { explorerAddress } from "@/lib/web3/contracts";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

const ease = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.8, delay, ease }} className={className}>
      {children}
    </motion.div>
  );
}

function StartLink({ className, children = "Start" }: { className?: string; children?: React.ReactNode }) {
  return (
    <Link href="/start" className={cn("group inline-flex items-center gap-2 rounded-full bg-primary font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]", className)} data-testid="link-start">
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function Nav() {
  return (
    <motion.header initial={{ y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto mt-3 flex max-w-6xl items-center justify-between rounded-full border border-border/70 bg-background/70 px-3 py-2 pl-5 backdrop-blur-xl">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#market" className="hover:text-foreground">Market</a>
          <a href="#positions" className="hover:text-foreground">Positions</a>
          <a href="#monad" className="hover:text-foreground">Monad</a>
        </nav>
        <StartLink className="h-9 px-4 text-sm" />
      </div>
    </motion.header>
  );
}

function LiveBoard() {
  const now = useNow();
  const open = useListRequests({ status: "open", sort: "ending", limit: 6 }, { query: { queryKey: getListRequestsQueryKey({ status: "open", sort: "ending", limit: 6 }), refetchInterval: LIVE } });
  // Prefer a running auction that already has bids, since it shows the rate falling.
  const running = open.data?.filter((r) => new Date(r.auctionEnd).getTime() > now) ?? [];
  const live = running.find((r) => r.bidCount > 0) ?? running[0] ?? open.data?.[0];
  const detail = useGetRequest(live?.id ?? 0, { query: { queryKey: getGetRequestQueryKey(live?.id ?? 0), enabled: !!live, refetchInterval: 3_000 } });
  const stats = useGetMarketStats({ query: { queryKey: getGetMarketStatsQueryKey(), refetchInterval: LIVE } });

  if (open.isLoading) {
    return (
      <div className="panel space-y-4 p-6">
        <Skel className="h-5 w-32" />
        <Skel className="h-16 w-48" />
        <Skel className="h-32" />
      </div>
    );
  }

  if (!live) {
    return (
      <div className="panel relative overflow-hidden p-7">
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><LiveDot tone="primary" /> Order book</p>
        <p className="mt-6 font-display text-2xl font-semibold">The book is open and waiting for the first ask.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {stats.data?.averageRateBps ? `Loans this week cleared at ${formatRate(stats.data.averageRateBps)} on average.` : "Post a request and watch lenders compete for it in real time."}
        </p>
        <StartLink className="mt-6 h-10 px-5 text-sm">Post the first request</StartLink>
      </div>
    );
  }

  const bids = detail.data?.bids ?? [];
  const best = live.bestRateBps;
  return (
    <div className="panel relative overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="flex items-center gap-2 text-sm"><LiveDot /> Live auction <span className="num text-muted-foreground">#{live.id}</span></span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /><Countdown to={live.auctionEnd} className="text-foreground" /></span>
      </div>
      <div className="px-6 pt-5">
        <p className="text-sm text-muted-foreground">
          {displayName(live.borrower, live.borrowerName)} wants <span className="num text-foreground">{formatAmount(live.principal)} tUSDC</span> for {formatDuration(live.duration)}
        </p>
        <div className="mt-4 flex items-end gap-4">
          <motion.span key={best ?? "none"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="num text-6xl text-primary md:text-7xl">
            {best !== null ? formatRate(best) : formatRate(live.maxRateBps)}
          </motion.span>
          <span className="pb-3 text-sm text-muted-foreground">{best !== null ? "best bid" : "ask ceiling"}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground num">
          Started at {formatRate(live.maxRateBps)} max · {formatAmount(live.collateralAmount)} {live.collateralSymbol} locked
        </p>
      </div>
      <div className="mt-5 border-t border-border px-3 py-3">
        {bids.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">No bids yet. The first lender sets the opening rate.</p>
        ) : (
          bids.slice(0, 4).map((b, i) => (
            <motion.div key={b.txHash} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm">
              <span className={cn("num", i === 0 ? "text-primary" : "text-muted-foreground")}>{formatRate(b.rateBps)}</span>
              <span className="text-muted-foreground">{displayName(b.bidder, b.bidderName)}</span>
              <span className="text-xs text-muted-foreground">{formatRelative(b.timestamp, now)}</span>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const words = ["Credit,", "priced", "by", "the", "people", "lending", "it."];
  return (
    <section ref={ref} className="relative overflow-hidden pt-36 pb-20 md:pt-44">
      <div className="grid-fade pointer-events-none absolute inset-0 opacity-60" />
      <motion.div style={{ y }} className="pointer-events-none absolute -top-40 right-[-10%] h-[720px] w-[720px]">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,hsl(56_96%_58%/.28),hsl(40_96%_50%/.08)_45%,transparent_70%)]" />
        <div className="spin-slow absolute inset-[12%] rounded-full border border-dashed border-primary/20" />
        <div className="spin-slow absolute inset-[24%] rounded-full border border-primary/10 [animation-direction:reverse]" />
      </motion.div>
      <motion.div style={{ opacity: fade }} className="relative mx-auto grid max-w-6xl gap-14 px-5 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
            <LiveDot /> Live on Monad Testnet
          </motion.div>
          <h1 className="font-display text-[52px] font-semibold leading-[0.95] md:text-[84px]">
            {words.map((w, i) => (
              <motion.span key={i} initial={{ y: 40 }} animate={{ y: 0 }} transition={{ delay: 0.15 + i * 0.07, duration: 0.8, ease }} className={cn("mr-[0.22em] inline-block", i >= 4 && "text-primary")}>
                {w}
              </motion.span>
            ))}
          </h1>
          <motion.p initial={{ y: 8 }} animate={{ y: 0 }} transition={{ delay: 0.8 }} className="mt-7 max-w-lg text-lg text-muted-foreground">
            Lock MON, ETH or BTC and name the most you would pay. Lenders bid the rate down in an open auction. The lowest rate wins, and the loan becomes a position anyone can trade.
          </motion.p>
          <motion.div initial={{ y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95 }} className="mt-9 flex flex-wrap items-center gap-4">
            <StartLink className="h-12 px-7 text-[15px]">Start trading credit</StartLink>
            <a href="#how" className="text-sm text-muted-foreground hover:text-foreground">See how a rate is set</a>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.5, duration: 0.9, ease }}>
          <LiveBoard />
        </motion.div>
      </motion.div>
    </section>
  );
}

function StatsStrip() {
  const { data, isLoading } = useGetMarketStats({ query: { queryKey: getGetMarketStatsQueryKey(), refetchInterval: LIVE } });
  const items = [
    { label: "Originated", value: data?.totalOriginated, fmt: (n: number) => formatUsd(n, true) },
    { label: "Outstanding", value: data?.outstandingPrincipal, fmt: (n: number) => formatUsd(n, true) },
    { label: "Collateral locked", value: data?.collateralLockedUsd, fmt: (n: number) => formatUsd(n, true) },
    { label: "7 day clearing rate", value: data?.averageRateBps ?? undefined, fmt: (n: number) => formatRate(n) },
    { label: "Loans funded", value: data?.loansFunded, fmt: (n: number) => Math.round(n).toLocaleString() },
  ];
  return (
    <section id="market" className="relative border-y border-border bg-card/40">
      <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-5">
        {items.map((it, i) => (
          <Reveal key={it.label} delay={i * 0.06} className={cn("px-5 py-8", i > 0 && "md:border-l md:border-border")}>
            <p className="text-xs text-muted-foreground">{it.label}</p>
            <p className="mt-2 text-2xl md:text-3xl">
              {isLoading ? <Skel className="h-8 w-24" /> : it.value === undefined ? <span className="num text-muted-foreground">—</span> : <AnimatedNumber value={it.value} format={it.fmt} />}
            </p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Ticker() {
  const { data } = useListActivity({ limit: 24 }, { query: { queryKey: getListActivityQueryKey({ limit: 24 }), refetchInterval: LIVE } });
  if (!data || data.length === 0) return null;
  const row = [...data, ...data];
  return (
    <div className="relative overflow-hidden border-b border-border py-3.5 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
      <div className="marquee flex w-max gap-10">
        {row.map((e, i) => (
          <span key={`${e.id}-${i}`} className="flex items-center gap-2.5 whitespace-nowrap text-sm text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-primary" />
            {describe(e)}
          </span>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Lock, title: "Lock collateral, name your ceiling", body: "Choose MON, tWETH or tWBTC, the tUSDC you need, a term from five minutes to a year, and the highest APR you would accept. Collateral goes into the exchange contract, not to a person." },
  { icon: Gavel, title: "Lenders bid the rate down", body: "Each bid must beat the last by at least 0.05%. The best bidder's tUSDC sits in escrow; anyone outbid gets theirs back. Late bids extend the clock, so nobody wins by sniping." },
  { icon: Zap, title: "Accept, or let the clock settle it", body: "Take the best bid whenever you like, or let the auction end and anyone can settle it. tUSDC lands in your wallet in the same block on Monad." },
  { icon: Repeat2, title: "The loan becomes a tradable position", body: "The lender receives an ERC-721 that carries the right to be repaid. List it at any price, and a buyer steps into the loan before it matures." },
];

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-28">
      <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <Reveal>
            <p className="text-sm text-primary">How a rate is set</p>
            <h2 className="mt-3 font-display text-4xl font-semibold leading-tight md:text-5xl">No pool formula. No utilisation curve. Just bids.</h2>
            <p className="mt-5 max-w-md text-muted-foreground">
              Lending pools set your rate from a spreadsheet curve. Citrine lets lenders compete for every single loan, so the price of credit is whatever the market will actually pay.
            </p>
          </Reveal>
        </div>
        <div className="relative space-y-4">
          <div className="absolute left-[27px] top-6 bottom-6 w-px bg-gradient-to-b from-primary/60 via-border to-transparent" />
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.05}>
              <div className="relative flex gap-5 rounded-2xl p-3 transition-colors hover:bg-card/60">
                <span className="relative z-10 grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-card text-primary ring-1 ring-border">
                  <s.icon className="h-5 w-5" />
                </span>
                <div className="pt-1.5">
                  <p className="num text-xs text-muted-foreground">0{i + 1}</p>
                  <h3 className="mt-1 text-xl font-medium">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CurveSection() {
  const { data, isLoading } = useGetRateCurve({ query: { queryKey: getGetRateCurveQueryKey(), refetchInterval: 8_000 } });
  const hasData = data?.some((p) => p.loans > 0);
  return (
    <section className="relative border-y border-border bg-card/30 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-[1fr_1.4fr] lg:items-center">
        <Reveal>
          <p className="text-sm text-primary">The yield curve, from real loans</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight">Every bar is a clearing price someone actually paid.</h2>
          <p className="mt-5 text-muted-foreground">Rates grouped by loan term, rebuilt from contract events as they land. Short loans and long loans price differently, and you can see it.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="panel p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>Average APR by term</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><LiveDot /> Updating</span>
            </div>
            {isLoading ? (
              <Skel className="h-[240px]" />
            ) : hasData && data ? (
              <RateCurveChart points={data} height={240} />
            ) : (
              <div className="grid h-[240px] place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <p>No loans have cleared yet.</p>
                  <Link href="/start" className="mt-2 inline-block text-primary hover:underline">Fund the first one</Link>
                </div>
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PositionCard() {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [10, -10]), { stiffness: 150, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-12, 12]), { stiffness: 150, damping: 18 });
  const now = useNow();
  const secs = Math.floor(now / 1000) % 86_400;
  return (
    <div
      className="[perspective:1200px]"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onMouseLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      <motion.div style={{ rotateX: rx, rotateY: ry }} className="relative mx-auto aspect-[4/5] w-full max-w-[360px] overflow-hidden rounded-[28px] border border-primary/30 bg-[linear-gradient(160deg,hsl(56_70%_14%),hsl(48_12%_6%)_55%)] p-7 shadow-2xl">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
        <div className="relative flex h-full flex-col">
          <div className="flex items-center justify-between">
            <Logo size={22} />
            <span className="num text-xs text-muted-foreground">ERC-721</span>
          </div>
          <p className="mt-10 text-xs text-muted-foreground">Position</p>
          <p className="font-display text-3xl font-semibold">Loan position</p>
          <div className="mt-auto space-y-3 text-sm">
            <div className="flex justify-between border-t border-primary/15 pt-3"><span className="text-muted-foreground">Pays</span><span>Principal plus interest</span></div>
            <div className="flex justify-between border-t border-primary/15 pt-3"><span className="text-muted-foreground">Secured by</span><span>Locked collateral</span></div>
            <div className="flex justify-between border-t border-primary/15 pt-3"><span className="text-muted-foreground">Accruing</span><span className="num text-primary">every second · {String(secs).padStart(5, "0")}</span></div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Positions() {
  return (
    <section id="positions" className="mx-auto max-w-6xl px-5 py-28">
      <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
        <Reveal><PositionCard /></Reveal>
        <Reveal delay={0.1}>
          <p className="text-sm text-primary">Exit before maturity</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight md:text-5xl">Lending without the lock-up.</h2>
          <p className="mt-5 text-muted-foreground">
            When a loan funds, the lender is minted a position NFT with its artwork drawn fully onchain. Repayment goes to whoever holds it. Need your tUSDC back early? List the position, and the Trade desk shows buyers its exact yield to maturity.
          </p>
          <ul className="mt-8 space-y-4 text-[15px]">
            {[
              [Layers, "Artwork and terms read straight from tokenURI on the exchange contract"],
              [ShieldCheck, "Liquidatable when debt reaches 85% of collateral value, priced by RedStone"],
              [Clock3, "If the borrower misses maturity plus grace, the holder claims the collateral"],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Layers;
              return (
                <li key={i} className="flex gap-3">
                  <I className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span className="text-muted-foreground">{text as string}</span>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function MonadSection() {
  const facts = [
    { big: "~0.4s", label: "Block time", body: "Bids, accepts and repayments confirm before you finish reading the toast. Short auctions are actually usable." },
    { big: "RedStone", label: "Oracle", body: "Collateral is valued with RedStone feeds. A liquidation carries a price signed by three RedStone nodes, checked by the contract." },
    { big: "100%", label: "Onchain", body: "Escrow, auctions, positions and liquidations all live in one exchange contract you can read." },
  ];
  return (
    <section id="monad" className="relative overflow-hidden border-y border-border bg-card/30 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <p className="text-sm text-primary">Why Monad</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight md:text-5xl">An auction is only fair if everyone sees the same clock.</h2>
        </Reveal>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-[1.3fr_1fr_1fr]">
          {facts.map((f, i) => (
            <Reveal key={f.label} delay={i * 0.08} className="bg-background p-8">
              <p className={cn("font-display font-semibold text-primary", i === 0 ? "text-7xl" : "text-5xl")}>{f.big}</p>
              <p className="mt-4 font-medium">{f.label}</p>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.1}>
          <a href={explorerAddress(deployment.exchange)} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
            Exchange contract <span className="num">{shortAddress(deployment.exchange)}</span> <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}

function LiveFeed() {
  const { data, isLoading } = useListActivity({ limit: 8 }, { query: { queryKey: getListActivityQueryKey({ limit: 8 }), refetchInterval: 3_000 } });
  return (
    <section className="mx-auto max-w-6xl px-5 py-28">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr]">
        <Reveal>
          <p className="text-sm text-primary">Right now</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight">The tape never lies.</h2>
          <p className="mt-5 text-muted-foreground">Every event below came from a Monad block in the last few moments. Click through to the explorer and check it.</p>
          <StartLink className="mt-8 h-11 px-6 text-sm">Join the market</StartLink>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="panel py-3">
            <div className="flex items-center gap-2 px-5 pb-2 text-sm"><LiveDot /> Activity</div>
            {isLoading ? (
              <div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, i) => <Skel key={i} className="h-10" />)}</div>
            ) : data && data.length > 0 ? (
              <ActivityList events={data} link={false} />
            ) : (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">Quiet for now. The first request will appear here the moment it is mined.</p>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden px-5 pb-24">
      <Reveal>
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] bg-primary px-8 py-20 text-primary-foreground md:px-16">
          <div className="spin-slow absolute -right-32 -top-32 h-[480px] w-[480px] rounded-full border-[40px] border-primary-foreground/5" />
          <h2 className="relative max-w-2xl font-display text-5xl font-semibold leading-[1] md:text-6xl">Pick a name. Get test tokens. Watch a rate fall.</h2>
          <p className="relative mt-5 max-w-lg text-primary-foreground/70">It takes about a minute. No sign-up, just a guest name and any browser wallet on Monad Testnet.</p>
          <Link href="/start" className="relative mt-9 inline-flex h-12 items-center gap-2 rounded-full bg-primary-foreground px-7 font-medium text-primary transition-transform hover:scale-[1.02]">
            Start <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Reveal>
      <footer className="mx-auto mt-12 flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
        <Logo size={20} />
        <span>Testnet software. Tokens have no value.</span>
      </footer>
    </section>
  );
}

export default function Landing() {
  return (
    <main className="min-h-[100dvh] overflow-x-hidden">
      <Nav />
      <Hero />
      <StatsStrip />
      <Ticker />
      <HowItWorks />
      <CurveSection />
      <Positions />
      <MonadSection />
      <LiveFeed />
      <FinalCta />
    </main>
  );
}
