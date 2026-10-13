// MIT. Complete recipient-return course inside the original OpenLineage receiver.
import { promises as fs, constants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const SCHEMA = "commons.openlineage.recipient-return-receiving.v1";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const canonical = value => JSON.stringify(value, (_, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const copy = value => structuredClone(value);
const equal = (a, b) => canonical(a) === canonical(b);

async function exists(path) {
  try { return await fs.lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function ordinary(path) {
  const info = await fs.lstat(path);
  need(info.isFile() && !info.isSymbolicLink(), "Use the original ordinary source/output file: " + path);
  return fs.readFile(path);
}
async function directory(path) {
  need(isAbsolute(path) && resolve(path) === path, "Use a canonical absolute original output directory.");
  const info = await fs.lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await fs.realpath(path) === path,
    "Use the original retained output directory.");
}
async function syncParent(path) {
  const handle = await fs.open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function putExact(path, bytes) {
  const data = Buffer.from(bytes), prior = await exists(path);
  if (prior) { need((await ordinary(path)).equals(data), "Keep different existing output: " + path); return; }
  const stage = path + ".writing-" + randomUUID(), handle = await fs.open(stage, "wx", 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await fs.link(stage, path); }
    catch (error) { if (error.code !== "EEXIST") throw error; need((await ordinary(path)).equals(data), "A different output won publication."); }
    await syncParent(path);
  } finally { await fs.unlink(stage).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
function normalInput(input) {
  need(input && typeof input === "object" && !Array.isArray(input), "Choose the original complete receiving input.");
  for (const key of ["operationId", "workspaceId", "reviewId", "reviewSha256", "requestedBy", "receivedBy"])
    need(typeof input[key] === "string" && input[key].trim(), "Keep the actual " + key + ".");
  need(/^[a-f0-9]{64}$/.test(input.reviewSha256), "Keep the actual saved review hash.");
  need(input.recipient && ["name", "organisation", "reference"].every(key => typeof input.recipient[key] === "string") &&
    input.recipient.name.trim() && input.recipient.reference.trim(), "Choose the original named recipient and unique original reference.");
  need(typeof input.instructions === "string" && typeof input.operatorNote === "string", "Keep complete operator instructions and note.");
  const reply = input.reply;
  need(reply && reply.respondent && ["name", "organisation", "role"].every(key => typeof reply.respondent[key] === "string") &&
    reply.respondent.name.trim(), "Choose the actual entered respondent attribution.");
  need(["comments", "acknowledged", "changes_requested"].includes(reply.overall) &&
    typeof reply.comment === "string" && Array.isArray(reply.items), "Keep the complete selected recipient response.");
  need(reply.items.every(row => row && typeof row.itemId === "string" && typeof row.comment === "string" &&
    ["not_reviewed", "acknowledged", "question", "change_requested"].includes(row.response)) &&
    new Set(reply.items.map(row => row.itemId)).size === reply.items.length, "Keep distinct actual item responses.");
  need(input.source && typeof input.source.commit === "string" && /^[a-f0-9]{40}$/.test(input.source.commit) &&
    Array.isArray(input.source.application) && input.source.application.length > 0, "Supply the actual published full application selection.");
  need(input.source.application.every(row => row && typeof row.path === "string" && /^[a-f0-9]{64}$/.test(row.sha256) &&
    Number.isSafeInteger(row.bytes) && row.bytes >= 0) &&
    new Set(input.source.application.map(row => row.path)).size === input.source.application.length,
    "Keep every original application file identity exactly once.");
  return copy(input);
}
function selectedSource(bundle, input) {
  const rows = [...bundle.application].map(([path, data]) => ({ path, bytes: data.length, sha256: hash(data) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const expected = copy(input.source.application).sort((a, b) => a.path.localeCompare(b.path));
  need(equal(rows, expected), "The actual complete application differs from the chosen published source.");
  for (const required of ["review-return.mjs", "review-return-store.mjs", "review-return-ui.mjs", "review-return-editor.mjs"])
    need(bundle.application.has(required), "The received application is missing " + required);
}
async function verifyReceivedFiles(receivePath, full) {
  await directory(receivePath);
  const received = JSON.parse(await ordinary(join(receivePath, "received.json")));
  need(received.packageSha256 === full.packageSha256 && received.payloadSha256 === full.payloadSha256,
    "Preserve a different existing independent receiving.");
  await directory(join(receivePath, "objects"));
  for (const [id, expected] of full.objects)
    need((await ordinary(join(receivePath, "objects", id))).equals(expected),
      "The retained received object differs from the complete export: " + id);
  if (full.application.size) await directory(join(receivePath, "application"));
  for (const [name, expected] of full.application)
    need((await ordinary(join(receivePath, "application", name))).equals(expected),
      "The retained received application differs from the complete export: " + name);
}
function originalStateUnchanged(before, after, request, response) {
  const omit = state => Object.fromEntries(Object.entries(state).filter(([key]) =>
    !["revision", "updatedAt", "operations", "customerReviewReturns"].includes(key)));
  need(equal(omit(before), omit(after)), "An original source, assessment, decision or customer review changed during receiving.");
  need(after.workspaceId === before.workspaceId && after.revision === before.revision + 2, "Keep the same two-operation recipient continuation.");
  need(equal(after.operations.slice(0, before.operations.length), before.operations), "Original operation history changed.");
  const added = after.operations.slice(before.operations.length);
  need(added.length === 2 && added[0].id === request.operationId && added[1].id === response.operationId,
    "Keep the actual recipient request and returned-response operations in original order.");
  const previous = before.customerReviewReturns ?? { requests: [], responses: [] }, current = after.customerReviewReturns;
  need(equal(current.requests, [...previous.requests, request]) && equal(current.responses, [...previous.responses, response]),
    "Unrelated recipient history changed.");
}
/**
 * Operate the original authenticated Page and workspace.
 * page/client/workspace/store/remember/openDesk come from the existing receiving caller.
 * No server, browser or substitute business workspace is created here.
 * An independent complete receiving directory is created only after the original export.
 */
/**
 * Open the recipient tab in the already-owned original customer-review operator.
 * The preceding original course keeps navigation, auth and Page ownership.
 */
export async function openCurrentReviewReturnDesk({page,workspaceId}) {
  need(page && typeof page.evaluate === "function", "Use the original customer-review Page.");
  const original = await page.evaluate(() => window.customerServiceReviewOperator?.inspect?.() ?? null);
  need(original?.workspaceId === workspaceId && !original.closed && !original.closing,
    "Keep the same open customer-service-review operator before entering its Recipient returns tab.");
  await page.getByRole("button", {name:"Recipient returns", exact:true}).click();
  await page.locator(".review-return-desk").waitFor({state:"visible", timeout:45000});
  const current = await page.evaluate(() => window.customerServiceReviewOperator?.inspect?.() ?? null);
  need(current?.workspaceId === workspaceId && !current.closed && !current.closing,
    "The original customer-review operator changed while opening recipient returns.");
}
export async function receiveReviewReturns({
  page, client, workspace, store, outputDirectory, input: incoming, remember,
  openDesk = openCurrentReviewReturnDesk
}) {
  const input = normalInput(incoming), root = resolve(outputDirectory);
  await directory(root);
  for (const [name, fn] of Object.entries({
    remember, openDesk,
    action: client?.action, exportWorkspace: client?.exportWorkspace, downloadExport: client?.downloadExport,
    read: workspace?.read, verifyBundle: store?.verifyBundle, receiveBundle: store?.receiveBundle
  })) need(typeof fn === "function", "Keep the original receiver's actual " + name + " function.");
  need(typeof store.LineageWorkspace === "function" && page && typeof page.context === "function", "Use the current original application and Page.");
  const inputPath = join(root, "recipient-return-input.json"), journalPath = join(root, "recipient-return-progress.json");
  await putExact(inputPath, json(input)); await remember(inputPath);
  let journal = { schema: SCHEMA, inputSha256: hash(json(input)), operationId: input.operationId, files: {}, captures: [], startedAt: new Date().toISOString() };
  let journalHash = null;
  if (await exists(journalPath)) {
    const bytes = await ordinary(journalPath); journal = JSON.parse(bytes); journalHash = hash(bytes);
    need(journal.schema === SCHEMA && journal.inputSha256 === hash(json(input)) && journal.operationId === input.operationId,
      "Resume the original complete input in its own output directory.");
  }
  async function commit() {
    if (journalHash === null) need(!await exists(journalPath), "Another receiver published this journal.");
    else need(hash(await ordinary(journalPath)) === journalHash, "Another receiver changed the original progress.");
    const data = json(journal), stage = journalPath + ".writing-" + randomUUID();
    const handle = await fs.open(stage, "wx", 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    if (journalHash === null) {
      try { await fs.link(stage, journalPath); } finally { await fs.unlink(stage); }
    } else await fs.rename(stage, journalPath);
    await syncParent(journalPath); journalHash = hash(data); await remember(journalPath);
  }
  async function retain(label, bytes, extension = "json") {
    need(/^[a-z0-9-]+$/.test(label) && /^[a-z0-9]+$/.test(extension), "Keep original portable output names.");
    const data = Buffer.from(bytes), id = hash(data), path = join(root, label + "-" + id + "." + extension);
    await putExact(path, data); await remember(path);
    const descriptor = { path, bytes: data.length, sha256: id };
    journal.files[label] = descriptor; await commit(); return descriptor;
  }
  async function readSaved(label) {
    const row = journal.files[label]; need(row, "The original " + label + " output has not been retained.");
    need(dirname(row.path) === root, "Keep output under this original directory.");
    const bytes = await ordinary(row.path);
    need(bytes.length === row.bytes && hash(bytes) === row.sha256, "The complete original " + label + " output changed.");
    return bytes;
  }
  async function screenshot(target, label) {
    const dimensions = await target.evaluate(() => ({
      width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth
    }));
    need(dimensions.documentWidth <= dimensions.width + 1, "The actual " + label + " view overflows its viewport.");
    const bytes = await target.screenshot({ fullPage: true }), file = await retain(label, bytes, "png");
    journal.captures.push({ ...file, label, dimensions }); await commit();
  }
  async function download(target, trigger, label, extension) {
    const transfer = target.waitForEvent("download", { timeout: 45000 }).then(value => ({ value }), error => ({ error }));
    try { await trigger(); } catch (error) { await transfer; throw error; }
    const result = await transfer; if (result.error) throw result.error;
    const failed = await result.value.failure(); need(!failed, "The actual download failed: " + failed);
    const temporary = join(root, ".download-" + randomUUID());
    try {
      await result.value.saveAs(temporary);
      return await retain(label, await ordinary(temporary), extension);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  async function exportNow(label) {
    if (journal.files[label]) {
      const bytes = await readSaved(label), checked = store.verifyBundle(bytes); selectedSource(checked, input);
      return { bytes, checked, descriptor: journal.files[label] };
    }
    let record = journal[label + "Record"];
    if (!record) {
      record = await client.exportWorkspace({ includeApplication: true });
      need(record.workspaceId === input.workspaceId && /^[a-f0-9]{64}$/.test(record.id), "Original export identity changed.");
      journal[label + "Record"] = record; await commit();
    }
    const path = join(root, label + "-" + record.id + ".json");
    await client.downloadExport(record.id, path); const bytes = await ordinary(path);
    need(hash(bytes) === record.id && bytes.length === record.bytes, "The actual original export download changed.");
    const checked = store.verifyBundle(bytes); selectedSource(checked, input);
    need(checked.state.workspaceId === input.workspaceId, "Export belongs to another workspace.");
    const descriptor = await retain(label, bytes); return { bytes, checked, descriptor };
  }
  const completePath = join(root, "recipient-return-complete.json");
  if (await exists(completePath)) {
    const prior = JSON.parse(await ordinary(completePath));
    need(prior.schema === SCHEMA && prior.complete === true && prior.inputSha256 === hash(json(input)),
      "The retained completed receiver belongs to a different input.");
    for (const [label] of Object.entries(journal.files)) await readSaved(label);
    const full = store.verifyBundle(await readSaved("complete-workspace")); selectedSource(full, input);
    const receivePath = join(root, "received-workspace");
    await verifyReceivedFiles(receivePath, full);
    const receiver = new store.LineageWorkspace(receivePath);
    need(equal(await receiver.read(), full.state), "The retained independent workspace differs from the complete export.");
    await remember(completePath); return prior;
  }
  await commit();
  const baseline = await exportNow("original-workspace"), before = baseline.checked.state;
  const review = (before.customerServiceReviews ?? []).find(row => row.id === input.reviewId);
  need(review?.contentSha256 === input.reviewSha256, "Select the exact original saved customer review.");
  const desk = page.locator(".review-return-desk");
  async function ready() {
    await desk.waitFor({ state: "visible", timeout: 45000 });
    await desk.getByRole("button", { name: "Download working copy", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const root = document.querySelector(".review-return-desk");
      const button = root && [...root.querySelectorAll("button")].find(el => el.textContent === "Download working copy");
      return button && !button.disabled;
    }, null, { timeout: 45000 });
  }
  async function click(name) { await desk.getByRole("button", { name, exact: true }).click(); await ready(); }
  async function workCopy(label) {
    await download(page, () => desk.getByRole("button", { name: "Download working copy", exact: true }).click(), label, "json");
    const value = JSON.parse(await readSaved(label));
    need(value.schema === "commons.openlineage.return-desk.v1" && value.workspaceId === input.workspaceId,
      "Downloaded working copy belongs to another original desk.");
    return value;
  }
  async function restoreOwnPending(copyValue) {
    const pending = copyValue.value.pending; if (!pending) return;
    const ours = pending.action === "review-return.request.save"
      ? pending.args.reviewId === input.reviewId && equal(pending.args.recipient, input.recipient) &&
        pending.args.requestedBy === input.requestedBy && pending.args.instructions === input.instructions
      : pending.action === "review-return.response.save" && journal.requestId === pending.args.requestId &&
        pending.args.receivedBy === input.receivedBy && pending.args.operatorNote === input.operatorNote &&
        journal.files["recipient-response"] && pending.args.originalText === (await readSaved("recipient-response")).toString("utf8");
    need(ours, "Preserve the different original pending request before this course continues.");
    await click("Replay original save");
    const next = await workCopy("operator-recovered");
    need(!next.value.pending, "The original pending request remains unresolved; retain its exact body.");
  }
  await openDesk({ page, workspaceId: input.workspaceId, reviewId: input.reviewId });
  await ready();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await restoreOwnPending(await workCopy("operator-before"));
  let state = await workspace.read(); need(state.workspaceId === input.workspaceId, "Original workspace changed.");
  const candidates = (state.customerReviewReturns?.requests ?? []).filter(row =>
    row.source.reviewId === input.reviewId && row.recipient.reference === input.recipient.reference);
  need(candidates.length <= 1, "The selected original reference names more than one request.");
  let savedRequest = candidates[0];
  if (savedRequest) {
    need(equal(savedRequest.recipient, input.recipient) && savedRequest.requestedBy === input.requestedBy &&
      savedRequest.instructions === input.instructions && savedRequest.source.review.contentSha256 === input.reviewSha256,
      "The existing recipient request differs from this original course.");
  } else {
    need(state.revision === before.revision, "A different operation advanced the original workspace before the request.");
    await desk.getByLabel("Saved customer review", { exact: true }).selectOption(input.reviewId);
    await desk.getByLabel("Recipient name", { exact: true }).fill(input.recipient.name);
    await desk.getByLabel("Organisation", { exact: true }).fill(input.recipient.organisation);
    await desk.getByLabel("Recipient reference", { exact: true }).fill(input.recipient.reference);
    await desk.getByLabel("Requesting operator", { exact: true }).fill(input.requestedBy);
    await desk.getByLabel("Review instructions", { exact: true }).fill(input.instructions);
    await click("Preview complete request");
    await screenshot(page, "operator-request-preview-desktop");
    await click("Save recipient request");
    state = await workspace.read();
    const found = (state.customerReviewReturns?.requests ?? []).filter(row =>
      row.source.reviewId === input.reviewId && row.recipient.reference === input.recipient.reference);
    need(found.length === 1, "Open the exact native request result before continuing."); savedRequest = found[0];
  }
  journal.requestId = savedRequest.id; journal.requestOperationId = savedRequest.operationId; await commit();
  await retain("saved-request", json(savedRequest));
  need(equal(input.reply.items.map(row => row.itemId).sort(), savedRequest.source.items.map(row => row.id).sort()),
    "Choose one actual response for every original selected item, with no omissions.");
  await desk.getByLabel("Saved request", { exact: true }).selectOption(savedRequest.id);
  if (!journal.files["recipient-original"]) await download(page,
    () => desk.getByRole("button", { name: "Download editable recipient review", exact: true }).click(),
    "recipient-original", "html");
  await readSaved("recipient-original");
  const recipientPage = await page.context().newPage();
  const dialog = async d => {
    if (d.type() === "beforeunload") return d.accept();
    if (d.type() === "confirm" && /^Replace the entries currently in this page with the selected complete file\?$/.test(d.message())) return d.accept();
    return d.dismiss();
  };
  recipientPage.on("dialog", dialog);
  try {
    await recipientPage.goto(pathToFileURL(journal.files["recipient-original"].path).href, { waitUntil: "domcontentloaded" });
    await recipientPage.locator("#review-editor").waitFor({ state: "visible" });
    const seed = await recipientPage.locator("#review-data").textContent();
    need(equal(JSON.parse(seed).request, savedRequest), "The actual editable download changed the original recipient request.");
    if (!journal.files["recipient-response"]) {
      await recipientPage.getByLabel("Respondent name", { exact: true }).fill(input.reply.respondent.name);
      await recipientPage.getByLabel("Organisation", { exact: true }).fill(input.reply.respondent.organisation);
      await recipientPage.getByLabel("Role or reference", { exact: true }).fill(input.reply.respondent.role);
      await recipientPage.getByLabel("Overall response", { exact: true }).selectOption(input.reply.overall);
      await recipientPage.getByLabel("Overall comments", { exact: true }).fill(input.reply.comment);
      for (let index = 0; index < savedRequest.source.items.length; index++) {
        const original = savedRequest.source.items[index], response = input.reply.items.find(row => row.itemId === original.id);
        const item = recipientPage.locator("#review-editor article").nth(index);
        await item.getByLabel("Your response", { exact: true }).selectOption(response.response);
        await item.getByLabel("Comment or proposed change", { exact: true }).fill(response.comment);
        await item.locator("summary").click();
        need(equal(JSON.parse(await item.locator("pre").textContent()), original.source), "The displayed original item differs.");
      }
      await download(recipientPage, () => recipientPage.locator("#return-json").click(), "recipient-response", "json");
      await download(recipientPage, () => recipientPage.locator("#working-json").click(), "recipient-working", "json");
      await download(recipientPage, () => recipientPage.locator("#editable-html").click(), "recipient-edited", "html");
    } else {
      await recipientPage.locator("#import").setInputFiles(journal.files["recipient-response"].path);
      await recipientPage.waitForFunction(() => document.getElementById("status").textContent === "Complete selected working copy opened.");
      if (!journal.files["recipient-working"]) await download(recipientPage, () => recipientPage.locator("#working-json").click(), "recipient-working", "json");
      if (!journal.files["recipient-edited"]) await download(recipientPage, () => recipientPage.locator("#editable-html").click(), "recipient-edited", "html");
    }
    const responseBytes = await readSaved("recipient-response"), response = JSON.parse(responseBytes);
    need(response.workspaceId === input.workspaceId && response.requestId === savedRequest.id &&
      response.requestSha256 === savedRequest.contentSha256 &&
      equal({ respondent: response.respondent, overall: response.overall, comment: response.comment,
        items: response.items.map(({ itemId, response, comment }) => ({ itemId, response, comment })) },
        { ...input.reply, items: savedRequest.source.items.map(item => input.reply.items.find(row => row.itemId === item.id)) }),
      "The actual downloaded response differs from the entered complete response.");
    await recipientPage.setViewportSize({ width: 1440, height: 1000 }); await screenshot(recipientPage, "recipient-desktop");
    await recipientPage.setViewportSize({ width: 390, height: 844 }); await screenshot(recipientPage, "recipient-phone");
    for (const [kind, path] of [
      ["working", journal.files["recipient-working"].path], ["response", journal.files["recipient-response"].path]
    ]) {
      await recipientPage.goto(pathToFileURL(journal.files["recipient-original"].path).href, { waitUntil: "domcontentloaded" });
      await recipientPage.locator("#import").setInputFiles(path);
      await recipientPage.waitForFunction(() => document.getElementById("status").textContent === "Complete selected working copy opened.");
      const reopened = await download(recipientPage, () => recipientPage.locator("#return-json").click(), "recipient-reopened-" + kind, "json");
      need((await ordinary(reopened.path)).equals(responseBytes), "Reopening changed the original response identity or complete bytes.");
    }
    await recipientPage.goto(pathToFileURL(journal.files["recipient-edited"].path).href, { waitUntil: "domcontentloaded" });
    await recipientPage.locator("#review-editor").waitFor({ state: "visible" });
    const editedSeed = JSON.parse(await recipientPage.locator("#review-data").textContent());
    need(equal(editedSeed.request, savedRequest) && equal(editedSeed.exported?.value, response), "The edited HTML lost the full source or returned identity.");
    const reopened = await download(recipientPage, () => recipientPage.locator("#return-json").click(), "recipient-reopened-html", "json");
    need((await ordinary(reopened.path)).equals(responseBytes), "The actual reopened editable file changed its complete response.");
  } finally { recipientPage.off("dialog", dialog); await recipientPage.close({ runBeforeUnload: false }); }
  state = await workspace.read();
  const responseText = (await readSaved("recipient-response")).toString("utf8"), responseObject = JSON.parse(responseText);
  let savedResponse = (state.customerReviewReturns?.responses ?? []).find(row =>
    row.requestId === savedRequest.id && row.response.responseId === responseObject.responseId);
  if (!savedResponse) {
    await desk.getByLabel("Returned response JSON", { exact: true }).setInputFiles(journal.files["recipient-response"].path);
    await ready();
    await desk.getByLabel("Receiving operator", { exact: true }).fill(input.receivedBy);
    await desk.getByLabel("Operator note", { exact: true }).fill(input.operatorNote);
    await click("Preview returned response");
    await page.setViewportSize({ width: 1440, height: 1000 }); await screenshot(page, "operator-return-preview-desktop");
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, "operator-return-preview-phone");
    await click("Retain reviewed response");
    state = await workspace.read();
    savedResponse = (state.customerReviewReturns?.responses ?? []).find(row =>
      row.requestId === savedRequest.id && row.response.responseId === responseObject.responseId);
    need(savedResponse, "The original response has not been admitted; inspect its retained exact request.");
  }
  need(savedResponse.originalText === responseText && savedResponse.receivedBy === input.receivedBy &&
    savedResponse.operatorNote === input.operatorNote, "The saved return differs from the complete selected file/operator attribution.");
  journal.responseId = savedResponse.id; journal.responseOperationId = savedResponse.operationId; await commit();
  await retain("saved-response", json(savedResponse));
  const after = await workspace.read(); originalStateUnchanged(before, after, savedRequest, savedResponse);
  await desk.getByLabel("Saved request", { exact: true }).selectOption(savedRequest.id);
  await click("Open complete history");
  await page.setViewportSize({ width: 1440, height: 1000 }); await screenshot(page, "operator-history-desktop");
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, "operator-history-phone");
  await download(page, () => desk.getByRole("button", { name: "Download full history JSON", exact: true }).click(), "history-json", "json");
  await download(page, () => desk.getByRole("button", { name: "Download printable history", exact: true }).click(), "history-html", "html");
  const history = JSON.parse(await readSaved("history-json"));
  need(equal(history.request, savedRequest) && history.responses.some(row => equal(row, savedResponse)),
    "The complete history download omitted the original request/returned response.");
  const historyPage = await page.context().newPage();
  try {
    await historyPage.goto(pathToFileURL(journal.files["history-html"].path).href, { waitUntil: "domcontentloaded" });
    await historyPage.setViewportSize({ width: 1440, height: 1000 }); await screenshot(historyPage, "history-file-desktop");
    await historyPage.setViewportSize({ width: 390, height: 844 }); await screenshot(historyPage, "history-file-phone");
  } finally { await historyPage.close(); }
  const working = await workCopy("operator-complete");
  need(!working.value.pending, "The original UI still has an unresolved native save.");
  const acceptedBodies = [
    { action: "review-return.request.save", args: {
      reviewId: savedRequest.source.reviewId, recipient: copy(savedRequest.recipient),
      instructions: savedRequest.instructions, requestedBy: savedRequest.requestedBy,
      expectedRevision: savedRequest.savedRevision - 1, expectedPreviewSha256: savedRequest.previewSha256,
      operationId: savedRequest.operationId
    } },
    { action: "review-return.response.save", args: {
      requestId: savedResponse.requestId, originalText: savedResponse.originalText,
      receivedBy: savedResponse.receivedBy, operatorNote: savedResponse.operatorNote,
      expectedRevision: savedResponse.savedRevision - 1, expectedPreviewSha256: savedResponse.expectedPreviewSha256,
      operationId: savedResponse.operationId
    } }
  ];
  // The immutable accepted records retain every request field. This also recovers
  // an accepted result after the original browser profile is lost, without a new ID.
  for (const body of acceptedBodies) {
    const browser = working.value.history.find(row => row.pending?.args?.operationId === body.args.operationId);
    if (browser) need(browser.pending.action === body.action && equal(browser.pending.args, body.args),
      "The retained browser body differs from its original accepted native record.");
    const operation = await client.action("review-return.operation.get", {
      operationId: body.args.operationId, expectedRevision: body.args.expectedRevision
    });
    need(operation.operation?.id === body.args.operationId, "The accepted original native operation is missing.");
    const result = await client.action(body.action, body.args);
    need(result.replayed === true && result.operationId === body.args.operationId,
      "The original complete native save did not replay its accepted operation.");
  }
  await retain("accepted-save-bodies", json(acceptedBodies));
  need(equal(await workspace.read(), after), "Replaying the original request changed native state.");
  const complete = await exportNow("complete-workspace");
  need(equal(complete.checked.state, after), "The final complete export differs from the operated workspace.");
  const receivePath = join(root, "received-workspace");
  if (!await exists(receivePath)) await store.receiveBundle(complete.bytes, receivePath);
  await verifyReceivedFiles(receivePath, complete.checked);
  const receivingStore = await import(pathToFileURL(join(receivePath, "application", "store.mjs")).href);
  const independent = new receivingStore.LineageWorkspace(receivePath);
  need(equal(await independent.read(), after), "The received original workspace changed state or history.");
  const reopenedHistory = await independent.dispatch("review-return.get", { requestId: savedRequest.id });
  need(equal(reopenedHistory.request, savedRequest) && reopenedHistory.responses.some(row => equal(row, savedResponse)),
    "Cold receiving lost original recipient history.");
  const independentExport = await independent.exportBundle({ includeApplication: true });
  const receivedExportPath = join(receivePath, "exports", independentExport.id + ".json");
  const receivedBytes = await ordinary(receivedExportPath); receivingStore.verifyBundle(receivedBytes);
  need(receivedBytes.equals(complete.bytes), "Independent receiving/re-export changed complete state, objects or source.");
  await remember(join(receivePath, "workspace.json")); await remember(join(receivePath, "received.json")); await remember(receivedExportPath);
  await retain("received-reexport", receivedBytes);
  journal.complete = true; journal.completedAt = new Date().toISOString(); await commit();
  const result = {
    schema: SCHEMA, complete: true, operationId: input.operationId, inputSha256: hash(json(input)),
    workspaceId: input.workspaceId, originalRevision: before.revision, revision: after.revision,
    reviewId: input.reviewId, reviewSha256: input.reviewSha256,
    requestId: savedRequest.id, responseId: savedResponse.id, returnedResponseId: responseObject.responseId,
    originalOperationIds: before.operations.map(row => row.id),
    requestOperationId: savedRequest.operationId, responseOperationId: savedResponse.operationId,
    source: copy(input.source), files: copy(journal.files), captures: copy(journal.captures),
    independentDirectory: receivePath, completeExportSha256: hash(complete.bytes),
    completedAt: journal.completedAt
  };
  await putExact(completePath, json(result)); await remember(completePath); return result;
}
