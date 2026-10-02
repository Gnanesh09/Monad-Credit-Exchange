import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { getCollections, type GuestDoc } from "@workspace/db";
import {
  CheckUsernameQueryParams,
  CheckUsernameResponse,
  CreateSessionBody,
  CreateSessionResponse,
  GetMeResponse,
  LinkWalletBody,
  LinkWalletResponse,
  ResumeSessionBody,
  ResumeSessionResponse,
  UnlinkWalletResponse,
} from "@workspace/api-zod";
import { badRequest, handler, HttpError, zodMessage } from "../lib/http";
import { hashToken, newToken, requireGuest, type SessionLocals } from "../middlewares/session";
import { rateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();

const RESERVED = new Set(["admin", "citrine", "system", "keeper", "monad", "root", "support", "null", "undefined", "anonymous", "guest"]);
const LINK_WINDOW_MS = 10 * 60_000;

function usernameProblem(username: string): string | null {
  if (username.length < 3 || username.length > 20) return "Use 3 to 20 characters.";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(username)) return "Start with a letter, then use letters, numbers or underscores.";
  if (RESERVED.has(username.toLowerCase())) return "That name is reserved.";
  return null;
}

function toUser(guest: GuestDoc) {
  return {
    id: guest._id,
    username: guest.username,
    wallet: guest.wallet ? getAddress(guest.wallet) : null,
    createdAt: guest.createdAt,
  };
}

router.get(
  "/usernames/check",
  handler(async (req, res) => {
    const parsed = CheckUsernameQueryParams.safeParse(req.query);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const username = parsed.data.username.trim();
    const reason = usernameProblem(username);
    if (reason) {
      res.json(CheckUsernameResponse.parse({ username, available: false, reason, exists: false, wallet: null }));
      return;
    }
    const { guests } = await getCollections();
    const existing = await guests.findOne({ usernameLower: username.toLowerCase() }, { projection: { username: 1, wallet: 1 } });
    res.json(
      CheckUsernameResponse.parse(
        existing
          ? { username: existing.username, available: false, reason: "That name is taken.", exists: true, wallet: existing.wallet ? getAddress(existing.wallet) : null }
          : { username, available: true, reason: null, exists: false, wallet: null },
      ),
    );
  }),
);

// Every new guest is a stored document, so anonymous creation is capped.
const guestLimit = rateLimit({
  windowMs: 10 * 60_000,
  perClient: 10,
  overall: 300,
  message: "Too many new guests from this connection. Try again in a few minutes.",
});

router.post(
  "/session",
  guestLimit,
  handler(async (req, res) => {
    const parsed = CreateSessionBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const username = parsed.data.username.trim();
    const problem = usernameProblem(username);
    if (problem) throw badRequest(problem);
    const { guests, sessions } = await getCollections();
    const now = new Date();
    const guest: GuestDoc = { _id: randomUUID(), username, usernameLower: username.toLowerCase(), wallet: null, createdAt: now, lastSeenAt: now };
    try {
      await guests.insertOne(guest);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, "That name is taken.");
      throw error;
    }
    const token = newToken();
    await sessions.insertOne({ _id: hashToken(token), guestId: guest._id, createdAt: now, lastUsedAt: now });
    res.status(201).json(CreateSessionResponse.parse({ token, user: toUser(guest) }));
  }),
);

// Resuming also stores a session document, so it is capped the same way.
const resumeLimit = rateLimit({
  windowMs: 10 * 60_000,
  perClient: 20,
  overall: 600,
  message: "Too many sign-ins from this connection. Try again in a few minutes.",
});

router.post(
  "/session/resume",
  resumeLimit,
  handler(async (req, res) => {
    const parsed = ResumeSessionBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { address, message, signature } = parsed.data;
    const username = parsed.data.username.trim();
    const { guests, sessions } = await getCollections();
    const guest = await guests.findOne({ usernameLower: username.toLowerCase() });
    if (!guest) throw new HttpError(404, "No guest uses that name.");

    // Without a linked wallet the name is all there is, so anyone may continue as it. A linked
    // wallet protects the guest: only a fresh message signed by that wallet opens a new session.
    if (guest.wallet) {
      if (!address || !message || !signature) {
        throw new HttpError(403, `@${guest.username} has a linked wallet. Sign in with that wallet to continue.`);
      }
      const fields = parseSignedMessage(message, "Citrine guest sign-in");
      if (!fields) throw badRequest("The signed message is not a Citrine sign-in message.");
      if (fields.guest !== guest.username) throw badRequest("The message was signed for a different guest.");
      if (fields.wallet.toLowerCase() !== address.toLowerCase()) throw badRequest("The message names a different wallet.");
      if (address.toLowerCase() !== guest.wallet) throw new HttpError(401, `Sign with the wallet linked to @${guest.username}.`);
      const age = Date.now() - fields.issuedAt.getTime();
      if (age > LINK_WINDOW_MS || age < -60_000) throw badRequest("The signed message has expired. Sign again.");
      const valid = await verifyMessage({ address: getAddress(address), message, signature: signature as Hex }).catch(() => false);
      if (!valid) throw new HttpError(401, "The signature does not match this wallet.");
      // Shares the link proof's clock, so neither kind of signed message can be replayed.
      const result = await guests.updateOne(
        { _id: guest._id, wallet: guest.wallet, $or: [{ walletProofAt: { $exists: false } }, { walletProofAt: null }, { walletProofAt: { $lt: fields.issuedAt } }] },
        { $set: { walletProofAt: fields.issuedAt } },
      );
      if (result.matchedCount === 0) throw new HttpError(409, "This signature was already used. Sign a new message.");
    }

    const now = new Date();
    const token = newToken();
    await Promise.all([
      sessions.insertOne({ _id: hashToken(token), guestId: guest._id, createdAt: now, lastUsedAt: now }),
      guests.updateOne({ _id: guest._id }, { $set: { lastSeenAt: now } }),
    ]);
    res.status(201).json(ResumeSessionResponse.parse({ token, user: toUser(guest) }));
  }),
);

router.delete(
  "/session",
  requireGuest,
  handler(async (_req, res) => {
    const { sessions } = await getCollections();
    await sessions.deleteOne({ _id: (res.locals as SessionLocals).sessionId });
    res.status(204).end();
  }),
);

router.get(
  "/session/me",
  requireGuest,
  handler(async (_req, res) => {
    res.json(GetMeResponse.parse(toUser((res.locals as SessionLocals).guest)));
  }),
);

/**
 * Parses a signed four-line message: the header, the guest, the wallet and the issue time.
 * See walletLinkMessage and guestSignInMessage in the web app.
 */
function parseSignedMessage(message: string, header: "Citrine wallet link" | "Citrine guest sign-in") {
  const lines = message.split("\n");
  if (lines.length !== 4 || lines[0] !== header) return null;
  const guest = lines[1]?.match(/^Guest: @(.+)$/)?.[1];
  const wallet = lines[2]?.match(/^Wallet: (0x[0-9a-fA-F]{40})$/)?.[1];
  const issued = lines[3]?.match(/^Issued: (.+)$/)?.[1];
  if (!guest || !wallet || !issued) return null;
  const issuedAt = new Date(issued);
  if (Number.isNaN(issuedAt.getTime())) return null;
  return { guest, wallet, issuedAt };
}

router.post(
  "/session/wallet",
  requireGuest,
  handler(async (req, res) => {
    const parsed = LinkWalletBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodMessage(parsed.error));
    const { address, message, signature } = parsed.data;
    if (!isAddress(address)) throw badRequest("That is not a valid wallet address.");
    const guest = (res.locals as SessionLocals).guest;
    const fields = parseSignedMessage(message, "Citrine wallet link");
    if (!fields) throw badRequest("The signed message is not a Citrine link message.");
    if (fields.guest !== guest.username) throw badRequest("The message was signed for a different guest.");
    if (fields.wallet.toLowerCase() !== address.toLowerCase()) throw badRequest("The message names a different wallet.");
    const age = Date.now() - fields.issuedAt.getTime();
    if (age > LINK_WINDOW_MS || age < -60_000) throw badRequest("The signed message has expired. Sign again.");
    const valid = await verifyMessage({ address: getAddress(address), message, signature: signature as Hex }).catch(() => false);
    if (!valid) throw new HttpError(401, "The signature does not match this wallet.");

    const wallet = address.toLowerCase();
    const { guests, sessions } = await getCollections();
    const owner = await guests.findOne({ wallet, _id: { $ne: guest._id } }, { projection: { username: 1 } });
    if (owner) throw new HttpError(409, `This wallet is already linked to @${owner.username}.`);
    try {
      // Each link must use a newer signed message than the last one, so a proof can't be replayed.
      const result = await guests.updateOne(
        { _id: guest._id, $or: [{ walletProofAt: { $exists: false } }, { walletProofAt: null }, { walletProofAt: { $lt: fields.issuedAt } }] },
        { $set: { wallet, walletProofAt: fields.issuedAt } },
      );
      if (result.matchedCount === 0) throw new HttpError(409, "This signature was already used. Sign a new message.");
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, "This wallet is already linked to another guest.");
      throw error;
    }
    // Sessions opened before the link never proved control of the wallet, so they end here.
    // From now on, other devices get in only by signing with this wallet.
    await sessions.deleteMany({ guestId: guest._id, _id: { $ne: (res.locals as SessionLocals).sessionId } });
    res.json(LinkWalletResponse.parse(toUser({ ...guest, wallet })));
  }),
);

router.delete(
  "/session/wallet",
  requireGuest,
  handler(async (_req, res) => {
    const guest = (res.locals as SessionLocals).guest;
    const { guests } = await getCollections();
    await guests.updateOne({ _id: guest._id }, { $set: { wallet: null } });
    res.json(UnlinkWalletResponse.parse(toUser({ ...guest, wallet: null })));
  }),
);

export default router;
