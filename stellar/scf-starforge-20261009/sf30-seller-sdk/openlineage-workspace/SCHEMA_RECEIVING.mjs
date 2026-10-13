#!/usr/bin/env node
// MIT. Complete schema staff workflow over retained original producer files and the maintained application.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { startServer } from "./server.mjs";
import { LineageClient } from "./client.mjs";
import { LineageWorkspace, receiveBundle, verifyBundle, APPLICATION_FILES } from "./store.mjs";
import { canonical, sha256 } from "./model.mjs";

const SOURCE = dirname(fileURLToPath(import.meta.url));
const OPERATION = "OPENLINEAGE-SCHEMA-OPERATIONS-B3909-20261012";
const INPUT_SCHEMA = "commons.openlineage.schema-operations-input.v1";
async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT" && fallback !== undefined) return fallback; throw error; }
}
async function atomic(path, value) {
  const pending = path + ".pending-" + randomUUID();
  try { await fs.writeFile(pending, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); await fs.rename(pending, path); }
  finally { await fs.unlink(pending).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
async function newBytes(path, bytes) {
  try { await fs.writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; assert.ok((await fs.readFile(path)).equals(Buffer.from(bytes)), "Keep the original complete " + path); }
}
async function sourceFiles(config, inputDirectory) {
  if (config.beforeSources || config.afterSources) {
    assert.ok(Array.isArray(config.beforeSources) && config.beforeSources.length &&
      Array.isArray(config.afterSources) && config.afterSources.length, "Supply both complete original source selections");
    const read = async (entry, phase) => {
      assert.match(entry.sha256 ?? "", /^[a-f0-9]{64}$/, "Pin each original source SHA-256");
      assert.equal(typeof entry.sourceUrl, "string", "Retain the original source reference");
      const path = resolve(inputDirectory, entry.path), bytes = await fs.readFile(path);
      assert.equal(sha256(bytes), entry.sha256, "Original source bytes changed: " + path);
      return { phase, path, name: entry.name ?? path.split(/[\\/]/).at(-1), sourceUrl: entry.sourceUrl,
        sha256: entry.sha256, contentEncoding: entry.contentEncoding ?? "identity", bytes };
    };
    return [...await Promise.all(config.beforeSources.map(entry => read(entry, "before"))),
      ...await Promise.all(config.afterSources.map(entry => read(entry, "after")))];
  }
  const manifest = await readJson(join(SOURCE, "fixtures.json"));
  const names = ["fixture-event-simple.json", "fixture-event-full.json"];
  return Promise.all(names.map(async (name, index) => {
    const spec = manifest.files.find(entry => entry.file === name);
    assert.ok(spec, "Retain the original upstream fixture manifest");
    const path = join(SOURCE, name), bytes = await fs.readFile(path);
    const blob = createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
    assert.equal(blob, spec.gitBlob, "Use the exact original upstream fixture");
    return { phase: index ? "after" : "before", path, name, sourceUrl: spec.url, sha256: sha256(bytes), contentEncoding: "identity", bytes };
  }));
}
function clientFor(host, token) {
  return new LineageClient(host.url, { token, expectedWorkspaceId: host.identity.workspaceId, instanceId: host.identity.instanceId });
}
function versions(review) { return [...review.history, review]; }
async function operateBrowser({ host, client, token, root, config, comparison, reviewId, requests, operation, journey, save }) {
  assert.ok(config.browser?.modulePath, "Supply the original installed Playwright module path");
  const native = await import(pathToFileURL(resolve(config.browser.modulePath)).href);
  const chromium = native.chromium ?? native.default?.chromium;
  assert.ok(chromium, "The selected installed browser module must provide Chromium");
  const browser = await chromium.launchPersistentContext(join(root, "browser-profile"), {
    headless: true, viewport: { width: 1440, height: 1000 },
    ...(config.browser.executablePath ? { executablePath: resolve(config.browser.executablePath) } : {}),
    args: config.browser.args ?? []
  });
  const browserErrors = [];
  let page;
  const reasonLost = OPERATION + ": accepted after original field review";
  const reasonPeer = OPERATION + ": assigned downstream follow-up";
  const reasonResolved = OPERATION + ": completed original schema follow-up";
  const getReview = async () => (await client.read()).schemaReviews.find(value => value.id === reviewId);
  const hasDecision = async reason => versions(await getReview()).some(value => value.reason === reason);
  const connect = async () => {
    const next = await browser.newPage();
    next.on("pageerror", error => browserErrors.push(error.message));
    await next.goto(host.url, { waitUntil: "domcontentloaded" });
    await next.locator("#connection-state").filter({ hasText: "Connected" }).waitFor({ timeout: 45000 });
    return next;
  };
  const showSchemas = async current => {
    await current.locator('[data-view="schema"]').click();
    await current.getByRole("combobox", { name: "Before edition", exact: true }).selectOption(comparison.comparison.from.id);
    await current.getByRole("combobox", { name: "After edition", exact: true }).selectOption(comparison.comparison.to.id);
    await current.getByRole("button", { name: "Compare schemas", exact: true }).click();
    await current.getByRole("button", { name: "Review this change", exact: true }).waitFor();
  };
  const updateForm = async (current, decision, reason) => {
    await current.getByRole("button", { name: "Update decision", exact: true }).first().click();
    const dialog = current.getByRole("dialog", { name: "Update schema decision" });
    await dialog.getByLabel("Reviewer", { exact: true }).fill("Receiving staff operator");
    await dialog.getByLabel("Decision", { exact: true }).selectOption(decision);
    await dialog.getByLabel("Reason", { exact: true }).fill(reason);
    if (decision === "resolved") await dialog.getByLabel("Completed resolution", { exact: true })
      .fill("Reviewed the original schema change and declared downstream references; retained the complete source and staff history for handover.");
    return dialog;
  };
  try {
    await browser.addInitScript(({ token }) => {
      try { sessionStorage.setItem("openlineage-access:" + location.origin + location.pathname, token); } catch {}
    }, { token });
    for (const old of browser.pages()) await old.close();
    page = await connect();
    const held = await page.evaluate(async () => {
      const request = indexedDB.open("openlineage-operator", 1);
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return new Promise((resolve, reject) => {
        const tx = db.transaction("pending", "readonly"), item = tx.objectStore("pending").get(location.origin + location.pathname);
        item.onsuccess = () => resolve(item.result ?? null); item.onerror = () => reject(item.error);
        tx.oncomplete = () => db.close();
      });
    });
    if (held) {
      assert.equal(held.workspaceId, host.identity.workspaceId);
      assert.equal(held.action, "schema.review.save");
      assert.equal(held.args.id, reviewId);
      assert.equal(held.args.comparisonId, comparison.comparisonId);
      assert.ok([reasonLost, reasonResolved].includes(held.args.reason), "Recover this programme's original staff request");
    }
    const heldConflict = page.getByRole("heading", { name: "Review the changed workspace", exact: true });
    if (await heldConflict.isVisible()) {
      await page.getByRole("button", { name: "Review current workspace", exact: true }).click();
      await page.getByRole("button", { name: /^Apply to reviewed revision / }).click();
      await page.locator("#pending-panel").waitFor({ state: "hidden", timeout: 45000 });
    }
    const recover = page.getByRole("button", { name: "Recover saved request", exact: true });
    if (await recover.isVisible()) {
      await recover.click();
      await page.locator("#pending-panel").waitFor({ state: "hidden", timeout: 45000 });
    }
    await showSchemas(page);
    if (!await hasDecision(reasonLost)) {
      const dialog = await updateForm(page, "accepted", reasonLost);
      let dropped = false;
      await page.route("**/api/action", async route => {
        const request = route.request(), data = request.postDataJSON();
        if (!dropped && data?.action === "schema.review.save" && data.args.reason === reasonLost) {
          const response = await route.fetch();
          if (response.status() !== 200) { await route.fulfill({ response }); return; }
          const saved = await response.json(); dropped = true;
          journey.interruptedResponse = { args: data.args, saved, url: request.url() };
          await save();
          await route.abort("failed");
        } else await route.continue();
      });
      await dialog.getByRole("button", { name: "Save schema decision", exact: true }).click();
      await page.getByRole("button", { name: "Recover saved request", exact: true }).waitFor({ timeout: 45000 });
      assert.ok(dropped, "The original server saved the review before its response was interrupted");
      await page.close();
      page = await connect();
      await page.getByRole("button", { name: "Recover saved request", exact: true }).click();
      await page.locator("#pending-panel").waitFor({ state: "hidden", timeout: 45000 });
      assert.equal(await hasDecision(reasonLost), true);
    }
    if (journey.interruptedResponse) {
      const original = journey.interruptedResponse;
      const replayed = await client.saveSchemaReview(original.args);
      assert.equal(replayed.replayed, true);
      assert.equal(replayed.review.id, original.saved.review.id);
      const state = await new LineageWorkspace(join(root, "workspace")).read();
      assert.equal(state.operations.filter(value => value.id === original.args.operationId).length, 1);
    }
    await showSchemas(page);
    if (!await hasDecision(reasonResolved)) {
      const dialog = await updateForm(page, "resolved", reasonResolved);
      const openingRevision = (await client.metadata()).revision;
      await operation("peer-schema-follow-up", "schema.review.save", async () => {
        const current = await getReview();
        return { id: reviewId, from: current.from, to: current.to, comparisonId: current.comparisonId,
          changeIds: current.changeIds, reviewer: "Receiving peer operator", decision: "needs-work",
          reason: reasonPeer, owner: "Data operations", action: "Inspect the original downstream declaration with its source owner.",
          evidence: current.evidence.map(value => ({ kind: value.kind, id: value.id })) };
      });
      const peerRevision = (await client.metadata()).revision;
      // Exercise the background-refresh seam while the original typed form is still open.
      await page.evaluate(() => document.getElementById("refresh-button").click());
      await page.locator("#revision-label").filter({ hasText: "Revision " + (await client.metadata()).revision }).waitFor();
      await dialog.getByRole("button", { name: "Save schema decision", exact: true }).click();
      if (peerRevision === openingRevision) {
        const deadline = Date.now() + 45000;
        while (!await hasDecision(reasonResolved)) {
          if (Date.now() >= deadline) throw new Error("The reviewed original peer decision did not save");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await page.locator("#pending-panel").waitFor({ state: "hidden", timeout: 45000 });
        journey.reviewedExistingPeer = { openingRevision, completedRevision: (await client.metadata()).revision };
        await save();
      } else {
      await page.getByRole("heading", { name: "Review the changed workspace", exact: true }).waitFor({ timeout: 45000 });
      const pending = await page.evaluate(async () => {
        const request = indexedDB.open("openlineage-operator", 1);
        const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        return new Promise((resolve, reject) => {
          const tx = db.transaction("pending", "readonly"), item = tx.objectStore("pending").get(location.origin + location.pathname);
          item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error);
          tx.oncomplete = () => db.close();
        });
      });
      assert.equal(pending.args.expectedRevision, openingRevision, "The original form keeps the revision it opened");
      assert.equal(pending.args.reason, reasonResolved, "The typed staff decision survives the revision conflict");
      assert.equal((await getReview()).reason, reasonPeer, "An unseen peer decision is preserved");
      journey.concurrentReview = { openingRevision, currentRevision: (await client.metadata()).revision,
        rejectedOperationId: pending.args.operationId, retainedReason: pending.args.reason };
      await save();
      await page.getByRole("button", { name: "Review current workspace", exact: true }).click();
      await page.getByRole("button", { name: /^Apply to reviewed revision / }).click();
      await page.locator("#pending-panel").waitFor({ state: "hidden", timeout: 45000 });
      assert.equal((await getReview()).reason, reasonResolved);
      }
    }
    await showSchemas(page);
    await page.screenshot({ path: join(root, "schema-workspace.png"), fullPage: true });
    const downloads = [];
    for (const format of ["HTML", "CSV", "JSON"]) {
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download " + format + " report", exact: true }).click();
      const download = await event, destination = join(root, "browser-schema-report." + format.toLowerCase());
      await download.saveAs(destination);
      const bytes = await fs.readFile(destination);
      if (format === "JSON") assert.equal(JSON.parse(bytes).comparison.id, comparison.comparisonId);
      downloads.push({ format, name: download.suggestedFilename(), bytes: bytes.length, sha256: sha256(bytes) });
    }
    assert.deepEqual(browserErrors, [], "The complete staff workflow has no browser script error");
    journey.browser = { completedAt: new Date().toISOString(), url: host.url, reviewId, downloads,
      review: await getReview(), screenshot: "schema-workspace.png", errors: browserErrors };
    await save();
  } finally { await browser.close(); }
}
async function inspectReceivedBrowser(host, token, root, config, comparison) {
  const native = await import(pathToFileURL(resolve(config.browser.modulePath)).href);
  const chromium = native.chromium ?? native.default?.chromium;
  const browser = await chromium.launchPersistentContext(join(root, "received-browser-profile"), {
    headless: true, viewport: { width: 1440, height: 1000 },
    ...(config.browser.executablePath ? { executablePath: resolve(config.browser.executablePath) } : {}),
    args: config.browser.args ?? []
  });
  const errors = [];
  try {
    await browser.addInitScript(({ token }) => {
      try { sessionStorage.setItem("openlineage-access:" + location.origin + location.pathname, token); } catch {}
    }, { token });
    for (const old of browser.pages()) await old.close();
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(host.url, { waitUntil: "domcontentloaded" });
    await page.locator("#connection-state").filter({ hasText: "Connected" }).waitFor({ timeout: 45000 });
    await page.locator('[data-view="schema"]').click();
    await page.getByRole("combobox", { name: "Before edition", exact: true }).selectOption(comparison.from.id);
    await page.getByRole("combobox", { name: "After edition", exact: true }).selectOption(comparison.to.id);
    await page.getByRole("button", { name: "Compare schemas", exact: true }).click();
    await page.locator("#inspector").getByText("resolved", { exact: true }).first().waitFor();
    await page.screenshot({ path: join(root, "received-schema-workspace.png"), fullPage: true });
    assert.deepEqual(errors, []);
    return { workspaceId: host.identity.workspaceId, url: host.url, screenshot: "received-schema-workspace.png", errors };
  } finally { await browser.close(); }
}

export async function operateSchemaWorkspace(inputPath) {
  const input = resolve(inputPath), config = await readJson(input);
  assert.equal(config.schema, INPUT_SCHEMA);
  assert.equal(config.operationId ?? OPERATION, OPERATION, "Continue the original schema operations identity");
  assert.equal(typeof config.outputDirectory, "string");
  const root = resolve(dirname(input), config.outputDirectory);
  const sources = await sourceFiles(config, dirname(input));
  const sourcePlan = sources.map(({ bytes, ...metadata }) => ({ ...metadata, bytes: bytes.length }));
  const plan = { schema: INPUT_SCHEMA, operationId: OPERATION, inputSha256: sha256(await fs.readFile(input)),
    applicationDirectory: SOURCE, outputDirectory: root, originalSources: sourcePlan };
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const originalPlan = await readJson(join(root, "operation.json"), null);
  if (originalPlan) assert.equal(canonical(originalPlan), canonical(plan), "Continue the exact original source and receiving selection");
  else await newBytes(join(root, "operation.json"), Buffer.from(JSON.stringify(plan, null, 2) + "\n"));
  const requests = await readJson(join(root, "requests.json"), {});
  const journey = await readJson(join(root, "schema-operations.json"), { schema: "commons.openlineage.schema-operations.v1",
    operationId: OPERATION, startedAt: new Date().toISOString(), applicationDirectory: SOURCE, originalSources: sourcePlan, operations: [] });
  if (journey.state === "COMPLETE") return journey;
  const save = () => atomic(join(root, "schema-operations.json"), journey);
  let token;
  if (config.tokenFile) token = (await fs.readFile(resolve(dirname(input), config.tokenFile), "utf8")).trim();
  else {
    const tokenPath = join(root, "operator-token");
    try { token = (await fs.readFile(tokenPath, "utf8")).trim(); }
    catch (error) { if (error.code !== "ENOENT") throw error; token = randomUUID() + randomUUID(); await newBytes(tokenPath, Buffer.from(token + "\n")); }
  }
  assert.ok(token.length >= 24, "Use the original private operator token");
  const selectedPort = await readJson(join(root, "server-port.json"), null);
  let host, receivedHost;
  try {
    host = await startServer({ directory: join(root, "workspace"), title: config.title ?? "OpenLineage schema operations",
      port: selectedPort?.port ?? 0, token });
    if (!selectedPort) await atomic(join(root, "server-port.json"), { port: Number(new URL(host.url).port), workspaceId: host.identity.workspaceId });
    else assert.equal(host.identity.workspaceId, selectedPort.workspaceId);
    let client = clientFor(host, token);
    const operation = async (name, action, makeArgs) => {
      let selected = requests[name];
      if (!selected) {
        const args = await makeArgs();
        selected = { action, args: { ...args, operationId: OPERATION + "/" + name,
          expectedRevision: (await client.metadata()).revision } };
        requests[name] = selected; await atomic(join(root, "requests.json"), requests);
      }
      assert.equal(selected.action, action, "Recover the original action");
      const result = await client.action(selected.action, selected.args);
      const position = journey.operations.findIndex(value => value.name === name);
      const record = { name, action, operationId: selected.args.operationId, revision: result.revision,
        ...(result.source ? { sourceId: result.source.id } : {}), ...(result.edition ? { editionId: result.edition.id } : {}),
        ...(result.review ? { reviewId: result.review.id } : {}), ...(result.result ? { resultId: result.result.id } : {}) };
      if (position < 0) journey.operations.push(record); else assert.equal(canonical(journey.operations[position]), canonical(record));
      await save(); return result;
    };
    for (const [index, source] of sources.filter(value => value.phase === "before").entries())
      await operation("before-source-" + index, "source.import", async () => ({ base64: source.bytes.toString("base64"),
        name: source.name, sourceUrl: source.sourceUrl, contentEncoding: source.contentEncoding }));
    const before = await operation("before-edition", "edition.save", async () => ({ title: config.beforeTitle ?? "Original schema selection before",
      description: "Exact original producer files retained by the schema operations input." }));
    for (const [index, source] of sources.filter(value => value.phase === "after").entries())
      await operation("after-source-" + index, "source.import", async () => ({ base64: source.bytes.toString("base64"),
        name: source.name, sourceUrl: source.sourceUrl, contentEncoding: source.contentEncoding }));
    const after = await operation("after-edition", "edition.save", async () => ({ title: config.afterTitle ?? "Original schema selection after",
      description: "The next exact original producer files over the first saved selection." }));
    const comparison = await client.compareSchemas(before.edition.id, after.edition.id);
    assert.ok(comparison.changes.length, "The selected original files must contain a schema observation or field change");
    journey.comparison = comparison.comparison; await save();
    const first = comparison.changes[0];
    const original = sources.find(value => value.phase === "after");
    const attached = await operation("attach-original-reference", "result.attach", async () => ({ base64: original.bytes.toString("base64"),
      name: original.name, mediaType: original.contentEncoding === "gzip" ? "application/gzip" : "application/json",
      entityKeys: [first.datasetKey], editionId: after.edition.id, sourceReference: original.sourceUrl || original.path,
      query: { purpose: "Complete original producer file supporting the schema review" } }));
    const reviewed = await operation("observe-schema", "schema.review.save", async () => ({
      from: before.edition.id, to: after.edition.id, comparisonId: comparison.comparisonId, changeIds: [first.id],
      reviewer: "Receiving operator", decision: "observed", reason: "Inspected the exact original schema facet, field record and source location.",
      evidence: [{ kind: "source", id: original.sha256 }, { kind: "result", id: attached.result.id }]
    }));
    for (const change of comparison.changes) {
      const impact = await client.schemaImpact({ from: before.edition.id, to: after.edition.id,
        comparisonId: comparison.comparisonId, changeId: change.id });
      assert.equal(impact.comparisonId, comparison.comparisonId);
      assert.equal(impact.before.editionId, before.edition.id); assert.equal(impact.after.editionId, after.edition.id);
    }
    if (!journey.browser) await operateBrowser({ host, client, token, root, config, comparison, reviewId: reviewed.review.id,
      requests, operation, journey, save });
    const state = await new LineageWorkspace(join(root, "workspace")).read();
    assert.ok(state.schemaReviews.find(value => value.id === reviewed.review.id).history.length >= 2);
    journey.revision = state.revision; journey.workspaceId = state.workspaceId;
    for (const format of ["json", "csv", "html"]) {
      const report = await client.schemaReport(before.edition.id, after.edition.id, format);
      await newBytes(join(root, "schema-report." + format), Buffer.from(report.text));
    }
    let offset = 0, retained = [];
    do {
      const result = await client.records({ collection: "schemaReviews", expectedRevision: state.revision, offset, limit: 2 });
      retained.push(...result.items); offset = result.nextOffset;
    } while (offset !== null);
    assert.deepEqual(retained, state.schemaReviews);
    const exported = await client.exportWorkspace({ includeApplication: true });
    const packagePath = join(root, "complete-schema-workspace.json");
    await client.downloadExport(exported.id, packagePath, { chunkBytes: 65536 });
    const bytes = await fs.readFile(packagePath), verified = verifyBundle(bytes);
    assert.equal(verified.application.size, APPLICATION_FILES.length);
    assert.deepEqual(verified.state.schemaReviews, state.schemaReviews);
    assert.deepEqual(verified.state.schemaComparisons, state.schemaComparisons);
    const destination = join(root, "received");
    let received = await readJson(join(destination, "received.json"), null);
    if (received) assert.equal(received.packageSha256, exported.id, "Resume the same complete received workspace");
    else received = await receiveBundle(bytes, destination);
    const reopenedApplication = await import(pathToFileURL(join(destination, "application", "server.mjs")).href);
    receivedHost = await reopenedApplication.startServer({ directory: destination, token, port: 0, expectedWorkspaceId: state.workspaceId });
    const receiving = clientFor(receivedHost, token), reopened = await receiving.read();
    assert.equal(reopened.revision, state.revision); assert.deepEqual(reopened.schemaReviews, state.schemaReviews);
    assert.deepEqual(reopened.schemaComparisons, state.schemaComparisons);
    for (const source of sources) {
      const original = await receiving.action("source.read", { id: source.sha256 });
      assert.ok(Buffer.from(original.base64, "base64").equals(source.bytes), "Independent receiving retains exact original source");
    }
    journey.receivingBrowser = await inspectReceivedBrowser(receivedHost, token, root, config, comparison.comparison); await save();
    const receivingReport = await receiving.schemaReport(before.edition.id, after.edition.id, "json");
    assert.equal(receivingReport.text, (await client.schemaReport(before.edition.id, after.edition.id, "json")).text);
    const receivedExport = await receiving.exportWorkspace({ includeApplication: true });
    await receiving.downloadExport(receivedExport.id, join(root, "received-export.json"));
    const returned = verifyBundle(await fs.readFile(join(root, "received-export.json")));
    assert.deepEqual([...returned.application.keys()].sort(), [...verified.application.keys()].sort());
    for (const [name, data] of verified.application) assert.ok(data.equals(returned.application.get(name)), "The received editable application keeps every original source leaf");
    journey.delivery = { package: "complete-schema-workspace.json", sha256: exported.id, bytes: exported.bytes,
      applicationFiles: verified.application.size, receivedDirectory: destination, receivedExport: receivedExport.id,
      originalUrl: host.url, receivingUrl: receivedHost.url, revision: reopened.revision };
    journey.legacyReceivings ??= [];
    for (const [index, path] of (config.legacyPackages ?? []).entries()) {
      const original = await fs.readFile(resolve(dirname(input), path)), legacy = verifyBundle(original);
      const target = join(root, "legacy-" + index);
      const previous = await readJson(join(target, "received.json"), null);
      if (previous) assert.equal(previous.packageSha256, sha256(original));
      else await receiveBundle(original, target);
      const receipt = { source: path, sha256: sha256(original), workspaceId: legacy.state.workspaceId,
        revision: legacy.state.revision, applicationFiles: legacy.application.size };
      const prior = journey.legacyReceivings.findIndex(value => value.source === path);
      if (prior < 0) journey.legacyReceivings.push(receipt); else journey.legacyReceivings[prior] = receipt;
    }
    delete journey.error; journey.state = "COMPLETE"; journey.completedAt = new Date().toISOString(); await save();
    return journey;
  } catch (error) {
    journey.state = "INTERRUPTED"; journey.error = { at: new Date().toISOString(), message: error.message, stack: error.stack };
    await save().catch(() => {}); throw error;
  } finally {
    if (receivedHost) await receivedHost.close();
    if (host) await host.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  operateSchemaWorkspace(process.argv[2] ?? (() => { throw new Error("Supply the complete original schema operations input JSON"); })())
    .then(value => console.log(JSON.stringify({ operationId: value.operationId, state: value.state, workspaceId: value.workspaceId,
      revision: value.revision, comparison: value.comparison.summary, delivery: value.delivery }, null, 2)))
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
