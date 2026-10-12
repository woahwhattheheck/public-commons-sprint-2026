import { stringifyJson } from "./json-codec.mjs";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { HaystackWorkspace } from "./store.mjs";
import { HaystackError, need, json as decodeJson, newId, now, sha256, fields } from "./util.mjs";
import { readBrowserAssets } from "./browser-assets-loader.mjs";
import { plainRead, atomicWrite } from "./files.mjs";
import { handleRpc } from "./protocol.mjs";
import { actions } from "./catalog.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
function equal(left, right) {
  const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b);
}
async function body(request, maximum) {
  const chunks = []; let total = 0;
  for await (const chunk of request) {
    total += chunk.length; need(total <= maximum, "The complete request exceeds its configured byte limit.", "HAYSTACK_SIZE", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function sendJson(response, status, value) {
  const bytes = Buffer.from(stringifyJson(value));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length, "Cache-Control": "no-store" }); response.end(bytes);
}
function attachment(response, bytes, metadata, rangeHeader) {
  let status = 200, start = 0, end = bytes.length - 1;
  const headers = { "Content-Type": metadata.mediaType, "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(metadata.name),
    "Cache-Control": "no-store", ETag: '"' + metadata.sha256 + '"', "Accept-Ranges": "bytes" };
  if (rangeHeader) {
    const match = /^bytes=(0|[1-9][0-9]*)-([0-9]*)$/.exec(String(rangeHeader));
    need(match, "Choose one complete byte range.", "HAYSTACK_RANGE", 416);
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
    need(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < bytes.length, "The delivery range is outside the complete file.", "HAYSTACK_RANGE", 416);
    status = 206; headers["Content-Range"] = "bytes " + start + "-" + end + "/" + bytes.length;
  }
  const selected = bytes.subarray(start, end + 1);
  response.writeHead(status, { ...headers, "Content-Length": selected.length }); response.end(selected);
}
export async function startServer({ directory, title = "Building turnover", host = "127.0.0.1", port = 8768, token = "",
  expectedWorkspaceId = null, maxBodyBytes = 48 * 1024 * 1024, maxActiveRequests = 8 } = {}) {
  need(typeof host === "string" && host.length > 0 && !/[\r\n\0/]/.test(host), "Choose the serving host.");
  need(typeof token === "string" && !/[\r\n\0]/.test(token), "Use a single-line access token.");
  need(LOOPBACK.has(host) || token.length >= 24, "Serving another computer requires an access token of at least 24 characters.");
  need(Number.isInteger(port) && port >= 0 && port <= 65535, "Choose a valid serving port.");
  need(Number.isSafeInteger(maxBodyBytes) && maxBodyBytes >= 1024 && maxBodyBytes <= 192 * 1024 * 1024, "Choose a request byte limit up to 192 MiB.");
  need(Number.isSafeInteger(maxActiveRequests) && maxActiveRequests >= 1 && maxActiveRequests <= 64, "Choose from one to 64 simultaneous requests.");
  const workspace = new HaystackWorkspace(directory);
  if (expectedWorkspaceId) need((await workspace.read()).workspaceId === expectedWorkspaceId, "The selected workspace identity changed.", "HAYSTACK_IDENTITY", 409);
  const initial = await workspace.initialize(title), instanceId = newId(), startedAt = now();
  const assets = await readBrowserAssets(new URL("./browser-assets.json", import.meta.url));
  let origin, active = 0;
  const identity = () => ({ schema: "commons.haystack.startup.v1", workspaceId: initial.workspaceId,
    workspaceCreatedAt: initial.createdAt, instanceId, startedAt, pid: process.pid, url: origin, directory: workspace.directory });
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY"); response.setHeader("x-haystack-workspace", initial.workspaceId);
    response.setHeader("x-haystack-instance", instanceId);
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    let admitted = false;
    try {
      need(request.headers.host === new URL(origin).host, "Use the selected workspace host.", "HAYSTACK_ORIGIN", 403);
      need(!request.headers.origin || request.headers.origin === origin, "Use this workspace's own origin.", "HAYSTACK_ORIGIN", 403);
      const url = new URL(request.url, origin);
      if (request.method === "GET" && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname), bytes = await fs.readFile(asset.url);
        response.writeHead(200, { "Content-Type": asset.type, "Content-Length": bytes.length, "Cache-Control": "no-store" }); response.end(bytes); return;
      }
      need(!token || equal(String(request.headers.authorization || ""), "Bearer " + token), "Supply the workspace access token.", "HAYSTACK_AUTH", 401);
      need(!request.headers["x-haystack-workspace"] || request.headers["x-haystack-workspace"] === initial.workspaceId, "The connected workspace identity changed.", "HAYSTACK_IDENTITY", 409);
      need(!request.headers["x-haystack-instance"] || request.headers["x-haystack-instance"] === instanceId, "The original server instance changed.", "HAYSTACK_INSTANCE", 409);
      need(active < maxActiveRequests, "The workspace is handling its admitted requests. Continue the same request after it completes.", "HAYSTACK_CAPACITY", 503, { retryAfterSeconds: 1 });
      active++; admitted = true;
      if (request.method === "GET" && url.pathname === "/api/identity") { sendJson(response, 200, identity()); return; }
      if (request.method === "GET" && url.pathname === "/api/catalog") {
        sendJson(response, 200, { workspaceId: initial.workspaceId, instanceId, actions }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/action") {
        const payload = decodeJson(await body(request, maxBodyBytes), maxBodyBytes);
        fields(payload, ["action", "args"], ["action"]); need(typeof payload.action === "string", "Supply the declared action name.");
        sendJson(response, 200, await workspace.dispatch(payload.action, payload.args ?? {})); return;
      }
      if (request.method === "POST" && url.pathname === "/mcp") {
        const payload = decodeJson(await body(request, maxBodyBytes), maxBodyBytes), result = await handleRpc(workspace, payload);
        if (result === null) { response.writeHead(202, { "Cache-Control": "no-store" }); response.end(); }
        else sendJson(response, 200, result);
        return;
      }
      const sourceMatch = /^\/api\/source\/([0-9a-f]{64})$/.exec(url.pathname);
      if (request.method === "GET" && sourceMatch) {
        const { source, bytes } = await workspace.originalSource(sourceMatch[1]);
        attachment(response, bytes, { name: source.name, mediaType: "application/json", sha256: source.id }, request.headers.range); return;
      }
      const deliveryMatch = /^\/api\/delivery\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(url.pathname);
      if (request.method === "GET" && deliveryMatch) {
        const { metadata, bytes } = await workspace.deliveryBytes(deliveryMatch[1]);
        attachment(response, bytes, metadata, request.headers.range); return;
      }
      need(false, "The requested workspace route is unavailable.", "HAYSTACK_ROUTE", 404);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else {
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
        if (error.details?.retryAfterSeconds) response.setHeader("Retry-After", String(error.details.retryAfterSeconds));
        sendJson(response, status, { error: error.message, code: error.code || "HAYSTACK_INTERNAL", ...(error.details ? { details: error.details } : {}) });
      }
    } finally { if (admitted) active--; }
  });
  server.maxConnections = 64;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const address = server.address();
  origin = "http://" + (host.includes(":") ? "[" + host + "]" : host) + ":" + address.port;
  const connectionPath = join(workspace.directory, "connection.json");
  try { await atomicWrite(connectionPath, Buffer.from(stringifyJson(identity()) + "\n")); }
  catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  let closing;
  const close = () => closing ||= new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return { server, workspace, identity: identity(), url: origin, close };
}
