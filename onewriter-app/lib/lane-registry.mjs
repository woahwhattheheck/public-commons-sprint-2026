import { ContractError, validateLaneId } from "./core.mjs";

const MAX_REGISTRY_BYTES = 262144;
const MAX_LANES = 4096;

function configError(message) {
  return new ContractError(message, 503);
}

export function parseLaneRegistry(raw) {
  if (typeof raw !== "string" || raw.length === 0 || Buffer.byteLength(raw, "utf8") > MAX_REGISTRY_BYTES) {
    throw configError("server lane registry is not configured or exceeds its byte bound");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configError("server lane registry configuration is invalid");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_LANES) {
    throw configError("server lane registry configuration is invalid");
  }

  const ids = [];
  const seen = new Set();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw configError("server lane registry configuration is invalid");
    }
    if (Object.keys(entry).sort().join(",") !== "lane_id") {
      throw configError("server lane registry configuration is invalid");
    }
    let laneId;
    try {
      laneId = validateLaneId(entry.lane_id);
    } catch {
      throw configError("server lane registry contains an invalid lane_id");
    }
    if (seen.has(laneId)) throw configError("server lane registry contains a duplicate lane_id");
    seen.add(laneId);
    ids.push(laneId);
  }

  const retained = Object.freeze([...ids]);
  const membership = new Set(retained);
  return Object.freeze({
    requireKnown(laneId) {
      const canonical = validateLaneId(laneId);
      if (!membership.has(canonical)) {
        throw new ContractError("unknown lane_id; server registry binding required", 403);
      }
      return canonical;
    },
    list() {
      return [...retained];
    },
  });
}
