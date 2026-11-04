# Guide 01 — Authentication

Phase 1 auth slice: email + password registration, DB-backed sessions, cookie auth, rate limiting.
GitHub OAuth comes in Phase 2 together with the GitHub App integration.

## Design decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Session storage | PostgreSQL `sessions` table, random token in an httpOnly cookie | Needs revocation and "log out everywhere" later. JWTs can't be revoked without a blocklist, which is a session table anyway. |
| Token at rest | Only the SHA-256 hash is stored | A DB leak must not hand out live sessions. |
| Password hashing | Argon2id (`argon2` package) | OWASP recommendation. Memory-hard. Prebuilt binaries on macOS. |
| Login timing | Verify against a dummy hash when the email is unknown | Prevents user enumeration via response time. |
| Env config | Zod-validated at boot | Process refuses to start with a missing secret instead of failing on the first request. |
| Errors | One `AppError` class, one error middleware | Every error leaves the API as `{ error: { code, message } }`. |

Express 5 forwards rejected promises from async handlers to the error middleware automatically. That is why the routes have no `try/catch`.

## Files to create

```
packages/shared/src/config/env.ts
packages/shared/src/errors/app-error.ts
packages/shared/src/index.ts
packages/db/prisma/schema.prisma
packages/db/src/index.ts
apps/api/src/lib/password.ts
apps/api/src/lib/session.ts
apps/api/src/services/auth.service.ts
apps/api/src/middleware/auth.ts
apps/api/src/middleware/error-handler.ts
apps/api/src/routes/auth.routes.ts
apps/api/src/app.ts
apps/api/src/index.ts
```

Dependencies are already installed. Postgres and Redis are already running via `pnpm infra:up`.

---

## 1. `packages/shared/src/config/env.ts`

Validates `process.env` once. Everything else imports `env` from here instead of touching `process.env`.

```ts
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
```

## 2. `packages/shared/src/errors/app-error.ts`

```ts
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(msg: string, code = "BAD_REQUEST") {
    return new AppError(400, code, msg);
  }
  static unauthorized(msg = "Unauthorized") {
    return new AppError(401, "UNAUTHORIZED", msg);
  }
  static forbidden(msg = "Forbidden") {
    return new AppError(403, "FORBIDDEN", msg);
  }
  static notFound(msg = "Not found") {
    return new AppError(404, "NOT_FOUND", msg);
  }
  static conflict(msg: string, code = "CONFLICT") {
    return new AppError(409, code, msg);
  }
}
```

## 3. `packages/shared/src/index.ts`

```ts
export { env, isProd } from "./config/env";
export { AppError } from "./errors/app-error";
```

## 4. `packages/db/prisma/schema.prisma`

Only auth tables for now. Projects, deployments, builds, nodes etc. are added in their own phases.

Notes:
- `passwordHash` is nullable so GitHub-only accounts work in Phase 2.
- `@db.Timestamptz` keeps every timestamp in UTC.
- `@map` gives snake_case column names in Postgres while the TS client stays camelCase.
- `onDelete: Cascade` on sessions and memberships: deleting a user cleans up after itself.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  OWNER
  ADMIN
  DEVELOPER
  VIEWER
}

model User {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique
  passwordHash String?  @map("password_hash")
  name         String?
  githubId     String?  @unique @map("github_id")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz

  sessions    Session[]
  memberships Membership[]

  @@map("users")
}

model Session {
  id        String   @id @default(uuid()) @db.Uuid
  tokenHash String   @unique @map("token_hash")
  userId    String   @map("user_id") @db.Uuid
  expiresAt DateTime @map("expires_at") @db.Timestamptz
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model Organization {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  slug      String   @unique
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

  memberships Membership[]

  @@map("organizations")
}

model Membership {
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  role           Role
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
  @@index([organizationId])
  @@map("memberships")
}
```

## 5. `packages/db/src/index.ts`

One Prisma client for the whole process. Re-exports the generated types so other packages import everything from `@forge/db`.

```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
export * from "@prisma/client";
```

**Stop here and run** (from the repo root):

```bash
pnpm db:generate
pnpm db:migrate        # when prompted for a name: init_auth
```

Check the tables exist:

```bash
docker exec compose-postgres-1 psql -U forge -d forge -c '\dt'
```

---

## 6. `apps/api/src/lib/password.ts`

Argon2id with the OWASP minimum parameters (19 MiB memory, 2 iterations, 1 lane).

```ts
import argon2 from "argon2";

const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string) {
  return argon2.hash(password, OPTIONS);
}

export function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}
```

## 7. `apps/api/src/lib/session.ts`

32 random bytes → base64url token for the cookie. SHA-256 of it is what goes in the DB.

```ts
import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "forge_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
```

## 8. `apps/api/src/services/auth.service.ts`

All DB logic for auth lives here. Routes stay thin.

```ts
import { prisma } from "@forge/db";
import { AppError } from "@forge/shared";
import { hashPassword, verifyPassword } from "../lib/password";
import { generateSessionToken, hashSessionToken, SESSION_TTL_MS } from "../lib/session";

// Verified against when the email doesn't exist, so login timing is the same either way.
const DUMMY_HASH_PROMISE = hashPassword("dummy-password-for-timing");

// Fields safe to return to the client. Never passwordHash.
export const publicUser = { id: true, email: true, name: true, createdAt: true } as const;

export async function register(input: { email: string; password: string; name?: string }) {
  const email = input.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw AppError.conflict("Email already registered", "EMAIL_TAKEN");

  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: { email, passwordHash, name: input.name },
    select: publicUser,
  });
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const ok = await verifyPassword(hash, input.password);

  if (!user || !user.passwordHash || !ok) {
    throw AppError.unauthorized("Invalid email or password");
  }

  return createSession(user.id);
}

export async function createSession(userId: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt },
  });

  return { token, expiresAt };
}

export async function getSessionUser(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: publicUser } },
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return { session, user: session.user };
}

export async function logout(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
```

## 9. `apps/api/src/middleware/auth.ts`

Reads the cookie, resolves the session, attaches `req.user`. The `declare global` block teaches TypeScript about the new fields on `Request`.

```ts
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
```

## 10. `apps/api/src/middleware/error-handler.ts`

Must have exactly four parameters or Express won't treat it as an error handler.

```ts
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, isProd } from "@forge/shared";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request", issues: err.flatten() },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  req.log.error({ err }, "unhandled error");
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: isProd ? "Internal server error" : String((err as Error)?.message ?? err),
    },
  });
}
```

## 11. `apps/api/src/routes/auth.routes.ts`

Validation with Zod inline. A `ZodError` thrown here is turned into a 400 by the error handler.

```ts
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { isProd } from "@forge/shared";
import { requireAuth } from "../middleware/auth";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../lib/session";
import * as auth from "../services/auth.service";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
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
  const user = await auth.register(body);
  const { token } = await auth.createSession(user.id);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  res.status(201).json({ user });
});

router.post("/login", authLimiter, async (req, res) => {
  const body = credentials.parse(req.body);
  const { token } = await auth.login(body);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  res.status(204).end();
});

router.post("/logout", requireAuth, async (req, res) => {
  await auth.logout(req.sessionToken!);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
```

## 12. `apps/api/src/app.ts`

`createApp()` is a factory so tests can build an app without opening a port.

```ts
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { isProd } from "@forge/shared";
import authRoutes from "./routes/auth.routes";
import { errorHandler } from "./middleware/error-handler";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      transport: isProd ? undefined : { target: "pino-pretty" },
      redact: ["req.headers.cookie", "req.headers.authorization"],
    }),
  );

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/v1/auth", authRoutes);

  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND" } }));
  app.use(errorHandler);

  return app;
}
```

## 13. `apps/api/src/index.ts`

Graceful shutdown: stop accepting connections, disconnect Prisma, exit. Hard-exit after 10s if something hangs.

```ts
import { prisma } from "@forge/db";
import { env } from "@forge/shared";
import { createApp } from "./app";

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`forge api listening on :${env.PORT}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

---

## Run

```bash
pnpm dev
```

## Test

```bash
# register → 201, sets cookie
curl -i -c jar.txt -X POST localhost:4000/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"password123","name":"You"}'

# me → 200 with user
curl -i -b jar.txt localhost:4000/v1/auth/me

# duplicate register → 409 EMAIL_TAKEN
curl -i -X POST localhost:4000/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"password123"}'

# bad password → 401
curl -i -X POST localhost:4000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"wrong"}'

# short password → 400 VALIDATION_ERROR
curl -i -X POST localhost:4000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"x"}'

# logout → 204, then me → 401
curl -i -b jar.txt -X POST localhost:4000/v1/auth/logout
curl -i -b jar.txt localhost:4000/v1/auth/me
```

## API summary

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| POST | `/v1/auth/register` | none | 201 `{ user }` + cookie |
| POST | `/v1/auth/login` | none | 204 + cookie |
| POST | `/v1/auth/logout` | cookie | 204, cookie cleared |
| GET | `/v1/auth/me` | cookie | 200 `{ user }` |
| GET | `/health` | none | 200 `{ status: "ok" }` |

## Common mistakes

- **`Cannot find module '@forge/shared'`**: `pnpm install` was not re-run after editing a package.json, or `main` in that package does not point to `src/index.ts`.
- **`@prisma/client did not initialize yet`**: run `pnpm db:generate`.
- **Error handler never fires**: it has fewer than 4 parameters, or it is registered before the routes.
- **Cookie not sent back by curl**: use `-c jar.txt` on register/login and `-b jar.txt` on later calls.
- **`req.log` is undefined**: `pinoHttp` is registered after the route, move it up.

## Next guide

`02-organizations.md`: create org, slug generation, membership roles, `requireRole(...)` middleware, org-scoped routes.
