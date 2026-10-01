"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { LoanRequest } from "@workspace/api-client-react";
import { PROTOCOL, quoteInterest } from "@workspace/contracts";
import { formatUnits } from "viem";
import { useCitrineActions } from "@/lib/web3/actions";
import { useWalletState } from "@/lib/web3/reads";
import { sameAddr, toRaw } from "@/lib/market";
import { formatAmount, formatDuration, formatRate } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { Btn, KV } from "./primitives";
import { TxStatus } from "./tx-status";
import { WalletGate } from "./wallet";

export function BidForm({ request, onDone }: { request: LoanRequest; onDone?: () => void }) {
  const { address } = useAccount();
  const w = useWalletState();
  const { bid, progress, busy } = useCitrineActions();
  const now = useNow();
  const ceiling = request.nextBidCeilingBps;
  const [rate, setRate] = useState(ceiling > 0 ? (ceiling / 100).toFixed(2) : "");

  useEffect(() => {
    setRate((r) => {
      const bps = Math.round(Number(r) * 100);
      return !r || bps > ceiling ? (ceiling > 0 ? (ceiling / 100).toFixed(2) : "") : r;
    });
  }, [ceiling]);

  const ended = new Date(request.auctionEnd).getTime() <= now;
  const own = sameAddr(address, request.borrower);
  const bps = Math.round(Number(rate) * 100);
  const valid = bps > 0 && bps <= ceiling;
  const usdc = w.balances.tUSDC?.value ?? 0;
  // The leader's funds are already escrowed; lowering their own bid moves no tokens.
  const leading = sameAddr(address, request.bestBidder);
  const enough = leading || usdc >= request.principal;
  const interest = valid ? Number(formatUnits(quoteInterest(toRaw(request.principal, 6), bps, request.duration), 6)) : 0;

  let blocker: string | null = null;
  if (request.status !== "open") blocker = "This request is no longer open.";
  else if (ended) blocker = "The auction has ended.";
  else if (ceiling === 0) blocker = "The rate has reached the floor. No further bids are possible.";
  else if (own) blocker = "This is your request. You can accept the best bid instead.";

  const step = (dir: number) => {
    const next = Math.min(ceiling, Math.max(PROTOCOL.MIN_BID_STEP_BPS, (bps || ceiling) + dir * PROTOCOL.MIN_BID_STEP_BPS));
    setRate((next / 100).toFixed(2));
  };

  return (
    <WalletGate title="Connect to bid" body="Bids escrow tUSDC in the exchange. If you are outbid, it returns to your claimable balance.">
      {blocker ? (
        <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">{blocker}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Your rate (APR)</span>
              <button className="hover:text-primary" onClick={() => setRate((ceiling / 100).toFixed(2))}>
                Ceiling <span className="num">{formatRate(ceiling)}</span>
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-muted/60 p-2 ring-1 ring-inset ring-border focus-within:ring-primary/60">
              <button onClick={() => step(-1)} className="grid h-10 w-10 place-items-center rounded-xl bg-background/60 text-lg hover:bg-accent">−</button>
              <input
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="num w-full bg-transparent text-center text-3xl outline-none"
                data-testid="input-bid-rate"
              />
              <span className="text-2xl text-muted-foreground">%</span>
              <button onClick={() => step(1)} className="grid h-10 w-10 place-items-center rounded-xl bg-background/60 text-lg hover:bg-accent">+</button>
            </div>
            {!valid && rate && <p className="mt-2 text-xs text-destructive">Enter a rate above 0% and at most {formatRate(ceiling)}.</p>}
          </div>
          <div className="divide-y divide-border rounded-xl bg-muted/30 px-4">
            <KV k="You lend" v={<span className="num">{formatAmount(request.principal)} tUSDC</span>} />
            <KV k={`Interest over ${formatDuration(request.duration)}`} v={<span className="num text-positive">+{formatAmount(interest, 4)} tUSDC</span>} />
            <KV k="Your tUSDC" v={<span className={`num ${enough ? "" : "text-destructive"}`}>{formatAmount(usdc)}</span>} />
          </div>
          <Btn
            size="lg"
            className="w-full"
            disabled={!valid || busy || !enough}
            onClick={() => void bid(request.id, bps, toRaw(request.principal, 6)).then((h) => h && onDone?.())}
            data-testid="button-place-bid"
          >
            {!enough ? "Not enough tUSDC: use the faucet" : leading ? `Lower your bid${valid ? ` to ${formatRate(bps)}` : ""}` : `Bid ${valid ? formatRate(bps) : ""}`}
          </Btn>
          <p className="text-xs text-muted-foreground">
            Bids in the last {PROTOCOL.EXTENSION_WINDOW}s extend the auction. Rates step by at least {formatRate(PROTOCOL.MIN_BID_STEP_BPS)}.
          </p>
          <TxStatus progress={progress} />
        </div>
      )}
    </WalletGate>
  );
}
