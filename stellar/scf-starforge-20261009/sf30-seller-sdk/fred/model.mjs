// MIT. FRED v1 source semantics; original numeric and vintage values remain intact.
export const SELECTION = 'stellar-forge.fred-selection.v1';
export const CAPTURE = 'stellar-forge.fred-capture.v1';
export const FRED_NOTICE = "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";
export const FRED_TERMS = 'https://fred.stlouisfed.org/docs/api/terms_of_use.html';
export const PUBLIC_CAPTURE = 'stellar-forge.fred-public-table-capture.v1';
export const FRED_ORIGIN = 'https://api.stlouisfed.org';
export const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
export const MAX_PAGE_BYTES = 8 * 1024 * 1024;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const need = (condition, message, code = 'FRED_INVALID', status = 400) => {
  if (!condition) throw Object.assign(new Error(message), { code, status });
};
export function canonical(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  need(plain(value), 'Only JSON values are supported.');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export function utf8Length(value) {
  let bytes = 0;
  for (const character of value) { const cp = character.codePointAt(0); bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4; }
  return bytes;
}
export const clone = value => JSON.parse(JSON.stringify(value));
export function date(value, label = 'Date') {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), label + ' must use YYYY-MM-DD.');
  const parsed = new Date(value + 'T00:00:00Z');
  need(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, label + ' is not a calendar date.');
  return value;
}
export function operationId(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value),
    'Use a stable operation ID of 1–96 letters, digits, underscores or hyphens.');
  return value;
}
export function normalizeSelection(input) {
  need(plain(input), 'A series selection is required.');
  const keys = ['schema', 'series', 'asOf', 'start', 'end', 'pageSize', 'maxRows'];
  need(Object.keys(input).every(key => keys.includes(key)), 'Unknown selection setting.');
  need(input.schema === undefined || input.schema === SELECTION, 'Unknown selection schema.');
  need(Array.isArray(input.series) && input.series.length >= 1 && input.series.length <= 50,
    'Select between one and fifty original FRED series IDs.');
  need(input.series.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(id)) &&
    new Set(input.series).size === input.series.length, 'Series IDs must be unique original FRED identifiers.');
  const selection = { schema: SELECTION, series: [...input.series].sort(), asOf: date(input.asOf, 'Vintage date'),
    start: date(input.start, 'Observation start'), end: date(input.end, 'Observation end'),
    pageSize: input.pageSize ?? 1000, maxRows: input.maxRows ?? 1000000 };
  need(selection.asOf >= '1776-07-04' && selection.start >= '1776-07-04' && selection.start <= selection.end,
    'Dates must be within the FRED range and the observation interval must be ordered.');
  need(Number.isSafeInteger(selection.pageSize) && selection.pageSize >= 1 && selection.pageSize <= 100000,
    'Page size must be from 1 to 100000.');
  need(Number.isSafeInteger(selection.maxRows) && selection.maxRows >= 1 && selection.maxRows <= 1000000,
    'Row capacity must be from 1 to 1000000.');
  return selection;
}
export function fredRequest(selectionInput, series, endpoint = 'series/observations', offset = 0) {
  const selection = normalizeSelection(selectionInput);
  need(selection.series.includes(series), 'Series does not belong to this selection.');
  need(['series', 'series/observations'].includes(endpoint), 'Unsupported FRED source endpoint.');
  need(Number.isSafeInteger(offset) && offset >= 0, 'Observation offset must be nonnegative.');
  const parameters = { series_id: series, file_type: 'json', realtime_start: selection.asOf, realtime_end: selection.asOf };
  if (endpoint === 'series/observations') Object.assign(parameters, { observation_start: selection.start,
    observation_end: selection.end, units: 'lin', output_type: '1', sort_order: 'asc',
    limit: String(selection.pageSize), offset: String(offset) });
  const url = new URL('/fred/' + endpoint, FRED_ORIGIN);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return { endpoint, parameters, url: url.href };
}
function bodyOf(receipt, request) {
  need(plain(receipt) && receipt.status === 200 && canonical(receipt.request) === canonical(request),
    'A retained source response does not match its original request.');
  need(typeof receipt.body === 'string' && utf8Length(receipt.body) <= MAX_PAGE_BYTES,
    'A retained source response exceeds its byte capacity.');
  need(typeof receipt.sha256 === 'string' && /^[a-f0-9]{64}$/.test(receipt.sha256), 'A source digest is required.');
  need(typeof receipt.receivedAt === 'string' && Number.isFinite(Date.parse(receipt.receivedAt)),
    'A source response needs its original capture time.');
  let body;
  try { body = JSON.parse(receipt.body); } catch { need(false, 'FRED source response is not JSON.'); }
  need(plain(body) && !Object.hasOwn(body, 'error_code'), 'FRED returned an error response.');
  return body;
}
function interval(body, selection, label) {
  need(body.realtime_start === selection.asOf && body.realtime_end === selection.asOf,
    label + ' must retain the selected single-date real-time period.');
}
function string(value, label, limit = 65536) {
  need(typeof value === 'string' && value.length <= limit, label + ' must be original source text.');
  return value;
}
export function readSeriesMetadata(receipt, selection, id) {
  const body = bodyOf(receipt, fredRequest(selection, id, 'series'));
  interval(body, selection, 'Series metadata');
  need(Array.isArray(body.seriess) && body.seriess.length === 1 && body.seriess[0]?.id === id,
    'Expected exactly the selected series in original FRED seriess metadata.');
  const source = body.seriess[0];
  interval(source, selection, 'Series');
  const metadata = { id, title: string(source.title, 'Series title'), units: string(source.units, 'Units'),
    frequency: string(source.frequency, 'Frequency'), seasonalAdjustment: string(source.seasonal_adjustment, 'Seasonal adjustment'),
    observationStart: date(source.observation_start), observationEnd: date(source.observation_end),
    lastUpdated: string(source.last_updated, 'Source update time'), notes: string(source.notes ?? '', 'Source notes'),
    sourceUrl: 'https://fred.stlouisfed.org/series/' + encodeURIComponent(id), asOf: selection.asOf };
  need(metadata.observationStart <= metadata.observationEnd, 'Series observation coverage is reversed.');
  return { metadata, original: clone(source) };
}
export function readObservationPage(receipt, selectionInput, id, offset = 0, expectedCount = null) {
  const selection = normalizeSelection(selectionInput);
  const body = bodyOf(receipt, fredRequest(selection, id, 'series/observations', offset));
  interval(body, selection, 'Observation response');
  need(body.observation_start === selection.start && body.observation_end === selection.end &&
    body.units === 'lin' && body.output_type === 1 && body.file_type === 'json' &&
    body.order_by === 'observation_date' && body.sort_order === 'asc',
    'The source must use original level values, original frequency and ascending observation-date output.');
  need(Number.isSafeInteger(body.count) && body.count >= 0 && body.count <= selection.maxRows &&
    body.offset === offset && Number.isSafeInteger(body.limit) && body.limit >= 1 && body.limit <= selection.pageSize,
    'Invalid or oversized original FRED pagination.');
  need(expectedCount === null || body.count === expectedCount, 'Source row count changed during capture.');
  need(Array.isArray(body.observations) && body.observations.length <= body.limit &&
    offset + body.observations.length <= body.count, 'Original page length disagrees with its count.');
  need(offset === 0 || offset < body.count, 'Unexpected page beyond the original source count.');
  need(body.observations.length > 0 || body.count === 0, 'An incomplete FRED page made no progress.');
  let previous = null;
  const observations = body.observations.map(item => {
    need(plain(item), 'Observation must be a source object.');
    const when = date(item.date, 'Observation date');
    need(when >= selection.start && when <= selection.end && (previous === null || when > previous),
      'Observation dates must be unique, ordered and within the selected interval.');
    previous = when;
    interval(item, selection, 'Observation');
    const raw = string(item.value, 'Observation value', 512);
    need(raw === '.' || /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,4})?$/.test(raw),
      'Observation values must remain original numeric strings or the original missing marker.');
    return { date: when, value: raw, missing: raw === '.', realtimeStart: item.realtime_start,
      realtimeEnd: item.realtime_end };
  });
  return { count: body.count, offset, returned: observations.length, nextOffset: offset + observations.length,
    complete: offset + observations.length === body.count, observations };
}
export function inspectCapture(capture) {
  if (capture?.schema === PUBLIC_CAPTURE) return inspectPublicTableCapture(capture);
  need(plain(capture) && capture.schema === CAPTURE, 'Select an original FRED capture bundle.');
  const selection = normalizeSelection(capture.selection);
  need(canonical(selection) === canonical(capture.selection), 'Capture selection is not normalized.');
  need(Array.isArray(capture.records) && capture.records.length >= selection.series.length * 2,
    'Capture is missing original metadata or observation responses.');
  need(utf8Length(JSON.stringify(capture)) <= MAX_CAPTURE_BYTES, 'Capture exceeds 64 MiB.');
  let cursor = 0, totalRows = 0;
  const series = [], rows = [];
  for (const id of selection.series) {
    const meta = readSeriesMetadata(capture.records[cursor++], selection, id), values = [];
    let offset = 0, count = null, previous = null, complete = false;
    while (!complete) {
      need(cursor < capture.records.length, 'Capture is incomplete for ' + id + '.');
      const page = readObservationPage(capture.records[cursor++], selection, id, offset, count);
      count = page.count;
      if (page.observations.length) need(previous === null || page.observations[0].date > previous,
        'Observation dates overlap across retained pages.');
      values.push(...page.observations);
      previous = values.at(-1)?.date ?? null;
      offset = page.nextOffset; complete = page.complete;
      totalRows += page.returned;
      need(totalRows <= selection.maxRows, 'Combined series exceed the selected row capacity.');
    }
    series.push({ ...meta.metadata, count, missing: values.filter(row => row.missing).length });
    for (const item of values) rows.push({ series: id, date: item.date, value: item.value, missing: item.missing,
      as_of: selection.asOf, time_basis: 'FRED_REALTIME_DATE', realtime_start: item.realtimeStart, realtime_end: item.realtimeEnd,
      units: meta.metadata.units, frequency: meta.metadata.frequency, seasonal_adjustment: meta.metadata.seasonalAdjustment });
  }
  need(cursor === capture.records.length, 'Capture contains responses outside the original selection.');
  return { selection, sourceMode: 'API_VINTAGE', timeBasis: 'FRED_REALTIME_DATE', series, rows, rowCount: totalRows,
    missing: rows.filter(row => row.missing).length, sourceResponses: capture.records.length };
}
export const COLUMNS = Object.freeze({ series: 'string', date: 'string', value: 'string', missing: 'boolean',
  as_of: 'string', time_basis: 'string', realtime_start: 'string', realtime_end: 'string', units: 'string', frequency: 'string',
  seasonal_adjustment: 'string' });
export function projectionPolicy(input = {}) {
  need(plain(input) && Object.keys(input).every(key => ['fields', 'filters', 'ranges', 'sorts', 'defaultLimit', 'maxLimit'].includes(key)),
    'Unknown customer projection setting.');
  const fields = input.fields ?? Object.keys(COLUMNS);
  need(Array.isArray(fields) && fields.length > 0 && new Set(fields).size === fields.length &&
    fields.every(key => Object.hasOwn(COLUMNS, key)), 'Select unique original observation columns.');
  for (const key of ['series', 'date', 'value', 'missing', 'as_of', 'time_basis', 'units', 'frequency', 'seasonal_adjustment'])
    need(fields.includes(key), 'Customer output must retain ' + key + ' with the original value.');
  const result = { fields: [...fields], filters: input.filters ?? ['series', 'missing'],
    ranges: input.ranges ?? ['date'], sorts: input.sorts ?? ['date', 'series'],
    defaultLimit: input.defaultLimit ?? 25, maxLimit: input.maxLimit ?? 100 };
  for (const key of ['filters', 'ranges', 'sorts']) {
    need(Array.isArray(result[key]) && result[key].length <= 8 &&
      new Set(result[key]).size === result[key].length && result[key].every(field => fields.includes(field)),
      'Query capabilities must reference unique exposed columns.');
    if (key === 'ranges') need(result[key].every(field => COLUMNS[field] !== 'boolean' && field !== 'value'),
      'Numeric values remain exact source strings; choose an observation or vintage date for ranges.');
    if (key === 'sorts') need(!result[key].includes('value'), 'Exact numeric strings do not have numeric string ordering.');
  }
  need(3 + result.filters.length + 4 * result.ranges.length + (result.sorts.length ? 1 : 0) <= 31,
    'The original seller requires room for the edition snapshot selector.');
  need(Number.isSafeInteger(result.defaultLimit) && Number.isSafeInteger(result.maxLimit) &&
    result.defaultLimit >= 1 && result.defaultLimit <= result.maxLimit && result.maxLimit <= 1000,
    'Page limits must satisfy 1 <= default <= maximum <= 1000.');
  return clone(result);
}
export function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function observationCsv(model, policyInput) {
  const policy = projectionPolicy(policyInput);
  return policy.fields.join(',') + '\n' + model.rows.map(row => policy.fields.map(field => csvCell(row[field])).join(',')).join('\n') +
    (model.rows.length ? '\n' : '');
}
function decimal(value) {
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!parts) return null;
  const exponent = Number(parts[4] ?? 0), fraction = parts[3] ?? '';
  if (Math.abs(exponent) > 1000) return null;
  let integer = BigInt((parts[1] || '') + parts[2] + fraction), scale = fraction.length - exponent;
  if (scale < 0) { integer *= 10n ** BigInt(-scale); scale = 0; }
  return { integer, scale };
}
export function exactDifference(before, after) {
  const a = decimal(before), b = decimal(after);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const difference = b.integer * 10n ** BigInt(scale - b.scale) - a.integer * 10n ** BigInt(scale - a.scale);
  const negative = difference < 0n, digits = (negative ? -difference : difference).toString().padStart(scale + 1, '0');
  const value = scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits;
  const normalized = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return (negative ? '-' : '') + normalized;
}
export function compareCaptures(beforeCapture, afterCapture) {
  const before = inspectCapture(beforeCapture), after = inspectCapture(afterCapture);
  need(canonical(before.selection.series) === canonical(after.selection.series) &&
    before.sourceMode === after.sourceMode &&
    (before.sourceMode === 'PUBLIC_TABLE' || before.selection.start === after.selection.start && before.selection.end === after.selection.end),
    'Compare the same series and source mode; API selections also retain the same observation interval.');
  const metadata = new Map(before.series.map(row => [row.id, row]));
  const metadataChanges = after.series.flatMap(row => {
    const previous = metadata.get(row.id), fields = ['title', 'units', 'frequency', 'seasonalAdjustment', 'observationStart', 'observationEnd', 'lastUpdated', 'notes', 'publisher', 'release'];
    const changes = fields.filter(key => previous[key] !== row[key]).map(key => ({ field: key, before: previous[key], after: row[key] }));
    return changes.length ? [{ series: row.id, changes }] : [];
  });
  const old = new Map(before.rows.map(row => [row.series + '\0' + row.date, row])), changes = [];
  for (const row of after.rows) {
    const key = row.series + '\0' + row.date, previous = old.get(key); old.delete(key);
    if (!previous) { changes.push({ kind: 'added', series: row.series, date: row.date, before: null, after: row.value, delta: null }); continue; }
    const semantics = ['units', 'frequency', 'seasonal_adjustment'].filter(field => previous[field] !== row[field]);
    if (previous.value !== row.value || semantics.length) changes.push({
      kind: semantics.length ? 'meaning-changed' : previous.missing !== row.missing ? 'missing-changed' : 'revised',
      series: row.series, date: row.date, before: previous.value, after: row.value,
      delta: semantics.length || previous.missing || row.missing ? null : exactDifference(previous.value, row.value),
      ...(semantics.length ? { meaningChanges: semantics.map(field => ({ field, before: previous[field], after: row[field] })) } : {}) });
  }
  for (const row of old.values()) changes.push({ kind: 'removed', series: row.series, date: row.date,
    before: row.value, after: null, delta: null });
  changes.sort((a, b) => a.series < b.series ? -1 : a.series > b.series ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return { schema: 'stellar-forge.fred-comparison.v1', beforeAsOf: before.selection.asOf, afterAsOf: after.selection.asOf,
    sourceMode: before.sourceMode, timeBasis: before.timeBasis,
    selection: { series: before.selection.series, start: before.selection.start, end: before.selection.end },
    afterSelection: { start: after.selection.start, end: after.selection.end },
    beforeRows: before.rowCount, afterRows: after.rowCount, unchanged: after.rowCount - changes.filter(row => row.kind !== 'removed').length,
    totals: Object.fromEntries(['added', 'removed', 'revised', 'missing-changed', 'meaning-changed'].map(kind => [kind, changes.filter(row => row.kind === kind).length])),
    metadataChanges, changes };
}

/** Read the actual complete public-table text, preserving its publisher metadata. */
export function readPublicTable(source) {
  need(plain(source) && source.version === 'commons.retained-public-table.v1',
    'Import a retained complete official public-table source.');
  const id = string(source.series_id, 'Original series ID', 100);
  need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(id) &&
    source.source_url === 'https://fred.stlouisfed.org/data/' + encodeURIComponent(id),
    'The public table must name its exact official FRED source page.');
  need(typeof source.retrieved_at === 'string' && Number.isFinite(Date.parse(source.retrieved_at)),
    'Retain the actual public-table retrieval timestamp.');
  const asOf = new Date(source.retrieved_at).toISOString().slice(0, 10);
  need(typeof source.table_text === 'string' && utf8Length(source.table_text) === source.bytes &&
    source.bytes <= MAX_CAPTURE_BYTES && /^[a-f0-9]{64}$/.test(source.sha256 ?? ''),
    'Retain the complete original public-table bytes and digest.');
  const lines = source.table_text.replace(/\r\n?/g, '\n').split('\n'), fields = new Map(), observations = [];
  const tableAt = lines.findIndex(line => /^DATE\s*\|\s*VALUE\s*$/.test(line));
  need(tableAt > 0 && /^# Table Data - .+/.test(lines[0]), 'Original table header is missing.');
  let field = null;
  for (const line of lines.slice(1, tableAt)) {
    const pair = /^([^|]+?)\s*\|\s*(.*)$/.exec(line);
    if (pair) {
      field = pair[1].trim();
      need(!fields.has(field), 'Public table repeats a metadata field.');
      fields.set(field, pair[2]);
    } else if (line.trim()) {
      need(field === 'Notes', 'Unrecognized original table metadata.');
      fields.set(field, fields.get(field) + '\n' + line);
    }
  }
  for (const name of ['Title', 'Series ID', 'Source', 'Frequency', 'Units', 'Seasonal Adjustment', 'Date Range', 'Last Updated'])
    need(fields.has(name) && fields.get(name).length > 0, 'Original table needs ' + name + '.');
  need(fields.get('Series ID') === id, 'Retained table series differs from its source page.');
  const range = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(fields.get('Date Range'));
  need(range, 'Original table date coverage is missing.');
  const start = date(range[1]), end = date(range[2]);
  let previous = null, separator = false;
  for (const line of lines.slice(tableAt + 1)) {
    if (!line.trim()) continue;
    if (/^-+\s*\|\s*-+\s*$/.test(line) && !separator && observations.length === 0) { separator = true; continue; }
    const row = /^(\d{4}-\d{2}-\d{2})\s*\|\s*(\.|-?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,4})?)\s*$/.exec(line);
    need(row, 'Every original public-table observation must remain present and readable.');
    const when = date(row[1]);
    need(when >= start && when <= end && (previous === null || when > previous), 'Public-table dates must remain unique and ordered.');
    observations.push({ date: when, value: row[2], missing: row[2] === '.' }); previous = when;
  }
  need(Number.isSafeInteger(source.observation_count) && observations.length === source.observation_count &&
    observations.length > 0 && observations.length <= 1000000 && observations[0].date === start &&
    observations.at(-1).date === end, 'The complete source count and original coverage must agree.');
  const selection = normalizeSelection({ series: [id], asOf, start, end });
  const metadata = { id, title: fields.get('Title'), publisher: fields.get('Source'), release: fields.get('Release') ?? '',
    units: fields.get('Units'), frequency: fields.get('Frequency'), seasonalAdjustment: fields.get('Seasonal Adjustment'),
    observationStart: start, observationEnd: end, lastUpdated: fields.get('Last Updated'), notes: fields.get('Notes') ?? '',
    sourceUrl: source.source_url, asOf, retrievedAt: source.retrieved_at, timeBasis: 'PUBLIC_TABLE_RETRIEVAL_DATE',
    count: observations.length, missing: observations.filter(row => row.missing).length };
  return { selection, sourceMode: 'PUBLIC_TABLE', timeBasis: 'PUBLIC_TABLE_RETRIEVAL_DATE',
    series: [metadata], rowCount: observations.length, missing: metadata.missing, sourceResponses: 1,
    rows: observations.map(row => ({ series: id, date: row.date, value: row.value, missing: row.missing,
      as_of: asOf, time_basis: 'PUBLIC_TABLE_RETRIEVAL_DATE', realtime_start: '', realtime_end: '',
      units: metadata.units, frequency: metadata.frequency, seasonal_adjustment: metadata.seasonalAdjustment })) };
}
export function inspectPublicTableCapture(capture) {
  need(capture?.schema === PUBLIC_CAPTURE, 'Select a retained public-table capture.');
  const model = readPublicTable(capture.source);
  need(canonical(capture.selection) === canonical(model.selection), 'Public table selection differs from its original coverage.');
  return model;
}
