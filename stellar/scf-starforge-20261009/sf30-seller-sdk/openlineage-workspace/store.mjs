import { promises as fs, constants as FS } from "node:fs";
import { dirname, resolve, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { FORMAT, sha256, canonical, digest, clone, parseSource, project, entity, compareEditions, lineage, report, csv } from "./model.mjs";

import { projectReport, reportCsv, reportHtml } from "./reports.mjs";

const APP_ROOT = dirname(fileURLToPath(import.meta.url));
export const APPLICATION_FILES = ["LICENSE","OPENLINEAGE_LICENSE","README.md","RECEIVING.mjs","SOURCE_CONTRACT.md","app.js","browser-assets-loader.mjs","browser-assets.json","catalog.mjs","cli.mjs","client.d.ts","client.mjs","contribution.json","fixture-event-full.json","fixture-event-simple.json","fixture-lineage-dataset.json","fixture-lineage-implicit-job.json","fixture-lineage-mixed-sources.json","fixtures.json","index.html","model.mjs","package.json","protocol.mjs","reports.mjs","schema-core-1-0-1.json","schema-core-1-0-5.json","server.mjs","store.mjs","style.css"];
const HASH = /^[0-9a-f]{64}$/;
export class WorkspaceError extends Error {
  constructor(message, status = 400, details = undefined) { super(message); this.status = status; this.details = details; }
}
function required(value, name) { if (typeof value !== "string" || !value.trim()) throw new WorkspaceError(name + " is required"); return value; }
function expectedRevision(value) { if (!Number.isSafeInteger(value) || value < 0) throw new WorkspaceError("expectedRevision must be a non-negative integer"); }
function safeFileName(value) { return String(value ?? "file").replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 240) || "file"; }
async function exists(path) { try { await fs.access(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function atomic(path, bytes) {
  const temporary = path + ".pending-" + randomUUID();
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temporary, path);
    if (process.platform !== "win32") {
      const parent = await fs.open(dirname(path), "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
async function plainRead(path) {
  const handle = await fs.open(path, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new WorkspaceError("Expected a regular file");
    return await handle.readFile();
  } finally { await handle.close(); }
}
function validateState(state) {
  if (!state || state.schema !== FORMAT || typeof state.workspaceId !== "string" || (!Number.isSafeInteger(state.revision) || state.revision < 0)) throw new WorkspaceError("Invalid workspace state");
  for (const name of ["sources", "events", "editions", "reviews", "results", "operations"]) if (!Array.isArray(state[name])) throw new WorkspaceError("Invalid workspace " + name);
  const events = new Set();
  for (const item of state.events) {
    if (events.has(item.id) || digest(item.event) !== item.id) throw new WorkspaceError("Workspace event identity mismatch");
    events.add(item.id);
  }
  for (const edition of state.editions) if (!Array.isArray(edition.eventIds) || edition.eventIds.some(id => !events.has(id))) throw new WorkspaceError("Edition references an absent event");
  return state;
}
export class LineageWorkspace {
  constructor(directory) { this.directory = resolve(directory); this.statePath = join(this.directory, "workspace.json"); }
  async initialize(title = "OpenLineage project") {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of ["objects", "exports"]) await fs.mkdir(join(this.directory, name), { recursive: true, mode: 0o700 });
    return this.lock(async () => {
      if (await exists(this.statePath)) return this.read();
      const at = new Date().toISOString();
      const state = { schema: FORMAT, workspaceId: randomUUID(), title, revision: 0, createdAt: at, updatedAt: at, sources: [], events: [], editions: [], reviews: [], results: [], operations: [] };
      await atomic(this.statePath, JSON.stringify(state));
      return clone(state);
    });
  }
  async lock(action) {
    const path = join(this.directory, "writer.lock");
    let handle;
    try { handle = await fs.open(path, "wx", 0o600); }
    catch (error) { if (error.code === "EEXIST") throw new WorkspaceError("Workspace writer is active; retry the same operation after it completes", 423); throw error; }
    const lock = { id: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
    try { await handle.writeFile(JSON.stringify(lock)); await handle.sync(); return await action(); }
    finally { await handle.close(); await fs.unlink(path); }
  }
  async recoverLock(expectedLockId) {
    const path = join(this.directory, "writer.lock");
    const lock = JSON.parse(await plainRead(path));
    if (lock.id !== expectedLockId) throw new WorkspaceError("Writer lock changed", 409);
    if (!Number.isSafeInteger(lock.pid)) throw new WorkspaceError("Invalid writer lock");
    let dead = false;
    try { process.kill(lock.pid, 0); } catch (error) { if (error.code === "ESRCH") dead = true; else throw error; }
    if (!dead) throw new WorkspaceError("Original writer process is still present", 423);
    const current = JSON.parse(await plainRead(path));
    if (current.id !== expectedLockId) throw new WorkspaceError("Writer lock changed", 409);
    await fs.unlink(path);
    return { recovered: lock.id };
  }
  async read() { return validateState(JSON.parse(await plainRead(this.statePath))); }
  async view(options = {}) {
    const state = await this.read(), projection = project(state, options);
    return { ...projection, title: state.title, sources: state.sources, editions: state.editions, reviews: state.reviews, results: state.results, updatedAt: state.updatedAt };
  }
  async readObject(id) {
    if (!HASH.test(id)) throw new WorkspaceError("Invalid object identity");
    const bytes = await plainRead(join(this.directory, "objects", id));
    if (sha256(bytes) !== id) throw new WorkspaceError("Stored object hash mismatch", 409);
    return bytes;
  }
  async writeObject(bytes) {
    const id = sha256(bytes), path = join(this.directory, "objects", id);
    if (await exists(path)) {
      if (sha256(await plainRead(path)) !== id) throw new WorkspaceError("Existing object differs", 409);
      return id;
    }
    const temporary = path + ".pending-" + randomUUID();
    let handle;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(bytes); await handle.sync();
      await handle.close(); handle = null;
      try { await fs.link(temporary, path); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (sha256(await plainRead(path)) !== id) throw new WorkspaceError("Existing object differs", 409);
      }
      if (process.platform !== "win32") {
        const parent = await fs.open(dirname(path), "r");
        try { await parent.sync(); } finally { await parent.close(); }
      }
      return id;
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }
  async change(operationId, input, revision, action) {
    required(operationId, "operationId"); expectedRevision(revision);
    const requestHash = digest(input);
    return this.lock(async () => {
      const state = await this.read();
      const previous = state.operations.find(item => item.id === operationId);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new WorkspaceError("Operation ID was already used for a different request", 409);
        return { ...clone(previous.result), replayed: true };
      }
      if (state.revision !== revision) throw new WorkspaceError("Workspace changed; review the current revision before saving", 409, { currentRevision: state.revision });
      const result = await action(state);
      state.revision++;
      state.updatedAt = new Date().toISOString();
      const saved = { ...result, workspaceId: state.workspaceId, revision: state.revision, operationId };
      state.operations.push({ id: operationId, requestHash, at: state.updatedAt, result: clone(saved) });
      await atomic(this.statePath, JSON.stringify(state));
      return saved;
    });
  }
  async importSource({ bytes, name = "events.json", sourceUrl = "", operationId, expectedRevision: revision }) {
    const buffer = Buffer.from(bytes), parsed = parseSource(buffer, name);
    const input = { action: "source.import", objectId: parsed.id, name, sourceUrl };
    return this.change(operationId, input, revision, async state => {
      const existing = state.sources.find(item => item.id === parsed.id);
      if (existing) return { source: existing, added: 0, retained: parsed.events.length };
      const objectId = await this.writeObject(buffer);
      const known = new Map(state.events.map(item => [item.id, item]));
      let added = 0;
      for (const item of parsed.events) {
        const source = { sourceId: objectId, ...(item.line ? { line: item.line } : { index: item.index }) };
        if (known.has(item.id)) known.get(item.id).sources.push(source);
        else {
          const row = { ...item, sequence: state.events.length, sources: [source] };
          state.events.push(row); known.set(row.id, row); added++;
        }
      }
      const source = { id: objectId, name: safeFileName(name), sourceUrl, bytes: buffer.length, format: parsed.format, eventIds: parsed.events.map(item => item.id), importedAt: new Date().toISOString(), diagnosticCount: parsed.events.filter(item => item.diagnostics.length).length };
      state.sources.push(source);
      return { source, added, retained: parsed.events.length };
    });
  }
  async saveEdition({ title, description = "", operationId, expectedRevision: revision }) {
    required(title, "title");
    return this.change(operationId, { action: "edition.save", title, description }, revision, state => {
      const edition = { id: randomUUID(), title, description, createdAt: new Date().toISOString(), sourceRevision: state.revision, eventIds: state.events.map(item => item.id), sourceIds: state.sources.map(item => item.id) };
      state.editions.push(edition);
      return { edition };
    });
  }
  async saveReview({ id = null, title, reason, decision, entityKeys, editionId = null, operationId, expectedRevision: revision }) {
    required(title, "title"); required(reason, "reason");
    if (!["accepted", "needs-work", "excluded", "observed"].includes(decision)) throw new WorkspaceError("Invalid review decision");
    if (!Array.isArray(entityKeys) || entityKeys.length === 0 || entityKeys.some(key => typeof key !== "string")) throw new WorkspaceError("Select at least one entity");
    return this.change(operationId, { action: "review.save", id, title, reason, decision, entityKeys, editionId }, revision, state => {
      for (const key of entityKeys) entity(state, key, { edition: editionId });
      const prior = id ? state.reviews.find(item => item.id === id) : null;
      if (id && !prior) throw new WorkspaceError("Unknown review");
      const review = { id: id ?? randomUUID(), title, reason, decision, entityKeys: [...new Set(entityKeys)], editionId, updatedAt: new Date().toISOString(), createdAt: prior?.createdAt ?? new Date().toISOString(), history: prior ? [...prior.history, clone({ ...prior, history: undefined })].map(item => JSON.parse(JSON.stringify(item))) : [] };
      if (prior) state.reviews[state.reviews.findIndex(item => item.id === id)] = review;
      else state.reviews.push(review);
      return { review };
    });
  }
  async attachResult({ bytes, name, mediaType = "application/octet-stream", entityKeys, editionId, sourceReference, query = null, operationId, expectedRevision: revision }) {
    required(name, "name"); required(editionId, "editionId"); required(sourceReference, "sourceReference");
    if (!Array.isArray(entityKeys) || !entityKeys.length) throw new WorkspaceError("Choose the original dataset or run");
    const buffer = Buffer.from(bytes);
    return this.change(operationId, { action: "result.attach", objectId: sha256(buffer), name, mediaType, entityKeys, editionId, sourceReference, query }, revision, async state => {
      for (const key of entityKeys) entity(state, key, { edition: editionId });
      const result = { id: randomUUID(), objectId: await this.writeObject(buffer), name: safeFileName(name), bytes: buffer.length, mediaType, entityKeys: [...new Set(entityKeys)], editionId, sourceReference, query: clone(query), attachedAt: new Date().toISOString() };
      state.results.push(result);
      return { result };
    });
  }
  async exportBundle({ includeApplication = true } = {}) {
    const state = await this.read();
    const objects = [];
    const ids = [...new Set([...state.sources.map(item => item.id), ...state.results.map(item => item.objectId)])].sort();
    for (const id of ids) {
      const bytes = await this.readObject(id);
      objects.push({ id, bytes: bytes.length, base64: bytes.toString("base64") });
    }
    const application = [];
    if (includeApplication) {
      for (const name of APPLICATION_FILES) {
        const bytes = await plainRead(join(APP_ROOT, name));
        application.push({ path: name, sha256: sha256(bytes), bytes: bytes.length, base64: bytes.toString("base64") });
      }
    }
    const payload = { schema: "commons.openlineage.package.v1", state, objects, application };
    const body = Buffer.from(JSON.stringify({ ...payload, payloadSha256: digest(payload) }));
    const id = sha256(body);
    const path = join(this.directory, "exports", id + ".json");
    if (!await exists(path)) await atomic(path, body);
    return { id, bytes: body.length, workspaceId: state.workspaceId, revision: state.revision, name: "openlineage-" + state.workspaceId + "-r" + state.revision + ".json" };
  }
  async readExport(id, { offset = 0, length = 262144 } = {}) {
    if (!HASH.test(id)) throw new WorkspaceError("Invalid export identity");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 4194304) throw new WorkspaceError("Invalid byte range");
    const bytes = await plainRead(join(this.directory, "exports", id + ".json"));
    if (sha256(bytes) !== id) throw new WorkspaceError("Export hash mismatch", 409);
    if (offset > bytes.length) throw new WorkspaceError("Byte offset exceeds export length", 416);
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + length));
    return { id, totalBytes: bytes.length, offset, bytes: chunk.length, nextOffset: offset + chunk.length, complete: offset + chunk.length === bytes.length, base64: chunk.toString("base64") };
  }
  async readRecords({ collection, edition = null, expectedRevision: revision, offset = 0, limit = 100 } = {}) {
    expectedRevision(revision);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new WorkspaceError("Use a non-negative offset and a record count from 1 to 1000");
    const state = await this.read();
    if (state.revision !== revision) throw new WorkspaceError("Workspace revision changed; restart this selection from its current revision", 409, { expectedRevision: revision, actualRevision: state.revision });
    const report = projectReport(state, { edition });
    const collections = new Set(["jobs", "datasets", "runs", "edges", "observedEdges", "sources", "events", "editions", "reviews", "results", "diagnostics"]);
    if (!collections.has(collection)) throw new WorkspaceError("Choose a declared original record collection");
    const records = report[collection] ?? [];
    if (offset > records.length) throw new WorkspaceError("Record offset exceeds the selected collection", 416);
    const items = records.slice(offset, offset + limit);
    return { workspaceId: state.workspaceId, revision: state.revision, edition, collection, total: records.length,
      offset, returned: items.length, nextOffset: offset + items.length < records.length ? offset + items.length : null, items };
  }
  async readObjectRange(id, { offset = 0, length = 262144 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 4194304)
      throw new WorkspaceError("Use a non-negative offset and an original byte range from 1 to 4194304");
    const state = await this.read(), source = state.sources.find(x => x.id === id), result = state.results.find(x => x.objectId === id);
    if (!source && !result) throw new WorkspaceError("Unknown original source or result object", 404);
    const bytes = await this.readObject(id);
    if (offset > bytes.length) throw new WorkspaceError("Byte offset exceeds the original object", 416);
    const chunk = bytes.subarray(offset, Math.min(offset + length, bytes.length));
    return { id, name: result?.name ?? source.name, mediaType: result?.mediaType ?? "application/json",
      totalBytes: bytes.length, offset, bytes: chunk.length, nextOffset: offset + chunk.length,
      complete: offset + chunk.length === bytes.length, base64: chunk.toString("base64") };
  }
  async metadata() {
    const state = await this.read(), view = project(state);
    return { workspaceId: state.workspaceId, title: state.title, revision: state.revision, createdAt: state.createdAt, updatedAt: state.updatedAt,
      counts: Object.fromEntries(["jobs", "datasets", "runs", "edges", "observedEdges", "diagnostics"].map(name => [name, (view[name] ?? []).length])),
      retained: Object.fromEntries(["sources", "events", "editions", "reviews", "results", "operations"].map(name => [name, state[name].length])) };
  }
  async dispatch(action, args = {}) {
    if (args === null || typeof args !== "object" || Array.isArray(args)) throw new WorkspaceError("Action arguments must be an object");
    if (action === "workspace.metadata") return this.metadata();
    if (action === "records.read") return this.readRecords(args);
    if (action === "object.read") return this.readObjectRange(args.id, args);
    if (action === "workspace.read") return this.view(args);
    if (action === "source.import") return this.importSource({ ...args, bytes: args.base64 !== undefined ? Buffer.from(args.base64, "base64") : Buffer.from(args.text ?? "") });
    if (action === "source.read") return { id: args.id, base64: (await this.readObject(args.id)).toString("base64") };
    if (action === "entity.read") return entity(await this.read(), args.key, args);
    if (action === "lineage.read") return lineage(await this.read(), args.key, args);
    if (action === "edition.save") return this.saveEdition(args);
    if (action === "edition.compare") return compareEditions(await this.read(), args.from, args.to);
    if (action === "review.save") return this.saveReview(args);
    if (action === "result.attach") return this.attachResult({ ...args, bytes: Buffer.from(args.base64 ?? "", "base64") });
    if (action === "workspace.export") return this.exportBundle(args);
    if (action === "export.read") return this.readExport(args.id, args);
    if (action === "report.read") {
      const state = await this.read();
      if (args.format === "csv") return { mediaType: "text/csv", text: reportCsv(state, args) };
      if (args.format === "json") return { mediaType: "application/json", text: JSON.stringify(projectReport(state, args), null, 2) };
      if (args.format !== undefined && args.format !== "html") throw new WorkspaceError("Use a JSON, CSV or HTML report");
      return { mediaType: "text/html", text: reportHtml(state, args) };
    }
    throw new WorkspaceError("Unknown action " + action, 404);
  }
}
function reconstructSources(state, objects) {
  const sourceIds = new Set(), reconstructed = new Map(), sourceRows = new Map();
  for (const source of state.sources) {
    if (!HASH.test(source.id) || sourceIds.has(source.id)) throw new WorkspaceError("Invalid or duplicate source identity");
    sourceIds.add(source.id);
    if (!Array.isArray(source.eventIds)) throw new WorkspaceError("Source requires its event references");
    const bytes = objects.get(source.id);
    if (!bytes) throw new WorkspaceError("Source bytes missing");
    const parsed = parseSource(bytes, source.name);
    if (source.bytes !== bytes.length || source.format !== parsed.format ||
        canonical(parsed.events.map(row => row.id)) !== canonical(source.eventIds)) {
      throw new WorkspaceError("Source metadata or event references differ from its original bytes");
    }
    sourceRows.set(source.id, parsed.events);
    for (const actual of parsed.events) {
      const position = { sourceId: source.id, ...(actual.line !== undefined ? { line: actual.line } : { index: actual.index }) };
      const prior = reconstructed.get(actual.id);
      if (prior) prior.sources.push(position);
      else reconstructed.set(actual.id, { ...actual, sequence: reconstructed.size, sources: [position] });
    }
  }
  const expected = [...reconstructed.values()];
  if (state.events.length !== expected.length) throw new WorkspaceError("Retained source/event count mismatch");
  for (let index = 0; index < expected.length; index++) {
    const actual = expected[index], row = state.events[index];
    if (!row || !Array.isArray(row.sources) || row.id !== actual.id || row.sequence !== index ||
        canonical(row.event) !== canonical(actual.event) ||
        canonical(row.sources) !== canonical(actual.sources) ||
        (actual.line !== undefined ? row.line !== actual.line : row.index !== actual.index)) {
      throw new WorkspaceError("Event ordering or source locations differ from the original documents");
    }
  }
  // Projection metadata is derived by the receiver's pinned adapters; it is never trusted from the package.
  state.events = expected;
  for (const edition of state.editions) {
    if (!Array.isArray(edition.sourceIds) || new Set(edition.sourceIds).size !== edition.sourceIds.length ||
        edition.sourceIds.some(id => !sourceIds.has(id))) throw new WorkspaceError("Edition references an absent or duplicate source");
    const selected = new Set();
    for (const sourceId of edition.sourceIds) for (const row of sourceRows.get(sourceId)) selected.add(row.id);
    const eventIds = state.events.filter(row => selected.has(row.id)).map(row => row.id);
    if (canonical(eventIds) !== canonical(edition.eventIds)) throw new WorkspaceError("Edition events differ from its original selected sources");
  }
  return state;
}
export function verifyBundle(bytes) {
  const bundle = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(bytes)));
  const { payloadSha256, ...payload } = bundle;
  if (payload.schema !== "commons.openlineage.package.v1" || digest(payload) !== payloadSha256) throw new WorkspaceError("Workspace package hash mismatch");
  const state = validateState(payload.state), objects = new Map();
  for (const item of payload.objects ?? []) {
    if (!HASH.test(item.id) || objects.has(item.id)) throw new WorkspaceError("Invalid or duplicate object identity");
    const data = Buffer.from(item.base64, "base64");
    if (sha256(data) !== item.id || data.length !== item.bytes) throw new WorkspaceError("Package object hash or length mismatch");
    objects.set(item.id, data);
  }
  reconstructSources(state, objects);
  const resultIds = new Set();
  for (const result of state.results) {
    if (typeof result.id !== "string" || resultIds.has(result.id)) throw new WorkspaceError("Invalid or duplicate result identity");
    resultIds.add(result.id);
    const object = objects.get(result.objectId);
    if (!object || object.length !== result.bytes) throw new WorkspaceError("Result bytes missing or incomplete");
    if (!Array.isArray(result.entityKeys) || !result.entityKeys.length || typeof result.editionId !== "string" || !state.editions.some(item => item.id === result.editionId)) throw new WorkspaceError("Result requires original entities and edition");
    for (const key of result.entityKeys) entity(state, key, { edition: result.editionId });
  }
  const reviewIds = new Set();
  for (const review of state.reviews) {
    if (typeof review.id !== "string" || reviewIds.has(review.id) || !Array.isArray(review.entityKeys) || !review.entityKeys.length ||
        !Array.isArray(review.history) || !["accepted", "needs-work", "excluded", "observed"].includes(review.decision)) throw new WorkspaceError("Invalid saved review");
    reviewIds.add(review.id);
    if (review.editionId !== null && !state.editions.some(item => item.id === review.editionId)) throw new WorkspaceError("Review edition is absent");
    for (const key of review.entityKeys) entity(state, key, { edition: review.editionId });
  }
  const application = new Map();
  for (const item of payload.application ?? []) {
    if (!APPLICATION_FILES.includes(item.path) || application.has(item.path)) throw new WorkspaceError("Unexpected application path");
    const data = Buffer.from(item.base64, "base64");
    if (sha256(data) !== item.sha256 || data.length !== item.bytes) throw new WorkspaceError("Application source hash mismatch");
    application.set(item.path, data);
  }
  if (application.size && application.size !== APPLICATION_FILES.length) throw new WorkspaceError("Incomplete editable application source");
  return { state, objects, application, payloadSha256, packageSha256: sha256(bytes) };
}
export async function receiveBundle(bytes, destination) {
  const verified = verifyBundle(bytes), target = resolve(destination);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  if (await exists(target)) throw new WorkspaceError("Receiving destination already exists; select a new directory", 409);
  const stage = target + ".receiving-" + randomUUID();
  await fs.mkdir(stage, { mode: 0o700 });
  try {
    await fs.mkdir(join(stage, "objects"), { mode: 0o700 });
    await fs.mkdir(join(stage, "exports"), { mode: 0o700 });
    for (const [id, data] of verified.objects) await fs.writeFile(join(stage, "objects", id), data, { mode: 0o600, flag: "wx" });
    if (verified.application.size) {
      await fs.mkdir(join(stage, "application"), { mode: 0o700 });
      for (const [name, data] of verified.application) await fs.writeFile(join(stage, "application", name), data, { mode: 0o600, flag: "wx" });
    }
    await fs.writeFile(join(stage, "workspace.json"), JSON.stringify(verified.state), { mode: 0o600, flag: "wx" });
    await fs.writeFile(join(stage, "received.json"), JSON.stringify({ packageSha256: verified.packageSha256, payloadSha256: verified.payloadSha256, receivedAt: new Date().toISOString(), installationId: randomUUID() }), { mode: 0o600, flag: "wx" });
    await fs.rename(stage, target);
  } catch (error) { await fs.rm(stage, { recursive: true, force: true }); throw error; }
  return { directory: target, workspaceId: verified.state.workspaceId, revision: verified.state.revision, packageSha256: verified.packageSha256, applicationFiles: verified.application.size };
}
