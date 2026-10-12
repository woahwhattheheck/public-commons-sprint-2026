#!/usr/bin/env node
/** Operate the real native vector browser against an original completed source capture. */
import { readFile, writeFile, mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { startVectorServer } from "../server.mjs";
import { parseExactJSON as parse, stringifyExactJSON as encode } from "../json.mjs";

const flags = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith("--") || process.argv[i + 1] === undefined) throw new Error("Use --name VALUE arguments");
  flags[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const name of ["native-directory","out","python","playwright-module","chromium"])
  if (!flags[name]) throw new Error("--" + name + " is required");
const nativeDirectory = resolve(flags["native-directory"]), out = resolve(flags.out);
const outputRelative = relative(nativeDirectory, out);
if (!outputRelative || outputRelative === ".." || outputRelative.startsWith(".." + sep))
  throw new Error("--out must be a separate directory inside --native-directory.");
const original = parse(await readFile(resolve(nativeDirectory, "native-result.json"), "utf8"));
if (!original.ok) throw new Error("Use the completed original native journey and source capture.");
const captureDirectory = resolve(nativeDirectory, "capture");
const capture = parse(await readFile(resolve(captureDirectory, "capture.json"), "utf8"));
const inspection = parse(await readFile(resolve(captureDirectory, "inspection.json"), "utf8"));
const originalExport = parse(await readFile(resolve(nativeDirectory, "native-export/vector-export.json"), "utf8"));
const firstFieldLayer = inspection.layers.find(layer => layer.fieldOrder.length);
if (!firstFieldLayer) throw new Error("This browser journey requires an original source field for native alias review.");
await mkdir(out, { recursive: true, mode: 0o700 });
const inputDirectory = resolve(out, "source-input"), control = resolve(out, "operator-control");
await mkdir(inputDirectory, { recursive: true, mode: 0o700 });
async function descriptor(path) {
  let bytes = 0; const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
  return { path, bytes, sha256: hash.digest("hex") };
}
for (const source of capture.selection.sources) {
  for (const item of [source, ...(source.members || [])]) {
    const retained = resolve(captureDirectory, "sources", source.id, item.path);
    const destination = resolve(inputDirectory, item.path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const before = await descriptor(retained);
    if (before.bytes !== item.bytes || before.sha256 !== item.sha256) throw new Error("Original source member changed.");
    await copyFile(retained, destination);
    const received = await descriptor(destination);
    if (received.bytes !== item.bytes || received.sha256 !== item.sha256) throw new Error("Original source copy changed.");
  }
}
const result = { schema: "starforge.vector-browser-journey.v1", ok: false,
  nativeDirectory, directory: out, originalSelectionSha256: capture.selectionSha256,
  steps: [], browserConsole: [] };
const record = async (name, value) => {
  result.steps.push({ name, completedAt: new Date().toISOString(), result: value });
  await writeFile(resolve(out, "browser-result.json"), encode(result, 2) + "\n", { mode: 0o600 });
};
let running, browser, context, phase;
try {
  const pw = await import(pathToFileURL(resolve(flags["playwright-module"])).href);
  running = await startVectorServer({ root: nativeDirectory, controlRoot: control, python: flags.python });
  const session = new URLSearchParams(new URL(running.url).hash.slice(1)).get("session");
  const api = async (path, body) => {
    const response = await fetch(running.origin + path, { method: body ? "POST" : "GET",
      headers: { authorization: "Bearer " + session, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: encode(body) } : {}) });
    const value = parse(await response.text());
    if (!response.ok) throw Object.assign(new Error(value.error?.code || "HTTP failure"), value.error || {});
    return value;
  };
  browser = await pw.chromium.launch({ executablePath: resolve(flags.chromium), headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  page.on("pageerror", error => result.browserConsole.push({ type: "pageerror", message: error.message }));
  page.on("console", message => { if (message.type() === "error") result.browserConsole.push({ type: "console", message: message.text() }); });
  const settled = async () => {
    await page.waitForFunction(() => {
      const notice = document.querySelector("#notice");
      if (notice?.dataset.kind === "error") throw new Error(notice.textContent);
      return document.querySelector("#capture")?.disabled === false;
    }, null, { timeout: 600000 });
  };
  phase = "open-native-operator";
  await page.goto(running.url);
  await page.waitForFunction(() => document.querySelector("#connection")?.textContent === "Connected");
  await record(phase, { browser: await browser.version(), root: nativeDirectory, python: flags.python });
  phase = "capture-and-inspect-original-selection-in-browser";
  await page.locator("#source-root").fill(inputDirectory);
  await page.locator("#capture-directory").fill(resolve(out, "browser-capture"));
  await page.locator("#selection-json").fill(encode(capture.selection, 2));
  await page.locator("#capture").click(); await settled();
  await page.waitForFunction(expected => document.querySelector("#source-layers")?.querySelectorAll("tr").length === expected,
    inspection.layers.length);
  const stateAfterCapture = await api("/api/state");
  const captureOperation = stateAfterCapture.operations.find(item => item.request.command === "capture");
  const inspectedOperation = stateAfterCapture.operations.find(item => item.request.command === "inspect");
  if (captureOperation.state !== "SUCCEEDED" || inspectedOperation.state !== "SUCCEEDED") throw new Error("Original capture did not complete.");
  await record(phase, { captureOperation: captureOperation.id, inspectOperation: inspectedOperation.id,
    layers: inspection.layers.length, sourceFeatures: inspection.counts.features });
  phase = "review-source-mapping-and-native-export";
  await page.locator('[data-tab="mapping"]').click();
  await page.getByText("Complete export profile", { exact: true }).click();
  await page.locator("#profile-json").fill(encode(originalExport.profile, 2));
  await page.locator("#profile-apply").click();
  await page.locator("#mapping-layer").selectOption(firstFieldLayer.id);
  const fieldName = firstFieldLayer.fieldOrder[0];
  await page.getByLabel("GPKG field name for " + fieldName, { exact: true }).fill("review_key");
  await page.getByLabel("GPKG field name for " + fieldName, { exact: true }).blur();
  await page.getByLabel("ESRI Shapefile field name for " + fieldName, { exact: true }).fill("review_key");
  await page.getByLabel("ESRI Shapefile field name for " + fieldName, { exact: true }).blur();
  const exportDirectory = resolve(out, "browser-export");
  await page.locator("#export-directory").fill(exportDirectory);
  await page.locator("#export-operation").fill("browser-native-export");
  await page.locator("#export").click(); await settled();
  const state = await api("/api/state");
  const exportOperation = state.operations.find(item => item.request.command === "export");
  const exportResult = await api("/api/operations/" + exportOperation.id + "/result");
  if (!exportResult.ok) throw new Error("Browser native export failed.");
  const exported = exportResult.result;
  for (const layer of exported.manifest.native.layers.filter(item => item.sourceLayerId === firstFieldLayer.id)) {
    if (layer.fields.find(item => item.sourceName === fieldName)?.targetName !== "review_key")
      throw new Error("The operator alias did not reach the actual native writer.");
  }
  await record(phase, { operation: exportOperation.id, originalField: fieldName, nativeAlias: "review_key",
    manifestFile: exported.manifestFile, counts: exported.manifest.counts });
  phase = "recover-committed-native-result-after-summary-loss";
  const logsBefore = (await readdir(resolve(control, "native"))).sort();
  await rm(resolve(control, exportOperation.id + ".status.json"));
  const replies = await Promise.all([1, 2].map(() => api("/api/run", {
    requestId: exportOperation.id, request: exportOperation.request })));
  const logsAfter = (await readdir(resolve(control, "native"))).sort();
  if (!replies.every(item => item.state === "SUCCEEDED") || encode(logsBefore) !== encode(logsAfter))
    throw new Error("Committed original response was not recovered without another native launch.");
  await record(phase, { operation: exportOperation.id, replies: replies.map(item => item.state), nativeLaunchesAdded: 0 });
  phase = "download-complete-native-package";
  const archivePath = resolve(out, "browser-vector-delivery.zip");
  await page.locator("#bundle-path").fill(archivePath);
  await page.locator("#bundle").click(); await settled();
  await page.waitForSelector("#bundle-download:not([hidden])");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#bundle-download").click();
  const download = await downloadPromise;
  const downloaded = resolve(out, "downloaded-vector-delivery.zip");
  await download.saveAs(downloaded);
  const diskArchive = await descriptor(archivePath), browserArchive = await descriptor(downloaded);
  if (diskArchive.bytes !== browserArchive.bytes || diskArchive.sha256 !== browserArchive.sha256)
    throw new Error("The browser download differs from the complete native archive.");
  await record(phase, { nativeArchive: diskArchive, browserDownload: browserArchive });
  phase = "receive-and-reopen-native-package-in-browser";
  const receiver = resolve(out, "browser-received");
  await page.locator("#receive-directory").fill(receiver);
  await page.locator("#receive-archive").fill(downloaded);
  await page.locator("#archive-sha").fill(browserArchive.sha256);
  await page.locator("#receive-bundle").click(); await settled();
  if (await page.locator("#package-sha").inputValue() !== exported.manifestFile.sha256)
    throw new Error("The original export identity changed in browser receiving.");
  await record(phase, { receiver, manifestSha256: exported.manifestFile.sha256 });
  phase = "compare-received-original-source-in-browser";
  await page.locator('[data-tab="comparison"]').click();
  await page.locator("#before-directory").fill(resolve(out, "browser-capture"));
  await page.locator("#after-directory").fill(receiver);
  await page.locator("#comparison-directory").fill(resolve(out, "browser-comparison"));
  await page.locator("#comparison-operation").fill("browser-source-receiving");
  await page.locator("#compare").click(); await settled();
  const finalState = await api("/api/state");
  const comparisonOperation = finalState.operations.find(item => item.request.command === "compare");
  const comparison = await api("/api/operations/" + comparisonOperation.id + "/result");
  const counts = comparison.result.manifest.counts;
  if (counts.added || counts.removed || counts.changed || counts.unchanged !== inspection.counts.features)
    throw new Error("The browser receiving changed original source features.");
  await record(phase, { operation: comparisonOperation.id, counts });
  phase = "reload-original-views";
  await page.reload(); await settled();
  await page.waitForFunction(expected =>
    document.querySelector("#package-sha")?.value === expected.sha256 &&
    document.querySelector("#native-layers")?.querySelectorAll("tr").length === expected.layers,
    { sha256: exported.manifestFile.sha256, layers: exported.manifest.native.layers.length });
  await page.locator('[data-tab="packages"]').click();
  if (await page.locator("#package-sha").inputValue() !== exported.manifestFile.sha256)
    throw new Error("Reload did not preserve the original received package.");
  await page.screenshot({ path: resolve(out, "vector-operator.png"), fullPage: true });
  await record(phase, { selectedManifestSha256: exported.manifestFile.sha256,
    screenshot: await descriptor(resolve(out, "vector-operator.png")) });
  if (result.browserConsole.some(item => item.type === "pageerror")) throw new Error("The operator raised a browser exception.");
  result.ok = true; result.completedAt = new Date().toISOString();
  result.operations = finalState.operations.map(item => ({ id: item.id, state: item.state, command: item.request.command }));
} catch (error) {
  result.failedPhase = phase; result.error = { code: error.code || error.name, message: error.message, stack: error.stack };
  process.exitCode = 2;
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  await running?.close().catch(() => {});
  await writeFile(resolve(out, "browser-result.json"), encode(result, 2) + "\n", { mode: 0o600 });
}
process.stdout.write(encode({ ok: result.ok, resultFile: resolve(out, "browser-result.json"),
  steps: result.steps.length, failedPhase: result.failedPhase, error: result.error }) + "\n");
