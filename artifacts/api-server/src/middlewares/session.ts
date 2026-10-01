import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getCollections, type GuestDoc } from "@workspace/db";
import { HttpError } from "../lib/http";

const TOUCH_INTERVAL_MS = 5 * 60_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

export interface SessionLocals {
  guest: GuestDoc;
  sessionId: string;
}

/** Resolves the guest from the bearer token, or responds 401. */
export async function requireGuest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearer(req);
    if (!token) throw new HttpError(401, "Enter as a guest first.");
    const { sessions, guests } = await getCollections();
    const sessionId = hashToken(token);
    const session = await sessions.findOne({ _id: sessionId });
    if (!session) throw new HttpError(401, "Your session has ended. Enter again.");
    const guest = await guests.findOne({ _id: session.guestId });
    if (!guest) throw new HttpError(401, "Your session has ended. Enter again.");
    const now = new Date();
    if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await Promise.all([
        sessions.updateOne({ _id: sessionId }, { $set: { lastUsedAt: now } }),
        guests.updateOne({ _id: guest._id }, { $set: { lastSeenAt: now } }),
      ]);
    }
    (res.locals as SessionLocals).guest = guest;
    (res.locals as SessionLocals).sessionId = sessionId;
    next();
  } catch (error) {
    next(error);
  }
}
