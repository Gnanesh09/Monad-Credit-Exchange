import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { getCollections } from "@workspace/db";
import { errorSummary, sleep } from "./chain";
import { logger } from "./logger";

/**
 * Elects one API instance to run the indexer and keeper through an expiring MongoDB lease.
 * Every instance serves reads, but only the leader writes the index and signs keeper
 * transactions, so replicas or overlapping deploys never race on the cursor or the nonce.
 */
const LEASE_ID = "workers";
const TTL_MS = 30_000;
const RENEW_MS = 10_000;
/**
 * The local view of the lease ends this long before other instances may claim it, so work
 * already in progress (one indexer batch or one keeper broadcast) finishes inside the term.
 */
const SAFETY_MS = 10_000;

const instance = randomUUID();
let leader = false;
let validUntil = 0;
let running = false;

async function claim(): Promise<boolean> {
  const { leases } = await getCollections();
  const now = new Date();
  const until = now.getTime() + TTL_MS - SAFETY_MS;
  try {
    const doc = await leases.findOneAndUpdate(
      { _id: LEASE_ID, $or: [{ holder: instance }, { expiresAt: { $lt: now } }] },
      { $set: { holder: instance, expiresAt: new Date(now.getTime() + TTL_MS) } },
      { upsert: true, returnDocument: "after" },
    );
    if (doc?.holder !== instance) return false;
    validUntil = until;
    return true;
  } catch (error) {
    // Another instance holds a live lease, so the upsert collided with its document.
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}

async function renew(): Promise<void> {
  const was = leader;
  try {
    leader = await claim();
  } catch (error) {
    // Without a confirmed lease, stop acting rather than risk two writers.
    leader = false;
    logger.warn({ err: errorSummary(error) }, "Lease renewal failed");
  }
  if (leader !== was) logger.info({ instance, leader }, leader ? "Took the worker lease" : "Lost the worker lease");
}

/** True while this instance holds an unexpired lease. Workers check it before every write. */
export function isLeader(): boolean {
  return leader && Date.now() < validUntil;
}

export async function startLeaderElection(): Promise<void> {
  if (running) return;
  running = true;
  await renew();
  void (async () => {
    while (running) {
      await sleep(RENEW_MS);
      if (running) await renew();
    }
  })();
}

/**
 * Releases the lease on shutdown so the next instance takes over without waiting for expiry.
 * Call it only after the workers have drained.
 */
export async function stopLeaderElection(): Promise<void> {
  running = false;
  if (!leader) return;
  leader = false;
  validUntil = 0;
  const { leases } = await getCollections();
  await leases.deleteOne({ _id: LEASE_ID, holder: instance }).catch(() => undefined);
}
