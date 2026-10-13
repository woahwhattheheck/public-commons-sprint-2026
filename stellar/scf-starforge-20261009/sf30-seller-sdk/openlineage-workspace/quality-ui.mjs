// MIT. Dataset quality operations in the original OpenLineage browser.
const element = (tag, attributes = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "className") node.className = value;
    else if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "value") node.value = value;
    else if (name === "checked" || name === "disabled" || name === "hidden") node[name] = Boolean(value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};
const labelText = value => String(value ?? "Unreported").replaceAll("-", " ");
const dateText = value => {
  if (!value) return "Unreported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
const display = value => value === undefined || value === null ? "Unreported" : typeof value === "object" ? JSON.stringify(value) : String(value);
const badge = (value, state = value) => element("span", { className: "q-status", "data-state": state ?? "unreported" }, labelText(value));
const details = (title, value, open = false) => element("details", { open }, element("summary", {}, title), element("pre", {}, JSON.stringify(value, null, 2)));
const paragraph = (text, className = "q-muted") => element("p", { className }, text);
const actionButton = (text, action, options = {}) => element("button", { type: "button", onclick: action, ...options }, text);
const empty = (title, description, ...actions) => element("div", { className: "q-empty" }, element("h3", {}, title), paragraph(description), ...actions);
const field = (title, input, help = "") => element("label", {}, element("span", {}, title), input, help ? element("span", { className: "q-help" }, help) : null);
const table = (headers, rows, name) => element("div", { className: "q-table", tabindex: "0", role: "region", "aria-label": name },
  element("table", {}, element("thead", {}, element("tr", {}, headers.map(value => element("th", { scope: "col" }, value)))),
    element("tbody", {}, rows.map(cells => element("tr", {}, cells.map(value => element("td", {}, value)))))));
const definitionList = entries => element("dl", { className: "q-detail-grid" }, entries.map(([key, value]) => [
  element("dt", {}, key), element("dd", {}, display(value))
]));
function selectInput(name, options, selected, changed, extra = {}) {
  const input = element("select", { name, "aria-label": name, onchange: changed, ...extra });
  if (selected && !options.some(([value]) => value === selected)) options = [...options, [selected, "Selected identity outside this view · " + selected]];
  for (const [value, label] of options) input.append(element("option", { value }, label));
  input.value = selected ?? "";
  return input;
}
function tabs(names, selected, changed) {
  const host = element("div", { className: "q-tabs", role: "tablist", "aria-label": "Quality views" });
  for (const [key, title] of names) host.append(actionButton(title, () => changed(key), {
    role: "tab", id: "quality-tab-" + key, "aria-selected": key === selected ? "true" : "false",
    "aria-controls": "quality-content", tabindex: key === selected ? "0" : "-1"
  }));
  host.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...host.querySelectorAll('[role="tab"]')], current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    changed(names[index][0]); document.getElementById("quality-tab-" + names[index][0])?.focus();
  });
  return host;
}

export function installQualityDesk({ getState, action, mutate, refresh, notify, download, openSource, navigate }) {
  const host = document.getElementById("catalog");
  const root = element("section", { className: "quality-desk", "aria-label": "Dataset quality operations" });
  const style = element("link", { rel: "stylesheet", href: new URL("./quality.css", import.meta.url).href });
  document.head.append(style);
  const nav = actionButton("Quality", () => navigate("quality"), { "data-view": "quality", id: "quality-nav" });
  document.getElementById("section-nav").append(nav);
  const ui = {
    tab: "observations", datasetKey: "", runKey: "", overview: null, history: null,
    preview: null, previewContext: null, selectedEvaluationId: "", selectedFindingId: "", ruleDraft: null,
    ruleDraftContext: null, ruleDraftBase: null, decisionContext: null,
    evaluationTitle: "", decision: "investigating", reason: "", page: 0, error: "", feedback: "",
    loading: false, loadingKey: null, loadedKey: null, request: 0, active: false, busy: false
  };
  const writeDisabled = () => {
    const state = getState();
    return !state.view || Boolean(state.pending) || state.pendingBusy || state.importBusy || ui.busy;
  };
  const context = () => {
    const state = getState();
    return { workspaceId: state.view?.workspaceId, revision: state.view?.revision, edition: state.edition || null };
  };
  const filters = () => ({
    ...(getState().edition ? { edition: getState().edition } : {}),
    ...(ui.datasetKey ? { datasetKey: ui.datasetKey } : {}),
    ...(ui.runKey ? { runKey: ui.runKey } : {})
  });
  const authoringContext = () => ({ ...context(), datasetKey: ui.datasetKey, runKey: ui.runKey });
  const sameContext = (a, b = authoringContext()) => a && JSON.stringify(a) === JSON.stringify(b);
  const selectionKey = () => JSON.stringify(authoringContext());
  function invalidateStalePreview() {
    if (ui.preview && !sameContext(ui.previewContext)) {
      ui.preview = null; ui.previewContext = null;
      ui.feedback = "The source selection or workspace revision changed. Evaluate the current source before saving a result.";
    }
  }
  const draftIsStale = () => Boolean(ui.ruleDraft && !sameContext(ui.ruleDraftContext));
  const decisionIsStale = () => Boolean(ui.selectedFindingId && !sameContext(ui.decisionContext));
  const datasets = () => getState().view?.datasets ?? [];
  const datasetName = key => {
    const found = datasets().find(item => item.key === key);
    return found ? found.namespace + " / " + found.name : key || "All datasets";
  };
  const editions = () => getState().view?.editions ?? [];
  const editionName = id => id ? editions().find(item => item.id === id)?.title ?? id : "Current workspace";
  const selectedEvaluation = () => ui.overview?.evaluations?.find(item => item.id === ui.selectedEvaluationId) ?? null;
  const shownEvaluation = () => selectedEvaluation() ?? ui.preview;
  const sourceLinks = sources => {
    const known = getState().view?.sources ?? [];
    return element("div", { className: "q-actions" }, (sources ?? []).map(source => {
      const id = source.sourceId ?? source.id;
      const original = known.find(item => item.id === id);
      return id && openSource ? actionButton((original?.name ?? "Source " + id) +
        (source.line !== undefined ? " · line " + source.line : source.index !== undefined ? " · item " + source.index : ""),
        () => openSource(id), { className: "link-button" }) : element("span", { className: "q-mono" }, display(source));
    }));
  };
  function sourceDetails(record) {
    return element("details", {}, element("summary", {}, "Original event and facet"),
      definitionList([
        ["Event", record.eventId], ["Event time", dateText(record.eventTime)], ["Run", record.runKey], ["Job", record.jobKey],
        ["Facet path", record.path ?? record.facetPath], ["Facet schema", record.schemaURL], ["Producer", record.producer]
      ]),
      sourceLinks(record.sources), details("Complete retained record", record));
  }
  function invalidate() {
    ui.loadedKey = null; ui.preview = null; ui.previewContext = null; ui.selectedFindingId = ""; ui.decisionContext = null; ui.page = 0; ui.feedback = "";
    if (ui.active) void load();
  }
  function selectDataset(value) {
    ui.datasetKey = value; ui.runKey = ""; ui.selectedEvaluationId = ""; ui.history = null; invalidate();
  }
  async function load() {
    invalidateStalePreview();
    const key = selectionKey(), current = context(), version = ++ui.request;
    ui.loading = true; ui.loadingKey = key; ui.error = ""; paint();
    try {
      const args = filters();
      const [overview, history] = await Promise.all([
        action("quality.overview", args),
        ui.datasetKey ? action("quality.history", { ...args, datasetKey: ui.datasetKey }) : Promise.resolve(null)
      ]);
      if (version !== ui.request || key !== selectionKey() || !ui.active) return;
      for (const value of [overview, history].filter(Boolean)) {
        if (value.workspaceId !== current.workspaceId || value.revision !== current.revision)
          throw new Error("The workspace changed while quality data was loading. Refresh the workspace to read one current revision.");
      }
      ui.overview = overview; ui.history = history; ui.loadedKey = key;
      if (ui.selectedEvaluationId && !overview.evaluations.some(item => item.id === ui.selectedEvaluationId)) {
        ui.selectedEvaluationId = ""; ui.selectedFindingId = "";
      }
    } catch (error) {
      if (version === ui.request) { ui.error = error.message; ui.loadedKey = key; ui.overview = null; ui.history = null; }
    } finally {
      if (version === ui.request) { ui.loading = false; ui.loadingKey = null; paint(); }
    }
  }
  async function perform(label, work) {
    if (ui.busy) return null;
    ui.busy = true; ui.feedback = ""; paint();
    try { return await work(); }
    catch (error) { ui.feedback = error.message; notify(error.message, true); return null; }
    finally { ui.busy = false; paint(); }
  }
  async function save(actionName, args, label, opened) {
    return perform(label, async () => {
      if (!sameContext(opened)) throw new Error("The workspace or source selection changed after this action was opened. Review the current revision before saving.");
      const result = await mutate(actionName, args, label);
      if (!result) { ui.feedback = "The original saved request remains in the workspace recovery panel."; return null; }
      ui.loadedKey = null;
      return result;
    });
  }
  async function reload() {
    ui.loadedKey = null;
    try { await refresh(); }
    catch (error) { ui.error = error.message; paint(); }
  }
  function filterControls() {
    const selected = datasets().find(item => item.key === ui.datasetKey);
    const runKeys = selected?.runKeys ? new Set(selected.runKeys) : null;
    const runs = (getState().view?.runs ?? []).filter(run => !runKeys || runKeys.has(run.key));
    return element("div", { className: "q-filters" },
      field("Dataset", selectInput("Quality dataset", [["", "All datasets"], ...datasets().map(item =>
        [item.key, item.namespace + " / " + item.name])], ui.datasetKey, event => selectDataset(event.target.value)),
      "Namespace and name select the original dataset identity."),
      field("Run", selectInput("Quality run", [["", "All selected runs"], ...runs.map(item =>
        [item.key, item.namespace + " / " + item.name + " · " + (item.runId ?? item.key)])],
        ui.runKey, event => { ui.runKey = event.target.value; ui.selectedEvaluationId = ""; invalidate(); }),
      "Dataset-only observations appear when all runs are selected."));
  }
  function summary() {
    const value = ui.overview.counts;
    return element("div", { className: "q-summary", "aria-label": "Quality observation totals" }, [
      ["Datasets", value.datasets, "in selected source"],
      ["Metrics", value.metrics, "original reported values"],
      ["Assertions", value.assertions, "original assertion results"],
      ["Failed assertions", value.failedAssertions, "independent of run state"]
    ].map(([title, total, help]) => element("div", { className: "q-stat" },
      element("span", {}, title), element("strong", {}, display(total)), element("span", { className: "q-muted" }, help))));
  }
  function observationsView() {
    if (!ui.datasetKey) {
      const rows = ui.overview.datasets ?? [];
      if (!rows.length) return empty("No quality observations in this selection",
        "Import original OpenLineage events containing dataQualityMetrics or dataQualityAssertions. Existing dataset names remain available for rule configuration.");
      return element("div", {},
        table(["Dataset", "Observations", "Metrics", "Assertions", "Failed", "Last observed"], rows.map(item => [
          element("div", {}, actionButton(item.name, () => selectDataset(item.datasetKey), { className: "link-button" }), paragraph(item.namespace, "q-small q-key")),
          display(item.observationCount), display(item.metricCount), display(item.assertionCount),
          display(item.failureCount), dateText(item.latestAt)
        ]), "Selected datasets and quality observations"),
        paragraph("Select a dataset to inspect its original measurements, assertion results and facet history."));
    }
    const records = ui.history?.observations ?? [];
    if (!records.length) return empty("No quality observations for this dataset and run",
      "Choose another run or import the producer's original quality facets. Missing observations remain unreported.");
    const perPage = 10, pageCount = Math.ceil(records.length / perPage);
    ui.page = Math.min(ui.page, Math.max(0, pageCount - 1));
    const view = element("div", {});
    for (const item of records.slice(ui.page * perPage, (ui.page + 1) * perPage)) {
      const run = (getState().view?.runs ?? []).find(row => row.key === item.runKey);
      const assertions = item.assertions ?? [], metrics = item.metrics ?? [];
      const card = element("article", { className: "q-record" },
        element("div", { className: "q-record-heading" },
          element("div", {}, element("h3", {}, item.facetName), paragraph(dateText(item.eventTime), "q-small q-muted")),
          element("div", { className: "q-actions" }, badge(item.scope + " scope"), badge({ input: "Input dataset", output: "Output dataset", dataset: "Dataset event" }[item.direction] ?? item.direction), badge(item.schemaStatus))),
        definitionList([["Dataset", item.namespace + " / " + item.name],
          ["Run state", run?.state ?? "Unreported"], ["Job", item.jobKey], ["Event type", item.eventType],
          ["Facet path", item.path]]));
      if (item.deleted) card.append(element("p", { className: "q-notice" }, "This original facet observation records a deletion."));
      if (item.diagnostics?.length) card.append(element("div", { className: "q-notice" },
        element("strong", {}, "Source details to review"), element("ul", { className: "q-list" }, item.diagnostics.map(text => element("li", {}, text)))));
      if (metrics.length) card.append(element("h4", {}, "Reported metrics"),
        table(["Metric path", "Original value", "Value status"], metrics.map(metric => [
          element("code", { className: "q-mono" }, metric.path), display(metric.value),
          metric.valid === true ? "Reported" : metric.valid === false ? "Not evaluated" : "Unreported"
        ]), "Original quality metrics"));
      if (assertions.length) card.append(element("h4", {}, "Original assertions"),
        table(["Assertion / column", "Result", "Severity", "Expected", "Actual"], assertions.map(assertion => [
          element("div", {}, assertion.name, paragraph(assertion.column ?? "Dataset", "q-small q-muted")),
          badge(assertion.success === true ? "Passed" : assertion.success === false ? "Failed" : "Unreported",
            assertion.success === true ? "passed" : assertion.success === false ? "failed" : "unknown"),
          labelText(assertion.severity), display(assertion.expected), display(assertion.actual)
        ]), "Original assertion results"));
      for (const assertion of assertions.filter(value => value.query !== undefined && value.query !== null))
        card.append(element("details", {}, element("summary", {}, "Reported assertion query — " + assertion.name), element("pre", {}, assertion.query)));
      if (!metrics.length && !assertions.length) card.append(paragraph("This facet has no supported reported metrics or assertions. Its full original content is retained below."));
      card.append(sourceDetails(item)); view.append(card);
    }
    view.append(element("div", { className: "q-pagination" },
      actionButton("Previous", () => { ui.page--; paint(); }, { disabled: ui.page === 0 }),
      element("span", { className: "q-small" }, "Observations " + (ui.page * perPage + 1) + "–" +
        Math.min(records.length, (ui.page + 1) * perPage) + " of " + records.length),
      actionButton("Next", () => { ui.page++; paint(); }, { disabled: ui.page + 1 >= pageCount })));
    return view;
  }
  const ruleInput = source => {
    const keys = ["id", "title", "datasetKey", "enabled", "severity", "scope", "kind", "metricPath", "operator", "value", "upper", "assertion", "expectedSuccess", "missing"];
    return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, structuredClone(source[key])]));
  };
  function newRule() {
    return { title: "", datasetKey: ui.datasetKey || datasets()[0]?.key || "", enabled: true, severity: "error",
      scope: "any", kind: "metric", metricPath: "/rowCount", operator: "gte", value: "", upper: "",
      assertion: { name: "", column: null }, expectedSuccess: true, missing: "unknown" };
  }
  function beginRule(source = null) {
    ui.ruleDraft = source ? ruleInput(source) : newRule();
    ui.ruleDraftContext = authoringContext(); ui.ruleDraftBase = source ? structuredClone(source) : null;
  }
  function ruleDraftNotice() {
    if (!draftIsStale()) return null;
    const current = authoringContext();
    const saved = ui.ruleDraft.id ? ui.overview?.rules?.find(rule => rule.id === ui.ruleDraft.id) : null;
    const originalWorkspace = ui.ruleDraftContext?.workspaceId === current.workspaceId;
    const currentRead = ui.loadedKey === selectionKey() && ui.overview?.revision === current.revision;
    const canReview = originalWorkspace && currentRead && (!ui.ruleDraft.id || Boolean(saved));
    return element("section", { className: "q-notice", role: "alert" },
      element("h4", {}, "Review the current source before saving this draft"),
      paragraph("Your draft text is retained. It was opened at revision " + ui.ruleDraftContext?.revision +
        " in " + editionName(ui.ruleDraftContext?.edition) + ". The current view is revision " + current.revision + "."),
      !originalWorkspace ? paragraph("This draft belongs to another workspace. Clear the form to start a rule in this workspace.") : null,
      ui.ruleDraft.id && !saved ? paragraph("Select the draft’s original dataset to inspect its current saved rule, or clear the form to start another rule.") : null,
      saved ? details("Current saved rule — review before applying your draft", saved, true) : null,
      ui.ruleDraftBase ? details("Rule when this draft was opened", ui.ruleDraftBase) : null,
      details("Your retained intended rule", ruleInput(ui.ruleDraft)),
      actionButton("Use reviewed revision with my draft", () => {
        if (!canReview || !sameContext(current) || ui.loadedKey !== selectionKey()) return;
        ui.ruleDraftContext = authoringContext(); ui.ruleDraftBase = saved ? structuredClone(saved) : null;
        ui.feedback = "Draft retained against reviewed revision " + context().revision + ". Save rule to apply it.";
        paint();
      }, { disabled: !canReview }));
  }
  function ruleEditor() {
    if (!ui.ruleDraft) beginRule();
    const draft = ui.ruleDraft;
    const form = element("form", { className: "q-form", "aria-label": "Quality rule" });
    const input = (key, attributes = {}) => element("input", { name: key, value: draft[key] ?? "",
      oninput: event => { draft[key] = event.target.value; }, ...attributes });
    const title = input("title", { required: true, maxlength: "240", placeholder: "Order records must be present" });
    const dataset = selectInput("Rule dataset", datasets().map(item => [item.key, item.namespace + " / " + item.name]),
      draft.datasetKey, event => { draft.datasetKey = event.target.value; }, { required: true });
    const kind = selectInput("Rule kind", [["metric", "Metric threshold"], ["assertion", "Named assertion"]],
      draft.kind, event => { draft.kind = event.target.value; updateRuleKind(); });
    const scope = selectInput("Facet scope", [["any", "Any original facet scope"], ["dataset", "Dataset facets"], ["input", "Run input facets"], ["output", "Run output facets"]],
      draft.scope, event => { draft.scope = event.target.value; });
    const metricPath = input("metricPath", { list: "quality-metric-paths", placeholder: "/columnMetrics/customer_id/nullCount" });
    const options = [...new Set((ui.history?.observations ?? []).flatMap(item => item.metrics.map(metric => metric.path)))];
    const suggestions = element("datalist", { id: "quality-metric-paths" }, options.map(path => element("option", { value: path })));
    const operator = selectInput("Comparison", [["eq", "Equals"], ["ne", "Does not equal"], ["lt", "Less than"], ["lte", "At most"],
      ["gt", "Greater than"], ["gte", "At least"], ["between", "Between, inclusive"]], draft.operator,
      event => { draft.operator = event.target.value; upperField.hidden = draft.operator !== "between"; });
    const upperField = field("Upper value", input("upper", { type: "number", step: "any" }));
    upperField.hidden = draft.operator !== "between";
    const metricFields = element("div", { className: "q-form-grid", hidden: draft.kind !== "metric" },
      field("Metric path", metricPath, "Choose an observed JSON pointer or enter the exact reported metric path."), suggestions,
      field("Comparison", operator), field("Threshold value", input("value", { type: "number", step: "any" })), upperField);
    const assertionName = element("input", { name: "assertionName", value: draft.assertion?.name ?? "", placeholder: "not_null",
      oninput: event => { draft.assertion = { ...draft.assertion, name: event.target.value }; } });
    const assertionColumn = element("input", { name: "assertionColumn", value: draft.assertion?.column ?? "", placeholder: "customer_id",
      oninput: event => { draft.assertion = { ...draft.assertion, column: event.target.value || null }; } });
    const assertionFields = element("div", { className: "q-form-grid", hidden: draft.kind !== "assertion" },
      field("Original assertion name", assertionName), field("Column", assertionColumn, "Leave empty for an assertion without a column."),
      field("Expected result", selectInput("Expected assertion result", [["true", "Passed"], ["false", "Failed"]],
        String(draft.expectedSuccess), event => { draft.expectedSuccess = event.target.value === "true"; })));
    function updateRuleKind() {
      metricFields.hidden = draft.kind !== "metric"; assertionFields.hidden = draft.kind !== "assertion";
      for (const control of metricFields.querySelectorAll("input,select")) control.disabled = metricFields.hidden;
      for (const control of assertionFields.querySelectorAll("input,select")) control.disabled = assertionFields.hidden;
    }
    updateRuleKind();
    form.append(element("h3", {}, draft.id ? "Edit saved rule" : "New quality rule"));
    const draftNotice = ruleDraftNotice();
    if (draftNotice) form.append(draftNotice);
    form.append(paragraph("Rules compare original observations. A missing value stays unknown unless you explicitly require failure.", "q-help"),
      field("Rule title", title), field("Dataset", dataset),
      element("div", { className: "q-form-grid" }, field("Rule kind", kind), field("Facet scope", scope)),
      metricFields, assertionFields,
      element("div", { className: "q-form-grid" },
        field("Finding severity", selectInput("Finding severity", [["error", "Error"], ["warning", "Warning"], ["info", "Information"]],
          draft.severity, event => { draft.severity = event.target.value; })),
        field("Missing observation", selectInput("Missing observation", [["unknown", "Mark unknown"], ["fail", "Mark failed"]],
          draft.missing, event => { draft.missing = event.target.value; }))),
      element("label", { className: "q-check" }, element("input", { type: "checkbox", checked: draft.enabled,
        onchange: event => { draft.enabled = event.target.checked; } }), "Rule enabled"),
      element("div", { className: "q-actions" },
        element("button", { type: "submit", className: "primary", "data-write": true, disabled: writeDisabled() || !draft.datasetKey || draftIsStale() }, "Save rule"),
        actionButton("Clear form", () => { beginRule(); paint(); })));
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (writeDisabled()) return;
      try {
        if (draftIsStale()) throw new Error("Review the current saved rule and source revision before applying this retained draft.");
        const rule = ruleInput(draft);
        if (!rule.title.trim() || !rule.datasetKey) throw new Error("Enter a rule title and select the original dataset.");
        if (rule.kind === "metric") {
          if (!rule.metricPath?.startsWith("/")) throw new Error("Use an exact metric JSON pointer beginning with /.");
          if (draft.value === "" || !Number.isFinite(Number(draft.value))) throw new Error("Enter a finite numeric threshold.");
          rule.value = Number(draft.value);
          if (rule.operator === "between") {
            if (draft.upper === "" || !Number.isFinite(Number(draft.upper))) throw new Error("Enter a finite upper value.");
            rule.upper = Number(draft.upper);
            if (rule.upper < rule.value) throw new Error("The upper value must be at least the lower value.");
          } else delete rule.upper;
          delete rule.assertion; delete rule.expectedSuccess;
        } else {
          if (!rule.assertion?.name) throw new Error("Enter the original assertion name.");
          delete rule.metricPath; delete rule.operator; delete rule.value; delete rule.upper;
        }
        const saved = await save("quality.rule.save", { rule }, "Quality rule", ui.ruleDraftContext);
        if (saved) { ui.ruleDraft = null; ui.preview = null; await load(); }
      } catch (error) { ui.feedback = error.message; paint(); }
    });
    return form;
  }
  function rulesView() {
    const opened = authoringContext();
    const rules = (ui.overview.rules ?? []).filter(rule => !ui.datasetKey || rule.datasetKey === ui.datasetKey);
    const list = element("div", {}, element("h3", {}, "Saved rules"));
    if (!rules.length) list.append(empty("No rules for this selection", "Create a threshold or assertion expectation for an exact dataset. Original producer assertions are evaluated even when no rule has been added."));
    for (const rule of rules) list.append(element("article", { className: "q-record" },
      element("div", { className: "q-record-heading" }, element("h4", {}, rule.title), badge(rule.enabled ? "Enabled" : "Disabled")),
      paragraph(datasetName(rule.datasetKey), "q-small q-key"),
      definitionList([["Kind", rule.kind], ["Scope", rule.scope], ["Severity", rule.severity],
        ["Expected", rule.kind === "metric" ? rule.metricPath + " " + rule.operator + " " + display(rule.value) +
          (rule.operator === "between" ? " … " + display(rule.upper) : "") : rule.assertion?.name + " / " +
          (rule.assertion?.column ?? "dataset") + " → " + (rule.expectedSuccess ? "passed" : "failed")],
        ["Missing value", rule.missing], ["Version", rule.version]]),
      element("div", { className: "q-actions" },
        actionButton("Edit rule", () => { beginRule(rule); paint(); root.querySelector('[name="title"]')?.focus(); }),
        actionButton(rule.enabled ? "Disable rule" : "Enable rule", async () => {
          if (writeDisabled()) return;
          const saved = await save("quality.rule.save", { rule: { ...ruleInput(rule), enabled: !rule.enabled } }, "Quality rule", opened);
          if (saved) { ui.preview = null; await load(); }
        }, { "data-write": true, disabled: writeDisabled() })),
      details("Complete rule and saved history", rule)));
    return element("div", { className: "q-layout" }, list, element("aside", { className: "q-panel" }, ruleEditor()));
  }
  function evaluationSelector() {
    return field("Saved evaluation", selectInput("Saved quality evaluation",
      [["", ui.preview ? "Current preview — not saved" : "Select a saved evaluation"],
        ...(ui.overview.evaluations ?? []).map(item => [item.id, (item.title || "Quality evaluation") + " · " + dateText(item.createdAt)])],
      ui.selectedEvaluationId, event => {
        ui.selectedEvaluationId = event.target.value; ui.selectedFindingId = ""; ui.decisionContext = null; ui.reason = ""; ui.feedback = ""; paint();
      }));
  }
  function findingCards(evaluation, reviewable = true) {
    const findings = evaluation.findings ?? [];
    if (!findings.length) return empty("No findings in this evaluation", "No matching original assertions or enabled rules produced findings for the selected source.");
    return element("div", {}, findings.map(finding => element("article", { className: "q-record" + (ui.selectedFindingId === finding.id ? " selected" : "") },
      element("div", { className: "q-record-heading" },
        element("h4", {}, finding.title), element("div", { className: "q-actions" }, badge(finding.status), badge(finding.severity))),
      paragraph(datasetName(finding.datasetKey), "q-small q-key"), paragraph(finding.message, "q-small"),
      definitionList([["Expected", finding.expected], ["Actual", finding.actual], ["Run", finding.runKey], ["Job", finding.jobKey],
        ["Event", finding.eventId], ["Facet path", finding.facetPath]]),
      sourceLinks(finding.sources),
      reviewable ? actionButton("Review finding", () => {
        ui.selectedFindingId = finding.id; ui.decisionContext = authoringContext(); ui.tab = "decisions"; ui.reason = ""; paint();
      }, { disabled: !evaluation.id, title: evaluation.id ? "Record a disposition for this saved finding" : "Save the evaluation before recording a disposition" }) : null,
      details("Complete finding", finding))));
  }
  function evaluationView() {
    const evaluation = shownEvaluation();
    const evaluate = actionButton("Evaluate selected source", () => perform("Evaluate quality", async () => {
      const opened = authoringContext(), key = selectionKey(), value = await action("quality.evaluate", filters());
      if (key !== selectionKey()) return;
      if (value.workspaceId !== context().workspaceId || value.revision !== context().revision)
        throw new Error("The workspace changed during evaluation. Refresh and evaluate the current revision.");
      ui.preview = value; ui.previewContext = opened; ui.selectedEvaluationId = ""; ui.selectedFindingId = ""; ui.decisionContext = null;
    }), { className: "primary", disabled: ui.busy });
    const view = element("div", {}, element("div", { className: "q-heading" },
      element("div", {}, element("h3", {}, "Evaluate data quality"), paragraph("Evaluate the selected original events against their reported assertions and the saved rule versions.", "q-help")),
      element("div", { className: "q-actions" }, evaluate)), evaluationSelector());
    if (!evaluation) return element("div", {}, view, empty("Choose a saved evaluation or evaluate this source",
      "Saving keeps the exact findings, source event identities and rule versions together for review and reporting."));
    const values = evaluation.summary;
    view.append(element("div", { className: "q-summary" }, ["pass", "fail", "unknown", "total"].map(key =>
      element("div", { className: "q-stat" }, element("span", {}, labelText(key)), element("strong", {}, display(values[key]))))),
      definitionList([["Evaluation", evaluation.id || "Current preview"], ["Saved title", evaluation.title],
        ["Edition", editionName(evaluation.edition)], ["Source revision", evaluation.revision], ["Evaluated", dateText(evaluation.createdAt)]]));
    if (!evaluation.id) {
      const form = element("form", { className: "q-form" },
        field("Evaluation title", element("input", { required: true, maxlength: "240", name: "evaluationTitle", value: ui.evaluationTitle,
          placeholder: "Daily order dataset review", oninput: event => { ui.evaluationTitle = event.target.value; } })),
        element("div", { className: "q-actions" }, element("button", { type: "submit", className: "primary", "data-write": true, disabled: writeDisabled() }, "Save evaluation")));
      form.addEventListener("submit", async event => {
        event.preventDefault(); if (writeDisabled()) return;
        if (ui.preview !== evaluation || !sameContext(ui.previewContext)) {
          invalidateStalePreview(); ui.feedback = "Evaluate the current source selection before saving a result."; paint(); return;
        }
        if (!/^[a-f0-9]{64}$/.test(evaluation.selectionSha256 ?? "") || !/^[a-f0-9]{64}$/.test(evaluation.ruleSetSha256 ?? "")) {
          ui.feedback = "The evaluation response did not identify its source and rule selection. Refresh the application before saving."; paint(); return;
        }
        const saved = await save("quality.evaluation.save", { ...filters(), title: ui.evaluationTitle.trim(),
          expectedSelectionHash: evaluation.selectionSha256, expectedRulesHash: evaluation.ruleSetSha256 }, "Quality evaluation", ui.previewContext);
        if (saved) { ui.selectedEvaluationId = saved.evaluation.id; ui.preview = null; await load(); }
      });
      view.append(element("div", { className: "q-panel" }, form));
    } else view.append(element("div", { className: "q-actions" },
      actionButton("Review findings", () => { ui.tab = "decisions"; paint(); }),
      reportControls(evaluation.id)));
    view.append(findingCards(evaluation), details("Selected rule versions", evaluation.ruleVersions ?? []),
      details("Selected original event identities", evaluation.eventIds ?? []));
    return view;
  }
  function decisionsView() {
    const view = element("div", {}, element("h3", {}, "Finding decisions"),
      paragraph("A disposition records an operator decision against one immutable saved evaluation and finding. The original result remains available."),
      evaluationSelector());
    const evaluation = selectedEvaluation();
    if (!evaluation) return element("div", {}, view, empty("Select a saved evaluation",
      "Evaluate the source and save its complete result before assigning a disposition.",
      actionButton("Open evaluation", () => { ui.tab = "evaluation"; paint(); })));
    const findings = evaluation.findings ?? [];
    const selected = findings.find(item => item.id === ui.selectedFindingId) ?? null;
    const picker = field("Finding", selectInput("Finding for disposition",
      [["", "Select a finding"], ...findings.map(item => [item.id, labelText(item.status) + " · " + item.title + " · " + datasetName(item.datasetKey)])],
      ui.selectedFindingId, event => { ui.selectedFindingId = event.target.value; ui.decisionContext = authoringContext(); ui.reason = ""; paint(); }));
    view.append(picker);
    if (!selected) return view;
    view.append(element("div", { className: "q-record" }, element("h4", {}, selected.title),
      element("div", { className: "q-actions" }, badge(selected.status), badge(selected.severity)),
      paragraph(selected.message), definitionList([["Expected", selected.expected], ["Actual", selected.actual],
        ["Dataset", datasetName(selected.datasetKey)], ["Run", selected.runKey], ["Job", selected.jobKey], ["Original event", selected.eventId]]), sourceLinks(selected.sources)));
    if (decisionIsStale()) {
      const current = authoringContext();
      const sameWorkspace = ui.decisionContext?.workspaceId === current.workspaceId;
      const currentRead = ui.loadedKey === selectionKey() && ui.overview?.revision === current.revision;
      view.append(element("section", { className: "q-notice", role: "alert" },
        element("h4", {}, "Review the current decision history"),
        paragraph("Your reason is retained. The workspace or selection changed after this finding was opened. Read the current saved history below before applying this decision."),
        !sameWorkspace ? paragraph("This decision was opened in another workspace. Select a finding in this workspace to begin another decision.") : null,
        actionButton("Use reviewed revision with this decision", () => {
          if (!sameWorkspace || !currentRead || !sameContext(current) || ui.loadedKey !== selectionKey()) return;
          ui.decisionContext = authoringContext(); paint();
        }, { disabled: !sameWorkspace || !currentRead })));
    }
    const form = element("form", { className: "q-form" },
      element("div", { className: "q-form-grid" },
        field("Disposition", selectInput("Finding disposition", [["open", "Open"], ["investigating", "Investigating"], ["accepted", "Accepted"], ["resolved", "Resolved"]],
          ui.decision, event => { ui.decision = event.target.value; })),
        field("Reason", element("textarea", { name: "reason", required: true, rows: "4", value: ui.reason,
          placeholder: "Record the decision, work performed, and relevant source or result.",
          oninput: event => { ui.reason = event.target.value; } }))),
      element("div", { className: "q-actions" }, element("button", { type: "submit", className: "primary", "data-write": true, disabled: writeDisabled() || decisionIsStale() }, "Save disposition")));
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (writeDisabled()) return;
      if (decisionIsStale()) { ui.feedback = "Review the current saved decision history before applying this retained reason."; paint(); return; }
      const saved = await save("quality.disposition.save", { evaluationId: evaluation.id, findingId: selected.id, decision: ui.decision, reason: ui.reason.trim() }, "Quality disposition", ui.decisionContext);
      if (saved) { ui.reason = ""; ui.decisionContext = authoringContext(); await load(); }
    });
    view.append(element("div", { className: "q-panel" }, form));
    const records = (ui.overview.dispositions ?? []).filter(item => item.evaluationId === evaluation.id && item.findingId === selected.id);
    view.append(element("h4", {}, "Saved decision history"));
    if (!records.length) view.append(paragraph("No disposition has been saved for this finding."));
    for (const item of records) view.append(element("article", { className: "q-record" },
      element("div", { className: "q-record-heading" }, badge(item.decision), element("span", { className: "q-small q-muted" }, dateText(item.updatedAt ?? item.createdAt))),
      paragraph(item.reason), details("Complete disposition and history", item)));
    return view;
  }
  function reportControls(evaluationId = null) {
    const selected = selectInput("Quality report format", [["html", "HTML report"], ["json", "JSON data"], ["csv", "CSV findings"]], "html");
    return element("div", { className: "q-actions" }, selected,
      actionButton("Download quality report", () => perform("Export quality report", async () => {
        const args = evaluationId ? { evaluationId, format: selected.value } : { ...filters(), format: selected.value };
        const result = await action("quality.report.read", args);
        if (typeof result.text !== "string" || typeof result.mediaType !== "string") throw new Error("The report response is incomplete.");
        download(new Blob([result.text], { type: result.mediaType }), "openlineage-quality-" + (evaluationId || "selected-source") + "." + selected.value);
        ui.feedback = "The complete quality report was downloaded from revision " + result.revision + ".";
      }), { disabled: ui.busy }));
  }
  function paint() {
    if (!ui.active || !getState().view) return;
    const header = element("div", { className: "q-heading" },
      element("div", {}, element("h2", {}, "Dataset quality"), paragraph(editionName(getState().edition) +
        " · revision " + context().revision + " · original producer observations", "q-small q-muted")),
      element("div", { className: "q-actions" }, actionButton("Refresh quality", reload, { disabled: ui.busy }),
        ui.overview ? reportControls(ui.selectedEvaluationId || null) : null));
    const pieces = [header, filterControls()];
    if (ui.loading) {
      pieces.push(element("p", { className: "q-notice", role: "status" }, "Loading quality data from the selected workspace revision…"));
      root.setAttribute("aria-busy", "true");
    } else root.setAttribute("aria-busy", "false");
    if (ui.error) pieces.push(element("div", { className: "q-notice", role: "alert" }, paragraph(ui.error), actionButton("Refresh workspace", reload)));
    if (ui.feedback) pieces.push(element("p", { className: "q-feedback", role: "status", "aria-live": "polite" }, ui.feedback));
    if (ui.overview && !ui.loading && !ui.error) {
      pieces.push(summary());
      if (ui.overview.counts.invalidFacets) pieces.push(element("p", { className: "q-notice" },
        display(ui.overview.counts.invalidFacets) + (ui.overview.counts.invalidFacets === 1 ? " quality facet has source diagnostics." : " quality facets have source diagnostics.") + " Supplied values and complete originals remain visible in Observations."));
      pieces.push(tabs([["observations", "Observations"], ["rules", "Rules"], ["evaluation", "Evaluation"], ["decisions", "Decisions"]],
        ui.tab, value => { ui.tab = value; ui.feedback = ""; paint(); }));
      const content = element("section", { id: "quality-content", role: "tabpanel", "aria-labelledby": "quality-tab-" + ui.tab },
        ui.tab === "observations" ? observationsView() : ui.tab === "rules" ? rulesView() :
        ui.tab === "evaluation" ? evaluationView() : decisionsView());
      pieces.push(content);
    }
    root.replaceChildren(...pieces);
    if (host.firstChild !== root || host.childNodes.length !== 1) host.replaceChildren(root);
  }
  function render() {
    invalidateStalePreview();
    const active = getState().section === "quality";
    document.body.classList.toggle("quality-mode", active);
    if (!active) {
      if (ui.active) { ui.request++; ui.loading = false; ui.loadingKey = null; }
      ui.active = false; return false;
    }
    ui.active = true;
    if (!getState().view) return true;
    if (ui.busy) { paint(); return true; }
    const key = selectionKey();
    if (ui.loadedKey !== key && ui.loadingKey !== key) void load();
    else paint();
    return true;
  }
  return { render, refresh: reload };
}
