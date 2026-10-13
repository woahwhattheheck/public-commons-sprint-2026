#!/usr/bin/env node
// MIT. Complete native Python and Java customer receiving from relocated original operations.
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { LineageWorkspace, APPLICATION_FILES, verifyBundle, receiveBundle } from "./store.mjs";
import { startServer } from "./server.mjs";
import { LineageClient } from "./client.mjs";
import { exportJavaProducerRuntime, receiveJavaProducerRuntime, prepareJavaProducer, emitJavaProducer } from "./JAVA_PRODUCER.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async path => JSON.parse(await fs.readFile(path));
const exists = path => fs.access(path).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
async function retain(path, bytes) {
  const data = Buffer.from(bytes);
  try { await fs.writeFile(path, data, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; assert.deepEqual(await fs.readFile(path), data); }
}
async function save(path, value) {
  const pending = path + ".pending-" + randomUUID();
  await retain(pending, JSON.stringify(value, null, 2) + "\n"); await fs.rename(pending, path);
}
async function secret(path) {
  if (!await exists(path)) await retain(path, randomBytes(32).toString("hex"));
  return (await fs.readFile(path, "utf8")).trim();
}
async function python(script, words, directory, executable) {
  const id = randomUUID(), stdoutPath = join(directory, "python-" + id + ".stdout"), stderrPath = join(directory, "python-" + id + ".stderr");
  const output = await fs.open(stdoutPath, "wx", 0o600), errors = await fs.open(stderrPath, "wx", 0o600);
  try {
    const result = await new Promise(accept => {
      const child = spawn(executable, [script, ...words], { shell: false, stdio: ["ignore", output.fd, errors.fd] });
      let error = null; child.once("error", value => { error = value; });
      child.once("close", (code, signal) => accept({ code, signal, error }));
    });
    await output.sync(); await errors.sync();
    return { code: result.code, signal: result.signal, error: result.error?.message ?? null, stdoutPath, stderrPath };
  } finally { await output.close(); await errors.close(); }
}
async function copyOperation(source, destination, { java = false } = {}) {
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  const copied = [];
  const visit = async (directory, prefix = "") => {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.name === "writer.lock" || java && /^java-config-.*\.yaml$/.test(item.name)) continue;
      assert.equal(item.isSymbolicLink(), false);
      if (item.isDirectory()) { await fs.mkdir(join(destination, name), { recursive: true, mode: 0o700 }); await visit(join(directory, item.name), name + "/"); }
      else {
        assert.equal(item.isFile(), true); const bytes = await fs.readFile(join(source, name));
        await retain(join(destination, name), bytes); copied.push({ path: name, sha256: hash(bytes), bytes: bytes.length });
      }
    }
  };
  await visit(source); return copied;
}
async function verifyPythonWires(server, directory) {
  const rows = [];
  for (const name of (await fs.readdir(join(directory, "receipts"))).sort()) {
    const receipt = await json(join(directory, "receipts", name));
    const request = await json(join(directory, "requests", name));
    const wire = Buffer.from(request.wireBase64, "base64"), retained = await server.workspace.readObject(receipt.wireSha256);
    assert.deepEqual(retained, wire); assert.equal(hash(wire), receipt.acknowledgement.source.id);
    assert.equal(receipt.acknowledgement.workspaceId, server.identity.workspaceId);
    const decoded = request.contentEncoding === "gzip" ? gunzipSync(wire) : wire;
    assert.equal(hash(decoded), request.serializedSha256);
    rows.push({ operationId: receipt.operationId, wireSha256: hash(wire), bytes: wire.length, serializedSha256: request.serializedSha256,
      receiverRevision: receipt.acknowledgement.revision, replayed: receipt.acknowledgement.replayed });
  }
  return rows;
}
async function verifyJavaWires(server, result) {
  const rows = [];
  for (const event of result.events) {
    const wire = await fs.readFile(join(result.directory, "native", event.wire));
    const serialized = await fs.readFile(join(result.directory, "native", event.serialized));
    assert.deepEqual(await server.workspace.readObject(event.wireSha256), wire);
    assert.equal(hash(wire), event.acknowledgement.source.id); assert.equal(hash(serialized), event.serializedSha256);
    assert.deepEqual(result.compression === "gzip" ? gunzipSync(wire) : wire, serialized);
    assert.equal(event.acknowledgement.workspaceId, server.identity.workspaceId);
    rows.push({ operationId: event.operationId, eventClass: event.eventClass, wireSha256: hash(wire), bytes: wire.length,
      serializedSha256: event.serializedSha256, receiverRevision: event.acknowledgement.revision, replayed: event.acknowledgement.replayed });
  }
  return rows;
}

/** Move complete original native operations and receive their runtime without a resolver. */
export async function receiveCustomerProducerRuntime(directory, { runtime, python: executable = "python3", java = "java", progress } = {}) {
  if (!runtime) throw new Error("Select the complete original prepared Java runtime with --runtime");
  const root = resolve(directory); runtime = resolve(runtime);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  return new LineageWorkspace(root).lock(async () => {
    const checkpoint = join(root, "runtime-receiving-operation.json");
    const sources = Object.fromEntries(await Promise.all(["JAVA_PRODUCER.mjs", "JAVA_RUNTIME_RECEIVING.mjs", "native_python_producer.py", "OpenLineageNativeProducer.java"]
      .map(async name => [name, hash(await fs.readFile(join(ROOT, name)))])));
    const operation = await exists(checkpoint) ? await json(checkpoint) : {
      schema: "commons.openlineage.customer-runtime-receiving.v1", directory: root, runtime,
      startedAt: new Date().toISOString(), javaSourceSha256: sources["OpenLineageNativeProducer.java"], sources: [], completed: {}
    };
    assert.equal(operation.directory, root); assert.equal(operation.runtime, runtime);
    assert.equal(operation.javaSourceSha256, sources["OpenLineageNativeProducer.java"]);
    if (!operation.sources.some(value => JSON.stringify(value) === JSON.stringify(sources))) operation.sources.push(sources);
    await save(checkpoint, operation);
    const phase = async (name, action) => {
      if (operation.completed[name]) return operation.completed[name];
      const result = await action(); operation.completed[name] = result; delete operation.interruption;
      await save(checkpoint, operation); if (progress) progress(name); return result;
    };
    let host, receivedHost;
    try {
      const transfer = await phase("complete-runtime", () => exportJavaProducerRuntime({ directory: runtime, destination: join(root, "java-runtime-package.json") }));
      const operatorFile = join(root, "operator-token"), producerFile = join(root, "producer-token");
      const operatorToken = await secret(operatorFile), producerToken = await secret(producerFile);
      host = await startServer({ directory: join(root, "workspace"), port: operation.port ?? 0, token: operatorToken, producerToken });
      if (operation.workspaceId) assert.equal(host.identity.workspaceId, operation.workspaceId);
      operation.workspaceId = host.identity.workspaceId; operation.port = Number(new URL(host.url).port); await save(checkpoint, operation);
      const inputs = [join(ROOT, "fixture-event-full.json"), join(ROOT, "fixture-event-simple.json")];
      const py = (command, target, script = join(ROOT, "native_python_producer.py"), server = host) => python(script,
        [command, "--directory", target, "--connection", join(server.workspace.directory, "connection.json"), "--token-file", producerFile,
          ...(command === "emit" ? ["--input", inputs[0], "--input", inputs[1], "--operation-id", "customer-python-" + (target.endsWith("pending-python") ? "pending" : "origin")] : [])], root, executable);
      const javaEmit = (server, target, module = { emitJavaProducer }, selectedRuntime = runtime, selectedInputs = inputs) => module.emitJavaProducer({
        runtime: selectedRuntime, directory: target, connection: server.identity, tokenFile: producerFile, inputs: selectedInputs,
        operationId: "customer-java-" + (target.endsWith("pending-java") ? "pending" : "origin"), compression: "gzip", java
      });
      await phase("native-originals", async () => {
        const pyDirectory = join(root, "origin-python"), run = await py("emit", pyDirectory);
        assert.equal(run.code, 0, "Read the complete native Python command output at " + run.stderrPath);
        const pythonWires = await verifyPythonWires(host, pyDirectory);
        const javaResult = await javaEmit(host, join(root, "origin-java"));
        return { python: { ...run, records: pythonWires }, java: { resultPath: javaResult.resultPath, records: await verifyJavaWires(host, javaResult) } };
      });
      await phase("retained-pending-native-requests", async () => {
        await host.workspace.lock(async () => {
          const run = await py("emit", join(root, "pending-python")); assert.notEqual(run.code, 0);
          await assert.rejects(javaEmit(host, join(root, "pending-java")));
        });
        const requests = await fs.readdir(join(root, "pending-python", "requests")); assert.equal(requests.length, 1);
        const pythonRequest = await json(join(root, "pending-python", "requests", requests[0]));
        const attempts = (await fs.readdir(join(root, "pending-java", "native"))).filter(name => name.endsWith(".attempt.json"));
        const javaAttempt = await json(join(root, "pending-java", "native", attempts.at(-1))); assert.equal(javaAttempt.httpStatus, 503);
        return { pythonWireSha256: pythonRequest.wireSha256, javaWireSha256: javaAttempt.wireSha256, httpStatus: 503 };
      });
      const exported = await phase("complete-workspace", async () => {
        const state = await host.workspace.read();
        const edition = (await host.workspace.saveEdition({ title: "Native client customer handover", description: "Complete original Python and Java SDK intake with retained pending delivery.",
          operationId: "customer-native-edition", expectedRevision: state.revision })).edition;
        assert.ok(APPLICATION_FILES.includes("JAVA_RUNTIME_RECEIVING.mjs"));
        const info = await host.workspace.exportBundle(), file = join(root, "customer-workspace.json");
        await retain(file, await fs.readFile(join(host.workspace.directory, "exports", info.id + ".json")));
        const verified = verifyBundle(await fs.readFile(file)); assert.equal(verified.packageSha256, info.id);
        return { ...info, file, editionId: edition.id, applicationFiles: verified.application.size };
      });
      await host.close(); host = null;
      await phase("received-offline-native-runtime", async () => {
        const destination = join(root, "customer-project");
        if (!await exists(destination)) await receiveBundle(await fs.readFile(exported.file), destination);
        else assert.equal((await json(join(destination, "received.json"))).packageSha256, exported.id);
        const application = join(destination, "application"), receivedJava = await import(pathToFileURL(join(application, "JAVA_PRODUCER.mjs")).href);
        const customerRuntime = join(root, "customer-runtime");
        const received = await receivedJava.receiveJavaProducerRuntime({ bytes: await fs.readFile(transfer.destination), directory: customerRuntime });
        const prepared = await receivedJava.prepareJavaProducer({ directory: customerRuntime, offline: true, maven: join(root, "resolver-does-not-exist") });
        assert.equal(prepared.receiving.packageSha256, transfer.packageSha256);
        for (const entry of received.entries) {
          const path = relative(customerRuntime, entry.path); assert.equal(isAbsolute(path), false); assert.equal(path.startsWith(".."), false);
        }
        const receivedServer = await import(pathToFileURL(join(application, "server.mjs")).href);
        receivedHost = await receivedServer.startServer({ directory: destination, port: 0, token: operatorToken, producerToken });
        assert.equal(receivedHost.identity.workspaceId, operation.workspaceId);
        assert.ok((await receivedHost.workspace.read()).editions.some(edition => edition.id === exported.editionId));
        const pythonTarget = join(root, "customer", "pending-python"), javaTarget = join(root, "customer", "pending-java");
        const copiedPython = await copyOperation(join(root, "pending-python"), pythonTarget);
        const copiedJava = await copyOperation(join(root, "pending-java"), javaTarget, { java: true });
        const resumedPython = await py("resume", pythonTarget, join(application, "native_python_producer.py"), receivedHost);
        assert.equal(resumedPython.code, 0, "Inspect the original Python continuation output at " + resumedPython.stderrPath);
        const pythonRecords = await verifyPythonWires(receivedHost, pythonTarget);
        assert.ok(pythonRecords.some(record => record.wireSha256 === operation.completed["retained-pending-native-requests"].pythonWireSha256));
        const receivedInputs = inputs.map(input => join(application, input.split("/").at(-1)));
        const javaResult = await javaEmit(receivedHost, javaTarget, receivedJava, customerRuntime, receivedInputs);
        const javaRecords = await verifyJavaWires(receivedHost, javaResult);
        assert.equal(javaRecords[0].wireSha256, operation.completed["retained-pending-native-requests"].javaWireSha256);
        const after = await receivedHost.workspace.metadata();
        const repeated = await javaEmit(receivedHost, javaTarget, receivedJava, customerRuntime, receivedInputs);
        const repeatedPython = await py("resume", pythonTarget, join(application, "native_python_producer.py"), receivedHost);
        assert.equal(repeatedPython.code, 0); assert.equal((await receivedHost.workspace.metadata()).revision, after.revision);
        await verifyJavaWires(receivedHost, repeated);
        return { directory: destination, runtime: customerRuntime, workspaceId: operation.workspaceId, editionId: exported.editionId,
          runtimePackageSha256: transfer.packageSha256, dependencyCount: received.entries.length, copiedPython, copiedJava,
          python: { ...resumedPython, records: pythonRecords }, java: { resultPath: javaResult.resultPath, records: javaRecords }, revision: after.revision };
      });
      operation.completedAt = new Date().toISOString(); delete operation.interruption;
      await save(checkpoint, operation); await save(join(root, "customer-runtime-receiving.json"), operation); return operation;
    } catch (error) {
      operation.interruption = { at: new Date().toISOString(), message: error.message, stdoutPath: error.stdoutPath ?? null, stderrPath: error.stderrPath ?? null };
      await save(checkpoint, operation); throw error;
    } finally { if (host) await host.close(); if (receivedHost) await receivedHost.close(); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, ...words] = process.argv.slice(2), options = {};
  try {
    if (!directory) throw new Error("Provide the original private receiving operation directory");
    for (let index = 0; index < words.length; index += 2) {
      const key = { "--runtime": "runtime", "--python": "python", "--java": "java" }[words[index]];
      if (!key || !words[index + 1]) throw new Error("Unknown or incomplete customer receiving option");
      if (Object.hasOwn(options, key)) throw new Error("Repeated customer receiving option"); options[key] = words[index + 1];
    }
    console.log(JSON.stringify(await receiveCustomerProducerRuntime(directory, options), null, 2));
  } catch (error) { console.error(JSON.stringify({ error: error.message, stack: error.stack })); process.exitCode = 1; }
}
