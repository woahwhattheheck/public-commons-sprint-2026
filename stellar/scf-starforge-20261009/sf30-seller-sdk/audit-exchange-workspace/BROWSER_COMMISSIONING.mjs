#!/usr/bin/env node
/**
 * Complete the original Audit Exchange operator workflow through the real browser.
 * Every mutation is retained before its real HTTP request is forwarded. Continuation
 * opens the same request in the application's recovery controls and the same workspace.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const FORMAT = "commons.audit-exchange.browser-commissioning.v1";
const OPERATION = "AUDIT-EXCHANGE-NATIVE-6804-20261012";
const now = () => new Date().toISOString();
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const need = (condition, message) => { if (!condition) throw new Error(message); };
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function emit(value) { process.stdout.write(JSON.stringify(value) + "\n"); }
function atomic(file, body) {
  body = Buffer.isBuffer(body) ? body : Buffer.from(body);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    need(!fs.lstatSync(file).isSymbolicLink() && fs.readFileSync(file).equals(body),
      "Keep the complete original file: " + file);
    return;
  }
  const candidate = path.join(path.dirname(file), "." + path.basename(file) + "." + crypto.randomUUID());
  const fd = fs.openSync(candidate, "wx", 0o600);
  try {
    fs.writeFileSync(fd, body); fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try {
    try { fs.linkSync(candidate, file); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      need(fs.readFileSync(file).equals(body), "Another complete original file differs: " + file);
    }
    const directory = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally { fs.unlinkSync(candidate); }
}
async function playwright(options) {
  const require = createRequire(import.meta.url);
  const candidates = options.module ? [options.module] : [
    "playwright", "playwright-core",
    ...[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, ...(process.env.NODE_PATH || "").split(path.delimiter)]
      .filter(Boolean).flatMap(root => [path.join(root, "playwright"), path.join(root, "playwright-core")])
  ];
  const failures = [];
  for (const candidate of candidates) {
    try {
      let resolved;
      try { resolved = require.resolve(candidate); }
      catch { resolved = path.isAbsolute(candidate) ? candidate : null; }
      if (!resolved) continue;
      const loaded = await import(pathToFileURL(resolved).href);
      const engine = loaded.chromium ? loaded : loaded.default;
      if (engine?.chromium) return engine;
    } catch (error) { failures.push(candidate + ": " + error.message); }
  }
  throw new Error("Provide the installed Playwright module in browser.module. " + failures.join("; "));
}
function timeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

class Journey {
  constructor(input) {
    this.input = input;
    need(["commons.audit-exchange.browser-input.v1", "commons.audit-exchange.rendered-input.v1", "commons.audit-exchange.colleague-browser-input.v1"].includes(input.format) && input.operation === OPERATION,
      "Use the original complete browser commissioning input.");
    need(input.workspaceId && input.instanceId && input.operator, "Keep the actual workspace, listener and operator identities.");
    this.root = path.resolve(input.directory);
    fs.mkdirSync(this.root, { recursive: true });
    const { url, instanceId, ...stable } = input;
    atomic(path.join(this.root, "original-input.json"), bytes(stable));
    this.connection = { url: new URL(url).href, workspaceId: input.workspaceId, instanceId };
    atomic(path.join(this.root, "connections", sha(bytes(this.connection)) + ".json"), bytes(this.connection));
    for (const [name, file] of input.format === "commons.audit-exchange.browser-input.v1" ?
      [["shared", input.sharedFixture], ["weather", input.weather]] : []) {
      const body = fs.readFileSync(file.path);
      need(sha(body) === file.sha256 && (file.bytes === undefined || body.length === file.bytes),
        "The complete original " + name + " input changed.");
    }
    this.browser = null; this.context = null; this.page = null; this.armed = null;
    this.routeFailure = null; this.messages = []; this.requests = [];
  }
  async http(route, envelope) {
    const response = await fetch(new URL(route, this.connection.url), {
      method: envelope ? "POST" : "GET",
      headers: { "X-Audit-Workspace-Id": this.input.workspaceId, ...(envelope ? { "Content-Type": "application/json" } : {}) },
      ...(envelope ? { body: JSON.stringify(envelope) } : {}),
      signal: AbortSignal.timeout(120000),
      redirect: "error"
    });
    const raw = Buffer.from(await response.arrayBuffer());
    let value; try { value = JSON.parse(raw.toString("utf8")); }
    catch { throw new Error("The actual native HTTP response is not JSON: " + raw.toString("utf8").slice(0, 500)); }
    if (!response.ok || value.ok === false) {
      const error = new Error(value.error?.message || "Native HTTP " + response.status);
      error.status = response.status; error.code = value.error?.code; error.details = value.error?.details;
      throw error;
    }
    return value;
  }
  async read(action, inputs = {}) { return (await this.http("/api/action", { action, inputs })).result; }
  async state() { return (await this.http("/api/state")).result; }
  async receipt(envelope) {
    try {
      const observed = await this.read("operation.get", { requestId: envelope.requestId });
      need(observed.requestId === envelope.requestId && observed.action === envelope.action,
        "The retained request belongs to another original operation.");
      return observed;
    } catch (error) { if (error.status === 404 && error.code === "not_found") return null; throw error; }
  }
  actionPath(label, name) { return path.join(this.root, "actions", label, name); }
  saveAction(label, name, value) { atomic(this.actionPath(label, name), bytes(value)); }
  async start() {
    const identity = await this.http("/api/identity");
    need(identity.workspaceId === this.input.workspaceId && identity.instanceId === this.input.instanceId,
      "Open the exact currently supplied native workspace listener.");
    const selected = { ...(this.input.browser || {}) };
    if (process.env.AUDIT_BROWSER_MODULE) {
      need(path.isAbsolute(process.env.AUDIT_BROWSER_MODULE),
        "AUDIT_BROWSER_MODULE must identify the installed module by absolute path.");
      selected.module = process.env.AUDIT_BROWSER_MODULE;
    }
    if (process.env.AUDIT_BROWSER_EXECUTABLE) {
      need(path.isAbsolute(process.env.AUDIT_BROWSER_EXECUTABLE),
        "AUDIT_BROWSER_EXECUTABLE must identify the installed browser by absolute path.");
      fs.accessSync(process.env.AUDIT_BROWSER_EXECUTABLE, fs.constants.X_OK);
      selected.executablePath = process.env.AUDIT_BROWSER_EXECUTABLE;
    }
    const engine = await playwright(selected);
    const launch = {
      headless: true,
      ...(selected.executablePath ? { executablePath: selected.executablePath } : {}),
      args: [...(typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : []),
        ...(selected.args || [])]
    };
    this.browser = await engine.chromium.launch(launch);
    const runtime = { format: "commons.audit-exchange.browser-runtime.v1", operation: OPERATION,
      workspaceId: this.input.workspaceId, at: now(), originalSelection: this.input.browser || {},
      selectedModule: selected.module || null,
      executablePath: selected.executablePath || engine.chromium.executablePath(),
      launchArguments: launch.args, version: this.browser.version() };
    atomic(path.join(this.root, "runtime-selections", sha(bytes(runtime)) + ".json"), bytes(runtime));
    emit({ stage: "ORIGINAL_BROWSER_RUNTIME_SELECTED", ...runtime });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await this.context.route("**/api/action", route => this.forward(route));
    this.page = await this.newPage();
    await this.connect();
  }
  async newPage() {
    const page = await this.context.newPage();
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) this.messages.push({ at: now(), type: message.type(), text: message.text() });
    });
    page.on("pageerror", error => this.messages.push({ at: now(), type: "pageerror", text: error.stack || error.message }));
    page.on("dialog", async dialog => {
      this.messages.push({ at: now(), type: "dialog", dialogType: dialog.type(), text: dialog.message() });
      // Deliberate navigation retains the staged original draft; unexpected prompts
      // remain visible in the complete browser log and refuse the operation.
      if (dialog.type() === "beforeunload") await dialog.accept();
      else { this.routeFailure ||= new Error("Unexpected operator prompt: " + dialog.message()); await dialog.dismiss(); }
    });
    await page.goto(this.connection.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    return page;
  }
  async idle() {
    await this.page.waitForFunction(() => document.body.getAttribute("aria-busy") === "false", null, { timeout: 120000 });
    if (this.routeFailure) throw this.routeFailure;
  }
  async connect() {
    await this.page.locator("#server-url").fill(this.connection.url);
    await this.page.locator("#workspace-pin").fill(this.input.workspaceId);
    await this.page.locator("#connect-form button[type=submit]").click();
    await this.idle();
    need((await this.page.locator("#connection-status").textContent()).includes(this.input.workspaceId),
      "The actual operator page did not open its original workspace.");
    await this.page.locator("#actor").fill(this.input.operator);
  }
  async section(name) {
    await this.page.locator('[data-section="' + name + '"]').click(); await this.idle();
  }
  async openSource(sourceId, revisionId) {
    await this.section("inspect");
    await this.page.locator("#source-select").selectOption(sourceId); await this.idle();
    if (revisionId) await this.page.locator("#revision-select").selectOption(revisionId);
    await this.page.locator("#source-picker button[type=submit]").click(); await this.idle();
    const binding = await this.page.locator("#source-context").textContent();
    need(!revisionId || binding.includes(revisionId), "The visible source revision changed.");
  }
  arm(label, action, expected = null, interrupt = false) {
    need(!this.armed, "Keep one original browser mutation in flight.");
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Attach a handler immediately; a real browser network failure can arrive
    // before the submit click finishes its own actionability wait.
    promise.catch(() => {});
    const capture = { label, action, expected, interrupt, resolve, reject, promise, observed: null };
    this.armed = capture;
    return capture;
  }
  async forward(route) {
    const request = route.request();
    let envelope;
    try { envelope = request.postDataJSON(); }
    catch { await route.continue(); return; }
    if (!envelope?.requestId) { await route.continue(); return; }
    const capture = this.armed;
    try {
      need(capture && capture.action === envelope.action, "An unselected browser mutation attempted to run.");
      const recordPath = this.actionPath(capture.label, "request.json");
      let record;
      if (fs.existsSync(recordPath)) {
        record = readJson(recordPath);
        need(same(record.envelope, envelope), "Continue the complete original browser request unchanged.");
      } else {
        record = { format: FORMAT, operation: OPERATION, workspaceId: this.input.workspaceId,
          label: capture.label, createdAt: now(), envelope };
        this.saveAction(capture.label, "request.json", record);
      }
      if (capture.expected) need(same(capture.expected, envelope), "The recovered request changed its original version or inputs.");
      const response = await route.fetch({ maxRedirects: 0, timeout: 120000 });
      const raw = await response.body(), responseSha256 = sha(raw);
      let parsed; try { parsed = JSON.parse(raw.toString("utf8")); }
      catch { throw new Error("The original native response is not a complete JSON object."); }
      const responseRecord = { format: FORMAT, operation: OPERATION, workspaceId: this.input.workspaceId,
        label: capture.label, requestId: envelope.requestId, status: response.status(),
        responseSha256, response: parsed };
      this.saveAction(capture.label, "responses/" + responseSha256 + ".json", responseRecord);
      capture.observed = { record, response: parsed, responseSha256, status: response.status() };
      this.requests.push({ label: capture.label, action: envelope.action, requestId: envelope.requestId, responseSha256,
        status: response.status(), interrupted: capture.interrupt });
      if (capture.interrupt && response.ok() && parsed.ok === true) {
        this.saveAction(capture.label, "response-interrupted.json", {
          format: FORMAT, operation: OPERATION, requestId: envelope.requestId,
          workspaceId: this.input.workspaceId, responseSha256, committedResult: parsed.result
        });
        await route.abort("failed");
      } else {
        // Forward the actual original HTTP response unchanged.
        await route.fulfill({ response });
      }
      capture.resolve(capture.observed);
    } catch (error) {
      this.routeFailure = error;
      try { await route.abort("failed"); } catch {}
      capture?.reject(error);
    }
  }
  async finish(capture) {
    let observed;
    try {
      observed = await timeout(capture.promise, 150000, "Continue the original browser request after its native response.");
      await this.idle();
    } finally { if (this.armed === capture) this.armed = null; }
    need(observed.response.ok === true && observed.status >= 200 && observed.status < 300,
      "The original mutation was refused: " + JSON.stringify(observed.response.error || observed.response));
    return observed;
  }
  complete(label, observed) {
    const result = { format: FORMAT, operation: OPERATION, workspaceId: this.input.workspaceId,
      label, action: observed.record.envelope.action, requestId: observed.record.envelope.requestId,
      responseSha256: observed.responseSha256, result: observed.response.result };
    this.saveAction(label, "completed.json", result);
    emit({ stage: "COMPLETE_BROWSER_OPERATION", ...result });
    return result.result;
  }
  async recover(label, record, secondTab = false) {
    const originalPage = this.page;
    if (secondTab) { this.page = await this.newPage(); await this.connect(); }
    const wrapper = { format: "commons.audit-exchange.pending.v1", workspaceId: this.input.workspaceId,
      serverUrl: this.connection.url, createdAt: record.createdAt, status: "outcome unknown", envelope: record.envelope };
    // The complete envelope has its own immutable file, independent of transient
    // browser storage and the current listener URL.
    const originalFile = this.actionPath(label, "complete-original-request.json");
    if (!fs.existsSync(originalFile)) atomic(originalFile, bytes(wrapper));
    else need(same(readJson(originalFile).envelope, record.envelope), "Keep the original exported request body.");
    const pending = await this.page.evaluate(async workspaceId => {
      const request = indexedDB.open("audit-exchange-operator", 1);
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        if (!db.objectStoreNames.contains("pending")) return null;
        return await new Promise((resolve, reject) => {
          const query = db.transaction("pending", "readonly").objectStore("pending").get(workspaceId);
          query.onsuccess = () => resolve(query.result || null); query.onerror = () => reject(query.error);
        });
      } finally { db.close(); }
    }, this.input.workspaceId);
    if (pending) need(same(pending.envelope, record.envelope), "Another tab retains a different original request.");
    else {
      await this.page.locator("#recover-file").setInputFiles(originalFile);
      await this.page.locator("#recover-file-form button[type=submit]").click(); await this.idle();
    }
    need((await this.page.locator("#recovery-details").textContent()).includes(record.envelope.requestId),
      "The operator recovery control must display the original request identity.");
    const capture = this.arm(label, record.envelope.action, record.envelope, false);
    await this.page.locator("#recover-request").click();
    const observed = await this.finish(capture);
    const receipt = await this.receipt(record.envelope);
    need(receipt && same(receipt.result, observed.response.result), "Browser recovery differs from the original committed result.");
    if (secondTab) {
      const recovery = {
        format: FORMAT, operation: OPERATION, workspaceId: this.input.workspaceId,
        requestId: record.envelope.requestId, sharedIndexedDB: Boolean(pending),
        originalResult: receipt.result, recoveredResult: observed.response.result
      };
      const firstRecovery = this.actionPath(label, "second-tab-recovery.json");
      if (fs.existsSync(firstRecovery)) {
        const original = readJson(firstRecovery);
        need(original.requestId === recovery.requestId && same(original.originalResult, recovery.originalResult) &&
          same(original.recoveredResult, recovery.recoveredResult), "Preserve the first complete original recovery result.");
        this.saveAction(label, "recoveries/" + sha(bytes(recovery)) + ".json", recovery);
      } else this.saveAction(label, "second-tab-recovery.json", recovery);
      await originalPage.close();
    }
    return observed;
  }
  async mutation(label, action, prepare, { interrupt = false } = {}) {
    const completePath = this.actionPath(label, "completed.json");
    const requestPath = this.actionPath(label, "request.json");
    if (fs.existsSync(completePath)) {
      const completed = readJson(completePath), record = readJson(requestPath);
      const receipt = await this.receipt(record.envelope);
      need(completed.workspaceId === this.input.workspaceId && completed.action === action && receipt &&
        same(receipt.result, completed.result), "The original completed browser action changed.");
      return completed.result;
    }
    if (fs.existsSync(requestPath)) {
      const record = readJson(requestPath);
      need(record.workspaceId === this.input.workspaceId && record.envelope.action === action,
        "Keep the original browser mutation identity.");
      await this.receipt(record.envelope);
      return this.complete(label, await this.recover(label, record, fs.existsSync(this.actionPath(label, "response-interrupted.json"))));
    }
    const capture = this.arm(label, action, null, interrupt);
    try { await prepare(); }
    catch (error) { if (this.armed === capture) this.armed = null; throw error; }
    let observed = await this.finish(capture);
    if (interrupt) observed = await this.recover(label, observed.record, true);
    return this.complete(label, observed);
  }
  plan(name, make) {
    const file = path.join(this.root, "plans", name + ".json");
    if (fs.existsSync(file)) return readJson(file);
    const value = make(); atomic(file, bytes(value)); return value;
  }
  async checkpoint(name, value) {
    const file = path.join(this.root, "observations", name + ".json");
    atomic(file, bytes(value)); return value;
  }
  async screenshot(name) {
    const file = path.join(this.root, "views", name + ".png");
    if (fs.existsSync(file)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = await this.page.screenshot({ fullPage: true });
    atomic(file, data);
  }
  async run() {
    const finishedPath = path.join(this.root, "result.json");
    if (fs.existsSync(finishedPath)) {
      const finished = readJson(finishedPath), state = await this.state();
      need(finished.operation === OPERATION && finished.workspaceId === state.workspaceId && finished.status === "passed",
        "Open the original completed operator journey.");
      for (const label of fs.readdirSync(path.join(this.root, "actions"))) {
        const completedPath = this.actionPath(label, "completed.json");
        if (!fs.existsSync(completedPath)) continue;
        const completed = readJson(completedPath), record = readJson(this.actionPath(label, "request.json"));
        const original = await this.receipt(record.envelope);
        need(original && same(original.result, completed.result), "The original completed browser result differs.");
      }
      emit({ stage: "COMPLETE_ORIGINAL_BROWSER_REOPENED", operation: OPERATION, workspaceId: state.workspaceId });
      return finished;
    }
    await this.start();
    const shared = await this.mutation("01-import-original-shared-source", "source.import", async () => {
      await this.section("sources");
      await this.page.locator("#import-file").setInputFiles(this.input.sharedFixture.path); await this.idle();
      await this.page.locator("#import-name").fill(this.input.sharedFixture.name);
      await this.page.locator("#import-schema").selectOption("2.7.0");
      const profiles = this.page.locator("#import-profiles input[type=checkbox]");
      for (let index = 0; index < await profiles.count(); index++) await profiles.nth(index).uncheck();
      await this.page.locator("#import-note").fill("Retain the complete original two-building shared-system example.");
      await this.page.locator("#import-form button[type=submit]").click();
    });
    const original = await this.read("source.get", { sourceId: shared.sourceId, revisionId: shared.revisionId });
    need(original.source.originalSha256 === this.input.sharedFixture.sha256 && original.revision.declaredVersion === "2.6.0" &&
      original.revision.selectedSchema === "2.7.0", "The original declared version and selected schema changed.");
    const physical = original.model.entities.filter(row => row.semanticKind === "system");
    need(physical.length === 3 && same(physical.map(row => row.buildingKeys.length).sort(), [1, 2, 2]),
      "Retain the complete original shared-system building associations.");
    const correction = this.plan("building-name-correction", () => {
      const buildings = new Set(original.model.entities.filter(row => row.semanticKind === "building").map(row => row.key));
      const candidates = original.model.fields.filter(field => field.kind === "text" && field.editable &&
        field.name === "PremisesName" && buildings.has(field.entityKey) && field.value);
      need(candidates.length > 0, "Select the original building's actual editable PremisesName field.");
      const field = candidates[0];
      return { sourceId: shared.sourceId, revisionId: shared.revisionId, field,
        value: field.value + " - reviewed", note: "Review the original building name while preserving both complete XML revisions." };
    });
    const patched = await this.mutation("02-save-complete-source-correction", "source.patch", async () => {
      await this.openSource(shared.sourceId, shared.revisionId);
      await this.page.locator('[data-inspector="fields"]').click();
      await this.page.locator("#field-entity").selectOption(correction.field.entityKey);
      await this.page.locator("#field-query").fill(correction.field.name);
      const index = await this.page.locator("#fields-table tbody tr").evaluateAll((rows, field) =>
        rows.findIndex(row => row.cells[0]?.textContent === field.name && row.cells[3]?.textContent === field.value), correction.field);
      need(index >= 0, "The complete original field is absent from the actual inspector.");
      await this.page.locator("#fields-table tbody tr").nth(index).getByRole("button", { name: "Stage correction", exact: true }).click();
      need(await this.page.locator("#field-before").inputValue() === correction.field.value,
        "The browser correction must retain the exact original value.");
      await this.page.locator("#field-after").fill(correction.value);
      await this.page.locator("#field-form button[type=submit]").click(); await this.idle();
      await this.page.locator("#patch-note").fill(correction.note);
      await this.section("revisions");
      await this.page.reload({ waitUntil: "domcontentloaded" }); await this.connect();
      await this.openSource(shared.sourceId, shared.revisionId);
      await this.page.locator('[data-inspector="fields"]').click();
      need((await this.page.locator("#patches-table").textContent()).includes(correction.value) &&
        await this.page.locator("#patch-note").inputValue() === correction.note,
        "The original complete correction draft did not survive reload.");
      await this.checkpoint("original-correction-draft", {
        operation: OPERATION, workspaceId: this.input.workspaceId, sourceId: shared.sourceId,
        revisionId: shared.revisionId, fieldPath: correction.field.path, expected: correction.field.value,
        value: correction.value, note: correction.note, restoredAfterReload: true
      });
      await this.page.locator("#patch-form button[type=submit]").click();
    });
    const current = await this.read("source.get", { sourceId: patched.sourceId, revisionId: patched.revisionId });
    need(current.revision.parentId === shared.revisionId && current.revision.number === original.revision.number + 1 &&
      current.model.fields.some(field => field.path === correction.field.path && field.value === correction.value),
      "The saved native revision did not retain the complete original field correction.");
    await this.openSource(shared.sourceId, patched.revisionId);
    await this.section("revisions");
    await this.page.locator("#compare-before").selectOption(shared.revisionId);
    await this.page.locator("#compare-after").selectOption(patched.revisionId);
    await this.page.locator("#compare-form button[type=submit]").click(); await this.idle();
    const comparison = await this.read("source.compare", { sourceId: shared.sourceId,
      fromRevisionId: shared.revisionId, toRevisionId: patched.revisionId });
    need(comparison.changed.some(row => row.before.value === correction.field.value && row.after.value === correction.value),
      "The complete source comparison omitted the original correction.");
    await this.checkpoint("complete-original-comparison", comparison);
    await this.screenshot("source-revisions");

    const review = await this.mutation("03-source-bound-review-with-response-recovery", "review.save", async () => {
      await this.openSource(shared.sourceId, patched.revisionId);
      await this.section("reviews"); await this.page.locator("#new-review").click(); await this.idle();
      await this.page.locator("#review-title").fill("Retain the original shared-system building scope");
      await this.page.locator("#review-status").selectOption("investigating");
      await this.page.locator("#review-entity").selectOption(correction.field.entityKey);
      await this.page.locator("#review-assignee").fill(this.input.operator);
      await this.page.locator("#review-note").fill("Original heating serves Building2; original cooling and PV each serve both buildings.");
      await this.page.locator("#review-evidence").fill("");
      await this.page.locator("#review-form button[type=submit]").click();
    }, { interrupt: true });
    const reviewRecord = (await this.state()).reviews.find(row => row.id === review.reviewId);
    need(reviewRecord && reviewRecord.sourceId === shared.sourceId && reviewRecord.revisionId === patched.revisionId &&
      reviewRecord.entityKey === correction.field.entityKey, "Recovered review lost its exact original source binding.");
    await this.openSource(shared.sourceId, patched.revisionId);
    const edition = await this.mutation("04-save-original-reviewed-edition", "edition.save", async () => {
      await this.section("editions");
      await this.page.locator("#edition-name").fill("Original sources and shared-system review");
      await this.page.locator("#edition-note").fill("Retain this complete review state before analysis and consumer continuation.");
      await this.page.locator("#edition-form button[type=submit]").click();
    });
    const frozen = await this.read("edition.get", { editionId: edition.editionId });
    need(frozen.reviews.some(row => row.id === review.reviewId && row.note === reviewRecord.note),
      "The saved edition did not freeze the complete original review.");

    const selection = this.plan("native-turnover-selection", () => ({
      sourceId: shared.sourceId, revisionId: patched.revisionId,
      assetEntityKeys: current.model.entities.filter(row => ["building", "system"].includes(row.semanticKind)).map(row => row.key),
      documentEntityKeys: current.model.entities.filter(row => row.semanticKind === "root").map(row => row.key),
      requirementEntityKeys: []
    }));
    need(selection.assetEntityKeys.length === 5, "Retain the two buildings and all three physical systems.");
    const projection = await this.mutation("05-save-complete-eight-table-projection", "projection.save", async () => {
      await this.openSource(shared.sourceId, patched.revisionId); await this.section("projection");
      for (const [id, key] of [["projection-assets", "assetEntityKeys"], ["projection-documents", "documentEntityKeys"],
        ["projection-requirements", "requirementEntityKeys"]]) await this.page.locator("#" + id).selectOption(selection[key]);
      await this.page.locator("#projection-preview-form button[type=submit]").click(); await this.idle();
      need(await this.page.locator("#projection-tables article").count() === 8, "The actual operator view must show all eight original tables.");
      await this.page.locator("#projection-note").fill("Complete source-linked native audit turnover for the original consumer workspace.");
      await this.page.locator("#projection-save-form button[type=submit]").click();
    });

    const analysis = await this.mutation("06-run-original-readings-with-observed-weather", "analysis.run", async () => {
      await this.openSource(this.input.combined.sourceId, this.input.combined.revisionId);
      await this.section("analysis");
      need(await this.page.locator("#analysis-building").inputValue() === "",
        "Unassigned original readings need a deliberate native Building selection.");
      for (const [id, key] of [["analysis-building", "buildingKey"], ["analysis-scenario", "scenarioKey"],
        ["analysis-resource", "resourceKey"], ["analysis-reading-type", "readingType"], ["analysis-units", "units"],
        ["analysis-stream", "streamKey"]]) {
        const value = this.input.analysisSelection[key];
        if (value !== undefined) await this.page.locator("#" + id).selectOption(value);
      }
      await this.page.locator("#analysis-preview-form button[type=submit]").click(); await this.idle();
      need(await this.page.locator("#analysis-readings tbody tr").count() === 12 &&
        (await this.page.locator("#analysis-scope-hint").textContent()).includes("no recorded building association"),
        "Keep the complete actual twelve-reading stream and its explicit operator-selected building scope.");
      await this.page.locator("#weather-file").setInputFiles(this.input.weather.path); await this.idle();
      await this.page.locator("#weather-source").fill(this.input.weather.source);
      await this.page.locator("#model-options").fill(JSON.stringify(this.input.modelOptions, null, 2));
      need(await this.page.locator("#analysis-weather-units").inputValue() === this.input.modelOptions.weatherUnits &&
        await this.page.locator("#analysis-weather-interval").inputValue() === this.input.modelOptions.weatherInterval,
        "The complete native configuration and visible weather controls differ.");
      await this.page.locator("#analysis-note").fill("Use the complete original readings, explicit building/time selection and acquired observed weather.");
      await this.screenshot("original-analysis-input");
      await this.page.locator("#analysis-form button[type=submit]").click();
    });
    need(analysis.analysisId, "The original native run did not return its retained analysis identity.");
    const retainedAnalysis = (await this.state()).analysisRuns.find(row => row.id === analysis.analysisId);
    need(retainedAnalysis && retainedAnalysis.sourceId === this.input.combined.sourceId &&
      retainedAnalysis.revisionId === this.input.combined.revisionId && retainedAnalysis.readingCount === 12 &&
      same(retainedAnalysis.modelOptions, this.input.modelOptions), "The queued original native inputs changed.");
    const result = { format: FORMAT, operation: OPERATION, workspaceId: this.input.workspaceId, status: "passed",
      shared, patched, correction, comparison, review, reviewRecord, edition, projection, analysis,
      originalRequestRecovery: readJson(this.actionPath("03-source-bound-review-with-response-recovery", "second-tab-recovery.json")),
      originalWeather: { sha256: this.input.weather.sha256, bytes: this.input.weather.bytes, source: this.input.weather.source },
      views: ["views/source-revisions.png", "views/original-analysis-input.png"] };
    const existing = path.join(this.root, "result.json");
    if (fs.existsSync(existing)) {
      const originalResult = readJson(existing);
      need(same(originalResult, result), "Keep the original complete browser result.");
      return originalResult;
    }
    atomic(existing, bytes(result)); emit({ stage: "COMPLETE_ORIGINAL_BROWSER_JOURNEY", ...result }); return result;
  }
  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    const log = { format: FORMAT, operation: OPERATION, workspaceId: this.input.workspaceId,
      messages: this.messages, requests: this.requests };
    atomic(path.join(this.root, "logs", sha(bytes(log)) + ".json"), bytes(log));
  }
}

/**
 * Continue the same completed case through its final rendered product.
 * This uses read actions and existing retained-download controls only. The resulting
 * captures require direct producer viewing; they are not a visual approval.
 */
class RenderedJourney extends Journey {
  constructor(input) {
    super(input);
    this.captures = []; this.downloads = []; this.opened = [];
    this.sequence = 0; this.role = input.role;
    need(Number.isSafeInteger(input.controllerFD)&&input.controllerFD>=3,"Retain the original case controller descriptor.");
    const inherited=fs.fstatSync(input.controllerFD),original=fs.statSync(input.controllerLock);
    need(inherited.isFile()&&inherited.dev===original.dev&&inherited.ino===original.ino,
      "The rendered native readers must inherit this same original case lock.");
    need(["author", "recipient-one"].includes(this.role) && input.sourceSha256 && input.servedSourceSha256,
      "Bind final rendering to the original producer or received application source.");
  }
  async capture(label, page = this.page, subject = {}) {
    const basename = String(++this.sequence).padStart(4, "0") + "-" + label.replace(/[^a-zA-Z0-9_.-]/g, "-");
    const root = this.viewRoot || this.root;
    const view = page.viewportSize();
    const png = await page.screenshot({ fullPage: true, animations: "disabled", timeout: 120000 });
    const file = path.join(root, "views", basename + ".png"); atomic(file, png);
    const screen = await page.evaluate(() => ({
      title: document.title, url: location.href, viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      busy: document.body.getAttribute("aria-busy"),
      scrollableRegions: [...document.querySelectorAll(".table-wrap,pre,textarea,.navigation")].filter(el => {
        const box=el.getBoundingClientRect(); return box.width && box.height;
      }).map(el => ({tag:el.tagName,id:el.id,classes:el.className,clientWidth:el.clientWidth,
        scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}))
    }));
    const entry = {label, path:path.relative(root,file),bytes:png.length,sha256:sha(png),
      viewport:view,subject,screen,review:"awaiting-producer-view"};
    this.captures.push(entry); atomic(path.join(root,"screens",basename+".json"),bytes(entry));
    return entry;
  }
  async connect() {
    if (!this.initialConnectionCaptured) {
      this.initialConnectionCaptured = true;
      await this.capture("desktop-disconnected");
      await this.page.locator("#server-url").fill(this.connection.url);
      await this.page.locator("#workspace-pin").fill("deliberately-mismatched-original-workspace");
      await this.page.locator("#connect-form button[type=submit]").click(); await this.idle();
      need((await this.page.locator("#notice").textContent()).includes("AUDIT_WORKSPACE_CHANGED"),
        "The deliberate read-only wrong-workspace connection did not show its real error.");
      await this.capture("desktop-real-connection-error");
    }
    await super.connect();
  }
  async loading(width) {
    let arrived, release;
    const seen = new Promise(resolve => {arrived=resolve;});
    const gate = new Promise(resolve => {release=resolve;});
    const pattern = new URL("/api/state",this.connection.url).href;
    const handler = async route => {arrived();await gate;await route.continue();};
    await this.context.route(pattern,handler);
    try {
      await this.page.locator("#refresh").click();
      await timeout(seen,30000,"The actual workspace refresh did not reach its read request.");
      await this.page.waitForFunction(()=>document.body.getAttribute("aria-busy")==="true");
      await this.capture(width+"-actual-read-loading");
    } finally {release();await this.context.unroute(pattern,handler);}
    await this.idle();
  }
  async tableButton(container,label) {
    const target=this.page.locator(container);
    let pages=0;
    while(true){
      const button=target.getByRole("button",{name:label,exact:true});
      if(await button.count()){await button.first().click();await this.idle();return;}
      const next=target.getByRole("button",{name:"Next",exact:true});
      need(await next.count()&&await next.isEnabled(),"The actual retained row is missing: "+label);
      await next.click();await this.idle();need(++pages<10000,"The existing table paging did not advance.");
    }
  }
  async tableRowAt(container,index) {
    need(Number.isSafeInteger(index)&&index>=0,"Select one actual retained table row.");
    await this.firstTablePage(container);let offset=0;
    while(true){
      const rows=this.page.locator(container+" tbody tr"),count=await rows.count();
      if(index<offset+count)return rows.nth(index-offset);
      const next=this.page.locator(container).getByRole("button",{name:"Next",exact:true});
      need(count>0&&await next.count()&&await next.isEnabled(),"The exact original table row is missing.");
      offset+=count;await next.click();await this.idle();
    }
  }
  async firstTablePage(container) {
    const previous=this.page.locator(container).getByRole("button",{name:"Previous",exact:true});
    while(await previous.count()&&await previous.isEnabled()){await previous.click();await this.idle();}
  }
  async allTablePages(container,label,subject={}) {
    await this.firstTablePage(container);let index=0;
    while(true){
      await this.capture(label+"-page-"+(++index),this.page,subject);
      const next=this.page.locator(container).getByRole("button",{name:"Next",exact:true});
      if(!await next.count()||!await next.isEnabled())break;
      await next.click();await this.idle();need(index<10000,"The actual complete table did not finish.");
    }
    await this.firstTablePage(container);
  }
  async inspect(width,state) {
    await this.page.setViewportSize(width==="desktop"?{width:1440,height:1000}:{width:390,height:844});
    await this.section("overview");await this.capture(width+"-workspace");
    await this.loading(width);
    for(const source of state.sources){
      const detail=await this.read("source.get",{sourceId:source.id});
      await this.openSource(source.id,detail.revision.id);
      await this.page.locator('[data-inspector="entities"]').click();
      await this.page.locator("#entity-kind").selectOption("building");
      await this.capture(width+"-"+source.id+"-buildings",this.page,{sourceId:source.id,revisionId:detail.revision.id});
      const first=this.page.locator("#entities-table tbody button").first();
      if(await first.count()){await first.click();await this.idle();await this.capture(width+"-"+source.id+"-building-detail");}
      await this.page.locator("#entity-query").fill("no-native-entity-matches-this-explicit-filter");
      need(await this.page.locator("#entities-table .empty").isVisible(),"The real empty entity filter did not render.");
      await this.capture(width+"-"+source.id+"-empty-filter");
      await this.page.locator("#entity-query").fill("");await this.page.locator("#entity-kind").selectOption("");
      for(const panel of ["references","series","validation","xml"]){
        await this.page.locator('[data-inspector="'+panel+'"]').click();
        await this.capture(width+"-"+source.id+"-"+panel,this.page,{sourceId:source.id,revisionId:detail.revision.id});
      }
      await this.section("revisions");
      const before=detail.revisions[0],after=detail.revision;
      await this.page.locator("#compare-before").selectOption(before.id);
      await this.page.locator("#compare-after").selectOption(after.id);
      await this.page.locator("#compare-form button[type=submit]").click();await this.idle();
      await this.capture(width+"-"+source.id+"-comparison",this.page,{before:before.id,after:after.id});
      if(before.id!==after.id){
        await this.openSource(source.id,before.id);await this.capture(width+"-"+source.id+"-historical-revision");
        await this.page.locator("#open-current").click();await this.idle();
      }
    }
    await this.section("editions");
    for(const [editionIndex,edition] of state.editions.entries()){
      const row=await this.tableRowAt("#editions-table",editionIndex);
      await row.getByRole("button",{name:edition.number+" · "+edition.name,exact:true}).click();await this.idle();
      need((await this.page.locator("#edition-summary").textContent()).includes(edition.id),
        "Open the exact retained edition even when received copies share their original display name.");
      await this.page.locator("#edition-detail details").evaluate(el=>{el.open=true;});
      await this.page.locator("#edition-title").scrollIntoViewIfNeeded();
      await this.capture(width+"-edition-"+edition.id,this.page,{editionId:edition.id});
      const first=this.page.locator("#edition-sources tbody button").first();
      if(await first.count()){await first.click();await this.idle();await this.capture(width+"-edition-source-"+edition.id);await this.section("editions");}
    }
    await this.section("reviews");await this.page.locator("#review-filter").selectOption("accepted");
    await this.capture(width+"-accepted-reviews");
    await this.page.locator("#review-filter").selectOption("");
    await this.section("links");await this.capture(width+"-source-bound-related-work");
    need(await this.page.locator('[data-section="corrections"]').count(),
      "The final served source must include its complete colleague corrections controls.");
    await this.section("corrections");await this.capture(width+"-colleague-return-intake");
    await this.page.locator("#correction-file").focus();await this.page.keyboard.press("Tab");
    await this.capture(width+"-colleague-keyboard-navigation");
    await this.section("analysis");
    for(const run of state.analysisRuns){
      await this.firstTablePage("#analysis-runs-table");
      await this.tableButton("#analysis-runs-table",run.analysisId||run.id);
      await this.page.locator("#analysis-result").scrollIntoViewIfNeeded();
      await this.page.locator("#analysis-result details").evaluate(el=>{el.open=true;});
      await this.capture(width+"-native-"+(run.analysisId||run.id),this.page,
        {analysisId:run.analysisId||run.id,status:run.status,outputCount:(run.outputs||[]).length});
    }
    const shared=state.sources.find(source=>source.id===this.input.sharedSourceId);
    need(shared&&shared.originalSha256===this.input.sharedOriginalSha256&&
      shared.currentRevisionId===this.input.sharedRevisionId,
      "Keep the exact corrected shared-system source binding selected by the original receiving.");
    const sharedDetail=await this.read("source.get",{sourceId:shared.id,revisionId:this.input.sharedRevisionId});
    await this.openSource(shared.id,sharedDetail.revision.id);await this.section("projection");
    const entities=sharedDetail.model.entities;
    const assets=entities.filter(row=>["building","system"].includes(row.semanticKind)).map(row=>row.key);
    const documents=entities.filter(row=>row.semanticKind==="root").map(row=>row.key);
    need(assets.length===5&&documents.length===1,"Keep both actual buildings and all three original physical systems.");
    await this.page.locator("#projection-assets").selectOption(assets);
    await this.page.locator("#projection-documents").selectOption(documents);
    await this.page.locator("#projection-requirements").selectOption([]);
    await this.page.locator("#projection-preview-form button[type=submit]").click();await this.idle();
    const tables=this.page.locator("#projection-tables > article");need(await tables.count()===8,"Open all eight complete native tables.");
    for(let index=0;index<8;index++){
      const article=tables.nth(index),name=await article.locator("h4").textContent();
      await article.scrollIntoViewIfNeeded();
      await this.allTablePages('#projection-tables > article:nth-child('+(index+1)+')',"turnover-"+width+"-"+name,
        {sourceId:shared.id,revisionId:sharedDetail.revision.id,table:name});
    }
    await this.section("exports");
    for(const kind of ["xml","review","workspace","application"]){
      await this.page.locator("#export-kind").selectOption(kind);
      if(kind!=="xml"&&state.editions.length)await this.page.locator("#export-edition").selectOption(state.editions.at(-1).id);
      await this.capture(width+"-existing-exports-"+kind);
    }
    // Reload the actual installed application, reopening the same retained workspace.
    await this.page.reload({waitUntil:"domcontentloaded"});await this.idle();await super.connect();
    await this.section("overview");await this.capture(width+"-reopened-workspace");
  }
  async downloadExisting(record) {
    await this.section("exports");await this.firstTablePage("#exports-table");
    const index=this.renderState.exports.findIndex(item=>item.id===record.id);
    need(index>=0,"Keep the exact retained export identifier.");
    const row=await this.tableRowAt("#exports-table",index);
    need((await row.textContent()).includes(record.sha256)&&
      await row.getByRole("button",{name:record.name,exact:true}).count(),
      "The selected original export row changed.");
    const arriving=this.page.waitForEvent("download",{timeout:120000});
    await row.getByRole("button",{name:record.name,exact:true}).click();
    const download=await arriving,failed=await download.failure();need(!failed,"The real operator download failed: "+failed);
    const temporary=await download.path();need(temporary,"The real downloaded bytes were not retained.");
    const body=fs.readFileSync(temporary);
    need(body.length===record.bytes&&sha(body)===record.sha256,"The operator download differs from its complete retained export: "+record.id);
    const file=path.join(this.root,"downloads",record.id,path.basename(download.suggestedFilename()));
    atomic(file,body);await this.idle();
    const retained={...record,path:file,suggestedFilename:download.suggestedFilename()};
    this.downloads.push(retained);atomic(path.join(this.root,"downloads",record.id,"record.json"),bytes(retained));
    return retained;
  }
  async artifactPage(label,raw,contentType,subject) {
    const origin="https://retained-audit-artifact.invalid/"+crypto.randomUUID();
    const page=await this.context.newPage();
    await page.route("**/*",async route=>{
      if(route.request().url()===origin)await route.fulfill({status:200,body:raw,contentType,
        headers:{"Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'"}});
      else await route.abort("blockedbyclient");
    });
    try{
      await page.goto(origin,{waitUntil:"load"});
      for(const width of ["desktop","narrow"]){
        await page.setViewportSize(width==="desktop"?{width:1440,height:1000}:{width:390,height:844});
        if(await page.locator("#artifact-first").count()&&await page.locator("#artifact-first").isEnabled())await page.locator("#artifact-first").click();
        let index=0;
        while(true){
          await this.capture("attachment-"+label+"-"+width+"-"+(++index),page,subject);
          const next=page.locator("#artifact-next");
          if(!await next.count()||!await next.isEnabled())break;
          await next.click();need(index<10000,"The complete attachment table did not finish.");
        }
      }
    }finally{await page.close();}
  }
  async openArtifact(record,body=fs.readFileSync(record.path),depth=0) {
    need(depth<=3,"Keep recursive package viewing within its actual delivered closure.");
    const extension=path.extname(record.name).toLowerCase(),label=record.id+"-"+path.basename(record.name);
    const opened={id:record.id,name:record.name,bytes:body.length,sha256:sha(body),method:null,capturesStart:this.captures.length};
    need(sha(body)===record.sha256&&body.length===record.bytes,"Open the complete original retained artifact.");
    if(extension===".zip"){
      const folder=path.join(this.root,"opened",record.id);fs.mkdirSync(folder,{recursive:true});
      const script=String.raw`
import hashlib,importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location("audit_original_course",sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
raw=pathlib.Path(sys.argv[2]).read_bytes()
manifest,members=module.package(raw)
root=pathlib.Path(sys.argv[3])
rows=[]
for name,body in members.items():
 row={"name":name,"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest()}
 if name.startswith("registers/") and name.endswith(".csv") or name.endswith(".html"):
  target=root/module.safe_name(name);module.atomic(target,body);row["path"]=str(target)
 rows.append(row)
result={"manifest":manifest,"members":rows}
module.atomic(root/"opened-package.json",module.raw_json(result))
print(module.canonical(result))
`;
      const observation=runNative(this.input.pythonExecutable,[ "-c",script,this.input.pythonCourse,record.path,folder],folder,"open-package",this.input.controllerFD);
      const index=JSON.parse(observation.stdout);opened.method="complete-native-package-inventory-and-received-application";
      opened.packageIndex=path.relative(this.root,path.join(folder,"opened-package.json"));
      await this.artifactPage(label,artifactHtml(record.name,index,"json"),"text/html",record);
      for(const [i,member] of index.members.entries())if(member.path)
        await this.openArtifact({...member,id:record.id+"-member-"+i},fs.readFileSync(member.path),depth+1);
    }else if(extension===".pdf"){
      const folder=path.join(this.root,"opened",record.id);fs.mkdirSync(folder,{recursive:true});
      const command=process.env.AUDIT_PDF_RENDERER||"pdftoppm";
      runNative(command,["-r","100","-png",record.path,path.join(folder,"page")],folder,"render-pdf",this.input.controllerFD);
      const pages=fs.readdirSync(folder).filter(name=>/^page-\d+\.png$/.test(name)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
      need(pages.length,"The original PDF did not render any pages.");opened.method="complete-original-pdf-pages";opened.pages=pages;
      for(const name of pages){
        const image=fs.readFileSync(path.join(folder,name));
        const html=artifactShell(record.name+" · "+name,'<img alt="Rendered original PDF page" style="max-width:100%;height:auto" src="data:image/png;base64,'+image.toString("base64")+'">');
        await this.artifactPage(label+"-"+name,Buffer.from(html),"text/html",{...record,page:name});
      }
    }else if(extension===".rds"){
      const folder=path.join(this.root,"opened",record.id);fs.mkdirSync(folder,{recursive:true});
      const r=process.env.AUDIT_RSCRIPT||"Rscript";
      const code='x <- readRDS(commandArgs(TRUE)[1]); cat("Class:", paste(class(x), collapse=", "), "\\n"); cat("Dimensions:", paste(dim(x), collapse=" x "), "\\n"); str(x, max.level=3, list.len=100, give.attr=TRUE)';
      const result=runNative(r,["--vanilla","-e",code,record.path],folder,"open-original-r-object",this.input.controllerFD);
      opened.method="native-R-readRDS";opened.nativeOutcome=path.relative(this.root,result.outcomePath);
      await this.artifactPage(label,artifactHtml(record.name,result.stdout,"text"),"text/html",record);
    }else if(extension===".html"||extension===".htm"){
      opened.method="original-HTML-bytes";await this.artifactPage(label,body,"text/html",record);
    }else if(extension===".csv"){
      const rows=parseCsv(body.toString("utf8").replace(/^\uFEFF/,""));opened.method="complete-CSV-table";opened.rows=Math.max(0,rows.length-1);
      await this.artifactPage(label,artifactHtml(record.name,rows,"csv"),"text/html",record);
    }else if([".png",".jpg",".jpeg",".webp",".svg"].includes(extension)){
      const mime=extension===".svg"?"image/svg+xml":extension===".jpg"?"image/jpeg":"image/"+extension.slice(1);
      opened.method="original-image";await this.artifactPage(label,body,mime,record);
    }else{
      const text=new TextDecoder("utf-8",{fatal:true}).decode(body);
      const value=extension===".json"?JSON.parse(text):text;opened.method=extension===".json"?"complete-JSON":"complete-original-text";
      await this.artifactPage(label,artifactHtml(record.name,value,extension===".json"?"json":"text"),"text/html",record);
    }
    opened.capturesEnd=this.captures.length;
    this.opened.push(opened);atomic(path.join(this.root,"opened",record.id,"opened.json"),bytes(opened));
    emit({stage:"ORIGINAL_ATTACHMENT_OPENED",role:this.role,id:record.id,name:record.name,method:opened.method,sha256:record.sha256});
  }
  async run() {
    await this.start();const state=await this.state();
    need(state.workspaceId===this.input.workspaceId&&state.version===this.input.version,
      "Retain the selected final workspace state before rendering.");
    atomic(path.join(this.root,"workspace-state.json"),bytes(state));
    this.renderState=state;
    for(const width of ["desktop","narrow"])await this.inspect(width,state);
    await this.page.setViewportSize({width:1440,height:1000});
    for(const record of this.input.exports){
      const retained=state.exports.find(row=>row.id===record.id);
      need(retained&&retained.sha256===record.sha256&&retained.bytes===record.bytes,
        "A final selected retained export changed before opening.");
      await this.openArtifact(await this.downloadExisting(retained));
    }
    const after=await this.state();
    need(after.version===state.version,"The final rendered continuation must preserve the original business version.");
    const result={format:"commons.audit-exchange.rendered-capture.v1",operation:OPERATION,
      role:this.role,workspaceId:state.workspaceId,version:state.version,
      sourceSha256:this.input.sourceSha256,servedSourceSha256:this.input.servedSourceSha256,
      status:"captured-awaiting-producer-view",captures:this.captures,downloads:this.downloads,opened:this.opened,
      instructions:"Open every listed screen and outgoing attachment, operate the retained application, inspect desktop and narrow layout, and repair defects before calling this exact version ready."};
    atomic(path.join(this.root,"rendered-capture.json"),bytes(result));
    const links=this.captures.map(row=>'<li><a href="'+escapeHtml(row.path)+'">'+escapeHtml(row.label)+'</a> · '+escapeHtml(JSON.stringify(row.subject))+'</li>').join("");
    const artifacts=this.downloads.map(row=>'<li><a href="'+escapeHtml(path.relative(this.root,row.path))+'">'+escapeHtml(row.name)+'</a> · '+escapeHtml(row.sha256)+'</li>').join("");
    atomic(path.join(this.root,"OPEN.html"),Buffer.from(artifactShell("Audit Exchange · "+this.role+" · direct viewing",
      "<h2>Captured; producer viewing remains required</h2><p>"+escapeHtml(result.instructions)+"</p><p>Workspace "+escapeHtml(state.workspaceId)+" · version "+state.version+"</p><h2>Actual outgoing files</h2><ul>"+artifacts+"</ul><h2>Actual rendered screens</h2><ol>"+links+"</ol>")));
    emit({stage:"ORIGINAL_RENDERED_CASE_CAPTURED",role:this.role,workspaceId:state.workspaceId,
      directory:this.root,captures:this.captures.length,opened:this.opened.length,review:result.status});
    return result;
  }
}
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
function artifactShell(title,body){
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(title)+'</title><style>body{font:15px/1.5 Arial,sans-serif;color:#202226;background:#fff;margin:0;padding:24px}h1{font-size:22px;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #bfc3c7;padding:16px;max-height:80vh;overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #c7cace;padding:8px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}.table{overflow:auto}button{font:inherit;background:white;border:1px solid #777;padding:8px 12px;margin:8px 8px 8px 0}a{color:inherit}@media(max-width:600px){body{padding:12px}}</style><h1>'+escapeHtml(title)+'</h1>'+body+'</html>';
}
function artifactHtml(title,value,kind){
  if(kind!=="csv")return Buffer.from(artifactShell(title,"<pre>"+escapeHtml(kind==="json"?JSON.stringify(value,null,2):value)+"</pre>"));
  const data=JSON.stringify(value).replace(/</g,"\\u003c"),script=String.raw`
const rows=DATA,head=rows[0]||[];let page=0;const size=100;
function render(){const start=page*size,items=rows.slice(1+start,1+start+size),table=document.querySelector("table");table.replaceChildren();
 const tr=document.createElement("tr");for(const value of head){const th=document.createElement("th");th.textContent=value;tr.append(th);}table.append(tr);
 for(const row of items){const line=document.createElement("tr");for(const value of row){const td=document.createElement("td");td.textContent=value;line.append(td);}table.append(line);}
 document.querySelector("#range").textContent=(rows.length-1)+" complete data rows; showing "+(items.length?start+1:0)+"–"+(start+items.length);
 document.querySelector("#artifact-first").disabled=page===0;document.querySelector("#artifact-previous").disabled=page===0;document.querySelector("#artifact-next").disabled=start+items.length>=rows.length-1;}
document.querySelector("#artifact-first").onclick=()=>{page=0;render();};document.querySelector("#artifact-previous").onclick=()=>{page--;render();};document.querySelector("#artifact-next").onclick=()=>{page++;render();};render();
`;
  return Buffer.from(artifactShell(title,'<p id="range"></p><button id="artifact-first">First</button><button id="artifact-previous">Previous</button><button id="artifact-next">Next</button><div class="table"><table></table></div><script>'+script.replace("DATA",data)+'</script>'));
}
function parseCsv(text){
  const rows=[];let row=[],cell="",quoted=false,afterQuote=false;
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(quoted){if(char==='"'){if(text[index+1]==='"'){cell+='"';index++;}else{quoted=false;afterQuote=true;}}else cell+=char;}
    else if(char==='"'&&cell===""&&!afterQuote)quoted=true;
    else if(char===","){row.push(cell);cell="";afterQuote=false;}
    else if(char==="\r"||char==="\n"){if(char==="\r"&&text[index+1]==="\n")index++;row.push(cell);rows.push(row);row=[];cell="";afterQuote=false;}
    else{need(!afterQuote,"The original CSV has content after a closed quoted field.");cell+=char;}
  }
  need(!quoted,"The original CSV contains an unfinished quoted field.");
  if(cell!==""||row.length||afterQuote){row.push(cell);rows.push(row);}
  return rows;
}
function runNative(command,args,directory,label,controllerFD){
  const stdio=Array.from({length:controllerFD+1},()=> "ignore");stdio[1]="pipe";stdio[2]="pipe";stdio[controllerFD]=controllerFD;
  const result=spawnSync(command,args,{cwd:directory,encoding:"utf8",stdio,maxBuffer:128*1024*1024,timeout:600000});
  const outcome={command,args,status:result.status,signal:result.signal,error:result.error?.message||null,
    stdout:result.stdout||"",stderr:result.stderr||""};
  const target=path.join(directory,label+"-outcome.json");atomic(target,bytes(outcome));
  need(result.status===0&&!result.error,"Open the complete actual artifact with its installed native reader: "+target);
  return {...outcome,outcomePath:target};
}


class ReturnJourney extends Journey {
  constructor(input){
    const {captureDirectory,sourceSha256,servedSourceSha256,controllerFD,controllerLock,version,...original}=input;
    super(original);this.input=input;this.role="author";this.viewRoot=path.resolve(captureDirectory);
    this.captures=[];this.sequence=0;
    need(Number.isSafeInteger(controllerFD)&&controllerFD>=3,"Keep the original colleague-return controller descriptor.");
    const inherited=fs.fstatSync(controllerFD),lock=fs.statSync(controllerLock);
    need(inherited.isFile()&&inherited.dev===lock.dev&&inherited.ino===lock.ino,"Continue this same original case lock.");
    const archive=fs.readFileSync(input.returnedArchive.path);
    need(archive.length===input.returnedArchive.bytes&&sha(archive)===input.returnedArchive.sha256,
      "Choose the complete retained colleague project.");
  }
  async capture(label,subject={}){
    return await RenderedJourney.prototype.capture.call(this,label,this.page,subject);
  }
  async both(label,subject={}){
    for(const [width,viewport] of [["desktop",{width:1440,height:1000}],["narrow",{width:390,height:844}]]){
      await this.page.setViewportSize(viewport);await this.capture(width+"-"+label,subject);
    }
    await this.page.setViewportSize({width:1440,height:1000});
  }
  async openSelectedSource(preview){
    const row=preview.sources.find(item=>item.sourceId===this.input.original.sourceId&&item.returnedSourceId===this.input.colleague.sourceId);
    need(row&&row.baseline.id===this.input.original.baselineRevisionId&&
      row.current.id===this.input.original.revisionId&&row.returned.id===this.input.colleague.revisionId,
      "The native three-way comparison must retain the deliberately selected original revisions.");
    await this.page.locator("#correction-sources").getByRole("button",{name:row.name,exact:true}).click();await this.idle();
    return row;
  }
  async run(){
    const existing=path.join(this.root,"result.json");
    if(fs.existsSync(existing)){
      const saved=readJson(existing),record=readJson(this.actionPath("07-reviewed-colleague-return","request.json"));
      const observed=await this.receipt(record.envelope);
      need(observed&&same(observed.result,saved.applied),"The complete original colleague application result changed.");
      emit({stage:"ORIGINAL_COLLEAGUE_EXCHANGE_REUSED",workspaceId:this.input.workspaceId,result:saved});return saved;
    }
    await this.start();
    const applied=await this.mutation("07-reviewed-colleague-return","return.apply",async()=>{
      const observed=await this.state();need(observed.version===this.input.version,"Review the selected original workspace version.");
      await this.section("corrections");await this.both("colleague-return-intake");
      await this.page.locator("#correction-file").setInputFiles(this.input.returnedArchive.path);await this.idle();
      const raw=fs.readFileSync(this.input.returnedArchive.path);
      const preview=await this.read("return.preview",{contentBase64:raw.toString("base64"),name:path.basename(this.input.returnedArchive.path)});
      const row=await this.openSelectedSource(preview);
      need(row.structuralSummary.compatible&&row.changedFields.length===2,
        "Keep the two explicit author/colleague native scalar corrections in the same original structure.");
      await this.page.locator("#correction-sources").getByRole("checkbox",{name:"Include "+row.name,exact:true}).check();await this.idle();
      await this.page.locator("#correction-baseline select").selectOption(row.baseline.id);await this.idle();
      await this.page.locator("#correction-mode select").selectOption("fields");await this.idle();
      for(const field of row.changedFields){
        const returned=field.path===this.input.colleague.field.path&&field.kind===this.input.colleague.field.kind;
        const original=field.path===this.input.original.field.path&&field.kind===this.input.original.field.kind;
        need(returned!==original,"Choose the two deliberately retained original source fields.");
        need(returned?field.status==="returned-change":field.status==="author-change",
          "The real three-way field classification differs from the original native edits.");
        await this.page.getByRole("combobox",{name:"Decision for "+field.path,exact:true}).selectOption(returned?"returned":"current");
        await this.idle();
      }
      const review=row.reviews.find(item=>item.id===this.input.colleague.reviewId);
      need(review&&review.entityKey===this.input.colleague.reviewEntityKey,"Keep the actual shared cooling review binding.");
      await this.page.locator("#correction-reviews").getByRole("checkbox",{name:"Receive "+review.title,exact:true}).check();await this.idle();
      await this.page.locator("#correction-source-note").fill("Preserve the author's second-building name; accept the colleague's first-building name and original shared-cooling review.");
      await this.page.locator("#correction-source-note").dispatchEvent("change");await this.idle();
      await this.both("explicit-three-way-decisions",{sourceId:row.sourceId,returnedSourceId:row.returnedSourceId,baselineRevisionId:row.baseline.id});
      const arriving=this.page.waitForEvent("download",{timeout:120000});
      await this.page.locator("#correction-save-draft").click();const download=await arriving;
      need(!await download.failure(),"Download the full retained correction review.");
      const draftBody=fs.readFileSync(await download.path()),draft=JSON.parse(draftBody.toString("utf8"));
      need(draft.workspaceId===this.input.workspaceId&&draft.selections.length===1&&
        draft.selections[0].decisions.length===2&&draft.selections[0].reviewIds[0]===review.id&&
        sha(Buffer.from(draft.contentBase64,"base64"))===this.input.returnedArchive.sha256,
        "The downloaded correction review must contain its complete archive and explicit decisions.");
      atomic(path.join(this.root,"downloaded-review",sha(draftBody)+".json"),draftBody);await this.idle();
      await this.page.reload({waitUntil:"domcontentloaded"});await this.idle();await this.connect();await this.section("corrections");
      await this.openSelectedSource(preview);
      for(const field of row.changedFields){
        const expected=field.path===this.input.colleague.field.path?"returned":"current";
        need(await this.page.getByRole("combobox",{name:"Decision for "+field.path,exact:true}).inputValue()===expected,
          "Reopening the same tab must retain each original field decision.");
      }
      need(await this.page.locator("#correction-reviews").getByRole("checkbox",{name:"Receive "+review.title,exact:true}).isChecked(),
        "The original returned review selection was lost on reopen.");
      await this.page.locator("#correction-prepare").click();await this.idle();
      const plan=JSON.parse(await this.page.locator("#correction-plan > details pre").textContent());
      need(plan.sources.length===1&&plan.sources[0].reviewCount===1&&plan.sources[0].result.changed,
        "The native complete correction plan must join both edits and the actual returned review.");
      await this.page.locator("#correction-plan article details").first().evaluate(el=>{el.open=true;});
      await this.both("complete-native-correction-plan",{planSha256:plan.planSha256});
      await this.page.locator("#correction-accept-diagnostics").check();
      await this.page.locator("#correction-apply").click();
    });
    need(applied.sources.length===1&&applied.sources[0].sourceId===this.input.original.sourceId&&
      applied.sources[0].changed&&applied.sources[0].reviewIds.length===1&&applied.edition?.editionId,
      "Save the reviewed native edits and selected returned review together in the original author workspace.");
    const detail=await this.read("source.get",{sourceId:applied.sources[0].sourceId,revisionId:applied.sources[0].revisionId});
    for(const selected of [this.input.original.field,this.input.colleague.field]){
      const actual=detail.model.fields.find(item=>item.path===selected.path&&item.kind===selected.kind&&
        (item.attributeName??null)===(selected.attributeName??null));
      need(actual&&actual.value===selected.value,"The applied complete XML lost one deliberately selected original correction.");
    }
    const state=await this.state(),review=state.reviews.find(item=>item.id===applied.sources[0].reviewIds[0]);
    need(review&&review.original?.returnedReview?.id===this.input.colleague.reviewId&&
      review.revisionId===detail.revision.id,"The accepted review must retain its full original colleague record and new local source binding.");
    await this.section("corrections");await this.both("saved-colleague-return",{revisionId:detail.revision.id,editionId:applied.edition.editionId});
    const result={format:"commons.audit-exchange.colleague-exchange.v1",operation:OPERATION,status:"passed",
      workspaceId:this.input.workspaceId,applied,source:detail.source,revision:detail.revision,
      review,archive:this.input.returnedArchive,captureDirectory:this.viewRoot,captures:this.captures,
      visualStatus:"captured-awaiting-producer-view"};
    const links=this.captures.map(row=>'<li><a href="'+escapeHtml(row.path)+'">'+escapeHtml(row.label)+'</a></li>').join("");
    atomic(path.join(this.viewRoot,"OPEN.html"),Buffer.from(artifactShell("Actual colleague-return workflow",
      "<p>Open and directly inspect these actual desktop and narrow screens before readiness.</p><ol>"+links+"</ol>")));
    atomic(existing,bytes(result));emit({stage:"ORIGINAL_COMPLETE_COLLEAGUE_EXCHANGE",workspaceId:this.input.workspaceId,applied});
    return result;
  }
}

const argv = process.argv.slice(2);
need(argv.length === 2 && ["--input", "--render", "--return"].includes(argv[0]),
  "Usage: node BROWSER_COMMISSIONING.mjs --input ORIGINAL_INPUT.json | --return SAME_CASE_RETURN_INPUT.json | --render SAME_CASE_RENDERED_INPUT.json");
let journey;
try {
  const input = readJson(path.resolve(argv[1]));
  need(input.format === (argv[0] === "--render" ? "commons.audit-exchange.rendered-input.v1" : argv[0] === "--return" ? "commons.audit-exchange.colleague-browser-input.v1" : "commons.audit-exchange.browser-input.v1"),
    "Use the selected original business or final rendered continuation input.");
  journey = argv[0] === "--render" ? new RenderedJourney(input) : argv[0] === "--return" ? new ReturnJourney(input) : new Journey(input);
  await journey.run();
} catch (error) {
  const failure = { format: FORMAT, operation: OPERATION, at: now(), error: error.message, stack: error.stack };
  if (journey) atomic(path.join(journey.root, "failures", sha(bytes(failure)) + ".json"), bytes(failure));
  emit({ stage: "ORIGINAL_BROWSER_CONTINUES", ...failure }); process.exitCode = 1;
} finally {
  if (journey) {
    try { await journey.close(); }
    catch (error) { emit({ stage: "ORIGINAL_BROWSER_CLOSE_CONTINUES", error: error.message }); process.exitCode = 1; }
  }
}
