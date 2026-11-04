import { prisma, type Prisma, type Role } from "@forge/db";
import { AppError, randomSuffix, slugify } from "@forge/shared";
import { audit } from "./audit.service";

type Client = Prisma.TransactionClient | typeof prisma;

export const orgSelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function uniqueOrgSlug(name: string, client: Client) {
  const base = slugify(name);
  let candidate = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await client.organization.findUnique({ where: { slug: candidate } });
    if (!taken) return candidate;
    candidate = `${base}-${randomSuffix()}`;
  }
  throw AppError.conflict("Could not generate a unique slug", "SLUG_EXHAUSTED");
}

export async function createOrg(
  input: { name: string; ownerId: string; ip?: string | null },
  client: Client = prisma,
) {
  const slug = await uniqueOrgSlug(input.name, client);
  const org = await client.organization.create({
    data: {
      name: input.name,
      slug,
      memberships: { create: { userId: input.ownerId, role: "OWNER" } },
    },
    select: orgSelect,
  });
  await audit(
    {
      organizationId: org.id,
      actorUserId: input.ownerId,
      action: "org.create",
      targetType: "organization",
      targetId: org.id,
      metadata: { name: org.name, slug: org.slug },
      ip: input.ip,
    },
    client,
  );
  return org;
}

export async function listOrgsForUser(userId: string) {
  const rows = await prisma.membership.findMany({
    where: { userId },
    include: { organization: { select: orgSelect } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({ ...m.organization, role: m.role }));
}

export async function updateOrg(
  orgId: string,
  input: { name?: string },
  actor: { userId: string; ip?: string | null },
) {
  const org = await prisma.organization.update({
    where: { id: orgId },
    data: { name: input.name },
    select: orgSelect,
  });
  await audit({
    organizationId: orgId,
    actorUserId: actor.userId,
    action: "org.update",
    targetType: "organization",
    targetId: orgId,
    metadata: input,
    ip: actor.ip,
  });
  return org;
}

export async function deleteOrg(orgId: string, actor: { userId: string; ip?: string | null }) {
  await prisma.$transaction(async (tx) => {
    await audit(
      {
        organizationId: null,
        actorUserId: actor.userId,
        action: "org.delete",
        targetType: "organization",
        targetId: orgId,
        ip: actor.ip,
      },
      tx,
    );
    await tx.organization.delete({ where: { id: orgId } });
  });
}

export async function getMembership(userId: string, organizationId: string) {
  return prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
}

export type MembershipWithRole = { role: Role };
