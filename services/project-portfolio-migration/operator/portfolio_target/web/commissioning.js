const FAMILIES = ["tasks", "resources", "assignments", "dependencies"];
const EVIDENCE_CLASSES = [
  ["native_receipt", "Native import receipt"], ["original_export", "Original export"],
  ["original_screenshot", "Original screenshot"], ["operator_statement", "Operator statement"]
];
const DISPOSITIONS = [
  ["retained_difference", "Retained difference"], ["needs_correction", "Needs correction"],
  ["manual_followup", "Manual follow-up"], ["observed_resolved", "Observed resolved"]
];
const OWN_ACTIONS = new Set(["adopt_existing", "prepare_adoption_review", "review_adoption",
  "prepare_observed_correction", "rebind_imported_target", "commissioning_handover"]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const sameBasis = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
const display = value => value === undefined ? "Unreported" : value === null ? "null" :
  typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
const text = (name, value, className) => {
  const node = document.createElement(name);
  if (value !== undefined && value !== null) node.textContent = String(value);
  if (className) node.className = className;
  return node;
};
const empty = message => text("p", message, "commissioning-empty");
function append(node, ...children) {
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
}
function card(title, ...children) {
  return append(text("section", undefined, "commissioning-card"), text("h3", title), ...children);
}
function disclosure(title, value) {
  return append(text("details"), text("summary", title), text("pre", display(value)));
}
function option(value, label, selected) {
  const node = new Option(label, value); node.selected = value === selected; return node;
}
function summary(values) {
  const node = text("dl", undefined, "commissioning-summary");
  for (const [label, value] of Object.entries(values)) append(node, text("dt", label), text("dd", display(value)));
  return node;
}
function table(headings, rows, label) {
  const node = text("table"); node.setAttribute("aria-label", label);
  const head = text("thead"), tr = text("tr");
  for (const heading of headings) { const th = text("th", heading); th.scope = "col"; tr.append(th); }
  head.append(tr); const body = text("tbody");
  for (const cells of rows) {
    const row = text("tr");
    cells.forEach((value, index) => {
      const td = text("td"); td.dataset.label = headings[index];
      if (value instanceof Node) td.append(value); else td.textContent = display(value);
      row.append(td);
    });
    body.append(row);
  }
  append(node, head, body);
  return append(text("div", undefined, "commissioning-table-wrap"), node);
}
function originalName(row) {
  return String(row?.fields?.NAME?.value ?? row?.native?.msdyn_subject ??
    row?.native?.msdyn_name ?? row?.guid ?? row?.native_guid ?? row?.key ?? "Original row");
}
function objectValue(raw, label) {
  const value = raw.trim() ? JSON.parse(raw) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be an object.");
  return value;
}
function valueInput(raw, format) { return format === "json" ? JSON.parse(raw) : raw; }

export function createCommissioningPanel(host) {
  const root = host.$("commissioning-desk");
  if (!root) throw new Error("The imported-plan commissioning panel is absent.");
  const state = {
    workspace: "", profiles: [], editions: [], deployments: [], deployment: null,
    inventory: null, intake: null, basis: null, proposal: null, recoveryProposal: null, source: null,
    family: "tasks", offset: 0, sourceRows: [], sourceTotal: 0, nextOffset: null,
    comparisonFilter: "all", comparisonLimit: 50, selectedNative: null,
    stage: "intake", intakeOpen: false, generation: 0, loading: false, rowsLoading: false, rowsError: "", loadError: "", loadedBasis: null,
    drafts: {}, intakeDraft: {label: "", projectId: "", projectUrl: "", importTime: "",
      profileId: "", settings: "{}", evidence: [], exceptions: []}, artifacts: [],
    intakeBasis: null
  };
  let serial = 0;
  const workspace = () => host.workspaceId();
  const currentBasis = () => {
    const d = host.deployment();
    return d ? {workspaceId: workspace(), deploymentId: d.id, revision: d.revision,
      snapshotSha256: d.snapshot_sha256 ?? null, sourceEditionId: d.source_edition_id,
      inventorySha256: d.commissioning_inventory_sha256 ?? null,
      comparisonSha256: d.commissioning_comparison_sha256 ?? null,
      captureEditionId: d.capture_edition_id ?? null} : null;
  };
  const intakeBasis = () => ({workspaceId: workspace(), sourceEditionId: host.sourceId()});
  const deploymentDraft = () => state.deployment ? state.drafts[state.deployment.id] : null;
  const id = suffix => "commissioning-" + suffix + "-" + (++serial);
  function change(fn, invalidate = true) {
    fn();
    const draft = deploymentDraft();
    if (invalidate && draft) { draft.proposalSha256 = null; draft.proposalSignature = null; state.proposal = null;
      root.querySelector("[data-commissioning-proposal]")?.remove(); }
    host.saveDraft();
  }
  function input(label, value, onChange, {type = "text", multiline = false, rows = 3, read = false, placeholder = ""} = {}) {
    const field = text("label", undefined, "commissioning-field"), control = text(multiline ? "textarea" : "input");
    control.id = id("field"); control.value = value ?? "";
    if (multiline) control.rows = rows; else control.type = type;
    if (placeholder) control.placeholder = placeholder;
    if (read) control.dataset.read = "";
    control.addEventListener("input", () => host.safe(() => onChange(control.value)));
    append(field, text("span", label), control);
    return {field, control};
  }
  function select(label, choices, value, onChange, {read = false, emptyLabel} = {}) {
    const field = text("label", undefined, "commissioning-field"), control = text("select");
    control.id = id("select"); if (read) control.dataset.read = "";
    if (emptyLabel !== undefined) control.append(option("", emptyLabel, value));
    for (const [key, title] of choices) control.append(option(key, title, value));
    control.value = value ?? "";
    control.addEventListener("change", () => host.safe(() => onChange(control.value)));
    append(field, text("span", label), control);
    return {field, control};
  }
  function button(label, callback, {read = false, disabled = false, primary = false} = {}) {
    const node = text("button", label, primary ? "commissioning-primary" : "");
    node.type = "button"; if (read) node.dataset.read = "";
    node.dataset.unavailable = disabled ? "true" : "false";
    node.disabled = disabled || (!read && host.busy());
    node.onclick = () => host.safe(callback); return node;
  }
  function check(label, checked, onChange, {disabled = false} = {}) {
    const control = text("input"); control.type = "checkbox"; control.checked = checked;
    control.dataset.unavailable = disabled ? "true" : "false";
    control.disabled = disabled || host.busy();
    control.onchange = () => host.safe(() => onChange(control.checked));
    return append(text("label", undefined, "commissioning-check"), control, text("span", label));
  }
  function contextNotice() {
    const draft = deploymentDraft();
    if (!draft || sameBasis(draft.basis, currentBasis())) return null;
    return card("Review the current saved context",
      text("p", "The selected deployment or native capture changed after this draft was opened. Your mappings and authored text are retained."),
      summary({"Draft revision": draft.basis?.revision, "Current revision": state.deployment?.revision}),
      button("Rebase draft onto this loaded capture", () => {
        if (state.loading || !sameBasis(state.loadedBasis, currentBasis())) throw new Error("Load the current saved deployment before rebasing.");
        draft.basis = clone(currentBasis()); draft.proposalSha256 = null; draft.proposalSignature = null;
        draft.acceptedFields = []; draft.acceptedIdentities = []; draft.correctionFields = []; draft.acceptedFindings = [];
        state.proposal = null;
        host.saveDraft(); render();
      }, {disabled: state.loading}));
  }
  function requireCurrent({reviewed = false} = {}) {
    const d = state.deployment, draft = deploymentDraft(), current = currentBasis();
    if (!d || d.commissioning_origin !== "external_import") throw new Error("Select a captured imported-plan deployment.");
    if (state.loading || !sameBasis(state.loadedBasis, current)) throw new Error("Wait for the selected original deployment to finish loading.");
    if (!sameBasis(draft?.basis, current)) throw new Error("Review and rebase the retained draft onto the current saved capture.");
    if (reviewed && !d.adoption_review_sha256) throw new Error("Save the identity and exception review first.");
    return {d, draft, basis: clone(current)};
  }
  function invoke(kind, args, extra = {}) {
    return host.action(kind, args, {commissioning: {workspaceId: workspace(), ...extra}});
  }
  function sourceReviewArgs() {
    const {d, draft} = requireCurrent();
    const rows = {};
    for (const family of FAMILIES) {
      rows[family] = {};
      const known = new Set((state.inventory?.families?.[family] || []).map(row => row.native_guid));
      const used = new Set();
      for (const [key, nativeGuid] of Object.entries(draft.rowIds[family] || {})) {
        if (!nativeGuid) continue;
        if (!GUID.test(nativeGuid) || !known.has(nativeGuid.toLowerCase())) throw new Error("Choose a captured " + family + " GUID for source " + key + ".");
        if (used.has(nativeGuid.toLowerCase())) throw new Error("Each selected " + family + " GUID must map to one source row.");
        used.add(nativeGuid.toLowerCase()); rows[family][key] = nativeGuid.toLowerCase();
      }
    }
    const exceptions = (state.intake?.import_exceptions || []).map(item => {
      const decision = draft.exceptionDecisions[item.id];
      if (!decision?.disposition || !decision.note?.trim()) throw new Error("Record a disposition and reason for every original import exception.");
      if (decision.disposition === "observed_resolved" && !decision.evidence_sha256?.length)
        throw new Error("Select retained evidence for each observed-resolution decision.");
      return {exception_id: item.id, disposition: decision.disposition, note: decision.note.trim(), evidence_sha256: [...(decision.evidence_sha256 || [])]};
    });
    return {deployment_id: d.id, expected_revision: d.revision, row_ids: rows,
      mappings: objectValue(draft.mappings, "Task conversion mappings"), exception_decisions: exceptions};
  }
  function signature(args) { return JSON.stringify(args); }
  function proposalArguments(args) {
    return {deployment_id: args.deployment_id, expected_revision: args.expected_revision,
      row_ids: Object.fromEntries(FAMILIES.map(family => [family, clone(args.row_ids?.[family] || {})])),
      mappings: clone(args.mappings || {}), exception_decisions: clone(args.exception_decisions || [])};
  }
  function proposalMatchesCapture(result, args, requestId) {
    const d = state.deployment;
    return !!d && result.schema === "portfolio.import-adoption-review-proposal.v1" &&
      result.request_id === requestId && result.deployment_id === args.deployment_id &&
      d.id === args.deployment_id && d.revision === args.expected_revision &&
      result.deployment_revision === d.revision && result.deployment_snapshot_sha256 === d.snapshot_sha256 &&
      result.source_edition_id === d.source_edition_id && result.capture_edition_id === d.capture_edition_id &&
      result.inventory_sha256 === d.commissioning_inventory_sha256 && HASH.test(result.proposal_sha256 || "") &&
      sameBasis(state.loadedBasis, currentBasis());
  }
  function authoredCopy(draft) {
    const {previousAuthoringDraft, recoveryRequestId, ...value} = draft;
    return clone(value);
  }
  function useSavedProposal(recovery, preserveDraft = true) {
    const {result, args, requestId} = recovery, draft = deploymentDraft();
    if (!proposalMatchesCapture(result, args, requestId)) throw new Error("This saved proposal belongs to an earlier capture. Inspect its original selection, then prepare a review from the current capture.");
    if (preserveDraft) draft.previousAuthoringDraft = authoredCopy(draft);
    const selected = proposalArguments(args);
    draft.basis = clone(currentBasis()); draft.rowIds = clone(selected.row_ids);
    draft.mappings = JSON.stringify(selected.mappings, null, 2);
    draft.exceptionDecisions = Object.fromEntries(selected.exception_decisions.map(item => [
      item.exception_id, {disposition: item.disposition, note: item.note, evidence_sha256: clone(item.evidence_sha256 || [])}
    ]));
    draft.proposalSha256 = result.proposal_sha256; draft.proposalSignature = signature(sourceReviewArgs());
    draft.acceptedFindings = []; draft.acceptedFields = []; draft.acceptedIdentities = []; draft.correctionFields = [];
    draft.recoveryRequestId = null; state.recoveryProposal = null; state.proposal = result;
    state.stage = "review"; host.saveDraft(); render();
  }
  function recoveredProposalCards() {
    const draft = deploymentDraft(), nodes = [], recovery = state.recoveryProposal;
    if (recovery) {
      const current = proposalMatchesCapture(recovery.result, recovery.args, recovery.requestId);
      nodes.push(card("Reopen the original saved proposal",
        summary({"Original request": recovery.requestId, "Saved proposal": recovery.result.proposal_sha256,
          "Proposal revision": recovery.result.deployment_revision, "Current revision": state.deployment.revision}),
        text("p", current ? "The saved proposal belongs to this current native capture. Your authored draft remains available while you review the original selection." :
          "This proposal belongs to an earlier saved capture. Its original mappings and findings remain available; the current capture needs its own reviewed proposal."),
        disclosure("Complete original proposal and request selection", {arguments: recovery.args, proposal: recovery.result}),
        button("Use this saved proposal and retain current draft", () => useSavedProposal(recovery), {disabled: !current})));
    }
    if (draft?.previousAuthoringDraft) nodes.push(card("Retained authored draft",
      disclosure("Complete previous authored selection and notes", draft.previousAuthoringDraft),
      button("Restore previous authored draft", async () => {
        const previous = clone(draft.previousAuthoringDraft), current = authoredCopy(draft);
        Object.assign(draft, previous); draft.previousAuthoringDraft = current;
        draft.recoveryRequestId = null; state.recoveryProposal = null; state.proposal = null;
        host.saveDraft(); await host.selectDeployment(state.deployment.id);
      })));
    return nodes;
  }
  function objectLink(label, hash) {
    if (!hash || !HASH.test(hash)) return null;
    return button(label, async () => {
      const selectedWorkspace = workspace(), generation = state.generation;
      const value = await host.api("/api/objects/" + hash);
      if (selectedWorkspace !== workspace() || generation !== state.generation) return;
      const dialog = root.querySelector("[data-commissioning-inspector]");
      dialog.replaceChildren(text("h3", label), text("p", hash, "commissioning-mono"), disclosure("Complete original object", value));
      dialog.querySelector("details").open = true; dialog.scrollIntoView({block: "nearest"});
    }, {read: true});
  }
  function evidenceChoices() {
    const rows = (state.intake?.evidence || []).map(item => [item.sha256, (item.title || item.filename) + " · " + item.class]);
    const d = state.deployment;
    for (const [label, hash] of [["Captured native inventory", d?.commissioning_inventory_sha256],
      ["Native identity and metadata", d?.commissioning_probe_sha256], ["Original reader responses", d?.capture_read_transport_sha256]])
      if (hash && !rows.some(row => row[0] === hash)) rows.push([hash, label]);
    return rows;
  }
  function renderEvidence() {
    const draft = state.intakeDraft, node = card("Original import evidence",
      text("p", "Retain the complete receipt, export, screenshot or operator statement that accompanies this imported project. Select its evidence class explicitly."));
    const files = text("input"); files.type = "file"; files.multiple = true; files.id = "commissioning-evidence-files";
    const filesLabel = append(text("label", undefined, "commissioning-field"), text("span", "Add complete evidence files"), files);
    files.onchange = () => host.safe(() => {
      for (const file of files.files) draft.evidence.push({id: crypto.randomUUID(), filename: file.name, file,
        class: "", title: file.name, format: "", source: null});
      files.value = ""; host.saveDraft(); render();
    });
    node.append(filesLabel);
    for (const evidence of draft.evidence) {
      const item = text("div", undefined, "commissioning-evidence");
      append(item, text("h4", evidence.filename),
        select("Evidence class", EVIDENCE_CLASSES, evidence.class, value => change(() => { evidence.class = value; }, false), {emptyLabel: "Select original evidence class"}).field,
        input("Evidence title", evidence.title, value => change(() => { evidence.title = value; }, false)).field,
        input("Original format (optional)", evidence.format, value => change(() => { evidence.format = value; }, false)).field,
        text("p", evidence.source ? "Retained · " + evidence.source.sha256 : evidence.file ? "Complete file selected for retention." : "Reselect this original file to retain its bytes.", "commissioning-hint"),
        button("Remove evidence selection", () => {
          draft.evidence = draft.evidence.filter(row => row.id !== evidence.id);
          host.saveDraft(); render();
        }));
      if (!evidence.source && !evidence.file) {
        const replacement = text("input"); replacement.type = "file";
        const label = append(text("label", undefined, "commissioning-field"), text("span", "Reselect the complete original file"), replacement);
        replacement.onchange = () => host.safe(() => {
          const file = replacement.files[0]; if (!file) return;
          if (evidence.title === evidence.filename) evidence.title = file.name;
          evidence.filename = file.name; evidence.file = file; host.saveDraft(); render();
        }); item.append(label);
      }
      node.append(item);
    }
    if (!draft.evidence.length) node.append(empty("No import evidence selected."));
    return node;
  }
  function renderIntakeExceptions() {
    const draft = state.intakeDraft, node = card("Original import exceptions",
      text("p", "Keep each reported exception's original coordinate and complete value. Its review decision is recorded after the native capture."));
    draft.exceptions.forEach((item, index) => {
      const row = text("div", undefined, "commissioning-exception");
      append(row, text("h4", "Original exception " + (index + 1)),
        select("Source evidence", draft.evidence.map(e => [e.id, e.title || e.filename]), item.evidenceId,
          value => change(() => { item.evidenceId = value; }, false), {emptyLabel: "Select original evidence"}).field,
        input("Original row, path or cell", item.coordinate, value => change(() => { item.coordinate = value; }, false)).field,
        select("Original value format", [["text", "Original text"], ["json", "Original structured value"]], item.format,
          value => change(() => { item.format = value; }, false)).field,
        input("Complete original exception", item.original, value => change(() => { item.original = value; }, false), {multiline: true, rows: 4}).field,
        button("Remove exception selection", () => { draft.exceptions.splice(index, 1); host.saveDraft(); render(); }));
      node.append(row);
    });
    node.append(button("Add original exception", () => {
      draft.exceptions.push({evidenceId: "", coordinate: "", original: "", format: "text"}); host.saveDraft(); render();
    }));
    return node;
  }
  function renderIntake() {
    const draft = state.intakeDraft;
    if (state.intake && state.deployment && !state.intakeOpen) {
      const imported = state.intake;
      const retained = card("Retained original import",
        summary({"Project": imported.project_id, "Source edition": imported.source_edition_id,
          "Original import time": imported.import_time, "Original project URL": imported.project_url}),
        table(["Original file", "Evidence class", "Bytes", "Original identity"],
          (imported.evidence || []).map(row => [row.title || row.filename, row.class, row.bytes, row.sha256]),
          "Retained original import evidence"),
        disclosure("Complete original import exceptions", imported.import_exceptions || []),
        disclosure("Original supplied import settings", imported.import_settings),
        button("Prepare another imported plan", () => { state.intakeOpen = true; render(); }, {read: true}));
      const downloads = text("div", undefined, "artifacts");
      host.artifacts(downloads, (imported.evidence || []).map(row => ({sha256: row.sha256, bytes: row.bytes, filename: row.filename})));
      retained.append(downloads); return retained;
    }
    const form = text("form"); form.setAttribute("aria-label", "Adopt an existing imported plan");
    const current = intakeBasis();
    const emptyDraft = !draft.projectId && !draft.label && !draft.projectUrl && !draft.importTime &&
      !draft.evidence.length && !draft.exceptions.length && draft.settings === "{}";
    if (!state.intakeBasis || emptyDraft) state.intakeBasis = current;
    append(form, card("Select the imported project",
      summary({"Original source edition": host.sourceId() || "Select an edition in Source",
        "Workspace": workspace()}),
      select("Native target profile", state.profiles.filter(p => p.kind === "project_operations").map(p => [p.id, p.label || p.id]),
        draft.profileId, value => { change(() => { draft.profileId = value; }, false); render(); }, {emptyLabel: "Select configured native target"}).field,
      input("Existing project GUID", draft.projectId, value => change(() => { draft.projectId = value; }, false)).field,
      input("Project label", draft.label, value => change(() => { draft.label = value; }, false)).field,
      input("Original project URL (optional)", draft.projectUrl, value => change(() => { draft.projectUrl = value; }, false), {type: "url"}).field,
      input("Original import time (as supplied)", draft.importTime, value => change(() => { draft.importTime = value; }, false)).field,
      append(text("details"), text("summary", "Original import settings"),
        input("Supplied import settings", draft.settings, value => change(() => { draft.settings = value; }, false), {multiline: true, rows: 5}).field)
    ), renderEvidence(), renderIntakeExceptions());
    if (!sameBasis(state.intakeBasis, current)) {
      form.append(card("Review selected source",
        text("p", "The workspace or source edition changed while this import draft was open. The selected evidence remains in this draft."),
        button("Use the currently selected source edition", () => { state.intakeBasis = intakeBasis(); host.saveDraft(); render(); })));
    }
    const submit = button("Retain import and capture existing plan", () => form.requestSubmit(), {
      primary: true, disabled: !host.sourceId() || !state.profiles.some(p => p.id === draft.profileId && p.kind === "project_operations") ||
        !sameBasis(state.intakeBasis, current)
    });
    form.append(append(text("div", undefined, "commissioning-actions"), submit));
    form.onsubmit = event => { event.preventDefault(); host.safe(async () => {
      if (host.busy()) throw new Error("Finish or reopen the saved request first.");
      const selectedBasis = clone(intakeBasis());
      if (!sameBasis(state.intakeBasis, selectedBasis)) throw new Error("Review the current source selection before retaining this import.");
      if (!GUID.test(draft.projectId.trim())) throw new Error("Use the existing project's complete GUID.");
      if (!draft.evidence.length) throw new Error("Select complete original import evidence.");
      const chosen = draft.evidence.map(item => ({...item}));
      if (chosen.some(item => !item.class || (!item.source && !item.file))) throw new Error("Select a class and complete original file for every evidence item.");
      const selected = {edition_id: selectedBasis.sourceEditionId, profile_id: draft.profileId,
        project_id: draft.projectId.trim().toLowerCase(), import_settings: objectValue(draft.settings, "Original import settings")};
      for (const [key, value] of [["label", draft.label], ["project_url", draft.projectUrl], ["import_time", draft.importTime]])
        if (value !== "") selected[key] = value;
      const exceptions = clone(draft.exceptions);
      host.setPosting(true);
      try {
        for (const item of chosen) {
          if (!item.source) {
            item.source = await host.upload(item.file);
            const retained = draft.evidence.find(row => row.id === item.id);
            if (retained) { retained.source = item.source; host.saveDraft(); }
          }
        }
      } finally { host.setPosting(false); }
      if (!sameBasis(selectedBasis, intakeBasis())) { render(); throw new Error("The source selection changed during upload. Review the current source; the uploaded originals remain retained."); }
      selected.evidence = chosen.map(item => ({source: clone(item.source), class: item.class, title: item.title || item.filename,
        ...(item.format ? {format: item.format} : {})}));
      selected.import_exceptions = exceptions.map(item => {
        const original = chosen.find(row => row.id === item.evidenceId);
        if (!original || !item.coordinate.trim()) throw new Error("Select the original evidence and coordinate for each import exception.");
        return {evidence_sha256: original.source.sha256, coordinate: item.coordinate,
          original: valueInput(item.original, item.format)};
      });
      await invoke("adopt_existing", selected, {intakeBasis: selectedBasis});
    }); };
    return form;
  }
  async function loadRows(offset = state.offset, family = state.family) {
    if (!state.deployment) return;
    const generation = state.generation, selected = state.deployment.source_edition_id, ws = workspace();
    state.rowsLoading = true; state.rowsError = ""; render();
    const stillSelected = () => generation === state.generation && ws === workspace() &&
      family === state.family && offset === state.offset;
    try {
      const page = await host.api("/api/editions/" + selected + "?family=" + family + "&offset=" + offset + "&limit=50");
      if (!stillSelected()) return;
      if (page.edition_id !== selected || page.family !== family) throw new Error("The source page does not match the selected original family.");
      state.sourceRows = page.items; state.sourceTotal = page.total; state.nextOffset = page.next_offset;
    } catch (error) {
      if (stillSelected()) { state.sourceRows = []; state.rowsError = error.message || String(error); state.nextOffset = null; }
      throw error;
    } finally { if (stillSelected()) { state.rowsLoading = false; render(); } }
  }
  function renderMappings() {
    const draft = deploymentDraft(), family = state.family, native = state.inventory?.families?.[family] || [];
    const node = card("Map original rows to captured native identities",
      text("p", "Choose each exact native GUID from this project's captured inventory. Source names and reader candidates remain visible for review."));
    const controls = append(text("div", undefined, "commissioning-actions"),
      select("Original row family", FAMILIES.map(f => [f, f[0].toUpperCase() + f.slice(1)]), family, async value => {
        state.family = value; state.offset = 0; state.sourceRows = []; await loadRows(0, value);
      }, {read: true}).field,
      button("Previous source rows", async () => { state.offset = Math.max(0, state.offset - 50); await loadRows(); },
        {read: true, disabled: state.offset === 0}),
      button("Next source rows", async () => { if (state.nextOffset !== null) { state.offset = state.nextOffset; await loadRows(); } },
        {read: true, disabled: state.nextOffset === null}));
    node.append(controls);
    if (state.rowsLoading) { node.append(text("p", "Loading the selected original source rows…", "commissioning-status")); return node; }
    if (state.rowsError) { node.append(card("Reload the selected original rows", text("p", state.rowsError), button("Reload source page", () => loadRows(), {read: true}))); return node; }
    node.append(text("p", state.sourceTotal ? "Rows " + (state.offset + 1) + "–" +
      (state.offset + state.sourceRows.length) + " of " + state.sourceTotal + " · " + native.length + " captured native rows." :
      "This source family has no original rows.", "commissioning-hint"));
    const datalist = text("datalist"); datalist.id = id("native-options");
    for (const row of native) { const o = text("option"); o.value = row.native_guid; o.label = originalName(row); datalist.append(o); }
    node.append(datalist);
    const rows = state.sourceRows.map(row => {
      const selected = draft.rowIds[family]?.[row.key] || "";
      const nativeLabel = text("span");
      const showSelectedNative = () => {
        const guid = draft.rowIds[family]?.[row.key] || "", chosen = native.find(item => item.native_guid === guid);
        nativeLabel.textContent = chosen ? originalName(chosen) : guid ? "Review this GUID against the captured inventory" : "Unmapped";
      };
      showSelectedNative();
      const mapping = input("Native GUID for " + row.key, selected, value => change(() => {
        draft.rowIds[family] ||= {}; const guid = value.trim().toLowerCase();
        if (guid) draft.rowIds[family][row.key] = guid; else delete draft.rowIds[family][row.key];
        showSelectedNative();
      }));
      mapping.control.setAttribute("list", datalist.id); mapping.control.classList.add("commissioning-mono");
      const actions = append(text("div", undefined, "commissioning-actions"),
        button("Inspect source row", () => { const inspector = root.querySelector("[data-commissioning-inspector]");
          inspector.replaceChildren(text("h3", "Original source row"), disclosure(family + " / " + row.key, row));
          inspector.querySelector("details").open = true; }, {read: true}),
        button("Inspect selected native row", () => {
          const exact = (state.inventory?.families?.[family] || []).find(item => item.native_guid === draft.rowIds[family]?.[row.key]);
          if (!exact) throw new Error("Choose a row from the captured native inventory.");
          const inspector = root.querySelector("[data-commissioning-inspector]");
          inspector.replaceChildren(text("h3", "Captured native row"), disclosure(exact.native_guid, exact));
          inspector.querySelector("details").open = true;
        }, {read: true}));
      return [row.key, originalName(row), mapping.field, nativeLabel, actions];
    });
    node.append(table(["Source key", "Original name", "Selected native GUID", "Captured row", "Inspect"], rows, "Original rows and explicit native identity mappings"));
    node.append(disclosure("Complete captured " + family + " inventory", native),
      disclosure("Original bucket observations", state.inventory?.bucket_observations || []));
    return node;
  }
  function renderExceptionDecisions() {
    const draft = deploymentDraft(), node = card("Review every original import exception"), originals = state.intake?.import_exceptions || [];
    if (!originals.length) { node.append(empty("The retained import contains no exception rows.")); return node; }
    for (const item of originals) {
      draft.exceptionDecisions[item.id] ||= {disposition: "", note: "", evidence_sha256: []};
      const decision = draft.exceptionDecisions[item.id];
      const row = card("Exception at " + display(item.coordinate),
        disclosure("Complete original exception and source", item),
        select("Disposition", DISPOSITIONS, decision.disposition, value => change(() => { decision.disposition = value; }), {emptyLabel: "Select a decision"}).field,
        input("Reason for this exception decision", decision.note, value => change(() => { decision.note = value; }), {multiline: true}).field);
      const evidence = text("fieldset"); evidence.append(text("legend", "Retained supporting evidence"));
      for (const [hash, label] of evidenceChoices()) evidence.append(check(label, decision.evidence_sha256.includes(hash), checked => change(() => {
        decision.evidence_sha256 = checked ? [...new Set([...decision.evidence_sha256, hash])] : decision.evidence_sha256.filter(value => value !== hash);
      })));
      row.append(evidence); node.append(row);
    }
    return node;
  }
  function renderComparison(basis = state.basis, selectable = false) {
    const node = card("Source, intended and observed values");
    if (!basis) { node.append(empty("The selected native capture has no saved field comparison yet.")); return node; }
    const counts = basis.counts || {};
    node.append(summary({"Equal": counts.equal ?? 0, "Different": counts.different ?? 0,
      "Unmapped": counts.unmapped ?? 0, "Unobserved": counts.unobserved ?? 0}));
    node.append(select("Show field outcomes", [["all", "All fields"], ["different", "Different"],
      ["unmapped", "Unmapped"], ["unobserved", "Unobserved"], ["equal", "Equal"]], state.comparisonFilter,
      value => { state.comparisonFilter = value; state.comparisonLimit = 50; render(); }, {read: true}).field);
    const all = (basis.fields || []).filter(row => state.comparisonFilter === "all" || row.status === state.comparisonFilter);
    const draft = deploymentDraft();
    const rows = all.slice(0, state.comparisonLimit).map(row => {
      const first = append(text("div"), text("strong", row.key), text("p", row.source_field + " → " + row.target_field, "commissioning-mono"));
      const inspect = button("Inspect exact field", () => {
        const inspector = root.querySelector("[data-commissioning-inspector]");
        inspector.replaceChildren(text("h3", "Source, intent and native observation"), disclosure(row.id, row));
        inspector.querySelector("details").open = true;
      }, {read: true});
      const selection = selectable ? check("Select for correction", draft.correctionFields.includes(row.id), checked => change(() => {
        draft.correctionFields = checked ? [...new Set([...draft.correctionFields, row.id])] : draft.correctionFields.filter(value => value !== row.id);
      }, false), {disabled: row.status !== "different" || !row.native_guid || !row.observed_present}) : inspect;
      return [first, display(row.source_value), display(row.target_value),
        row.observed_present ? display(row.observed_value) : "Unreported", row.status, append(text("div"), selection, selectable ? inspect : null)];
    });
    node.append(table(["Original field", "Source value", "Intended native value", "Observed native value", "Outcome", selectable ? "Correction" : "Inspect"], rows, "Source intended and observed field comparison"));
    if (all.length > state.comparisonLimit) node.append(button("Show more fields", () => { state.comparisonLimit += 100; render(); }, {read: true}));
    node.append(text("p", "Showing " + Math.min(all.length, state.comparisonLimit) + " of " + all.length + " selected fields.", "commissioning-hint"));
    return node;
  }
  function renderReview() {
    const draft = deploymentDraft(), d = state.deployment, node = text("div");
    append(node, ...recoveredProposalCards());
    if (d.plan?.mode !== "external_import_adoption") {
      append(node, card("Reviewed correction deployment",
        text("p", "The selected child retains its original adoption and prepared correction. Continue its reviewed native journal from Correction."),
        button("Open correction workflow", () => { state.stage = "correction"; render(); }, {read: true})),
        renderComparison(), disclosure("Complete selected correction plan", d.plan),
        objectLink("Inspect original adoption review", d.adoption_review_sha256),
        objectLink("Inspect the pinned parent deployment", d.parent_snapshot_sha256));
      return node;
    }
    append(node, renderMappings(), renderExceptionDecisions(),
      card("Task value conversions",
        text("p", "The maintained defaults map NAME, START and FINISH. Additional conversions retain the exact field, time zone and choice decisions."),
        append(text("details"), text("summary", "Review task conversion mappings"),
          input("Task conversion mappings", draft.mappings, value => change(() => { draft.mappings = value; }), {multiline: true, rows: 8}).field)),
      button("Prepare identity and exception review", async () => {
        const args = sourceReviewArgs();
        await invoke("prepare_adoption_review", args, {basis: clone(draft.basis), draftSignature: signature(args)});
      }, {primary: true, disabled: !sameBasis(draft.basis, currentBasis())}));
    const proposal = state.proposal;
    if (proposal) {
      const proposalGroup = text("div"); proposalGroup.dataset.commissioningProposal = "";
      node.append(proposalGroup);
      append(proposalGroup, renderComparison(proposal.intended_observed),
        card("Save this proposed review",
          summary({"Saved proposal": draft.proposalSha256, "Deployment revision": proposal.deployment_revision,
            "Captured inventory": proposal.inventory_sha256}),
          input("Reviewer", draft.reviewer, value => change(() => { draft.reviewer = value; }, false)).field,
          input("Review note", draft.reviewNote, value => change(() => { draft.reviewNote = value; }, false), {multiline: true}).field));
      const reviewCard = proposalGroup.lastChild, findings = proposal.plan?.findings || [];
      const fieldset = text("fieldset"); fieldset.append(text("legend", "Review each original finding"));
      for (const finding of findings) {
        const item = append(text("div", undefined, "commissioning-finding"),
          check(finding.code || finding.id, draft.acceptedFindings.includes(finding.id), checked => change(() => {
            draft.acceptedFindings = checked ? [...new Set([...draft.acceptedFindings, finding.id])] : draft.acceptedFindings.filter(value => value !== finding.id);
          }, false)), text("p", finding.message || ""), disclosure("Full finding", finding));
        fieldset.append(item);
      }
      reviewCard.append(fieldset, button("Save reviewed identities and exceptions", async () => {
        const current = requireCurrent(), args = sourceReviewArgs();
        if (!draft.proposalSha256 || signature(args) !== draft.proposalSignature ||
            proposal.deployment_revision !== current.d.revision || proposal.inventory_sha256 !== current.d.commissioning_inventory_sha256)
          throw new Error("Prepare a review from the currently displayed mappings and capture.");
        const required = proposal.required_finding_ids || [];
        if (required.some(key => !draft.acceptedFindings.includes(key))) throw new Error("Review each required finding before saving.");
        await invoke("review_adoption", {deployment_id: current.d.id, expected_revision: current.d.revision,
          proposal_sha256: draft.proposalSha256, reviewer: draft.reviewer.trim(), note: draft.reviewNote.trim(),
          accepted_findings: [...draft.acceptedFindings]}, {basis: current.basis});
      }, {primary: true, disabled: !sameBasis(draft.basis, currentBasis())}));
    } else node.append(renderComparison());
    return node;
  }
  function renderCorrection() {
    const {deployment: d} = state, draft = deploymentDraft(), node = text("div");
    const correction = d.plan?.mode === "task_correction";
    append(node, renderComparison(state.basis, !correction));
    if (!correction) {
      const choices = state.editions.map(row => [row.id, row.id.slice(0, 12) + " · " + row.kind]);
      append(node, card("Prepare a correction from observed values",
        text("p", "Select the different task fields above. The existing native values are read again and retained before a correction plan is prepared. The original source edition can remain the intended result."),
        select("Intended source edition", choices, draft.correctionEdition || d.source_edition_id,
          value => change(() => { draft.correctionEdition = value; }, false)).field,
        text("p", draft.correctionFields.length + " fields selected.", "commissioning-hint"),
        button("Prepare selected task correction", async () => {
          const current = requireCurrent({reviewed: true});
          const chosen = (state.basis?.fields || []).filter(row => draft.correctionFields.includes(row.id));
          if (!chosen.length) throw new Error("Select the different task fields to correct.");
          if (chosen.length !== draft.correctionFields.length) throw new Error("The selected comparison changed; review its current fields.");
          await invoke("prepare_observed_correction", {deployment_id: current.d.id, expected_revision: current.d.revision,
            basis_sha256: current.d.commissioning_comparison_sha256, edition_id: draft.correctionEdition || current.d.source_edition_id,
            selected_fields: chosen.map(row => ({source_key: row.key, target_field: row.target_field}))}, {basis: current.basis});
        }, {primary: true, disabled: !d.adoption_review_sha256 || !["CAPTURED", "ACCEPTED"].includes(d.state) || !sameBasis(draft.basis, currentBasis())})));
      return node;
    }
    const planCard = card("Review the prepared native correction",
      summary({"Deployment": d.id, "Parent": d.parent_deployment_id, "State": d.state,
        "Saved native review": d.review_sha256 || "Awaiting review"}),
      disclosure("Original task correction plan, before values and native request bodies", d.plan));
    append(planCard,
      input("Correction reviewer", draft.reviewer, value => change(() => { draft.reviewer = value; }, false)).field,
      input("Correction review note", draft.reviewNote, value => change(() => { draft.reviewNote = value; }, false), {multiline: true}).field);
    const findings = text("fieldset"); findings.append(text("legend", "Review correction findings"));
    for (const finding of d.plan.findings || []) findings.append(append(text("div", undefined, "commissioning-finding"),
      check(finding.code || finding.id, draft.acceptedFindings.includes(finding.id), checked => change(() => {
        draft.acceptedFindings = checked ? [...new Set([...draft.acceptedFindings, finding.id])] : draft.acceptedFindings.filter(value => value !== finding.id);
      }, false)), text("p", finding.message || ""), disclosure("Complete correction finding", finding)));
    planCard.append(findings, button("Save correction review", async () => {
      const current = requireCurrent();
      await invoke("review", {deployment_id: current.d.id, expected_revision: current.d.revision,
        reviewer: draft.reviewer.trim(), note: draft.reviewNote.trim(), accepted_findings: [...draft.acceptedFindings]}, {basis: current.basis});
    }, {disabled: !sameBasis(draft.basis, currentBasis())}));
    node.append(planCard,
      card("Continue the original native journal",
        text("p", "The reviewed correction uses the existing operation sets, native replies and saved request recovery. Read the journal before resuming an interrupted native operation."),
        disclosure("Native calls and operation sets", {calls: d.calls, batches: d.batches, observations: d.observations, error: d.error}),
        check("Retry an explicitly rejected native request", draft.retryRejected, checked => change(() => { draft.retryRejected = checked; }, false)),
        button("Execute reviewed correction", async () => {
          const current = requireCurrent();
          if (!current.d.review_sha256) throw new Error("Save the original correction review first.");
          await invoke("continue", {deployment_id: current.d.id, review_sha256: current.d.review_sha256,
            retry_rejected: !!draft.retryRejected}, {basis: current.basis});
        }, {primary: true, disabled: !d.review_sha256 || ["NATIVE_COMPLETE", "CAPTURED", "ACCEPTED"].includes(d.state) || !sameBasis(draft.basis, currentBasis())}),
        button("Open native recapture and acceptance", () => { state.stage = "receiving"; render(); }, {read: true}),
        button("Read existing native request controls", () => host.showTab("migration"), {read: true})));
    return node;
  }
  function renderReceiving() {
    const d = state.deployment, draft = deploymentDraft(), node = text("div");
    append(node, card("Capture the current native project",
      text("p", "A new capture retains complete native observations. After a correction completes, compare that capture with the selected source intent."),
      summary({"Capture edition": d.capture_edition_id, "Native capture state": d.capture_in_progress || "No interrupted capture"}),
      button("Capture current native values", async () => {
        const current = requireCurrent();
        await invoke("capture_target", {deployment_id: current.d.id, expected_revision: current.d.revision}, {basis: current.basis});
      }, {disabled: !["NATIVE_COMPLETE", "CAPTURED", "ACCEPTED"].includes(d.state) || !!d.capture_in_progress || !sameBasis(draft.basis, currentBasis())}),
      d.capture_in_progress ? button("Open original capture request activity", () => host.showTab("history"), {read: true}) : null,
      objectLink("Inspect complete original native inventory", d.commissioning_inventory_sha256),
      objectLink("Inspect original native reader responses", d.capture_read_transport_sha256)));
    append(node, renderComparison());
    const nonEqual = (state.basis?.fields || []).filter(row => row.status !== "equal"), identities = d.commissioning_identity_findings || [];
    const acceptance = card("Accept the reviewed receiving result",
      summary({"Saved acceptance": d.acceptance_sha256 || "Awaiting receiving decision"}),
      d.acceptance ? disclosure("Complete saved receiving acceptance", d.acceptance) : null,
      input("Receiving reviewer", draft.acceptReviewer, value => change(() => { draft.acceptReviewer = value; }, false)).field,
      input("Receiving decision and reason", draft.acceptNote, value => change(() => { draft.acceptNote = value; }, false), {multiline: true}).field,
      input("Retained difference notes (one per line)", draft.acceptExceptions, value => change(() => { draft.acceptExceptions = value; }, false), {multiline: true}).field);
    const fields = text("fieldset"); fields.append(text("legend", "Retain each non-equal field explicitly"));
    for (const row of nonEqual) fields.append(check(row.key + " · " + row.target_field + " · " + row.status,
      draft.acceptedFields.includes(row.id), checked => change(() => {
        draft.acceptedFields = checked ? [...new Set([...draft.acceptedFields, row.id])] : draft.acceptedFields.filter(value => value !== row.id);
      }, false)));
    if (!nonEqual.length) fields.append(empty("All compared mapped fields are equal."));
    const identity = text("fieldset"); identity.append(text("legend", "Review each identity finding"));
    for (const row of identities) identity.append(append(text("div", undefined, "commissioning-finding"),
      check(row.code || row.id, draft.acceptedIdentities.includes(row.id), checked => change(() => {
        draft.acceptedIdentities = checked ? [...new Set([...draft.acceptedIdentities, row.id])] : draft.acceptedIdentities.filter(value => value !== row.id);
      }, false)), text("p", row.message || ""), disclosure("Complete identity finding", row)));
    append(acceptance, fields, identity, button("Save receiving acceptance", async () => {
      const current = requireCurrent({reviewed: true});
      const requiredFields = (state.basis?.fields || []).filter(row => row.status !== "equal").map(row => row.id);
      const requiredIdentities = (current.d.commissioning_identity_findings || []).map(row => row.id);
      if (requiredFields.some(key => !draft.acceptedFields.includes(key)) || requiredIdentities.some(key => !draft.acceptedIdentities.includes(key)))
        throw new Error("Review every non-equal field and identity finding before accepting.");
      await invoke("accept", {deployment_id: current.d.id, expected_revision: current.d.revision,
        comparison_sha256: current.d.comparison_sha256, commissioning_comparison_sha256: current.d.commissioning_comparison_sha256,
        reviewer: draft.acceptReviewer.trim(), note: draft.acceptNote.trim(),
        exceptions: draft.acceptExceptions.split("\n").map(value => value.trim()).filter(Boolean),
        accepted_commissioning_fields: requiredFields, accepted_identity_findings: requiredIdentities}, {basis: current.basis});
    }, {primary: true, disabled: !d.adoption_review_sha256 || !d.comparison_sha256 || !sameBasis(draft.basis, currentBasis())}));
    node.append(acceptance);
    const delivery = card("Deliver the complete commissioned project",
      text("p", "The handover retains original import evidence, reviewed identities, source/intent/observed values, accepted differences and the pinned correction history."),
      button("Create complete commissioning handover", async () => {
        const current = requireCurrent();
        await invoke("commissioning_handover", {deployment_id: current.d.id}, {basis: current.basis});
      }, {disabled: !d.acceptance_sha256 || !sameBasis(draft.basis, currentBasis())}),
      button("Export the full editable workspace", () => invoke("archive", {}, {deploymentId: d.id})),
      button("Open portfolio archive", () => host.showTab("archive"), {read: true}));
    const artifacts = text("div", undefined, "artifacts"); host.artifacts(artifacts, state.artifacts); delivery.append(artifacts);
    node.append(delivery);
    const rebind = card("Receive under another configured principal",
      text("p", "Select the receiving host's configured profile and explain the handover. The application verifies the same organization and project, retains the original principal, and captures a new reviewed adoption entry."),
      select("Receiving native profile", state.profiles.filter(p => p.kind === "project_operations").map(p => [p.id, p.label || p.id]),
        draft.rebindProfile, value => change(() => { draft.rebindProfile = value; }, false), {emptyLabel: "Select receiving profile"}).field,
      input("Rebind reviewer", draft.rebindReviewer, value => change(() => { draft.rebindReviewer = value; }, false)).field,
      input("Reason for the receiving profile", draft.rebindNote, value => change(() => { draft.rebindNote = value; }, false), {multiline: true}).field,
      button("Capture the same project under this profile", async () => {
        const current = requireCurrent();
        if (!draft.rebindProfile) throw new Error("Select a configured receiving profile.");
        await invoke("rebind_imported_target", {deployment_id: current.d.id, expected_revision: current.d.revision,
          profile_id: draft.rebindProfile, reviewer: draft.rebindReviewer.trim(), note: draft.rebindNote.trim()}, {basis: current.basis});
      }, {disabled: !sameBasis(draft.basis, currentBasis())}));
    node.append(rebind); return node;
  }
  function render() {
    root.replaceChildren(); root.setAttribute("aria-busy", state.loading ? "true" : "false");
    const heading = append(text("div", undefined, "commissioning-heading"), text("h2", "Existing-plan commissioning"),
      text("p", "Adopt the imported project, review its actual native rows, correct selected task values and deliver the complete receiving history."));
    root.append(heading);
    const nav = text("div", undefined, "commissioning-tabs"); nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", "Commissioning steps");
    for (const [key, label] of [["intake", "Import & evidence"], ["review", "Identity & exceptions"], ["correction", "Observed corrections"], ["receiving", "Acceptance & handover"]]) {
      const tab = button(label, () => { state.stage = key; host.saveDraft(); render(); }, {read: true});
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", key === state.stage ? "true" : "false");
      tab.setAttribute("aria-controls", "commissioning-active-step");
      tab.tabIndex = key === state.stage ? 0 : -1;
      tab.onkeydown = event => {
        const tabs = [...nav.querySelectorAll("[role=tab]")], index = tabs.indexOf(tab);
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length :
          event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length :
          event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); const label = tabs[next].textContent; tabs[next].click();
        [...root.querySelectorAll("[role=tab]")].find(item => item.textContent === label)?.focus();
      }; nav.append(tab);
    }
    root.append(nav);
    const selection = card("Saved commissioning deployment",
      select("Imported plan", state.deployments.filter(d => d.commissioning_origin === "external_import").map(d => [d.id, (d.project_name || d.id.slice(0, 12)) + " · " + d.state]),
        state.deployment?.id || "", async value => { if (value) await host.selectDeployment(value); }, {read: true, emptyLabel: "Select an existing captured plan"}).field,
      host.hasMoreDeployments() ? button("More saved commissioning plans", () => host.loadMoreDeployments(), {read: true}) : null);
    if (state.deployment) append(selection, summary({"Project": state.deployment.project_name || state.deployment.project_id,
      "Revision": state.deployment.revision, "State": state.deployment.state, "Original source edition": state.deployment.source_edition_id,
      "Native capture": state.deployment.capture_edition_id, "Parent": state.deployment.parent_deployment_id || "Original imported plan"}),
      objectLink("Inspect original import evidence and settings", state.deployment.import_intake_sha256));
    root.append(selection);
    if (state.loading) root.append(text("p", "Loading the original saved capture and source rows…", "commissioning-status"));
    const body = text("div"); body.id = "commissioning-active-step"; body.setAttribute("role", "tabpanel");
    if (state.stage === "intake") body.append(renderIntake());
    else if (!state.deployment || state.deployment.commissioning_origin !== "external_import")
      body.append(empty("Retain an imported plan or select its saved commissioning deployment above."));
    else if (!state.loading && !state.loadedBasis) {
      body.append(card("Load the complete saved capture", text("p", state.loadError || "The selected capture is not loaded."),
        button("Reload original deployment", () => host.selectDeployment(state.deployment.id), {read: true})));
    } else if (!state.loading) {
      append(body, contextNotice());
      body.append(state.stage === "review" ? renderReview() : state.stage === "correction" ? renderCorrection() : renderReceiving());
    }
    root.append(body);
    const inspector = text("section", undefined, "commissioning-inspector"); inspector.dataset.commissioningInspector = "";
    inspector.setAttribute("aria-label", "Original commissioning source inspector"); root.append(inspector);
    host.lock();
  }
  function newDraft(d, basis) {
    const exceptionDecisions = {};
    for (const row of d.plan?.import_exception_review || []) exceptionDecisions[row.original.id] = clone(row.decision);
    return {basis: clone(basis), rowIds: clone(d.plan?.row_ids || Object.fromEntries(FAMILIES.map(f => [f, {}]))),
      mappings: JSON.stringify(d.plan?.mappings || {}, null, 2), exceptionDecisions,
      proposalSha256: null, proposalSignature: null, acceptedFindings: [...(d.review?.accepted_findings || [])],
      reviewer: d.review?.reviewer || "", reviewNote: d.review?.note || "", correctionFields: [], correctionEdition: d.source_edition_id,
      retryRejected: false, acceptReviewer: "", acceptNote: "", acceptExceptions: "",
      acceptedFields: [], acceptedIdentities: [], rebindProfile: "", rebindReviewer: "", rebindNote: ""};
  }
  async function loadDeployment(d = host.deployment()) {
    const generation = ++state.generation, ws = workspace();
    state.deployment = d?.commissioning_origin === "external_import" ? d : null;
    state.inventory = state.intake = state.basis = state.proposal = state.recoveryProposal = state.source = null;
    state.sourceRows = []; state.sourceTotal = 0; state.nextOffset = null; state.offset = 0;
    state.loadedBasis = null;
    if (!state.deployment) { state.loading = false; render(); return; }
    const selectedBasis = currentBasis();
    if (!state.drafts[d.id]) state.drafts[d.id] = newDraft(d, selectedBasis);
    const draft = state.drafts[d.id]; state.loading = true; state.loadError = ""; state.rowsError = ""; render();
    const object = hash => hash ? host.api("/api/objects/" + hash) : Promise.resolve(null);
    try {
      const [inventory, intake, basis, source, proposal, recoveryRequest] = await Promise.all([
        object(d.commissioning_inventory_sha256), object(d.import_intake_sha256),
        object(d.commissioning_comparison_sha256), host.api("/api/editions/" + d.source_edition_id),
        object(draft.proposalSha256),
        draft.recoveryRequestId ? host.api("/api/requests/" + draft.recoveryRequestId) : Promise.resolve(null)
      ]);
      if (generation !== state.generation || ws !== workspace() || !sameBasis(selectedBasis, currentBasis())) return;
      state.inventory = inventory; state.intake = intake; state.basis = basis; state.source = source;
      if (proposal && proposal.deployment_id === d.id && proposal.deployment_revision === d.revision &&
          proposal.deployment_snapshot_sha256 === d.snapshot_sha256 &&
          proposal.source_edition_id === d.source_edition_id && proposal.capture_edition_id === d.capture_edition_id &&
          proposal.inventory_sha256 === d.commissioning_inventory_sha256) {
        const [plan, comparison] = await Promise.all([object(proposal.plan_sha256), object(proposal.basis_sha256)]);
        if (generation !== state.generation || ws !== workspace() || !sameBasis(selectedBasis, currentBasis())) return;
        state.proposal = {...proposal, plan, intended_observed: comparison};
      }
      if (recoveryRequest?.state === "COMPLETE" && recoveryRequest.kind === "prepare_adoption_review" &&
          recoveryRequest.arguments?.deployment_id === d.id && recoveryRequest.result?.request_id === recoveryRequest.id) {
        state.recoveryProposal = {requestId: recoveryRequest.id, args: recoveryRequest.arguments, result: recoveryRequest.result};
      }
      state.loadedBasis = clone(selectedBasis); state.loading = false; await loadRows(0, state.family);
    } catch (error) {
      if (generation === state.generation && ws === workspace()) state.loadError = error.message || String(error);
      throw error;
    } finally {
      if (generation === state.generation && ws === workspace()) { state.loading = false; render(); }
    }
  }
  function updateState(value, editions) {
    const ws = workspace();
    if (state.workspace && state.workspace !== ws) {
      state.generation++; state.deployment = null; state.inventory = state.intake = state.basis = state.proposal = state.recoveryProposal = null;
      state.loadedBasis = null;
    }
    state.workspace = ws; state.profiles = value.profiles || []; state.editions = editions || [];
    state.deployments = host.deployments();
    render();
  }
  async function acceptResult(request, result, context = {}) {
    const origin = context.commissioning;
    const originalFlow = ["review", "continue", "capture_target", "accept"].includes(request.kind) && !!origin;
    if (request.kind === "archive" && origin) {
      if (!origin.workspaceId || origin.workspaceId === workspace()) {
        const item = {...result.archive, filename: result.filename};
        if (item.sha256 && !state.artifacts.some(old => old.sha256 === item.sha256 && old.filename === item.filename))
          state.artifacts.push(item);
      }
      return false;
    }
    if (!OWN_ACTIONS.has(request.kind) && !originalFlow) return false;
    if (origin?.workspaceId && origin.workspaceId !== workspace()) return true;
    if (request.kind === "prepare_adoption_review") {
      const selected = request.arguments.deployment_id;
      if (!origin?.draftSignature) {
        const selectedWorkspace = workspace();
        if (request.state !== "COMPLETE" || result.request_id !== request.id || result.deployment_id !== selected)
          throw new Error("Open the complete original saved proposal request.");
        await host.selectDeployment(selected);
        if (selectedWorkspace !== workspace() || state.deployment?.id !== selected) return true;
        const draft = deploymentDraft(), recovery = {requestId: request.id, args: clone(request.arguments), result: clone(result)};
        draft.recoveryRequestId = request.id; state.recoveryProposal = recovery; state.stage = "review";
        let sameSelection = false;
        try { sameSelection = signature(sourceReviewArgs()) === signature(proposalArguments(request.arguments)); } catch {}
        if (sameSelection && proposalMatchesCapture(result, request.arguments, request.id)) useSavedProposal(recovery, false);
        else { host.saveDraft(); render(); }
        host.showTab("commissioning"); return true;
      }
      const draft = state.drafts[selected];
      if (draft && origin?.draftSignature && sameBasis(draft.basis, origin.basis)) {
        const currentSignature = selected === state.deployment?.id && sameBasis(draft.basis, currentBasis()) ? signature(sourceReviewArgs()) : null;
        if (currentSignature === origin.draftSignature) {
          draft.proposalSha256 = result.proposal_sha256; draft.proposalSignature = origin.draftSignature;
          draft.acceptedFindings = []; state.proposal = result; state.stage = "review";
        }
      }
      host.saveDraft(); render(); return true;
    }
    if (request.kind === "commissioning_handover") {
      const selected = request.arguments.deployment_id, selectedWorkspace = workspace();
      if (origin && context.deployId !== undefined && context.deployId !== host.deployment()?.id && selected !== host.deployment()?.id) return true;
      if (host.deployment()?.id !== selected) await host.selectDeployment(selected);
      if (selectedWorkspace !== workspace() || state.deployment?.id !== selected) return true;
      for (const item of [result.html, result.json, result.commissioning_html, result.commissioning_json])
        if (item && !state.artifacts.some(old => old.sha256 === item.sha256 && old.filename === item.filename)) state.artifacts.push(item);
      state.stage = "receiving"; host.saveDraft(); render(); return true;
    }
    if (result.id) {
      const selectedId = host.deployment()?.id || "";
      if (context.deployId !== undefined && context.deployId !== selectedId && result.id !== selectedId) return true;
      const priorDraft = state.drafts[result.id];
      const alreadyReadOwnResult = state.deployment?.id === result.id && state.deployment?.revision === result.revision &&
        state.deployment?.snapshot_sha256 === result.snapshot_sha256;
      const advanceOwnDraft = priorDraft && sameBasis(priorDraft.basis, origin?.basis) &&
        (sameBasis(origin?.basis, currentBasis()) || alreadyReadOwnResult);
      await host.selectDeployment(result.id);
      const exactResultLoaded = state.deployment?.id === result.id && state.deployment?.revision === result.revision &&
        state.deployment?.snapshot_sha256 === result.snapshot_sha256;
      if (advanceOwnDraft && exactResultLoaded && state.drafts[result.id]) {
        const draft = state.drafts[result.id]; draft.basis = clone(currentBasis());
        draft.proposalSha256 = null; draft.proposalSignature = null; state.proposal = null;
        if (request.kind === "capture_target") {
          draft.acceptedFields = []; draft.acceptedIdentities = []; draft.correctionFields = [];
        }
      }
      if (request.kind === "adopt_existing" || request.kind === "rebind_imported_target") state.intakeOpen = false;
      state.stage = request.kind === "prepare_observed_correction" || request.kind === "review" || request.kind === "continue" ? "correction" :
        ["review_adoption", "capture_target", "accept"].includes(request.kind) ? "receiving" : "review";
      host.showTab("commissioning"); host.saveDraft(); render();
    }
    return true;
  }
  function snapshot() {
    return {schema: "portfolio.commissioning-browser-draft.v1", workspaceId: workspace(), stage: state.stage,
      intakeBasis: state.intakeBasis, intake: {...state.intakeDraft,
        evidence: state.intakeDraft.evidence.map(({file, ...item}) => item)},
      drafts: state.drafts, artifacts: state.artifacts, family: state.family};
  }
  function restore(value = {}) {
    state.generation++; state.loading = false; state.rowsLoading = false;
    state.workspace = workspace(); state.deployment = null; state.loadedBasis = null; state.intakeOpen = false;
    state.profiles = []; state.editions = []; state.deployments = [];
    state.inventory = state.intake = state.basis = state.proposal = state.recoveryProposal = null;
    state.sourceRows = []; state.sourceTotal = 0; state.nextOffset = null;
    state.drafts = {}; state.artifacts = []; state.intakeBasis = null;
    state.intakeDraft = {label: "", projectId: "", projectUrl: "", importTime: "",
      profileId: "", settings: "{}", evidence: [], exceptions: []};
    if ((value.workspaceId && value.workspaceId !== workspace()) ||
        value.schema !== "portfolio.commissioning-browser-draft.v1") { state.stage = "intake"; return; }
    state.stage = ["intake", "review", "correction", "receiving"].includes(value.stage) ? value.stage : "intake";
    state.intakeDraft = {...state.intakeDraft, ...value.intake};
    state.intakeDraft.evidence = (value.intake?.evidence || []).map(item => ({...item, file: null}));
    state.intakeDraft.exceptions = value.intake?.exceptions || [];
    state.intakeBasis = value.intakeBasis || null; state.drafts = value.drafts || {};
    state.artifacts = value.artifacts || []; state.family = FAMILIES.includes(value.family) ? value.family : "tasks";
  }
  return {snapshot, restore, updateState, loadDeployment, acceptResult};
}
