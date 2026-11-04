import { prisma, type Prisma } from "@forge/db";

export type AuditInput = {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

type Client = Prisma.TransactionClient | typeof prisma;

export function audit(input: AuditInput, client: Client = prisma) {
  return client.auditLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata,
      ip: input.ip ?? null,
    },
  });
}

export async function listAudit(organizationId: string, limit = 50, before?: Date) {
  return prisma.auditLog.findMany({
    where: { organizationId, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { id: true, email: true, name: true } } },
  });
}
