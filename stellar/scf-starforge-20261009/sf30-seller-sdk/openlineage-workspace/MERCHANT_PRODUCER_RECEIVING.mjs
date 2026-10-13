#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { strict as assert } from "node:assert";
import { startServer } from "./server.mjs";
import { LineageClient } from "./client.mjs";
import { MerchantOpenLineageWorkspaces } from "./mcp.mjs";
import { readLineageWorkspaceConfiguration } from "./mcp-client.mjs";
import { verifyBundle, receiveBundle } from "./store.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const ORIGINALS = [
  { path: "fixture-event-simple.json", git: "3b6936894172b4fc78f9b385771695fb6e2a8720" },
  { path: "fixture-event-full.json", git: "d0f19663859955c95afde83bd7bd3fcdffc641e8" }
];
async function exists(path) { try { await fs.access(path); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } }
async function json(path) { return JSON.parse(await fs.readFile(path, "utf8")); }
async function save(path, value) {
  const pending = path + ".pending";
  await fs.writeFile(pending, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(pending, path);
}
async function newOrSame(path, bytes) {
  try { await fs.writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; assert.deepEqual(await fs.readFile(path), Buffer.from(bytes)); }
}
async function token(path) {
  if (!await exists(path)) await newOrSame(path, randomBytes(32).toString("hex"));
  return (await fs.readFile(path, "utf8")).trim();
}

/** Operate the real merchant producer workflow and reopen its complete application. */
export async function receiveMerchantProducers(directory) {
  const root = resolve(directory), checkpoint = join(root, "merchant-producer-operation.json");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (!await exists(checkpoint) && (await fs.readdir(root)).length) throw new Error("Select an empty directory or this original merchant producer operation");
  const operation = await exists(checkpoint) ? await json(checkpoint) : {
    schema: "commons.openlineage.merchant-producer-receiving.v1",
    operationId: "merchant-producer-receiving", directory: root, startedAt: new Date().toISOString(), completed: {}
  };
  assert.equal(operation.schema, "commons.openlineage.merchant-producer-receiving.v1");
  assert.equal(operation.directory, root);
  operation.applicationSources = {};
  for (const name of ["mcp-client.mjs", "mcp.mjs", "mcp-tools.mjs", "cli.mjs", "MERCHANT.md"])
    operation.applicationSources[name] = hash(await fs.readFile(join(ROOT, name)));
  const record = async (name, value) => { operation.completed[name] = value; await save(checkpoint, operation); return value; };
  await save(checkpoint, operation);
  const originals = [];
  for (const original of ORIGINALS) {
    const bytes = await fs.readFile(join(ROOT, original.path));
    assert.equal(createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex"), original.git);
    originals.push(bytes);
  }
  const wires = [originals[0], gzipSync(originals[1], { level: 3 }), originals[1]];
  const names = ["original-simple.json", "original-full.json.gz", "original-full.json"];
  for (let i = 0; i < wires.length; i++) await newOrSame(join(root, names[i]), wires[i]);
  const operatorFile = join(root, "operator-token"), producerFile = join(root, "producer-token");
  const operatorToken = await token(operatorFile);
  let producerToken = await token(producerFile), host, owner, receivingHost, receivingOwner;
  const workspacePath = join(root, "workspace");
  try {
    host = await startServer({ directory: workspacePath, port: operation.port ?? 0, token: operatorToken, producerToken });
    if (operation.workspaceId) assert.equal(host.identity.workspaceId, operation.workspaceId);
    operation.workspaceId = host.identity.workspaceId;
    operation.port = Number(new URL(host.url).port);
    await save(checkpoint, operation);
    const rawConfig = { schema: "stellar-forge.openlineage-workspace-host.v1", workspaces: { operations: {
      label: "Producer operations", connectionFile: join(workspacePath, "connection.json"), workspaceId: operation.workspaceId,
      tokenFile: operatorFile, timeoutMs: 30000,
      inputs: Object.fromEntries(names.map((name, i) => ["source" + i, {
        path: join(root, name), kind: "source", sha256: hash(wires[i]), name,
        sourceReference: "Original upstream OpenLineage fixture"
      }])),
      producer: { tokenFile: producerFile, directory: join(root, "producer-configurations"), profiles: {
        python: { client: "python", compression: "gzip", timeoutSeconds: 30 },
        java: { client: "java", compression: "gzip", timeoutSeconds: 30 }
      } }
    } } };
    const configFile = join(root, "merchant-host.json");
    await newOrSame(configFile, JSON.stringify(rawConfig, null, 2) + "\n");
    owner = new MerchantOpenLineageWorkspaces({ openlineageWorkspaces: await readLineageWorkspaceConfiguration(configFile) });
    const call = (name, args = {}) => owner.call("merchant_lineage_" + name, { workspace: "operations", ...args });
    const operator = () => new LineageClient(host.url, { token: operatorToken, expectedWorkspaceId: operation.workspaceId, instanceId: host.identity.instanceId });
    const emission = (i, extra = {}) => ({ input: "source" + i, expectedSha256: hash(wires[i]),
      operationId: ["merchant-producer-simple", "merchant-producer-gzip", "merchant-producer-recovery"][i],
      contentEncoding: i === 1 ? "gzip" : "identity", ...extra });
    assert.equal((await call("producer_status")).state, "receiving");
    assert.equal((await call("producer_profiles")).profiles.length, 2);
    const configured = {};
    for (const profile of ["python", "java"]) {
      const [first, concurrent] = await Promise.all([
        call("producer_configure", { profile }), call("producer_configure", { profile })
      ]);
      const again = await call("producer_configure", { profile });
      assert.equal(first.sha256, concurrent.sha256); assert.equal(first.configurationFile, concurrent.configurationFile);
      assert.equal(first.sha256, again.sha256); assert.equal(again.reused, true);
      const configBytes = await fs.readFile(first.configurationFile), actual = JSON.parse(configBytes);
      assert.equal(hash(configBytes), first.sha256);
      assert.equal(actual.transport[profile === "python" ? "custom_headers" : "headers"]["X-OpenLineage-Workspace"], operation.workspaceId);
      assert.equal(actual.transport.auth.apiKey, producerToken);
      if (process.platform !== "win32") assert.equal((await fs.stat(first.configurationFile)).mode & 0o077, 0);
      assert.equal(JSON.stringify(first).includes(producerToken), false);
      configured[profile] = first;
    }
    await record("upstream-configurations", configured);
    const simple = await call("emit_file", emission(0));
    assert.equal(simple.source.id, hash(wires[0]));
    const gzipRevision = (await operator().metadata()).revision;
    const gzipArgs = emission(1, { expectedRevision: gzipRevision });
    const compressed = await call("emit_file", gzipArgs), replay = await call("emit_file", gzipArgs);
    assert.equal(compressed.source.id, hash(wires[1])); assert.equal(replay.replayed, true);
    await record("complete-file-emission", { simple, compressed, replay });

    // The original writer supplies real backpressure. Retain the captured input
    // across that uncertain wait, then recover even while its host file is moved.
    await host.workspace.lock(async () => {
      await assert.rejects(call("emit_file", emission(2)), error => error.status === 503 && error.details?.outcome === "UNCERTAIN");
    });
    const moved = join(root, names[2] + ".retained");
    await fs.rename(join(root, names[2]), moved);
    let recovered;
    try {
      await assert.rejects(call("emit_file", emission(2, { sourceUrl: "Changed request" })), error => error.status === 409 && error.code === "OPENLINEAGE_RECOVERY_INPUT");
      recovered = await call("emit_file", emission(2));
      assert.equal(recovered.source.id, hash(wires[2]));
    } finally { await fs.rename(moved, join(root, names[2])); }
    await record("original-buffer-recovery", { wireSha256: hash(wires[2]), receipt: recovered });
    const metadata = await operator().metadata();
    const edition = await operator().saveEdition({ title: "Producer intake receiving",
      description: "Original sources sent from the configured merchant host.",
      operationId: "merchant-producer-edition", expectedRevision: metadata.revision });

    const origin = host.url, port = Number(new URL(origin).port), previousInstance = host.identity.instanceId;
    await host.close();
    host = await startServer({ directory: workspacePath, port, token: operatorToken, producerToken });
    assert.equal(host.url, origin); assert.notEqual(host.identity.instanceId, previousInstance);
    await assert.rejects(call("producer_status"), error => error.status === 409);
    const connection = await call("connection");
    assert.equal(connection.reconnectRequired, true);
    await call("reconnect", { expectedInstanceId: connection.selected.instanceId });
    const sameConfig = await call("producer_configure", { profile: "python" });
    assert.equal(sameConfig.sha256, configured.python.sha256); assert.equal(sameConfig.reused, true);
    await record("explicit-reconnect", { previousInstance, instanceId: host.identity.instanceId, configuration: sameConfig });

    const previousToken = producerToken;
    producerToken = randomBytes(32).toString("hex");
    await host.close();
    await fs.writeFile(producerFile + ".pending", producerToken, { mode: 0o600 });
    await fs.rename(producerFile + ".pending", producerFile);
    host = await startServer({ directory: workspacePath, port, token: operatorToken, producerToken });
    await call("reconnect", { expectedInstanceId: host.identity.instanceId });
    const rotated = await call("producer_configure", { profile: "python" });
    assert.notEqual(rotated.sha256, sameConfig.sha256);
    assert.equal(await exists(sameConfig.configurationFile), true);
    const oldEmitter = new LineageClient(host.url, { token: previousToken, expectedWorkspaceId: operation.workspaceId });
    await assert.rejects(oldEmitter.emitSource(wires[0], { operationId: "merchant-producer-simple" }), error => error.status === 401);
    assert.equal((await call("emit_file", emission(0))).replayed, true);
    await record("producer-token-rotation", rotated);
    await owner.close(); owner = null;
    assert.equal((await operator().producerStatus()).state, "receiving");

    const info = await operator().exportWorkspace(), exportFile = join(root, "merchant-workspace-" + info.id + ".json");
    await operator().downloadExport(info.id, exportFile);
    const bytes = await fs.readFile(exportFile), verified = verifyBundle(bytes);
    assert.equal(verified.packageSha256, info.id);
    for (const [name, sourceHash] of Object.entries(operation.applicationSources))
      assert.equal(hash(Buffer.from(verified.application.get(name))), sourceHash);
    const receivingPath = join(root, "received-" + info.id);
    if (await exists(receivingPath)) assert.equal((await json(join(receivingPath, "received.json"))).packageSha256, info.id);
    else await receiveBundle(bytes, receivingPath);
    const receiving = await import(pathToFileURL(join(receivingPath, "application", "server.mjs")).href);
    receivingHost = await receiving.startServer({ directory: receivingPath, port: 0, token: operatorToken, producerToken });
    const receivedConfig = structuredClone(rawConfig);
    receivedConfig.workspaces.operations.connectionFile = join(receivingPath, "connection.json");
    receivedConfig.workspaces.operations.producer.directory = join(root, "received-producer-configurations");
    const receivedConfigFile = join(root, "received-merchant-host.json");
    await save(receivedConfigFile, receivedConfig);
    const receivedMerchant = await import(pathToFileURL(join(receivingPath, "application", "mcp.mjs")).href);
    receivingOwner = new receivedMerchant.MerchantOpenLineageWorkspaces({
      openlineageWorkspaces: await receivedMerchant.readLineageWorkspaceConfiguration(receivedConfigFile)
    });
    assert.equal((await receivingOwner.call("merchant_lineage_producer_status", { workspace: "operations" })).state, "receiving");
    const receivedReplay = await receivingOwner.call("merchant_lineage_emit_file", { workspace: "operations", ...gzipArgs });
    assert.equal(receivedReplay.replayed, true);
    const receiver = new LineageClient(receivingHost.url, { token: operatorToken, expectedWorkspaceId: operation.workspaceId });
    const view = await receiver.read();
    assert.equal(view.workspaceId, operation.workspaceId);
    assert.equal(view.editions.some(value => value.id === edition.edition.id), true);
    for (const wire of wires) {
      const source = await receiver.action("source.read", { id: hash(wire) });
      assert.deepEqual(Buffer.from(source.base64, "base64"), wire);
    }
    await record("complete-application-receiving", {
      ...info, exportFile, receivingPath, sourceIds: view.sources.map(value => value.id),
      editionId: edition.edition.id, applicationFiles: verified.application.size, replay: receivedReplay
    });
    operation.completedAt = new Date().toISOString();
    delete operation.interruption;
    await save(checkpoint, operation);
    await save(join(root, "merchant-producer-receiving.json"), operation);
    return operation;
  } catch (error) {
    operation.interruption = { at: new Date().toISOString(), message: error.message, status: error.status ?? null };
    await save(checkpoint, operation); throw error;
  } finally {
    if (receivingOwner) await receivingOwner.close();
    if (owner) await owner.close();
    if (receivingHost) await receivingHost.close();
    if (host) await host.close();
  }
}
if (process.argv[1] && await fs.realpath(resolve(process.argv[1])).then(path => path === fileURLToPath(import.meta.url), () => false)) {
  if (!process.argv[2]) throw new Error("Provide the original private merchant producer receiving directory");
  receiveMerchantProducers(process.argv[2]).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({ error: error.message, status: error.status ?? null, stack: error.stack })); process.exitCode = 1;
  });
}
