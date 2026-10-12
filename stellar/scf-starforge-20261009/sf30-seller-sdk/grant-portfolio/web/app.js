"use strict";
const $ = (selector, root = document) => root.querySelector(selector);
const S = { token: location.hash.slice(1), state: null, portfolio: null, view: "portfolios", table: "entities",
  offset: 0, search: "", status: "", standard: "", epoch: 0, refreshEpoch: 0, pending: null, review: {}, totalsOffset: 0 };
const names = { "source.receive": "Receive source edition", "portfolio.save": "Save portfolio",
  "review.save": "Save review", "portfolio.export": "Build complete handoff", "portfolio.receive": "Receive complete portfolio" };
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined && text !== null) result.textContent = String(text);
  if (className) result.className = className;
  return result;
}
function button(text, fn, className) {
  const result = node("button", text, className);
  result.type = "button";
  result.addEventListener("click", () => Promise.resolve(fn()).catch(failure));
  return result;
}
function field(label, type, value = "", options = []) {
  const wrapper = node("label", null, "field");
  wrapper.append(node("span", label));
  const input = node(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
  if (input.tagName === "INPUT") input.type = type;
  if (type === "select") options.forEach(([key, name]) => { const option = node("option", name); option.value = key; input.append(option); });
  input.value = value;
  wrapper.append(input);
  return { wrapper, input };
}
function notice(text, kind = "info", retry = null) {
  const box = $("#notice");
  box.hidden = false;
  box.dataset.kind = kind;
  box.replaceChildren(node("span", text));
  if (retry) box.append(button("Retry original operation", retry));
}
function failure(error) { notice(error.message || String(error), "error", S.pending ? () => runOriginal(S.pending) : null); }
async function response(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Authorization", "Bearer " + S.token);
  const result = await fetch(path, { ...options, headers, cache: "no-store", credentials: "omit" });
  if (!result.ok) {
    let body;
    try { body = await result.json(); } catch { body = {}; }
    const error = new Error(body.message || "The workspace request did not complete (" + result.status + ").");
    error.code = body.code;
    throw error;
  }
  return result;
}
async function api(path, options) { return (await response(path, options)).json(); }
async function post(path, value) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}
async function refresh(selectId = S.portfolio && S.portfolio.id, selectRevision = null) {
  const refreshEpoch = ++S.refreshEpoch;
  ++S.epoch;
  const state = await api("/api/state");
  if (refreshEpoch !== S.refreshEpoch) return;
  const current = state.portfolios.find(p => p.id === selectId);
  const portfolio = current ? await api("/api/portfolio?id=" + current.id + "&revision=" + (selectRevision || current.revision)) : null;
  if (refreshEpoch !== S.refreshEpoch) return;
  if (S.portfolio?.id !== portfolio?.id || S.portfolio?.snapshot !== portfolio?.snapshot) {
    S.review = {}; S.offset = 0; S.totalsOffset = 0;
    if ($("#detail-dialog").open) $("#detail-dialog").close();
  }
  S.state = state; S.portfolio = portfolio;
  $("#connection").textContent = state.sources.length + " source editions · Workspace revision " + state.revision;
  const selected = $("#portfolio-select");
  selected.replaceChildren(node("option", "Select a saved portfolio"));
  selected.firstChild.value = "";
  for (const p of state.portfolios) { const o = node("option", p.name); o.value = p.id; selected.append(o); }
  if (current) selected.value = current.id;
  const revisions = $("#revision-select");
  revisions.replaceChildren();
  if (current) for (let index = current.revision; index >= 1; index--) {
    const option = node("option", "Revision " + index); option.value = String(index); revisions.append(option);
  }
  if (portfolio) revisions.value = String(portfolio.revision);
  else revisions.append(node("option", "—"));
  await render();
}
async function awaitOperation(initial) {
  let current = initial;
  while (current.state === "RUNNING") {
    notice((names[current.action] || current.action) + " is running. The operation is saved in this workspace.");
    await new Promise(resolve => setTimeout(resolve, 1800));
    current = await api("/api/request?id=" + encodeURIComponent(current.id));
  }
  if (current.state !== "COMPLETED") {
    S.pending = null;
    throw new Error(current.error && current.error.message || "The saved operation needs attention.");
  }
  return current;
}
async function runOriginal(original) {
  S.pending = original;
  document.body.classList.add("busy");
  try {
    const completed = await awaitOperation(await post("/api/action", original));
    S.pending = null;
    const result = completed.result;
    notice((names[original.action] || original.action) + " completed.");
    let id = S.portfolio && S.portfolio.id;
    if (original.action === "portfolio.save" || original.action === "review.save") id = result.id;
    if (original.action === "portfolio.receive") id = result.portfolioId;
    await refresh(id);
    return result;
  } finally { document.body.classList.remove("busy"); }
}
async function action(kind, payload) {
  if (S.pending) throw new Error("Continue the original pending operation before starting another.");
  return runOriginal({ operationId: "grant-" + crypto.randomUUID(), action: kind, payload });
}
function sourceName(id) { return S.state.sources.find(source => source.id === id)?.label || id; }
function heading(title, description, actions = []) {
  const header = node("header", null, "section-head");
  const left = node("div"); left.append(node("h1", title), node("p", description, "muted"));
  header.append(left);
  if (actions.length) { const buttons = node("div", null, "actions"); buttons.append(...actions); header.append(buttons); }
  return header;
}
function panel(title, description) {
  const section = node("section", null, "panel");
  if (title) section.append(node("h2", title));
  if (description) section.append(node("p", description, "muted"));
  return section;
}
function metric(value, label) {
  const div = node("div", null, "metric"); div.append(node("strong", value), node("span", label)); return div;
}
function rawDetails(title, value) {
  const details = node("details"); details.append(node("summary", title), node("pre", JSON.stringify(value, null, 2))); return details;
}
function table(headers, rows) {
  const wrapper = node("div", null, "table-wrap"), grid = node("table"), head = node("thead"), tr = node("tr");
  headers.forEach(text => tr.append(node("th", text))); head.append(tr); grid.append(head);
  const body = node("tbody");
  for (const cells of rows) {
    const row = node("tr");
    for (const cell of cells) {
      const td = node("td");
      if (cell && cell.nodeType) td.append(cell);
      else if (cell && typeof cell === "object") { td.textContent = cell.text ?? ""; td.className = cell.className || ""; }
      else td.textContent = cell ?? "—";
      row.append(td);
    }
    body.append(row);
  }
  grid.append(body); wrapper.append(grid); return wrapper;
}
function pager(result, change) {
  const div = node("div", null, "pager"), buttons = node("div", null, "actions");
  div.append(node("span", result.total ? (result.offset + 1) + "–" + (result.offset + result.rows.length) + " of " + result.total
    : "No matching records", "small"));
  const previous = button("Previous", () => change(Math.max(0, result.offset - 50)));
  previous.disabled = result.offset === 0;
  const next = button("Next", () => change(result.nextOffset)); next.disabled = result.nextOffset === null;
  buttons.append(previous, next); div.append(buttons); return div;
}
async function page(name, extra = {}) {
  const p = S.portfolio;
  const query = new URLSearchParams({ portfolioId: p.id, revision: String(p.revision), table: name,
    offset: String(S.offset), limit: "50", search: S.search, status: S.status, standard: S.standard, ...extra });
  const result = await api("/api/rows?" + query);
  if (result.snapshot !== p.snapshot || result.revision !== p.revision) throw new Error("The response selected another saved revision.");
  return result;
}
function needPortfolio(container) {
  if (S.portfolio) return false;
  container.append(node("div", "Choose a saved portfolio, or receive source editions and create one.", "empty"));
  return true;
}
function currentEdit() {
  const p = S.portfolio;
  return !p || S.state.portfolios.find(row => row.id === p.id)?.revision === p.revision;
}
async function download(path, filename) {
  const res = await response(path);
  const size = Number(res.headers.get("Content-Length")), hash = res.headers.get("X-Content-SHA256");
  if (!Number.isSafeInteger(size) || size < 1 || !/^[0-9a-f]{64}$/.test(hash || "")) throw new Error("The complete download descriptor is missing.");
  if (typeof showSaveFilePicker === "function") {
    const selected = await showSaveFilePicker({ suggestedName: filename, types: [{ description: "Complete ZIP handoff", accept: { "application/zip": [".zip"] } }] });
    const writable = await selected.createWritable(), reader = res.body.getReader();
    let count = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; count += part.value.length; await writable.write(part.value); }
      if (count !== size) throw new Error("The complete download was interrupted.");
      await writable.close();
    } catch (error) { await writable.abort(); throw error; }
  } else {
    const blob = await res.blob();
    if (blob.size !== size) throw new Error("The complete download was interrupted.");
    const url = URL.createObjectURL(blob), anchor = node("a");
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  notice("Complete handoff downloaded: " + filename);
}
async function upload(file) {
  if (!file) throw new Error("Choose the complete original ZIP handoff.");
  notice("Receiving the complete file: " + file.name);
  return api("/api/upload", { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
}
function sourceCard(source) {
  const card = panel(source.label);
  card.append(node("span", source.standard === "iati" ? "IATI" : "360Giving", "tag"),
    node("p", source.coverage.statement, "coverage"));
  const line = node("p", null, "small"), link = node("a", "Publisher source");
  link.href = source.coverage.sourceUrl; link.target = "_blank"; link.rel = "noreferrer";
  line.append(link, node("span", " · " + source.coverage.observedAt + " · " + source.coverage.license));
  card.append(line);
  const metrics = node("div", null, "metrics");
  metrics.append(metric(source.counts.entities, "records and organizations"), metric(source.counts.financial, "financial records"));
  card.append(metrics);
  const buttons = node("div", null, "actions");
  buttons.append(button("Original source packet", () => download("/api/object?sha256=" + source.object.sha256, source.label.replace(/[^a-z0-9]+/gi, "_") + ".zip")),
    button("Source details", async () => {
      const full = await api("/api/source?id=" + source.id);
      showDialog(source.label, [node("p", source.coverage.statement, "coverage"), rawDetails("Complete native selection and receiving", full)]);
    }));
  card.append(buttons); return card;
}
function sourcesView(container) {
  container.append(heading("Source editions", "Receive complete IATI or 360Giving handoffs with their original coverage and capture."));
  const form = node("form", null, "panel"), grid = node("div", null, "form-grid");
  form.append(node("h2", "Receive a source edition"));
  const standard = field("Standard", "select", "iati", [["iati", "IATI"], ["360giving", "360Giving"]]);
  const label = field("Publisher and edition label", "text");
  const sourceUrl = field("Original publisher URL", "url");
  const observedAt = field("Captured at", "text", new Date().toISOString());
  const license = field("Published license", "text");
  const selection = field("Native build", "select", "original", [["original", "Original publisher records"], ["candidate", "Explicit reviewed 360Giving candidate"]]);
  const coverage = field("Coverage of this edition", "textarea");
  coverage.wrapper.classList.add("full");
  const file = field("Complete native ZIP handoff", "file"); file.input.accept = ".zip,application/zip"; file.wrapper.classList.add("full");
  for (const item of [standard, label, sourceUrl, observedAt, license, selection, coverage, file]) grid.append(item.wrapper);
  for (const item of [label, sourceUrl, observedAt, license, coverage, file]) item.input.required = true;
  form.append(grid);
  const submit = node("button", "Receive complete source", "primary"); submit.type = "submit";
  const actions = node("div", null, "actions"); actions.append(submit); form.append(actions);
  form.addEventListener("submit", async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      const selected = { standard: standard.input.value, label: label.input.value,
        coverage: { statement: coverage.input.value, sourceUrl: sourceUrl.input.value,
          observedAt: observedAt.input.value, license: license.input.value },
        selection: standard.input.value === "360giving" ? { build: selection.input.value } : {} };
      const original = await upload(file.input.files[0]);
      await action("source.receive", { ...selected, object: original.sha256 });
    } catch (error) { failure(error); } finally { submit.disabled = false; }
  });
  container.append(form);
  const receive = panel("Receive a complete portfolio", "Restore every source, saved review and revision from one complete handoff.");
  const incoming = field("Complete portfolio ZIP", "file"); incoming.input.accept = ".zip,application/zip";
  receive.append(incoming.wrapper, button("Receive complete portfolio", async () => {
    const original = await upload(incoming.input.files[0]); await action("portfolio.receive", { object: original.sha256 });
  }));
  container.append(receive);
  const cards = node("div", null, "grid"); S.state.sources.forEach(source => cards.append(sourceCard(source))); container.append(cards);
}
function portfoliosView(container) {
  const p = S.portfolio;
  container.append(heading(p ? p.name : "Portfolios", "Select original source editions, describe the review scope, and save a complete portfolio.",
    p ? [button("Export complete portfolio", async () => {
      const result = await action("portfolio.export", { portfolioId: p.id, revision: p.revision });
      await download("/api/export?id=" + result.sha256, result.filename);
    })] : []));
  if (p) {
    const summary = panel(null), metrics = node("div", null, "metrics");
    metrics.style.borderTop = "0"; metrics.style.marginTop = "0";
    metrics.append(metric(p.sources.length, "source editions"), metric(p.counts.entities, "records"),
      metric(p.counts.links, "confirmed links"), metric(p.decisions.filter(d => d.status === "STALE").length, "reviews to refresh"));
    summary.append(metrics, node("p", "Revision " + p.revision + " · " + p.review.status + " · " + p.updatedAt, "small"));
    container.append(summary);
  }
  const form = node("form", null, "panel");
  form.append(node("h2", p ? "Save the following revision" : "Create a portfolio"));
  const grid = node("div", null, "form-grid");
  const name = field("Portfolio name", "text", p?.name || ""), reviewer = field("Reviewer", "text", p?.review.reviewer || "");
  const status = field("Review state", "select", p?.review.status || "draft",
    [["draft", "Draft"], ["reviewed", "Reviewed"], ["needs-correction", "Needs correction"]]);
  const note = field("Review note", "textarea", p?.review.note || ""), notes = field("Portfolio scope and notes", "textarea", p?.notes || "");
  notes.wrapper.classList.add("full"); note.wrapper.classList.add("full");
  [name, reviewer, status, note, notes].forEach(x => grid.append(x.wrapper));
  name.input.required = reviewer.input.required = true; form.append(grid, node("h3", "Source selection"));
  const boxes = new Map(), sourceList = node("div", null, "source-list"), replacements = node("div");
  for (const source of S.state.sources) {
    const item = node("label", null, "source-option"), input = node("input"); input.type = "checkbox"; input.checked = !!p?.sources.includes(source.id);
    const description = node("div"); description.append(node("strong", source.label + " · " + source.standard), node("p", source.coverage.statement));
    item.append(input, description); boxes.set(source.id, input); sourceList.append(item);
  }
  const replacementChoices = new Map();
  function updateReplacements() {
    replacements.replaceChildren(); replacementChoices.clear();
    const selected = [...boxes].filter(([, box]) => box.checked).map(([id]) => id);
    const removed = (p?.sources || []).filter(id => !selected.includes(id)), added = selected.filter(id => !p?.sources.includes(id));
    if (removed.length && added.length) {
      replacements.append(node("h3", "Following editions"), node("p", "Pair an earlier source with its replacement to carry unchanged reviews and reopen changed records.", "small"));
      for (const before of removed) {
        const row = node("div", null, "replacement"), select = node("select"), blank = node("option", "Leave unpaired");
        blank.value = ""; select.append(blank);
        for (const after of added) {
          if (S.state.sources.find(x => x.id === before)?.standard !== S.state.sources.find(x => x.id === after)?.standard) continue;
          const option = node("option", sourceName(after)); option.value = after; select.append(option);
        }
        row.append(node("span", sourceName(before)), select); replacementChoices.set(before, select); replacements.append(row);
      }
    }
  }
  boxes.forEach(box => box.addEventListener("change", updateReplacements));
  form.append(sourceList, replacements); updateReplacements();
  if (!S.state.sources.length) form.append(node("p", "Receive the original source editions first.", "small"));
  const submit = node("button", p ? "Save revision" : "Create portfolio", "primary"); submit.type = "submit";
  submit.disabled = !S.state.sources.length || !currentEdit();
  if (!currentEdit()) form.append(node("p", "Open the latest revision to save changes.", "small"));
  const buttons = node("div", null, "actions"); buttons.append(submit); form.append(buttons);
  form.addEventListener("submit", async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      const payload = { name: name.input.value, notes: notes.input.value,
        sources: [...boxes].filter(([, input]) => input.checked).map(([id]) => id),
        review: { status: status.input.value, reviewer: reviewer.input.value, note: note.input.value },
        sourceReplacements: [...replacementChoices].filter(([, input]) => input.value).map(([before, input]) => ({ before, after: input.value })) };
      if (p) Object.assign(payload, { id: p.id, expectedPortfolioRevision: p.revision });
      await action("portfolio.save", payload);
    } catch (error) { failure(error); } finally { submit.disabled = false; }
  });
  container.append(form);
}
async function detail(ref) {
  const p = S.portfolio;
  const full = await api("/api/detail?" + new URLSearchParams({ portfolioId: p.id, revision: String(p.revision), sourceId: ref.sourceId, entityKey: ref.entityKey }));
  if (S.portfolio?.id !== p.id || S.portfolio?.snapshot !== p.snapshot || full.snapshot !== p.snapshot)
    throw new Error("The selected portfolio revision changed. Open its current record again.");
  return full;
}
function showDialog(title, elements) {
  $("#detail-title").textContent = title; $("#detail-content").replaceChildren(...elements); $("#detail-dialog").showModal();
}
async function showRecord(ref) {
  const full = await detail(ref);
  showDialog(full.entity.title || full.entity.originalId, [
    node("p", full.source.label + " · " + full.entity.kind, "small"),
    node("p", full.source.coverage.statement, "coverage"),
    node("pre", JSON.stringify(full.entity.original, null, 2)),
    rawDetails("Every original financial record", full.financial),
    rawDetails("Exact source and record references", { sourceId: full.source.id, entityKey: full.entity.entityKey,
      sha256: full.entity.sha256, snapshot: full.snapshot })
  ]);
}
function reference(row) { return { sourceId: row.sourceId, entityKey: row.entityKey, sha256: row.sha256 }; }
async function choose(side, ref, decision = null) {
  const full = await detail(ref);
  S.review[side] = full.entity;
  if (decision) S.review.decision = decision;
  await render();
}
async function openDecision(row) {
  const selectedPortfolio = S.portfolio;
  S.review = { decision: row };
  const resolve = field => row.staleReasons?.find(reason => reason.field === field)?.current
    || row.proposedReferences?.[field] || row[field];
  const left = resolve(row.type === "record" ? "record" : "left");
  const right = resolve(row.type === "record" ? "related" : "right");
  for (const [side, ref] of [["left", left], ["right", right]]) {
    if (S.portfolio?.snapshot !== selectedPortfolio.snapshot) return;
    if (ref && selectedPortfolio.sources.includes(ref.sourceId)) {
      try {
        const full = await detail(ref);
        if (S.portfolio?.snapshot !== selectedPortfolio.snapshot) return;
        S.review[side] = full.entity;
      } catch (error) {
        if (S.portfolio?.snapshot !== selectedPortfolio.snapshot) return;
        if (error.code !== "NOT_FOUND") throw error;
      }
    }
  }
  await render();
}
function reviewEditor(container) {
  const p = S.portfolio, old = S.review.decision, left = S.review.left, right = S.review.right;
  if (!left && !right && !old) return;
  const editor = panel(old ? "Review the saved decision" : "Review selected records");
  const pair = node("div", null, "pair");
  for (const [side, record] of [["left", left], ["right", right]]) {
    const card = node("div", null, "record-summary"); card.append(node("small", side === "left" ? "Selected record" : "Related record"));
    if (record) card.append(node("h3", record.title || record.originalId), node("p", record.originalId),
      node("p", sourceName(record.sourceId)), button("Complete original record", () => showRecord(reference(record))));
    else card.append(node("p", "Choose a record from the list."));
    pair.append(card);
  }
  editor.append(pair);
  const form = node("form"), grid = node("div", null, "form-grid");
  const type = field("Review type", "select", old?.type || (right ? "link" : "record"), [["record", "Single record"], ["link", "Record relation"]]);
  const relation = field("Relation", "select", old?.relation || (left?.kind === "organization" ? "same-organization" : "grant-activity"),
    [["same-organization", "Same organization"], ["grant-activity", "Grant and activity"], ["duplicate", "Duplicate record"]]);
  const disposition = field("Decision", "select", "", []);
  function setDispositions() {
    disposition.input.replaceChildren();
    const values = type.input.value === "record" ? [["unmatched", "Unmatched"], ["coverage-only", "Covered by this source only"], ["duplicate", "Duplicate"]]
      : [["confirmed", "Confirm relation"], ["rejected", "Reject relation"], ["ambiguous", "Ambiguous"]];
    for (const [value, text] of values) { const option = node("option", text); option.value = value; disposition.input.append(option); }
    if (values.some(([value]) => value === old?.disposition)) disposition.input.value = old.disposition;
    relation.wrapper.hidden = type.input.value !== "link";
  }
  type.input.addEventListener("change", setDispositions); setDispositions();
  const reviewer = field("Reviewer", "text", old?.reviewer || p.review.reviewer);
  const rationale = field("Reason for this decision", "textarea", old?.rationale || ""); rationale.wrapper.classList.add("full");
  reviewer.input.required = rationale.input.required = true;
  [type, relation, disposition, reviewer, rationale].forEach(item => grid.append(item.wrapper));
  form.append(grid);
  const submit = node("button", "Save review", "primary"); submit.type = "submit"; submit.disabled = !left || !currentEdit();
  const buttons = node("div", null, "actions"); buttons.append(submit, button("Clear selection", () => { S.review = {}; return render(); }));
  form.append(buttons);
  if (old?.status === "STALE") form.append(node("p", "This decision's original records changed. Review the current originals and save the updated decision.", "small"));
  form.addEventListener("submit", async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      if (!left) throw new Error("Choose the original record.");
      let decision = { type: type.input.value, disposition: disposition.input.value, rationale: rationale.input.value };
      if (old) decision.id = old.id;
      if (decision.type === "link") {
        if (!right) throw new Error("Choose both records.");
        Object.assign(decision, { left: reference(left), right: reference(right), relation: relation.input.value });
      } else {
        decision.record = reference(left);
        if (decision.disposition === "duplicate") {
          if (!right) throw new Error("Choose the related original record.");
          decision.related = reference(right);
        }
      }
      await action("review.save", { portfolioId: p.id, expectedPortfolioRevision: p.revision,
        reviewer: reviewer.input.value, decisions: [decision] });
      S.review = {}; await render();
    } catch (error) { failure(error); } finally { submit.disabled = false; }
  });
  editor.append(form); container.append(editor);
}
function filters(container, options = {}) {
  const bar = node("div", null, "toolbar"), search = node("input"); search.type = "search"; search.placeholder = "Search records"; search.value = S.search;
  const status = node("select"), standard = node("select");
  for (const value of ["", ...(options.statuses || [])]) { const o = node("option", value || "All states"); o.value = value; status.append(o); }
  status.value = S.status;
  for (const [value, text] of [["", "Both standards"], ["iati", "IATI"], ["360giving", "360Giving"]]) {
    const o = node("option", text); o.value = value; standard.append(o);
  }
  standard.value = S.standard;
  const apply = () => { S.search = search.value; S.status = status.value; S.standard = standard.value; S.offset = 0; return render(); };
  search.addEventListener("keydown", event => { if (event.key === "Enter") apply().catch(failure); });
  bar.append(search, status, standard, button("Apply", apply)); container.append(bar);
}
async function reviewView(container, epoch) {
  container.append(heading("Review records", "Inspect original records, confirm relationships, and resolve unmatched, duplicate or changed entries."));
  if (needPortfolio(container)) return;
  reviewEditor(container);
  const tabs = node("div", null, "tabs");
  for (const [key, text] of [["entities", "All records"], ["candidates", "Suggested relations"], ["decisions", "Saved decisions"], ["links", "Confirmed links"]])
    tabs.append(button(text, () => { S.table = key; S.offset = 0; S.status = ""; S.search = ""; return render(); }, S.table === key ? "selected" : ""));
  container.append(tabs);
  filters(container, { statuses: S.table === "entities" ? ["UNREVIEWED", "LINKED", "UNMATCHED", "COVERAGE-ONLY", "DUPLICATE", "STALE"]
    : S.table === "candidates" ? ["PROPOSED", "AMBIGUOUS", "CONFIRMED", "REJECTED"] : ["CURRENT", "STALE"] });
  const result = await page(S.table); if (epoch !== S.epoch) return;
  let rows, headers;
  if (S.table === "entities") {
    headers = ["Record", "Kind", "Source edition", "State", "Review"];
    rows = result.rows.map(row => {
      const buttons = node("div"); buttons.append(button("Open", () => showRecord(reference(row))),
        button("Select left", () => choose("left", reference(row))), button("Select right", () => choose("right", reference(row))));
      return [{ text: row.title || row.originalId, className: "title" }, row.kind, sourceName(row.sourceId), row.status, buttons];
    });
  } else if (S.table === "candidates") {
    headers = ["First record", "Second record", "Suggested relation", "Basis", "State", "Review"];
    rows = result.rows.map(row => [row.leftTitle, row.rightTitle, row.relation, row.basis.join("; "), row.status,
      button("Review pair", async () => {
        S.review = { left: (await detail(row.left)).entity, right: (await detail(row.right)).entity };
        if (row.decisionId) {
          const found = S.portfolio.decisions.find(item => item.id === row.decisionId); if (found) S.review.decision = found;
        }
        await render();
      })]);
  } else {
    headers = ["Decision", "State", "Reviewer", "Rationale", "Review"];
    rows = result.rows.map(row => [row.relation || row.type, row.status + " · " + row.disposition, row.reviewer,
      { text: row.rationale, className: "title" }, button("Open decision", () => openDecision(row))]);
  }
  container.append(table(headers, rows), pager(result, offset => { S.offset = offset; return render(); }));
}
async function ledgerView(container, epoch) {
  container.append(heading("Financial ledger", "Amounts retain their original decimal text, source, currency, dates and financial meaning."));
  if (needPortfolio(container)) return;
  const p = S.portfolio, totals = p.financialTotals.slice(S.totalsOffset, S.totalsOffset + 50), summary = panel("Independent financial groups");
  summary.append(node("p", "Awards, application requests, commitments, disbursements and budgets remain separate. Confirmed links keep both source records visible.", "small"));
  summary.append(table(["Source edition", "Meaning and original dimensions", "Amount", "Included", "Excluded / missing"],
    totals.map(row => [sourceName(row.dimensions.sourceId), JSON.stringify(Object.fromEntries(Object.entries(row.dimensions).filter(([key]) => key !== "sourceId"))),
      { text: row.amount ?? "Missing", className: "number" }, row.includedRecords, row.excludedRecords + " / " + row.missingRecords])));
  summary.append(pager({ rows: totals, offset: S.totalsOffset, total: p.financialTotals.length,
    nextOffset: S.totalsOffset + totals.length < p.financialTotals.length ? S.totalsOffset + totals.length : null },
    offset => { S.totalsOffset = offset; return render(); }));
  container.append(summary);
  filters(container, { statuses: ["award", "application-request", "transactions", "budgets"] });
  const result = await page("financial"); if (epoch !== S.epoch) return;
  container.append(table(["Original record", "Source edition", "Meaning", "Amount", "Currency", "Eligibility", "Original dimensions", "Detail"],
    result.rows.map(row => [row.originalId, sourceName(row.sourceId), row.kind, { text: row.value ?? "Missing", className: "number" },
      row.currency || "Missing", row.eligible ? "Included in its group" : "Excluded from totals", JSON.stringify(row.dimensions),
      button("Open record", () => showRecord(row))])),
    pager(result, offset => { S.offset = offset; return render(); }));
}
async function historyView(container, epoch) {
  container.append(heading("Revision history", "Each saved revision retains the selected sources, original decisions and complete record changes."));
  if (needPortfolio(container)) return;
  const p = S.portfolio, summary = panel("Revision " + p.revision);
  summary.append(node("p", p.updatedAt + " · " + p.review.reviewer + " · " + p.review.status, "small"),
    node("p", p.review.note || p.notes), rawDetails("Source replacements and exact revision", {
      sourceReplacements: p.sourceReplacements, snapshot: p.snapshot, previousSnapshot: p.previousSnapshot, operationId: p.operationId }));
  container.append(summary);
  filters(container, { statuses: ["added", "removed", "changed", "unchanged-in-following-edition", "review-updated"] });
  const result = await page("changes"); if (epoch !== S.epoch) return;
  container.append(table(["Change", "Record", "Earlier source", "Following source", "Detail"],
    result.rows.map(row => [row.kind, row.title || row.decisionId, row.before ? sourceName(row.before.sourceId) : "",
      row.after ? sourceName(row.after.sourceId) : "", row.after ? button("Current original", () => showRecord(row.after))
        : button("Saved change", () => showDialog("Saved change", [node("pre", JSON.stringify(row, null, 2))]))])),
    pager(result, offset => { S.offset = offset; return render(); }));
}
function requestsView(container) {
  container.append(heading("Saved operations", "Continue the original operation after an interruption and inspect its saved input and result."));
  const entries = S.state.requests.slice(S.offset, S.offset + 50);
  container.append(table(["Operation", "State", "Updated", "Detail", "Continue"],
    entries.map(row => [names[row.action] || row.action, row.state, row.updatedAt,
      button("Open", async () => showDialog("Saved operation", [node("pre", JSON.stringify(await api("/api/request?id=" + encodeURIComponent(row.id)), null, 2))])),
      row.state === "COMPLETED" ? "Complete" : button("Resume original", async () => {
        await awaitOperation(await post("/api/resume", { operationId: row.id })); await refresh();
      })])),
    pager({ rows: entries, offset: S.offset, total: S.state.requests.length,
      nextOffset: S.offset + entries.length < S.state.requests.length ? S.offset + entries.length : null },
    offset => { S.offset = offset; return render(); }));
}
async function render() {
  const epoch = ++S.epoch, content = $("#content"), fragment = node("div");
  document.querySelectorAll("nav button").forEach(button => button.classList.toggle("active", button.dataset.view === S.view));
  if (!S.state) return;
  if (S.view === "sources") sourcesView(fragment);
  else if (S.view === "portfolios") portfoliosView(fragment);
  else if (S.view === "review") await reviewView(fragment, epoch);
  else if (S.view === "ledger") await ledgerView(fragment, epoch);
  else if (S.view === "history") await historyView(fragment, epoch);
  else requestsView(fragment);
  if (epoch === S.epoch) content.replaceChildren(...fragment.childNodes);
}
document.querySelectorAll("nav button").forEach(button => button.addEventListener("click", () => {
  S.view = button.dataset.view; S.offset = 0; S.search = ""; S.status = ""; S.standard = ""; render().catch(failure);
}));
$("#portfolio-select").addEventListener("change", () => {
  S.review = {}; S.offset = 0; S.totalsOffset = 0; refresh($("#portfolio-select").value).catch(failure);
});
$("#revision-select").addEventListener("change", () => {
  S.review = {}; S.offset = 0; S.totalsOffset = 0; refresh(S.portfolio?.id, Number($("#revision-select").value)).catch(failure);
});
$("#refresh").addEventListener("click", () => refresh().catch(failure));
$("#new-portfolio").addEventListener("click", () => {
  ++S.refreshEpoch; S.portfolio = null; S.view = "portfolios"; S.review = {}; $("#portfolio-select").value = ""; $("#revision-select").replaceChildren(node("option", "—")); render().catch(failure);
});
$("#close-detail").addEventListener("click", () => $("#detail-dialog").close());
if (!/^[A-Za-z0-9_-]{43}$/.test(S.token)) {
  notice("Open this workspace's saved console link to connect.", "error");
  $("#connection").textContent = "Connection required";
} else refresh().catch(failure);
