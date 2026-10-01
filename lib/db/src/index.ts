import { MongoClient, type Collection, type Db } from "mongodb";
import type { EventDoc, GuestDoc, LeaseDoc, LoanDoc, MetaDoc, RequestDoc, SessionDoc } from "./types";

export * from "./types";

const DB_NAME = process.env.MONGODB_DB || "citrine";

let client: MongoClient | null = null;
let connecting: Promise<Db> | null = null;

/** Shared connection. The first call connects; later calls reuse the client. */
export function getDb(): Promise<Db> {
  if (!connecting) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI must be set.");
    client = new MongoClient(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 10_000 });
    connecting = client
      .connect()
      .then((c) => c.db(DB_NAME))
      .catch((error: unknown) => {
        connecting = null;
        client = null;
        throw error;
      });
  }
  return connecting;
}

export interface Collections {
  guests: Collection<GuestDoc>;
  sessions: Collection<SessionDoc>;
  requests: Collection<RequestDoc>;
  loans: Collection<LoanDoc>;
  events: Collection<EventDoc>;
  meta: Collection<MetaDoc>;
  leases: Collection<LeaseDoc>;
}

export async function getCollections(): Promise<Collections> {
  const db = await getDb();
  return {
    guests: db.collection<GuestDoc>("guests"),
    sessions: db.collection<SessionDoc>("sessions"),
    requests: db.collection<RequestDoc>("requests"),
    loans: db.collection<LoanDoc>("loans"),
    events: db.collection<EventDoc>("events"),
    meta: db.collection<MetaDoc>("meta"),
    leases: db.collection<LeaseDoc>("leases"),
  };
}

export async function ensureIndexes(): Promise<void> {
  const c = await getCollections();
  await Promise.all([
    c.guests.createIndex({ usernameLower: 1 }, { unique: true }),
    c.guests.createIndex({ wallet: 1 }, { unique: true, partialFilterExpression: { wallet: { $type: "string" } } }),
    c.sessions.createIndex({ guestId: 1 }),
    c.requests.createIndex({ status: 1, auctionEnd: 1 }),
    c.requests.createIndex({ borrower: 1 }),
    c.requests.createIndex({ bestBidder: 1 }),
    c.loans.createIndex({ status: 1, maturity: 1 }),
    c.loans.createIndex({ holder: 1 }),
    c.loans.createIndex({ borrower: 1 }),
    c.loans.createIndex({ lender: 1 }),
    c.loans.createIndex({ "listing.seller": 1 }),
    c.events.createIndex({ loanId: 1, blockNumber: 1, logIndex: 1 }),
    c.events.createIndex({ timestamp: -1 }),
    c.events.createIndex({ actor: 1, timestamp: -1 }),
    c.events.createIndex({ counterparty: 1, timestamp: -1 }),
    c.events.createIndex({ kind: 1, timestamp: -1 }),
  ]);
}

export async function closeDb(): Promise<void> {
  const current = client;
  client = null;
  connecting = null;
  if (current) await current.close();
}
