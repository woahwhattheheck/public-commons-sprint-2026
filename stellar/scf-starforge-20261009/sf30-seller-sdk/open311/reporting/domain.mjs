// MIT. Immutable original-source imports and explicit service reporting calculations.
import { canonicalJson, normalizeRequests } from '../domain.mjs';
import { normalizeCollectionPlan, splitCollectionWindow, nextCollectionPage, collectionNodeQuery, projectCollection } from '../collection-domain.mjs';
import { fail, copy, digest, object, label, instant, maybeInstant, normalizeCalendar, calendarResolver, resolveLocal } from './calendar.mjs';

export const SOURCE_SCHEMA = 'commons.open311.collection-export.v1';
export const PROFILE_SCHEMA = 'commons.open311.reporting-profile.v1';
export const REPORT_SCHEMA = 'commons.open311.service-report.v1';
export const REVIEW_SCHEMA = 'commons.open311.report-review.v1';
const iso = ms => ms === null ? null : new Date(ms).toISOString();
const eq = (a, b) => canonicalJson(a) === canonicalJson(b);

export function validateSource(originalText) {
  if (typeof originalText !== 'string') fail('SOURCE_TEXT_REQUIRED', 'Import the complete original collection JSON file.');
  let envelope; try { envelope = JSON.parse(originalText); } catch { fail('INVALID_JSON', 'The collection file must contain complete JSON.'); }
  object(envelope, 'Collection export');
  if (envelope.schema !== SOURCE_SCHEMA) fail('UNSUPPORTED_SOURCE_SCHEMA', 'Import a complete ' + SOURCE_SCHEMA + ' file.');
  label(envelope.workspaceId, 'Original workspace ID', 120);
  if (!Number.isSafeInteger(envelope.revision) || envelope.revision < 0) fail('INVALID_SOURCE_REVISION', 'The original workspace revision is invalid.');
  const c = object(envelope.collection, 'Collection'), originals = envelope.originals;
  label(c.id, 'Collection ID', 120); object(c.connection, 'Frozen source connection');
  if (c.connection.id !== c.connectionId) fail('SOURCE_CONNECTION_MISMATCH', 'The original collection connection identity differs.');
  if (!Array.isArray(c.nodes) || !Array.isArray(originals) || !Array.isArray(envelope.sourceOperations)) fail('INCOMPLETE_COLLECTION', 'Import every original capture, window and source operation.');
  const records = [], captures = new Map();
  for (const original of originals) {
    const capture = object(original.capture, 'Original capture'), raw = object(original.raw, 'Original bytes');
    if (raw.encoding !== 'base64' || typeof raw.body !== 'string' || raw.complete === false) fail('INCOMPLETE_SOURCE_BYTES', 'Every original response must contain its complete base64 body.');
    const bytes = Buffer.from(raw.body, 'base64');
    if (bytes.toString('base64') !== raw.body || raw.bytes !== bytes.length || raw.sha256 !== digest(bytes) ||
        capture.sourceSha256 !== raw.sha256 || capture.sourceBytes !== raw.bytes) fail('SOURCE_BYTES_MISMATCH', 'Original response bytes do not match their retained length and SHA-256.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('INVALID_ORIGINAL_JSON', 'The complete original body is not valid UTF-8 JSON.'); }
    if (!eq(value, original.value)) fail('SOURCE_VALUE_MISMATCH', 'Parsed source values differ from their original bytes.');
    const normalized = normalizeRequests(value, { connectionId: c.connectionId, jurisdictionId: c.connection.jurisdictionId ?? null });
    const expectedItems = new Map(normalized.map(item => [item.key, item]));
    if (!Array.isArray(original.items) || original.items.length !== normalized.length ||
        new Set(original.items.map(item => item.key)).size !== normalized.length ||
        original.items.some(item => !expectedItems.has(item.key) || !eq(expectedItems.get(item.key), item)) ||
        capture.kind !== 'requests' || capture.connectionId !== c.connectionId || capture.rowCount !== normalized.length)
      fail('SOURCE_PROJECTION_MISMATCH', 'The original normalized requests differ from their complete source records.');
    const items = copy(original.items);
    instant(capture.capturedAt, 'Capture observation time');
    if (captures.has(capture.id)) fail('DUPLICATE_CAPTURE', 'An original capture identity is repeated.');
    if (!Number.isSafeInteger(capture.responseLimit) || capture.responseLimit < 1 ||
        capture.saturated !== (items.length >= capture.responseLimit)) fail('INVALID_CAPTURE_CAP', 'The source response ceiling and observed row count disagree.');
    const record = { ...copy(original), items }; captures.set(capture.id, record); records.push(record);
  }
  const plan = normalizeCollectionPlan(c.connection, { name: c.name, query: c.requestedQuery, policy: c.policy });
  if (!eq(plan.query, c.query) || !eq(plan.policy, c.policy)) fail('COLLECTION_PLAN_MISMATCH', 'The saved collection filters differ from their original plan.');
  const nodes = new Map(c.nodes.map(n => [n.id, n])), referenced = new Set(), expected = [...plan.nodes];
  if (nodes.size !== c.nodes.length) fail('DUPLICATE_WINDOW', 'An original collection window is repeated.');
  for (let i = 0; i < expected.length; i++) {
    const planned = expected[i], n = nodes.get(planned.id);
    if (!n || n.startDate !== planned.startDate || n.endDate !== planned.endDate || n.parentId !== planned.parentId || n.page !== planned.page)
      fail('COLLECTION_WINDOW_MISMATCH', 'An original window differs from its recorded automatic subdivision.');
    if (!['PENDING', 'FETCHING', 'CAPTURED', 'SPLIT', 'PAGED', 'LIMITED', 'FAILED'].includes(n.state)) fail('INVALID_WINDOW_STATE', 'An original window state is unsupported.');
    if (n.captureId) {
      const r = captures.get(n.captureId);
      if (!r || referenced.has(n.captureId) || !eq(r.capture.query, collectionNodeQuery(c, n)))
        fail('COLLECTION_CAPTURE_MISMATCH', 'A member capture does not match its exact window query.');
      referenced.add(n.captureId);
      if (n.state === 'CAPTURED' && r.capture.saturated) fail('UNRESOLVED_SOURCE_CAP', 'A capped member is marked below its source ceiling.');
    } else if (['CAPTURED', 'SPLIT', 'PAGED', 'LIMITED'].includes(n.state)) fail('MISSING_ORIGINAL', 'A completed window has no original source response.');
    if (n.state === 'SPLIT') {
      const children = splitCollectionWindow(n, c.policy);
      if (!children || !eq(n.children, children.map(child => child.id))) fail('INVALID_SUBDIVISION', 'A split differs from the original collection policy.');
      expected.push(...children);
    } else if (n.state === 'PAGED') {
      const next = nextCollectionPage(n, c.policy);
      if (!next || !eq(n.children, [next.id])) fail('INVALID_PAGINATION', 'A page continuation differs from the original provider selection.');
      if (!captures.get(n.captureId)?.capture.saturated) fail('UNNECESSARY_PAGE_CONTINUATION', 'A continued page must retain its full source page.');
      expected.push(next);
    } else if (n.children?.length) fail('INVALID_SUBDIVISION', 'A terminal or pending window has child references.');
  }
  if (expected.length !== nodes.size || referenced.size !== records.length) fail('INCOMPLETE_COLLECTION', 'The source has missing windows or unreferenced original responses.');
  const projection = projectCollection(c, records);
  if (!eq(projection.summary.counts, envelope.summary?.counts) || projection.summary.capResolved !== envelope.summary?.capResolved)
    fail('SOURCE_COUNTS_MISMATCH', 'The retained source counts do not match the complete originals.');
  const selected = new Map((envelope.requests ?? []).map(r => [r.key, r]));
  if (selected.size !== projection.items.length || selected.size !== (envelope.requests ?? []).length) fail('SOURCE_SELECTION_MISMATCH', 'Selected request identities do not match the source projection.');
  for (const item of projection.items) {
    const incoming = selected.get(item.key); if (!incoming) fail('SOURCE_SELECTION_MISMATCH', 'An original request is missing.');
    const { review, ...sourceSelection } = incoming;
    if (!eq(sourceSelection, item)) fail('SOURCE_SELECTION_MISMATCH', 'The selected source version differs from the original observations.');
    if (review != null) { object(review, 'Original review'); if (!Array.isArray(review.history)) fail('INCOMPLETE_REVIEW_HISTORY', 'Keep the complete original review history.'); }
  }
  const observations = [...projection.observations.values()].map(entry => ({
    key: entry.row.key, serviceRequestId: entry.row.serviceRequestId, selectedCaptureId: entry.captureId,
    occurrences: entry.occurrences, versions: [...entry.versions.values()]
  }));
  if (!eq(observations, envelope.observations)) fail('OBSERVATION_HISTORY_MISMATCH', 'The complete original observation history differs from its response bodies.');
  return { schema: 'commons.open311.reporting-source.v1', id: 'source-' + digest(originalText).slice(0, 24),
    sha256: digest(originalText), bytes: Buffer.byteLength(originalText), originalText, envelope,
    identity: [envelope.workspaceId, envelope.revision, c.id],
    connectionIdentity: [c.connectionId, c.connection.baseUrl, c.connection.jurisdictionId ?? ''] };
}

const mappingFields = ['serviceCode', 'serviceName', 'agency', 'status', 'serviceRequestId'];
const policyFields = [...mappingFields, 'group', 'priority', 'reviewStatus'];
function selector(value, fields) {
  object(value, 'Selector');
  if (Object.keys(value).some(k => !fields.includes(k))) fail('INVALID_SELECTOR', 'Selector fields must be one of: ' + fields.join(', ') + '.');
  for (const v of Object.values(value)) if (!(v === null || typeof v === 'string' || Array.isArray(v) && v.every(x => x === null || typeof x === 'string')))
    fail('INVALID_SELECTOR', 'Selector values are exact strings, null, or arrays of those values.');
  return copy(value);
}
const matches = (item, selected) => Object.entries(selected).every(([k, v]) => (Array.isArray(v) ? v : [v]).some(x => x === (item[k] ?? null)));
function rule(input, fields) {
  label(input.id, 'Rule ID', 120); label(input.name, 'Rule name');
  if (!Number.isSafeInteger(input.priority)) fail('RULE_PRIORITY_REQUIRED', 'Every mapping and target policy requires an explicit integer priority.');
  return { id: input.id, name: input.name, priority: input.priority, selector: selector(input.selector ?? {}, fields) };
}
export function normalizeProfile(input) {
  object(input, 'Reporting profile'); label(input.id, 'Profile ID', 120); label(input.name, 'Profile name');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail('INVALID_PROFILE', 'Profile revision must be a positive integer.');
  if (!['helsinki', 'georeport-v2'].includes(input.provider)) fail('INVALID_PROVIDER_PROFILE', 'Choose helsinki or georeport-v2 timestamp semantics.');
  const calendars = (input.calendars ?? []).map(normalizeCalendar), calendarKeys = new Set(calendars.map(c => c.id + '@' + c.revision));
  if (calendarKeys.size !== calendars.length) fail('DUPLICATE_CALENDAR', 'The profile repeats a calendar edition.');
  const mappings = (input.mappings ?? []).map(m => ({ ...rule(m, mappingFields), group: label(m.group, 'Mapped service group'), mappedPriority: m.mappedPriority ?? null }));
  if (mappings.some(m => m.mappedPriority !== null && typeof m.mappedPriority !== 'string')) fail('INVALID_PRIORITY_MAPPING', 'A mapped service priority is an explicit string.');
  const policies = (input.policies ?? []).map(p => {
    const value = rule(p, policyFields);
    if (!Number.isSafeInteger(p.revision) || p.revision < 1 || !Number.isFinite(p.durationMinutes) || p.durationMinutes < 0 || p.durationMinutes > 5256000)
      fail('INVALID_TARGET_POLICY', 'Use a positive policy revision and an explicit target of 0–5,256,000 minutes.');
    if (!['elapsed', 'business'].includes(p.clockMode) || !['requestedAt', 'reviewAssignedAt'].includes(p.origin) ||
        !['sourceClosed', 'reviewDone', 'asOf'].includes(p.stop)) fail('INVALID_TARGET_POLICY', 'Choose an explicit clock mode, origin and stop event.');
    const calendarKey = p.clockMode === 'business' ? p.calendarKey : null;
    if (p.clockMode === 'business' && !calendarKeys.has(calendarKey)) fail('CALENDAR_NOT_FOUND', 'Business targets require a retained calendar id@revision.');
    if (!Array.isArray(p.sourceReferences) || !p.sourceReferences.length || p.sourceReferences.some(s => typeof s !== 'string' || !s.trim()))
      fail('TARGET_ATTRIBUTION_REQUIRED', 'Each target requires its operator or source attribution.');
    return { ...value, revision: p.revision, durationMinutes: p.durationMinutes, clockMode: p.clockMode,
      calendarKey, origin: p.origin, stop: p.stop, sourceReferences: copy(p.sourceReferences) };
  });
  for (const list of [mappings, policies]) if (new Set(list.map(r => r.id)).size !== list.length) fail('DUPLICATE_RULE', 'A profile repeats a mapping or target policy ID.');
  const statusMappings = copy(object(input.statusMappings ?? {}, 'Source status groups'));
  if (Object.values(statusMappings).some(v => typeof v !== 'string' || !v.trim())) fail('INVALID_STATUS_GROUP', 'Status groups need explicit labels.');
  const reviewDeadline = input.reviewDeadline == null ? null : copy(input.reviewDeadline);
  if (reviewDeadline) {
    object(reviewDeadline, 'Review deadline interpretation');
    label(reviewDeadline.timeZone, 'Review deadline timezone', 100);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reviewDeadline.time ?? '')) fail('INVALID_REVIEW_DEADLINE', 'Date-only review deadlines require an explicit local HH:mm cutoff.');
    reviewDeadline.disambiguation ??= 'reject';
    if (!['reject', 'earlier', 'later'].includes(reviewDeadline.disambiguation)) fail('INVALID_REVIEW_DEADLINE', 'Choose reject, earlier or later for repeated local times.');
    resolveLocal('2026-01-15', reviewDeadline.time, reviewDeadline.timeZone, reviewDeadline.disambiguation);
  }
  return { schema: PROFILE_SCHEMA, id: input.id, name: input.name, revision: input.revision, provider: input.provider,
    calendars, mappings, policies, statusMappings, reviewDeadline, notes: typeof input.notes === 'string' ? input.notes : '' };
}
function chooseRule(rules, row, name) {
  const found = rules.filter(r => matches(row, r.selector)).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  if (found.length > 1 && found[0].priority === found[1].priority) fail('AMBIGUOUS_' + name, 'Equal-priority rules ' + found[0].id + ' and ' + found[1].id + ' both match this request.');
  return found[0] ?? null;
}
function originalReview(row, cutoff) {
  if (!row?.review) return null;
  const selected = [...(row.review.history ?? []), row.review].filter(r => maybeInstant(r.updatedAt) !== null && Date.parse(r.updatedAt) <= cutoff)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || String(a.requestId).localeCompare(String(b.requestId)));
  return selected.length ? { ...copy(selected.at(-1)), history: copy(selected) } : null;
}
export function selectedObservations(sources, asOf) {
  if (!sources.length) fail('SOURCE_REQUIRED', 'Select at least one retained source edition.');
  const identity = sources[0].connectionIdentity;
  if (sources.some(s => !eq(s.connectionIdentity, identity))) fail('INCOMPATIBLE_SOURCE_CONNECTIONS', 'A report combines source editions from the same frozen endpoint and connection identity.');
  const cutoff = instant(asOf, 'Report asOf'), keys = new Map(), allKeys = new Set();
  for (const source of sources) {
    const incoming = new Map(source.envelope.requests.map(r => [r.key, r]));
    for (const observation of source.envelope.observations) {
      allKeys.add(observation.key);
      for (const version of observation.versions) for (const occurrence of version.occurrences) {
        if (instant(occurrence.capturedAt, 'Observation time') > cutoff) continue;
        let entry = keys.get(observation.key);
        if (!entry) { entry = { versions: new Map(), observations: [], candidates: [] }; keys.set(observation.key, entry); }
        const selected = { ...copy(occurrence), sourceId: source.id };
        entry.observations.push(selected); entry.versions.set(version.sourceSha256, version.item);
        entry.candidates.push({ item: version.item, occurrence: selected, originalReview: originalReview(incoming.get(observation.key), cutoff) });
      }
    }
  }
  const rows = [...keys.entries()].map(([key, value]) => {
    value.candidates.sort((a, b) => Date.parse(a.occurrence.capturedAt) - Date.parse(b.occurrence.capturedAt) ||
      a.occurrence.captureId.localeCompare(b.occurrence.captureId) || a.occurrence.sourceId.localeCompare(b.occurrence.sourceId));
    const chosen = value.candidates.at(-1);
    const reviews = value.candidates.map(c => c.originalReview).filter(Boolean).sort((a, b) =>
      Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || String(a.requestId).localeCompare(String(b.requestId)));
    const review = reviews.at(-1) ?? null;
    return { ...copy(chosen.item), sourceId: chosen.occurrence.sourceId, captureId: chosen.occurrence.captureId,
      observedAt: chosen.occurrence.capturedAt, occurrences: value.observations,
      observationCount: new Set(value.observations.map(o => o.captureId + '/' + o.sourceSha256)).size,
      versionCount: value.versions.size, review,
      reviewNeedsRebase: !!review && review.sourceSha256 !== chosen.item.sourceSha256 };
  }).sort((a, b) => a.key.localeCompare(b.key));
  return { rows, totalKnownRequests: allKeys.size, unobservedAtCutoff: allKeys.size - rows.length };
}
function groups(rows, field, missing = 'Unstated') {
  const counts = new Map(); for (const row of rows) { const k = row[field] === null || row[field] === '' || row[field] === undefined ? missing : String(row[field]); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
export const ratio = (numerator, denominator) => ({ numerator, denominator, percentage: denominator ? 100 * numerator / denominator : null });
function durationSummary(values) {
  const selected = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  const n = selected.length, middle = n ? n % 2 ? selected[(n - 1) / 2] : (selected[n / 2 - 1] + selected[n / 2]) / 2 : null;
  return { count: n, meanMinutes: n ? selected.reduce((a, b) => a + b, 0) / n : null, medianMinutes: middle, maximumMinutes: n ? selected.at(-1) : null };
}
function normalizeDefinition(input) {
  object(input, 'Report definition'); label(input.name, 'Report name');
  label(input.seriesId, 'Report series ID', 120);
  if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || new Set(input.sourceIds).size !== input.sourceIds.length) fail('SOURCE_SELECTION_REQUIRED', 'Choose distinct complete source editions.');
  label(input.profileId, 'Profile edition key', 240);
  const start = instant(input.period?.start, 'Period start'), end = instant(input.period?.end, 'Period end'), asOf = instant(input.asOf, 'Report observation cutoff');
  if (end <= start) fail('INVALID_PERIOD', 'Report periods use [start,end) with the end after the start.');
  const timeZone = label(input.displayTimeZone, 'Display timezone', 100);
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0); } catch { fail('INVALID_TIME_ZONE', 'Choose a valid display timezone.'); }
  if (input.cohort && input.cohort !== 'requestedAt') fail('UNSUPPORTED_COHORT', 'This edition reports a source creation-period cohort.');
  if (!['sourceExpectedAt', 'reviewDueAt', 'policyDueAt'].includes(input.targetBasis)) fail('TARGET_BASIS_REQUIRED', 'Choose the source expectation, internal review deadline or operator policy target.');
  const filters = {};
  for (const field of ['group', 'status', 'reviewStatus', 'assignee']) {
    const values = input.filters?.[field] ?? [];
    if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) fail('INVALID_REPORT_FILTER', 'Report filters contain explicit string arrays.');
    filters[field] = [...new Set(values)].sort();
  }
  return { name: input.name, seriesId: input.seriesId, sourceIds: copy(input.sourceIds), profileId: input.profileId,
    period: { start: iso(start), end: iso(end), boundary: '[start,end)' }, asOf: iso(asOf), displayTimeZone: timeZone,
    cohort: 'requestedAt', targetBasis: input.targetBasis, filters, commentary: typeof input.commentary === 'string' ? input.commentary : '' };
}
export function buildReport(input, sources, profile, identity) {
  const definition = normalizeDefinition(input);
  if (profile.id + '@' + profile.revision !== definition.profileId || !eq(sources.map(s => s.id), definition.sourceIds)) fail('REPORT_SELECTION_MISMATCH', 'The selected source/profile editions differ from the report definition.');
  const start = Date.parse(definition.period.start), end = Date.parse(definition.period.end), asOf = Date.parse(definition.asOf);
  const selected = selectedObservations(sources, definition.asOf), resolver = calendarResolver(profile.calendars);
  let missingCreationDate = 0, outsidePeriod = 0, filtered = 0;
  const rows = [];
  for (const source of selected.rows) {
    const requested = maybeInstant(source.requestedAt);
    if (requested === null) { missingCreationDate++; continue; }
    if (requested < start || requested >= end) { outsidePeriod++; continue; }
    const row = { ...source, sourceStatus: source.status, reportingStatus: Object.hasOwn(profile.statusMappings, source.status) ? profile.statusMappings[source.status] : source.status,
      group: source.serviceCode == null || source.serviceCode === '' ? 'Unmapped service' : 'Service ' + source.serviceCode,
      priority: null, mappingId: null, reviewStatus: source.review?.status ?? 'new', assignee: source.review?.assignee ?? '',
      issues: [], sourceExpectedAt: source.expectedAt, sourceClosedAt: null,
      sourceStatusNotes: source.source?.status_notes == null ? null : typeof source.source.status_notes === 'string'
        ? source.source.status_notes : canonicalJson(source.source.status_notes),
      reviewDueDate: source.review?.dueDate ?? null,
      reviewDueAt: null, policyDueAt: null, policyId: null, ageMinutes: null, resolutionMinutes: null, businessMinutes: null,
      target: { basis: definition.targetBasis, dueAt: null, completedAt: null, state: 'UNASSESSED', reason: null } };
    function issue(code, message) { row.issues.push({ code, message }); }
    let mapping;
    try { mapping = chooseRule(profile.mappings, row, 'MAPPING'); } catch (e) { issue(e.code, e.message); }
    if (mapping) { row.group = mapping.group; row.priority = mapping.mappedPriority; row.mappingId = mapping.id; }
    if (Object.entries(definition.filters).some(([field, values]) => values.length && !values.includes(String(row[field] ?? '')))) { filtered++; continue; }
    if (requested <= asOf) row.ageMinutes = (asOf - requested) / 60000; else issue('CREATION_AFTER_CUTOFF', 'The source creation time is after the observation cutoff.');
    const updated = maybeInstant(source.updatedAt);
    let sourceClosed = profile.provider === 'georeport-v2' && String(source.status).toLowerCase() === 'closed' ? updated : null;
    if (sourceClosed !== null && (sourceClosed < requested || sourceClosed > asOf)) { issue('INVALID_CLOSURE_INTERVAL', 'The source closure time lies before creation or after the report cutoff.'); sourceClosed = null; }
    if (sourceClosed !== null) { row.sourceClosedAt = iso(sourceClosed); row.resolutionMinutes = (sourceClosed - requested) / 60000; }
    const pinnedReview = source.reviewNeedsRebase ? null : source.review;
    if (source.reviewNeedsRebase) issue('REVIEW_SOURCE_CHANGED', 'The retained internal review names a different source version.');
    let reviewDone = pinnedReview?.status === 'done' ? maybeInstant(pinnedReview.updatedAt) : null;
    if (reviewDone !== null && reviewDone < requested) { issue('INVALID_REVIEW_COMPLETION', 'The review completion precedes source creation.'); reviewDone = null; }
    if (row.reviewDueDate) {
      if (profile.reviewDeadline && pinnedReview) {
        try { row.reviewDueAt = iso(resolveLocal(row.reviewDueDate, profile.reviewDeadline.time, profile.reviewDeadline.timeZone, profile.reviewDeadline.disambiguation)); }
        catch (e) { issue(e.code, e.message); }
      } else issue('UNASSESSED_DATE_ONLY_DEADLINE', 'The review due date needs a selected local cutoff/timezone and matching source version.');
    }
    let policy = null, origin = null;
    try {
      policy = chooseRule(profile.policies, row, 'TARGET_POLICY');
      if (policy) {
        row.policyId = policy.id + '@' + policy.revision;
        origin = policy.origin === 'requestedAt' ? requested : null;
        if (policy.origin === 'reviewAssignedAt' && pinnedReview) {
          const history = [...(source.review?.history ?? []), pinnedReview].filter(r => ['assigned', 'in_progress'].includes(r.status) &&
            r.sourceSha256 === source.sourceSha256 && maybeInstant(r.updatedAt) !== null && Date.parse(r.updatedAt) <= asOf)
            .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
          origin = history.length ? Date.parse(history[0].updatedAt) : null;
        }
        if (origin === null) issue('MISSING_TARGET_ORIGIN', 'The target policy has no matching source-pinned assignment origin.');
        else row.policyDueAt = iso(policy.clockMode === 'elapsed' ? origin + policy.durationMinutes * 60000 : resolver.add(policy.calendarKey, origin, policy.durationMinutes));
      }
    } catch (e) { issue(e.code ?? 'TARGET_CALCULATION_ERROR', e.message); }
    const due = maybeInstant(row[definition.targetBasis]);
    const policyCompleted = policy?.stop === 'reviewDone' ? reviewDone : policy?.stop === 'sourceClosed' ? sourceClosed : null;
    const completed = definition.targetBasis === 'reviewDueAt' ? reviewDone
      : definition.targetBasis === 'sourceExpectedAt' ? sourceClosed : policyCompleted;
    row.target.dueAt = iso(due); row.target.completedAt = iso(completed);
    if (due === null) {
      row.target.reason = 'No valid selected target';
      if (row[definition.targetBasis] !== null && row[definition.targetBasis] !== '') issue('INVALID_SELECTED_TARGET_TIME', 'The selected target contains no valid offset datetime.');
    } else if (due < requested) {
      row.target.reason = 'Selected target precedes source creation';
      issue('TARGET_PRECEDES_CREATION', 'The selected target lies before the request creation time.');
    }
    else if (requested > asOf) row.target.reason = 'Source creation is after the selected cutoff';
    else if (completed !== null) row.target.state = completed <= due ? 'COMPLETED_ON_TIME' : 'COMPLETED_LATE';
    else row.target.state = asOf <= due ? 'PENDING_WITHIN_TARGET' : 'OPEN_OVERDUE';
    if (policy?.clockMode === 'business' && origin !== null) {
      try { row.businessMinutes = resolver.between(policy.calendarKey, origin, policyCompleted ?? asOf); }
      catch (e) { issue(e.code, e.message); }
    }
    rows.push(row);
  }
  const assessed = rows.filter(r => r.target.state !== 'UNASSESSED'), completed = assessed.filter(r => r.target.state.startsWith('COMPLETED_'));
  const open = assessed.filter(r => ['PENDING_WITHIN_TARGET', 'OPEN_OVERDUE'].includes(r.target.state));
  const count = state => rows.filter(r => r.target.state === state).length;
  const report = { schema: REPORT_SCHEMA, id: identity.id, createdAt: identity.createdAt, seriesId: definition.seriesId,
    predecessorId: null, definition, sourceIds: definition.sourceIds, profileId: definition.profileId, profile: copy(profile),
    commentary: definition.commentary, requestComments: {}, reviewerHistory: [], rows,
    totals: { intake: rows.length, observedUniqueRequests: selected.rows.length, totalKnownRequests: selected.totalKnownRequests,
      unobservedAtCutoff: selected.unobservedAtCutoff, missingCreationDate, outsidePeriod, filtered,
      unmappedServices: rows.filter(r => r.group === 'Unmapped service').length,
      reviewedRequests: rows.filter(r => r.reviewStatus !== 'new').length,
      staleReviews: rows.filter(r => r.reviewNeedsRebase).length, calculationIssues: rows.filter(r => r.issues.length).length,
      assessedTargets: assessed.length, unassessedTargets: count('UNASSESSED'),
      completedOnTime: ratio(count('COMPLETED_ON_TIME'), completed.length),
      openOverdue: ratio(count('OPEN_OVERDUE'), open.length),
      currentlyWithinTarget: ratio(count('COMPLETED_ON_TIME') + count('PENDING_WITHIN_TARGET'), assessed.length),
      age: durationSummary(rows.map(r => r.ageMinutes)), resolution: durationSummary(rows.map(r => r.resolutionMinutes)) },
    groups: { sourceStatus: groups(rows, 'sourceStatus'), reportingStatus: groups(rows, 'reportingStatus'),
      service: groups(rows, 'group'), review: groups(rows, 'reviewStatus'), assignee: groups(rows, 'assignee', 'Unassigned'),
      target: groups(rows.map(r => ({ state: r.target.state })), 'state') },
    coverage: sources.map(s => ({ sourceId: s.id, sha256: s.sha256, bytes: s.bytes,
      originalWorkspaceId: s.envelope.workspaceId, originalRevision: s.envelope.revision,
      collectionId: s.envelope.collection.id, connection: copy(s.envelope.collection.connection),
      query: copy(s.envelope.collection.query), requestedQuery: copy(s.envelope.collection.requestedQuery),
      summary: copy(s.envelope.summary),
      selectionTimeBasis: s.envelope.collection.policy.timeBasis ?? 'created',
      traversal: s.envelope.collection.policy.strategy ?? 'windows',
      populationDescription: s.envelope.collection.policy.timeBasis === 'updated'
        ? 'Requests observed through the exact retained updated-time filters; an updated feed selects changed cases and does not establish the whole creation-period intake.'
        : 'Requests observed through the exact retained creation-time filters.',
      unresolvedWindows: s.envelope.collection.nodes.filter(n => !['CAPTURED', 'SPLIT', 'PAGED'].includes(n.state)).map(copy) })),
    resolvedCalendarIntervals: resolver.intervals(),
    calculationRuntime: { node: process.versions.node, icu: process.versions.icu ?? null, tz: process.versions.tz ?? null },
    interpretation: 'Creation-period cohort using the latest retained original observation at or before asOf. Source case status and closure disposition, internal review and operator target remain separate.'
  };
  report.sha256 = digest(report); return report;
}
export function validateReport(report) {
  object(report, 'Report'); const { sha256, ...body } = report;
  if (report.schema !== REPORT_SCHEMA || sha256 !== digest(body)) fail('REPORT_HASH_MISMATCH', 'The complete report edition does not match its SHA-256.');
  if (!Array.isArray(report.rows) || new Set(report.rows.map(r => r.key)).size !== report.rows.length) fail('INVALID_REPORT_ROWS', 'Report request identities must be unique.');
  return copy(report);
}
export function compareReports(before, after) {
  const a = new Map(before.rows.map(r => [r.key, r])), b = new Map(after.rows.map(r => [r.key, r]));
  const changed = [], added = [], absent = [];
  for (const [key, row] of b) {
    const previous = a.get(key); if (!previous) { added.push(key); continue; }
    const fields = ['sourceSha256', 'group', 'priority', 'reviewStatus', 'assignee', 'sourceExpectedAt', 'reviewDueAt', 'policyDueAt', 'target', 'issues'];
    const differences = fields.filter(field => !eq(previous[field], row[field]));
    if (differences.length) changed.push({ key, serviceRequestId: row.serviceRequestId, fields: differences, before: previous, after: row });
  }
  for (const key of a.keys()) if (!b.has(key)) absent.push(key);
  return { schema: 'commons.open311.report-comparison.v1',
    before: { id: before.id, sha256: before.sha256, definition: before.definition, totals: before.totals, coverage: before.coverage },
    after: { id: after.id, sha256: after.sha256, definition: after.definition, totals: after.totals, coverage: after.coverage },
    configurationChanged: !eq(before.profile, after.profile),
    commentaryChanged: before.commentary !== after.commentary,
    commentary: { before: before.commentary, after: after.commentary },
    requestCommentChanges: [...new Set([...Object.keys(before.requestComments), ...Object.keys(after.requestComments)])]
      .filter(key => !eq(before.requestComments[key] ?? null, after.requestComments[key] ?? null))
      .map(key => ({ key, before: before.requestComments[key] ?? null, after: after.requestComments[key] ?? null })),
    added, absent, changed };
}
export function reviewTemplate(report) {
  return { schema: REVIEW_SCHEMA, baseReportId: report.id, baseReportSha256: report.sha256, reviewer: '',
    changes: [], availableRequests: report.rows.map(r => ({ key: r.key, serviceRequestId: r.serviceRequestId, sourceSha256: r.sourceSha256 })),
    instructions: 'Set reviewer and changes. Each change has id, kind (report-comment or request-comment), comment; request-comment also has key and sourceSha256. Import and choose individual changes to incorporate.' };
}
export function validateReview(input, base) {
  object(input, 'Reviewer return');
  if (input.schema !== REVIEW_SCHEMA || input.baseReportId !== base.id || input.baseReportSha256 !== base.sha256) fail('REVIEW_BASE_MISMATCH', 'The reviewer return must name its complete retained base report.');
  label(input.reviewer, 'Reviewer', 200);
  if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 10000) fail('REVIEW_CHANGES_REQUIRED', 'Supply 1–10,000 review changes.');
  const rows = new Map(base.rows.map(r => [r.key, r]));
  const changes = input.changes.map(change => {
    label(change.id, 'Review change ID', 120);
    if (!['report-comment', 'request-comment'].includes(change.kind) || typeof change.comment !== 'string' || change.comment.length > 20000)
      fail('INVALID_REVIEW_CHANGE', 'Review changes contain a supported kind and a comment up to 20,000 characters.');
    if (change.kind === 'request-comment' && rows.get(change.key)?.sourceSha256 !== change.sourceSha256)
      fail('REVIEW_SOURCE_MISMATCH', 'A request comment must name its exact original request key and version.');
    return { id: change.id, kind: change.kind, comment: change.comment,
      ...(change.kind === 'request-comment' ? { key: change.key, sourceSha256: change.sourceSha256 } : {}) };
  });
  if (new Set(changes.map(c => c.id)).size !== changes.length) fail('DUPLICATE_REVIEW_CHANGE', 'A reviewer return repeats a change ID.');
  return { schema: REVIEW_SCHEMA, baseReportId: base.id, baseReportSha256: base.sha256, reviewer: input.reviewer, changes };
}
export function incorporateReview(base, current, review, selection, identity) {
  if (!Array.isArray(selection.changeIds) || new Set(selection.changeIds).size !== selection.changeIds.length || !selection.changeIds.length)
    fail('REVIEW_SELECTION_REQUIRED', 'Select the individual review change IDs to incorporate.');
  if (current.id !== base.id && selection.rebaseToReportId !== current.id) fail('REVIEW_BASE_CHANGED', 'The report series has a newer edition. Inspect the comparison and select rebaseToReportId explicitly.', 409, compareReports(base, current));
  const changes = selection.changeIds.map(id => {
    const value = review.changes.find(c => c.id === id); if (!value) fail('REVIEW_CHANGE_NOT_FOUND', 'A selected review change was not found.'); return value;
  });
  const successor = copy(current); delete successor.sha256;
  successor.id = identity.id; successor.createdAt = identity.createdAt; successor.predecessorId = current.id;
  for (const change of changes) {
    if (change.kind === 'report-comment') successor.commentary = change.comment;
    else {
      const row = current.rows.find(r => r.key === change.key);
      if (row?.sourceSha256 !== change.sourceSha256) fail('REVIEW_SOURCE_CHANGED', 'The selected request now has a different original version. Keep this change with its original base or prepare a new source-linked review.', 409, { key: change.key, before: change.sourceSha256, after: row?.sourceSha256 ?? null });
      successor.requestComments[change.key] = { comment: change.comment, sourceSha256: change.sourceSha256, reviewer: review.reviewer };
    }
  }
  successor.reviewerHistory.push({ reviewId: selection.reviewId, baseReportId: base.id, baseReportSha256: base.sha256,
    incorporatedInto: current.id, changeIds: copy(selection.changeIds), reviewer: review.reviewer, incorporatedAt: identity.createdAt });
  successor.sha256 = digest(successor); return successor;
}
