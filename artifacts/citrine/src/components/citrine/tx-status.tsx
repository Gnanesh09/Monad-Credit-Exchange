"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Wallet } from "lucide-react";
import type { TxProgress } from "@/lib/web3/actions";
import { cn } from "@/lib/utils";
import { TxLink } from "./primitives";

/** Inline step indicator for a running wallet transaction. */
export function TxStatus({ progress, className }: { progress: TxProgress | null; className?: string }) {
  return (
    <AnimatePresence>
      {progress && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className={cn("overflow-hidden", className)}
        >
          <div className="rounded-xl bg-primary/8 p-3 ring-1 ring-inset ring-primary/20">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{progress.label}</span>
              <span className="num">
                Step {progress.step} of {progress.total}
              </span>
            </div>
            <div className="mt-2 flex gap-1">
              {Array.from({ length: progress.total }).map((_, i) => (
                <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: i + 1 < progress.step ? "100%" : i + 1 === progress.step ? (progress.phase === "wallet" ? "35%" : "75%") : "0%" }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2 text-sm">
              {progress.phase === "wallet" ? <Wallet className="h-4 w-4 text-primary" /> : <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <span className="flex-1">{progress.title}</span>
              <span className="text-xs text-muted-foreground">{progress.phase === "wallet" ? "Confirm in wallet" : "Confirming on Monad"}</span>
            </div>
            {progress.hash && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                <Check className="h-3 w-3 text-positive" /> Sent <TxLink hash={progress.hash} />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
