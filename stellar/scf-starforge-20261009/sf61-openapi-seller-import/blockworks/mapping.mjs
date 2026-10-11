// MIT. Source-bound semantic review and complete-population comparison.
// No network or filesystem access. The caller supplies original capture bytes.
import { createHash } from 'node:crypto';

export const MAPPING_SCHEMA = 'blockworks-mapping/v1';
export const REVIEW_SCHEMA = 'blockworks-mapping-review/v1';
export const COMPARISON_SCHEMA = 'blockworks-comparison/v1';
const SIDES = ['baseline', 'candidate'];
const HASH = /^[a-f0-9]{64}$/;
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof ExactNumber);
const text = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pointer = parts => '/' + parts.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
class ExactNumber { constructor(source) { this.source = source; } }
function stable(value) {
  if (value instanceof ExactNumber) return '{"$number":' + JSON.stringify(value.source) + '}';
  if (value === undefined) return '{"$absent":true}';
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return '{"$bytes":' + JSON.stringify(sha256(value)) + ',"length":' + value.length + '}';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify({ $invalidNumber: String(value) });
  if (typeof value === 'bigint') return JSON.stringify({ $integer: String(value) });
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify({ $unsupported: typeof value });
}
const same = (left, right) => stable(left) === stable(right);
function plain(value) {
  if (value instanceof ExactNumber) return Number(value.source);
  if (Array.isArray(value)) return value.map(plain);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
}
function jsonCopy(value) { return JSON.parse(JSON.stringify(value)); }
const ISSUE_KEYS = new WeakMap();
function problem(issues, code, path, message, severity = 'error', extra = {}) {
  const issue = { code, path, message, severity, ...extra };
  let keys = ISSUE_KEYS.get(issues);
  if (!keys) { keys = new Set(issues.map(row => stable([row.code, row.path, row.side, row.message, row.details?.identity]))); ISSUE_KEYS.set(issues, keys); }
  const key = stable([code, path, issue.side, message, issue.details?.identity]);
  if (!keys.has(key)) { keys.add(key); issues.push(issue); }
  return issue;
}

/** Parse JSON without losing numeric lexemes or accepting duplicate properties. */
function exactJson(input) {
  let index = 0;
  const fail = message => { throw new TypeError(message + ' at JSON byte/character offset ' + index); };
  const whitespace = () => { while (/[\x20\t\r\n]/.test(input[index] ?? '') && index < input.length) index++; };
  function stringValue() {
    const begin = index++;
    while (index < input.length) {
      const character = input[index++];
      if (character === '"') return JSON.parse(input.slice(begin, index));
      if (character === '\\') index++;
      else if (character.charCodeAt(0) < 32) fail('Control character in JSON string');
    }
    fail('Unterminated JSON string');
  }
  function value(depth = 0) {
    if (depth > 300) fail('JSON nesting exceeds supported depth');
    whitespace();
    const character = input[index];
    if (character === '"') return stringValue();
    if (character === '{') {
      index++; whitespace(); const result = Object.create(null);
      if (input[index] === '}') { index++; return result; }
      while (index < input.length) {
        whitespace(); if (input[index] !== '"') fail('Expected JSON object key');
        const key = stringValue(); whitespace();
        if (own(result, key)) fail('Duplicate JSON object property ' + key);
        if (input[index++] !== ':') fail('Expected JSON colon');
        result[key] = value(depth + 1); whitespace();
        const separator = input[index++];
        if (separator === '}') return result;
        if (separator !== ',') fail('Expected JSON object separator');
      }
    } else if (character === '[') {
      index++; whitespace(); const result = [];
      if (input[index] === ']') { index++; return result; }
      while (index < input.length) {
        result.push(value(depth + 1)); whitespace();
        const separator = input[index++];
        if (separator === ']') return result;
        if (separator !== ',') fail('Expected JSON array separator');
      }
    } else {
      for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
        if (input.startsWith(token, index)) { index += token.length; return result; }
      }
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(index));
      if (number) { index += number[0].length; return new ExactNumber(number[0]); }
    }
    fail('Unexpected JSON value');
  }
  const result = value(); whitespace();
  if (index !== input.length) fail('Trailing JSON input');
  return result;
}
function csvRows(input, options = {}) {
  const delimiter = options.delimiter;
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || ['\"', '\r', '\n'].includes(delimiter)) throw new TypeError('Declare one original CSV delimiter.');
  if (typeof options.header !== 'boolean') throw new TypeError('Declare whether the original CSV has a header.');
  const table = []; let row = [], cell = '', state = 'start';
  const commitCell = () => { row.push(cell); cell = ''; state = 'start'; };
  const commitRow = () => { commitCell(); table.push(row); row = []; };
  for (let index = 0; index < input.length; index++) {
    const ch = input[index];
    if (state === 'quoted') {
      if (ch === '"') {
        if (input[index + 1] === '"') { cell += '"'; index++; } else state = 'closed';
      } else cell += ch;
      continue;
    }
    if (state === 'closed' && ![delimiter, '\r', '\n'].includes(ch)) throw new TypeError('Characters follow a closed CSV quote.');
    if (ch === delimiter) { commitCell(); continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[index + 1] === '\n') index++;
      commitRow(); continue;
    }
    if (ch === '"') {
      if (state !== 'start' || cell) throw new TypeError('Quote inside an unquoted CSV field.');
      state = 'quoted'; continue;
    }
    cell += ch; state = 'unquoted';
  }
  if (state === 'quoted') throw new TypeError('Unterminated CSV field.');
  if (cell || row.length || state === 'closed') commitRow();
  if (!table.length) throw new TypeError('CSV header is missing.');
  const headers = options.header ? table.shift() : options.columns;
  if (!Array.isArray(headers) || !headers.length || headers.some(key => typeof key !== 'string' || !key) || new Set(headers).size !== headers.length) throw new TypeError('CSV headers must be distinct original names.');
  return table.map((values, index) => {
    if (values.length !== headers.length) throw new TypeError('CSV row ' + (index + 2) + ' has a different field count.');
    return Object.fromEntries(headers.map((key, column) => [key, values[column]]));
  });
}

function gcd(left, right) {
  left = left < 0n ? -left : left; right = right < 0n ? -right : right;
  while (right) [left, right] = [right, left % right];
  return left || 1n;
}
function rational(numerator, denominator = 1n) {
  if (!denominator) throw new TypeError('Zero numeric denominator.');
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  return { n: numerator / divisor, d: denominator / divisor };
}
function decimal(value) {
  const source = value instanceof ExactNumber ? value.source : typeof value === 'number' ? String(value) : value;
  if (typeof source !== 'string' || source.length > 4000) throw new TypeError('A finite decimal value is required.');
  const found = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!found) throw new TypeError('A finite decimal value is required.');
  const exponent = Number(found[4] ?? 0) - (found[3]?.length ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 4000) throw new TypeError('Decimal exponent exceeds supported exact arithmetic range.');
  let numerator = BigInt((found[1] === '-' ? '-' : '') + found[2] + (found[3] ?? '')), denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent); else denominator = 10n ** BigInt(-exponent);
  return rational(numerator, denominator);
}
const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => rational(a.n * b.n, a.d * b.d);
const abs = value => rational(value.n < 0n ? -value.n : value.n, value.d);
const cmp = (a, b) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const ZERO = rational(0n), ONE = rational(1n);
function numericView(value) {
  return { numerator: String(value.n), denominator: String(value.d), exact: value.d === 1n ? String(value.n) : String(value.n) + '/' + String(value.d) };
}
function rfcSeconds(value) {
  if (typeof value !== 'string') throw new TypeError('An RFC3339 timestamp with an explicit timezone is required.');
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) throw new TypeError('An RFC3339 timestamp with an explicit timezone is required.');
  if (m[8] === '-00:00') throw new TypeError('RFC3339 -00:00 denotes an unknown offset; retain a known offset for exact UTC alignment.');
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) throw new TypeError('Invalid RFC3339 calendar time.');
  const local = new Date(0); local.setUTCFullYear(year, month - 1, day); local.setUTCHours(hour, minute, second, 0);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) throw new TypeError('Invalid RFC3339 calendar date.');
  let offset = 0;
  if (!/^[Zz]$/.test(m[8])) {
    const hours = Number(m[8].slice(1, 3)), minutes = Number(m[8].slice(4, 6));
    if (hours > 23 || minutes > 59) throw new TypeError('Invalid RFC3339 timezone offset.');
    offset = (hours * 3600 + minutes * 60) * (m[8][0] === '-' ? -1 : 1);
  }
  return add(rational(BigInt(local.getTime() / 1000 - offset)), m[7] ? decimal('0' + m[7]) : ZERO);
}
function timeValue(value, format) {
  if (format === 'rfc3339') return rfcSeconds(value);
  const result = decimal(value);
  if (format === 'unix-s') return result;
  if (format === 'unix-ms') return mul(result, rational(1n, 1000n));
  throw new TypeError('Choose unix-ms, unix-s or rfc3339 explicitly.');
}
function boundary(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return rfcSeconds(value + 'T00:00:00Z');
  if (typeof value === 'string' && /[Tt]/.test(value)) return rfcSeconds(value);
  return decimal(value);
}
function cell(value, present = true) {
  if (!present || value === undefined) return { state: 'absent' };
  if (value === null) return { state: 'null', value: null };
  if (value instanceof ExactNumber) return { state: 'value', type: 'number', value: value.source };
  if (typeof value === 'number') return { state: 'value', type: 'number', value: String(value) };
  if (typeof value === 'string' || typeof value === 'boolean') return { state: 'value', type: typeof value, value };
  return { state: 'value', type: Array.isArray(value) ? 'array' : 'object', value: plain(value) };
}
function atPath(root, path) {
  let value = root;
  for (const key of path) {
    if (value === null || value === undefined || typeof value !== 'object' || value instanceof ExactNumber || !own(value, key)) return { value: undefined, present: false };
    value = value[key];
  }
  return { value, present: true };
}
function validPath(value) { return Array.isArray(value) && value.every(key => (typeof key === 'string' && key.length > 0) || (Number.isSafeInteger(key) && key >= 0)); }
const DESCRIPTOR_INDEXES = new WeakMap();
function selectorValue(sample, selector) {
  if (selector.from !== 'point') return atPath(selector.from === 'row' ? sample.row : sample.entity, selector.path);
  const descriptorKey = selector.descriptorKey ?? 'field';
  let indexes = sample.schema && DESCRIPTOR_INDEXES.get(sample.schema);
  if (!indexes && sample.schema) { indexes = new Map(); DESCRIPTOR_INDEXES.set(sample.schema, indexes); }
  if (indexes && !indexes.has(descriptorKey)) {
    const byValue = new Map();
    sample.schema.forEach((descriptor, index) => {
      if (!object(descriptor) || !own(descriptor, descriptorKey)) return;
      const found = byValue.get(descriptor[descriptorKey]) ?? []; found.push({ descriptor, index }); byValue.set(descriptor[descriptorKey], found);
    });
    indexes.set(descriptorKey, byValue);
  }
  const candidates = indexes?.get(descriptorKey)?.get(selector.path[0]) ?? [];
  if (candidates.length !== 1) return { value: undefined, present: false, schemaError: 'An exact, unique original descriptor is required.' };
  const selected = candidates[0];
  const value = atPath(sample.point, [selected.index, ...selector.path.slice(1)]);
  return { ...value, descriptor: selected.descriptor, descriptorIndex: selected.index };
}
function valueIdentity(value) {
  const packed = cell(value);
  if (packed.state !== 'value' || !['string', 'number', 'boolean'].includes(packed.type) || packed.value === '') throw new TypeError('A nonempty original scalar identity is required.');
  return packed.type === 'number' ? 'number:' + numericView(decimal(value)).exact : packed.type + ':' + JSON.stringify(packed.value);
}
function validateMapping(mapping, issues) {
  const result = { keys: [], measures: [], window: null, decisions: new Map() };
  if (!object(mapping) || mapping.schemaVersion !== MAPPING_SCHEMA) {
    problem(issues, 'MAPPING_SCHEMA', '/mapping/schemaVersion', 'Use ' + MAPPING_SCHEMA + '.'); return result;
  }
  if (!text(mapping.id)) problem(issues, 'MAPPING_ID', '/mapping/id', 'Retain a nonempty mapping identity.');
  const decisions = Array.isArray(mapping.decisions) ? mapping.decisions : [];
  decisions.forEach((decision, index) => {
    const path = '/mapping/decisions/' + index;
    if (!object(decision) || !text(decision.id)) { problem(issues, 'DECISION_ID', path, 'Each retained decision needs an identity.'); return; }
    if (result.decisions.has(decision.id)) problem(issues, 'DECISION_DUPLICATE', path, 'A decision identity is repeated.');
    result.decisions.set(decision.id, decision);
  });
  function approval(id, kind, path) {
    const decision = result.decisions.get(id);
    let dated = false; try { rfcSeconds(decision?.at); dated = true; } catch {}
    const ready = decision?.decision === 'approved' && decision.kind === kind && text(decision.by) && dated && text(decision.reference) && text(decision.note);
    if (!ready) problem(issues, 'DECISION_REQUIRED', path, 'Retain the approved ' + kind + ' decision, reviewer, timezone-qualified date, source reference and explanation.');
    return ready;
  }
  function selectors(item, path, isMeasure) {
    for (const side of SIDES) {
      const value = item[side], at = path + '/' + side;
      if (!object(value) || !['row', 'entity', 'point'].includes(value.from) || !validPath(value.path) || !value.path.length) {
        problem(issues, 'SELECTOR_INVALID', at, 'Choose row, entity or point and a nonempty array of exact original field segments.'); continue;
      }
      if (value.from === 'point' && (typeof value.path[0] !== 'string' || (own(value, 'descriptorKey') && !text(value.descriptorKey))))
        problem(issues, 'POINT_SELECTOR_INVALID', at, 'A point selector names an original descriptor property and its exact field identity.');
      if (item.semantic === 'time' && !['unix-ms', 'unix-s', 'rfc3339'].includes(value.timeFormat))
        problem(issues, 'TIME_FORMAT_REQUIRED', at + '/timeFormat', 'Declare unix-ms, unix-s or rfc3339 for each original time selector.');
      if (isMeasure && (!own(value, 'unit') || !(value.unit === null || text(value.unit))))
        problem(issues, 'UNIT_REQUIRED', at + '/unit', 'Declare the source unit exactly, or null when no unit is stated.');
      if (isMeasure && !object(value.dimensions)) problem(issues, 'DIMENSIONS_REQUIRED', at + '/dimensions', 'Retain the original metric dimensions; use an empty object when none apply.');
    }
  }
  const ids = new Set();
  if (!Array.isArray(mapping.keys) || !mapping.keys.length) problem(issues, 'KEYS_REQUIRED', '/mapping/keys', 'Choose the original population identity keys.');
  for (const [index, key] of (Array.isArray(mapping.keys) ? mapping.keys : []).entries()) {
    const path = '/mapping/keys/' + index;
    if (!object(key) || !text(key.id) || ids.has(key.id)) { problem(issues, 'KEY_ID', path, 'Mapping key identities must be nonempty and unique.'); continue; }
    ids.add(key.id); selectors(key, path, false);
    const aliases = { baseline: new Map(), candidate: new Map() }, canonical = new Set();
    if (own(key, 'aliases') && !Array.isArray(key.aliases)) problem(issues, 'ALIASES_INVALID', path + '/aliases', 'Identity aliases must be an array.');
    (Array.isArray(key.aliases) ? key.aliases : []).forEach((alias, position) => {
      const at = path + '/aliases/' + position;
      if (!object(alias)) { problem(issues, 'ALIAS_INVALID', at, 'Retain both original identities and their canonical customer identity.'); return; }
      approval(alias.decisionId, 'identity', at + '/decisionId');
      try {
        const target = valueIdentity(alias.canonical);
        if (canonical.has(target)) problem(issues, 'ALIAS_MANY_TO_ONE', at, 'Separate original identities cannot silently collapse into one customer identity.');
        canonical.add(target);
        for (const side of SIDES) {
          const source = valueIdentity(alias[side]);
          if (aliases[side].has(source)) problem(issues, 'ALIAS_DUPLICATE', at + '/' + side, 'An original identity has more than one mapping.');
          aliases[side].set(source, { identity: target, canonical: alias.canonical, decisionId: alias.decisionId });
        }
      } catch (error) { problem(issues, 'ALIAS_INVALID', at, error.message); }
    });
    if (key.semantic === 'time' && (key.aliases?.length ?? 0)) problem(issues, 'TIME_ALIAS_UNSUPPORTED', path, 'Use the declared time format; time instants are not identity aliases.');
    result.keys.push({ definition: key, path, aliases });
  }
  const measureIds = new Set();
  if (!Array.isArray(mapping.measures) || !mapping.measures.length) problem(issues, 'MEASURES_REQUIRED', '/mapping/measures', 'Choose at least one customer measure.');
  for (const [index, measure] of (Array.isArray(mapping.measures) ? mapping.measures : []).entries()) {
    const path = '/mapping/measures/' + index;
    if (!object(measure) || !text(measure.id) || measureIds.has(measure.id)) { problem(issues, 'MEASURE_ID', path, 'Measure identities must be nonempty and unique.'); continue; }
    measureIds.add(measure.id); selectors(measure, path, true);
    if (!['numeric', 'scalar'].includes(measure.interpretation))
      problem(issues, 'MEASURE_INTERPRETATION_REQUIRED', path + '/interpretation', 'Choose numeric decimal interpretation or original scalar type and value explicitly.');
    let factor = ONE, offset = ZERO, absolute = ZERO, relative = ZERO;
    try {
      if (!object(measure.conversion)) throw new TypeError('Retain the candidate-to-baseline factor and offset explicitly.');
      factor = decimal(measure.conversion.factor); offset = decimal(measure.conversion.offset);
      if (!factor.n) throw new TypeError('A zero conversion factor would erase the source values.');
    } catch (error) { problem(issues, 'CONVERSION_INVALID', path + '/conversion', error.message); }
    const semanticChange = !same(measure.baseline?.unit, measure.candidate?.unit) || !same(measure.baseline?.dimensions, measure.candidate?.dimensions);
    if (cmp(factor, ONE) !== 0 || cmp(offset, ZERO) !== 0 || semanticChange) approval(measure.conversion?.decisionId, 'conversion', path + '/conversion/decisionId');
    try {
      if (!object(measure.tolerance)) throw new TypeError('Retain absolute and relative tolerances explicitly.');
      absolute = decimal(measure.tolerance.absolute); relative = decimal(measure.tolerance.relative);
      if (absolute.n < 0n || relative.n < 0n) throw new TypeError('Tolerances must be nonnegative.');
    } catch (error) { problem(issues, 'TOLERANCE_INVALID', path + '/tolerance', error.message); }
    if (absolute.n !== 0n || relative.n !== 0n) approval(measure.tolerance?.decisionId, 'tolerance', path + '/tolerance/decisionId');
    if (measure.interpretation === 'scalar' && (measure.baseline?.unit !== null || measure.candidate?.unit !== null || semanticChange ||
        cmp(factor, ONE) !== 0 || cmp(offset, ZERO) !== 0 || absolute.n !== 0n || relative.n !== 0n))
      problem(issues, 'SCALAR_CONVERSION_UNSUPPORTED', path, 'Original scalar comparison requires unitless unchanged dimensions, factor 1, offset 0 and zero tolerances.');
    result.measures.push({ definition: measure, path, factor, offset, absolute, relative });
  }
  const timeKeys = result.keys.filter(key => key.definition.semantic === 'time');
  if (timeKeys.length > 1) problem(issues, 'TIME_KEY_AMBIGUOUS', '/mapping/keys', 'Use one declared observation-time key.');
  if (mapping.window !== null && mapping.window !== undefined) {
    try {
      if (!object(mapping.window) || timeKeys.length !== 1 || mapping.window.timeKey !== timeKeys[0].definition.id)
        throw new TypeError('window.timeKey must name the configured time key.');
      const start = decimal(mapping.window.start), end = decimal(mapping.window.end);
      if (cmp(start, end) >= 0) throw new TypeError('Use an increasing UTC-second half-open window [start,end).');
      result.window = { start, end, key: timeKeys[0] };
    } catch (error) { problem(issues, 'WINDOW_INVALID', '/mapping/window', error.message); }
  } else if (timeKeys.length) problem(issues, 'WINDOW_REQUIRED', '/mapping/window', 'Retain the exact UTC-second [start,end) comparison window.');
  return result;
}

/** Decode retained legacy bytes for the receiving adapter. Original comparison reparses these same bytes exactly. */
export function decodeLegacyCapture(body, { format, csv } = {}) {
  if (!(Buffer.isBuffer(body) || body instanceof Uint8Array))
    throw new TypeError('Retain the original legacy response bytes as a Buffer or Uint8Array.');
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(body).replace(/^\uFEFF/, '');
  if (format === 'json') return plain(exactJson(raw));
  if (format === 'csv') return csvRows(raw, csv);
  throw new TypeError('Declare the retained legacy format as json or csv.');
}

function pointerParts(value, label) {
  if (typeof value !== 'string' || (value !== '' && !value.startsWith('/')) || /~(?:[^01]|$)/.test(value))
    throw new TypeError('Declare ' + label + ' as an RFC6901 JSON pointer.');
  return value === '' ? [] : value.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}
function projectCapture(document, source, capture, issues, side) {
  const request = source.manifest.request ?? {}, projection = request.projection;
  const path = '/sources/' + side + '/captures/' + capture.id;
  const kind = source.result.kind, fileImport = capture.status === null;
  const legacyImport = request.kind === 'legacy-import' || projection?.schemaVersion === 'blockworks-legacy-projection/v1';
  const pick = (root, selector, label, required = true) => {
    if (selector === undefined && !required) return undefined;
    const found = atPath(root, pointerParts(selector, label));
    if (!found.present && required) throw new TypeError('The declared ' + label + ' pointer is absent.');
    return found.value;
  };
  let rows = [], entries = [], schema = null, metadata = {}, legacy = false, rowPath = [], singletonRow = false;
  if (legacyImport || fileImport) {
    legacy = true;
    if (!object(projection) || projection.schemaVersion !== 'blockworks-legacy-projection/v1')
      throw new TypeError('Retain the original blockworks-legacy-projection/v1 selection.');
    if (projection.format !== request.format || projection.kind !== kind)
      throw new TypeError('The original projection format and family differ from the returned source.');
    if (request.format === 'csv') {
      if (!Array.isArray(document)) throw new TypeError('The original CSV decoder did not return rows.');
      if (kind !== 'tabular') throw new TypeError('Retain CSV as original rows and select its declared time column with row selectors.');
      rows = document;
    } else if (kind === 'tabular') {
      rowPath = pointerParts(projection.rowsPointer, 'rows');
      rows = pick(document, projection.rowsPointer, 'rows');
    } else {
      schema = pick(document, projection.pointSchemaPointer, 'point schema');
      const origins = projection.seriesPointer === undefined ? [document] : pick(document, projection.seriesPointer, 'series');
      if (!Array.isArray(origins)) throw new TypeError('The original series pointer must return an array.');
      entries = origins.map((entry, index) => {
        if (projection.seriesPointer === undefined && !own(projection, 'seriesKey')) throw new TypeError('Retain the explicitly declared original series key.');
        if (projection.seriesPointer !== undefined && projection.seriesKeyPointer === undefined) throw new TypeError('Retain the original per-series key pointer.');
        const key = projection.seriesPointer === undefined ? projection.seriesKey : pick(entry, projection.seriesKeyPointer, 'series key');
        const points = pick(entry, projection.pointsPointer, 'series points');
        const entity = projection.entityPointer === undefined ? projection.entity : pick(entry, projection.entityPointer, 'series entity', false);
        const sourcePath = projection.seriesPointer === undefined ? [] : [...pointerParts(projection.seriesPointer, 'series'), index];
        return { row: { ...(projection.seriesPointer === undefined ? {} : object(entry) ? entry : {}), key, points, ...(entity === undefined ? {} : { entity }) },
          key, points, entity, schema, path: sourcePath,
          pointsPath: [...sourcePath, ...pointerParts(projection.pointsPointer, 'points')] };
      });
    }
    if (projection.metadataPointer !== undefined) metadata = pick(document, projection.metadataPointer, 'metadata', false) ?? {};
    if (projection.totalRowsPointer !== undefined) {
      const total = plain(pick(document, projection.totalRowsPointer, 'total rows'));
      const count = kind === 'tabular' ? rows.length : entries.reduce((n, entry) => n + entry.points.length, 0);
      if (!Number.isSafeInteger(total) || total < 0 || count !== total)
        problem(issues, 'EXPORT_SOURCE_TOTAL', path, 'The declared whole export differs from its original total-row field.', 'error', { side, details: { originalTotalRows: total, receivedRows: count } });
    }
    if (projection.totalPagesPointer !== undefined) pick(document, projection.totalPagesPointer, 'total pages');
  } else {
    if (!object(document) || !own(document, 'data')) throw new TypeError('The original response has no data envelope.');
    if (own(document, 'error') && document.error !== null && document.error !== '') throw new TypeError('The original response contains a provider error.');
    metadata = document.metadata ?? {};
    if (kind === 'tabular') {
      rows = Array.isArray(document.data) ? document.data : object(document.data) ? [document.data] : [];
      if (!Array.isArray(document.data) && !object(document.data)) throw new TypeError('The original tabular data is absent.');
      rowPath = ['data']; singletonRow = !Array.isArray(document.data);
    } else if (kind === 'catalog') {
      rows = document.data?.models; rowPath = ['data', 'models'];
    } else {
      const data = document.data;
      if (!object(data)) throw new TypeError('The original timeseries data is absent.');
      schema = data.point_schema;
      const original = Array.isArray(data.series) ? data.series : [data];
      entries = original.map((entry, index) => {
        const origin = Array.isArray(data.series) ? ['data', 'series', index] : ['data'];
        return { row: entry, key: entry.key, points: entry.points, entity: entry.entity, schema: entry.point_schema ?? schema,
          path: origin, pointsPath: [...origin, 'points'] };
      });
    }
  }
  if (kind === 'tabular' || kind === 'catalog') {
    if (!Array.isArray(rows) || !rows.every(object)) throw new TypeError('The original projected rows must be objects.');
    return { rows, entries: [], schema, metadata, legacy,
      samples: rows.map((row, index) => ({ row, entity: row.entity, point: null, schema: null, legacy,
        location: { captureId: capture.id, row: index, pointer: pointer(singletonRow ? rowPath : [...rowPath, index]) } })) };
  }
  const samples = [];
  for (const [seriesIndex, entry] of entries.entries()) {
    if (!Array.isArray(entry.schema) || !entry.schema.length || !entry.schema.every(object)) throw new TypeError('Retain the original array of point descriptor objects.');
    if (!Array.isArray(entry.points)) throw new TypeError('The original points must be an array.');
    try { valueIdentity(entry.key); } catch { throw new TypeError('Each original series needs its retained scalar canonical key.'); }
    if (!entry.points.length && !object(entry.entity)) problem(issues, 'UNRESOLVED_SERIES', path, 'This returned key has neither entity metadata nor points.', 'error', { side, details: { key: cell(entry.key) } });
    const descriptorFields = new Map();
    entry.schema.forEach((descriptor, index) => {
      for (const property of ['field', 'slug']) if (typeof descriptor[property] === 'string') {
        const name = property + ':' + descriptor[property];
        if (descriptorFields.has(name)) throw new TypeError('The original point schema repeats descriptor ' + name + '.');
        descriptorFields.set(name, index);
      }
    });
    for (const [pointIndex, point] of entry.points.entries()) {
      if (!Array.isArray(point) || point.length !== entry.schema.length) throw new TypeError('A point width differs from its original point descriptor array.');
      if (!legacy && (!(point[0] instanceof ExactNumber) || !Number.isFinite(Number(point[0].source)) ||
          point.slice(1).some(value => value !== null && (!(value instanceof ExactNumber) || !Number.isFinite(Number(value.source))))))
        throw new TypeError('The original Blockworks point contract requires finite numeric time and nullable finite numeric metrics.');
      samples.push({ row: entry.row, entity: entry.entity, point, schema: entry.schema, legacy,
        location: { captureId: capture.id, series: seriesIndex, seriesKey: cell(entry.key), point: pointIndex, pointer: pointer([...entry.pointsPath, pointIndex]) } });
    }
  }
  return { rows: [], entries, schema, metadata, legacy, samples };
}
function validDate(value) { try { rfcSeconds(value); return true; } catch { return false; } }
function inspectSource(source, side, issues) {
  const base = '/sources/' + side;
  const result = { side, samples: [], entries: [], rows: [], captures: [], complete: false, kind: null, coverage: {}, digest: null,
    acceptedCaptureCount: 0, historicalFailureCount: 0, fileImport: false, legacyImport: false, schema: null };
  if (!object(source) || !object(source.manifest) || !object(source.result) || !Array.isArray(source.captures)) {
    problem(issues, 'SOURCE_ENVELOPE', base, 'Supply the original manifest, unchanged readRows result and readCapture {body:Buffer,metadata} entries.', 'error', { side }); return result;
  }
  const manifest = source.manifest, native = source.result;
  result.legacyImport = manifest.request?.kind === 'legacy-import' || manifest.request?.projection?.schemaVersion === 'blockworks-legacy-projection/v1';
  result.kind = native.kind; result.complete = native.complete === true; result.coverage = native.coverage ?? manifest.coverage ?? {};
  if (!text(manifest.id)) problem(issues, 'SOURCE_ID', base + '/manifest/id', 'Retain the original acquisition/import identity.', 'error', { side });
  if (!['tabular', 'timeseries', 'single-series', 'multi-series', 'catalog'].includes(native.kind))
    problem(issues, 'SOURCE_KIND', base + '/result/kind', 'Use the actual tabular or timeseries family.', 'error', { side });
  if (!result.complete) problem(issues, 'SOURCE_INCOMPLETE', base + '/result/complete', 'Finish or explicitly declare the source extraction before comparing its population.', 'error', { side, details: { state: manifest.state ?? null, problem: manifest.problem ?? null } });
  if (!object(native.coverage) || !object(manifest.coverage)) problem(issues, 'COVERAGE_REQUIRED', base, 'Retain source coverage with both the manifest and readRows result.', 'error', { side });
  for (const [location, value] of [['manifest/complete', manifest.complete], ['manifest/coverage/complete', manifest.coverage?.complete], ['result/coverage/complete', native.coverage?.complete]]) {
    if (value !== undefined && (typeof value !== 'boolean' || value !== native.complete))
      problem(issues, 'COMPLETENESS_CONTRADICTION', base + '/' + location, 'The retained source completeness statements contradict the readRows completion value.', 'error', { side,
        details: { resultComplete: native.complete, statedComplete: value } });
  }
  if (object(native.coverage) && object(manifest.coverage) && !same(native.coverage, manifest.coverage))
    problem(issues, 'COVERAGE_BINDING', base + '/result/coverage', 'The returned coverage differs from its retained source manifest.', 'error', { side });
  const captureIds = new Set(), projected = [];
  for (const [index, captured] of source.captures.entries()) {
    const path = base + '/captures/' + index, meta = captured?.metadata;
    if (!object(meta) || !(Buffer.isBuffer(captured?.body) || captured?.body instanceof Uint8Array)) {
      problem(issues, 'CAPTURE_BYTES_REQUIRED', path, 'Use unchanged readCapture output with original byte Buffer and nested metadata.', 'error', { side }); continue;
    }
    const body = Buffer.from(captured.body);
    if (!text(meta.id) || captureIds.has(meta.id)) problem(issues, 'CAPTURE_ID', path + '/metadata/id', 'Capture identities must be retained and unique.', 'error', { side });
    captureIds.add(meta.id);
    const digest = sha256(body);
    if (!HASH.test(meta.sha256 ?? '') || digest !== meta.sha256 || meta.bytes !== body.length)
      problem(issues, 'CAPTURE_BYTES_CHANGED', path, 'Captured byte count or SHA-256 differs from the retained original.', 'error', { side });
    if (typeof meta.accepted !== 'boolean') problem(issues, 'CAPTURE_ACCEPTANCE', path + '/metadata/accepted', 'Retain the acquisition/import acceptance value.', 'error', { side });
    const file = meta.status === null;
    result.fileImport ||= file; result.legacyImport ||= file;
    if (file) {
      if (meta.provenance?.kind !== 'file' || !text(meta.provenance?.name) || !validDate(meta.provenance?.importedAt))
        problem(issues, 'FILE_PROVENANCE', path + '/metadata/provenance', 'File captures retain kind:file, original name and actual timezone-qualified importedAt.', 'error', { side });
    } else if (!Number.isInteger(meta.status) || meta.status < 100 || meta.status > 599)
      problem(issues, 'CAPTURE_STATUS', path + '/metadata/status', 'Retain the numeric original HTTP status, or null with actual file provenance.', 'error', { side });
    if (!file && meta.accepted && !(meta.status >= 200 && meta.status < 300))
      problem(issues, 'FAILED_CAPTURE_ACCEPTED', path, 'A failed HTTP response cannot supply successful comparison data.', 'error', { side, details: { status: meta.status } });
    if (!file && (meta.request?.method !== 'GET' || !text(meta.request?.url))) problem(issues, 'CAPTURE_REQUEST', path + '/metadata/request', 'Retain the original GET URL with each provider response.', 'error', { side });
    if (!file && !validDate(meta.capturedAt)) problem(issues, 'CAPTURE_TIME', path + '/metadata/capturedAt', 'Retain the actual timezone-qualified HTTP capture time.', 'error', { side });
    result.captures.push({ id: meta.id, sha256: digest, bytes: body.length, status: meta.status,
      accepted: meta.accepted, capturedAt: meta.capturedAt ?? null, request: meta.request ?? null, provenance: meta.provenance ?? null });
    if (!meta.accepted) {
      result.historicalFailureCount++;
      problem(issues, 'RETAINED_UNACCEPTED_CAPTURE', path, 'The unsuccessful or replaced capture remains in source history.', 'warning', { side, details: { status: meta.status, assessment: meta.assessment ?? null } });
      continue;
    }
    result.acceptedCaptureCount++;
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(body).replace(/^\uFEFF/, '');
      const format = result.legacyImport ? manifest.request?.format : 'json';
      if (!['json', 'csv'].includes(format)) throw new TypeError('Declare the original file format as json or csv.');
      const document = format === 'csv' ? csvRows(raw, manifest.request.projection?.csv) : exactJson(raw);
      const projectedCapture = projectCapture(document, source, meta, issues, side);
      projected.push({ ...projectedCapture, capture: meta });
      for (const row of projectedCapture.samples) result.samples.push(row);
      for (const row of projectedCapture.rows) result.rows.push(row);
      for (const row of projectedCapture.entries) result.entries.push(row);
      result.schema ??= projectedCapture.schema;
    } catch (error) { problem(issues, 'SOURCE_DECODE', path, error.message, 'error', { side }); }
  }
  if (!result.acceptedCaptureCount) problem(issues, 'NO_ACCEPTED_SOURCE', base, 'Retain at least one successful provider capture or accepted original file.', 'error', { side });
  if (Array.isArray(manifest.captures)) {
    const declared = new Map(manifest.captures.map(capture => [capture.id, capture]));
    if (declared.size !== manifest.captures.length || declared.size !== captureIds.size || [...captureIds].some(id => !declared.has(id)))
      problem(issues, 'CAPTURE_MANIFEST_BINDING', base + '/manifest/captures', 'The supplied captures differ from the retained manifest population.', 'error', { side });
    for (const captured of source.captures) if (captured.metadata && declared.has(captured.metadata.id)) {
      const original = declared.get(captured.metadata.id);
      for (const field of ['sha256', 'bytes', 'status', 'accepted']) if (!same(original[field], captured.metadata[field]))
        problem(issues, 'CAPTURE_MANIFEST_CHANGED', base + '/manifest/captures/' + captured.metadata.id, 'Capture ' + field + ' differs from its manifest.', 'error', { side });
    }
  }
  if (result.legacyImport) {
    const coverage = result.coverage;
    if (coverage.kind !== 'declared-export' || coverage.complete !== true || !text(coverage.declaredBy) || !validDate(coverage.declaredAt) || !text(coverage.reference) || !text(coverage.note))
      problem(issues, 'EXPORT_DECLARATION', base + '/manifest/coverage', 'Retain the complete-export declaration, reviewer, actual date, reference and scope note.', 'error', { side });
  }
  if (['tabular', 'catalog'].includes(result.kind)) {
    if (!Array.isArray(native.rows) || !same(plain(result.rows), native.rows))
      problem(issues, 'RESULT_SOURCE_MISMATCH', base + '/result/rows', 'Returned rows differ from the original captured rows and explicit import projection.', 'error', { side });
  } else {
    if (!Array.isArray(native.series) || native.series.length !== result.entries.length) {
      problem(issues, 'RESULT_SOURCE_MISMATCH', base + '/result/series', 'The returned series population differs from the original captures.', 'error', { side });
    } else result.entries.forEach((entry, index) => {
      const declared = native.series[index];
      if (!same(plain(entry.key), declared.key) || !same(plain(entry.points), declared.points) || !same(plain(entry.entity), declared.entity))
        problem(issues, 'RESULT_SOURCE_MISMATCH', base + '/result/series/' + index, 'Returned series identity, entity or points differ from the retained source.', 'error', { side });
      const declaredSchema = declared.point_schema ?? declared.pointSchema ?? native.pointSchema;
      if (!same(plain(entry.schema), declaredSchema)) problem(issues, 'POINT_SCHEMA_BINDING', base + '/result/series/' + index, 'The returned point schema differs from its exact original descriptors.', 'error', { side });
    });
    const seriesKeys = new Map();
    for (const entry of result.entries) {
      let key; try { key = valueIdentity(entry.key); } catch { continue; }
      if (seriesKeys.has(key)) problem(issues, 'DUPLICATE_SERIES_ID', base + '/result/series', 'The source repeats an original series identity.', 'error', { side, details: { key: cell(entry.key) } });
      seriesKeys.set(key, entry);
    }
  }
  if (manifest.request?.paged === true) {
    const pages = projected.map(item => ({ page: item.capture.request?.page, totalRows: plain(item.metadata?.totalRows), totalPages: plain(item.metadata?.totalPages), rows: item.rows.length }));
    const first = pages[0];
    if (!first || !Number.isSafeInteger(first.totalRows) || first.totalRows < 0 || !Number.isSafeInteger(first.totalPages) || first.totalPages < 0) {
      problem(issues, 'PROVIDER_TOTALS_REQUIRED', base, 'Original provider page totals are required for a paginated population.', 'error', { side });
    } else {
      const expected = Math.max(1, first.totalPages), seen = new Set();
      for (const page of pages) {
        if (!Number.isSafeInteger(page.page) || page.page < 1 || page.page > expected || seen.has(page.page)) problem(issues, 'PAGE_COVERAGE', base, 'Provider pages must cover the complete original one-based range without duplicates.', 'error', { side });
        seen.add(page.page);
        if (page.totalRows !== first.totalRows || page.totalPages !== first.totalPages) problem(issues, 'PROVIDER_TOTALS_CHANGED', base, 'Provider totals changed across the retained extraction.', 'error', { side });
      }
      if (seen.size !== expected || result.rows.length !== first.totalRows) problem(issues, 'PAGE_COVERAGE', base, 'The complete provider population is not present in the retained pages.', 'error', { side, details: { receivedPages: seen.size, expectedPages: expected, receivedRows: result.rows.length, expectedRows: first.totalRows } });
    }
  }
  const selectedRequest = !result.legacyImport && !['tabular', 'catalog'].includes(result.kind) ?
    (typeof manifest.request?.query?.series === 'string' ? manifest.request.query.series.split(',') :
      Object.entries(manifest.request?.pathParameters ?? {}).filter(([key]) => key !== 'granularity').map(([, value]) => value)) : [];
  if (selectedRequest.some(value => typeof value !== 'string' || value.length === 0))
    problem(issues, 'REQUEST_IDENTITY_INVALID', base + '/manifest/request', 'Retain the exact nonempty canonical identifiers selected by the native request.', 'error', { side });
  if (selectedRequest.length) for (const entry of result.entries) if (!selectedRequest.includes(plain(entry.key)))
    problem(issues, 'UNREQUESTED_SERIES', base + '/captures', 'The original capture returns a series outside the selected native identifiers.', 'error', { side,
      details: { key: cell(entry.key), requested: selectedRequest } });
  const pages = !result.legacyImport && Array.isArray(native.metadata?.pages) ? native.metadata.pages : null;
  if (!result.legacyImport && manifest.schema === 'starforge.blockworks-acquisition/v1' && pages === null)
    problem(issues, 'SOURCE_METADATA_CONTRADICTION', base + '/result/metadata/pages', 'The native acquisition readRows result must retain its original per-capture metadata pages.', 'error', { side });
  const expectedUnresolved = [], capturedUnresolved = [];
  for (const item of projected) {
    const capturePath = base + '/captures/' + item.capture.id;
    const metadataPointer = result.legacyImport ? manifest.request?.projection?.metadataPointer : '/metadata';
    const rawUnresolved = item.metadata?.unresolvedIdentifiers;
    if (rawUnresolved !== undefined && !Array.isArray(rawUnresolved))
      problem(issues, 'SOURCE_METADATA_INVALID', capturePath, 'The original unresolvedIdentifiers field is not an array.', 'error', { side });
    if (Array.isArray(rawUnresolved)) for (const identifier of rawUnresolved) capturedUnresolved.push({
      identifier: plain(identifier), captureId: item.capture.id, pointer: (metadataPointer ?? '') + '/unresolvedIdentifiers' });
    const derived = !result.legacyImport && !['tabular', 'catalog'].includes(result.kind) ?
      selectedRequest.filter(key => !item.entries.some(entry => plain(entry.key) === key && (entry.points.length > 0 || object(entry.entity)))) : undefined;
    if (derived !== undefined && Array.isArray(rawUnresolved) && !same(plain(rawUnresolved), derived))
      problem(issues, 'SOURCE_METADATA_CONTRADICTION', capturePath, 'The original unresolvedIdentifiers metadata differs from the identifiers resolved by the original request and series.', 'error', { side,
        details: { original: plain(rawUnresolved), derived } });
    if (derived?.length)
      problem(issues, 'UNRESOLVED_IDENTIFIERS', capturePath, 'The original capture omits a requested canonical identifier or returns it without points or entity metadata.', 'error', { side,
        details: { identifiers: derived, requested: selectedRequest } });
    const expected = derived ?? (Array.isArray(rawUnresolved) ? plain(rawUnresolved) : undefined);
    if (expected) expectedUnresolved.push(...expected);
    if (pages !== null) {
      const matches = pages.filter(page => page?.captureId === item.capture.id);
      if (matches.length !== 1) problem(issues, 'SOURCE_METADATA_CONTRADICTION', base + '/result/metadata/pages',
        'Each accepted original capture must have exactly one native metadata page.', 'error', { side, details: { captureId: item.capture.id, matches: matches.length } });
      else {
        const page = matches[0];
        if (!same(page.unresolvedIdentifiers, expected) || page.page !== item.capture.request?.page)
          problem(issues, 'SOURCE_METADATA_CONTRADICTION', base + '/result/metadata/pages/' + pages.indexOf(page),
            'The native per-capture unresolved identifiers or page number differ from their original request and response.', 'error', { side,
              details: { captureId: item.capture.id, expectedUnresolved: expected ?? null, returnedUnresolved: page.unresolvedIdentifiers ?? null,
                expectedPage: item.capture.request?.page ?? null, returnedPage: page.page ?? null } });
      }
    }
  }
  if (pages !== null && pages.some(page => !projected.some(item => item.capture.id === page?.captureId)))
    problem(issues, 'SOURCE_METADATA_CONTRADICTION', base + '/result/metadata/pages', 'A metadata page has no accepted original capture in this source.', 'error', { side });
  if (capturedUnresolved.length)
    problem(issues, 'UNRESOLVED_IDENTIFIERS', base + '/captures', 'The original accepted provider captures contain unresolved canonical identifiers.', 'error', { side,
      details: { identifiers: capturedUnresolved } });
  const normalizedUnresolved = native.metadata?.unresolvedIdentifiers;
  if (Array.isArray(normalizedUnresolved) && normalizedUnresolved.length)
    problem(issues, 'UNRESOLVED_IDENTIFIERS', base + '/result/metadata/unresolvedIdentifiers', 'Resolve the original canonical identifiers retained by readRows.', 'error', { side,
      details: { identifiers: normalizedUnresolved } });
  if (normalizedUnresolved !== undefined || (pages === null && (capturedUnresolved.length || expectedUnresolved.length))) {
    const expected = [...new Set(expectedUnresolved.map(stable))].sort();
    const observed = Array.isArray(normalizedUnresolved) ? [...new Set(normalizedUnresolved.map(stable))].sort() : null;
    if (observed === null || !same(expected, observed))
      problem(issues, 'SOURCE_METADATA_CONTRADICTION', base + '/result/metadata/unresolvedIdentifiers', 'The readRows unresolved identifiers differ from the original capture and request population.', 'error', { side,
        details: { captured: capturedUnresolved, expected: expectedUnresolved, returned: normalizedUnresolved ?? null } });
  }
  result.digest = sha256(stable({ manifest, result: native, captures: result.captures }));
  return result;
}

function normalizedKey(sample, key, side) {
  const selector = key.definition[side], found = selectorValue(sample, selector);
  if (!found.present || found.value === null) throw new TypeError('The original key is ' + (found.present ? 'null' : 'absent') + '.');
  if (key.definition.semantic === 'time') {
    if (found.descriptor && (found.descriptor.time === false || found.descriptor.is_timestamp === false))
      throw new TypeError('The selected original descriptor explicitly identifies a non-time value.');
    if (!sample.legacy && selector.from === 'point' && found.descriptorIndex !== 0)
      throw new TypeError('The original Blockworks contract places Unix time in its first descriptor position.');
    const instant = timeValue(found.value, selector.timeFormat);
    return { identity: 'time:' + numericView(instant).exact, original: cell(found.value), canonical: { type: 'utc-seconds', ...numericView(instant) }, instant };
  }
  const identity = valueIdentity(found.value), alias = key.aliases[side].get(identity);
  return { identity: alias?.identity ?? identity, sourceIdentity: identity, original: cell(found.value),
    canonical: alias ? cell(alias.canonical) : cell(found.value), ...(alias ? { decisionId: alias.decisionId } : {}) };
}
function population(prepared, source, originalSource, mapping, issues) {
  const side = source.side, base = '/sources/' + side;
  const result = { groups: new Map(), selected: 0, excluded: 0, original: source.samples.length, invalid: [], fields: [], duplicateKeys: 0 };
  const timeseries = !['tabular', 'catalog', null].includes(source.kind);
  if (timeseries && !prepared.window) problem(issues, 'SERIES_WINDOW_REQUIRED', '/mapping/window', 'Timeseries comparison requires one explicit observation-time key and UTC-second window.', 'error', { side });
  if (timeseries && !prepared.keys.some(key => key.definition.semantic !== 'time' && key.definition[side]?.from === 'row' && same(key.definition[side]?.path, ['key'])))
    problem(issues, 'CANONICAL_SERIES_KEY_REQUIRED', '/mapping/keys', 'Retain the original series key as an identity selector; symbols and shared product labels are separate fields.', 'error', { side });
  const request = originalSource?.manifest?.request ?? {};
  const canonicalField = !source.legacyImport && source.kind === 'tabular' ? request.keyField : null;
  if (canonicalField && !prepared.keys.some(key => key.definition[side]?.from === 'row' && same(key.definition[side]?.path, [canonicalField])))
    problem(issues, 'CANONICAL_ROW_KEY_REQUIRED', '/mapping/keys', 'Retain original ' + canonicalField + ' as a population identity key.', 'error', { side });
  if (canonicalField) {
    const originalIds = new Map();
    for (const sample of source.samples) {
      try {
        const value = atPath(sample.row, [canonicalField]);
        const id = valueIdentity(value.value);
        if (originalIds.has(id)) problem(issues, 'DUPLICATE_ROW_ID', base, 'The native tabular source repeats a canonical row identity.', 'error',
          { side, details: { field: canonicalField, value: cell(value.value), locations: [originalIds.get(id), sample.location] } });
        originalIds.set(id, sample.location);
      } catch (error) { problem(issues, 'CANONICAL_ROW_ID_MISSING', base, error.message, 'error', { side }); }
    }
  }
  if (prepared.window) {
    if (request.query?.bounds === true || request.window?.bounds === true) problem(issues, 'BOUNDS_ONLY_SOURCE', base, 'A first/last-points response cannot supply a complete time-window comparison.', 'error', { side });
    const covered = source.coverage.window ?? request.window ?? originalSource?.result?.metadata?.window;
    if (object(covered) && own(covered, 'start') && own(covered, 'end')) {
      try {
        const start = boundary(covered.start), end = boundary(covered.end);
        if (cmp(start, prepared.window.start) > 0 || cmp(end, prepared.window.end) < 0)
          problem(issues, 'WINDOW_COVERAGE', base, 'The original extraction does not cover the complete requested comparison window.', 'error', { side, details: { covered: plain(covered), requested: mapping.window } });
      } catch (error) { problem(issues, 'WINDOW_COVERAGE_INVALID', base, error.message, 'error', { side }); }
    } else if (source.legacyImport) {
      problem(issues, 'DECLARED_EXPORT_WINDOW', base, 'The selected window relies on the retained complete-export declaration; no provider window totals are asserted.', 'warning', { side });
    } else problem(issues, 'WINDOW_UNRESOLVED', base, 'Retain explicit start/end or the source-resolved window; relative-now or bounds-only input is insufficient for exact window alignment.', 'error', { side });
  }
  const schemaViews = new Set(), identityOrigins = new Map();
  for (const sample of source.samples) {
    if (!prepared.keys.every(key => object(key.definition[side]) && validPath(key.definition[side].path) && key.definition[side].path.length)) continue;
    const keyValues = [];
    let invalid = false, observationTime = null;
    for (const key of prepared.keys) {
      try {
        const value = normalizedKey(sample, key, side);
        keyValues.push({ id: key.definition.id, ...value });
        if (key.definition.semantic === 'time') observationTime = value.instant;
        else {
          const targets = identityOrigins.get(key.definition.id) ?? new Map(); identityOrigins.set(key.definition.id, targets);
          const originals = targets.get(value.identity) ?? new Map(); targets.set(value.identity, originals);
          const originalId = value.sourceIdentity;
          if (!originals.has(originalId)) originals.set(originalId, { original: value.original, canonical: value.canonical, location: sample.location,
            ...(value.decisionId ? { decisionId: value.decisionId } : {}) });
        }
      } catch (error) {
        invalid = true; result.invalid.push({ location: sample.location, keyId: key.definition.id, reason: error.message });
        problem(issues, 'SOURCE_KEY_UNRESOLVED', key.path + '/' + side, error.message, 'error', { side });
      }
    }
    if (invalid) continue;
    if (prepared.window && observationTime && (cmp(observationTime, prepared.window.start) < 0 || cmp(observationTime, prepared.window.end) >= 0)) {
      result.excluded++; continue;
    }
    const identity = stable(keyValues.map(key => key.identity));
    const row = { sample, identity, keyValues };
    const group = result.groups.get(identity) ?? []; group.push(row); result.groups.set(identity, group); result.selected++;
    for (const measure of prepared.measures) {
      const selector = measure.definition[side];
      if (!object(selector) || !validPath(selector.path) || !selector.path.length) continue;
      const value = selectorValue(sample, selector);
      if (value.schemaError) problem(issues, 'POINT_FIELD_UNRESOLVED', measure.path + '/' + side, value.schemaError, 'error', { side, details: { selector } });
      const descriptor = value.descriptor;
      const view = { measureId: measure.definition.id, side, selector, originalDescriptor: descriptor ? plain(descriptor) : null,
        unitEvidence: descriptor && own(descriptor, 'unit') ? 'source-descriptor' : 'operator-declaration',
        unit: selector.unit, dimensions: selector.dimensions };
      const fingerprint = stable(view);
      if (!schemaViews.has(fingerprint)) { schemaViews.add(fingerprint); result.fields.push(view); }
      if (descriptor && own(descriptor, 'unit') && !same(descriptor.unit, selector.unit))
        problem(issues, 'SOURCE_UNIT_MISMATCH', measure.path + '/' + side + '/unit', 'The declared unit differs from the original point descriptor. Record the original unit before specifying a conversion.', 'error', { side, details: { declared: selector.unit, original: descriptor.unit } });
      if (!value.present && !value.schemaError) problem(issues, 'OPTIONAL_FIELD_ABSENT', measure.path + '/' + side, 'This selected field is absent from at least one original record; absence is retained in comparison.', 'warning', { side });
    }
  }
  for (const [keyId, targets] of identityOrigins) for (const [canonicalIdentity, originals] of targets) if (originals.size > 1)
    problem(issues, 'IDENTITY_ALIAS_COLLISION', '/mapping/keys/' + prepared.keys.findIndex(key => key.definition.id === keyId) + '/aliases',
      'Distinct original identities collapse into the same mapped identity on this source side, independent of timestamps or other keys.', 'error',
      { side, details: { keyId, identity: canonicalIdentity, originals: [...originals.values()] } });
  for (const [identity, rows] of result.groups) if (rows.length > 1) {
    result.duplicateKeys++;
    problem(issues, 'DUPLICATE_COMPARISON_KEY', base, 'The selected original keys do not uniquely identify every record in this population.', 'error',
      { side, details: { key: rows[0].keyValues.map(({ id, original, canonical }) => ({ id, original, canonical })), count: rows.length, locations: rows.map(row => row.sample.location), identity } });
  }
  if (!result.selected) problem(issues, 'EMPTY_SELECTED_POPULATION', base, 'There are no records in the explicitly selected comparison population.', 'warning', { side });
  return result;
}
const ENGINE_VERSION = '2026-10-11.1';
function prepare(input) {
  const issues = [], mapping = input?.mapping, sources = input?.sources ?? {};
  const parsed = validateMapping(mapping, issues);
  const sides = Object.fromEntries(SIDES.map(side => [side, inspectSource(sources[side], side, issues)]));
  const populations = Object.fromEntries(SIDES.map(side => [side, population(parsed, sides[side], sources[side], mapping ?? {}, issues)]));
  const baselineInterval = sources.baseline?.manifest?.request?.pathParameters?.granularity ?? sources.baseline?.manifest?.coverage?.granularity;
  const candidateInterval = sources.candidate?.manifest?.request?.pathParameters?.granularity ?? sources.candidate?.manifest?.coverage?.granularity;
  if (baselineInterval !== undefined && candidateInterval !== undefined && baselineInterval !== candidateInterval)
    problem(issues, 'GRANULARITY_MISMATCH', '/sources', 'Original observation granularities differ; align the selected extracts before comparing. No resampling is implicit.', 'error',
      { details: { baseline: baselineInterval, candidate: candidateInterval } });
  const selectedContract = sources.contract?.sha256, acquisitionContract = sources.candidate?.manifest?.sourceHash ?? sources.candidate?.manifest?.source?.sha256;
  if (selectedContract && acquisitionContract && selectedContract !== acquisitionContract)
    problem(issues, 'CANDIDATE_CONTRACT_CHANGED', '/sources/contract', 'The selected provider contract differs from the candidate acquisition source.');
  const binding = {
    engine: ENGINE_VERSION, mapping,
    baseline: sides.baseline.digest, candidate: sides.candidate.digest,
    contract: sources.contract ?? null, catalog: sources.catalog ?? null
  };
  const reviewId = sha256(stable(binding));
  const ready = !issues.some(issue => issue.severity === 'error');
  const summary = {
    keys: parsed.keys.length, measures: parsed.measures.length,
    baselineRecords: populations.baseline.original, candidateRecords: populations.candidate.original,
    baselineSelected: populations.baseline.selected, candidateSelected: populations.candidate.selected,
    baselineExcluded: populations.baseline.excluded, candidateExcluded: populations.candidate.excluded,
    baselineInvalidKeys: populations.baseline.invalid.length, candidateInvalidKeys: populations.candidate.invalid.length,
    duplicateKeyGroups: populations.baseline.duplicateKeys + populations.candidate.duplicateKeys,
    errors: issues.filter(issue => issue.severity === 'error').length, warnings: issues.filter(issue => issue.severity === 'warning').length
  };
  const sourceViews = Object.fromEntries(SIDES.map(side => [side, {
    id: sources[side]?.manifest?.id ?? null, schema: sources[side]?.manifest?.schema ?? null,
    kind: sides[side].kind, digest: sides[side].digest, complete: sides[side].complete,
    coverage: plain(sides[side].coverage), coverageKind: sides[side].legacyImport ? 'declared-export' : 'provider-capture',
    request: sources[side]?.manifest?.request ?? null, captures: sides[side].captures,
    records: populations[side].original, selectedRecords: populations[side].selected, excludedRecords: populations[side].excluded,
    invalidKeys: populations[side].invalid, fields: populations[side].fields
  }]));
  const review = { schemaVersion: REVIEW_SCHEMA, engineVersion: ENGINE_VERSION, mappingId: mapping?.id ?? null, reviewId,
    status: ready ? 'ready' : 'needs_review', ready, issues, summary, sources: sourceViews,
    window: mapping?.window ?? null, calculation: { conversion: 'candidate * factor + offset',
      tolerance: 'abs(converted candidate - baseline) <= absolute + relative * abs(baseline)',
      arithmetic: 'Exact rational arithmetic from original JSON numeric lexemes or explicitly selected decimal fields.',
      identity: 'Original scalar types and case; declared aliases only.', time: 'Declared formats normalized to exact UTC seconds.',
      missing: 'Absent fields, null values and zero are distinct.' } };
  return { review, parsed, sides, populations };
}

/** Deterministic source-bound review; no acquisition, mutation or implicit approval. */
export function reviewMapping({ mapping, sources } = {}) {
  return prepare({ mapping, sources }).review;
}
function selectedCell(row, definition, side) {
  const found = selectorValue(row.sample, definition[side]);
  return { ...found, packed: cell(found.value, found.present) };
}
function compareMeasure(left, right, measure) {
  const baseline = selectedCell(left, measure.definition, 'baseline'), candidate = selectedCell(right, measure.definition, 'candidate');
  const result = { id: measure.definition.id, interpretation: measure.definition.interpretation, baseline: baseline.packed, candidate: candidate.packed };
  if (baseline.packed.state !== candidate.packed.state) return { ...result, status: 'presence_mismatch', equal: false, comparable: true };
  if (baseline.packed.state === 'null') return { ...result, status: 'both_null', equal: true, comparable: false };
  if (baseline.packed.state === 'absent') return { ...result, status: 'both_absent', equal: null, comparable: false };
  if (measure.definition.interpretation === 'scalar') {
    if (!['string', 'boolean', 'number'].includes(baseline.packed.type) || !['string', 'boolean', 'number'].includes(candidate.packed.type))
      return { ...result, status: 'uncomparable', equal: null, comparable: false, reason: 'The selected original values are not scalar strings, booleans or numbers.' };
    const equal = same(baseline.packed, candidate.packed);
    return { ...result, status: equal ? 'exact' : 'different', equal, comparable: true, comparison: 'original scalar type and value' };
  }
  let before, after;
  try { before = decimal(baseline.value); after = decimal(candidate.value); }
  catch {
    return { ...result, status: 'uncomparable', equal: null, comparable: false,
      reason: 'The explicitly numeric selected values are not finite decimals.' };
  }
  const converted = add(mul(after, measure.factor), measure.offset);
  const difference = abs(sub(converted, before));
  const allowed = add(measure.absolute, mul(measure.relative, abs(before)));
  const exact = difference.n === 0n, equal = cmp(difference, allowed) <= 0;
  return { ...result, status: exact ? 'exact' : equal ? 'within_tolerance' : 'different', equal, comparable: true,
    baselineNumber: numericView(before), candidateNumber: numericView(after), convertedCandidate: numericView(converted),
    absoluteDifference: numericView(difference), allowedDifference: numericView(allowed),
    ...(measure.definition.conversion.decisionId ? { conversionDecisionId: measure.definition.conversion.decisionId } : {}),
    ...(measure.definition.tolerance.decisionId ? { toleranceDecisionId: measure.definition.tolerance.decisionId } : {}) };
}
function recordView(row) {
  return { location: row.sample.location, keys: row.keyValues.map(({ id, original, canonical, decisionId }) =>
    ({ id, original, canonical, ...(decisionId ? { decisionId } : {}) })) };
}

/** Compare every record in the reviewed population. No sampling or zero filling. */
export function compareMappedResults({ mapping, sources, reviewId } = {}) {
  const prepared = prepare({ mapping, sources }), review = prepared.review;
  const issues = [...review.issues];
  if (reviewId !== review.reviewId) problem(issues, 'MAPPING_REVIEW_CHANGED', '/reviewId', 'Review the current mapping and exact source captures before comparing them.');
  const eligible = review.ready && reviewId === review.reviewId;
  if (!eligible) {
    const result = { schemaVersion: COMPARISON_SCHEMA, engineVersion: ENGINE_VERSION, mappingId: mapping?.id ?? null,
      reviewId: review.reviewId, requestedReviewId: reviewId ?? null, status: 'needs_review', ready: false, equivalent: null,
      summary: review.summary, coverage: review.sources, rows: [], issues };
    return { ...result, comparisonId: sha256(stable(result)) };
  }
  const rows = [], baseline = prepared.populations.baseline.groups, candidate = prepared.populations.candidate.groups;
  const identities = new Set([...baseline.keys(), ...candidate.keys()]);
  const summary = { ...review.summary, matchedRecords: 0, onlyBaseline: 0, onlyCandidate: 0,
    exactValues: 0, withinToleranceValues: 0, differentValues: 0, bothNullValues: 0,
    bothAbsentValues: 0, uncomparableValues: 0, comparedValues: 0 };
  const measures = prepared.parsed.measures.map(measure => ({ id: measure.definition.id, interpretation: measure.definition.interpretation,
    baselineUnit: measure.definition.baseline.unit, candidateUnit: measure.definition.candidate.unit,
    baselineDimensions: measure.definition.baseline.dimensions, candidateDimensions: measure.definition.candidate.dimensions,
    exact: 0, withinTolerance: 0, different: 0, bothNull: 0, bothAbsent: 0, uncomparable: 0 }));
  for (const identity of [...identities].sort()) {
    const left = baseline.get(identity)?.[0], right = candidate.get(identity)?.[0];
    const rowId = sha256(identity);
    if (!left || !right) {
      const side = left ? 'baseline' : 'candidate', row = left ?? right;
      summary[left ? 'onlyBaseline' : 'onlyCandidate']++;
      rows.push({ rowId, status: left ? 'baseline_only' : 'candidate_only', [side]: recordView(row),
        measures: prepared.parsed.measures.map(measure => ({ id: measure.definition.id, [side]: selectedCell(row, measure.definition, side).packed })) });
      continue;
    }
    summary.matchedRecords++;
    const comparisons = prepared.parsed.measures.map((measure, index) => {
      const value = compareMeasure(left, right, measure), stats = measures[index];
      if (value.status === 'exact') { summary.exactValues++; stats.exact++; }
      else if (value.status === 'within_tolerance') { summary.withinToleranceValues++; stats.withinTolerance++; }
      else if (value.status === 'both_null') { summary.bothNullValues++; stats.bothNull++; }
      else if (value.status === 'both_absent') { summary.bothAbsentValues++; stats.bothAbsent++; }
      else if (value.equal === false) { summary.differentValues++; stats.different++; }
      else { summary.uncomparableValues++; stats.uncomparable++; }
      if (value.comparable) summary.comparedValues++;
      return value;
    });
    const status = comparisons.some(item => item.equal === false) ? 'different' :
      comparisons.some(item => item.equal === null) ? 'inconclusive' : 'match';
    rows.push({ rowId, status, baseline: recordView(left), candidate: recordView(right), measures: comparisons });
  }
  const changed = summary.onlyBaseline + summary.onlyCandidate + summary.differentValues > 0;
  const inconclusive = summary.comparedValues === 0 || summary.bothAbsentValues + summary.uncomparableValues > 0;
  const status = changed ? 'different' : inconclusive ? 'inconclusive' : 'equivalent';
  if (inconclusive) problem(issues, 'VALUES_INCONCLUSIVE', '/comparison', 'Retain the absent or uncomparable values shown in the full comparison; no complete numeric equivalence is established.', 'warning');
  const result = { schemaVersion: COMPARISON_SCHEMA, engineVersion: ENGINE_VERSION, mappingId: mapping.id,
    reviewId: review.reviewId, status, ready: true, equivalent: status === 'equivalent' ? true : status === 'different' ? false : null,
    summary, measures, coverage: review.sources, window: mapping.window ?? null, calculation: review.calculation, rows, issues };
  return { ...result, comparisonId: sha256(stable(result)) };
}
