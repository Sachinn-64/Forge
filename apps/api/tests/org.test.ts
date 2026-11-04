import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@forge/db";
import { resetDb, signup } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("organizations", () => {
  it("creates an org with an auto slug and makes the creator OWNER", async () => {
    const { agent } = await signup();
    const res = await agent.post("/v1/orgs").send({ name: "Acme Corp!" }).expect(201);
    expect(res.body.org.slug).toBe("acme-corp");

    const get = await agent.get("/v1/orgs/acme-corp").expect(200);
    expect(get.body.org.role).toBe("OWNER");
  });

  it("de-duplicates slugs with a suffix", async () => {
    const { agent } = await signup();
    await agent.post("/v1/orgs").send({ name: "Acme" }).expect(201);
    const second = await agent.post("/v1/orgs").send({ name: "Acme" }).expect(201);
    expect(second.body.org.slug).toMatch(/^acme-[a-z0-9]{4}$/);
  });

  it("lists only orgs the user belongs to", async () => {
    const a = await signup("A");
    const b = await signup("B");
    await a.agent.post("/v1/orgs").send({ name: "A Second" }).expect(201);

    const list = await a.agent.get("/v1/orgs").expect(200);
    const slugs = list.body.orgs.map((o: { slug: string }) => o.slug).sort();
    expect(slugs).toEqual(["a", "a-second"]);
    expect(slugs).not.toContain(b.org.slug);
  });

  it("returns 404 for orgs the user is not a member of (no enumeration)", async () => {
    const a = await signup("A");
    const b = await signup("B");
    await a.agent.get(`/v1/orgs/${b.org.slug}`).expect(404);
    await a.agent.get("/v1/orgs/does-not-exist").expect(404);
  });

  it("updates and deletes with the right roles", async () => {
    const { agent, org } = await signup();
    const upd = await agent.patch(`/v1/orgs/${org.slug}`).send({ name: "Renamed" }).expect(200);
    expect(upd.body.org.name).toBe("Renamed");

    await agent.delete(`/v1/orgs/${org.slug}`).expect(204);
    await agent.get(`/v1/orgs/${org.slug}`).expect(404);
    expect(await prisma.organization.count()).toBe(0);
  });

  it("writes audit entries", async () => {
    const { agent, org } = await signup();
    await agent.patch(`/v1/orgs/${org.slug}`).send({ name: "Renamed" }).expect(200);

    const res = await agent.get(`/v1/orgs/${org.slug}/audit`).expect(200);
    const actions = res.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(["org.update", "org.create"]);
    expect(res.body.entries[0].actor.email).toBeDefined();
  });
});
