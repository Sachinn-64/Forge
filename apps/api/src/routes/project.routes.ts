import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/org";
import * as projects from "../services/project.service";

const router = Router({ mergeParams: true });

const branch = z.string().trim().min(1).max(200);
const rootDir = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => v.startsWith("/") && !v.includes(".."), "rootDirectory must be absolute");

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  defaultBranch: branch.optional(),
  rootDirectory: rootDir.optional(),
});
const updateSchema = createSchema.partial();

router.get("/", requireRole("VIEWER"), async (req, res) => {
  res.json({ projects: await projects.listProjects(req.org!.id) });
});

router.post("/", requireRole("DEVELOPER"), async (req, res) => {
  const body = createSchema.parse(req.body);
  const project = await projects.createProject(req.org!.id, body, {
    userId: req.user!.id,
    ip: req.ip,
  });
  res.status(201).json({ project });
});

router.get("/:projectSlug", requireRole("VIEWER"), async (req, res) => {
  const project = await projects.getProject(req.org!.id, req.params.projectSlug as string);
  res.json({ project });
});

router.patch("/:projectSlug", requireRole("DEVELOPER"), async (req, res) => {
  const body = updateSchema.parse(req.body);
  const project = await projects.updateProject(
    req.org!.id,
    req.params.projectSlug as string,
    body,
    { userId: req.user!.id, ip: req.ip },
  );
  res.json({ project });
});

router.delete("/:projectSlug", requireRole("ADMIN"), async (req, res) => {
  await projects.deleteProject(req.org!.id, req.params.projectSlug as string, {
    userId: req.user!.id,
    ip: req.ip,
  });
  res.status(204).end();
});

export default router;
