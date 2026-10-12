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
import { handleRpc } from "./protocol.mjs";
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
  const original = await startServer({ directory: join(root, "project"), title: "Original OpenLineage source receiving", port: 0 });
  let receivedHost;
  const results = { schema: "commons.openlineage.receiving.v1", startedAt: new Date().toISOString(),
    source: { applicationDirectory: SOURCE, fixtures: fixtures.map(({ bytes, ...metadata }) => metadata) }, operations: [] };
  const record = (step, value) => { results.operations.push({ step, at: new Date().toISOString(), value }); };
  try {
    const identityResponse = await fetch(original.url + "/api/identity");
    assert.equal(identityResponse.status, 200);
    const identity = await identityResponse.json();
    const client = new LineageClient(original.url, { expectedWorkspaceId: identity.workspaceId, instanceId: identity.instanceId });
    const initial = await client.read(); assert.equal(initial.revision, 0);
    const firstArgs = { name: first.file, sourceUrl: first.url, operationId: "receiving-import-first", expectedRevision: 0 };
    const importedFirst = await client.importSource(first.bytes, firstArgs);
    record("import-original-first-source", importedFirst);
    let current = await client.read();
    assert.equal(current.projectedCount, JSON.parse(first.bytes.toString("utf8")) instanceof Array ?
      JSON.parse(first.bytes.toString("utf8")).length : 1);
    assert.equal(Buffer.from((await client.action("source.read", { id: first.sha256 })).base64, "base64").equals(first.bytes), true);
    const editionOne = await client.saveEdition({ title: "First upstream example", description: first.url,
      operationId: "receiving-edition-first", expectedRevision: current.revision });
    record("save-first-edition", editionOne);
    current = await client.read();
    const importedSecond = await client.importSource(second.bytes, { name: second.file, sourceUrl: second.url,
      operationId: "receiving-import-second", expectedRevision: current.revision });
    record("import-original-second-source", importedSecond);
    current = await client.read();
    assert.ok(current.projectedCount >= 2, "Both untouched upstream examples must enter the operational projection");
    const editionTwo = await client.saveEdition({ title: "Both upstream examples", description: second.url,
      operationId: "receiving-edition-second", expectedRevision: current.revision });
    current = await client.read();
    assert.equal(current.editions.length, 2);
    const comparison = await client.compare(current.editions[0].id, current.editions[1].id);
    record("compare-original-editions", comparison);
    const selected = current.runs[0] ?? current.datasets[0] ?? current.jobs[0];
    assert.ok(selected?.key, "The original event entities must be inspectable");
    const inspected = await client.entity(selected.key);
    record("inspect-native-entity", { key: selected.key, originalEvents: inspected.events.length });
    record("read-original-lineage", await client.lineage(selected.key));
    const review = await client.saveReview({ title: "Original upstream source review",
      reason: "Reviewed the exact retained OpenLineage upstream example, its native event identity and reported relationships.",
      decision: "observed", entityKeys: [selected.key], editionId: current.editions[1].id,
      operationId: "receiving-review", expectedRevision: current.revision });
    record("retain-reasoned-review", review);
    current = await client.read();
    const attached = await client.attachResult(attachment.bytes, { name: attachment.file, mediaType: "application/json",
      sourceReference: attachment.url, query: { purpose: "Original upstream LineageFacet field-contract reference" },
      entityKeys: [selected.key], editionId: current.editions[1].id,
      operationId: "receiving-attach-original-contract", expectedRevision: current.revision });
    record("attach-complete-original-reference", attached);
    const beforeReplay = (await client.read()).revision;
    const recovered = await client.importSource(first.bytes, firstArgs);
    assert.equal(recovered.replayed, true);
    assert.equal((await client.read()).revision, beforeReplay);
    record("recover-same-import-response", recovered);
    const rpc = await handleRpc(original.workspace, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    assert.ok(rpc.result.tools.some(x => x.name === "lineage_edition_compare"));
    record("native-mcp-catalog", { tools: rpc.result.tools.map(x => x.name) });
    for (const format of ["json", "csv", "html"]) {
      const report = await client.action("report.read", { format });
      await fs.writeFile(join(root, "report." + format), report.text, { flag: "wx", mode: 0o600 });
      record("complete-report-" + format, { bytes: Buffer.byteLength(report.text), mediaType: report.mediaType });
    }
    const exported = await client.exportWorkspace({ includeApplication: true });
    record("export-complete-editable-application", exported);
    const destination = join(root, "openlineage-workspace.json");
    const download = await client.downloadExport(exported.id, destination, { chunkBytes: 32768 });
    assert.equal((await client.downloadExport(exported.id, destination)).alreadyPresent, true);
    record("download-complete-export", download);
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
    if (receivedHost) await receivedHost.close();
    await original.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  receiveOriginalExamples(process.argv[2] ?? (() => { throw new Error("Supply a new receiving output directory"); })())
    .then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
