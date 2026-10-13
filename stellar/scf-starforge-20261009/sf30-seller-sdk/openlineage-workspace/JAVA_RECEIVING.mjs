#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { APPLICATION_FILES, verifyBundle, receiveBundle } from "./store.mjs";
import { startServer } from "./server.mjs";
import { LineageClient } from "./client.mjs";
import { prepareJavaProducer, emitJavaProducer } from "./JAVA_PRODUCER.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const JAVA_FILES = ["OpenLineageNativeProducer.java", "java-producer-pom.xml", "JAVA_PRODUCER.mjs", "JAVA_PRODUCER.md"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = path => fs.readFile(path, "utf8").then(JSON.parse);
const exists = path => fs.access(path).then(() => true, error => {
  if (error.code === "ENOENT") return false; throw error;
});
async function original(path, bytes) {
  const content = Buffer.from(bytes);
  try {
    const handle = await fs.open(path, "wx", 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    assert.deepEqual(await fs.readFile(path), content, "Retained operation content differs");
  }
}
async function save(path, value) {
  const pending = path + ".pending-" + randomUUID();
  await original(pending, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(pending, path);
}
async function secret(path) {
  if (!await exists(path)) await original(path, randomBytes(32).toString("hex"));
  return (await fs.readFile(path, "utf8")).trim();
}
async function operationLock(root, action) {
  const path = join(root, "java-receiving.lock"), identity = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await original(path, JSON.stringify({ id: identity, pid: process.pid })); break; }
    catch (error) {
      if (!await exists(path)) throw error;
      const retained = await fs.readFile(path), owner = JSON.parse(retained);
      try { process.kill(owner.pid, 0); throw new Error("The original Java receiving process is active"); }
      catch (failure) {
        if (failure.code !== "ESRCH") throw failure;
        assert.deepEqual(await fs.readFile(path), retained);
        await fs.unlink(path);
      }
      if (attempt === 1) throw error;
    }
  }
  try { return await action(); }
  finally {
    if (await exists(path) && (await json(path)).id === identity) await fs.unlink(path);
  }
}
async function latestAttempt(directory, status = null, optional = false) {
  const root = join(directory, "native");
  const names = (await fs.readdir(root).catch(error => { if (optional && error.code === "ENOENT") return []; throw error; })).filter(name => name.endsWith(".attempt.json"));
  const rows = (await Promise.all(names.map(async name => ({ ...(await json(join(root, name))), file: join(root, name) })))).filter(row => status === null || row.httpStatus === status);
  rows.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  if (optional && !rows.length) return null;
  assert.ok(rows.length, "Read the actual native HTTP attempt");
  return rows.at(-1);
}

/** Continue the released Java client through the original receiver, export and delivered application. */
export async function receiveJavaProducers(directory, options = {}) {
  const root = resolve(directory);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  return operationLock(root, async () => {
    const checkpoint = join(root, "java-receiving-operation.json");
    const sources = {};
    for (const name of JAVA_FILES) sources[name] = hash(await fs.readFile(join(ROOT, name)));
    const workspaceDirectory = resolve(options.workspaceDirectory ?? join(root, "workspace"));
    const runtimeDirectory = resolve(options.runtimeDirectory ?? join(root, "runtime"));
    const operatorFile = resolve(options.operatorTokenFile ?? join(root, "operator-token"));
    const producerFile = resolve(options.producerTokenFile ?? join(root, "producer-token"));
    const operation = await exists(checkpoint) ? await json(checkpoint) : {
      schema: "commons.openlineage.java-receiving.v1", operationId: "SCF-OPENLINEAGE-JAVA-9F05-20261012",
      startedAt: new Date().toISOString(), workspaceDirectory, runtimeDirectory, sources, completed: {}
    };
    assert.deepEqual(operation.sources, sources, "Continue with the original released Java client source");
    assert.equal(operation.workspaceDirectory, workspaceDirectory);
    assert.equal(operation.runtimeDirectory, runtimeDirectory);
    if (operation.completedAt) {
      await save(join(root, "java-receiving.json"), operation);
      return operation;
    }
    await save(checkpoint, operation);
    const phase = async (name, action) => {
      if (operation.completed[name]) return operation.completed[name];
      const result = await action();
      operation.completed[name] = result; delete operation.interruption;
      await save(checkpoint, operation);
      if (options.progress) options.progress({ phase: name, completedAt: new Date().toISOString() });
      return result;
    };
    let host, receivedHost;
    try {
      const runtime = await phase("released-java-runtime", () => prepareJavaProducer({
        directory: runtimeDirectory, maven: options.maven ?? "mvn", offline: options.offline === true
      }));
      const sdk = runtime.entries.find(item => item.path.endsWith("/openlineage-java-1.53.0.jar"));
      assert.ok(sdk); assert.equal(runtime.sdkVersion, "1.53.0");
      const operatorToken = await secret(operatorFile), producerToken = await secret(producerFile);
      assert.notEqual(operatorToken, producerToken);
      await fs.mkdir(join(root, "wire"), { recursive: true, mode: 0o700 });
      host = await startServer({ directory: workspaceDirectory, port: operation.port ?? 0, token: operatorToken, producerToken });
      if (operation.workspaceId) assert.equal(host.identity.workspaceId, operation.workspaceId);
      else {
        operation.workspaceId = host.identity.workspaceId;
        operation.initialRevision = (await host.workspace.read()).revision;
        await save(checkpoint, operation);
      }
      operation.port = Number(new URL(host.url).port);
      await save(checkpoint, operation);
      const operator = () => new LineageClient(host.url, {
        token: operatorToken, expectedWorkspaceId: operation.workspaceId, instanceId: host.identity.instanceId
      });
      const input = name => join(ROOT, name);
      const emit = (server, name, fixture, compression, operationId, module = { emitJavaProducer }, identity = server.identity) =>
        module.emitJavaProducer({ runtime: runtimeDirectory, directory: join(root, name), connection: identity,
          tokenFile: producerFile, inputs: [input(fixture)], operationId, compression, java: options.java ?? "java" });
      async function retainedWires(server, emission) {
        const state = await server.workspace.read(), records = [];
        assert.equal(emission.workspaceId, operation.workspaceId);
        assert.equal(emission.sdkVersion, "1.53.0");
        for (const sent of emission.events) {
          const saved = state.operations.find(item => item.id === sent.operationId);
          assert.ok(saved, "The native SDK operation has a committed receiver record");
          const source = state.sources.find(item => item.id === saved.result.source.id);
          assert.ok(source);
          const receiverWire = await server.workspace.readObject(source.id);
          const producerWire = await fs.readFile(join(emission.directory, "native", sent.wire));
          const serialized = await fs.readFile(join(emission.directory, "native", sent.serialized));
          const response = await fs.readFile(join(emission.directory, "native", sent.response));
          assert.deepEqual(receiverWire, producerWire, "The producer's streamed bytes equal the receiver's original object");
          assert.equal(hash(producerWire), sent.wireSha256); assert.equal(hash(producerWire), source.id);
          assert.equal(hash(serialized), sent.serializedSha256); assert.equal(hash(response), sent.responseSha256);
          const decoded = source.contentEncoding === "gzip" ? gunzipSync(receiverWire) : receiverWire;
          assert.deepEqual(decoded, serialized, "The native SDK serialization is the actual decoded source");
          assert.equal(sent.acknowledgement.source.id, source.id);
          assert.equal(sent.acknowledgement.workspaceId, operation.workspaceId);
          const wireFile = join(root, "wire", source.id + (source.contentEncoding === "gzip" ? ".json.gz" : ".json"));
          await original(wireFile, receiverWire);
          records.push({ operationId: sent.operationId, sourceId: source.id, wireFile, wireBytes: receiverWire.length,
            encoding: source.contentEncoding ?? "identity", serializedSha256: sent.serializedSha256,
            responseSha256: sent.responseSha256, eventClass: sent.eventClass,
            receiverRevision: sent.acknowledgement.revision, replayed: sent.acknowledgement.replayed === true });
        }
        return records;
      }
      const cases = [
        { name: "gzip-full-run", fixture: "fixture-event-full.json", compression: "gzip", operationId: "java-native-full-gzip" },
        { name: "plain-simple-run", fixture: "fixture-event-simple.json", compression: "identity", operationId: "java-native-simple-plain" },
        { name: "gzip-simple-run", fixture: "fixture-event-simple.json", compression: "gzip", operationId: "java-native-simple-gzip" }
      ];
      for (const item of cases) await phase(item.name, async () => {
        const emission = await emit(host, item.name, item.fixture, item.compression, item.operationId);
        return { originalFixture: item.fixture, originalFixtureSha256: hash(await fs.readFile(input(item.fixture))),
          nativeResult: emission.resultPath, records: await retainedWires(host, emission) };
      });
      await phase("native-workspace-pin", async () => {
        const before = await operator().metadata();
        const wrong = operation.wrongWorkspaceId ?? randomUUID();
        operation.wrongWorkspaceId = wrong; await save(checkpoint, operation);
        await assert.rejects(emit(host, "wrong-workspace", "fixture-event-simple.json", "gzip", "java-native-wrong-workspace",
          { emitJavaProducer }, { ...host.identity, workspaceId: wrong }));
        const attempt = await latestAttempt(join(root, "wrong-workspace"));
        assert.equal(attempt.httpStatus, 409);
        assert.equal((await operator().metadata()).revision, before.revision);
        return { attemptFile: attempt.file, httpStatus: attempt.httpStatus, receiverRevision: before.revision };
      });
      await phase("native-writer-recovery", async () => {
        const before = await operator().metadata();
        const recoveryDirectory = join(root, "writer-recovery");
        const send = () => emit(host, "writer-recovery", "fixture-event-full.json", "identity", "java-native-writer-recovery");
        let attempt = await latestAttempt(recoveryDirectory, 503, true);
        if (!attempt) {
          await host.workspace.lock(async () => { await assert.rejects(send()); });
          attempt = await latestAttempt(recoveryDirectory, 503);
          assert.equal((await operator().metadata()).revision, before.revision);
        }
        assert.equal(attempt.httpStatus, 503);
        if (!await exists(join(recoveryDirectory, "java-producer-result.json"))) {
          const seconds = Number(attempt.responseHeaders?.["retry-after"] ?? 1);
          assert.ok(Number.isFinite(seconds) && seconds >= 0 && seconds <= 30);
          await new Promise(accept => setTimeout(accept, seconds * 1000));
        }
        const emission = await send(), records = await retainedWires(host, emission);
        assert.equal(records[0].wireSha256 ?? records[0].sourceId, attempt.wireSha256);
        return { interruptedAttempt: attempt.file, httpStatus: attempt.httpStatus, nativeResult: emission.resultPath, records };
      });
      await phase("native-restart-replay", async () => {
        const before = await operator().metadata(), previousInstanceId = host.identity.instanceId;
        await host.close();
        host = await startServer({ directory: workspaceDirectory, port: operation.port ?? 0, token: operatorToken, producerToken });
        const emission = await emit(host, "restart-replay", "fixture-event-simple.json", "gzip", "java-native-simple-gzip");
        const records = await retainedWires(host, emission);
        assert.ok(records.every(item => item.replayed));
        assert.deepEqual(records.map(item => item.sourceId), operation.completed["gzip-simple-run"].records.map(item => item.sourceId));
        assert.equal((await operator().metadata()).revision, before.revision);
        assert.notEqual(host.identity.instanceId, previousInstanceId);
        return { previousInstanceId, instanceId: host.identity.instanceId, nativeResult: emission.resultPath, records, revision: before.revision };
      });
      const edition = await phase("saved-java-edition", async () => {
        const state = await operator().metadata();
        return (await operator().saveEdition({ title: "Native Java producer receiving",
          description: "Released OpenLineage Java 1.53.0 models and HTTP transport, original inputs, streamed wire and receiver acknowledgements.",
          operationId: "java-native-producer-edition", expectedRevision: state.revision })).edition;
      });
      const exported = await phase("complete-export", async () => {
        for (const name of JAVA_FILES) assert.ok(APPLICATION_FILES.includes(name), "The composed application export includes " + name);
        if (!operation.preparedExport) {
          operation.preparedExport = await operator().exportWorkspace(); await save(checkpoint, operation);
        }
        const result = operation.preparedExport, destination = join(root, "java-workspace-" + result.id + ".json");
        await operator().downloadExport(result.id, destination);
        const verified = verifyBundle(await fs.readFile(destination));
        assert.equal(verified.packageSha256, result.id);
        for (const name of JAVA_FILES) assert.equal(hash(verified.application.get(name)), sources[name]);
        for (const item of [...cases.map(item => item.name), "native-writer-recovery"])
          for (const record of operation.completed[item].records) assert.ok(verified.objects.has(record.sourceId));
        return { ...result, exportFile: destination, editionId: edition.id, applicationFiles: verified.application.size };
      });
      await phase("received-native-client", async () => {
        const destination = join(root, "received-" + exported.id), bytes = await fs.readFile(exported.exportFile);
        if (await exists(destination)) assert.equal((await json(join(destination, "received.json"))).packageSha256, exported.id);
        else await receiveBundle(bytes, destination);
        const deliveredServer = await import(pathToFileURL(join(destination, "application", "server.mjs")).href);
        const deliveredClient = await import(pathToFileURL(join(destination, "application", "JAVA_PRODUCER.mjs")).href);
        receivedHost = await deliveredServer.startServer({ directory: destination, port: 0, token: operatorToken, producerToken });
        const emission = await deliveredClient.emitJavaProducer({ runtime: runtimeDirectory,
          directory: join(root, "received-replay"), connection: receivedHost.identity, tokenFile: producerFile,
          inputs: [join(destination, "application", "fixture-event-simple.json")], operationId: "java-native-simple-gzip",
          compression: "gzip", java: options.java ?? "java" });
        const records = await retainedWires(receivedHost, emission);
        assert.ok(records.every(item => item.replayed));
        const state = await receivedHost.workspace.read();
        assert.equal(state.workspaceId, operation.workspaceId); assert.equal(state.revision, exported.revision);
        assert.ok(state.editions.some(item => item.id === edition.id));
        assert.deepEqual(records.map(item => item.sourceId), operation.completed["gzip-simple-run"].records.map(item => item.sourceId));
        return { directory: destination, workspaceId: state.workspaceId, revision: state.revision,
          editionId: edition.id, nativeResult: emission.resultPath, records, applicationFiles: exported.applicationFiles };
      });
      operation.completedAt = new Date().toISOString(); delete operation.interruption;
      operation.sdk = { version: "1.53.0", sha256: sdk.sha256, bytes: sdk.bytes };
      await save(join(root, "java-receiving.json"), operation); await save(checkpoint, operation);
      return operation;
    } catch (error) {
      operation.interruption = { at: new Date().toISOString(), message: error.message,
        stdoutPath: error.stdoutPath ?? null, stderrPath: error.stderrPath ?? null };
      await save(checkpoint, operation); throw error;
    } finally {
      if (receivedHost) await receivedHost.close();
      if (host) await host.close();
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, ...args] = process.argv.slice(2), options = {};
  const keys = { "--runtime": "runtimeDirectory", "--java": "java", "--maven": "maven",
    "--workspace": "workspaceDirectory", "--operator-token-file": "operatorTokenFile", "--producer-token-file": "producerTokenFile" };
  try {
    if (!directory) throw new Error("Provide the original private Java receiving directory");
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--offline") { options.offline = true; continue; }
      const key = keys[args[i]];
      if (!key || !args[i + 1]) throw new Error("Invalid Java receiving argument " + args[i]);
      options[key] = args[++i];
    }
    console.log(JSON.stringify(await receiveJavaProducers(directory, options), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, stdoutPath: error.stdoutPath ?? null,
      stderrPath: error.stderrPath ?? null, stack: error.stack })); process.exitCode = 1;
  }
}
