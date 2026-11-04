import { prisma, type Role } from "@forge/db";
import { AppError } from "@forge/shared";
import { hasAtLeast, outranks } from "../lib/roles";
import { audit } from "./audit.service";

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, email: true, name: true } },
} as const;

type Actor = { userId: string; role: Role; ip?: string | null };

export function listMembers(organizationId: string) {
  return prisma.membership.findMany({
    where: { organizationId },
    select: memberSelect,
    orderBy: { createdAt: "asc" },
  });
}

function assertCanAssign(actor: Actor, role: Role) {
  // Only an OWNER may grant OWNER. Nobody may grant above their own rank.
  if (!hasAtLeast(actor.role, role)) {
    throw AppError.forbidden("Cannot assign a role above your own");
  }
}

function assertCanActOn(actor: Actor, targetRole: Role) {
  // OWNER can act on anyone. Others only on members they outrank.
  if (actor.role !== "OWNER" && !outranks(actor.role, targetRole)) {
    throw AppError.forbidden("Cannot modify a member with equal or higher role");
  }
}

async function assertNotLastOwner(organizationId: string, membershipId: string) {
  const owners = await prisma.membership.count({ where: { organizationId, role: "OWNER" } });
  const target = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (target?.role === "OWNER" && owners <= 1) {
    throw AppError.conflict("Organization must keep at least one owner", "LAST_OWNER");
  }
}

export async function addMember(
  organizationId: string,
  input: { email: string; role: Role },
  actor: Actor,
) {
  assertCanAssign(actor, input.role);

  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user) throw AppError.notFound("No user with that email. They must register first.");

  const existing = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
  });
  if (existing) throw AppError.conflict("User is already a member", "ALREADY_MEMBER");

  const membership = await prisma.membership.create({
    data: { organizationId, userId: user.id, role: input.role },
    select: memberSelect,
  });
  await audit({
    organizationId,
    actorUserId: actor.userId,
    action: "member.add",
    targetType: "user",
    targetId: user.id,
    metadata: { role: input.role },
    ip: actor.ip,
  });
  return membership;
}

export async function changeRole(
  organizationId: string,
  targetUserId: string,
  role: Role,
  actor: Actor,
) {
  if (targetUserId === actor.userId) {
    throw AppError.badRequest("Cannot change your own role", "SELF_ROLE_CHANGE");
  }

  const target = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
  });
  if (!target) throw AppError.notFound("Member not found");

  assertCanActOn(actor, target.role);
  assertCanAssign(actor, role);
  if (target.role === "OWNER" && role !== "OWNER") {
    await assertNotLastOwner(organizationId, target.id);
  }

  const updated = await prisma.membership.update({
    where: { id: target.id },
    data: { role },
    select: memberSelect,
  });
  await audit({
    organizationId,
    actorUserId: actor.userId,
    action: "member.role_change",
    targetType: "user",
    targetId: targetUserId,
    metadata: { from: target.role, to: role },
    ip: actor.ip,
  });
  return updated;
}

export async function removeMember(organizationId: string, targetUserId: string, actor: Actor) {
  const target = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
  });
  if (!target) throw AppError.notFound("Member not found");

  const isSelf = targetUserId === actor.userId;
  if (!isSelf) {
    if (!hasAtLeast(actor.role, "ADMIN")) throw AppError.forbidden();
    assertCanActOn(actor, target.role);
  }
  await assertNotLastOwner(organizationId, target.id);

  await prisma.membership.delete({ where: { id: target.id } });
  await audit({
    organizationId,
    actorUserId: actor.userId,
    action: isSelf ? "member.leave" : "member.remove",
    targetType: "user",
    targetId: targetUserId,
    metadata: { role: target.role },
    ip: actor.ip,
  });
}
