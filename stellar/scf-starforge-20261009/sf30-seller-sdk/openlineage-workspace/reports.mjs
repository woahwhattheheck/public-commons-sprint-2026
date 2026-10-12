// MIT. Complete report views over the same original project projection.
import { project, csv, canonical } from "./model.mjs";

export function projectReport(state, { edition = null } = {}) {
  const selected = edition ? state.editions.find(item => item.id === edition) : null;
  if (edition && !selected) throw new Error("Unknown saved edition");
  const eventIds = selected ? new Set(selected.eventIds) : null;
  const sourceIds = selected ? new Set(selected.sourceIds) : null;
  const projection = project(state, { edition });
  return { schema: "commons.openlineage.report.v1",
    workspace: { id: state.workspaceId, title: state.title, revision: state.revision,
      edition, sourceRevision: selected?.sourceRevision ?? state.revision,
      createdAt: state.createdAt, updatedAt: state.updatedAt },
    ...projection,
    sources: state.sources.filter(item => !sourceIds || sourceIds.has(item.id)),
    editions: selected ? [selected] : state.editions,
    reviews: state.reviews.filter(item => !edition || item.editionId === edition),
    results: state.results.filter(item => !edition || item.editionId === edition),
    events: state.events.filter(item => !eventIds || eventIds.has(item.id)) };
}
function rows(report) {
  const records = [];
  for (const [kind, items] of Object.entries({ job: report.jobs, dataset: report.datasets,
    run: report.runs, edge: report.edges, source: report.sources, edition: report.editions,
    review: report.reviews, result: report.results, event: report.events, diagnostic: report.diagnostics }))
    for (const item of items ?? []) records.push({ kind, id: item.key ?? item.id ?? item.eventId ?? "",
      namespace: item.namespace ?? "", name: item.name ?? item.title ?? "",
      state: item.state ?? item.decision ?? "", record: item });
  return records;
}
export function reportCsv(state, options) {
  return csv(rows(projectReport(state, options)), ["kind", "id", "namespace", "name", "state", "record"]);
}
export function reportHtml(state, options) {
  const report = projectReport(state, options);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const field = value => escape(typeof value === "object" && value !== null ? canonical(value) : value);
  const table = (items, columns) => items.length ?
    "<table><thead><tr>" + columns.map(x => "<th>" + escape(x) + "</th>").join("") +
    "</tr></thead><tbody>" + items.map(item => "<tr>" + columns.map(x =>
      "<td>" + field(item[x]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>" :
    "<p class='muted'>None in this selection.</p>";
  const section = (title, items, columns) => "<section><h2>" + escape(title) + " (" + items.length + ")</h2>" + table(items, columns) + "</section>";
  return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\">" +
    "<title>" + escape(state.title) + " — OpenLineage report</title>" +
    "<style>body{font:13px/1.5 system-ui,sans-serif;margin:32px;color:#232323;background:white}h1{font-size:25px;margin-bottom:8px}h2{font-size:18px;margin-top:32px}.muted{color:#616161}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;vertical-align:top;border:1px solid #c9c9c9;padding:8px;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,monospace}details{margin:8px 0;border:1px solid #d0d0d0;padding:8px}summary{font-weight:600}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0}thead{display:table-header-group}h2{break-after:avoid}details>pre{display:block}}</style></head><body>" +
    "<h1>" + escape(state.title) + "</h1><p class='muted'>Workspace " + escape(state.workspaceId) +
    " · current revision " + state.revision + " · selected edition " + escape(options?.edition ?? "current") +
    "</p><p>" + report.eventCount + " retained event observations; " + report.projectedCount +
    " events in the operational projection. The editable workspace package carries the complete original source and result files.</p>" +
    section("Runs", report.runs, ["namespace", "name", "runId", "state", "startedAt", "endedAt", "durationMs", "issues"]) +
    section("Jobs", report.jobs, ["namespace", "name", "declaredFacets", "inputs", "outputs"]) +
    section("Datasets", report.datasets, ["namespace", "name", "facets"]) +
    section("Current relationships", report.edges, ["from", "to", "kind", "eventId"]) +
    section("Original source files", report.sources, ["name", "id", "bytes", "sourceUrl", "eventIds"]) +
    section("Saved editions", report.editions, ["title", "id", "description", "sourceRevision", "createdAt", "eventIds"]) +
    section("Operator reviews", report.reviews, ["title", "decision", "reason", "entityKeys", "editionId", "history"]) +
    section("Attached original results", report.results, ["name", "objectId", "bytes", "mediaType", "sourceReference", "entityKeys", "editionId", "query"]) +
    section("Intake diagnostics", report.diagnostics, ["eventId", "messages"]) +
    "<section><h2>Complete event records (" + report.events.length + ")</h2>" +
    report.events.map(event => "<details open><summary>" + escape(event.id) + "</summary><pre>" +
      escape(JSON.stringify(event, null, 2)) + "</pre></details>").join("") + "</section></body></html>";
}
