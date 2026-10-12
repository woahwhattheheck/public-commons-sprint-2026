#!/usr/bin/env node
// MIT. The original corrective-work receiving programme uses the complete public Charlie building source.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { startServer } from "./server.mjs";
import { HaystackWorkspace } from "./store.mjs";
import { HaystackClient } from "./client.mjs";
import { APPLICATION_FILES, verifyBundle, receiveBundle } from "./portable.mjs";
import { actions } from "./catalog.mjs";
import { parseGrid } from "./haystack-types.mjs";
import { stringifyJson, canonicalJson } from "./json-codec.mjs";
import { atomicWrite, createOnlyFile, plainRead, exists } from "./files.mjs";
import { runCorrectiveBrowser } from "./CORRECTIVE_BROWSER.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FORMAT = "commons.haystack.corrective-receiving.v1";
const SOURCE_URL = "https://project-haystack.org/example/download/charlie.json";
const SOURCE_SHA = "c44a410c183f9ef9add5757955637d1ce0bad0dabf418f80e6b9a7b4a2b9afe9";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = value => Buffer.from(stringifyJson(value, 2) + "\n");
const at = () => new Date().toISOString();
const same = (left, right, message) => assert.equal(canonicalJson(left), canonicalJson(right), message);
const outcome = value => { const copy = structuredClone(value); delete copy.replayed; return copy; };
const readJson = async path => JSON.parse(await plainRead(path));
const saveJson = (path, value) => atomicWrite(path, encoded(value));
async function completeFile(path, bytes) {
  bytes = Buffer.from(bytes); await fs.mkdir(dirname(path), {recursive:true, mode:0o700});
  await createOnlyFile(path, bytes); return {path, bytes:bytes.length, sha256:sha(bytes)};
}
const completeJson = (path, value) => completeFile(path, encoded(value));
async function nativeCli(applicationRoot, args, input = "") {
  return new Promise((resolveDone, reject) => {
    const child = spawn(process.execPath, [join(applicationRoot, "cli.mjs"), ...args], {stdio:["pipe","pipe","pipe"]});
    const stdout = [], stderr = []; let total = 0, overflow = false;
    const collect = sink => bytes => {
      total += bytes.length;
      if (total > 16 * 1024 * 1024) { overflow = true; child.kill("SIGTERM"); } else sink.push(bytes);
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const result = {args, code, signal, stdout:Buffer.concat(stdout).toString("utf8"), stderr:Buffer.concat(stderr).toString("utf8")};
      if (overflow || code !== 0) reject(Object.assign(new Error("The native corrective-work command did not complete."), {result}));
      else resolveDone(result);
    });
    child.stdin.end(input);
  });
}

export async function main(directory) {
  assert.equal(typeof directory, "string", "Supply one original operation directory.");
  const root = resolve(directory), outputs = join(root, "outputs"), requestRoot = join(root, "requests");
  await fs.mkdir(outputs, {recursive:true, mode:0o700}); await fs.mkdir(requestRoot, {recursive:true, mode:0o700});
  assert(!(await fs.lstat(root)).isSymbolicLink(), "Use the original operation directory.");
  const originalBytes = await plainRead(join(ROOT, "fixture-charlie.json"), 32 * 1024 * 1024);
  assert.equal(sha(originalBytes), SOURCE_SHA); assert.equal(originalBytes.length, 257776);
  const decoded = parseGrid(originalBytes, {format:"json-v4"});
  assert.equal(decoded.grid.rows.length, 624); assert.equal(decoded.grid.cols.length, 87);
  const application = [];
  for (const name of APPLICATION_FILES) {
    const bytes = await plainRead(join(ROOT, name), 8 * 1024 * 1024);
    application.push({name, bytes:bytes.length, sha256:sha(bytes)});
  }
  const journalPath = join(root, "corrective-programme.json"), workspaceDirectory = join(root, "workspace");
  const workspace = new HaystackWorkspace(workspaceDirectory);
  const initial = await workspace.initialize("Charlie building — corrective work");
  let journal;
  if (await exists(journalPath)) {
    journal = await readJson(journalPath);
    assert.equal(journal.format, FORMAT); assert.equal(journal.directory, root);
    assert.equal(journal.workspaceId, initial.workspaceId); assert.equal(journal.source.sha256, SOURCE_SHA);
    same(journal.application, application, "Continue the original complete application cohort.");
  } else {
    journal = {format:FORMAT, operationId:randomUUID(), directory:root, workspaceId:initial.workspaceId,
      startedAt:at(), source:{url:SOURCE_URL, bytes:originalBytes.length, sha256:SOURCE_SHA, rows:624, columns:87},
      application, stages:{}, state:"CONTINUING"};
    await saveJson(journalPath, journal);
  }
  if (journal.state === "COMPLETE") {
    const result = await readJson(join(root, "complete-result.json"));
    assert.equal(result.operationId, journal.operationId);
    assert.equal(result.workspaceId, journal.workspaceId);
    for (const file of Object.values(result.deliveries)) assert.equal(sha(await plainRead(file.file.path)), file.file.sha256);
    process.stdout.write(stringifyJson({completed:true, replayed:true, operationId:journal.operationId,
      result:join(root, "complete-result.json")}) + "\n");
    return result;
  }
  let server = null, recipient = null, cold = null, client = null, recipientClient = null;
  const status = client => client.request("workspace.status", {});
  const item = async (client, itemId) => client.request("work.read", {expectedRevision:(await status(client)).revision, itemId});
  async function pages(client, action, fields = {}) {
    const rows = [], revision = (await status(client)).revision;
    for await (const page of client.pages(action, {...fields, expectedRevision:revision, limit:137})) rows.push(...page.items);
    return rows;
  }
  async function step(name, action) {
    if (Object.hasOwn(journal.stages, name)) return structuredClone(journal.stages[name]);
    const value = await action();
    journal.stages[name] = value; await saveJson(journalPath, journal);
    process.stdout.write(stringifyJson({operationId:journal.operationId, completedStage:name, at:at()}) + "\n");
    return structuredClone(value);
  }
  async function observe(name, action) {
    const path = join(outputs, name + ".json");
    if (await exists(path)) return readJson(path);
    const value = await action(); await completeJson(path, value); return value;
  }
  async function requestFor(name, client, action, supply) {
    assert(/^[a-z0-9-]+$/.test(name));
    const path = join(requestRoot, name + ".request.json");
    if (await exists(path)) {
      const original = await readJson(path); assert.equal(original.action, action);
      assert.equal(original.workspaceId, journal.workspaceId); return original;
    }
    const values = typeof supply === "function" ? await supply() : supply;
    const original = {format:"commons.haystack.corrective-request.v1", programmeOperationId:journal.operationId,
      workspaceId:journal.workspaceId, action,
      args:{operationId:randomUUID(), expectedRevision:(await status(client)).revision, ...structuredClone(values)}};
    await completeJson(path, original); return original;
  }
  async function originalOutcome(client, operationId) {
    try { return await client.request("operation.read", {operationId}); }
    catch (error) { if (error.code === "HAYSTACK_OPERATION_MISSING" && error.status === 404) return null; throw error; }
  }
  async function mutation(name, client, action, supply, {loseResponse = false} = {}) {
    const original = await requestFor(name, client, action, supply), receiptPath = join(requestRoot, name + ".outcome.json");
    let recovered = await originalOutcome(client, original.args.operationId);
    if (!recovered) {
      if (loseResponse) {
        const normalFetch = client.fetcher, lossPath = join(requestRoot, name + ".lost-response.json");
        assert(!(await exists(lossPath)), "A retained accepted response must reconcile through its original operation.");
        client.fetcher = async (url, options) => {
          const response = await normalFetch(url, options);
          if (String(url).endsWith("/api/action") && response.ok &&
              JSON.parse(options.body).args?.operationId === original.args.operationId) {
            const bytes = Buffer.from(await response.arrayBuffer());
            await completeJson(lossPath, {operationId:original.args.operationId, responseStatus:response.status,
              responseSha256:sha(bytes), response:JSON.parse(bytes), receivedAt:at()});
            throw new Error("The original programme deliberately loses this fully accepted operator response.");
          }
          return response;
        };
        try {
          await assert.rejects(() => client.request(action, original.args),
            error => error.code === "HAYSTACK_TRANSPORT" && error.outcomeUnknown === true);
        } finally { client.fetcher = normalFetch; }
        recovered = await originalOutcome(client, original.args.operationId);
        assert(recovered, "Read the saved original operation after the accepted response is lost.");
      } else recovered = await client.request(action, original.args);
    }
    const replayed = await client.request(action, original.args);
    assert.equal(replayed.replayed, true); same(outcome(replayed), outcome(recovered));
    if (await exists(receiptPath)) same(await readJson(receiptPath), outcome(recovered));
    else await completeJson(receiptPath, outcome(recovered));
    return outcome(recovered);
  }
  async function workMutation(name, client, action, itemId, supply, options) {
    return mutation(name, client, action, async () => {
      const current = await item(client, itemId);
      const fields = typeof supply === "function" ? await supply(current) : supply;
      return {itemId, expectedHeadSha256:current.headSha256, author:"Corrective receiving operator", ...fields};
    }, options);
  }
  async function delivery(name, client, fields) {
    const receipt = await mutation(name, client, "delivery.prepare", fields);
    const bytes = Buffer.from(await client.deliveryBytes(receipt.operationId));
    assert.equal(bytes.length, receipt.bytes); assert.equal(sha(bytes), receipt.sha256);
    const file = await completeFile(join(outputs, name + "-" + receipt.name), bytes);
    return {receipt, file};
  }
  async function compareReturn(name, client, path) {
    return observe(name, async () => {
      const bytes = await plainRead(path);
      const preview = await client.request("return.preview", {expectedRevision:(await status(client)).revision, base64:bytes.toString("base64")});
      assert.equal(preview.packageSha256, sha(bytes)); return preview;
    });
  }
  function decisionsFor(preview, accepted, resolveConflict) {
    return preview.items.map(row => ({itemId:row.itemId, decision:accepted.has(row.itemId) ? "accept" : "keep",
      expectedHeadSha256:row.localHeadSha256,
      choices:accepted.has(row.itemId) ? Object.fromEntries(row.conflicts.map(key => [key, resolveConflict(row, key)])) : {}}));
  }
  try {
    const originalOrigin = journal.serverOrigin ? new URL(journal.serverOrigin) : null;
    if (originalOrigin) {
      assert.equal(originalOrigin.protocol, "http:"); assert.equal(originalOrigin.hostname, "127.0.0.1");
      assert.equal(originalOrigin.origin, journal.serverOrigin);
      assert(Number.isInteger(Number(originalOrigin.port)) && Number(originalOrigin.port) > 0);
    }
    server = await startServer({directory:workspaceDirectory, host:"127.0.0.1",
      port:originalOrigin ? Number(originalOrigin.port) : 0, expectedWorkspaceId:journal.workspaceId});
    if (originalOrigin) assert.equal(server.url, journal.serverOrigin, "Reopen the original browser storage origin.");
    else { journal.serverOrigin = server.url; await saveJson(journalPath, journal); }
    client = new HaystackClient({url:server.url, workspaceId:journal.workspaceId}); await client.connect();
    await atomicWrite(join(root, "current-connection.json"), encoded(server.identity));
    const seed = await step("original-records-and-work", async () => {
      await mutation("import-original-charlie", client, "source.import", {name:"charlie.json", sourceUrl:SOURCE_URL,
        format:"json-v4", select:true, base64:originalBytes.toString("base64")});
      const records = await observe("original-records", () => pages(client, "records.list"));
      const findings = await observe("original-diagnostics", () => pages(client, "diagnostics.list"));
      assert.equal(records.length, 624); same(records.map(record => record.tags), decoded.grid.rows);
      const point = records.find(record => record.roles.includes("point"));
      const diagnostic = findings.find(value => value.sourceId === SOURCE_SHA && value.recordKey !== point.key) || null;
      const second = diagnostic?.recordKey ? records.find(value => value.key === diagnostic.recordKey) :
        records.find(record => record.key !== point.key && record.roles.includes("equip"));
      const third = records.find(record => record.key !== point.key && record.key !== second?.key && record.roles.includes("point"));
      const fourth = records.find(record => ![point?.key, second?.key, third?.key].includes(record.key) && record.roles.includes("point"));
      assert(point && second && third && fourth);
      const manual = await mutation("capture-manual-work", client, "work.capture", async () => ({
        author:"Original facilities operator", materialSha256:(await status(client)).materialSha256, recordKey:point.key,
        title:"Review original point evidence", description:"Review the complete native point row and its proposed commissioning annotation.",
        assignee:"Facilities", dueDate:"", priority:"routine"}));
      const diagnosticWork = await mutation("capture-diagnostic-work", client, "work.capture", async () => ({
        author:"Original facilities operator", materialSha256:(await status(client)).materialSha256,
        ...(diagnostic ? {diagnosticId:diagnostic.id, diagnosticSha256:sha(Buffer.from(canonicalJson(diagnostic)))} : {recordKey:second.key}),
        title:diagnostic ? "Review retained native diagnostic" : "Review original equipment evidence",
        description:"Retain the original source finding, assignment and explicit final disposition.", priority:"high"}));
      const evidenceFile = await completeJson(join(outputs, "complete-original-point-record.json"), point);
      await workMutation("attach-complete-record-file", client, "work.evidence", manual.itemId,
        {kind:"file", name:"complete-original-point-record.json", mediaType:"application/json",
          base64:(await plainRead(evidenceFile.path)).toString("base64"),
          note:"Complete unchanged native row exported for the source-linked operator review."});
      await workMutation("attach-diagnostic-observation", client, "work.evidence", diagnosticWork.itemId,
        {kind:"note", note:diagnostic ? "Reviewing the full native finding retained with this work item: " + diagnostic.code :
          "Reviewing the complete original equipment row retained with this work item."});
      const proposal = await mutation("prepare-native-tag-proposal", client, "proposal.prepare", {
        title:"Record the source-row review annotation", note:"Operator programme annotation on the unchanged original point source.",
        edits:[{recordKey:point.key, tag:"commissioningNote", action:"set", value:"Original source-row reviewed for corrective-work handover"}]});
      await workMutation("attach-complete-native-proposal", client, "work.evidence", manual.itemId,
        {kind:"proposal", proposalId:proposal.proposal.id, note:"Retain this complete pending native proposal for explicit tag review."});
      return {sourceId:SOURCE_SHA, manualItemId:manual.itemId, diagnosticItemId:diagnosticWork.itemId,
        diagnostic:diagnostic ? {id:diagnostic.id, code:diagnostic.code} : null,
        recordKey:point.key, browserRecordKey:third.key, returnRecordKey:fourth.key, evidenceFile, proposalId:proposal.proposal.id,
        originalTitle:"Review original point evidence"};
    });
    const issued = await step("complete-recipient-copy", () => delivery("issued-workspace", client, {kind:"workspace"}));
    const issuedBytes = await plainRead(issued.file.path), issuedBundle = verifyBundle(issuedBytes);
    assert.equal(issuedBundle.application.size, APPLICATION_FILES.length);
    const recipientDirectory = join(root, "recipient");
    const receivingReceipt = await receiveBundle(issuedBytes, recipientDirectory);
    assert.equal(receivingReceipt.workspaceId, journal.workspaceId);
    const recipientRoot = join(recipientDirectory, "application");
    const {startServer:receivedServer} = await import(pathToFileURL(join(recipientRoot, "server.mjs")).href);
    const {HaystackClient:ReceivedClient} = await import(pathToFileURL(join(recipientRoot, "client.mjs")).href);
    recipient = await receivedServer({directory:recipientDirectory, host:"127.0.0.1", port:0, expectedWorkspaceId:journal.workspaceId});
    recipientClient = new ReceivedClient({url:recipient.url, workspaceId:journal.workspaceId}); await recipientClient.connect();
    await step("independent-proposal-reviews-and-peer-edit", async () => {
      await mutation("local-tag-review", client, "proposal.review", {proposalId:seed.proposalId, decision:"accept",
        note:"Facilities reviewed and accepted the complete native annotation."});
      await mutation("recipient-tag-review", recipientClient, "proposal.review", {proposalId:seed.proposalId, decision:"accept",
        note:"Recipient independently reviewed the same complete native annotation."});
      assert.equal((await status(client)).materialSha256, (await status(recipientClient)).materialSha256);
      await workMutation("local-exception-context", client, "work.review", seed.diagnosticItemId,
        {decision:"accept-exception", author:"Original facilities reviewer",
          note:"Retain the original source finding for planned follow-up; this programme records the explicit operator disposition."});
      await requestFor("stale-assignment", client, "work.update", async () => {
        const current = await item(client, seed.manualItemId);
        return {itemId:seed.manualItemId, expectedHeadSha256:current.headSha256, author:"First operator",
          note:"Original assignment draft before a separate operator's update.",
          fields:{...current.current.fields, assignee:"Original draft assignee"}};
      });
      const peer = new HaystackClient({url:server.url, workspaceId:journal.workspaceId}); await peer.connect();
      await workMutation("peer-assignment-update", peer, "work.update", seed.manualItemId, current => ({
        author:"Peer facilities operator", note:"Peer saves the complete reviewed assignment before the first draft.",
        fields:{...current.current.fields, title:"Facilities review of point evidence",
          description:"Facilities retains this complete local description while the recipient works from the issued copy.", priority:"critical"}}));
      const stale = await readJson(join(requestRoot, "stale-assignment.request.json"));
      await observe("native-stale-assignment-rejection", async () => {
        try { await client.request(stale.action, stale.args); assert.fail("A stale complete assignment must not overwrite the peer."); }
        catch (error) {
          assert.equal(error.status, 409); assert.equal(error.code, "HAYSTACK_REVISION");
          assert.equal(await originalOutcome(client, stale.args.operationId), null);
          return {operationId:stale.args.operationId, expectedRevision:stale.args.expectedRevision,
            status:error.status, code:error.code, peerHead:(await item(client, seed.manualItemId)).headSha256};
        }
      });
      await workMutation("reviewed-local-assignment", client, "work.update", seed.manualItemId, current => ({
        note:"First operator reads the peer's complete assignment and saves a distinct reviewed due date.",
        fields:{...current.current.fields, dueDate:"2026-11-02"}}));
      await workMutation("recipient-assignment-update", recipientClient, "work.update", seed.manualItemId, current => ({
        author:"Recipient operator", note:"Recipient takes responsibility for the issued point review.",
        fields:{...current.current.fields, title:"Recipient point evidence review", assignee:"Recipient commissioning team"}}));
      await workMutation("recipient-evidence", recipientClient, "work.evidence", seed.manualItemId,
        {kind:"note", author:"Recipient operator", note:"Read the complete original source row and the exact accepted annotation."});
      const submission = await workMutation("recipient-submission", recipientClient, "work.submit", seed.manualItemId,
        {author:"Recipient operator", note:"Submit the complete point review against this exact accepted native material."});
      await workMutation("recipient-diagnostic-exception", recipientClient, "work.review", seed.diagnosticItemId,
        {decision:"accept-exception", author:"Recipient reviewer", note:"Recipient separately records its review of the retained source finding."});
      return {recipientSubmission:submission.submission, recipientHead:submission.headSha256,
        materialSha256:(await status(client)).materialSha256};
    });
    const firstReturned = await step("first-complete-return", () => delivery("recipient-return-one", recipientClient, {kind:"workspace"}));
    await step("explicit-first-return-with-lost-response", async () => {
      const preview = await compareReturn("first-return-preview", client, firstReturned.file.path);
      const row = preview.items.find(value => value.itemId === seed.manualItemId);
      assert(row.conflicts.includes("title"));
      assert.equal(row.fields.description.suggested, "Facilities retains this complete local description while the recipient works from the issued copy.");
      const beforeOther = await observe("kept-item-before-return", () => item(client, seed.diagnosticItemId));
      const result = await mutation("apply-first-recipient-return", client, "return.apply", {
        author:"Original facilities reviewer", note:"Accept the recipient title and completed review; retain local description, priority, due date and the other item's disposition.",
        base64:(await plainRead(firstReturned.file.path)).toString("base64"),
        decisions:decisionsFor(preview, new Set([seed.manualItemId]), () => "incoming")}, {loseResponse:true});
      assert.equal(result.accepted, 1); assert.equal(result.kept, 1);
      const current = await item(client, seed.manualItemId), other = await item(client, seed.diagnosticItemId);
      assert.equal(current.current.fields.title, "Recipient point evidence review");
      assert.equal(current.current.fields.priority, "critical"); assert.equal(current.current.fields.dueDate, "2026-11-02");
      assert.equal(other.headSha256, beforeOther.headSha256);
      const state = await workspace.read();
      const contexts = state.correctiveWork.contexts.filter(value => value.materialSha256 === journal.stages["independent-proposal-reviews-and-peer-edit"].materialSha256);
      assert(contexts.length >= 2, "Retain distinct full review-provenance versions of identical native material.");
      assert(new Set(contexts.map(value => value.id)).size >= 2);
      assert.equal(new Set(contexts.map(value => canonicalJson(value.proposals))).size, contexts.length);
      const lost = await readJson(join(requestRoot, "apply-first-recipient-return.lost-response.json"));
      assert.equal(lost.response.operationId, result.operationId);
      return {returnId:result.returnId, acceptedHead:current.headSha256, keptHead:other.headSha256,
        contexts:contexts.map(value => ({id:value.id, materialSha256:value.materialSha256})), lostResponseOperationId:result.operationId};
    });
    await step("recipient-deliberate-later-revert", async () => {
      await workMutation("recipient-reopen-for-revert", recipientClient, "work.review", seed.manualItemId,
        {decision:"reopen", author:"Recipient operator", note:"Reopen to deliberately restore the original title while retaining the completed evidence."});
      await workMutation("recipient-restore-original-title", recipientClient, "work.update", seed.manualItemId, current => ({
        author:"Recipient operator", note:"Deliberately change the previously returned title back to the original wording.",
        fields:{...current.current.fields, title:seed.originalTitle}}));
      const submitted = await workMutation("recipient-resubmit-reverted-title", recipientClient, "work.submit", seed.manualItemId,
        {author:"Recipient operator", note:"Submit the later intentional title revision with the same retained source evidence."});
      assert.equal(submitted.submission.round, 2); return submitted;
    });
    const recipientAdditional = await step("recipient-additional-assigned-work", async () => {
      const created = await mutation("recipient-capture-additional-work", recipientClient, "work.capture", async () => ({
        author:"Recipient facilities operator", materialSha256:(await status(recipientClient)).materialSha256,
        recordKey:seed.returnRecordKey, title:"Inspect the recipient point service history",
        description:"Inspect the retained original point record and record the maintenance review in the returned workspace.",
        assignee:"Receiving maintenance", dueDate:"", priority:"routine"}));
      await workMutation("recipient-additional-observation", recipientClient, "work.evidence", created.itemId,
        {kind:"note", author:"Recipient facilities operator",
          note:"This service review was raised in the received application against original source " + SOURCE_SHA +
            ", record " + seed.returnRecordKey + ". The complete source and record remain in the returned workspace."});
      return created;
    });
    const secondReturned = await step("second-complete-return", () => delivery("recipient-return-two", recipientClient, {kind:"workspace"}));
    await step("accepted-return-ancestry-and-second-review", async () => {
      const preview = await compareReturn("second-return-preview", client, secondReturned.file.path);
      const row = preview.items.find(value => value.itemId === seed.manualItemId);
      assert.equal(row.commonHeadSha256, journal.stages["independent-proposal-reviews-and-peer-edit"].recipientHead);
      assert.equal(row.fields.title.base, "Recipient point evidence review");
      assert.equal(row.fields.title.incoming, seed.originalTitle);
      assert.equal(row.fields.title.suggested, seed.originalTitle); assert.equal(row.fields.title.conflict, false);
      await mutation("apply-second-recipient-return", client, "return.apply", {
        author:"Original facilities reviewer", note:"Accept the recipient's later deliberate title reversal against the already accepted return branch.",
        base64:(await plainRead(secondReturned.file.path)).toString("base64"),
        decisions:decisionsFor(preview, new Set([seed.manualItemId]), () => "incoming")});
      const current = await item(client, seed.manualItemId);
      assert.equal(current.current.fields.title, seed.originalTitle); assert.equal(current.current.fields.priority, "critical");
      const verified = await workMutation("verify-exact-manual-submission", client, "work.review", seed.manualItemId, value => ({
        decision:"verify", submissionSha256:value.current.submission.sha256, author:"Original facilities reviewer",
        note:"Verified this manual source-row review against the exact submitted native material and retained evidence."}));
      assert.equal(verified.status, "verified");
      return {acceptedTitle:seed.originalTitle, verifiedHead:verified.headSha256,
        commonHeadSha256:row.commonHeadSha256, submissionRound:current.current.submission.round};
    });
    await step("reopened-finding-and-explicit-disposition", async () => {
      await workMutation("reopen-retained-finding", client, "work.review", seed.diagnosticItemId,
        {decision:"reopen", note:"Reopen the earlier exception to retain a fresh review round."});
      const submission = await workMutation("resubmit-retained-finding", client, "work.submit", seed.diagnosticItemId,
        {note:"Submit the complete retained source finding and original observation for the next disposition."});
      if (seed.diagnostic) {
        await observe("diagnostic-verification-rejection", async () => {
          const current = await item(client, seed.diagnosticItemId);
          const request = await requestFor("verify-present-diagnostic", client, "work.review", {
            itemId:seed.diagnosticItemId, expectedHeadSha256:current.headSha256, author:"Original facilities reviewer",
            decision:"verify", submissionSha256:submission.submission.sha256,
            note:"Read the actual retained finding before attempting verification."});
          try { await client.request(request.action, request.args); assert.fail("A present source diagnostic must remain explicit."); }
          catch (error) {
            assert.equal(error.code, "HAYSTACK_WORK_FINDING_PRESENT"); assert.equal(error.status, 409);
            return {status:error.status, code:error.code, diagnostic:seed.diagnostic, operationId:request.args.operationId};
          }
        });
      }
      const accepted = await workMutation("accept-retained-finding-exception", client, "work.review", seed.diagnosticItemId,
        {decision:"accept-exception", submissionSha256:submission.submission.sha256, author:"Original facilities reviewer",
          note:"Accept the retained original-source finding with its complete observation and explicit follow-up disposition."});
      assert.equal(accepted.status, "exception");
      return {headSha256:accepted.headSha256, submissionRound:submission.submission.round, sourceDiagnostic:seed.diagnostic};
    });
    await recipient.close(); recipient = null;
    await step("native-cli-and-mcp-workflow", async () => {
      const current = await status(client), args = {expectedRevision:current.revision, itemId:seed.manualItemId};
      const argsFile = await completeJson(join(outputs, "native-work-read-arguments.json"), args);
      const cli = await nativeCli(ROOT, ["request", "work.read", "--directory", workspaceDirectory, "--args", argsFile.path]);
      assert.equal(JSON.parse(cli.stdout).id, seed.manualItemId);
      const tool = actions.find(value => value.action === "work.read");
      const rpc = {jsonrpc:"2.0", id:1, method:"tools/call", params:{name:tool.name, arguments:args}};
      const response = await fetch(server.url + "/mcp", {method:"POST", headers:{"Content-Type":"application/json",
        "x-haystack-workspace":journal.workspaceId, "x-haystack-instance":server.identity.instanceId}, body:stringifyJson(rpc)});
      assert.equal(response.status, 200); const mcp = await response.json();
      assert.equal(mcp.result.structuredContent.id, seed.manualItemId);
      const stdio = await nativeCli(ROOT, ["rpc", "--directory", workspaceDirectory], stringifyJson(rpc) + "\n");
      assert.equal(JSON.parse(stdio.stdout).result.structuredContent.id, seed.manualItemId);
      return {file:await completeJson(join(outputs, "native-cli-http-mcp-stdio.json"), {cli, mcp, stdio}), actions:actions.length};
    });
    await step("complete-browser-operator", () => runCorrectiveBrowser({
      url:server.url, workspaceId:journal.workspaceId, instanceId:server.identity.instanceId, token:"",
      outputRoot:join(root, "browser"), sourceId:seed.sourceId, recordKey:seed.browserRecordKey,
      evidenceFile:seed.evidenceFile.path, returnFile:secondReturned.file.path,
      manualItemId:seed.manualItemId, diagnosticItemId:seed.diagnosticItemId, returnItemId:recipientAdditional.itemId}));
    const deliveries = {};
    for (const format of ["json", "csv", "html"]) {
      deliveries[format] = await step("complete-work-register-" + format,
        () => delivery("complete-work-register-" + format, client, {kind:"work-register", format}));
    }
    deliveries.workspace = await step("complete-editable-workspace", () => delivery("complete-editable-workspace", client, {kind:"workspace"}));
    const finalState = await workspace.read();
    await step("all-evidence-and-original-source-bytes", async () => {
      const restoredSource = Buffer.from(await client.sourceBytes(SOURCE_SHA)); assert(restoredSource.equals(originalBytes));
      const evidenceFiles = [];
      for (const evidence of finalState.correctiveWork.evidence) {
        const bytes = Buffer.from(await client.completeBytes("evidence.read", {evidenceId:evidence.id}));
        if (evidence.kind === "file") assert.equal(sha(bytes), evidence.fileSha256);
        evidenceFiles.push(await completeFile(join(outputs, "evidence", evidence.id + ".bytes"), bytes));
      }
      const report = JSON.parse(await plainRead(deliveries.json.file.path));
      assert.equal(report.items.length, finalState.correctiveWork.items.length);
      same(report.evidence, finalState.correctiveWork.evidence); same(report.returns, finalState.correctiveWork.returns);
      assert(report.items.some(value => value.history.some(event => event.returnedHeadSha256)));
      return {originalSourceSha256:sha(restoredSource), completeEvidence:evidenceFiles,
        workItems:report.items.length, workEvents:finalState.correctiveWork.events.length};
    });
    const coldResult = await step("independent-complete-application-receiving", async () => {
      const bytes = await plainRead(deliveries.workspace.file.path), bundle = verifyBundle(bytes), coldDirectory = join(root, "cold-received");
      same(bundle.state, finalState);
      const receipt = await receiveBundle(bytes, coldDirectory), replayed = await receiveBundle(bytes, coldDirectory);
      assert.equal(replayed.installationId, receipt.installationId); assert.equal(replayed.replayed, true);
      for (const [name, original] of bundle.application) assert((await plainRead(join(coldDirectory, "application", name))).equals(original), name);
      const coldRoot = join(coldDirectory, "application");
      const {startServer:coldServer} = await import(pathToFileURL(join(coldRoot, "server.mjs")).href);
      const {HaystackClient:ColdClient} = await import(pathToFileURL(join(coldRoot, "client.mjs")).href);
      cold = await coldServer({directory:coldDirectory, host:"127.0.0.1", port:0, expectedWorkspaceId:journal.workspaceId});
      const coldClient = new ColdClient({url:cold.url, workspaceId:journal.workspaceId}); await coldClient.connect();
      const current = await status(coldClient);
      assert.equal(current.sha256, finalState.sha256);
      assert(Buffer.from(await coldClient.sourceBytes(SOURCE_SHA)).equals(originalBytes));
      for (const evidence of finalState.correctiveWork.evidence) {
        const left = Buffer.from(await client.completeBytes("evidence.read", {evidenceId:evidence.id}));
        const right = Buffer.from(await coldClient.completeBytes("evidence.read", {evidenceId:evidence.id}));
        assert(right.equals(left));
      }
      const originalRequest = await readJson(join(requestRoot, "apply-second-recipient-return.request.json"));
      const original = await coldClient.request(originalRequest.action, originalRequest.args);
      assert.equal(original.replayed, true);
      same(outcome(original), await readJson(join(requestRoot, "apply-second-recipient-return.outcome.json")));
      const again = await delivery("cold-complete-reexport", coldClient, {kind:"workspace"});
      const reexport = verifyBundle(await plainRead(again.file.path));
      same(reexport.state, bundle.state);
      for (const [name, originalBytes] of bundle.application) assert(reexport.application.get(name).equals(originalBytes), name);
      await cold.close(); cold = null;
      return {receipt, replayed, reexport:again, workspaceSha256:current.sha256,
        applicationFiles:bundle.application.size, completeEvidence:finalState.correctiveWork.evidence.length};
    });
    const result = {format:FORMAT, completed:true, operationId:journal.operationId, workspaceId:journal.workspaceId,
      startedAt:journal.startedAt, completedAt:at(), source:journal.source, application:journal.application,
      status:await status(client), stages:journal.stages, deliveries, received:coldResult,
      programmeJournal:journalPath, requestDirectory:requestRoot, outputDirectory:outputs};
    await saveJson(join(root, "complete-result.json"), result);
    journal.state = "COMPLETE"; journal.completedAt = result.completedAt; await saveJson(journalPath, journal);
    process.stdout.write(stringifyJson({completed:true, operationId:journal.operationId, workspaceId:journal.workspaceId,
      sourceRows:624, workItems:result.status.workCounts.total, completeResult:join(root, "complete-result.json"),
      workspace:deliveries.workspace.file}) + "\n");
    return result;
  } catch (error) {
    journal.lastFailure = {at:at(), message:error.message, code:error.code || null, details:error.details || null,
      ...(error.result ? {nativeResult:error.result} : {})};
    await saveJson(journalPath, journal).catch(() => {}); throw error;
  } finally {
    if (cold) await cold.close().catch(() => {});
    if (recipient) await recipient.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { process.stderr.write("Use node CORRECTIVE_RECEIVING.mjs /absolute/original-operation-directory\n"); process.exitCode = 2; }
  else main(process.argv[2]).catch(error => { process.stderr.write(stringifyJson({error:error.message, code:error.code || null,
    details:error.details || null, ...(error.result ? {nativeResult:error.result} : {})}) + "\n"); process.exitCode = 1; });
}
