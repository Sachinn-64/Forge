import type { NextFunction, Request, Response } from "express";
import type { Membership, Organization } from "@forge/db";
import { AppError } from "@forge/shared";
import { SESSION_COOKIE } from "../lib/session";
import { getSessionUser } from "../services/auth.service";
import { getApiTokenUser } from "../services/token.service";

export type AuthUser = { id: string; email: string; name: string | null; createdAt: Date };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authMethod?: "session" | "token";
      sessionToken?: string;
      org?: Organization;
      membership?: Membership;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const user = await getApiTokenUser(header.slice("Bearer ".length).trim());
    if (!user) throw AppError.unauthorized("Invalid or expired API token");
    req.user = user;
    req.authMethod = "token";
    return next();
  }

  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) throw AppError.unauthorized();

  const result = await getSessionUser(token);
  if (!result) throw AppError.unauthorized("Session expired");

  req.user = result.user;
  req.authMethod = "session";
  req.sessionToken = token;
  next();
}
