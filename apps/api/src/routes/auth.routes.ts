import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env, isProd } from "@forge/shared";
import { requireAuth } from "../middleware/auth";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../lib/session";
import * as auth from "../services/auth.service";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
});

const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

const registerSchema = credentials.extend({
  name: z.string().min(1).max(80).optional(),
});

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProd,
  path: "/",
  maxAge: SESSION_TTL_MS,
};

router.post("/register", authLimiter, async (req, res) => {
  const body = registerSchema.parse(req.body);
  const { user, org } = await auth.register(body, req.ip);
  const { token } = await auth.createSession(user.id);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  res.status(201).json({ user, org });
});

router.post("/login", authLimiter, async (req, res) => {
  const body = credentials.parse(req.body);
  const { token } = await auth.login(body);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  res.status(204).end();
});

router.post("/logout", requireAuth, async (req, res) => {
  if (req.sessionToken) await auth.logout(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user, authMethod: req.authMethod });
});

export default router;
