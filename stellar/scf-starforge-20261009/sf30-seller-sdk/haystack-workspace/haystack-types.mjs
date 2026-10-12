import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const SUPPORTED_FORMATS = Object.freeze(['json-v4']);
export const MAX_VALUE_DEPTH = 128;
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const TAG_NAME = /^[a-z][a-zA-Z0-9_]*$/;
const REF_NAME = /^[a-zA-Z0-9_:.~\-]+$/;
const XSTR_NAME = /^[A-Z][a-zA-Z0-9_]*$/;
const UNIT_NAME = /^[a-zA-Z%_/$\u0080-\uFFFF]+$/u;
const ZONE_NAME = /^[a-zA-Z][a-zA-Z0-9_+\-]*$/;
const KINDS = new Set(['marker', 'remove', 'na', 'number', 'ref', 'date',
  'time', 'dateTime', 'uri', 'coord', 'xstr', 'symbol', 'dict', 'grid']);

export class HaystackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HaystackError';
    this.status = 400;
    this.code = code;
    this.details = details;
  }
}

export function isTagName(value) {
  return typeof value === 'string' && TAG_NAME.test(value);
}

export function valueKind(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'str';
  if (Array.isArray(value)) return 'list';
  if (!value || typeof value !== 'object') return 'invalid';
  if (!OWN(value, '_kind')) return 'dict';
  return typeof value._kind === 'string' && KINDS.has(value._kind) ? value._kind : 'invalid';
}

function fail(code, message, path, details = {}) {
  throw new HaystackError(code, message, { path, ...details });
}

function pointer(path, key) {
  return path + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function diagnosticId(code, ...identity) {
  return createHash('sha256').update(JSON.stringify([code, ...identity]), 'utf8').digest('hex');
}

function diagnostic(code, severity, message, path, details = {}) {
  return { id: diagnosticId(code, path), code, severity, message,
    details: { path, ...details } };
}

function uniqueDiagnostics(items) {
  const result = new Map();
  for (const item of items) if (!result.has(item.id)) result.set(item.id, item);
  return [...result.values()];
}

function wellFormed(text, path) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const d = text.charCodeAt(++i);
      if (!(d >= 0xDC00 && d <= 0xDFFF))
        fail('INVALID_UNICODE', 'String contains an unpaired high surrogate.', path);
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      fail('INVALID_UNICODE', 'String contains an unpaired low surrogate.', path);
    }
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Reject values which ordinary JSON serialization would silently change or omit. */
function assertJsonTree(value, path = '', depth = 0, active = new Set()) {
  if (depth > MAX_VALUE_DEPTH) fail('VALUE_DEPTH', 'Value nesting exceeds the supported depth.', path, { maximum: MAX_VALUE_DEPTH });
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { wellFormed(value, path); return; }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NONFINITE_JSON_NUMBER', 'Special numbers require a typed number object.', path);
    return;
  }
  if (typeof value !== 'object') fail('NON_JSON_VALUE', 'A value must be representable in JSON.', path, { type: typeof value });
  if (active.has(value)) fail('CYCLIC_VALUE', 'Cyclic values cannot be encoded as a Haystack grid.', path);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      for (const key of Reflect.ownKeys(value)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
          fail('NON_JSON_ARRAY_PROPERTY', 'Array contains a property outside its indexed values.', path);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor.enumerable || !OWN(descriptor, 'value'))
          fail('NON_JSON_PROPERTY', 'Only enumerable data properties can be encoded.', pointer(path, key));
      }
      for (let i = 0; i < value.length; i++) {
        if (!OWN(value, i)) fail('SPARSE_JSON_ARRAY', 'Sparse arrays must use explicit null values.', pointer(path, i));
        assertJsonTree(value[i], pointer(path, i), depth + 1, active);
      }
      return;
    }
    if (!isPlainObject(value)) fail('NON_JSON_OBJECT', 'Only plain JSON objects are supported.', path);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail('NON_JSON_PROPERTY', 'Symbol properties cannot be encoded.', path);
      wellFormed(key, pointer(path, key));
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !OWN(descriptor, 'value'))
        fail('NON_JSON_PROPERTY', 'Only enumerable data properties can be encoded.', pointer(path, key));
      assertJsonTree(descriptor.value, pointer(path, key), depth + 1, active);
    }
  } finally { active.delete(value); }
}

/** JSON decoder which rejects duplicate member names before any value is overwritten. */
function parseJson(text, diagnostics) {
  let at = 0;
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?/y;
  const whitespace = () => { while (at < text.length && /[ \t\n\r]/.test(text[at])) at++; };
  const syntax = (message, path) => fail('INVALID_JSON', message, path, { characterOffset: at });

  function string(path) {
    const start = at;
    at++;
    let escaped = false;
    while (at < text.length) {
      const c = text[at++];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') {
        let result;
        try { result = JSON.parse(text.slice(start, at)); }
        catch { syntax('Invalid JSON string.', path); }
        wellFormed(result, path);
        return result;
      }
      if (c.charCodeAt(0) < 32) syntax('Unescaped control character in a JSON string.', path);
    }
    syntax('Unterminated JSON string.', path);
  }

  function value(path, depth) {
    if (depth > MAX_VALUE_DEPTH) fail('VALUE_DEPTH', 'Value nesting exceeds the supported depth.', path, { maximum: MAX_VALUE_DEPTH });
    whitespace();
    const c = text[at];
    if (c === '"') return string(path);
    if (c === '{') {
      at++; whitespace();
      const result = {};
      const names = new Set();
      if (text[at] === '}') { at++; return result; }
      while (at < text.length) {
        if (text[at] !== '"') syntax('Object member name must be a JSON string.', path);
        const key = string(path);
        if (names.has(key)) fail('DUPLICATE_JSON_MEMBER', 'Duplicate JSON member would make the original value ambiguous.', pointer(path, key), { characterOffset: at, key });
        names.add(key);
        whitespace();
        if (text[at++] !== ':') syntax('Expected a colon after an object member name.', pointer(path, key));
        const child = value(pointer(path, key), depth + 1);
        Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true });
        whitespace();
        if (text[at] === '}') { at++; return result; }
        if (text[at++] !== ',') syntax('Expected a comma or closing brace.', path);
        whitespace();
      }
      syntax('Unterminated JSON object.', path);
    }
    if (c === '[') {
      at++; whitespace();
      const result = [];
      if (text[at] === ']') { at++; return result; }
      while (at < text.length) {
        result.push(value(pointer(path, result.length), depth + 1));
        whitespace();
        if (text[at] === ']') { at++; return result; }
        if (text[at++] !== ',') syntax('Expected a comma or closing bracket.', path);
      }
      syntax('Unterminated JSON array.', path);
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, at)) { at += token.length; return result; }
    }
    numberPattern.lastIndex = at;
    const match = numberPattern.exec(text);
    if (match) {
      at = numberPattern.lastIndex;
      const result = Number(match[0]);
      if (!Number.isFinite(result))
        fail('JSON_NUMBER_RANGE', 'JSON numeric literal exceeds the finite IEEE 754 range; use the documented typed special-number encoding.', path, { literal: match[0] });
      if (Number.isInteger(result) && !Number.isSafeInteger(result))
        diagnostics.push(diagnostic('NUMBER_PRECISION', 'warning', 'Integer-valued number is outside the exact integer range of the Haystack IEEE 754 representation.', path, { originalLiteral: match[0] }));
      return result;
    }
    syntax('Expected a JSON value.', path);
  }

  const result = value('', 0);
  whitespace();
  if (at !== text.length) syntax('Unexpected content after the complete JSON value.', '');
  return result;
}

function shape(value, path, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  for (const name of required) if (!OWN(value, name))
    fail('MISSING_TYPED_MEMBER', 'Required member is missing: ' + name + '.', pointer(path, name), { member: name });
  for (const name of Object.keys(value)) if (!allowed.has(name))
    fail('UNEXPECTED_TYPED_MEMBER', 'Unexpected member in a typed value: ' + name + '.', pointer(path, name), { member: name });
}

function stringMember(value, member, path, nonempty = false) {
  if (typeof value[member] !== 'string' || (nonempty && value[member].length === 0))
    fail('INVALID_TYPED_STRING', 'Member ' + member + ' must be ' + (nonempty ? 'a nonempty' : 'a') + ' string.', pointer(path, member));
  return value[member];
}

function calendar(year, month, day) {
  const y = BigInt(year);
  const leap = y % 400n === 0n || (y % 4n === 0n && y % 100n !== 0n);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= lengths[month - 1];
}

function dateValue(value, path) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || !calendar(match[1], Number(match[2]), Number(match[3])))
    fail('INVALID_DATE', 'Date must contain a valid calendar day in YYYY-MM-DD form.', path);
}

function timeValue(value, path) {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59)
    fail('INVALID_TIME', 'Time must contain a valid hour, minute and second, with an optional fractional second.', path);
}

function dateTimeValue(value, path, diagnostics) {
  const match = /^([+\-]?\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+\-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !calendar(match[1], Number(match[2]), Number(match[3])) ||
      Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)
    fail('INVALID_DATETIME', 'DateTime must contain a valid ISO calendar date and time.', path);
  const offset = match[8];
  if (offset && offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59))
    fail('INVALID_DATETIME_OFFSET', 'DateTime has an invalid UTC offset.', path);
  if (!offset)
    diagnostics.push(diagnostic('DATETIME_OFFSET_ABSENT', 'warning', 'The original timestamp has no explicit UTC offset. Its literal timestamp and timezone remain unchanged.', path));
}

function checkDict(value, path, diagnostics, depth) {
  if (!isPlainObject(value) || (OWN(value, '_kind') && value._kind !== 'dict'))
    fail('EXPECTED_DICT', 'Expected a Haystack dictionary.', path);
  for (const [name, child] of Object.entries(value)) {
    if (name === '_kind') continue;
    if (!isTagName(name)) {
      diagnostics.push(diagnostic('IGNORED_DICT_NAME', 'warning', 'Member is outside the Haystack tag-name grammar and is excluded from semantic indexing; its original JSON member is retained.', pointer(path, name), { name }));
      continue;
    }
    checkValue(child, pointer(path, name), diagnostics, depth + 1);
  }
}

function checkGrid(value, path, diagnostics, depth) {
  shape(value, path, ['_kind', 'meta', 'cols', 'rows']);
  checkDict(value.meta, pointer(path, 'meta'), diagnostics, depth + 1);
  if (!OWN(value.meta, 'ver') || value.meta.ver !== '3.0')
    fail('GRID_VERSION', 'Haystack JSON v4 grids in this product require meta.ver "3.0".', pointer(pointer(path, 'meta'), 'ver'));
  if (!Array.isArray(value.cols)) fail('GRID_COLUMNS', 'Grid cols must be an array of column dictionaries.', pointer(path, 'cols'));
  if (!Array.isArray(value.rows)) fail('GRID_ROWS', 'Grid rows must be an array of dictionaries.', pointer(path, 'rows'));
  const names = new Set();
  for (let i = 0; i < value.cols.length; i++) {
    const col = value.cols[i], colPath = pointer(pointer(path, 'cols'), i);
    if (!isPlainObject(col)) fail('GRID_COLUMN', 'Each grid column must be an object.', colPath);
    shape(col, colPath, ['name'], ['meta']);
    if (!isTagName(col.name)) fail('GRID_COLUMN_NAME', 'Column name must follow the Haystack tag-name grammar.', pointer(colPath, 'name'));
    if (names.has(col.name)) fail('DUPLICATE_GRID_COLUMN', 'Grid column names must be unique.', pointer(colPath, 'name'), { name: col.name });
    names.add(col.name);
    if (OWN(col, 'meta')) checkDict(col.meta, pointer(colPath, 'meta'), diagnostics, depth + 2);
  }
  for (let i = 0; i < value.rows.length; i++) {
    const row = value.rows[i], rowPath = pointer(pointer(path, 'rows'), i);
    checkDict(row, rowPath, diagnostics, depth + 1);
    for (const name of Object.keys(row)) {
      if (isTagName(name) && !names.has(name))
        diagnostics.push(diagnostic('UNDECLARED_ROW_TAG', 'warning', 'Row member is not declared in the original column list. The complete row value remains available for review.', pointer(rowPath, name), { name }));
    }
  }
}

function checkValue(value, path, diagnostics, depth) {
  if (depth > MAX_VALUE_DEPTH) fail('VALUE_DEPTH', 'Value nesting exceeds the supported depth.', path, { maximum: MAX_VALUE_DEPTH });
  const kind = valueKind(value);
  if (kind === 'null' || kind === 'bool' || kind === 'str') return;
  if (typeof value === 'number') {
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      diagnostics.push(diagnostic('NUMBER_PRECISION', 'warning', 'Integer-valued number is outside the exact integer range of the Haystack IEEE 754 representation.', path));
    return;
  }
  if (kind === 'list') {
    value.forEach((child, i) => checkValue(child, pointer(path, i), diagnostics, depth + 1));
    return;
  }
  if (kind === 'dict') { checkDict(value, path, diagnostics, depth); return; }
  if (kind === 'grid') { checkGrid(value, path, diagnostics, depth); return; }
  if (kind === 'invalid') fail('UNKNOWN_HAYSTACK_KIND', 'Object has an unknown or invalid _kind discriminator.', pointer(path, '_kind'));
  if (kind === 'marker' || kind === 'remove' || kind === 'na') {
    shape(value, path, ['_kind']);
    return;
  }
  if (kind === 'number') {
    shape(value, path, ['_kind', 'val'], ['unit']);
    const n = value.val;
    if (!(typeof n === 'number' && Number.isFinite(n)) && !['INF', '-INF', 'NaN'].includes(n))
      fail('INVALID_NUMBER', 'Typed number val must be a finite JSON number or INF, -INF, or NaN.', pointer(path, 'val'));
    if (typeof n === 'number' && Number.isInteger(n) && !Number.isSafeInteger(n))
      diagnostics.push(diagnostic('NUMBER_PRECISION', 'warning', 'Integer-valued number is outside the exact integer range of the Haystack IEEE 754 representation.', pointer(path, 'val')));
    if (OWN(value, 'unit')) {
      const unit = stringMember(value, 'unit', path, true);
      if (!UNIT_NAME.test(unit)) fail('INVALID_UNIT_SYMBOL', 'Unit must use the Haystack unit-symbol lexical form.', pointer(path, 'unit'));
      if (n === 'NaN') fail('NAN_UNIT', 'Haystack NaN must not have a unit.', pointer(path, 'unit'));
      if (n === 'INF' || n === '-INF')
        diagnostics.push(diagnostic('INFINITY_UNIT', 'warning', 'The Haystack Kinds contract permits but discourages units on infinity. The supplied unit is retained.', pointer(path, 'unit')));
    }
    return;
  }
  if (kind === 'coord') {
    shape(value, path, ['_kind', 'lat', 'lng']);
    for (const [name, limit] of [['lat', 90], ['lng', 180]]) {
      if (typeof value[name] !== 'number' || !Number.isFinite(value[name]) || Math.abs(value[name]) > limit)
        fail('INVALID_COORDINATE', 'Coordinate ' + name + ' must be a finite number from -' + limit + ' to ' + limit + '.', pointer(path, name));
    }
    return;
  }
  if (kind === 'xstr') {
    shape(value, path, ['_kind', 'type', 'val']);
    const type = stringMember(value, 'type', path, true);
    if (!XSTR_NAME.test(type)) fail('INVALID_XSTR_TYPE', 'XStr type must begin with an uppercase ASCII letter and otherwise follow tag naming rules.', pointer(path, 'type'));
    stringMember(value, 'val', path);
    return;
  }
  const optional = kind === 'ref' ? ['dis'] : kind === 'dateTime' ? ['tz'] : [];
  shape(value, path, ['_kind', 'val'], optional);
  const val = stringMember(value, 'val', path);
  if ((kind === 'ref' || kind === 'symbol') && !REF_NAME.test(val))
    fail('INVALID_REFERENCE_ID', 'Ref and symbol values must use the documented nonempty identifier grammar.', pointer(path, 'val'));
  if (kind === 'ref' && OWN(value, 'dis')) stringMember(value, 'dis', path);
  if (kind === 'date') dateValue(val, pointer(path, 'val'));
  if (kind === 'time') timeValue(val, pointer(path, 'val'));
  if (kind === 'dateTime') {
    dateTimeValue(val, pointer(path, 'val'), diagnostics);
    if (OWN(value, 'tz')) {
      const tz = stringMember(value, 'tz', path, true);
      if (!ZONE_NAME.test(tz)) fail('INVALID_TIMEZONE_NAME', 'Haystack timezone names use the zoneinfo city-name form.', pointer(path, 'tz'));
    }
  }
  if (kind === 'uri' && /[\u0000-\u0020\u007F]/.test(val))
    diagnostics.push(diagnostic('URI_WHITESPACE', 'warning', 'URI contains an unescaped space or control character. Its supplied string is retained.', pointer(path, 'val')));
}

/** Validate one complete typed value without mutating it. */
export function validateValue(value) {
  assertJsonTree(value);
  const diagnostics = [];
  checkValue(value, '', diagnostics, 0);
  return { valid: true, diagnostics: uniqueDiagnostics(diagnostics) };
}

/** Structural failures throw HaystackError; retained semantic concerns are diagnostics. */
export function validateGrid(grid) {
  assertJsonTree(grid);
  if (valueKind(grid) !== 'grid') fail('EXPECTED_GRID', 'Expected a Haystack JSON v4 grid with _kind "grid".', '');
  const diagnostics = [];
  checkGrid(grid, '', diagnostics, 0);
  return { valid: true, diagnostics: uniqueDiagnostics(diagnostics) };
}

function formatOption(options) {
  const format = options?.format ?? 'json-v4';
  if (!SUPPORTED_FORMATS.includes(format))
    throw new HaystackError('UNSUPPORTED_HAYSTACK_FORMAT', 'Supported import and export format: json-v4.', { format, supported: [...SUPPORTED_FORMATS] });
  return format;
}

export function parseGrid(bytes, options = {}) {
  const format = formatOption(options);
  let raw;
  if (typeof bytes === 'string') {
    wellFormed(bytes, '');
    raw = Buffer.from(bytes, 'utf8');
  } else if (Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) {
    raw = Buffer.from(bytes);
  } else {
    throw new HaystackError('SOURCE_BYTES', 'Grid source must be a UTF-8 string, Buffer or Uint8Array.');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { throw new HaystackError('INVALID_UTF8', 'Original source is not valid UTF-8.'); }
  const diagnostics = [];
  const bom = text.startsWith('\uFEFF');
  if (bom) {
    text = text.slice(1);
    diagnostics.push(diagnostic('UTF8_BOM', 'info', 'The original source has a UTF-8 byte order mark; it is retained in the original source bytes.', ''));
  }
  const grid = parseJson(text, diagnostics);
  const validation = validateGrid(grid);
  return {
    grid,
    diagnostics: uniqueDiagnostics([...diagnostics, ...validation.diagnostics]),
    source: {
      sha256: createHash('sha256').update(raw).digest('hex'),
      bytes: raw.length,
      format,
      mediaType: 'application/json',
      bom
    }
  };
}

function serialize(value, indentation, depth = 0) {
  if (value === null) return 'null';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  const array = Array.isArray(value);
  const items = array
    ? value.map(child => serialize(child, indentation, depth + 1))
    : Object.keys(value).map(key => JSON.stringify(key) + (indentation ? ': ' : ':') + serialize(value[key], indentation, depth + 1));
  const left = array ? '[' : '{', right = array ? ']' : '}';
  if (!items.length) return left + right;
  if (!indentation) return left + items.join(',') + right;
  const pad = ' '.repeat(indentation * (depth + 1));
  return left + '\n' + pad + items.join(',\n' + pad) + '\n' + ' '.repeat(indentation * depth) + right;
}

/** A derived JSON v4 encoding; original byte download is the source-retention operation. */
export function encodeGrid(grid, options = {}) {
  formatOption(options);
  validateGrid(grid);
  const indentation = options.indent ?? 2;
  if (!Number.isInteger(indentation) || indentation < 0 || indentation > 8)
    throw new HaystackError('JSON_INDENT', 'JSON indent must be an integer from 0 through 8.');
  return Buffer.from(serialize(grid, indentation) + '\n', 'utf8');
}

export function displayValue(value) {
  const kind = valueKind(value);
  if (kind === 'null') return 'null';
  if (kind === 'str') return value;
  if (kind === 'bool') return value ? 'true' : 'false';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (kind === 'number') return (Object.is(value.val, -0) ? '-0' : String(value.val)) + (OWN(value, 'unit') ? ' ' + value.unit : '');
  if (kind === 'marker') return 'M';
  if (kind === 'remove') return 'R';
  if (kind === 'na') return 'NA';
  if (kind === 'ref') return '@' + value.val + (OWN(value, 'dis') ? ' ' + JSON.stringify(value.dis) : '');
  if (kind === 'symbol') return '^' + value.val;
  if (kind === 'date' || kind === 'time' || kind === 'uri') return value.val;
  if (kind === 'dateTime') return value.val + ' ' + (OWN(value, 'tz') ? value.tz : 'GMT');
  if (kind === 'coord') return 'C(' + value.lat + ',' + value.lng + ')';
  if (kind === 'xstr') return value.type + '(' + JSON.stringify(value.val) + ')';
  if (kind === 'grid') return value.rows.length + ' rows, ' + value.cols.length + ' columns';
  if (kind === 'dict' || kind === 'list') return serialize(value, 0);
  return '[invalid Haystack value]';
}
