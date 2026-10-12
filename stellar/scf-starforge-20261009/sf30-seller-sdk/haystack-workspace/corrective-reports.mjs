import { stringifyJson } from "./json-codec.mjs";
import { analyzed, sourceSummary } from "./model.mjs";
import { workRows, workView, workSummary, evidenceSummary } from "./corrective-work.mjs";
import { canonical, clone, csv, escapeHtml as h, need } from "./util.mjs";

const COLUMNS = ["work_id", "title", "description", "assignee", "due_date", "priority", "status",
  "source_id", "source_name", "record_key", "diagnostic_code", "captured_material", "current_finding",
  "evidence_count", "evidence_ids", "submission_round", "submitted_at", "reviewer", "review_decision",
  "review_note", "updated_at", "updated_by", "work_head"];
export function workReportData(state) {
  const view = analyzed(state), api = { analyzed: () => view }, work = state.correctiveWork;
  return {
    format: "commons.haystack.corrective-work-register.v1",
    workspace: { id: state.workspaceId, title: state.title, revision: state.revision, stateSha256: state.sha256 },
    currentMaterialSha256: view.contentSha256, counts: workSummary(state),
    sources: state.sources.map(sourceSummary),
    items: workRows(state, {}, api).map(item => workView(state, item.id, api)),
    contexts: clone(work?.contexts || []), evidence: clone(work?.evidence || []),
    returns: clone(work?.returns || [])
  };
}
function rows(data) {
  const sources = new Map(data.sources.map(source => [source.id, source]));
  return data.items.map(item => {
    const current = item.current, fields = current.fields;
    return { work_id: item.id, title: fields.title, description: fields.description,
      assignee: fields.assignee, due_date: fields.dueDate, priority: fields.priority, status: current.status,
      source_id: item.origin.sourceId, source_name: sources.get(item.origin.sourceId)?.name || "",
      record_key: item.origin.recordKey || "", diagnostic_code: item.origin.diagnostic?.code || "",
      captured_material: item.origin.materialSha256, current_finding: item.finding.state,
      evidence_count: current.evidenceIds.length, evidence_ids: current.evidenceIds.join("; "),
      submission_round: current.submission?.round || "", submitted_at: current.submission?.at || "",
      reviewer: current.review?.author || "", review_decision: current.review?.decision || "",
      review_note: current.review?.note || "", updated_at: current.at, updated_by: current.author,
      work_head: item.headSha256 };
  });
}
function table(columns, values) {
  return "<div class=\"table-wrap\"><table><thead><tr>" + columns.map(column => "<th scope=\"col\">" + h(column.replaceAll("_", " ")) + "</th>").join("") +
    "</tr></thead><tbody>" + values.map(value => "<tr>" + columns.map(column => "<td>" + h(value[column]) + "</td>").join("") + "</tr>").join("") +
    "</tbody></table></div>";
}
function fact(label, value) { return "<dt>" + h(label) + "</dt><dd>" + h(value || "—") + "</dd>"; }
function jsonDetails(label, value) { return "<details><summary>" + h(label) + "</summary><pre>" + h(stringifyJson(value, 2)) + "</pre></details>"; }
export function workReportHtml(data) {
  const title = data.workspace.title + " — corrective work", register = rows(data);
  const evidence = data.evidence.map(record => {
    const summary = evidenceSummary(record);
    const download = record.kind === "file" ?
      "<p><a download=\"" + h(record.name) + "\" href=\"data:application/octet-stream;base64," + record.base64 + "\">Download " + h(record.name) + "</a></p>" :
      jsonDetails(record.kind === "proposal" ? "Complete native proposal" : "Complete observation", record.kind === "proposal" ? record.proposal : { note: record.note, author: record.author, recordedAt: record.recordedAt });
    return "<article id=\"evidence-" + h(record.id) + "\"><h3>" + h(summary.name) + "</h3><dl>" +
      fact("Kind", record.kind) + fact("Author", record.author) + fact("Recorded", record.recordedAt) +
      fact("Note", record.note) + fact("Complete bytes", String(summary.bytes)) + fact("SHA-256", summary.sha256) +
      "</dl>" + download + "</article>";
  }).join("");
  const details = data.items.map(item => {
    const current = item.current, fields = current.fields;
    const history = item.history.map(event => ({
      recorded: event.at, author: event.author, action: event.kind, status: event.status, note: event.note,
      event: event.sha256, previous: event.previousSha256 || "", recipient_branch: event.returnedHeadSha256 || ""
    }));
    return "<article id=\"work-" + h(item.id) + "\"><h3>" + h(fields.title) + "</h3><p class=\"description\">" + h(fields.description) + "</p><dl>" +
      fact("Assigned to", fields.assignee) + fact("Due", fields.dueDate) + fact("Priority", fields.priority) +
      fact("Disposition", current.status) + fact("Current finding", item.finding.state) +
      fact("Original record", item.origin.recordKey || item.origin.sourceId) +
      fact("Captured material", item.origin.materialSha256) + fact("Current work head", item.headSha256) +
      "</dl><h4>Evidence</h4>" + (current.evidenceIds.length ? "<ul>" + current.evidenceIds.map(evidenceId =>
        "<li><a href=\"#evidence-" + h(evidenceId) + "\">" + h(data.evidence.find(value => value.id === evidenceId)?.name || evidenceId) + "</a></li>").join("") + "</ul>" : "<p>No evidence has been attached to this open item.</p>") +
      (current.submission ? jsonDetails("Complete submitted work", current.submission) : "") +
      (current.review ? jsonDetails("Operator review", current.review) : "") +
      jsonDetails("Original captured finding and native record", item.origin) +
      "<h4>Retained work history</h4>" + table(["recorded", "author", "action", "status", "note"], history) +
      jsonDetails("Complete history, including recipient branches", item.history) + "</article>";
  }).join("");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + h(title) +
    "</title><style>body{font:14px system-ui,sans-serif;color:#202124;background:#fff;margin:32px;line-height:1.5}main{max-width:1200px;margin:auto}h1{font-size:26px}h2{font-size:21px;margin-top:32px}h3{font-size:18px}h4{font-size:15px}article{border-top:1px solid #bbb;padding:16px 0;margin-top:18px}a{color:#202124;text-underline-offset:3px}dl{display:grid;grid-template-columns:minmax(110px,180px) minmax(0,1fr);gap:6px 14px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:7px;text-align:left;vertical-align:top}th{background:#eee}td,code,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f5f5f5;padding:12px;font-size:12px}.description{white-space:pre-wrap}details{margin:12px 0}summary{cursor:pointer}@media(max-width:600px){body{margin:14px}dl{grid-template-columns:1fr}dt{margin-top:7px}}@media print{body{margin:10mm}thead{display:table-header-group}tr{break-inside:avoid}.table-wrap{overflow:visible}a{color:#000}details{display:block}}</style></head><body><main><h1>" + h(title) +
    "</h1><p>Workspace " + h(data.workspace.id) + ", revision " + data.workspace.revision + ". Every work item retains its original source, assignment, evidence and review history.</p>" +
    "<p>" + data.counts.total + " items · " + data.counts.open + " open · " + data.counts["in-progress"] + " in progress · " +
    data.counts.submitted + " awaiting review · " + data.counts.verified + " verified · " + data.counts.exception + " accepted exceptions.</p>" +
    "<h2>Work register</h2>" + table(["title", "assignee", "due_date", "priority", "status", "current_finding"], register) +
    "<h2>Complete work items</h2>" + details + "<h2>Retained evidence files and observations</h2>" + evidence +
    "<h2>Original return decisions</h2>" + jsonDetails("Complete operator decisions", data.returns) +
    "<h2>Source records</h2>" + table(["name", "id", "bytes", "rows", "sourceUrl"], data.sources) +
    "<p>Current material SHA-256: <code>" + h(data.currentMaterialSha256) + "</code>.</p></main></body></html>";
}
export function makeWorkReport(state, { format = "json" } = {}) {
  need(["json", "csv", "html"].includes(format), "Choose JSON, CSV or HTML for the complete work register.");
  const data = workReportData(state);
  const body = format === "json" ? stringifyJson(data, 2) + "\n" : format === "csv" ? csv(COLUMNS, rows(data)) : workReportHtml(data);
  return { bytes: Buffer.from(body), name: "haystack-corrective-work-r" + state.revision + "." + format,
    mediaType: format === "json" ? "application/json" : format === "csv" ? "text/csv; charset=utf-8" : "text/html; charset=utf-8" };
}
