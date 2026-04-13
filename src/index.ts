import { createApplication } from "./app.js";
import { logger } from "./lib/logger.js";

const app = await createApplication();

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down");
  await app.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.start();
