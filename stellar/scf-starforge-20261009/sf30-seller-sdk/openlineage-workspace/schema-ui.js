// MIT. Schema review inside the original operations workspace and saved-request lifecycle.
export function createSchemaUI(context) {
  const { h, button, table, jsonBlock, badge, count, when, notice, action, mutate,
    downloadJSON, downloaded, downloadObject, setBusyControls, getView, getSearch } = context;
  const labels = { unreviewed: "Unreviewed", observed: "Observed", "needs-work": "Needs work", accepted: "Accepted", resolved: "Resolved" };
  const state = { workspaceId: null, from: "", to: "", result: null, loading: false, error: "", sequence: 0,
    selected: new Set(), focused: null, filter: "", impact: new Map(), impactBusy: new Set(), dialog: null };
  let catalog = null, inspector = null;
  const sameSelection = (version, id, from, to) => version === state.sequence &&
    getView()?.workspaceId === id && state.from === from && state.to === to;
  function reset() {
    state.sequence++; state.workspaceId = getView()?.workspaceId ?? null;
    state.from = ""; state.to = ""; state.result = null; state.loading = false; state.error = "";
    state.selected.clear(); state.focused = null; state.impact.clear(); state.impactBusy.clear();
    if (state.dialog?.open) state.dialog.close(); state.dialog?.remove(); state.dialog = null;
  }
  function sync() {
    const view = getView();
    if (state.workspaceId !== view?.workspaceId) reset();
    const editions = view?.editions ?? [];
    if (!state.from && editions.length > 1) state.from = editions.at(-2).id;
    if (!state.to && editions.length) state.to = editions.at(-1).id;
    if (!state.result || !view || view.revision < state.result.revision) return;
    state.result.revision = view.revision;
    const reviews = (view.schemaReviews ?? []).filter(review => review.comparisonId === state.result.comparisonId);
    state.result.reviews = reviews;
    state.result.changes = state.result.changes.map(change => {
      const matching = reviews.filter(review => review.changeIds.includes(change.id))
        .sort((a, b) => b.savedRevision - a.savedRevision || b.id.localeCompare(a.id));
      const latest = matching[0];
      return { ...change, decision: latest?.decision ?? "unreviewed", owner: latest?.owner ?? "",
        reviewer: latest?.reviewer ?? "", reviewId: latest?.id ?? null, reviewIds: matching.map(review => review.id) };
    });
    state.result.counts = Object.fromEntries(Object.keys(labels).map(key =>
      [key, state.result.changes.filter(change => change.decision === key).length]));
  }
  function invalidate() {
    state.sequence++; state.result = null; state.error = ""; state.loading = false;
    state.selected.clear(); state.focused = null; state.impact.clear(); state.impactBusy.clear();
    render();
  }
  function editionSelect(label, value, update) {
    const select = h("select", { "aria-label": label }, h("option", { value: "" }, "Choose a saved edition"),
      (getView()?.editions ?? []).map(edition => h("option", { value: edition.id }, edition.title + " · r" + edition.sourceRevision)));
    select.value = value;
    select.addEventListener("change", () => { update(select.value); invalidate(); });
    return h("label", {}, label, select);
  }
  async function compare() {
    if (!state.from || !state.to || state.from === state.to) { notice("Choose two distinct named editions.", true); return; }
    const version = ++state.sequence, id = state.workspaceId, from = state.from, to = state.to;
    state.loading = true; state.error = ""; render();
    try {
      const result = await action("schema.compare", { from, to });
      if (!sameSelection(version, id, from, to)) return;
      if (result.workspaceId !== id || result.comparison?.from?.id !== from || result.comparison?.to?.id !== to ||
          result.comparison.id !== result.comparisonId || !Array.isArray(result.changes))
        throw new Error("The schema response differs from the selected saved editions.");
      state.result = result; state.selected.clear(); state.focused = result.changes[0]?.id ?? null;
    } catch (error) { if (sameSelection(version, id, from, to)) state.error = error.message; }
    finally {
      if (sameSelection(version, id, from, to)) { state.loading = false; render(); if (state.focused) loadImpact(state.focused); }
    }
  }
  const pathLabel = path => path === null ? "Schema" : path.length ? path.map(part => part === "" ? '""' : part).join(" / ") : "Schema";
  const title = change => pathLabel(change.fieldPath) + " · " + change.kind.replaceAll("-", " ");
  function changes() {
    const search = (getSearch?.() ?? "").toLowerCase();
    return (state.result?.changes ?? []).filter(change =>
      (!state.filter || change.decision === state.filter) && (!search || JSON.stringify(change).toLowerCase().includes(search)));
  }
  function render(nextCatalog, nextInspector) {
    if (nextCatalog) catalog = nextCatalog;
    if (nextInspector) inspector = nextInspector;
    if (!catalog || !context.isActive()) return;
    sync();
    const controls = h("section", { className: "schema-controls", "aria-label": "Schema comparison" },
      h("h3", {}, "Compare saved schemas"),
      h("div", { className: "compare-selects" },
        editionSelect("Before edition", state.from, value => { state.from = value; }),
        editionSelect("After edition", state.to, value => { state.to = value; }),
        button(state.loading ? "Comparing…" : "Compare schemas", compare, "", { disabled: state.loading || (getView()?.editions?.length ?? 0) < 2 })),
      h("p", { className: "field-help" }, "Each named edition keeps its original events. Field names, nested paths and declared types are compared as reported."));
    if ((getView()?.editions?.length ?? 0) < 2) controls.append(h("p", {}, "Save an edition before and after the source change, then compare them here."));
    const content = [controls];
    if (state.error) content.push(h("p", { role: "alert", className: "schema-message" }, state.error));
    if (state.result) {
      const result = state.result, selected = [...state.selected].filter(id => result.changes.some(change => change.id === id));
      const filter = h("select", { "aria-label": "Schema decision filter" },
        h("option", { value: "" }, "All decisions"), Object.entries(labels).map(([value, name]) =>
          h("option", { value }, name + " · " + count(result.counts[value]))));
      filter.value = state.filter; filter.addEventListener("change", () => { state.filter = filter.value; render(); });
      content.push(h("section", { className: "schema-actions" },
        h("p", {}, count(result.comparison.summary.changedDatasets) + " changed datasets · " +
          count(result.changes.length) + " changes · " + count(result.comparison.summary.ambiguousDatasets) + " with field details to inspect"),
        h("div", { className: "button-row" }, h("label", {}, "Decision", filter),
          button("Review selected (" + selected.length + ")", () => openReview(selected), "primary", { "data-write": true, "data-schema-selection": true }),
          button("Select visible", () => { for (const change of changes()) state.selected.add(change.id); render(); }, "small"),
          button("Clear selection", () => { state.selected.clear(); render(); }, "small")),
        h("div", { className: "button-row schema-report-controls", "aria-label": "Schema reports" },
          ...["html", "csv", "json"].map(format => button("Download " + format.toUpperCase() + " report", () => exportReport(format), "small")))));
      const visible = changes();
      content.push(visible.length ? table(["Select", "Dataset / field", "Change", "Decision / owner"], visible.map(change => {
        const selected = h("input", { type: "checkbox", checked: state.selected.has(change.id),
          "aria-label": "Select " + pathLabel(change.fieldPath) + " on " + change.datasetName });
        selected.addEventListener("change", () => {
          if (selected.checked) state.selected.add(change.id); else state.selected.delete(change.id); render();
        });
        return h("tr", { className: state.focused === change.id ? "selected" : "" },
          h("td", {}, selected),
          h("td", {}, button(change.datasetName, () => focus(change.id), "link-button primary-line"),
            h("span", { className: "secondary-line" }, change.namespace),
            button(pathLabel(change.fieldPath), () => focus(change.id), "link-button")),
          h("td", {}, change.kind.replaceAll("-", " "), h("span", { className: "secondary-line" }, change.property)),
          h("td", {}, badge(change.decision, change.decision === "needs-work"),
            h("span", { className: "secondary-line" }, change.owner || "Unassigned")));
      }), "Observed schema changes") : h("div", { className: "empty compact" }, h("h3", {}, result.changes.length ? "No matching changes" : "Matching schema observations"),
        h("p", {}, result.changes.length ? "Change the decision filter or search." : "The selected editions have matching reported schemas.")));
      content.push(h("div", { className: "table-footer" }, count(visible.length) + " of " + count(result.changes.length) + " changes"),
        jsonBlock("Complete original comparison", result.comparison));
    }
    catalog.replaceChildren(...content); renderInspector(); setBusyControls();
    const reviewButton = catalog.querySelector("[data-schema-selection]");
    if (reviewButton && state.selected.size === 0) reviewButton.disabled = true;
  }
  function focus(id) { state.focused = id; render(); loadImpact(id); }
  async function loadImpact(changeId) {
    const result = state.result;
    if (!result || state.impact.has(changeId) || state.impactBusy.has(changeId)) return;
    const version = state.sequence, workspaceId = state.workspaceId, from = state.from, to = state.to;
    state.impactBusy.add(changeId); renderInspector();
    try {
      const value = await action("schema.impact", { from, to, comparisonId: result.comparisonId, changeId });
      if (!sameSelection(version, workspaceId, from, to)) return;
      if (value.workspaceId !== workspaceId || value.comparisonId !== result.comparisonId || value.change?.id !== changeId)
        throw new Error("The impact response differs from the selected original change.");
      state.impact.set(changeId, value);
    } catch (error) {
      if (sameSelection(version, workspaceId, from, to)) state.impact.set(changeId, { error: error.message });
    } finally { if (sameSelection(version, workspaceId, from, to)) { state.impactBusy.delete(changeId); renderInspector(); } }
  }
  function sourceSection(label, inventory) {
    const observation = inventory.observation;
    return h("section", { className: "section-block" }, h("h4", {}, label), h("p", {}, inventory.status.replaceAll("-", " ")),
      inventory.diagnostics.length ? h("ul", { className: "detail-list" }, inventory.diagnostics.map(value => h("li", {}, value))) : null,
      observation ? [
        h("p", { className: "muted" }, when(observation.eventTime) + " · " + observation.jsonPointer),
        ...(observation.sources ?? []).map(source => h("div", { className: "source-links" },
          button("Download " + source.name, () => downloadObject(source.sourceId, source.name), "small"),
          h("span", { className: "secondary-line" }, source.line !== undefined ? "Line " + source.line : "Item " + ((source.index ?? 0) + 1)))),
        jsonBlock("Original schema facet and source positions", observation)
      ] : h("p", { className: "muted" }, "No schema observation in this selection."));
  }
  function relationshipSection(label, side) {
    const affected = side.nodes.filter(node => !node.source);
    return h("section", { className: "section-block" }, h("h4", {}, label),
      h("p", {}, count(affected.length) + " downstream fields · " + count(side.edges.length) + " declared relationships · " + count(side.runKeys.length) + " related runs"),
      affected.length ? table(["Entity", "Field", "Steps", "Schema observation"], affected.map(node => h("tr", {},
        h("td", {}, context.entityName(node.entityKey)), h("td", {}, node.field), h("td", {}, node.depth), h("td", {}, node.schemaPresence.replaceAll("-", " ")))), label + " downstream fields") :
        h("p", { className: "muted" }, "No downstream field relationship is declared for this change in this edition."),
      side.entityDependencies.length ? jsonBlock("Declared entity dependencies", side.entityDependencies, true) : null,
      side.unresolved.length ? jsonBlock("Field identities to inspect", side.unresolved, true) : null,
      jsonBlock("Complete declared paths, original events and transformations", side));
  }
  function renderInspector(nextInspector) {
    if (nextInspector) inspector = nextInspector;
    if (!inspector || !context.isActive()) return;
    const result = state.result, change = result?.changes.find(item => item.id === state.focused);
    if (!change) {
      inspector.replaceChildren(h("div", { className: "empty compact" }, h("h3", {}, "Inspect a schema change"),
        h("p", {}, "Choose a change to inspect its before and after values, original source, downstream relationships and staff decisions."))); return;
    }
    const dataset = result.comparison.datasets.find(item => item.key === change.datasetKey);
    const reviews = result.reviews.filter(review => review.changeIds.includes(change.id)).sort((a, b) => b.savedRevision - a.savedRevision);
    const impact = state.impact.get(change.id);
    const children = [
      h("header", { className: "inspector-head" }, h("p", { className: "eyebrow" }, "Schema change"),
        h("h2", { id: "schema-change-title" }, change.datasetName), h("p", { className: "namespace" }, change.namespace),
        h("p", {}, title(change)), h("div", { className: "button-row" },
          button("Review this change", () => openReview([change.id]), "small", { "data-write": true }),
          button("Download change", () => downloadJSON({ comparisonId: result.comparisonId, change, impact }, "openlineage-schema-change-" + change.id + ".json"), "small"))),
      h("div", { className: "inspector-body" },
        h("section", { className: "section-block schema-values" },
          jsonBlock("Before", change.before, true), jsonBlock("After", change.after, true)),
        h("section", { className: "section-block" }, h("h3", {}, "Staff decisions"),
          reviews.length ? reviews.map(review => h("article", { className: "item-card" },
            badge(review.decision, review.decision === "needs-work"), h("p", {}, review.reason),
            h("p", { className: "card-meta" }, review.reviewer + " · " + when(review.updatedAt) + " · r" + review.savedRevision),
            review.owner ? h("p", {}, "Owner: " + review.owner) : null,
            review.action ? h("p", {}, "Follow-up: " + review.action) : null,
            review.resolution ? h("p", {}, "Resolution: " + review.resolution) : null,
            h("div", { className: "button-row" }, button("Update decision", () => openReview(review.changeIds, review), "small", { "data-write": true })),
            jsonBlock("Complete decision, evidence and history", review))) : h("p", { className: "muted" }, "Unreviewed."),
        ),
        h("section", { className: "section-block" }, h("h3", {}, "Declared downstream impact"),
          state.impactBusy.has(change.id) ? h("p", { role: "status" }, "Reading declared relationships…") :
          impact?.error ? h("div", {}, h("p", { role: "alert" }, impact.error), button("Read impact again", () => { state.impact.delete(change.id); loadImpact(change.id); })) :
          impact ? [relationshipSection("Before edition", impact.before), relationshipSection("After edition", impact.after)] : null),
        h("section", { className: "section-block" }, h("h3", {}, "Original schema observations"),
          sourceSection("Before edition", dataset.before), sourceSection("After edition", dataset.after)))
    ];
    inspector.replaceChildren(...children); setBusyControls();
  }
  function evidenceChoices(changeIds) {
    const result = state.result, view = getView(), values = new Map();
    const add = value => values.set(value.kind + ":" + value.id, value);
    const selectedDatasets = result.comparison.datasets.filter(dataset => dataset.changes.some(change => changeIds.includes(change.id)));
    for (const dataset of selectedDatasets) for (const side of ["before", "after"]) {
      const observation = dataset[side].observation;
      if (!observation) continue;
      add({ kind: "event", id: observation.eventId, label: "Event · " + observation.eventTime + " · " + observation.eventId.slice(0, 12) });
      for (const source of observation.sources) add({ kind: "source", id: source.sourceId, label: "Source · " + source.name });
    }
    const selectedKeys = new Set(selectedDatasets.map(dataset => dataset.key));
    for (const attached of view.results ?? []) {
      const relevant = [state.from, state.to].includes(attached.editionId) && attached.entityKeys.some(key => selectedKeys.has(key));
      if (relevant) add({ kind: "result", id: attached.id, label: "Result · " + attached.name });
    }
    return values;
  }
  function openReview(changeIds, prior = null) {
    if (!state.result || !changeIds.length) { notice("Select at least one schema change.", true); return; }
    const comparison = state.result.comparison, workspaceId = state.workspaceId, openingRevision = getView().revision;
    const selected = state.result.changes.filter(change => changeIds.includes(change.id));
    if (selected.length !== changeIds.length) { notice("The selected change is absent from this comparison.", true); return; }
    state.dialog?.remove();
    const reviewer = h("input", { required: true, name: "reviewer", value: prior?.reviewer ?? "", autocomplete: "name" });
    const decision = h("select", { name: "decision" }, Object.entries(labels).filter(([key]) => key !== "unreviewed").map(([key, label]) => h("option", { value: key }, label)));
    decision.value = prior?.decision ?? "observed";
    const reason = h("textarea", { required: true, name: "reason", rows: "3" }, prior?.reason ?? "");
    const owner = h("input", { name: "owner", value: prior?.owner ?? "" });
    const followUp = h("textarea", { name: "followUp", rows: "3" }, prior?.action ?? "");
    const resolution = h("textarea", { name: "resolution", rows: "3" }, prior?.resolution ?? "");
    const errorHost = h("p", { className: "form-feedback", role: "status", "aria-live": "polite" });
    const options = evidenceChoices(changeIds);
    for (const item of prior?.evidence ?? []) if (!options.has(item.kind + ":" + item.id))
      options.set(item.kind + ":" + item.id, { kind: item.kind, id: item.id, label: item.kind + " · " + (item.name ?? item.id) });
    const evidenceInputs = [...options.values()].map(item => {
      const input = h("input", { type: "checkbox", checked: prior?.evidence.some(value => value.kind === item.kind && value.id === item.id) ?? item.kind === "event" });
      return { input, item, element: h("label", { className: "checkbox-label" }, input, item.label) };
    });
    const updateRequired = () => { owner.required = decision.value === "needs-work"; followUp.required = decision.value === "needs-work"; resolution.required = decision.value === "resolved"; };
    decision.addEventListener("change", updateRequired); updateRequired();
    const dialog = h("dialog", { className: "schema-review-dialog", "aria-labelledby": "schema-review-title" });
    const form = h("form", { className: "schema-review-form" },
      h("header", { className: "dialog-header" }, h("h2", { id: "schema-review-title" }, prior ? "Update schema decision" : "Review schema changes"),
        button("×", () => dialog.close(), "icon-button", { "aria-label": "Close schema review" })),
      h("p", {}, comparison.from.title + " → " + comparison.to.title),
      h("ul", { className: "detail-list schema-selected-changes" }, selected.map(change => h("li", {}, change.datasetName + " · " + title(change)))),
      h("label", {}, "Reviewer", reviewer), h("p", { className: "field-help" }, "The name recorded with this decision."),
      h("label", {}, "Decision", decision), h("label", {}, "Reason", reason),
      h("label", {}, "Follow-up owner", owner), h("label", {}, "Follow-up action", followUp),
      h("label", {}, "Completed resolution", resolution),
      h("fieldset", { className: "schema-evidence" }, h("legend", {}, "Original supporting evidence"),
        evidenceInputs.length ? evidenceInputs.map(value => value.element) : h("p", {}, "No linked source or result is present in this selection.")),
      errorHost, h("div", { className: "dialog-actions" }, button("Cancel", () => dialog.close()),
        h("button", { type: "submit", className: "primary", "data-write": true }, "Save schema decision")));
    form.addEventListener("submit", async event => {
      event.preventDefault(); errorHost.textContent = "";
      if (getView()?.workspaceId !== workspaceId || state.result?.comparisonId !== comparison.id)
        { errorHost.textContent = "Return to the original saved comparison before saving this decision."; return; }
      const args = { ...(prior ? { id: prior.id } : {}), from: comparison.from.id, to: comparison.to.id,
        comparisonId: comparison.id, changeIds: [...changeIds], reviewer: reviewer.value, decision: decision.value,
        reason: reason.value, owner: owner.value, action: followUp.value, resolution: resolution.value,
        evidence: evidenceInputs.filter(value => value.input.checked).map(({ item }) => ({ kind: item.kind, id: item.id })) };
      try {
        const saved = await mutate("schema.review.save", args, "Schema decision", { expectedRevision: openingRevision });
        if (saved) { if (dialog.open) dialog.close(); sync(); render(); }
        else if (context.hasPending()) { if (dialog.open) dialog.close(); notice("The schema decision is retained. Use the saved request controls to recover or review it."); }
        else errorHost.textContent = "The decision was not submitted. Resolve the current saved request and try again.";
      } catch (error) { errorHost.textContent = error.message; }
    });
    dialog.append(form); document.body.append(dialog); state.dialog = dialog;
    dialog.addEventListener("close", () => { if (state.dialog === dialog) state.dialog = null; dialog.remove(); });
    dialog.showModal(); setBusyControls(); reviewer.focus();
  }
  async function exportReport(format) {
    if (!state.result) return;
    const workspaceId = state.workspaceId, from = state.from, to = state.to, comparisonId = state.result.comparisonId;
    try {
      const report = await action("schema.report", { from, to, format });
      if (getView()?.workspaceId !== workspaceId || state.result?.comparisonId !== comparisonId) return;
      if (typeof report.text !== "string") throw new Error("The complete schema report was unavailable.");
      downloaded(new Blob([report.text], { type: report.mediaType }), "openlineage-schema-review-" + comparisonId + "." + format);
    } catch (error) { notice(error.message, true); }
  }
  return { render, renderInspector, compare, reset };
}
