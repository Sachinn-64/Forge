import { prisma } from "@forge/db";
import { AppError, randomSuffix, slugify } from "@forge/shared";
import { audit } from "./audit.service";

export const projectSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  defaultBranch: true,
  rootDirectory: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Actor = { userId: string; ip?: string | null };

async function uniqueProjectSlug(organizationId: string, name: string) {
  const base = slugify(name);
  let candidate = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await prisma.project.findUnique({
      where: { organizationId_slug: { organizationId, slug: candidate } },
    });
    if (!taken) return candidate;
    candidate = `${base}-${randomSuffix()}`;
  }
  throw AppError.conflict("Could not generate a unique slug", "SLUG_EXHAUSTED");
}

export function listProjects(organizationId: string) {
  return prisma.project.findMany({
    where: { organizationId },
    select: projectSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function getProject(organizationId: string, slug: string) {
  const project = await prisma.project.findUnique({
    where: { organizationId_slug: { organizationId, slug } },
    select: projectSelect,
  });
  if (!project) throw AppError.notFound("Project not found");
  return project;
}

export async function createProject(
  organizationId: string,
  input: { name: string; defaultBranch?: string; rootDirectory?: string },
  actor: Actor,
) {
  const slug = await uniqueProjectSlug(organizationId, input.name);
  const project = await prisma.project.create({
    data: {
      organizationId,
      name: input.name,
      slug,
      defaultBranch: input.defaultBranch,
      rootDirectory: input.rootDirectory,
    },
    select: projectSelect,
  });
  await audit({
    organizationId,
    actorUserId: actor.userId,
    action: "project.create",
    targetType: "project",
    targetId: project.id,
    metadata: { name: project.name, slug: project.slug },
    ip: actor.ip,
  });
  return project;
}

export async function updateProject(
  organizationId: string,
  slug: string,
  input: { name?: string; defaultBranch?: string; rootDirectory?: string },
  actor: Actor,
) {
  const existing = await getProject(organizationId, slug);
  const project = await prisma.project.update({
    where: { id: existing.id },
    data: input,
    select: projectSelect,
  });
  await audit({
    organizationId,
    actorUserId: actor.userId,
    action: "project.update",
    targetType: "project",
    targetId: project.id,
    metadata: input,
    ip: actor.ip,
  });
  return project;
}

export async function deleteProject(organizationId: string, slug: string, actor: Actor) {
  const existing = await getProject(organizationId, slug);
  await prisma.project.delete({ where: { id: existing.id } });
  await audit({
    organizationId,
    actorUserId: actor.userId,
    action: "project.delete",
    targetType: "project",
    targetId: existing.id,
    metadata: { slug },
    ip: actor.ip,
  });
}
