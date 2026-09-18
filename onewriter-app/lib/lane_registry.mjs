import { collisionKeyFromCanonical, requireCondition, requireExactKeys, validateCanonicalId } from "./core.mjs";

const REGISTRY_ENTRY_KEYS = ["lane_id", "org_id", "purpose_id", "opportunity_id"];

export function parseLaneRegistry(raw) {
  requireCondition(typeof raw === "string" && raw.length > 0, "server lane registry is not configured", 503);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("server lane registry configuration is invalid JSON"); }
  requireCondition(Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 4096, "server lane registry configuration is invalid", 503);
  const aliases = new Map();
  for (const entry of parsed) {
    requireExactKeys(entry, REGISTRY_ENTRY_KEYS, "lane registry entry");
    const laneId = validateCanonicalId(entry.lane_id, "lane_id");
    requireCondition(!aliases.has(laneId), `duplicate lane_id: ${laneId}`, 503);
    const canonical = Object.freeze({
      org_id: validateCanonicalId(entry.org_id, "org_id"),
      purpose_id: validateCanonicalId(entry.purpose_id, "purpose_id"),
      opportunity_id: validateCanonicalId(entry.opportunity_id, "opportunity_id"),
    });
    aliases.set(laneId, Object.freeze({ lane_id: laneId, canonical, collision_key: collisionKeyFromCanonical(canonical) }));
  }
  return Object.freeze({
    resolve(value) {
      const laneId = validateCanonicalId(value, "lane_id");
      const resolved = aliases.get(laneId);
      requireCondition(Boolean(resolved), `unknown lane_id: ${laneId}`, 409);
      return resolved;
    },
  });
}
