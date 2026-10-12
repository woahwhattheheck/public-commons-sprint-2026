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

// Recovery journals and claims are immutable. A successor links a new claim
// after a released or dead predecessor; it never removes a predecessor claim.
const RECOVERY_RUNTIME_ID = newId();
const ACTIVE_RECOVERY_CLAIMS = new Set();
const RECOVERY_MAX_BYTES = 65536;

async function recoveryRead(path, maximum = RECOVERY_MAX_BYTES) {
  try {
    const bytes = await plainRead(path, maximum);
    return { value: json(bytes, maximum), sha256: sha256(bytes) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function recoveryPublish(directory, name, value) {
  const target = join(directory, name), temporary = target + ".candidate-" + newId();
  const bytes = Buffer.from(canonical(value) + "\n");
  let file;
  try {
    file = await fs.open(temporary, "wx", 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    try { await fs.link(temporary, target); }
    catch (error) { if (error.code === "EEXIST") return false; throw error; }
    await syncDirectory(directory);
    return true;
  } finally {
    if (file) await file.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
function recoveryProcessPresent(pid) {
  integer(pid, "original process PID", 1);
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}
async function recoveryWriterSnapshot(path) {
  let file;
  try { file = await fs.open(path, FS.O_RDONLY | (FS.O_NOFOLLOW || 0)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  try {
    const before = await file.stat({ bigint: true });
    need(before.isFile() && before.size <= 16384n,
      "The original writer must be a complete regular ownership file.", "HAYSTACK_WRITER_CHANGED", 409);
    const bytes = await file.readFile(), after = await file.stat({ bigint: true });
    need(BigInt(bytes.length) === before.size && fileSignature(before) === fileSignature(after),
      "Writer ownership changed while it was being read. Continue the same recovery request.",
      "HAYSTACK_WRITER_CHANGED", 409);
    return { bytes, sha256: sha256(bytes), device: before.dev.toString(),
      inode: before.ino.toString(), signature: fileSignature(before) };
  } finally { await file.close(); }
}
function recoveryWriterOwner(snapshot) {
  let owner;
  try { owner = json(snapshot.bytes, 16384); }
  catch (error) {
    if (error.code !== "HAYSTACK_JSON") throw error;
    need(false, "The current writer has not published a complete ownership record. Continue after its original process finishes publishing.",
      "HAYSTACK_WRITER", 423);
  }
  need(plain(owner) && owner.format === "commons.haystack.writer.v1",
    "The current file is not the original workspace writer.", "HAYSTACK_WRITER_CHANGED", 409);
  id(owner.id, "writer identity"); integer(owner.pid, "original writer PID", 1);
  need(typeof owner.host === "string" && owner.host.length > 0,
    "The original writer lacks its owning computer.", "HAYSTACK_WRITER_CHANGED", 409);
  return owner;
}
function recoveryValidateJournal(record, expectedLockId) {
  const journal = record.value;
  const legacy = plain(journal) && journal.format === undefined &&
    typeof journal.recoveredAt === "string" && Number.isSafeInteger(journal.recoveredBy);
  need(plain(journal) && (journal.format === "commons.haystack.writer-recovery.v1" || legacy) &&
    plain(journal.writer) && journal.writer.id === expectedLockId &&
    journal.writer.format === "commons.haystack.writer.v1" && journal.writer.host === hostname(),
    "Continue the exact original writer recovery on its owning computer.", "HAYSTACK_WRITER_RECOVERY", 409);
  integer(journal.writer.pid, "original writer PID", 1);
  if (!legacy) {
    const original = journal.originalLock;
    need(plain(original) && typeof original.device === "string" && /^\d+$/.test(original.device) &&
      typeof original.inode === "string" && /^\d+$/.test(original.inode),
      "The original recovery lacks its complete writer file identity.", "HAYSTACK_WRITER_RECOVERY", 409);
    hash(original.sha256, "original writer SHA-256");
  }
  return { ...record, legacy };
}
function recoveryValidateClaim(record, index, previousSha256, journalSha256) {
  const claim = record.value;
  need(plain(claim) && claim.format === "commons.haystack.writer-recovery-claim.v1" &&
    claim.journalSha256 === journalSha256 && claim.index === index &&
    claim.previousSha256 === previousSha256 && claim.host === hostname(),
    "The original recovery claim chain differs.", "HAYSTACK_WRITER_RECOVERY", 409);
  id(claim.id, "recovery claim identity"); id(claim.runtimeId, "recovery runtime identity");
  integer(claim.pid, "recovery process PID", 1);
  return record;
}
async function recoveryAcquireClaim(directory, journalSha256) {
  let index = 0, previousSha256 = null;
  for (;;) {
    const name = index + ".json", path = join(directory, name);
    let retained = await recoveryRead(path);
    if (!retained) {
      const claim = { format: "commons.haystack.writer-recovery-claim.v1", id: newId(),
        index, previousSha256, journalSha256, pid: process.pid, host: hostname(),
        runtimeId: RECOVERY_RUNTIME_ID, createdAt: now() };
      let owned = false;
      ACTIVE_RECOVERY_CLAIMS.add(claim.id);
      try {
        owned = await recoveryPublish(directory, name, claim);
        if (owned) return { ...claim, directory, name };
      } finally {
        if (!owned) ACTIVE_RECOVERY_CLAIMS.delete(claim.id);
      }
      retained = await recoveryRead(path);
      need(retained, "The original recovery claim disappeared.", "HAYSTACK_WRITER_RECOVERY", 409);
    }
    recoveryValidateClaim(retained, index, previousSha256, journalSha256);
    const claim = retained.value;
    // Existing successors are the authoritative chain even if an old PID has
    // since been reused. Validate every link before inspecting its live tail.
    if (await recoveryRead(join(directory, (index + 1) + ".json"))) {
      previousSha256 = retained.sha256; index += 1; continue;
    }
    const released = await recoveryRead(join(directory, index + ".released.json"));
    let mayContinue = false;
    if (released) {
      need(released.value.format === "commons.haystack.writer-recovery-release.v1" &&
        released.value.claimId === claim.id && released.value.claimSha256 === retained.sha256 &&
        released.value.journalSha256 === journalSha256,
        "The original recovery release differs.", "HAYSTACK_WRITER_RECOVERY", 409);
      mayContinue = true;
    } else if (claim.pid === process.pid && claim.runtimeId === RECOVERY_RUNTIME_ID &&
      !ACTIVE_RECOVERY_CLAIMS.has(claim.id)) {
      // This exact module invocation has finished, including its last file action.
      // This also permits retry after a release write failed in the same process.
      mayContinue = true;
    } else mayContinue = !recoveryProcessPresent(claim.pid);
    need(mayContinue,
      "The original recovery invocation is active. Continue the same request after it finishes.",
      "HAYSTACK_WRITER_RECOVERY_ACTIVE", 423, { retryAfterSeconds: 1, recoveryClaimId: claim.id });
    previousSha256 = retained.sha256; index += 1;
  }
}
async function recoveryReleaseClaim(claim) {
  try {
    const retained = await recoveryRead(join(claim.directory, claim.name));
    need(retained?.value.id === claim.id, "The original recovery claim changed.", "HAYSTACK_WRITER_RECOVERY", 409);
    await recoveryPublish(claim.directory, claim.index + ".released.json", {
      format: "commons.haystack.writer-recovery-release.v1", claimId: claim.id,
      claimSha256: retained.sha256, journalSha256: claim.journalSha256, releasedAt: now()
    });
  } finally {
    // After this deletion no code owned by this invocation mutates writer.lock.
    ACTIVE_RECOVERY_CLAIMS.delete(claim.id);
  }
}
function recoveryValidateResult(record, journal, expectedLockId) {
  const receipt = record.value;
  need(plain(receipt) && receipt.format === "commons.haystack.writer-recovery-result.v1" &&
    receipt.journalSha256 === journal.sha256 && receipt.writerId === expectedLockId &&
    plain(receipt.result) && receipt.result.recovered === expectedLockId &&
    digest(receipt.result.writer) === digest(journal.value.writer),
    "The original completed writer recovery differs.", "HAYSTACK_WRITER_RECOVERY", 409);
  return receipt.result;
}

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
    this.lockPath = join(this.directory, "writer.lock"); this.fileChecks = new Map(); this.stateCache = null;
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
    const file = await fs.open(this.statePath, FS.O_RDONLY | (FS.O_NOFOLLOW || 0));
    try {
      const stat = await file.stat({ bigint: true }), signature = fileSignature(stat);
      need(stat.isFile() && stat.size <= BigInt(STATE_MAX_BYTES), "Read the complete original workspace within its declared capacity.", "HAYSTACK_WORKSPACE", 409);
      if (this.stateCache?.signature === signature) return clone(this.stateCache.state);
      const bytes = await file.readFile();
      need(BigInt(bytes.length) === stat.size && fileSignature(await file.stat({ bigint: true })) === signature,
        "The original workspace changed during this read. Read its complete current revision.", "HAYSTACK_WORKSPACE_CHANGED", 409);
      const state = validateState(json(bytes, STATE_MAX_BYTES));
      this.stateCache = { signature, state }; return clone(state);
    } finally { await file.close(); }
  }
  async writer() {
    try { return json(await plainRead(this.lockPath, 16384), 16384); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async withWriter(action) {
    const owner = { format: "commons.haystack.writer.v1", id: newId(),
      pid: process.pid, host: hostname(), createdAt: now() };
    const candidate = this.lockPath + ".candidate-" + owner.id;
    let file = null, originalStat = null, created = false, linked = false;
    try {
      // An interrupted private candidate never occupies writer.lock. Publish
      // only after every byte of its ownership record is written and synced.
      file = await fs.open(candidate, "wx", 0o600); created = true;
      originalStat = await file.stat({ bigint: true });
      await file.writeFile(canonical(owner) + "\n"); await file.sync();
      try { await fs.link(candidate, this.lockPath); linked = true; }
      catch (error) {
        if (error.code === "EEXIST") need(false,
          "The original workspace writer is active. Continue the same request after it completes.",
          "HAYSTACK_WRITER", 423, { retryAfterSeconds: 1 });
        throw error;
      }
      await fs.unlink(candidate); created = false;
      await syncDirectory(this.directory);
      return await action();
    } finally {
      try {
        if (linked) {
          const retained = await fs.lstat(this.lockPath, { bigint: true });
          need(retained.isFile() && retained.dev === originalStat.dev && retained.ino === originalStat.ino,
            "The original writer ownership changed.", "HAYSTACK_WRITER_CHANGED", 409);
          await fs.unlink(this.lockPath);
          await syncDirectory(this.directory);
        }
      } finally {
        try { if (file) await file.close(); }
        finally {
          if (created) await fs.unlink(candidate).catch(error => { if (error.code !== "ENOENT") throw error; });
        }
      }
    }
  }
  async recoverWriter(expectedLockId) {
    id(expectedLockId, "writer identity");
    const journalName = "writer-recovery-" + expectedLockId + ".json";
    const journalPath = join(this.directory, journalName);
    const resultName = "writer-recovery-" + expectedLockId + ".completed.json";
    const resultPath = join(this.directory, resultName);
    let journal = await recoveryRead(journalPath);
    if (!journal) {
      const original = await recoveryWriterSnapshot(this.lockPath);
      need(original, "The selected original writer is no longer present and has no retained recovery request.",
        "HAYSTACK_WRITER_CHANGED", 409);
      const owner = recoveryWriterOwner(original);
      need(owner.id === expectedLockId && owner.host === hostname(),
        "Recover the exact original writer on its owning computer.", "HAYSTACK_WRITER_CHANGED", 409);
      need(!recoveryProcessPresent(owner.pid), "The original writer process is still present.", "HAYSTACK_WRITER", 423);
      await recoveryPublish(this.directory, journalName, {
        format: "commons.haystack.writer-recovery.v1", writer: owner,
        originalLock: { device: original.device, inode: original.inode, sha256: original.sha256 },
        startedAt: now(), requestedBy: { pid: process.pid, host: hostname() }
      });
      journal = await recoveryRead(journalPath);
      need(journal, "The original recovery journal disappeared.", "HAYSTACK_WRITER_RECOVERY", 409);
    }
    journal = recoveryValidateJournal(journal, expectedLockId);
    let completed = await recoveryRead(resultPath);
    if (completed) return { ...clone(recoveryValidateResult(completed, journal, expectedLockId)), replayed: true };

    const claimDirectory = join(this.directory, "writer-recovery-" + expectedLockId + ".claims");
    try { await fs.mkdir(claimDirectory, { mode: 0o700 }); await syncDirectory(this.directory); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const directory = await fs.lstat(claimDirectory);
    need(directory.isDirectory() && !directory.isSymbolicLink(),
      "Use the original recovery claim directory.", "HAYSTACK_WRITER_RECOVERY", 409);
    let claim;
    try { claim = await recoveryAcquireClaim(claimDirectory, journal.sha256); }
    catch (error) {
      completed = await recoveryRead(resultPath);
      if (completed) return { ...clone(recoveryValidateResult(completed, journal, expectedLockId)), replayed: true };
      throw error;
    }
    let finished = false;
    try {
      // A predecessor may have completed while this invocation was reading its chain.
      completed = await recoveryRead(resultPath);
      if (completed) {
        finished = true;
        return { ...clone(recoveryValidateResult(completed, journal, expectedLockId)), replayed: true };
      }
      const snapshot = await recoveryWriterSnapshot(this.lockPath);
      let originalLockState = "already-absent";
      if (snapshot) {
        const original = journal.value.originalLock;
        if (original && (snapshot.device !== original.device || snapshot.inode !== original.inode)) {
          originalLockState = "replaced";
        } else {
          const owner = recoveryWriterOwner(snapshot);
          if (owner.id !== expectedLockId) originalLockState = "replaced";
          else {
            need(digest(owner) === digest(journal.value.writer) &&
              (!original || snapshot.sha256 === original.sha256),
              "The selected writer differs from its original recovery journal.", "HAYSTACK_WRITER_CHANGED", 409);
            need(!recoveryProcessPresent(owner.pid),
              "The original writer process is still present.", "HAYSTACK_WRITER", 423);
            const retained = await fs.lstat(this.lockPath, { bigint: true });
            need(retained.isFile() && fileSignature(retained) === snapshot.signature,
              "Writer ownership changed before recovery.", "HAYSTACK_WRITER_CHANGED", 409);
            // Only this live invocation owns the immutable claim. A normal writer
            // cannot create writer.lock while the original exists, and a successor
            // cannot recover it until this invocation has finished or its PID stops.
            await fs.unlink(this.lockPath);
            await syncDirectory(this.directory);
            originalLockState = "removed";
          }
        }
      }
      const result = { recovered: expectedLockId, writer: clone(journal.value.writer),
        recoveredAt: now(), originalLockState };
      await recoveryPublish(this.directory, resultName, {
        format: "commons.haystack.writer-recovery-result.v1", writerId: expectedLockId,
        journalSha256: journal.sha256, claimId: claim.id, result
      });
      completed = await recoveryRead(resultPath);
      need(completed, "The original recovery result has not completed.", "HAYSTACK_WRITER_RECOVERY", 409);
      const saved = recoveryValidateResult(completed, journal, expectedLockId);
      finished = true;
      return { ...clone(saved), replayed: false };
    } finally {
      if (finished) ACTIVE_RECOVERY_CLAIMS.delete(claim.id);
      else {
        // Release is the last possible side effect of this failed invocation.
        // A failed release remains recoverable after process exit, or on retry
        // in this exact runtime once the in-memory invocation has finished.
        await recoveryReleaseClaim(claim).catch(() => {});
      }
    }
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
        diagnostics: sourceDiagnostics(view).filter(item => item.recordKey === record.key || (record.diagnosticIds || []).includes(item.id)) };
    }
    if (action === "diagnostics.list") {
      const relatedIds = new Set(args.recordKey ? view.records.find(record => record.key === args.recordKey)?.diagnosticIds || [] : []);
      return paginate(sourceDiagnostics(view).filter(item =>
        (!args.severity || item.severity === args.severity) && (!args.sourceId || item.sourceId === args.sourceId) &&
        (!args.recordKey || item.recordKey === args.recordKey || relatedIds.has(item.id))));
    }
    need(false, "Choose a declared Haystack action.", "HAYSTACK_ACTION", 404);
  }
}
