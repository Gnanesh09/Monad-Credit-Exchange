"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownRight, Ban, Gavel, HandCoins, Hourglass, Repeat, ShieldAlert, Sparkles, Tag, TagsIcon, TimerOff, Undo2 } from "lucide-react";
import type { ActivityEvent } from "@workspace/api-client-react";
import { displayName, formatAmount, formatRate, formatRelative } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { TxLink } from "./primitives";

const META: Record<string, { icon: typeof Gavel; tone: string; verb: string }> = {
  request_created: { icon: Sparkles, tone: "text-primary", verb: "asked to borrow" },
  bid_placed: { icon: Gavel, tone: "text-primary", verb: "bid" },
  request_cancelled: { icon: Ban, tone: "text-muted-foreground", verb: "cancelled request" },
  request_expired: { icon: TimerOff, tone: "text-muted-foreground", verb: "request expired" },
  loan_started: { icon: HandCoins, tone: "text-positive", verb: "loan funded" },
  loan_repaid: { icon: Undo2, tone: "text-chart-4", verb: "repaid" },
  loan_defaulted: { icon: Hourglass, tone: "text-warning", verb: "defaulted" },
  loan_liquidated: { icon: ShieldAlert, tone: "text-destructive", verb: "liquidated" },
  listed: { icon: Tag, tone: "text-primary", verb: "listed position" },
  listing_cancelled: { icon: TagsIcon, tone: "text-muted-foreground", verb: "delisted position" },
  position_sold: { icon: Repeat, tone: "text-positive", verb: "sold position" },
  position_transferred: { icon: ArrowDownRight, tone: "text-muted-foreground", verb: "transferred position" },
};

export function describe(e: ActivityEvent): string {
  const who = displayName(e.actor, e.actorName);
  const amt = e.amount !== null ? `${formatAmount(e.amount)} ${e.symbol ?? ""}`.trim() : "";
  const rate = e.rateBps !== null ? formatRate(e.rateBps) : "";
  switch (e.kind) {
    case "request_created":
      return `${who} asked for ${amt}${rate ? ` at up to ${rate}` : ""}`;
    case "bid_placed":
      return `${who} bid ${rate} on #${e.loanId}`;
    case "loan_started":
      return `#${e.loanId} funded${amt ? `: ${amt}` : ""}${rate ? ` at ${rate}` : ""}`;
    case "loan_repaid":
      return `${who} repaid ${amt || `#${e.loanId}`}`;
    case "listed":
      return `${who} listed #${e.loanId}${amt ? ` for ${amt}` : ""}`;
    case "position_sold":
      return `#${e.loanId} sold${amt ? ` for ${amt}` : ""}${e.counterparty ? ` to ${displayName(e.counterparty, e.counterpartyName)}` : ""}`;
    case "loan_defaulted":
      // The actor only triggered the claim; the collateral goes to the position holder.
      return `#${e.loanId} defaulted${amt && e.counterparty ? `, ${amt} went to ${displayName(e.counterparty, e.counterpartyName)}` : ""}`;
    case "loan_liquidated":
      return `${who} liquidated #${e.loanId}${amt ? `, seizing ${amt}` : ""}`;
    default:
      return `${who} ${META[e.kind]?.verb ?? e.kind} #${e.loanId}`;
  }
}

export function eventHref(e: ActivityEvent): string {
  const reqKinds = ["request_created", "bid_placed", "request_cancelled", "request_expired"];
  return reqKinds.includes(e.kind) ? `/app/requests/${e.loanId}` : `/app/loans/${e.loanId}`;
}

export function ActivityRow({ e, link = true }: { e: ActivityEvent; link?: boolean }) {
  const now = useNow(5000);
  const meta = META[e.kind] ?? META.position_transferred!;
  const Icon = meta.icon;
  const content = (
    <>
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted", meta.tone)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{describe(e)}</span>
        <span className="block text-xs text-muted-foreground">{formatRelative(e.timestamp, now)}</span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent/60">
      {link ? (
        <Link href={eventHref(e)} className="flex min-w-0 flex-1 items-center gap-3">
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>
      )}
      <TxLink hash={e.txHash} className="hidden text-xs sm:inline-flex" />
    </div>
  );
}

export function ActivityList({ events, link = true }: { events: ActivityEvent[]; link?: boolean }) {
  return (
    <div className="px-3 pb-3">
      <AnimatePresence initial={false}>
        {events.map((e) => (
          <motion.div key={e.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
            <ActivityRow e={e} link={link} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
