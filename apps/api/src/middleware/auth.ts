import type { NextFunction, Request, Response } from "express";
import { AppError } from "@forge/shared";
import { SESSION_COOKIE } from "../lib/session";
import { getSessionUser } from "../services/auth.service";

export type AuthUser = { id: string; email: string; name: string | null; createdAt: Date };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionToken?: string;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) throw AppError.unauthorized();

  const result = await getSessionUser(token);
  if (!result) throw AppError.unauthorized("Session expired");

  req.user = result.user;
  req.sessionToken = token;
  next();
}
