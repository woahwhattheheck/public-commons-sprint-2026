#!/usr/bin/env node
// MIT. Operate the complete retained FHIR workbench through its rendered browser UI.
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {createInterface} from "node:readline";
import {access, chmod, mkdir, open, readFile, rename, unlink} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {once} from "node:events";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = "stellar-forge.fhir-bulk-browser-receiving.v1";
const OPERATION = "SCF-FHIR-BULK-DATA-WORKBENCH-450E-20261012";
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!["--receiving", "--out", "--source", "--python", "--chromium", "--credentials-file"].includes(key) || !value || value.startsWith("--")) {
    throw new Error("Usage: node operate_browser.mjs --receiving OPERATED_FHIR_BULK.json --out ORIGINAL_BROWSER_OUTPUT [--source FHIR_BULK_DIRECTORY] [--python PYTHON] [--chromium EXECUTABLE] [--credentials-file FILE]");
  }
  if (key in args) throw new Error("Repeated option: " + key);
  args[key] = value;
}
if (!args["--receiving"] || !args["--out"]) throw new Error("--receiving and --out are required.");
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Use the original SDK's Node 22 or newer runtime.");
const output = resolve(args["--out"]), source = resolve(args["--source"] || HERE), receivingPath = resolve(args["--receiving"]);
const python = args["--python"] || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || "python3";
const sha = value => createHash("sha256").update(value).digest("hex");
const serialize = value => JSON.stringify(value, null, 2) + "\n";
const receivingBytes = await readFile(receivingPath);
const receiving = JSON.parse(receivingBytes.toString("utf8"));
for (const key of ["workspace", "connectionId", "baseSourceId", "planId"]) if (typeof receiving[key] !== "string" || !receiving[key]) throw new Error("The original native receiving result needs " + key);
if (!Array.isArray(receiving.operationIds) || !receiving.operationIds.length || !Array.isArray(receiving.buildIds)) throw new Error("The original native export/build identities are required.");
const workspace = resolve(receiving.workspace);
await access(join(source, "fhir_server.py"));
await mkdir(output, {recursive: true, mode: 0o700});
await chmod(output, 0o700);

async function atomicJSON(path, value) {
  const temporary = path + ".receiving-" + process.pid;
  const file = await open(temporary, "w", 0o600);
  try {await file.writeFile(serialize(value), "utf8"); await file.sync();} finally {await file.close();}
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {await directory.sync();} finally {await directory.close();}
}
async function fileIdentity(path) {
  const value = await readFile(path);
  return {file: path, bytes: value.length, sha256: sha(value)};
}
async function loadJSON(path, fallback = null) {
  try {return JSON.parse(await readFile(path, "utf8"));}
  catch (error) {if (error.code === "ENOENT") return fallback; throw error;}
}
const lockPath = join(output, "browser-owner.json");
try {
  const lock = await open(lockPath, "wx", 0o600);
  await lock.writeFile(serialize({pid: process.pid, operation: OPERATION, startedAt: new Date().toISOString()})); await lock.sync(); await lock.close();
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const owner = await loadJSON(lockPath);
  let live = true;
  try {process.kill(owner.pid, 0);} catch (probe) {if (probe.code === "ESRCH") live = false; else throw probe;}
  if (live) throw new Error("The original browser output is owned by active process " + owner.pid);
  await rename(lockPath, lockPath + ".ended-" + owner.pid + "-" + Date.now());
  const lock = await open(lockPath, "wx", 0o600);
  await lock.writeFile(serialize({pid: process.pid, operation: OPERATION, startedAt: new Date().toISOString(), resumedFrom: owner.pid})); await lock.sync(); await lock.close();
}
const journalPath = join(output, "BROWSER_JOURNEY.json");
let journal = await loadJSON(journalPath, {schema: SCHEMA, operation: OPERATION, receivingSha256: sha(receivingBytes), source, workspace, startedAt: new Date().toISOString(), phases: [], ports: {}, artifacts: [], errors: []});
if (journal.schema !== SCHEMA || journal.receivingSha256 !== sha(receivingBytes) || journal.workspace !== workspace || journal.source !== source) throw new Error("The output belongs to a different original source or native receiving operation.");
const pageErrors = [], servers = [];
let browserContext = null, currentPage = null;
async function checkpoint() {journal.updatedAt = new Date().toISOString(); await atomicJSON(journalPath, journal);}
async function phase(name, callback) {
  const previous = journal.phases.find(item => item.name === name && item.state === "complete");
  if (previous) return previous.result;
  let entry = journal.phases.find(item => item.name === name);
  if (!entry) {entry = {name, state: "running", startedAt: new Date().toISOString()}; journal.phases.push(entry);}
  else {entry.state = "running"; entry.resumedAt = new Date().toISOString();}
  await checkpoint();
  process.stdout.write(JSON.stringify({operation: OPERATION, phase: name, state: "running"}) + "\n");
  try {
    const result = await callback();
    entry.result = result; entry.sourceFiles = journal.sourceFiles; entry.state = "complete"; entry.completedAt = new Date().toISOString(); delete entry.error;
    await checkpoint();
    process.stdout.write(JSON.stringify({operation: OPERATION, phase: name, state: "complete"}) + "\n");
    return result;
  } catch (error) {
    entry.state = "interrupted"; entry.error = error.message; entry.interruptedAt = new Date().toISOString();
    await checkpoint(); throw error;
  }
}
async function loadPlaywright() {
  try {return await import("playwright");}
  catch (original) {
    const root = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (!root) throw original;
    return createRequire(import.meta.url)(join(root, "playwright"));
  }
}
async function startServer(name, directory) {
  const argv = ["-B", join(source, "fhir_server.py"), "--workspace", directory, "--port", String(journal.ports[name] || 0)];
  if (args["--credentials-file"]) argv.push("--credentials-file", resolve(args["--credentials-file"]));
  const child = spawn(python, argv, {cwd: source, env: {...process.env, PYTHONDONTWRITEBYTECODE: "1"}, stdio: ["ignore", "pipe", "pipe"]});
  let errors = "", announced = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", value => {errors = (errors + value).slice(-65536);});
  const lines = createInterface({input: child.stdout});
  let result;
  try {result = await new Promise((resolvePromise, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); error ? reject(error) : resolvePromise(value);
    };
    const timeout = setTimeout(() => finish(new Error("The original FHIR server did not open its workspace within 120 seconds.")), 120000);
    child.once("error", error => finish(error));
    child.once("exit", (code, signal) => {if (!announced) finish(new Error("Original FHIR server exited before startup: " + code + " " + (signal || "") + "\n" + errors));});
    lines.on("line", line => {
      if (announced) return;
      try {
        const value = JSON.parse(line);
        if (!value.url) return;
        const link = new URL(value.url);
        if (link.hostname !== "127.0.0.1" || !link.hash) throw new Error("The native server did not provide its private loopback link.");
        announced = true; finish(null, {child, lines, name, directory, url: value.url, origin: link.origin, token: link.hash.slice(1)});
      } catch (error) {finish(error);}
    });
  });} catch (error) {
    lines.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit").catch(() => {});
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 15000);
      try {await exited;} finally {clearTimeout(force);}
    }
    throw error;
  }
  servers.push(result);
  journal.ports[name] = Number(new URL(result.origin).port || "80");
  await checkpoint(); return result;
}
async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const exited = once(server.child, "exit");
  server.child.kill("SIGINT");
  const timer = setTimeout(() => server.child.kill("SIGKILL"), 15000);
  try {await exited;} finally {clearTimeout(timer); server.lines.close();}
}
async function nativeRead(server, path) {
  const response = await fetch(server.origin + path, {headers: {Authorization: "Bearer " + server.token}, redirect: "error"});
  const result = await response.json();
  if (!response.ok) throw new Error("Native read " + path.split("?")[0] + ": " + (result.error || response.status));
  return result;
}
function watchPage(page) {
  page.on("pageerror", error => pageErrors.push({at: new Date().toISOString(), message: error.message}));
}
async function ready(page) {
  await page.waitForFunction(() => {
    const content = document.querySelector("#content"), status = document.querySelector("#connection-state");
    return content?.getAttribute("aria-busy") === "false" && ["Private workspace connected", "Workspace needs attention"].includes(status?.textContent);
  }, null, {timeout: 180000});
  const alert = page.locator("#notice[role=alert]:visible");
  if (await alert.count()) throw new Error(await alert.innerText());
}
async function navigate(page, section) {
  await page.locator('[data-section="' + section + '"]').click();
  await ready(page);
}
async function choose(page, key, value) {
  await page.locator('[data-field="' + key + '"]').selectOption(String(value));
  await ready(page);
}
async function openDetails(page, title) {
  const disclosure = page.locator("details").filter({has: page.locator("summary", {hasText: title})});
  if (await disclosure.getAttribute("open") === null) await disclosure.locator("summary").click();
  return disclosure;
}
async function fill(page, key, value) {
  await page.locator('[data-field="' + key + '"]').fill(String(value));
}
async function click(page, label) {
  await page.getByRole("button", {name: label, exact: true}).click();
  await ready(page);
}
async function writeUI(page, label, expectedPath, before = null) {
  const responsePromise = page.waitForResponse(response => {
    const target = new URL(response.url());
    return response.request().method() === "POST" && target.pathname === expectedPath;
  }, {timeout: 240000});
  if (before) await before();
  await page.getByRole("button", {name: label, exact: true}).click();
  const response = await responsePromise;
  const result = await response.json();
  if (!response.ok()) throw new Error("Rendered operation " + label + ": " + (result.error || response.status()));
  await ready(page);
  return result;
}
async function screenshot(page, name) {
  const path = join(output, name + ".png");
  await page.screenshot({path, fullPage: true});
  await chmod(path, 0o600);
  const artifact = await fileIdentity(path);
  journal.artifacts = journal.artifacts.filter(item => item.file !== path);
  journal.artifacts.push(artifact); await checkpoint(); return artifact;
}
async function downloadUI(page, label, filename) {
  const downloadPromise = page.waitForEvent("download", {timeout: 240000});
  await page.getByRole("button", {name: label, exact: true}).click();
  const download = await downloadPromise;
  const path = join(output, filename);
  await download.saveAs(path);
  const failure = await download.failure();
  if (failure) throw new Error("Original download failed: " + failure);
  await chmod(path, 0o600);
  return fileIdentity(path);
}
async function resumeBrowserRequest(page) {
  if (await page.locator("#pending:visible").count()) {
    await page.getByRole("button", {name: "Retry saved request", exact: true}).click();
    await page.locator("#pending").waitFor({state: "hidden", timeout: 240000});
    await ready(page);
  }
}
async function observeOriginalRows(page, server, sourceId, resourceType) {
  await navigate(page, "sources");
  await choose(page, "source-selector", sourceId);
  await page.locator('[data-field="source-type"]').selectOption(resourceType);
  await click(page, "Apply resource filter");
  const original = await nativeRead(server, "/api/sources/" + encodeURIComponent(sourceId) + "/rows?" + new URLSearchParams({resourceType, kind: "output", offset: "0", limit: "25"}));
  if (!original.rows.length) throw new Error("The original selected source has no resources of " + resourceType);
  await page.getByRole("button", {name: "Inspect original", exact: true}).first().click();
  await page.locator("#inspect-dialog[open]").waitFor();
  const rendered = await page.locator("[data-original-json]").textContent();
  if (rendered !== original.rows[0].jsonText) throw new Error("The rendered original resource line differs from its retained source bytes.");
  await page.getByRole("button", {name: "Close", exact: true}).click();
  return {first: original.rows[0], total: original.total};
}
async function run() {
  const completed = await loadJSON(join(output, "OPERATED_FHIR_BROWSER.json"));
  if (completed) {
    if (completed.schema !== SCHEMA || completed.receivingSha256 !== sha(receivingBytes)) throw new Error("The completed browser output has a different original receiving identity.");
    for (const artifact of completed.artifacts) {
      const actual = await fileIdentity(artifact.file);
      if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes) throw new Error("A completed original browser artifact changed: " + artifact.file);
    }
    process.stdout.write(JSON.stringify({operation: OPERATION, state: "complete", summary: join(output, "OPERATED_FHIR_BROWSER.json"), reopened: true}) + "\n");
    return;
  }
  const sourceFiles = ["fhir_server.py", "fhir_workspace.py", "fhir_source.py", "fhir_acquisition.py", "fhir_runtime.py", "public/index.html", "public/app.js", "public/style.css", "operate_browser.mjs"];
  journal.sourceFiles = [];
  for (const path of sourceFiles) journal.sourceFiles.push({...await fileIdentity(join(source, path)), relativePath: path});
  await checkpoint();
  const playwright = await loadPlaywright();
  browserContext = await playwright.chromium.launchPersistentContext(join(output, "browser-profile"), {
    headless: true, viewport: {width: 1440, height: 1080}, acceptDownloads: true,
    ...(args["--chromium"] ? {executablePath: resolve(args["--chromium"])} : {})
  });
  const server = await startServer("original", workspace);
  const page = browserContext.pages()[0] || await browserContext.newPage();
  currentPage = page; watchPage(page);
  await page.goto(server.url); await ready(page); await resumeBrowserRequest(page);
  const beforeState = await nativeRead(server, "/api/state");
  const originalSource = await nativeRead(server, "/api/sources/" + encodeURIComponent(receiving.baseSourceId));
  const type = originalSource.inventory.resourceTypes.find(item => item.type === "Patient" && item.count)?.type ||
    originalSource.inventory.resourceTypes.find(item => item.count)?.type;
  if (!type) throw new Error("The actual original native source contains no resource type to operate.");
  const originalPlan = await nativeRead(server, "/api/plans/" + encodeURIComponent(receiving.planId));
  const originalOperation = await nativeRead(server, "/api/operations/" + encodeURIComponent(receiving.operationIds[0]));
  if (originalOperation.sourceId !== receiving.baseSourceId || originalOperation.state !== "complete") throw new Error("The original native base export must be complete and bound to its declared source.");

  await phase("reopen-original-export-and-source", async () => {
    await navigate(page, "exports");
    const row = page.locator('[data-operation-id="' + originalOperation.operationId + '"]').locator("xpath=ancestor::tr");
    await row.getByRole("button", {name: "Reopen operation", exact: true}).click(); await ready(page);
    const displayed = await page.locator("[data-operation-state]").getAttribute("data-operation-state");
    if (displayed !== "complete") throw new Error("The browser did not reopen the complete original export.");
    await screenshot(page, "01-original-export");
    const observed = await observeOriginalRows(page, server, receiving.baseSourceId, type);
    await screenshot(page, "02-original-resources");
    return {operationId: originalOperation.operationId, sourceId: receiving.baseSourceId, resourceType: type,
      originalRecords: observed.total, firstOriginal: {fileId: observed.first.fileId, line: observed.first.line, lineSha256: observed.first.lineSha256}};
  });

  const mapped = await phase("review-and-build-browser-projection", async () => {
    await navigate(page, "mapping");
    await choose(page, "source-selector", receiving.baseSourceId);
    await page.locator('[data-field="mapping-resource-type"]').selectOption(type);
    const defaultMapping = await writeUI(page, "Create editable default mapping", "/api/sources/" + encodeURIComponent(receiving.baseSourceId) + "/mapping");
    const provenanceIndex = defaultMapping.columns.findIndex(column =>
      column.source === "record" && column.path.length === 1 && column.path[0] === "recordId");
    if (provenanceIndex >= 0) {
      await page.locator('[data-action="column-remove-' + provenanceIndex + '"]').click();
      await ready(page);
    }
    await fill(page, "mapping-name", type + " original resource content · browser projection");
    const field = originalSource.inventory.fields.find(item => item.resourceType === type &&
      item.path.length === 1 && !["resourceType", "id", "text", "meta"].includes(item.path[0]) &&
      item.types.every(value => ["string", "boolean", "number", "null"].includes(value))) ||
      originalSource.inventory.fields.find(item => item.resourceType === type && item.path.length === 1 && item.path[0] === "id");
    if (field) {
      const previousCount = await page.locator("[data-column-index]").count();
      await click(page, "Add projection column");
      await fill(page, "column-name-" + previousCount, "selected_field_json");
      await fill(page, "column-path-" + previousCount, JSON.stringify(field.path));
      await page.locator('[data-field="column-mode-' + previousCount + '"]').selectOption("single");
      await page.locator('[data-field="column-encoding-' + previousCount + '"]').selectOption("json");
    }
    await writeUI(page, "Preview projection", "/api/sources/" + encodeURIComponent(receiving.baseSourceId) + "/preview");
    const saved = await writeUI(page, "Save reviewed mapping", "/api/plans");
    if (!saved.plan.keys.length) throw new Error("The actual selected source needs explicit duplicate resolution before a keyed comparison.");
    const built = await writeUI(page, "Build source with saved mapping", "/api/builds");
    await screenshot(page, "03-native-dataset");
    return {planId: saved.id, buildId: built.id, sourceId: built.source, resourceType: type, native: built.native,
      reviewedField: field ? {path: field.path, pointer: field.pointer, types: field.types} : null,
      omittedComparisonProvenance: provenanceIndex >= 0 ? defaultMapping.columns[provenanceIndex] : null, rowCount: built.rowCount, plan: saved.plan};
  });

  const queried = await phase("operate-native-query-and-cursor", async () => {
    await navigate(page, "query");
    await choose(page, "build-selector", mapped.buildId);
    const actual = await nativeRead(server, "/api/sources/" + encodeURIComponent(receiving.baseSourceId) + "/rows?" + new URLSearchParams({resourceType: type, kind: "output", offset: "0", limit: "1"}));
    const resourceId = actual.rows[0].id;
    await click(page, "Clear query");
    await click(page, "Add query condition");
    await page.locator('[data-field="query-column-0"]').selectOption("resource_id");
    await fill(page, "query-value-0", resourceId);
    await click(page, "Run native query");
    const selected = await nativeRead(server, "/api/builds/" + encodeURIComponent(mapped.buildId) + "/query?" + new URLSearchParams({where_resource_id: resourceId, limit: "50"}));
    if (selected.response.status !== 200 || selected.response.body.page.total !== 1) throw new Error("The original unique resource query did not return one matching row.");
    await click(page, "Clear query");
    await page.locator('[data-field="query-field-resource_id"]').check();
    if (mapped.plan.columns.some(item => item.name === "selected_field_json")) await page.locator('[data-field="query-field-selected_field_json"]').check();
    await click(page, "Add sort column");
    await page.locator('[data-field="query-sort-column-0"]').selectOption("resource_id");
    await fill(page, "query-limit", 5);
    await click(page, "Run native query");
    const hasNext = await page.getByRole("button", {name: "Next native page", exact: true}).isEnabled();
    if (hasNext) {await click(page, "Next native page"); await click(page, "Previous native page");}
    const recipe = await downloadUI(page, "Save current query result", "fhir-browser-native-query.json");
    const observed = JSON.parse(await readFile(recipe.file, "utf8"));
    if (observed.buildId !== mapped.buildId || observed.response.response.status !== 200) throw new Error("The browser query download is not the selected native dataset.");
    await screenshot(page, "04-native-query");
    return {buildId: mapped.buildId, matchedResourceId: resourceId, totalRows: observed.response.response.body.page.total, paged: hasNext, recipe};
  });


  const composed = await phase("compose-original-incremental-captures", async () => {
    if (!receiving.deltaSourceId || !receiving.composedSourceId) throw new Error("The complete native receiving needs its actual incremental and composed source identities.");
    const original = await nativeRead(server, "/api/sources/" + encodeURIComponent(receiving.composedSourceId));
    const composition = original.inventory.composition;
    if (!composition || composition.baseSourceId !== receiving.baseSourceId || !composition.deltaSourceIds.includes(receiving.deltaSourceId)) throw new Error("The retained native composition does not bind the original base and incremental captures.");
    await navigate(page, "compare");
    await choose(page, "composition-base", composition.baseSourceId);
    await fill(page, "composition-label", "Original retained resource state · browser receiving");
    // On interrupted receiving, discard only this browser form's delta choices,
    // then enter the exact original native sequence through the rendered controls.
    while (await page.locator('[data-action^="delta-remove-"]').count()) {
      await page.locator('[data-action^="delta-remove-"]').first().click(); await ready(page);
    }
    for (const id of composition.deltaSourceIds) await choose(page, "composition-add-delta", id);
    await openDetails(page, "Resolve conflicting duplicate resource identities");
    while (await page.locator('[data-action^="resolution-remove-"]').count()) {
      await page.locator('[data-action^="resolution-remove-"]').first().click(); await ready(page);
    }
    for (const [index, item] of (composition.resolutions || []).entries()) {
      await click(page, "Add explicit duplicate resolution");
      await page.locator('[data-field="resolution-source-' + index + '"]').selectOption(item.sourceId);
      await fill(page, "resolution-type-" + index, item.resourceType);
      await fill(page, "resolution-id-" + index, item.id);
      await fill(page, "resolution-file-" + index, item.fileId);
      await fill(page, "resolution-line-" + index, item.line);
    }
    const result = await writeUI(page, "Compose retained resource state", "/api/compositions");
    const sourceResult = await nativeRead(server, "/api/sources/" + encodeURIComponent(result.source.id));
    if (JSON.stringify(sourceResult.inventory.composition.deltaSourceIds) !== JSON.stringify(composition.deltaSourceIds)) throw new Error("The browser composition changed the original incremental order.");
    return {sourceId: result.source.id, baseSourceId: composition.baseSourceId, deltaSourceIds: composition.deltaSourceIds, resolutions: composition.resolutions || [], coverage: sourceResult.inventory.coverage};
  });

  const compared = await phase("build-and-compare-received-editions", async () => {
    await navigate(page, "mapping");
    await choose(page, "source-selector", composed.sourceId);
    await choose(page, "mapping-plan-selector", mapped.planId);
    const built = await writeUI(page, "Build source with saved mapping", "/api/builds");
    await navigate(page, "compare");
    await choose(page, "compare-before", mapped.buildId);
    await choose(page, "compare-after", built.id);
    const comparison = await writeUI(page, "Compare editions", "/api/comparisons");
    if (comparison.before !== mapped.buildId || comparison.after !== built.id || comparison.plan !== mapped.planId) throw new Error("The browser comparison differs from its selected original editions.");
    const changes = await downloadUI(page, "Download complete changes", "fhir-browser-edition-changes.jsonl");
    await screenshot(page, "05-edition-comparison");
    return {beforeId: mapped.buildId, afterId: built.id, comparisonId: comparison.id, counts: comparison.counts, changes, sourceId: composed.sourceId};
  });

  const deliveries = await phase("download-complete-original-deliveries", async () => {
    await navigate(page, "delivery");
    await choose(page, "build-selector", compared.afterId);
    const dataset = await downloadUI(page, "Download merchant dataset", "fhir-browser-merchant-dataset.zip");
    const packet = await downloadUI(page, "Download dataset packet", "fhir-browser-dataset-packet.zip");
    const editable = await downloadUI(page, "Download editable workspace", "fhir-browser-editable-workspace.zip");
    const observed = await nativeRead(server, "/api/state");
    await atomicJSON(join(output, "ORIGINAL_BROWSER_WORKSPACE.json"), observed);
    await screenshot(page, "06-complete-delivery");
    return {dataset, packet, editable, workspaceState: await fileIdentity(join(output, "ORIGINAL_BROWSER_WORKSPACE.json")),
      workspaceId: observed.workspaceId, sourceIds: observed.sources.map(item => item.id), buildIds: observed.builds.map(item => item.id)};
  });

  const receivedPacket = await phase("receive-source-backed-dataset-in-browser", async () => {
    const directory = join(output, "received-dataset-workspace");
    const receiver = await startServer("datasetReceiver", directory);
    const target = await browserContext.newPage(); watchPage(target); currentPage = target;
    try {
      await target.goto(receiver.url); await ready(target); await resumeBrowserRequest(target);
      let receivedState = await nativeRead(receiver, "/api/state");
      let result;
      if (receivedState.builds.some(item => item.id === compared.afterId)) {
        result = {build: await nativeRead(receiver, "/api/builds/" + encodeURIComponent(compared.afterId)), reconstructed: true, reopened: true};
      } else {
        await navigate(target, "delivery");
        await target.locator('[data-field="upload-packet-file"]').setInputFiles(deliveries.packet.file);
        result = await writeUI(target, "Receive dataset packet", "/api/packets");
      }
      if (result.build.id !== compared.afterId || !result.reconstructed) throw new Error("The dataset receiver did not reconstruct the original native edition.");
      receivedState = await nativeRead(receiver, "/api/state");
      const originalBuild = await nativeRead(server, "/api/builds/" + encodeURIComponent(compared.afterId));
      const rebuilt = await nativeRead(receiver, "/api/builds/" + encodeURIComponent(compared.afterId));
      for (const name of ["data.csv", "dataset.json"]) {
        if (originalBuild.files[name].sha256 !== rebuilt.files[name].sha256) throw new Error("Receiving changed original " + name);
      }
      if (originalBuild.native.snapshot !== rebuilt.native.snapshot) throw new Error("The received dataset has a different native snapshot.");
      await navigate(target, "query"); await choose(target, "build-selector", compared.afterId);
      await fill(target, "query-limit", 5); await click(target, "Run native query");
      await screenshot(target, "07-received-dataset");
      return {workspace: directory, workspaceId: receivedState.workspaceId, sourceId: rebuilt.source, planId: rebuilt.plan, buildId: rebuilt.id, snapshot: rebuilt.native.snapshot, reconstructed: true};
    } finally {await target.close(); await stopServer(receiver); currentPage = page;}
  });

  const receivedWorkspace = await phase("receive-and-reopen-complete-editable-workspace", async () => {
    const directory = join(output, "received-editable-workspace");
    let receiver = await startServer("workspaceReceiver", directory);
    let target = await browserContext.newPage(); watchPage(target); currentPage = target;
    try {
      await target.goto(receiver.url); await ready(target); await resumeBrowserRequest(target);
      let current = await nativeRead(receiver, "/api/state");
      if (current.workspaceId !== deliveries.workspaceId || current.receives.some(item => item.state !== "complete")) {
        await navigate(target, "delivery");
        await target.locator('[data-field="upload-workspace-file"]').setInputFiles(deliveries.editable.file);
        const result = await writeUI(target, "Receive editable workspace", "/api/workspace/packet");
        if (!result.reconstructed || result.workspaceId !== deliveries.workspaceId) throw new Error("The editable receiver did not reconstruct its original workspace identity.");
      }
      const expected = JSON.parse(await readFile(deliveries.workspaceState.file, "utf8"));
      const compareMembership = (original, received) => {
        const fields = {sources: "id", plans: "id", builds: "id", comparisons: "id", connections: "id", discoveries: "id",
          groupPages: "id", exports: "id", operations: "operationId", compositions: "sourceId"};
        const totals = {};
        for (const [collection, key] of Object.entries(fields)) {
          const left = (original[collection] || []).map(item => item[key]).sort();
          const right = (received[collection] || []).map(item => item[key]).sort();
          if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error("Whole receiving changed original " + collection + " membership.");
          totals[collection] = left.length;
        }
        return totals;
      };
      current = await nativeRead(receiver, "/api/state");
      const totals = compareMembership(expected, current);
      await navigate(target, "sources"); await choose(target, "source-selector", receiving.baseSourceId);
      const original = await observeOriginalRows(target, receiver, receiving.baseSourceId, type);
      const baseOriginal = await nativeRead(server, "/api/sources/" + encodeURIComponent(receiving.baseSourceId) + "/rows?" + new URLSearchParams({resourceType: type, kind: "output", offset: "0", limit: "1"}));
      if (original.first.jsonText !== baseOriginal.rows[0].jsonText || original.first.lineSha256 !== baseOriginal.rows[0].lineSha256) throw new Error("Whole workspace receiving changed the original retained resource.");
      await screenshot(target, "08-editable-workspace");
      await target.close(); await stopServer(receiver);
      receiver = await startServer("workspaceReceiver", directory);
      target = await browserContext.newPage(); watchPage(target); currentPage = target;
      await target.goto(receiver.url); await ready(target);
      const reopened = await nativeRead(receiver, "/api/state");
      compareMembership(expected, reopened);
      await navigate(target, "query"); await choose(target, "build-selector", compared.afterId);
      await target.bringToFront();
      await fill(target, "query-limit", 5); await click(target, "Run native query");
      await target.setViewportSize({width: 390, height: 844});
      await screenshot(target, "09-reopened-workspace-mobile");
      await atomicJSON(join(output, "RECEIVED_BROWSER_WORKSPACE.json"), reopened);
      return {workspace: directory, workspaceId: reopened.workspaceId, totals, originalResourceSha256: original.first.resourceSha256,
        sourceId: receiving.baseSourceId, buildId: compared.afterId, restored: true, reopened: true,
        state: await fileIdentity(join(output, "RECEIVED_BROWSER_WORKSPACE.json"))};
    } finally {await target.close(); await stopServer(receiver); currentPage = page;}
  });

  await phase("reopen-original-browser-workspace", async () => {
    await page.goto(server.url); await ready(page); await resumeBrowserRequest(page);
    const reopened = await nativeRead(server, "/api/state");
    if (reopened.workspaceId !== beforeState.workspaceId || !reopened.builds.some(item => item.id === compared.afterId) ||
        !reopened.comparisons.some(item => item.id === compared.comparisonId)) throw new Error("The original browser workspace did not retain the operated dataset and comparison.");
    await navigate(page, "overview");
    return {workspaceId: reopened.workspaceId, originalOperationId: originalOperation.operationId, planId: mapped.planId, buildId: compared.afterId,
      comparisonId: compared.comparisonId, operationCountBefore: beforeState.operations.length, operationCountAfter: reopened.operations.length};
  });
  if (pageErrors.length) throw new Error("Browser page error: " + pageErrors.map(item => item.message).join("; "));
  const artifacts = [...journal.artifacts, queried.recipe, compared.changes, deliveries.dataset, deliveries.packet, deliveries.editable, deliveries.workspaceState, receivedWorkspace.state];
  const summary = {schema: SCHEMA, operation: OPERATION, completedAt: new Date().toISOString(), receiving: receivingPath, receivingSha256: sha(receivingBytes),
    source, sourceFiles: journal.sourceFiles, workspace, originalWorkspaceId: beforeState.workspaceId, originalSourceId: receiving.baseSourceId,
    originalOperationId: originalOperation.operationId, mapping: mapped, query: queried, composition: composed, comparison: compared,
    deliveries, datasetReceiving: receivedPacket, workspaceReceiving: receivedWorkspace, artifacts, pageErrors,
    journal: journalPath, phases: journal.phases.map(item => ({name: item.name, state: item.state, completedAt: item.completedAt}))};
  await atomicJSON(join(output, "OPERATED_FHIR_BROWSER.json"), summary);
  journal.completedAt = summary.completedAt; await checkpoint();
  process.stdout.write(JSON.stringify({operation: OPERATION, state: "complete", summary: join(output, "OPERATED_FHIR_BROWSER.json"),
    sources: receivedWorkspace.totals.sources, datasets: receivedWorkspace.totals.builds, originalWorkspaceId: beforeState.workspaceId}) + "\n");
}
try {
  await run();
} catch (error) {
  journal.errors.push({at: new Date().toISOString(), message: error.message, pageErrors});
  if (currentPage && !currentPage.isClosed()) {
    try {await screenshot(currentPage, "INTERRUPTED-browser");} catch {}
  }
  await checkpoint();
  process.stderr.write("FHIR browser receiving interrupted: " + error.message + "\n");
  process.exitCode = 1;
} finally {
  if (browserContext) await browserContext.close().catch(() => {});
  for (const server of servers.reverse()) await stopServer(server).catch(() => {});
  const owner = await loadJSON(lockPath);
  if (owner?.pid === process.pid) await unlink(lockPath);
}
