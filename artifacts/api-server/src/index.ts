import app from "./app";
import { closeDb, ensureIndexes } from "@workspace/db";
import { startIndexer, stopIndexer } from "./lib/indexer";
import { startKeeper, stopKeeper } from "./lib/keeper";
import { startLeaderElection, stopLeaderElection } from "./lib/leader";
import { sleep } from "./lib/chain";
import { logger } from "./lib/logger";
import { startPriceService, stopPriceService } from "./lib/prices";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  await ensureIndexes();
  await startLeaderElection();
  await startPriceService();
  await startIndexer();
  startKeeper();

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    // Let in-flight indexer writes and keeper transactions finish before giving up the lease.
    await Promise.race([Promise.all([stopKeeper(), stopIndexer()]), sleep(15_000)]);
    await stopLeaderElection();
    stopPriceService();
    server.close();
    await closeDb().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start the API server");
  process.exit(1);
});
