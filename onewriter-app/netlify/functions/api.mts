import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";
import { createAuthenticator } from "../../lib/auth.mjs";
import { createHttpHandler } from "../../lib/http.mjs";
import { createService } from "../../lib/service.mjs";

let cachedRegistry: string | null = null;
let cachedAuthenticator: ReturnType<typeof createAuthenticator> | null = null;

function getAuthenticator() {
  const raw = process.env.ONEWRITER_SESSIONS_JSON ?? "";
  if (raw !== cachedRegistry || cachedAuthenticator === null) {
    cachedAuthenticator = createAuthenticator(raw);
    cachedRegistry = raw;
  }
  return cachedAuthenticator;
}

export default createHttpHandler({
  getAuthenticator,
  getService: () => createService(getDatabase()),
});

export const config: Config = { path: "/api/*" };
