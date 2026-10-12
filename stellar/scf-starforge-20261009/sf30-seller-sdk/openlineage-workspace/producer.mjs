import { WorkspaceError } from "./store.mjs";
import { sha256 } from "./model.mjs";
import { normalizeEncoding, MAX_SOURCE_BYTES, SourceEncodingError } from "./source-encoding.mjs";

function integer(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new WorkspaceError(name + " must be a positive integer no larger than " + maximum);
  return value;
}
function retry(message) {
  return new WorkspaceError(message, 503, { retryable: true, retryAfterSeconds: 1 });
}
export function producerRevision(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^(?:"[0-9]+"|[0-9]+)$/.test(value))
    throw new WorkspaceError("If-Match must contain one non-negative workspace revision");
  const number = Number(value.replaceAll('"', ""));
  if (!Number.isSafeInteger(number) || number < 0) throw new WorkspaceError("Invalid If-Match revision");
  return number;
}
export function producerConfiguration(identity, { token = null, compression = "gzip", timeoutSeconds = 30, client = "python" } = {}) {
  if (!identity || identity.schema !== "commons.openlineage.startup.v1" ||
      typeof identity.workspaceId !== "string" || typeof identity.instanceId !== "string")
    throw new WorkspaceError("Use an original OpenLineage connection file");
  const url = new URL(identity.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new WorkspaceError("Producer connection must be an HTTP origin without credentials or a path");
  if (token !== null && (typeof token !== "string" || token.length < 24 || /[\r\n\u0000]/.test(token)))
    throw new WorkspaceError("Producer token must contain at least 24 characters on one line");
  if (!["identity", "gzip"].includes(compression)) throw new WorkspaceError("Compression must be identity or gzip");
  integer(timeoutSeconds, "timeoutSeconds", 3600);
  if (!["python", "java"].includes(client)) throw new WorkspaceError("Client must be python or java");
  const headers = { "X-OpenLineage-Workspace": identity.workspaceId };
  const transport = { type: "http", url: url.origin, endpoint: "api/v1/lineage",
    ...(client === "java" ? { timeoutInMillis: timeoutSeconds * 1000, headers } : { timeout: timeoutSeconds, custom_headers: headers }),
    ...(token ? { auth: { type: "api_key", apiKey: token } } : {}),
    ...(compression === "gzip" ? { compression: "gzip" } : {}) };
  return { transport };
}

/** One acknowledged append is an original atomic workspace commit.
 * Bodies waiting for that commit remain unacknowledged; an interrupted producer
 * resends its identical body and recovers the original saved operation.
 */
export class ProducerIntake {
  constructor(workspace, { maxRequests = 64, maxBufferedBytes = 128 * 1024 * 1024,
    maxBodyBytes = 64 * 1024 * 1024, maxDecodedBytes = 64 * 1024 * 1024 } = {}) {
    this.workspace = workspace;
    this.limits = {
      maxRequests: integer(maxRequests, "maxRequests", 4096),
      maxBufferedBytes: integer(maxBufferedBytes, "maxBufferedBytes", 2 * 1024 * 1024 * 1024),
      maxBodyBytes: integer(maxBodyBytes, "maxBodyBytes", MAX_SOURCE_BYTES),
      maxDecodedBytes: integer(maxDecodedBytes, "maxDecodedBytes", MAX_SOURCE_BYTES)
    };
    if (this.limits.maxBufferedBytes < this.limits.maxBodyBytes)
      throw new WorkspaceError("Producer buffer must accommodate one complete maximum-size body");
    this.tail = Promise.resolve(); this.inflight = new Set();
    this.pending = 0; this.bufferedBytes = 0; this.closed = false;
    this.startedAt = new Date().toISOString();
    this.counters = { admitted: 0, committed: 0, replayed: 0, rejected: 0, failed: 0, wireBytes: 0 };
    this.lastCommit = null;
  }
  describe() {
    return { schema: "commons.openlineage.producer-status.v1", endpoint: "/api/v1/lineage",
      state: this.closed ? "draining" : "receiving", startedAt: this.startedAt,
      limits: { ...this.limits }, pending: this.pending, bufferedBytes: this.bufferedBytes,
      counters: { ...this.counters }, lastCommit: this.lastCommit ? { ...this.lastCommit } : null,
      supportedContentEncodings: ["identity", "gzip"],
      acknowledgement: "after original source and operation are committed",
      retryIdentity: "Idempotency-Key when supplied; otherwise intake- plus the SHA-256 of the unchanged wire body" };
  }
  receive(request, { name = "http-event.json", sourceUrl = "", revision = null } = {}) {
    if (this.closed || this.pending >= this.limits.maxRequests) {
      this.counters.rejected++;
      return Promise.reject(retry("Producer intake is busy; retry the same original body"));
    }
    this.pending++; this.counters.admitted++;
    const operation = this._receive(request, { name, sourceUrl, revision });
    this.inflight.add(operation);
    // Install a rejection handler without discarding the original caller's failure.
    operation.then(() => this.inflight.delete(operation), () => this.inflight.delete(operation));
    return operation;
  }
  async _receive(request, { name, sourceUrl, revision }) {
    let held = 0;
    try {
      const media = String(request.headers["content-type"] ?? "application/json").split(";")[0].trim().toLowerCase();
      if (media !== "application/json" && !/^application\/[-a-z0-9.+]+\+json$/.test(media))
        throw new WorkspaceError("Native producers send Content-Type: application/json", 415);
      const contentEncoding = normalizeEncoding(request.headers["content-encoding"] ?? "identity");
      const declared = request.headers["content-length"];
      if (declared !== undefined && (!/^[0-9]+$/.test(String(declared)) || Number(declared) > this.limits.maxBodyBytes))
        throw new WorkspaceError("Producer body exceeds the configured original-byte limit", 413);
      const chunks = [];
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        if (held + chunk.length > this.limits.maxBodyBytes)
          throw new WorkspaceError("Producer body exceeds the configured original-byte limit", 413);
        if (this.bufferedBytes + chunk.length > this.limits.maxBufferedBytes)
          throw retry("Producer intake buffer is full; retry the same original body");
        held += chunk.length; this.bufferedBytes += chunk.length; chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks), id = sha256(bytes);
      const header = request.headers["idempotency-key"];
      if (header !== undefined && (typeof header !== "string" || !header.trim() || header.length > 512))
        throw new WorkspaceError("Idempotency-Key must be one non-empty value of at most 512 characters");
      const operationId = header ?? "intake-" + id;
      const commit = this.tail.then(async () => {
        try {
          const saved = await this.workspace.importSource({
            bytes, name: contentEncoding === "gzip" && !name.endsWith(".gz") ? name + ".gz" : name,
            sourceUrl, operationId, expectedRevision: revision ?? 0, contentEncoding
          }, { append: revision === null, maxDecodedBytes: this.limits.maxDecodedBytes });
          this.counters[saved.replayed ? "replayed" : "committed"]++;
          this.counters.wireBytes += bytes.length;
          this.lastCommit = { at: new Date().toISOString(), operationId, sourceId: saved.source.id,
            revision: saved.revision, replayed: saved.replayed === true };
          const source = saved.source;
          // Complete source/event records remain in the original workspace and journal.
          return { workspaceId: saved.workspaceId, revision: saved.revision, operationId,
            replayed: saved.replayed === true, added: saved.added, retained: saved.retained,
            source: { id: source.id, name: source.name, bytes: source.bytes, format: source.format,
              contentEncoding: source.contentEncoding ?? "identity",
              ...(source.contentEncoding === "gzip" ? { decodedBytes: source.decodedBytes, decodedSha256: source.decodedSha256 } : {}) } };
        } catch (error) {
          if (error instanceof WorkspaceError && error.status === 423)
            throw retry("Original workspace writer is active; retry the same producer body");
          throw error;
        }
      });
      this.tail = commit.catch(() => {});
      return await commit;
    } catch (error) {
      if (!request.destroyed) request.resume();
      this.counters[error.status === 503 ? "rejected" : "failed"]++;
      if (error instanceof SourceEncodingError) throw new WorkspaceError(error.message, error.status);
      throw error;
    } finally {
      this.bufferedBytes -= held; this.pending--;
    }
  }
  stop() { this.closed = true; }
  async drain() { this.stop(); await Promise.allSettled([...this.inflight]); }
}
