// MIT. Source-preserving hydrology summaries and comparisons.
import { createHash } from 'node:crypto';
import { canonicalJson } from './provider.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
const semanticSha = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { code: 'WATER_ANALYSIS_INVALID', status: 400 }); };
const text = value => value === null || value === undefined ? '' : String(value);
const field = (row, name) => row[name] ?? row.properties?.[name] ?? null;
const escape = value => text(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

function decimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value);
  if (s.length > 320) return null;
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return null;
  const fraction = m[3] ?? m[4] ?? '', exponent = Number(m[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 300) return null;
  let scale = fraction.length - exponent;
  let n = BigInt((m[2] ?? '0') + fraction) * (m[1] === '-' ? -1n : 1n);
  if (scale < 0) { n *= 10n ** BigInt(-scale); scale = 0; }
  return { n, scale, original: s };
}
const pow = scale => 10n ** BigInt(scale);
const align = (value, scale) => value.n * pow(scale - value.scale);
function compare(a, b) {
  const scale = Math.max(a.scale, b.scale), x = align(a, scale), y = align(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}
function ratioString(numerator, denominator, digits = 12) {
  if (!denominator) return null;
  const negative = (numerator < 0n) !== (denominator < 0n);
  let n = numerator < 0n ? -numerator : numerator, d = denominator < 0n ? -denominator : denominator;
  const scaled = n * pow(digits);
  let q = scaled / d;
  if ((scaled % d) * 2n >= d) q += 1n;
  let s = q.toString().padStart(digits + 1, '0');
  s = (digits ? s.slice(0, -digits) + '.' + s.slice(-digits) : s).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return (negative && q !== 0n ? '-' : '') + s;
}
function average(values) {
  if (!values.length) return null;
  const scale = values.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const numerator = values.reduce((sum, v) => sum + align(v, scale), 0n);
  const denominator = BigInt(values.length) * pow(scale);
  return { value: ratioString(numerator, denominator), numerator: String(numerator), denominator: String(denominator), decimalPlaces: 12 };
}
function difference(current, baseline) {
  if (!current || !baseline) return null;
  const a = BigInt(current.numerator), ad = BigInt(current.denominator);
  const b = BigInt(baseline.numerator), bd = BigInt(baseline.denominator);
  const n = a * bd - b * ad, d = ad * bd;
  return { value: ratioString(n, d), numerator: String(n), denominator: String(d),
    percent: b === 0n ? null : ratioString(n * 100n, ad * b),
    percentBasis: 'Change divided by the baseline mean; undefined for a zero baseline.' };
}
function timePoint(value) {
  const match = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.(\d+))?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds)) return null;
  return { seconds: Math.floor(milliseconds / 1000), fraction: (match[1] ?? '').replace(/0+$/, '') };
}
function comparePoint(a, b) {
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  const size = Math.max(a.fraction.length, b.fraction.length);
  const x = a.fraction.padEnd(size, '0'), y = b.fraction.padEnd(size, '0');
  return x < y ? -1 : x > y ? 1 : 0;
}
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
function endPoint(value) {
  const point = timePoint(value);
  return point && isDate(value) ? { seconds: point.seconds + 86400, fraction: '' } : point;
}
export function windowOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail('Choose a start and end for the analysis period.');
  const result = {};
  for (const name of ['start', 'end']) {
    if (value[name] !== undefined && value[name] !== '') {
      const v = String(value[name]);
      if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(v) || !Number.isFinite(Date.parse(v)))
        fail('Use an ISO date or a timestamp with an explicit offset.');
      if (new Date(v.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== v.slice(0, 10)) fail('Choose an actual calendar date.');
      const clock = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
      if (clock && (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59)) fail('Choose an actual clock time.');
      result[name] = v;
    }
  }
  if (result.start && result.end) {
    const order = comparePoint(timePoint(result.start), endPoint(result.end));
    if (order > 0 || (isDate(result.end) && order === 0)) fail('The period end precedes its start.');
  }
  return Object.keys(result).length ? result : null;
}
export function inWindow(row, window) {
  if (!window) return true;
  const value = text(field(row, 'time'));
  if (!value) return false;
  // A daily observation is a provider-local calendar date, never an invented UTC instant.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return (!window.start || value >= window.start.slice(0, 10)) && (!window.end || value <= window.end.slice(0, 10));
  }
  const stamp = timePoint(value);
  if (!stamp) return false;
  const start = window.start ? timePoint(window.start) : null;
  const end = window.end ? endPoint(window.end) : null;
  return (!start || comparePoint(stamp, start) >= 0) &&
    (!end || (isDate(window.end) ? comparePoint(stamp, end) < 0 : comparePoint(stamp, end) <= 0));
}
export function seriesIdentity(row) {
  return {
    timeSeriesId: text(field(row, 'time_series_id')),
    locationId: text(field(row, 'monitoring_location_id')),
    parameterCode: text(field(row, 'parameter_code')),
    statisticId: text(field(row, 'statistic_id')),
    unit: text(field(row, 'unit_of_measure')),
    collection: text(row.collection ?? row.source_collection ?? (field(row, 'statistic_id') ? 'daily' : 'continuous')),
    methodCategory: text(field(row, 'method_category')),
  };
}
export const seriesKey = row => sha(seriesIdentity(row));
const rawFeatureId = row => text(row.feature_id ?? row.id) || semanticSha({ series: seriesIdentity(row), time: field(row, 'time'), properties: row.properties, geometry: row.geometry });
const rowIdentity = row => seriesIdentity(row).collection + ':' + rawFeatureId(row);
function rowView(row) {
  return { featureId: rawFeatureId(row), identityKey: rowIdentity(row), time: field(row, 'time'), value: field(row, 'value'),
    approvalStatus: field(row, 'approval_status'), qualifier: field(row, 'qualifier'),
    lastModified: field(row, 'last_modified'), sourceUrl: row.source_url ?? null,
    sourceSha256: row.source_sha256 ?? null, sourcePage: row.source_page ?? null };
}
function digestable(row) {
  return { identity: seriesIdentity(row), time: field(row, 'time'), value: field(row, 'value'),
    approval: field(row, 'approval_status'), qualifier: field(row, 'qualifier'),
    modified: field(row, 'last_modified'), properties: row.properties ?? null, geometry: row.geometry ?? null };
}
function deduplicate(rows) {
  const map = new Map(), conflicts = new Map(), versions = new Map(); let repeated = 0;
  for (const row of rows) {
    if (field(row, 'time') === null) continue;
    const key = rowIdentity(row), version = semanticSha(digestable(row));
    if (!map.has(key)) { map.set(key, row); versions.set(key, new Set([version])); continue; }
    if (versions.get(key).has(version)) { repeated += 1; continue; }
    versions.get(key).add(version);
    const retained = conflicts.get(key) ?? [map.get(key)]; retained.push(row); conflicts.set(key, retained);
  }
  for (const key of conflicts.keys()) map.delete(key);
  return { rows: [...map.values()], repeated, conflicts: [...conflicts].map(([identityKey, records]) =>
    ({ identityKey, featureId: rawFeatureId(records[0]), collection: seriesIdentity(records[0]).collection, records: records.map(rowView) })) };
}
function summary(rows, window, quality) {
  const selected = rows.filter(row => inWindow(row, window) && (quality === 'all' || text(field(row, 'approval_status')).toLowerCase() === quality));
  selected.sort((a, b) => {
    const at = text(field(a, 'time')), bt = text(field(b, 'time'));
    const x = timePoint(at), y = timePoint(bt);
    return (x && y ? comparePoint(x, y) : at.localeCompare(bt)) || rowIdentity(a).localeCompare(rowIdentity(b));
  });
  const numbers = selected.map(row => ({ row, value: decimal(field(row, 'value')) })).filter(x => x.value);
  numbers.sort((a, b) => compare(a.value, b.value));
  const statuses = {}, qualifiers = {};
  for (const row of selected) {
    const status = text(field(row, 'approval_status')) || 'Unspecified';
    statuses[status] = (statuses[status] ?? 0) + 1;
    const qualifier = field(row, 'qualifier');
    if (qualifier !== null && qualifier !== '') {
      for (const item of Array.isArray(qualifier) ? qualifier : [qualifier]) qualifiers[text(item)] = (qualifiers[text(item)] ?? 0) + 1;
    }
  }
  const medianNumbers = numbers.length ? numbers.length % 2 ? [numbers[(numbers.length - 1) / 2].value] : [numbers[numbers.length / 2 - 1].value, numbers[numbers.length / 2].value] : [];
  const times = new Set(selected.map(row => text(field(row, 'time'))));
  return { window, observations: selected.length, numericObservations: numbers.length,
    missingOrNonNumeric: selected.length - numbers.length, distinctTimes: times.size,
    repeatedTimes: selected.length - times.size, firstTime: field(selected[0] ?? {}, 'time'), lastTime: field(selected.at(-1) ?? {}, 'time'),
    minimum: numbers.length ? rowView(numbers[0].row) : null, maximum: numbers.length ? rowView(numbers.at(-1).row) : null,
    mean: average(numbers.map(x => x.value)), median: average(medianNumbers), approvalCounts: statuses, qualifierCounts: qualifiers,
    observationsByTime: selected.map(rowView) };
}

/** Each series stays in its original unit, statistic, method and collection. */
export function analyzeCapture(capture, rows, options = {}) {
  if (!capture || !Array.isArray(rows)) fail('A retained capture and its original rows are required.');
  const quality = options.quality ?? 'all';
  if (!['all', 'approved', 'provisional'].includes(quality)) fail('Choose all, approved, or provisional observations.');
  const window = windowOf(options.window), baselineWindow = windowOf(options.baselineWindow);
  if (capture.selection?.collection === 'daily' && [window, baselineWindow].some(range => range && Object.values(range).some(value => value.includes('T'))))
    fail('Use calendar-date boundaries for daily observations; their provider-local dates have no supplied UTC offset.');
  const unique = deduplicate(rows), selectedSeries = options.series ? new Set(options.series) : null, grouped = new Map();
  for (const row of unique.rows) {
    const key = seriesKey(row);
    if (selectedSeries && !selectedSeries.has(key) && !selectedSeries.has(text(field(row, 'time_series_id')))) continue;
    if (!grouped.has(key)) grouped.set(key, { key, ...seriesIdentity(row), rows: [] });
    grouped.get(key).rows.push(row);
  }
  const series = [...grouped.values()].sort((a, b) => (a.locationId + a.parameterCode + a.timeSeriesId + a.key).localeCompare(b.locationId + b.parameterCode + b.timeSeriesId + b.key)).map(group => {
    const current = summary(group.rows, window, quality);
    const baseline = baselineWindow ? summary(group.rows, baselineWindow, quality) : null;
    return { key: group.key, timeSeriesId: group.timeSeriesId, locationId: group.locationId,
      parameterCode: group.parameterCode, statisticId: group.statisticId, unit: group.unit, collection: group.collection,
      methodCategory: group.methodCategory, current, baseline, change: baseline ? difference(current.mean, baseline.mean) : null };
  });
  const source = { operationId: capture.operationId, captureSha256: capture.captureSha256, status: capture.status,
    selection: capture.selection, completedAt: capture.completedAt ?? null,
    pages: (capture.pages ?? []).map(page => ({ url: page.url, sha256: page.sha256 ?? page.bodySha256, receivedAt: page.receivedAt, count: page.numberReturned ?? page.featureCount })) };
  const result = { schema: 'starforge.usgs-water-analysis.v1', source, options: { quality, window, baselineWindow, series: options.series ?? null },
    counts: { retainedRows: rows.length, uniqueObservationRows: unique.rows.length, repeatedFeatures: unique.repeated,
      conflictingFeatures: unique.conflicts.length, series: series.length, selectedObservations: series.reduce((n, row) => n + row.current.observations, 0) },
    series, conflicts: unique.conflicts,
    method: {
      aggregation: 'Arithmetic summaries of returned numeric observations within each original series. Irregular samples are not time-weighted.',
      exactValues: 'Original value strings are retained. Sums and comparisons use decimal integers; displayed means and changes round to 12 decimal places and retain their exact rational numerator and denominator.',
      missing: 'Missing and non-numeric observations are retained and excluded from arithmetic. Conflicting versions of one feature are excluded and listed for review.',
      quality: 'Approval status and qualifier remain attached to each observation. No qualification is inferred from an empty field.',
      time: 'Daily dates remain provider-local dates. Continuous timestamps preserve their offsets; date-only continuous filter boundaries denote UTC days.',
      coverage: 'Returned records describe the selected capture. No missing date or sampling interval is filled, and observation count does not establish completeness of the monitoring record.',
      usage: 'Operational analysis of USGS source data; thresholds and actions are supplied by the operator.',
    },
  };
  return { ...result, analysisSha256: sha(result) };
}

export function compareCaptures(previous, previousRows, current, currentRows) {
  const left = deduplicate(previousRows), right = deduplicate(currentRows);
  const a = new Map(left.rows.map(row => [rowIdentity(row), row])), b = new Map(right.rows.map(row => [rowIdentity(row), row]));
  const leftConflicts = new Map(left.conflicts.map(row => [row.identityKey, row]));
  const rightConflicts = new Map(right.conflicts.map(row => [row.identityKey, row]));
  const conflictKeys = new Set([...leftConflicts.keys(), ...rightConflicts.keys()]);
  const unresolved = [...conflictKeys].sort().map(identityKey => ({
    identityKey, previous: leftConflicts.get(identityKey)?.records ?? (a.has(identityKey) ? [rowView(a.get(identityKey))] : []),
    current: rightConflicts.get(identityKey)?.records ?? (b.has(identityKey) ? [rowView(b.get(identityKey))] : []),
  }));
  const added = [], removed = [], changed = [];
  for (const [id, row] of b) {
    if (conflictKeys.has(id)) continue;
    if (!a.has(id)) added.push({ identityKey: id, featureId: rawFeatureId(row), row: rowView(row), series: seriesIdentity(row) });
    else if (semanticSha(digestable(a.get(id))) !== semanticSha(digestable(row))) changed.push({ identityKey: id,
      featureId: rawFeatureId(row), previous: rowView(a.get(id)), current: rowView(row), series: seriesIdentity(row) });
  }
  for (const [id, row] of a) if (!conflictKeys.has(id) && !b.has(id)) removed.push({ identityKey: id, featureId: rawFeatureId(row), row: rowView(row), series: seriesIdentity(row) });
  return { schema: 'starforge.usgs-water-comparison.v1',
    previous: { operationId: previous.operationId, captureSha256: previous.captureSha256, status: previous.status, selection: previous.selection },
    current: { operationId: current.operationId, captureSha256: current.captureSha256, status: current.status, selection: current.selection },
    sameSelection: semanticSha(previous.selection) === semanticSha(current.selection),
    counts: { added: added.length, removed: removed.length, changed: changed.length, unresolved: unresolved.length,
      previousConflicts: left.conflicts.length, currentConflicts: right.conflicts.length },
    added, removed, changed, unresolved,
    meaning: 'Comparison of collection-scoped retained feature identities and original properties. Conflicting versions remain unresolved. Absence from the newer capture can reflect changed selections or incomplete acquisition.',
  };
}

const CSV_FIELDS = ['collection', 'feature_id', 'monitoring_location_id', 'time_series_id', 'parameter_code', 'statistic_id', 'time', 'value', 'unit_of_measure', 'approval_status', 'qualifier', 'last_modified', 'source_url', 'source_sha256'];
function csvCell(value) {
  let result = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Protect spreadsheet interpretation while the original JSON remains unchanged.
  if (/^[=+@\t\r]/.test(result) || /^-\D/.test(result)) result = "'" + result;
  return '"' + result.replace(/"/g, '""') + '"';
}
export function observationsCsv(rows) {
  return CSV_FIELDS.join(',') + '\r\n' + rows.map(row => CSV_FIELDS.map(name => csvCell(row[name] ?? field(row, name))).join(',')).join('\r\n') + '\r\n';
}
export function observationsGeoJson(rows) {
  return json({ type: 'FeatureCollection', features: rows.map(row => ({ type: 'Feature', id: row.feature_id ?? row.id,
    geometry: row.geometry ?? null, properties: { ...(row.properties ?? {}), _starforge_source: {
      url: row.source_url ?? null, sha256: row.source_sha256 ?? null, page: row.source_page ?? null } } })) });
}
export function renderReport(analysis, { title = 'Water operations review', note = '', comparison = null } = {}) {
  const rows = analysis.series.map(series => '<tr><td>' + escape(series.locationId) + '<br><small>' + escape(series.timeSeriesId) + '</small></td><td>' +
    escape(series.parameterCode) + ' / ' + escape(series.statisticId) + '</td><td>' + escape(series.unit) + '</td><td>' + series.current.observations + ' / ' + series.current.numericObservations + '</td><td>' +
    escape(series.current.minimum?.value) + '</td><td>' + escape(series.current.maximum?.value) + '</td><td>' + escape(series.current.mean?.value) +
    '</td><td>' + escape(series.change?.value) + '</td><td>' + escape(JSON.stringify(series.current.approvalCounts)) + '</td></tr>').join('');
  const links = analysis.source.pages.map(page => '<li><a href="' + escape(page.url) + '">' + escape(page.url) + '</a><br><small>' +
    escape(page.sha256) + ' · retrieved ' + escape(page.receivedAt) + '</small></li>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) +
    '</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#171717;background:#fff;max-width:1160px;margin:40px auto;padding:0 24px}h1{font-size:28px}h2{margin-top:32px;font-size:19px}small{color:#555}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:10px;border-bottom:1px solid #ccc;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px}a{color:#222;overflow-wrap:anywhere}li{margin:10px 0}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}}</style><h1>' + escape(title) +
    '</h1><p>USGS Water Data · capture ' + escape(analysis.source.operationId) + ' · ' + escape(analysis.source.status) + '</p><p>Conflicting features excluded from arithmetic: ' + analysis.counts.conflictingFeatures + '. Missing or non-numeric selected observations: ' + analysis.series.reduce((n, row) => n + row.current.missingOrNonNumeric, 0) + '.</p><p><small>Capture ' + escape(analysis.source.captureSha256) +
    '<br>Analysis ' + escape(analysis.analysisSha256) + '</small></p><h2>Selected observations</h2><p>Quality: ' + escape(analysis.options.quality) +
    ' · Period: ' + escape(JSON.stringify(analysis.options.window)) + ' · Baseline: ' + escape(JSON.stringify(analysis.options.baselineWindow)) +
    '</p><table><thead><tr><th>Location / series</th><th>Parameter / statistic</th><th>Unit</th><th>Total / numeric N</th><th>Min</th><th>Max</th><th>Mean</th><th>Mean change</th><th>Approval</th></tr></thead><tbody>' + rows +
    '</tbody></table>' + (analysis.conflicts.length ? '<h2>Unresolved source conflicts</h2><pre>' + escape(json(analysis.conflicts)) + '</pre>' : '') + '<h2>Operator decision</h2><pre>' + escape(note || 'No decision note saved.') + '</pre>' +
    (comparison ? '<h2>Capture comparison</h2><pre>' + escape(json({ ...comparison, added: undefined, removed: undefined, changed: undefined })) + '</pre>' : '') +
    '<h2>Calculation and source interpretation</h2><ul>' + Object.values(analysis.method).map(value => '<li>' + escape(value) + '</li>').join('') +
    '</ul><h2>Original source</h2><p>Data supplied by the U.S. Geological Survey. Original GeoJSON and exact response files accompany the saved capture.</p><ul>' + links + '</ul></html>';
}
