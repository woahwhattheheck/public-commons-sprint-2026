(() => {
"use strict";
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const pretty = value => JSON.stringify(value, null, 2);
const stable = value => JSON.stringify(value, function (key, item) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]));
  }
  return item;
});
const S = {
  data: null, csrf: "", connected: false, tab: "overview", stateBusy: false,
  requestBusy: false, savePending: false, reviewEpoch: 0, rawEpoch: 0, rawDirty: false,
  savedReview: null, draftReview: null, baseSelection: null,
  previewSeq: 0, preview: null, offset: 0, selectedRecords: new Set(),
  recordRow: null, recordForm: null, recordDirty: false, recordEpoch: 0,
  destinationDrafts: {}, provider: "roda", destinationEpoch: 0,
  destinationTouched: false, selectedMigration: null, pendingSelection: null,
  migrationSeq: 0, migration: null, migrationBusy: false,
  renderedMigrations: "", renderedArtifacts: "", renderedActivity: "",
  renderedHistory: "", externalReview: false, timer: null, searchTimer: null
};
function element(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "hidden") node.hidden = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  return node;
}
function replace(id, nodes) { $(id).replaceChildren(...nodes); }
function emptyRow(columns, message) {
  const row = element("tr"); row.append(element("td", message, {colspan: columns, class: "empty"})); return row;
}
function describe(id, pairs) {
  replace(id, pairs.flatMap(([key, value]) => [
    element("dt", key), element("dd", typeof value === "string" ? value : pretty(value))
  ]));
}
function shortHash(value) { return value ? String(value).slice(0, 16) : "—"; }
function size(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KiB";
  if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(2) + " MiB";
  return (value / (1024 * 1024 * 1024)).toFixed(2) + " GiB";
}
function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString();
}
function message(value, details) {
  $("message-text").textContent = value + (details && Object.keys(details).length ? "\n" + pretty(details) : "");
  $("message-text").style.whiteSpace = "pre-wrap";
  $("message").hidden = false;
}
function report(error) {
  message(error.message || String(error), error.details);
  console.error(error);
}
function dismiss() { $("message").hidden = true; }
function on(id, event, handler) {
  $(id).addEventListener(event, ev => {
    try { Promise.resolve(handler(ev)).catch(report); } catch (error) { report(error); }
  });
}
async function api(path, body) {
  const options = {headers: {"Accept": "application/json"}, credentials: "same-origin", cache: "no-store"};
  if (body !== undefined) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.headers["X-Workspace-Token"] = S.csrf;
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  let value;
  try { value = await response.json(); }
  catch (_) { throw new Error("The workspace returned an unreadable response. Refresh its current state before continuing."); }
  if (!response.ok || value.error) {
    const error = new Error(value.message || value.error || ("Workspace request failed: " + response.status));
    error.code = value.error; error.details = value.details || {}; error.status = response.status;
    throw error;
  }
  return value;
}
async function mutation(path, body) {
  if (S.requestBusy) throw new Error("The current operator request is being saved.");
  if (!S.connected) throw new Error("Reconnect to the workspace before starting an operator action.");
  S.requestBusy = true; renderControls();
  try {
    const value = await api(path, body);
    if (value.queued) {
      message("Queued " + value.job.kind + ". Its original operation and outcome appear in Activity.");
    }
    return value;
  } finally { S.requestBusy = false; renderControls(); }
}
function reviewChoice(selection) { return selection.revision + ":" + selection.reviewSha256; }
function selectionOf(status) {
  return {sourceManifestSha256: status.project.binding.manifestSha256,
    revision: status.revision, reviewSha256: status.reviewSha256};
}
function reviewDirty() {
  return Boolean(S.draftReview && (S.rawDirty || S.recordDirty ||
    stable(S.draftReview) !== stable(S.savedReview)));
}
function completeDraft() {
  if (!S.draftReview) throw new Error("Receive an original edition before reviewing records.");
  if (S.recordDirty) throw new Error("Apply or discard the open record edit first.");
  if (S.rawDirty) throw new Error("Apply the complete review JSON to the draft, or reload it from the draft first.");
}
function savedSelection(id) {
  if (!S.data?.initialized) throw new Error("Receive an original edition first.");
  if (reviewDirty()) throw new Error("Save the review draft before preparing a package or destination.");
  const value = $(id).value;
  if (value === "current") return selectionOf(S.data.status);
  const item = (S.data.reviewHistory || []).find(entry => reviewChoice(entry.selection) === value);
  if (!item) throw new Error("Select a retained saved review.");
  return clone(item.selection);
}
function switchTab(tab, focus = false) {
  if (!["overview", "records", "destinations", "delivery", "activity"].includes(tab)) return;
  S.tab = tab;
  for (const button of document.querySelectorAll("[data-tab]")) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $("page-" + button.dataset.tab).hidden = !selected;
    if (selected && focus) button.focus();
  }
  if (tab === "records" && S.data?.initialized && !S.preview) refreshPreview().catch(report);
  if (tab === "destinations" && S.selectedMigration) refreshMigration().catch(report);
}
function syncReviewWidgets() {
  $("review-note").value = S.draftReview?.note || "";
  if (!S.rawDirty) $("review-json").value = S.draftReview ? pretty(S.draftReview) : "";
}
function adoptReview(status) {
  S.savedReview = clone(status.review);
  S.draftReview = clone(status.review);
  S.baseSelection = selectionOf(status);
  S.reviewEpoch += 1;
  S.rawDirty = false;
  S.externalReview = false;
  S.recordDirty = false;
  S.recordRow = null; S.recordForm = null; S.recordEpoch += 1;
  S.preview = null; S.previewSeq += 1;
  $("record-editor").hidden = true; $("record-empty").hidden = false;
  syncReviewWidgets();
}
function mergeState(value) {
  const prior = S.data;
  if (prior?.initialized && value.initialized) {
    if (prior.status.project.binding.manifestSha256 !== value.status.project.binding.manifestSha256) {
      throw new Error("This browser is attached to a different original edition. Reopen the workspace page.");
    }
    if (value.status.revision < prior.status.revision) {
      value.status = prior.status;
      value.reviewHistory = prior.reviewHistory;
    }
  }
  S.data = value; S.csrf = value.csrf; S.connected = true;
  if (value.initialized) {
    if (!S.draftReview) adoptReview(value.status);
    else if (S.baseSelection.revision !== value.status.revision ||
             S.baseSelection.reviewSha256 !== value.status.reviewSha256) {
      if (!reviewDirty() && !S.savePending) adoptReview(value.status);
      else S.externalReview = true;
    }
  }
  if (S.pendingSelection && value.migrations.some(item => item.id === S.pendingSelection)) {
    const operation = S.pendingSelection; S.pendingSelection = null;
    selectMigration(operation);
  }
  renderState();
  const completed = prior?.active && !value.active;
  if ((!prior?.initialized && value.initialized) || completed || (value.initialized && !S.preview)) {
    if (value.initialized) refreshPreview().catch(report);
  }
  if (S.selectedMigration && S.tab === "destinations") refreshMigration().catch(report);
}
async function refreshState(quiet = false) {
  if (S.stateBusy) return;
  S.stateBusy = true;
  try { mergeState(await api("/api/state")); }
  catch (error) {
    S.connected = false;
    $("connection").textContent = "DISCONNECTED";
    $("footer-status").textContent = "The browser will reconnect to this original workspace.";
    renderControls();
    if (!quiet) throw error;
  } finally { S.stateBusy = false; }
}
function renderState() {
  const data = S.data;
  $("connection").textContent = data.active ? "WORKING" : "CONNECTED";
  $("workspace-path").textContent = data.workspace;
  $("source-intake").hidden = data.initialized;
  $("overview-ready").hidden = !data.initialized;
  if (data.initialized) {
    const status = data.status, project = status.project;
    $("source-count").textContent = status.sourceRecords.toLocaleString();
    $("included-count").textContent = status.includedRecords.toLocaleString();
    $("excluded-count").textContent = status.excludedRecords.toLocaleString();
    $("revision-count").textContent = "r" + status.revision;
    describe("source-details", [
      ["Organization", project.organization || "—"], ["Contact", project.contact || "—"],
      ["Received", date(project.createdAt)], ["Source manifest", project.binding.manifestSha256],
      ["Saved review", status.reviewSha256], ["Source field issues", status.sourceFieldIssues || {}]
    ]);
    $("source-identity").textContent = pretty(project);
  }
  const active = data.jobs.find(job => job.id === data.active);
  $("active-notice").hidden = !data.active;
  $("active-notice").textContent = active
    ? active.kind + " · " + active.state + " · Original job " + active.id
    : "The original workspace action is running.";
  $("external-review").hidden = !S.externalReview;
  $("external-review").textContent = "The saved catalogue has advanced to r" + data.status?.revision +
    ". Your draft is retained against r" + S.baseSelection?.revision +
    ". Save will check the original revision; reload the saved review to replace this draft.";
  $("footer-status").textContent = data.initialized
    ? "Original edition " + shortHash(data.status.project.binding.manifestSha256) +
      " · Saved review r" + data.status.revision + " · " + data.migrations.length + " saved destinations"
    : "Receive an original research edition to open the review and destination workflow.";
  renderHistory();
  renderDestinationList();
  ensureDestinationDraft();
  renderArtifacts();
  renderActivity();
  renderControls();
}
function renderHistory() {
  if (!S.data?.initialized) return;
  const history = S.data.reviewHistory || [];
  const identity = stable({current: S.data.status.reviewSha256, history});
  if (identity === S.renderedHistory) return;
  S.renderedHistory = identity;
  for (const select of document.querySelectorAll("[data-review-select]")) {
    const selected = select.value || "current";
    const current = element("option", "Current saved review · r" + S.data.status.revision, {value: "current"});
    select.replaceChildren(current, ...history.map(item => element("option",
      "Saved r" + item.selection.revision + " · " + date(item.createdAt) +
      (item.note ? " · " + item.note.slice(0, 70) : ""), {value: reviewChoice(item.selection)})));
    select.value = [...select.options].some(option => option.value === selected) ? selected : "current";
  }
  updateDestinationSelection();
}
function renderControls() {
  const initialized = Boolean(S.data?.initialized);
  const busy = Boolean(S.data?.active || S.requestBusy);
  const dirty = reviewDirty();
  $("initialize").disabled = !S.connected || busy;
  $("save-review").disabled = !initialized || !S.connected || S.requestBusy || S.savePending ||
    S.recordDirty || S.rawDirty || stable(S.draftReview) === stable(S.savedReview);
  $("save-review").textContent = S.savePending ? "Saving review…" : "Save review";
  $("reload-review").disabled = !initialized || S.savePending;
  $("review-note").disabled = !initialized || S.rawDirty;
  $("refresh-preview").disabled = !initialized || S.rawDirty || S.requestBusy;
  $("record-query").disabled = !initialized;
  $("record-filter").disabled = !initialized;
  $("review-json").disabled = !initialized;
  $("apply-review-json").disabled = !initialized || !S.rawDirty || S.recordDirty || S.requestBusy;
  $("reset-review-json").disabled = !initialized;
  const available = Boolean(S.data?.providers?.[S.provider]?.available);
  $("prepare-destination").disabled = !initialized || !S.connected || busy || dirty || !available;
  $("build-package").disabled = !initialized || !S.connected || busy || dirty;
  $("export-workspace").disabled = !initialized || !S.connected || busy || dirty;
  for (const id of ["run-migration", "refresh-migration", "resume-preparation", "reconcile-migration"]) {
    $(id).disabled = !S.selectedMigration || !S.connected || busy;
  }
  $("previous-page").disabled = !S.preview || S.offset === 0;
  $("next-page").disabled = !S.preview || S.offset + S.preview.limit >= S.preview.total;
  const selected = S.selectedRecords.size;
  $("exclude-selected").disabled = !selected || S.recordDirty || S.rawDirty;
  $("include-selected").disabled = !selected || S.recordDirty || S.rawDirty;
  $("clear-selection").disabled = !selected;
  $("selection-count").textContent = selected + " selected across the current search pages.";
  $("record-dirty").hidden = !S.recordDirty;
  $("apply-record").disabled = !S.recordForm || !S.recordDirty || S.rawDirty;
  $("record-include").disabled = $("record-reason").disabled = S.rawDirty;
  for (const input of $("field-editors").querySelectorAll("textarea,button")) input.disabled = S.rawDirty;
  $("discard-record-edit").disabled = !S.recordDirty;
  $("review-status").textContent = !initialized ? "Receive an original edition to start." :
    "Draft based on saved r" + S.baseSelection.revision + " · " +
    (S.recordDirty ? "Apply the open record edit" : S.rawDirty ? "Complete review JSON has unapplied edits" :
      dirty ? "Unsaved review changes" : "All review changes saved");
  $("destination-draft-status").textContent = dirty
    ? "Save the record review before preparing this destination."
    : S.destinationTouched ? "Destination entries have unsaved changes. Preparation saves this exact selection." :
      "Destination entries are a local draft until preparation is saved.";
}
function markReviewChanged() {
  S.reviewEpoch += 1;
  if (!S.rawDirty) $("review-json").value = pretty(S.draftReview);
  renderControls();
}
async function refreshPreview() {
  if (!S.data?.initialized || !S.draftReview || S.rawDirty) return;
  const sequence = ++S.previewSeq, epoch = S.reviewEpoch;
  const query = $("record-query").value, filter = $("record-filter").value, offset = S.offset;
  const preview = await api("/api/preview", {review: clone(S.draftReview), query, filter, offset});
  if (sequence !== S.previewSeq || epoch !== S.reviewEpoch || query !== $("record-query").value ||
      filter !== $("record-filter").value || offset !== S.offset) return;
  if (preview.total && offset >= preview.total) {
    S.offset = Math.floor((preview.total - 1) / preview.limit) * preview.limit;
    return refreshPreview();
  }
  S.preview = preview;
  renderRecords();
  if (S.recordRow && !S.recordDirty) {
    const current = preview.rows.find(row => row.identifier === S.recordRow.identifier);
    if (current) openRecord(current, true);
    else await refreshRecordDetail();
  }
}
async function refreshRecordDetail() {
  if (!S.recordRow || S.recordDirty || S.rawDirty) return;
  const identifier = S.recordRow.identifier, epoch = S.reviewEpoch, recordEpoch = S.recordEpoch;
  const value = await api("/api/preview", {review: clone(S.draftReview),
    query: "id:" + identifier, filter: "all", offset: 0});
  if (epoch !== S.reviewEpoch || recordEpoch !== S.recordEpoch || S.recordDirty ||
      identifier !== S.recordRow?.identifier) return;
  const row = value.rows.find(item => item.identifier === identifier);
  if (row) openRecord(row, true);
}
function renderRecords() {
  const preview = S.preview;
  if (!preview) return;
  $("record-summary").textContent = preview.counts.source + " original · " +
    preview.counts.included + " included · " + preview.counts.excluded + " excluded in this draft";
  const nodes = preview.rows.map(row => {
    const tr = element("tr", null, {class: S.recordRow?.identifier === row.identifier ? "selected" : ""});
    const chosen = element("input", null, {type: "checkbox", "aria-label": "Select " + row.identifier});
    chosen.checked = S.selectedRecords.has(row.identifier);
    chosen.addEventListener("change", () => {
      if (chosen.checked) S.selectedRecords.add(row.identifier); else S.selectedRecords.delete(row.identifier);
      renderSelection(); renderControls();
    });
    const choice = element("td"); choice.append(chosen);
    const record = element("td", null, {class: "long"});
    const title = element("button", row.identifier, {type: "button", class: "record-button"});
    title.addEventListener("click", () => { try { openRecord(row); } catch (error) { report(error); } });
    record.append(title, element("span", (row.reviewedDc.title || []).join("; "), {class: "record-title"}));
    if (row.reviewedDc.creator?.length) record.append(element("span", row.reviewedDc.creator.join("; "), {class: "record-sub"}));
    tr.append(choice, record, element("td", row.include ? "Yes" : "No", {class: "short"}),
      element("td", row.decision ? (Object.keys(row.decision.fields || {}).length + " fields · " +
        (row.decision.reason || "Inclusion decision")) : "Source values", {class: "long"}));
    return tr;
  });
  replace("record-rows", nodes.length ? nodes : [emptyRow(4, "No records match this search and filter.")]);
  $("page-label").textContent = preview.total
    ? (preview.offset + 1) + "–" + (preview.offset + preview.rows.length) + " of " + preview.total + " matches"
    : "0 matching records";
  renderSelection(); renderControls();
}
function renderSelection() {
  const rows = S.preview?.rows || [];
  const count = rows.filter(row => S.selectedRecords.has(row.identifier)).length;
  $("select-page").checked = Boolean(rows.length && count === rows.length);
  $("select-page").indeterminate = count > 0 && count < rows.length;
  $("select-page").disabled = !rows.length;
}
function recordChanged() { S.recordDirty = true; S.recordEpoch += 1; renderControls(); }
function openRecord(row, refresh = false) {
  if (!refresh && S.recordDirty && !window.confirm("Discard the open record edit and inspect this record?")) return;
  if (!refresh && S.rawDirty) throw new Error("Apply or reload the complete review JSON before opening a record.");
  S.recordRow = clone(row);
  const decision = S.draftReview.decisions.find(item => item.identifier === row.identifier) ||
    {identifier: row.identifier, include: true, fields: {}, reason: ""};
  S.recordEpoch += 1;
  S.recordForm = {identifier: row.identifier, include: decision.include !== false,
    reason: decision.reason || "", fields: Object.fromEntries(Object.entries(decision.fields || {})
      .map(([key, values]) => [key, pretty(values)]))};
  S.recordDirty = false;
  $("record-heading").textContent = (row.reviewedDc.title || [row.identifier]).join("; ");
  $("record-identity").textContent = row.identifier + "\n" + row.payloadPath;
  $("record-include").checked = S.recordForm.include;
  $("record-reason").value = S.recordForm.reason;
  $("record-empty").hidden = true; $("record-editor").hidden = false;
  renderFieldEditors();
  const fields = [...new Set([...Object.keys(row.originalDc), ...Object.keys(row.reviewedDc)])].sort();
  replace("metadata-rows", fields.map(field => {
    const tr = element("tr");
    const original = element("td", (row.originalDc[field] || []).join("\n\n"), {class: "break"});
    const reviewed = element("td", (row.reviewedDc[field] || []).join("\n\n"), {class: "break"});
    original.style.whiteSpace = reviewed.style.whiteSpace = "pre-wrap";
    tr.append(element("td", field, {class: "short"}), original, reviewed); return tr;
  }));
  $("record-source-details").textContent = pretty({sourceWorkType: row.sourceWorkType,
    sourceResourceRights: row.sourceResourceRights, issues: row.issues, source: row.source});
  for (const tr of $("record-rows").rows) {
    const button = tr.querySelector(".record-button");
    tr.classList.toggle("selected", button?.textContent === row.identifier);
  }
  renderControls();
}
function renderFieldEditors() {
  const fields = S.recordForm?.fields || {};
  replace("field-editors", Object.keys(fields).sort().map(field => {
    const row = element("div", null, {class: "field-editor-row"});
    const inputId = "correction-" + field;
    const label = element("label", field, {for: inputId});
    const input = element("textarea", null, {id: inputId, class: "code", spellcheck: "false", rows: "3"});
    input.value = fields[field];
    input.addEventListener("input", () => { S.recordForm.fields[field] = input.value; recordChanged(); });
    const remove = element("button", "Remove", {type: "button", "aria-label": "Remove " + field + " correction"});
    remove.addEventListener("click", () => {
      delete S.recordForm.fields[field]; recordChanged(); renderFieldEditors();
    });
    row.append(label, input, remove); return row;
  }));
  const remaining = (S.data?.editableFields || []).filter(field => !(field in fields));
  replace("field-select", remaining.map(field => element("option", field, {value: field})));
  $("add-field").disabled = !remaining.length;
}
function parseObject(text, label) {
  let value;
  try { value = JSON.parse(text); } catch (error) { throw new Error(label + " is not valid JSON: " + error.message); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be a JSON object.");
  return value;
}
function putDecision(decision) {
  const rest = S.draftReview.decisions.filter(item => item.identifier !== decision.identifier);
  if (!decision.include || Object.keys(decision.fields).length || decision.reason) rest.push(decision);
  rest.sort((a, b) => a.identifier.localeCompare(b.identifier));
  S.draftReview.decisions = rest;
}
async function applyRecord(event) {
  event.preventDefault();
  if (!S.recordForm) return;
  if (S.rawDirty) throw new Error("Apply or reload the complete review JSON first.");
  const form = S.recordForm, fields = {};
  for (const [field, input] of Object.entries(form.fields)) {
    let values;
    try { values = JSON.parse(input); } catch (error) { throw new Error(field + " requires a JSON array of strings: " + error.message); }
    if (!Array.isArray(values) || values.some(value => typeof value !== "string" || !value.trim())) {
      throw new Error(field + " requires a JSON array of nonempty strings; use [] to clear an editable field.");
    }
    fields[field] = values;
  }
  const include = $("record-include").checked, reason = $("record-reason").value;
  if ((!include || Object.keys(fields).length) && !reason.trim()) {
    throw new Error("Enter a reason for the exclusion or metadata correction.");
  }
  putDecision({identifier: form.identifier, include, fields, reason});
  S.recordDirty = false; markReviewChanged();
  await refreshPreview();
  message("The record decision is in the review draft. Save the review to retain this revision.");
}
async function bulkDecision(include) {
  completeDraft();
  if (!S.selectedRecords.size) return;
  const reason = $("bulk-reason").value.trim();
  if (!reason) throw new Error("Enter the decision reason for the selected records.");
  for (const identifier of S.selectedRecords) {
    const prior = S.draftReview.decisions.find(item => item.identifier === identifier);
    putDecision({identifier, include, fields: clone(prior?.fields || {}), reason});
  }
  markReviewChanged(); await refreshPreview();
  message(S.selectedRecords.size + " inclusion decisions are in the review draft.");
}
async function saveReview() {
  completeDraft();
  if (S.savePending) return;
  const epoch = S.reviewEpoch, submitted = clone(S.draftReview), expected = S.baseSelection.revision;
  S.savePending = true; renderControls();
  try {
    const result = await mutation("/api/review", {review: submitted, expectedRevision: expected});
    const status = result.status;
    if (S.data?.initialized && status.revision >= S.data.status.revision) S.data.status = status;
    S.savedReview = clone(status.review);
    S.baseSelection = selectionOf(status);
    S.externalReview = Boolean(S.data?.status && S.data.status.revision > status.revision);
    if (epoch === S.reviewEpoch && !S.rawDirty) {
      S.draftReview = clone(status.review); syncReviewWidgets();
    }
    message("Saved review r" + status.revision + (epoch !== S.reviewEpoch || S.rawDirty || S.recordDirty
      ? ". Edits made while saving remain in the current draft." : "."));
    await refreshState();
    await refreshPreview();
  } finally { S.savePending = false; renderControls(); }
}
async function reloadReview() {
  if (reviewDirty() && !window.confirm("Replace the unsaved review and record edits with the current saved review?")) return;
  const epoch = S.reviewEpoch, rawEpoch = S.rawEpoch, recordEpoch = S.recordEpoch;
  const result = await api("/api/review");
  if (epoch !== S.reviewEpoch || rawEpoch !== S.rawEpoch || recordEpoch !== S.recordEpoch) {
    throw new Error("The draft changed while the saved review was loading. Your edits are retained; reload again when ready.");
  }
  const status = {...S.data.status, ...result.selection, review: result.review};
  if (status.revision < S.data.status.revision) throw new Error("The saved review advanced during reload. Refresh and reload its latest revision.");
  adoptReview(status);
  await refreshState(); await refreshPreview(); renderControls();
}
async function applyReviewJson() {
  if (S.recordDirty) throw new Error("Apply or discard the open record edit first.");
  const text = $("review-json").value, rawEpoch = S.rawEpoch, epoch = S.reviewEpoch;
  const review = parseObject(text, "Complete review");
  if (review.decisions === undefined) review.decisions = [];
  if (review.note === undefined) review.note = "";
  const query = $("record-query").value, filter = $("record-filter").value;
  const sequence = ++S.previewSeq;
  const preview = await api("/api/preview", {review, query, filter, offset: 0});
  if (rawEpoch !== S.rawEpoch || epoch !== S.reviewEpoch || text !== $("review-json").value || S.recordDirty) {
    throw new Error("The draft changed while the JSON was being checked. Your current edits are retained.");
  }
  S.draftReview = clone(review); S.rawDirty = false; S.offset = 0;
  S.recordRow = null; S.recordForm = null;
  $("record-editor").hidden = true; $("record-empty").hidden = false;
  markReviewChanged(); syncReviewWidgets();
  if (sequence === S.previewSeq && query === $("record-query").value && filter === $("record-filter").value) {
    S.preview = preview; renderRecords();
  } else await refreshPreview();
  message("The complete JSON is applied to the review draft. Save the review to retain it.");
}

function operationId() {
  const suffix = typeof crypto.randomUUID === "function" ? crypto.randomUUID().replaceAll("-", "").slice(0, 16) :
    [...crypto.getRandomValues(new Uint8Array(8))].map(value => value.toString(16).padStart(2, "0")).join("");
  return "preservation-" + new Date().toISOString().slice(0, 10).replaceAll("-", "") + "-" + suffix;
}
function makeDestinationDraft(provider) {
  const template = S.data?.providers?.[provider];
  if (!template?.available) return null;
  const settings = clone(template.settings), configuration = clone(template.configuration);
  const job = template.jobTemplate ? clone(template.jobTemplate) : null;
  const project = S.data?.status?.project;
  if (provider === "roda" && project) {
    if (settings.producer && !settings.producer.name) settings.producer.name = project.organization || "";
    if (settings.producer && !settings.producer.contact) settings.producer.contact = project.contact || "";
  }
  return {provider, id: operationId(), label: "", revision: "current",
    settings: pretty(settings), configuration: pretty(configuration),
    job: job ? pretty(job) : "", touched: false, epoch: 0};
}
function ensureDestinationDraft() {
  const template = S.data?.providers?.[S.provider];
  for (const option of $("destination-provider").options) {
    const provider = S.data?.providers?.[option.value];
    option.textContent = (provider?.label || option.value) + (provider?.available ? "" : " · source unavailable");
  }
  if (!S.destinationDrafts[S.provider] && template?.available) {
    S.destinationDrafts[S.provider] = makeDestinationDraft(S.provider);
    showDestinationDraft();
  }
}
function captureDestinationDraft() {
  const draft = S.destinationDrafts[S.provider];
  if (!draft) return;
  Object.assign(draft, {
    id: $("destination-id").value, label: $("destination-label").value,
    revision: $("destination-revision").value || "current",
    settings: $("destination-settings").value, configuration: $("destination-configuration").value,
    job: $("destination-job").value, touched: S.destinationTouched
  });
}
function showDestinationDraft() {
  const template = S.data?.providers?.[S.provider], draft = S.destinationDrafts[S.provider];
  $("destination-provider").value = S.provider;
  $("job-template-field").hidden = S.provider !== "roda";
  $("destination-settings-label").textContent = S.provider === "roda" ? "RODA submission agreement" : "Preservica OPEX package settings";
  $("provider-availability").hidden = Boolean(template?.available);
  $("provider-availability").textContent = "Install the complete " + (template?.label || S.provider) +
    " producer, client and guides to prepare this destination.";
  for (const [id, value] of [
    ["destination-id", draft?.id || ""], ["destination-label", draft?.label || ""],
    ["destination-settings", draft?.settings || ""], ["destination-configuration", draft?.configuration || ""],
    ["destination-job", draft?.job || ""]
  ]) $(id).value = value;
  const revision = draft?.revision || "current";
  $("destination-revision").value = [...$("destination-revision").options].some(option => option.value === revision) ? revision : "current";
  S.destinationTouched = Boolean(draft?.touched);
  updateDestinationSelection();
  renderControls();
}
function destinationChanged() {
  S.destinationTouched = true; S.destinationEpoch += 1;
  captureDestinationDraft();
  if (S.destinationDrafts[S.provider]) S.destinationDrafts[S.provider].epoch += 1;
  updateDestinationSelection(); renderControls();
}
function updateDestinationSelection() {
  if (!S.data?.initialized) { $("destination-selection").textContent = ""; return; }
  const value = $("destination-revision").value;
  const selection = value === "current" || !value ? selectionOf(S.data.status) :
    S.data.reviewHistory?.find(item => reviewChoice(item.selection) === value)?.selection;
  $("destination-selection").textContent = selection
    ? "Original source " + shortHash(selection.sourceManifestSha256) + " · Saved r" + selection.revision +
      " · Review " + shortHash(selection.reviewSha256)
    : "Select an available saved review.";
}
function newDestination() {
  captureDestinationDraft();
  S.selectedMigration = null; S.migration = null; S.migrationSeq += 1;
  $("saved-destination").hidden = true; $("destination-draft").hidden = false;
  renderDestinationList(true); showDestinationDraft();
}
function renderDestinationList(force = false) {
  if (!S.data) return;
  const identity = stable([S.data.migrations, S.selectedMigration]);
  if (!force && identity === S.renderedMigrations) return;
  S.renderedMigrations = identity;
  const migrations = [...S.data.migrations].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  replace("destination-list", migrations.length ? migrations.map(item => {
    const button = element("button", null, {type: "button", class: "destination-item",
      "aria-pressed": String(item.id === S.selectedMigration)});
    button.append(element("span", item.label, {class: "name"}),
      element("span", (S.data.providers[item.provider]?.label || item.provider) + " · Saved r" +
        item.selection.revision, {class: "meta"}), element("span", item.id, {class: "meta mono"}));
    button.addEventListener("click", () => selectMigration(item.id));
    return button;
  }) : [element("div", "No saved destinations. Prepare a destination from a saved review.", {class: "empty"})]);
}
function selectMigration(operation) {
  captureDestinationDraft();
  S.selectedMigration = operation; S.migration = null; S.migrationSeq += 1;
  $("destination-draft").hidden = true; $("saved-destination").hidden = false;
  $("migration-label").textContent = S.data?.migrations.find(item => item.id === operation)?.label || "Saved destination";
  $("migration-id").textContent = operation;
  $("migration-state").textContent = "LOADING";
  $("migration-progress").textContent = "";
  $("migration-configuration").textContent = "";
  $("migration-package").textContent = "";
  $("migration-progress-message").hidden = true;
  $("transfer-uuid").value = ""; $("job-id").value = ""; $("reconcile-json").value = "{}";
  replace("migration-summary", []);
  renderDestinationList(true); renderControls();
  refreshMigration().catch(report);
}
async function refreshMigration() {
  if (!S.selectedMigration || S.migrationBusy) return;
  S.migrationBusy = true;
  const operation = S.selectedMigration, sequence = ++S.migrationSeq;
  try {
    const result = await api("/api/migration?id=" + encodeURIComponent(operation));
    if (sequence !== S.migrationSeq || operation !== S.selectedMigration) return;
    S.migration = result; renderMigration();
  } finally {
    S.migrationBusy = false;
    if (operation !== S.selectedMigration && S.selectedMigration) refreshMigration().catch(report);
  }
}
function findScalar(value, names) {
  for (const name of names) {
    let cursor = value;
    for (const segment of name.split(".")) cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
    if (cursor !== null && cursor !== undefined && typeof cursor !== "object") return String(cursor);
  }
  return null;
}
function renderMigration() {
  const migration = S.migration;
  if (!migration || migration.id !== S.selectedMigration) return;
  const progress = migration.progress || {};
  const state = findScalar(progress, ["state", "status"]) || "PREPARED";
  $("migration-label").textContent = migration.label;
  $("migration-id").textContent = migration.id;
  $("migration-state").textContent = state;
  const pairs = [
    ["Destination", S.data?.providers[migration.provider]?.label || migration.provider],
    ["Original source", migration.selection.sourceManifestSha256],
    ["Saved review", "r" + migration.selection.revision + " · " + migration.selection.reviewSha256],
    ["Prepared", date(migration.createdAt)]
  ];
  const transfer = findScalar(progress, ["transfer.uploadId", "transfer.uuid", "transferUuid", "transferUuid.value"]);
  const job = findScalar(progress, ["ingest.processId", "job.id", "jobId", "jobId.value"]);
  const key = findScalar(progress, ["transfer.key"]);
  const verified = progress.readback?.verifiedRecords, total = progress.readback?.totalRecords;
  if (key) pairs.push(["Original object", key]);
  if (transfer) pairs.push(["Original upload / transfer", transfer]);
  if (job) pairs.push(["Original ingest / job", job]);
  if (Number.isFinite(verified) && Number.isFinite(total)) pairs.push(["Received records", verified + " / " + total + " verified"]);
  const retry = findScalar(progress, ["retryAt"]);
  if (retry) pairs.push(["Repository retry time", date(retry)]);
  describe("migration-summary", pairs);
  const notice = progress.message || (migration.operatorRunning ?
    "The original operator action is running. Its latest saved progress is shown below." : "");
  $("migration-progress-message").hidden = !notice;
  $("migration-progress-message").textContent = notice;
  $("migration-progress").textContent = pretty(progress);
  $("migration-configuration").textContent = pretty({
    id: migration.id, provider: migration.provider, sourceSelection: migration.selection,
    settings: migration.settings, configuration: migration.configuration, jobTemplate: migration.jobTemplate
  });
  $("migration-package").textContent = migration.package ? pretty(migration.package) :
    "Package details are available after the original preparation completes.";
  $("roda-evidence").hidden = migration.provider !== "roda";
  $("preservica-evidence").hidden = migration.provider !== "preservica";
  renderControls();
}
async function prepareDestination(event) {
  event.preventDefault();
  completeDraft();
  captureDestinationDraft();
  const provider = S.provider, draft = S.destinationDrafts[provider], epoch = draft?.epoch;
  if (!draft) throw new Error("Install the selected provider's complete source.");
  const request = {
    id: draft.id.trim(), provider, label: draft.label.trim(),
    selection: savedSelection("destination-revision"),
    settings: parseObject(draft.settings, "Package settings"),
    configuration: parseObject(draft.configuration, "Repository configuration"),
    jobTemplate: provider === "roda" ? parseObject(draft.job, "RODA ingest job template") : null
  };
  await mutation("/api/prepare", request);
  if (draft.epoch === epoch) {
    draft.touched = false;
    if (S.provider === provider) S.destinationTouched = false;
  }
  S.pendingSelection = request.id;
  await refreshState(); renderControls();
}
async function migrate(action) {
  const operation = S.selectedMigration;
  if (!operation) throw new Error("Select the original saved destination.");
  await mutation("/api/" + action, {operationId: operation});
  await refreshState(); await refreshMigration();
}
async function reconcileMigration(event) {
  event.preventDefault();
  const migration = S.migration;
  if (!migration || migration.id !== S.selectedMigration) throw new Error("Load the selected saved destination first.");
  let evidence;
  if (migration.provider === "roda") {
    const transferUuid = $("transfer-uuid").value.trim(), jobId = $("job-id").value.trim();
    if (!transferUuid && !jobId) throw new Error("Enter the original transfer UUID or ingest job ID.");
    evidence = {};
    if (transferUuid) evidence.transferUuid = transferUuid;
    if (jobId) evidence.jobId = jobId;
  } else {
    evidence = parseObject($("reconcile-json").value, "Original request evidence");
    if (!Object.keys(evidence).length) throw new Error("Enter the original request evidence for this Preservica operation.");
  }
  await mutation("/api/reconcile", {operationId: migration.id, evidence});
  await refreshState(); await refreshMigration();
}
function renderArtifacts() {
  const artifacts = S.data?.artifacts || [];
  const identity = stable(artifacts);
  if (identity === S.renderedArtifacts) return;
  S.renderedArtifacts = identity;
  $("artifact-count").textContent = artifacts.length + " retained file identities";
  replace("artifact-rows", artifacts.length ? [...artifacts].reverse().map(item => {
    const row = element("tr");
    const file = element("td", null, {class: "long"});
    file.append(element("strong", item.name), element("span", date(item.createdAt), {class: "record-sub"}));
    const details = element("details");
    details.append(element("summary", "File identity"), element("pre", pretty({sha256: item.sha256,
      bytes: item.bytes, artifactId: item.id})));
    file.append(details);
    const source = item.selection ? "r" + item.selection.revision + " · " + shortHash(item.selection.reviewSha256) : "—";
    const selection = element("td", source, {class: "long"});
    if (item.operationId) selection.append(element("span", item.operationId, {class: "record-sub mono"}));
    const action = element("td", null, {class: "short"});
    if (item.available) action.append(element("a", "Download", {
      href: "/download?id=" + encodeURIComponent(item.id), class: "button", download: item.name
    }));
    else action.append(element("span", "Identity retained", {class: "muted"}));
    row.append(file, element("td", item.kind, {class: "short"}), selection,
      element("td", size(item.bytes), {class: "short"}), action);
    return row;
  }) : [emptyRow(5, "Build a transfer or export the complete workspace to create a delivery.")]);
}
function renderActivity() {
  const data = S.data;
  if (!data) return;
  const identity = stable([data.jobs, data.jobCount]);
  if (identity === S.renderedActivity) return;
  S.renderedActivity = identity;
  $("activity-count").textContent = data.jobCount + " retained operations · " + data.jobs.length + " shown";
  replace("activity-list", data.jobs.length ? [...data.jobs].reverse().map(job => {
    const item = element("div", null, {class: "activity-item"});
    const title = element("div", null, {class: "toolbar spread"});
    title.append(element("span", job.kind, {class: "title"}), element("span", job.state, {class: "badge"}));
    item.append(title, element("div", "Original job " + job.id + " · " + date(job.createdAt), {class: "meta mono"}));
    if (job.arguments?.operationId) item.append(element("div", "Destination " + job.arguments.operationId, {class: "meta"}));
    if (job.error) item.append(element("p", job.error.message || pretty(job.error), {class: "meta"}));
    if (job.persistenceError) item.append(element("p", "Saving the outcome requires attention: " +
      (job.persistenceError.message || pretty(job.persistenceError)), {class: "meta"}));
    const details = element("details");
    details.append(element("summary", "Complete saved operation"), element("pre", pretty(job)));
    item.append(details); return item;
  }) : [element("div", "No operations have run in this workspace.", {class: "empty"})]);
}

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
  button.addEventListener("keydown", event => {
    const buttons = [...document.querySelectorAll("[data-tab]")], index = buttons.indexOf(button);
    let selected;
    if (event.key === "ArrowRight") selected = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft") selected = (index + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") selected = 0;
    else if (event.key === "End") selected = buttons.length - 1;
    if (selected !== undefined) { event.preventDefault(); switchTab(buttons[selected].dataset.tab, true); }
  });
}
for (const button of document.querySelectorAll("[data-open-tab]")) {
  button.addEventListener("click", () => switchTab(button.dataset.openTab, true));
}
on("dismiss-message", "click", dismiss);
on("refresh-state", "click", async () => {
  await refreshState(); if (S.data?.initialized) await refreshPreview();
});
on("intake-form", "submit", async event => {
  event.preventDefault();
  await mutation("/api/init", {source: $("source-path").value.trim(), prefix: $("source-prefix").value.trim(),
    organization: $("source-organization").value.trim(), contact: $("source-contact").value.trim()});
  await refreshState();
});
on("review-note", "input", () => {
  if (!S.draftReview) return;
  S.draftReview.note = $("review-note").value; markReviewChanged();
});
on("save-review", "click", saveReview);
on("reload-review", "click", reloadReview);
on("record-query", "input", () => {
  S.offset = 0; clearTimeout(S.searchTimer);
  S.searchTimer = setTimeout(() => refreshPreview().catch(report), 250);
});
on("record-filter", "change", async () => { S.offset = 0; await refreshPreview(); });
on("refresh-preview", "click", refreshPreview);
on("previous-page", "click", async () => {
  S.offset = Math.max(0, S.offset - (S.preview?.limit || 50)); await refreshPreview();
});
on("next-page", "click", async () => {
  S.offset += S.preview?.limit || 50; await refreshPreview();
});
on("select-page", "change", () => {
  for (const row of S.preview?.rows || []) {
    if ($("select-page").checked) S.selectedRecords.add(row.identifier);
    else S.selectedRecords.delete(row.identifier);
  }
  renderRecords();
});
on("clear-selection", "click", () => { S.selectedRecords.clear(); renderRecords(); });
on("exclude-selected", "click", () => bulkDecision(false));
on("include-selected", "click", () => bulkDecision(true));
on("record-include", "change", () => {
  if (S.recordForm) S.recordForm.include = $("record-include").checked; recordChanged();
});
on("record-reason", "input", () => {
  if (S.recordForm) S.recordForm.reason = $("record-reason").value; recordChanged();
});
on("add-field", "click", () => {
  if (!S.recordForm) return;
  const field = $("field-select").value;
  if (!field || field in S.recordForm.fields) return;
  S.recordForm.fields[field] = pretty(S.recordRow.originalDc[field] || []);
  recordChanged(); renderFieldEditors(); $("correction-" + field).focus();
});
on("record-form", "submit", applyRecord);
on("reset-record", "click", async () => {
  if (!S.recordForm) return;
  if (S.rawDirty) throw new Error("Apply or reload the complete review JSON first.");
  const identifier = S.recordForm.identifier;
  S.draftReview.decisions = S.draftReview.decisions.filter(item => item.identifier !== identifier);
  S.recordDirty = false; markReviewChanged(); await refreshPreview();
  message("The draft now uses this record's original source values and includes it.");
});
on("discard-record-edit", "click", () => { if (S.recordRow) openRecord(S.recordRow, true); });
on("review-json", "input", () => { S.rawDirty = true; S.rawEpoch += 1; renderControls(); });
on("apply-review-json", "click", applyReviewJson);
on("reset-review-json", "click", () => {
  if (S.rawDirty && !window.confirm("Replace the unapplied JSON edits with the current review draft?")) return;
  S.rawDirty = false; S.rawEpoch += 1;
  $("review-json").value = S.draftReview ? pretty(S.draftReview) : ""; renderControls();
});
on("new-destination", "click", newDestination);
on("destination-provider", "change", () => {
  captureDestinationDraft(); S.provider = $("destination-provider").value;
  if (!S.destinationDrafts[S.provider]) S.destinationDrafts[S.provider] = makeDestinationDraft(S.provider);
  showDestinationDraft();
});
for (const id of ["destination-id", "destination-label", "destination-settings",
                  "destination-configuration", "destination-job"]) on(id, "input", destinationChanged);
on("destination-revision", "change", destinationChanged);
on("destination-form", "submit", prepareDestination);
on("reset-destination-template", "click", () => {
  captureDestinationDraft();
  if (S.destinationDrafts[S.provider]?.touched &&
      !window.confirm("Replace this unsaved destination draft with the provider template and a new operation ID?")) return;
  S.destinationDrafts[S.provider] = makeDestinationDraft(S.provider);
  S.destinationEpoch += 1; showDestinationDraft();
});
on("run-migration", "click", () => migrate("run"));
on("refresh-migration", "click", () => migrate("refresh"));
on("resume-preparation", "click", () => migrate("resume-preparation"));
on("reconcile-form", "submit", reconcileMigration);
on("load-evidence-template", "click", () => {
  const migration = S.migration, kind = $("reconcile-kind").value;
  const template = S.data?.providers?.preservica?.reconciliationTemplates?.[kind];
  if (!migration || migration.provider !== "preservica" || !template) throw new Error("Load the original Preservica operation first.");
  if ($("reconcile-json").value.trim() !== "{}" &&
      !window.confirm("Replace the entered reconciliation JSON with this original operation's template?")) return;
  const value = clone(template), progress = migration.progress || {};
  value.operationId = migration.id;
  if (kind !== "process-observation") {
    const action = $("reconcile-action").value;
    value.action = action;
    if (progress.actions?.[action]?.requestSha256) value.requestSha256 = progress.actions[action].requestSha256;
  }
  if (kind === "progress-observation") {
    if (progress.transfer?.bucket) value.bucket = progress.transfer.bucket;
    if (progress.transfer?.key) value.key = progress.transfer.key;
    if (progress.transfer?.progressToken) value.progressToken = progress.transfer.progressToken;
  }
  if (kind === "process-observation" && progress.ingest?.processId) value.processId = progress.ingest.processId;
  $("reconcile-json").value = pretty(value);
  $("reconcile-help").textContent = "Known identifiers come from this original saved operation. Replace each remaining template value with its retained original response or observation.";
});

on("build-package", "click", async () => {
  const selection = savedSelection("package-revision");
  await mutation("/api/package", {selection}); await refreshState();
});
on("export-workspace", "click", async () => {
  completeDraft();
  if (reviewDirty()) throw new Error("Save the review draft before exporting the complete workspace.");
  await mutation("/api/export", {}); await refreshState();
});
window.addEventListener("beforeunload", event => {
  if (reviewDirty() || Object.values(S.destinationDrafts).some(draft => draft?.touched)) {
    event.preventDefault(); event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshState(true).catch(report);
});
async function poll() {
  try { await refreshState(true); }
  finally {
    const delay = document.visibilityState === "hidden" ? 10000 : S.data?.active ? 2500 : 5000;
    S.timer = setTimeout(poll, delay);
  }
}
renderControls();
refreshState().catch(report).finally(() => { S.timer = setTimeout(poll, 2500); });
})();
