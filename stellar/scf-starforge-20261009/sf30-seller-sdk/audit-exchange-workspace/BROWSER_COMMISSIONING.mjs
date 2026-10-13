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
    need(input.format === "commons.audit-exchange.browser-input.v1" && input.operation === OPERATION,
      "Use the original complete browser commissioning input.");
    need(input.workspaceId && input.instanceId && input.operator, "Keep the actual workspace, listener and operator identities.");
    this.root = path.resolve(input.directory);
    fs.mkdirSync(this.root, { recursive: true });
    const { url, instanceId, ...stable } = input;
    atomic(path.join(this.root, "original-input.json"), bytes(stable));
    this.connection = { url: new URL(url).href, workspaceId: input.workspaceId, instanceId };
    atomic(path.join(this.root, "connections", sha(bytes(this.connection)) + ".json"), bytes(this.connection));
    for (const [name, file] of [["shared", input.sharedFixture], ["weather", input.weather]]) {
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
const argv = process.argv.slice(2);
need(argv.length === 2 && argv[0] === "--input", "Usage: node BROWSER_COMMISSIONING.mjs --input ORIGINAL_INPUT.json");
let journey;
try {
  journey = new Journey(readJson(path.resolve(argv[1])));
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
