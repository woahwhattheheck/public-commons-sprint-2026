// MIT. Schema changes and declared field impact over original saved OpenLineage editions.
import { project, datasetKey, canonical, digest, clone, csv } from "./model.mjs";

export const SCHEMA_COMPARISON = "commons.openlineage.schema-comparison.v1";
export const SCHEMA_REVIEW = "commons.openlineage.schema-review.v1";
export const SCHEMA_DECISIONS = ["observed", "needs-work", "accepted", "resolved"];
export class SchemaError extends Error {
  constructor(message, details = undefined) { super(message); this.status = 400; this.details = details; }
}
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...values].sort(order);
const keyOf = path => JSON.stringify(path);
const same = (a, b) => canonical(a) === canonical(b);
const omit = (value, names) => Object.fromEntries(Object.entries(value).filter(([key]) => !names.includes(key)));
function require(value, message) { if (!value) throw new SchemaError(message); }
function editionSelection(state, id) {
  require(typeof id === "string" && id.length > 0, "Choose two named saved editions.");
  const edition = state.editions.find(value => value.id === id);
  require(edition, "The selected saved edition is absent: " + id);
  return { id: edition.id, title: edition.title, sourceRevision: edition.sourceRevision,
    createdAt: edition.createdAt, eventIds: [...edition.eventIds], sourceIds: [...edition.sourceIds] };
}
function sourceReferences(state, row, sourceIds) {
  return row.sources.filter(value => sourceIds.has(value.sourceId)).map(value => {
    const source = state.sources.find(item => item.id === value.sourceId);
    require(source, "A schema observation has lost its original source.");
    return { ...clone(value), name: source.name, bytes: source.bytes, sourceUrl: source.sourceUrl,
      ...(source.contentEncoding ? { contentEncoding: source.contentEncoding,
        decodedBytes: source.decodedBytes, decodedSha256: source.decodedSha256 } : {}) };
  });
}
function schemaObservation(state, dataset, selection) {
  if (!dataset) return null;
  const rows = new Map(state.events.map(row => [row.id, row])), sourceIds = new Set(selection.sourceIds);
  let selected = null;
  for (const id of dataset.eventIds) {
    const row = rows.get(id);
    require(row, "The schema's original event is absent.");
    const candidates = row.kind === "dataset" ? [[row.event.dataset, "/dataset/facets/schema"]] :
      ["inputs", "outputs"].flatMap(direction => (row.event[direction] ?? []).map((item, index) =>
        [item, "/" + direction + "/" + index + "/facets/schema"]));
    for (const [item, pointer] of candidates) {
      if (datasetKey(item) !== dataset.key || !own(item.facets ?? {}, "schema")) continue;
      selected = { eventId: row.id, eventTime: row.event.eventTime, sequence: row.sequence,
        jsonPointer: pointer, facet: clone(item.facets.schema),
        sources: sourceReferences(state, row, sourceIds) };
    }
  }
  return selected;
}
function inventory(state, dataset, selection) {
  const empty = (status, metadata, observation, diagnostics = []) =>
    ({ status, fields: [], invalidRecords: [], metadata, observation, diagnostics });
  if (!dataset) return empty("dataset-unobserved", null, null);
  const facet = dataset.facets.schema, observation = schemaObservation(state, dataset, selection);
  if (facet === undefined) return empty(observation?.facet?._deleted === true ? "facet-withdrawn" : "schema-unreported", null, observation);
  if (!object(facet) || !Array.isArray(facet.fields))
    return empty("fields-unreported", clone(facet ?? null), observation, ["The selected schema facet has no field array."]);
  const fields = [], invalidRecords = [], diagnostics = [];
  const queue = [{ fields: facet.fields, parent: [], indexes: [], pointer: "/fields", ambiguous: false }];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor], frequencies = new Map();
    for (const field of current.fields) if (object(field) && typeof field.name === "string")
      frequencies.set(field.name, (frequencies.get(field.name) ?? 0) + 1);
    for (const [position, field] of current.fields.entries()) {
      const pointer = current.pointer + "/" + position, indexPath = [...current.indexes, position];
      if (!object(field) || typeof field.name !== "string") {
        invalidRecords.push({ jsonPointer: pointer, indexPath, value: clone(field) });
        diagnostics.push(pointer + " requires a named field object."); continue;
      }
      const repeated = frequencies.get(field.name) > 1;
      if (repeated) diagnostics.push(pointer + " repeats a sibling field name: " + field.name);
      const path = [...current.parent, field.name], metadata = omit(field, ["name", "fields"]);
      const ambiguous = current.ambiguous || repeated;
      fields.push({ key: keyOf(path), recordKey: keyOf(indexPath), path, indexPath, name: field.name,
        position, metadata: clone(metadata), jsonPointer: pointer, nested: own(field, "fields"), ambiguous });
      if (own(field, "fields")) {
        if (!Array.isArray(field.fields)) {
          invalidRecords.push({ jsonPointer: pointer + "/fields", indexPath, value: clone(field.fields) });
          diagnostics.push(pointer + "/fields must be an array.");
        } else queue.push({ fields: field.fields, parent: path, indexes: indexPath, pointer: pointer + "/fields", ambiguous });
      }
    }
  }
  fields.sort((a, b) => {
    const named = order(a.key, b.key); if (named) return named;
    for (let index = 0; index < Math.min(a.indexPath.length, b.indexPath.length); index++)
      if (a.indexPath[index] !== b.indexPath[index]) return a.indexPath[index] - b.indexPath[index];
    return a.indexPath.length - b.indexPath.length;
  });
  return { status: diagnostics.length ? "ambiguous-fields" : "declared", fields, invalidRecords,
    metadata: clone(omit(facet, ["fields"])), observation, diagnostics };
}
function valueAt(field, property) {
  if (!field) return { present: false, value: null };
  if (property === "$position") return { present: true, value: field.position };
  if (property === "$nested") return { present: true, value: field.nested };
  return own(field.metadata, property) ? { present: true, value: clone(field.metadata[property]) } : { present: false, value: null };
}
function changesForDataset(key, before, after) {
  const changes = [];
  const add = (kind, path, property, previous, current) => {
    const body = { datasetKey: key, kind, fieldPath: path, fieldKey: path === null ? null : keyOf(path),
      property, before: previous, after: current };
    changes.push({ id: digest(body), ...body });
  };
  if (before.status !== after.status) add("schema-observation", null, "status",
    { present: true, value: before.status }, { present: true, value: after.status });
  if (!same(before.metadata, after.metadata)) add("schema-metadata", null, "facet",
    { present: before.metadata !== null, value: before.metadata }, { present: after.metadata !== null, value: after.metadata });
  if (!same(before.invalidRecords, after.invalidRecords)) add("schema-field-records", null, "invalid-fields",
    { present: before.invalidRecords.length > 0, value: before.invalidRecords },
    { present: after.invalidRecords.length > 0, value: after.invalidRecords });
  const group = fields => {
    const values = new Map();
    for (const field of fields) { if (!values.has(field.key)) values.set(field.key, []); values.get(field.key).push(field); }
    return values;
  };
  const left = group(before.fields), right = group(after.fields);
  const hasFields = value => ["declared", "ambiguous-fields"].includes(value.status);
  for (const fieldKey of sorted(new Set([...left.keys(), ...right.keys()]))) {
    const previousFields = left.get(fieldKey) ?? [], currentFields = right.get(fieldKey) ?? [];
    const a = previousFields[0], b = currentFields[0], path = (b ?? a).path;
    if (!hasFields(before) || !hasFields(after)) {
      if (!hasFields(before) && hasFields(after) && b) add("field-observed", path, "field-records",
        { present: false, value: null }, { present: true, value: currentFields });
      continue;
    }
    if (previousFields.length > 1 || currentFields.length > 1 || a?.ambiguous || b?.ambiguous) {
      if (!same(previousFields, currentFields)) add("field-ambiguity", path, "field-records",
        { present: previousFields.length > 0, value: previousFields }, { present: currentFields.length > 0, value: currentFields });
      continue;
    }
    if (!a || !b) {
      add(!a ? "field-added" : "field-removed", path, "field",
        { present: Boolean(a), value: a ?? null }, { present: Boolean(b), value: b ?? null });
      continue;
    }
    for (const property of sorted(new Set([...Object.keys(a.metadata), ...Object.keys(b.metadata), "$position", "$nested"]))) {
      const previous = valueAt(a, property), current = valueAt(b, property);
      if (same(previous, current)) continue;
      const kind = property === "type" ? "field-type" : property === "$position" ? "field-position" :
        property === "$nested" ? "field-structure" : "field-metadata";
      add(kind, path, property, previous, current);
    }
  }
  return changes.sort((a, b) => order(a.datasetKey, b.datasetKey) || order(a.fieldKey ?? "", b.fieldKey ?? "") ||
    order(a.kind, b.kind) || order(a.property, b.property));
}
function declaredEdges(view) {
  return view.edges.filter(edge => !edge.boundaryOnly && ["explicit-lineage", "column-lineage"].includes(edge.kind))
    .map(edge => ({ id: digest(edge), ...clone(edge) })).sort((a, b) => order(a.id, b.id));
}
export function compareSchemas(state, { from, to } = {}) {
  require(from !== to, "Choose two distinct saved editions.");
  const first = editionSelection(state, from), last = editionSelection(state, to);
  const left = project(state, { edition: from }), right = project(state, { edition: to });
  const a = new Map(left.datasets.map(item => [item.key, item])), b = new Map(right.datasets.map(item => [item.key, item]));
  const datasets = [];
  for (const key of sorted(new Set([...a.keys(), ...b.keys()]))) {
    const before = inventory(state, a.get(key), first), after = inventory(state, b.get(key), last);
    if (before.status === "schema-unreported" && after.status === "schema-unreported") continue;
    const changes = changesForDataset(key, before, after), identity = b.get(key) ?? a.get(key);
    datasets.push({ key, namespace: identity.namespace, name: identity.name, before, after, changes });
  }
  const core = { schema: SCHEMA_COMPARISON, workspaceId: state.workspaceId, from: first, to: last,
    datasets, declaredEdges: { before: declaredEdges(left), after: declaredEdges(right) } };
  return { id: digest(core), ...core, summary: { datasets: datasets.length,
    changedDatasets: datasets.filter(item => item.changes.length).length,
    changes: datasets.reduce((n, item) => n + item.changes.length, 0),
    ambiguousDatasets: datasets.filter(item => item.before.diagnostics.length || item.after.diagnostics.length).length } };
}
export function comparisonBody(comparison) {
  return { schema: comparison.schema, workspaceId: comparison.workspaceId, from: comparison.from, to: comparison.to,
    datasets: comparison.datasets, declaredEdges: comparison.declaredEdges };
}
export function comparisonChanges(comparison) {
  return comparison.datasets.flatMap(dataset => dataset.changes.map(change => ({
    ...clone(change), namespace: dataset.namespace, datasetName: dataset.name
  })));
}
function pathMatches(fields, field) {
  const exact = fields.filter(item => item.path.length === 1 && item.path[0] === field);
  const nested = fields.filter(item => item.path.length > 1 && item.path.join(".") === field);
  return [...exact, ...nested];
}
function traceSide(comparison, dataset, change, side) {
  const edges = comparison.declaredEdges[side], schemas = new Map(comparison.datasets.map(item => [item.key, item[side]]));
  const rootSchema = dataset[side], rootPaths = change.fieldPath === null ? rootSchema.fields.map(item => item.path) : [change.fieldPath];
  const roots = [], unresolved = [], dependencies = [], graph = new Map(), usedEdges = new Map(), nodes = new Map();
  const nodeKey = (entity, field) => JSON.stringify([entity, field]);
  const addNode = (entity, field, path, via = null) => {
    const key = nodeKey(entity, field);
    if (!nodes.has(key)) nodes.set(key, { id: key, entityKey: entity, field, depth: path.length,
      edgePath: [...path], via, source: entity === dataset.key && rootPaths.some(item => item.join(".") === field),
      schemaPresence: (() => {
        const schema = schemas.get(entity), matches = pathMatches(schema?.fields ?? [], field);
        return matches.length > 1 || matches.some(item => item.ambiguous) ? "ambiguous-schema-path" :
          matches.length ? "observed" : ["declared", "ambiguous-fields"].includes(schema?.status) ?
            "absent-from-declared-schema" : "schema-unreported";
      })() });
    return key;
  };
  for (const edge of edges) {
    if (typeof edge.fromField === "string" && typeof edge.toField === "string") {
      const key = nodeKey(edge.from, edge.fromField);
      if (!graph.has(key)) graph.set(key, []);
      graph.get(key).push(edge);
    }
  }
  for (const path of rootPaths) {
    const field = path.join("."), matching = pathMatches(rootSchema.fields, field);
    if (matching.length > 1 || matching.some(item => item.ambiguous))
      unresolved.push({ datasetKey: dataset.key, field, paths: matching.map(item => ({ path: item.path, jsonPointer: item.jsonPointer })),
        reason: "The declared lineage field has ambiguous schema records. Its declared relationships retain that ambiguity." });
    if (matching.length === 1 && !same(matching[0].path, path)) continue;
    if (!matching.length && ["declared", "ambiguous-fields"].includes(rootSchema.status))
      unresolved.push({ datasetKey: dataset.key, field, reason: "The declared field reference is absent from this edition's reported schema." });
    const root = addNode(dataset.key, field, []); if (!roots.includes(root)) roots.push(root);
  }
  const queue = [...roots], visited = new Set();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const key = queue[cursor];
    if (visited.has(key)) continue;
    visited.add(key);
    const current = nodes.get(key);
    for (const edge of graph.get(key) ?? []) {
      const sourceSchema = schemas.get(edge.from), targetSchema = schemas.get(edge.to);
      const fromMatches = pathMatches(sourceSchema?.fields ?? [], edge.fromField);
      const toMatches = pathMatches(targetSchema?.fields ?? [], edge.toField);
      if (fromMatches.length > 1 || toMatches.length > 1 || fromMatches.some(item => item.ambiguous) || toMatches.some(item => item.ambiguous)) {
        unresolved.push({ edgeId: edge.id, eventId: edge.eventId, facetPath: edge.facetPath,
          reason: "A declared field reference has ambiguous schema records; relationships retain their original producer field names.",
          fromPaths: fromMatches.map(item => ({ path: item.path, jsonPointer: item.jsonPointer })),
          toPaths: toMatches.map(item => ({ path: item.path, jsonPointer: item.jsonPointer })) });
      }
      usedEdges.set(edge.id, edge);
      const target = addNode(edge.to, edge.toField, [...current.edgePath, edge.id], edge.id);
      if (!visited.has(target)) queue.push(target);
    }
  }
  for (const edge of edges) {
    if (typeof edge.fromField === "string" && typeof edge.toField === "string") continue;
    const relevant = [...nodes.values()].some(node => edge.from === node.entityKey &&
      (edge.fromField === null || edge.fromField === undefined || edge.fromField === node.field)) ||
      change.fieldPath === null && edge.from === dataset.key;
    if (relevant) dependencies.push({ ...edge, interpretation: "Declared entity dependency; target-field propagation is unspecified." });
  }
  const impacts = [...nodes.values()].filter(item => !item.source);
  const runKeys = sorted(new Set([...usedEdges.values(), ...dependencies].flatMap(edge =>
    [edge.runKey, edge.scopeKey?.startsWith('["run",') ? edge.scopeKey : null]).filter(Boolean)));
  const relatedEntities = sorted(new Set([...impacts.map(item => item.entityKey), ...dependencies.map(item => item.to)]));
  return { editionId: side === "before" ? comparison.from.id : comparison.to.id, roots,
    nodes: [...nodes.values()].sort((a, b) => a.depth - b.depth || order(a.id, b.id)),
    edges: [...usedEdges.values()].sort((a, b) => order(a.id, b.id)), entityDependencies: dependencies,
    unresolved, datasetAndJobKeys: relatedEntities, runKeys, complete: true };
}
export function schemaImpact(comparison, { changeId } = {}) {
  const dataset = comparison.datasets.find(item => item.changes.some(change => change.id === changeId));
  require(dataset, "Choose an exact change from the selected schema comparison.");
  const change = dataset.changes.find(item => item.id === changeId);
  return { schema: "commons.openlineage.schema-impact.v1", comparisonId: comparison.id, change: clone(change),
    before: traceSide(comparison, dataset, change, "before"), after: traceSide(comparison, dataset, change, "after") };
}
export function reviewSummary(state, comparison) {
  const reviews = (state.schemaReviews ?? []).filter(item => item.comparisonId === comparison.id);
  const rows = comparisonChanges(comparison).map(change => {
    const matching = reviews.filter(review => review.changeIds.includes(change.id))
      .sort((a, b) => b.savedRevision - a.savedRevision || order(b.id, a.id));
    const effective = matching[0] ?? null;
    return { ...change, decision: effective?.decision ?? "unreviewed", owner: effective?.owner ?? "",
      reviewer: effective?.reviewer ?? "", reviewId: effective?.id ?? null, reviewIds: matching.map(item => item.id) };
  });
  return { comparisonId: comparison.id, reviews: clone(reviews), changes: rows,
    counts: Object.fromEntries(["unreviewed", ...SCHEMA_DECISIONS].map(value => [value, rows.filter(row => row.decision === value).length])) };
}
export function resolveEvidence(state, entries, { retained = false } = {}) {
  require(Array.isArray(entries), "Evidence must be a list of original source, event or result selections.");
  const seen = new Set();
  return entries.map(entry => {
    require(object(entry) && ["source", "event", "result"].includes(entry.kind) && typeof entry.id === "string",
      "Select an existing source, event or attached result.");
    const key = entry.kind + ":" + entry.id;
    require(!seen.has(key), "The same evidence was selected twice."); seen.add(key);
    const collection = entry.kind === "source" ? state.sources : entry.kind === "event" ? state.events : state.results;
    const record = collection.find(value => value.id === entry.id);
    require(record, "The selected evidence is absent: " + key);
    if (entry.kind === "source") return { kind: entry.kind, id: record.id, name: record.name,
      bytes: record.bytes, sourceUrl: record.sourceUrl, contentEncoding: record.contentEncoding ?? "identity" };
    if (entry.kind === "result") return { kind: entry.kind, id: record.id, name: record.name,
      objectId: record.objectId, bytes: record.bytes, editionId: record.editionId,
      entityKeys: clone(record.entityKeys), sourceReference: record.sourceReference };
    const sources = retained ? entry.sources : record.sources;
    require(Array.isArray(sources) && sources.length > 0 && new Set(sources.map(canonical)).size === sources.length &&
      sources.every(source => record.sources.some(actual => same(actual, source))),
      "The review's original event source positions are absent or changed.");
    return { kind: entry.kind, id: record.id, eventTime: record.event.eventTime,
      sources: clone(sources), producer: record.event.producer };
  });
}
export function validateSchemaCollections(state, { complete = false } = {}) {
  for (const name of ["schemaComparisons", "schemaReviews"])
    require(state[name] === undefined || Array.isArray(state[name]), "Invalid workspace " + name + ".");
  const comparisons = new Map();
  for (const comparison of state.schemaComparisons ?? []) {
    require(comparison?.schema === SCHEMA_COMPARISON && comparison.workspaceId === state.workspaceId &&
      typeof comparison.id === "string" && !comparisons.has(comparison.id), "Invalid or repeated schema comparison.");
    require(digest(comparisonBody(comparison)) === comparison.id, "The retained schema comparison changed.");
    if (complete) require(same(compareSchemas(state, { from: comparison.from.id, to: comparison.to.id }), comparison),
      "The schema comparison differs from its original saved sources.");
    comparisons.set(comparison.id, comparison);
  }
  const ids = new Set();
  for (const review of state.schemaReviews ?? []) {
    require(review?.schema === SCHEMA_REVIEW && typeof review.id === "string" && !ids.has(review.id),
      "Invalid or repeated schema review."); ids.add(review.id);
    const comparison = comparisons.get(review.comparisonId);
    require(comparison && Array.isArray(review.changeIds) && review.changeIds.length &&
      new Set(review.changeIds).size === review.changeIds.length, "Schema review requires its complete comparison and distinct changes.");
    const changes = new Set(comparisonChanges(comparison).map(item => item.id));
    require(review.changeIds.every(id => changes.has(id)), "The review selected a change absent from its original comparison.");
    require(Array.isArray(review.history), "Schema review history is required.");
    for (const version of [...review.history, review]) {
      require(version.id === review.id && version.comparisonId === review.comparisonId &&
        same(version.changeIds, review.changeIds) && SCHEMA_DECISIONS.includes(version.decision) &&
        Number.isSafeInteger(version.savedRevision) && version.savedRevision >= 1 &&
        version.savedRevision <= state.revision && typeof version.reason === "string" && version.reason.trim() &&
        typeof version.reviewer === "string" && version.reviewer.trim() &&
        typeof version.owner === "string" && typeof version.action === "string" &&
        typeof version.resolution === "string" && typeof version.createdAt === "string" &&
        typeof version.updatedAt === "string" && version.schema === SCHEMA_REVIEW &&
        version.workspaceId === state.workspaceId &&
        version.from === comparison.from.id && version.to === comparison.to.id &&
        (version.decision !== "needs-work" || version.owner.trim() && version.action.trim()) &&
        (version.decision !== "resolved" || version.resolution.trim()),
        "A schema review revision lost its original selection or staff decision.");
      require(Array.isArray(version.evidence), "The original review evidence is required.");
      if (complete) require(same(resolveEvidence(state, version.evidence, { retained: true }), version.evidence),
        "Schema review evidence differs from its retained original source.");
    }
    for (let i = 1; i < review.history.length; i++)
      require(review.history[i].savedRevision > review.history[i - 1].savedRevision, "Schema review history is out of order.");
    if (review.history.length) require(review.savedRevision > review.history.at(-1).savedRevision, "Schema review head precedes its history.");
  }
  return state;
}
export function schemaReport(state, { from, to } = {}) {
  const comparison = compareSchemas(state, { from, to }), review = reviewSummary(state, comparison);
  const impacted = comparisonChanges(comparison).map(change => schemaImpact(comparison, { changeId: change.id }));
  return { schema: "commons.openlineage.schema-report.v1", workspaceId: state.workspaceId,
    workspaceTitle: state.title, revision: state.revision, comparison, ...review, impact: impacted };
}
export function schemaReportCsv(value) {
  const rows = [];
  for (const change of value.changes) {
    const impact = value.impact.find(item => item.change.id === change.id);
    rows.push({ kind: "change", id: change.id, dataset: change.datasetKey, field: change.fieldPath,
      decision: change.decision, owner: change.owner, record: { change, impact } });
  }
  for (const review of value.reviews) rows.push({ kind: "review", id: review.id, dataset: "", field: "",
    decision: review.decision, owner: review.owner, record: review });
  return csv(rows, ["kind", "id", "dataset", "field", "decision", "owner", "record"]);
}
export function schemaReportHtml(value) {
  const escape = text => String(text ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const field = cell => escape(cell !== null && typeof cell === "object" ? canonical(cell) : cell);
  const table = (items, columns) => "<table><thead><tr>" + columns.map(column => "<th>" + escape(column) + "</th>").join("") +
    "</tr></thead><tbody>" + items.map(item => "<tr>" + columns.map(column => "<td>" + field(item[column]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
  return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>Schema change review</title>" +
    "<style>body{font:14px/1.5 system-ui;margin:32px;color:#222;background:#fff}h1{font-size:26px}h2{font-size:19px;margin-top:30px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #bbb;padding:8px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{font-weight:600}details{border:1px solid #bbb;padding:10px;margin:10px 0}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0}thead{display:table-header-group}}</style></head><body>" +
    "<h1>" + escape(value.workspaceTitle) + " · Schema change review</h1><p>" +
    escape(value.comparison.from.title) + " → " + escape(value.comparison.to.title) +
    "</p><p>Workspace " + escape(value.workspaceId) + " · revision " + value.revision +
    " · comparison " + escape(value.comparison.id) + "</p>" +
    "<h2>Staff decisions</h2>" + table(value.changes, ["datasetName", "fieldPath", "kind", "property", "before", "after", "decision", "owner"]) +
    "<h2>Review history</h2>" + table(value.reviews, ["reviewer", "decision", "reason", "owner", "action", "resolution", "evidence", "history"]) +
    "<h2>Declared downstream relationships</h2>" + value.impact.map(item => "<details open><summary>" +
      escape(item.change.datasetKey + " · " + (item.change.fieldPath?.join(" / ") ?? "Schema") + " · " + item.change.kind) +
      "</summary><pre>" + escape(JSON.stringify(item, null, 2)) + "</pre></details>").join("") +
    "<h2>Complete original comparison</h2><pre>" + escape(JSON.stringify(value.comparison, null, 2)) + "</pre></body></html>";
}
