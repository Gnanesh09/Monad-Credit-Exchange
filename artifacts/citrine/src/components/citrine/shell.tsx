"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight, Briefcase, Gauge, HandCoins, Landmark, LogOut, Menu, X } from "lucide-react";
import {
  useGetProtocol,
  getGetProtocolQueryKey,
  useHealthCheck,
  getHealthCheckQueryKey,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { usePriceMap } from "@/lib/market";
import { collaterals } from "@/lib/web3/contracts";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Logo, Skel } from "./primitives";
import { WalletButton, WrongNetworkBanner } from "./wallet";

const NAV = [
  { href: "/app", label: "Market", icon: Gauge },
  { href: "/app/borrow", label: "Borrow", icon: Landmark },
  { href: "/app/lend", label: "Lend", icon: HandCoins },
  { href: "/app/trade", label: "Trade", icon: ArrowLeftRight },
  { href: "/app/portfolio", label: "Portfolio", icon: Briefcase },
];

function isActive(path: string, href: string) {
  if (href === "/app") return path === "/app" || path.startsWith("/app/requests") || path.startsWith("/app/loans");
  return path.startsWith(href);
}

function PriceTicker() {
  const { map } = usePriceMap();
  return (
    <div className="hidden items-center gap-4 xl:flex">
      {collaterals.map((c) => {
        const p = map[c.symbol];
        return (
          <span key={c.symbol} className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{c.symbol}</span>
            <motion.span key={p?.price} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className={cn("num", p?.stale && "text-warning")}>
              {p ? formatUsd(p.price) : "—"}
            </motion.span>
          </span>
        );
      })}
    </div>
  );
}

function StatusLine() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 15_000 } });
  const protocol = useGetProtocol({ query: { queryKey: getGetProtocolQueryKey(), refetchInterval: 8_000 } });
  const ok = !!health.data && !health.isError;
  const lag = protocol.data?.indexer.lagBlocks;
  return (
    <div className="space-y-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="live-dot" style={ok ? undefined : { background: "hsl(var(--destructive))" }} />
        {health.isLoading ? "Checking API" : ok ? "API online" : "API unreachable"}
      </div>
      {protocol.data && (
        <div className="num">
          Block {protocol.data.indexer.headBlock.toLocaleString()}
          {/* A few blocks of lag is one poll in progress (Monad makes ~2.5 blocks a second); only a stall shows. */}
          {lag !== undefined && lag > 20 ? ` · ${lag} behind` : " · in sync"}
        </div>
      )}
      {protocol.data && !protocol.data.livePrices && <div className="text-warning">Live Pyth prices unavailable</div>}
    </div>
  );
}

function Identity() {
  const { user, signOut } = useSession();
  const router = useRouter();
  if (!user) return <Skel className="h-10" />;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-2.5 ring-1 ring-inset ring-border">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{user.username.slice(0, 1).toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">@{user.username}</p>
        <p className="text-xs text-muted-foreground">{user.wallet ? "Wallet linked" : "Guest"}</p>
      </div>
      <button
        title="Sign out"
        onClick={() => void signOut().then(() => router.replace("/start"))}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname() ?? "";
  return (
    <nav className="space-y-0.5">
      {NAV.map((n) => {
        const active = isActive(path, n.href);
        return (
          <Link key={n.href} href={n.href} onClick={onNavigate} className={cn("relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-accent ring-1 ring-inset ring-border" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <n.icon className={cn("relative h-4 w-4", active && "text-primary")} />
            <span className="relative">{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, user } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace("/start");
  }, [ready, user, router]);

  useEffect(() => setMobile(false), [path]);

  if (!ready || !user) {
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.6 }}>
          <Logo size={34} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh]">
      <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link href="/" className="mb-8 px-2 pt-1">
          <Logo />
        </Link>
        <NavLinks />
        <div className="mt-auto space-y-4">
          <StatusLine />
          <Identity />
        </div>
      </aside>

      <AnimatePresence>
        {mobile && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobile(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: "spring", stiffness: 400, damping: 40 }} className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-sidebar p-4 md:hidden">
              <div className="mb-8 flex items-center justify-between px-2">
                <Logo />
                <button onClick={() => setMobile(false)} className="text-muted-foreground"><X className="h-5 w-5" /></button>
              </div>
              <NavLinks onNavigate={() => setMobile(false)} />
              <div className="mt-auto space-y-4"><StatusLine /><Identity /></div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-xl md:px-8">
          <button className="md:hidden" onClick={() => setMobile(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <PriceTicker />
          <div className="ml-auto flex items-center gap-2">
            <WalletButton />
          </div>
        </header>
        <WrongNetworkBanner />
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-8 md:px-8">
          <motion.div key={path} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
