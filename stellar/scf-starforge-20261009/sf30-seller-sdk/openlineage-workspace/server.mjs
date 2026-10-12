import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { readBrowserAssets } from "./browser-assets-loader.mjs";
import { LineageWorkspace, WorkspaceError } from "./store.mjs";
import { sha256 } from "./model.mjs";
import { handleRpc } from "./protocol.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

function equal(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
async function body(request, maximum) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximum) throw new WorkspaceError("Request exceeds the configured " + maximum + "-byte intake limit", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length, "Cache-Control": "no-store" });
  response.end(bytes);
}
function attachment(response, data, mediaType, name, status = 200, headers = {}) {
  response.writeHead(status, { "Content-Type": mediaType, "Content-Length": data.length, "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(name), "Cache-Control": "no-store", ...headers });
  response.end(data);
}
export async function startServer({ directory, title, host = "127.0.0.1", port = 8767, token = null, maxBodyBytes = 64 * 1024 * 1024, expectedWorkspaceId = null } = {}) {
  if (!LOOPBACK.has(host) && (!token || token.length < 24)) throw new WorkspaceError("A token of at least 24 characters is required when serving beyond this computer");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new WorkspaceError("Invalid port");
  const workspace = new LineageWorkspace(directory);
  if (expectedWorkspaceId && (await workspace.read()).workspaceId !== expectedWorkspaceId) throw new WorkspaceError("Selected workspace identity changed", 409);
  const initial = await workspace.initialize(title);
  const instanceId = randomUUID(), startedAt = new Date().toISOString();
  const staticAssets = await readBrowserAssets(new URL("./browser-assets.json", import.meta.url));
  let expectedOrigin;
  const identity = () => ({ schema: "commons.openlineage.startup.v1", workspaceId: initial.workspaceId, workspaceCreatedAt: initial.createdAt, instanceId, startedAt, pid: process.pid, url: expectedOrigin, workspace: workspace.directory });
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const requestUrl = new URL(request.url, expectedOrigin);
      if (request.headers.host !== new URL(expectedOrigin).host) throw new WorkspaceError("Unrecognized workspace host", 403);
      if (request.headers.origin && request.headers.origin !== expectedOrigin) throw new WorkspaceError("Use this workspace's own origin", 403);
      if (request.method === "GET" && staticAssets.has(requestUrl.pathname)) {
        const { url, type } = staticAssets.get(requestUrl.pathname), data = await fs.readFile(url);
        response.writeHead(200, { "Content-Type": type, "Content-Length": data.length, "Cache-Control": "no-store" }); response.end(data); return;
      }
      if (token && !equal(String(request.headers.authorization ?? ""), "Bearer " + token)) throw new WorkspaceError("Workspace access token required", 401);
      if (request.headers["x-openlineage-workspace"] && request.headers["x-openlineage-workspace"] !== initial.workspaceId) throw new WorkspaceError("Connected workspace identity changed", 409);
      if (request.headers["x-openlineage-instance"] && request.headers["x-openlineage-instance"] !== instanceId) throw new WorkspaceError("Connected application instance changed", 409);
      if (request.method === "GET" && requestUrl.pathname === "/api/identity") { json(response, 200, identity()); return; }
      if (request.method === "GET" && requestUrl.pathname === "/api/workspace") {
        json(response, 200, await workspace.view({ edition: requestUrl.searchParams.get("edition") || null })); return;
      }
      if (request.method === "POST" && ["/api/v1/lineage", "/api/sources"].includes(requestUrl.pathname)) {
        const bytes = await body(request, maxBodyBytes);
        const state = await workspace.read();
        const name = requestUrl.searchParams.get("name") || (requestUrl.pathname.endsWith("lineage") ? "http-event.json" : "events.json");
        const operationId = request.headers["idempotency-key"] ?? "intake-" + sha256(bytes);
        const revision = request.headers["if-match"] === undefined ? state.revision : Number(String(request.headers["if-match"]).replaceAll('"', ""));
        const result = await workspace.importSource({ bytes, name, sourceUrl: requestUrl.searchParams.get("source") ?? "", operationId: String(operationId), expectedRevision: revision });
        json(response, 200, result); return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/action") {
        const payload = JSON.parse((await body(request, maxBodyBytes)).toString("utf8"));
        json(response, 200, await workspace.dispatch(payload.action, payload.args ?? {})); return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/mcp") {
        const payload = JSON.parse((await body(request, maxBodyBytes)).toString("utf8"));
        const result = await handleRpc(workspace, payload);
        if (result === null) { response.writeHead(202); response.end(); } else json(response, 200, result);
        return;
      }
      const objectMatch = /^\/api\/objects\/([0-9a-f]{64})$/.exec(requestUrl.pathname);
      if (request.method === "GET" && objectMatch) {
        const state = await workspace.read(), id = objectMatch[1];
        const source = state.sources.find(item => item.id === id), result = state.results.find(item => item.objectId === id);
        if (!source && !result) throw new WorkspaceError("Unknown original object", 404);
        attachment(response, await workspace.readObject(id), result?.mediaType ?? "application/json", result?.name ?? source.name); return;
      }
      const exportMatch = /^\/api\/exports\/([0-9a-f]{64})$/.exec(requestUrl.pathname);
      if (request.method === "GET" && exportMatch) {
        const id = exportMatch[1], data = await fs.readFile(join(workspace.directory, "exports", id + ".json"));
        if (sha256(data) !== id) throw new WorkspaceError("Export hash mismatch", 409);
        const range = request.headers.range;
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(range);
          if (!match) throw new WorkspaceError("Use a single byte range", 416);
          const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= data.length) throw new WorkspaceError("Invalid export byte range", 416);
          attachment(response, data.subarray(start, end + 1), "application/json", "openlineage-workspace.json", 206, { "Accept-Ranges": "bytes", "Content-Range": "bytes " + start + "-" + end + "/" + data.length, ETag: '"' + id + '"' });
        } else attachment(response, data, "application/json", "openlineage-workspace.json", 200, { "Accept-Ranges": "bytes", ETag: '"' + id + '"' });
        return;
      }
      throw new WorkspaceError("Not found", 404);
    } catch (error) {
      if (!response.headersSent) json(response, error.status ?? (error.code === "ENOENT" ? 404 : 400), { error: error.message, ...(error.details ? { details: error.details } : {}) });
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const address = server.address();
  expectedOrigin = "http://" + (host.includes(":") ? "[" + host + "]" : host) + ":" + address.port;
  const connectionPath = join(workspace.directory, "connection.json"), pendingConnection = connectionPath + "." + instanceId;
  try {
    await fs.writeFile(pendingConnection, JSON.stringify(identity()), { flag: "wx", mode: 0o600 });
    await fs.rename(pendingConnection, connectionPath);
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(pendingConnection).catch(() => {});
    throw error;
  }
  return { server, workspace, identity: identity(), url: expectedOrigin, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
