/** Inspect the complete commissioning desk in the caller's original running browser. */
import assert from "node:assert/strict";
import {readFile, writeFile, mkdir, rename, stat} from "node:fs/promises";
import {resolve, join, basename} from "node:path";
import {createHash} from "node:crypto";

const sha = value => createHash("sha256").update(value).digest("hex");
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const exists = async path => {try {await stat(path); return true;} catch (error) {if (error.code === "ENOENT") return false; throw error;}};
const readJSON = async (path, fallback) => await exists(path) ? JSON.parse(await readFile(path, "utf8")) : fallback;
async function save(path, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + "\n");
  const temporary = path + "." + process.pid + ".tmp";
  await writeFile(temporary, data, {mode: 0o600}); await rename(temporary, path);
}
async function until(check, message, milliseconds = 30000) {
  const deadline = Date.now() + milliseconds;
  do {const value = await check(); if (value) return value; await sleep(100);} while (Date.now() < deadline);
  throw new Error(message);
}
const basis = d => ({
  id: d.id, revision: d.revision, snapshot_sha256: d.snapshot_sha256, state: d.state,
  source_edition_id: d.source_edition_id, capture_edition_id: d.capture_edition_id,
  plan_sha256: d.plan_sha256, review_sha256: d.review_sha256, adoption_review_sha256: d.adoption_review_sha256,
  commissioning_inventory_sha256: d.commissioning_inventory_sha256,
  commissioning_comparison_sha256: d.commissioning_comparison_sha256,
  comparison_sha256: d.comparison_sha256, acceptance_sha256: d.acceptance_sha256,
  parent_snapshot_sha256: d.parent_snapshot_sha256 ?? null
});

/**
 * page and api belong to the existing running Desk/browser.
 * handoverRequestId is the original COMPLETE commissioning_handover request.
 * expectedModuleSha256 selects the actual complete commissioning.js leaf.
 * Call again with phase="received" on the original independently received workspace.
 */
export async function receiveCommissioningDesk({
  page, api, output, operationId, deploymentId, handoverRequestId,
  expectedModuleSha256, phase = "original", sourceIdentity = null, completeWorkspace = null
}) {
  assert(page && typeof api === "function", "Use the original running browser and local API.");
  assert(operationId && /^[0-9a-f]{64}$/.test(deploymentId), "Use the original operation and saved deployment ID.");
  assert(/^[0-9a-f]{64}$/.test(handoverRequestId), "Use the original completed commissioning handover request.");
  assert(/^[0-9a-f]{64}$/.test(expectedModuleSha256), "Select the complete browser source leaf.");
  assert(["original", "received"].includes(phase), "Use the original or independently received phase.");
  const directory = resolve(output); await mkdir(directory, {recursive: true, mode: 0o700});
  const [hello, original, handover] = await Promise.all([
    api("/api/hello"), api("/api/deployments/" + deploymentId), api("/api/requests/" + handoverRequestId)
  ]);
  assert.equal(original.commissioning_origin, "external_import");
  assert.equal(original.state, "ACCEPTED");
  assert.equal(handover.state, "COMPLETE");
  assert.equal(handover.kind, "commissioning_handover");
  assert.equal(handover.arguments.deployment_id, deploymentId);
  const binding = {operationId, phase, workspaceId: hello.workspace_id, deploymentId,
    handoverRequestId, expectedModuleSha256, basis: basis(original)};
  const progressPath = join(directory, "commissioning-browser-progress.json");
  const resultPath = join(directory, "commissioning-browser-result.json");
  const progress = await readJSON(progressPath, {schema: "portfolio.commissioning-browser-progress.v1",
    binding, screenshots: {}, downloads: {}, startedAt: new Date().toISOString()});
  assert.deepEqual(progress.binding, binding, "Continue the same saved selection and source edition.");
  await save(progressPath, progress);
  const completed = await readJSON(resultPath, null);
  if (completed) {
    assert.deepEqual(completed.binding, binding);
    for (const item of completed.artifacts) {
      const bytes = await readFile(item.path); assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256);
    }
    return completed;
  }
  const source = await page.evaluate(async () => {
    const response = await fetch("/assets/commissioning.js", {cache: "no-store", credentials: "omit"});
    if (!response.ok) throw new Error("The selected commissioning browser source is absent.");
    return response.text();
  });
  assert.equal(sha(Buffer.from(source)), expectedModuleSha256, "The actual browser must serve the selected full module.");
  assert(!(await page.locator("#active-label").innerText()).startsWith("Saved request"), "Reopen the original pending operation before this completed-desk inspection.");
  const browserErrors = [], mutationRequests = [], layouts = [], artifacts = [], sourcePages = [];
  const onError = error => browserErrors.push(String(error?.message || error));
  const onRequest = request => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.origin === new URL(page.url()).origin && url.pathname.startsWith("/api/"))
      mutationRequests.push({method: request.method(), path: url.pathname});
  };
  page.on("pageerror", onError); page.on("request", onRequest);
  const desk = page.locator("#commissioning-desk");
  const tabs = [["intake", "Import & evidence"], ["review", "Identity & exceptions"],
    ["correction", "Observed corrections"], ["receiving", "Acceptance & handover"]];
  try {
    await page.locator('[data-tab="commissioning"]').click();
    const picker = desk.getByLabel("Imported plan", {exact: true});
    const seenDeployments = new Set();
    while (!(await picker.locator("option").evaluateAll((rows, id) => rows.some(row => row.value === id), deploymentId))) {
      const more = desk.getByRole("button", {name: "More saved commissioning plans", exact: true});
      assert(await more.count(), "The original deployment is absent from the complete saved history.");
      const old = await page.locator("#deployment-select option").count();
      assert(!seenDeployments.has(old), "Saved deployment pagination did not advance.");
      seenDeployments.add(old); await more.click();
      await until(async () => await page.locator("#deployment-select option").count() > old || !(await more.count()),
        "Saved deployment history did not finish loading.");
    }
    await picker.selectOption(deploymentId);
    await until(async () => await picker.inputValue() === deploymentId &&
      await desk.getAttribute("aria-busy") === "false" &&
      (await desk.innerText()).includes(original.source_edition_id), "The selected original commissioning deployment did not load.");
    assert.equal(await desk.getByRole("button", {name: "Reload original deployment", exact: true}).count(), 0,
      "The complete saved native capture must load.");
    await desk.getByRole("tab", {name: "Identity & exceptions", exact: true}).click();
    if (original.plan.mode === "external_import_adoption") {
      for (const family of ["tasks", "resources", "assignments", "dependencies"]) {
        const expected = await api("/api/editions/" + original.source_edition_id + "?family=" + family + "&offset=0&limit=50");
        assert.equal(expected.edition_id, original.source_edition_id); assert.equal(expected.family, family);
        await desk.getByLabel("Original row family", {exact: true}).selectOption(family);
        await until(async () => {
          const table = desk.locator('table[aria-label="Original rows and explicit native identity mappings"]');
          if (!(await table.count())) return false;
          const rows = table.locator("tbody tr");
          return await rows.count() === expected.items.length &&
            (!expected.items.length || (await rows.first().locator("td").first().innerText()) === expected.items[0].key);
        }, "The complete selected source page did not match its original API.");
        sourcePages.push({family, total: expected.total, offset: expected.offset, shown: expected.items.length,
          next_offset: expected.next_offset, originalKeys: expected.items.map(row => row.key)});
      }
      await desk.getByLabel("Original row family", {exact: true}).selectOption("tasks");
      await until(async () => await desk.locator('table[aria-label="Original rows and explicit native identity mappings"]').count(),
        "The original task view did not reopen.");
    }

    // Open the already completed original result through the maintained Activity controls.
    await page.locator('[data-tab="history"]').click(); await page.locator("#refresh").click();
    const seenRequests = new Set();
    let historyRow;
    for (;;) {
      historyRow = page.locator("#history-table .finding").filter({has:
        page.locator("p").filter({hasText: new RegExp("^" + handoverRequestId + "$")})});
      if (await historyRow.count()) break;
      const more = page.getByRole("button", {name: "More original requests", exact: true});
      assert(await more.count(), "The complete original handover request is absent from Activity.");
      const old = await page.locator("#history-table .finding").count();
      assert(!seenRequests.has(old), "Original request history pagination did not advance.");
      seenRequests.add(old); await more.click();
      await until(async () => await page.locator("#history-table .finding").count() > old || !(await more.count()),
        "Original request history did not finish loading.");
    }
    await historyRow.locator("button").first().click();
    await page.getByRole("button", {name: "Open saved result", exact: true}).click();
    await page.locator('[data-tab="commissioning"]').click();
    await until(async () => await desk.getByLabel("Imported plan", {exact: true}).inputValue() === deploymentId &&
      await desk.getByRole("tab", {name: "Acceptance & handover", exact: true}).getAttribute("aria-selected") === "true",
      "The exact saved handover did not reopen in its commissioning deployment.");
    for (const key of ["html", "json", "commissioning_html", "commissioning_json"]) {
      const expected = handover.result[key]; assert(expected?.sha256 && expected.filename, "The complete handover artifact is absent.");
      const filename = basename(expected.filename), path = join(directory, filename);
      if (await exists(path)) {
        const bytes = await readFile(path);
        assert.equal(sha(bytes), expected.sha256); if (expected.bytes !== undefined) assert.equal(bytes.length, expected.bytes);
      } else {
        const trigger = desk.locator('button[title="' + expected.sha256 + '"]');
        await until(async () => await trigger.count(), "The original handover download control is absent.");
        const downloadPromise = page.waitForEvent("download"); await trigger.first().click();
        const download = await downloadPromise, downloadedPath = await download.path();
        assert(downloadedPath, "The original browser did not retain its completed download.");
        const bytes = await readFile(downloadedPath);
        assert.equal(sha(bytes), expected.sha256); if (expected.bytes !== undefined) assert.equal(bytes.length, expected.bytes);
        await save(path, bytes);
      }
      const bytes = await readFile(path), item = {kind: "handover", name: filename, path, bytes: bytes.length, sha256: sha(bytes)};
      artifacts.push(item); progress.downloads[key] = item; await save(progressPath, progress);
    }

    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height: width < 600 ? 844 : 1000});
      for (const [stage, label] of tabs) {
        await desk.getByRole("tab", {name: label, exact: true}).click();
        await until(async () => await desk.getByRole("tab", {name: label, exact: true}).getAttribute("aria-selected") === "true" &&
          await desk.getAttribute("aria-busy") === "false", "The selected commissioning screen did not render.");
        const layout = await page.evaluate(() => ({viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth}));
        assert(layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1,
          label + " overflows the original " + width + "-pixel viewport.");
        layouts.push({stage, width, ...layout});
        const name = "commissioning-" + (width < 600 ? "phone" : "desktop") + "-" + stage + ".png";
        const path = join(directory, name);
        if (!(await exists(path))) {
          progress.screenshots[name] = {state: "CAPTURING", width, stage}; await save(progressPath, progress);
          await save(path, await page.screenshot({fullPage: true}));
        }
        const bytes = await readFile(path);
        assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
        assert.equal(bytes.readUInt32BE(16), width);
        const prior = progress.screenshots[name];
        assert(prior && prior.width === width && prior.stage === stage, "Retain the original screenshot selection.");
        if (prior.sha256) assert.equal(sha(bytes), prior.sha256);
        const item = {kind: "screenshot", name, path, width, height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: sha(bytes)};
        artifacts.push(item); progress.screenshots[name] = {...item, stage, state: "COMPLETE"}; await save(progressPath, progress);
      }
    }
    if (completeWorkspace) {
      const bytes = await readFile(completeWorkspace.path);
      assert.equal(bytes.length, completeWorkspace.bytes); assert.equal(sha(bytes), completeWorkspace.sha256);
    }
    const after = await api("/api/deployments/" + deploymentId);
    assert.deepEqual(basis(after), basis(original), "The displayed receiving history must retain the original domain selection.");
    assert.deepEqual(browserErrors, []); assert.deepEqual(mutationRequests, []);
    const result = {schema: "portfolio.commissioning-browser-receiving.v1", binding, sourceIdentity,
      completedAt: new Date().toISOString(), sourcePages, layouts, artifacts, browserErrors,
      browserMutationCount: mutationRequests.length, domainStateUnchanged: true, completeWorkspace,
      handover: {requestId: handoverRequestId, resultSha256: handover.result_sha256}};
    await save(resultPath, result); return result;
  } finally {
    page.off("pageerror", onError); page.off("request", onRequest);
  }
}
