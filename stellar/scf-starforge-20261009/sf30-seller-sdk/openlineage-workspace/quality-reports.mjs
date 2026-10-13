import { clone, csv } from "./model.mjs";
import { QualityError } from "./quality.mjs";
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const printable = value => value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
function reportData(evaluation, dispositions) {
  return { schema: "commons.openlineage.quality.report.v1", evaluation: clone(evaluation),
    dispositions: clone(dispositions.filter(row => row.evaluationId === evaluation.id)) };
}
export function qualityReport(evaluation, dispositions = [], format = "json") {
  const data = reportData(evaluation, dispositions);
  if (format === "json") return { mediaType: "application/json; charset=utf-8", text: JSON.stringify(data, null, 2) + "\n" };
  const rows = evaluation.findings.map(finding => {
    const disposition = data.dispositions.find(row => row.findingId === finding.id);
    return [evaluation.id ?? "preview", evaluation.title ?? "Current quality preview", evaluation.workspaceId, evaluation.revision,
      evaluation.edition ?? "", finding.id, finding.status, finding.severity, finding.title, finding.namespace, finding.name,
      finding.datasetKey, finding.runKey, finding.eventId, finding.eventTime, finding.facetPath, finding.scope,
      finding.ruleId, finding.ruleVersion, printable(finding.expected), printable(finding.actual), finding.message,
      printable(finding.sources), finding.schemaURL, disposition?.decision ?? "open", disposition?.reason ?? "",
      evaluation.selectionSha256, evaluation.ruleSetSha256];
  });
  const header = ["Evaluation ID", "Evaluation title", "Workspace ID", "Reviewed revision", "Edition", "Finding ID", "Status",
    "Severity", "Finding", "Dataset namespace", "Dataset", "Dataset key", "Run key", "Original event", "Event time", "Facet path",
    "Facet scope", "Rule ID", "Rule version", "Expected", "Actual", "Explanation", "Original source locations", "Original schema URL",
    "Disposition", "Disposition reason", "Selection SHA-256", "Rules SHA-256"];
  if (format === "csv") return { mediaType: "text/csv; charset=utf-8", text: csv(rows.map(row => Object.fromEntries(header.map((key, index) => [key, row[index]]))), header) };
  if (format !== "html") throw new QualityError("Use json, csv or html for the quality report");
  const cells = evaluation.findings.map(finding => {
    const disposition = data.dispositions.find(row => row.findingId === finding.id);
    return "<tr><td>" + escape(finding.status) + "<br>" + escape(finding.severity) + "</td><td><strong>" + escape(finding.title) +
      "</strong><br>" + escape(finding.namespace + " / " + finding.name) + "</td><td>" + escape(printable(finding.expected)) +
      "</td><td>" + escape(printable(finding.actual)) + "</td><td>" + escape(finding.message) + "<br><code>" +
      escape(finding.eventId) + "</code><br>" + escape(finding.facetPath) + "<br><code>" + escape(printable(finding.sources)) +
      "</code></td><td>" + escape(disposition?.decision ?? "open") + "<br>" + escape(disposition?.reason ?? "") + "</td></tr>";
  }).join("");
  const title = evaluation.title ?? "Current quality preview";
  const text = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" + escape(title) + "</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#181818;background:#fff}" +
    "h1{font-size:24px}p{max-width:90ch}table{border-collapse:collapse;width:100%;margin-top:1.5rem}th,td{border:1px solid #bbb;padding:.6rem;text-align:left;vertical-align:top}" +
    ".quality-report-table{max-width:100%;overflow-x:auto}th{background:#eee}code{font:11px monospace;overflow-wrap:anywhere}td{overflow-wrap:anywhere}@media(max-width:600px){body{margin:1rem}}@media print{body{margin:.4in}thead{display:table-header-group}tr{break-inside:avoid}}</style>" +
    "<h1>" + escape(title) + "</h1><p>Workspace <code>" + escape(evaluation.workspaceId) + "</code> · Reviewed revision " +
    escape(evaluation.revision) + " · " + escape(evaluation.createdAt) + "</p><p>" + escape(evaluation.summary.pass) + " pass · " +
    escape(evaluation.summary.fail) + " fail · " + escape(evaluation.summary.unknown) + " unknown · " + escape(evaluation.summary.total) +
    " findings</p><p>Reported assertion results retain their original success values. Dispositions record operator follow-through for this saved evaluation; they preserve the original finding.</p>" +
    '<div class="quality-report-table"><table><thead><tr><th>Status</th><th>Finding</th><th>Expected</th><th>Actual</th><th>Original observation</th><th>Disposition</th></tr></thead><tbody>' +
    cells + "</tbody></table></div><p>Selection <code>" + escape(evaluation.selectionSha256) + "</code><br>Rules <code>" +
    escape(evaluation.ruleSetSha256) + "</code></p></html>\n";
  return { mediaType: "text/html; charset=utf-8", text };
}
