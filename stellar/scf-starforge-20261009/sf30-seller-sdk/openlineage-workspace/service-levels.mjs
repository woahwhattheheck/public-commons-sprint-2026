// MIT. Service-level decisions use the original OpenLineage projection and writer.
import { project, digest, canonical, clone, csv } from "./model.mjs";

export const SERVICE_LEVELS_SCHEMA = "commons.openlineage.service-levels.v1";
export class ServiceLevelError extends Error {
  constructor(message, status = 400, details) { super(message); this.status = status; this.details = details; }
}
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const STATES = new Set(["open", "acknowledged", "resolved", "accepted"]);
const REVIEW_ACTIONS = new Set(["acknowledge", "assign", "resolve", "accept", "reopen"]);
const POLICY_FIELDS = ["id", "title", "jobKey", "owner", "runbook", "enabled", "effectiveFrom", "maxCompletionAgeSeconds", "maxDurationSeconds", "failureWindowSeconds", "monitorFailures"];
function fail(message, status = 400, details) { throw new ServiceLevelError(message, status, details); }
function text(value, name, { optional = false, maximum = 8000 } = {}) {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > maximum || value.includes("\0")) fail("Invalid " + name);
  return value.trim();
}
function instant(value, name = "asOf") {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match || !Number.isFinite(Date.parse(value))) fail(name + " requires an RFC3339 timestamp with a timezone");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 ||
      (match[8] && (Number(match[9]) > 23 || Number(match[10]) > 59)))
    fail(name + " contains an invalid calendar time");
  return new Date(value).toISOString();
}
function seconds(value, name, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 315360000) fail(name + " must be an integer from 1 to 315360000 seconds");
  return value;
}
function jobIdentity(value) {
  const key = text(value, "jobKey", { maximum: 4000 });
  let parsed;
  try { parsed = JSON.parse(key); } catch { fail("Select an exact namespaced job key"); }
  if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== "job" ||
      parsed.slice(1).some(part => typeof part !== "string" || !part.trim()) || JSON.stringify(parsed) !== key)
    fail("Select the exact job key returned by the workspace");
  return key;
}
export function normalizePolicy(input) {
  if (!record(input)) fail("policy must be an object");
  for (const key of Object.keys(input)) if (!POLICY_FIELDS.includes(key)) fail("Unknown policy field " + key);
  const policy = {
    id: input.id === undefined || input.id === null ? null : text(input.id, "policy id", { maximum: 240 }),
    title: text(input.title, "policy title", { maximum: 400 }),
    jobKey: jobIdentity(input.jobKey),
    owner: text(input.owner, "owner", { optional: true, maximum: 400 }),
    runbook: text(input.runbook, "runbook", { optional: true, maximum: 4000 }),
    enabled: input.enabled ?? true,
    effectiveFrom: instant(input.effectiveFrom, "effectiveFrom"),
    maxCompletionAgeSeconds: seconds(input.maxCompletionAgeSeconds, "maxCompletionAgeSeconds", true),
    maxDurationSeconds: seconds(input.maxDurationSeconds, "maxDurationSeconds", true),
    failureWindowSeconds: seconds(input.failureWindowSeconds ?? 86400, "failureWindowSeconds"),
    monitorFailures: input.monitorFailures ?? true
  };
  if (typeof policy.enabled !== "boolean" || typeof policy.monitorFailures !== "boolean") fail("enabled and monitorFailures must be booleans");
  if (!policy.maxCompletionAgeSeconds && !policy.maxDurationSeconds && !policy.monitorFailures) fail("Select at least one service-level condition");
  if (policy.runbook) {
    let url;
    try { url = new URL(policy.runbook); } catch { fail("runbook must be an HTTP(S) URL"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) fail("runbook must be an HTTP(S) URL without credentials");
  }
  return policy;
}
function snapshotPolicy(policy) {
  const value = Object.fromEntries(POLICY_FIELDS.map(key => [key, policy[key]]));
  return { ...normalizePolicy(value), version: policy.version };
}
function emptyState() { return { schema: SERVICE_LEVELS_SCHEMA, policies: [], assessments: [], incidents: [] }; }
function serviceState(state) { return state.serviceLevels ?? emptyState(); }
function unique(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!record(item) || typeof item.id !== "string" || !item.id || ids.has(item.id)) fail("Invalid or duplicate " + label);
    ids.add(item.id);
  }
  return ids;
}
function sourceSelection(state, { editionId = null, eventIds, sourceIds } = {}) {
  const edition = editionId === null ? null : state.editions.find(item => item.id === editionId);
  if (editionId !== null && !edition) fail("Unknown service-level edition", 404);
  const wanted = new Set(eventIds ?? edition?.eventIds ?? state.events.map(row => row.id));
  const knownSources = new Set(state.sources.map(row => row.id));
  const sources = new Set(sourceIds ?? edition?.sourceIds ?? knownSources);
  const rows = state.events.filter(row => wanted.has(row.id)).map(row => ({ ...row, sources: row.sources.filter(item => sources.has(item.sourceId)) }));
  if (rows.length !== wanted.size || [...sources].some(id => !knownSources.has(id))) fail("Service-level selection refers to absent originals", 409);
  if (rows.some(row => !row.sources.length)) fail("A selected event requires its original source", 409);
  return { rows, eventIds: rows.map(row => row.id), sourceIds: [...sources].sort() };
}
function evidence(sourcesByEvent, eventIds) {
  return [...new Set(eventIds.flatMap(id => sourcesByEvent.get(id) ?? []))].sort();
}
export function evaluateServiceLevels(state, { asOf, editionId = null, policies, eventIds, sourceIds, sourceRevision, evaluationVersion = 2 } = {}) {
  if (![1, 2].includes(evaluationVersion)) fail("Unsupported service-level evaluation version", 409);
  const at = instant(asOf), now = Date.parse(at);
  const selected = sourceSelection(state, { editionId, eventIds, sourceIds });
  const future = selected.rows.filter(row => Number.isFinite(Date.parse(row.event?.eventTime)) && Date.parse(row.event?.eventTime) > now);
  const eligible = selected.rows.filter(row => !Number.isFinite(Date.parse(row.event?.eventTime)) || Date.parse(row.event?.eventTime) <= now);
  const view = project({ ...state, events: eligible }, { edition: null });
  const jobsByKey = new Map(view.jobs.map(job => [job.key, job]));
  const runsByJob = new Map();
  for (const run of view.runs) { if (!runsByJob.has(run.jobKey)) runsByJob.set(run.jobKey, []); runsByJob.get(run.jobKey).push(run); }
  const sourcesByEvent = new Map(eligible.map(row => [row.id, row.sources.map(source => source.sourceId)]));
  const policySnapshots = (policies ?? serviceState(state).policies).map(snapshotPolicy).sort((a, b) => a.id.localeCompare(b.id));
  const findings = [], observations = [];
  for (const policy of policySnapshots) {
    const start = Date.parse(policy.effectiveFrom), job = jobsByKey.get(policy.jobKey);
    const runs = runsByJob.get(policy.jobKey) ?? [];
    const completed = runs.filter(run => run.state === "COMPLETE" && run.endedAt)
      .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt) || a.key.localeCompare(b.key));
    const latest = completed[0] ?? null;
    const active = runs.filter(run => ["START", "RUNNING"].includes(run.state));
    const row = { policyId: policy.id, policyVersion: policy.version, title: policy.title, jobKey: policy.jobKey,
      owner: policy.owner, runbook: policy.runbook, enabled: policy.enabled, state: "satisfied",
      lastCompletedAt: latest?.endedAt ?? null, lastCompletedRunKey: latest?.key ?? null,
      observedRuns: runs.length, activeRuns: active.length, findingIds: [], notes: [] };
    observations.push(row);
    if (!policy.enabled) { row.state = "disabled"; continue; }
    if (start > now) { row.state = "not-started"; continue; }
    if (!runs.length) row.state = "awaiting-observation";
    if (!job) row.notes.push("No accepted job observation is present in this selection.");
    function finding(kind, run, anchor, summary, measuredSeconds = null, thresholdSeconds = null, dueAt = null) {
      const nativeEvents = run?.eventIds ?? [];
      const id = digest(["openlineage-service-level", policy.id, policy.version, kind, run?.key ?? null, anchor]);
      const value = { id, policyId: policy.id, policyVersion: policy.version, jobKey: policy.jobKey, runKey: run?.key ?? null,
        kind, summary, owner: policy.owner, runbook: policy.runbook, eventIds: [...nativeEvents], sourceIds: evidence(sourcesByEvent, nativeEvents),
        asOf: at, observedAt: run?.endedAt ?? run?.lastEventAt ?? null, dueAt, measuredSeconds, thresholdSeconds };
      findings.push(value); row.findingIds.push(id); row.state = "violated";
    }
    if (policy.maxCompletionAgeSeconds) {
      const last = latest ? Date.parse(latest.endedAt) : null;
      const anchor = Math.max(start, last ?? start), due = anchor + policy.maxCompletionAgeSeconds * 1000;
      if (now > due) finding(latest ? "completion-stale" : "completion-unobserved", latest,
        latest && last >= start ? latest.endedAt : policy.effectiveFrom,
        latest ? "The latest observed successful completion exceeds the saved freshness interval." : "No successful completion has been observed by the saved deadline.",
        (now - anchor) / 1000, policy.maxCompletionAgeSeconds, new Date(due).toISOString());
    }
    const windowStart = Math.max(start, now - policy.failureWindowSeconds * 1000);
    if (policy.monitorFailures) for (const run of runs) {
      if (["FAIL", "ABORT"].includes(run.state) && run.endedAt && Date.parse(run.endedAt) >= windowStart)
        finding(run.state === "FAIL" ? "run-failed" : "run-aborted", run, run.endedAt,
          "The original producer reported " + run.state + " within the saved observation window.");
    }
    if (policy.maxDurationSeconds) for (const run of runs) {
      if (evaluationVersion === 1 && !run.startedAt) {
        if (["START", "RUNNING"].includes(run.state)) row.notes.push("Run " + run.runId + " has no original START timestamp; elapsed duration is unavailable.");
        continue;
      }
      const terminal = ["COMPLETE", "FAIL", "ABORT"].includes(run.state);
      if (terminal && (!run.endedAt || Date.parse(run.endedAt) < windowStart)) continue;
      if (!terminal && !["START", "RUNNING"].includes(run.state)) continue;
      if (!run.startedAt) {
        row.notes.push("Run " + run.runId + " has no original START timestamp; elapsed duration is unavailable.");
        if (row.state !== "violated") row.state = "awaiting-observation";
        continue;
      }
      const ended = terminal ? Date.parse(run.endedAt) : now;
      const elapsed = (ended - Date.parse(run.startedAt)) / 1000;
      if (elapsed > policy.maxDurationSeconds) finding(terminal ? "run-duration-exceeded" : "run-overdue", run, run.startedAt,
        terminal ? "The observed run duration exceeds the saved maximum." : "The observed active run exceeds the saved maximum duration.",
        elapsed, policy.maxDurationSeconds, new Date(Date.parse(run.startedAt) + policy.maxDurationSeconds * 1000).toISOString());
    }
  }
  findings.sort((a, b) => a.policyId.localeCompare(b.policyId) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { schema: "commons.openlineage.service-level-assessment.v1", evaluationVersion, workspaceId: state.workspaceId,
    sourceRevision: sourceRevision ?? state.revision, editionId, asOf: at,
    eventIds: selected.eventIds, sourceIds: selected.sourceIds, policySnapshots, observations, findings,
    coverage: { selectedEvents: selected.rows.length, eligibleEvents: eligible.length,
      projectedEvents: view.projectedCount, excludedFutureEvents: future.length, invalidTimeEvents: eligible.filter(row => !Number.isFinite(Date.parse(row.event?.eventTime))).length,
      diagnostics: view.diagnostics } };
}
export function validateServiceLevels(state, { deep = false } = {}) {
  if (state.serviceLevels === undefined) return;
  const value = state.serviceLevels;
  if (!record(value) || value.schema !== SERVICE_LEVELS_SCHEMA) fail("Invalid service-level workspace state", 409);
  for (const key of ["policies", "assessments", "incidents"]) if (!Array.isArray(value[key])) fail("Invalid service-level " + key, 409);
  const policyIds = unique(value.policies, "service-level policy"), policyVersions = new Map();
  for (const policy of value.policies) {
    policyVersions.set(policy.id + ":" + policy.version, snapshotPolicy(policy));
    if (!Number.isSafeInteger(policy.version) || policy.version < 1 || !Array.isArray(policy.history) || policy.history.length !== policy.version - 1) fail("Invalid service-level policy revision", 409);
    instant(policy.createdAt, "policy createdAt"); instant(policy.updatedAt, "policy updatedAt"); text(policy.reason, "policy reason");
    if (policy.history.some((prior, index) => prior.version !== index + 1)) fail("Policy history must retain every original version", 409);
    for (const prior of policy.history) {
      policyVersions.set(prior.id + ":" + prior.version, snapshotPolicy(prior));
      if (prior.id !== policy.id || !Number.isSafeInteger(prior.version) || prior.version < 1 || prior.version >= policy.version) fail("Invalid prior policy revision", 409);
    }
  }
  const assessmentIds = unique(value.assessments, "service-level assessment"), findingMap = new Map();
  let lastAppliedAt = null, lastApplied = null;
  for (const saved of value.assessments) {
    if (!record(saved.assessment) || digest(saved.assessment) !== saved.assessmentSha256 ||
        saved.assessment.workspaceId !== state.workspaceId || typeof saved.appliedToIncidents !== "boolean") fail("Invalid saved service-level assessment", 409);
    const assessment = saved.assessment;
    if (assessment.evaluationVersion !== undefined && ![1, 2].includes(assessment.evaluationVersion)) fail("Unsupported saved service-level evaluation version", 409);
    instant(assessment.asOf); instant(saved.createdAt, "assessment createdAt");
    if (saved.appliedToIncidents) {
      if (assessment.editionId !== null || (lastAppliedAt !== null && Date.parse(assessment.asOf) < lastAppliedAt)) fail("Incident assessments require current selection in observation order", 409);
      lastAppliedAt = Date.parse(assessment.asOf); lastApplied = saved;
    }
    if (!Array.isArray(assessment.policySnapshots)) fail("Assessment requires its original policy versions", 409);
    for (const snapshot of assessment.policySnapshots) {
      const original = policyVersions.get(snapshot.id + ":" + snapshot.version);
      if (!original || canonical(original) !== canonical(snapshot)) fail("Assessment policy differs from its saved policy version", 409);
    }
    if (!Number.isSafeInteger(assessment.sourceRevision) || assessment.sourceRevision < 0 ||
        assessment.sourceRevision >= state.revision || !Array.isArray(assessment.findings)) fail("Invalid assessment source revision", 409);
    for (const finding of assessment.findings) findingMap.set(saved.id + ":" + finding.id, finding);
    if (deep) {
      const versions = assessment.evaluationVersion === undefined ? [2, 1] : [assessment.evaluationVersion];
      const recorded = canonical(assessment);
      const matches = versions.some(evaluationVersion => {
        const actual = evaluateServiceLevels(state, { asOf: assessment.asOf, editionId: assessment.editionId,
          policies: assessment.policySnapshots, eventIds: assessment.eventIds, sourceIds: assessment.sourceIds,
          sourceRevision: assessment.sourceRevision, evaluationVersion });
        if (assessment.evaluationVersion === undefined) delete actual.evaluationVersion;
        return canonical(actual) === recorded;
      });
      if (!matches) fail("Saved assessment differs from original events or policy", 409, { assessmentId: saved.id });
    }
  }
  unique(value.incidents, "service-level incident");
  for (const incident of value.incidents) {
    if (!policyIds.has(incident.policyId) || !STATES.has(incident.status) || typeof incident.active !== "boolean" ||
        !assessmentIds.has(incident.firstAssessmentId) || !assessmentIds.has(incident.lastAssessmentId) || !assessmentIds.has(incident.lastObservedAssessmentId) ||
        !Array.isArray(incident.history) || !findingMap.has(incident.firstAssessmentId + ":" + incident.id) ||
        !findingMap.has(incident.lastObservedAssessmentId + ":" + incident.id))
      fail("Invalid service-level incident history", 409);
    if (deep && canonical(incident.originalFinding) !== canonical(findingMap.get(incident.firstAssessmentId + ":" + incident.id)))
      fail("Incident original finding differs from its recorded assessment", 409);
    if (deep && canonical(incident.latestFinding) !== canonical(findingMap.get(incident.lastObservedAssessmentId + ":" + incident.id)))
      fail("Incident latest finding differs from its recorded assessment", 409);
    if (deep && lastApplied && (incident.lastAssessmentId !== lastApplied.id || incident.active !== findingMap.has(lastApplied.id + ":" + incident.id)))
      fail("Incident current condition differs from its latest applied assessment", 409);
    for (const change of incident.history) {
      instant(change.at, "incident history timestamp");
      if (change.assessmentId && !assessmentIds.has(change.assessmentId)) fail("Incident history references an absent assessment", 409);
    }
  }
  if (deep && lastApplied && lastApplied.assessment.findings.some(finding => !value.incidents.some(incident => incident.id === finding.id)))
    fail("Latest applied finding is missing from the incident desk", 409);
}
function normalizeActionArgs(action, args) {
  const common = ["operationId", "expectedRevision"];
  const allowed = {
    "service-levels.read": [],
    "service-levels.policy.save": [...common, "policy", "reason"],
    "service-levels.evaluate": ["asOf", "editionId"],
    "service-levels.assessment.save": [...common, "asOf", "editionId", "applyToIncidents"],
    "service-levels.incident.review": [...common, "id", "decision", "reason", "owner"],
    "service-levels.report": ["assessmentId", "format"]
  }[action];
  if (!allowed) fail("Unknown service-level action", 404);
  for (const key of Object.keys(args)) if (!allowed.includes(key)) fail("Unknown service-level argument " + key);
}
// One original policy revision constructor is shared by single-policy and reviewed batch saves.
export function servicePolicyRevision(prior, policy, reason, operationId, workspaceId, { at = new Date().toISOString(), newId } = {}) {
  const id = prior?.id ?? newId ?? digest([workspaceId, "service-level-policy", operationId]);
  return { ...policy, id, version: (prior?.version ?? 0) + 1, reason, createdAt: prior?.createdAt ?? at, updatedAt: at,
    history: prior ? [...prior.history, clone({ ...prior, history: undefined })].map(item => JSON.parse(JSON.stringify(item))) : [] };
}
export async function serviceLevelAction(workspace, action, args = {}) {
  if (!record(args)) fail("Service-level action arguments must be an object");
  normalizeActionArgs(action, args);
  if (action === "service-levels.read") {
    const state = await workspace.read();
    return { workspaceId: state.workspaceId, revision: state.revision, ...clone(serviceState(state)) };
  }
  if (action === "service-levels.evaluate") return evaluateServiceLevels(await workspace.read(), args);
  if (action === "service-levels.report") return serviceLevelReport(await workspace.read(), args);
  const revision = args.expectedRevision, operationId = text(args.operationId, "operationId", { maximum: 400 });
  if (action === "service-levels.policy.save") {
    const policy = normalizePolicy(args.policy), reason = text(args.reason, "reason");
    return workspace.change(operationId, { action, policy, reason }, revision, state => {
      const service = state.serviceLevels ??= emptyState();
      const prior = policy.id ? service.policies.find(item => item.id === policy.id) : null;
      if (policy.id && !prior) fail("Unknown service-level policy", 404);
      const saved = servicePolicyRevision(prior, policy, reason, operationId, state.workspaceId);
      if (prior) service.policies[service.policies.findIndex(item => item.id === saved.id)] = saved;
      else service.policies.push(saved);
      return { policy: saved };
    });
  }
  if (action === "service-levels.assessment.save") {
    const asOf = instant(args.asOf), editionId = args.editionId ?? null, applyToIncidents = args.applyToIncidents ?? true;
    if (typeof applyToIncidents !== "boolean") fail("applyToIncidents must be a boolean");
    if (applyToIncidents && editionId !== null) fail("Historical edition assessments use applyToIncidents:false");
    return workspace.change(operationId, { action, asOf, editionId, applyToIncidents }, revision, state => {
      const service = state.serviceLevels ??= emptyState();
      const applied = service.assessments.filter(item => item.appliedToIncidents);
      const last = applied.at(-1);
      if (applyToIncidents && last && Date.parse(asOf) < Date.parse(last.assessment.asOf))
        fail("Record an older assessment without changing the current incident desk", 409, { latestIncidentAsOf: last.assessment.asOf });
      const assessment = evaluateServiceLevels(state, { asOf, editionId });
      const id = digest([state.workspaceId, "service-level-assessment", operationId]);
      const saved = { id, createdAt: new Date().toISOString(), appliedToIncidents: applyToIncidents, assessmentSha256: digest(assessment), assessment };
      service.assessments.push(saved);
      if (applyToIncidents) {
        const current = new Map(assessment.findings.map(finding => [finding.id, finding]));
        for (const incident of service.incidents) {
          const finding = current.get(incident.id), active = Boolean(finding);
          if (incident.active !== active) incident.history.push({ at: asOf, action: active ? "observed-again" : "condition-clear", assessmentId: id });
          incident.active = active; incident.lastAssessmentId = id; incident.lastEvaluatedAt = asOf;
          if (active) {
            incident.lastSeenAt = asOf; incident.latestFinding = clone(finding); incident.lastObservedAssessmentId = id;
            if (incident.status === "resolved") {
              incident.status = "open";
              incident.history.push({ at: asOf, action: "reopened-by-observation", assessmentId: id });
            }
          }
          current.delete(incident.id);
        }
        for (const finding of current.values()) service.incidents.push({
          id: finding.id, policyId: finding.policyId, status: "open", active: true, owner: finding.owner,
          firstSeenAt: asOf, lastSeenAt: asOf, lastEvaluatedAt: asOf, firstAssessmentId: id, lastAssessmentId: id, lastObservedAssessmentId: id,
          originalFinding: clone(finding), latestFinding: clone(finding),
          history: [{ at: asOf, action: "opened", assessmentId: id }]
        });
      }
      return { assessment: saved, incidentCount: service.incidents.length };
    });
  }
  if (action === "service-levels.incident.review") {
    const id = text(args.id, "incident id"), reason = text(args.reason, "reason");
    const decision = text(args.decision, "decision"), owner = text(args.owner, "owner", { optional: true, maximum: 400 });
    if (!REVIEW_ACTIONS.has(decision)) fail("Choose acknowledge, assign, resolve, accept or reopen");
    if (decision === "assign" && !owner) fail("An assignment requires an owner");
    return workspace.change(operationId, { action, id, decision, reason, owner }, revision, state => {
      const incident = serviceState(state).incidents.find(item => item.id === id);
      if (!incident) fail("Unknown service-level incident", 404);
      if (decision === "resolve" && incident.active) fail("The saved assessment still observes this condition; record a later clear assessment or explicitly accept it", 409);
      const before = { status: incident.status, owner: incident.owner };
      if (decision === "acknowledge") incident.status = "acknowledged";
      if (decision === "resolve") incident.status = "resolved";
      if (decision === "accept") incident.status = "accepted";
      if (decision === "reopen") incident.status = "open";
      if (owner || decision === "assign") incident.owner = owner;
      incident.history.push({ at: new Date().toISOString(), action: decision, reason, owner: incident.owner,
        before, after: { status: incident.status, owner: incident.owner }, assessmentId: incident.lastAssessmentId });
      return { incident: clone(incident) };
    });
  }
}
export function serviceLevelReport(state, { assessmentId = null, format = "json" } = {}) {
  if (!["json", "csv", "html"].includes(format)) fail("Use json, csv or html");
  const service = serviceState(state), saved = assessmentId ? service.assessments.find(item => item.id === assessmentId) : service.assessments.at(-1) ?? null;
  if (assessmentId && !saved) fail("Unknown saved service-level assessment", 404);
  const report = { schema: "commons.openlineage.service-level-report.v1", workspaceId: state.workspaceId, title: state.title, revision: state.revision,
    policies: clone(service.policies), assessment: clone(saved), incidents: clone(service.incidents) };
  if (format === "json") return { mediaType: "application/json", text: JSON.stringify(report, null, 2) };
  const rows = [
    { kind: "workspace", id: state.workspaceId, job: "", state: String(state.revision), owner: "", detail: { workspaceId: state.workspaceId, title: state.title, revision: state.revision } },
    ...(saved ? [{ kind: "assessment", id: saved.id, job: "", state: saved.appliedToIncidents ? "applied" : "historical", owner: "", detail: saved }] : []),
    ...report.policies.map(value => ({ kind: "policy", id: value.id, job: value.jobKey, state: value.enabled ? "enabled" : "disabled", owner: value.owner, detail: value })),
    ...(saved?.assessment.observations ?? []).map(value => ({ kind: "observation", id: value.policyId, job: value.jobKey, state: value.state, owner: value.owner, detail: value })),
    ...(saved?.assessment.findings ?? []).map(value => ({ kind: "finding", id: value.id, job: value.jobKey, state: value.kind, owner: value.owner, detail: value })),
    ...report.incidents.map(value => ({ kind: "incident", id: value.id, job: value.originalFinding.jobKey, state: value.status, owner: value.owner, detail: value }))
  ];
  if (format === "csv") return { mediaType: "text/csv", text: csv(rows, ["kind", "id", "job", "state", "owner", "detail"]) };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const block = (title, values) => "<section><h2>" + escape(title) + " (" + values.length + ")</h2>" +
    values.map(value => "<article><h3>" + escape(value.title ?? value.summary ?? value.id ?? value.policyId) + "</h3><pre>" + escape(JSON.stringify(value, null, 2)) + "</pre></article>").join("") + "</section>";
  return { mediaType: "text/html", text: "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>" + escape(state.title) + " — Service levels</title>" +
    "<style>body{font:14px/1.5 system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#202020;background:#fff}h1{font-size:27px}h2{font-size:20px;margin-top:32px}h3{font-size:15px}article{border:1px solid #bbb;padding:16px;margin:12px 0;break-inside:avoid}pre{font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}h2{break-after:avoid}}</style></head><body><h1>" +
    escape(state.title) + " — Pipeline service levels</h1><p>Workspace " + escape(state.workspaceId) + " · revision " + state.revision + "</p><p>Saved assessment: " +
    escape(saved?.id ?? "none") + " · as of " + escape(saved?.assessment.asOf ?? "not evaluated") + " · source revision " + escape(saved?.assessment.sourceRevision ?? "") +
    "</p><p>The report carries saved policy versions, observed event references, complete findings, and operator incident history. The original workspace export carries the complete event files and editable application.</p>" +
    block("Assessment context", saved ? [{ id: saved.id, createdAt: saved.createdAt, appliedToIncidents: saved.appliedToIncidents,
      assessmentSha256: saved.assessmentSha256, ...Object.fromEntries(Object.entries(saved.assessment).filter(([key]) => !["observations", "findings"].includes(key))) }] : []) +
    block("Policies", report.policies) + block("Observed service levels", saved?.assessment.observations ?? []) +
    block("Findings", saved?.assessment.findings ?? []) + block("Incident decisions", report.incidents) + "</body></html>" };
}
