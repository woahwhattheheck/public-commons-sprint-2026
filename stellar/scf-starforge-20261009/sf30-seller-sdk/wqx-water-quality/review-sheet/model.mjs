// MIT. Bulk decisions over an immutable original Open Waters receiving plan.
import { OPEN_WATERS_CONTRACT } from '../openwaters-contract.mjs';
import { OPEN_WATERS_FIELD_CHOICES, OPEN_WATERS_LIMIT_FIELDS, verifyOpenWatersPlan,
  normalizeOpenWatersOptions, openWatersHash, openWatersCanonical } from '../openwaters.mjs';

export const REVIEW_SHEET_SCHEMA = 'starforge.wqx-review-sheet.v1';
export const REVIEW_SHEET_KINDS = Object.freeze(['settings', 'location', 'activity', 'result', 'translation', 'limit', 'reference']);
export const REVIEW_SHEET_MAX_DECISIONS = 200000;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (a, b) => openWatersCanonical(a) === openWatersCanonical(b);
const defaults = normalizeOpenWatersOptions({});
const settings = ['organizationId', 'projectId', 'locationMode', 'identityMode', 'notes'];
const referenceFamilies = [...new Set(OPEN_WATERS_CONTRACT.fields.map(x => x.reference).filter(Boolean))].sort();
const schemas = new Map(OPEN_WATERS_CONTRACT.fields.map(x => [x.level + ':' + x.name, x]));
const noChoice = () => ({ present: false, value: null, reason: null });
const choice = (value, reason = null) => ({ present: true, value, reason });
export function reviewSheetFail(message, code = 'WQX_REVIEW_SHEET_INVALID', status = 400) {
  throw Object.assign(new Error(message), { code, status });
}
function identifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))
    reviewSheetFail('Choose a stable ' + name + ' containing letters, digits, hyphens or underscores.');
  return value;
}
function hash(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) reviewSheetFail('Provide the exact ' + name + ' SHA-256.');
  return value;
}
function text(value, name, maximum = 24000) {
  if (typeof value !== 'string' || value.length > maximum) reviewSheetFail(name + ' must be exact text of at most ' + maximum + ' characters.');
  return value;
}
function checkKeys(value, allowed, name) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) reviewSheetFail('Invalid ' + name + ' fields.');
}
export function normalizeReviewSheetDocument(input) {
  checkKeys(input, ['schema', 'sourcePlanId', 'sourcePlanSha256', 'decisions'], 'decision document');
  if (input.schema !== REVIEW_SHEET_SCHEMA) reviewSheetFail('Choose a complete Open Waters decision document.');
  identifier(input.sourcePlanId, 'source plan name'); hash(input.sourcePlanSha256, 'source plan');
  if (!Array.isArray(input.decisions) || input.decisions.length > REVIEW_SHEET_MAX_DECISIONS)
    reviewSheetFail('The decision document supports at most ' + REVIEW_SHEET_MAX_DECISIONS + ' target decisions.');
  const seen = new Set(), decisions = [];
  for (const row of input.decisions) {
    checkKeys(row, ['targetId', 'action', 'value', 'reason'], 'target decision');
    if (typeof row.targetId !== 'string' || !/^wqx-(settings|location|activity|result|translation|limit|reference)-[0-9a-f]{64}$/.test(row.targetId))
      reviewSheetFail('Use the original target identity from this saved source plan.');
    if (seen.has(row.targetId)) reviewSheetFail('A target occurs more than once in the decision document.');
    seen.add(row.targetId);
    if (!['keep', 'set', 'clear'].includes(row.action)) reviewSheetFail('Choose keep, set or clear for each decision.');
    const reason = row.reason === undefined ? '' : text(row.reason, 'Decision reason', 2000);
    if (row.action === 'set') {
      decisions.push({ targetId: row.targetId, action: 'set', value: text(row.value, 'Selected value', 1024 * 1024), reason });
    } else {
      if (row.value !== undefined && row.value !== '') reviewSheetFail('Only a set decision takes a selected value.');
      // Unmarked rows are already kept. Explicit reasons for keeping are retained.
      if (row.action !== 'keep' || reason !== '') decisions.push({ targetId: row.targetId, action: row.action, reason });
    }
  }
  decisions.sort((a, b) => a.targetId.localeCompare(b.targetId));
  return { schema: REVIEW_SHEET_SCHEMA, sourcePlanId: input.sourcePlanId, sourcePlanSha256: input.sourcePlanSha256, decisions };
}
function sourceOf(plan) {
  return { schema: REVIEW_SHEET_SCHEMA, sourcePlanId: plan.planId, sourcePlanSha256: plan.planSha256,
    reviewId: plan.reviewId, reviewSha256: plan.reviewSha256, captureId: plan.captureId,
    captureSha256: plan.captureSha256, title: plan.title, summary: structuredClone(plan.summary) };
}
export function reviewSheetSource(input) {
  const plan = verifyOpenWatersPlan(input); identifier(plan.planId, 'saved source plan');
  return sourceOf(plan);
}
export function reviewSheetTargetId(sourcePlanSha256, row) {
  hash(sourcePlanSha256, 'source plan');
  if (!REVIEW_SHEET_KINDS.includes(row.kind)) reviewSheetFail('Unknown decision target kind.');
  return 'wqx-' + row.kind + '-' + openWatersHash([sourcePlanSha256, row.kind, row.sourceKey, row.sourceId,
    row.field, row.matchValue, row.currentValue, row.savedChoice, row.type]);
}
function indexes(options) {
  return {
    location: new Map(options.locationOverrides.map(x => [x.sourceKey, x])),
    activity: new Map(options.activityOverrides.map(x => [x.sourceKey, x])),
    result: new Map(options.resultOverrides.map(x => [x.sourceRecordId, x])),
    translation: new Map(options.fieldTranslations.map(x => [openWatersCanonical([x.field, x.from]), x])),
    limit: new Map(options.limitMappings.map(x => [x.type, x])),
  };
}
function context(input) {
  const plan = verifyOpenWatersPlan(input); identifier(plan.planId, 'saved source plan');
  const options = normalizeOpenWatersOptions(plan.options);
  return { plan, source: sourceOf(plan), options, index: indexes(options) };
}
function savedChoice(ctx, kind, sourceKey, field) {
  if (kind === 'settings') return choice(ctx.options[field]);
  if (kind === 'reference') return own(ctx.options.referenceValues, sourceKey)
    ? choice(JSON.stringify(ctx.options.referenceValues[sourceKey])) : noChoice();
  const item = ctx.index[kind].get(sourceKey);
  if (!item) return noChoice();
  if (kind === 'translation') return choice(item.to, item.reason);
  if (kind === 'limit') return choice(item.field ?? '', item.reason);
  const key = kind === 'location' && field === 'MONLOC_ID' || kind === 'activity' && field === 'ACTIVITY_ID' ? 'id'
    : kind === 'location' && field === 'locationMode' ? 'mode' : null;
  return key ? own(item, key) ? choice(item[key]) : noChoice()
    : own(item.fields, field) ? choice(item.fields[field]) : noChoice();
}
function rowIssues(row, field, anchor = false) {
  return (row.issues ?? []).filter(item => item.field === field ||
    (anchor && item.field === null && item.code !== 'LIMIT_RETAINED_IN_SOURCE'));
}
function makeTarget(ctx, { kind, sourceKey, sourceId = sourceKey, field, matchValue = null, currentValue = '',
  issues = [], attention = false, type = 'text', allowedValues = null, count = null }) {
  const saved = savedChoice(ctx, kind, sourceKey, field);
  const level = kind === 'location' ? 'M' : 'S', rule = schemas.get(level + ':' + field);
  const row = { kind, sourceKey, sourceId: sourceId == null ? '' : String(sourceId), field, matchValue,
    currentValue: String(currentValue), savedChoice: saved, issueCodes: [...new Set(issues.map(x => x.code))].sort(),
    issues, type, allowedValues, attention: Boolean(attention || issues.length || saved.present),
    status: issues.length ? 'attention' : saved.present ? 'chosen' : 'unchosen',
    native: rule ? { type: rule.dataType || 'text', length: rule.length, required: rule.required, reference: rule.reference || null } : null,
    ...(count === null ? {} : { count }) };
  row.targetId = reviewSheetTargetId(ctx.plan.planSha256, row);
  return row;
}
function queryOf(input = {}, { paged = false } = {}) {
  if (!plain(input)) reviewSheetFail('Use an object of decision target filters.');
  const result = { kind: input.kind || '', field: input.field || '', search: input.search || '',
    status: input.status || 'all', attentionOnly: input.attentionOnly === undefined ? true : input.attentionOnly };
  if (result.kind && !REVIEW_SHEET_KINDS.includes(result.kind)) reviewSheetFail('Choose a known decision kind.');
  text(result.field, 'Field filter', 200); text(result.search, 'Search', 500);
  if (!['all', 'attention', 'chosen', 'unchosen'].includes(result.status)) reviewSheetFail('Choose all, attention, chosen or unchosen target status.');
  if (typeof result.attentionOnly !== 'boolean') reviewSheetFail('attentionOnly must be a boolean.');
  result.search = result.search.toLowerCase();
  if (paged) for (const [key, fallback, min, max] of [['offset', 0, 0, 10000000], ['limit', 100, 1, 1000]]) {
    result[key] = input[key] === undefined ? fallback : input[key];
    if (!Number.isSafeInteger(result[key]) || result[key] < min || result[key] > max)
      reviewSheetFail(key + ' must be an integer between ' + min + ' and ' + max + '.');
  }
  return result;
}
function matches(row, query) {
  return (!query.kind || row.kind === query.kind) && (!query.field || row.field === query.field) &&
    (!query.attentionOnly || row.attention) &&
    (query.status === 'all' || query.status === 'attention' && row.attention ||
      query.status === 'chosen' && row.savedChoice.present || query.status === 'unchosen' && !row.savedChoice.present) &&
    (!query.search || [row.sourceKey, row.sourceId, row.field, row.matchValue, row.currentValue,
      row.savedChoice.value, row.savedChoice.reason, ...row.issueCodes].filter(x => x != null).join('\n').toLowerCase().includes(query.search));
}
function fieldList(kind = '') {
  const byKind = {
    settings, location: ['MONLOC_ID', 'locationMode', ...OPEN_WATERS_FIELD_CHOICES.location],
    activity: ['ACTIVITY_ID', ...OPEN_WATERS_FIELD_CHOICES.activity], result: OPEN_WATERS_FIELD_CHOICES.result,
    translation: OPEN_WATERS_FIELD_CHOICES.translation, limit: ['targetField'], reference: referenceFamilies,
  };
  return [...new Set(kind ? byKind[kind] : Object.values(byKind).flat())].sort();
}
function* targets(ctx, wantedKind = '', wantedField = '') {
  const { plan, options, index } = ctx;
  const use = kind => !wantedKind || wantedKind === kind;
  const field = name => !wantedField || wantedField === name;
  if (use('settings')) for (const name of settings) if (field(name)) {
    const allowed = name === 'locationMode' ? ['create', 'existing'] : name === 'identityMode' ? ['compact', 'source'] : null;
    const code = name === 'organizationId' ? 'ORGANIZATION_REQUIRED' : name === 'projectId' ? 'PROJECT_REQUIRED' : null;
    yield makeTarget(ctx, { kind: 'settings', sourceKey: 'receiving', sourceId: plan.planId, field: name,
      currentValue: options[name], attention: true, type: allowed ? 'enum' : 'text', allowedValues: allowed,
      issues: code ? plan.issues.filter(x => x.code === code) : [] });
  }
  for (const [kind, rows] of [['location', plan.locations], ['activity', plan.activities], ['result', plan.results]]) {
    if (!use(kind)) continue;
    for (const row of rows) {
      const sourceKey = kind === 'result' ? row.sourceRecordId : row.sourceKey;
      const sourceId = kind === 'result' ? row.nativeResultId ?? row.sourceRecordId : row.sourceId;
      const identity = kind === 'location' ? 'MONLOC_ID' : kind === 'activity' ? 'ACTIVITY_ID' : null;
      if (identity && field(identity)) yield makeTarget(ctx, { kind, sourceKey, sourceId, field: identity,
        currentValue: row.destinationId, issues: rowIssues(row, identity, true), attention: true });
      if (kind === 'location' && field('locationMode')) yield makeTarget(ctx, { kind, sourceKey, sourceId,
        field: 'locationMode', currentValue: row.mode, type: 'enum', allowedValues: ['create', 'existing'], attention: true });
      for (const name of OPEN_WATERS_FIELD_CHOICES[kind]) if (field(name)) yield makeTarget(ctx, {
        kind, sourceKey, sourceId, field: name, currentValue: row.fields[name] ?? '',
        issues: rowIssues(row, name, kind === 'result' && name === 'RESULT_COMMENT') });
    }
  }
  if (use('translation')) {
    const candidates = new Map();
    function add(name, from, issues = [], increment = 1) {
      const key = openWatersCanonical([name, from]);
      let item = candidates.get(key);
      if (!item) { item = { field: name, from, issues: new Map(), count: 0 }; candidates.set(key, item); }
      item.count += increment;
      for (const issue of issues) item.issues.set(openWatersCanonical(issue), issue);
    }
    for (const [kind, rows] of [['location', plan.locations], ['activity', plan.activities], ['result', plan.results]])
      for (const row of rows) for (const name of OPEN_WATERS_FIELD_CHOICES[kind]) {
        if (!field(name) || !OPEN_WATERS_FIELD_CHOICES.translation.includes(name) || !own(row.fields, name)) continue;
        const key = kind === 'result' ? row.sourceRecordId : row.sourceKey, override = index[kind].get(key);
        // This is the exact value entering native cleanCells, before a saved translation or receiver cleanup.
        const from = own(override?.fields ?? {}, name) ? override.fields[name]
          : (row.changes.find(x => x.field === name)?.from ?? row.fields[name]);
        add(name, from, rowIssues(row, name));
      }
    for (const row of options.fieldTranslations) if (field(row.field)) add(row.field, row.from, [], 0);
    for (const [sourceKey, item] of [...candidates].sort((a, b) => a[0].localeCompare(b[0]))) {
      const selected = index.translation.get(sourceKey);
      yield makeTarget(ctx, { kind: 'translation', sourceKey, sourceId: item.field, field: item.field,
        matchValue: item.from, currentValue: selected?.to ?? item.from, issues: [...item.issues.values()], count: item.count });
    }
  }
  if (use('limit') && field('targetField')) {
    const types = new Map();
    for (const row of plan.results) for (const limit of row.limits) {
      if (typeof limit.type !== 'string' || !limit.type.trim()) continue;
      const entry = types.get(limit.type) ?? { count: 0, fields: new Set(), issues: new Map() };
      entry.count++; entry.fields.add(limit.targetField ?? '');
      for (const issue of row.issues.filter(x => x.code.startsWith('LIMIT_') ||
        x.code === 'DETECTION_REPRESENTATION')) entry.issues.set(openWatersCanonical(issue), issue);
      types.set(limit.type, entry);
    }
    for (const selected of options.limitMappings) if (!types.has(selected.type))
      types.set(selected.type, { count: 0, fields: new Set([selected.field ?? '']), issues: new Map() });
    for (const [sourceKey, item] of [...types].sort((a, b) => a[0].localeCompare(b[0])))
      yield makeTarget(ctx, { kind: 'limit', sourceKey, field: 'targetField', matchValue: sourceKey,
        currentValue: index.limit.get(sourceKey)?.field ?? [...item.fields][0] ?? '', attention: true,
        type: 'enum', allowedValues: ['', ...OPEN_WATERS_LIMIT_FIELDS], count: item.count, issues: [...item.issues.values()] });
  }
  if (use('reference')) for (const family of referenceFamilies) if (field(family)) {
    const references = plan.references.filter(x => x.kind === 'reference' && x.name === family);
    const count = references.reduce((n, x) => n + x.count, 0), unmatched = references.filter(x => x.matched === false);
    yield makeTarget(ctx, { kind: 'reference', sourceKey: family, field: family, type: 'string-array',
      currentValue: own(options.referenceValues, family) ? JSON.stringify(options.referenceValues[family]) : '',
      attention: count > 0, count, issues: unmatched.map(x => ({ code: 'REFERENCE_VALUE', severity: 'error',
        field: family, message: 'The supplied catalog does not contain the exact value ' + x.value + '.' })) });
  }
}
export function* iterateReviewSheetTargets(input, query = {}) {
  const ctx = context(input), filter = queryOf(query);
  for (const row of targets(ctx, filter.kind, filter.field)) if (matches(row, filter)) yield row;
}
export function listReviewSheetTargets(input, query = {}) {
  const ctx = context(input), filter = queryOf(query, { paged: true }), rows = [];
  let total = 0;
  for (const row of targets(ctx, filter.kind, filter.field)) if (matches(row, filter)) {
    if (total >= filter.offset && rows.length < filter.limit) rows.push(row);
    total++;
  }
  return { source: ctx.source, rows, total, offset: filter.offset, limit: filter.limit,
    kinds: [...REVIEW_SHEET_KINDS], fields: fieldList(filter.kind) };
}
function updateChoice(ctx, target, decision) {
  const { kind, sourceKey, field } = target, clear = decision.action === 'clear';
  if (kind === 'settings') { ctx.options[field] = clear ? defaults[field] : decision.value; return; }
  if (kind === 'reference') {
    if (clear) delete ctx.options.referenceValues[sourceKey];
    else {
      let values; try { values = JSON.parse(decision.value); } catch { reviewSheetFail('Reference catalogs use a JSON array of exact string codes.'); }
      if (!Array.isArray(values) || values.some(x => typeof x !== 'string')) reviewSheetFail('Reference catalogs use a JSON array of exact string codes.');
      ctx.options.referenceValues[sourceKey] = [...new Set(values)].sort();
    }
    return;
  }
  const map = ctx.index[kind], existing = map.get(sourceKey);
  if (kind === 'translation' || kind === 'limit') {
    if (clear) map.delete(sourceKey);
    else {
      const reason = decision.reason.trim() ? decision.reason : existing?.reason ?? '';
      map.set(sourceKey, kind === 'translation'
        ? { field, from: target.matchValue, to: decision.value, reason }
        : { type: sourceKey, field: decision.value === '' ? null : decision.value, reason });
    }
    return;
  }
  const member = kind === 'location' && field === 'MONLOC_ID' || kind === 'activity' && field === 'ACTIVITY_ID' ? 'id'
    : kind === 'location' && field === 'locationMode' ? 'mode' : null;
  if (clear) {
    if (!existing || !(member ? own(existing, member) : own(existing.fields, field))) return;
    if (member) delete existing[member]; else delete existing.fields[field];
    if (!Object.keys(existing.fields).length && !own(existing, 'id') && !own(existing, 'mode')) map.delete(sourceKey);
  } else {
    let item = existing;
    if (!item) { item = { [kind === 'result' ? 'sourceRecordId' : 'sourceKey']: sourceKey, fields: {} }; map.set(sourceKey, item); }
    if (member) item[member] = decision.value; else item.fields[field] = decision.value;
  }
}
export function composeReviewSheet(input, document) {
  const ctx = context(input), normalized = normalizeReviewSheetDocument(document);
  if (normalized.sourcePlanId !== ctx.plan.planId || normalized.sourcePlanSha256 !== ctx.plan.planSha256)
    reviewSheetFail('These decisions belong to a different immutable source plan. Open the matching source plan.',
      'WQX_REVIEW_SHEET_SOURCE_CHANGED', 409);
  const wanted = new Map(normalized.decisions.map(x => [x.targetId, x])), selected = new Map();
  const wantedKinds = new Set(normalized.decisions.map(x => x.targetId.split('-')[1]));
  for (const kind of wantedKinds) for (const row of targets(ctx, kind)) if (wanted.has(row.targetId)) selected.set(row.targetId, row);
  if (selected.size !== wanted.size) reviewSheetFail('A decision target is absent from, or changed in, this source plan.',
    'WQX_REVIEW_SHEET_TARGET_CHANGED', 409);
  const changes = [], counts = { keep: 0, set: 0, clear: 0, changed: 0, noOp: 0 };
  for (const decision of normalized.decisions) {
    counts[decision.action]++;
    const target = selected.get(decision.targetId);
    if (decision.action === 'keep') { counts.noOp++; continue; }
    if (decision.action === 'set' && target.allowedValues && !target.allowedValues.includes(decision.value))
      reviewSheetFail('Choose a declared value for ' + target.field + '.');
    updateChoice(ctx, target, decision);
    const after = savedChoice(ctx, target.kind, target.sourceKey, target.field);
    if (!exact(target.savedChoice, after)) {
      if (!decision.reason.trim()) reviewSheetFail('Explain the changed decision for ' + target.sourceId + ' / ' + target.field + '.');
      counts.changed++;
      changes.push({ targetId: target.targetId, kind: target.kind, sourceKey: target.sourceKey, sourceId: target.sourceId,
        field: target.field, matchValue: target.matchValue, currentValue: target.currentValue,
        beforeChoice: target.savedChoice, afterChoice: after, action: decision.action,
        ...(decision.action === 'set' ? { value: decision.value } : {}), reason: decision.reason });
    } else counts.noOp++;
  }
  Object.assign(ctx.options, {
    locationOverrides: [...ctx.index.location.values()], activityOverrides: [...ctx.index.activity.values()],
    resultOverrides: [...ctx.index.result.values()], fieldTranslations: [...ctx.index.translation.values()],
    limitMappings: [...ctx.index.limit.values()],
  });
  const options = normalizeOpenWatersOptions(ctx.options);
  return { source: ctx.source, document: normalized, documentSha256: openWatersHash(normalized), options, changes, decisionCounts: counts };
}
export function reviewSheetIssues(plan) {
  const rows = (kind, list, key) => list.flatMap(row => row.issues.map(item => ({ kind,
    sourceKey: row[key], sourceId: kind === 'result' ? row.nativeResultId ?? row.sourceRecordId : row.sourceId, ...item })));
  return [...plan.issues.map(item => ({ kind: 'settings', sourceKey: 'receiving', sourceId: plan.planId, ...item })),
    ...rows('location', plan.locations, 'sourceKey'), ...rows('activity', plan.activities, 'sourceKey'),
    ...rows('result', plan.results, 'sourceRecordId')];
}
export function reviewSheetImpact(before, after) {
  const byField = new Map(), result = { changedLocations: 0, changedActivities: 0, changedResults: 0,
    changedFieldValues: 0, changedLimitLists: 0, becameReady: 0, becameReview: 0, summaryDelta: {} };
  for (const key of new Set([...Object.keys(before.summary), ...Object.keys(after.summary)]))
    if (typeof before.summary[key] === 'number' && typeof after.summary[key] === 'number')
      result.summaryDelta[key] = after.summary[key] - before.summary[key];
  for (const [kind, plural, identity] of [['location', 'locations', 'sourceKey'], ['activity', 'activities', 'sourceKey'], ['result', 'results', 'sourceRecordId']]) {
    const old = new Map(before[plural].map(row => [row[identity], row]));
    if (old.size !== after[plural].length) reviewSheetFail('A receiving decision changed the selected original source cohort.', 'WQX_REVIEW_SHEET_COHORT_CHANGED', 409);
    for (const row of after[plural]) {
      const previous = old.get(row[identity]);
      if (!previous) reviewSheetFail('A receiving decision changed an original source identity.', 'WQX_REVIEW_SHEET_COHORT_CHANGED', 409);
      let changed = previous.ready !== row.ready || previous.mode !== row.mode;
      for (const field of new Set([...Object.keys(previous.fields), ...Object.keys(row.fields)])) {
        if ((previous.fields[field] ?? '') === (row.fields[field] ?? '')) continue;
        changed = true; result.changedFieldValues++;
        const key = kind + ':' + field, entry = byField.get(key) ?? { kind, field, count: 0 };
        entry.count++; byField.set(key, entry);
      }
      if (kind === 'result' && !exact(previous.limits, row.limits)) { changed = true; result.changedLimitLists++; }
      if (changed) result['changed' + plural[0].toUpperCase() + plural.slice(1)]++;
      if (!previous.ready && row.ready) result.becameReady++;
      if (previous.ready && !row.ready) result.becameReview++;
    }
  }
  result.byField = [...byField.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.field.localeCompare(b.field));
  return result;
}
