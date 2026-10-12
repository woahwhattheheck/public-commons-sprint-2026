/** Industrial local operator for the same retained native vector requests. */
import http from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, lstat, realpath, rename, open, link, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolve, dirname, relative, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runVectorCommand, normalizeRequest, VectorOperationError } from "./index.mjs";
import { parseExactJSON, stringifyExactJSON, ExactNumber } from "./json.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 16 * 1024 * 1024;
const COMMANDS = new Set(["capabilities", "capture", "inspect", "export", "open", "receive",
  "compare", "open-comparison", "changes", "receive-comparison", "bundle", "receive-bundle"]);
const PATHS = ["directory", "sourceDirectory", "captureDirectory", "sourceRoot",
  "beforeDirectory", "afterDirectory", "selectionFile", "profileFile", "archivePath"];
const same = (a, b) => typeof a === "string" && typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const error = (code, detail, status = 400) => Object.assign(new VectorOperationError(code, detail), { status });
function stable(value) {
  if (value instanceof ExactNumber || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
async function atomic(path, value) {
  const temporary = path + "." + randomBytes(12).toString("hex") + ".receiving";
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(stringifyExactJSON(value) + "\n"); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
}
async function immutable(path, value) {
  const temporary = path + "." + randomBytes(12).toString("hex") + ".receiving";
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(stringifyExactJSON(value) + "\n");
    await file.sync(); await file.close();
    await link(temporary, path);
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await file.close().catch(() => {});
    await unlink(temporary).catch(exc => { if (exc.code !== "ENOENT") throw exc; });
  }
}
async function optional(path) {
  try { return parseExactJSON(await readFile(path, "utf8")); }
  catch (exc) { if (exc.code === "ENOENT") return null; throw exc; }
}
function reply(res, status, value, headers = {}) {
  const raw = Buffer.from(stringifyExactJSON(value));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8",
    "content-length": raw.length, "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(raw);
}
async function body(req) {
  if (String(req.headers["content-type"]).split(";")[0] !== "application/json")
    throw error("VECTOR_JSON_REQUIRED");
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw error("VECTOR_REQUEST_TOO_LARGE", MAX_BODY, 413);
    chunks.push(chunk);
  }
  return parseExactJSON(Buffer.concat(chunks).toString("utf8"));
}
async function bounded(root, value) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw error("VECTOR_PATH_REQUIRED");
  const target = resolve(root, value), rel = relative(root, target);
  if (rel === ".." || rel.startsWith(".." + sep)) throw error("VECTOR_PATH_OUTSIDE_OPERATOR_ROOT", value);
  let parent = target;
  for (;;) {
    try {
      const actual = await realpath(parent), r = relative(root, actual);
      if (r === ".." || r.startsWith(".." + sep)) throw error("VECTOR_SYMLINK_OUTSIDE_OPERATOR_ROOT", value);
      break;
    } catch (exc) {
      if (exc.code !== "ENOENT") throw exc;
      const next = dirname(parent); if (next === parent) throw exc; parent = next;
    }
  }
  return target;
}
export async function createVectorOperator(options = {}) {
  const root = await realpath(resolve(options.root || process.cwd()));
  const control = resolve(options.controlRoot || resolve(root, "vector-operations"));
  await mkdir(control, { recursive: true, mode: 0o700 });
  const python = options.python || process.env.STARFORGE_VECTOR_PYTHON || "python3";
  const active = new Map(), claims = new Map();
  const idPath = (id, suffix) => {
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id))
      throw error("VECTOR_REQUEST_ID_INVALID");
    return resolve(control, id + suffix);
  };
  function completedStatus(id, requestSha256, complete) {
    const result = complete.result;
    return { id, state: "SUCCEEDED", command: result.native?.request?.command,
      completedAt: result.native?.completedAt || new Date().toISOString(), requestSha256,
      summary: { directory: result.directory, path: result.path, manifestFile: result.manifestFile,
        counts: result.manifest?.counts || result.inspection?.counts || result.counts,
        replayed: result.replayed, file: result.file } };
  }
  async function saved(id) {
    const request = await optional(idPath(id, ".request.json"));
    if (!request) throw error("VECTOR_REQUEST_NOT_FOUND", id, 404);
    let status = await optional(idPath(id, ".status.json"));
    // A successful summary is published only after the complete result. Its
    // original request binding makes ordinary history/poll reads independent
    // of the (potentially large) retained native response.
    const summarized = status?.state === "SUCCEEDED" && status.id === id &&
      status.requestSha256 === request.requestSha256 &&
      status.command === request.request.command && typeof status.completedAt === "string" &&
      status.summary && typeof status.summary === "object" && !Array.isArray(status.summary);
    if (summarized) return { ...status, id, request: request.request,
      requestSha256: request.requestSha256, state: "SUCCEEDED" };
    const complete = await optional(idPath(id, ".result.json"));
    if (complete?.ok) {
      const reconciled = completedStatus(id, request.requestSha256, complete);
      if (status?.state !== "SUCCEEDED" || status.requestSha256 !== request.requestSha256) {
        try { await atomic(idPath(id, ".status.json"), reconciled); }
        catch (exc) { reconciled.summarySaved = false; reconciled.summaryError = exc.code || exc.message; }
      }
      status = reconciled;
    }
    return { ...status, id, request: request.request, requestSha256: request.requestSha256,
      state: complete?.ok ? "SUCCEEDED" : active.has(id) ? "RUNNING" :
        status?.state === "RUNNING" ? "INTERRUPTED" : status?.state || "RETAINED" };
  }
  async function run(input) {
    const id = input?.requestId; idPath(id, ".request.json");
    const previous = claims.get(id) || Promise.resolve();
    const claim = previous.catch(() => {}).then(() => runClaimed(input));
    claims.set(id, claim);
    claim.finally(() => { if (claims.get(id) === claim) claims.delete(id); }).catch(() => {});
    return claim;
  }
  async function runClaimed(input) {
    if (!input || typeof input !== "object") throw error("VECTOR_REQUEST_REQUIRED");
    const id = input.requestId; idPath(id, ".request.json");
    if (!input.request || !COMMANDS.has(input.request.command)) throw error("VECTOR_COMMAND_UNKNOWN");
    const request = { ...input.request };
    for (const key of PATHS) if (request[key] !== undefined) request[key] = await bounded(root, request[key]);
    const normalized = normalizeRequest(request);
    const canonical = stringifyExactJSON(stable(normalized));
    const requestSha256 = createHash("sha256").update(canonical).digest("hex");
    const envelope = { schema: "starforge.vector-operator-request.v1", id, requestSha256, request: normalized };
    try { await immutable(idPath(id, ".request.json"), envelope); }
    catch (exc) {
      if (exc.code !== "EEXIST") throw exc;
      const original = await optional(idPath(id, ".request.json"));
      if (original.requestSha256 !== requestSha256 || stringifyExactJSON(stable(original.request)) !== canonical)
        throw error("VECTOR_ORIGINAL_REQUEST_CONFLICT", { id, originalSha256: original.requestSha256 }, 409);
    }
    const retained = await saved(id);
    if (active.has(id) || retained.state === "SUCCEEDED") return retained;
    const task = (async () => {
      await atomic(idPath(id, ".status.json"), { id, state: "RUNNING", command: normalized.command,
        startedAt: new Date().toISOString(), requestSha256 });
      let complete;
      try {
        const result = await runVectorCommand(normalized, { python, logDirectory: resolve(control, "native") });
        complete = { ok: true, result };
      } catch (exc) {
        complete = { ok: false, error: { code: exc.code || exc.name, detail: exc.detail || exc.message }, native: exc.native };
      }
      // The committed result is authoritative even if the later summary cannot be written.
      await atomic(idPath(id, ".result.json"), complete);
      await atomic(idPath(id, ".status.json"), complete.ok ? completedStatus(id, requestSha256, complete) :
        { id, state: "FAILED", command: normalized.command, completedAt: new Date().toISOString(),
          requestSha256, error: complete.error });

    })();
    active.set(id, task);
    task.finally(() => active.delete(id)).catch(() => {});
    return { id, state: "RUNNING", request: normalized, requestSha256 };
  }
  async function history() {
    const names = (await readdir(control)).filter(name => name.endsWith(".request.json"));
    const values = [];
    // Recovery may have to open full original results. Keep that work bounded
    // while each valid completed summary remains a small independent read.
    for (let at = 0; at < names.length; at += 4) {
      values.push(...await Promise.all(names.slice(at, at + 4)
        .map(name => saved(name.slice(0, -".request.json".length)))));
    }
    return values.sort((a, b) => String(b.startedAt || b.completedAt || "").localeCompare(String(a.startedAt || a.completedAt || "")));
  }
  async function result(id) {
    await saved(id);
    const value = await optional(idPath(id, ".result.json"));
    if (!value) throw error("VECTOR_RESULT_PENDING", id, 409);
    return value;
  }
  async function list(path = ".") {
    const target = await bounded(root, path), entries = [];
    for (const entry of await readdir(target, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const full = resolve(target, entry.name), info = await lstat(full);
      if (!info.isDirectory() && !info.isFile()) continue;
      entries.push({ name: entry.name, path: relative(root, full) || ".",
        kind: info.isDirectory() ? "directory" : "file", bytes: info.isFile() ? info.size : null });
    }
    entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    return { path: relative(root, target) || ".", entries };
  }
  return { root, control, python, run, saved, result, history, list,
    bounded: path => bounded(root, path), idle: () => Promise.allSettled([...active.values()]) };
}
export async function startVectorServer(options = {}) {
  const operator = options.operator || await createVectorOperator(options);
  const token = randomBytes(32).toString("base64url"), host = options.host || "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(host)) throw error("VECTOR_LOCAL_BIND_REQUIRED");
  const port = options.port ?? 0;
  let origin;
  const staticFiles = { "/vector/": ["public/index.html", "text/html"],
    "/vector/app.js": ["public/app.js", "text/javascript"],
    "/vector/style.css": ["public/style.css", "text/css"], "/vector/json.mjs": ["json.mjs", "text/javascript"] };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) throw error("VECTOR_HOST_MISMATCH", undefined, 403);
      const url = new URL(req.url, origin);
      if (req.headers.origin && req.headers.origin !== origin) throw error("VECTOR_ORIGIN_MISMATCH", undefined, 403);
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(302, { location: "/vector/" }); res.end(); return;
      }
      if (req.method === "GET" && staticFiles[url.pathname]) {
        const [file, mime] = staticFiles[url.pathname], raw = await readFile(resolve(HERE, file));
        res.writeHead(200, { "content-type": mime + "; charset=utf-8", "content-length": raw.length,
          "cache-control": "no-store", "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
        res.end(raw); return;
      }
      const cookieName = "vector_session_" + new URL(origin).port;
      const cookies = Object.fromEntries(String(req.headers.cookie || "").split(";").map(item => item.trim()).filter(Boolean)
        .map(item => { const at = item.indexOf("="); return [item.slice(0, at), item.slice(at + 1)]; }));
      const supplied = String(req.headers.authorization || (cookies[cookieName] ? "Bearer " + cookies[cookieName] : "")).replace(/^Bearer /, "");
      if (!same(supplied, token)) throw error("VECTOR_SESSION_REQUIRED", undefined, 401);
      if (req.method === "GET" && url.pathname === "/api/state") {
        reply(res, 200, { root: operator.root, python: operator.python, operations: await operator.history() },
          { "set-cookie": cookieName + "=" + token + "; HttpOnly; SameSite=Strict; Path=/api" }); return;
      }
      if (req.method === "GET" && url.pathname === "/api/files") {
        reply(res, 200, await operator.list(url.searchParams.get("path") || ".")); return;
      }
      if (req.method === "POST" && url.pathname === "/api/run") {
        reply(res, 202, await operator.run(await body(req))); return;
      }
      const match = /^\/api\/operations\/([A-Za-z0-9._-]+)(?:\/(result))?$/.exec(url.pathname);
      if (req.method === "GET" && match) {
        reply(res, 200, match[2] ? await operator.result(match[1]) : await operator.saved(match[1])); return;
      }
      if (req.method === "GET" && url.pathname === "/api/document") {
        const path = await operator.bounded(url.searchParams.get("path")), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BODY) throw error("VECTOR_DOCUMENT_UNAVAILABLE");
        const raw = await readFile(path);
        if (raw.length > MAX_BODY) throw error("VECTOR_DOCUMENT_TOO_LARGE");
        parseExactJSON(raw.toString("utf8"));
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": raw.length,
          "cache-control": "no-store" }); res.end(raw); return;
      }
      if (req.method === "GET" && url.pathname === "/api/download") {
        const path = await operator.bounded(url.searchParams.get("path")), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw error("VECTOR_DOWNLOAD_FILE_REQUIRED");
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": info.size,
          "content-disposition": 'attachment; filename="' + basename(path).replace(/["\\\x00-\x1f]/g, "_") + '"',
          "cache-control": "no-store", "x-content-type-options": "nosniff" });
        await pipeline(createReadStream(path), res); return;
      }
      throw error("VECTOR_ROUTE_NOT_FOUND", undefined, 404);
    } catch (exc) {
      if (res.headersSent) { res.destroy(exc); return; }
      reply(res, exc.status || 400, { ok: false, error: { code: exc.code || exc.name, detail: exc.detail || exc.message } });
    }
  });
  await new Promise((yes, no) => { server.once("error", no); server.listen(port, host, yes); });
  const actual = server.address();
  origin = "http://" + (host.includes(":") ? "[" + host + "]" : host) + ":" + actual.port;
  return { url: origin + "/vector/#session=" + token, origin, operator,
    close: async () => { await operator.idle(); await new Promise((yes, no) => server.close(exc => exc ? no(exc) : yes())); } };
}
