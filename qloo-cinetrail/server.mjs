import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_REQUEST_BYTES = 4096;
const MAX_QLOO_BYTES = 800_000;
const QLOO_BASE = process.env.QLOO_API_BASE || "https://hackathon.api.qloo.com";
// Local metadata cannot be provided by an upstream JSON response.
const QLOO_SOURCE_POSITION = Symbol("qlooSourcePosition");

export function cleanInput(value, label, max = 80) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max ||
      /[\u0000-\u001f]/.test(value)) throw new Error(label + " must be 1-" + max + " printable characters");
  return value.trim();
}

export function normalizeEntities(payload, kind) {
  const arr = Array.isArray(payload?.results?.entities) ? payload.results.entities
    : kind === "search" && Array.isArray(payload?.results) ? payload.results
    : kind === "search" && Array.isArray(payload?.entities) ? payload.entities : null;
  if (!Array.isArray(arr)) throw new Error("Qloo " + kind + " response missing entity list");
  return arr.flatMap((e, index) =>
    e && typeof e === "object" && typeof e.entity_id === "string" &&
    e.entity_id.length > 0 && typeof e.name === "string" && e.name.trim().length > 0
      ? [{ ...e, [QLOO_SOURCE_POSITION]: index + 1 }] : []);
}

export function buildPlan({ movie, locality, mood = "curious", seed, places, mode }) {
  const used = new Set();
  const stops = [];
  for (const place of places) {
    const id = place.entity_id;
    if (typeof id !== "string" || !id || used.has(id) || typeof place.name !== "string") continue;
    used.add(id);
    // Keep gaps in upstream order when records were removed or deduplicated.
    const sourcePosition = mode === "live" && Number.isSafeInteger(place[QLOO_SOURCE_POSITION])
      ? place[QLOO_SOURCE_POSITION] : stops.length + 1;
    const tags = Array.isArray(place.tags) ? place.tags
      .filter(t => typeof t?.name === "string").map(t => t.name).slice(0, 5) : [];
    const description = typeof place.properties?.description === "string"
      ? place.properties.description.slice(0, 250) : "";
    stops.push({
      qloo_entity_id: id,
      name: place.name.slice(0, 140),
      qloo_rank: sourcePosition,
      description,
      tags,
      address: typeof place.properties?.address === "string" ? place.properties.address : null,
      reasoning: "Qloo returned this place for the selected movie and locality; source result position #" +
        sourcePosition + " (not an affinity score). " +
        (tags.length ? "Qloo tags: " + tags.slice(0, 2).join(", ") + "." : "No descriptive tags reported."),
    });
    if (stops.length === 3) break;
  }
  return {
    product: "CineTrail",
    mode,
    locality,
    requested_movie: movie,
    resolved_movie: seed?.name || movie,
    resolved_movie_qloo_id: seed?.entity_id || null,
    mood,
    itinerary_type: "thematic suggestions, not mapped travel directions",
    stops,
    evidence: mode === "live"
      ? "Movie identity and place ordering derived from live Qloo API responses. Tags and descriptions are provider attributes."
      : "SYNTHETIC DEMO: invented movie and place examples; not Qloo results, real businesses, opening hours, or verified affinity.",
    limitations: ["No route, travel time, pricing, opening hours, or real-world availability verified",
      "Qloo place ordering is not a guaranteed movie-themed venue description"],
  };
}

async function safeResponseJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Qloo returned no response body");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_QLOO_BYTES) throw new Error("Qloo response exceeds safety limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Qloo returned non-JSON content"); }
}

export async function qlooGet(endpoint, params, { fetcher = fetch, key = process.env.QLOO_API_KEY, base = QLOO_BASE } = {}) {
  if (!key) throw new Error("QLOO_API_KEY is required for live mode");
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("QLOO_API_BASE must be an HTTPS origin");
  }
  const url = new URL(endpoint, origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const response = await fetcher(url, {
    headers: { "X-Api-Key": key, Accept: "application/json" },
    // Never follow a provider redirect with a server-side API credential.
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Qloo upstream returned HTTP " + response.status);
  const payload = await safeResponseJson(response);
  if (payload?.success === false) throw new Error("Qloo declined the request");
  return payload;
}

export async function producePlan(fields, { fetcher = fetch, key = process.env.QLOO_API_KEY,
  base = QLOO_BASE } = {}) {
  const movie = cleanInput(fields.movie, "Movie");
  const locality = cleanInput(fields.locality, "Locality");
  const mood = typeof fields.mood === "string" && ["curious", "cozy", "adventurous"].includes(fields.mood)
    ? fields.mood : "curious";
  if (!key) {
    const fixture = JSON.parse(await readFile(path.join(HERE, "fixtures", "synthetic.json"), "utf8"));
    return buildPlan({ movie, locality, mood, seed: fixture.movie, places: fixture.places, mode: "synthetic" });
  }
  const search = normalizeEntities(await qlooGet("/search", {
    query: movie, types: "urn:entity:movie", take: 8,
  }, { fetcher, key, base }), "search");
  const candidates = search.filter(e => !e.subtype || e.subtype === "urn:entity:movie");
  const seed = candidates.find(e => e.name.toLocaleLowerCase() === movie.toLocaleLowerCase());
  if (!seed) throw new Error("No exact-name movie match in Qloo. Try the full movie title.");
  const response = await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:place",
    "filter.location.query": locality,
    "signal.interests.entities": seed.entity_id,
    take: 12,
  }, { fetcher, key, base });
  const places = normalizeEntities(response, "insights");
  return buildPlan({ movie, locality, mood, seed, places, mode: "live" });
}

function respond(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

const quotas = new Map();
function admit(req) {
  const now = Date.now();
  const ip = req.socket.remoteAddress || "unknown";
  const entries = (quotas.get(ip) || []).filter(t => now - t < 60_000);
  if (entries.length >= 5) { quotas.set(ip, entries); return false; }
  entries.push(now); quotas.set(ip, entries);
  if (quotas.size > 1000) for (const [k, v] of quotas) {
    if (!v.some(t => now - t < 60_000)) quotas.delete(k);
  }
  return true;
}

export function createHandler(options = {}) {
  return async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        const html = await readFile(path.join(HERE, "public", "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; object-src 'none'",
          "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
        res.end(html); return;
      }
      if (req.method === "GET" && req.url === "/app.js") {
        const js = await readFile(path.join(HERE, "public", "app.js"));
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8",
          "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
        res.end(js); return;
      }
      if (req.method === "POST" && req.url === "/api/plan" &&
          !String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
        respond(res, 415, { error: "Content-Type must be application/json" }); return;
      }
      if (req.method === "GET" && req.url === "/api/status") {
        respond(res, 200, { service: "CineTrail", mode: (options.key ?? process.env.QLOO_API_KEY) ? "live" : "synthetic",
          disclaimer: "Public demo requires live Qloo key, HTTPS hosting, and validated real-world output" });
        return;
      }
      if (req.method !== "POST" || req.url !== "/api/plan") { respond(res, 404, { error: "Not found" }); return; }
      if (!admit(req)) { respond(res, 429, { error: "Too many plans. Try later." }); return; }
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_REQUEST_BYTES) { respond(res, 413, { error: "Request too large" }); return; }
        chunks.push(chunk);
      }
      let fields;
      try { fields = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { respond(res, 400, { error: "Invalid JSON" }); return; }
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        respond(res, 400, { error: "Object expected" }); return;
      }
      const result = await producePlan(fields, options);
      respond(res, 200, result);
    } catch (e) {
      const badInput = /printable characters|must be 1-|No exact-name/.test(e.message);
      respond(res, badInput ? 400 : 502, { error: e.message.replace(/QLOO_API_KEY.*/, "Live configuration unavailable") });
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = http.createServer(createHandler());
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () => {
    console.log("CineTrail listening at http://" + host + ":" + port +
      " [" + (process.env.QLOO_API_KEY ? "live" : "SYNTHETIC") + "]");
  });
}
