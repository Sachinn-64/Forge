import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "@forge/shared";
import authRoutes from "./routes/auth.routes";
import orgRoutes from "./routes/org.routes";
import tokenRoutes from "./routes/token.routes";
import { errorHandler } from "./middleware/error-handler";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      level: env.NODE_ENV === "test" ? "silent" : "info",
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
      redact: ["req.headers.cookie", "req.headers.authorization"],
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/v1/auth", authRoutes);
  app.use("/v1/orgs", orgRoutes);
  app.use("/v1/tokens", tokenRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
  app.use(errorHandler);

  return app;
}
