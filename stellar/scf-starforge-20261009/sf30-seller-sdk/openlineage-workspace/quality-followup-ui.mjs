// MIT. Original Quality evaluation comparison and explicit follow-up desk.
import { listQualityDrafts, saveQualityDraft, validateQualityDraft } from "./quality-followup-drafts.mjs";
const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "className") node.className = value;
    else if (["value", "checked", "disabled"].includes(key)) node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
const p = value => el("p", {className: "qf-muted"}, value);
const btn = (label, work, attrs = {}) => el("button", {type: "button", onclick: work, ...attrs}, label);
const details = (title, value) => el("details", {}, el("summary", {}, title), el("pre", {}, JSON.stringify(value, null, 2)));
const field = (label, input, help = null) => el("label", {className: "qf-field"}, el("span", {}, label), input, help ? p(help) : null);
const select = (label, values, value, changed) => {
  const node = el("select", {"aria-label": label, onchange: event => changed(event.target.value)},
    values.map(([id, title]) => el("option", {value: id}, title)));
  if (value && !values.some(([id]) => id === value))
    node.append(el("option", {value}, "Original selection · " + value));
  node.value = value ?? ""; return node;
};
const textInput = (label, value, changed, type = "text") => el(type === "textarea" ? "textarea" : "input", {
  type: type === "textarea" ? null : type, "aria-label": label, value: value ?? "", rows: type === "textarea" ? 5 : null,
  oninput: event => changed(event.target.value)
});
const date = value => value ? new Date(value).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"}) : "No date";
const show = value => value === null || value === undefined ? "Not reported" : typeof value === "object" ? JSON.stringify(value) : String(value);
const names = {matched: "Compared", "before-only": "Observed only before", "after-only": "Observed only after", ambiguous: "Correspondence needs review"};
const table = (headers, rows) => el("div", {className: "qf-table", tabindex: "0"},
  el("table", {}, el("thead", {}, el("tr", {}, headers.map(label => el("th", {scope: "col"}, label)))),
    el("tbody", {}, rows.map(row => el("tr", {}, row.map(cell => el("td", {}, cell)))))));
const keyLabel = key => { try { const parts = JSON.parse(key); return parts.slice(1).join(" / "); } catch { return key; } };
const newWork = () => ({selection: {beforeEvaluationId: "", afterEvaluationId: "", runPairs: [], findingPairs: [], title: ""},
  followups: {}, selectedComparisonId: "", selectedRowId: ""});
function mergeEdited(current, opened, entered) {
  const result = clone(current);
  for (const key of Object.keys(entered)) if (!same(opened[key], entered[key])) result[key] = clone(entered[key]);
  return result;
}
export function installQualityFollowupDesk({getState, action, mutate, refresh, notify, download, navigate, openSource, restoreRequest}) {
  const root = el("section", {className: "qf-desk", "aria-label": "Quality follow-up"});
  document.head.append(el("link", {rel: "stylesheet", href: new URL("./quality-followup.css", import.meta.url).href}));
  document.getElementById("section-nav").append(btn("Quality follow-up", () => navigate("quality-followup"), {"data-view": "quality-followup"}));
  const retained = new Map(), selectedCopies = new Map();
  const ui = {active: false, busy: false, loading: false, overview: null, preview: null, error: "", feedback: "",
    key: null, generation: 0, workspaceId: null, slot: null, copies: [], tab: "compare", search: "", page: 0};
  for (const [property, field] of Object.entries({work: "work", draftId: "id", draftVersion: "version",
    draftError: "error", dirty: "dirty", savedDirty: "savedDirty"}))
    Object.defineProperty(ui, property, {get: () => ui.slot?.[field], set: value => {ui.slot[field] = value;}});
  const identity = () => ({workspaceId: getState().view?.workspaceId, revision: getState().view?.revision});
  const identityKey = () => JSON.stringify(identity());
  const current = () => ui.overview && ui.overview.workspaceId === identity().workspaceId && ui.overview.revision === identity().revision;
  const pending = () => Boolean(getState().pending || getState().pendingBusy);
  const selected = () => ui.overview?.comparisons.find(row => row.id === ui.work.selectedComparisonId) ?? null;
  const pointer = workspaceId => "commons.openlineage.quality-followup.selected:" + workspaceId;
  const slotKey = (workspaceId, id) => JSON.stringify([workspaceId, id]);
  function normalizeWork(work) {
    work.controls ??= {beforeRunKey: "", afterRunKey: "", findingChoices: {}, reportFormat: "html"};
    work.controls.findingChoices ??= {};
    return work;
  }
  function makeSlot(workspaceId, saved = null) {
    const slot = {workspaceId, id: saved?.id ?? crypto.randomUUID(), version: saved?.version ?? 0,
      work: normalizeWork(saved ? validateQualityDraft(saved, workspaceId) : newWork()),
      dirty: 0, savedDirty: 0, error: "", conflict: false, queue: Promise.resolve(), timer: null, writes: 0};
    retained.set(slotKey(workspaceId, slot.id), slot); return slot;
  }
  function remember(slot) {
    selectedCopies.set(slot.workspaceId, slot.id);
    try { sessionStorage.setItem(pointer(slot.workspaceId), slot.id); } catch {}
  }
  function activate(slot) {
    ui.slot = slot; ui.workspaceId = slot.workspaceId; remember(slot);
    ui.preview = null; ui.tab = slot.work.controls.tab ?? "compare";
    ui.search = slot.work.controls.search ?? ""; ui.page = slot.work.controls.page ?? 0;
  }
  function context() { return {slot: ui.slot, workspaceId: identity().workspaceId}; }
  function requireContext(captured) {
    if (captured.slot !== ui.slot || captured.workspaceId !== identity().workspaceId ||
      captured.slot?.workspaceId !== captured.workspaceId)
      throw new Error("The original workspace or working copy changed. Its complete entered fields remain retained.");
  }
  function changed(invalidate = false, slot = ui.slot) {
    slot.dirty++;
    if (invalidate && slot === ui.slot) { ui.preview = null; ui.page = 0; }
    clearTimeout(slot.timer); slot.timer = setTimeout(() => void persist(slot).catch(error => fail(error, slot)), 200);
  }
  function fail(error, slot = ui.slot) {
    if (slot !== ui.slot) return;
    ui.error = error.message; notify(error.message, true); paint();
  }
  function persist(slot = ui.slot) {
    if (!slot) return Promise.resolve();
    clearTimeout(slot.timer);
    const work = clone(slot.work), dirty = slot.dirty;
    slot.queue = slot.queue.catch(() => {}).then(async () => {
      if (dirty <= slot.savedDirty) return;
      if (slot.conflict) throw new Error(slot.error);
      slot.writes++;
      try {
        const result = await saveQualityDraft(slot.workspaceId, slot.id, slot.version, work);
        slot.version = result.version; slot.savedDirty = dirty; slot.error = ""; slot.conflict = false;
        if (slot === ui.slot) ui.copies = [result, ...ui.copies.filter(row => row.id !== slot.id)];
      } catch (error) {
        slot.error = error.message; slot.conflict = error.code === "QUALITY_DRAFT_CONFLICT"; throw error;
      } finally { slot.writes--; }
    });
    return slot.queue;
  }
  function envelope(slot = ui.slot) {
    const value = {schema: "commons.openlineage.quality-working-copy.v1",
      workspaceId: slot.workspaceId, id: slot.id, version: slot.version, value: clone(slot.work)};
    const request = getState().pending;
    if (request?.workspaceId === slot.workspaceId && request.action?.startsWith("quality.followup."))
      value.originalPendingRequest = clone(request);
    return value;
  }
  function downloadWork(slot = ui.slot, name = "quality-followup-working-copy.json") {
    if (!slot) return;
    download(new Blob([JSON.stringify(envelope(slot), null, 2) + "\n"], {type: "application/json"}), name);
  }
  async function preserveBeforeOpen(captured) {
    requireContext(captured);
    await persist(captured.slot).catch(error => { captured.slot.error = error.message; });
    requireContext(captured);
    downloadWork(captured.slot, "quality-followup-before-opening.json");
  }
  async function task(work) {
    if (ui.busy || ui.loading || !ui.slot) return;
    const captured = context();
    if (captured.workspaceId !== captured.slot.workspaceId) return;
    ui.busy = true; ui.error = ""; paint();
    try { return await work(captured); } catch (error) { fail(error, captured.slot); }
    finally {
      ui.busy = false;
      if (ui.active && !ui.loading && ui.key !== identityKey()) void load(); else paint();
    }
  }
  async function load() {
    const id = identity(), key = identityKey(), generation = ++ui.generation;
    ui.loading = true; ui.error = ""; paint();
    try {
      if (ui.workspaceId !== id.workspaceId) {
        if (ui.slot) { const previous = ui.slot; void persist(previous).catch(error => fail(error, previous)); }
        let chosenId = selectedCopies.get(id.workspaceId);
        if (!chosenId) try { chosenId = sessionStorage.getItem(pointer(id.workspaceId)); } catch {}
        const held = chosenId ? retained.get(slotKey(id.workspaceId, chosenId)) : null;
        let copies = [], storageError = null;
        try { copies = await listQualityDrafts(id.workspaceId); } catch (error) { storageError = error; }
        if (generation !== ui.generation || identityKey() !== key) return;
        let slot = held;
        if (!slot) {
          const saved = copies.find(row => row.id === chosenId) ?? copies[0];
          try { slot = makeSlot(id.workspaceId, saved); }
          catch (error) { storageError = error; slot = makeSlot(id.workspaceId); }
        }
        activate(slot); ui.copies = copies;
        if (storageError) slot.error = storageError.message;
      }
      const value = await action("quality.followup.overview", {});
      if (generation !== ui.generation || identityKey() !== key) return;
      if (value.workspaceId !== id.workspaceId || value.revision !== id.revision)
        throw new Error("The workspace changed while loading. Refresh the original workspace.");
      ui.overview = value; ui.key = key;
      if (ui.preview && ui.preview.revision !== value.revision) ui.preview = null;
    } catch (error) { if (generation === ui.generation) { ui.error = error.message; ui.key = key; } }
    finally { if (generation === ui.generation) { ui.loading = false; paint(); } }
  }
  async function reload(captured = context()) {
    await persist(captured.slot).catch(error => { captured.slot.error = error.message; });
    requireContext(captured); ui.key = null; await refresh();
    if (ui.active && !ui.loading) await load();
  }
  async function openCopy(id, captured) {
    if (!id) return;
    await preserveBeforeOpen(captured);
    let rows = [], storageError = null;
    try { rows = await listQualityDrafts(captured.workspaceId); } catch (error) { storageError = error; }
    requireContext(captured);
    const saved = rows.find(row => row.id === id), memory = retained.get(slotKey(captured.workspaceId, id));
    if (!saved && !memory) throw storageError ?? new Error("This saved copy is no longer available");
    const next = saved ? makeSlot(captured.workspaceId, saved) : memory;
    activate(next); ui.copies = rows.length ? rows : ui.copies;
    if (storageError) next.error = storageError.message;
  }
  function viewChanged() {
    Object.assign(ui.work.controls, {tab: ui.tab, search: ui.search, page: ui.page}); changed();
  }
  function authoringCopies() {
    const upload = el("input", {type: "file", accept: ".json,application/json", "aria-label": "Open quality working copy",
      onchange: event => {
        const file = event.target.files[0];
        if (!file) return;
        void task(async captured => {
          if (file.size > 10000000) throw new Error("Working copy exceeds 10 MB");
          const raw = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(await file.arrayBuffer());
          requireContext(captured);
          const received = JSON.parse(raw.replace(/^\uFEFF/, ""));
          const value = validateQualityDraft(received, captured.workspaceId);
          await preserveBeforeOpen(captured);
          const next = makeSlot(captured.workspaceId); next.work = normalizeWork(value);
          // The native pending journal remains authoritative. Preserve its original downloaded context without dispatching it.
          if (received.originalPendingRequest) next.work.originalPendingRequest = clone(received.originalPendingRequest);
          activate(next); changed();
          await persist(next);
        });
      }});
    const copies = new Map(ui.copies.map(row => [row.id, row]));
    for (const slot of retained.values()) if (slot.workspaceId === ui.workspaceId)
      copies.set(slot.id, {id: slot.id, value: slot.work, updatedAt: copies.get(slot.id)?.updatedAt ?? null});
    return el("details", {className: "qf-working"}, el("summary", {}, "Working copies and complete authoring files"),
      p("Entered fields stay with their original workspace and selected copy. Complete downloads remain available while a save or browser storage needs attention."),
      select("Saved working copy", [["", "Choose a saved copy"], ...[...copies.values()].map(row => [row.id,
        (row.value.selection.title || "Untitled working copy") + " · " + date(row.updatedAt)])], ui.draftId, id => task(captured => openCopy(id, captured))),
      btn("Save these entries as a separate working copy", () => task(async captured => {
        await captured.slot.queue.catch(() => {}); requireContext(captured);
        const next = makeSlot(captured.workspaceId); next.work = clone(captured.slot.work);
        activate(next); changed(); await persist(next);
      })),
      btn("Reopen current saved version", () => task(captured => openCopy(captured.slot.id, captured))),
      btn("Retry saving this working copy", () => task(async captured => {
        requireContext(captured); if (captured.slot.dirty <= captured.slot.savedDirty) changed();
        await persist(captured.slot);
      })),
      btn("Download complete working copy", () => downloadWork(), {"data-qf-download": ""}),
      field("Reopen a complete working copy", upload),
      ui.work.originalPendingRequest ? el("div", {},
        details("Complete original request retained with the opened working copy", ui.work.originalPendingRequest),
        btn("Restore original request to workspace recovery", () => task(async captured => {
          const original = clone(captured.slot.work.originalPendingRequest);
          if (typeof restoreRequest !== "function") throw new Error("Open this complete application with its original request-recovery host.");
          downloadWork(captured.slot, "quality-followup-before-request-recovery.json");
          await persist(captured.slot); requireContext(captured);
          await restoreRequest(original); requireContext(captured);
          ui.feedback = "The exact original request is in the workspace recovery panel. No native request was sent by opening this copy.";
        }))) : null,
      ui.draftError ? el("p", {role: "alert"}, ui.draftError + " Your complete fields remain available to download, open or save separately.") :
        p("Working copy version " + ui.draftVersion + (ui.dirty > ui.savedDirty ? " · entered fields awaiting storage" : "")));
  }
  function sourceLinks(finding) {
    return el("div", {className: "qf-actions"}, finding.sources.map(source => btn(
      (getState().view?.sources.find(item => item.id === source.sourceId)?.name ?? "Original source") +
      (source.line !== undefined ? " · line " + source.line : source.index !== undefined ? " · item " + source.index : ""),
      () => openSource(source.sourceId))));
  }
  function findingCard(finding) {
    return el("article", {className: "qf-finding"}, el("strong", {}, finding.title),
      p(finding.namespace + " / " + finding.name), p(finding.status + " · " + finding.severity),
      el("p", {}, "Actual: " + show(finding.actual)), el("p", {}, "Expected: " + show(finding.expected)),
      details("Original run, facet and full finding", finding), sourceLinks(finding));
  }
  async function preview(captured = context()) {
    await persist(captured.slot); requireContext(captured);
    if (!current()) throw new Error("Refresh the current workspace before comparing");
    const chosen = clone(ui.work.selection), expected = identityKey();
    const value = await action("quality.followup.compare", {beforeEvaluationId: chosen.beforeEvaluationId,
      afterEvaluationId: chosen.afterEvaluationId, runPairs: chosen.runPairs, findingPairs: chosen.findingPairs});
    if (expected !== identityKey() || !same(chosen, ui.work.selection)) throw new Error("The source or choices changed during comparison");
    ui.preview = value; ui.page = 0;
  }
  function compareView() {
    const selection = ui.work.selection, evaluations = ui.overview.evaluations;
    const choices = [["", "Choose saved evaluation"], ...evaluations.map(row => [row.id, row.title + " · " + date(row.createdAt)])];
    const changeEvaluation = (key, value) => {
      selection[key] = value; selection.runPairs = []; selection.findingPairs = [];
      ui.work.controls.beforeRunKey = ""; ui.work.controls.afterRunKey = ""; ui.work.controls.findingChoices = {};
      changed(true); paint();
    };
    const view = el("div", {}, p("Compare two immutable saved evaluations. Each original event, rule version and source scope remains visible."),
      el("div", {className: "qf-grid"},
        field("Earlier saved evaluation", select("Earlier saved evaluation", choices, selection.beforeEvaluationId, value => changeEvaluation("beforeEvaluationId", value))),
        field("Later saved evaluation", select("Later saved evaluation", choices, selection.afterEvaluationId, value => changeEvaluation("afterEvaluationId", value)))));
    const before = evaluations.find(row => row.id === selection.beforeEvaluationId), after = evaluations.find(row => row.id === selection.afterEvaluationId);
    if (before && after) {
      const controls = ui.work.controls;
      const rb = select("Earlier run", [["", "Choose original run"], ...before.runs.map(row => [row.runKey, keyLabel(row.runKey)])],
        controls.beforeRunKey, value => {controls.beforeRunKey = value; changed();});
      const ra = select("Later run", [["", "Choose corresponding run"], ...after.runs.map(row => [row.runKey, keyLabel(row.runKey)])],
        controls.afterRunKey, value => {controls.afterRunKey = value; changed();});
      view.append(el("details", {}, el("summary", {}, "Explicit correspondence between different runs"),
        p("Run identities match automatically only when unchanged. Select runs of the same named job to compare separate executions."),
        el("div", {className: "qf-grid"}, field("Earlier run", rb), field("Later run", ra)),
        btn("Add run correspondence", () => task(async () => {
          const br = controls.beforeRunKey, ar = controls.afterRunKey;
          if (!br || !ar) throw new Error("Choose both original runs");
          if (selection.runPairs.some(row => row.beforeRunKey === br || row.afterRunKey === ar)) throw new Error("Each run can appear in only one correspondence");
          if (before.runs.find(row => row.runKey === br)?.jobKey !== after.runs.find(row => row.runKey === ar)?.jobKey) throw new Error("Choose runs of the same named job");
          selection.runPairs.push({beforeRunKey: br, afterRunKey: ar}); selection.findingPairs = []; controls.findingChoices = {}; changed(true); await persist();
        })),
        selection.runPairs.map((row, index) => el("p", {}, keyLabel(row.beforeRunKey) + " → " + keyLabel(row.afterRunKey),
          btn("Remove run correspondence", () => {selection.runPairs.splice(index, 1); selection.findingPairs = []; changed(true); paint();})))));
    }
    view.append(btn("Compare saved evaluations", () => task(preview), {disabled: !before || !after || before.id === after.id || ui.busy}));
    if (ui.preview) {
      const value = ui.preview;
      view.append(p(value.summary.matched + " compared · " + value.summary.beforeOnly + " only before · " + value.summary.afterOnly +
        " only after · " + value.summary.ambiguous + " needing correspondence"),
        details("Both source selections, rules and scope changes", {before: value.before, after: value.after, selectionChanges: value.selectionChanges}),
        comparisonRows(value, true),
        field("Saved comparison title", textInput("Saved comparison title", selection.title, value => {
          selection.title = value; changed();
          const save = root.querySelector("[data-qf-save-comparison]");
          if (save) save.disabled = ui.busy || ui.loading || pending() || !value.trim() ||
            !ui.preview || ui.preview.revision !== identity().revision;
        })),
        btn("Save reviewed comparison", () => task(async captured => {
          const context = {workspaceId: ui.workspaceId, draftId: ui.draftId, work: ui.work,
            selection: clone(selection), preview: clone(ui.preview)};
          const stillHere = () => identity().workspaceId === context.workspaceId && ui.workspaceId === context.workspaceId &&
            ui.draftId === context.draftId && ui.work === context.work;
          await persist(captured.slot); requireContext(captured);
          if (!stillHere() || !current() || !context.preview || context.preview.revision !== identity().revision)
            throw new Error("Compare the current source in this original working copy before saving");
          const submitted = context.selection;
          const result = await mutate("quality.followup.comparison.save", {beforeEvaluationId: submitted.beforeEvaluationId,
            afterEvaluationId: submitted.afterEvaluationId, runPairs: submitted.runPairs, findingPairs: submitted.findingPairs,
            title: submitted.title, expectedComparisonHash: context.preview.comparisonSha256}, "Quality comparison",
            {expectedRevision: context.preview.revision});
          if (!result) return;
          if (result.comparison.workspaceId !== context.workspaceId || result.workspaceId && result.workspaceId !== context.workspaceId)
            throw new Error("Saved comparison belongs to a different workspace; retain its original request receipt");
          if (!stillHere()) return;
          if (same(ui.work.selection, submitted)) {
            ui.work.selectedComparisonId = result.comparison.id; ui.work.selectedRowId = ""; ui.tab = "followup"; viewChanged();
            ui.preview = null; changed(); await persist();
          } else ui.feedback = "The submitted comparison is saved. Newer entered comparison choices remain in this working copy.";
          ui.key = null; await load();
        }), {"data-qf-save-comparison": "", disabled: ui.busy || pending() || !selection.title.trim() || ui.preview.revision !== identity().revision}));
    }
    return view;
  }
  function comparisonRows(comparison, editable) {
    const rows = comparison.rows.filter(row => !ui.search || JSON.stringify(row).toLowerCase().includes(ui.search.toLowerCase()));
    const pages = Math.max(1, Math.ceil(rows.length / 20)); ui.page = Math.min(ui.page, pages - 1);
    return el("div", {}, field("Find compared findings", textInput("Find compared findings", ui.search, value => {ui.search = value; ui.page = 0; viewChanged(); paint();})),
      rows.slice(ui.page * 20, (ui.page + 1) * 20).map(row => {
        const card = el("article", {className: "qf-row"}, el("h3", {}, names[row.kind]),
          el("div", {className: "qf-grid"}, el("section", {}, el("h4", {}, "Earlier"), row.before.length ? row.before.map(findingCard) : p("No corresponding finding")),
            el("section", {}, el("h4", {}, "Later"), row.after.length ? row.after.map(findingCard) : p("No corresponding finding"))),
          p(row.statusTransition ?? "Review the complete source selection when interpreting absence."),
          row.definitionChanged ? el("p", {className: "qf-notice"}, "The original check definition changed.") : null,
          details("Complete changed fields and rule versions", {changes: row.changes, beforeRule: row.beforeRule, afterRule: row.afterRule}));
        if (row.kind === "ambiguous" && editable) {
          const choices = ui.work.controls.findingChoices;
          const choice = () => choices[row.id] ?? "";
          card.append(field("Explicit finding correspondence", select("Explicit finding correspondence", [["", "Choose exact original findings"],
            ...row.candidates.map((pair, i) => [String(i), row.before.find(f => f.id === pair.beforeFindingId).title + " [" +
              row.before.find(f => f.id === pair.beforeFindingId).facetPath + ", " + pair.beforeFindingId.slice(0, 10) + "] → " +
              row.after.find(f => f.id === pair.afterFindingId).title + " [" + pair.afterFindingId.slice(0, 10) + "]"])], choice(), value => {choices[row.id] = value; changed();})),
            btn("Use this one-to-one finding correspondence", () => task(async () => {
              if (choice() === "") throw new Error("Choose the exact pair");
              const pair = row.candidates[Number(choice())];
              if (!pair) throw new Error("Choose one of the current exact finding pairs");
              ui.work.selection.findingPairs.push(clone(pair)); changed(true); await preview();
            })));
        }
        if (!editable && row.kind !== "ambiguous" && row.after.length === 1)
          card.append(btn("Open finding follow-up", () => {ui.work.selectedRowId = row.id; changed(); paint();}));
        return card;
      }),
      el("div", {className: "qf-actions"}, btn("Previous findings", () => {ui.page--; viewChanged(); paint();}, {disabled: ui.page === 0}),
        p("Page " + (ui.page + 1) + " of " + pages + " · " + rows.length + " rows"),
        btn("Next findings", () => {ui.page++; viewChanged(); paint();}, {disabled: ui.page + 1 >= pages})));
  }
  function followupValues(existing) {
    return existing ? {decision: existing.decision, reason: existing.reason, owner: existing.owner, dueDate: existing.dueDate,
      evidenceResultIds: clone(existing.evidenceResultIds), sourceDisposition: existing.sourceDisposition && {
        evaluationId: existing.sourceDisposition.evaluationId, findingId: existing.sourceDisposition.findingId, version: existing.sourceDisposition.version
      }} : {decision: "investigating", reason: "", owner: "", dueDate: null, evidenceResultIds: [], sourceDisposition: null};
  }
  function followupForm(comparison, row) {
    const key = comparison.id + "|" + row.id;
    const existing = ui.overview.followups.find(item => item.comparisonId === comparison.id && item.rowId === row.id);
    if (!ui.work.followups[key]) {
      const values = followupValues(existing);
      ui.work.followups[key] = {values, opened: clone(values), basis: {workspaceId: ui.workspaceId, revision: ui.overview.revision,
        id: existing?.id ?? null, version: existing?.version ?? null}};
      changed();
    }
    const draft = ui.work.followups[key], basis = {workspaceId: ui.workspaceId, revision: ui.overview.revision,
      id: existing?.id ?? null, version: existing?.version ?? null};
    const stale = !same(draft.basis, basis), set = (name, value) => {
      draft.values[name] = value; changed();
      const save = root.querySelector("[data-qf-save-followup]");
      if (save) save.disabled = stale || pending() || ui.busy || ui.loading || !draft.values.reason.trim();
    };
    const form = el("section", {className: "qf-editor"}, el("h3", {}, "Reasoned follow-up"), findingCard(row.after[0]),
      p("This records an operator decision for the later finding. Its original producer outcome remains unchanged."));
    if (stale) form.append(el("div", {className: "qf-notice"}, el("h4", {}, "Review the current saved follow-up"),
      details("Current saved fields", followupValues(existing)), details("Fields when opened", draft.opened), details("Retained entered fields", draft.values),
      btn("Keep my edited fields on the reviewed current version", () => {
        if (!current() || !same(basis, {workspaceId: ui.workspaceId, revision: ui.overview.revision, id: existing?.id ?? null, version: existing?.version ?? null})) return;
        draft.previous = clone({values: draft.values, opened: draft.opened, basis: draft.basis});
        draft.values = mergeEdited(followupValues(existing), draft.opened, draft.values);
        draft.opened = followupValues(existing); draft.basis = clone(basis); changed(); paint();
      })));
    if (draft.previous) form.append(details("Previous entered version retained after review", draft.previous),
      btn("Restore previous entered version", () => {const previous = clone(draft.previous); draft.previous = clone({values: draft.values, opened: draft.opened, basis: draft.basis}); Object.assign(draft, previous); changed(); paint();}));
    form.append(el("div", {className: "qf-grid"},
      field("Decision", select("Follow-up decision", ["open", "investigating", "accepted", "resolved"].map(value => [value, value]), draft.values.decision, value => set("decision", value))),
      field("Owner", textInput("Follow-up owner", draft.values.owner, value => set("owner", value))),
      field("Due date", textInput("Follow-up due date", draft.values.dueDate, value => set("dueDate", value || null), "date"))),
      field("Reason and action taken", textInput("Follow-up reason", draft.values.reason, value => set("reason", value), "textarea")));
    const disposition = row.before.length === 1 ? ui.overview.dispositions.find(value => value.evaluationId === comparison.before.id && value.findingId === row.before[0].id) : null;
    const versions = disposition ? [disposition, ...disposition.history] : [];
    form.append(field("Earlier decision reference", select("Earlier decision reference", [["", "No earlier disposition selected"],
      ...versions.map(value => [String(value.version), "Version " + value.version + " · " + value.decision + " · " + date(value.updatedAt)])],
      draft.values.sourceDisposition ? String(draft.values.sourceDisposition.version) : "", value => {
        set("sourceDisposition", value ? {evaluationId: comparison.before.id, findingId: row.before[0].id, version: Number(value)} : null); paint();
      }), "Selecting a reference retains that original version; write the current follow-up reason explicitly."));
    if (draft.values.sourceDisposition) form.append(details("Selected original disposition", versions.find(value => value.version === draft.values.sourceDisposition.version) ?? draft.values.sourceDisposition));
    form.append(el("fieldset", {}, el("legend", {}, "Supporting complete result files"), ui.overview.evidence.length ?
      ui.overview.evidence.map(value => el("label", {className: "qf-check"}, el("input", {type: "checkbox",
        checked: draft.values.evidenceResultIds.includes(value.id), onchange: event => {
          set("evidenceResultIds", event.target.checked ? [...draft.values.evidenceResultIds, value.id] : draft.values.evidenceResultIds.filter(id => id !== value.id));
        }}), value.title ?? value.name ?? value.id)) : p("Attach a complete result through the original Results workflow, then refresh this desk.")));
    form.append(btn("Save follow-up", () => task(async captured => {
      const context = {workspaceId: ui.workspaceId, draftId: ui.draftId, work: ui.work, draft,
        values: clone(draft.values), basis: clone(basis), comparisonId: comparison.id, rowId: row.id};
      const stillHere = () => identity().workspaceId === context.workspaceId && ui.workspaceId === context.workspaceId &&
        ui.draftId === context.draftId && ui.work === context.work && ui.work.followups[key] === context.draft;
      await persist(captured.slot); requireContext(captured);
      if (!stillHere() || !current() || !same(draft.basis, context.basis) || identity().revision !== context.basis.revision)
        throw new Error("Review current saved fields in this original working copy before saving");
      const result = await mutate("quality.followup.save", {...context.values, comparisonId: context.comparisonId, rowId: context.rowId,
        ...(context.basis.id ? {id: context.basis.id, version: context.basis.version} : {})}, "Quality finding follow-up",
        {expectedRevision: context.basis.revision});
      if (!result) return;
      if (result.followup.workspaceId !== context.workspaceId || result.workspaceId && result.workspaceId !== context.workspaceId ||
        result.followup.comparisonId !== context.comparisonId || result.followup.rowId !== context.rowId)
        throw new Error("Saved follow-up differs from its original workspace and finding; retain its original request receipt");
      if (!stillHere() || !same(draft.basis, context.basis)) return;
      const values = followupValues(result.followup);
      draft.previous = clone({values: draft.values, opened: draft.opened, basis: draft.basis});
      draft.values = mergeEdited(values, context.values, draft.values);
      draft.opened = clone(values); draft.basis = {workspaceId: context.workspaceId, revision: result.revision,
        id: result.followup.id, version: result.followup.version};
      changed(); await persist(); ui.key = null; await load();
    }), {"data-qf-save-followup": "", disabled: stale || pending() || ui.busy || !draft.values.reason.trim()}));
    if (existing) form.append(details("Complete saved follow-up and history", existing));
    return form;
  }
  function followupView() {
    const comparison = selected();
    const view = el("div", {}, field("Saved comparison", select("Saved quality comparison", [["", "Choose saved comparison"],
      ...ui.overview.comparisons.map(row => [row.id, row.title + " · " + date(row.createdAt)])], ui.work.selectedComparisonId, value => {
        ui.work.selectedComparisonId = value; ui.work.selectedRowId = ""; ui.search = ""; ui.page = 0; viewChanged(); paint();
      })));
    if (!comparison) {view.append(p("Save a comparison to assign and review its later findings.")); return view;}
    const controls = ui.work.controls;
    view.append(p(comparison.before.title + " → " + comparison.after.title), el("div", {className: "qf-actions"},
      select("Comparison report format", [["html", "HTML report"], ["json", "Complete JSON"], ["csv", "CSV findings"]], controls.reportFormat, value => {controls.reportFormat = value; changed();}),
      btn("Download complete comparison report", () => task(async captured => {
        const format = controls.reportFormat;
        const value = await action("quality.followup.report.read", {comparisonId: comparison.id, format});
        requireContext(captured);
        download(new Blob([value.text], {type: value.mediaType}), "quality-followup-" + comparison.id + "." + format);
      }))), details("Original comparison and correspondence choices", comparison));
    const row = comparison.rows.find(item => item.id === ui.work.selectedRowId);
    if (row && row.after.length === 1 && row.kind !== "ambiguous") view.append(followupForm(comparison, row));
    view.append(comparisonRows(comparison, false)); return view;
  }
  function paint() {
    if (!ui.active || !getState().view) return;
    const focused = root.contains(document.activeElement) && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) ?
      {label: document.activeElement.getAttribute("aria-label"), start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd} : null;
    root.setAttribute("aria-busy", String(ui.loading || ui.busy));
    const parts = [el("header", {}, el("h2", {}, "Quality follow-up"),
      p("Saved evaluations, original findings and reasoned follow-up in this workspace."),
      btn("Refresh follow-up", () => task(reload), {disabled: ui.busy})), ui.workspaceId ? authoringCopies() : null];
    if (ui.loading) parts.push(p("Loading the current saved evaluations and follow-up history…"));
    if (ui.error) parts.push(el("p", {className: "qf-notice", role: "alert"}, ui.error));
    if (ui.feedback) parts.push(el("p", {role: "status"}, ui.feedback));
    if (ui.overview && !ui.loading && current()) {
      parts.push(el("nav", {className: "qf-actions", "aria-label": "Quality follow-up views"},
        btn("Compare evaluations", () => {ui.tab = "compare"; viewChanged(); paint();}, {"aria-pressed": String(ui.tab === "compare")}),
        btn("Saved comparisons and follow-up", () => {ui.tab = "followup"; viewChanged(); paint();}, {"aria-pressed": String(ui.tab === "followup")})),
        ui.tab === "compare" ? compareView() : followupView());
    }
    root.replaceChildren(...parts.filter(node => node !== null && node !== undefined));
    if (ui.busy || ui.loading || ui.workspaceId !== identity().workspaceId)
      root.querySelectorAll("button,input,select,textarea").forEach(node => {
        if (!node.hasAttribute("data-qf-download")) node.disabled = true;
      });
    const host = document.getElementById("catalog"); if (host.firstChild !== root || host.childNodes.length !== 1) host.replaceChildren(root);
    if (focused?.label) {
      const input = [...root.querySelectorAll("input[aria-label],textarea[aria-label]")].find(node => node.getAttribute("aria-label") === focused.label);
      if (input) { input.focus({preventScroll: true}); if (focused.start !== null) try { input.setSelectionRange(focused.start, focused.end); } catch {} }
    }
  }
  function render() {
    ui.active = getState().section === "quality-followup";
    document.body.classList.toggle("quality-followup-mode", ui.active);
    if (!ui.active) return false;
    if (!getState().view) return true;
    if (!ui.loading && !ui.busy && ui.key !== identityKey()) void load(); else paint();
    return true;
  }
  window.addEventListener("beforeunload", event => {
    if ([...retained.values()].some(slot => slot.dirty > slot.savedDirty || slot.writes)) {
      event.preventDefault(); event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    for (const slot of retained.values()) void persist(slot).catch(() => {});
  });
  return {render, refresh: reload};
}
