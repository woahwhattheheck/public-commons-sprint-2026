import { randomUUID, createHash } from "node:crypto";
import { promises as fs } from "node:fs";

export class LineageClient {
  constructor(baseUrl, { token = null, fetchImpl = globalThis.fetch, timeoutMs = 30000, expectedWorkspaceId = null, instanceId = null, signal = null } = {}) {
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Use an HTTP(S) workspace URL");
    this.baseUrl = parsed.href.replace(/\/$/, ""); this.token = token; this.fetch = fetchImpl; this.timeoutMs = timeoutMs; this.expectedWorkspaceId = expectedWorkspaceId; this.instanceId = instanceId; this.signal = signal;
  }
  async action(action, args = {}) {
    const captured = structuredClone(args);
    const response = await this.fetch(this.baseUrl + "/api/action", { method: "POST", headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: "Bearer " + this.token } : {}), ...(this.expectedWorkspaceId ? { "X-OpenLineage-Workspace": this.expectedWorkspaceId } : {}), ...(this.instanceId ? { "X-OpenLineage-Instance": this.instanceId } : {}) }, body: JSON.stringify({ action, args: captured }), signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs), redirect: "error" });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error ?? "Workspace request failed"), { status: response.status, details: result.details });
    return result;
  }
  metadata() { return this.action("workspace.metadata"); }
  records(args) { return this.action("records.read", args); }
  object(id, options = {}) { return this.action("object.read", { id, ...options }); }
  read(options = {}) { return this.action("workspace.read", options); }
  importSource(bytes, { name = "events.json", sourceUrl = "", operationId = randomUUID(), expectedRevision } = {}) {
    return this.action("source.import", { base64: Buffer.from(bytes).toString("base64"), name, sourceUrl, operationId, expectedRevision });
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
