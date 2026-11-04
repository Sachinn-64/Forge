import type { NextFunction, Request, Response } from "express";
import { prisma, type Role } from "@forge/db";
import { AppError } from "@forge/shared";
import { hasAtLeast } from "../lib/roles";

/**
 * Loads the organization from `:orgSlug`, verifies the caller is a member with at
 * least `min` role, and attaches `req.org` and `req.membership`.
 *
 * Non-members get 404, not 403, so org slugs can't be enumerated.
 */
export function requireRole(min: Role) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const slug = req.params.orgSlug as string | undefined;
    if (!slug) throw AppError.badRequest("Missing organization slug");
    if (!req.user) throw AppError.unauthorized();

    const org = await prisma.organization.findUnique({ where: { slug } });
    if (!org) throw AppError.notFound("Organization not found");

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.user.id, organizationId: org.id } },
    });
    if (!membership) throw AppError.notFound("Organization not found");

    if (!hasAtLeast(membership.role, min)) {
      throw AppError.forbidden(`Requires ${min} role or higher`);
    }

    req.org = org;
    req.membership = membership;
    next();
  };
}
