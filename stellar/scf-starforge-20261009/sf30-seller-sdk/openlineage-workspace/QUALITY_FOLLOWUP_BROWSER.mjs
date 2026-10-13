#!/usr/bin/env node
// MIT. Continue the same native Quality fixture with the actual browser application.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
import { LineageWorkspace, verifyBundle, receiveBundle } from "./store.mjs";
import { QualityFollowupClient } from "./quality-followup-client.mjs";
import { sha256, canonical } from "./model.mjs";
import { randomUUID } from "node:crypto";

const SOURCE = dirname(fileURLToPath(import.meta.url));
const read = async path => JSON.parse(await fs.readFile(path, "utf8"));
const exists = async path => fs.access(path).then(() => true, () => false);
async function publish(path, value, immutable) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  const retained = async () => assert.ok((await fs.readFile(path)).equals(bytes), "Retain original " + path);
  if (immutable && await exists(path)) { await retained(); return; }
  const temporary = path + ".pending-" + randomUUID();
  let handle = null, owned = false, primary = null;
  try {
    handle = await fs.open(temporary, "wx", 0o600); owned = true;
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    if (immutable) {
      try { await fs.link(temporary, path); }
      catch (error) { if (error.code !== "EEXIST") throw error; await retained(); }
    } else { await fs.rename(temporary, path); owned = false; }
  } catch (error) { primary = error; throw error; }
  finally {
    const errors = [];
    if (handle) try { await handle.close(); } catch (error) { errors.push(error); }
    if (owned) try { await fs.unlink(temporary); } catch (error) { if (error.code !== "ENOENT") errors.push(error); }
    if (errors.length) {
      const error = new AggregateError(errors, "Could not close the original browser receiving output.");
      if (primary) primary.outputCleanupError = error; else throw error;
    }
  }
}
const save = (path, value) => publish(path, value, false);
const fixed = (path, value) => publish(path, value, true);
export async function receiveQualityBrowser(directory, configuration) {
  const root = resolve(directory), output = join(root, "browser");
  await fs.mkdir(output, {recursive: true, mode: 0o700});
  const lockPath = join(root, "receiving.lock"), lock = await fs.open(lockPath, "wx", 0o600);
  let host, context, lockOpen = true, lockRetained = true, primaryError = null;
  const reportPath = join(output, "BROWSER_RESULT.json");
  let report;
  async function closeResources() {
    const errors = [];
    if (context) try { await context.close(); context = null; } catch (error) { errors.push(error); }
    if (host) try { await host.close(); host = null; } catch (error) { errors.push(error); }
    if (lockOpen) try { await lock.close(); lockOpen = false; } catch (error) { errors.push(error); }
    if (!context && !host && !lockOpen && lockRetained)
      try { await fs.unlink(lockPath); lockRetained = false; }
      catch (error) { if (error.code === "ENOENT") lockRetained = false; else errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Could not close the original Quality browser resources.");
  }
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, phase: "browser", at: new Date().toISOString()}));
    const native = await read(join(root, "NATIVE_RESULT.json"));
    assert.equal(native.nativeStatus, "COMPLETE");
    const workspace = new LineageWorkspace(join(root, "workspace"));
    assert.equal((await workspace.read()).workspaceId, native.workspaceId);
    const source = await read(join(root, "selected-application.json"));
    for (const item of source.files) {
      const bytes = await fs.readFile(join(SOURCE, item.path));
      assert.equal(bytes.length, item.bytes); assert.equal(sha256(bytes), item.sha256, "Selected application differs");
    }
    const config = typeof configuration === "string" ? await read(configuration) : configuration;
    assert.ok(config?.playwrightModule && config?.executablePath, "Select actual installed Playwright and browser");
    const {chromium} = await import(pathToFileURL(resolve(config.playwrightModule)).href);
    const bindingPath = join(output, "browser-origin.json"), prior = await exists(bindingPath) ? await read(bindingPath) : null;
    if (prior) assert.equal(prior.workspaceId, native.workspaceId);
    host = await startServer({directory: workspace.directory, host: "127.0.0.1", port: prior ? new URL(prior.url).port * 1 : 0,
      expectedWorkspaceId: native.workspaceId});
    await fixed(bindingPath, {workspaceId: native.workspaceId, url: host.url});
    const client = new QualityFollowupClient(host.url, {expectedWorkspaceId: native.workspaceId, instanceId: host.identity.instanceId});
    report = await exists(reportPath) ? await read(reportPath) : {schema: "commons.openlineage.quality-followup.browser.v1",
      workspaceId: native.workspaceId, sourceSha256: native.sourceSha256, steps: {}, captures: [], downloads: [], pageErrors: [], status: "RUNNING"};
    assert.equal(report.workspaceId, native.workspaceId); assert.equal(report.sourceSha256, native.sourceSha256);
    async function checkReceived(bytes, receiving, expectedRevision) {
      const verified = verifyBundle(bytes);
      assert.equal(verified.state.workspaceId, native.workspaceId);
      assert.equal(verified.state.revision, expectedRevision);
      const receipt = await read(join(receiving, "received.json"));
      assert.equal(receipt.packageSha256, verified.packageSha256);
      assert.equal(receipt.payloadSha256, verified.payloadSha256);
      assert.equal(typeof receipt.installationId, "string"); assert.ok(receipt.installationId);
      assert.deepEqual(await new LineageWorkspace(receiving).read(), verified.state);
      for (const [id, original] of verified.objects) {
        const bytes = await fs.readFile(join(receiving, "objects", id));
        assert.equal(bytes.length, original.length); assert.equal(sha256(bytes), id);
      }
      for (const [name, original] of verified.application) {
        const bytes = await fs.readFile(join(receiving, "application", name));
        assert.equal(bytes.length, original.length); assert.equal(sha256(bytes), sha256(original));
      }
      return verified;
    }
    if (report.status === "COMPLETE") {
      for (const item of [...report.captures, ...report.downloads]) assert.equal(sha256(await fs.readFile(join(output, item.path))), item.sha256);
      const whole = report.downloads.find(item => item.name === "complete-workspace");
      assert.ok(whole, "Retain the complete original browser workspace download");
      const verified = await checkReceived(await fs.readFile(join(output, whole.path)),
        join(output, "received-browser-workspace"), report.revision);
      assert.equal(verified.packageSha256, report.completeWorkspace.packageSha256);
      assert.ok((await workspace.read()).revision >= report.revision);
      await closeResources(); return report;
    }
    context = await chromium.launchPersistentContext(join(output, "profile"), {headless: true,
      executablePath: resolve(config.executablePath), args: config.args ?? ["--no-sandbox", "--disable-dev-shm-usage"],
      viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    report.runtime = {playwrightModule: resolve(config.playwrightModule), browser: resolve(config.executablePath),
      browserVersion: context.browser()?.version() ?? "persistent context", node: process.version};
    let active = null, routeFailure = null;
    const page = context.pages()[0] ?? await context.newPage();
    await context.route("**/api/action", async route => {
      try {
        const request = route.request();
        const bytes = request.postDataBuffer(), body = bytes ? JSON.parse(bytes.toString("utf8")) : null;
        if (body?.args?.operationId) {
          if (!active) throw new Error("Unexpected browser mutation outside the original receiving step");
          assert.equal(body.action, active.action);
          const intent = {workspaceId: native.workspaceId, action: body.action, args: body.args,
            bodyUtf8: bytes.toString("utf8"), bytes: bytes.length, sha256: sha256(bytes)};
          await fixed(join(output, "intent-" + active.label + ".json"), intent);
        }
        if (body?.action === "quality.followup.overview" &&
            !report.captures.some(item => item.name === "desktop-loading-evaluations")) {
          await page.getByText("Loading the current saved evaluations and follow-up history…", {exact: true}).waitFor();
          await captureRaw("desktop-loading-evaluations");
        }
        await route.continue();
      } catch (error) {
        routeFailure = error;
        await route.abort("failed").catch(() => {});
      }
    });
    page.on("pageerror", error => {report.pageErrors.push(error.message);});
    async function ready() {
      if (routeFailure) throw routeFailure;
      await page.locator(".qf-desk").waitFor({state: "visible"});
      await page.waitForFunction(() => document.querySelector(".qf-desk")?.getAttribute("aria-busy") === "false" &&
        !document.querySelector(".qf-desk")?.textContent.includes("Loading the current saved evaluations"));
      if (routeFailure) throw routeFailure;
    }
    async function open() {
      await page.goto(host.url, {waitUntil: "domcontentloaded"});
      await page.getByRole("button", {name: "Quality follow-up", exact: true}).click();
      await ready();
    }
    async function readPendingJournal() {
      return page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open("openlineage-operator", 1);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("The original browser request journal is blocked"));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("pending")) { db.close(); resolve(null); return; }
          const transaction = db.transaction("pending", "readonly");
          const value = transaction.objectStore("pending").get(location.origin + location.pathname);
          let found;
          value.onsuccess = () => { found = value.result ?? null; };
          transaction.oncomplete = () => { db.close(); resolve(found); };
          transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
        };
      }));
    }
    async function retainPreparedIntent() {
      const pending = await readPendingJournal();
      if (!pending) return;
      assert.equal(pending.workspaceId, native.workspaceId);
      const labels = {"quality.followup.comparison.save": "browser-comparison", "quality.followup.save": "browser-followup"};
      const label = labels[pending.action];
      assert.ok(label, "Keep an unrelated original pending request with its existing operator");
      assert.equal(typeof pending.args?.operationId, "string"); assert.ok(pending.args.operationId);
      assert.ok(Number.isSafeInteger(pending.args.expectedRevision) && pending.args.expectedRevision >= 0);
      const path = join(output, "intent-" + label + ".json");
      if (await exists(path)) {
        const intent = await read(path);
        assert.equal(canonical({workspaceId: pending.workspaceId, action: pending.action, args: pending.args}),
          canonical({workspaceId: intent.workspaceId, action: intent.action, args: intent.args}));
        return;
      }
      if (label === "browser-comparison") {
        assert.equal(pending.args.beforeEvaluationId, native.beforeEvaluationId);
        assert.equal(pending.args.afterEvaluationId, native.afterEvaluationId);
        assert.equal(pending.args.title, "Browser-reviewed fixture comparison");
        const selected = await read(join(root, "selection.json"));
        assert.equal(canonical(pending.args.runPairs), canonical(selected.runPairs));
        assert.equal(canonical(pending.args.findingPairs), canonical(selected.findingPairs));
      } else {
        const comparisonIntent = await read(join(output, "intent-browser-comparison.json"));
        const state = await workspace.read();
        const comparison = state.operations.find(item => item.id === comparisonIntent.args.operationId)?.result?.comparison;
        assert.ok(comparison, "Retain the original browser comparison before its follow-up");
        assert.equal(pending.args.comparisonId, comparison.id);
        assert.ok(comparison.rows.some(row => row.id === pending.args.rowId && row.after[0]?.title === "Fixture output rows"));
        assert.equal(pending.args.owner, "Browser receiving operator");
        assert.equal(pending.args.reason, "Reviewed original fixture output, source scope and retained rule changes.");
        assert.equal(pending.args.dueDate, "2026-11-02");
      }
      const bodyUtf8 = JSON.stringify({action: pending.action, args: pending.args}), bytes = Buffer.from(bodyUtf8);
      const journalPath = join(output, "journal-intent-" + label + ".json");
      if (await exists(journalPath)) {
        const retained = (await read(journalPath)).pending;
        assert.equal(canonical({workspaceId: retained.workspaceId, action: retained.action, args: retained.args}),
          canonical({workspaceId: pending.workspaceId, action: pending.action, args: pending.args}));
      } else await fixed(journalPath, {source: "Original same-workspace browser request journal", pending});
      await fixed(path, {workspaceId: pending.workspaceId, action: pending.action, args: pending.args,
        bodyUtf8, bytes: bytes.length, sha256: sha256(bytes)});
    }
    async function recoverPending(resultRevision) {
      const button = page.getByRole("button", {name: "Recover saved request", exact: true});
      if (await button.count() && await button.isVisible()) {
        assert.ok(active, "Retain the original receiving intent before recovering its UI request");
        const pending = await readPendingJournal();
        assert.ok(pending, "Read the original pending browser request");
        assert.equal(pending.workspaceId, native.workspaceId);
        const intent = await read(join(output, "intent-" + active.label + ".json"));
        if (pending.args.operationId !== intent.args.operationId) {
          // Earlier completed steps leave an original later step for its own recovery.
          await retainPreparedIntent(); return;
        }
        assert.equal(canonical({action: pending.action, args: pending.args}), canonical({action: intent.action, args: intent.args}));
        assert.ok(Number.isSafeInteger(resultRevision) && resultRevision >= 0);
        await button.click();
        await page.waitForFunction(async ({operationId, revision}) => {
          const pending = await new Promise((resolve, reject) => {
            const request = indexedDB.open("openlineage-operator", 1);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error("The original browser request journal is blocked"));
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains("pending")) { db.close(); resolve(null); return; }
              const transaction = db.transaction("pending", "readonly");
              const value = transaction.objectStore("pending").get(location.origin + location.pathname);
              let found;
              value.onsuccess = () => { found = value.result ?? null; };
              transaction.oncomplete = () => { db.close(); resolve(found); };
              transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
            };
          });
          if (pending) {
            if (pending.args?.operationId !== operationId)
              throw new Error("The original recovery request changed before it completed");
            return false;
          }
          const panel = document.querySelector("#pending-panel");
          const match = document.querySelector("#revision-label")?.textContent.match(/^Revision\s+(\d+)$/);
          return Boolean(panel?.hidden && match && Number(match[1]) >= revision &&
            document.querySelector("#catalog")?.getAttribute("aria-busy") !== "true");
        }, {operationId: intent.args.operationId, revision: resultRevision}, {timeout: 30000});
        assert.equal(await readPendingJournal(), null, "The exact recovered browser request must be cleared");
        await ready();
      }
    }
    async function mutation(label, action, click) {
      const intentPath = join(output, "intent-" + label + ".json");
      const resultPath = join(output, "result-" + label + ".json");
      active = {label, action};
      try {
        if (await exists(intentPath)) {
          const intent = await read(intentPath);
          assert.equal(intent.workspaceId, native.workspaceId); assert.equal(intent.action, action);
          assert.equal(sha256(Buffer.from(intent.bodyUtf8)), intent.sha256);
          assert.deepEqual(JSON.parse(intent.bodyUtf8), {action: intent.action, args: intent.args});
          const result = await client.action(intent.action, intent.args);
          if (await exists(resultPath)) {
            const prior = await read(resultPath), normalize = value => {const copy = structuredClone(value); delete copy.replayed; return copy;};
            assert.deepEqual(normalize(result), normalize(prior));
          } else await fixed(resultPath, result);
          await recoverPending(result.revision); report.steps[label] = {status: "COMPLETE", operationId: intent.args.operationId, revision: result.revision};
          await save(reportPath, report); return result;
        }
        await click();
        await page.waitForFunction(() => document.querySelector("#pending-panel")?.hidden, null, {timeout: 30000});
        await ready();
        assert.ok(await exists(intentPath), "Original browser intent must be retained before dispatch");
        const intent = await read(intentPath);
        const committed = (await workspace.read()).operations.find(row => row.id === intent.args.operationId);
        assert.ok(committed, "Original browser request must commit through the original workspace journal");
        await fixed(resultPath, committed.result);
        report.steps[label] = {status: "COMPLETE", operationId: intent.args.operationId, revision: committed.result.revision};
        await save(reportPath, report); return committed.result;
      } finally {active = null;}
    }
    async function capture(name) {
      await ready(); return captureRaw(name);
    }
    async function captureRaw(name) {
      const retained = report.captures.find(item => item.name === name);
      if (retained) {
        assert.equal(sha256(await fs.readFile(join(output, retained.path))), retained.sha256);
        return;
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const file = name + ".png"; await page.screenshot({path: join(output, file), fullPage: true});
      const bytes = await fs.readFile(join(output, file));
      report.captures.push({name, path: file, bytes: bytes.length, sha256: sha256(bytes), width: page.viewportSize().width,
        revision: (await workspace.read()).revision});
      await save(reportPath, report);
    }
    async function download(label, trigger) {
      const saved = report.downloads.find(item => item.name === label);
      if (saved) {assert.equal(sha256(await fs.readFile(join(output, saved.path))), saved.sha256); return join(output, saved.path);}
      const pending = page.waitForEvent("download"); await trigger();
      const downloaded = await pending; const file = label + "-" + downloaded.suggestedFilename();
      await downloaded.saveAs(join(output, file)); const bytes = await fs.readFile(join(output, file));
      report.downloads.push({name: label, path: file, bytes: bytes.length, sha256: sha256(bytes)});
      await save(reportPath, report); return join(output, file);
    }
    await open();
    await retainPreparedIntent();
    const selections = await read(join(root, "selection.json"));
    if (!await exists(join(output, "intent-browser-comparison.json"))) {
      await capture("desktop-empty-comparison");
      await page.getByLabel("Earlier saved evaluation", {exact: true}).selectOption(native.beforeEvaluationId);
      await page.getByLabel("Later saved evaluation", {exact: true}).selectOption(native.afterEvaluationId);
      await page.getByText("Explicit correspondence between different runs", {exact: true}).click();
      await page.getByLabel("Earlier run", {exact: true}).selectOption(selections.runPairs[0].beforeRunKey);
      await page.getByLabel("Later run", {exact: true}).selectOption(selections.runPairs[0].afterRunKey);
      await page.getByRole("button", {name: "Add run correspondence", exact: true}).click(); await ready();
      await page.getByRole("button", {name: "Compare saved evaluations", exact: true}).click(); await ready();
      await capture("desktop-ambiguous-comparison");
      while (await page.getByLabel("Explicit finding correspondence", {exact: true}).count()) {
        await page.getByLabel("Explicit finding correspondence", {exact: true}).first().selectOption("0");
        await page.getByRole("button", {name: "Use this one-to-one finding correspondence", exact: true}).first().click(); await ready();
      }
      await page.getByLabel("Saved comparison title", {exact: true}).fill("Browser-reviewed fixture comparison");
      await capture("desktop-reviewed-comparison");
    }
    const comparisonResult = await mutation("browser-comparison", "quality.followup.comparison.save",
      () => page.getByRole("button", {name: "Save reviewed comparison", exact: true}).click());
    await page.getByRole("button", {name: "Saved comparisons and follow-up", exact: true}).click();
    await page.getByLabel("Saved quality comparison", {exact: true}).selectOption(comparisonResult.comparison.id);
    const findingRow = page.locator(".qf-row").filter({has: page.locator("strong").filter({hasText: /^Fixture output rows$/})}).first();
    await findingRow.getByRole("button", {name: "Open finding follow-up", exact: true}).click();
    if (!await exists(join(output, "intent-browser-followup.json"))) {
      await page.getByLabel("Follow-up owner", {exact: true}).fill("Browser receiving operator");
      await page.getByLabel("Follow-up reason", {exact: true}).fill("Reviewed original fixture output, source scope and retained rule changes.");
      await page.getByLabel("Follow-up due date", {exact: true}).fill("2026-11-02");
      await page.getByLabel("Earlier decision reference", {exact: true}).selectOption("1");
      await page.getByText("Working copies and complete authoring files", {exact: true}).click();
      const draftFile = await download("working-copy", () => page.getByRole("button", {name: "Download complete working copy", exact: true}).click());
      const wrongWorkspace = await read(draftFile);
      wrongWorkspace.workspaceId = "different-workspace-fixture";
      const wrongFile = join(output, "working-copy-different-workspace.json");
      await fixed(wrongFile, wrongWorkspace);
      await page.getByLabel("Open quality working copy", {exact: true}).setInputFiles(wrongFile);
      await page.getByRole("alert").filter({hasText: "Choose a complete working copy belonging to this original workspace"}).waitFor();
      await capture("desktop-working-copy-error");
      assert.equal(await page.getByLabel("Follow-up reason", {exact: true}).inputValue(),
        "Reviewed original fixture output, source scope and retained rule changes.");
      // Opening the valid complete copy also emits its actual preceding entered copy.
      // Always perform the original reopen, including after an interrupted earlier attempt.
      const beforeOpening = page.waitForEvent("download");
      await page.getByLabel("Open quality working copy", {exact: true}).setInputFiles(draftFile);
      const retainedBeforeOpening = await beforeOpening;
      const beforeOpeningName = "working-copy-before-opening-" + randomUUID() + ".json";
      const beforeOpeningPath = join(output, beforeOpeningName);
      await retainedBeforeOpening.saveAs(beforeOpeningPath);
      const beforeOpeningBytes = await fs.readFile(beforeOpeningPath);
      const beforeOpeningValue = JSON.parse(beforeOpeningBytes.toString("utf8"));
      assert.equal(beforeOpeningValue.workspaceId, native.workspaceId);
      assert.equal(beforeOpeningValue.schema, "commons.openlineage.quality-working-copy.v1");
      report.downloads.push({name: beforeOpeningName, path: beforeOpeningName,
        bytes: beforeOpeningBytes.length, sha256: sha256(beforeOpeningBytes)});
      await save(reportPath, report);
      await ready(); assert.equal(await page.getByLabel("Follow-up owner", {exact: true}).inputValue(), "Browser receiving operator");
      await page.reload({waitUntil: "domcontentloaded"});
      await page.getByRole("button", {name: "Quality follow-up", exact: true}).click(); await ready();
      await page.getByRole("button", {name: "Saved comparisons and follow-up", exact: true}).click();
      assert.equal(await page.getByLabel("Follow-up reason", {exact: true}).inputValue(), "Reviewed original fixture output, source scope and retained rule changes.");
      await capture("desktop-retained-authoring");
    }
    const followup = await mutation("browser-followup", "quality.followup.save",
      () => page.getByRole("button", {name: "Save follow-up", exact: true}).click());
    assert.equal(followup.followup.sourceDisposition.version, 1);
    await page.getByRole("button", {name: "Refresh follow-up", exact: true}).click(); await ready();
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height: 1000});
      await capture((width === 1440 ? "desktop" : "phone") + "-saved-followup");
      for (const format of ["html", "json", "csv"]) {
        await page.getByLabel("Comparison report format", {exact: true}).selectOption(format);
        const reportFile = await download("comparison-" + format, () => page.getByRole("button", {name: "Download complete comparison report", exact: true}).click());
        const text = await fs.readFile(reportFile, "utf8");
        if (format === "json") assert.equal(JSON.parse(text).comparison.id, comparisonResult.comparison.id);
        if (format === "csv") assert.ok(text.includes("Comparison ID"));
        if (format === "html") {
          const rendered = await context.newPage(); await rendered.setViewportSize({width, height: 1000}); await rendered.setContent(text);
          const file = (width === 1440 ? "desktop" : "phone") + "-downloaded-report.png";
          if (!report.captures.some(item => item.path === file)) {
            await rendered.screenshot({path: join(output, file), fullPage: true});
            const bytes = await fs.readFile(join(output, file)); report.captures.push({name: file, path: file, bytes: bytes.length, sha256: sha256(bytes), width});
            await save(reportPath, report);
          }
          await rendered.close();
        }
      }
    }
    await page.getByRole("button", {name: "Export", exact: true}).click();
    const whole = await download("complete-workspace", () => page.getByRole("button", {name: "Download complete workspace", exact: true}).click());
    const verified = verifyBundle(await fs.readFile(whole)), final = await workspace.read();
    assert.equal(verified.state.workspaceId, native.workspaceId); assert.equal(verified.state.revision, final.revision);
    assert.equal(verified.state.qualityFollowup.comparisons.length, 2);
    assert.equal(verified.state.qualityFollowup.followups.length, 2);
    const receiving = join(output, "received-browser-workspace");
    if (!await exists(receiving)) await receiveBundle(await fs.readFile(whole), receiving);
    await checkReceived(await fs.readFile(whole), receiving, final.revision);
    assert.deepEqual(report.pageErrors, []);
    report.revision = final.revision;
    report.completeWorkspace = {path: whole, packageSha256: verified.packageSha256, receivedDirectory: receiving};
    await closeResources();
    report.status = "COMPLETE";
    await save(reportPath, report); return report;
  } catch (error) {
    primaryError = error;
    if (report) {
      report.status = "INTERRUPTED"; report.interruption = {message: error.message, stack: error.stack, at: new Date().toISOString()};
      try { await save(reportPath, report); } catch (retentionError) { error.retentionError = retentionError.message; }
    }
    throw error;
  } finally {
    try { await closeResources(); }
    catch (cleanupError) {
      try { await save(join(output, "CLEANUP_INTERRUPTION.json"), {at: new Date().toISOString(),
        message: cleanupError.message, primaryError: primaryError?.message ?? null}); }
      catch (retentionError) { cleanupError.retentionError = retentionError.message; }
      if (primaryError) primaryError.cleanupError = cleanupError.message; else throw cleanupError;
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  receiveQualityBrowser(process.argv[2], process.argv[3]).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => {
    console.error(error.stack); process.exitCode = 1;
  });
