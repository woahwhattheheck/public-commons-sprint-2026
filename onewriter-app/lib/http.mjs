import { AUTHORITY, ContractError, requireCondition } from "./core.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function rejectDuplicateTopLevelKeys(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  const seen = new Set();
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch !== '"') continue;
      inString = false;
      if (depth !== 1 || start < 0) continue;
      let j = i + 1;
      while (j < text.length && /\s/u.test(text[j])) j += 1;
      if (text[j] !== ":") continue;
      const key = JSON.parse(text.slice(start, i + 1));
      requireCondition(!seen.has(key), `duplicate JSON key: ${key}`);
      seen.add(key);
      continue;
    }
    if (ch === '"') { inString = true; start = i; continue; }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
}

async function parseBody(req) {
  const text = await req.text();
  requireCondition(text.length > 0 && text.length <= 32768, "request body must be 1..32768 UTF-8 characters");
  rejectDuplicateTopLevelKeys(text);
  let value;
  try { value = JSON.parse(text); } catch { throw new ContractError("request body must be valid JSON"); }
  requireCondition(value && typeof value === "object" && !Array.isArray(value), "request body must be a JSON object");
  return value;
}

export function createHttpHandler({ getService, getAuthenticator }) {
  requireCondition(typeof getService === "function" && typeof getAuthenticator === "function", "HTTP handler dependencies invalid", 500);
  return async function handle(req) {
    try {
      const path = new URL(req.url).pathname;
      const supported =
        (req.method === "GET" && path === "/api/state") ||
        (req.method === "POST" && (path === "/api/claim" || path === "/api/event"));
      if (!supported) return json({ error: "not found", authority: AUTHORITY }, 404);

      // Authentication intentionally happens before service/database construction
      // and before request-body parsing. Untrusted callers cannot read operational
      // state or drive any lane/evidence transition.
      const principal = getAuthenticator().authenticate(req.headers.get("authorization"));
      const service = getService();
      if (req.method === "GET") return json(await service.snapshot(principal));
      if (path === "/api/claim") return json(await service.claim(await parseBody(req), principal), 201);
      return json(await service.record(await parseBody(req), principal), 201);
    } catch (error) {
      if (error instanceof ContractError) {
        const headers = error.status === 401 ? { "www-authenticate": "Bearer realm=OneWriter" } : {};
        return json({ error: error.message, authority: AUTHORITY }, error.status ?? 400, headers);
      }
      console.error(error);
      return json({ error: "internal error", authority: AUTHORITY }, 500);
    }
  };
}
