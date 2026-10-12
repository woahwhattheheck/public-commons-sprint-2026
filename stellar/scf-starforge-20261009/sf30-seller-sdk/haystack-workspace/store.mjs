import { stringifyJson } from "./json-codec.mjs";
import { promises as fs, constants as FS } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { freshState, seal, validateState, summary, analyzed, applyAction, sourceSummary, findSource, findProposal, proposalView, proposedChanges, findEdition, editionView, compareEditions, STATE_MAX_BYTES, SOURCE_MAX_BYTES } from "./model.mjs";
import { clone, digest, sha256, json, base64, plain, need, id, hash, integer, text, now, newId, page, canonical } from "./util.mjs";
import { exists, plainRead, atomicWrite, createOnlyFile, syncDirectory } from "./files.mjs";
import { validateArguments, MUTATIONS } from "./catalog.mjs";
import { buildBundle, PACKAGE_MAX_BYTES } from "./portable.mjs";
import { makeReport, nativeGrid } from "./reports.mjs";

function assertRevision(state, expectedRevision) {
  integer(expectedRevision, "reviewed workspace revision");
  need(state.revision === expectedRevision, "The workspace changed. Read its current selection before continuing.", "HAYSTACK_REVISION", 409,
    { expectedRevision, actualRevision: state.revision, workspaceId: state.workspaceId });
}
function range(raw, metadata, { offset = 0, length = 262144 } = {}) {
  integer(offset, "byte offset"); integer(length, "byte range", 1, 4194304);
  need(offset <= raw.length, "The byte offset exceeds this complete file.", "HAYSTACK_RANGE", 416);
  const bytes = raw.subarray(offset, offset + length);
  return { ...metadata, offset, bytes: bytes.length, totalBytes: raw.length, nextOffset: offset + bytes.length,
    complete: offset + bytes.length === raw.length, base64: bytes.toString("base64"), chunkSha256: sha256(bytes) };
}
function fileSignature(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":"); }
function previewSummary(prepared) {
  return { materialSha256: prepared.materialSha256, changes: prepared.changes,
    counts: prepared.preview.counts, diagnostics: prepared.preview.diagnostics };
}
function sourceDiagnostics(view) {
  return view.diagnostics.map(item => ({ ...item, ...(item.sourceId ? {} : item.recordKey ? { sourceId: item.recordKey.split(":")[0] } : {}) }));
}
export class HaystackWorkspace {
  constructor(directory) {
    need(typeof directory === "string" && directory.length > 0, "Choose an explicit local workspace directory.");
    this.directory = resolve(directory); this.statePath = join(this.directory, "workspace.json");
    this.lockPath = join(this.directory, "writer.lock"); this.fileChecks = new Map();
  }
  async initialize(title = "Building turnover") {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await fs.lstat(this.directory);
    need(directory.isDirectory() && !directory.isSymbolicLink(), "Choose the actual workspace directory.", "HAYSTACK_DIRECTORY");
    if (await exists(join(this.directory, "receiving.json"))) need(await exists(join(this.directory, "received.json")),
      "Continue the original receiving operation to finish installing this workspace.", "HAYSTACK_RECEIVING", 409);
    await fs.mkdir(join(this.directory, "deliveries"), { recursive: true, mode: 0o700 });
    return this.withWriter(async () => {
      if (await exists(this.statePath)) return this.read();
      const state = freshState(title); await createOnlyFile(this.statePath, Buffer.from(stringifyJson(state) + "\n")); return state;
    });
  }
  async read() {
    if (await exists(join(this.directory, "receiving.json"))) need(await exists(join(this.directory, "received.json")),
      "The original received application is still being installed.", "HAYSTACK_RECEIVING", 409);
    return validateState(json(await plainRead(this.statePath, STATE_MAX_BYTES), STATE_MAX_BYTES));
  }
  async writer() {
    try { return json(await plainRead(this.lockPath, 16384), 16384); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async withWriter(action) {
    let file;
    try { file = await fs.open(this.lockPath, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") need(false, "The original workspace writer is active. Continue the same request after it completes.", "HAYSTACK_WRITER", 423, { retryAfterSeconds: 1 });
      throw error;
    }
    const owner = { format: "commons.haystack.writer.v1", id: newId(), pid: process.pid, host: hostname(), createdAt: now() };
    const originalStat = await file.stat({ bigint: true });
    try {
      await file.writeFile(stringifyJson(owner) + "\n"); await file.sync(); return await action();
    } finally {
      try {
        const retained = await fs.lstat(this.lockPath, { bigint: true });
        need(retained.dev === originalStat.dev && retained.ino === originalStat.ino, "The original writer ownership changed.", "HAYSTACK_WRITER_CHANGED", 409);
        await fs.unlink(this.lockPath); await syncDirectory(this.directory);
      } finally { await file.close(); }
    }
  }
  async recoverWriter(expectedLockId) {
    id(expectedLockId, "writer identity");
    const owner = await this.writer();
    need(owner?.id === expectedLockId && owner.host === hostname(), "Recover the exact original writer on its owning computer.", "HAYSTACK_WRITER_CHANGED", 409);
    integer(owner.pid, "original writer PID", 1);
    let stopped = false;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === "ESRCH") stopped = true; else throw error; }
    need(stopped, "The original writer process is still present.", "HAYSTACK_WRITER", 423);
    const recoveryPath = join(this.directory, "writer-recovery-" + owner.id + ".json");
    const existingRecovery = await exists(recoveryPath);
    need(!existingRecovery, "This writer already has an original recovery record. Inspect that completed or interrupted local operation.", "HAYSTACK_WRITER_RECOVERY", 409);
    const recovery = await fs.open(recoveryPath, "wx", 0o600);
    try { await recovery.writeFile(stringifyJson({ writer: owner, recoveredAt: now(), recoveredBy: process.pid }) + "\n"); await recovery.sync(); }
    finally { await recovery.close(); }
    need((await this.writer())?.id === owner.id, "Writer ownership changed before recovery.", "HAYSTACK_WRITER_CHANGED", 409);
    await fs.unlink(this.lockPath); await syncDirectory(this.directory);
    return { recovered: owner.id, writer: owner };
  }
  deliveryDirectory(operationId) { return join(this.directory, "deliveries", id(operationId)); }
  async mutate(action, args) {
    const operationId = id(args.operationId), argumentsSha256 = digest({ action, args });
    return this.withWriter(async () => {
      const state = await this.read(), original = state.operations.find(item => item.id === operationId);
      if (original) {
        need(original.action === action && original.argumentsSha256 === argumentsSha256, "This operation identity belongs to different complete arguments.", "HAYSTACK_OPERATION", 409);
        return { ...clone(original.result), replayed: true };
      }
      need(!await exists(this.deliveryDirectory(operationId)), "This operation identity belongs to an existing delivery.", "HAYSTACK_OPERATION", 409);
      assertRevision(state, args.expectedRevision);
      const result = applyAction(state, action, args); state.revision += 1;
      const outcome = { ...clone(result), workspaceId: state.workspaceId, revision: state.revision, operationId };
      const operation = { id: operationId, action, argumentsSha256, revision: state.revision, at: now(),
        previousSha256: state.operations.at(-1)?.sha256 || null, result: outcome };
      operation.sha256 = digest(operation); state.operations.push(operation);
      const saved = seal(state), bytes = Buffer.from(stringifyJson(saved) + "\n");
      need(bytes.length <= STATE_MAX_BYTES, "This complete workspace exceeds 128 MiB. Export the retained history and continue the next project in a new workspace.", "HAYSTACK_SIZE", 413);
      validateState(saved);
      await atomicWrite(this.statePath, bytes);
      return { ...outcome, replayed: false };
    });
  }
  async originalSource(sourceId) {
    const state = await this.read(), source = findSource(state, sourceId), bytes = base64(source.base64, SOURCE_MAX_BYTES);
    need(bytes.length === source.bytes && sha256(bytes) === source.id, "The original source bytes differ.", "HAYSTACK_SOURCE", 409);
    return { source: sourceSummary(source), bytes };
  }
  async deliveryManifest(operationId) {
    const directory = this.deliveryDirectory(operationId);
    let manifest;
    try { manifest = json(await plainRead(join(directory, "manifest.json"), 65536), 65536); }
    catch (error) { if (error.code === "ENOENT") need(false, "This delivery has not completed.", "HAYSTACK_DELIVERY_MISSING", 404); throw error; }
    const body = clone(manifest); delete body.manifestSha256;
    need(manifest.format === "commons.haystack.delivery.v1" && manifest.operationId === operationId &&
      manifest.manifestSha256 === digest(body), "The complete delivery metadata differs.", "HAYSTACK_DELIVERY", 409);
    hash(manifest.sha256); hash(manifest.argumentsSha256); integer(manifest.bytes, "delivery bytes", 0, PACKAGE_MAX_BYTES);
    need(manifest.argumentsSha256 === digest({ action: "delivery.prepare", args: manifest.arguments }), "The original delivery arguments differ.", "HAYSTACK_DELIVERY", 409);
    return manifest;
  }
  deliverySummary(manifest, replayed = false) {
    const { format, arguments: omitted, argumentsSha256, manifestSha256, ...result } = manifest;
    return { ...result, replayed };
  }
  async readDelivery(operationId, options = {}) {
    const metadata = await this.deliveryManifest(operationId), path = join(this.deliveryDirectory(operationId), "payload");
    const offset = options.offset ?? 0, length = options.length ?? 262144;
    integer(offset, "byte offset"); integer(length, "byte range", 1, 4194304);
    need(offset <= metadata.bytes, "The byte offset exceeds this complete delivery.", "HAYSTACK_RANGE", 416);
    const file = await fs.open(path, FS.O_RDONLY | (FS.O_NOFOLLOW || 0));
    try {
      const stat = await file.stat({ bigint: true }), signature = fileSignature(stat);
      need(stat.isFile() && stat.size === BigInt(metadata.bytes), "The complete delivery size differs.", "HAYSTACK_DELIVERY", 409);
      if (this.fileChecks.get(operationId) !== signature) {
        const digestor = createHash("sha256"), chunk = Buffer.alloc(262144); let position = 0;
        while (position < metadata.bytes) {
          const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, metadata.bytes - position), position);
          need(bytesRead > 0, "The original delivery ended before its declared size.", "HAYSTACK_DELIVERY", 409);
          digestor.update(chunk.subarray(0, bytesRead)); position += bytesRead;
        }
        need(digestor.digest("hex") === metadata.sha256 && fileSignature(await file.stat({ bigint: true })) === signature,
          "The complete delivery bytes changed.", "HAYSTACK_DELIVERY", 409);
        this.fileChecks.set(operationId, signature);
      }
      const size = Math.min(length, metadata.bytes - offset), bytes = Buffer.alloc(size); let read = 0;
      while (read < size) {
        const result = await file.read(bytes, read, size - read, offset + read);
        need(result.bytesRead > 0, "The delivery range ended early.", "HAYSTACK_DELIVERY", 409); read += result.bytesRead;
      }
      need(fileSignature(await file.stat({ bigint: true })) === signature, "The delivery changed during the read.", "HAYSTACK_DELIVERY", 409);
      return { operationId, sha256: metadata.sha256, name: metadata.name, mediaType: metadata.mediaType,
        offset, bytes: bytes.length, totalBytes: metadata.bytes, nextOffset: offset + bytes.length,
        complete: offset + bytes.length === metadata.bytes, base64: bytes.toString("base64"), chunkSha256: sha256(bytes) };
    } finally { await file.close(); }
  }
  async deliveryBytes(operationId) {
    const metadata = await this.deliveryManifest(operationId), bytes = await plainRead(join(this.deliveryDirectory(operationId), "payload"), PACKAGE_MAX_BYTES);
    need(bytes.length === metadata.bytes && sha256(bytes) === metadata.sha256, "The complete delivery bytes differ.", "HAYSTACK_DELIVERY", 409);
    return { metadata: this.deliverySummary(metadata), bytes };
  }
  async prepareDelivery(args) {
    const operationId = id(args.operationId), argumentsSha256 = digest({ action: "delivery.prepare", args });
    if (args.kind === "workspace") need(args.format === undefined && args.editionId === undefined && args.sourceId === undefined && args.role === undefined,
      "The complete workspace delivery includes every source, edition and application file; omit report-only fields.");
    else if (args.kind === "native-grid") need(args.sourceId && args.role === undefined && (args.format === undefined || args.format === "json"), "Native grid delivery needs one selected source and JSON format.");
    else need(args.sourceId === undefined, "Register and diagnostic reports use their complete selected source set.");
    return this.withWriter(async () => {
      const target = this.deliveryDirectory(operationId);
      if (await exists(target)) {
        const original = await this.deliveryManifest(operationId);
        need(original.argumentsSha256 === argumentsSha256, "This original delivery belongs to different complete arguments.", "HAYSTACK_OPERATION", 409);
        await this.readDelivery(operationId, { length: 1 });
        return this.deliverySummary(original, true);
      }
      const state = await this.read(); assertRevision(state, args.expectedRevision);
      need(!state.operations.some(item => item.id === operationId), "This identity belongs to an original saved mutation.", "HAYSTACK_OPERATION", 409);
      const result = args.kind === "workspace" ? await buildBundle(state) :
        args.kind === "native-grid" ? nativeGrid(state, args) : makeReport(state, args);
      const bytes = Buffer.from(result.bytes);
      need(bytes.length <= PACKAGE_MAX_BYTES, "This complete delivery exceeds 192 MiB.", "HAYSTACK_SIZE", 413);
      const manifest = { format: "commons.haystack.delivery.v1", operationId, arguments: clone(args), argumentsSha256,
        workspaceId: state.workspaceId, revision: state.revision, name: result.name, mediaType: result.mediaType,
        sha256: sha256(bytes), bytes: bytes.length, kind: args.kind, createdAt: now() };
      manifest.manifestSha256 = digest(manifest);
      const temporary = target + ".pending-" + newId();
      await fs.mkdir(temporary, { mode: 0o700 });
      try {
        await createOnlyFile(join(temporary, "payload"), bytes);
        await createOnlyFile(join(temporary, "manifest.json"), Buffer.from(stringifyJson(manifest) + "\n"));
        await syncDirectory(temporary); await fs.rename(temporary, target); await syncDirectory(join(this.directory, "deliveries"));
      } finally { await fs.rm(temporary, { recursive: true, force: true }); }
      return this.deliverySummary(manifest);
    });
  }
  async dispatch(action, args = {}) {
    validateArguments(action, args);
    if (MUTATIONS.has(action)) return this.mutate(action, args);
    if (action === "delivery.prepare") return this.prepareDelivery(args);
    if (action === "delivery.read") return this.readDelivery(args.operationId, args);
    if (action === "source.read") {
      const original = await this.originalSource(args.sourceId);
      return range(original.bytes, { sourceId: original.source.id, sha256: original.source.id, name: original.source.name, mediaType: "application/json" }, args);
    }
    const state = await this.read();
    if (action === "workspace.status") return summary(state);
    if (action === "operation.read") {
      const operationId = id(args.operationId), operation = state.operations.find(item => item.id === operationId);
      if (operation) return { ...clone(operation.result), replayed: true };
      if (await exists(this.deliveryDirectory(operationId))) {
        const delivery = await this.deliveryManifest(operationId);
        need(delivery.workspaceId === state.workspaceId, "The completed delivery belongs to another workspace.", "HAYSTACK_DELIVERY", 409);
        await this.readDelivery(operationId, { length: 1 });
        return this.deliverySummary(delivery, true);
      }
      need(false, "This original mutation or delivery has not completed.", "HAYSTACK_OPERATION_MISSING", 404);
    }
    assertRevision(state, args.expectedRevision);
    const envelope = { workspaceId: state.workspaceId, revision: state.revision, ...(args.editionId ? { editionId: args.editionId } : {}) };
    const paginate = items => ({ ...envelope, ...page(items, args) });
    if (action === "sources.list") return paginate(state.sources.map(source => ({ ...sourceSummary(source), selected: state.selectedSourceIds.includes(source.id) })));
    if (action === "operations.list") return paginate(state.operations);
    if (action === "editions.list") return paginate(state.editions);
    if (action === "edition.read") {
      const view = editionView(state, args.editionId);
      return { ...envelope, edition: view.edition, sources: view.sources, counts: view.counts, diagnosticCount: view.diagnostics.length };
    }
    if (action === "edition.compare") {
      const comparison = compareEditions(state, args.beforeEditionId, args.afterEditionId, args);
      const rows = args.state ? comparison.rows.filter(row => row.state === args.state) : comparison.rows;
      const { rows: omitted, ...metadata } = comparison;
      return { ...paginate(rows), ...metadata };
    }
    if (action === "proposal.preview") return { ...envelope, ...previewSummary(proposedChanges(state, args.edits)) };
    if (action === "proposals.list") {
      const materialSha256 = analyzed(state).contentSha256;
      return paginate(state.proposals.filter(proposal => !args.state || proposal.state === args.state).map(proposal => {
        const { changes, ...metadata } = proposal;
        return { ...metadata, changeCount: changes.length, stale: proposal.state === "proposed" && proposal.baseMaterialSha256 !== materialSha256 };
      }));
    }
    if (action === "proposal.read") {
      const proposal = proposalView(state, findProposal(state, args.proposalId)); let preview = null;
      if (proposal.state === "proposed" && !proposal.stale) {
        const edits = proposal.changes.map(change => ({ recordKey: change.recordKey, tag: change.tag,
          action: change.after.present ? "set" : "remove", ...(change.after.present ? { value: change.after.value } : {}) }));
        const prepared = proposedChanges(state, edits); preview = { counts: prepared.preview.counts, diagnostics: prepared.preview.diagnostics };
      }
      return { ...envelope, proposal, preview };
    }
    const view = args.editionId ? editionView(state, args.editionId) : analyzed(state);
    if (action === "records.list") {
      const query = (args.query || "").trim().toLocaleLowerCase("en-US");
      need(query.length <= 1000, "Keep the register search within 1,000 characters.");
      return paginate(view.records.filter(row => (!args.role || args.role === "all" || row.roles.includes(args.role)) &&
        (!args.sourceId || row.sourceId === args.sourceId) &&
        (!query || [row.id || "", row.display, canonical(row.tags)].some(value => value.toLocaleLowerCase("en-US").includes(query)))));
    }
    if (action === "record.read") {
      const record = view.records.find(row => row.key === args.recordKey);
      need(record, "Choose a complete source row in this edition.", "HAYSTACK_RECORD_MISSING", 404);
      return { ...envelope, record, relations: view.relations.filter(item => item.fromKey === record.key || (item.targetKeys || []).includes(record.key)),
        diagnostics: sourceDiagnostics(view).filter(item => item.recordKey === record.key) };
    }
    if (action === "diagnostics.list") return paginate(sourceDiagnostics(view).filter(item =>
      (!args.severity || item.severity === args.severity) && (!args.sourceId || item.sourceId === args.sourceId) &&
      (!args.recordKey || item.recordKey === args.recordKey)));
    need(false, "Choose a declared Haystack action.", "HAYSTACK_ACTION", 404);
  }
}
