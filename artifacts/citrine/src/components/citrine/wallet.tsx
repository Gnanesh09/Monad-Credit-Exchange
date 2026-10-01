"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowUpRight, Check, Copy, Droplets, LogOut, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { monadTestnet } from "@/lib/web3/config";
import { explorerAddress, faucetTokens } from "@/lib/web3/contracts";
import { useWalletState } from "@/lib/web3/reads";
import { useCitrineActions } from "@/lib/web3/actions";
import { formatAmount, formatCountdown, shortAddress } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { Btn } from "./primitives";
import { TxStatus } from "./tx-status";

export function useWrongNetwork() {
  const { isConnected, chainId } = useAccount();
  return isConnected && chainId !== monadTestnet.id;
}

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { connectors, connect, isPending, variables, error } = useConnect();
  const list = connectors.filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl border-border bg-popover">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Connect a wallet</DialogTitle>
          <DialogDescription>Citrine runs on Monad Testnet. Any injected wallet works.</DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-2">
          {list.length === 0 && (
            <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              No browser wallet found. Install MetaMask, Rabby, Phantom or Backpack and reload.
            </p>
          )}
          {list.map((c) => {
            const pending = isPending && variables?.connector && "uid" in variables.connector && variables.connector.uid === c.uid;
            return (
              <button
                key={c.uid}
                onClick={() => connect({ connector: c, chainId: monadTestnet.id }, { onSuccess: () => onOpenChange(false) })}
                className="flex w-full items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 text-left ring-1 ring-inset ring-border transition-colors hover:bg-accent"
              >
                {c.icon ? <img src={c.icon} alt="" className="h-7 w-7 rounded-lg" /> : <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary"><Wallet className="h-4 w-4" /></span>}
                <span className="flex-1 text-sm font-medium">{c.name === "Injected" ? "Browser wallet" : c.name}</span>
                {pending && <span className="text-xs text-muted-foreground">Check wallet</span>}
              </button>
            );
          })}
          {error && <p className="text-xs text-destructive">{error.message.split("\n")[0]}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectButton({ className, label = "Connect wallet" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn className={className} onClick={() => setOpen(true)}>
        <Wallet className="h-4 w-4" /> {label}
      </Btn>
      <ConnectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function SwitchNetworkButton({ className }: { className?: string }) {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <Btn variant="danger" className={className} disabled={isPending} onClick={() => switchChain({ chainId: monadTestnet.id })}>
      <AlertTriangle className="h-4 w-4" /> {isPending ? "Switching" : "Switch to Monad"}
    </Btn>
  );
}

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const wrong = useWrongNetwork();
  const { disconnect } = useDisconnect();
  const w = useWalletState();
  const [copied, setCopied] = useState(false);

  if (!isConnected || !address) return <ConnectButton />;
  if (wrong) return <SwitchNetworkButton />;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex h-10 items-center gap-2.5 rounded-full bg-secondary pl-1.5 pr-4 ring-1 ring-inset ring-border transition-colors hover:bg-accent">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-primary to-chart-3 text-[11px] font-semibold text-primary-foreground">
            {address.slice(2, 4)}
          </span>
          <span className="num text-[13px]">{shortAddress(address)}</span>
          <span className="hidden text-xs text-muted-foreground lg:inline num">{formatAmount(w.balances.MON?.value ?? 0, 3)} MON</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl border-border bg-popover p-0">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="live-dot" /> Monad Testnet
            </span>
            <a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary">
              Explorer <ArrowUpRight className="inline h-3 w-3" />
            </a>
          </div>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="mt-2 flex items-center gap-2 num text-lg hover:text-primary"
          >
            {shortAddress(address)} {copied ? <Check className="h-4 w-4 text-positive" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>
        <div className="border-t border-border px-4 py-3">
          {["MON", ...faucetTokens.map((t) => t.symbol)].map((s) => (
            <div key={s} className="flex justify-between py-1 text-sm">
              <span className="text-muted-foreground">{s}</span>
              <span className="num">{w.loading ? "…" : formatAmount(w.balances[s]?.value ?? 0)}</span>
            </div>
          ))}
          {w.claimable.length > 0 && (
            <Link href="/app/portfolio" className="mt-2 block rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
              You have funds to withdraw from the exchange
            </Link>
          )}
        </div>
        <div className="flex gap-2 border-t border-border p-3">
          <Link href="/app/portfolio#faucet" className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-secondary text-[13px] ring-1 ring-inset ring-border hover:bg-accent">
            <Droplets className="h-3.5 w-3.5" /> Faucet
          </Link>
          <Btn size="sm" variant="ghost" className="h-9 flex-1" onClick={() => disconnect()}>
            <LogOut className="h-3.5 w-3.5" /> Disconnect
          </Btn>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Banner shown across the app when the wallet is on another chain. */
export function WrongNetworkBanner() {
  const wrong = useWrongNetwork();
  return (
    <AnimatePresence>
      {wrong && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-5 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-warning">
              <AlertTriangle className="h-4 w-4" /> Your wallet is on another network. Citrine settles on Monad Testnet.
            </span>
            <SwitchNetworkButton className="h-8 text-[13px]" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Faucet({ compact = false }: { compact?: boolean }) {
  const w = useWalletState();
  const { faucet, progress, busy } = useCitrineActions();
  const now = useNow();
  if (!w.connected) {
    return (
      <div className="flex flex-col items-start gap-3 p-5">
        <p className="text-sm text-muted-foreground">Connect a wallet to claim test tUSDC, tWETH and tWBTC. You need a little MON for gas.</p>
        <ConnectButton />
      </div>
    );
  }
  return (
    <div className={cn("space-y-2", compact ? "p-3" : "p-5 pt-0")}>
      {faucetTokens.map((t) => {
        const next = w.nextDripAt[t.symbol] ?? 0;
        const cooling = next > now;
        return (
          <div key={t.symbol} className="flex items-center gap-3 rounded-xl bg-muted/50 px-3.5 py-3 ring-1 ring-inset ring-border">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">{t.symbol.replace("t", "").slice(0, 3)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.symbol}</p>
              <p className="text-xs text-muted-foreground num">
                Balance {formatAmount(w.balances[t.symbol]?.value ?? 0)} · drip {t.drip}
              </p>
            </div>
            <Btn size="sm" variant={cooling ? "secondary" : "primary"} disabled={busy || cooling} onClick={() => void faucet(t.address, t.symbol)}>
              {cooling ? <span className="num">{formatCountdown(next, now)}</span> : "Claim"}
            </Btn>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-muted-foreground">
        Need MON for gas? Use the official Monad testnet faucet at{" "}
        <a className="text-primary hover:underline" href="https://faucet.monad.xyz" target="_blank" rel="noopener noreferrer">
          faucet.monad.xyz
        </a>
        .
      </p>
      <TxStatus progress={progress} />
    </div>
  );
}

/** Gate content behind a connected wallet on Monad. */
export function WalletGate({ children, title, body }: { children: React.ReactNode; title: string; body: string }) {
  const { isConnected } = useAccount();
  const wrong = useWrongNetwork();
  if (isConnected && !wrong) return <>{children}</>;
  return (
    <div className="panel relative overflow-hidden px-6 py-14 text-center">
      <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/25">
        {wrong ? <AlertTriangle className="h-6 w-6" /> : <Wallet className="h-6 w-6" />}
      </div>
      <h2 className="relative mt-5 font-display text-2xl font-semibold">{wrong ? "Switch to Monad Testnet" : title}</h2>
      <p className="relative mx-auto mt-2 max-w-md text-sm text-muted-foreground">{wrong ? "Your wallet is connected to a different chain. One click moves it to Monad." : body}</p>
      <div className="relative mt-6 flex justify-center">{wrong ? <SwitchNetworkButton /> : <ConnectButton />}</div>
    </div>
  );
}
