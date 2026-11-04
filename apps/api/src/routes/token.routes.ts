import { Router } from "express";
import { z } from "zod";
import { AppError } from "@forge/shared";
import { requireAuth } from "../middleware/auth";
import * as tokens from "../services/token.service";

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

router.get("/", async (req, res) => {
  res.json({ tokens: await tokens.listTokens(req.user!.id) });
});

router.post("/", async (req, res) => {
  // Tokens can only be minted from a browser session, never from another token.
  if (req.authMethod !== "session") throw AppError.forbidden("Use a session to create tokens");
  const body = createSchema.parse(req.body);
  const token = await tokens.createToken(req.user!.id, body, req.ip);
  res.status(201).json({ token });
});

router.delete("/:tokenId", async (req, res) => {
  const tokenId = z.string().uuid().parse(req.params.tokenId);
  await tokens.revokeToken(req.user!.id, tokenId, req.ip);
  res.status(204).end();
});

export default router;
