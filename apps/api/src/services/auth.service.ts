import { prisma } from "@forge/db";
import { AppError } from "@forge/shared";
import { hashPassword, verifyPassword } from "../lib/password";
import { generateSessionToken, hashSessionToken, SESSION_TTL_MS } from "../lib/session";
import { createOrg } from "./org.service";

// Verified against when the email doesn't exist, so login timing is the same either way.
const DUMMY_HASH_PROMISE = hashPassword("dummy-password-for-timing");

// Fields safe to return to the client. Never passwordHash.
export const publicUser = { id: true, email: true, name: true, createdAt: true } as const;

export async function register(
  input: { email: string; password: string; name?: string },
  ip?: string | null,
) {
  const email = input.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw AppError.conflict("Email already registered", "EMAIL_TAKEN");

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, name: input.name },
      select: publicUser,
    });
    const orgName = input.name?.trim() || email.split("@")[0] || "personal";
    const org = await createOrg({ name: orgName, ownerId: user.id, ip }, tx);
    return { user, org };
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
