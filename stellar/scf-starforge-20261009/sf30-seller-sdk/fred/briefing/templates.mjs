// MIT. Reusable calendar briefing selections over the original retained FRED models.
import { need, plain, clone, canonical, date, exactDifference } from '../model.mjs';
import { digest } from '../source.mjs';
import { validateFredReview } from '../review.mjs';
import { BRIEFING_SPEC, BRIEFING_MODEL, BRIEFING_COMPARISONS, normalizeFredBriefing, buildFredBriefingModel, pageFredBriefing } from './model.mjs';

export const FRED_BRIEFING_TEMPLATE = 'stellar-forge.fred-briefing-template.v1';
export const FRED_BRIEFING_MATERIALIZATION = 'stellar-forge.fred-briefing-materialization.v1';
export const FRED_BRIEFING_CHANGES = 'stellar-forge.fred-briefing-changes.v1';
export const FRED_BRIEFING_SUCCESSOR = 'stellar-forge.fred-briefing-successor.v1';
export const FRED_TEMPLATE_ANCHORS = Object.freeze(['latest_all', 'latest_any']);
export const FRED_BRIEFING_CHANGE_KINDS = Object.freeze([
  'NEW_PERIOD', 'EARLIER_PERIOD', 'ADDED_COMPARISON', 'LEFT_WINDOW',
  'REMOVED_COMPARISON', 'REVISED', 'UNCHANGED',
]);
const SHA = /^[a-f0-9]{64}$/;
const TEMPLATE_ID = /^fred-template-[a-f0-9]{64}$/;
const SUCCESSOR_ID = /^fred-successor-[a-f0-9]{64}$/;
const REPORT_ID = /^fred-briefing-[a-f0-9]{64}$/;
const MEANING_FIELDS = Object.freeze(['title', 'units', 'frequency', 'seasonalAdjustment']);
const ECONOMIC_FIELDS = Object.freeze(['units', 'frequency', 'seasonalAdjustment']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function exactKeys(value, fields, label) {
  need(plain(value) && Object.keys(value).every(key => fields.includes(key)),
    'Use the declared ' + label + ' fields.', 'FRED_TEMPLATE_INVALID');
}
function text(value, label, maximum = 160, allowEmpty = false) {
  need(typeof value === 'string' && value.length <= maximum &&
    (allowEmpty || value.trim().length > 0) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value),
    'Supply a readable ' + label + '.', 'FRED_TEMPLATE_INVALID');
  return value;
}
function integer(value, minimum, maximum, label) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'Choose ' + label + ' between ' + minimum + ' and ' + maximum + '.', 'FRED_TEMPLATE_INVALID');
  return value;
}
function sourceBasis(model) {
  need(typeof model?.sourceMode === 'string' && model.sourceMode.length > 0 && model.sourceMode.length <= 100 &&
    (typeof model.timeBasis === 'string' || plain(model.timeBasis)) &&
    canonical(model.timeBasis).length <= 32768, 'Retain the original source time basis.', 'FRED_TEMPLATE_SOURCE_REQUIRED');
  return { sourceMode: model.sourceMode, timeBasis: clone(model.timeBasis) };
}
function seriesMeaning(series) {
  return { id: series.id, title: series.title ?? series.id, units: series.units,
    frequency: series.frequency, seasonalAdjustment: series.seasonalAdjustment };
}
function yearMonth(value) {
  date(value);
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
}
function calendarDate(month, last = false) {
  const year = Math.floor(month / 12), monthIndex = (month % 12 + 12) % 12;
  need(year >= 1 && year <= 9999, 'The selected calendar window exceeds the supported source dates.',
    'FRED_TEMPLATE_WINDOW_INVALID');
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, monthIndex, 1);
  if (last) {
    result.setUTCMonth(result.getUTCMonth() + 1);
    result.setUTCDate(0);
  }
  need(result.getUTCFullYear() >= 1 && result.getUTCFullYear() <= 9999,
    'The selected calendar window exceeds the supported source dates.', 'FRED_TEMPLATE_WINDOW_INVALID');
  return result.toISOString().slice(0, 10);
}
function normalizeWindow(value, fallbackMonths = 12) {
  exactKeys(value, ['months', 'anchor', 'lagMonths'], 'calendar window');
  const months = integer(value.months ?? fallbackMonths, 1, 1200, 'the number of calendar months');
  const lagMonths = integer(value.lagMonths ?? 0, 0, 1200, 'the number of calendar months to omit at the end');
  const anchor = value.anchor ?? 'latest_all';
  need(FRED_TEMPLATE_ANCHORS.includes(anchor), 'Choose latest_all or latest_any for the calendar anchor.',
    'FRED_TEMPLATE_INVALID');
  return { months, anchor, lagMonths };
}
function templateIdentity(template) {
  return { schema: FRED_BRIEFING_TEMPLATE, name: template.name, origin: template.origin, window: template.window,
    briefing: template.briefing, seriesMeaning: template.seriesMeaning, sourceBasis: template.sourceBasis,
    previousTemplateId: template.previousTemplateId };
}

/** Derive one immutable template from a saved original analyst review. */
export function createFredBriefingTemplate({ name, review, model, window = {}, previousTemplateId = null } = {}) {
  need(review?.briefing && SHA.test(review.id ?? '') && SHA.test(review.captureId ?? ''),
    'Choose a saved original analyst review.', 'FRED_TEMPLATE_REVIEW_REQUIRED');
  validateFredReview(review, model);
  const original = normalizeFredBriefing(review.briefing, model);
  const selected = new Map(model.series.map(item => [item.id, item]));
  const spanMonths = yearMonth(original.end) - yearMonth(original.start) + 1;
  const template = {
    schema: FRED_BRIEFING_TEMPLATE, name: text(name ?? original.title, 'template name'),
    origin: { reviewId: review.id, captureId: review.captureId },
    window: normalizeWindow(window, Math.min(spanMonths, 1200)),
    briefing: { title: original.title, notes: original.notes, decimalPlaces: original.decimalPlaces,
      series: clone(original.series) },
    seriesMeaning: original.series.map(item => seriesMeaning(selected.get(item.id))),
    sourceBasis: sourceBasis(model), previousTemplateId,
  };
  need(previousTemplateId === null || TEMPLATE_ID.test(previousTemplateId), 'Choose an original predecessor template ID.');
  template.id = 'fred-template-' + digest(templateIdentity(template));
  return validateFredBriefingTemplate(template);
}

/** Validate the whole portable descriptor, including its original source and calculation choices. */
export function validateFredBriefingTemplate(input) {
  exactKeys(input, ['schema', 'id', 'name', 'origin', 'window', 'briefing', 'seriesMeaning', 'sourceBasis', 'previousTemplateId'],
    'briefing template');
  need(input.schema === FRED_BRIEFING_TEMPLATE && TEMPLATE_ID.test(input.id ?? ''),
    'Choose a complete supported briefing template.', 'FRED_TEMPLATE_INVALID');
  text(input.name, 'template name');
  exactKeys(input.origin, ['reviewId', 'captureId'], 'template source');
  need(SHA.test(input.origin.reviewId ?? '') && SHA.test(input.origin.captureId ?? ''),
    'Retain the original template review and source.', 'FRED_TEMPLATE_INVALID');
  need(canonical(input.window) === canonical(normalizeWindow(input.window)), 'Retain the complete calendar window.');
  exactKeys(input.briefing, ['title', 'notes', 'decimalPlaces', 'series'], 'template calculation');
  text(input.briefing.title, 'briefing title');
  text(input.briefing.notes, 'briefing note', 8000, true);
  integer(input.briefing.decimalPlaces, 0, 12, 'relative-change decimal places');
  const selected = input.briefing.series;
  need(Array.isArray(selected) && selected.length >= 1 && selected.length <= 50 &&
    new Set(selected.map(item => item?.id)).size === selected.length, 'Retain each selected original series once.');
  for (const item of selected) {
    exactKeys(item, ['id', 'comparisons', 'relativeChange'], 'template series');
    text(item.id, 'original series ID', 100);
    need(Array.isArray(item.comparisons) && item.comparisons.length >= 1 && item.comparisons.length <= 3 &&
      new Set(item.comparisons).size === item.comparisons.length &&
      item.comparisons.every(value => BRIEFING_COMPARISONS.includes(value)) && typeof item.relativeChange === 'boolean',
      'Retain the original period and relative-change choices.');
  }
  need(Array.isArray(input.seriesMeaning) && input.seriesMeaning.length === selected.length,
    'Retain the meaning of every selected source series.');
  for (let index = 0; index < selected.length; index++) {
    const meaning = input.seriesMeaning[index];
    exactKeys(meaning, ['id', ...MEANING_FIELDS], 'series meaning');
    need(meaning.id === selected[index].id, 'The template source series order changed.');
    for (const field of MEANING_FIELDS) text(meaning[field], 'original ' + field, field === 'title' ? 2000 : 1000, true);
  }
  exactKeys(input.sourceBasis, ['sourceMode', 'timeBasis'], 'template source basis');
  sourceBasis(input.sourceBasis);
  need(input.previousTemplateId === null || TEMPLATE_ID.test(input.previousTemplateId),
    'Retain the original predecessor template ID.');
  need(input.id === 'fred-template-' + digest(templateIdentity(input)),
    'The retained briefing template changed.', 'FRED_TEMPLATE_IDENTITY_CHANGED');
  return clone(input);
}
function materializationIdentity(value) {
  const { previewId, ...body } = value;
  return body;
}

/** Select a calendar window from original observation labels, including missing observations. */
export function materializeFredBriefingTemplate({ template, model, captureId, anchorDate = null } = {}) {
  template = validateFredBriefingTemplate(template);
  need(SHA.test(captureId ?? '') && Array.isArray(model?.series) && Array.isArray(model?.rows),
    'Select a complete original retained source capture.', 'FRED_TEMPLATE_SOURCE_REQUIRED');
  const selected = new Set(template.briefing.series.map(item => item.id));
  const metadata = new Map(model.series.map(item => [item.id, item]));
  const rows = new Map([...selected].map(id => [id, []]));
  for (const row of model.rows) if (rows.has(row.series)) {
    date(row.date);
    rows.get(row.series).push(row);
  }
  const latest = [];
  for (const id of selected) {
    need(metadata.has(id) && rows.get(id).length > 0,
      'The selected capture does not contain original observations for series ' + id + '.',
      'FRED_TEMPLATE_SERIES_MISSING');
    rows.get(id).sort((a, b) => a.date.localeCompare(b.date));
    need(new Set(rows.get(id).map(row => row.date)).size === rows.get(id).length,
      'The selected capture repeats an original observation date.', 'FRED_TEMPLATE_SOURCE_INVALID');
    latest.push(rows.get(id).at(-1).date);
  }
  const observedAnchor = template.window.anchor === 'latest_all'
    ? latest.reduce((first, next) => first < next ? first : next)
    : latest.reduce((first, next) => first > next ? first : next);
  const chosenAnchor = anchorDate === null ? observedAnchor : date(anchorDate);
  const endingMonth = yearMonth(chosenAnchor) - template.window.lagMonths;
  const start = calendarDate(endingMonth - template.window.months + 1);
  const end = calendarDate(endingMonth, true);
  const selection = normalizeFredBriefing({ ...clone(template.briefing), start, end }, model);
  const meaningChanges = [];
  for (const previous of template.seriesMeaning) {
    const current = seriesMeaning(metadata.get(previous.id));
    for (const field of MEANING_FIELDS) if (canonical(previous[field]) !== canonical(current[field]))
      meaningChanges.push({ series: previous.id, field, before: clone(previous[field]), after: clone(current[field]) });
  }
  const currentBasis = sourceBasis(model);
  for (const field of ['sourceMode', 'timeBasis'])
    if (canonical(template.sourceBasis[field]) !== canonical(currentBasis[field]))
      meaningChanges.push({ series: null, field, before: clone(template.sourceBasis[field]), after: clone(currentBasis[field]) });
  const coverage = template.briefing.series.map(({ id }) => {
    const original = rows.get(id), visible = original.filter(row => row.date >= start && row.date <= end);
    const last = original.at(-1), windowLast = visible.at(-1) ?? null;
    return { series: id, title: metadata.get(id).title ?? id, frequency: metadata.get(id).frequency,
      units: metadata.get(id).units, firstSourceDate: original[0].date, lastSourceDate: last.date,
      sourceRows: original.length, windowRows: visible.length, windowMissing: visible.filter(row => row.missing).length,
      firstWindowDate: visible[0]?.date ?? null, lastWindowDate: windowLast?.date ?? null,
      lastSourceMissing: Boolean(last.missing), lastWindowMissing: windowLast === null ? null : Boolean(windowLast.missing),
      rowsAfterWindow: original.filter(row => row.date > end).length };
  });
  const value = { schema: FRED_BRIEFING_MATERIALIZATION, templateId: template.id,
    originReviewId: template.origin.reviewId, originCaptureId: template.origin.captureId, captureId,
    selection, window: { anchorDate: chosenAnchor, observedAnchorDate: observedAnchor,
      anchorBasis: anchorDate === null ? template.window.anchor : 'explicit',
      start, end, policy: clone(template.window) },
    coverage, meaningChanges };
  value.previewId = digest(materializationIdentity(value));
  return value;
}

export function validateFredBriefingMaterialization(value) {
  exactKeys(value, ['schema', 'previewId', 'templateId', 'originReviewId', 'originCaptureId', 'captureId',
    'selection', 'window', 'coverage', 'meaningChanges'], 'briefing materialization');
  need(value.schema === FRED_BRIEFING_MATERIALIZATION && SHA.test(value.previewId ?? '') &&
    TEMPLATE_ID.test(value.templateId ?? '') && SHA.test(value.originReviewId ?? '') &&
    SHA.test(value.originCaptureId ?? '') && SHA.test(value.captureId ?? '') &&
    plain(value.selection) && plain(value.window) && Array.isArray(value.coverage) && Array.isArray(value.meaningChanges),
    'Retain the complete reviewed calendar selection.', 'FRED_TEMPLATE_PREVIEW_CHANGED');
  exactKeys(value.window, ['anchorDate', 'observedAnchorDate', 'anchorBasis', 'start', 'end', 'policy'], 'materialized window');
  date(value.window.anchorDate); date(value.window.observedAnchorDate);
  const policy = normalizeWindow(value.window.policy);
  need(canonical(policy) === canonical(value.window.policy) &&
    [...FRED_TEMPLATE_ANCHORS, 'explicit'].includes(value.window.anchorBasis) &&
    (value.window.anchorBasis === 'explicit' || value.window.anchorBasis === policy.anchor &&
      value.window.anchorDate === value.window.observedAnchorDate), 'Retain the reviewed original anchor.');
  const endingMonth = yearMonth(value.window.anchorDate) - policy.lagMonths;
  need(value.window.start === calendarDate(endingMonth - policy.months + 1) &&
    value.window.end === calendarDate(endingMonth, true) &&
    value.selection.schema === BRIEFING_SPEC && value.selection.start === value.window.start &&
    value.selection.end === value.window.end && Array.isArray(value.selection.series) &&
    value.selection.series.length >= 1 && value.selection.series.length <= 50 &&
    value.coverage.length === value.selection.series.length, 'The reviewed selection lost its calendar window.');
  const ids = value.selection.series.map(item => item?.id);
  need(ids.every(id => typeof id === 'string') && new Set(ids).size === ids.length,
    'Retain every selected series once.');
  for (let index = 0; index < value.coverage.length; index++) {
    const item = value.coverage[index];
    need(plain(item) && item.series === ids[index], 'Retain source coverage in the original series order.');
    for (const field of ['sourceRows', 'windowRows', 'windowMissing', 'rowsAfterWindow'])
      integer(item[field], 0, 1000000, 'source coverage');
    date(item.firstSourceDate); date(item.lastSourceDate);
    need(item.sourceRows > 0 && item.windowMissing <= item.windowRows &&
      item.windowRows + item.rowsAfterWindow <= item.sourceRows &&
      item.firstSourceDate <= item.lastSourceDate && typeof item.lastSourceMissing === 'boolean',
      'Retain the original source and missing-marker counts.');
    if (item.windowRows === 0)
      need(item.firstWindowDate === null && item.lastWindowDate === null && item.lastWindowMissing === null,
        'An empty window must retain absent observation dates.');
    else {
      date(item.firstWindowDate); date(item.lastWindowDate);
      need(item.firstWindowDate >= value.window.start && item.lastWindowDate <= value.window.end &&
        item.firstWindowDate <= item.lastWindowDate && typeof item.lastWindowMissing === 'boolean',
        'Retain the first and last original observations in the window.');
    }
  }
  need(value.meaningChanges.every(item => plain(item) && (item.series === null ||
    ids.includes(item.series)) && [...MEANING_FIELDS, 'sourceMode', 'timeBasis'].includes(item.field) &&
    own(item, 'before') && own(item, 'after')), 'Retain the original source meaning changes.');
  need(value.previewId === digest(materializationIdentity(value)),
    'The reviewed briefing selection changed.', 'FRED_TEMPLATE_PREVIEW_CHANGED');
  return clone(value);
}

export function previewFredBriefingTemplate({ template, model, captureId, anchorDate = null, offset = 0, limit = 100 } = {}) {
  const materialization = materializeFredBriefingTemplate({ template, model, captureId, anchorDate });
  const report = buildFredBriefingModel({ model, captureId, selection: materialization.selection });
  return { ...materialization, briefing: pageFredBriefing(report, { offset, limit }) };
}
function reportProjection(report) {
  need(report?.schema === BRIEFING_MODEL && SHA.test(report.captureId ?? '') &&
    Array.isArray(report.series) && Array.isArray(report.observations) && Array.isArray(report.measures) &&
    plain(report.selection), 'Compare complete original analyst reports.', 'FRED_BRIEFING_COMPARISON_INVALID');
  const metadata = new Map(report.series.map(item => [item.id, item]));
  const result = new Map();
  for (const measure of report.measures) {
    need(typeof measure.series === 'string' && metadata.has(measure.series) &&
      BRIEFING_COMPARISONS.includes(measure.comparison) &&
      Number.isSafeInteger(measure.currentIndex) && measure.currentIndex >= 0 &&
      measure.currentIndex < report.observations.length && (measure.baselineIndex === null ||
        Number.isSafeInteger(measure.baselineIndex) && measure.baselineIndex >= 0 &&
        measure.baselineIndex < report.observations.length),
      'An original report measure lost its source observation.', 'FRED_BRIEFING_COMPARISON_INVALID');
    date(measure.date);
    const current = report.observations[measure.currentIndex];
    const baseline = measure.baselineIndex === null ? null : report.observations[measure.baselineIndex];
    need(current?.series === measure.series && current.date === measure.date &&
      (baseline === null || baseline.series === measure.series && baseline.date === measure.baselineDate),
      'The original measure and retained source rows differ.', 'FRED_BRIEFING_COMPARISON_INVALID');
    const key = measure.series + '\0' + measure.date + '\0' + measure.comparison;
    need(!result.has(key), 'The original report repeats a period comparison.', 'FRED_BRIEFING_COMPARISON_INVALID');
    const { currentIndex, baselineIndex, ...value } = measure;
    result.set(key, { ...clone(value), current: clone(current), baseline: clone(baseline),
      meaning: seriesMeaning(metadata.get(measure.series)) });
  }
  return result;
}
function economicMeaningEqual(before, after) {
  return ECONOMIC_FIELDS.every(field => canonical(before.meaning[field]) === canonical(after.meaning[field]));
}
function difference(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') return null;
  try { return exactDifference(before, after); } catch { return null; }
}
function measureChanges(before, after) {
  const reasons = [];
  const fields = ['state', 'baselineDate', 'absoluteChange', 'changeUnits', 'relativePercent',
    'relativeState', 'relativeRounded'];
  for (const field of fields)
    if (canonical(before[field] ?? null) !== canonical(after[field] ?? null)) reasons.push(field);
  for (const field of ['current', 'baseline']) {
    const previous = before[field], current = after[field];
    if (previous === null || current === null) {
      if (previous !== current) reasons.push(field + '.presence');
    } else for (const member of ['date', 'value', 'missing', 'units', 'frequency', 'seasonal_adjustment']) {
      if (canonical(previous[member] ?? null) !== canonical(current[member] ?? null)) reasons.push(field + '.' + member);
    }
  }
  for (const field of MEANING_FIELDS)
    if (canonical(before.meaning[field]) !== canonical(after.meaning[field])) reasons.push('meaning.' + field);
  return reasons;
}

function sourceContextChanges(before, after) {
  const changes = [];
  for (const field of ['current', 'baseline']) {
    if (!before?.[field] || !after?.[field]) continue;
    for (const member of ['as_of', 'time_basis', 'realtime_start', 'realtime_end'])
      if (canonical(before[field][member] ?? null) !== canonical(after[field][member] ?? null))
        changes.push(field + '.' + member);
  }
  return changes;
}

/** Classify overlap revisions separately from periods entering or leaving a rolling report. */
export function compareFredBriefingSuccessor({ before, after } = {}) {
  const previous = reportProjection(before), current = reportProjection(after);
  date(before.selection.start); date(before.selection.end); date(after.selection.start); date(after.selection.end);
  const keys = [...new Set([...previous.keys(), ...current.keys()])].sort();
  const totals = Object.fromEntries(FRED_BRIEFING_CHANGE_KINDS.map(kind => [kind, 0]));
  const rows = [];
  for (const key of keys) {
    const prior = previous.get(key) ?? null, next = current.get(key) ?? null;
    const value = next ?? prior, reasons = prior && next ? measureChanges(prior, next) : [];
    let kind;
    if (prior === null) kind = value.date > before.selection.end ? 'NEW_PERIOD'
      : value.date < before.selection.start ? 'EARLIER_PERIOD' : 'ADDED_COMPARISON';
    else if (next === null) kind = value.date < after.selection.start || value.date > after.selection.end
      ? 'LEFT_WINDOW' : 'REMOVED_COMPARISON';
    else kind = reasons.length ? 'REVISED' : 'UNCHANGED';
    const compatible = prior && next && economicMeaningEqual(prior, next);
    rows.push({ series: value.series, date: value.date, comparison: value.comparison, kind, reasons,
      contextChanges: prior && next ? sourceContextChanges(prior, next) : [], before: prior, after: next,
      currentValueDelta: compatible && !prior.current.missing && !next.current.missing
        ? difference(prior.current.value, next.current.value) : null,
      absoluteChangeDelta: compatible && prior.state === 'READY' && next.state === 'READY'
        ? difference(prior.absoluteChange, next.absoluteChange) : null });
    totals[kind]++;
  }
  const sourceChanges = [];
  for (const field of ['sourceMode', 'timeBasis'])
    if (canonical(before.source?.[field] ?? null) !== canonical(after.source?.[field] ?? null))
      sourceChanges.push({ field, before: clone(before.source?.[field] ?? null), after: clone(after.source?.[field] ?? null) });
  for (const field of ['asOf', 'retrievalWindow']) {
    const previousValue = field === 'asOf' ? before.source?.selection?.asOf ?? null : before.source?.retrievalWindow ?? null;
    const currentValue = field === 'asOf' ? after.source?.selection?.asOf ?? null : after.source?.retrievalWindow ?? null;
    if (canonical(previousValue) !== canonical(currentValue))
      sourceChanges.push({ field, before: clone(previousValue), after: clone(currentValue) });
  }
  const value = { schema: FRED_BRIEFING_CHANGES,
    before: { captureId: before.captureId, reviewId: before.reviewId ?? null, reportId: before.reportId ?? null,
      selection: clone(before.selection) },
    after: { captureId: after.captureId, selection: clone(after.selection) },
    totals, sourceChanges, rowCount: rows.length, changedCount: rows.length - totals.UNCHANGED,
    contextChangedCount: rows.filter(row => row.contextChanges.length > 0).length, rows };
  value.comparisonId = digest(value);
  return value;
}
export function validateFredBriefingChanges(comparison) {
  exactKeys(comparison, ['schema', 'before', 'after', 'totals', 'sourceChanges', 'rowCount', 'changedCount',
    'rows', 'contextChangedCount', 'comparisonId'], 'briefing comparison');
  need(comparison.schema === FRED_BRIEFING_CHANGES && SHA.test(comparison.comparisonId ?? '') &&
    SHA.test(comparison.before?.captureId ?? '') && SHA.test(comparison.after?.captureId ?? '') &&
    plain(comparison.before?.selection) && plain(comparison.after?.selection) &&
    Array.isArray(comparison.rows) && comparison.rows.length <= 60000 &&
    comparison.rows.length === comparison.rowCount && Number.isSafeInteger(comparison.changedCount) &&
    comparison.changedCount >= 0 && Array.isArray(comparison.sourceChanges),
    'Retain the complete original report comparison.', 'FRED_BRIEFING_COMPARISON_INVALID');
  exactKeys(comparison.totals, FRED_BRIEFING_CHANGE_KINDS, 'report comparison totals');
  const counts = Object.fromEntries(FRED_BRIEFING_CHANGE_KINDS.map(kind => [kind, 0])), keys = new Set();
  for (const row of comparison.rows) {
    need(plain(row) && typeof row.series === 'string' && FRED_BRIEFING_CHANGE_KINDS.includes(row.kind) &&
      BRIEFING_COMPARISONS.includes(row.comparison) && Array.isArray(row.reasons) && Array.isArray(row.contextChanges) &&
      (plain(row.before) || row.before === null) && (plain(row.after) || row.after === null) &&
      (row.before !== null || row.after !== null), 'Retain every original period comparison.');
    date(row.date);
    const key = row.series + '\0' + row.date + '\0' + row.comparison;
    need(!keys.has(key), 'The comparison repeats an original period.'); keys.add(key);
    counts[row.kind]++;
  }
  need(FRED_BRIEFING_CHANGE_KINDS.every(kind => comparison.totals[kind] === counts[kind]) &&
    comparison.changedCount === comparison.rowCount - counts.UNCHANGED &&
    comparison.contextChangedCount === comparison.rows.filter(row => row.contextChanges.length > 0).length,
    'The comparison totals differ from its original rows.');
  const { comparisonId, ...body } = comparison;
  need(comparisonId === digest(body), 'The retained report comparison changed.', 'FRED_TEMPLATE_IDENTITY_CHANGED');
  return comparison;
}
export function pageFredBriefingChanges(comparison, { offset = 0, limit = 100, changesOnly = false } = {}) {
  validateFredBriefingChanges(comparison);
  integer(limit, 1, 500, 'report comparison page size');
  need(typeof changesOnly === 'boolean', 'Choose a boolean changes-only filter.');
  const rows = changesOnly ? comparison.rows.filter(row => row.kind !== 'UNCHANGED') : comparison.rows;
  need(Number.isSafeInteger(offset) && offset >= 0 && offset <= rows.length, 'Choose an available report comparison page.');
  const { rows: originalRows, ...summary } = comparison;
  return { ...clone(summary), offset, limit, changesOnly, filteredCount: rows.length,
    nextOffset: offset + limit < rows.length ? offset + limit : null, rows: clone(rows.slice(offset, offset + limit)) };
}
function successorIdentity(value) { const { id, ...body } = value; return body; }

/** Compact lineage record; full reports remain in their original retained review directories. */
export function createFredBriefingSuccessorRecord({ template, materialization, reviewId, reportId,
  comparison, previousSuccessorId = null } = {}) {
  template = validateFredBriefingTemplate(template);
  materialization = validateFredBriefingMaterialization(materialization);
  need(materialization.templateId === template.id && materialization.originReviewId === template.origin.reviewId &&
    materialization.originCaptureId === template.origin.captureId && SHA.test(reviewId ?? '') && REPORT_ID.test(reportId ?? ''),
    'Bind the saved report to its reviewed original template and source.', 'FRED_TEMPLATE_SUCCESSOR_INVALID');
  validateFredBriefingChanges(comparison);
  need(comparison.after.captureId === materialization.captureId &&
    canonical(comparison.after.selection) === canonical(materialization.selection) &&
    SHA.test(comparison.before.reviewId ?? '') && REPORT_ID.test(comparison.before.reportId ?? ''),
    'Bind the original predecessor report and exact materialized selection.', 'FRED_TEMPLATE_SUCCESSOR_INVALID');
  need(previousSuccessorId === null || SUCCESSOR_ID.test(previousSuccessorId),
    'Choose the retained predecessor successor ID.');
  const value = { schema: FRED_BRIEFING_SUCCESSOR, templateId: template.id, originReviewId: template.origin.reviewId,
    beforeReviewId: comparison.before.reviewId, beforeReportId: comparison.before.reportId,
    beforeCaptureId: comparison.before.captureId, captureId: materialization.captureId, reviewId, reportId,
    previousSuccessorId, materialization,
    comparison: { id: comparison.comparisonId, totals: clone(comparison.totals),
      rowCount: comparison.rowCount, changedCount: comparison.changedCount, contextChangedCount: comparison.contextChangedCount, sourceChanges: clone(comparison.sourceChanges) } };
  value.id = 'fred-successor-' + digest(value);
  return validateFredBriefingSuccessorRecord(value);
}
export function validateFredBriefingSuccessorRecord(value) {
  exactKeys(value, ['schema', 'id', 'templateId', 'originReviewId', 'beforeReviewId', 'beforeReportId',
    'beforeCaptureId', 'captureId', 'reviewId', 'reportId', 'previousSuccessorId', 'materialization', 'comparison'],
    'briefing successor');
  need(value.schema === FRED_BRIEFING_SUCCESSOR && SUCCESSOR_ID.test(value.id ?? '') &&
    TEMPLATE_ID.test(value.templateId ?? '') && SHA.test(value.originReviewId ?? '') &&
    SHA.test(value.beforeReviewId ?? '') && SHA.test(value.beforeCaptureId ?? '') && SHA.test(value.captureId ?? '') &&
    SHA.test(value.reviewId ?? '') && REPORT_ID.test(value.beforeReportId ?? '') && REPORT_ID.test(value.reportId ?? '') &&
    (value.previousSuccessorId === null || SUCCESSOR_ID.test(value.previousSuccessorId)),
    'Retain the complete original report lineage.', 'FRED_TEMPLATE_SUCCESSOR_INVALID');
  const materialization = validateFredBriefingMaterialization(value.materialization);
  need(materialization.templateId === value.templateId && materialization.originReviewId === value.originReviewId &&
    materialization.captureId === value.captureId && SHA.test(value.comparison?.id ?? '') &&
    plain(value.comparison?.totals) && Array.isArray(value.comparison?.sourceChanges) &&
    Number.isSafeInteger(value.comparison.rowCount) && value.comparison.rowCount >= 0 &&
    Number.isSafeInteger(value.comparison.changedCount) && value.comparison.changedCount >= 0 &&
    value.comparison.changedCount <= value.comparison.rowCount && Number.isSafeInteger(value.comparison.contextChangedCount) &&
    value.comparison.contextChangedCount >= 0 && value.comparison.contextChangedCount <= value.comparison.rowCount,
    'The original report lineage and materialized selection differ.', 'FRED_TEMPLATE_SUCCESSOR_INVALID');
  exactKeys(value.comparison, ['id', 'totals', 'rowCount', 'changedCount', 'contextChangedCount', 'sourceChanges'], 'successor comparison');
  exactKeys(value.comparison.totals, FRED_BRIEFING_CHANGE_KINDS, 'successor comparison totals');
  for (const kind of FRED_BRIEFING_CHANGE_KINDS)
    need(own(value.comparison.totals, kind) && Number.isSafeInteger(value.comparison.totals[kind]) &&
      value.comparison.totals[kind] >= 0, 'Retain the complete comparison totals.');
  need(Object.values(value.comparison.totals).reduce((sum, count) => sum + count, 0) === value.comparison.rowCount &&
    value.comparison.rowCount - value.comparison.totals.UNCHANGED === value.comparison.changedCount &&
    value.id === 'fred-successor-' + digest(successorIdentity(value)),
    'The retained successor record changed.', 'FRED_TEMPLATE_IDENTITY_CHANGED');
  return clone(value);
}
