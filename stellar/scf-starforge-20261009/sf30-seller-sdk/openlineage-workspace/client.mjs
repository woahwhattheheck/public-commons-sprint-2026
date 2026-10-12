import { randomUUID, createHash } from "node:crypto";
import { promises as fs } from "node:fs";

export class LineageClient {
  constructor(baseUrl, { token = null, fetchImpl = globalThis.fetch, timeoutMs = 30000, expectedWorkspaceId = null, instanceId = null, signal = null } = {}) {
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Use an HTTP(S) workspace URL");
    this.baseUrl = parsed.href.replace(/\/$/, ""); this.token = token; this.fetch = fetchImpl; this.timeoutMs = timeoutMs; this.expectedWorkspaceId = expectedWorkspaceId; this.instanceId = instanceId; this.signal = signal;
  }
  async requestJSON(path, init = {}) {
    const response = await this.fetch(this.baseUrl + path, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
        ...(this.expectedWorkspaceId ? { "X-OpenLineage-Workspace": this.expectedWorkspaceId } : {}),
        ...(this.instanceId ? { "X-OpenLineage-Instance": this.instanceId } : {}) },
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
      redirect: "error"
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error ?? "Workspace request failed"), {
      status: response.status, details: result.details, retryAfter: response.headers.get("retry-after")
    });
    return result;
  }
  async action(action, args = {}) {
    const captured = structuredClone(args);
    return this.requestJSON("/api/action", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, args: captured }) });
  }
  producerStatus() { return this.requestJSON("/api/producer"); }
  emitSource(bytes, { name = "http-event.json", sourceUrl = "", contentEncoding = "identity", operationId, expectedRevision } = {}) {
    const body = Buffer.from(bytes), query = new URLSearchParams({ name });
    if (sourceUrl) query.set("source", sourceUrl);
    if (!["identity", "gzip"].includes(contentEncoding)) throw new Error("Content encoding must be identity or gzip");
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))
      throw new Error("Expected revision must be a non-negative integer");
    return this.requestJSON("/api/v1/lineage?" + query, { method: "POST",
      headers: { "Content-Type": "application/json",
        ...(contentEncoding === "gzip" ? { "Content-Encoding": "gzip" } : {}),
        ...(operationId === undefined ? {} : { "Idempotency-Key": operationId }),
        ...(expectedRevision === undefined ? {} : { "If-Match": String(expectedRevision) }) },
      body });
  }
  metadata() { return this.action("workspace.metadata"); }
  records(args) { return this.action("records.read", args); }
  object(id, options = {}) { return this.action("object.read", { id, ...options }); }
  read(options = {}) { return this.action("workspace.read", options); }
  importSource(bytes, { name = "events.json", sourceUrl = "", operationId = randomUUID(), expectedRevision, contentEncoding = "identity" } = {}) {
    return this.action("source.import", { base64: Buffer.from(bytes).toString("base64"), name, sourceUrl, operationId, expectedRevision, contentEncoding });
  }
  saveEdition(args) { return this.action("edition.save", args); }
  compare(from, to) { return this.action("edition.compare", { from, ...(to ? { to } : {}) }); }
  entity(key, edition) { return this.action("entity.read", { key, ...(edition ? { edition } : {}) }); }
  lineage(key, options = {}) { return this.action("lineage.read", { key, ...options }); }
  saveReview(args) { return this.action("review.save", args); }
  attachResult(bytes, args) { return this.action("result.attach", { ...args, base64: Buffer.from(bytes).toString("base64") }); }
  exportWorkspace(options = {}) { return this.action("workspace.export", options); }
  async downloadExport(id, destination, { chunkBytes = 262144 } = {}) {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("Invalid export identity");
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 4194304) throw new Error("Use an export chunk size from 1 to 4194304 bytes");
    try {
      const existing = await fs.lstat(destination);
      if (!existing.isFile() || existing.isSymbolicLink() || createHash("sha256").update(await fs.readFile(destination)).digest("hex") !== id)
        throw new Error("Destination contains a different file");
      return { id, bytes: existing.size, destination, alreadyPresent: true };
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const pending = destination + ".part", marker = destination + ".part.json";
    let saved = null;
    try {
      const metadata = await fs.lstat(marker);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Use the original ordinary partial-download record");
      saved = JSON.parse(await fs.readFile(marker, "utf8"));
      if (saved.id !== id || saved.baseUrl !== this.baseUrl) throw new Error("Existing partial download belongs to another export");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    let partial = null;
    try {
      partial = await fs.lstat(pending);
      if (!partial.isFile() || partial.isSymbolicLink()) throw new Error("Use the original ordinary partial-download file");
      if (!saved) throw new Error("Unidentified partial file already exists");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!saved) await fs.writeFile(marker, JSON.stringify({ id, baseUrl: this.baseUrl }), { flag: "wx", mode: 0o600 });
    if (!partial) await fs.writeFile(pending, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    let offset = partial?.size ?? 0;
    const handle = await fs.open(pending, "a");
    try {
      while (true) {
        const chunk = await this.action("export.read", { id, offset, length: chunkBytes });
        const data = Buffer.from(chunk.base64, "base64");
        if (chunk.id !== id || chunk.offset !== offset || data.length !== chunk.bytes || chunk.nextOffset !== offset + data.length) throw new Error("Export range identity mismatch");
        await handle.writeFile(data); await handle.sync(); offset = chunk.nextOffset;
        if (chunk.complete) break;
        if (!data.length) throw new Error("Export transfer made no progress");
      }
    } finally { await handle.close(); }
    const hash = createHash("sha256").update(await fs.readFile(pending)).digest("hex");
    if (hash !== id) throw new Error("Complete downloaded export hash mismatch");
    try { await fs.link(pending, destination); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (createHash("sha256").update(await fs.readFile(destination)).digest("hex") !== id) throw new Error("Destination contains a different file");
    }
    await fs.unlink(pending); await fs.unlink(marker);
    return { id, bytes: offset, destination };
  }
}
