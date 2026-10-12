// MIT. DBnomics source semantics and explicit economic calculations.
import { createHash } from 'node:crypto';
import { exactDifference } from '../fred/model.mjs';
export const API_ORIGIN = 'https://api.db.nomics.world';
export const API_BASE = API_ORIGIN + '/v22';
export const CAPTURE_SCHEMA = 'stellar-forge.dbnomics-capture.v1';
export const REPORT_SCHEMA = 'stellar-forge.dbnomics-report.v1';
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const MAX_CAPTURE_BYTES = 128 * 1024 * 1024;
export const MAX_SERIES = 100;
export const SOURCE_TERMS = Object.freeze({
  aggregator: { name: 'DBnomics', url: 'https://db.nomics.world/', termsUrl: 'https://docs.db.nomics.world/legal-terms/',
    license: 'ODbL-1.0', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: 'Contains data from DBnomics, made available under the Open Database License (ODbL).' },
  underlying: 'Original provider terms continue to apply to each source series.',
  insee: { provider: 'INSEE', license: 'Open Licence 2.0', attribution: 'Source: Insee',
    termsUrl: 'https://www.insee.fr/fr/information/2008466',
    note: 'Include the known source update date and preserve the meaning of the information.' }
});
export function need(condition, message, code = 'DBNOMICS_INVALID_INPUT', status = 400) {
  if (!condition) throw Object.assign(new Error(message), { code, status });
}
export const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = value => hash(Buffer.from(canonical(value)));
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function operationId(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value), 'Use a stable operation ID of at most 128 characters.');
  return value;
}
export function text(value, name, max = 1000, allowEmpty = false) {
  need(typeof value === 'string' && value.length <= max && (allowEmpty || value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),
    'Supply ' + name + ' as ' + (allowEmpty ? '' : 'nonempty ') + 'text of at most ' + max + ' characters.');
  return value;
}
export function code(value, name = 'source code') {
  text(value, name, 512);
  need(!/[/?#\\\u0000-\u0020]/.test(value) && value !== '.' && value !== '..', 'Use the exact provider ' + name + '.');
  return value;
}
export function seriesId(value) {
  text(value, 'series ID', 1536);
  const pieces = value.split('/');
  need(pieces.length === 3, 'A series ID is provider/dataset/series.');
  pieces.forEach((part, i) => code(part, ['provider code', 'dataset code', 'series code'][i]));
  need(!/[+*]/.test(pieces[2]), 'Select exact series IDs; use discovery to choose the actual series returned by a mask.');
  return pieces.join('/');
}
export function normalizeSelection(value = {}) {
  need(isRecord(value), 'Use a source selection object.');
  need(Object.keys(value).every(key => ['seriesIds', 'title'].includes(key)), 'Source selections accept seriesIds and title.');
  need(Array.isArray(value.seriesIds) && value.seriesIds.length >= 1 && value.seriesIds.length <= MAX_SERIES,
    'Select one to ' + MAX_SERIES + ' exact source series.');
  const ids = value.seriesIds.map(seriesId);
  need(new Set(ids).size === ids.length, 'Select each source series once.');
  return { seriesIds: ids, title: text(value.title ?? 'DBnomics economic edition', 'selection title', 160) };
}
export function normalizeRights(value, providers) {
  const base = clone(SOURCE_TERMS);
  base.providers = [...new Set(providers)].sort().map(provider => provider === 'INSEE'
    ? clone(SOURCE_TERMS.insee) : { provider, license: null, attribution: provider, termsUrl: null });
  if (value !== undefined) {
    need(isRecord(value) && Object.keys(value).every(key => ['note', 'providers'].includes(key)), 'Rights contain provider references and a note.');
    if (value.note !== undefined) base.note = text(value.note, 'source terms note', 8000, true);
    if (value.providers !== undefined) {
      need(Array.isArray(value.providers) && value.providers.length <= providers.length, 'Use terms for the selected providers.');
      const seen = new Set();
      for (const item of value.providers) {
        need(isRecord(item) && providers.includes(item.provider) && !seen.has(item.provider), 'Rights must identify a selected provider once.');
        seen.add(item.provider);
        const entry = base.providers.find(row => row.provider === item.provider);
        for (const key of ['license', 'attribution', 'termsUrl', 'note']) if (item[key] !== undefined) {
          if (item[key] === null && key !== 'attribution') entry[key] = null;
          else entry[key] = text(item[key], 'provider ' + key, key === 'note' ? 8000 : 2000, key === 'note');
        }
        if (entry.termsUrl) { const url = new URL(entry.termsUrl); need(['http:', 'https:'].includes(url.protocol), 'Use a public source-terms URL.'); }
      }
    }
  }
  return base;
}
const frequencyAliases = { annual:'annual', yearly:'annual', year:'annual', A:'annual', Y:'annual',
  quarterly:'quarterly', quarter:'quarterly', Q:'quarterly', monthly:'monthly', month:'monthly', M:'monthly',
  daily:'daily', day:'daily', D:'daily', weekly:'weekly', week:'weekly', W:'weekly',
  semester:'semiannual', semiannual:'semiannual', 'semi-annual':'semiannual', 'bi-annual':'semiannual', H:'semiannual', S:'semiannual',
  bimester:'bimonthly', bimonthly:'bimonthly', 'bi-monthly':'bimonthly', B:'bimonthly' };
export function periodInfo(period, frequency, providedStart = null) {
  text(period, 'original period', 80);
  const freq = frequencyAliases[frequency] ?? frequency ?? 'unknown';
  const day = 86400000;
  let ordinal = null, start = null, periodFrequency = null, issue = null;
  if (/^\d{4}$/.test(period)) {
    periodFrequency='annual';ordinal=Number(period);start=period+'-01-01';
  } else if (/^\d{4}-S[12]$/.test(period)) {
    const n=Number(period.at(-1));periodFrequency='semiannual';ordinal=Number(period.slice(0,4))*2+n-1;
    start=period.slice(0,4)+(n===1?'-01-01':'-07-01');
  } else if (/^\d{4}-Q[1-4]$/.test(period)) {
    const n=Number(period.at(-1));periodFrequency='quarterly';ordinal=Number(period.slice(0,4))*4+n-1;
    start=period.slice(0,4)+'-'+String((n-1)*3+1).padStart(2,'0')+'-01';
  } else if (/^\d{4}-B[1-6]$/.test(period)) {
    const n=Number(period.at(-1));periodFrequency='bimonthly';ordinal=Number(period.slice(0,4))*6+n-1;
    start=period.slice(0,4)+'-'+String((n-1)*2+1).padStart(2,'0')+'-01';
  } else if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) {
    periodFrequency='monthly';ordinal=Number(period.slice(0,4))*12+Number(period.slice(5))-1;start=period+'-01';
  } else if (/^\d{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3])$/.test(period)) {
    const year=Number(period.slice(0,4)),week=Number(period.slice(6)),jan4=Date.parse(period.slice(0,4)+'-01-04T00:00:00Z');
    const firstMonday=jan4-((new Date(jan4).getUTCDay()+6)%7)*day;
    const monday=firstMonday+(week-1)*7*day;
    need(new Date(monday+3*day).getUTCFullYear()===year,'Provider returned an invalid ISO week.');
    periodFrequency='weekly';ordinal=(monday/day+3)/7;start=new Date(monday).toISOString().slice(0,10);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const time=Date.parse(period+'T00:00:00Z');
    need(Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===period,'Provider returned an invalid calendar date.');
    periodFrequency='daily';ordinal=time/day;start=period;
  }
  if(!periodFrequency){ordinal=null;issue='UNSUPPORTED_SOURCE_PERIOD';}
  else if(periodFrequency!==freq){ordinal=null;issue='FREQUENCY_PERIOD_MISMATCH';}
  if(providedStart!==null&&providedStart!==undefined){
    need(typeof providedStart==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(providedStart),'Preserve the provider period_start_day as an ISO date.');
    const time=Date.parse(providedStart+'T00:00:00Z');
    need(Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===providedStart,'Provider period_start_day is invalid.');
    if(start!==null&&providedStart!==start){ordinal=null;issue='PERIOD_START_MISMATCH';}
    start=providedStart;
  }
  return {frequency:freq,ordinal,start,original:period,calendarIssue:issue};
}
function observationAttributes(doc, index, count) {
  const raw = doc.observations_attributes;
  if (raw === undefined || raw === null) return {};
  const entries = Array.isArray(raw) ? raw : isRecord(raw) ? Object.entries(raw) : null;
  need(entries, 'Provider observations_attributes must be a mapping or name/value pairs.');
  const selected = {};
  for (const pair of entries) {
    need(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string', 'Provider observation attribute pair is invalid.');
    const [key, values] = pair;
    need(!Object.hasOwn(selected, key), 'Provider observation attribute is repeated.');
    if (Array.isArray(values)) {
      need(values.length === count, 'Provider observation attributes must align with the complete original period array.');
      Object.defineProperty(selected, key, { value: clone(values[index]), enumerable: true });
    } else {
      need(values === null || ['string', 'number', 'boolean'].includes(typeof values), 'Provider observation attribute is not scalar or aligned.');
      Object.defineProperty(selected, key, { value: clone(values), enumerable: true });
    }
  }
  return selected;
}
export function parseProviderJson(bytes) {
  const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const numbers = new WeakMap();
  // Node's original-source reviver preserves each observation's numeric token.
  let parsed;
  try {
    parsed = JSON.parse(body, function (key, value, context) {
      if (typeof value === 'number' && context?.source) {
        let selected = numbers.get(this);
        if (!selected) { selected = new Map(); numbers.set(this, selected); }
        selected.set(key, context.source);
      }
      return value;
    });
  } catch { need(false, 'The retained provider response is not complete JSON.', 'DBNOMICS_INVALID_PROVIDER_JSON', 502); }
  return { body, value: parsed, numericToken: (array, index) => numbers.get(array)?.get(String(index)) ?? String(array[index]) };
}
function errorMessage(value) {
  if (typeof value.error === 'string') return value.error;
  if (isRecord(value.error)) return value.error.message ?? canonical(value.error);
  if (Array.isArray(value.errors) && value.errors.length) return canonical(value.errors);
  return null;
}
export function inspectResponse(parsed) {
  const value = parsed.value ?? parsed;
  need(isRecord(value), 'Provider response must be a JSON object.', 'DBNOMICS_PROVIDER_SCHEMA', 502);
  const error = errorMessage(value);
  need(!error, error ?? 'Provider failed.', 'DBNOMICS_PROVIDER_ERROR', 502);
  const series = value.series;
  need(isRecord(series) && Array.isArray(series.docs), 'Provider response is missing its series/docs collection.', 'DBNOMICS_PROVIDER_SCHEMA', 502);
  for (const key of ['num_found', 'offset', 'limit']) if (series[key] !== undefined)
    need(Number.isSafeInteger(series[key]) && series[key] >= 0, 'Provider series pagination is invalid.', 'DBNOMICS_PROVIDER_SCHEMA', 502);
  return { value, docs: series.docs, total: series.num_found ?? series.docs.length, offset: series.offset ?? 0, limit: series.limit ?? series.docs.length };
}
function requestedMatch(requested, resolved) {
  if (requested === resolved) return true;
  const [rp, rd, rs] = requested.split('/'), [p, d, s] = resolved.split('/');
  return rp === p && rs === s && rd.endsWith(':latest') && d.startsWith(rd.slice(0, -6)) && !d.endsWith(':latest');
}
export function modelFromResponses(selection, responses, captureId = null) {
  selection = normalizeSelection(selection);
  need(Array.isArray(responses) && responses.length >= 1 && responses.length <= MAX_SERIES, 'Retain the complete original source response set.');
  const series = [], rows = [], seenSeries = new Set(), metadata = [];
  for (const response of responses) {
    need(Buffer.isBuffer(response.bytes) || response.bytes instanceof Uint8Array, 'Read the exact retained response bytes.');
    const parsed = parseProviderJson(response.bytes), page = inspectResponse(parsed);
    need(page.offset === 0 && page.total === page.docs.length, 'A retained exact-ID response must contain its complete selected series.', 'DBNOMICS_INCOMPLETE_SOURCE', 502);
    metadata.push({ responseSha256: hash(response.bytes), dataset: clone(page.value.dataset ?? null), datasets: clone(page.value.datasets ?? null),
      provider: clone(page.value.provider ?? null), providers: clone(page.value.providers ?? null), meta: clone(page.value._meta ?? null) });
    for (const doc of page.docs) {
      need(isRecord(doc), 'Provider series must be a source object.');
      const id = seriesId([code(doc.provider_code, 'provider code'), code(doc.dataset_code, 'dataset code'), code(doc.series_code, 'series code')].join('/'));
      need(selection.seriesIds.some(requested => requestedMatch(requested, id)), 'Provider returned an unselected series: ' + id, 'DBNOMICS_SOURCE_SELECTION_CHANGED', 502);
      need(!seenSeries.has(id), 'Provider returned a duplicate selected series.', 'DBNOMICS_DUPLICATE_SERIES', 502); seenSeries.add(id);
      need(Array.isArray(doc.period) && Array.isArray(doc.value) && doc.period.length === doc.value.length, 'Provider periods and values must align.', 'DBNOMICS_OBSERVATION_ALIGNMENT', 502);
      need(doc.period_start_day === undefined || Array.isArray(doc.period_start_day) && doc.period_start_day.length === doc.period.length, 'Provider period_start_day must align.');
      need(doc.period.length <= 1000000 && rows.length + doc.period.length <= 1000000, 'This selected capture exceeds one million observations.');
      const dimensions = isRecord(doc.dimensions) ? clone(doc.dimensions) : {};
      const frequency = doc['@frequency'] ?? doc.frequency ?? dimensions.FREQ ?? 'unknown';
      const metadataDoc = Object.fromEntries(Object.entries(doc).filter(([key]) => !['period', 'value', 'period_start_day', 'observations_attributes'].includes(key)));
      const entry = { id, provider: doc.provider_code, dataset: doc.dataset_code, code: doc.series_code,
        name: typeof doc.series_name === 'string' ? doc.series_name : id, frequency: frequencyAliases[frequency] ?? frequency,
        dimensions, sourceUpdatedAt: doc.updated_at ?? page.value.dataset?.updated_at ?? null, indexedAt: doc.indexed_at ?? null,
        metadata: clone(metadataDoc), rowCount: doc.period.length, missing: 0, responseSha256: hash(response.bytes) };
      const periods = new Set();
      doc.period.forEach((period, index) => {
        need(!periods.has(period), 'Provider repeats a period within ' + id + ': ' + period, 'DBNOMICS_DUPLICATE_OBSERVATION', 502); periods.add(period);
        const info = periodInfo(period, frequency, doc.period_start_day?.[index]);
        const original = doc.value[index], missing = original === 'NA' || original === null;
        need(missing || typeof original === 'number' && Number.isFinite(original), 'Preserve a finite provider number, NA or null; unsupported observation for ' + id + '.');
        const valueText = missing ? original === null ? 'null' : 'NA' : parsed.numericToken(doc.value, index);
        if (missing) entry.missing++;
        rows.push({ observationId: digest({ seriesId: id, period }), seriesId: id, provider: entry.provider, dataset: entry.dataset,
          seriesCode: entry.code, seriesName: entry.name, frequency: info.frequency, period, periodStartDay: info.start,
          periodOrdinal: info.ordinal, calendarIssue: info.calendarIssue, sourceIndex: index, value: missing ? null : original, valueText,
          missing, missingReason: missing ? original === null ? 'PROVIDER_NULL' : 'PROVIDER_NA' : null,
          dimensions: clone(dimensions), attributes: observationAttributes(doc, index, doc.period.length),
          sourceUpdatedAt: entry.sourceUpdatedAt, responseSha256: entry.responseSha256, captureId });
      });
      series.push(entry);
    }
  }
  for (const requested of selection.seriesIds)
    need([...seenSeries].filter(resolved => requestedMatch(requested, resolved)).length === 1, 'The complete capture is missing the selected series: ' + requested, 'DBNOMICS_MISSING_SERIES', 502);
  need(series.length === selection.seriesIds.length, 'The source returned another series population.');
  return { selection, series, rows, metadata, rowCount: rows.length, missing: rows.filter(row => row.missing).length,
    terms: normalizeRights(undefined, series.map(row => row.provider)), captureId };
}
export function compareModels(before, after) {
  const left = new Map(before.rows.map(row => [row.observationId, row])), right = new Map(after.rows.map(row => [row.observationId, row]));
  const changes = [];
  for (const [id, row] of right) {
    const previous = left.get(id);
    if (!previous) changes.push({ kind: 'added', observationId: id, seriesId: row.seriesId, period: row.period, before: null, after: row });
    else {
      const valueChanged = row.valueText !== previous.valueText || row.missing !== previous.missing;
      const attributesChanged = canonical(row.attributes) !== canonical(previous.attributes);
      const meaningChanged = row.frequency !== previous.frequency || row.periodStartDay !== previous.periodStartDay || row.calendarIssue !== previous.calendarIssue || canonical(row.dimensions) !== canonical(previous.dimensions);
      if (valueChanged || attributesChanged || meaningChanged) changes.push({ kind: 'revised', observationId: id, seriesId: row.seriesId, period: row.period,
        valueChanged, attributesChanged, meaningChanged, before: previous, after: row,
        delta: !meaningChanged && !row.missing && !previous.missing ? exactDifference(previous.valueText, row.valueText) : null });
    }
  }
  for (const [id, row] of left) if (!right.has(id)) changes.push({ kind: 'removed', observationId: id, seriesId: row.seriesId, period: row.period, before: row, after: null });
  const metadataChanges = [];
  const oldSeries = new Map(before.series.map(row => [row.id, row]));
  for (const row of after.series) {
    const previous = oldSeries.get(row.id);
    if (previous && canonical(previous.metadata) !== canonical(row.metadata))
      metadataChanges.push({ seriesId: row.id, before: previous.metadata, after: row.metadata });
  }
  return { beforeCapture: before.captureId, afterCapture: after.captureId, beforeRows: before.rowCount, afterRows: after.rowCount,
    unchanged: [...right].filter(([id]) => left.has(id)).length - changes.filter(row => row.kind === 'revised').length,
    added: changes.filter(row => row.kind === 'added').length, removed: changes.filter(row => row.kind === 'removed').length,
    revised: changes.filter(row => row.kind === 'revised').length, changes, metadataChanges };
}
export function reportSpec(value, model) {
  need(isRecord(value) && Object.keys(value).every(key=>['title','seriesIds','method','lag','start','end','basePeriod','note'].includes(key)), 'Use the documented analyst report fields.');
  const chosen = value.seriesIds ?? model.series.map(series => series.id);
  need(Array.isArray(chosen) && chosen.length > 0 && new Set(chosen).size === chosen.length && chosen.every(id => model.series.some(series => series.id === id)),
    'Select retained source series for the report.');
  const method = value.method ?? 'level';
  need(['level', 'difference', 'percent-change', 'index-100'].includes(method), 'Choose levels, differences, percent change or index 100.');
  const lag = value.lag ?? 1;
  need(Number.isInteger(lag) && lag >= 1 && lag <= 1200, 'Use a positive whole-number calendar-period lag.');
  const start = value.start ?? null, end = value.end ?? null, basePeriod = value.basePeriod ?? null;
  for (const [name, period] of [['start', start], ['end', end], ['basePeriod', basePeriod]]) if (period !== null) text(period, name, 80);
  for (const date of [start, end]) if (date !== null) need(/^\d{4}-\d{2}-\d{2}$/.test(date) && periodInfo(date, 'daily').start === date, 'Use ISO calendar dates for the report interval.');
  need(start === null || end === null || start <= end, 'The report interval ends before it starts.');
  need(method !== 'index-100' || basePeriod !== null, 'Index 100 needs an explicit source base period.');
  return { title: text(value.title ?? 'Economic analysis', 'report title', 160), seriesIds: [...chosen], method, lag, start, end, basePeriod,
    note: text(value.note ?? '', 'analyst note', 16000, true) };
}
export function calculateReport(model, spec) {
  spec = reportSpec(spec, model);
  const rows = [], summaries = [];
  for (const id of spec.seriesIds) {
    const sourceSeries = model.series.find(row => row.id === id);
    const original = model.rows.filter(row => row.seriesId === id);
    const byOrdinal = new Map(original.filter(row => row.periodOrdinal !== null).map(row => [row.periodOrdinal, row]));
    const indexedBase = original.find(row => row.period === spec.basePeriod);
    let selected = original;
    if (spec.start) {
      selected = selected.filter(row => row.periodStartDay !== null && row.periodStartDay >= spec.start);
    }
    if (spec.end) {
      selected = selected.filter(row => row.periodStartDay !== null && row.periodStartDay <= spec.end);
    }
    selected = [...selected].sort((a, b) => (a.periodOrdinal ?? Infinity) - (b.periodOrdinal ?? Infinity) || a.period.localeCompare(b.period));
    let valid = 0;
    for (const source of selected) {
      const prior = spec.method === 'index-100' ? indexedBase :
        spec.method === 'level' ? null : source.periodOrdinal === null ? null : byOrdinal.get(source.periodOrdinal - spec.lag);
      let value = null, reason = null;
      if (source.missing) reason = source.missingReason;
      else if (spec.method === 'level') value = source.value;
      else if (!prior) reason = spec.method === 'index-100' ? 'BASE_PERIOD_ABSENT' : source.calendarIssue ? 'SOURCE_PERIOD_CALENDAR_UNAVAILABLE' : 'EXACT_LAG_PERIOD_ABSENT';
      else if (prior.missing) reason = 'BASE_VALUE_MISSING';
      else if (spec.method !== 'difference' && prior.value === 0) reason = 'ZERO_BASE_VALUE';
      else if (spec.method === 'difference') value = source.value - prior.value;
      else if (spec.method === 'percent-change') value = (source.value / prior.value - 1) * 100;
      else value = source.value / prior.value * 100;
      if (value !== null && !Number.isFinite(value)) { value = null; reason = 'NONFINITE_CALCULATION'; }
      if (value !== null) valid++;
      rows.push({ ...source, sourceValue: source.value, calculatedValue: value, calculation: spec.method,
        calculationReason: reason, basePeriod: prior?.period ?? null, baseObservationId: prior?.observationId ?? null,
        baseValue: prior?.value ?? null, precision: 'IEEE-754 calculation; original numeric tokens retained separately' });
    }
    summaries.push({ id, name: sourceSeries.name, frequency: sourceSeries.frequency, dimensions: sourceSeries.dimensions,
      rows: selected.length, calculable: valid, unavailable: selected.length - valid,
      firstPeriod: selected[0]?.period ?? null, lastPeriod: selected.at(-1)?.period ?? null });
  }
  return { schema: REPORT_SCHEMA, captureId: model.captureId, spec, series: summaries, rows, rowCount: rows.length,
    missingCalculations: rows.filter(row => row.calculatedValue === null).length,
    methodology: spec.method === 'level' ? 'Original observations, with original missing values retained.' :
      spec.method === 'index-100' ? '100 × current / explicit original base-period value. No interpolation.' :
      spec.method === 'difference' ? 'Current − original value at the exact calendar-period lag. Missing periods are not skipped.' :
      '100 × (current / original value at the exact calendar-period lag − 1). No interpolation; zero bases remain unavailable.',
    terms: clone(model.terms) };
}
export function csvCell(value) {
  const s = value === null || value === undefined ? '' : typeof value === 'object' ? canonical(value) : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}
export const OBSERVATION_COLUMNS = Object.freeze({
  observation_id: 'string', series_id: 'string', provider: 'string', dataset: 'string', series_code: 'string',
  series_name: 'string', frequency: 'string', period: 'string', period_start_day: 'string', calendar_issue: 'string', value: 'string',
  value_text: 'string', missing: 'boolean', missing_reason: 'string', dimensions: 'string', attributes: 'string',
  source_updated_at: 'string', response_sha256: 'string', capture_id: 'string'
});
export function observationRows(model) {
  return model.rows.map(row => ({ observation_id: row.observationId, series_id: row.seriesId, provider: row.provider, dataset: row.dataset,
    series_code: row.seriesCode, series_name: row.seriesName, frequency: row.frequency, period: row.period, period_start_day: row.periodStartDay, calendar_issue: row.calendarIssue,
    value: row.valueText, value_text: row.valueText, missing: row.missing, missing_reason: row.missingReason,
    dimensions: canonical(row.dimensions), attributes: canonical(row.attributes), source_updated_at: row.sourceUpdatedAt,
    response_sha256: row.responseSha256, capture_id: model.captureId }));
}
export function rowsCsv(rows, fields = Object.keys(rows[0] ?? {})) {
  return fields.map(csvCell).join(',') + '\n' + rows.map(row => fields.map(field => csvCell(row[field])).join(',')).join('\n') + (rows.length ? '\n' : '');
}
export const observationCsv = model => rowsCsv(observationRows(model), Object.keys(OBSERVATION_COLUMNS));
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
export function reportHtml(report) {
  const e = escapeHtml;
  const fields = ['seriesId', 'period', 'valueText', 'calculatedValue', 'calculationReason', 'basePeriod', 'attributes'];
  const table = '<table><thead><tr>' + fields.map(name => '<th>' + e(name) + '</th>').join('') + '</tr></thead><tbody>' +
    report.rows.map(row => '<tr>' + fields.map(name => '<td>' + e(typeof row[name] === 'object' && row[name] !== null ? canonical(row[name]) : row[name]) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    e(report.spec.title) + '</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#222;max-width:1400px;margin:32px auto;padding:0 24px}h1{font-size:28px}p,pre{max-width:100ch}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:7px;border:1px solid #bbb;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}.table{overflow:auto}@media print{body{margin:0;padding:0}thead{display:table-header-group}tr{break-inside:avoid}}</style><h1>' +
    e(report.spec.title) + '</h1><p>' + e(report.methodology) + '</p><p>' + e(report.spec.note) + '</p><p>Source capture: ' + e(report.captureId) +
    '. Complete report: ' + report.rowCount + ' observations; ' + report.missingCalculations + ' unavailable calculations.</p><pre>' +
    e(JSON.stringify({ selection: report.spec, series: report.series, terms: report.terms, sourceReceipts: report.sourceReceipts, captureSha256: report.captureSha256, notesRevision: report.notesRevision, analystNotes: report.analystNotes }, null, 2)) + '</pre><div class="table">' + table + '</div></html>\n';
}
