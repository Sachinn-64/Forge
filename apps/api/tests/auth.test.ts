import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "@forge/db";
import { app, resetDb, signup, uniqueEmail } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("auth", () => {
  it("registers, sets a cookie, and creates a personal org", async () => {
    const { agent, user, org } = await signup("Ada Lovelace");
    expect(user.email).toMatch(/@test\.forge$/);
    expect(org.slug).toBe("ada-lovelace");

    const me = await agent.get("/v1/auth/me").expect(200);
    expect(me.body.user.id).toBe(user.id);
    expect(me.body.authMethod).toBe("session");

    const membership = await prisma.membership.findFirst({ where: { userId: user.id } });
    expect(membership?.role).toBe("OWNER");
  });

  it("never returns the password hash", async () => {
    const { agent } = await signup();
    const me = await agent.get("/v1/auth/me").expect(200);
    expect(JSON.stringify(me.body)).not.toContain("passwordHash");
    expect(JSON.stringify(me.body)).not.toContain("argon2");
  });

  it("rejects duplicate emails with 409", async () => {
    const { email } = await signup();
    const res = await request(app)
      .post("/v1/auth/register")
      .send({ email: email.toUpperCase(), password: "password123" })
      .expect(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("validates input", async () => {
    const res = await request(app)
      .post("/v1/auth/register")
      .send({ email: "not-an-email", password: "short" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.issues.fieldErrors).toHaveProperty("email");
    expect(res.body.error.issues.fieldErrors).toHaveProperty("password");
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const { email } = await signup();
    await request(app)
      .post("/v1/auth/login")
      .send({ email, password: "wrong-password" })
      .expect(401);
    await request(app)
      .post("/v1/auth/login")
      .send({ email: uniqueEmail("ghost"), password: "password123" })
      .expect(401);

    const agent = request.agent(app);
    await agent.post("/v1/auth/login").send({ email, password: "password123" }).expect(204);
    await agent.get("/v1/auth/me").expect(200);
  });

  it("logout invalidates the session server-side", async () => {
    const { agent, user } = await signup();
    await agent.post("/v1/auth/logout").expect(204);
    await agent.get("/v1/auth/me").expect(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rejects expired sessions", async () => {
    const { agent, user } = await signup();
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await agent.get("/v1/auth/me").expect(401);
    expect(res.body.error.message).toBe("Session expired");
  });

  it("requires auth", async () => {
    await request(app).get("/v1/auth/me").expect(401);
    await request(app).get("/v1/orgs").expect(401);
  });
});
