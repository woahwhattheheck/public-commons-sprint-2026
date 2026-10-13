// MIT. Complete comparison reports preserve original evaluations and decisions.
import { clone, csv } from "./model.mjs";
import { QualityError, qualityState } from "./quality.mjs";
import { qualityFollowupState } from "./quality-followup.mjs";
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const show = value => value === undefined || value === null ? "Not reported" : typeof value === "object" ? JSON.stringify(value) : String(value);
const labels = { matched: "Compared findings", "before-only": "Observed only before", "after-only": "Observed only after", ambiguous: "Correspondence needs review" };
const details = (label, value) => "<details><summary>" + escape(label) + "</summary><pre>" + escape(JSON.stringify(value, null, 2)) + "</pre></details>";
const finding = value => "<strong>" + escape(value.title) + "</strong><br>" + escape(value.namespace + " / " + value.name) +
  "<br>" + escape(value.status + " · " + value.severity) + "<br>Actual: " + escape(show(value.actual)) +
  "<br>Expected: " + escape(show(value.expected)) + details("Complete original finding", value);
export function qualityFollowupReport(state, comparison, format = "json") {
  const evaluations = qualityState(state).evaluations.filter(row => [comparison.before.id, comparison.after.id].includes(row.id));
  const followups = qualityFollowupState(state).followups.filter(row => row.comparisonId === comparison.id);
  const ids = new Set(followups.flatMap(row => [...row.evidenceResultIds, ...row.history.flatMap(item => item.evidenceResultIds)]));
  const data = { schema: "commons.openlineage.quality-followup.report.v1", workspaceId: state.workspaceId, revision: state.revision,
    comparison: clone(comparison), evaluations: clone(evaluations), followups: clone(followups),
    dispositions: clone(qualityState(state).dispositions.filter(row => [comparison.before.id, comparison.after.id].includes(row.evaluationId))),
    evidence: clone(state.results.filter(row => ids.has(row.id))) };
  if (format === "json") return { mediaType: "application/json; charset=utf-8", text: JSON.stringify(data, null, 2) + "\n" };
  if (format === "csv") {
    const columns = ["Comparison ID", "Comparison SHA-256", "Earlier evaluation", "Later evaluation", "Row ID", "Correspondence",
      "Matching method", "Earlier complete findings", "Later complete findings", "Changed fields", "Definition changed",
      "Earlier original rule", "Later original rule", "Complete follow-up and history", "Original source changes"];
    const rows = comparison.rows.map(row => Object.fromEntries(columns.map((column, index) => [column, [
      comparison.id, comparison.contentSha256, comparison.before.id, comparison.after.id, row.id, labels[row.kind], row.method,
      JSON.stringify(row.before), JSON.stringify(row.after), JSON.stringify(row.changes), row.definitionChanged,
      JSON.stringify(row.beforeRule), JSON.stringify(row.afterRule), JSON.stringify(followups.filter(item => item.rowId === row.id)),
      JSON.stringify(comparison.selectionChanges)
    ][index]])));
    return { mediaType: "text/csv; charset=utf-8", text: csv(rows, columns) };
  }
  if (format !== "html") throw new QualityError("Choose json, csv or html");
  const rows = comparison.rows.map(row => "<tr><td>" + escape(labels[row.kind]) + "<br>" +
    escape(row.method ?? "") + "</td><td>" + row.before.map(finding).join("<hr>") + "</td><td>" +
    row.after.map(finding).join("<hr>") + "</td><td>" + escape(row.changes.join(", ") || "No matched-field changes") +
    (row.definitionChanged ? "<p>The check definition changed.</p>" : "") + details("Full correspondence", row) + "</td><td>" +
    followups.filter(item => item.rowId === row.id).map(item => "<strong>" + escape(item.decision) + "</strong><p>" +
      escape(item.reason) + "</p><p>Owner: " + escape(item.owner || "Unassigned") + "<br>Due: " +
      escape(item.dueDate ?? "No date") + "</p>" + details("Complete follow-up history and evidence", item)).join("") + "</td></tr>").join("");
  const content = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>" + escape(comparison.title) + "</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#181818;background:white}" +
    "table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:.6rem;text-align:left;vertical-align:top}" +
    "th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}td{min-width:10rem;overflow-wrap:anywhere}" +
    ".scroll{max-width:100%;overflow:auto}h1{font-size:24px}@media(max-width:600px){body{margin:1rem}}@media print{body{margin:.3in}thead{display:table-header-group}tr{break-inside:avoid}details{display:block}}</style>" +
    "<h1>" + escape(comparison.title) + "</h1><p>" + escape(comparison.before.title) + " → " + escape(comparison.after.title) +
    "</p><p>Comparison saved at revision " + comparison.revision + "; report reads follow-up history at revision " + state.revision +
    ".</p><p>Original producer outcomes and rule definitions remain independent from operator follow-up. A finding absent from one selection is recorded as observed only before or after.</p>" +
    details("Original source selections and changes", { before: comparison.before, after: comparison.after, changes: comparison.selectionChanges }) +
    "<div class=\"scroll\"><table><thead><tr><th>Correspondence</th><th>Earlier finding</th><th>Later finding</th><th>Changes</th><th>Follow-up</th></tr></thead><tbody>" +
    rows + "</tbody></table></div><h2>Complete retained records</h2>" + details("Both original evaluations", data.evaluations) +
    details("Original dispositions and history", data.dispositions) + details("Supporting complete result files", data.evidence) +
    "<p>Use the complete editable workspace export to transfer source and result bytes with the application.</p></html>\n";
  return { mediaType: "text/html; charset=utf-8", text: content };
}
