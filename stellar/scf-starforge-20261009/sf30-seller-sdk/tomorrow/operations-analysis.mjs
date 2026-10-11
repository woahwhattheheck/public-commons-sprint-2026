import { createHash } from 'node:crypto';

/**
 * Pure operations projection over TomorrowWorkspace.editionView()/compare().
 * The original workspace owns acquisition, native weather rules, immutable
 * decisions, payment, source retention, and persistence.
 */
export const OPERATIONS_SCHEMA = 'stellar-forge.tomorrow.operations-review.v1';
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
};
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const text = value => value == null ? '' : String(value);
const list = value => Array.isArray(value) ? value : [];
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const instant = value => time(value) === null ? text(value) : new Date(time(value)).toISOString();
const refKey = (edition, interval) => JSON.stringify([edition, interval]);
const fieldKey = (edition, step, start, field) => JSON.stringify([edition, step, instant(start), field]);
const OPERATOR_LABELS = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤', '==': '=', '!=': '≠' };

export class OperationsReviewError extends Error {
  constructor(message, code = 'INVALID_OPERATIONS_INPUT') {
    super(message); this.name = 'OperationsReviewError'; this.code = code;
  }
}
function identity(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new OperationsReviewError(label + ' must be a non-empty string');
  return value;
}
function ruleView(rule) {
  const operator = text(rule.operator);
  const target = typeof rule.value === 'object' ? JSON.stringify(rule.value) : text(rule.value);
  return {
    id: text(rule.id), field: text(rule.field), operator, value: copy(rule.value ?? null),
    unit: text(rule.unit), label: text(rule.label),
    triggered: rule.triggered === true ? true : rule.triggered === false ? false : null,
    explanation: (text(rule.label) ? text(rule.label) + ': ' : '') +
      text(rule.field) + ' ' + (OPERATOR_LABELS[operator] || operator || 'operator not recorded') +
      ' ' + target + (rule.unit ? ' ' + rule.unit : ''),
  };
}
function issue(code, message, context = {}) {
  return { id: hash({ code, context }).slice(0, 24), code, message, ...context };
}
function sourceReference(edition, row, field) {
  const result = {
    editionId: edition.id, sourceSha256: edition.sourceSha256,
    intervalId: row.id, timestep: row.timestep, startTime: row.startTime, field: field.field,
  };
  if (typeof field.sourcePointer === 'string') result.sourcePointer = field.sourcePointer;
  return result;
}
function comparisonRows(comparison) {
  return Array.isArray(comparison.rows) ? comparison.rows : null;
}
function comparisonIdentity(comparison, side) {
  const value = comparison[side + 'Id'];
  return typeof value === 'string' ? value : value && typeof value.id === 'string' ? value.id : null;
}
function comparisonStatus(row) {
  return text(row.status).toLowerCase();
}
function comparisonChanged(row) {
  return ['changed', 'added_interval', 'removed_interval', 'missing_or_different_unit'].includes(comparisonStatus(row));
}

/**
 * Selected editions are the caller's scope. The latest acquisition among those
 * supplied is the active edition for each work plan; no global "latest" claim
 * is made. Input order breaks equal acquisition times, including two absent times.
 */
export function buildOperationsReview({ editionViews, comparisons = [] } = {}) {
  if (!Array.isArray(editionViews) || !Array.isArray(comparisons)) throw new OperationsReviewError('editionViews and comparisons must be arrays');
  const issues = [], editions = [], intervals = [], decisions = [], workByEdition = new Map();
  const editionIds = new Set(), intervalIds = new Set(), sourceDecisionIds = new Set();
  const currentDecision = new Map(), decisionCandidates = new Map(), byEdition = new Map();

  editionViews.forEach((view, position) => {
    if (!view || typeof view !== 'object' || !view.edition || !view.work) throw new OperationsReviewError('Each view needs edition and work');
    const nativeEdition = view.edition, work = view.work;
    const editionId = identity(nativeEdition.id, 'edition.id'), workId = identity(work.id, 'work.id');
    if (editionIds.has(editionId)) throw new OperationsReviewError('Duplicate edition view: ' + editionId);
    editionIds.add(editionId);
    if (nativeEdition.workId && nativeEdition.workId !== workId) throw new OperationsReviewError('Edition/work identity mismatch: ' + editionId);
    const timeline = nativeEdition.resources?.timeline ?? {};
    const receivedAt = timeline.receivedAt ?? nativeEdition.createdAt ?? null;
    const edition = {
      id: editionId, workId, state: nativeEdition.state ?? null,
      receivedAt, sourceSha256: timeline.sha256 ?? null,
      resource: copy(timeline), usage: copy(nativeEdition.usage ?? null),
      rawAvailability: copy(nativeEdition.rawAvailability ?? view.rawAvailability ?? null),
      rawExpiresAt: nativeEdition.rawExpiresAt ?? null,
      sourceError: view.sourceError ?? null,
      sourceExtent: copy(timeline.returnedExtent ?? null),
      location: copy(work.location), units: work.units ?? null,
      window: copy(work.window ?? null), selectedOrder: position,
      intervalCount: 0, withinWindowCount: 0, currentDecisionCount: 0, retainedDecisionIntervals: 0,
    };
    editions.push(edition); byEdition.set(editionId, edition); workByEdition.set(editionId, copy(work));
    for (const timestep of list(timeline.requestedTimestepsAbsent)) issues.push(issue('REQUESTED_TIMESTEP_ABSENT', 'The native source did not return requested timestep ' + text(timestep) + '.', { workId, editionId, timestep }));
    if (view.sourceError) issues.push(issue('SOURCE_VIEW_ERROR', 'The original workspace could not read this edition: ' + text(view.sourceError), { workId, editionId }));
    const seenNativeRows = new Set();
    for (const nativeRow of list(view.rows)) {
      const rowId = identity(nativeRow.id, 'rows[].id'), key = refKey(editionId, rowId);
      if (seenNativeRows.has(rowId) || intervalIds.has(key)) throw new OperationsReviewError('Duplicate interval identity in edition: ' + rowId);
      seenNativeRows.add(rowId); intervalIds.add(key);
      const row = {
        id: rowId, intervalId: rowId, workId, editionId, timestep: text(nativeRow.timestep),
        startTime: text(nativeRow.startTime), withinWindow: nativeRow.withinWindow === true,
        windowStatusKnown: typeof nativeRow.withinWindow === 'boolean',
        sourceSha256: edition.sourceSha256, observationAvailability: 'AVAILABLE',
        fields: [], rules: [], reasonCodes: [], needsReview: false,
        latestDecision: null, decisionHistory: [], changes: [], assignee: '',
      };
      for (const nativeField of list(nativeRow.fields)) {
        const rules = list(nativeField.rules).map(ruleView);
        const field = {
          field: text(nativeField.field), value: copy(nativeField.value ?? null),
          present: nativeField.present === true, unit: nativeField.unit ?? null,
          exposure: copy(nativeField.exposure ?? null), rules,
          quality: copy(nativeField.quality ?? null),
          source: sourceReference(edition, row, nativeField),
        };
        row.fields.push(field); row.rules.push(...rules);
      }
      row.hasTriggeredRule = row.rules.some(rule => rule.triggered === true);
      row.hasMissingValue = row.fields.some(field => !field.present || field.value === null || field.exposure === 'MISSING');
      row.hasUnknownRule = row.rules.some(rule => rule.triggered === null);
      if (!row.windowStatusKnown) issues.push(issue('WINDOW_SCOPE_UNAVAILABLE', 'The source view did not state whether this interval is inside the work window.', { editionId, intervalId: rowId }));
      if (time(row.startTime) === null) issues.push(issue('INTERVAL_TIME_UNPARSEABLE', 'The source interval time is retained as supplied and cannot be ordered as an instant.', { editionId, intervalId: rowId }));
      intervals.push(row); edition.intervalCount++; if (row.withinWindow) edition.withinWindowCount++;
    }
    // Reopened keyless work retains exact staff interval identities and choices,
    // while the original feed is absent. These are decision records, not new
    // observations or a reconstruction of the provider's values.
    if (edition.rawAvailability !== 'AVAILABLE' || edition.sourceError) {
      for (const retained of list(view.decisions)) {
        if (retained.editionId !== editionId || retained.sourceSha256 !== edition.sourceSha256 ||
            !retained.intervalId || !retained.timestep || time(retained.startTime) === null) continue;
        const key = refKey(editionId, retained.intervalId);
        if (intervalIds.has(key)) continue;
        const epoch = time(retained.startTime), start = time(work.window?.startTime), end = time(work.window?.endTime);
        const scopeKnown = start !== null && end !== null;
        const triggeredIds = new Set(list(retained.rulesTriggered));
        const rules = list(work.thresholds).filter(rule => triggeredIds.has(rule.id)).map(rule => ruleView({ ...rule, triggered: true }));
        intervals.push({ id: retained.intervalId, intervalId: retained.intervalId, workId, editionId, timestep: retained.timestep,
          startTime: retained.startTime, withinWindow: scopeKnown && epoch >= start && epoch < end,
          windowStatusKnown: scopeKnown, sourceSha256: edition.sourceSha256,
          observationAvailability: 'RETAINED_DECISION_ONLY', fields: [], rules,
          reasonCodes: [], needsReview: false, latestDecision: null, decisionHistory: [], changes: [], assignee: '',
          hasTriggeredRule: rules.length > 0, hasMissingValue: false, hasUnknownRule: false });
        intervalIds.add(key); edition.retainedDecisionIntervals++;
      }
    }
    for (const nativeDecision of list(view.decisions)) {
      const record = copy(nativeDecision);
      const id = identity(record.id, 'decisions[].id');
      const duplicateKey = refKey(editionId, id);
      if (sourceDecisionIds.has(duplicateKey)) {
        issues.push(issue('DUPLICATE_DECISION_ID', 'A repeated decision identity is retained only once.', { editionId, decisionId: id }));
        continue;
      }
      sourceDecisionIds.add(duplicateKey);
      record.workId = workId;
      record.applicability = 'HISTORICAL_REVISION';
      if (record.editionId !== editionId) record.applicability = 'OTHER_EDITION';
      else if (!Number.isInteger(record.revision) || record.revision < 1) record.applicability = 'INVALID_REVISION';
      else if (!intervalIds.has(refKey(editionId, record.intervalId))) record.applicability = 'INTERVAL_UNAVAILABLE';
      else if (!edition.sourceSha256 || record.sourceSha256 !== edition.sourceSha256) record.applicability = 'SOURCE_CHANGED';
      else if (!['PROCEED', 'RESCHEDULE', 'REVIEW', 'CANCEL'].includes(record.decision)) record.applicability = 'DECISION_UNRECORDED';
      else {
        const key = refKey(editionId, record.intervalId);
        if (!decisionCandidates.has(key)) decisionCandidates.set(key, []);
        decisionCandidates.get(key).push(record);
      }
      decisions.push(record);
    }
  });

  for (const [key, records] of decisionCandidates) {
    const maxRevision = Math.max(...records.map(record => record.revision));
    const newest = records.filter(record => record.revision === maxRevision);
    if (newest.length !== 1) {
      for (const record of newest) record.applicability = 'AMBIGUOUS_REVISION';
      issues.push(issue('AMBIGUOUS_DECISION_REVISION', 'Multiple immutable decisions have the same latest revision; no assignment or decision is selected silently.', { editionId: newest[0].editionId, intervalId: newest[0].intervalId, revision: maxRevision }));
      continue;
    }
    newest[0].applicability = 'CURRENT';
    currentDecision.set(key, newest[0]);
  }

  const nativeComparisons = comparisons.map(copy);
  const changesByField = new Map();
  for (const comparison of nativeComparisons) {
    const beforeId = comparisonIdentity(comparison, 'before'), afterId = comparisonIdentity(comparison, 'after');
    const rows = comparisonRows(comparison);
    if (!beforeId || !afterId || !rows) {
      issues.push(issue('COMPARISON_SHAPE_UNAVAILABLE', 'The original comparison is retained, but interval triage requires its explicit before/after edition IDs and rows.', { comparisonId: comparison.id ?? null }));
      continue;
    }
    if (comparison.comparable === false) {
      issues.push(issue('COMPARISON_NOT_COMPARABLE', 'The original workspace did not compare these editions: ' + text(comparison.reason), { beforeEditionId: beforeId, afterEditionId: afterId }));
      continue;
    }
    if (!byEdition.has(beforeId) || !byEdition.has(afterId)) {
      issues.push(issue('COMPARISON_EDITION_OUTSIDE_SELECTION', 'The comparison includes an edition outside the selected views; its original result is retained.', { beforeEditionId: beforeId, afterEditionId: afterId }));
    }
    for (const nativeRow of rows) {
      if (!comparisonChanged(nativeRow)) continue;
      if (nativeRow.status === 'REMOVED_INTERVAL') issues.push(issue('REFRESH_INTERVAL_REMOVED', 'The refreshed source omitted an earlier interval for ' + text(nativeRow.field) + '. Its original comparison remains visible; there is no new source row to approve.', { beforeEditionId: beforeId, editionId: afterId, timestep: nativeRow.timestep, startTime: nativeRow.startTime, field: nativeRow.field }));
      const startTime = nativeRow.startTime ?? nativeRow.time;
      const key = fieldKey(afterId, nativeRow.timestep, startTime, nativeRow.field);
      if (!changesByField.has(key)) changesByField.set(key, []);
      changesByField.get(key).push({
        beforeEditionId: beforeId, afterEditionId: afterId,
        timestep: nativeRow.timestep, startTime, field: nativeRow.field,
        unit: nativeRow.unit ?? null, status: nativeRow.status,
        before: copy(nativeRow.before ?? null), after: copy(nativeRow.after ?? null),
        change: copy(nativeRow.change ?? null),
        source: copy(nativeRow.source ?? null),
      });
    }
  }

  const decisionsByInterval = new Map();
  for (const record of decisions) {
    const key = refKey(record.editionId, record.intervalId);
    if (!decisionsByInterval.has(key)) decisionsByInterval.set(key, []);
    decisionsByInterval.get(key).push(record);
  }
  const activeEdition = new Map();
  for (const edition of editions) {
    const prior = activeEdition.get(edition.workId);
    const epoch = time(edition.receivedAt), priorEpoch = prior ? time(prior.receivedAt) : null;
    if (!prior || (epoch !== null && (priorEpoch === null || epoch > priorEpoch)) ||
        (epoch === priorEpoch && edition.selectedOrder > prior.selectedOrder)) activeEdition.set(edition.workId, edition);
  }
  for (const row of intervals) {
    const key = refKey(row.editionId, row.id);
    row.decisionHistory = (decisionsByInterval.get(key) ?? []).sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0) || text(a.id).localeCompare(text(b.id)));
    row.latestDecision = currentDecision.get(key) ?? null;
    row.assignee = text(row.latestDecision?.assignee);
    row.changes = row.fields.flatMap(field => changesByField.get(fieldKey(row.editionId, row.timestep, row.startTime, field.field)) ?? []);
    row.isActiveEdition = activeEdition.get(row.workId)?.id === row.editionId;
    if (row.latestDecision) byEdition.get(row.editionId).currentDecisionCount++;
    if (!row.latestDecision) row.reasonCodes.push('DECISION_NEEDED');
    if (row.latestDecision?.decision === 'REVIEW') row.reasonCodes.push('STAFF_REVIEW_REQUESTED');
    if (row.decisionHistory.some(record => ['SOURCE_CHANGED', 'AMBIGUOUS_REVISION', 'INVALID_REVISION'].includes(record.applicability))) row.reasonCodes.push('DECISION_HISTORY_REQUIRES_REVIEW');
    if (row.hasTriggeredRule) row.reasonCodes.push('THRESHOLD_MATCH');
    if (row.hasMissingValue) row.reasonCodes.push('VALUE_UNAVAILABLE');
    if (row.hasUnknownRule) row.reasonCodes.push('RULE_RESULT_UNAVAILABLE');
    if (row.changes.length) row.reasonCodes.push('FORECAST_CHANGED');
    if (row.observationAvailability === 'RETAINED_DECISION_ONLY') row.reasonCodes.push('SOURCE_VALUES_NO_LONGER_AVAILABLE');
    row.needsReview = row.withinWindow && (!row.latestDecision || row.latestDecision.decision === 'REVIEW');
  }

  const workPlans = [];
  for (const [workId, active] of activeEdition) {
    const work = workByEdition.get(active.id), rows = intervals.filter(row => row.workId === workId && row.isActiveEdition && row.withinWindow);
    workPlans.push({
      id: workId, title: text(work.title), location: copy(work.location), window: copy(work.window ?? null),
      units: work.units ?? null, thresholds: copy(list(work.thresholds)),
      activeEditionId: active.id, selectedEditionIds: editions.filter(edition => edition.workId === workId).map(edition => edition.id),
      sourceSha256: active.sourceSha256, acquiredAt: active.receivedAt,
      intervals: rows.length, reviewed: rows.filter(row => row.latestDecision).length,
      needsReview: rows.filter(row => row.needsReview).length,
      triggered: rows.filter(row => row.hasTriggeredRule).length,
      missingValues: rows.filter(row => row.hasMissingValue).length,
      changedIntervals: rows.filter(row => row.changes.length).length,
      sourceAvailable: rows.some(row => row.observationAvailability === 'AVAILABLE'),
      retainedDecisionIntervals: rows.filter(row => row.observationAvailability === 'RETAINED_DECISION_ONLY').length,
    });
    if (!rows.some(row => row.observationAvailability === 'AVAILABLE')) issues.push(issue('WORK_INTERVALS_UNAVAILABLE', 'Source values inside this selected work window are unavailable. Retained staff interval identities and decisions remain separate from observations.', { workId, editionId: active.id }));
  }
  const activeRows = intervals.filter(row => row.isActiveEdition && row.withinWindow);
  const queue = activeRows.filter(row => row.needsReview || row.hasTriggeredRule || row.hasMissingValue || row.hasUnknownRule || row.changes.length)
    .sort((a, b) => Number(b.needsReview) - Number(a.needsReview) ||
      Number(b.hasMissingValue) - Number(a.hasMissingValue) ||
      Number(b.hasTriggeredRule) - Number(a.hasTriggeredRule) ||
      ((time(a.startTime) ?? Infinity) - (time(b.startTime) ?? Infinity)) ||
      refKey(a.editionId, a.id).localeCompare(refKey(b.editionId, b.id)));
  const assignmentsMap = new Map();
  for (const row of activeRows) {
    const assignee = row.assignee;
    if (!assignmentsMap.has(assignee)) assignmentsMap.set(assignee, { assignee, intervals: 0, needsReview: 0, triggered: 0, changed: 0, workIds: new Set(), decisionCounts: Object.create(null) });
    const value = assignmentsMap.get(assignee);
    value.intervals++; if (row.needsReview) value.needsReview++; if (row.hasTriggeredRule) value.triggered++; if (row.changes.length) value.changed++;
    value.workIds.add(row.workId);
    if (row.latestDecision) value.decisionCounts[row.latestDecision.decision] = (value.decisionCounts[row.latestDecision.decision] ?? 0) + 1;
  }
  const assignments = [...assignmentsMap.values()].map(value => ({ ...value, workIds: [...value.workIds].sort() }))
    .sort((a, b) => b.needsReview - a.needsReview || a.assignee.localeCompare(b.assignee));
  const summary = {
    workPlans: workPlans.length, selectedEditions: editions.length, selectedIntervals: intervals.length,
    activeIntervals: activeRows.length, needsReview: activeRows.filter(row => row.needsReview).length,
    reviewed: activeRows.filter(row => row.latestDecision).length,
    thresholdMatches: activeRows.filter(row => row.hasTriggeredRule).length,
    unavailableValues: activeRows.filter(row => row.hasMissingValue).length,
    changedIntervals: activeRows.filter(row => row.changes.length).length,
    unassigned: activeRows.filter(row => !row.assignee).length,
    decisionRevisions: decisions.length,
    unavailableWorkPlans: workPlans.filter(work => !work.sourceAvailable).length,
  };
  const definitions = {
    selection: 'The active edition is the latest acquisition among the supplied views for each work plan. Older selected editions remain in history; this does not assert a globally latest forecast.',
    decisions: 'Current means the unique highest immutable revision for this edition and interval with the original source hash. A decision from an earlier forecast edition is never copied onto a refresh.',
    thresholds: 'Threshold matches and rule results come from the original workspace. This operations projection does not re-evaluate, interpolate, convert or forecast values.',
    queue: 'Decision needed, staff-requested REVIEW, threshold match, missing data and forecast change are separate reasons. A current PROCEED, RESCHEDULE or CANCEL decision reviews its original interval; REVIEW remains in the assigned work queue.',
    coverage: 'Counts describe actual source rows returned inside the work window. They do not establish continuous weather, expected delivery cadence, provider issuance or ADMS ingestion.',
    assignment: 'The active assignment comes from the current decision revision. Empty assignee is shown as Unassigned. All older assignments remain in decision history.',
    retention: 'Live values follow the original workspace availability. Download projection follows edition usage and removes non-retainable provider values; request, source identity and derived staff decisions remain available.',
    retainedDecisions: 'After raw data expires, source-bound staff interval identities, assignments, choices and triggered-rule IDs can still be shown. They are marked RETAINED_DECISION_ONLY and never counted as available weather observations.',
    attribution: 'Powered by Tomorrow.io',
  };
  const review = { schema: OPERATIONS_SCHEMA, summary, workPlans, queue, assignments, editions, intervals, decisions, comparisons: nativeComparisons, issues, definitions };
  review.id = 'ops_' + hash({ editions, intervals, decisions, comparisons: nativeComparisons, workPlans }).slice(0, 32);
  return review;
}

