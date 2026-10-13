#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { LineageClient } from "./client.mjs";
import { LineageWorkspace, receiveBundle, verifyBundle } from "./store.mjs";
import { producerConfiguration } from "./producer.mjs";
import { sha256, runKey } from "./model.mjs";

const APP = dirname(fileURLToPath(import.meta.url));
const SCHEMA = "commons.openlineage.async-producer-receiving.v1";
const OPERATION = "OPENLINEAGE-UPSTREAM-CLIENTS-24EA-20261012";
const ORIGINALS = [
  { name: "fixture-event-simple.json", git: "3b6936894172b4fc78f9b385771695fb6e2a8720" },
  { name: "fixture-event-full.json", git: "d0f19663859955c95afde83bd7bd3fcdffc641e8" }
];
const MODULES = [
  "native_async_producer.py", "async-producer.mjs", "ASYNC_PYTHON_PRODUCER.md",
  "ASYNC_PRODUCER_RECEIVING.mjs"
];
const exists = path => fs.access(path).then(() => true, error => {
  if (error.code === "ENOENT") return false;
  throw error;
});
const readJSON = async path => JSON.parse(await fs.readFile(path, "utf8"));
function receivingLease(directory) {
  const inherited = process.env.OPENLINEAGE_RECEIVING_LOCK_FD;
  const descriptor = Number(inherited), selected = process.env.OPENLINEAGE_RECEIVING_LOCK_ROOT;
  if (!/^\d+$/.test(inherited ?? "") || !Number.isSafeInteger(descriptor) || descriptor < 3 ||
      !selected || relative(resolve(selected), resolve(directory)).split(/[\\/]/).includes(".."))
    throw new Error("Use the original receiving supervisor and its inherited directory lease");
  return descriptor;
}

const recordName = id => createHash("sha256").update(id).digest("hex") + ".json";
async function save(path, value) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + ".pending-" + randomBytes(8).toString("hex");
  const file = await fs.open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
  await fs.rename(temporary, path);
  if (process.platform !== "win32") {
    const parent = await fs.open(dirname(path), "r");
    try { await parent.sync(); } finally { await parent.close(); }
  }
}
async function writeOriginal(path, bytes) {
  const body = Buffer.from(bytes);
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + ".pending-" + randomBytes(8).toString("hex");
  const file = await fs.open(temporary, "wx", 0o600);
  try { await file.writeFile(body); await file.sync(); }
  finally { await file.close(); }
  try {
    try { await fs.link(temporary, path); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      assert.deepEqual(await fs.readFile(path), body, "Original receiving file changed: " + path);
    }
  } finally { await fs.unlink(temporary); }
}
async function waitUntil(read, milliseconds = 30000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("The original native phase did not reach its retained observation");
}
async function privateToken(path) {
  if (!await exists(path)) await writeOriginal(path, randomBytes(32).toString("hex"));
  const token = (await fs.readFile(path, "utf8")).trim();
  assert.ok(token.length >= 24);
  return token;
}
async function records(client, collection) {
  const identity = await client.metadata(), result = [];
  let offset = 0;
  do {
    const page = await client.records({ collection, expectedRevision: identity.revision, offset, limit: 1000 });
    assert.equal(page.revision, identity.revision); assert.equal(page.collection, collection);
    assert.equal(page.offset, offset); result.push(...page.items); offset = page.nextOffset;
  } while (offset !== null);
  return { revision: identity.revision, records: result };
}

/** A controlled receiving seam that forwards real original requests to the actual host. */
async function responseRelay({ target, directory, holdOperation, holdUntil, dropOperation }) {
  let closed = false, capturedDrop = false;
  const sockets = new Set();
  const droppedPath = join(directory, "actual-lost-response.json");
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/api/v1/lineage")
        throw new Error("The native receiving relay accepts the original producer route only");
      const parts = []; let count = 0;
      for await (const chunk of request) {
        count += chunk.length; if (count > 64 * 1024 * 1024) throw new Error("Native body exceeds 64 MiB");
        parts.push(chunk);
      }
      const bytes = Buffer.concat(parts), operationId = request.headers["idempotency-key"];
      assert.equal(typeof operationId, "string");
      const headers = {};
      for (const key of ["authorization", "content-type", "content-encoding",
        "idempotency-key", "x-openlineage-workspace"]) {
        if (request.headers[key] !== undefined) headers[key] = request.headers[key];
      }
      const upstream = await fetch(new URL(request.url, target), {
        method: "POST", headers, body: bytes, redirect: "error", signal: AbortSignal.timeout(30000)
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const observed = {
        operationId, wireSha256: sha256(bytes), wireBytes: bytes.length,
        status: upstream.status, receivedAt: new Date().toISOString(),
        responseSha256: sha256(body), responseBytes: body.length,
        responseBase64: body.toString("base64")
      };
      await save(join(directory, "relay", recordName(operationId)), observed);
      if (operationId === holdOperation) {
        await waitUntil(holdUntil, 15000);
        // Let the native producer complete its immediately following ordering check.
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (operationId === dropOperation && upstream.status === 200 &&
          !capturedDrop && !await exists(droppedPath)) {
        capturedDrop = true;
        await save(droppedPath, observed);
        response.destroy();
        return;
      }
      response.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Content-Length": body.length,
        ...(upstream.headers.get("retry-after") ? { "Retry-After": upstream.headers.get("retry-after") } : {})
      });
      response.end(body);
    } catch (error) {
      if (!closed) await save(join(directory, "relay-error.json"), {
        at: new Date().toISOString(), message: error.message
      }).catch(() => {});
      response.destroy();
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    url: "http://127.0.0.1:" + server.address().port,
    close: async () => {
      if (closed) return; closed = true;
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        for (const socket of sockets) socket.destroy();
      });
    }
  };
}

/**
 * Continue the original native OpenLineage workspace through its async customer arm.
 * host is the existing started server; ownership and shutdown remain with its caller.
 */
export async function receiveAsyncProducers({
  directory, python, host, operatorToken, producerToken, sourceCommit = null
}) {
  assert.equal(typeof python, "string"); assert.ok(python.length);
  assert.equal(typeof host?.url, "string");
  assert.equal(typeof host?.identity?.workspaceId, "string");
  assert.ok(typeof operatorToken === "string" && operatorToken.length >= 24);
  assert.ok(typeof producerToken === "string" && producerToken.length >= 24 && producerToken !== operatorToken);
  assert.ok(sourceCommit === null || /^[0-9a-f]{40}$/.test(sourceCommit), "Select the actual Git source commit");
  const root = resolve(directory), checkpoint = join(root, "async-operation.json");
  const leaseFd = receivingLease(root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const operation = await exists(checkpoint) ? await readJSON(checkpoint) : {
    schema: SCHEMA, operationId: OPERATION, workspaceId: host.identity.workspaceId,
    startedAt: new Date().toISOString(), completed: {}, requests: {}, sources: []
  };
  assert.equal(operation.schema, SCHEMA); assert.equal(operation.operationId, OPERATION);
  assert.equal(operation.workspaceId, host.identity.workspaceId);
  operation.origin ??= host.url;
  assert.equal(host.url, operation.origin, "Resume the original receiving host origin retained in async-operation.json");
  const moduleSources = [];
  for (const path of MODULES) {
    const bytes = await fs.readFile(join(APP, path));
    moduleSources.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const edition = { sourceCommit, files: moduleSources };
  if (!operation.sources.some(x => JSON.stringify(x) === JSON.stringify(edition))) operation.sources.push(edition);
  await save(checkpoint, operation);
  const operator = new LineageClient(host.url, { token: operatorToken,
    expectedWorkspaceId: operation.workspaceId });
  const emitOnly = new LineageClient(host.url, { token: producerToken,
    expectedWorkspaceId: operation.workspaceId });
  const phase = async (name, action) => {
    if (Object.hasOwn(operation.completed, name)) return operation.completed[name];
    console.log(JSON.stringify({ operationId: OPERATION, phase: name, state: "running" }));
    const result = await action();
    operation.completed[name] = result; await save(checkpoint, operation);
    console.log(JSON.stringify({ operationId: OPERATION, phase: name, state: "retained" }));
    return result;
  };
  const retainRequest = async (name, prepare) => {
    if (!operation.requests[name]) {
      operation.requests[name] = await prepare(); await save(checkpoint, operation);
    }
    return operation.requests[name];
  };
  let child = null, receivedHost = null;
  const startPython = async (name, args, { application = APP } = {}) => {
    assert.equal(child, null, "Only one original native Python child may run");
    const attempt = randomBytes(8).toString("hex");
    const stdoutPath = join(root, "logs", name + "-" + attempt + ".stdout.json");
    const stderrPath = join(root, "logs", name + "-" + attempt + ".stderr.log");
    await fs.mkdir(dirname(stdoutPath), { recursive: true, mode: 0o700 });
    const stdout = await fs.open(stdoutPath, "wx", 0o600);
    let stderr;
    try { stderr = await fs.open(stderrPath, "wx", 0o600); }
    catch (error) { await stdout.close(); throw error; }
    let native;
    try {
      native = spawn(python, [join(application, "native_async_producer.py"), ...args], {
        stdio: ["ignore", stdout.fd, stderr.fd, leaseFd], shell: false,
        env: { ...process.env, PYTHONUNBUFFERED: "1", OPENLINEAGE_RECEIVING_LOCK_FD: "3" }
      });
    } catch (error) { await stdout.close(); await stderr.close(); throw error; }
    const running = { process: native, done: null, attempt };
    child = running;
    const interrupted = () => native.kill("SIGINT"), terminated = () => native.kill("SIGTERM");
    process.once("SIGINT", interrupted); process.once("SIGTERM", terminated);
    const timeout = setTimeout(() => native.kill("SIGTERM"), 120000);
    const hardStop = setTimeout(() => native.kill("SIGKILL"), 130000);
    let spawnError = null;
    const terminal = new Promise(resolve => {
      native.once("error", error => { spawnError = { code: error.code ?? null, message: error.message }; });
      native.once("close", (code, signal) => resolve({ code, signal, ...(spawnError ? { error: spawnError } : {}) }));
    });
    const initial = {
      schema: SCHEMA + ".child", name, attempt, pid: native.pid ?? null, python,
      script: join(application, "native_async_producer.py"), state: "running",
      startedAt: new Date().toISOString(), stdout: stdoutPath, stderr: stderrPath
    };
    const initialSave = save(join(root, "native-active.json"), initial);
    running.done = terminal.then(async result => {
      // Serialize the actual closed record after its initial record even for a
      // fast source/status command, and retain each attempt's original log bytes.
      await initialSave;
      await stdout.sync(); await stderr.sync();
      const metadata = { ...initial, ...result, state: "closed", closedAt: new Date().toISOString() };
      await save(join(root, "logs", name + "-" + attempt + ".result.json"), metadata);
      await save(join(root, "native-active.json"), metadata);
      return metadata;
    }).finally(async () => {
      clearTimeout(timeout); clearTimeout(hardStop);
      process.removeListener("SIGINT", interrupted); process.removeListener("SIGTERM", terminated);
      try { await Promise.all([stdout.close(), stderr.close()]); }
      finally { if (child === running) child = null; }
    });
    // A very fast failure may settle before the caller receives this handle.
    running.done.catch(() => {});
    try { await initialSave; }
    catch (error) {
      native.kill("SIGTERM");
      await running.done.catch(() => {});
      throw error;
    }
    console.log(JSON.stringify({ operationId: OPERATION, phase: name, childPid: native.pid, attempt }));
    return running;
  };
  const runPython = async (name, args, expected = [0], options = {}) => {
    const running = await startPython(name, args, options), outcome = await running.done;
    if (!expected.includes(outcome.code)) {
      const detail = (await fs.readFile(outcome.stderr, "utf8")).slice(-6000);
      throw new Error("Original native " + name + " exited " + outcome.code + " / " + outcome.signal + ": " + detail);
    }
    const bytes = await fs.readFile(outcome.stdout);
    return { outcome, value: bytes.length ? JSON.parse(bytes.toString("utf8")) : null };
  };
  const inputPath = join(root, "original-ordering-events.json");
  const baseId = OPERATION + "/" + operation.workspaceId;
  const badDirectory = join(root, "native-failed-start");
  const orderedDirectory = join(root, "native-ordered");
  const interruptedDirectory = join(root, "native-interrupted");
  const directConfig = join(root, "private-async-config.json");
  const makeConfig = async (path, token, url = host.url, changes = {}) => {
    const config = producerConfiguration({ ...host.identity, url }, {
      token, compression: "gzip", client: "python", timeoutSeconds: 3
    });
    Object.assign(config.transport, {
      type: "async_http", max_queue_size: 4, max_concurrent_requests: 2,
      retry: { total: 2, backoff_factor: 0.05,
        status_forcelist: [429, 500, 502, 503, 504] }, ...changes
    });
    // Connection origin can change on the same workspace's next native lifetime.
    await save(path, config); return path;
  };
  await makeConfig(directConfig, producerToken);
  try {
    const inputs = await phase("original-input-selection", async () => {
      const originals = [];
      for (const item of ORIGINALS) {
        const bytes = await fs.readFile(join(APP, item.name));
        const git = createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
        assert.equal(git, item.git);
        await writeOriginal(join(root, "upstream", item.name), bytes);
        originals.push({ ...item, bytes: bytes.length, sha256: sha256(bytes) });
      }
      const full = JSON.parse(await fs.readFile(join(APP, "fixture-event-full.json"), "utf8"));
      const simple = JSON.parse(await fs.readFile(join(APP, "fixture-event-simple.json"), "utf8"));
      const events = [{ ...structuredClone(full), eventType: "START" },
        { ...structuredClone(full), eventType: "COMPLETE" }, simple];
      await writeOriginal(inputPath, JSON.stringify(events, null, 2) + "\n");
      await assert.rejects(emitOnly.metadata(), error => error.status === 401);
      return {
        originals, path: inputPath, sha256: sha256(await fs.readFile(inputPath)),
        description: "Authored START/COMPLETE ordering selection from the exact upstream full fixture, plus the original simple event.",
        runKey: runKey(events[0]), runId: events[0].run.runId, eventCount: events.length,
        workspaceId: operation.workspaceId, producerCredentialOperatorReadStatus: 401
      };
    });
    assert.equal(sha256(await fs.readFile(inputPath)), inputs.sha256);
    await phase("native-failed-start-release", async () => {
      const identifier = baseId + "/failed", startId = identifier + "/file-1/event-1";
      const terminalPath = join(badDirectory, "requests", recordName(identifier + "/file-1/event-2"));
      const relay = await responseRelay({ target: host.url, directory: join(root, "failed-relay"),
        holdOperation: startId, holdUntil: () => exists(terminalPath) });
      try {
        const token = await privateToken(join(root, "private-rejected-token"));
        assert.notEqual(token, producerToken); assert.notEqual(token, operatorToken);
        const path = await makeConfig(join(root, "private-rejected-config.json"), token, relay.url);
        const result = await runPython("failed-start", [
          "emit", "--config", path, "--directory", badDirectory,
          "--input", inputPath, "--operation-id", identifier, "--drain-timeout", "10"
        ], [2]);
        assert.equal(result.value.complete, false);
        assert.equal(result.value.acknowledgedEvents, 0);
        assert.equal(result.value.lastClosedSession.nativeStats.pending, 0);
        assert.equal(result.value.lastClosedSession.nativeStats.failed, inputs.eventCount);
        const start = result.value.events.find(x => x.operationId === startId);
        assert.ok(start.observations.some(x => x.kind === "http" && x.status === 401));
        assert.ok(start.observations.some(x => x.kind === "native-failed" && x.releasedTerminalRequests >= 1));
        return { ...result, observedHttpStatus: 401, nativeTerminalReleaseObserved: true };
      } finally { await relay.close(); }
    });
    await phase("native-failed-original-recovery", async () => {
      const result = await runPython("recover-failed", ["resume", "--config", directConfig,
        "--directory", badDirectory, "--drain-timeout", "20"]);
      assert.equal(result.value.complete, true);
      assert.equal(result.value.acknowledgedEvents, inputs.eventCount);
      return result;
    });
    await phase("native-ordered-lost-response", async () => {
      const identifier = baseId + "/ordered", startId = identifier + "/file-1/event-1";
      const relayDirectory = join(root, "lost-response-relay");
      const relay = await responseRelay({ target: host.url, directory: relayDirectory,
        dropOperation: startId });
      try {
        const config = await makeConfig(join(root, "private-relay-config.json"), producerToken, relay.url);
        const result = await runPython("ordered", [
          "emit", "--config", config, "--directory", orderedDirectory,
          "--input", inputPath, "--operation-id", identifier, "--drain-timeout", "20"
        ]);
        assert.equal(result.value.complete, true);
        const dropped = await readJSON(join(relayDirectory, "actual-lost-response.json"));
        assert.equal(dropped.operationId, startId); assert.equal(dropped.status, 200);
        const acknowledged = JSON.parse(Buffer.from(dropped.responseBase64, "base64"));
        assert.equal(acknowledged.operationId, startId);
        const receipt = result.value.events.find(x => x.operationId === startId);
        assert.equal(receipt.acknowledgement.replayed, true);
        assert.equal(receipt.wireSha256, dropped.wireSha256);
        const history = await records(operator, "operations");
        const startIndex = history.records.findIndex(x => x.id === startId);
        const completeIndex = history.records.findIndex(x => x.id === identifier + "/file-1/event-2");
        assert.ok(startIndex >= 0 && completeIndex > startIndex);
        return { ...result, actualLostResponse: dropped, startOperationIndex: startIndex,
          terminalOperationIndex: completeIndex };
      } finally { await relay.close(); }
    });
    await phase("native-backpressure-interruption", async () => {
      const identifier = baseId + "/interrupted";
      const retryConfig = await makeConfig(join(root, "private-backpressure-config.json"),
        producerToken, host.url, {
          max_queue_size: 1, max_concurrent_requests: 1,
          retry: { total: 5, backoff_factor: 1, status_forcelist: [429, 500, 502, 503, 504] }
        });
      let outcome;
      await host.workspace.lock(async () => {
        const failurePath = join(interruptedDirectory, "failures", recordName(identifier + "/file-1/event-1"));
        const priorObservations = await exists(failurePath)
          ? (await readJSON(failurePath)).observations.length : 0;
        const running = await startPython("interrupted", [
          "emit", "--config", retryConfig, "--directory", interruptedDirectory,
          "--input", inputPath, "--operation-id", identifier, "--drain-timeout", "1"
        ]);
        try {
          await waitUntil(async () => {
            if (!await exists(failurePath)) return false;
            return (await readJSON(failurePath)).observations.slice(priorObservations)
              .some(x => x.kind === "http" && x.status === 503);
          }, 15000);
          assert.ok(running.process.kill("SIGINT"), "The original native sender must still be running");
          outcome = await running.done;
        } catch (error) {
          running.process.kill("SIGTERM"); await running.done.catch(() => {}); throw error;
        }
      });
      assert.equal(outcome.code, 130);
      const result = await runPython("interrupted-status", ["status", "--directory", interruptedDirectory]);
      assert.equal(result.value.complete, false);
      assert.ok(result.value.unacknowledgedOperations.length + result.value.unsubmittedOperations.length > 0);
      assert.ok(result.value.events.some(x => (x.observations ?? []).some(y => y.status === 503)));
      return { outcome, status: result.value, actualOriginalWriterStatus: 503 };
    });
    await phase("native-interrupted-original-recovery", async () => {
      const result = await runPython("recover-interrupted", ["resume", "--config", directConfig,
        "--directory", interruptedDirectory, "--drain-timeout", "20"]);
      assert.equal(result.value.complete, true);
      assert.equal(result.value.acknowledgedEvents, inputs.eventCount);
      return result;
    });
    const reconciled = await phase("original-source-and-receipt-reconciliation", async () => {
      const results = [];
      const history = await records(operator, "operations");
      for (const [name, selected] of [
        ["failed", badDirectory], ["ordered", orderedDirectory], ["interrupted", interruptedDirectory]
      ]) {
        const report = (await runPython(name + "-status", ["status", "--directory", selected])).value;
        assert.equal(report.complete, true); assert.equal(report.acknowledgedEvents, inputs.eventCount);
        for (const event of report.events) {
          const request = await readJSON(join(selected, "requests", recordName(event.operationId)));
          const original = await operator.action("source.read", { id: event.wireSha256, decode: true });
          assert.deepEqual(Buffer.from(original.base64, "base64"), Buffer.from(request.wireBase64, "base64"));
          const command = history.records.find(x => x.id === event.operationId);
          assert.ok(command); assert.equal(command.result.source.id, event.wireSha256);
          assert.equal(command.result.revision, event.acknowledgement.revision);
        }
        results.push({ name, directory: selected, status: report });
      }
      return { workspaceId: operation.workspaceId, revision: history.revision, producers: results };
    });
    const delivery = await phase("producer-deliveries-and-original-edition", async () => {
      const outputs = [];
      for (const producer of reconciled.producers) {
        const archive = join(root, "delivery", producer.name + "-producer.zip");
        const result = await runPython(producer.name + "-export", ["export", "--directory",
          producer.directory, "--out", archive]);
        assert.equal(result.value.complete, true);
        assert.equal(result.value.sha256, sha256(await fs.readFile(archive)));
        outputs.push({ name: producer.name, ...result.value });
      }
      const request = await retainRequest("edition", async () => ({
        title: "Native asynchronous producer completion",
        description: "Original SDK queue, failed START release, actual response loss, writer backpressure and exact recovery.",
        operationId: baseId + "/edition", expectedRevision: (await operator.metadata()).revision
      }));
      const result = await operator.saveEdition(request);
      return { outputs, edition: result.edition };
    });
    const attachments = await phase("original-run-delivery-attachments", async () => {
      const saved = [];
      for (const output of delivery.outputs) {
        const data = await fs.readFile(output.path);
        const request = await retainRequest("attachment-" + output.name, async () => ({
          name: output.name + "-native-async-producer.zip", mediaType: "application/zip",
          entityKeys: [inputs.runKey], editionId: delivery.edition.id,
          sourceReference: OPERATION, operationId: baseId + "/attach-" + output.name,
          expectedRevision: (await operator.metadata()).revision
        }));
        saved.push(await operator.attachResult(data, request));
      }
      return saved;
    });
    const exported = await phase("complete-original-workspace-export", async () => {
      const info = await retainRequest("workspace-export", () => operator.exportWorkspace());
      const destination = join(root, "delivery", "async-complete-workspace.json");
      await operator.downloadExport(info.id, destination);
      const verified = verifyBundle(await fs.readFile(destination));
      assert.equal(verified.packageSha256, info.id); assert.equal(verified.state.workspaceId, operation.workspaceId);
      for (const name of MODULES) assert.ok(verified.application.has(name), "Complete application is missing " + name);
      for (const result of attachments) assert.ok(verified.state.results.some(x => x.id === result.result.id));
      return { ...info, destination, applicationFiles: verified.application.size };
    });
    const receivedDirectory = join(root, "received-workspace");
    const received = await phase("complete-workspace-receiving", async () => {
      if (await exists(receivedDirectory)) {
        assert.equal((await readJSON(join(receivedDirectory, "received.json"))).packageSha256, exported.id);
      } else await receiveBundle(await fs.readFile(exported.destination), receivedDirectory);
      const original = verifyBundle(await fs.readFile(exported.destination));
      const state = await new LineageWorkspace(receivedDirectory).read();
      assert.deepEqual(state, original.state);
      return { directory: receivedDirectory, workspaceId: state.workspaceId,
        revision: state.revision, packageSha256: exported.id };
    });
    await phase("received-producer-cold-replay", async () => {
      const selected = delivery.outputs.find(x => x.name === "ordered");
      const receiver = join(root, "received-producer");
      const application = join(received.directory, "application");
      if (!await exists(receiver)) {
        await runPython("producer-receive", ["receive", "--input", selected.path,
          "--directory", receiver], [0], { application });
      } else {
        const marker = await readJSON(join(receiver, ".async-received.json"));
        assert.equal(marker.archiveSha256, selected.sha256);
      }
      const before = (await runPython("received-status", ["status", "--directory", receiver],
        [0], { application })).value;
      const operationId = baseId + "/ordered/file-1/event-1";
      const receiptPath = join(receiver, "receipts", recordName(operationId));
      const retainedFault = join(root, "retained-fault", "original-received-receipt.json");
      if (!operation.requests.receivedFault) {
        const body = await fs.readFile(receiptPath);
        await writeOriginal(retainedFault, body);
        operation.requests.receivedFault = { operationId, sha256: sha256(body), retained: retainedFault };
        await save(checkpoint, operation);
      }
      const fault = operation.requests.receivedFault;
      assert.equal(sha256(await fs.readFile(fault.retained)), fault.sha256);
      if (await exists(receiptPath)) {
        const current = await fs.readFile(receiptPath);
        if (sha256(current) === fault.sha256) await fs.unlink(receiptPath);
        else {
          const restored = JSON.parse(current.toString("utf8"));
          assert.equal(restored.operationId, operationId);
          assert.equal(restored.acknowledgement.replayed, true);
        }
      }
      const implementation = await import(pathToFileURL(join(application, "server.mjs")).href);
      receivedHost = await implementation.startServer({
        directory: received.directory, port: 0, token: operatorToken, producerToken,
        expectedWorkspaceId: operation.workspaceId
      });
      const client = new LineageClient(receivedHost.url, {
        token: operatorToken, expectedWorkspaceId: operation.workspaceId
      });
      const initial = await client.metadata();
      const config = await makeConfig(join(root, "private-received-config.json"),
        producerToken, receivedHost.url);
      const replay = await runPython("received-replay", ["resume", "--config", config,
        "--directory", receiver, "--drain-timeout", "20"], [0], { application });
      assert.equal(replay.value.complete, true);
      const restored = replay.value.events.find(x => x.operationId === operationId);
      assert.equal(restored.acknowledgement.replayed, true);
      assert.equal((await client.metadata()).revision, initial.revision);
      const state = await new LineageWorkspace(received.directory).read();
      assert.deepEqual(state, verifyBundle(await fs.readFile(exported.destination)).state);
      return { directory: receiver, workspaceId: operation.workspaceId,
        originalArchive: selected.sha256, before, replay, originalRevision: initial.revision,
        instanceId: receivedHost.identity.instanceId, retainedOriginalReceipt: fault };
    });
    operation.completedAt = operation.completedAt ?? new Date().toISOString();
    await save(checkpoint, operation);
    const result = { ...operation, directory: root, originalWorkspace: host.workspace.directory,
      receivedWorkspace: received.directory, completeWorkspace: exported,
      completedNativePhases: Object.keys(operation.completed) };
    await save(join(root, "native-async-receiving.json"), result);
    return result;
  } catch (error) {
    operation.lastError = { message: error.message, at: new Date().toISOString() };
    await save(checkpoint, operation);
    throw error;
  } finally {
    if (child) {
      const owned = child; owned.process.kill("SIGTERM");
      await owned.done.catch(() => {});
    }
    if (receivedHost) await receivedHost.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || !argv[i + 1] || argv[i + 1].startsWith("--") ||
        Object.hasOwn(options, argv[i].slice(2))) throw new Error("Use each native selection once with a value");
    options[argv[i].slice(2)] = argv[i + 1];
  }
  const allowed = ["directory", "workspace", "python", "operator-token-file", "producer-token-file", "source-commit"];
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error("Unknown native option --" + key);
  for (const key of allowed.filter(x => x !== "source-commit")) if (!options[key]) throw new Error("--" + key + " is required");
  if (process.env.OPENLINEAGE_RECEIVING_LOCK_FD === undefined) {
    const command = [join(APP, "native_async_producer.py"), "receive-workspace",
      "--directory", resolve(options.directory), "--workspace", resolve(options.workspace),
      "--node", process.execPath,
      "--operator-token-file", resolve(options["operator-token-file"]),
      "--producer-token-file", resolve(options["producer-token-file"])];
    if (options["source-commit"]) command.push("--source-commit", options["source-commit"]);
    return await new Promise((accept, reject) => {
      let child;
      try { child = spawn(options.python, command, { stdio: "inherit", shell: false }); }
      catch (error) { reject(error); return; }
      const interrupt = () => child.kill("SIGINT"), terminate = () => child.kill("SIGTERM");
      process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
      const cleanup = () => {
        process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", terminate);
      };
      child.once("error", error => { cleanup(); reject(error); });
      child.once("close", (code, stoppedBy) => {
        cleanup(); accept(Number.isInteger(code) ? code : stoppedBy === "SIGINT" ? 130 : 143);
      });
    });
  }
  receivingLease(resolve(options.directory));
  const original = await new LineageWorkspace(resolve(options.workspace)).read();
  const token = (await fs.readFile(resolve(options["operator-token-file"]), "utf8")).trim();
  const producerToken = (await fs.readFile(resolve(options["producer-token-file"]), "utf8")).trim();
  const { startServer } = await import("./server.mjs");
  const checkpoint = join(resolve(options.directory), "async-operation.json");
  const prior = await exists(checkpoint) ? await readJSON(checkpoint) : null;
  let port = 0;
  if (prior?.origin) {
    const origin = new URL(prior.origin);
    assert.equal(origin.protocol, "http:"); assert.equal(origin.hostname, "127.0.0.1");
    port = Number(origin.port); assert.ok(Number.isSafeInteger(port) && port > 0 && port < 65536);
  }
  const host = await startServer({ directory: resolve(options.workspace), port,
    token, producerToken, expectedWorkspaceId: original.workspaceId });
  try {
    const result = await receiveAsyncProducers({ directory: resolve(options.directory), python: options.python,
      host, operatorToken: token, producerToken, sourceCommit: options["source-commit"] ?? null });
    console.log(JSON.stringify(result, null, 2)); return 0;
  } finally { await host.close(); }
}
if (process.argv[1] && await fs.realpath(resolve(process.argv[1])).then(
  value => value === fileURLToPath(import.meta.url), () => false))
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ error: error.message })); process.exitCode = 1;
  });
