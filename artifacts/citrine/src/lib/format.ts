const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });

export function formatUsd(value: number | null | undefined, compact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return compact && Math.abs(value) >= 10_000 ? compactUsd.format(value) : usdFormatter.format(value);
}

/** Token amount with sensible precision for its size. */
export function formatAmount(value: number | null | undefined, maxDigits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = maxDigits ?? (abs >= 1000 ? 2 : abs >= 1 ? 4 : 6);
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Basis points as a percentage, e.g. 825 -> "8.25%". */
export function formatRate(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d >= 1) return h ? `${d}d ${h}h` : `${d} day${d === 1 ? "" : "s"}`;
  if (h >= 1) return m ? `${h}h ${m}m` : `${h} hour${h === 1 ? "" : "s"}`;
  if (m >= 1) return `${m} min`;
  return `${Math.max(0, Math.floor(seconds))}s`;
}

/** Countdown such as "2d 4h", "13m 05s" or "Ended". */
export function formatCountdown(targetMs: number, nowMs: number): string {
  const s = Math.floor((targetMs - nowMs) / 1000);
  if (s <= 0) return "Ended";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

export function formatRelative(iso: string, nowMs: number = Date.now()): string {
  const s = Math.round((nowMs - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3_600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function shortAddress(address: string | null | undefined): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Display name for an address: the guest username when linked, otherwise the short address. */
export function displayName(address: string | null | undefined, name?: string | null): string {
  return name ? `@${name}` : shortAddress(address);
}
