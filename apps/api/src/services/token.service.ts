import { prisma } from "@forge/db";
import { AppError } from "@forge/shared";
import { randomToken, sha256 } from "../lib/tokens";
import { publicUser } from "./auth.service";
import { audit } from "./audit.service";

export const TOKEN_PREFIX = "forge_";
const PREFIX_DISPLAY_LENGTH = 12;

const tokenSelect = {
  id: true,
  name: true,
  prefix: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

export function listTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    select: tokenSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function createToken(
  userId: string,
  input: { name: string; expiresInDays?: number },
  ip?: string | null,
) {
  const secret = TOKEN_PREFIX + randomToken(32);
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const token = await prisma.apiToken.create({
    data: {
      userId,
      name: input.name,
      prefix: secret.slice(0, PREFIX_DISPLAY_LENGTH),
      tokenHash: sha256(secret),
      expiresAt,
    },
    select: tokenSelect,
  });
  await audit({
    actorUserId: userId,
    action: "token.create",
    targetType: "api_token",
    targetId: token.id,
    metadata: { name: input.name },
    ip,
  });

  // The plaintext secret is returned exactly once.
  return { ...token, token: secret };
}

export async function revokeToken(userId: string, tokenId: string, ip?: string | null) {
  const result = await prisma.apiToken.deleteMany({ where: { id: tokenId, userId } });
  if (result.count === 0) throw AppError.notFound("Token not found");
  await audit({
    actorUserId: userId,
    action: "token.revoke",
    targetType: "api_token",
    targetId: tokenId,
    ip,
  });
}

export async function getApiTokenUser(secret: string) {
  if (!secret.startsWith(TOKEN_PREFIX)) return null;

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: sha256(secret) },
    include: { user: { select: publicUser } },
  });
  if (!token) return null;
  if (token.expiresAt && token.expiresAt < new Date()) return null;

  // Best-effort; never block the request on this write.
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return token.user;
}
