import { promises as fs, constants as FS } from "node:fs";
import { dirname, resolve, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { FORMAT, sha256, canonical, digest, clone, parseSource, project, entity, compareEditions, lineage, report, csv } from "./model.mjs";

import { projectReport, reportCsv, reportHtml } from "./reports.mjs";
import { parseRetainedSource, decodeSource, SourceEncodingError } from "./source-encoding.mjs";
import { SchemaError, validateSchemaCollections } from "./schema-domain.mjs";
import { dispatchSchema } from "./schema-workflow.mjs";
import { serviceLevelAction, validateServiceLevels, ServiceLevelError } from "./service-levels.mjs";
import { validateQualityState, QualityError } from "./quality.mjs";
import { dispatchQuality } from "./quality-store.mjs";
import { policyRolloutAction, validatePolicyRollouts } from "./service-policy-rollout.mjs";
import { customerReviewAction, validateCustomerReviews, CustomerReviewError } from "./customer-service-review.mjs";
import { validateReviewReturns, ReviewReturnError } from "./review-return.mjs";
import { resolveReviewReturnSource } from "./review-return-source.mjs";
import { dispatchReviewReturns } from "./review-return-store.mjs";
import { validateQualityFollowup } from "./quality-followup.mjs";
import { dispatchQualityFollowup } from "./quality-followup-store.mjs";

const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const LEGACY_APPLICATION_FILES = ["LICENSE","MERCHANT.md","OPENLINEAGE_LICENSE","README.md","RECEIVING.mjs","SOURCE_CONTRACT.md","app.js","browser-assets-loader.mjs","browser-assets.json","catalog.mjs","cli.mjs","client.d.ts","client.mjs","contribution.json","fixture-event-full.json","fixture-event-simple.json","fixture-lineage-dataset.json","fixture-lineage-implicit-job.json","fixture-lineage-mixed-sources.json","fixtures.json","index.html","mcp-client.mjs","mcp-setup.mjs","mcp-tools.mjs","mcp.mjs","merchant-provider.mjs","model.mjs","package.json","protocol.mjs","reports.mjs","schema-core-1-0-1.json","schema-core-1-0-5.json","server.mjs","store.mjs","style.css"];
export const VERSION_2_APPLICATION_FILES = ["LICENSE","MERCHANT.md","OPENLINEAGE_LICENSE","PRODUCERS.md","PRODUCER_RECEIVING.mjs","README.md","RECEIVING.mjs","SOURCE_CONTRACT.md","app.js","browser-assets-loader.mjs","browser-assets.json","catalog.mjs","cli.mjs","client.d.ts","client.mjs","contribution.json","fixture-event-full.json","fixture-event-simple.json","fixture-lineage-dataset.json","fixture-lineage-implicit-job.json","fixture-lineage-mixed-sources.json","fixtures.json","index.html","mcp-client.mjs","mcp-setup.mjs","mcp-tools.mjs","mcp.mjs","merchant-provider.mjs","model.mjs","package.json","producer.d.mts","producer.mjs","protocol.mjs","reports.mjs","schema-core-1-0-1.json","schema-core-1-0-5.json","server.mjs","source-encoding.mjs","store.mjs","style.css"];
export const VERSION_3_NATIVE_APPLICATION_FILES = ["JAVA_PRODUCER.md","JAVA_PRODUCER.mjs","LICENSE","MERCHANT.md","OPENLINEAGE_LICENSE","OpenLineageNativeProducer.java","PRODUCERS.md","PRODUCER_RECEIVING.mjs","PYTHON_PRODUCER.md","README.md","RECEIVING.mjs","SOURCE_CONTRACT.md","app.js","browser-assets-loader.mjs","browser-assets.json","catalog.mjs","cli.mjs","client.d.ts","client.mjs","contribution.json","fixture-event-full.json","fixture-event-simple.json","fixture-lineage-dataset.json","fixture-lineage-implicit-job.json","fixture-lineage-mixed-sources.json","fixtures.json","index.html","java-producer-pom.xml","mcp-client.mjs","mcp-setup.mjs","mcp-tools.mjs","mcp.mjs","merchant-provider.mjs","model.mjs","native-producer.mjs","native_python_producer.py","package.json","producer.d.mts","producer.mjs","protocol.mjs","python-producer-requirements.txt","reports.mjs","schema-core-1-0-1.json","schema-core-1-0-5.json","server.mjs","source-encoding.mjs","store.mjs","style.css"];
export const VERSION_3_APPLICATION_FILES = ["JAVA_PRODUCER.md","JAVA_PRODUCER.mjs","JAVA_RECEIVING.mjs","LICENSE","MERCHANT.md","MERCHANT_PRODUCER_RECEIVING.mjs","OPENLINEAGE_LICENSE","OpenLineageNativeProducer.java","PRODUCERS.md","PRODUCER_RECEIVING.mjs","PYTHON_PRODUCER.md","README.md","RECEIVING.mjs","SCHEMA_OPERATIONS.md","SCHEMA_RECEIVING.mjs","SOURCE_CONTRACT.md","app.js","browser-assets-loader.mjs","browser-assets.json","catalog.mjs","cli.mjs","client.d.ts","client.mjs","contribution.json","fixture-event-full.json","fixture-event-simple.json","fixture-lineage-dataset.json","fixture-lineage-implicit-job.json","fixture-lineage-mixed-sources.json","fixtures.json","index.html","java-producer-pom.xml","mcp-client.mjs","mcp-setup.mjs","mcp-tools.mjs","mcp.mjs","merchant-provider.mjs","model.mjs","native-producer.mjs","native_python_producer.py","package.json","producer.d.mts","producer.mjs","protocol.mjs","python-producer-requirements.txt","reports.mjs","schema-core-1-0-1.json","schema-core-1-0-5.json","schema-domain.mjs","schema-ui.js","schema-workflow.mjs","server.mjs","source-encoding.mjs","store.mjs","style.css"];
export const VERSION_4_APPLICATION_FILES = ["JAVA_PRODUCER.md","JAVA_PRODUCER.mjs","JAVA_RECEIVING.mjs","LICENSE","MERCHANT.md","MERCHANT_PRODUCER_RECEIVING.mjs","OPENLINEAGE_LICENSE","OpenLineageNativeProducer.java","PRODUCERS.md","PRODUCER_RECEIVING.mjs","PYTHON_PRODUCER.md","README.md","RECEIVING.mjs","SCHEMA_OPERATIONS.md","SCHEMA_RECEIVING.mjs","SERVICE_LEVELS.md","SERVICE_LEVELS_OPERATOR.md","SOURCE_CONTRACT.md","app.js","browser-assets-loader.mjs","browser-assets.json","catalog.mjs","cli.mjs","client.d.ts","client.mjs","contribution.json","fixture-event-full.json","fixture-event-simple.json","fixture-lineage-dataset.json","fixture-lineage-implicit-job.json","fixture-lineage-mixed-sources.json","fixtures.json","index.html","java-producer-pom.xml","mcp-client.mjs","mcp-setup.mjs","mcp-tools.mjs","mcp.mjs","merchant-provider.mjs","model.mjs","native-producer.mjs","native_python_producer.py","package.json","producer.d.mts","producer.mjs","protocol.mjs","python-producer-requirements.txt","reports.mjs","schema-core-1-0-1.json","schema-core-1-0-5.json","schema-domain.mjs","schema-ui.js","schema-workflow.mjs","server.mjs","service-levels-browser.js","service-levels-catalog.mjs","service-levels-cli.mjs","service-levels-client.d.mts","service-levels-client.mjs","service-levels-example.json","service-levels.css","service-levels.html","service-levels.mjs","source-encoding.mjs","store.mjs","style.css"];
export const APPLICATION_VERSION = 11;
export const VERSION_5_APPLICATION_FILES = ["JAVA_PRODUCER.md","JAVA_PRODUCER.mjs","JAVA_RECEIVING.mjs","LICENSE","MERCHANT.md","MERCHANT_PRODUCER_RECEIVING.mjs","OPENLINEAGE_LICENSE","OpenLineageNativeProducer.java","PRODUCERS.md","PRODUCER_RECEIVING.mjs","PYTHON_PRODUCER.md","QUALITY_OPERATOR.md","README.md","RECEIVING.mjs","SCHEMA_OPERATIONS.md","SCHEMA_RECEIVING.mjs","SERVICE_LEVELS.md","SERVICE_LEVELS_OPERATOR.md","SOURCE_CONTRACT.md","app.js","browser-assets-loader.mjs","browser-assets.json","catalog.mjs","cli.mjs","client.d.ts","client.mjs","contribution.json","fixture-event-full.json","fixture-event-simple.json","fixture-lineage-dataset.json","fixture-lineage-implicit-job.json","fixture-lineage-mixed-sources.json","fixtures.json","index.html","java-producer-pom.xml","mcp-client.mjs","mcp-setup.mjs","mcp-tools.mjs","mcp.mjs","merchant-provider.mjs","model.mjs","native-producer.mjs","native_python_producer.py","package.json","producer.d.mts","producer.mjs","protocol.mjs","python-producer-requirements.txt","quality-catalog.mjs","quality-cli.mjs","quality-client.d.mts","quality-client.mjs","quality-reports.mjs","quality-store.mjs","quality-ui.mjs","quality.css","quality.mjs","reports.mjs","schema-core-1-0-1.json","schema-core-1-0-5.json","schema-domain.mjs","schema-ui.js","schema-workflow.mjs","server.mjs","service-levels-browser.js","service-levels-catalog.mjs","service-levels-cli.mjs","service-levels-client.d.mts","service-levels-client.mjs","service-levels-example.json","service-levels.css","service-levels.html","service-levels.mjs","source-encoding.mjs","store.mjs","style.css"];
export const VERSION_6_APPLICATION_FILES = ["ASYNC_PRODUCER_RECEIVING.mjs","ASYNC_PYTHON_PRODUCER.md","JAVA_PRODUCER.md","JAVA_PRODUCER.mjs","JAVA_RECEIVING.mjs","LICENSE","MERCHANT.md","MERCHANT_PRODUCER_RECEIVING.mjs","OPENLINEAGE_LICENSE","OpenLineageNativeProducer.java","PRODUCERS.md","PRODUCER_RECEIVING.mjs","PYTHON_PRODUCER.md","QUALITY_OPERATOR.md","README.md","RECEIVING.mjs","SCHEMA_OPERATIONS.md","SCHEMA_RECEIVING.mjs","SERVICE_LEVELS.md","SERVICE_LEVELS_OPERATOR.md","SOURCE_CONTRACT.md","app.js","async-producer.mjs","browser-assets-loader.mjs","browser-assets.json","catalog.mjs","cli.mjs","client.d.ts","client.mjs","contribution.json","fixture-event-full.json","fixture-event-simple.json","fixture-lineage-dataset.json","fixture-lineage-implicit-job.json","fixture-lineage-mixed-sources.json","fixtures.json","index.html","java-producer-pom.xml","mcp-client.mjs","mcp-setup.mjs","mcp-tools.mjs","mcp.mjs","merchant-provider.mjs","model.mjs","native-producer.mjs","native_async_producer.py","native_python_producer.py","package.json","producer.d.mts","producer.mjs","protocol.mjs","python-producer-requirements.txt","quality-catalog.mjs","quality-cli.mjs","quality-client.d.mts","quality-client.mjs","quality-reports.mjs","quality-store.mjs","quality-ui.mjs","quality.css","quality.mjs","reports.mjs","schema-core-1-0-1.json","schema-core-1-0-5.json","schema-domain.mjs","schema-ui.js","schema-workflow.mjs","server.mjs","service-levels-browser.js","service-levels-catalog.mjs","service-levels-cli.mjs","service-levels-client.d.mts","service-levels-client.mjs","service-levels-example.json","service-levels.css","service-levels.html","service-levels.mjs","source-encoding.mjs","store.mjs","style.css"];
export const VERSION_7_APPLICATION_FILES = [...VERSION_6_APPLICATION_FILES, "JAVA_RUNTIME_RECEIVING.mjs"].sort();
export const VERSION_8_APPLICATION_FILES = [...VERSION_7_APPLICATION_FILES, "quality-followup.mjs", "quality-followup-store.mjs", "quality-followup-catalog.mjs", "quality-followup-reports.mjs", "quality-followup-client.mjs", "quality-followup-client.d.mts", "quality-followup-cli.mjs", "quality-followup-drafts.mjs", "quality-followup-ui.mjs", "quality-followup.css", "QUALITY_FOLLOWUP.md", "QUALITY_FOLLOWUP_RECEIVING.mjs", "QUALITY_FOLLOWUP_BROWSER.mjs"].sort();
export const VERSION_9_APPLICATION_FILES = [...VERSION_8_APPLICATION_FILES, "SERVICE_POLICY_ROLLOUT.md", "service-policy-rollout.mjs",
  "service-policy-rollout-catalog.mjs", "service-policy-rollout-client.mjs", "service-policy-rollout-client.d.mts",
  "service-policy-rollout-cli.mjs", "service-policy-rollout.html", "service-policy-rollout.js", "service-policy-rollout.css"].sort();
export const VERSION_10_APPLICATION_FILES = [...VERSION_9_APPLICATION_FILES, "customer-service-review.mjs", "customer-service-review-catalog.mjs",
  "customer-service-review-client.mjs", "customer-service-review-client.d.mts", "customer-service-review-cli.mjs", "CUSTOMER_SERVICE_REVIEW.md",
  "customer-service-review.html", "customer-service-review.js", "customer-service-review.css", "CUSTOMER_SERVICE_REVIEW_OPERATOR.md"].sort();
export const APPLICATION_FILES = [...VERSION_10_APPLICATION_FILES, "REVIEW_RETURNS.md", "review-return-catalog.mjs", "review-return-cli.mjs", "review-return-client.d.mts", "review-return-client.mjs", "review-return-drafts.mjs", "review-return-editor.mjs", "review-return-reports.mjs", "review-return-source.mjs", "review-return-store.mjs", "review-return-ui.mjs", "review-return.css", "review-return.mjs"].sort();
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
function validateSchemas(state, complete = false) {
  try { return validateSchemaCollections(state, { complete }); }
  catch (error) { if (error instanceof SchemaError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
}
function validateServices(state, deep = false) {
  try { validateServiceLevels(state, { deep }); validatePolicyRollouts(state, { deep }); return state; }
  catch (error) { if (error instanceof ServiceLevelError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
}
function validateQuality(state, deep = false) {
  try { validateQualityState(state, { deep }); validateQualityFollowup(state, { deep }); return state; }
  catch (error) { if (error instanceof QualityError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
}
function validateCustomers(state, deep = false) {
  try { validateCustomerReviews(state, { deep }); validateReviewReturns(state, deep ? resolveReviewReturnSource : undefined); return state; }
  catch (error) { if (error instanceof CustomerReviewError || error instanceof ReviewReturnError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
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
  validateServices(state);
  validateQuality(state);
  validateCustomers(state);
  return validateSchemas(state);
}
export class LineageWorkspace {
  constructor(directory) { this.directory = resolve(directory); this.statePath = join(this.directory, "workspace.json"); }
  async initialize(title = "OpenLineage project") {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of ["objects", "exports"]) await fs.mkdir(join(this.directory, name), { recursive: true, mode: 0o700 });
    return this.lock(async () => {
      if (await exists(this.statePath)) return this.read();
      const at = new Date().toISOString();
      const state = { schema: FORMAT, workspaceId: randomUUID(), title, revision: 0, createdAt: at, updatedAt: at, sources: [], events: [], editions: [], reviews: [], results: [], operations: [], schemaComparisons: [], schemaReviews: [] };
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
    return { ...projection, title: state.title, sources: state.sources, editions: state.editions, reviews: state.reviews, results: state.results, schemaComparisons: state.schemaComparisons ?? [], schemaReviews: state.schemaReviews ?? [], updatedAt: state.updatedAt };
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
  async change(operationId, input, revision, action, { append = false } = {}) {
    required(operationId, "operationId");
    if (append && input.action !== "source.import") throw new WorkspaceError("Append admission applies only to original source imports");
    if (!append) expectedRevision(revision);
    const requestHash = digest(input);
    return this.lock(async () => {
      const state = await this.read();
      const previous = state.operations.find(item => item.id === operationId);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new WorkspaceError("Operation ID was already used for a different request", 409);
        return { ...clone(previous.result), replayed: true };
      }
      if (!append && state.revision !== revision) throw new WorkspaceError("Workspace changed; review the current revision before saving", 409, { currentRevision: state.revision });
      const result = await action(state);
      state.revision++;
      state.updatedAt = new Date().toISOString();
      const saved = { ...result, workspaceId: state.workspaceId, revision: state.revision, operationId };
      state.operations.push({ id: operationId, requestHash, at: state.updatedAt, result: clone(saved) });
      await atomic(this.statePath, JSON.stringify(state));
      return saved;
    });
  }
  async importSource({ bytes, name = "events.json", sourceUrl = "", operationId, expectedRevision: revision, contentEncoding = "identity" },
    { append = false, maxDecodedBytes } = {}) {
    const buffer = Buffer.from(bytes);
    let parsed;
    try { parsed = parseRetainedSource(buffer, name, { contentEncoding, ...(maxDecodedBytes === undefined ? {} : { maxDecodedBytes }) }); }
    catch (error) { if (error instanceof SourceEncodingError) throw new WorkspaceError(error.message, error.status); throw error; }
    const input = { action: "source.import", objectId: parsed.id, name, sourceUrl,
      ...(parsed.contentEncoding ? { contentEncoding: parsed.contentEncoding } : {}) };
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
      const source = { id: objectId, name: safeFileName(name), sourceUrl, bytes: buffer.length, format: parsed.format,
        ...(parsed.contentEncoding ? { contentEncoding: parsed.contentEncoding, decodedBytes: parsed.decodedBytes, decodedSha256: parsed.decodedSha256 } : {}),
        eventIds: parsed.events.map(item => item.id), importedAt: new Date().toISOString(), diagnosticCount: parsed.events.filter(item => item.diagnostics.length).length };
      state.sources.push(source);
      return { source, added, retained: parsed.events.length };
    }, { append });
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
    if (typeof mediaType !== "string" || !mediaType || /[\r\n\u0000]/.test(mediaType)) throw new WorkspaceError("Use a single valid media type");
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
    const payload = { schema: "commons.openlineage.package.v1", applicationVersion: APPLICATION_VERSION, state, objects, application };
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
    const qualityCollections = {
      qualityRules: state.quality?.rules ?? [],
      qualityEvaluations: state.quality?.evaluations ?? [],
      qualityDispositions: state.quality?.dispositions ?? [],
      qualityComparisons: state.qualityFollowup?.comparisons ?? [],
      qualityFollowups: state.qualityFollowup?.followups ?? [],
      customerReviewRequests: state.customerReviewReturns?.requests ?? [],
      customerReviewResponses: state.customerReviewReturns?.responses ?? []
    };
    const globalCollections = ["operations", "schemaComparisons", "schemaReviews", "servicePolicyRollouts", "customerServiceReviews", ...Object.keys(qualityCollections)];
    if (globalCollections.includes(collection) && edition !== null)
      throw new WorkspaceError("Operation, schema, quality and policy-rollout history belong to the complete workspace; omit edition");
    const report = globalCollections.includes(collection)
      ? { [collection]: qualityCollections[collection] ?? state[collection] ?? [] } : projectReport(state, { edition });
    const collections = new Set(["jobs", "datasets", "runs", "edges", "observedEdges", "sources", "events", "editions", "reviews", "results", "diagnostics", ...globalCollections]);
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
    return { id, name: result?.name ?? source.name, mediaType: result?.mediaType ?? (source?.contentEncoding === "gzip" ? "application/gzip" : "application/json"),
      totalBytes: bytes.length, offset, bytes: chunk.length, nextOffset: offset + chunk.length,
      complete: offset + chunk.length === bytes.length, base64: chunk.toString("base64") };
  }
  async metadata() {
    const state = await this.read(), view = project(state);
    return { workspaceId: state.workspaceId, title: state.title, revision: state.revision, createdAt: state.createdAt, updatedAt: state.updatedAt,
      counts: Object.fromEntries(["jobs", "datasets", "runs", "edges", "observedEdges", "diagnostics"].map(name => [name, (view[name] ?? []).length])),
      retained: {
        ...Object.fromEntries(["sources", "events", "editions", "reviews", "results", "operations", "schemaComparisons", "schemaReviews", "servicePolicyRollouts", "customerServiceReviews"].map(name => [name, (state[name] ?? []).length])),
        qualityRules: state.quality?.rules.length ?? 0,
        qualityEvaluations: state.quality?.evaluations.length ?? 0,
        qualityDispositions: state.quality?.dispositions.length ?? 0,
        qualityComparisons: state.qualityFollowup?.comparisons.length ?? 0,
        qualityFollowups: state.qualityFollowup?.followups.length ?? 0,
        customerReviewRequests: state.customerReviewReturns?.requests.length ?? 0,
        customerReviewResponses: state.customerReviewReturns?.responses.length ?? 0
      } };
  }
  async dispatch(action, args = {}) {
    if (args === null || typeof args !== "object" || Array.isArray(args)) throw new WorkspaceError("Action arguments must be an object");
    if (typeof action === "string" && action.startsWith("review-return.")) {
      try { return await dispatchReviewReturns(this, action, args); }
      catch (error) { if (error instanceof ReviewReturnError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
    }
    if (typeof action === "string" && action.startsWith("customer-review.")) {
      try { return await customerReviewAction(this, action, args); }
      catch (error) { if (error instanceof CustomerReviewError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
    }
    if (typeof action === "string" && action.startsWith("service-policy-rollout.")) {
      try { return await policyRolloutAction(this, action, args); }
      catch (error) { if (error instanceof ServiceLevelError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
    }
    if (typeof action === "string" && action.startsWith("quality.")) {
      try { return await (action.startsWith("quality.followup.") ? dispatchQualityFollowup : dispatchQuality)(this, action, args); }
      catch (error) { if (error instanceof QualityError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
    }
    if (typeof action === "string" && action.startsWith("schema.")) {
      try { return await dispatchSchema(this, action, args); }
      catch (error) { if (error instanceof SchemaError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
    }
    if (typeof action === "string" && action.startsWith("service-levels.")) {
      try { return await serviceLevelAction(this, action, args); }
      catch (error) { if (error instanceof ServiceLevelError) throw new WorkspaceError(error.message, error.status, error.details); throw error; }
    }
    if (action === "workspace.metadata") return this.metadata();
    if (action === "records.read") return this.readRecords(args);
    if (action === "object.read") return this.readObjectRange(args.id, args);
    if (action === "workspace.read") return this.view(args);
    if (action === "source.import") return this.importSource({ ...args, bytes: args.base64 !== undefined ? Buffer.from(args.base64, "base64") : Buffer.from(args.text ?? "") });
    if (action === "source.read") {
      const state = await this.read(), source = state.sources.find(row => row.id === args.id);
      const bytes = await this.readObject(args.id);
      const value = { id: args.id, base64: bytes.toString("base64"), contentEncoding: source?.contentEncoding ?? "identity" };
      if (args.decode === true && source?.contentEncoding === "gzip") {
        const decoded = decodeSource(bytes, { contentEncoding: "gzip" }).decoded;
        if (sha256(decoded) !== source.decodedSha256 || decoded.length !== source.decodedBytes)
          throw new WorkspaceError("Decoded source identity differs", 409);
        value.decodedBase64 = decoded.toString("base64"); value.decodedSha256 = source.decodedSha256;
      }
      return value;
    }
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
    // Retained uncompressed originals predate ingress limits. Reconstruct them
    // through their original parser so a valid earlier package stays receivable.
    const encoding = source.contentEncoding ?? "identity";
    const parsed = encoding === "identity" ? parseSource(bytes, source.name) :
      parseRetainedSource(bytes, source.name, { contentEncoding: encoding });
    if (source.bytes !== bytes.length || source.format !== parsed.format ||
        (source.contentEncoding === "gzip" && (source.decodedBytes !== parsed.decodedBytes || source.decodedSha256 !== parsed.decodedSha256)) ||
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
  validateServices(state, true);
  validateQuality(state, true);
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
  validateSchemas(state, true);
  validateCustomers(state, true);
  const application = new Map();
  if (payload.applicationVersion !== undefined && ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(payload.applicationVersion)) throw new WorkspaceError("Unsupported application source edition");
  if (payload.applicationVersion === undefined && state.sources.some(source => source.contentEncoding === "gzip"))
    throw new WorkspaceError("Compressed sources require their complete version 2 application edition");
  const hasSchemaRecords = Boolean((state.schemaComparisons ?? []).length || (state.schemaReviews ?? []).length);
  if (![3, 4, 5, 6, 7, 8, 9, 10, 11].includes(payload.applicationVersion) && hasSchemaRecords)
    throw new WorkspaceError("Saved schema comparisons and decisions require a complete schema-capable application edition");
  const hasServiceRecords = Boolean((state.serviceLevels?.policies ?? []).length ||
    (state.serviceLevels?.assessments ?? []).length || (state.serviceLevels?.incidents ?? []).length);
  if (![4, 5, 6, 7, 8, 9, 10, 11].includes(payload.applicationVersion) && hasServiceRecords)
    throw new WorkspaceError("Saved service-level policies, assessments and decisions require their complete service-capable application edition");
  const hasQualityRecords = Boolean((state.quality?.rules ?? []).length ||
    (state.quality?.evaluations ?? []).length || (state.quality?.dispositions ?? []).length);
  if (![5, 6, 7, 8, 9, 10, 11].includes(payload.applicationVersion) && hasQualityRecords)
    throw new WorkspaceError("Saved quality rules, evaluations and dispositions require their complete quality-capable application edition (version 5 or later)");
  if (![8, 9, 10, 11].includes(payload.applicationVersion) && ((state.qualityFollowup?.comparisons ?? []).length || (state.qualityFollowup?.followups ?? []).length))
    throw new WorkspaceError("Saved quality comparisons and follow-up require their complete version 8 or later application");
  if (state.servicePolicyRollouts?.length && ![9, 10, 11].includes(payload.applicationVersion))
    throw new WorkspaceError("Saved policy rollouts require their complete policy-rollout application edition");
  if (state.customerServiceReviews?.length && ![10, 11].includes(payload.applicationVersion))
    throw new WorkspaceError("Saved customer service reviews require their complete customer-review application edition");
  if (((state.customerReviewReturns?.requests ?? []).length || (state.customerReviewReturns?.responses ?? []).length) && payload.applicationVersion !== 11)
    throw new WorkspaceError("Saved recipient requests and responses require their complete recipient-return application edition");
  const applicationEntries = payload.application ?? [];
  if (!Array.isArray(applicationEntries)) throw new WorkspaceError("Application source must be a complete file list");
  const nativeVersion3 = payload.applicationVersion === 3 &&
    applicationEntries.length === VERSION_3_NATIVE_APPLICATION_FILES.length &&
    applicationEntries.every(item => item && VERSION_3_NATIVE_APPLICATION_FILES.includes(item.path));
  if (nativeVersion3 && hasSchemaRecords)
    throw new WorkspaceError("Saved schema comparisons and decisions require the complete schema-capable application");
  const expectedApplication = nativeVersion3 ? VERSION_3_NATIVE_APPLICATION_FILES :
    payload.applicationVersion === 11 ? APPLICATION_FILES :
    payload.applicationVersion === 10 ? VERSION_10_APPLICATION_FILES :
    payload.applicationVersion === 9 ? VERSION_9_APPLICATION_FILES :
    payload.applicationVersion === 8 ? VERSION_8_APPLICATION_FILES :
    payload.applicationVersion === 7 ? VERSION_7_APPLICATION_FILES :
    payload.applicationVersion === 6 ? VERSION_6_APPLICATION_FILES :
    payload.applicationVersion === 5 ? VERSION_5_APPLICATION_FILES :
    payload.applicationVersion === 4 ? VERSION_4_APPLICATION_FILES :
    payload.applicationVersion === 3 ? VERSION_3_APPLICATION_FILES :
    payload.applicationVersion === 2 ? VERSION_2_APPLICATION_FILES : LEGACY_APPLICATION_FILES;
  for (const item of applicationEntries) {
    if (!expectedApplication.includes(item.path) || application.has(item.path)) throw new WorkspaceError("Unexpected application path");
    const data = Buffer.from(item.base64, "base64");
    if (sha256(data) !== item.sha256 || data.length !== item.bytes) throw new WorkspaceError("Application source hash mismatch");
    application.set(item.path, data);
  }
  if (application.size && application.size !== expectedApplication.length) throw new WorkspaceError("Incomplete editable application source");
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
