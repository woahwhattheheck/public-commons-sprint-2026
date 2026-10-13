#!/usr/bin/env node
// MIT. One retained native fixture course for saved comparison and follow-up.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { LineageWorkspace, verifyBundle, receiveBundle, APPLICATION_FILES } from "./store.mjs";
import { startServer } from "./server.mjs";
import { QualityFollowupClient } from "./quality-followup-client.mjs";
import { qualityFollowupCommand } from "./quality-followup-cli.mjs";
import { validateQualityFollowup } from "./quality-followup.mjs";
import { datasetKey, runKey, canonical, digest, sha256 } from "./model.mjs";
import { tools } from "./catalog.mjs";

const SOURCE = dirname(fileURLToPath(import.meta.url));
const read = async path => JSON.parse(await fs.readFile(path, "utf8"));
const exists = async path => fs.access(path).then(() => true, () => false);
async function exact(path, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  const bytes = Buffer.from(text, "utf8");
  const retained = async () => {
    assert.ok((await fs.readFile(path)).equals(bytes), "Retain original " + path);
  };
  if (await exists(path)) { await retained(); return; }
  const temporary = path + ".pending-" + randomUUID();
  let handle = null, owned = false, primary = null;
  try {
    handle = await fs.open(temporary, "wx", 0o600); owned = true;
    await handle.writeFile(bytes); await handle.sync();
    await handle.close(); handle = null;
    try { await fs.link(temporary, path); }
    catch (error) { if (error.code !== "EEXIST") throw error; await retained(); }
  } catch (error) { primary = error; throw error; }
  finally {
    const cleanup = [];
    if (handle) try { await handle.close(); } catch (error) { cleanup.push(error); }
    if (owned) try { await fs.unlink(temporary); }
      catch (error) { if (error.code !== "ENOENT") cleanup.push(error); }
    if (cleanup.length) {
      const error = new AggregateError(cleanup, "Could not close the retained output temporary file.");
      if (primary) primary.cleanupError = error; else throw error;
    }
  }
}
async function inspectReceived(receivePath, verified) {
  const receiveInfo = await read(join(receivePath, "received.json"));
  assert.equal(receiveInfo.packageSha256, verified.packageSha256, "Retain the exact original received package");
  assert.equal(receiveInfo.payloadSha256, verified.payloadSha256, "Retain the original received payload");
  assert.equal(typeof receiveInfo.installationId, "string"); assert.ok(receiveInfo.installationId);
  const reopened = await new LineageWorkspace(receivePath).read();
  assert.deepEqual(reopened, verified.state, "The independently received original workspace must remain complete");
  validateQualityFollowup(reopened, {deep: true});
  for (const [id, originalBytes] of verified.objects) {
    const receivedBytes = await fs.readFile(join(receivePath, "objects", id));
    assert.equal(receivedBytes.length, originalBytes.length); assert.equal(sha256(receivedBytes), id);
  }
  for (const [name, originalBytes] of verified.application) {
    const receivedBytes = await fs.readFile(join(receivePath, "application", name));
    assert.equal(receivedBytes.length, originalBytes.length); assert.equal(sha256(receivedBytes), sha256(originalBytes));
  }
  return receiveInfo;
}
export async function receiveQualityFollowup(directory) {
  const root = resolve(directory); await fs.mkdir(root, {recursive: true, mode: 0o700});
  const lockPath = join(root, "receiving.lock");
  const lock = await fs.open(lockPath, "wx", 0o600);
  let host, lockOpen = true, lockRetained = true, primaryError = null;
  async function closeResources() {
    const errors = [];
    if (host) try { await host.close(); host = null; } catch (error) { errors.push(error); }
    if (lockOpen) try { await lock.close(); lockOpen = false; } catch (error) { errors.push(error); }
    if (!host && !lockOpen && lockRetained) try { await fs.unlink(lockPath); lockRetained = false; }
      catch (error) { if (error.code === "ENOENT") lockRetained = false; else errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Could not close the original Quality receiving resources: " + errors.map(error => error.message).join("; "));
  }
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
    const manifest = [];
    for (const name of APPLICATION_FILES) {
      const bytes = await fs.readFile(join(SOURCE, name));
      manifest.push({path: name, bytes: bytes.length, sha256: sha256(bytes)});
    }
    await exact(join(root, "selected-application.json"), {files: manifest, sourceSha256: digest(manifest)});
    const workspace = new LineageWorkspace(join(root, "workspace"));
    await workspace.initialize("Quality follow-up — original OpenLineage fixture course");
    const initial = await workspace.read();
    if (await exists(join(root, "NATIVE_RESULT.json"))) {
      const completed = await read(join(root, "NATIVE_RESULT.json"));
      assert.equal(completed.workspaceId, initial.workspaceId); assert.equal(completed.sourceSha256, digest(manifest));
      assert.ok(initial.revision >= completed.revision);
      const originalExport = await fs.readFile(join(root, "quality-followup-workspace.json"));
      const reopened = verifyBundle(originalExport);
      assert.equal(reopened.state.workspaceId, completed.workspaceId); assert.equal(reopened.state.revision, completed.revision);
      validateQualityFollowup(initial, {deep: true});
      const originalReceiving = await inspectReceived(join(root, "received"), reopened);
      assert.deepEqual(originalReceiving, completed.receiving, "Retain the original completed receiving identity");
      await closeResources();
      return completed;
    }
    await exact(join(root, "receiving-identity.json"), {workspaceId: initial.workspaceId, sourceSha256: digest(manifest)});
    host = await startServer({directory: workspace.directory, port: 0, expectedWorkspaceId: initial.workspaceId});
    const client = new QualityFollowupClient(host.url, {expectedWorkspaceId: initial.workspaceId, instanceId: host.identity.instanceId});
    const requests = join(root, "requests"), results = join(root, "results");
    await fs.mkdir(requests, {recursive: true}); await fs.mkdir(results, {recursive: true});
    async function write(label, action, build) {
      const requestPath = join(requests, label + ".json"), resultPath = join(results, label + ".json");
      if (!await exists(requestPath)) await exact(requestPath, {action, args: {...await build(),
        operationId: "quality-followup-receiving-" + label, expectedRevision: (await workspace.read()).revision}});
      const request = await read(requestPath); assert.equal(request.action, action);
      const actual = await client.action(action, request.args);
      if (await exists(resultPath)) {
        const saved = await read(resultPath);
        const clean = value => {const result = structuredClone(value); delete result.replayed; return result;};
        assert.deepEqual(clean(actual), clean(saved)); return saved;
      }
      await exact(resultPath, actual); return actual;
    }
    const fixtureBytes = await fs.readFile(join(SOURCE, "fixture-event-full.json"));
    const fixture = JSON.parse(fixtureBytes), sourceContract = await read(join(SOURCE, "fixtures.json"));
    const original = sourceContract.files.find(row => row.file === "fixture-event-full.json");
    assert.equal(createHash("sha1").update(Buffer.from("blob " + fixtureBytes.length + "\0")).update(fixtureBytes).digest("hex"), original.gitBlob);
    await write("original-source", "source.import", async () => ({base64: fixtureBytes.toString("base64"),
      name: "fixture-event-full.json", sourceUrl: original.originalUrl ?? original.url}));
    const dk = datasetKey(fixture.outputs[0]), rkBefore = runKey(fixture);
    const rule = (await write("rule-v1", "quality.rule.save", async () => ({rule: {
      title: "Fixture output rows", datasetKey: dk, enabled: true, severity: "warning", scope: "output",
      kind: "metric", metricPath: "/rowCount", operator: "gte", value: 1950, missing: "unknown"}}))).rule;
    const before = (await write("evaluation-before", "quality.evaluation.save", async () => ({
      title: "Original full fixture evaluation", runKey: rkBefore}))).evaluation;
    const firstFinding = before.findings.find(row => row.ruleId === rule.id);
    assert.equal(firstFinding.status, "pass");
    const earlierDecision = (await write("disposition-v1", "quality.disposition.save", async () => ({
      evaluationId: before.id, findingId: firstFinding.id, decision: "investigating",
      reason: "Retain the original fixture outcome and inspect the later execution."}))).disposition;
    const later = structuredClone(fixture);
    later.run.runId = "fe6e9909-12c8-4b98-833a-2f71cc23f71a";
    later.eventTime = "2020-12-29T19:51:01.641Z";
    later.outputs[0].outputFacets.outputStatistics.rowCount = 1500;
    later.inputs[0].inputFacets.dataQualityAssertions.assertions[0].success = false;
    later.inputs[0].inputFacets.dataQualityAssertions.assertions.push(structuredClone(later.inputs[0].inputFacets.dataQualityAssertions.assertions[0]));
    const laterText = JSON.stringify(later, null, 2) + "\n", rkAfter = runKey(later);
    await exact(join(root, "later-fixture-execution.json"), laterText);
    await write("later-source", "source.import", async () => ({base64: Buffer.from(laterText).toString("base64"),
      name: "later-fixture-execution.json", sourceUrl: "urn:commons:fixture-course:quality-followup:later-execution"}));
    await write("rule-v2", "quality.rule.save", async () => ({rule: {...rule, value: 1600}}));
    const after = (await write("evaluation-after", "quality.evaluation.save", async () => ({
      title: "Later fixture execution evaluation", runKey: rkAfter}))).evaluation;
    const selection = {beforeEvaluationId: before.id, afterEvaluationId: after.id, runPairs: [
      {beforeRunKey: rkBefore, afterRunKey: rkAfter}], findingPairs: []};
    const unmapped = await client.compareSavedQuality({...selection, runPairs: []});
    assert.equal(unmapped.summary.matched, 0, "Separate runs require explicit original correspondence");
    const ambiguous = await client.compareSavedQuality(selection);
    assert.ok(ambiguous.rows.some(row => row.kind === "ambiguous"), "Repeated original assertions stay unresolved");
    for (const row of ambiguous.rows.filter(row => row.kind === "ambiguous")) selection.findingPairs.push(row.candidates[0]);
    const preview = await client.compareSavedQuality(selection);
    assert.equal(preview.summary.ambiguous, 0);
    assert.ok(preview.summary.afterOnly > 0);
    assert.ok(preview.summary.changedDefinitions > 0);
    await exact(join(root, "selection.json"), selection);
    const compared = (await write("comparison", "quality.followup.comparison.save", async () => ({
      ...selection, title: "Fixture execution follow-up", expectedComparisonHash: (await client.compareSavedQuality(selection)).comparisonSha256}))).comparison;
    const row = compared.rows.find(item => item.kind === "matched" && item.after[0].ruleId === rule.id);
    assert.equal(row.statusTransition, "pass → fail");
    assert.equal(row.definitionChanged, true);
    const edition = (await write("evidence-edition", "edition.save", async () => ({
      title: "Fixture evidence selection", description: "Both original fixture executions for the receiving course."}))).edition;
    const evidenceText = JSON.stringify({fixtureSource: original, before: firstFinding, after: row.after[0]}, null, 2) + "\n";
    const evidence = (await write("evidence", "result.attach", async () => ({
      base64: Buffer.from(evidenceText).toString("base64"), name: "fixture-comparison-evidence.json", mediaType: "application/json",
      entityKeys: [dk], editionId: edition.id, sourceReference: "Original fixture and retained later fixture execution", query: null}))).result;
    const first = (await write("followup-v1", "quality.followup.save", async () => ({
      comparisonId: compared.id, rowId: row.id, decision: "investigating", reason: "Review the retained output-row change.",
      owner: "Receiving operator", dueDate: "2026-11-01", evidenceResultIds: [evidence.id],
      sourceDisposition: {evaluationId: before.id, findingId: firstFinding.id, version: earlierDecision.version}}))).followup;
    const second = (await write("followup-v2", "quality.followup.save", async () => ({
      id: first.id, version: first.version, comparisonId: compared.id, rowId: row.id, decision: "accepted",
      reason: "The fixture change is reviewed with its complete original evidence; retain the producer failure.",
      owner: first.owner, dueDate: null, evidenceResultIds: [evidence.id], sourceDisposition: {
        evaluationId: before.id, findingId: firstFinding.id, version: earlierDecision.version}}))).followup;
    assert.equal(second.version, 2); assert.equal(second.history.length, 1);
    assert.equal(second.sourceDisposition.reason, earlierDecision.reason);
    await write("disposition-v2", "quality.disposition.save", async () => ({
      evaluationId: before.id, findingId: firstFinding.id, decision: "accepted", reason: "Later original disposition version."}));
    const final = await workspace.read(); validateQualityFollowup(final, {deep: true});
    assert.equal(final.quality.evaluations.find(item => item.id === after.id).findings.find(item => item.id === row.after[0].id).status, "fail");
    assert.equal(final.qualityFollowup.followups[0].sourceDisposition.version, 1);
    const replayRequest = await read(join(requests, "followup-v1.json"));
    const replay = await client.action(replayRequest.action, replayRequest.args);
    assert.equal(replay.replayed, true); assert.equal((await workspace.read()).revision, final.revision);
    const stale = {...replayRequest.args, operationId: "quality-followup-receiving-stale-check"};
    await assert.rejects(client.action(replayRequest.action, stale), /revision/i);
    const badPair = {beforeEvaluationId: before.id, afterEvaluationId: after.id, runPairs: selection.runPairs,
      findingPairs: [{beforeFindingId: firstFinding.id, afterFindingId: after.findings.find(item => item.ruleId === null).id}]};
    await assert.rejects(client.compareSavedQuality(badPair), /original dataset|correspondence/i);
    for (const format of ["json", "csv", "html"]) {
      const report = await client.qualityFollowupReport({comparisonId: compared.id, format});
      await exact(join(root, "quality-followup-report." + format), report.text);
    }
    const cli = await qualityFollowupCommand(workspace, ["compare"], {workspace: workspace.directory, input: join(root, "selection.json")});
    assert.equal(cli.comparisonSha256, (await client.compareSavedQuality(selection)).comparisonSha256);
    for (const collection of ["qualityComparisons", "qualityFollowups"]) {
      const page = await client.records({collection, expectedRevision: final.revision, limit: 1, offset: 0});
      assert.equal(page.total, 1); assert.equal(page.items.length, 1);
    }
    const catalogue = tools.filter(tool => tool.action.startsWith("quality.followup."));
    assert.equal(catalogue.length, 5);
    const exportRecord = join(root, "export-result.json");
    let exported;
    if (await exists(exportRecord)) exported = await read(exportRecord);
    else {exported = await workspace.exportBundle(); await exact(exportRecord, exported);}
    const bytes = await fs.readFile(join(workspace.directory, "exports", exported.id + ".json"));
    const verified = verifyBundle(bytes);
    assert.equal(verified.application.size, APPLICATION_FILES.length);
    assert.deepEqual(verified.state.qualityFollowup, final.qualityFollowup);
    await exact(join(root, "quality-followup-workspace.json"), bytes.toString("utf8"));
    const receivePath = join(root, "received");
    if (!await exists(join(receivePath, "received.json"))) await receiveBundle(bytes, receivePath);
    const receiveInfo = await inspectReceived(receivePath, verified);
    const result = {schema: "commons.openlineage.quality-followup.receiving.v1", workspaceId: final.workspaceId,
      revision: final.revision, sourceSha256: digest(manifest), nativeStatus: "COMPLETE", browserStatus: "PENDING",
      fixture: {originalSha256: sha256(fixtureBytes), gitBlob: original.gitBlob, laterSha256: sha256(Buffer.from(laterText))},
      beforeEvaluationId: before.id, afterEvaluationId: after.id, comparisonId: compared.id, rowId: row.id,
      followupId: second.id, followupVersion: second.version, ambiguousBeforeReview: ambiguous.summary.ambiguous,
      matched: compared.summary.matched, afterOnly: compared.summary.afterOnly,
      applicationFiles: verified.application.size, export: exported, receiving: receiveInfo};
    await closeResources();
    await exact(join(root, "NATIVE_RESULT.json"), result);
    return result;
  } catch (error) {
    primaryError = error;
    try {
      await fs.writeFile(join(root, "INTERRUPTION.json"), JSON.stringify({at: new Date().toISOString(), message: error.message, stack: error.stack}, null, 2));
    } catch (retentionError) { error.retentionError = retentionError.message; }
    throw error;
  } finally {
    try { await closeResources(); }
    catch (cleanupError) {
      try {
        await fs.writeFile(join(root, "CLEANUP_INTERRUPTION.json"), JSON.stringify({at: new Date().toISOString(),
          message: cleanupError.message, primaryError: primaryError?.message ?? null}, null, 2));
      } catch (retentionError) { cleanupError.retentionError = retentionError.message; }
      if (primaryError) primaryError.cleanupError = cleanupError.message;
      else throw cleanupError;
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  receiveQualityFollowup(process.argv[2] ?? "").then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.stack); process.exitCode = 1;
  });
