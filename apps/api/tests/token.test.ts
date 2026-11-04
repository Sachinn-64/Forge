import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "@forge/db";
import { app, resetDb, signup } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("api tokens", () => {
  it("creates a token shown once and authenticates with it", async () => {
    const { agent, user, org } = await signup();
    const created = await agent.post("/v1/tokens").send({ name: "cli" }).expect(201);
    const secret: string = created.body.token.token;
    expect(secret).toMatch(/^forge_/);

    // Listing never reveals the secret.
    const list = await agent.get("/v1/tokens").expect(200);
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(list.body.tokens[0].prefix).toBe(secret.slice(0, 12));

    // Stored hashed.
    const row = await prisma.apiToken.findFirst();
    expect(row?.tokenHash).not.toBe(secret);

    // Bearer auth works and reaches org-scoped routes.
    const me = await request(app)
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${secret}`)
      .expect(200);
    expect(me.body.user.id).toBe(user.id);
    expect(me.body.authMethod).toBe("token");
    await request(app)
      .get(`/v1/orgs/${org.slug}/projects`)
      .set("Authorization", `Bearer ${secret}`)
      .expect(200);
  });

  it("rejects bad, revoked and expired tokens", async () => {
    const { agent } = await signup();
    await request(app).get("/v1/auth/me").set("Authorization", "Bearer forge_nope").expect(401);

    const created = await agent.post("/v1/tokens").send({ name: "t", expiresInDays: 1 });
    const { id, token } = created.body.token;

    await prisma.apiToken.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app).get("/v1/auth/me").set("Authorization", `Bearer ${token}`).expect(401);

    await agent.delete(`/v1/tokens/${id}`).expect(204);
    await agent.delete(`/v1/tokens/${id}`).expect(404);
  });

  it("a token cannot mint more tokens", async () => {
    const { agent } = await signup();
    const created = await agent.post("/v1/tokens").send({ name: "cli" }).expect(201);
    await request(app)
      .post("/v1/tokens")
      .set("Authorization", `Bearer ${created.body.token.token}`)
      .send({ name: "escalate" })
      .expect(403);
  });

  it("users cannot revoke each other's tokens", async () => {
    const a = await signup("A");
    const b = await signup("B");
    const created = await a.agent.post("/v1/tokens").send({ name: "cli" }).expect(201);
    await b.agent.delete(`/v1/tokens/${created.body.token.id}`).expect(404);
    expect(await prisma.apiToken.count()).toBe(1);
  });
});
