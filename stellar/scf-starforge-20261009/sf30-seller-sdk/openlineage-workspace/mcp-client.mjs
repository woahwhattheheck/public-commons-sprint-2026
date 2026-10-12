// MIT. Host aliases borrow the original HTTP workspace and its operation journal.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { LineageClient } from "./client.mjs";

export const LINEAGE_HOST_SCHEMA = "stellar-forge.openlineage-workspace-host.v1";
const STARTUP_SCHEMA = "commons.openlineage.startup.v1";
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MUTATIONS = new Set(["source.import", "edition.save", "review.save", "result.attach"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
export function lineageHostError(message, status = 400, code = "OPENLINEAGE_HOST_INPUT", details) {
  return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}
function need(value, message, status = 400, code = "OPENLINEAGE_HOST_INPUT") {
  if (!value) throw lineageHostError(message, status, code);
}
function fields(value, allowed, label) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)), "Use the declared " + label + " fields.");
}
function text(value, label, maximum = 8192) {
  need(typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value), "Select a plain " + label + ".");
  return value;
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
}
async function readRegular(path, maximum, privateFile = false) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const observed = await handle.stat();
    need(observed.isFile() && observed.size <= maximum, "Use a complete regular file within the configured input capacity.", 413, "OPENLINEAGE_FILE_SIZE");
    if (privateFile) need(observed.nlink === 1 && (process.platform === "win32" || (observed.mode & 0o077) === 0) &&
      (!process.getuid || observed.uid === process.getuid()), "Use an owned private connection or token file.", 403, "OPENLINEAGE_PRIVATE_FILE");
    const bytes = await handle.readFile();
    need(bytes.length <= maximum, "The original file exceeds the configured input capacity.", 413, "OPENLINEAGE_FILE_SIZE");
    return bytes;
  } finally { await handle.close(); }
}
export async function readLineagePrivateJson(path, maximum = 1024 * 1024) {
  const bytes = await readRegular(path, maximum, true);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export async function readLineageWorkspaceConfiguration(path) {
  path = resolve(text(path, "host connection file"));
  const raw = await readLineagePrivateJson(path);
  fields(raw, ["schema", "workspaces"], "host connection");
  need(raw.schema === LINEAGE_HOST_SCHEMA && plain(raw.workspaces) && Object.keys(raw.workspaces).length >= 1 &&
    Object.keys(raw.workspaces).length <= 32, "Declare one to 32 original workspace aliases.");
  const base = dirname(path), workspaces = Object.create(null), identities = new Set();
  for (const [alias, value] of Object.entries(raw.workspaces)) {
    need(ALIAS.test(alias), "Use a lowercase workspace alias.");
    fields(value, ["label", "connectionFile", "workspaceId", "tokenFile", "timeoutMs", "maxInputBytes", "inputs"], "workspace");
    need(UUID.test(value.workspaceId ?? "") && !identities.has(value.workspaceId), "Pin each original workspace ID under one alias.");
    identities.add(value.workspaceId);
    const entry = {
      label: text(value.label ?? alias, "workspace label", 240),
      connectionFile: resolve(base, text(value.connectionFile, "private startup file")),
      workspaceId: value.workspaceId,
      tokenFile: value.tokenFile === undefined ? null : resolve(base, text(value.tokenFile, "private token file")),
      timeoutMs: value.timeoutMs ?? 120000, maxInputBytes: value.maxInputBytes ?? 40 * 1024 * 1024,
      inputs: Object.create(null)
    };
    need(Number.isSafeInteger(entry.timeoutMs) && entry.timeoutMs >= 1000 && entry.timeoutMs <= 3600000, "Select a local timeout from one second to one hour.");
    need(Number.isSafeInteger(entry.maxInputBytes) && entry.maxInputBytes >= 1 && entry.maxInputBytes <= 1024 * 1024 * 1024, "Select an input capacity from one byte to one GiB.");
    need(plain(value.inputs ?? {}) && Object.keys(value.inputs ?? {}).length <= 128, "Declare at most 128 original input aliases.");
    for (const [name, input] of Object.entries(value.inputs ?? {})) {
      need(ALIAS.test(name), "Use a lowercase input alias.");
      fields(input, ["label", "path", "kind", "sha256", "name", "mediaType", "sourceReference"], "input");
      need(["source", "result"].includes(input.kind) && HASH.test(input.sha256 ?? ""), "Pin an original source or result file and its complete SHA-256.");
      const selected = resolve(base, text(input.path, "original input file"));
      entry.inputs[name] = {
        label: text(input.label ?? name, "input label", 240), path: selected, kind: input.kind,
        sha256: input.sha256, name: text(input.name ?? basename(selected), "input name", 240),
        mediaType: text(input.mediaType ?? (input.kind === "source" ? "application/json" : "application/octet-stream"), "media type", 160),
        sourceReference: input.sourceReference === undefined ? "" : text(input.sourceReference, "source reference")
      };
    }
    workspaces[alias] = entry;
  }
  return { schema: LINEAGE_HOST_SCHEMA, path, workspaces };
}
export function lineageInputMetadata(name, input) {
  return { input: name, label: input.label, kind: input.kind, name: input.name, sha256: input.sha256,
    mediaType: input.mediaType, sourceReference: input.sourceReference };
}
export async function readLineageHostInput(entry, name, expectedSha256) {
  const input = entry.inputs[name];
  need(input, "Choose a configured original input alias.", 404, "OPENLINEAGE_INPUT_UNKNOWN");
  if (expectedSha256 !== undefined) need(input.sha256 === expectedSha256, "The selected input differs from its host-pinned SHA-256.", 409, "OPENLINEAGE_INPUT_CHANGED");
  const bytes = await readRegular(input.path, entry.maxInputBytes);
  need(digest(bytes) === input.sha256, "The original input file changed. Restore the host-pinned source before recovery.", 409, "OPENLINEAGE_INPUT_CHANGED");
  return { input, bytes, sha256: input.sha256 };
}
function localUrl(value) {
  const url = new URL(value);
  need(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname === "/", "Use the original literal loopback workspace origin.");
  return url.origin;
}
function publicIdentity(value) {
  return { schema: value.schema, workspaceId: value.workspaceId, workspaceCreatedAt: value.workspaceCreatedAt,
    instanceId: value.instanceId, startedAt: value.startedAt };
}
export class LineageHostClient {
  #entry; #lifetime = new AbortController(); #tasks = new Set(); #active = new Map(); #uncertain = new Map();
  #session = null; #attachment = null; #closed = false; #close; #last = null;
  constructor(entry) { this.#entry = entry; }
  get metadata() {
    return { state: this.#closed ? "CLOSED" : this.#session ? "ATTACHED" : "UNATTACHED",
      workspaceId: this.#entry.workspaceId, ...(this.#session ? publicIdentity(this.#session.identity) : {}),
      activeOperations: [...this.#active.keys()],
      uncertainOperations: [...this.#uncertain.values()].map(value => ({
        action: value.action, operationId: value.args.operationId, expectedRevision: value.args.expectedRevision,
        payloadSha256: value.payloadSha256, startedAt: value.startedAt
      })), lastOutcome: this.#last ? structuredClone(this.#last) : null };
  }
  #track(work) {
    need(!this.#closed, "This borrowed workspace client is closed.", 409, "OPENLINEAGE_CLIENT_CLOSED");
    const task = Promise.resolve().then(() => work(this.#lifetime.signal));
    this.#tasks.add(task); task.finally(() => this.#tasks.delete(task)).catch(() => {});
    return task;
  }
  async #inspect(signal, expectedInstanceId) {
    const record = await readLineagePrivateJson(this.#entry.connectionFile, 65536);
    need(record.schema === STARTUP_SCHEMA && record.workspaceId === this.#entry.workspaceId && UUID.test(record.instanceId ?? ""),
      "The original startup record belongs to a different workspace.", 409, "OPENLINEAGE_WORKSPACE_CHANGED");
    if (expectedInstanceId !== undefined) need(record.instanceId === expectedInstanceId, "The selected application instance changed. Inspect the current connection.", 409, "OPENLINEAGE_INSTANCE_CHANGED");
    const url = localUrl(record.url);
    let token = null;
    if (this.#entry.tokenFile) {
      token = new TextDecoder("utf-8", { fatal: true }).decode(await readRegular(this.#entry.tokenFile, 16384, true)).trim();
      text(token, "workspace token", 8192);
    }
    const response = await fetch(url + "/api/identity", {
      headers: { ...(token ? { Authorization: "Bearer " + token } : {}),
        "X-OpenLineage-Workspace": record.workspaceId, "X-OpenLineage-Instance": record.instanceId },
      redirect: "error", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)])
    });
    const declaredLength = response.headers.get("content-length");
    need(declaredLength === null || Number(declaredLength) <= 65536, "The application identity response is too large.", 502, "OPENLINEAGE_IDENTITY_RESPONSE");
    const raw = await response.text();
    need(Buffer.byteLength(raw) <= 65536, "The application identity response is too large.", 502, "OPENLINEAGE_IDENTITY_RESPONSE");
    let live; try { live = JSON.parse(raw); } catch { throw lineageHostError("The application identity response is unreadable.", 502, "OPENLINEAGE_IDENTITY_RESPONSE"); }
    if (!response.ok) throw lineageHostError(live.error ?? "The selected workspace could not be reached.", response.status, "OPENLINEAGE_CONNECTION", live.details);
    need(live.schema === record.schema && live.workspaceId === record.workspaceId && live.instanceId === record.instanceId &&
      live.workspaceCreatedAt === record.workspaceCreatedAt && live.workspace === record.workspace && localUrl(live.url) === url,
      "The live application differs from the original startup record.", 409, "OPENLINEAGE_INSTANCE_CHANGED");
    return { identity: live, url, token };
  }
  async #ensure(signal) {
    if (this.#attachment) return this.#attachment;
    if (this.#session) return this.#session;
    this.#attachment = this.#inspect(signal).then(session => { this.#session = session; return session; });
    try { return await this.#attachment; } finally { this.#attachment = null; }
  }
  connection() {
    return this.#track(async signal => {
      const selected = await this.#inspect(signal);
      return { selected: publicIdentity(selected.identity), attached: this.#session ? publicIdentity(this.#session.identity) : null,
        reconnectRequired: Boolean(this.#session && selected.identity.instanceId !== this.#session.identity.instanceId) };
    });
  }
  reconnect(expectedInstanceId) {
    return this.#track(async signal => {
      need(!this.#active.size && !this.#attachment, "Wait for active local requests to settle before reconnecting.", 423, "OPENLINEAGE_CLIENT_BUSY");
      this.#attachment = this.#inspect(signal, expectedInstanceId).then(session => { this.#session = session; return session; });
      try { await this.#attachment; return this.metadata; } finally { this.#attachment = null; }
    });
  }
  action(action, args = {}) {
    const captured = structuredClone(args), mutation = MUTATIONS.has(action);
    if (mutation) need(typeof captured.operationId === "string" && captured.operationId.trim() && Number.isSafeInteger(captured.expectedRevision) && captured.expectedRevision >= 0, "Supply the original operation ID and a non-negative expected revision.");
    const operationId = captured.operationId, payloadSha256 = digest(Buffer.from(canonical({ action, args: captured })));
    return this.#track(async lifetime => {
      const previous = mutation ? this.#uncertain.get(operationId) : null;
      if (previous) need(previous.payloadSha256 === payloadSha256, "Recover the original operation with its exact saved input and expected revision.", 409, "OPENLINEAGE_RECOVERY_INPUT");
      if (mutation) need(!this.#active.has(operationId), "This exact operation already has an active local wait.", 423, "OPENLINEAGE_OPERATION_ACTIVE");
      const controller = new AbortController(), startedAt = new Date().toISOString();
      if (mutation) this.#active.set(operationId, controller);
      let dispatched = false;
      try {
        const selected = await this.#ensure(AbortSignal.any([lifetime, controller.signal]));
        const client = new LineageClient(selected.url, { token: selected.token, expectedWorkspaceId: this.#entry.workspaceId,
          instanceId: selected.identity.instanceId, timeoutMs: this.#entry.timeoutMs, signal: AbortSignal.any([lifetime, controller.signal]) });
        dispatched = true;
        const result = await client.action(action, captured);
        if (mutation) {
          need(Number.isSafeInteger(result?.revision), "The mutation response is incomplete; recover the original operation.", 502, "OPENLINEAGE_SAVE_RESPONSE");
          this.#uncertain.delete(operationId);
        }
        this.#last = { action, operationId: operationId ?? null, outcome: "CONFIRMED", at: new Date().toISOString(), revision: result?.revision ?? null, replayed: Boolean(result?.replayed) };
        return result;
      } catch (error) {
        const revisionConflict = error.status === 409 && Number.isSafeInteger(error.details?.currentRevision);
        const uncertain = mutation && (previous && !revisionConflict || dispatched && (!error.status || error.status >= 500));
        if (uncertain) this.#uncertain.set(operationId, previous ?? { action, args: captured, payloadSha256, startedAt });
        else if (mutation && revisionConflict) this.#uncertain.delete(operationId);
        const outcome = uncertain ? "UNCERTAIN" : revisionConflict ? "REVISION_CONFLICT" : "REJECTED";
        this.#last = { action, operationId: operationId ?? null, outcome, at: new Date().toISOString(), status: error.status ?? 503, message: error.message };
        if (mutation) error.details = { ...error.details, outcome, operationId, expectedRevision: captured.expectedRevision,
          payloadSha256, workspaceId: this.#entry.workspaceId, ...(this.#session ? { instanceId: this.#session.identity.instanceId } : {}),
          recovery: uncertain ? "Repeat this exact operation ID and input; after a restart explicitly reconnect to the same workspace first." : revisionConflict ? "Read the changed workspace and submit a separately reviewed operation." : "Resolve the reported request error." };
        throw error;
      } finally { if (mutation) this.#active.delete(operationId); }
    });
  }
  cancel(operationId) {
    need(!this.#closed, "This borrowed workspace client is closed.", 409, "OPENLINEAGE_CLIENT_CLOSED");
    const active = this.#active.get(operationId);
    if (active) active.abort();
    return { operationId, state: active ? "CANCELLATION_REQUESTED" : "NO_ACTIVE_LOCAL_WAIT",
      recovery: "Read the original workspace operation and repeat the same input to determine its saved outcome." };
  }
  close() {
    if (!this.#close) {
      this.#closed = true; this.#lifetime.abort();
      this.#close = Promise.allSettled([...this.#tasks]).then(() => { this.#session = null; this.#active.clear(); });
    }
    return this.#close;
  }
}
