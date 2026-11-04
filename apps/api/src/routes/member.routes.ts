import { Router, type Request } from "express";
import { z } from "zod";
import { Role } from "@forge/db";
import { requireRole } from "../middleware/org";
import * as members from "../services/member.service";

const router = Router({ mergeParams: true });

const roleSchema = z.nativeEnum(Role);
const addSchema = z.object({ email: z.string().email(), role: roleSchema.default("DEVELOPER") });
const roleBody = z.object({ role: roleSchema });
const userIdParam = z.string().uuid();

function actor(req: Request) {
  return { userId: req.user!.id, role: req.membership!.role, ip: req.ip };
}

router.get("/", requireRole("VIEWER"), async (req, res) => {
  res.json({ members: await members.listMembers(req.org!.id) });
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const body = addSchema.parse(req.body);
  const member = await members.addMember(req.org!.id, body, actor(req));
  res.status(201).json({ member });
});

router.patch("/:userId", requireRole("ADMIN"), async (req, res) => {
  const userId = userIdParam.parse(req.params.userId);
  const { role } = roleBody.parse(req.body);
  const member = await members.changeRole(req.org!.id, userId, role, actor(req));
  res.json({ member });
});

// Any member may remove themselves; removing others needs ADMIN (checked in the service).
router.delete("/:userId", requireRole("VIEWER"), async (req, res) => {
  const userId = userIdParam.parse(req.params.userId);
  await members.removeMember(req.org!.id, userId, actor(req));
  res.status(204).end();
});

export default router;
