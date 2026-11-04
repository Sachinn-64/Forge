import { randomToken, sha256 } from "./tokens";

export const SESSION_COOKIE = "forge_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateSessionToken() {
  return randomToken(32);
}

export function hashSessionToken(token: string) {
  return sha256(token);
}
