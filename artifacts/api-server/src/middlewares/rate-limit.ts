import type { RequestHandler } from "express";
import { HttpError } from "../lib/http";

interface Window {
  count: number;
  resetAt: number;
}

interface Limits {
  windowMs: number;
  /** Requests allowed per client address in each window. */
  perClient: number;
  /** Requests allowed across all clients in each window, a backstop for spoofed addresses. */
  overall: number;
  message: string;
}

/** Fixed-window limiter kept in memory, for endpoints that write documents for anonymous callers. */
export function rateLimit({ windowMs, perClient, overall, message }: Limits): RequestHandler {
  const clients = new Map<string, Window>();
  let total: Window = { count: 0, resetAt: 0 };
  setInterval(() => {
    const now = Date.now();
    for (const [key, w] of clients) if (w.resetAt <= now) clients.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const reject = (w: Window) => {
      res.setHeader("Retry-After", String(Math.ceil((w.resetAt - now) / 1000)));
      next(new HttpError(429, message));
    };
    const existing = clients.get(key);
    const client = existing && existing.resetAt > now ? existing : undefined;
    // A capped client is turned away before it can use up the shared allowance.
    if (client && client.count >= perClient) return reject(client);
    if (total.resetAt <= now) total = { count: 0, resetAt: now + windowMs };
    if (total.count >= overall) return reject(total);
    total.count += 1;
    if (client) client.count += 1;
    else clients.set(key, { count: 1, resetAt: now + windowMs });
    next();
  };
}
