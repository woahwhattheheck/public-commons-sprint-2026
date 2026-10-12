import { createHash } from "node:crypto";

export const FORMAT = "commons.openlineage.workspace.v1";
export const CORE_SCHEMA = "https://openlineage.io/spec/2-0-2/OpenLineage.json";
export const TERMINAL = new Set(["COMPLETE", "FAIL", "ABORT"]);
const STATES = new Set(["START", "RUNNING", "COMPLETE", "FAIL", "ABORT", "OTHER"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const clone = value => structuredClone(value);
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (record(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Only JSON values are supported");
  return encoded;
}
export const digest = value => sha256(canonical(value));
export const entityKey = (kind, namespace, name) => JSON.stringify([kind, namespace, name]);
export const jobKey = job => entityKey("job", job.namespace, job.name);
export const datasetKey = dataset => entityKey("dataset", dataset.namespace, dataset.name);
export const runKey = event => JSON.stringify(["run", event.job.namespace, event.job.name, event.run.runId]);
function string(value) { return typeof value === "string" && value.length > 0; }
function uri(value) { try { return string(value) && Boolean(new URL(value).protocol); } catch { return false; } }
function timestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function named(value) { return record(value) && typeof value.namespace === "string" && typeof value.name === "string"; }
function facets(value, path, diagnostics) {
  if (value === undefined) return;
  if (!record(value)) { diagnostics.push(path + " must be an object"); return; }
  for (const [name, facet] of Object.entries(value)) {
    if (!record(facet) || !uri(facet._producer) || !uri(facet._schemaURL)) diagnostics.push(path + "." + name + " requires a facet object with _producer and _schemaURL URIs");
    if (record(facet) && own(facet, "_deleted") && typeof facet._deleted !== "boolean") diagnostics.push(path + "." + name + "._deleted must be a boolean");
  }
}
export const SUPPORTED_CORE = Object.freeze({
  "1-0-1": { kinds: ["run"], fragment: "/definitions/RunEvent", states: ["START", "COMPLETE", "ABORT", "FAIL", "OTHER"] },
  "1-0-5": { kinds: ["run"], fragment: "/$defs/RunEvent", states: [...STATES] },
  "2-0-2": { kinds: ["run", "job", "dataset"], fragment: null, states: [...STATES] }
});
export function inspectEvent(event) {
  const diagnostics = [], notes = [];
  if (!record(event)) return { kind: "unknown", supported: false, diagnostics: ["Event must be a JSON object"], notes };
  if (!timestamp(event.eventTime)) diagnostics.push("eventTime must be an RFC3339 timestamp with a timezone");
  if (!uri(event.producer)) diagnostics.push("producer must be a URI");
  if (!uri(event.schemaURL)) diagnostics.push("schemaURL must be a URI");
  let kind = own(event, "run") ? "run" : own(event, "job") ? "job" : own(event, "dataset") ? "dataset" : "unknown";
  let schemaVersion = null, adapter = null, supported = false;
  try {
    const schema = new URL(event.schemaURL);
    const match = /^\/spec\/(1-0-1|1-0-5|2-0-2)\/OpenLineage\.json$/.exec(schema.pathname);
    if (schema.origin === "https://openlineage.io" && !schema.search && match) {
      schemaVersion = match[1];
      const contract = SUPPORTED_CORE[schemaVersion], fragment = decodeURIComponent(schema.hash.slice(1));
      const expected = contract.fragment ?? ({ run: "/$defs/RunEvent", job: "/$defs/JobEvent", dataset: "/$defs/DatasetEvent" })[kind];
      supported = contract.kinds.includes(kind) && (!fragment || fragment === expected);
      // The maintained upstream fluentd fixture emits this legacy pointer for core 1-0-5.
      // Keep it byte-for-byte and name the compatibility adapter instead of rewriting the schema URL.
      if (schemaVersion === "1-0-5" && kind === "run" && fragment === "/definitions/RunEvent") {
        supported = true; adapter = "core-1-0-5-legacy-run-pointer";
        notes.push("Original producer uses the legacy /definitions/RunEvent pointer; projected with pinned core 1-0-5 runtime fields");
      }
      if (!supported) diagnostics.push("schemaURL does not select a supported event kind");
      if (kind === "run" && own(event, "eventType") && !contract.states.includes(event.eventType)) diagnostics.push("eventType is not defined by the selected core schema");
    }
  } catch {}
  if (kind === "run") {
    if (!record(event.run) || typeof event.run.runId !== "string" || !UUID.test(event.run.runId)) diagnostics.push("run.runId must be a UUID");
    if (!named(event.job)) diagnostics.push("job requires namespace and name strings");
    if (own(event, "eventType") && !STATES.has(event.eventType) && !diagnostics.some(item => item.startsWith("eventType"))) diagnostics.push("Unsupported eventType");
    facets(event.run?.facets, "run.facets", diagnostics);
  } else if (kind === "job") {
    if (!named(event.job)) diagnostics.push("job requires namespace and name strings");
  } else if (kind === "dataset") {
    if (!named(event.dataset)) diagnostics.push("dataset requires namespace and name strings");
  } else diagnostics.push("Expected a RunEvent, JobEvent or DatasetEvent");
  if (schemaVersion === "2-0-2" && own(event, "dataset") && own(event, "job")) diagnostics.push("Ambiguous event contains both job and dataset");
  if (kind === "run" || kind === "job") facets(event.job?.facets, "job.facets", diagnostics);
  if (kind === "dataset") facets(event.dataset?.facets, "dataset.facets", diagnostics);
  if (kind === "run" || kind === "job") for (const direction of ["inputs", "outputs"]) {
    if (event[direction] === undefined) continue;
    if (!Array.isArray(event[direction])) { diagnostics.push(direction + " must be an array"); continue; }
    event[direction].forEach((dataset, index) => {
      const path = direction + "[" + index + "]";
      if (!named(dataset)) diagnostics.push(path + " requires namespace and name strings");
      facets(dataset?.facets, path + ".facets", diagnostics);
      facets(dataset?.[direction === "inputs" ? "inputFacets" : "outputFacets"], path + (direction === "inputs" ? ".inputFacets" : ".outputFacets"), diagnostics);
    });
  }
  if (!supported) diagnostics.push("Projection supports pinned OpenLineage core 1-0-1, 1-0-5 and 2-0-2; original event retained");
  return { kind, supported, schemaVersion, adapter, diagnostics, notes };
}
export function parseSource(bytes, name = "events.json") {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  let values;
  try {
    const document = JSON.parse(text);
    values = Array.isArray(document) ? document : [document];
  } catch (error) {
    const lines = text.split(/\r?\n/).map((line, i) => ({ line, position: i + 1 })).filter(item => item.line.trim());
    try { values = lines.map(item => ({ value: JSON.parse(item.line), line: item.position })); }
    catch { throw new Error(name + ": expected JSON object, JSON array or newline-delimited JSON"); }
    return { id: sha256(buffer), bytes: buffer.length, format: "ndjson", events: values.map(item => eventRecord(item.value, { line: item.line })) };
  }
  return { id: sha256(buffer), bytes: buffer.length, format: Array.isArray(JSON.parse(text)) ? "array" : "object", events: values.map((value, index) => eventRecord(value, { index })) };
}
function eventRecord(value, position) {
  const inspection = inspectEvent(value);
  return { id: digest(value), ...position, ...inspection, event: value };
}
function mergeFacets(previous, incoming, allowDelete = false) {
  const merged = new Map(Object.entries(previous ?? {}));
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (allowDelete && value?._deleted === true) merged.delete(key);
    else merged.set(key, clone(value));
  }
  return Object.fromEntries(merged);
}
function selectRows(state, edition) {
  if (!edition) return state.events;
  const selected = state.editions.find(item => item.id === edition);
  if (!selected) throw new Error("Unknown edition " + edition);
  const wanted = new Set(selected.eventIds);
  return state.events.filter(item => wanted.has(item.id));
}
function byTime(a, b) {
  const difference = Date.parse(a.event.eventTime) - Date.parse(b.event.eventTime);
  if (difference) return difference;
  // Producers commonly emit microseconds; Date.parse retains only milliseconds.
  const left = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i.exec(a.event.eventTime)?.[1] ?? "";
  const right = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i.exec(b.event.eventTime)?.[1] ?? "";
  const width = Math.max(left.length, right.length), x = left.padEnd(width, "0"), y = right.padEnd(width, "0");
  return (x < y ? -1 : x > y ? 1 : 0) || a.sequence - b.sequence;
}
function datasetObservation(dataset, eventId) {
  return { key: datasetKey(dataset), namespace: dataset.namespace, name: dataset.name, facets: mergeFacets({}, dataset.facets, true), inputFacets: clone(dataset.inputFacets ?? {}), outputFacets: clone(dataset.outputFacets ?? {}), eventIds: [eventId] };
}
function updateObservation(previous, dataset, eventId) {
  if (!previous) return datasetObservation(dataset, eventId);
  return { ...previous,
    facets: mergeFacets(previous.facets, dataset.facets, true),
    inputFacets: mergeFacets(previous.inputFacets, dataset.inputFacets),
    outputFacets: mergeFacets(previous.outputFacets, dataset.outputFacets),
    eventIds: [...new Set([...previous.eventIds, eventId])]
  };
}
function updateBoundary(target, event, eventId, mode) {
  for (const direction of ["inputs", "outputs"]) {
    if (event[direction] === undefined && mode !== "COMPLETE_SNAPSHOT") continue;
    const prior = mode === "COMPLETE_SNAPSHOT" || mode === "REPLACE_PRESENT" ? new Map() : new Map(target[direction].map(item => [item.key, item]));
    for (const dataset of event[direction] ?? []) {
      const key = datasetKey(dataset);
      prior.set(key, updateObservation(prior.get(key), dataset, eventId));
    }
    target[direction] = [...prior.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}
function addEventId(entity, id) { if (!entity.eventIds.includes(id)) entity.eventIds.push(id); }
function facetEntityRef(value, job) {
  if (!record(value) || !["DATASET", "JOB"].includes(value.type)) return null;
  const identity = value.type === "JOB" && value.namespace === undefined && value.name === undefined ? job : value;
  if (!named(identity)) return null;
  if (value.type === "JOB" && own(value, "runId")) {
    if (!UUID.test(value.runId ?? "")) return null;
    return JSON.stringify(["run", identity.namespace, identity.name, value.runId]);
  }
  return entityKey(value.type === "JOB" ? "job" : "dataset", identity.namespace, identity.name);
}
function lineagePackets(row) {
  const event = row.event;
  const scopeKey = row.kind === "run" ? runKey(event) : row.kind === "job" ? jobKey(event.job) : datasetKey(event.dataset);
  const packets = [];
  function add(owner, values, facetName, shape, path) {
    if (!record(values) || !own(values, facetName)) return;
    packets.push({ slot: JSON.stringify([scopeKey, owner, facetName]), scopeKey, owner, shape, path,
      row, facet: values[facetName], facetName, contextJob: event.job ?? null });
  }
  if (event.job) add(jobKey(event.job), event.job.facets, "lineage", "job", "job.facets.lineage");
  if (row.kind === "dataset") {
    const owner = datasetKey(event.dataset);
    add(owner, event.dataset.facets, "lineage", "dataset", "dataset.facets.lineage");
    add(owner, event.dataset.facets, "columnLineage", "column", "dataset.facets.columnLineage");
  }
  for (const direction of row.kind === "dataset" ? [] : ["inputs", "outputs"]) {
    for (const [index, dataset] of (event[direction] ?? []).entries()) {
      const owner = datasetKey(dataset), path = direction + "[" + index + "].facets.";
      add(owner, dataset.facets, "lineage", "dataset", path + "lineage");
      add(owner, dataset.facets, "columnLineage", "column", path + "columnLineage");
    }
  }
  return packets;
}
function supportedLineageFacet(packet) {
  try {
    const schema = new URL(packet.facet._schemaURL);
    const fragment = decodeURIComponent(schema.hash.slice(1));
    if (schema.search || schema.origin !== "https://openlineage.io") return false;
    if (packet.shape === "column") {
      return /^\/spec\/facets\/(?:1-0-0|1-0-1|1-0-2|1-1-0|1-2-0)\/ColumnLineageDatasetFacet\.json$/.test(schema.pathname)
        && (!fragment || fragment === "/$defs/ColumnLineageDatasetFacet" || fragment === "/definitions/ColumnLineageDatasetFacet");
    }
    const expected = packet.shape === "job" ? "/$defs/LineageJobFacet" : "/$defs/LineageDatasetFacet";
    return schema.pathname === "/spec/facets/1-0-0/LineageFacet.json" && (!fragment || fragment === expected);
  } catch { return false; }
}
function decodeLineagePacket(packet) {
  const { row, facet, contextJob } = packet;
  const result = { edges: [], targets: [], diagnostics: [] };
  if (!record(facet) || facet._deleted === true) return result;
  const issue = text => result.diagnostics.push(packet.path + ": " + text);
  if (!supportedLineageFacet(packet)) {
    issue("Original facet schema is retained; no edge interpretation is registered for " + facet._schemaURL);
    return result;
  }
  const common = { eventId: row.id, eventTime: row.event.eventTime, sequence: row.sequence,
    runKey: row.kind === "run" ? runKey(row.event) : null, scopeKey: packet.scopeKey,
    declared: row.kind !== "run", facetSchema: facet._schemaURL, facetProducer: facet._producer, facetPath: packet.path };
  function edge(targetKey, source, targetField = null, legacy = false, fieldMetadata = null) {
    const typed = legacy && record(source) ? { ...source, type: "DATASET" } : source;
    const from = facetEntityRef(typed, contextJob);
    if (!from) { issue("A source has no supported entity identity"); return; }
    if (own(typed, "field") && typeof typed.field !== "string") { issue("A source field must be a string"); return; }
    if (legacy && typeof typed.field !== "string") { issue("Column lineage input requires field"); return; }
    if (own(typed, "transformations") && !Array.isArray(typed.transformations)) { issue("Source transformations must be an array"); return; }
    result.edges.push({ ...common, from, to: targetKey,
      kind: legacy ? "column-lineage" : "explicit-lineage",
      granularity: targetField !== null ? "field" : own(typed, "field") ? "dataset-dependency" : "entity",
      fromField: own(typed, "field") ? typed.field : null, toField: targetField,
      source: clone(source), transformations: clone(typed.transformations ?? []),
      ...(fieldMetadata ? { fieldMetadata: clone(fieldMetadata) } : {}) });
  }
  function fields(targetKey, values, legacy = false) {
    if (values === undefined) return;
    if (!record(values)) { issue("fields must be an object"); return; }
    for (const [field, value] of Object.entries(values)) {
      const inputs = value?.[legacy ? "inputFields" : "inputs"];
      if (!Array.isArray(inputs)) { issue("Each field entry requires its source array"); continue; }
      for (const input of inputs) edge(targetKey, input, field, legacy, value);
    }
  }
  function target(targetKey, entry, legacy = false) {
    if (!result.targets.includes(targetKey)) result.targets.push(targetKey);
    if (entry.inputs !== undefined) {
      if (!Array.isArray(entry.inputs)) issue("inputs must be an array");
      else for (const input of entry.inputs) edge(targetKey, input, null, legacy);
    }
    fields(targetKey, entry.fields, legacy);
  }
  if (packet.shape === "job") {
    if (!Array.isArray(facet.entries)) issue("Job lineage requires entries");
    else for (const entry of facet.entries) {
      const to = facetEntityRef(entry, contextJob);
      if (!to) { issue("A target has no supported entity identity"); continue; }
      target(to, entry.type === "JOB" ? { inputs: entry.inputs } : entry);
    }
  } else if (packet.shape === "dataset") target(packet.owner, facet);
  else {
    if (!record(facet.fields)) issue("Column lineage requires fields");
    target(packet.owner, { fields: facet.fields }, true);
    if (facet.dataset !== undefined) {
      if (!Array.isArray(facet.dataset)) issue("dataset must be an array");
      else for (const input of facet.dataset) edge(packet.owner, input, null, true);
    }
  }
  return result;
}
function activeLineage(packets) {
  const decoded = [...packets.values()].map(packet => ({ packet, result: decodeLineagePacket(packet) }));
  const explicitTargets = new Set();
  const explicitScopes = new Set();
  for (const { packet, result } of decoded) {
    if (packet.shape === "column" || packet.facet?._deleted === true || !supportedLineageFacet(packet)) continue;
    // Empty explicit entries/inputs still declare that no inferred lineage should be added.
    explicitScopes.add(packet.scopeKey);
    for (const target of result.targets) explicitTargets.add(JSON.stringify([packet.scopeKey, target]));
  }
  const edges = [], diagnostics = [], declarations = [];
  for (const { packet, result } of decoded) {
    if (result.diagnostics.length) diagnostics.push({ eventId: packet.row.id, messages: result.diagnostics });
    if (packet.shape === "column" && explicitTargets.has(JSON.stringify([packet.scopeKey, packet.owner]))) continue;
    edges.push(...result.edges);
    for (const target of result.targets) declarations.push({ target, scopeKey: packet.scopeKey,
      eventId: packet.row.id, eventTime: packet.row.event.eventTime, facetPath: packet.path,
      facetSchema: packet.facet._schemaURL, kind: packet.shape, edgeCount: result.edges.filter(edge => edge.to === target).length });
  }
  return { edges, diagnostics, declarations, explicitScopes };
}
export function project(state, { edition = null } = {}) {
  const selected = selectRows(state, edition);
  const accepted = selected.filter(row => row.supported && row.diagnostics.length === 0).sort(byTime);
  const jobs = new Map(), datasets = new Map(), runs = new Map(), runIds = new Map(), packets = new Map();
  const observedEdges = [];
  const diagnostics = selected.filter(row => row.diagnostics.length).map(row => ({ eventId: row.id, messages: row.diagnostics }));
  function observeDataset(dataset, row) {
    const key = datasetKey(dataset);
    const value = datasets.get(key) ?? { key, namespace: dataset.namespace, name: dataset.name, facets: {}, eventIds: [], runKeys: [], updatedAt: null };
    value.facets = mergeFacets(value.facets, dataset.facets, true);
    value.updatedAt = row.event.eventTime;
    addEventId(value, row.id);
    if (row.kind === "run" && !value.runKeys.includes(runKey(row.event))) value.runKeys.push(runKey(row.event));
    datasets.set(key, value);
  }
  function observeLineage(row, reset = false, boundary = null) {
    const scope = row.kind === "run" ? runKey(row.event) : row.kind === "job" ? jobKey(row.event.job) : datasetKey(row.event.dataset);
    if (reset) for (const [slot, packet] of packets) if (packet.scopeKey === scope) packets.delete(slot);
    if (boundary) {
      const retained = new Set([...boundary.inputs, ...boundary.outputs].map(item => item.key));
      for (const [slot, packet] of packets) {
        if (packet.scopeKey === scope && packet.shape !== "job" && !retained.has(packet.owner)) packets.delete(slot);
      }
    }
    const observation = new Map();
    for (const packet of lineagePackets(row)) {
      observation.set(packet.slot, packet);
      if (packet.facet?._deleted === true) packets.delete(packet.slot);
      else packets.set(packet.slot, packet);
    }
    observedEdges.push(...activeLineage(observation).edges);
  }
  for (const row of accepted) {
    const event = row.event;
    if (row.kind === "dataset") {
      observeDataset(event.dataset, row);
      observeLineage(row);
      continue;
    }
    const jk = jobKey(event.job);
    const job = jobs.get(jk) ?? { key: jk, namespace: event.job.namespace, name: event.job.name, facets: {}, declaredFacets: {},
      eventIds: [], runKeys: [], inputs: [], outputs: [], updatedAt: null, declaredUpdatedAt: null };
    job.facets = mergeFacets(job.facets, event.job.facets, true);
    job.updatedAt = event.eventTime;
    addEventId(job, row.id);
    jobs.set(jk, job);
    for (const item of [...(event.inputs ?? []), ...(event.outputs ?? [])]) observeDataset(item, row);
    if (row.kind === "job") {
      job.declaredFacets = mergeFacets(job.declaredFacets, event.job.facets, true);
      job.declaredUpdatedAt = event.eventTime;
      updateBoundary(job, event, row.id, "REPLACE_PRESENT");
      observeLineage(row, false, job);
      continue;
    }
    const rk = runKey(event), nativeId = event.run.runId;
    const run = runs.get(rk) ?? { key: rk, runId: nativeId, jobKey: jk, namespace: event.job.namespace, name: event.job.name,
      state: "OBSERVED", firstEventAt: event.eventTime, lastEventAt: event.eventTime, startedAt: null, endedAt: null,
      facets: {}, jobFacets: {}, inputs: [], outputs: [], eventIds: [], transitions: [], issues: [], emissionPattern: null };
    const seenJobs = runIds.get(nativeId) ?? new Set();
    seenJobs.add(jk); runIds.set(nativeId, seenJobs);
    run.lastEventAt = event.eventTime;
    run.facets = mergeFacets(run.facets, event.run.facets);
    run.jobFacets = mergeFacets(run.jobFacets, event.job.facets, true);
    run.emissionPattern = clone(run.jobFacets.jobType?.emissionPattern ?? null);
    const mode = run.emissionPattern?.eventContentMode ?? "ACCUMULATIVE";
    const snapshot = mode === "COMPLETE_SNAPSHOT" && event.eventType !== "OTHER";
    updateBoundary(run, event, row.id, snapshot ? "COMPLETE_SNAPSHOT" : "ACCUMULATIVE");
    observeLineage(row, snapshot, run);
    addEventId(run, row.id);
    if (event.eventType && event.eventType !== "OTHER") {
      run.transitions.push({ eventId: row.id, state: event.eventType, eventTime: event.eventTime });
      const wasTerminal = TERMINAL.has(run.state);
      if (wasTerminal) {
        if (event.eventType !== run.state) run.issues.push({ eventId: row.id,
          message: TERMINAL.has(event.eventType) ? "Conflicting terminal observation; original terminal retained" : "Lifecycle observation after terminal; original terminal retained" });
      } else {
        run.state = event.eventType;
        if (event.eventType === "START" && run.startedAt === null) run.startedAt = event.eventTime;
        if (TERMINAL.has(event.eventType)) run.endedAt = event.eventTime;
      }
    }
    runs.set(rk, run);
    if (!job.runKeys.includes(rk)) job.runKeys.push(rk);
  }
  const active = activeLineage(packets);
  const edges = [...active.edges], boundaryEdges = [];
  diagnostics.push(...active.diagnostics);
  for (const run of runs.values()) {
    if ((runIds.get(run.runId)?.size ?? 0) > 1) run.issues.push({ message: "Original run UUID appears under multiple jobs; observations kept separate" });
    run.durationMs = run.startedAt && run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null;
    const explicit = active.explicitScopes.has(run.key);
    for (const input of run.inputs) boundaryEdges.push({ from: input.key, to: run.key, kind: "consumes",
      eventIds: input.eventIds, runKey: run.key, scopeKey: run.key, declared: false, boundaryOnly: explicit });
    for (const output of run.outputs) boundaryEdges.push({ from: run.key, to: output.key, kind: "produces",
      eventIds: output.eventIds, runKey: run.key, scopeKey: run.key, declared: false, boundaryOnly: explicit });
  }
  for (const job of jobs.values()) {
    const explicit = active.explicitScopes.has(job.key);
    for (const input of job.inputs) boundaryEdges.push({ from: input.key, to: job.key, kind: "declared-input",
      eventIds: input.eventIds, scopeKey: job.key, declared: true, boundaryOnly: explicit });
    for (const output of job.outputs) boundaryEdges.push({ from: job.key, to: output.key, kind: "declared-output",
      eventIds: output.eventIds, scopeKey: job.key, declared: true, boundaryOnly: explicit });
  }
  edges.push(...boundaryEdges);
  const known = new Set([...jobs.keys(), ...datasets.keys(), ...runs.keys()]), references = new Map();
  for (const edge of edges) for (const key of [edge.from, edge.to]) {
    if (known.has(key)) continue;
    const identity = JSON.parse(key);
    const ref = references.get(key) ?? { key, kind: identity[0], namespace: identity[1], name: identity[2],
      ...(identity[0] === "run" ? { runId: identity[3] } : {}), referencedOnly: true, eventIds: [] };
    for (const id of edge.eventIds ?? [edge.eventId]) if (id && !ref.eventIds.includes(id)) ref.eventIds.push(id);
    references.set(key, ref);
  }
  return { workspaceId: state.workspaceId, revision: state.revision, edition, eventCount: selected.length, projectedCount: accepted.length,
    jobs: [...jobs.values()].sort((a, b) => a.key.localeCompare(b.key)),
    datasets: [...datasets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    runs: [...runs.values()].sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt)),
    references: [...references.values()].sort((a, b) => a.key.localeCompare(b.key)),
    edges, observedEdges, lineageDeclarations: active.declarations, diagnostics
  };
}
export function entity(state, key, options = {}) {
  const view = project(state, options);
  const value = [...view.runs, ...view.jobs, ...view.datasets, ...view.references].find(item => item.key === key);
  if (!value) throw new Error("Unknown entity");
  const ids = new Set(value.eventIds);
  return { ...value, events: state.events.filter(row => ids.has(row.id)).sort(byTime),
    reviews: state.reviews.filter(review => review.entityKeys.includes(key) && (!options.edition || review.editionId === null || review.editionId === options.edition)),
    results: state.results.filter(result => result.entityKeys.includes(key) && (!options.edition || result.editionId === options.edition)) };
}
function comparable(value) {
  const { eventIds, runKeys, updatedAt, firstEventAt, lastEventAt, transitions, issues, ...rest } = value;
  return rest;
}
export function compareEditions(state, from, to = null) {
  const left = project(state, { edition: from }), right = project(state, { edition: to });
  const changes = [];
  for (const kind of ["jobs", "datasets", "runs"]) {
    const a = new Map(left[kind].map(item => [item.key, item])), b = new Map(right[kind].map(item => [item.key, item]));
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const before = a.get(key), after = b.get(key);
      if (!before || !after || canonical(comparable(before)) !== canonical(comparable(after))) {
        changes.push({ kind, key, change: !before ? "added" : !after ? "removed" : "changed", before: before ?? null, after: after ?? null });
      }
    }
  }
  const oldEvents = new Set(selectRows(state, from).map(item => item.id));
  return { from, to, changes, addedEventIds: selectRows(state, to).filter(item => !oldEvents.has(item.id)).map(item => item.id) };
}
export function lineage(state, key, { edition = null, direction = "both", maxDepth = 6 } = {}) {
  if (!["upstream", "downstream", "both"].includes(direction)) throw new Error("Invalid lineage direction");
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 64) throw new Error("maxDepth must be 0–64");
  const view = project(state, { edition });
  const all = new Map([...view.jobs, ...view.datasets, ...view.runs, ...view.references].map(value => [value.key, value]));
  if (!all.has(key)) throw new Error("Unknown entity");
  const found = new Set([key]), kept = new Set(), frontier = [key];
  // A selected job/run also exposes its explicit graph without inferring a cross product through its boundary.
  for (const [index, edge] of view.edges.entries()) {
    if (maxDepth === 0 || edge.scopeKey !== key || edge.boundaryOnly || !["explicit-lineage", "column-lineage"].includes(edge.kind)) continue;
    kept.add(index);
    for (const endpoint of [edge.from, edge.to]) if (!found.has(endpoint)) { found.add(endpoint); frontier.push(endpoint); }
  }
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    for (const current of frontier.splice(0)) {
      view.edges.forEach((edge, index) => {
        if (edge.boundaryOnly) return;
        let neighbor;
        if (direction !== "upstream" && edge.from === current) neighbor = edge.to;
        if (direction !== "downstream" && edge.to === current) neighbor = edge.from;
        if (neighbor !== undefined) {
          kept.add(index);
          if (!found.has(neighbor)) { found.add(neighbor); next.push(neighbor); }
        }
      });
    }
    frontier.push(...next);
  }
  const boundaries = view.edges.filter(edge => edge.boundaryOnly && edge.scopeKey === key);
  return { root: key, edition, direction, maxDepth,
    nodes: [...found].map(id => all.get(id) ?? { key: id, referencedOnly: true }),
    edges: [...kept].map(index => view.edges[index]), boundaries,
    declarations: view.lineageDeclarations.filter(item => found.has(item.target) || item.scopeKey === key)
  };
}
export function csv(rows, columns) {
  const cell = value => {
    const text = value === null || value === undefined ? "" : typeof value === "object" ? canonical(value) : String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return [columns.map(cell).join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n") + "\r\n";
}
export function report(state, { edition = null } = {}) {
  const view = project(state, { edition });
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const table = (rows, columns) => "<table><thead><tr>" + columns.map(key => "<th>" + escape(key) + "</th>").join("") + "</tr></thead><tbody>" + rows.map(row => "<tr>" + columns.map(key => "<td>" + escape(typeof row[key] === "object" ? canonical(row[key]) : row[key]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
  return "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>OpenLineage project report</title><style>body{font:14px system-ui;margin:36px;color:#202124;line-height:1.5}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{border:1px solid #c8c8c8;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#eee}h1{font-size:24px}code{overflow-wrap:anywhere}@media print{body{margin:0}thead{display:table-header-group}}</style><h1>" + escape(state.title) + "</h1><p>Workspace " + escape(state.workspaceId) + " · revision " + state.revision + " · edition " + escape(edition ?? "current") + "</p><p>" + view.eventCount + " retained events; " + view.projectedCount + " projected. Original events, source documents, facets, reviews and attached results are included in the editable workspace export.</p><h2>Runs</h2>" + table(view.runs, ["namespace", "name", "runId", "state", "startedAt", "endedAt", "durationMs"]) + "<h2>Datasets</h2>" + table(view.datasets, ["namespace", "name", "facets"]) + "<h2>Reviews</h2>" + table(state.reviews, ["title", "decision", "reason", "editionId", "updatedAt"]) + "<h2>Intake diagnostics</h2>" + table(view.diagnostics, ["eventId", "messages"]) + "</html>";
}
