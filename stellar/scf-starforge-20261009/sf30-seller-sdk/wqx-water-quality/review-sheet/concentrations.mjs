// MIT. Source-bound concentration choices over the existing WQX decision sheet.
import { CONCENTRATION_UNIT_PROFILE, concentrationUnit, convertConcentrationMeasure, convertConcentrationRecord } from '../concentration-units.mjs';
import { OPEN_WATERS_LIMIT_FIELDS, verifyOpenWatersPlan, openWatersHash, openWatersCanonical } from '../openwaters.mjs';
import { composeReviewSheet, iterateReviewSheetTargets, normalizeReviewSheetDocument } from './model.mjs';

export const CONCENTRATION_CHOICE_SCHEMA = 'starforge.wqx.concentration-choice/v1';
export const CONCENTRATION_REVIEW_SCHEMA = 'starforge.wqx.concentration-review/v1';
const MARKER = '\nWQX_CONCENTRATION_V1=';
const PAIR_MARKER = '\nWQX_CONCENTRATION_PAIR_V1=';
const FIELDS = ['RESULT_MSR', 'RESULT_MSR_UNIT', ...OPEN_WATERS_LIMIT_FIELDS, 'DETECTION_LIMIT_UNIT'];
const same = (a, b) => openWatersCanonical(a) === openWatersCanonical(b);
const clone = value => structuredClone(value);
const text = value => value === undefined || value === null ? '' : String(value);
function fail(message, code = 'WQX_CONCENTRATION_INVALID', status = 400) {
  throw Object.assign(new Error(message), {code, status});
}
function hash(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function reportedLimits(row) {
  return (row.limits ?? []).map(({targetField, choiceReason, ...original}) => clone(original));
}
function binding(plan, row) {
  return {sourcePlanId: plan.planId, sourcePlanSha256: plan.planSha256, reviewId: plan.reviewId,
    reviewSha256: plan.reviewSha256, captureId: plan.captureId, captureSha256: plan.captureSha256,
    sourceRecordId: row.sourceRecordId, sourceRecordSha256: row.sourceRecordSha256 ?? null, source: clone(row.source ?? null)};
}
function unitsIssue(scope, error, field = null) {
  return {scope, field, code: error.code ?? 'WQX_CONCENTRATION_VALUE', message: error.message};
}
function pairs(before, targetUnit) {
  const result = [], issues = [];
  for (const field of OPEN_WATERS_LIMIT_FIELDS) {
    const value = before[field];
    // Empty native fields are exact empty values, not a zero or a detection threshold.
    if (!value) continue;
    try {
      result.push({field, ...convertConcentrationMeasure({value, unit: before.DETECTION_LIMIT_UNIT}, targetUnit)});
    } catch (error) { issues.push(unitsIssue('native-limit', error, field)); }
  }
  return {result, issues};
}
function convertedRow(plan, row, before, targetUnit) {
  const converted = convertConcentrationRecord({source: binding(plan, row), value: before.RESULT_MSR,
    unit: before.RESULT_MSR_UNIT, limits: reportedLimits(row)}, {targetUnit});
  const native = pairs(before, targetUnit), values = {...before}, issues = [...converted.issues, ...native.issues];
  if (converted.result) {
    values.RESULT_MSR = text(converted.result.value); values.RESULT_MSR_UNIT = text(converted.result.unit);
  }
  for (const item of native.result) values[item.field] = text(item.value);
  if (native.result.length || concentrationUnit(before.DETECTION_LIMIT_UNIT)) values.DETECTION_LIMIT_UNIT = targetUnit;
  // These are the exact native receiver string limits. The preview checks its remaining field/reference rules.
  for (const field of FIELDS) {
    const maximum = field === 'RESULT_MSR' ? 60 : 12;
    if (values[field].length > maximum) issues.push({scope: 'native-field', field, code: 'WQX_CONCENTRATION_FIELD_LENGTH',
      message: 'The exact converted ' + field + ' needs ' + values[field].length + ' characters; the native receiver accepts ' + maximum + '.'});
  }
  return {sourceRecordId: row.sourceRecordId, nativeResultId: row.nativeResultId, source: binding(plan, row),
    characteristic: row.fields.CHAR_NAME ?? '', sampleFraction: row.fields.RESULT_SAMP_FRACTION ?? '',
    methodSpeciation: row.fields.METHOD_SPECIATION_NAME ?? '', qualifier: row.fields.RESULT_MSR_QUAL ?? '',
    detectionCondition: row.fields.RESULT_DETECT_CONDITION ?? '', valueType: row.fields.RESULT_VALUE_TYPE ?? '',
    status: row.fields.RESULT_STATUS ?? '', before, after: values, result: converted.result,
    reportedLimits: converted.limits, nativeLimits: native.result, issues, state: issues.length ? 'REVIEW_REQUIRED' : 'PREPARED'};
}
function targetsFor(plan, ids) {
  const fields = new Set(FIELDS), result = new Map();
  for (const target of iterateReviewSheetTargets(plan, {kind: 'result', attentionOnly: false})) {
    if (ids.has(target.sourceKey) && fields.has(target.field)) result.set(target.sourceKey + '\0' + target.field, target);
  }
  for (const id of ids) for (const field of FIELDS)
    if (!result.has(id + '\0' + field)) fail('The selected result is missing its original native target ' + field + '.', 'WQX_CONCENTRATION_TARGET', 409);
  return result;
}
function choiceMetadata(plan, row, report, inputDocumentSha256, effectivePlanSha256, targetUnit) {
  return {schema: CONCENTRATION_CHOICE_SCHEMA, profileId: CONCENTRATION_UNIT_PROFILE.id, profileVersion: CONCENTRATION_UNIT_PROFILE.version,
    sourcePlanSha256: plan.planSha256, sourceRecordId: row.sourceRecordId, inputDocumentSha256, effectivePlanSha256,
    reportedLimitsSha256: openWatersHash(reportedLimits(row)), targetUnit, before: report.before};
}
function parseChoice(decision) {
  const reason = decision.reason ?? '', index = reason.lastIndexOf(MARKER);
  if (index < 0) return null;
  let value;
  try { value = JSON.parse(reason.slice(index + MARKER.length)); }
  catch { fail('The retained concentration choice is incomplete. Prepare it again from the current draft.', 'WQX_CONCENTRATION_CHOICE', 409); }
  if (!plain(value) || value.schema !== CONCENTRATION_CHOICE_SCHEMA ||
      value.profileId !== CONCENTRATION_UNIT_PROFILE.id || value.profileVersion !== CONCENTRATION_UNIT_PROFILE.version ||
      !hash(value.sourcePlanSha256) || !hash(value.inputDocumentSha256) || !hash(value.effectivePlanSha256) ||
      !hash(value.reportedLimitsSha256) || typeof value.sourceRecordId !== 'string' || !concentrationUnit(value.targetUnit) ||
      !plain(value.before) || Object.keys(value.before).length !== FIELDS.length || FIELDS.some(field => typeof value.before[field] !== 'string'))
    fail('This concentration choice has a different source or conversion profile.', 'WQX_CONCENTRATION_CHOICE', 409);
  return {value, reason: reason.slice(0, index), choiceSha256: openWatersHash(value)};
}
export function concentrationSourceGroups(input) {
  const plan = verifyOpenWatersPlan(input), groups = new Map(), limitOnlyIds = [], limitUnits = new Map();
  for (const row of plan.results) {
    const unit = text(row.fields.RESULT_MSR_UNIT), group = groups.get(unit) ?? {unit, supported: Boolean(concentrationUnit(unit)), resultIds: []};
    group.resultIds.push(row.sourceRecordId); groups.set(unit, group);
    const resultMissing = !text(row.fields.RESULT_MSR).trim() && !unit;
    const quantities = reportedLimits(row).filter(limit => text(limit.value).trim());
    if (resultMissing && (quantities.length || OPEN_WATERS_LIMIT_FIELDS.some(field => text(row.fields[field]).trim()))) {
      limitOnlyIds.push(row.sourceRecordId);
      for (const limit of quantities) limitUnits.set(text(limit.unit), (limitUnits.get(text(limit.unit)) ?? 0) + 1);
    }
  }
  return {profile: CONCENTRATION_UNIT_PROFILE, sourcePlanId: plan.planId, sourcePlanSha256: plan.planSha256,
    sourceResults: plan.results.length, groups: [...groups.values()].map(row => ({...row, count: row.resultIds.length})).sort((a, b) => a.unit.localeCompare(b.unit)),
    limitOnly: {resultIds:limitOnlyIds, count:limitOnlyIds.length,
      sourceUnits:[...limitUnits].map(([unit,count]) => ({unit,count,supported:Boolean(concentrationUnit(unit))})).sort((a,b) => a.unit.localeCompare(b.unit))}};
}
/**
 * Build paired receiving choices from the complete current draft. Original records,
 * reported limits and unrelated draft choices remain in the original saved-plan graph.
 */
export async function prepareConcentrationChoices({project, document, resultIds, targetUnit, reason} = {}) {
  if (!project || typeof project.readOpenWaters !== 'function' || typeof project.previewOpenWaters !== 'function')
    fail('Use the original private water-quality project.');
  if (!concentrationUnit(targetUnit)) fail('Choose an exact supported target concentration unit.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 600 || reason.includes(MARKER) || reason.includes(PAIR_MARKER))
    fail('Give this unit change a reason of 1–600 characters.');
  if (!Array.isArray(resultIds) || !resultIds.length || resultIds.length > 100000 || resultIds.some(id => typeof id !== 'string' || !id) ||
      new Set(resultIds).size !== resultIds.length) fail('Choose distinct original result identifiers from the source plan.');
  const normalized = normalizeReviewSheetDocument(document), original = verifyOpenWatersPlan(await project.readOpenWaters(normalized.sourcePlanId));
  const composed = composeReviewSheet(original, normalized);
  const effective = verifyOpenWatersPlan(await project.previewOpenWaters({reviewId: original.reviewId,
    expectedReviewSha256: original.reviewSha256, options: composed.options}));
  if (effective.captureSha256 !== original.captureSha256 || effective.reviewSha256 !== original.reviewSha256 ||
      effective.results.length !== original.results.length)
    fail('The current draft no longer selects the original complete source cohort.', 'WQX_CONCENTRATION_SOURCE', 409);
  const originals = new Map(original.results.map(row => [row.sourceRecordId, row])), current = new Map(effective.results.map(row => [row.sourceRecordId, row]));
  if (originals.size !== original.results.length || current.size !== effective.results.length ||
      [...originals.keys()].some(id => !current.has(id))) fail('The current source result identity changed.', 'WQX_CONCENTRATION_SOURCE', 409);
  const ids = new Set(resultIds), targets = targetsFor(original, ids), decisions = new Map(normalized.decisions.map(row => [row.targetId, clone(row)]));
  const rows = [], issues = [];
  for (const id of [...ids].sort()) {
    const source = originals.get(id), row = current.get(id);
    if (!source || !row || !same(reportedLimits(source), reportedLimits(row)))
      fail('The selected result or its complete original limit list changed.', 'WQX_CONCENTRATION_SOURCE', 409);
    const before = Object.fromEntries(FIELDS.map(field => [field, text(row.fields[field])]));
    const report = convertedRow(original, source, before, targetUnit);
    // Keep source context and current reviewed context distinct; this operation changes concentration representation only.
    report.sourceContext = Object.fromEntries(['characteristic','sampleFraction','methodSpeciation','qualifier','detectionCondition','valueType','status'].map(key => [key, report[key]]));
    for (const [key, field] of [['characteristic','CHAR_NAME'],['sampleFraction','RESULT_SAMP_FRACTION'],['methodSpeciation','METHOD_SPECIATION_NAME'],
      ['qualifier','RESULT_MSR_QUAL'],['detectionCondition','RESULT_DETECT_CONDITION'],['valueType','RESULT_VALUE_TYPE'],['status','RESULT_STATUS']])
      report[key] = row.fields[field] ?? '';
    for (const field of FIELDS) {
      const translation = composed.options.fieldTranslations.find(rule => rule.field === field && rule.from === report.after[field] && rule.to !== rule.from);
      if (translation) report.issues.push({scope: 'receiving-translation', field, code: 'WQX_CONCENTRATION_TRANSLATION',
        message: 'The existing exact translation would change converted ' + field + ' from ' + translation.from + ' to ' + translation.to + '. Revise that translation before preparing this unit change.'});
    }
    const metadata = choiceMetadata(original, source, report, composed.documentSha256, effective.planSha256, targetUnit);
    const pairedReason = reason + MARKER + JSON.stringify(metadata);
    if (pairedReason.length > 2000) report.issues.push({scope: 'choice', field: 'RESULT_MSR_UNIT', code: 'WQX_CONCENTRATION_REASON_LENGTH',
      message: 'The complete source-bound choice needs ' + pairedReason.length + ' characters. Shorten the human reason to fit the existing 2,000-character decision field.'});
    report.state = report.issues.length ? 'REVIEW_REQUIRED' : 'PREPARED';
    report.choiceSha256 = openWatersHash(metadata); report.pairedFields = [];
    const pairReason = reason + PAIR_MARKER + JSON.stringify({sourceRecordId:id,
      unitTargetId:targets.get(id + '\0RESULT_MSR_UNIT').targetId, choiceSha256:report.choiceSha256});
    if (report.state === 'PREPARED') for (const field of FIELDS) {
      const target = targets.get(id + '\0' + field), prior = decisions.get(target.targetId);
      if (field === 'RESULT_MSR_UNIT' || report.after[field] !== before[field] || prior?.reason?.includes(PAIR_MARKER)) {
        decisions.set(target.targetId, {targetId:target.targetId, action:'set', value:report.after[field],
          reason:field === 'RESULT_MSR_UNIT' ? pairedReason : pairReason});
        report.pairedFields.push(field);
      }
    }
    report.reason = reason;
    rows.push(report); issues.push(...report.issues.map(issue => ({sourceRecordId: id, ...issue})));
  }
  const proposed = normalizeReviewSheetDocument({...normalized, decisions: [...decisions.values()]});
  const state = issues.length ? 'REVIEW_REQUIRED' : 'PREPARED';
  if (state === 'PREPARED') validateConcentrationChoices(original, proposed);
  const summary = {selectedResults: rows.length, readyResults: rows.filter(row => row.state === 'PREPARED').length,
    reviewResults: rows.filter(row => row.state !== 'PREPARED').length, originalResults: original.results.length,
    reportedLimits: rows.reduce((n, row) => n + row.reportedLimits.length, 0),
    nativeLimits: rows.reduce((n, row) => n + row.nativeLimits.length, 0),
    pairedDecisions: rows.reduce((n, row) => n + row.pairedFields.length, 0)};
  const content = {schema: CONCENTRATION_REVIEW_SCHEMA, profile: CONCENTRATION_UNIT_PROFILE,
    source: {sourcePlanId: original.planId, sourcePlanSha256: original.planSha256, reviewId: original.reviewId,
      reviewSha256: original.reviewSha256, captureId: original.captureId, captureSha256: original.captureSha256},
    inputDocumentSha256: composed.documentSha256, effectivePlanSha256: effective.planSha256, targetUnit, reason, state, summary,
    inputDocument: normalized, rows, issues, document: state === 'PREPARED' ? proposed : null};
  return {...content, proposalSha256: openWatersHash(content)};
}
/** Validate all paired quantities before the existing full native preview, save and receiving paths. */
export function validateConcentrationChoices(input, document) {
  const normalized = normalizeReviewSheetDocument(document);
  const marked = normalized.decisions.map(decision => ({decision, parsed: parseChoice(decision)})).filter(row => row.parsed);
  const paired = normalized.decisions.filter(row => (row.reason ?? '').includes(PAIR_MARKER));
  if (!marked.length && !paired.length) return {rows: [], count: 0};
  const plan = verifyOpenWatersPlan(input);
  if (normalized.sourcePlanId !== plan.planId || normalized.sourcePlanSha256 !== plan.planSha256)
    fail('Open the concentration choices against their exact original source plan.', 'WQX_CONCENTRATION_SOURCE', 409);
  const ids = new Set(marked.map(row => row.parsed.value.sourceRecordId));
  if (ids.size !== marked.length) fail('A source result has more than one concentration choice.', 'WQX_CONCENTRATION_CHOICE', 409);
  const targets = targetsFor(plan, ids), byId = new Map(plan.results.map(row => [row.sourceRecordId, row]));
  const decisions = new Map(normalized.decisions.map(row => [row.targetId, row])), rows = [];
  const markers = new Map(marked.map(row => [row.decision.targetId,row.parsed]));
  const byTargetId = new Map([...targets.values()].map(row => [row.targetId,row]));
  for (const decision of paired) {
    let value;
    try { value = JSON.parse(decision.reason.slice(decision.reason.lastIndexOf(PAIR_MARKER) + PAIR_MARKER.length)); }
    catch { fail('The paired concentration decision is incomplete.', 'WQX_CONCENTRATION_PAIR_CHANGED', 409); }
    const anchor = markers.get(value?.unitTargetId);
    const target = anchor && byTargetId.get(decision.targetId);
    if (!anchor || !target || target.sourceKey !== value.sourceRecordId || anchor.value.sourceRecordId !== value.sourceRecordId ||
        anchor.choiceSha256 !== value.choiceSha256 || decision.action !== 'set')
      fail('A concentration quantity lost its original paired unit choice. Restore the preceding complete draft or prepare that result and all of its limits again.', 'WQX_CONCENTRATION_PAIR_CHANGED', 409);
  }
  for (const {decision, parsed} of marked) {
    const metadata = parsed.value, source = byId.get(metadata.sourceRecordId);
    if (!source || metadata.sourcePlanSha256 !== plan.planSha256 || metadata.reportedLimitsSha256 !== openWatersHash(reportedLimits(source)) ||
        decision.targetId !== targets.get(metadata.sourceRecordId + '\0RESULT_MSR_UNIT').targetId)
      fail('The concentration choice no longer matches its original result and every reported limit.', 'WQX_CONCENTRATION_SOURCE', 409);
    const row = convertedRow(plan, source, metadata.before, metadata.targetUnit);
    if (row.issues.length) fail('A retained concentration quantity cannot be converted under its original profile.', 'WQX_CONCENTRATION_CHOICE', 409);
    for (const field of FIELDS) {
      const target = targets.get(source.sourceRecordId + '\0' + field), actual = decisions.get(target.targetId);
      const changed = field === 'RESULT_MSR_UNIT' || row.after[field] !== metadata.before[field];
      if (changed && (!actual || actual.action !== 'set' || actual.value !== row.after[field]) ||
          !changed && actual?.action === 'set' && actual.value !== row.after[field])
        fail('The paired unit choice and ' + field + ' differ for ' + source.sourceRecordId + '. Prepare this result and all limits again from the current draft, or restore the preceding complete draft.',
          'WQX_CONCENTRATION_PAIR_CHANGED', 409);
    }
    rows.push({...row, reason: parsed.reason, choiceSha256: parsed.choiceSha256,
      inputDocumentSha256: metadata.inputDocumentSha256, effectivePlanSha256: metadata.effectivePlanSha256,
      reportedLimitsSha256: metadata.reportedLimitsSha256});
  }
  return {rows, count: rows.length};
}
/** Check the actual native postimage after its original translations and field normalization. */
export function assertConcentrationPlan(input, checked) {
  if (!checked?.count) return;
  const plan = verifyOpenWatersPlan(input), rows = new Map(plan.results.map(row => [row.sourceRecordId, row]));
  for (const expected of checked.rows) {
    const row = rows.get(expected.sourceRecordId);
    if (!row || openWatersHash(reportedLimits(row)) !== expected.reportedLimitsSha256)
      fail('The complete reported limit source changed during the concentration preview.', 'WQX_CONCENTRATION_SOURCE', 409);
    for (const field of FIELDS) if (text(row.fields[field]) !== expected.after[field])
      fail('The native planner changed the exact converted ' + field + ' for ' + row.sourceRecordId + '. Review its existing translations and the concentration choices together.',
        'WQX_CONCENTRATION_NATIVE_CHANGED', 409);
  }
}
export function concentrationReportForDocument(input, document, {resultPlan = null} = {}) {
  const plan = verifyOpenWatersPlan(input), checked = validateConcentrationChoices(plan, document);
  if (resultPlan) {
    assertConcentrationPlan(resultPlan, checked);
    const receiving = new Map(resultPlan.results.map(row => [row.sourceRecordId, row]));
    for (const row of checked.rows) {
      row.sourceContext = Object.fromEntries(['characteristic','sampleFraction','methodSpeciation','qualifier','detectionCondition','valueType','status'].map(key => [key, row[key]]));
      for (const [key, field] of [['characteristic','CHAR_NAME'],['sampleFraction','RESULT_SAMP_FRACTION'],['methodSpeciation','METHOD_SPECIATION_NAME'],['qualifier','RESULT_MSR_QUAL'],['detectionCondition','RESULT_DETECT_CONDITION'],['valueType','RESULT_VALUE_TYPE'],['status','RESULT_STATUS']]) row[key] = receiving.get(row.sourceRecordId).fields[field] ?? '';
    }
  }
  const content = {schema: CONCENTRATION_REVIEW_SCHEMA, profile: CONCENTRATION_UNIT_PROFILE, state: 'SAVED_CHOICES',
    source: {sourcePlanId: plan.planId, sourcePlanSha256: plan.planSha256, reviewId: plan.reviewId,
      reviewSha256: plan.reviewSha256, captureId: plan.captureId, captureSha256: plan.captureSha256},
    documentSha256: openWatersHash(normalizeReviewSheetDocument(document)),
    summary: {selectedResults: checked.count, originalResults: plan.results.length,
      reportedLimits: checked.rows.reduce((n, row) => n + row.reportedLimits.length, 0),
      nativeLimits: checked.rows.reduce((n, row) => n + row.nativeLimits.length, 0)}, rows: checked.rows, issues: []};
  return {...content, proposalSha256: openWatersHash(content)};
}
export function concentrationReportCsv(report) {
  if (report?.schema !== CONCENTRATION_REVIEW_SCHEMA || !Array.isArray(report.rows)) fail('Choose a complete concentration report.');
  const {proposalSha256, ...body} = report;
  if (!hash(proposalSha256) || openWatersHash(body) !== proposalSha256) fail('The complete concentration report changed.', 'WQX_CONCENTRATION_REPORT_CHANGED', 409);
  const quote = value => '"' + text(value).replaceAll('"', '""') + '"';
  const columns = ['source_plan','source_plan_sha256','source_record_id','native_result_id','characteristic','fraction','speciation',
    'qualifier','detection_condition','value_type','status','quantity','limit_index','limit_type','limit_origin','before_value','before_unit',
    'after_value','after_unit','factor_numerator','factor_denominator','exact','source_json','reason','issues_json'];
  const lines = [columns.map(quote).join(',')];
  for (const row of report.rows) {
    const common = [report.source.sourcePlanId,report.source.sourcePlanSha256,row.sourceRecordId,row.nativeResultId,
      row.characteristic,row.sampleFraction,row.methodSpeciation,row.qualifier,row.detectionCondition,row.valueType,row.status];
    const emit = (quantity,index,type,origin,before,after,source) => lines.push([...common,quantity,index,type,origin,
      before?.value,before?.unit,after?.value,after?.unit,after?.factor?.numerator,after?.factor?.denominator,after?.exact ?? false,
      JSON.stringify(source ?? null),row.reason,JSON.stringify(row.issues ?? [])].map(quote).join(','));
    emit('result','','','',row.result?.original ?? {value:row.before.RESULT_MSR,unit:row.before.RESULT_MSR_UNIT},row.result,row.source);
    for (const limit of row.reportedLimits) emit('reported-limit',limit.original.index,limit.original.type,limit.original.origin,
      limit.original,limit.converted,limit.original.source);
    for (const limit of row.nativeLimits) emit('native-limit','',limit.field,'receiving',limit.original,limit,row.source);
  }
  return lines.join('\r\n') + '\r\n';
}
