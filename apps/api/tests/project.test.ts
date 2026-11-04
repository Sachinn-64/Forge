import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@forge/db";
import { resetDb, signup } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("projects", () => {
  it("creates with defaults and auto slug", async () => {
    const { agent, org } = await signup();
    const res = await agent
      .post(`/v1/orgs/${org.slug}/projects`)
      .send({ name: "My API Service" })
      .expect(201);
    expect(res.body.project).toMatchObject({
      slug: "my-api-service",
      defaultBranch: "main",
      rootDirectory: "/",
      organizationId: org.id,
    });
  });

  it("slugs are unique per org, not globally", async () => {
    const a = await signup("A");
    const b = await signup("B");
    const pa = await a.agent.post(`/v1/orgs/${a.org.slug}/projects`).send({ name: "web" });
    const pb = await b.agent.post(`/v1/orgs/${b.org.slug}/projects`).send({ name: "web" });
    expect(pa.body.project.slug).toBe("web");
    expect(pb.body.project.slug).toBe("web");

    const dup = await a.agent.post(`/v1/orgs/${a.org.slug}/projects`).send({ name: "web" });
    expect(dup.body.project.slug).toMatch(/^web-[a-z0-9]{4}$/);
  });

  it("lists, updates, deletes", async () => {
    const { agent, org } = await signup();
    await agent.post(`/v1/orgs/${org.slug}/projects`).send({ name: "one" }).expect(201);
    await agent.post(`/v1/orgs/${org.slug}/projects`).send({ name: "two" }).expect(201);

    const list = await agent.get(`/v1/orgs/${org.slug}/projects`).expect(200);
    expect(list.body.projects).toHaveLength(2);

    const upd = await agent
      .patch(`/v1/orgs/${org.slug}/projects/one`)
      .send({ defaultBranch: "develop", rootDirectory: "/apps/api" })
      .expect(200);
    expect(upd.body.project.defaultBranch).toBe("develop");
    expect(upd.body.project.rootDirectory).toBe("/apps/api");

    await agent.delete(`/v1/orgs/${org.slug}/projects/one`).expect(204);
    await agent.get(`/v1/orgs/${org.slug}/projects/one`).expect(404);
  });

  it("rejects path traversal in rootDirectory", async () => {
    const { agent, org } = await signup();
    await agent
      .post(`/v1/orgs/${org.slug}/projects`)
      .send({ name: "bad", rootDirectory: "/../etc" })
      .expect(400);
    await agent
      .post(`/v1/orgs/${org.slug}/projects`)
      .send({ name: "bad", rootDirectory: "relative" })
      .expect(400);
  });

  it("cascades on org delete", async () => {
    const { agent, org } = await signup();
    await agent.post(`/v1/orgs/${org.slug}/projects`).send({ name: "p" }).expect(201);
    await agent.delete(`/v1/orgs/${org.slug}`).expect(204);
    expect(await prisma.project.count()).toBe(0);
  });
});
