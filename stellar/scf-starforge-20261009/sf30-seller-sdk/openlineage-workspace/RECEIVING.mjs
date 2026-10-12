#!/usr/bin/env node
// MIT. One complete native receiving journey using the retained upstream examples.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { startServer } from "./server.mjs";
import { LineageClient } from "./client.mjs";
import { receiveBundle, verifyBundle } from "./store.mjs";
import { MerchantOpenLineageWorkspaces, readLineageWorkspaceConfiguration } from "./mcp.mjs";
import { tools as nativeTools } from "./catalog.mjs";
import { sha256 } from "./model.mjs";

const SOURCE = dirname(fileURLToPath(import.meta.url));
function originalBlob(bytes) {
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
}
export async function receiveOriginalExamples(outputDirectory) {
  const root = resolve(outputDirectory);
  await fs.mkdir(root, { mode: 0o700 });
  const sourceManifest = JSON.parse(await fs.readFile(join(SOURCE, "fixtures.json"), "utf8"));
  const fixtures = [];
  for (const spec of sourceManifest.files) {
    const bytes = await fs.readFile(join(SOURCE, spec.file));
    assert.equal(originalBlob(bytes), spec.gitBlob, "Retain the exact upstream fixture bytes");
    fixtures.push({ ...spec, bytes, sha256: sha256(bytes) });
  }
  const first = fixtures.find(x => x.file === "fixture-event-simple.json");
  const second = fixtures.find(x => x.file === "fixture-event-full.json");
  const attachment = fixtures.find(x => x.file === "fixture-lineage-mixed-sources.json");
  assert.ok(first && second && attachment, "Complete original upstream fixture selection is required");
  let original = await startServer({ directory: join(root, "project"), title: "Original OpenLineage source receiving", port: 0 });
  let receivedHost, merchant;
  const usedMerchantTools = new Set();
  const merchantCall = async (action, args = {}) => {
    const name = "merchant_lineage_" + action.replaceAll(".", "_");
    usedMerchantTools.add(name);
    return merchant.call(name, { ...(action === "workspaces" ? {} : { workspace: "operations" }), ...args });
  };
  const results = { schema: "commons.openlineage.receiving.v1", startedAt: new Date().toISOString(),
    source: { applicationDirectory: SOURCE, fixtures: fixtures.map(({ bytes, ...metadata }) => metadata) }, operations: [] };
  const record = (step, value) => { results.operations.push({ step, at: new Date().toISOString(), value }); };
  try {
    const identityResponse = await fetch(original.url + "/api/identity");
    assert.equal(identityResponse.status, 200);
    const identity = await identityResponse.json();
    let client = new LineageClient(original.url, { expectedWorkspaceId: identity.workspaceId, instanceId: identity.instanceId });
    const hostConfiguration = join(root, "merchant-workspaces.json");
    await fs.writeFile(hostConfiguration, JSON.stringify({
      schema: "stellar-forge.openlineage-workspace-host.v1",
      workspaces: { operations: {
        label: "Original source receiving", workspaceId: identity.workspaceId,
        connectionFile: join(root, "project", "connection.json"),
        inputs: {
          first: { path: join(SOURCE, first.file), kind: "source", name: first.file, sha256: first.sha256, sourceReference: first.url },
          contract: { path: join(SOURCE, attachment.file), kind: "result", name: attachment.file,
            sha256: attachment.sha256, mediaType: "application/json", sourceReference: attachment.url }
        }
      } }
    }), { flag: "wx", mode: 0o600 });
    merchant = new MerchantOpenLineageWorkspaces({ openlineageWorkspaces: await readLineageWorkspaceConfiguration(hostConfiguration) });
    record("merchant-original-workspace-alias", await merchantCall("workspaces"));
    record("merchant-original-connection", await merchantCall("connection"));
    record("merchant-complete-input", await merchantCall("input", { input: "first", expectedSha256: first.sha256 }));
    const initial = await client.read(); assert.equal(initial.revision, 0);
    const firstArgs = { name: first.file, sourceUrl: first.url, operationId: "receiving-import-first", expectedRevision: 0 };
    const importedFirst = await merchantCall("import_file", { input: "first", expectedSha256: first.sha256, sourceUrl: first.url,
      operationId: firstArgs.operationId, expectedRevision: firstArgs.expectedRevision });
    record("import-original-first-source", importedFirst);
    let current = await merchantCall("workspace.read");
    assert.equal(current.projectedCount, JSON.parse(first.bytes.toString("utf8")) instanceof Array ?
      JSON.parse(first.bytes.toString("utf8")).length : 1);
    assert.equal(Buffer.from((await merchantCall("source.read", { id: first.sha256 })).base64, "base64").equals(first.bytes), true);
    const editionOne = await merchantCall("edition.save", { title: "First upstream example", description: first.url,
      operationId: "receiving-edition-first", expectedRevision: current.revision });
    record("save-first-edition", editionOne);
    current = await client.read();
    const importedSecond = await merchantCall("source.import", { base64: second.bytes.toString("base64"), name: second.file, sourceUrl: second.url,
      operationId: "receiving-import-second", expectedRevision: current.revision });
    record("import-original-second-source", importedSecond);
    current = await client.read();
    assert.ok(current.projectedCount >= 2, "Both untouched upstream examples must enter the operational projection");
    const editionTwo = await merchantCall("edition.save", { title: "Both upstream examples", description: second.url,
      operationId: "receiving-edition-second", expectedRevision: current.revision });
    current = await client.read();
    assert.equal(current.editions.length, 2);
    const comparison = await merchantCall("edition.compare", { from: current.editions[0].id, to: current.editions[1].id });
    record("compare-original-editions", comparison);
    const selected = current.runs[0] ?? current.datasets[0] ?? current.jobs[0];
    assert.ok(selected?.key, "The original event entities must be inspectable");
    const inspected = await merchantCall("entity.read", { key: selected.key });
    record("inspect-native-entity", { key: selected.key, originalEvents: inspected.events.length });
    record("read-original-lineage", await merchantCall("lineage.read", { key: selected.key }));
    const originalRange = await merchantCall("object.read", { id: first.sha256, offset: 0, length: first.bytes.length });
    assert.equal(originalRange.complete, true);
    assert.equal(Buffer.from(originalRange.base64, "base64").equals(first.bytes), true);
    const review = await merchantCall("review.save", { title: "Original upstream source review",
      reason: "Reviewed the exact retained OpenLineage upstream example, its native event identity and reported relationships.",
      decision: "observed", entityKeys: [selected.key], editionId: current.editions[1].id,
      operationId: "receiving-review", expectedRevision: current.revision });
    record("retain-reasoned-review", review);
    current = await client.read();
    const attachmentArgs = { sourceReference: attachment.url, query: { purpose: "Original upstream LineageFacet field-contract reference" },
      entityKeys: [selected.key], editionId: current.editions[1].id,
      operationId: "receiving-attach-original-contract", expectedRevision: current.revision };
    const attached = await merchantCall("attach_file", { ...attachmentArgs, input: "contract", expectedSha256: attachment.sha256 });
    record("attach-complete-original-reference", attached);
    const beforeReplay = (await client.read()).revision;
    const previousInstance = original.identity.instanceId;
    await original.close();
    original = await startServer({ directory: join(root, "project"), port: 0, expectedWorkspaceId: identity.workspaceId });
    assert.notEqual(original.identity.instanceId, previousInstance);
    const changedConnection = await merchantCall("connection");
    assert.equal(changedConnection.reconnectRequired, true);
    record("merchant-explicit-instance-reconnect", await merchantCall("reconnect", { expectedInstanceId: original.identity.instanceId }));
    client = new LineageClient(original.url, { expectedWorkspaceId: identity.workspaceId, instanceId: original.identity.instanceId });
    const recovered = await merchantCall("source.import", { ...firstArgs, base64: first.bytes.toString("base64") });
    assert.equal(recovered.replayed, true);
    assert.equal((await client.read()).revision, beforeReplay);
    record("recover-same-import-response", recovered);
    const attachedReplay = await merchantCall("result.attach", { ...attachmentArgs, name: attachment.file,
      mediaType: "application/json", base64: attachment.bytes.toString("base64") });
    assert.equal(attachedReplay.replayed, true);
    assert.equal(attachedReplay.result.id, attached.result.id);
    const metadata = await merchantCall("workspace.metadata");
    assert.equal(metadata.revision, beforeReplay);
    const journal = [];
    let journalOffset = 0;
    do {
      const page = await merchantCall("records.read", { collection: "operations", expectedRevision: beforeReplay,
        offset: journalOffset, limit: 2 });
      journal.push(...page.items); journalOffset = page.nextOffset;
    } while (journalOffset !== null);
    assert.equal(journal.length, metadata.retained.operations);
    assert.equal(journal.filter(item => item.id === firstArgs.operationId).length, 1);
    record("merchant-complete-operation-history", { revision: beforeReplay, operationIds: journal.map(item => item.id) });
    record("merchant-completed-operation-cancellation-state", await merchantCall("cancel", { operationId: firstArgs.operationId }));
    const rpcResponse = await fetch(original.url + "/mcp", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
    assert.equal(rpcResponse.status, 200);
    const rpc = await rpcResponse.json();
    assert.ok(rpc.result.tools.some(x => x.name === "lineage_edition_compare"));
    record("native-mcp-catalog", { tools: rpc.result.tools.map(x => x.name) });
    for (const format of ["json", "csv", "html"]) {
      const report = await merchantCall("report.read", { format });
      await fs.writeFile(join(root, "report." + format), report.text, { flag: "wx", mode: 0o600 });
      record("complete-report-" + format, { bytes: Buffer.byteLength(report.text), mediaType: report.mediaType });
    }
    const exported = await merchantCall("workspace.export", { includeApplication: true });
    record("export-complete-editable-application", exported);
    const destination = join(root, "openlineage-workspace.json");
    const download = await client.downloadExport(exported.id, destination, { chunkBytes: 32768 });
    assert.equal((await client.downloadExport(exported.id, destination)).alreadyPresent, true);
    record("download-complete-export", download);
    const merchantChunks = [];
    let exportOffset = 0;
    while (exportOffset < exported.bytes) {
      const range = await merchantCall("export.read", { id: exported.id, offset: exportOffset, length: 32768 });
      assert.equal(range.offset, exportOffset);
      assert.equal(range.totalBytes, exported.bytes);
      const bytes = Buffer.from(range.base64, "base64");
      assert.equal(bytes.length, range.bytes);
      merchantChunks.push(bytes); exportOffset = range.nextOffset;
      assert.equal(range.complete, exportOffset === exported.bytes);
    }
    const merchantBytes = Buffer.concat(merchantChunks);
    assert.equal(sha256(merchantBytes), exported.id);
    await fs.writeFile(join(root, "merchant-workspace.json"), merchantBytes, { flag: "wx", mode: 0o600 });
    record("merchant-complete-export-ranges", { id: exported.id, bytes: merchantBytes.length });
    for (const native of nativeTools) assert.equal(usedMerchantTools.has("merchant_" + native.name), true, native.name + " through the original merchant owner");
    record("merchant-complete-native-catalog", { nativeActions: nativeTools.length, calledTools: [...usedMerchantTools].sort() });
    await merchant.close(); merchant = null;
    assert.equal((await client.metadata()).revision, beforeReplay);
    record("merchant-close-preserves-original-server", { workspaceId: identity.workspaceId, revision: beforeReplay });
    const raw = await fs.readFile(destination), verified = verifyBundle(raw);
    assert.equal(verified.state.workspaceId, identity.workspaceId);
    assert.equal(verified.objects.get(first.sha256).equals(first.bytes), true);
    const receivedDirectory = join(root, "received");
    const receipt = await receiveBundle(raw, receivedDirectory);
    record("receive-new-independent-workspace", receipt);
    const receivedNative = await import(pathToFileURL(join(receivedDirectory, "application", "server.mjs")).href);
    receivedHost = await receivedNative.startServer({ directory: receivedDirectory, port: 0 });
    const receivedClient = new LineageClient(receivedHost.url, {
      expectedWorkspaceId: identity.workspaceId, instanceId: receivedHost.identity.instanceId });
    const reopened = await receivedClient.read();
    assert.equal(reopened.workspaceId, identity.workspaceId);
    assert.equal(reopened.revision, beforeReplay);
    assert.deepEqual(reopened.editions, (await client.read()).editions);
    assert.deepEqual(reopened.reviews, (await client.read()).reviews);
    assert.equal(Buffer.from((await receivedClient.action("source.read", { id: attachment.sha256 })).base64, "base64").equals(attachment.bytes), true);
    record("reopen-received-original-application", { workspaceId: reopened.workspaceId, revision: reopened.revision,
      events: reopened.eventCount, jobs: reopened.jobs.length, datasets: reopened.datasets.length, runs: reopened.runs.length,
      sources: reopened.sources.length, editions: reopened.editions.length, reviews: reopened.reviews.length, results: reopened.results.length,
      originalUrl: original.url, receivedUrl: receivedHost.url });
    results.state = "COMPLETE"; results.completedAt = new Date().toISOString();
    await fs.writeFile(join(root, "receiving.json"), JSON.stringify(results, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return results;
  } catch (error) {
    results.state = "INTERRUPTED"; results.error = { message: error.message, stack: error.stack };
    await fs.writeFile(join(root, "receiving-interrupted.json"), JSON.stringify(results, null, 2) + "\n", { flag: "wx", mode: 0o600 }).catch(() => {});
    throw error;
  } finally {
    if (merchant) await merchant.close();
    if (receivedHost) await receivedHost.close();
    await original.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  receiveOriginalExamples(process.argv[2] ?? (() => { throw new Error("Supply a new receiving output directory"); })())
    .then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
