// MIT. Original OpenLineage observations and operator-authored quality rules.
import { clone, digest, canonical, datasetKey, jobKey, runKey, project } from "./model.mjs";

export const QUALITY_FORMAT = "commons.openlineage.quality.v1";
export const QUALITY_UPSTREAM = "8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe";
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const present = x => typeof x === "string" && x.length > 0;
const finite = x => typeof x === "number" && Number.isFinite(x);
const encode = s => String(s).replaceAll("~", "~0").replaceAll("/", "~1");
const hash = /^[a-f0-9]{64}$/;
const scopes = new Set(["any", "dataset", "input", "output"]);
const severities = new Set(["error", "warning", "info"]);
const operators = new Set(["eq", "ne", "lt", "lte", "gt", "gte", "between"]);
const facetNames = new Set(["dataQualityMetrics", "dataQualityAssertions", "outputStatistics"]);
const columnNames = new Set(["nullCount", "distinctCount", "sum", "count", "min", "max"]);

export class QualityError extends Error {
  constructor(message, status = 400, details) { super(message); this.status = status; this.details = details; }
}
function requireText(value, name) {
  if (!present(value) || !value.trim()) throw new QualityError(name + " is required");
  return value;
}
function named(value) { return object(value) && typeof value.namespace === "string" && typeof value.name === "string"; }
function validKey(value) {
  if (typeof value !== "string") return false;
  try { const p = JSON.parse(value); return Array.isArray(p) && p.length === 3 && p[0] === "dataset" && p.slice(1).every(x => typeof x === "string") && JSON.stringify(p) === value; }
  catch { return false; }
}
function uri(value) { try { return present(value) && Boolean(new URL(value).protocol); } catch { return false; } }
function selectedRows(state, options = {}, frozen = null) {
  const edition = options.edition ?? null;
  if (edition !== null && !present(edition)) throw new QualityError("edition must identify a saved edition");
  if (options.datasetKey != null && !validKey(options.datasetKey)) throw new QualityError("Use the original dataset key");
  if (options.runKey != null && !present(options.runKey)) throw new QualityError("Use the original run key");
  let allowed = null, sourceIds;
  if (frozen) {
    const sourceSet = new Set(frozen.sourceIds);
    const fromSources = state.events.filter(row => row.sources.some(source => sourceSet.has(source.sourceId))).map(row => row.id);
    if (canonical(fromSources) !== canonical(frozen.eventIds))
      throw new QualityError("Frozen quality selection differs from its complete original sources", 409);
    if (edition !== null) {
      const saved = state.editions.find(row => row.id === edition);
      if (!saved || canonical(saved.eventIds) !== canonical(frozen.eventIds) || canonical(saved.sourceIds) !== canonical(frozen.sourceIds))
        throw new QualityError("Frozen quality selection differs from its original saved edition", 409);
    }
    allowed = new Set(frozen.eventIds);
    sourceIds = frozen.sourceIds;
  } else if (edition !== null) {
    const found = state.editions.find(row => row.id === edition);
    if (!found) throw new QualityError("Unknown saved edition", 404);
    allowed = new Set(found.eventIds); sourceIds = found.sourceIds;
  } else sourceIds = state.sources.map(row => row.id);
  const sources = new Set(sourceIds);
  return { edition, sourceIds: [...sourceIds], rows: state.events.filter(row => !allowed || allowed.has(row.id)).map(row => ({
    ...row, sources: row.sources.filter(source => sources.has(source.sourceId))
  })) };
}
function compareTime(a, b) {
  const at = Date.parse(a.eventTime), bt = Date.parse(b.eventTime);
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
  const af = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/i.exec(a.eventTime ?? "")?.[1] ?? "";
  const bf = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/i.exec(b.eventTime ?? "")?.[1] ?? "";
  const width = Math.max(af.length, bf.length), ap = af.padEnd(width, "0"), bp = bf.padEnd(width, "0");
  return (ap < bp ? -1 : ap > bp ? 1 : 0) || a.sequence - b.sequence || (a.occurrence ?? 0) - (b.occurrence ?? 0) || a.path.localeCompare(b.path);
}
function schemaAdapter(facet, name) {
  const result = { recognized: false, adapter: null, expectedScope: null, allowedScopes: [],
    metricFields: [], requiredFields: [], timestampField: false, assertionFields: ["column"], diagnostics: [] };
  if (!object(facet)) { result.diagnostics.push("Facet must be an object"); return result; }
  if (!uri(facet._producer)) result.diagnostics.push("_producer must be a URI");
  try {
    const url = new URL(facet._schemaURL);
    if (url.origin !== "https://openlineage.io" || url.search) throw new Error();
    const definitions = {
      dataQualityMetrics: ["DataQualityMetricsDatasetFacet", "DataQualityMetricsInputDatasetFacet"],
      dataQualityAssertions: ["DataQualityAssertionsDatasetFacet"],
      outputStatistics: ["OutputStatisticsOutputDatasetFacet"]
    };
    let definition, version, legacy = false;
    const standalone = /^\/spec\/facets\/(\d+-\d+-\d+)\/([A-Za-z]+)\.json$/.exec(url.pathname);
    const fragment = decodeURIComponent(url.hash.slice(1));
    if (standalone && definitions[name].includes(standalone[2])) {
      version = standalone[1]; definition = standalone[2];
      const versions = {
        DataQualityMetricsDatasetFacet: ["1-0-0"], DataQualityMetricsInputDatasetFacet: ["1-0-3"],
        DataQualityAssertionsDatasetFacet: ["1-0-0", "1-1-0"], OutputStatisticsOutputDatasetFacet: ["1-0-2"]
      };
      if (!versions[definition].includes(version) || (fragment && fragment !== "/$defs/" + definition)) throw new Error();
    } else if (url.pathname === "/spec/1-0-1/OpenLineage.json") {
      if (!fragment.startsWith("/definitions/")) throw new Error();
      definition = fragment.slice("/definitions/".length);
      if (!definitions[name].includes(definition) || definition === "DataQualityMetricsDatasetFacet") throw new Error();
      version = "1-0-1"; legacy = true;
    } else throw new Error();
    result.recognized = true;
    result.adapter = (legacy ? "core-" : "facet-") + version + "/" + definition;
    result.expectedScope = definition === "DataQualityMetricsDatasetFacet" ? "dataset" :
      definition === "OutputStatisticsOutputDatasetFacet" ? "output" : "input";
    result.allowedScopes = legacy && name === "dataQualityAssertions" ? ["dataset", "input"] : [result.expectedScope];
    result.timestampField = !legacy && name === "dataQualityMetrics";
    result.metricFields = name === "outputStatistics" ? legacy ? ["rowCount", "size"] : ["rowCount", "size", "fileCount"] :
      legacy ? ["rowCount", "bytes"] : ["rowCount", "bytes", "fileCount"];
    result.requiredFields = name === "dataQualityMetrics" ? ["columnMetrics"] : name === "outputStatistics" && legacy ? ["rowCount"] : [];
    if (!legacy && version === "1-1-0" && name === "dataQualityAssertions")
      result.assertionFields = ["column", "severity", "name", "description", "expected", "actual", "content", "contentType", "params"];
  } catch { result.diagnostics.push("Unrecognized quality schema URL; original facet is retained"); }
  return result;
}
function metricPathInfo(path, facetName, adapter = null) {
  let parts;
  try {
    if (!present(path) || path[0] !== "/" || /~(?![01])/u.test(path)) return null;
    parts = path.slice(1).split("/").map(x => x.replaceAll("~1", "/").replaceAll("~0", "~"));
  } catch { return null; }
  if (parts.length === 1) {
    const names = adapter ? adapter.metricFields : facetName === "outputStatistics" ? ["rowCount", "size", "fileCount"] : ["rowCount", "bytes", "fileCount"];
    if (names.includes(parts[0])) return { integer: true };
  }
  if (facetName !== "outputStatistics" && parts[0] === "columnMetrics" && parts.length === 3 && columnNames.has(parts[2]))
    return { integer: ["nullCount", "distinctCount"].includes(parts[2]) };
  if (facetName !== "outputStatistics" && parts[0] === "columnMetrics" && parts.length === 4 && parts[2] === "quantiles")
    return { integer: false };
  return null;
}
function metricRows(facet, name, diagnostics, adapter) {
  const rows = [];
  const add = (path, value) => {
    const spec = metricPathInfo(path, name, adapter);
    const valid = Boolean(spec && finite(value) && (!spec.integer || Number.isSafeInteger(value)));
    rows.push({ path, value: clone(value), valid,
      ...(valid ? {} : { reason: !spec ? "Field is outside the pinned metric contract" : !finite(value) ? "Metric is not a finite number" : "Integer metric is outside exact integer representation" }) });
    if (spec && !valid) diagnostics.push(path + " is not a usable " + (spec.integer ? "exact integer" : "finite numeric") + " observation");
  };
  for (const [key, value] of Object.entries(facet)) {
    if (key.startsWith("_") || key === "lastUpdated" || key === "columnMetrics") continue;
    add("/" + encode(key), value);
  }
  if (name === "dataQualityMetrics") {
    if (!object(facet.columnMetrics) && (own(facet, "columnMetrics") || adapter.requiredFields.includes("columnMetrics"))) diagnostics.push("columnMetrics is required to be an object by the selected metrics schema; original reported fields remain available");
    else if (object(facet.columnMetrics)) for (const [column, value] of Object.entries(facet.columnMetrics)) {
      const prefix = "/columnMetrics/" + encode(column);
      if (!object(value)) { diagnostics.push(prefix + " must be an object"); continue; }
      for (const [field, metric] of Object.entries(value)) {
        if (field === "quantiles") {
          if (object(metric)) for (const [quantile, number] of Object.entries(metric)) add(prefix + "/quantiles/" + encode(quantile), number);
          else { diagnostics.push(prefix + "/quantiles must be an object"); add(prefix + "/quantiles", metric); }
        } else add(prefix + "/" + encode(field), metric);
      }
    }
  } else if (adapter.requiredFields.includes("rowCount") && !own(facet, "rowCount")) diagnostics.push("rowCount is required by the selected output statistics schema");
  if (adapter.timestampField && own(facet, "lastUpdated") && (typeof facet.lastUpdated !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(facet.lastUpdated) || !Number.isFinite(Date.parse(facet.lastUpdated))))
    diagnostics.push("lastUpdated must be an RFC3339 timestamp");
  return rows;
}
function assertionRows(facet, observationId, diagnostics, adapter) {
  if (!Array.isArray(facet.assertions)) { diagnostics.push("assertions must be an array"); return []; }
  return facet.assertions.map((value, index) => {
    const row = object(value) ? value : {};
    const issues = [];
    if (typeof row.assertion !== "string") issues.push("assertion must be a string");
    if (typeof row.success !== "boolean") issues.push("success must be a boolean");
    for (const field of adapter.assertionFields.filter(field => field !== "params"))
      if (own(row, field) && typeof row[field] !== "string") issues.push(field + " must be a string");
    if (adapter.assertionFields.includes("params") && own(row, "params") && !object(row.params)) issues.push("params must be an object");
    diagnostics.push(...issues.map(message => "/assertions/" + index + "/" + message));
    return {
      id: digest({ observationId, index }), index, path: "/assertions/" + index,
      name: typeof row.name === "string" && row.name ? row.name : typeof row.assertion === "string" ? row.assertion : "Unnamed assertion",
      assertion: typeof row.assertion === "string" ? row.assertion : null,
      column: typeof row.column === "string" && row.column ? row.column : null,
      success: typeof row.success === "boolean" ? row.success : null,
      severity: typeof row.severity === "string" ? row.severity : null,
      expected: typeof row.expected === "string" ? row.expected : null,
      actual: typeof row.actual === "string" ? row.actual : null,
      query: typeof row.content === "string" ? row.content : null,
      contentType: typeof row.contentType === "string" ? row.contentType : null,
      description: typeof row.description === "string" ? row.description : null,
      valid: typeof row.assertion === "string" && typeof row.success === "boolean",
      diagnostics: issues, original: clone(value)
    };
  });
}
export function scanQuality(state, options = {}, frozen = null) {
  const selection = selectedRows(state, options, frozen), observations = [], contexts = new Map(), datasets = new Map();
  for (const row of selection.rows) {
    const event = row.event;
    if (!object(event)) continue;
    const rk = named(event.job) && object(event.run) && typeof event.run.runId === "string" ? runKey(event) : null;
    const jk = named(event.job) ? jobKey(event.job) : null;
    if (options.runKey != null && rk !== options.runKey) continue;
    const occurrences = [];
    if (named(event.dataset)) occurrences.push({ dataset: event.dataset, direction: "dataset", path: "/dataset" });
    for (const direction of ["inputs", "outputs"]) if (Array.isArray(event[direction]))
      event[direction].forEach((dataset, i) => { if (named(dataset)) occurrences.push({ dataset, direction: direction === "inputs" ? "input" : "output", path: "/" + direction + "/" + i, order: i }); });
    for (const item of occurrences) {
      const key = datasetKey(item.dataset);
      if (options.datasetKey != null && key !== options.datasetKey) continue;
      const base = { eventId: row.id, sequence: row.sequence, eventTime: event.eventTime ?? null, eventType: event.eventType ?? null,
        runKey: rk, jobKey: jk, datasetKey: key, namespace: item.dataset.namespace, name: item.dataset.name,
        direction: item.direction, datasetPath: item.path, occurrence: item.order ?? 0, eventSupported: Boolean(row.supported && row.diagnostics.length === 0), eventDiagnostics: clone(row.diagnostics), sources: clone(row.sources) };
      const contextKey = canonical([key, rk, jk, item.direction]);
      const prior = contexts.get(contextKey);
      if (base.eventSupported && (!prior || compareTime({ ...prior, path: prior.datasetPath }, { ...base, path: base.datasetPath }) <= 0)) contexts.set(contextKey, base);
      const ds = datasets.get(key) ?? { datasetKey: key, namespace: item.dataset.namespace, name: item.dataset.name, eventIds: [] };
      if (!ds.eventIds.includes(row.id)) ds.eventIds.push(row.id);
      datasets.set(key, ds);
      for (const [field, scope] of [["facets", "dataset"], ["inputFacets", "input"], ["outputFacets", "output"]]) {
        if (!object(item.dataset[field])) continue;
        for (const [facetName, raw] of Object.entries(item.dataset[field])) {
          if (!facetNames.has(facetName)) continue;
          const path = item.path + "/" + field + "/" + encode(facetName), id = digest({ eventId: row.id, path });
          const adapter = schemaAdapter(raw, facetName), diagnostics = [...adapter.diagnostics];
          const facet = object(raw) ? raw : {};
          const deleted = scope === "dataset" && facet._deleted === true;
          if (scope === "dataset" && own(facet, "_deleted") && typeof facet._deleted !== "boolean") diagnostics.push("_deleted must be a boolean in a static dataset facet");
          const scopeValid = adapter.recognized && adapter.allowedScopes.includes(scope) && (scope === "dataset" || item.direction === scope);
          if (adapter.recognized && !scopeValid) diagnostics.push("The original facet is outside its declared scope or event direction");
          let metrics = [], assertions = [];
          if (!deleted) {
            if (facetName === "dataQualityAssertions") assertions = assertionRows(facet, id, diagnostics, adapter);
            else metrics = metricRows(facet, facetName, diagnostics, adapter);
          }
          observations.push({ ...base, id, scope, facetName, path, schemaURL: facet._schemaURL ?? null, producer: facet._producer ?? null,
            adapter: adapter.adapter, expectedScope: adapter.expectedScope, allowedScopes: adapter.allowedScopes, scopeValid, recognized: adapter.recognized,
            schemaStatus: !adapter.recognized ? "unsupported" : diagnostics.length ? "invalid" : "recognized",
            deleted, diagnostics, metrics, assertions, facet: clone(raw) });
        }
      }
    }
  }
  observations.sort(compareTime);
  const projection = project({ ...state, events: selection.rows, editions: [] });
  const active = new Map();
  const boundaryKey = value => canonical([value.datasetKey, value.runKey, value.jobKey, value.direction]);
  const addBoundary = (dataset, rk, jk, direction) => {
    const context = { datasetKey: dataset.key, runKey: rk, jobKey: jk, direction };
    active.set(boundaryKey(context), { ...context, eventIds: dataset.eventIds,
      facets: clone(dataset.facets ?? {}), inputFacets: clone(dataset.inputFacets ?? {}), outputFacets: clone(dataset.outputFacets ?? {}) });
  };
  for (const run of projection.runs) for (const direction of ["input", "output"])
    for (const dataset of run[direction + "s"]) addBoundary(dataset, run.key, run.jobKey, direction);
  for (const job of projection.jobs) for (const direction of ["input", "output"])
    for (const dataset of job[direction + "s"]) addBoundary(dataset, null, job.key, direction);
  for (const context of contexts.values()) if (context.direction === "dataset") {
    const dataset = projection.datasets.find(row => row.key === context.datasetKey);
    if (dataset) addBoundary(dataset, null, null, "dataset");
  }
  const currentContexts = [...contexts.values()].filter(context => active.has(boundaryKey(context)));
  return { workspaceId: state.workspaceId, revision: state.revision, edition: selection.edition,
    eventIds: selection.rows.map(row => row.id), sourceIds: selection.sourceIds,
    observations, contexts: currentContexts, activeBoundaries: [...active.values()], datasets: [...datasets.values()].sort((a, b) => a.datasetKey.localeCompare(b.datasetKey)) };
}
export function qualityState(state) {
  return state.quality ?? { schema: QUALITY_FORMAT, rules: [], evaluations: [], dispositions: [] };
}
function filteredSaved(state, options, observations) {
  const quality = qualityState(state);
  const evaluations = quality.evaluations.filter(row =>
    ((!options.datasetKey && !options.runKey) || row.findings.some(f => (!options.datasetKey || f.datasetKey === options.datasetKey) && (!options.runKey || f.runKey === options.runKey))) &&
    (!options.edition || row.edition === options.edition));
  const evalIds = new Set(evaluations.map(row => row.id));
  return { rules: quality.rules.filter(row => !options.datasetKey || row.datasetKey === options.datasetKey),
    evaluations: clone(evaluations), dispositions: clone(quality.dispositions.filter(row => evalIds.has(row.evaluationId))) };
}
export function qualityHistory(state, options = {}) {
  const scan = scanQuality(state, options);
  return { workspaceId: state.workspaceId, revision: state.revision, edition: scan.edition, datasetKey: options.datasetKey ?? null,
    runKey: options.runKey ?? null, observations: scan.observations, ...filteredSaved(state, options, scan.observations) };
}
export function qualityOverview(state, options = {}) {
  const scan = scanQuality(state, options);
  const datasets = scan.datasets.map(dataset => {
    const rows = scan.observations.filter(row => row.datasetKey === dataset.datasetKey);
    const assertions = rows.flatMap(row => row.assertions);
    return { ...dataset, observationCount: rows.length, metricCount: rows.reduce((n, row) => n + row.metrics.length, 0),
      assertionCount: assertions.length, failureCount: assertions.filter(row => row.success === false).length,
      latestAt: rows.at(-1)?.eventTime ?? null };
  });
  return { workspaceId: state.workspaceId, revision: state.revision, edition: scan.edition, datasets,
    counts: { datasets: datasets.length, observations: scan.observations.length, metrics: datasets.reduce((n, row) => n + row.metricCount, 0),
      assertions: datasets.reduce((n, row) => n + row.assertionCount, 0), failedAssertions: datasets.reduce((n, row) => n + row.failureCount, 0),
      invalidFacets: scan.observations.filter(row => row.schemaStatus !== "recognized").length },
    ...filteredSaved(state, options, scan.observations) };
}
export function normalizeRule(rule) {
  if (!object(rule)) throw new QualityError("rule must be an object");
  const result = { title: requireText(rule.title, "Rule title"), datasetKey: rule.datasetKey, enabled: rule.enabled ?? true,
    severity: rule.severity ?? "error", scope: rule.scope ?? "any", kind: rule.kind, missing: rule.missing ?? "unknown" };
  if (!validKey(result.datasetKey)) throw new QualityError("Choose the exact original dataset key");
  if (typeof result.enabled !== "boolean" || !severities.has(result.severity) || !scopes.has(result.scope) || !["unknown", "fail"].includes(result.missing))
    throw new QualityError("Invalid rule enabled, severity, scope or missing-value choice");
  if (result.kind === "metric") {
    result.metricPath = requireText(rule.metricPath, "Metric JSON pointer");
    if (!metricPathInfo(result.metricPath, "dataQualityMetrics") && !metricPathInfo(result.metricPath, "outputStatistics"))
      throw new QualityError("Choose a numeric field from the pinned quality metrics or output statistics contract");
    result.operator = rule.operator; result.value = rule.value;
    if (!operators.has(result.operator) || !finite(result.value)) throw new QualityError("Choose a supported comparison and finite numeric value");
    if (result.operator === "between") {
      if (!finite(rule.upper) || rule.upper < result.value) throw new QualityError("The upper bound must be finite and at least the lower bound");
      result.upper = rule.upper;
    }
  } else if (result.kind === "assertion") {
    if (!object(rule.assertion)) throw new QualityError("Choose an assertion name and optional original column");
    result.assertion = { name: requireText(rule.assertion.name, "Assertion name") };
    if (own(rule.assertion, "column")) {
      if (rule.assertion.column !== null && typeof rule.assertion.column !== "string") throw new QualityError("Assertion column must be text or null");
      result.assertion.column = rule.assertion.column || null;
    }
    result.expectedSuccess = rule.expectedSuccess ?? true;
    if (typeof result.expectedSuccess !== "boolean") throw new QualityError("expectedSuccess must be a boolean");
  } else throw new QualityError("Choose a metric or assertion rule");
  return result;
}
function latestObservations(scan) {
  const latest = new Map(), boundaries = new Map(scan.activeBoundaries.map(row => [canonical([row.datasetKey, row.runKey, row.jobKey, row.direction]), row]));
  for (const row of scan.observations) {
    const boundary = boundaries.get(canonical([row.datasetKey, row.runKey, row.jobKey, row.direction]));
    const field = row.scope === "dataset" ? "facets" : row.scope + "Facets";
    if (!row.eventSupported || !boundary || !boundary.eventIds.includes(row.eventId) || !own(boundary[field], row.facetName)) continue;
    if (canonical(boundary[field][row.facetName]) !== canonical(row.facet)) continue;
    latest.set(canonical([row.datasetKey, row.runKey, row.jobKey, row.direction, row.scope, row.facetName]), row);
  }
  return [...latest.values()];
}
function observedSeverity(value) { return value === "warn" || value === "warning" ? "warning" : value === "info" ? "info" : "error"; }
function compareMetric(operator, actual, lower, upper) {
  return operator === "eq" ? actual === lower : operator === "ne" ? actual !== lower : operator === "lt" ? actual < lower :
    operator === "lte" ? actual <= lower : operator === "gt" ? actual > lower : operator === "gte" ? actual >= lower : actual >= lower && actual <= upper;
}
export function evaluateQuality(state, options = {}, frozen = null) {
  const scan = scanQuality(state, options, frozen);
  const sourceRules = frozen?.rules ?? qualityState(state).rules;
  const rules = sourceRules.filter(rule => rule.enabled && (!options.datasetKey || rule.datasetKey === options.datasetKey));
  const latest = latestObservations(scan), findings = [];
  const add = (context, detail) => {
    const identity = { ruleId: detail.ruleId, ruleVersion: detail.ruleVersion ?? null, observationId: context.id ?? null,
      datasetKey: context.datasetKey, runKey: context.runKey, jobKey: context.jobKey ?? null, direction: context.direction, datasetPath: context.datasetPath,
      selector: detail.selector ?? null };
    findings.push({ id: digest(identity), ruleId: detail.ruleId, ruleVersion: detail.ruleVersion ?? null,
      title: detail.title, datasetKey: context.datasetKey, namespace: context.namespace, name: context.name, runKey: context.runKey, jobKey: context.jobKey ?? null,
      eventId: context.eventId, eventTime: context.eventTime, eventType: context.eventType, observationId: context.id ?? null,
      facetPath: context.path ?? context.datasetPath, scope: context.scope ?? null, direction: context.direction,
      status: detail.status, severity: detail.severity, expected: detail.expected ?? null, actual: detail.actual ?? null,
      message: detail.message, sources: clone(context.sources), schemaURL: context.schemaURL ?? null,
      ...(detail.reportedSeverity !== undefined ? { reportedSeverity: detail.reportedSeverity } : {}),
      ...(detail.assertion ? { assertion: clone(detail.assertion) } : {}) });
  };
  for (const observation of latest) {
    if (observation.facetName !== "dataQualityAssertions" || observation.deleted) continue;
    for (const assertion of observation.assertions) {
      const known = observation.recognized && observation.scopeValid && assertion.valid;
      add(observation, { ruleId: null, title: assertion.name, selector: assertion.id,
        status: !known ? "unknown" : assertion.success ? "pass" : "fail",
        severity: observedSeverity(assertion.severity), reportedSeverity: assertion.severity,
        expected: assertion.expected ?? true, actual: assertion.actual ?? assertion.success, assertion,
        message: !known ? "Original assertion retained; its result cannot be interpreted by the pinned contract" :
          assertion.success ? "Original assertion reports success" : "Original assertion reports failure" });
    }
  }
  for (const rule of rules) {
    const contexts = scan.contexts.filter(context => context.datasetKey === rule.datasetKey &&
      (!["input", "output"].includes(rule.scope) || context.direction === rule.scope));
    if (!contexts.length) {
      const identity = JSON.parse(rule.datasetKey);
      add({ datasetKey: rule.datasetKey, namespace: identity[1], name: identity[2], runKey: null, eventId: null, eventTime: null,
        eventType: null, direction: "dataset", datasetPath: null, sources: [] },
      { ruleId: rule.id, ruleVersion: rule.version, title: rule.title, selector: "missing-dataset",
        status: rule.missing === "fail" ? "fail" : "unknown", severity: rule.severity,
        expected: rule.kind === "metric" ? { operator: rule.operator, value: rule.value, ...(rule.upper === undefined ? {} : { upper: rule.upper }) } : rule.expectedSuccess,
        message: "No original dataset observation is present in this selection" });
      continue;
    }
    for (const context of contexts) {
      const candidates = latest.filter(row => row.datasetKey === context.datasetKey && row.runKey === context.runKey && row.jobKey === context.jobKey &&
        row.direction === context.direction && (rule.scope === "any" || row.scope === rule.scope) &&
        (rule.kind === "metric" ? row.facetName !== "dataQualityAssertions" : row.facetName === "dataQualityAssertions"));
      const targets = candidates.length ? candidates : [null];
      for (const observation of targets) {
        const base = observation ?? context;
        if (rule.kind === "metric") {
          const metric = observation?.metrics.find(item => item.path === rule.metricPath);
          const usable = Boolean(observation?.recognized && observation.scopeValid && !observation.deleted && metric?.valid);
          const expected = { operator: rule.operator, value: rule.value, ...(rule.upper === undefined ? {} : { upper: rule.upper }) };
          add(base, { ruleId: rule.id, ruleVersion: rule.version, title: rule.title, selector: rule.metricPath,
            status: !usable ? rule.missing === "fail" ? "fail" : "unknown" : compareMetric(rule.operator, metric.value, rule.value, rule.upper) ? "pass" : "fail",
            severity: rule.severity, expected, actual: metric?.value ?? null,
            message: !observation ? "The selected original scope has no metrics facet" : observation.deleted ? "The original facet is explicitly deleted" :
              !observation.recognized ? "The original metrics schema is unrecognized" : !observation.scopeValid ? "The facet is outside its declared original scope" : !metric ? "The metric was not reported" :
              !metric.valid ? metric.reason : "Compared the exact original metric " + rule.metricPath });
        } else {
          const matches = observation?.assertions.filter(row => (row.name === rule.assertion.name || row.assertion === rule.assertion.name) &&
            (!own(rule.assertion, "column") || row.column === rule.assertion.column)) ?? [];
          for (const assertion of matches.length ? matches : [null]) {
            const usable = Boolean(observation?.recognized && observation.scopeValid && !observation.deleted && assertion?.valid);
            add(base, { ruleId: rule.id, ruleVersion: rule.version, title: rule.title, selector: assertion?.id ?? canonical(rule.assertion),
              status: !usable ? rule.missing === "fail" ? "fail" : "unknown" : assertion.success === rule.expectedSuccess ? "pass" : "fail",
              severity: rule.severity, expected: rule.expectedSuccess, actual: assertion?.success ?? null, assertion,
              message: !usable ? "The selected original assertion result is unavailable" : "Compared original assertion success independently of producer severity" });
          }
        }
      }
    }
  }
  findings.sort((a, b) => a.datasetKey.localeCompare(b.datasetKey) || String(a.runKey).localeCompare(String(b.runKey)) || a.id.localeCompare(b.id));
  const summary = { pass: 0, fail: 0, unknown: 0, total: findings.length };
  for (const finding of findings) summary[finding.status]++;
  const ruleVersions = rules.map(rule => {
    const { history, ...snapshot } = rule; return clone(snapshot);
  });
  return { schema: "commons.openlineage.quality.evaluation.v1", id: null, workspaceId: state.workspaceId,
    revision: frozen?.revision ?? state.revision, edition: scan.edition, datasetKey: options.datasetKey ?? null, runKey: options.runKey ?? null,
    createdAt: frozen?.createdAt ?? new Date().toISOString(), summary, findings, ruleVersions,
    eventIds: scan.eventIds, sourceIds: scan.sourceIds, selectionSha256: digest({ edition: scan.edition, datasetKey: options.datasetKey ?? null, runKey: options.runKey ?? null, eventIds: scan.eventIds, sourceIds: scan.sourceIds }),
    ruleSetSha256: digest(ruleVersions), adapterVersion: 1, upstreamCommit: QUALITY_UPSTREAM };
}
export function validateQualityState(state, { deep = false } = {}) {
  if (state.quality === undefined) return state;
  const quality = state.quality;
  if (!object(quality) || quality.schema !== QUALITY_FORMAT) throw new QualityError("Invalid quality workspace state");
  for (const field of ["rules", "evaluations", "dispositions"]) {
    if (!Array.isArray(quality[field])) throw new QualityError("Invalid quality " + field);
    const ids = new Set();
    for (const row of quality[field]) {
      if (!object(row) || !present(row.id) || ids.has(row.id)) throw new QualityError("Invalid or duplicate quality record identity");
      ids.add(row.id);
    }
  }
  for (const rule of quality.rules) {
    normalizeRule(rule);
    if (!Number.isSafeInteger(rule.version) || rule.version < 1 || !Array.isArray(rule.history)) throw new QualityError("Invalid quality rule history");
  }
  const eventIds = new Set(state.events.map(row => row.id)), sourceIds = new Set(state.sources.map(row => row.id));
  for (const evaluation of quality.evaluations) {
    if (evaluation.schema !== "commons.openlineage.quality.evaluation.v1" || !Array.isArray(evaluation.eventIds) || !Array.isArray(evaluation.sourceIds) ||
      !Array.isArray(evaluation.findings) || !Array.isArray(evaluation.ruleVersions) || !hash.test(evaluation.contentSha256 ?? ""))
      throw new QualityError("Invalid saved quality evaluation");
    if (new Set(evaluation.eventIds).size !== evaluation.eventIds.length || evaluation.eventIds.some(id => !eventIds.has(id)) ||
      new Set(evaluation.sourceIds).size !== evaluation.sourceIds.length || evaluation.sourceIds.some(id => !sourceIds.has(id)))
      throw new QualityError("Quality evaluation refers to absent or duplicate original source observations");
    const { contentSha256, ...body } = evaluation;
    if (digest(body) !== contentSha256) throw new QualityError("Quality evaluation content differs", 409);
    if (deep) {
      for (const rule of evaluation.ruleVersions) normalizeRule(rule);
      const actual = evaluateQuality(state, { edition: evaluation.edition, datasetKey: evaluation.datasetKey, runKey: evaluation.runKey },
        { eventIds: evaluation.eventIds, sourceIds: evaluation.sourceIds, rules: evaluation.ruleVersions, revision: evaluation.revision, createdAt: evaluation.createdAt });
      const expected = { ...actual, id: evaluation.id, title: evaluation.title };
      if (canonical(expected) !== canonical(body)) throw new QualityError("Saved quality evaluation differs from its original events or rule edition", 409);
    }
  }
  for (const disposition of quality.dispositions) {
    const evaluation = quality.evaluations.find(row => row.id === disposition.evaluationId);
    if (!evaluation?.findings.some(row => row.id === disposition.findingId) || !["open", "investigating", "accepted", "resolved"].includes(disposition.decision) ||
      !present(disposition.reason) || !Array.isArray(disposition.history)) throw new QualityError("Invalid quality finding disposition");
  }
  return state;
}
