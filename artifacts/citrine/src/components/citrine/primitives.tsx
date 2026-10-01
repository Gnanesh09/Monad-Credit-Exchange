"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { animate, motion, useMotionValue } from "framer-motion";
import { AlertTriangle, ArrowUpRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { explorerTx } from "@/lib/web3/contracts";
import { formatCountdown } from "@/lib/format";
import { useNow } from "@/hooks/use-now";

export function Logo({ className, size = 26 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <path d="M16 2 28 9v14l-12 7L4 23V9z" fill="hsl(var(--primary))" />
        <path d="M16 2v28M4 9l24 14M28 9 4 23" stroke="hsl(var(--primary-foreground))" strokeOpacity=".28" strokeWidth="1.2" />
        <path d="M16 9.5 22 13v6l-6 3.5-6-3.5v-6z" fill="hsl(var(--primary-foreground))" fillOpacity=".85" />
      </svg>
      <span className="font-display text-[19px] font-semibold">Citrine</span>
    </span>
  );
}

export function AnimatedNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setDisplay(v) });
    return () => controls.stop();
  }, [mv, value]);
  return <span className={cn("num", className)}>{format(display)}</span>;
}

/** A value that flashes when it changes. */
export function Flash({ value, children, className }: { value: string | number; children: React.ReactNode; className?: string }) {
  return (
    <motion.span
      key={String(value)}
      initial={{ opacity: 0.35, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className={cn("inline-block", className)}
    >
      {children}
    </motion.span>
  );
}

export function Countdown({ to, className, endedLabel = "Ended" }: { to: string; className?: string; endedLabel?: string }) {
  const now = useNow();
  const ms = new Date(to).getTime() - now;
  const text = formatCountdown(new Date(to).getTime(), now);
  return (
    <span className={cn("num", ms < 60_000 && ms > 0 && "text-warning", ms <= 0 && "text-muted-foreground", className)}>
      {ms <= 0 ? endedLabel : text}
    </span>
  );
}

export function LiveDot({ className, tone = "positive" }: { className?: string; tone?: "positive" | "warning" | "primary" }) {
  const bg = tone === "warning" ? "hsl(var(--warning))" : tone === "primary" ? "hsl(var(--primary))" : undefined;
  return <span className={cn("live-dot", className)} style={bg ? { background: bg } : undefined} />;
}

const TONES: Record<string, string> = {
  open: "bg-primary/12 text-primary ring-primary/25",
  active: "bg-positive/12 text-positive ring-positive/25",
  funded: "bg-positive/12 text-positive ring-positive/25",
  repaid: "bg-chart-4/12 text-chart-4 ring-chart-4/25",
  listed: "bg-primary/12 text-primary ring-primary/25",
  cancelled: "bg-muted text-muted-foreground ring-border",
  expired: "bg-muted text-muted-foreground ring-border",
  defaulted: "bg-warning/12 text-warning ring-warning/25",
  liquidated: "bg-destructive/12 text-destructive ring-destructive/25",
  overdue: "bg-warning/12 text-warning ring-warning/25",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[status] ?? TONES.cancelled, className)}>
      {(status === "open" || status === "active") && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel", className)} {...rest}>
      {children}
    </div>
  );
}

export function PanelHeader({ title, hint, right, live }: { title: string; hint?: string; right?: React.ReactNode; live?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[15px] font-medium">
          {title}
          {live && <LiveDot />}
        </h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

export function Skel({ className }: { className?: string }) {
  // A span keeps placeholders valid inside text elements such as <p>.
  return <span aria-hidden className={cn("skel block h-4", className)} />;
}

export function SkelRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3 px-5 pb-5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skel key={i} className="h-10" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="relative mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
        <div className="absolute inset-0 rounded-2xl ring-1 ring-primary/10 [animation:pulse-ring_2.6s_ease-out_infinite]" />
        {icon}
      </div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <AlertTriangle className="mb-3 h-6 w-6 text-warning" />
      <p className="font-medium">Could not load this</p>
      <p className="mt-1 text-sm text-muted-foreground">{message ?? "The market API did not respond. It usually recovers in a few seconds."}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm hover:bg-accent">
          <RotateCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

export function TxLink({ hash, className }: { hash: string; className?: string }) {
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 text-muted-foreground hover:text-primary", className)}>
      <span className="num">{hash.slice(0, 8)}</span>
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

export function Btn({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[transform,background-color,opacity] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-5 text-sm",
        size === "lg" && "h-12 px-7 text-[15px]",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "secondary" && "bg-secondary text-foreground ring-1 ring-inset ring-border hover:bg-accent",
        variant === "ghost" && "text-muted-foreground hover:bg-accent hover:text-foreground",
        variant === "danger" && "bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/30 hover:bg-destructive/20",
        className,
      )}
      {...rest}
    />
  );
}

export function LinkBtn({ href, children, variant = "primary", className }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors",
        variant === "primary" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-secondary ring-1 ring-inset ring-border hover:bg-accent",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: {
  options: { label: string; value: NoInfer<T> }[];
  value: T;
  onChange: (v: NoInfer<T>) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("inline-flex flex-wrap gap-1 rounded-full bg-muted p-1", className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn("relative rounded-full px-3 py-1 text-[13px] transition-colors", value === o.value ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function KV({ k, v, className }: { k: React.ReactNode; v: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2 text-sm", className)}>
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold md:text-[34px]">{title}</h1>
        {sub && <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </motion.div>
  );
}

export const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } }),
};
