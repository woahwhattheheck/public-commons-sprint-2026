#!/usr/bin/env node
// MIT. Native Java producer preparation and continuation using the original workspace connection.
import { promises as fs, constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve, join, dirname, delimiter, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { producerConfiguration } from "./producer.mjs";
import { LineageWorkspace } from "./store.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
export const JAVA_PRODUCER_VERSION = "1.53.0";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const exists = async path => fs.access(path).then(() => true, error => {
  if (error.code === "ENOENT") return false; throw error;
});
async function json(path) { return JSON.parse(await ordinary(path)); }
async function ordinary(path) {
  const before = await fs.lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("Keep the original ordinary producer file: " + path);
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("Producer file changed while opening: " + path);
    const bytes = await handle.readFile(), after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || bytes.length !== opened.size)
      throw new Error("Producer file changed while reading: " + path);
    return bytes;
  } finally { await handle.close(); }
}
async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await fs.open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
function pendingPath(path, bytes) { return join(dirname(path), "." + basename(path) + ".pending-" + hash(bytes)); }
async function completedPending(path, bytes) {
  const temporary = pendingPath(path, bytes);
  const handle = await fs.open(temporary, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error("Keep the original independent producer staging file: " + temporary);
    const prefix = await handle.readFile();
    if (prefix.length > bytes.length || !bytes.subarray(0, prefix.length).equals(prefix))
      throw new Error("Retained producer staging prefix differs: " + temporary);
    let offset = prefix.length;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (!bytesWritten) throw new Error("Producer staging write made no progress");
      offset += bytesWritten;
    }
    await handle.sync();
    const captured = await ordinary(temporary);
    if (!captured.equals(bytes)) throw new Error("Complete producer staging file differs: " + temporary);
  } finally { await handle.close(); }
  return temporary;
}
async function save(path, value) {
  const temporary = await completedPending(path, encoded(value));
  await fs.rename(temporary, path); await syncDirectory(dirname(path));
}
async function retainBeforeReplacement(path, bytes, expectedStat) {
  const backup = join(dirname(path), "." + basename(path) + ".interrupted-" + hash(bytes));
  try { await fs.link(path, backup); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await ordinary(backup)).equals(bytes)) throw new Error("Retained interrupted file differs: " + backup);
  }
  const current = await fs.lstat(path);
  if (current.dev !== expectedStat.dev || current.ino !== expectedStat.ino ||
      current.size !== expectedStat.size || current.mtimeMs !== expectedStat.mtimeMs ||
      !(await ordinary(path)).equals(bytes))
    throw new Error("Original producer file changed before its completed publication: " + path);
  await syncDirectory(dirname(path));
  return backup;
}
async function newOrSame(path, input, { replaceUnverified = false } = {}) {
  const bytes = Buffer.from(input);
  let prior = null, info = null;
  try { prior = await ordinary(path); info = await fs.lstat(path); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (prior?.equals(bytes)) return { path, bytes: bytes.length, sha256: hash(bytes), alreadyPresent: true };
  if (prior && !replaceUnverified && (prior.length >= bytes.length || !bytes.subarray(0, prior.length).equals(prior)))
    throw new Error("Retained original file differs: " + path);
  const temporary = await completedPending(path, bytes);
  let retainedPrefix = null;
  if (prior) {
    // A legacy direct write may have stopped at this exact prefix. Preserve the
    // original inode before publishing the complete selected bytes over its name.
    retainedPrefix = await retainBeforeReplacement(path, prior, info);
    await fs.rename(temporary, path);
  } else {
    try { await fs.link(temporary, path); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await ordinary(path)).equals(bytes)) throw new Error("A different producer file was published: " + path);
    }
    await fs.unlink(temporary);
  }
  await syncDirectory(dirname(path));
  return { path, bytes: bytes.length, sha256: hash(bytes), ...(retainedPrefix ? { retainedPrefix } : {}) };
}
async function privateDirectory(path) {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Select an owned producer directory");
  await fs.chmod(path, 0o700);
}
async function initialDirectory(directory, identityName, bytes) {
  if (await exists(join(directory, identityName))) return;
  const allowed = new Set(["writer.lock", basename(pendingPath(join(directory, identityName), bytes))]);
  if ((await fs.readdir(directory)).some(name => !allowed.has(name)))
    throw new Error("Select an empty directory or this original native producer operation");
}
async function run(command, args, { cwd, logPrefix, signal } = {}) {
  const stdoutPath = logPrefix + ".stdout", stderrPath = logPrefix + ".stderr";
  const output = await fs.open(stdoutPath, "wx", 0o600);
  let errors, result;
  try {
    errors = await fs.open(stderrPath, "wx", 0o600);
    result = await new Promise((accept) => {
      let child, startError = null;
      try { child = spawn(command, args, { cwd, signal, stdio: ["ignore", output.fd, errors.fd], shell: false }); }
      catch (error) { accept({ code: null, signal: null, error }); return; }
      child.once("error", error => { startError = error; });
      // Abort can emit error before the child exits. Keep the original writer
      // and output descriptors until close proves the native process ended.
      child.once("close", (code, stoppedBy) => accept({ code, signal: stoppedBy, error: startError }));
    });
    await output.sync(); await errors.sync();
  } finally { await output.close(); if (errors) await errors.close(); }
  if (result.code !== 0 || result.error) {
    const error = new Error("Native producer command interrupted; inspect " + stderrPath);
    error.code = "OPENLINEAGE_NATIVE_JAVA_INTERRUPTED"; error.exitCode = result.code;
    error.stoppedBy = result.signal; error.cause = result.error;
    error.stdoutPath = stdoutPath; error.stderrPath = stderrPath; throw error;
  }
  return { command, args, code: result.code, signal: result.signal, stdoutPath, stderrPath };
}
async function selectedRuntimeSource() {
  const java = await ordinary(join(ROOT, "OpenLineageNativeProducer.java"));
  const pom = await ordinary(join(ROOT, "java-producer-pom.xml"));
  return { java, pom, intent: { schema: "commons.openlineage.java-runtime.v1", sdkVersion: JAVA_PRODUCER_VERSION,
    javaSourceSha256: hash(java), pomSha256: hash(pom) } };
}
async function runtimeFiles(directory) {
  const { java, pom, intent } = await selectedRuntimeSource();
  await newOrSame(join(directory, "runtime-intent.json"), encoded(intent));
  await newOrSame(join(directory, "OpenLineageNativeProducer.java"), java);
  await newOrSame(join(directory, "pom.xml"), pom);
  return intent;
}
async function classpathEntries(directory, filename = "classpath.txt") {
  const body = await ordinary(join(directory, filename)), text = body.toString("utf8").trim();
  if (!text || text.includes("\n") || text.includes("\r")) throw new Error("Read the complete native Maven classpath");
  const paths = text.split(delimiter).map(path => resolve(directory, path));
  if (paths.some(path => !path) || new Set(paths).size !== paths.length ||
      !paths.some(path => basename(path) === "openlineage-java-" + JAVA_PRODUCER_VERSION + ".jar"))
    throw new Error("The original runtime must contain the complete selected released OpenLineage Java SDK");
  const entries = [];
  for (const path of paths) {
    const bytes = await ordinary(path);
    if (!bytes.length) throw new Error("An original Java dependency file is empty: " + path);
    entries.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  return entries;
}
function sameIntent(saved, selected) {
  return saved?.schema === selected.schema && saved?.sdkVersion === selected.sdkVersion &&
    saved?.javaSourceSha256 === selected.javaSourceSha256 && saved?.pomSha256 === selected.pomSha256;
}
async function verifiedRuntime(directory, intent, { allowUnobservedPreparation = false } = {}) {
  const prior = await json(join(directory, "java-runtime.json"));
  if (!sameIntent(prior, intent) || !sameIntent(await json(join(directory, "runtime-intent.json")), intent))
    throw new Error("The original Java runtime selects different SDK or source identities");
  const source = await ordinary(join(directory, "OpenLineageNativeProducer.java"));
  const pom = await ordinary(join(directory, "pom.xml"));
  if (hash(source) !== intent.javaSourceSha256 || hash(pom) !== intent.pomSha256)
    throw new Error("Keep the original Java runtime source and POM");
  const entries = await classpathEntries(directory);
  if (JSON.stringify(prior.entries) !== JSON.stringify(entries))
    throw new Error("The original Java dependency files changed; select a distinct dependency edition");
  if (prior.classpathSha256 && hash(await ordinary(join(directory, "classpath.txt"))) !== prior.classpathSha256)
    throw new Error("The original complete Java classpath changed");
  if (prior.receiving) await verifiedReceivedRuntime(directory, prior);
  if (!allowUnobservedPreparation && prior.preparation?.code !== 0) {
    const error = new Error("Continue prepare on this original Java runtime to observe its complete Maven result");
    error.code = "OPENLINEAGE_JAVA_PREPARATION_UNOBSERVED"; throw error;
  }
  return prior;
}

const RUNTIME_PACKAGE_SCHEMA = "commons.openlineage.java-runtime-package.v1";
const RUNTIME_RECEIVING_SCHEMA = "commons.openlineage.java-runtime-receiving.v1";
const RUNTIME_ORIGIN_FILES = ["OpenLineageNativeProducer.java", "pom.xml", "runtime-intent.json", "java-runtime.json"];
function runtimePayloadHash(payload) { return hash(encoded(payload)); }
function packageFile(path, bytes) {
  return { path, sha256: hash(bytes), bytes: bytes.length, base64: bytes.toString("base64") };
}
function dependencyPath(index, entry) {
  return "dependencies/" + String(index).padStart(6, "0") + "-" + entry.sha256 + "/" + basename(entry.path);
}
function runtimeFilesFromPackage(bytes) {
  const packageSha256 = hash(bytes), bundle = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const { payloadSha256, ...payload } = bundle;
  if (payload.schema !== RUNTIME_PACKAGE_SCHEMA || runtimePayloadHash(payload) !== payloadSha256 ||
      !Array.isArray(payload.dependencies) || !payload.dependencies.length || !Array.isArray(payload.files))
    throw new Error("Read a complete original Java runtime package");
  const files = new Map(), expected = new Set(RUNTIME_ORIGIN_FILES.map(name => "origin/" + name));
  for (const name of ["maven-preparation.json", "maven.stdout", "maven.stderr", "runtime-received-origin.json"])
    if (payload.originFiles?.includes(name)) expected.add("origin/" + name);
  if (!Array.isArray(payload.originFiles) || payload.originFiles.some(name =>
      ![...RUNTIME_ORIGIN_FILES, "maven-preparation.json", "maven.stdout", "maven.stderr", "runtime-received-origin.json"].includes(name)))
    throw new Error("The runtime package declares an unexpected original preparation file");
  for (let index = 0; index < payload.dependencies.length; index++) {
    const entry = payload.dependencies[index];
    if (!entry || !/^[0-9a-f]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 ||
        typeof entry.originPath !== "string" || basename(entry.originPath) !== entry.name ||
        !/^[A-Za-z0-9_.-]+\.jar$/.test(entry.name) || entry.path !== dependencyPath(index, { path: entry.originPath, sha256: entry.sha256 }))
      throw new Error("The runtime package dependency identity differs");
    expected.add(entry.path);
  }
  for (const file of payload.files) {
    if (!file || !expected.has(file.path) || files.has(file.path) || typeof file.base64 !== "string" ||
        !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
      throw new Error("Unexpected or duplicate runtime package file");
    const data = Buffer.from(file.base64, "base64");
    if (data.toString("base64") !== file.base64 || data.length !== file.bytes || hash(data) !== file.sha256)
      throw new Error("A complete runtime package file differs from its original bytes");
    files.set(file.path, data);
  }
  if (files.size !== expected.size || [...expected].some(path => !files.has(path)))
    throw new Error("The runtime package is missing complete original files");
  const originalIntent = JSON.parse(files.get("origin/runtime-intent.json"));
  const originalReceipt = JSON.parse(files.get("origin/java-runtime.json"));
  if (!sameIntent(payload.intent, originalIntent) || !sameIntent(originalReceipt, originalIntent) ||
      originalReceipt.preparation?.code !== 0 ||
      hash(files.get("origin/OpenLineageNativeProducer.java")) !== originalIntent.javaSourceSha256 ||
      hash(files.get("origin/pom.xml")) !== originalIntent.pomSha256 ||
      originalReceipt.entries?.length !== payload.dependencies.length)
    throw new Error("The runtime package must retain its original successful preparation and selected sources");
  if (!originalReceipt.receiving) {
    const preparation = files.has("origin/maven-preparation.json") && JSON.parse(files.get("origin/maven-preparation.json"));
    if (!preparation || preparation.state !== "COMPLETE" || preparation.command?.code !== 0 ||
        !sameIntent(preparation.intent, originalIntent) || preparation.id !== originalReceipt.preparationId ||
        JSON.stringify(preparation.entries) !== JSON.stringify(originalReceipt.entries) ||
        !files.has("origin/maven.stdout") || !files.has("origin/maven.stderr"))
      throw new Error("Keep the original completed Maven preparation and its actual command output");
  } else if (!files.has("origin/runtime-received-origin.json")) {
    throw new Error("Keep the preceding runtime's complete original receiving descriptor");
  }
  for (let index = 0; index < payload.dependencies.length; index++) {
    const entry = payload.dependencies[index], original = originalReceipt.entries[index], data = files.get(entry.path);
    if (entry.originPath !== original.path || entry.sha256 !== original.sha256 || entry.bytes !== original.bytes ||
        !data || hash(data) !== entry.sha256 || data.length !== entry.bytes)
      throw new Error("The complete native dependency differs from the prepared original");
  }
  if (!payload.dependencies.some(entry => entry.name === "openlineage-java-" + JAVA_PRODUCER_VERSION + ".jar"))
    throw new Error("The original released OpenLineage SDK is missing");
  return { payload, files, originalReceipt, packageSha256, payloadSha256 };
}

/** Verify a complete runtime transfer without installing or invoking a resolver. */
export async function verifyJavaProducerRuntimePackage(bytes) {
  const verified = runtimeFilesFromPackage(bytes), { intent } = await selectedRuntimeSource();
  if (!sameIntent(verified.payload.intent, intent))
    throw new Error("The received runtime must select this application's original Java source and POM");
  return { schema: verified.payload.schema, packageSha256: verified.packageSha256,
    payloadSha256: verified.payloadSha256, sdkVersion: intent.sdkVersion,
    javaSourceSha256: intent.javaSourceSha256, pomSha256: intent.pomSha256,
    dependencies: verified.payload.dependencies.map(({ base64, ...entry }) => entry),
    fileCount: verified.files.size, bytes: Buffer.from(bytes).length };
}

async function verifiedReceivedRuntime(directory, receipt) {
  const origin = await json(join(directory, "runtime-received-origin.json"));
  const selected = receipt.receiving;
  if (origin.schema !== RUNTIME_RECEIVING_SCHEMA || selected.schema !== RUNTIME_RECEIVING_SCHEMA ||
      selected.packageSha256 !== origin.packageSha256 || selected.payloadSha256 !== origin.payloadSha256 ||
      hash(await ordinary(join(directory, "runtime-received-origin.json"))) !== selected.originDescriptorSha256 ||
      !sameIntent(origin.intent, receipt) || origin.originReceipt.preparation?.code !== 0 ||
      origin.dependencies.length !== receipt.entries.length || origin.originFiles.length < RUNTIME_ORIGIN_FILES.length)
    throw new Error("The received runtime's original preparation descriptor changed");
  for (const file of origin.originFiles) {
    if (!/^origin\/[A-Za-z0-9_.-]+$/.test(file.path)) throw new Error("Unexpected retained runtime origin path");
    const bytes = await ordinary(join(directory, file.path));
    if (hash(bytes) !== file.sha256 || bytes.length !== file.bytes)
      throw new Error("The received runtime's retained original source or preparation changed");
  }
  for (let index = 0; index < origin.dependencies.length; index++) {
    const dependency = origin.dependencies[index], entry = receipt.entries[index];
    if (dependency.path !== dependencyPath(index, { path: dependency.originPath, sha256: dependency.sha256 }) ||
        entry.path !== join(directory, dependency.path) || entry.sha256 !== dependency.sha256 || entry.bytes !== dependency.bytes)
      throw new Error("The received runtime's local classpath differs from the original dependency selection");
  }
}

/** Carry complete unchanged resolved dependencies, source and preparation to an independent host. */
export async function exportJavaProducerRuntime({ directory, destination } = {}) {
  if (!directory || !destination) throw new Error("Provide the original runtime and its new output file");
  directory = resolve(directory); destination = resolve(destination);
  const { intent } = await selectedRuntimeSource();
  return new LineageWorkspace(directory).lock(async () => {
    const receipt = await verifiedRuntime(directory, intent), files = [], originFiles = [...RUNTIME_ORIGIN_FILES];
    for (const name of originFiles) files.push(packageFile("origin/" + name, await ordinary(join(directory, name))));
    if (receipt.receiving) {
      const name = "runtime-received-origin.json";
      originFiles.push(name); files.push(packageFile("origin/" + name, await ordinary(join(directory, name))));
    } else {
      const preparation = await json(join(directory, "maven-preparation.json"));
      for (const [name, path] of [["maven-preparation.json", join(directory, "maven-preparation.json")],
        ["maven.stdout", preparation.command?.stdoutPath], ["maven.stderr", preparation.command?.stderrPath]]) {
        if (!path) throw new Error("Retain the original successful preparation output");
        originFiles.push(name); files.push(packageFile("origin/" + name, await ordinary(path)));
      }
    }
    const dependencies = [];
    for (let index = 0; index < receipt.entries.length; index++) {
      const entry = receipt.entries[index], bytes = await ordinary(entry.path), path = dependencyPath(index, entry);
      if (hash(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
        throw new Error("The selected dependency changed while exporting its complete runtime");
      dependencies.push({ path, name: basename(entry.path), originPath: entry.path, sha256: entry.sha256, bytes: entry.bytes });
      files.push(packageFile(path, bytes));
    }
    const payload = { schema: RUNTIME_PACKAGE_SCHEMA, intent, originFiles, dependencies, files };
    const bytes = encoded({ ...payload, payloadSha256: runtimePayloadHash(payload) });
    const verified = await verifyJavaProducerRuntimePackage(bytes);
    await newOrSame(destination, bytes);
    return { ...verified, destination };
  });
}

/** Receive the same runtime locally, rebinding only dependency paths and preserving every original byte. */
export async function receiveJavaProducerRuntime({ bytes, directory } = {}) {
  if (!bytes || !directory) throw new Error("Provide the complete original runtime package and receiving directory");
  const complete = Buffer.from(bytes), verified = runtimeFilesFromPackage(complete);
  const { intent } = await selectedRuntimeSource();
  if (!sameIntent(verified.payload.intent, intent))
    throw new Error("The runtime package belongs to a different original Java application source");
  directory = resolve(directory); await privateDirectory(directory);
  const receivingPath = join(directory, "java-runtime-receiving.json");
  const selection = { schema: RUNTIME_RECEIVING_SCHEMA, packageSha256: verified.packageSha256,
    payloadSha256: verified.payloadSha256, intent };
  await initialDirectory(directory, "java-runtime-receiving.json", encoded(selection));
  return new LineageWorkspace(directory).lock(async () => {
    const prior = await exists(receivingPath) ? await json(receivingPath) : null;
    if (prior && (prior.schema !== selection.schema || prior.packageSha256 !== selection.packageSha256 ||
        prior.payloadSha256 !== selection.payloadSha256 || !sameIntent(prior.intent, intent)))
      throw new Error("This receiving directory belongs to a different original runtime package");
    if (!prior) await newOrSame(receivingPath, encoded(selection));
    if (prior?.state === "COMPLETE") return verifiedRuntime(directory, intent);
    for (const [name, content] of verified.files) {
      await privateDirectory(dirname(join(directory, name)));
      await newOrSame(join(directory, name), content);
    }
    await newOrSame(join(directory, "OpenLineageNativeProducer.java"), verified.files.get("origin/OpenLineageNativeProducer.java"));
    await newOrSame(join(directory, "pom.xml"), verified.files.get("origin/pom.xml"));
    await newOrSame(join(directory, "runtime-intent.json"), encoded(intent));
    const origin = { ...selection, originReceipt: verified.originalReceipt,
      originFiles: verified.payload.files.filter(file => file.path.startsWith("origin/")).map(({ base64, ...file }) => file),
      dependencies: verified.payload.dependencies };
    const originBytes = encoded(origin);
    await newOrSame(join(directory, "runtime-received-origin.json"), originBytes);
    const entries = verified.payload.dependencies.map(entry => ({ path: join(directory, entry.path), bytes: entry.bytes, sha256: entry.sha256 }));
    const classpath = Buffer.from(entries.map(entry => entry.path).join(delimiter) + "\n");
    await newOrSame(join(directory, "classpath.txt"), classpath);
    const publication = { path: join(directory, "classpath.txt"), bytes: classpath.length, sha256: hash(classpath) };
    const receipt = { ...intent, directory, preparedAt: verified.originalReceipt.preparedAt, entries,
      preparation: { kind: "received", code: 0, originalPreparationId: verified.originalReceipt.preparationId,
        originalCommand: verified.originalReceipt.preparation },
      preparationId: verified.originalReceipt.preparationId,
      classpathSha256: hash(classpath), classpathBytes: classpath.length, publication,
      receiving: { ...selection, originDescriptorSha256: hash(originBytes) } };
    await newOrSame(join(directory, "java-runtime.json"), encoded(receipt));
    const received = await verifiedRuntime(directory, intent);
    await save(receivingPath, { ...selection, state: "COMPLETE", receivedAt: new Date().toISOString(),
      dependencyCount: entries.length, dependencyBytes: entries.reduce((total, entry) => total + entry.bytes, 0) });
    return received;
  });
}

/** Resolve only the native SDK runtime, preserving interrupted preparation in the same directory. */
export async function prepareJavaProducer({ directory, maven = "mvn", flock = "flock", offline = false, signal } = {}) {
  if (!directory) throw new Error("Provide an owned native Java runtime directory");
  directory = resolve(directory); await privateDirectory(directory);
  const { intent: selected } = await selectedRuntimeSource();
  await initialDirectory(directory, "runtime-intent.json", encoded(selected));
  return new LineageWorkspace(directory).lock(async () => {
    const intent = await runtimeFiles(directory);
    const priorPath = join(directory, "java-runtime.json");
    let legacyReceipt = null;
    if (await exists(priorPath)) {
      const prior = await verifiedRuntime(directory, intent, { allowUnobservedPreparation: true });
      if (prior.preparation?.code === 0) return prior;
      const bytes = await ordinary(priorPath);
      legacyReceipt = { path: join(directory, "." + basename(priorPath) + ".interrupted-" + hash(bytes)),
        bytes: bytes.length, sha256: hash(bytes), reason: "No original successful Maven exit was retained" };
    }
    const preparationPath = join(directory, "maven-preparation.json");
    let preparation = await exists(preparationPath) ? await json(preparationPath) : null;
    if (preparation && (!sameIntent(preparation.intent, intent) ||
        preparation.schema !== "commons.openlineage.java-preparation.v1"))
      throw new Error("Retained Maven preparation belongs to another native runtime");
    if (preparation?.state !== "COMPLETE") {
      if (preparation) await newOrSame(join(directory, "maven-preparation-" + preparation.id + ".json"), encoded(preparation));
      const id = randomUUID(), candidate = "classpath-" + id + ".txt";
      const processLock = { schema: "commons.openlineage.java-maven-process-lock.v1",
        path: join(directory, ".maven-process.lock"), executable: flock, conflictExitCode: 75 };
      // Keep this inode permanently. The actual Maven command inherits the
      // kernel lock, so a dead Node writer cannot permit a second live resolver.
      await newOrSame(processLock.path, Buffer.alloc(0));
      preparation = { schema: "commons.openlineage.java-preparation.v1", id, intent,
        startedAt: new Date().toISOString(), state: "STARTED", candidate, processLock };
      await save(preparationPath, preparation);
      try {
        const mavenArgs = ["-B", "-q", ...(offline ? ["-o"] : []), "-f", join(directory, "pom.xml"),
          "org.apache.maven.plugins:maven-dependency-plugin:3.8.1:build-classpath",
          "-DincludeScope=runtime", "-Dmdep.outputFile=" + join(directory, candidate)];
        const executed = await run(flock, ["--exclusive", "--nonblock", "--conflict-exit-code", "75",
          processLock.path, maven, ...mavenArgs],
          { cwd: directory, signal, logPrefix: join(directory, "maven-" + id) });
        const command = { ...executed, mavenCommand: { command: maven, args: mavenArgs }, processLock };
        const bytes = await ordinary(join(directory, candidate));
        const entries = await classpathEntries(directory, candidate);
        preparation = { ...preparation, state: "COMPLETE", completedAt: new Date().toISOString(),
          command, classpathSha256: hash(bytes), classpathBytes: bytes.length, entries };
        await save(preparationPath, preparation);
      } catch (error) {
        await save(preparationPath, { ...preparation, state: "INTERRUPTED", finishedAt: new Date().toISOString(),
          error: error.code ?? error.name, exitCode: error.exitCode ?? null,
          stdoutPath: error.stdoutPath ?? null, stderrPath: error.stderrPath ?? null });
        throw error;
      }
    }
    // Only a returned successful Maven command can supply a new READY runtime.
    // A complete saved preparation resumes publication without rerunning Maven.
    const candidate = preparation.candidate;
    if (typeof candidate !== "string" || basename(candidate) !== candidate ||
        !/^classpath-[0-9a-f-]+\.txt$/.test(candidate) || preparation.command?.code !== 0)
      throw new Error("Read the original completed Maven preparation");
    const bytes = await ordinary(join(directory, candidate));
    const entries = await classpathEntries(directory, candidate);
    if (hash(bytes) !== preparation.classpathSha256 || bytes.length !== preparation.classpathBytes ||
        JSON.stringify(entries) !== JSON.stringify(preparation.entries))
      throw new Error("The original completed Maven preparation changed");
    // An old classpath without java-runtime.json is unverified, even if it
    // contains the SDK filename. Retain those exact bytes before replacement.
    const publication = await newOrSame(join(directory, "classpath.txt"), bytes, { replaceUnverified: true });
    const result = { ...intent, directory, preparedAt: preparation.completedAt, entries,
      preparation: preparation.command, preparationId: preparation.id,
      classpathSha256: hash(bytes), classpathBytes: bytes.length, publication,
      ...(legacyReceipt ? { legacyReceipt } : {}) };
    await newOrSame(priorPath, encoded(result), { replaceUnverified: legacyReceipt !== null });
    return verifiedRuntime(directory, intent);
  });
}

/** Reuse the exact input copies and event identities after an interrupted native producer invocation. */
export async function emitJavaProducer({ runtime, directory, connection, tokenFile = null, inputs,
  operationId, compression = "gzip", java = "java", previousJavaSourceSha256 = null, signal } = {}) {
  if (!runtime || !directory || !connection || !Array.isArray(inputs) || !inputs.length)
    throw new Error("Provide the original runtime, operation directory, connection and complete input files");
  if (typeof operationId !== "string" || !operationId.trim() || operationId.length > 512)
    throw new Error("Provide a stable original producer operation ID");
  if (previousJavaSourceSha256 !== null && !/^[0-9a-f]{64}$/.test(previousJavaSourceSha256))
    throw new Error("Select the exact original Java source SHA-256 for an explicit source continuation");
  runtime = resolve(runtime); directory = resolve(directory);
  const { intent } = await selectedRuntimeSource();
  const prepared = await verifiedRuntime(runtime, intent), entries = prepared.entries;
  const identity = typeof connection === "string" ? await json(resolve(connection)) : connection;
  const token = tokenFile ? (await fs.readFile(resolve(tokenFile), "utf8")).trim() : null;
  const configuration = producerConfiguration(identity, { token, client: "java", compression });
  await privateDirectory(directory);
  const inputRows = [];
  for (let index = 0; index < inputs.length; index++) {
    const path = resolve(inputs[index]), bytes = await fs.readFile(path);
    const file = "input-" + String(index).padStart(6, "0") + ".json";
    inputRows.push({ file, originalName: basename(path), bytes: bytes.length, sha256: hash(bytes) });
  }
  const manifest = { schema: "commons.openlineage.java-input.v1", sdkVersion: JAVA_PRODUCER_VERSION,
    operationId, workspaceId: identity.workspaceId, compression, inputs: inputRows,
    javaSourceSha256: prepared.javaSourceSha256, pomSha256: prepared.pomSha256 };
  const manifestPath = join(directory, "java-input.json");
  await initialDirectory(directory, "java-input.json", encoded(manifest));
  return new LineageWorkspace(directory).lock(async () => {
  let manifestBytes = encoded(manifest), sourceContinuation = null;
  if (previousJavaSourceSha256 !== null) {
    if (previousJavaSourceSha256 === prepared.javaSourceSha256)
      throw new Error("A source continuation selects a distinct Java source edition");
    // The old manifest is immutable. Only its source hash may differ from this
    // exact SDK, POM, original inputs, event order and workspace selection.
    const originalManifest = await ordinary(manifestPath);
    const expectedOriginal = encoded({ ...manifest, javaSourceSha256: previousJavaSourceSha256 });
    if (!originalManifest.equals(expectedOriginal))
      throw new Error("The retained Java manifest does not match this exact original source continuation");
    manifestBytes = originalManifest;
    const receiptBytes = await ordinary(join(runtime, "java-runtime.json"));
    const sourceBytes = await ordinary(join(runtime, "OpenLineageNativeProducer.java"));
    const pomBytes = await ordinary(join(runtime, "pom.xml"));
    if (hash(sourceBytes) !== prepared.javaSourceSha256 || hash(pomBytes) !== prepared.pomSha256 ||
        !sameIntent(JSON.parse(receiptBytes), prepared))
      throw new Error("The selected native runtime changed before source continuation");
    const runtimeReceipt = { file: "java-source-runtime-" + hash(receiptBytes) + ".json",
      bytes: receiptBytes.length, sha256: hash(receiptBytes) };
    const runtimeSource = { file: "java-source-" + hash(sourceBytes) + ".java",
      bytes: sourceBytes.length, sha256: hash(sourceBytes) };
    const runtimePom = { file: "java-source-pom-" + hash(pomBytes) + ".xml",
      bytes: pomBytes.length, sha256: hash(pomBytes) };
    await newOrSame(join(directory, runtimeReceipt.file), receiptBytes);
    await newOrSame(join(directory, runtimeSource.file), sourceBytes);
    await newOrSame(join(directory, runtimePom.file), pomBytes);
    const selected = { schema: "commons.openlineage.java-source-continuation.v1",
      operationId, workspaceId: identity.workspaceId, sdkVersion: JAVA_PRODUCER_VERSION,
      compression, previousJavaSourceSha256, javaSourceSha256: prepared.javaSourceSha256,
      pomSha256: prepared.pomSha256, originalManifest: { file: "java-input.json",
        bytes: originalManifest.length, sha256: hash(originalManifest) },
      runtime, runtimeReceipt, runtimeSource, runtimePom };
    const bytes = encoded(selected);
    sourceContinuation = { ...selected, file: "java-source-continuation-" + hash(bytes) + ".json",
      bytes: bytes.length, sha256: hash(bytes) };
    await newOrSame(join(directory, sourceContinuation.file), bytes);
  } else {
    await newOrSame(manifestPath, manifestBytes);
  }
  for (let index = 0; index < inputs.length; index++) {
    const bytes = await fs.readFile(resolve(inputs[index]));
    if (hash(bytes) !== inputRows[index].sha256) throw new Error("Original input changed while preparing its operation");
    await newOrSame(join(directory, inputRows[index].file), bytes);
  }
  const configurationBytes = encoded(configuration);
  const configurationPath = join(directory, "java-config-" + hash(configurationBytes) + ".yaml");
  await newOrSame(configurationPath, configurationBytes);
  const invocationId = randomUUID(), logPrefix = join(directory, "java-" + invocationId);
  const invocation = { schema: "commons.openlineage.java-invocation.v1", invocationId,
    operationId, workspaceId: identity.workspaceId, startedAt: new Date().toISOString(),
    runtime, javaSourceSha256: prepared.javaSourceSha256, manifestSha256: hash(manifestBytes),
    ...(sourceContinuation ? { sourceContinuation } : {}) };
  const invocationPath = join(directory, "invocation-" + invocationId + ".json");
  await save(invocationPath, invocation);
  try {
    const command = await run(java, ["--class-path", entries.map(item => item.path).join(delimiter),
      join(runtime, "OpenLineageNativeProducer.java"), manifestPath, configurationPath],
      { cwd: directory, signal, logPrefix });
    if (!(await ordinary(manifestPath)).equals(manifestBytes))
      throw new Error("The original Java manifest changed during its native source continuation");
    const result = await json(join(directory, "java-producer-result.json"));
    if (result.workspaceId !== identity.workspaceId || result.operationId !== operationId ||
        result.sdkVersion !== JAVA_PRODUCER_VERSION || result.state !== "ACKNOWLEDGED")
      throw new Error("Native result does not match the selected original producer operation");
    await save(invocationPath, { ...invocation, completedAt: new Date().toISOString(), state: result.state,
      stdoutPath: command.stdoutPath, stderrPath: command.stderrPath, events: result.events.length });
    return { ...result, directory, resultPath: join(directory, "java-producer-result.json"),
      stdoutPath: command.stdoutPath, stderrPath: command.stderrPath,
      ...(sourceContinuation ? { sourceContinuation } : {}) };
  } catch (error) {
    await save(invocationPath, { ...invocation, finishedAt: new Date().toISOString(), state: "INTERRUPTED",
      error: error.code ?? error.name, stdoutPath: logPrefix + ".stdout", stderrPath: logPrefix + ".stderr" });
    throw error;
  }
  });
}

export async function javaProducerCommand(args) {
  const [action, ...words] = args, values = {}, inputs = [];
  const flags = new Set(["--offline"]), options = new Set(["--runtime", "--directory", "--connection",
    "--token-file", "--input", "--operation-id", "--compression", "--java", "--maven", "--flock",
    "--previous-java-source-sha256", "--out"]);
  for (let i = 0; i < words.length; i++) {
    const key = words[i];
    if (flags.has(key)) { values[key] = true; continue; }
    if (!options.has(key) || words[i + 1] === undefined || words[i + 1].startsWith("--"))
      throw new Error("Unknown or incomplete native producer option: " + key);
    if (key === "--input") inputs.push(words[++i]);
    else {
      if (Object.hasOwn(values, key)) throw new Error("Repeated native producer option: " + key);
      values[key] = words[++i];
    }
  }
  if (action === "prepare") return prepareJavaProducer({ directory: values["--runtime"],
    maven: values["--maven"], flock: values["--flock"], offline: values["--offline"] === true });
  if (action === "runtime-export") return exportJavaProducerRuntime({ directory: values["--runtime"], destination: values["--out"] });
  if (action === "runtime-verify" || action === "runtime-receive") {
    if (inputs.length !== 1) throw new Error("Select one complete original runtime package with --input");
    const bytes = await ordinary(resolve(inputs[0]));
    return action === "runtime-verify" ? verifyJavaProducerRuntimePackage(bytes)
      : receiveJavaProducerRuntime({ bytes, directory: values["--runtime"] });
  }
  if (action === "emit") return emitJavaProducer({ runtime: values["--runtime"], directory: values["--directory"],
    connection: values["--connection"], tokenFile: values["--token-file"], inputs,
    operationId: values["--operation-id"], compression: values["--compression"],
    java: values["--java"], previousJavaSourceSha256: values["--previous-java-source-sha256"] });
  throw new Error("Use native-java prepare, emit, runtime-export, runtime-verify or runtime-receive with the original selected files");
}
if (process.argv[1] && await fs.realpath(resolve(process.argv[1])).then(path => path === fileURLToPath(import.meta.url), () => false)) {
  javaProducerCommand(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({ error: error.message, code: error.code ?? null })); process.exitCode = 1;
  });
}

