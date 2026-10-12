import { promises as fs } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { plainRead, createOnlyFile, atomicWrite, exists, syncDirectory } from "./files.mjs";
import { canonical, sha256, digest, json, need, id, now, plain, clone, HaystackError } from "./util.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT_MAX = 64 * 1024 * 1024;
const SOURCE_FILES = ["SEMANTIC_NATIVE.md", "install_semantic_runtime.py", "requirements-semantic.txt",
  "semantic-brick-LICENSE.txt", "semantic-brick.ttl", "semantic-catalog.json", "semantic-dependencies.json",
  "semantic-standard.json", "semantic_native.py"];
let catalogCache;
function same(left, right) { return digest(left) === digest(right); }
export async function semanticCatalog() {
  const path = join(ROOT, "semantic-catalog.json"), bytes = await plainRead(path, 16 * 1024 * 1024), identity = sha256(bytes);
  if (catalogCache?.sha256 === identity) return clone(catalogCache.result);
  const result = json(bytes, 16 * 1024 * 1024);
  need(result.ok === true && result.action === "catalog", "Use the complete native-generated standard catalogue.", "HAYSTACK_SEMANTIC_CATALOG", 409);
  catalogCache = { sha256: identity, result: { ...result, catalogueSha256: identity, catalogueBytes: bytes.length } };
  return clone(catalogCache.result);
}
async function sourceIdentity() {
  const files = [];
  for (const name of SOURCE_FILES) {
    const bytes = await plainRead(join(ROOT, name), 16 * 1024 * 1024);
    files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return { files, sha256: digest(files) };
}
async function privateDirectory(path) {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink(), "Use the original private native receiving directory.", "HAYSTACK_SEMANTIC_NATIVE_DIRECTORY", 409);
}
async function retainFile(path, bytes) {
  if (await exists(path)) {
    const previous = await plainRead(path, bytes.length);
    need(previous.length === bytes.length && sha256(previous) === sha256(bytes), "An original native request file belongs to other bytes.", "HAYSTACK_SEMANTIC_NATIVE_REQUEST", 409);
  } else await createOnlyFile(path, bytes);
}
async function retainedResult(path, input, source) {
  if (!await exists(path)) return null;
  const bytes = await plainRead(path, OUTPUT_MAX), result = json(bytes, OUTPUT_MAX);
  need(plain(result) && result.schema === "commons.haystack.semantic-native-result.v1" && typeof result.ok === "boolean",
    "The original native adapter returned an incomplete result.", "HAYSTACK_SEMANTIC_NATIVE_RESULT", 409);
  if (result.action) need(result.action === input.action, "The native result belongs to another action.", "HAYSTACK_SEMANTIC_NATIVE_RESULT", 409);
  if (input.action === "validate" && result.ok) need(result.modelId === input.model.modelId && result.versionId === input.model.versionId && result.contentSha256 === input.model.contentSha256,
    "The native result belongs to another exact model version.", "HAYSTACK_SEMANTIC_NATIVE_RESULT", 409);
  if (input.action === "inspect" && result.ok) need(result.file?.sha256 === input.file.sha256 && result.file?.bytes === input.file.bytes,
    "The native inspection belongs to another source file.", "HAYSTACK_SEMANTIC_NATIVE_RESULT", 409);
  return { result, bytes: bytes.length, sha256: sha256(bytes), sourceSha256: source.sha256 };
}
async function matchingProcesses(adapter, inputPath, outputPath) {
  // Narrow process observation only; it does not alter any other operation.
  let entries;
  try { entries = await fs.readdir("/proc"); }
  catch { return { known: false, pids: [] }; }
  const pids = []; let uncertain = false;
  for (const entry of entries) {
    if (!/^[0-9]+$/.test(entry)) continue;
    try {
      const processRoot = "/proc/" + entry;
      if (typeof process.getuid === "function" && (await fs.stat(processRoot)).uid !== process.getuid()) continue;
      const command = (await fs.readFile(processRoot + "/cmdline")).toString("utf8").split("\0");
      if (command.includes(adapter) && command.includes(inputPath) && command.includes(outputPath)) pids.push(Number(entry));
    } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) uncertain = true; }
  }
  return { known: !uncertain, pids };
}
function acceptResult(saved, binding, { replayed, attempt = null, process: processReceipt = null } = {}) {
  if (!saved.result.ok) throw new HaystackError(saved.result.error?.code || "HAYSTACK_SEMANTIC_NATIVE",
    saved.result.error?.message || "The retained native operation failed.", 422,
    { nativeOperationId: binding.operationId, resultSha256: saved.sha256, process: processReceipt, error: saved.result.error });
  if (processReceipt) need(processReceipt.code === 0 && !processReceipt.signal && !processReceipt.spawnError && !processReceipt.limitExceeded && !processReceipt.timeout,
    "The native adapter saved a result but its observed process did not complete successfully.",
    "HAYSTACK_SEMANTIC_NATIVE_EXIT", 422, { ...processReceipt, resultSha256: saved.sha256 });
  return { result: saved.result, execution: { ...binding, attempt, process: processReceipt,
    completionObserved: processReceipt !== null, resultSha256: saved.sha256, resultBytes: saved.bytes, replayed } };
}
async function latestAttempt(attemptsDirectory, operationId) {
  const numbers = (await fs.readdir(attemptsDirectory)).filter(name => /^(0|[1-9][0-9]*)\.json$/.test(name))
    .map(name => Number(name.slice(0, -5))).sort((a, b) => a - b);
  const attempt = numbers.at(-1);
  if (attempt === undefined) return { attempt: null, next: 0, process: null };
  const intent = json(await plainRead(join(attemptsDirectory, attempt + ".json"), 65536), 65536);
  need(intent.operationId === operationId && intent.attempt === attempt, "The original native attempt identity differs.", "HAYSTACK_SEMANTIC_NATIVE_REQUEST", 409);
  const path = join(attemptsDirectory, attempt + ".completed.json");
  const processReceipt = await exists(path) ? json(await plainRead(path, 65536), 65536) : null;
  if (processReceipt) need(processReceipt.operationId === operationId && processReceipt.attempt === attempt,
    "The native completion belongs to another attempt.", "HAYSTACK_SEMANTIC_NATIVE_REQUEST", 409);
  return { attempt, next: attempt + 1, process: processReceipt };
}
export async function runSemanticNative(workspaceDirectory, operationId, input) {
  id(operationId);
  const directory = join(resolve(workspaceDirectory), "semantic-native", operationId);
  await privateDirectory(directory);
  const inputPath = join(directory, "input.json"), outputPath = join(directory, "result.json"), identityPath = join(directory, "identity.json");
  const source = await sourceIdentity(), inputBytes = Buffer.from(canonical(input) + "\n"), inputSha256 = sha256(inputBytes);
  const binding = { format: "commons.haystack.semantic-native-request.v1", operationId, inputSha256, inputBytes: inputBytes.length,
    source, adapter: join(ROOT, "semantic_native.py"), python: process.env.HAYSTACK_SEMANTIC_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || "python3" };
  if (await exists(identityPath)) {
    const original = json(await plainRead(identityPath, 65536), 65536);
    need(same(original, binding), "Continue this native request with its exact original input, source and Python selection.", "HAYSTACK_SEMANTIC_NATIVE_REQUEST", 409);
  } else await createOnlyFile(identityPath, Buffer.from(canonical(binding) + "\n"));
  await retainFile(inputPath, inputBytes);
  const attemptsDirectory = join(directory, "attempts"); await privateDirectory(attemptsDirectory);
  const previous = await latestAttempt(attemptsDirectory, operationId);
  if (previous.attempt !== null && !previous.process) {
    const active = await matchingProcesses(binding.adapter, inputPath, outputPath);
    need(active.known && !active.pids.length, "The original validation process is still running or cannot yet be conclusively observed. Continue this same request after it finishes.",
      "HAYSTACK_SEMANTIC_NATIVE_ACTIVE", 423, { operationId, pids: active.pids, retryAfterSeconds: 1 });
  }
  let saved = await retainedResult(outputPath, input, source);
  if (saved) return acceptResult(saved, binding, { replayed: true, attempt: previous.attempt, process: previous.process });
  const attempt = previous.next, attemptPath = join(attemptsDirectory, attempt + ".json");
  await createOnlyFile(attemptPath, Buffer.from(canonical({ format: "commons.haystack.semantic-native-attempt.v1", operationId, attempt,
    host: hostname(), parentPid: process.pid, startedAt: now(), inputSha256, sourceSha256: source.sha256 }) + "\n"));
  const stderr = []; let outputBytes = 0, errorBytes = 0, limitExceeded = false, timeout = false, metadataError = null;
  let child, timer, killTimer, exited;
  const terminate = () => {
    child.kill("SIGTERM");
    if (!killTimer) killTimer = setTimeout(() => child.kill("SIGKILL"), 10000);
  };
  try {
    child = spawn(binding.python, ["-B", binding.adapter, "--input", inputPath, "--output", outputPath], {
      cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
    });
    // Attach all lifecycle listeners before the first asynchronous metadata write.
    const completion = new Promise(resolve => {
      child.once("error", error => resolve({ code: null, signal: null, spawnError: { code: String(error.code || "SPAWN_ERROR"), message: String(error.message) } }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    child.stdout.on("data", chunk => { outputBytes += chunk.length; if (outputBytes > OUTPUT_MAX) { limitExceeded = true; terminate(); } });
    child.stderr.on("data", chunk => {
      const room = Math.max(0, 2 * 1024 * 1024 - errorBytes);
      if (room) stderr.push(chunk.subarray(0, room));
      errorBytes += chunk.length;
      if (errorBytes > 2 * 1024 * 1024) { limitExceeded = true; terminate(); }
    });
    timer = setTimeout(() => { timeout = true; terminate(); }, 300000);
    try {
      await atomicWrite(join(attemptsDirectory, attempt + ".process.json"), Buffer.from(canonical({ operationId, attempt, pid: child.pid || null,
        parentPid: process.pid, host: hostname(), observedAt: now(), inputSha256, adapter: binding.adapter }) + "\n"));
    } catch (error) {
      // A full filesystem must not orphan an already-created child. Await its
      // actual outcome and retain the failed metadata observation with that outcome.
      metadataError = { code: String(error.code || "METADATA_WRITE"), message: String(error.message) };
    }
    exited = await completion;
  } finally { if (timer) clearTimeout(timer); if (killTimer) clearTimeout(killTimer); }
  const processReceipt = { operationId, attempt, ...exited, outputBytes, errorBytes, limitExceeded, timeout, metadataError, completedAt: now() };
  await createOnlyFile(join(attemptsDirectory, attempt + ".completed.json"), Buffer.from(canonical(processReceipt) + "\n"));
  if (stderr.length) await createOnlyFile(join(attemptsDirectory, attempt + ".stderr"), Buffer.concat(stderr));
  need(!exited.spawnError, "The selected Python runtime could not start. Its original attempt is retained.", "HAYSTACK_SEMANTIC_NATIVE_SPAWN", 503, processReceipt);
  need(!limitExceeded && !timeout, timeout ? "The original native validation exceeded its five-minute runtime." : "The complete native output exceeded its declared capacity.",
    "HAYSTACK_SEMANTIC_NATIVE_CAPACITY", 422, processReceipt);
  saved = await retainedResult(outputPath, input, source);
  need(saved, "The original native process ended before saving its complete result. Its attempt is retained; continue the same request.", "HAYSTACK_SEMANTIC_NATIVE_INCOMPLETE", 503, processReceipt);
  await syncDirectory(directory);
  return acceptResult(saved, binding, { replayed: false, attempt, process: processReceipt });
}
