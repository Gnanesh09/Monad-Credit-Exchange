"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CurvePoint, LoanRequest, RatePoint } from "@workspace/api-client-react";
import { displayName, formatAmount, formatDuration, formatRate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Countdown } from "./primitives";

const axis = { stroke: "hsl(46 8% 40%)", fontSize: 11, tickLine: false, axisLine: false } as const;

function ChartTip({ active, payload, label, fmt }: { active?: boolean; payload?: { value: number; payload: Record<string, unknown> }[]; label?: string; fmt: (p: Record<string, unknown>, v: number, l?: string) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">{fmt(payload[0]!.payload, payload[0]!.value, label)}</div>;
}

export function RateHistoryChart({ points, height = 240 }: { points: RatePoint[]; height?: number }) {
  const data = [...points]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((p) => ({ ...p, t: new Date(p.timestamp).getTime(), rate: p.rateBps / 100 }));
  // Match the tick precision to the span so neighbouring labels never repeat.
  const span = data.length > 1 ? data[data.length - 1]!.t - data[0]!.t : 0;
  const tick = (t: number) =>
    span < 15 * 60_000
      ? new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
      : span < 2 * 86_400_000
        ? new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(56 96% 58%)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(56 96% 58%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(48 8% 12%)" vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tick} minTickGap={48} {...axis} />
        <YAxis tickFormatter={(v: number) => `${v}%`} width={48} {...axis} />
        <Tooltip
          cursor={{ stroke: "hsl(56 96% 58% / .4)" }}
          content={
            <ChartTip
              fmt={(p) => (
                <>
                  <div className="num text-sm text-primary">{formatRate(p.rateBps as number)}</div>
                  <div className="text-muted-foreground">
                    #{String(p.loanId)} · {formatAmount(p.principal as number)} tUSDC · {formatDuration(p.duration as number)} · {String(p.collateralSymbol)}
                  </div>
                </>
              )}
            />
          }
        />
        <Area type="monotone" dataKey="rate" stroke="hsl(56 96% 58%)" strokeWidth={2} fill="url(#rateFill)" dot={{ r: 2.5, fill: "hsl(56 96% 58%)", strokeWidth: 0 }} animationDuration={900} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RateCurveChart({ points, height = 220 }: { points: CurvePoint[]; height?: number }) {
  const data = points.map((p) => ({ ...p, avg: p.averageRateBps !== null ? p.averageRateBps / 100 : 0 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="hsl(48 8% 12%)" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis tickFormatter={(v: number) => `${v}%`} width={48} {...axis} />
        <Tooltip
          cursor={{ fill: "hsl(48 8% 12% / .6)" }}
          content={
            <ChartTip
              fmt={(p) => (
                <>
                  <div className="font-medium">{String(p.label)}</div>
                  <div className="num text-primary">avg {formatRate(p.averageRateBps as number | null)}</div>
                  <div className="num text-muted-foreground">
                    range {formatRate(p.minRateBps as number | null)} to {formatRate(p.maxRateBps as number | null)}
                  </div>
                  <div className="text-muted-foreground">
                    {String(p.loans)} loans · {formatUsd(p.volume as number, true)}
                  </div>
                </>
              )}
            />
          }
        />
        <Bar dataKey="avg" fill="hsl(56 96% 58%)" radius={[6, 6, 2, 2]} animationDuration={900} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Dense auction row used in lists. */
export function RequestRow({ r, i = 0, action }: { r: LoanRequest; i?: number; action?: React.ReactNode }) {
  const best = r.bestRateBps;
  const drop = best !== null ? Math.max(0, Math.min(1, 1 - best / r.maxRateBps)) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.03 }}
      className="group grid grid-cols-2 items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3.5 transition-colors first:border-t-0 hover:bg-accent/40 md:grid-cols-[64px_1.4fr_1fr_1.2fr_0.9fr_auto]"
    >
      <Link href={`/app/requests/${r.id}`} className="num text-sm text-muted-foreground group-hover:text-primary">
        #{r.id}
      </Link>
      <Link href={`/app/requests/${r.id}`} className="min-w-0">
        <p className="num text-[15px]">{formatAmount(r.principal)} <span className="text-muted-foreground text-xs">tUSDC</span></p>
        <p className="truncate text-xs text-muted-foreground">
          {formatAmount(r.collateralAmount)} {r.collateralSymbol} · {displayName(r.borrower, r.borrowerName)}
        </p>
      </Link>
      <div>
        <p className="text-sm">{formatDuration(r.duration)}</p>
        <p className="text-xs text-muted-foreground num">LTV {formatRate(r.ltvBps)}</p>
      </div>
      <div>
        <p className="num text-[15px]">
          {best !== null ? <span className="text-primary">{formatRate(best)}</span> : <span className="text-muted-foreground">No bids</span>}
          <span className="ml-1.5 text-xs text-muted-foreground">/ {formatRate(r.maxRateBps)}</span>
        </p>
        <div className="mt-1.5 h-1 w-full max-w-[140px] overflow-hidden rounded-full bg-muted">
          <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${Math.max(4, drop * 100)}%` }} transition={{ duration: 0.8 }} />
        </div>
      </div>
      <div className="text-sm">
        <Countdown to={r.auctionEnd} />
        <p className="text-xs text-muted-foreground">{r.bidCount} bid{r.bidCount === 1 ? "" : "s"}</p>
      </div>
      <div className={cn("col-span-2 flex justify-end md:col-span-1")}>{action}</div>
    </motion.div>
  );
}

export function RequestHeaderRow() {
  return (
    <div className="hidden grid-cols-[64px_1.4fr_1fr_1.2fr_0.9fr_auto] gap-4 border-b border-border px-5 pb-2 text-xs text-muted-foreground md:grid">
      <span>Id</span>
      <span>Amount</span>
      <span>Term</span>
      <span>Best / max rate</span>
      <span>Ends in</span>
      <span className="w-16" />
    </div>
  );
}
