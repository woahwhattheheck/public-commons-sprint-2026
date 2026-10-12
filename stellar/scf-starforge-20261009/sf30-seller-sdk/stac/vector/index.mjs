/** Complete original-file native GIS operations; no provider acquisition or order state. */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, stat, rename, open as openFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve, dirname, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExactJSON, stringifyExactJSON } from "./json.mjs";
export { ExactNumber, parseExactJSON, stringifyExactJSON } from "./json.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = resolve(HERE, "engine.py");
const MAX_RESULT = 256 * 1024 * 1024;
const PATH_KEYS = new Set(["directory", "sourceDirectory", "captureDirectory", "sourceRoot",
  "beforeDirectory", "afterDirectory", "selectionFile", "profileFile", "archivePath"]);

export class VectorOperationError extends Error {
  constructor(code, detail, native = undefined) {
    super(code + (detail === undefined ? "" : ": " + (typeof detail === "string" ? detail : stringifyExactJSON(detail))));
    this.name = "VectorOperationError"; this.code = code; this.detail = detail; this.native = native;
  }
}
function need(value, code, detail) { if (!value) throw new VectorOperationError(code, detail); }
async function atomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + "." + randomUUID() + ".receiving";
  const file = await openFile(tmp, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await rename(tmp, path);
}
export function normalizeRequest(request) {
  need(request && typeof request === "object" && !Array.isArray(request), "VECTOR_REQUEST_REQUIRED");
  return Object.fromEntries(Object.entries(request).map(([key, value]) => {
    if (PATH_KEYS.has(key)) {
      need(typeof value === "string" && value, "VECTOR_PATH_REQUIRED", key);
      return [key, resolve(value)];
    }
    return [key, value];
  }));
}
export async function runVectorCommand(request, options = {}) {
  request = normalizeRequest(request);
  const python = options.python || process.env.STARFORGE_VECTOR_PYTHON || "python3";
  need(typeof python === "string" && python && !python.includes("\0"), "VECTOR_PYTHON_REQUIRED");
  const body = stringifyExactJSON(request) + "\n";
  const logDirectory = options.logDirectory ? resolve(options.logDirectory) : null;
  let logBase = null;
  if (logDirectory) {
    await mkdir(logDirectory, { recursive: true, mode: 0o700 });
    logBase = resolve(logDirectory, "native-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID());
    await atomic(logBase + ".request.json", body);
  }
  const startedAt = new Date().toISOString();
  const result = await new Promise(resolvePromise => {
    let child, timer, error = null, bytes = 0, stderrBytes = 0, overflow = false, killTimer;
    const output = [], errors = [];
    const stop = reason => {
      if (!error) error = reason;
      child?.kill("SIGTERM");
      killTimer = setTimeout(() => child?.kill("SIGKILL"), 5000);
      killTimer.unref();
    };
    try {
      child = spawn(python, [ENGINE], { stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PROJ_NETWORK: "OFF" }, windowsHide: true });
    } catch (exc) {
      resolvePromise({ exitCode: null, signal: null, stdout: "", stderr: "", launchError: String(exc) }); return;
    }
    const aborted = () => stop("VECTOR_NATIVE_CANCELLED");
    if (options.signal) {
      if (options.signal.aborted) aborted();
      else options.signal.addEventListener("abort", aborted, { once: true });
    }
    if (options.timeoutMs > 0) timer = setTimeout(() => stop("VECTOR_NATIVE_TIMEOUT"), options.timeoutMs);
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes <= MAX_RESULT) output.push(chunk);
      else if (!overflow) { overflow = true; stop("VECTOR_NATIVE_RESULT_TOO_LARGE"); }
    });
    child.stderr.on("data", chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_RESULT) errors.push(chunk);
      else stop("VECTOR_NATIVE_STDERR_TOO_LARGE");
    });
    child.on("error", exc => { error = String(exc); });
    child.stdin.on("error", exc => { if (exc.code !== "EPIPE") error = String(exc); });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", aborted);
      resolvePromise({ exitCode, signal, stdout: Buffer.concat(output).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8"), launchError: error,
        outputBytes: bytes, stderrBytes, completeOutput: !overflow && stderrBytes <= MAX_RESULT });
    });
    child.stdin.end(body);
  });
  const native = { ...result, startedAt, completedAt: new Date().toISOString(),
    python, engine: ENGINE, request, requestFile: logBase ? logBase + ".request.json" : null,
    resultFile: logBase ? logBase + ".result.json" : null };
  if (logBase) {
    await atomic(logBase + ".stdout.json", result.stdout);
    await atomic(logBase + ".stderr.log", result.stderr);
    await atomic(logBase + ".result.json", stringifyExactJSON(native) + "\n");
  }
  let parsed;
  try { parsed = parseExactJSON(result.stdout); }
  catch (exc) { throw new VectorOperationError(result.launchError || "VECTOR_NATIVE_RESPONSE_INVALID", String(exc), native); }
  if (result.exitCode !== 0 || !parsed.ok)
    throw new VectorOperationError(parsed.error?.code || result.launchError || "VECTOR_NATIVE_OPERATION_FAILED",
      parsed.error?.detail || { exitCode: result.exitCode, signal: result.signal }, native);
  need(result.completeOutput && !result.launchError, "VECTOR_NATIVE_OUTPUT_INCOMPLETE", native);
  return { ...parsed.result, native };
}
export async function captureVectorSelection(selection, directory, options = {}) {
  const request = { command: "capture", directory, sourceRoot: options.sourceRoot || process.cwd() };
  if (typeof selection === "string") request.selectionFile = selection;
  else request.selection = selection;
  return runVectorCommand(request, options);
}
export const openVectorCapture = (directory, options = {}) => runVectorCommand(
  { command: "inspect", directory, expectedManifestSha256: options.expectedManifestSha256 }, options);
export const exportVectorCapture = (captureDirectory, directory, profile, operationId, options = {}) =>
  runVectorCommand({ command: "export", captureDirectory, directory, operationId,
    ...(typeof profile === "string" ? { profileFile: profile } : { profile }) }, options);
export const openVectorExport = (directory, options = {}) => runVectorCommand(
  { command: "open", directory, expectedManifestSha256: options.expectedManifestSha256,
    native: options.native !== false }, options);
export const receiveVectorExport = (sourceDirectory, directory, options = {}) => runVectorCommand(
  { command: "receive", sourceDirectory, directory, expectedManifestSha256: options.expectedManifestSha256 }, options);
export const compareVectorCaptures = (beforeDirectory, afterDirectory, directory, operationId, options = {}) =>
  runVectorCommand({ command: "compare", beforeDirectory, afterDirectory, directory, operationId,
    beforeManifestSha256: options.beforeManifestSha256, afterManifestSha256: options.afterManifestSha256 }, options);
export const openVectorComparison = (directory, options = {}) => runVectorCommand(
  { command: "open-comparison", directory, expectedManifestSha256: options.expectedManifestSha256 }, options);
export const vectorChanges = (directory, options = {}) => runVectorCommand({
  command: "changes", directory, expectedManifestSha256: options.expectedManifestSha256,
  offset: options.offset ?? 0, limit: options.limit ?? 100, layerId: options.layerId, status: options.status,
}, options);
export const receiveVectorComparison = (sourceDirectory, directory, options = {}) => runVectorCommand(
  { command: "receive-comparison", sourceDirectory, directory,
    expectedManifestSha256: options.expectedManifestSha256 }, options);

function localMember(directory, path) {
  need(typeof path === "string" && path && !isAbsolute(path) && !path.includes("\\") &&
    !path.split("/").some(part => !part || part === "." || part === ".."), "VECTOR_SOURCE_MEMBER_INVALID", path);
  const target = resolve(directory, path);
  need(!relative(resolve(directory), target).startsWith(".." + sep), "VECTOR_SOURCE_MEMBER_ESCAPES_ROOT");
  return target;
}
async function descriptor(directory, path) {
  const source = localMember(directory, path), info = await stat(source);
  need(info.isFile(), "VECTOR_SOURCE_FILE_REQUIRED", path);
  const hash = createHash("sha256"); let bytes = 0;
  for await (const part of createReadStream(source)) { hash.update(part); bytes += part.length; }
  need(bytes === info.size, "VECTOR_SOURCE_CHANGED_WHILE_READING", path);
  return { path, bytes, sha256: hash.digest("hex") };
}
/** Derive a selection from the verified, already received STAC delivery. */
export async function selectionFromStac(directory, options = {}) {
  const { openPortableStacDelivery } = await import("../receiving/delivery.mjs");
  const received = await openPortableStacDelivery(resolve(directory), {
    expectedManifestSha256: options.expectedManifestSha256, signal: options.signal });
  const paths = options.assetPaths || ["scene-footprints.geojson"];
  need(Array.isArray(paths) && paths.length, "VECTOR_SELECTED_STAC_FILES_REQUIRED");
  const sources = [];
  const resolveReceived = path => {
    if (path.startsWith("edition/")) {
      const originalPath = path.slice("edition/".length);
      const record = received.delivery.members().find(item => item.path === originalPath);
      need(record, "VECTOR_STAC_MEMBER_NOT_RECEIVED", path);
      return { file: received.delivery.file(originalPath),
        record: { path, bytes: record.bytes, sha256: record.sha256 } };
    }
    const file = received.file(path);
    return { file, record: { path, bytes: file.record.bytes, sha256: file.record.sha256 } };
  };
  async function verifiedDescriptor(path) {
    const original = resolveReceived(path);
    await original.file.verify({ signal: options.signal });
    const observed = await descriptor(directory, path);
    need(observed.bytes === original.record.bytes && observed.sha256 === original.record.sha256,
      "VECTOR_ORIGINAL_STAC_FILE_CHANGED", { original: original.record, observed });
    return original.record;
  }
  for (const choice of paths) {
    const path = typeof choice === "string" ? choice : choice.path;
    const selected = typeof choice === "object" ? choice : {};
    const record = await verifiedDescriptor(path), members = [];
    for (const companion of selected.members || []) {
      const companionPath = typeof companion === "string" ? companion : companion.path;
      members.push(await verifiedDescriptor(companionPath));
    }
    sources.push({ ...selected,
      id: selected.id || "stac-vector-" + createHash("sha256").update(path).digest("hex").slice(0, 20),
      ...record, members, identity: selected.identity || { mode: "feature-id" } });
  }
  return { schema: "starforge.vector-selection.v1", id: options.selectionId || "received-stac-vectors",
    sourceEdition: { schema: "starforge.vector-stac-source.v1",
      portableManifest: received.manifestFile.record, sourceDelivery: received.manifest.sourceDelivery,
      sourceEdition: received.manifest.sourceEdition, edition: received.delivery.edition }, sources };
}

export async function captureStacVectors(directory, captureDirectory, options = {}) {
  const selection = await selectionFromStac(directory, options);
  return captureVectorSelection(selection, captureDirectory, { ...options, sourceRoot: directory });
}

/** Complete original customer delivery -> portable source -> native vector export. */
export async function materializeStacVectors(customerDirectory, options = {}) {
  const { StacDelivery } = await import("../customer.mjs");
  const { exportPortableStacDelivery } = await import("../receiving/delivery.mjs");
  need(options.portableDirectory && options.captureDirectory && options.directory && options.operationId,
    "VECTOR_STAC_OUTPUT_DIRECTORIES_REQUIRED");
  const delivery = await StacDelivery.open(resolve(customerDirectory), { signal: options.signal });
  const portable = await exportPortableStacDelivery(delivery, resolve(options.portableDirectory),
    { signal: options.signal, progress: options.progress });
  const captured = await captureStacVectors(portable.directory, options.captureDirectory, options);
  const exported = await exportVectorCapture(captured.directory, options.directory,
    options.profile, options.operationId, options);
  return { portable, capture: captured, export: exported };
}

export const createVectorBundle = (directory, archivePath, options = {}) => runVectorCommand(
  { command: "bundle", directory, archivePath, expectedManifestSha256: options.expectedManifestSha256 }, options);
export const receiveVectorBundle = (archivePath, directory, options = {}) => runVectorCommand(
  { command: "receive-bundle", archivePath, directory, expectedManifestSha256: options.expectedManifestSha256,
    expectedArchiveSha256: options.expectedArchiveSha256 }, options);
