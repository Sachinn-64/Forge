import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/org";
import * as orgs from "../services/org.service";
import { listAudit } from "../services/audit.service";
import memberRoutes from "./member.routes";
import projectRoutes from "./project.routes";

const router = Router();
router.use(requireAuth);

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });
const updateSchema = z.object({ name: z.string().trim().min(1).max(80).optional() });
const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

router.get("/", async (req, res) => {
  res.json({ orgs: await orgs.listOrgsForUser(req.user!.id) });
});

router.post("/", async (req, res) => {
  const body = createSchema.parse(req.body);
  const org = await orgs.createOrg({ name: body.name, ownerId: req.user!.id, ip: req.ip });
  res.status(201).json({ org });
});

router.get("/:orgSlug", requireRole("VIEWER"), (req, res) => {
  const { id, name, slug, createdAt, updatedAt } = req.org!;
  res.json({ org: { id, name, slug, createdAt, updatedAt, role: req.membership!.role } });
});

router.patch("/:orgSlug", requireRole("ADMIN"), async (req, res) => {
  const body = updateSchema.parse(req.body);
  const org = await orgs.updateOrg(req.org!.id, body, { userId: req.user!.id, ip: req.ip });
  res.json({ org });
});

router.delete("/:orgSlug", requireRole("OWNER"), async (req, res) => {
  await orgs.deleteOrg(req.org!.id, { userId: req.user!.id, ip: req.ip });
  res.status(204).end();
});

router.get("/:orgSlug/audit", requireRole("ADMIN"), async (req, res) => {
  const q = auditQuery.parse(req.query);
  res.json({ entries: await listAudit(req.org!.id, q.limit, q.before) });
});

router.use("/:orgSlug/members", memberRoutes);
router.use("/:orgSlug/projects", projectRoutes);

export default router;
