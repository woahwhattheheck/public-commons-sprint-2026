import { stringifyJson } from "./json-codec.mjs";
import { analyzed, editionView } from "./model.mjs";
import { canonical, csv, digest, escapeHtml as h, need, clone } from "./util.mjs";
import { displayValue, encodeGrid } from "./haystack-types.mjs";

export function reportData(state, { editionId, role = "all" } = {}) {
  need(["all", "site", "equip", "point"].includes(role), "Choose a declared register role.");
  const view = editionId ? editionView(state, editionId) : analyzed(state);
  const records = view.records.filter(row => role === "all" || row.roles.includes(role));
  const keys = new Set(records.map(row => row.key));
  return {
    format: "commons.haystack.turnover-register.v1",
    workspace: { id: state.workspaceId, title: state.title, revision: state.revision, stateSha256: state.sha256 },
    edition: view.edition || null, materialSha256: view.contentSha256, role,
    sources: view.sources, counts: view.counts, records,
    relations: view.relations.filter(item => keys.has(item.fromKey) || (item.targetKeys || []).some(key => keys.has(key))),
    diagnostics: view.diagnostics
  };
}
export function registerRows(data) {
  const sources = new Map(data.sources.map(source => [source.id, source]));
  const relations = new Map(), diagnostics = new Map();
  for (const item of data.relations) { const list = relations.get(item.fromKey) || []; list.push(item); relations.set(item.fromKey, list); }
  for (const item of data.diagnostics) if (item.recordKey) { const ids = diagnostics.get(item.recordKey) || new Set(); ids.add(item.id || digest(item)); diagnostics.set(item.recordKey, ids); }
  return data.records.map(record => {
    const source = sources.get(record.sourceId), links = relations.get(record.key) || [];
    const rowsFor = tag => links.filter(item => item.tag === tag).flatMap(item => item.targetKeys || []);
    return {
      record_key: record.key, source_id: record.sourceId, source_name: source?.name || "",
      source_url: source?.sourceUrl || "", source_row_index: record.rowIndex ?? Number(record.key.split(":")[1]),
      ref_id: record.id || "", display: record.display, roles: record.roles.join("; "),
      site_ref: record.siteRef || "", site_record_keys: rowsFor("siteRef").join("; "),
      equip_ref: record.equipRef || "", equip_record_keys: rowsFor("equipRef").join("; "),
      kind: record.kind || "", unit: record.unit || "", diagnostic_count: new Set([...(diagnostics.get(record.key) || []), ...(record.diagnosticIds || [])]).size,
      tags_json: canonical(record.tags), relations_json: canonical(links)
    };
  });
}
export const REGISTER_COLUMNS = ["record_key", "source_id", "source_name", "source_url", "source_row_index", "ref_id", "display", "roles", "site_ref", "site_record_keys", "equip_ref", "equip_record_keys", "kind", "unit", "diagnostic_count", "tags_json", "relations_json"];
export const DIAGNOSTIC_COLUMNS = ["id", "severity", "code", "source_id", "record_key", "tag", "message", "details_json"];
export function diagnosticRows(data) {
  return data.diagnostics.map(item => ({ id: item.id || digest(item), severity: item.severity, code: item.code,
    source_id: item.sourceId || (item.recordKey ? item.recordKey.split(":")[0] : ""), record_key: item.recordKey || "",
    tag: item.tag || "", message: item.message, details_json: canonical(item.details ?? null) }));
}
function table(columns, rows) {
  return "<table><thead><tr>" + columns.map(column => "<th scope=\"col\">" + h(column.replaceAll("_", " ")) + "</th>").join("") +
    "</tr></thead><tbody>" + rows.map(row => "<tr>" + columns.map(column => "<td>" + h(row[column]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
}
export function reportHtml(data, { diagnostics = false } = {}) {
  const sourceRows = data.sources.map(source => ({ name: source.name, original_sha256: source.id, bytes: source.bytes, rows: source.rows, source_url: source.sourceUrl }));
  const rows = diagnostics ? diagnosticRows(data) : registerRows(data);
  const title = data.workspace.title + (diagnostics ? " — diagnostics" : " — " + data.role + " register");
  return "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + h(title) +
    "</title><style>body{font:14px system-ui,sans-serif;color:#202124;background:#fff;margin:32px;line-height:1.5}h1{font-size:25px}h2{font-size:18px;margin-top:30px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}code{overflow-wrap:anywhere}p{max-width:90ch}@media print{body{margin:10mm}thead{display:table-header-group}tr{break-inside:avoid}}</style><h1>" + h(title) +
    "</h1><p>Workspace <code>" + h(data.workspace.id) + "</code>, revision " + data.workspace.revision + ". " +
    (data.edition ? "Saved edition: " + h(data.edition.title) + " (<code>" + h(data.edition.id) + "</code>)." : "Current explicitly selected source view.") +
    "</p><p>Material SHA-256: <code>" + h(data.materialSha256) + "</code>. The register retains each original row identity and its full typed tags. References resolve within their original source.</p><h2>Original sources</h2>" +
    table(["name", "original_sha256", "bytes", "rows", "source_url"], sourceRows) +
    "<h2>" + (diagnostics ? "Complete diagnostics" : "Complete register") + " (" + rows.length + ")</h2>" +
    table(diagnostics ? DIAGNOSTIC_COLUMNS : REGISTER_COLUMNS, rows) +
    (diagnostics ? "" : "<h2>Complete diagnostics (" + data.diagnostics.length + ")</h2>" + table(DIAGNOSTIC_COLUMNS, diagnosticRows(data))) +
    "</html>";
}
export function makeReport(state, args) {
  const data = reportData(state, args), format = args.format || "json", diagnostics = args.kind === "diagnostics";
  need(["json", "csv", "html"].includes(format), "Choose JSON, CSV or HTML.");
  const body = format === "json" ? stringifyJson(diagnostics ? { ...data, records: undefined, relations: undefined } : data, 2) + "\n" :
    format === "csv" ? csv(diagnostics ? DIAGNOSTIC_COLUMNS : REGISTER_COLUMNS, diagnostics ? diagnosticRows(data) : registerRows(data)) :
    reportHtml(data, { diagnostics });
  return { bytes: Buffer.from(body), mediaType: format === "json" ? "application/json" : format === "csv" ? "text/csv; charset=utf-8" : "text/html; charset=utf-8",
    name: "haystack-" + (diagnostics ? "diagnostics" : (args.role || "all") + "-register") + "-r" + state.revision + "." + format };
}
export function nativeGrid(state, { sourceId, editionId }) {
  const view = editionId ? editionView(state, editionId) : analyzed(state), item = view.grids.find(grid => grid.sourceId === sourceId);
  need(item, "Choose a source in the selected current or saved edition.", "HAYSTACK_SOURCE_MISSING", 404);
  return { bytes: Buffer.from(encodeGrid(item.grid, { format: "json-v4" })), mediaType: "application/json",
    name: "haystack-" + sourceId.slice(0, 12) + "-r" + state.revision + ".json" };
}
