import { Role } from "@forge/db";

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  DEVELOPER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasAtLeast(role: Role, min: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function outranks(a: Role, b: Role) {
  return ROLE_RANK[a] > ROLE_RANK[b];
}
