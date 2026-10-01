# Citrine

A decentralized credit exchange on Monad testnet: borrowers post collateralized loan requests, lenders compete in onchain rate auctions to fund them, and funded loans become tradable ERC-721 positions. Built for the Metropolis Hackathon (Track 01, deadline Oct 13, 2026, 11:59 PM ET). See `README.md` for the full product, architecture and setup docs submitted to judges.

## Run & Operate

- Workflows: `artifacts/citrine: web` (Next.js dev, port 19776, serves `/`) and `artifacts/api-server: API Server` (Express, serves `/api`, also runs the indexer, keeper and price service).
- `pnpm run typecheck` — typecheck all packages; `pnpm --filter @workspace/citrine run build` — production build of the web app.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate React Query hooks and Zod schemas after editing `lib/api-spec/openapi.yaml`.
- Contracts: `pnpm --filter @workspace/contracts run compile | test | deploy:testnet | verify:testnet | seed:testnet`.
- Secrets: `MONGODB_URI`, `DEPLOYER_PRIVATE_KEY` (deployer and keeper key). Optional: `PYTH_API_KEY` (live Hermes prices; without it liquidations pause), `MONAD_RPC_URL`, `KEEPER_ENABLED=false`.

## Stack

- Contracts: Solidity 0.8.28 + Hardhat + OpenZeppelin 5 + Pyth (`lib/contracts`).
- API: Express 5, MongoDB driver (no ORM; `lib/db`), viem, Zod generated from OpenAPI.
- Web: Next.js 16 App Router (Turbopack), wagmi 2 + viem, TanStack Query, Tailwind, shadcn/ui, Framer Motion, Recharts.

## Where things live

- Contract addresses + start block: `lib/contracts/src/deployments.ts` (written by the deploy script; never edit by hand). ABIs: `lib/contracts/src/generated`.
- API contract: `lib/api-spec/openapi.yaml`. Mongo collections/indexes: `lib/db/src`.
- Indexer / keeper / prices: `artifacts/api-server/src/lib/{indexer,keeper,prices}.ts`.
- Theme tokens: `artifacts/citrine/src/app/globals.css`. Wallet/tx logic: `artifacts/citrine/src/lib/web3`.

## Architecture decisions

- MongoDB is only a read model plus guest identities; the contract is the source of truth. The indexer re-reads contract state after events instead of trusting event payloads alone.
- State reads are pinned to the indexed block number, because the public Monad RPC is load-balanced and a lagging node answers `latest` with stale state.
- No authentication: guests pick a username (bearer token stored on device) and can link a wallet via a signed message.
- The keeper shares the deployer key, so scripts must not send from the deployer while the API is running (nonce collisions).
- Indexer and keeper run only on the instance holding the MongoDB `leases` lease (`lib/leader.ts`). Anything new that writes the index or signs transactions must call the fence or `isLeader()` right before the write. The dev workflow does not forward SIGTERM, so after a restart the new process waits up to 30 s for the old lease to expire.
- Monad bills the full gas limit, so transactions use the estimate plus a 15% buffer rather than a large fixed limit.

## Product

- Landing page at `/`, guest entry at `/start`, app under `/app` (Market, Borrow, Lend, Trade, Portfolio, request and loan detail pages).
- Rate auctions with anti-sniping extension, accept-early, permissionless settle/expire/default/liquidate (automated by the keeper), fixed-price secondary market for positions, in-app token faucet.

## User preferences

- Dark theme with lemon/solar yellow primary; Apple/Coinbase-level polish; no all-caps or bold shouting typography; no static or placeholder data — everything comes from the chain or the API.
- Frontend must be Next.js; MongoDB for storage; real Monad integration (ask for API keys when needed).

## Gotchas

- Next 16 dev blocks the HMR websocket for origins not in `allowedDevOrigins`, and then pages never hydrate (SSR shell renders but nothing is interactive). Keep the Replit dev domains and `127.0.0.1` listed in `next.config.mjs`.
- Anything time-based rendered during SSR must not read `Date.now()` in its initial state (hydration mismatch); use the `useNow` hook.
- `eth_getLogs` on Monad testnet is limited to 100 blocks per call.
- The testnet market was seeded from team wallets (`seed:testnet`); live auctions end within a day, so re-run the seed before judging/demo recording.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
