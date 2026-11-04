import { prisma } from "@forge/db";
import { env } from "@forge/shared";
import { createApp } from "./app";

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`forge api listening on :${env.PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
