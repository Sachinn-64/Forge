import request from "supertest";
import { prisma } from "@forge/db";
import { createApp } from "../src/app";

export const app = createApp();

export async function resetDb() {
  // CASCADE reaches every table with a FK to these two.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "users", "organizations" CASCADE`);
}

let counter = 0;
export function uniqueEmail(prefix = "user") {
  counter += 1;
  return `${prefix}${counter}-${Date.now()}@test.forge`;
}

export async function signup(name = "Test User") {
  const agent = request.agent(app);
  const email = uniqueEmail(name.toLowerCase().replace(/\s+/g, ""));
  const res = await agent
    .post("/v1/auth/register")
    .send({ email, password: "password123", name })
    .expect(201);
  return {
    agent,
    email,
    user: res.body.user as { id: string; email: string; name: string },
    org: res.body.org as { id: string; name: string; slug: string },
  };
}

export async function addMember(
  ownerAgent: request.Agent,
  orgSlug: string,
  email: string,
  role: "OWNER" | "ADMIN" | "DEVELOPER" | "VIEWER",
) {
  return ownerAgent.post(`/v1/orgs/${orgSlug}/members`).send({ email, role }).expect(201);
}
