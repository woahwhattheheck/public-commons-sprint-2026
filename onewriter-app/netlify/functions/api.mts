import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";
import { AUTHORITY, ContractError, requireCondition } from "../../lib/core.mjs";
import { createService } from "../../lib/service.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function rejectDuplicateTopLevelKeys(text: string) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  const seen = new Set<string>();
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

async function parseBody(req: Request) {
  const text = await req.text();
  requireCondition(text.length > 0 && text.length <= 32768, "request body must be 1..32768 UTF-8 characters");
  rejectDuplicateTopLevelKeys(text);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ContractError("request body must be valid JSON"); }
  requireCondition(value && typeof value === "object" && !Array.isArray(value), "request body must be a JSON object");
  return value as Record<string, unknown>;
}

export default async (req: Request) => {
  try {
    const service = createService(getDatabase());
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/api/state") return json(await service.snapshot());
    if (req.method === "POST" && path === "/api/claim") return json(await service.claim(await parseBody(req)), 201);
    if (req.method === "POST" && path === "/api/event") {
      const result: any = await service.record(await parseBody(req));
      if (result.conflict) return json(result, result.status);
      return json(result, 201);
    }
    return json({ error: "not found", authority: AUTHORITY }, 404);
  } catch (error: any) {
    if (error instanceof ContractError) return json({ error: error.message, authority: AUTHORITY }, error.status ?? 400);
    console.error(error);
    return json({ error: "internal error", authority: AUTHORITY }, 500);
  }
};

export const config: Config = { path: "/api/*" };
