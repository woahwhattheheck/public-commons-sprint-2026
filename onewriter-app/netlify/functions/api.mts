import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";
import { createAuthenticator } from "../../lib/auth.mjs";
import { createHttpHandler } from "../../lib/http.mjs";
import { parseLaneRegistry } from "../../lib/lane-registry.mjs";
import { createService } from "../../lib/service.mjs";

let cachedSessionRegistry: string | null = null;
let cachedAuthenticator: ReturnType<typeof createAuthenticator> | null = null;
let cachedLaneRegistryRaw: string | null = null;
let cachedLaneRegistry: ReturnType<typeof parseLaneRegistry> | null = null;

function getAuthenticator() {
  const runtimeProcess = (globalThis as any).process;
  const raw = runtimeProcess?.env?.ONEWRITER_SESSIONS_JSON ?? "";
  if (raw !== cachedSessionRegistry || cachedAuthenticator === null) {
    cachedAuthenticator = createAuthenticator(raw);
    cachedSessionRegistry = raw;
  }
  return cachedAuthenticator;
}

function getLaneRegistry() {
  const runtimeProcess = (globalThis as any).process;
  const raw = runtimeProcess?.env?.ONEWRITER_LANES_JSON ?? "";
  if (raw !== cachedLaneRegistryRaw || cachedLaneRegistry === null) {
    cachedLaneRegistry = parseLaneRegistry(raw);
    cachedLaneRegistryRaw = raw;
  }
  return cachedLaneRegistry;
}

export default createHttpHandler({
  getAuthenticator,
  getService: () => createService(getDatabase(), { laneRegistry: getLaneRegistry() }),
});

export const config: Config = { path: "/api/*" };
