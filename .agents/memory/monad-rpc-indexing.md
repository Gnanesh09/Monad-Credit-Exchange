---
name: Monad RPC and indexing
description: How the public Monad testnet RPC behaves and the rules the indexer follows because of it.
---
- The public testnet RPC is load-balanced: consecutive calls can hit nodes a few blocks apart, so a "latest" head from one call may not exist on the next node, and getLogs is capped at 100 blocks per call.
  **Why:** indexing to "latest" produced missed or duplicated state when nodes disagreed.
  **How to apply:** index only to the "finalized" block minus a small margin, and pin every follow-up state read (getRequest, getLoan, ownerOf) to the indexed block number.
- Indexer and keeper must have a single writer. A MongoDB lease elects the leader; followers only mirror the cursor.
  **Why:** autoscale or overlapping deploys would otherwise race on the cursor and the keeper nonce.
  **How to apply:** anything that writes the index or signs transactions must check leadership right before the write, and only the leader may reset the index.
- In the dev workflow, SIGTERM does not reach the Node process through the pnpm wrapper, so the lease is not released and the next start waits up to the 30 s TTL. Sending SIGTERM to node directly releases it.
