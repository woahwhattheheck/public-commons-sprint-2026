import { createHash, timingSafeEqual } from "node:crypto";
import { ContractError, requireCondition, validateActor } from "./core.mjs";

export const ROLES = Object.freeze([
  "state",
  "claim",
  "hold",
  "provider_evidence",
  "human_evidence",
]);
const ROLE_SET = new Set(ROLES);
const TOKEN_RE = /^[\x21-\x7e]{16,1024}$/u;
const DIGEST_RE = /^[0-9a-f]{64}$/u;

function digestToken(token) {
  return createHash("sha256").update(token, "utf8").digest();
}

function parseDigest(hex) {
  requireCondition(typeof hex === "string" && DIGEST_RE.test(hex), "session token_sha256 must be 64 lowercase hex", 503);
  return Buffer.from(hex, "hex");
}

export function parseSessionRegistry(raw) {
  requireCondition(typeof raw === "string" && raw.length > 0, "server authentication is not configured", 503);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContractError("server authentication configuration is invalid", 503);
  }
  requireCondition(Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 128, "server authentication configuration is invalid", 503);
  const digests = new Set();
  return parsed.map((entry) => {
    requireCondition(entry && typeof entry === "object" && !Array.isArray(entry), "server authentication configuration is invalid", 503);
    requireCondition(Object.keys(entry).sort().join(",") === "roles,subject,token_sha256", "server authentication configuration is invalid", 503);
    const digest = parseDigest(entry.token_sha256);
    requireCondition(!digests.has(entry.token_sha256), "duplicate session token digest", 503);
    digests.add(entry.token_sha256);
    const subject = validateActor(entry.subject);
    requireCondition(Array.isArray(entry.roles) && entry.roles.length >= 1 && entry.roles.length <= ROLES.length, "session roles invalid", 503);
    const roles = [...new Set(entry.roles)];
    requireCondition(roles.length === entry.roles.length && roles.every((role) => typeof role === "string" && ROLE_SET.has(role)), "session roles invalid", 503);
    return Object.freeze({ digest, subject, roles: Object.freeze(roles) });
  });
}

export function createAuthenticator(rawRegistry) {
  const sessions = parseSessionRegistry(rawRegistry);
  return Object.freeze({
    authenticate(authorizationHeader) {
      requireCondition(typeof authorizationHeader === "string" && authorizationHeader.startsWith("Bearer "), "authentication required", 401);
      const token = authorizationHeader.slice(7);
      requireCondition(TOKEN_RE.test(token), "authentication required", 401);
      const presented = digestToken(token);
      let match = null;
      for (const session of sessions) {
        const equal = session.digest.length === presented.length && timingSafeEqual(session.digest, presented);
        if (equal) match = session;
      }
      requireCondition(Boolean(match), "authentication required", 401);
      return Object.freeze({ subject: match.subject, roles: match.roles });
    },
  });
}

export function requireRole(principal, role) {
  requireCondition(principal && typeof principal === "object" && typeof principal.subject === "string" && Array.isArray(principal.roles), "authenticated principal required", 401);
  requireCondition(ROLE_SET.has(role), "unknown authorization role", 500);
  requireCondition(principal.roles.includes(role), `role ${role} required`, 403);
  return principal;
}
