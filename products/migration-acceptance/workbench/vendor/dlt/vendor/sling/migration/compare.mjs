// SPDX-License-Identifier: MIT
import {
  canonical, copy, isObject, nonempty, objectDigest, requireValue, unique, verifyDocumentDigest,
} from './common.mjs';

const CELL_TYPES = new Set(['null', 'text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'binary', 'float64']);
const SHA256 = /^[a-f0-9]{64}$/;
const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

function decimalParts(value) {
  const match = DECIMAL.exec(value);
  requireValue(match, 'invalid_decimal', 'A decimal needs an exact finite decimal string.');
  const fraction = match[3] || match[4] || '';
  let digits = ((match[2] || '0') + fraction).replace(/^0+/, '');
  let power = BigInt(match[5] || '0') - BigInt(fraction.length);
  if (!digits) return { negative: false, digits: '0', power: 0n };
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); power += 1n; }
  return { negative: match[1] === '-', digits, power };
}
function normalizedDecimal(value) {
  const item = decimalParts(value);
  return (item.negative ? '-' : '') + item.digits + 'e' + item.power.toString();
}
function normalizedInteger(value) {
  requireValue(INTEGER.test(value), 'invalid_integer', 'An integer needs an exact integer string.');
  return BigInt(value).toString();
}
function calendar(year, month, day) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  requireValue(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1],
    'invalid_calendar_date', 'The date is not in the Gregorian calendar.');
}
function normalizedDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  requireValue(match, 'invalid_date', 'A date must use YYYY-MM-DD.');
  calendar(Number(match[1]), Number(match[2]), Number(match[3]));
  return value;
}
function normalizedTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  requireValue(match, 'invalid_timestamp',
    'Use a complete ISO date/time; retain the original offset or the absence of an offset.');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  calendar(year, month, day);
  requireValue(hour <= 23 && minute <= 59 && second <= 59, 'invalid_timestamp',
    'Hours, minutes and seconds must form an ordinary complete timestamp.');
  const fraction = (match[7] || '').replace(/0+$/, '');
  const suffix = fraction ? '.' + fraction : '';
  if (!match[8]) return 'local:' + match[1] + '-' + match[2] + '-' + match[3] + 'T' +
    match[4] + ':' + match[5] + ':' + match[6] + suffix;
  let offset = 0;
  if (match[8] !== 'Z') {
    const hours = Number(match[8].slice(1, 3)), minutes = Number(match[8].slice(4, 6));
    requireValue(hours <= 23 && minutes <= 59, 'invalid_timestamp_offset', 'The UTC offset is invalid.');
    offset = (hours * 60 + minutes) * 60 * (match[8][0] === '-' ? -1 : 1);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return 'utc:' + (BigInt(date.getTime() / 1000) - BigInt(offset)).toString() + suffix;
}
function normalizedBinary(value) {
  requireValue(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
    'invalid_binary', 'Binary cells must use canonical padded Base64.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (value.endsWith('==')) requireValue((alphabet.indexOf(value.at(-3)) & 15) === 0,
    'invalid_binary_padding', 'Binary Base64 has nonzero padding bits.');
  else if (value.endsWith('=')) requireValue((alphabet.indexOf(value.at(-2)) & 3) === 0,
    'invalid_binary_padding', 'Binary Base64 has nonzero padding bits.');
  return value;
}
function defaultCell(cell) {
  requireValue(isObject(cell) && CELL_TYPES.has(cell.type), 'invalid_typed_cell',
    'Export every cell with an explicit supported type.');
  if (cell.type === 'null') {
    requireValue(cell.value == null, 'invalid_null_cell', 'A null cell must not carry a value.');
    return ['null'];
  }
  requireValue(typeof cell.value === 'string', 'non_string_typed_cell',
    'Typed values must be strings; JSON numbers can lose precision.', { type: cell.type });
  switch (cell.type) {
    case 'integer': return ['integer', normalizedInteger(cell.value)];
    case 'decimal': return ['decimal', normalizedDecimal(cell.value)];
    case 'boolean':
      requireValue(cell.value === 'true' || cell.value === 'false', 'invalid_boolean', 'Use true or false as a string.');
      return ['boolean', cell.value];
    case 'date': return ['date', normalizedDate(cell.value)];
    case 'timestamp':
      // Default comparison preserves lexical timestamp representation.
      normalizedTimestamp(cell.value);
      return ['timestamp', cell.value];
    case 'binary': return ['binary', normalizedBinary(cell.value)];
    case 'float64':
      requireValue(/^[a-fA-F0-9]{16}$/.test(cell.value), 'invalid_float64',
        'Export the original IEEE-754 float64 bytes as 16 big-endian hexadecimal digits.');
      return ['float64', cell.value.toLowerCase()];
    default: return ['text', cell.value];
  }
}

/** Exact typed cell identity. A declared column conversion is explicit and lossless. */
export function canonicalCell(cell, declaredType = null) {
  const original = defaultCell(cell);
  if (original[0] === 'null' || declaredType == null) return original;
  requireValue(CELL_TYPES.has(declaredType) && declaredType !== 'null', 'invalid_cell_type_binding',
    'Select one supported non-null comparison type.', { declaredType });
  if (declaredType === 'timestamp') {
    requireValue(cell.type === 'timestamp' || cell.type === 'text', 'incompatible_timestamp_cell',
      'Timestamp comparison accepts original timestamp or text values.');
    return ['timestamp', normalizedTimestamp(cell.value)];
  }
  if (declaredType === 'date') {
    requireValue(cell.type === 'date' || cell.type === 'text', 'incompatible_date_cell',
      'Date comparison accepts original date or text values.');
    return ['date', normalizedDate(cell.value)];
  }
  if (declaredType === 'decimal') {
    requireValue(['integer', 'decimal', 'text'].includes(cell.type), 'incompatible_decimal_cell',
      'Decimal comparison needs exact decimal text; float64 is not silently rounded.');
    return ['decimal', normalizedDecimal(cell.value)];
  }
  if (declaredType === 'integer') {
    requireValue(['integer', 'decimal', 'text'].includes(cell.type), 'incompatible_integer_cell',
      'Integer comparison needs exact integer text.');
    if (cell.type === 'decimal') {
      const item = decimalParts(cell.value);
      requireValue(item.power >= 0n, 'fractional_integer_conversion', 'A fractional value cannot be compared as an integer.');
      // Decimal identity avoids allocating an enormous expanded integer.
      return ['integer-decimal', (item.negative ? '-' : '') + item.digits + 'e' + item.power.toString()];
    }
    return ['integer-decimal', normalizedDecimal(normalizedInteger(cell.value))];
  }
  if (declaredType === 'boolean') {
    if (cell.type === 'boolean') return original;
    requireValue((cell.type === 'integer' && ['0', '1'].includes(normalizedInteger(cell.value))) ||
      (cell.type === 'text' && ['true', 'false', '0', '1'].includes(cell.value)),
      'incompatible_boolean_cell', 'Explicit boolean conversion accepts only exact true/false or zero/one.');
    return ['boolean', cell.value === 'true' || (cell.type === 'integer' ? normalizedInteger(cell.value) : cell.value) === '1' ? 'true' : 'false'];
  }
  requireValue(cell.type === declaredType, 'incompatible_cell_type',
    'This declared comparison type requires the same original typed value.', { actual: cell.type, declaredType });
  return original;
}
function typeFamily(type) {
  const text = String(type ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const base = text.replace(/\(.*/, '').trim();
  if (/^(?:tinyint|smallint|mediumint|int|integer|bigint|int[248]|int32|int64|uint[0-9]+|serial|bigserial)$/.test(base)) return 'integer';
  if (/^(?:decimal|numeric|number|bignumeric)$/.test(base)) return 'decimal';
  if (/^(?:float|float4|float8|float32|float64|double|double precision|real)$/.test(base)) return 'float64';
  if (/^(?:char|character|varchar|character varying|nvarchar|nchar|text|string|clob)$/.test(base)) return 'text';
  if (/^(?:boolean|bool|bit)$/.test(base)) return 'boolean';
  if (/^(?:blob|binary|varbinary|bytea|bytes)$/.test(base)) return 'binary';
  if (base === 'date') return 'date';
  if (/^(?:timestamp|timestamptz|timestamp without time zone|timestamp with time zone|timestamp_ntz|timestamp_tz|datetime|datetime2)$/.test(base)) return 'timestamp';
  return text || 'undeclared';
}
function validateSide(side, label) {
  requireValue(isObject(side) && Array.isArray(side.columns) && Array.isArray(side.rows),
    'incomplete_observation', 'Each side must contain the complete column list and every typed row.', { side: label });
  side.columns.forEach(column => {
    requireValue(isObject(column), 'invalid_column', 'Every observed column must be an object.', { side: label });
    nonempty(column.name, label + '.column.name');
    requireValue(typeof column.type === 'string', 'invalid_column_type', 'Retain the native column type.', { column: column.name });
  });
  unique(side.columns.map(column => column.name), 'duplicate_observed_column', 'Observed column names must be unique.');
  side.rows.forEach((row, index) => requireValue(Array.isArray(row) && row.length === side.columns.length,
    'invalid_row_width', 'Every complete row must have exactly one cell for each observed column.', { side: label, row: index }));
  requireValue(isObject(side.source) && typeof side.source.kind === 'string' && typeof side.source.path === 'string' &&
    SHA256.test(side.source.sha256 || '') && typeof side.source.recordedAt === 'string',
    'missing_observation_source', 'Retain each full original export path, SHA-256, kind and recording time.', { side: label });
  if (side.source.rowCount != null) requireValue(Number.isSafeInteger(side.source.rowCount) && side.source.rowCount === side.rows.length,
    'partial_rows', 'The declared complete export count does not match the provided rows.', { side: label });
  if (side.complete != null) requireValue(side.complete === true, 'partial_rows', 'A sampled export cannot establish full comparison.', { side: label });
}
function mappedColumns(stream, side, label, names) {
  const map = stream.columnMaps?.[label] ?? {};
  requireValue(isObject(map) && Object.values(map).every(value => typeof value === 'string'),
    'invalid_column_map', 'Column maps must map business-column names to exact observed-column names.', { side: label });
  const indexes = new Map(side.columns.map((column, index) => [column.name, index]));
  const result = names.map(name => ({ name, observedName: map[name] ?? name, index: indexes.get(map[name] ?? name) }));
  unique(result.map(item => item.observedName), 'duplicate_column_mapping', 'Two business columns cannot select the same observed column.');
  return result;
}
function schemaComparison(stream, left, right, names, leftMap, rightMap) {
  const differences = [], errors = [];
  const selected = new Set(names);
  for (const [label, side, mapping, ignored] of [
    ['left', left, leftMap, stream.ignoredLeftColumns || []],
    ['right', right, rightMap, stream.ignoredRightColumns || []],
  ]) {
    const reverse = new Map(mapping.map(item => [item.observedName, item.name]));
    for (const item of mapping) {
      if (item.index === undefined) errors.push({ code: 'missing_business_column', side: label, column: item.name, observedName: item.observedName });
    }
    for (const column of side.columns) {
      if (!reverse.has(column.name) && !ignored.includes(column.name)) {
        errors.push({ code: 'unreviewed_column', side: label, column: column.name });
      }
    }
    for (const ignoredName of ignored) {
      if (reverse.has(ignoredName) && selected.has(reverse.get(ignoredName))) errors.push({
        code: 'metadata_business_overlap', side: label, column: ignoredName,
      });
    }
  }
  for (let at = 0; at < names.length; at += 1) {
    const a = left.columns[leftMap[at].index], b = right.columns[rightMap[at].index];
    if (!a || !b) continue;
    const familyA = typeFamily(a.type), familyB = typeFamily(b.type);
    const explicit = stream.cellTypes?.[names[at]] ?? null;
    if (a.type !== b.type) differences.push({
      column: names[at], field: 'type', left: a.type, right: b.type,
      leftFamily: familyA, rightFamily: familyB, explicitCellType: explicit,
    });
    if (familyA !== familyB && !explicit) errors.push({
      code: 'schema_type_difference', column: names[at], left: a.type, right: b.type,
    });
    for (const field of ['nullable', 'precision', 'scale', 'maxLength']) {
      if (a[field] != null && b[field] != null && a[field] !== b[field]) {
        differences.push({ column: names[at], field, left: a[field], right: b[field] });
        // A wider/looser destination is visible but can preserve the complete source domain.
        const narrows = field === 'nullable' ? a[field] === true && b[field] === false :
          field === 'scale' ? true : Number(b[field]) < Number(a[field]);
        if (narrows) errors.push({ code: 'schema_domain_narrows', column: names[at], field, left: a[field], right: b[field] });
      }
    }
  }
  return { identical: !differences.length && !errors.length, compatible: !errors.length, differences, errors };
}
function numericCompare(a, b) {
  const x = decimalParts(a), y = decimalParts(b);
  if (x.digits === '0' && y.digits === '0') return 0;
  if (x.digits === '0') return y.negative ? 1 : -1;
  if (y.digits === '0') return x.negative ? -1 : 1;
  if (x.negative !== y.negative) return x.negative ? -1 : 1;
  const widthX = BigInt(x.digits.length) + x.power, widthY = BigInt(y.digits.length) + y.power;
  let result;
  if (widthX !== widthY) result = widthX < widthY ? -1 : 1;
  else {
    const width = Math.max(x.digits.length, y.digits.length);
    const dx = x.digits.padEnd(width, '0'), dy = y.digits.padEnd(width, '0');
    result = dx === dy ? 0 : dx < dy ? -1 : 1;
  }
  return x.negative ? -result : result;
}
function cellOrder(a, b) {
  if (a[0] !== b[0]) return null;
  if (a[0] === 'null') return 0;
  if (['integer', 'integer-decimal', 'decimal'].includes(a[0])) return numericCompare(a[1], b[1]);
  if (a[0] === 'float64' || a[0] === 'binary' || a[0] === 'timestamp') return null;
  return a[1] === b[1] ? 0 : a[1] < b[1] ? -1 : 1;
}
function summarizeRows(stream, side, mapping, label, maxExamples) {
  const rows = new Map(), keys = new Map(), invalid = [], invalidCodes = new Map();
  let invalidRowCount = 0;
  const keyIndexes = (stream.primaryKey || []).map(name => mapping.findIndex(item => item.name === name));
  const cursorIndex = mapping.findIndex(item => item.name === stream.updateKey);
  let nullKeyRows = 0, lower = null, upper = null, watermarkOrderable = true, nullWatermarks = 0;
  const errors = [];
  if (keyIndexes.some(at => at < 0)) errors.push({ code: 'key_not_compared', side: label, columns: stream.primaryKey });
  if (stream.updateKey && cursorIndex < 0) errors.push({ code: 'cursor_not_compared', side: label, column: stream.updateKey });
  for (let at = 0; at < side.rows.length; at += 1) {
    const row = side.rows[at];
    let values;
    try {
      values = mapping.map(column => {
        requireValue(column.index !== undefined, 'missing_business_column', 'A compared business column is absent.');
        return canonicalCell(row[column.index], stream.cellTypes?.[column.name]);
      });
    } catch (error) {
      if (invalid.length < maxExamples) invalid.push({ row: at, code: error.code || 'invalid_typed_row', message: error.message });
      const code = error.code || 'invalid_typed_row';
      invalidCodes.set(code, (invalidCodes.get(code) || 0) + 1);
      invalidRowCount += 1;
      continue;
    }
    const identity = canonical(values);
    rows.set(identity, (rows.get(identity) || 0) + 1);
    if (keyIndexes.length && keyIndexes.every(index => index >= 0)) {
      const key = keyIndexes.map(index => values[index]);
      if (key.some(value => value[0] === 'null')) nullKeyRows += 1;
      const identity = canonical(key);
      keys.set(identity, (keys.get(identity) || 0) + 1);
    }
    if (cursorIndex >= 0) {
      const cursor = values[cursorIndex];
      if (cursor[0] === 'null') nullWatermarks += 1;
      else if (lower == null) { lower = cursor; upper = cursor; }
      else {
        const low = cellOrder(cursor, lower), high = cellOrder(cursor, upper);
        if (low === null || high === null) watermarkOrderable = false;
        else { if (low < 0) lower = cursor; if (high > 0) upper = cursor; }
      }
    }
  }
  errors.push(...[...invalidCodes.entries()].map(([code, count]) => ({ code, side: label, count })));
  const duplicateEntries = [...keys.entries()].filter(([, count]) => count > 1);
  return {
    rows, keys, errors, invalid,
    summary: {
      observedRows: side.rows.length,
      comparedRows: side.rows.length - invalidRowCount,
      distinctRows: rows.size,
      rowMultisetDigest: objectDigest([...rows.entries()].sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1)),
      primaryKey: {
        columns: (stream.primaryKey || []).slice(), nullKeyRows,
        duplicateKeyGroups: duplicateEntries.length,
        excessDuplicateRows: duplicateEntries.reduce((sum, [, count]) => sum + count - 1, 0),
        examples: duplicateEntries.slice(0, maxExamples).map(([key, count]) => ({ values: JSON.parse(key), count })),
      },
      watermark: {
        column: stream.updateKey, nullRows: nullWatermarks,
        ordering: watermarkOrderable ? 'exact-value-order' : 'retained-values-without-database-collation',
        minimum: watermarkOrderable ? lower : null, maximum: watermarkOrderable ? upper : null,
        native: side.watermark == null ? null : copy(side.watermark),
      },
      source: copy(side.source),
      invalidExamples: invalid,
    },
  };
}
function multisetDifference(left, right, limit) {
  let missingRows = 0, additionalRows = 0, differingValues = 0;
  const examples = [];
  const identities = new Set([...left.keys(), ...right.keys()]);
  for (const identity of identities) {
    const a = left.get(identity) || 0, b = right.get(identity) || 0;
    if (a === b) continue;
    differingValues += 1;
    if (a > b) missingRows += a - b;
    else additionalRows += b - a;
    if (examples.length < limit) examples.push({ values: JSON.parse(identity), leftCount: a, rightCount: b });
  }
  return { equal: !missingRows && !additionalRows, missingRows, additionalRows, differingValues, examples };
}

/** Compare every complete business row, its multiplicity, schemas, keys and retained native execution. */
export function compareObservations(plan, observations, options = {}) {
  verifyDocumentDigest(plan, 'planId');
  requireValue(plan?.schema === 'slingdata.migration-plan.v1', 'invalid_plan', 'Select a migration plan.');
  requireValue(observations?.schema === 'slingdata.migration-observations.v1', 'invalid_observations', 'Select complete migration observations.');
  requireValue(observations.planId === plan.planId, 'observation_plan_mismatch', 'Observations must identify their exact compiled plan.');
  requireValue(['baseline', 'incremental', 'rollback'].includes(observations.phase), 'invalid_observation_phase',
    'Select baseline, incremental or rollback observations.');
  requireValue(Array.isArray(observations.streams), 'invalid_observations', 'Observations must contain streams.');
  unique(observations.streams.map(item => item.streamId), 'duplicate_observation_stream', 'Each stream must occur exactly once.');
  const limit = options.maxExamples ?? 20;
  requireValue(Number.isSafeInteger(limit) && limit >= 0 && limit <= 100, 'invalid_example_limit', 'Example limit must be between zero and 100.');
  const observed = new Map(observations.streams.map(item => [item.streamId, item]));
  const errors = [];
  for (const id of observed.keys()) if (!plan.selectedStreams.some(stream => stream.id === id)) errors.push({ code: 'unexpected_stream', streamId: id });
  const streams = [];
  for (const stream of plan.selectedStreams) {
    const observation = observed.get(stream.id);
    if (!observation) { errors.push({ code: 'missing_stream', streamId: stream.id }); continue; }
    validateSide(observation.left, 'left'); validateSide(observation.right, 'right');
    const leftReverse = new Map(Object.entries(stream.columnMaps?.left ?? {}).map(([key, value]) => [value, key]));
    const rightReverse = new Map(Object.entries(stream.columnMaps?.right ?? {}).map(([key, value]) => [value, key]));
    const names = stream.businessColumns.length ? stream.businessColumns.slice() : [...new Set([
      ...observation.left.columns.filter(column => !stream.ignoredLeftColumns.includes(column.name)).map(column => leftReverse.get(column.name) ?? column.name),
      ...observation.right.columns.filter(column => !stream.ignoredRightColumns.includes(column.name)).map(column => rightReverse.get(column.name) ?? column.name),
    ])].sort();
    requireValue(names.length > 0, 'no_business_columns', 'Select or observe at least one business column.', { streamId: stream.id });
    const leftMap = mappedColumns(stream, observation.left, 'left', names);
    const rightMap = mappedColumns(stream, observation.right, 'right', names);
    const schema = schemaComparison(stream, observation.left, observation.right, names, leftMap, rightMap);
    const left = summarizeRows(stream, observation.left, leftMap, 'left', limit);
    const right = summarizeRows(stream, observation.right, rightMap, 'right', limit);
    const rows = multisetDifference(left.rows, right.rows, limit);
    const streamErrors = [...schema.errors, ...left.errors, ...right.errors];
    if (!rows.equal) streamErrors.push({ code: 'business_rows_differ', missingRows: rows.missingRows, additionalRows: rows.additionalRows });
    if (stream.primaryKey.length && stream.mode === 'incremental') {
      for (const [label, summary] of [['left', left.summary], ['right', right.summary]]) {
        if (summary.primaryKey.nullKeyRows) streamErrors.push({ code: 'null_primary_key', side: label, count: summary.primaryKey.nullKeyRows });
        if (summary.primaryKey.duplicateKeyGroups) streamErrors.push({
          code: 'duplicate_primary_key', side: label, count: summary.primaryKey.duplicateKeyGroups,
        });
      }
    }
    const native = observation.native ?? null;
    const nativeComplete = isObject(native) && typeof native.commandId === 'string' && native.commandId.length > 0 &&
      native.exitCode === 0 && typeof native.startedAt === 'string' && typeof native.completedAt === 'string';
    if (!nativeComplete) streamErrors.push({ code: 'native_execution_incomplete', native: native == null ? null : copy(native) });
    const result = {
      streamId: stream.id, businessColumns: names,
      equal: rows.equal && !left.errors.length && !right.errors.length,
      readyForCutover: stream.ready && !streamErrors.length,
      schema, left: left.summary, right: right.summary, rows,
      native: native == null ? null : copy(native), errors: streamErrors,
    };
    streams.push(result);
    errors.push(...streamErrors.map(error => ({ streamId: stream.id, ...error })));
  }
  const report = {
    schema: 'slingdata.migration-comparison.v1', planId: plan.planId,
    phase: observations.phase, observationsDigest: objectDigest(observations),
    comparedStreams: streams.length, selectedStreams: plan.selectedStreams.length,
    equal: streams.length === plan.selectedStreams.length && streams.every(stream => stream.equal) &&
      !errors.some(error => ['missing_stream', 'unexpected_stream'].includes(error.code)),
    readyForCutover: plan.ready && streams.length === plan.selectedStreams.length && !errors.length,
    streams, errors,
  };
  report.comparisonId = objectDigest(report);
  return report;
}
