import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@forge/db";
import { addMember, resetDb, signup } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function orgWithMembers() {
  const owner = await signup("Owner");
  const admin = await signup("Admin");
  const dev = await signup("Dev");
  const viewer = await signup("Viewer");
  const slug = owner.org.slug;
  await addMember(owner.agent, slug, admin.email, "ADMIN");
  await addMember(owner.agent, slug, dev.email, "DEVELOPER");
  await addMember(owner.agent, slug, viewer.email, "VIEWER");
  return { owner, admin, dev, viewer, slug };
}

describe("role-based access control", () => {
  it("enforces role hierarchy on org update and delete", async () => {
    const { admin, dev, viewer, slug } = await orgWithMembers();

    await viewer.agent.patch(`/v1/orgs/${slug}`).send({ name: "x" }).expect(403);
    await dev.agent.patch(`/v1/orgs/${slug}`).send({ name: "x" }).expect(403);
    await admin.agent.patch(`/v1/orgs/${slug}`).send({ name: "x" }).expect(200);

    await admin.agent.delete(`/v1/orgs/${slug}`).expect(403);
  });

  it("enforces role hierarchy on projects", async () => {
    const { admin, dev, viewer, slug } = await orgWithMembers();

    await viewer.agent.post(`/v1/orgs/${slug}/projects`).send({ name: "p" }).expect(403);
    const created = await dev.agent
      .post(`/v1/orgs/${slug}/projects`)
      .send({ name: "p" })
      .expect(201);
    const pslug = created.body.project.slug;

    await viewer.agent.get(`/v1/orgs/${slug}/projects/${pslug}`).expect(200);
    await dev.agent.delete(`/v1/orgs/${slug}/projects/${pslug}`).expect(403);
    await admin.agent.delete(`/v1/orgs/${slug}/projects/${pslug}`).expect(204);
  });

  it("only admins and above can add members, and cannot grant above their own role", async () => {
    const { admin, dev, slug } = await orgWithMembers();
    const newcomer = await signup("New");

    await dev.agent
      .post(`/v1/orgs/${slug}/members`)
      .send({ email: newcomer.email, role: "VIEWER" })
      .expect(403);

    await admin.agent
      .post(`/v1/orgs/${slug}/members`)
      .send({ email: newcomer.email, role: "OWNER" })
      .expect(403);

    await admin.agent
      .post(`/v1/orgs/${slug}/members`)
      .send({ email: newcomer.email, role: "ADMIN" })
      .expect(201);
  });

  it("admins cannot modify or remove other admins or owners", async () => {
    const { owner, admin, slug } = await orgWithMembers();
    const admin2 = await signup("Admin2");
    await addMember(owner.agent, slug, admin2.email, "ADMIN");

    await admin.agent
      .patch(`/v1/orgs/${slug}/members/${admin2.user.id}`)
      .send({ role: "VIEWER" })
      .expect(403);
    await admin.agent.delete(`/v1/orgs/${slug}/members/${owner.user.id}`).expect(403);

    // Owner can.
    await owner.agent
      .patch(`/v1/orgs/${slug}/members/${admin2.user.id}`)
      .send({ role: "VIEWER" })
      .expect(200);
  });

  it("cannot change own role", async () => {
    const { owner, slug } = await orgWithMembers();
    const res = await owner.agent
      .patch(`/v1/orgs/${slug}/members/${owner.user.id}`)
      .send({ role: "VIEWER" })
      .expect(400);
    expect(res.body.error.code).toBe("SELF_ROLE_CHANGE");
  });

  it("protects the last owner", async () => {
    const { owner, admin, slug } = await orgWithMembers();

    // Owner can't leave while sole owner.
    const leave = await owner.agent.delete(`/v1/orgs/${slug}/members/${owner.user.id}`).expect(409);
    expect(leave.body.error.code).toBe("LAST_OWNER");

    // Promote admin to owner, then the original owner can step down.
    await owner.agent
      .patch(`/v1/orgs/${slug}/members/${admin.user.id}`)
      .send({ role: "OWNER" })
      .expect(200);
    await owner.agent.delete(`/v1/orgs/${slug}/members/${owner.user.id}`).expect(204);
    await owner.agent.get(`/v1/orgs/${slug}`).expect(404);
  });

  it("any member can leave", async () => {
    const { viewer, slug } = await orgWithMembers();
    await viewer.agent.delete(`/v1/orgs/${slug}/members/${viewer.user.id}`).expect(204);
    await viewer.agent.get(`/v1/orgs/${slug}`).expect(404);
  });

  it("isolates tenants: members of one org cannot touch another", async () => {
    const a = await signup("A");
    const b = await signup("B");

    await b.agent.get(`/v1/orgs/${a.org.slug}/projects`).expect(404);
    await b.agent.post(`/v1/orgs/${a.org.slug}/projects`).send({ name: "x" }).expect(404);
    await b.agent.get(`/v1/orgs/${a.org.slug}/members`).expect(404);
    await b.agent.get(`/v1/orgs/${a.org.slug}/audit`).expect(404);
  });
});
