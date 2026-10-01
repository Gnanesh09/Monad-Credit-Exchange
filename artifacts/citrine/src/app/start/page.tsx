"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";
import { useCheckUsername, getCheckUsernameQueryKey, useGetMarketStats, getGetMarketStatsQueryKey } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { apiErrorMessage } from "@/lib/api-error";
import { Logo, AnimatedNumber } from "@/components/citrine/primitives";
import { formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";

const VALID = /^[a-zA-Z0-9_]{3,20}$/;

export default function StartPage() {
  const router = useRouter();
  const { ready, user, enter, signOut } = useSession();
  const [name, setName] = useState("");
  const [debounced, setDebounced] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stats = useGetMarketStats({ query: { queryKey: getGetMarketStatsQueryKey(), refetchInterval: 5_000 } });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(name.trim()), 300);
    return () => clearTimeout(t);
  }, [name]);

  const formatOk = VALID.test(debounced);
  const check = useCheckUsername({ username: debounced }, { query: { queryKey: getCheckUsernameQueryKey({ username: debounced }), enabled: formatOk } });
  const typing = name.trim() !== debounced;
  const available = formatOk && !typing && check.data?.available === true;

  let hint: { tone: "ok" | "bad" | "idle"; text: string } = { tone: "idle", text: "3 to 20 letters, numbers or underscores." };
  if (name && !typing) {
    if (!formatOk) hint = { tone: "bad", text: "Use 3 to 20 letters, numbers or underscores." };
    else if (check.isFetching && !check.data) hint = { tone: "idle", text: "Checking" };
    else if (check.data?.available) hint = { tone: "ok", text: `@${check.data.username} is yours to take.` };
    else if (check.data) hint = { tone: "bad", text: check.data.reason ?? "That name is taken." };
  }

  const submit = async () => {
    if (!available) return;
    setSubmitting(true);
    setError(null);
    try {
      await enter(debounced);
      router.push("/app");
    } catch (e) {
      setError(apiErrorMessage(e, "Could not create your guest session."));
      setSubmitting(false);
    }
  };

  return (
    <main className="relative grid min-h-[100dvh] overflow-hidden lg:grid-cols-[1fr_1.1fr]">
      <div className="grid-fade pointer-events-none absolute inset-0 opacity-50" />
      <section className="relative flex flex-col px-6 py-8 md:px-14">
        <div className="flex items-center justify-between">
          <Link href="/"><Logo /></Link>
          <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        </div>
        <div className="my-auto w-full max-w-md py-16">
          {!ready ? (
            <div className="space-y-4"><div className="skel h-10 w-3/4" /><div className="skel h-14" /></div>
          ) : user ? (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <p className="text-sm text-primary">Welcome back</p>
              <h1 className="mt-2 font-display text-5xl font-semibold">@{user.username}</h1>
              <p className="mt-3 text-muted-foreground">Your guest session is still active on this device.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button onClick={() => router.push("/app")} className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 font-medium text-primary-foreground" data-testid="button-continue">
                  Continue to Citrine <ArrowRight className="h-4 w-4" />
                </button>
                <button onClick={() => void signOut()} className="h-12 rounded-full px-5 text-sm text-muted-foreground ring-1 ring-inset ring-border hover:text-foreground">
                  Use a different name
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <p className="text-sm text-primary">Guest access</p>
              <h1 className="mt-2 font-display text-5xl font-semibold leading-[1.02]">What should the market call you?</h1>
              <p className="mt-4 text-muted-foreground">Your name shows next to your bids and loans. You can link a wallet to it later.</p>
              <form
                className="mt-9"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className={cn("flex items-center rounded-2xl bg-card px-5 ring-1 ring-inset transition-shadow", hint.tone === "ok" ? "ring-positive/50" : hint.tone === "bad" ? "ring-destructive/50" : "ring-border focus-within:ring-primary/60")}>
                  <span className="font-display text-2xl text-muted-foreground">@</span>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value.replace(/\s/g, ""))}
                    maxLength={20}
                    placeholder="satoshi_lends"
                    className="h-16 w-full bg-transparent pl-1 font-display text-2xl outline-none placeholder:text-muted-foreground/40"
                    data-testid="input-username"
                  />
                  <span className="w-6">
                    {name && (typing || check.isFetching) ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : hint.tone === "ok" ? <Check className="h-5 w-5 text-positive" /> : hint.tone === "bad" ? <X className="h-5 w-5 text-destructive" /> : null}
                  </span>
                </div>
                <AnimatePresence mode="wait">
                  <motion.p key={hint.text} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn("mt-3 text-sm", hint.tone === "ok" ? "text-positive" : hint.tone === "bad" ? "text-destructive" : "text-muted-foreground")}>
                    {hint.text}
                  </motion.p>
                </AnimatePresence>
                {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
                <button type="submit" disabled={!available || submitting} className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-medium text-primary-foreground transition-opacity disabled:opacity-35" data-testid="button-enter">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Enter as guest
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </button>
                <p className="mt-4 text-center text-xs text-muted-foreground">No email, no password. Your session lives on this device.</p>
              </form>
            </motion.div>
          )}
        </div>
      </section>
      <aside className="relative hidden overflow-hidden border-l border-border bg-card/40 lg:flex lg:flex-col lg:justify-end lg:p-14">
        <div className="absolute right-[-20%] top-[-10%] h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle,hsl(56_96%_58%/.3),transparent_65%)]" />
        <div className="spin-slow absolute right-[-5%] top-[5%] h-[460px] w-[460px] rounded-full border border-dashed border-primary/25" />
        <div className="relative">
          <p className="text-sm text-muted-foreground">Market clearing rate, last 7 days</p>
          <p className="mt-2 font-display text-[110px] font-semibold leading-none text-primary">
            {stats.data?.averageRateBps ? <AnimatedNumber value={stats.data.averageRateBps} format={formatRate} className="font-display" /> : "Open"}
          </p>
          <div className="mt-10 grid grid-cols-3 gap-6 border-t border-border pt-6 text-sm">
            <div><p className="text-muted-foreground">Open auctions</p><p className="num mt-1 text-2xl">{stats.data?.openRequests ?? "—"}</p></div>
            <div><p className="text-muted-foreground">Active loans</p><p className="num mt-1 text-2xl">{stats.data?.activeLoans ?? "—"}</p></div>
            <div><p className="text-muted-foreground">Lenders</p><p className="num mt-1 text-2xl">{stats.data?.uniqueLenders ?? "—"}</p></div>
          </div>
        </div>
      </aside>
    </main>
  );
}
