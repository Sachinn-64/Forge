import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, isProd } from "@forge/shared";

// Must keep all four parameters or Express won't treat this as an error handler.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request", issues: err.flatten() },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  req.log.error({ err }, "unhandled error");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: isProd ? "Internal server error" : String((err as Error)?.message ?? err),
    },
  });
}
