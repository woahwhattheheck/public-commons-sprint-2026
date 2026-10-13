// MIT. Compare immutable quality evaluations and retain explicit operator follow-up.
import { clone, canonical, digest } from "./model.mjs";
import { QualityError, qualityState, normalizeRule } from "./quality.mjs";

export const FOLLOWUP_SCHEMA = "commons.openlineage.quality-followup.v1";
export const COMPARISON_SCHEMA = "commons.openlineage.quality-comparison.v1";
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, name) => {
  if (typeof value !== "string" || !value.trim()) throw new QualityError(name + " is required");
  return value;
};
const same = (a, b) => canonical(a) === canonical(b);
const hash = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const decisions = new Set(["open", "investigating", "accepted", "resolved"]);
const sorted = values => [...values].sort();
function uniqueRows(rows, label) {
  if (!Array.isArray(rows)) throw new QualityError(label + " must be an array");
  const ids = new Set();
  for (const row of rows) {
    if (!record(row) || !text(row.id, label + " identity") || ids.has(row.id))
      throw new QualityError("Duplicate " + label + " identity");
    ids.add(row.id);
  }
  return rows;
}
function savedEvaluation(state, id) {
  text(id, "Saved evaluation ID");
  const row = qualityState(state).evaluations.find(value => value.id === id);
  if (!row) throw new QualityError("Unknown saved quality evaluation", 404);
  const { contentSha256, ...body } = row;
  if (row.workspaceId !== state.workspaceId || !hash.test(contentSha256 ?? "") || digest(body) !== contentSha256)
    throw new QualityError("The original saved evaluation content differs", 409);
  uniqueRows(row.findings, "quality finding");
  return row;
}
function pairList(value, beforeField, afterField, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new QualityError(label + " must be an array");
  const left = new Set(), right = new Set();
  const result = value.map(row => {
    if (!record(row) || Object.keys(row).some(key => ![beforeField, afterField].includes(key)))
      throw new QualityError("Use the exact before and after identities for " + label);
    const before = text(row[beforeField], label + " before"), after = text(row[afterField], label + " after");
    if (left.has(before) || right.has(after)) throw new QualityError(label + " must be one-to-one");
    left.add(before); right.add(after);
    return { [beforeField]: before, [afterField]: after };
  });
  return result.sort((a, b) => a[beforeField].localeCompare(b[beforeField]));
}
function runs(evaluation) {
  const result = new Map();
  for (const finding of evaluation.findings) if (finding.runKey !== null) {
    const prior = result.get(finding.runKey);
    if (prior && prior.jobKey !== finding.jobKey) throw new QualityError("A saved run has conflicting job identities", 409);
    result.set(finding.runKey, { runKey: finding.runKey, jobKey: finding.jobKey });
  }
  return result;
}
function facetName(finding) {
  const match = /\/(?:facets|inputFacets|outputFacets)\/([^/]+)$/.exec(finding.facetPath ?? "");
  return match ? match[1].replaceAll("~1", "/").replaceAll("~0", "~") : null;
}
function assertionIdentity(finding) {
  if (!finding.assertion) return null;
  const assertion = finding.assertion;
  return { name: assertion.name, assertion: assertion.assertion, column: assertion.column ?? null };
}
function checkIdentity(finding) {
  return finding.ruleId === null
    ? { kind: "producer-assertion", assertion: assertionIdentity(finding) }
    : { kind: "rule", id: finding.ruleId };
}
function sourceIdentity(evaluation) {
  return { id: evaluation.id, title: evaluation.title, contentSha256: evaluation.contentSha256,
    revision: evaluation.revision, edition: evaluation.edition, datasetKey: evaluation.datasetKey,
    runKey: evaluation.runKey, createdAt: evaluation.createdAt, selectionSha256: evaluation.selectionSha256,
    ruleSetSha256: evaluation.ruleSetSha256, adapterVersion: evaluation.adapterVersion,
    upstreamCommit: evaluation.upstreamCommit, eventIds: clone(evaluation.eventIds),
    sourceIds: clone(evaluation.sourceIds), ruleVersions: clone(evaluation.ruleVersions), runs: [...runs(evaluation).values()] };
}
function setChange(before, after) {
  const b = new Set(before), a = new Set(after);
  return { added: after.filter(value => !b.has(value)), removed: before.filter(value => !a.has(value)),
    retained: before.filter(value => a.has(value)) };
}
function ruleFor(evaluation, finding) {
  if (finding.ruleId === null) return null;
  const row = evaluation.ruleVersions.find(rule => rule.id === finding.ruleId && rule.version === finding.ruleVersion);
  if (!row) throw new QualityError("Finding refers to an absent original rule version", 409);
  return row;
}
function changesFor(before, after, beforeEvaluation, afterEvaluation) {
  const changes = [];
  for (const field of ["status", "severity", "actual", "expected", "runKey", "eventId", "eventTime",
    "observationId", "scope", "facetPath", "schemaURL", "sources", "message", "title"])
    if (!same(before[field] ?? null, after[field] ?? null)) changes.push(field);
  const br = ruleFor(beforeEvaluation, before), ar = ruleFor(afterEvaluation, after);
  const definitionChanged = !same(br ? normalizeRule(br) : null, ar ? normalizeRule(ar) : null) ||
    !same(before.assertion ? { ...before.assertion.original, success: null, actual: null } : null,
      after.assertion ? { ...after.assertion.original, success: null, actual: null } : null);
  if (definitionChanged) changes.push("definition");
  if (before.ruleVersion !== after.ruleVersion) changes.push("ruleVersion");
  return { changes, definitionChanged, beforeRule: clone(br), afterRule: clone(ar),
    statusTransition: before.status + " → " + after.status,
    outcomeChanged: before.status !== after.status,
    valueChanged: !same(before.actual, after.actual) };
}
export function compareQualityEvaluations(state, args = {}) {
  const before = savedEvaluation(state, args.beforeEvaluationId), after = savedEvaluation(state, args.afterEvaluationId);
  if (before.id === after.id) throw new QualityError("Choose two different saved quality evaluations");
  const runPairs = pairList(args.runPairs, "beforeRunKey", "afterRunKey", "Run correspondences");
  const findingPairs = pairList(args.findingPairs, "beforeFindingId", "afterFindingId", "Finding correspondences");
  const beforeRuns = runs(before), afterRuns = runs(after), runForward = new Map(), runReverse = new Map();
  for (const pair of runPairs) {
    const b = beforeRuns.get(pair.beforeRunKey), a = afterRuns.get(pair.afterRunKey);
    if (!b || !a || b.jobKey !== a.jobKey || b.jobKey === null)
      throw new QualityError("Run correspondence must select original runs of the same named job");
    runForward.set(pair.beforeRunKey, pair.afterRunKey); runReverse.set(pair.afterRunKey, pair.beforeRunKey);
  }
  const runIdentity = (finding, side) => {
    const key = finding.runKey;
    if (key === null) return null;
    if (side === "before") return runForward.has(key) ? ["mapped", key] : runReverse.has(key) ? ["before", key] : ["same", key];
    return runReverse.has(key) ? ["mapped", runReverse.get(key)] : runForward.has(key) ? ["after", key] : ["same", key];
  };
  const baseIdentity = (finding, side) => canonical({ datasetKey: finding.datasetKey, jobKey: finding.jobKey,
    run: runIdentity(finding, side), direction: finding.direction, check: checkIdentity(finding) });
  const compatible = (b, a) => baseIdentity(b, "before") === baseIdentity(a, "after") &&
    (!b.scope || !a.scope || b.scope === a.scope) &&
    (!facetName(b) || !facetName(a) || facetName(b) === facetName(a)) &&
    (!b.assertion || !a.assertion || same(assertionIdentity(b), assertionIdentity(a)));
  const beforeMap = new Map(before.findings.map(row => [row.id, row])), afterMap = new Map(after.findings.map(row => [row.id, row]));
  const usedBefore = new Set(), usedAfter = new Set(), rows = [];
  const add = (kind, b, a, method = null, candidates = []) => {
    const beforeIds = sorted(b.map(row => row.id)), afterIds = sorted(a.map(row => row.id));
    const id = digest({ before: before.contentSha256, after: after.contentSha256, kind, beforeIds, afterIds });
    rows.push({ id, kind, method, before: clone(b), after: clone(a), candidates: clone(candidates),
      ...(kind === "matched" ? changesFor(b[0], a[0], before, after) : {
        changes: [], definitionChanged: false, beforeRule: b.length === 1 ? clone(ruleFor(before, b[0])) : null,
        afterRule: a.length === 1 ? clone(ruleFor(after, a[0])) : null, statusTransition: null, outcomeChanged: false, valueChanged: false
      }) });
    b.forEach(row => usedBefore.add(row.id)); a.forEach(row => usedAfter.add(row.id));
  };
  for (const pair of findingPairs) {
    const b = beforeMap.get(pair.beforeFindingId), a = afterMap.get(pair.afterFindingId);
    if (!b || !a || !compatible(b, a))
      throw new QualityError("Finding correspondence must retain the original dataset, job, selected run correspondence, direction and check");
    add("matched", [b], [a], "explicit");
  }
  // Resolve only mutual unique edges. Multiple same-name assertions remain operator decisions.
  const remainingBefore = before.findings.filter(row => !usedBefore.has(row.id));
  const remainingAfter = after.findings.filter(row => !usedAfter.has(row.id));
  const beforeGroups = new Map(), afterGroups = new Map();
  for (const [items, groups, side] of [[remainingBefore, beforeGroups, "before"], [remainingAfter, afterGroups, "after"]])
    for (const item of items) {
      const key = baseIdentity(item, side);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
  const forward = new Map(remainingBefore.map(b => [b.id,
    (afterGroups.get(baseIdentity(b, "before")) ?? []).filter(a => compatible(b, a)).map(a => a.id)]));
  const reverse = new Map(remainingAfter.map(a => [a.id,
    (beforeGroups.get(baseIdentity(a, "after")) ?? []).filter(b => compatible(b, a)).map(b => b.id)]));
  for (const b of remainingBefore) {
    const matches = forward.get(b.id);
    if (matches.length === 1 && reverse.get(matches[0]).length === 1)
      add("matched", [b], [afterMap.get(matches[0])], "unique-original-identity");
  }
  for (const b of remainingBefore) if (!usedBefore.has(b.id) && !forward.get(b.id).length) add("before-only", [b], []);
  for (const a of remainingAfter) if (!usedAfter.has(a.id) && !reverse.get(a.id).length) add("after-only", [], [a]);
  for (const first of remainingBefore) {
    if (usedBefore.has(first.id)) continue;
    const bs = new Set([first.id]), as = new Set(), queue = [["before", first.id]];
    for (let index = 0; index < queue.length; index++) {
      const [side, id] = queue[index];
      if (side === "before") for (const candidate of forward.get(id) ?? []) {
        if (!as.has(candidate) && !usedAfter.has(candidate)) { as.add(candidate); queue.push(["after", candidate]); }
      } else for (const candidate of reverse.get(id) ?? []) {
        if (!bs.has(candidate) && !usedBefore.has(candidate)) { bs.add(candidate); queue.push(["before", candidate]); }
      }
    }
    const candidates = [...bs].flatMap(b => (forward.get(b) ?? []).filter(a => as.has(a)).map(a => ({
      beforeFindingId: b, afterFindingId: a
    })));
    add("ambiguous", [...bs].map(id => beforeMap.get(id)), [...as].map(id => afterMap.get(id)), null, candidates);
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const summary = { matched: 0, beforeOnly: 0, afterOnly: 0, ambiguous: 0, changedOutcomes: 0,
    changedDefinitions: 0, beforeFindings: before.findings.length, afterFindings: after.findings.length };
  for (const row of rows) {
    summary[row.kind === "before-only" ? "beforeOnly" : row.kind === "after-only" ? "afterOnly" : row.kind]++;
    if (row.outcomeChanged) summary.changedOutcomes++;
    if (row.definitionChanged) summary.changedDefinitions++;
  }
  const body = { schema: COMPARISON_SCHEMA, workspaceId: state.workspaceId, revision: state.revision,
    before: sourceIdentity(before), after: sourceIdentity(after), runPairs, findingPairs, rows, summary,
    selectionChanges: { adapterChanged: !same(before.adapterVersion, after.adapterVersion),
      upstreamChanged: !same(before.upstreamCommit, after.upstreamCommit), filtersChanged: !same([before.edition, before.datasetKey, before.runKey], [after.edition, after.datasetKey, after.runKey]),
      events: setChange(before.eventIds, after.eventIds), sources: setChange(before.sourceIds, after.sourceIds),
      rules: setChange(before.ruleVersions.map(row => row.id), after.ruleVersions.map(row => row.id)) } };
  return { ...body, comparisonSha256: digest(body) };
}
export function qualityFollowupState(state) {
  return state.qualityFollowup ?? { schema: FOLLOWUP_SCHEMA, comparisons: [], followups: [] };
}
function savedComparison(state, id) {
  const row = qualityFollowupState(state).comparisons.find(item => item.id === id);
  if (!row) throw new QualityError("Unknown saved quality comparison", 404);
  return row;
}
function dispositionVersion(state, value, row, comparison) {
  if (value === undefined || value === null) return null;
  if (!record(value) || row.before.length !== 1 || value.evaluationId !== comparison.before.id ||
    value.findingId !== row.before[0].id || !Number.isSafeInteger(value.version) || value.version < 1)
    throw new QualityError("Choose an exact earlier disposition version for this compared finding");
  const current = qualityState(state).dispositions.find(item => item.evaluationId === value.evaluationId && item.findingId === value.findingId);
  const found = current && [current, ...current.history].find(item => item.version === value.version);
  if (!found) throw new QualityError("The selected earlier disposition version is absent", 409);
  const { history, ...snapshot } = found;
  return clone(snapshot);
}
export function normalizeQualityFollowup(state, args) {
  const comparison = savedComparison(state, text(args.comparisonId, "Comparison ID"));
  const row = comparison.rows.find(value => value.id === text(args.rowId, "Comparison row"));
  if (!row || row.kind === "ambiguous" || row.after.length !== 1)
    throw new QualityError("Choose one resolved correspondence or one finding observed only in the later evaluation");
  const reason = text(args.reason, "Follow-up reason");
  if (!decisions.has(args.decision)) throw new QualityError("Choose open, investigating, accepted or resolved");
  const owner = args.owner ?? "", dueDate = args.dueDate ?? null;
  if (typeof owner !== "string") throw new QualityError("Follow-up owner must be text");
  if (dueDate !== null && (typeof dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
    !Number.isFinite(Date.parse(dueDate + "T00:00:00Z")) || new Date(dueDate + "T00:00:00Z").toISOString().slice(0, 10) !== dueDate))
    throw new QualityError("Due date must be a real YYYY-MM-DD date or null");
  const evidenceResultIds = args.evidenceResultIds ?? [];
  if (!Array.isArray(evidenceResultIds) || new Set(evidenceResultIds).size !== evidenceResultIds.length ||
    evidenceResultIds.some(id => typeof id !== "string" || !state.results.some(result => result.id === id)))
    throw new QualityError("Evidence must select distinct existing complete result files");
  const sourceDisposition = dispositionVersion(state, args.sourceDisposition, row, comparison);
  return { comparisonId: comparison.id, comparisonSha256: comparison.contentSha256, rowId: row.id,
    beforeEvaluationId: comparison.before.id, beforeFindingId: row.before[0]?.id ?? null,
    afterEvaluationId: comparison.after.id, afterFindingId: row.after[0].id,
    decision: args.decision, reason, owner, dueDate, evidenceResultIds: clone(evidenceResultIds), sourceDisposition };
}
export function qualityFollowupOverview(state) {
  const followup = qualityFollowupState(state);
  return { workspaceId: state.workspaceId, revision: state.revision,
    evaluations: qualityState(state).evaluations.map(sourceIdentity),
    comparisons: clone(followup.comparisons), followups: clone(followup.followups),
    dispositions: clone(qualityState(state).dispositions), evidence: clone(state.results) };
}
function exactSavedBody(value, label) {
  if (!record(value) || !hash.test(value.contentSha256 ?? "")) throw new QualityError("Invalid " + label);
  const { contentSha256, ...body } = value;
  if (digest(body) !== contentSha256) throw new QualityError(label + " content differs", 409);
}
export function validateQualityFollowup(state, { deep = false } = {}) {
  if (state.qualityFollowup === undefined) return state;
  const data = state.qualityFollowup;
  if (!record(data) || data.schema !== FOLLOWUP_SCHEMA) throw new QualityError("Invalid quality follow-up state");
  uniqueRows(data.comparisons, "quality comparison"); uniqueRows(data.followups, "quality follow-up");
  for (const row of data.comparisons) {
    exactSavedBody(row, "Saved quality comparison");
    text(row.title, "Comparison title"); text(row.createdAt, "Comparison time");
    if (row.workspaceId !== state.workspaceId || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision > state.revision)
      throw new QualityError("Invalid saved comparison workspace or revision");
    const before = savedEvaluation(state, row.before.id), after = savedEvaluation(state, row.after.id);
    if (before.contentSha256 !== row.before.contentSha256 || after.contentSha256 !== row.after.contentSha256)
      throw new QualityError("Comparison refers to changed original evaluations", 409);
    const { id, title, createdAt, contentSha256, ...preview } = row;
    const { comparisonSha256, ...body } = preview;
    if (digest(body) !== comparisonSha256) throw new QualityError("Saved comparison preview differs", 409);
    if (deep) {
      const actual = compareQualityEvaluations({ ...state, revision: row.revision }, {
        beforeEvaluationId: row.before.id, afterEvaluationId: row.after.id, runPairs: row.runPairs, findingPairs: row.findingPairs
      });
      if (!same(actual, preview)) throw new QualityError("Saved comparison differs from its original findings", 409);
    }
  }
  const targets = new Set();
  for (const current of data.followups) {
    const target = canonical([current.comparisonId, current.rowId]);
    if (targets.has(target)) throw new QualityError("Duplicate follow-up for one original compared finding");
    targets.add(target);
    if (!Array.isArray(current.history) || !Number.isSafeInteger(current.version) || current.version < 1 ||
      current.history.length !== current.version - 1) throw new QualityError("Invalid follow-up history");
    const versions = [...current.history, (({ history, ...value }) => value)(current)];
    for (let index = 0; index < versions.length; index++) {
      const row = versions[index];
      exactSavedBody(row, "Saved quality follow-up");
      if (row.id !== current.id || row.version !== index + 1 || row.workspaceId !== state.workspaceId ||
        !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision > state.revision)
        throw new QualityError("Invalid follow-up version identity");
      text(row.createdAt, "Follow-up creation time"); text(row.updatedAt, "Follow-up update time");
      const normalized = normalizeQualityFollowup(state, { ...row, sourceDisposition: row.sourceDisposition && {
        evaluationId: row.sourceDisposition.evaluationId, findingId: row.sourceDisposition.findingId, version: row.sourceDisposition.version
      } });
      for (const [key, value] of Object.entries(normalized)) if (!same(value, row[key]))
        throw new QualityError("Follow-up differs from its original comparison, disposition or evidence", 409);
      if (index && (row.createdAt !== versions[0].createdAt || row.comparisonId !== versions[0].comparisonId ||
        row.rowId !== versions[0].rowId || row.revision <= versions[index - 1].revision))
        throw new QualityError("Follow-up history changes its original compared finding");
    }
  }
  return state;
}
