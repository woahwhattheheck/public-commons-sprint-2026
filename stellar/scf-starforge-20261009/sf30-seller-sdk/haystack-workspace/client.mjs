import { stringifyJson } from "./json-codec.mjs";
export class HaystackClientError extends Error {
  constructor(message, { status = 0, code = "HAYSTACK_CLIENT", details, outcomeUnknown = false } = {}) {
    super(message); this.name = "HaystackClientError"; this.status = status; this.code = code; this.details = details; this.outcomeUnknown = outcomeUnknown;
  }
}
function check(condition, message, options) { if (!condition) throw new HaystackClientError(message, options); }
function bytes64(value) {
  check(typeof value === "string" && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), "The response must contain canonical complete base64.");
  const binary = atob(value), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  let rebuilt = ""; for (let i = 0; i < bytes.length; i += 32768) rebuilt += String.fromCharCode(...bytes.subarray(i, i + 32768));
  check(btoa(rebuilt) === value, "The response base64 differs from its original byte representation.");
  return bytes;
}
async function checksum(bytes) {
  check(globalThis.crypto?.subtle, "This client needs Web Crypto for complete-byte verification.");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
}
function clone(value) { return JSON.parse(stringifyJson(value)); }
export class HaystackClient {
  constructor({ url, token = "", workspaceId = null, instanceId = null, fetch: fetcher = globalThis.fetch, maxResponseBytes = 192 * 1024 * 1024 } = {}) {
    const endpoint = new URL(url);
    check(["http:", "https:"].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash &&
      (endpoint.pathname === "/" || endpoint.pathname === ""), "Use the workspace's complete HTTP origin.");
    check(typeof fetcher === "function", "A fetch implementation is required.");
    check(typeof token === "string" && !/[\r\n\0]/.test(token), "Use a single-line access token.");
    check(Number.isSafeInteger(maxResponseBytes) && maxResponseBytes > 0 && maxResponseBytes <= 256 * 1024 * 1024, "Choose a response limit up to 256 MiB.");
    this.url = endpoint.origin; this.token = token; this.workspaceId = workspaceId; this.instanceId = instanceId;
    this.fetcher = fetcher; this.maxResponseBytes = maxResponseBytes; this.identity = null;
  }
  headers() {
    return { ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
      ...(this.workspaceId ? { "x-haystack-workspace": this.workspaceId } : {}),
      ...(this.instanceId ? { "x-haystack-instance": this.instanceId } : {}) };
  }
  async call(path, { method = "GET", body, signal } = {}) {
    let response;
    try { response = await this.fetcher(this.url + path, { method, headers: { ...this.headers(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body, signal, redirect: "error", cache: "no-store" }); }
    catch (error) { throw new HaystackClientError(error.message || "The workspace response was lost.", { code: "HAYSTACK_TRANSPORT", outcomeUnknown: method === "POST" }); }
    const chunks = []; let total = 0;
    try {
      const length = response.headers.get("content-length");
      check(length === null || Number(length) <= this.maxResponseBytes, "The complete response exceeds this client's configured limit.", { status: 413, code: "HAYSTACK_SIZE", outcomeUnknown: method === "POST" });
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            total += value.byteLength;
            if (total > this.maxResponseBytes) { await reader.cancel(); throw new HaystackClientError("The complete response exceeds this client's configured limit.", { status: 413, code: "HAYSTACK_SIZE", outcomeUnknown: method === "POST" }); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      } else { const bytes = new Uint8Array(await response.arrayBuffer()); total = bytes.length; chunks.push(bytes); check(total <= this.maxResponseBytes, "The complete response exceeds the configured limit."); }
    } catch (error) {
      if (error instanceof HaystackClientError) throw error;
      throw new HaystackClientError(error.message || "The complete workspace response was lost.", { code: "HAYSTACK_TRANSPORT", outcomeUnknown: method === "POST" });
    }
    const raw = new Uint8Array(total); let position = 0;
    for (const chunk of chunks) { raw.set(chunk, position); position += chunk.length; }
    let value;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
    catch { throw new HaystackClientError("The workspace returned incomplete JSON.", { status: response.status, code: "HAYSTACK_RESPONSE", outcomeUnknown: method === "POST" }); }
    if (!response.ok) throw new HaystackClientError(value.error || "The requested workspace operation failed.", { status: response.status, code: value.code, details: value.details });
    for (const [header, expected] of [["x-haystack-workspace", this.workspaceId], ["x-haystack-instance", this.instanceId]])
      check(!expected || response.headers.get(header) === expected, "The responding workspace identity changed.", { status: 409, code: "HAYSTACK_IDENTITY", outcomeUnknown: method === "POST" });
    return value;
  }
  async connect(options = {}) {
    const identity = await this.call("/api/identity", { signal: options.signal });
    check(identity?.schema === "commons.haystack.startup.v1" && typeof identity.workspaceId === "string" && typeof identity.instanceId === "string",
      "The selected endpoint is not the complete Haystack workspace.");
    check(!this.workspaceId || identity.workspaceId === this.workspaceId, "The selected workspace identity changed.", { status: 409, code: "HAYSTACK_IDENTITY" });
    check(!this.instanceId || identity.instanceId === this.instanceId, "The original server instance changed. Connect deliberately to the same reopened workspace.", { status: 409, code: "HAYSTACK_INSTANCE" });
    this.workspaceId = identity.workspaceId; this.instanceId = identity.instanceId; this.identity = clone(identity); return clone(identity);
  }
  async request(action, args = {}, options = {}) {
    if (!this.identity) await this.connect(options);
    check(typeof action === "string" && /^[a-z]+\.[a-z]+$/.test(action) && args !== null && typeof args === "object" && !Array.isArray(args), "Use a declared action and complete arguments object.");
    return this.call("/api/action", { method: "POST", body: stringifyJson({ action, args: clone(args) }), signal: options.signal });
  }
  async *pages(action, args = {}, options = {}) {
    const original = clone(args); let offset = original.offset ?? 0, total = null;
    while (true) {
      const result = await this.request(action, { ...original, offset }, options);
      check(result && Array.isArray(result.items) && result.offset === offset && typeof result.hasMore === "boolean" && Number.isSafeInteger(result.total), "The complete record page is malformed.");
      check(total === null || total === result.total, "The selected record collection changed during paging.", { status: 409, code: "HAYSTACK_REVISION" });
      total = result.total; yield result;
      if (!result.hasMore) return;
      check(Number.isSafeInteger(result.nextOffset) && result.nextOffset > offset && result.nextOffset <= total, "The record cursor did not advance.");
      offset = result.nextOffset;
    }
  }
  async completeBytes(action, args, options = {}) {
    let offset = 0, total = null, expected = null; const chunks = [];
    while (true) {
      const part = await this.request(action, { ...args, offset, length: 4194304 }, options);
      check(part.offset === offset && Number.isSafeInteger(part.totalBytes) && part.totalBytes >= 0 &&
        /^[0-9a-f]{64}$/.test(part.sha256), "The original byte range is malformed.");
      if (total === null) { total = part.totalBytes; expected = part.sha256; }
      check(part.totalBytes === total && part.sha256 === expected && total <= this.maxResponseBytes, "The original complete file identity or size changed.");
      const bytes = bytes64(part.base64);
      check(bytes.length === part.bytes && part.nextOffset === offset + bytes.length && part.nextOffset <= total &&
        (part.complete === (part.nextOffset === total)), "The original byte range lost bytes.");
      if (part.chunkSha256) check(await checksum(bytes) === part.chunkSha256, "The original range checksum differs.");
      chunks.push(bytes); offset = part.nextOffset;
      if (part.complete) break;
      check(bytes.length > 0, "The original byte cursor did not advance.");
    }
    const full = new Uint8Array(total); let position = 0;
    for (const bytes of chunks) { full.set(bytes, position); position += bytes.length; }
    check(position === total && await checksum(full) === expected, "The complete original file checksum differs.");
    return full;
  }
  sourceBytes(sourceId, options) { return this.completeBytes("source.read", { sourceId }, options); }
  deliveryBytes(operationId, options) { return this.completeBytes("delivery.read", { operationId }, options); }
}
