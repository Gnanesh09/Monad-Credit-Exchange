"use client";

import { useEffect, useState } from "react";

// False on the server and during the first client render, so both render the same markup.
let hydrated = false;

/** Current time in milliseconds, updated every `intervalMs`. Drives countdowns and accruing interest. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => (hydrated ? Date.now() : 0));
  useEffect(() => {
    hydrated = true;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
