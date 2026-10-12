#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { strict as assert } from "node:assert";
import { startServer } from "./server.mjs";
import { LineageClient } from "./client.mjs";
import { sha256, parseSource } from "./model.mjs";
import { verifyBundle, receiveBundle, LineageWorkspace } from "./store.mjs";
import { producerConfiguration } from "./producer.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const ORIGINALS = [
  { path: "fixture-event-simple.json", git: "3b6936894172b4fc78f9b385771695fb6e2a8720" },
  { path: "fixture-event-full.json", git: "d0f19663859955c95afde83bd7bd3fcdffc641e8" }
];
async function readJson(path) { return JSON.parse(await fs.readFile(path, "utf8")); }
async function present(path) { try { await fs.access(path); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } }
async function save(path, value) {
  const pending = path + ".pending";
  await fs.writeFile(pending, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(pending, path);
}
async function newOrSame(path, bytes) {
  try { await fs.writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; assert.deepEqual(await fs.readFile(path), Buffer.from(bytes), "Existing operation source differs: " + path); }
}
async function key(path) {
  try { await fs.writeFile(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  return (await fs.readFile(path, "utf8")).trim();
}

/** Continue this exact original producer receiving operation in its private directory. */
export async function receiveOriginalProducers(directory) {
  const root = resolve(directory), checkpoint = join(root, "producer-operation.json");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (!await present(checkpoint) && (await fs.readdir(root)).length)
    throw new Error("Select an empty directory or this original producer operation");
  const operation = await present(checkpoint) ? await readJson(checkpoint) : {
    schema: "commons.openlineage.producer-receiving.v1", operationId: "SCF-OPENLINEAGE-OPERATIONS-6804-20261012",
    directory: root, startedAt: new Date().toISOString(), completed: {}, applicationSources: []
  };
  assert.equal(operation.schema, "commons.openlineage.producer-receiving.v1");
  assert.equal(operation.directory, root);
  const currentSource = await fs.readFile(new URL("./producer.mjs", import.meta.url));
  const sourceHash = sha256(currentSource);
  if (!operation.applicationSources.includes(sourceHash)) operation.applicationSources.push(sourceHash);
  await save(checkpoint, operation);
  const phase = async (name, run) => {
    if (Object.hasOwn(operation.completed, name)) return operation.completed[name];
    const value = await run(); operation.completed[name] = value; await save(checkpoint, operation); return value;
  };
  const originals = [];
  for (const original of ORIGINALS) {
    const bytes = await fs.readFile(join(ROOT, original.path));
    assert.equal(createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex"), original.git);
    originals.push(bytes);
  }
  const wires = [originals[0], gzipSync(originals[0], { level: 3 }), gzipSync(originals[1], { level: 3 }), originals[1]];
  const names = ["original-simple.json", "original-simple.json.gz", "original-full.json.gz", "original-full.json"];
  const encodings = ["identity", "gzip", "gzip", "identity"], originIndex = [0, 0, 1, 1];
  for (let i = 0; i < wires.length; i++) await newOrSame(join(root, names[i]), wires[i]);
  const operatorToken = await key(join(root, "operator-token")), producerToken = await key(join(root, "producer-token"));
  let host, receivedHost;
  try {
    host = await startServer({ directory: join(root, "workspace"), port: 0, token: operatorToken, producerToken });
    if (operation.workspaceId) assert.equal(host.identity.workspaceId, operation.workspaceId);
    operation.workspaceId = host.identity.workspaceId; await save(checkpoint, operation);
    const operator = () => new LineageClient(host.url, { token: operatorToken, expectedWorkspaceId: operation.workspaceId });
    const emitter = () => new LineageClient(host.url, { token: producerToken, expectedWorkspaceId: operation.workspaceId });
    const emit = index => emitter().emitSource(wires[index], { name: names[index], contentEncoding: encodings[index] });
    await phase("configuration", async () => {
      const python = producerConfiguration(host.identity, { token: producerToken });
      const java = producerConfiguration(host.identity, { token: producerToken, client: "java" });
      const pythonFile = "python-openlineage-" + host.identity.instanceId + ".yaml";
      const javaFile = "java-openlineage-" + host.identity.instanceId + ".yaml";
      await newOrSame(join(root, pythonFile), JSON.stringify(python, null, 2) + "\n");
      await newOrSame(join(root, javaFile), JSON.stringify(java, null, 2) + "\n");
      assert.equal(python.transport.custom_headers["X-OpenLineage-Workspace"], operation.workspaceId);
      assert.equal(java.transport.headers["X-OpenLineage-Workspace"], operation.workspaceId);
      await assert.rejects(emitter().metadata(), error => error.status === 401);
      return { workspaceId: operation.workspaceId, python: pythonFile, java: javaFile };
    });
    await phase("concurrent-originals", async () => {
      const receipts = await Promise.all([0, 1, 2, 1, 0, 2].map(emit));
      const view = await operator().read(), expected = [...new Set(originals.flatMap(bytes => parseSource(bytes).events.map(x => x.id)))].sort();
      assert.deepEqual(view.sources.map(x => x.id).sort(), wires.slice(0, 3).map(sha256).sort());
      assert.equal(view.eventCount, expected.length);
      assert.ok(receipts.filter(x => x.replayed).length >= 3);
      const journal = await host.workspace.read();
      assert.equal(journal.operations.filter(x => wires.slice(0, 3).some(body => x.id === "intake-" + sha256(body))).length, 3);
      const gzipSources = view.sources.filter(x => x.contentEncoding === "gzip");
      assert.equal(gzipSources.length, 2);
      for (const source of gzipSources) {
        const decoded = await operator().action("source.read", { id: source.id, decode: true });
        assert.equal(sha256(Buffer.from(decoded.base64, "base64")), source.id);
        assert.equal(sha256(Buffer.from(decoded.decodedBase64, "base64")), source.decodedSha256);
      }
      const status = await operator().producerStatus();
      assert.equal(status.pending, 0); assert.equal(status.bufferedBytes, 0);
      return { receipts, originalEventIds: expected, producerStatus: status };
    });
    await phase("writer-backpressure", async () => {
      // Hold the actual original writer while the real HTTP producer arrives.
      await host.workspace.lock(async () => {
        await assert.rejects(emit(3), error => error.status === 503 && error.retryAfter === "1");
      });
      const recovered = await emit(3);
      assert.equal(recovered.source.id, sha256(wires[3]));
      return { httpStatusWhileWriterActive: 503, retryAfterSeconds: 1, receipt: recovered };
    });
    const edition = await phase("reviewed-edition", async () => {
      const current = await operator().metadata();
      const result = await operator().saveEdition({ title: "Original producer transport receiving",
        description: "Unchanged upstream event bodies received concurrently in plain and gzip HTTP transports.",
        operationId: "producer-receiving-edition", expectedRevision: current.revision });
      return result.edition;
    });
    await phase("restart-replay", async () => {
      const before = await operator().metadata(), instance = host.identity.instanceId;
      await host.close(); host = await startServer({ directory: join(root, "workspace"), port: 0, token: operatorToken, producerToken });
      assert.notEqual(host.identity.instanceId, instance);
      const replay = await emit(1), after = await operator().metadata();
      assert.equal(replay.replayed, true); assert.equal(after.revision, before.revision);
      assert.equal(replay.source.id, sha256(wires[1]));
      return { previousInstanceId: instance, instanceId: host.identity.instanceId, receipt: replay, revision: after.revision };
    });
    const exported = await phase("complete-export", async () => {
      if (!operation.preparedExport) {
        operation.preparedExport = await operator().exportWorkspace(); await save(checkpoint, operation);
      }
      const info = operation.preparedExport, destination = join(root, "producer-workspace.json");
      await operator().downloadExport(info.id, destination);
      const verified = verifyBundle(await fs.readFile(destination));
      assert.equal(verified.packageSha256, info.id);
      assert.deepEqual(verified.state.sources.map(x => x.id).sort(), wires.map(sha256).sort());
      assert.equal(verified.state.editions[0].id, edition.id);
      assert.equal(verified.application.has("producer.mjs"), true);
      assert.equal(verified.application.has("source-encoding.mjs"), true);
      return { ...info, destination, applicationFiles: verified.application.size };
    });
    const receivedPath = join(root, "received");
    await phase("independent-receiving", async () => {
      const bytes = await fs.readFile(exported.destination);
      if (await present(receivedPath)) {
        const prior = await readJson(join(receivedPath, "received.json"));
        assert.equal(prior.packageSha256, exported.id);
      } else await receiveBundle(bytes, receivedPath);
      const receiver = await import(pathToFileURL(join(receivedPath, "application", "server.mjs")).href);
      receivedHost = await receiver.startServer({ directory: receivedPath, port: 0, token: operatorToken, producerToken });
      const client = new LineageClient(receivedHost.url, { token: operatorToken, expectedWorkspaceId: operation.workspaceId });
      const view = await client.read(), status = await client.producerStatus();
      assert.equal(view.workspaceId, operation.workspaceId); assert.equal(view.editions[0].id, edition.id);
      assert.equal(status.state, "receiving");
      for (let i = 0; i < wires.length; i++) {
        const source = view.sources.find(x => x.id === sha256(wires[i])); assert.ok(source);
        const original = await client.action("source.read", { id: source.id, decode: true });
        assert.deepEqual(Buffer.from(original.base64, "base64"), wires[i]);
        if (encodings[i] === "gzip") assert.deepEqual(Buffer.from(original.decodedBase64, "base64"), originals[originIndex[i]]);
      }
      const emitter = new LineageClient(receivedHost.url, { token: producerToken, expectedWorkspaceId: operation.workspaceId });
      const replay = await emitter.emitSource(wires[2], { name: names[2], contentEncoding: "gzip" });
      assert.equal(replay.replayed, true); assert.equal((await client.metadata()).revision, exported.revision);
      return { directory: receivedPath, workspaceId: view.workspaceId, editionId: edition.id,
        sourceIds: view.sources.map(x => x.id), replay, applicationFiles: exported.applicationFiles };
    });
    operation.completedAt = new Date().toISOString(); await save(checkpoint, operation);
    const result = { schema: operation.schema, operationId: operation.operationId, workspaceId: operation.workspaceId,
      startedAt: operation.startedAt, completedAt: operation.completedAt, originalSourceGitBlobs: ORIGINALS,
      applicationSources: operation.applicationSources, completed: operation.completed };
    await save(join(root, "producer-receiving.json"), result);
    return result;
  } catch (error) {
    operation.interruption = { at: new Date().toISOString(), message: error.message, status: error.status ?? null };
    await save(checkpoint, operation); throw error;
  } finally {
    if (receivedHost) await receivedHost.close();
    if (host) await host.close();
  }
}
if (process.argv[1] && await fs.realpath(resolve(process.argv[1])).then(path => path === fileURLToPath(import.meta.url), () => false)) {
  if (!process.argv[2]) throw new Error("Provide this original private producer receiving directory");
  receiveOriginalProducers(process.argv[2]).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({ error: error.message, status: error.status ?? null })); process.exitCode = 1;
  });
}
