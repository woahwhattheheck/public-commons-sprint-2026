// MIT. PostgreSQL query declarations are trusted operator configuration.
export const record = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const validName = name => typeof name === 'string' && NAME.test(name) && !reserved.has(name);
export class PostgresInputError extends Error {
  constructor(field, code) { super('QUERY_INPUT_INVALID'); this.name = 'PostgresInputError'; this.field = field; this.code = code; }
}
const reject = (field, code) => { throw new PostgresInputError(field, code); };
export function limit(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be ${min}–${max}`);
  return value;
}
function integer(value, field) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || value.length > 20 || !/^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value)) reject(field, 'EXPECTED_INTEGER');
  const number = BigInt(value);
  if (number < -(2n ** 63n) || number > 2n ** 63n - 1n) reject(field, 'INTEGER_OUT_OF_RANGE');
  return value;
}
function decimal(value, field) {
  if (typeof value !== 'string' || value.length > 128 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) reject(field, 'EXPECTED_DECIMAL_STRING');
  return value;
}
function compare(a, b) {
  const left = a.split('.'), right = b.split('.');
  const scale = Math.max(left[1]?.length ?? 0, right[1]?.length ?? 0);
  const exact = parts => BigInt(parts[0] + (parts[1] ?? '').padEnd(scale, '0'));
  const x = exact(left), y = exact(right);
  return x < y ? -1 : x > y ? 1 : 0;
}
function scalar(value, spec) {
  const field = spec.name;
  if (value === null) { if (spec.nullable === true) return null; reject(field, 'NULL_NOT_ALLOWED'); }
  let parsed;
  if (spec.type === 'string') {
    if (typeof value !== 'string') reject(field, 'EXPECTED_STRING');
    if (value.includes('\0') || value.length < (spec.minLength ?? 0) || value.length > (spec.maxLength ?? 4096)) reject(field, 'STRING_LENGTH');
    parsed = value;
  } else if (spec.type === 'integer') parsed = integer(value, field);
  else if (spec.type === 'decimal') parsed = decimal(value, field);
  else if (spec.type === 'boolean') {
    if (![true, false, 'true', 'false'].includes(value)) reject(field, 'EXPECTED_BOOLEAN');
    parsed = value === true || value === 'true';
  } else throw new TypeError('Unsupported parameter type');
  if (['integer', 'decimal'].includes(spec.type)) {
    if (own(spec, 'minimum') && compare(parsed, String(spec.minimum)) < 0 ||
        own(spec, 'maximum') && compare(parsed, String(spec.maximum)) > 0) reject(field, 'OUT_OF_RANGE');
  }
  return parsed;
}
function valueFor(value, spec) {
  const parsed = scalar(value, spec);
  if (spec.enum && !spec.enum.some(item => {
    const candidate = scalar(item, spec);
    return parsed !== null && candidate !== null && ['integer', 'decimal'].includes(spec.type) ?
      compare(String(parsed), String(candidate)) === 0 : Object.is(parsed, candidate);
  })) reject(spec.name, 'NOT_IN_ENUM');
  return parsed;
}
function compileParameter(raw) {
  if (!record(raw) || !validName(raw.name) || !['string', 'integer', 'decimal', 'boolean'].includes(raw.type))
    throw new TypeError('Each parameter needs a unique name and supported type');
  const spec = structuredClone(raw);
  if (own(spec, 'nullable') && typeof spec.nullable !== 'boolean') throw new TypeError('nullable must be boolean');
  if (spec.type === 'string') {
    const min = limit(spec.minLength ?? 0, 0, 65536, 'minLength');
    limit(spec.maxLength ?? 4096, min, 65536, 'maxLength');
  }
  for (const key of ['minimum', 'maximum']) if (own(spec, key)) {
    if (spec.type === 'integer') spec[key] = integer(spec[key], spec.name);
    else if (spec.type === 'decimal') spec[key] = decimal(spec[key], spec.name);
    else throw new TypeError('Only integer and decimal parameters support numeric bounds');
  }
  if (own(spec, 'minimum') && own(spec, 'maximum') && compare(spec.minimum, spec.maximum) > 0)
    throw new TypeError('minimum exceeds maximum');
  if (own(spec, 'enum')) {
    if (!Array.isArray(spec.enum) || spec.enum.length < 1 || spec.enum.length > 128) throw new TypeError('enum needs 1–128 values');
    for (const item of spec.enum) scalar(item, spec);
  }
  if (own(spec, 'default')) valueFor(spec.default, spec);
  return spec;
}

// Declaration lint handles native PostgreSQL quoting and comments. PostgreSQL
// still parses the SELECT wrapper; this scanner is not a tenant SQL sandbox.
function positions(sql) {
  const used = new Set();
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) {
      i += 2; let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; } else i++;
      }
      if (depth) throw new TypeError('Unclosed SQL comment');
      continue;
    }
    const quote = sql[i];
    if (quote === "'" || quote === '"') {
      const escaped = quote === "'" && i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !/[A-Za-z0-9_$]/.test(sql[i - 2]));
      i++; let ended = false;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] !== quote) continue;
        if (sql[i] === quote) { i++; continue; }
        ended = true; break;
      }
      if (!ended) throw new TypeError('Unclosed SQL string or identifier');
      continue;
    }
    if (quote === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end < 0) throw new TypeError('Unclosed SQL dollar string');
        i = end + tag[0].length; continue;
      }
      const parameter = /^\$([1-9]\d*)(?![A-Za-z0-9_$])/.exec(sql.slice(i));
      if (!parameter) throw new TypeError('Use native positional SQL parameters $1, $2, …');
      used.add(Number(parameter[1])); i += parameter[0].length; continue;
    }
    if (quote === ';') throw new TypeError('Only one SELECT statement is allowed');
    i++;
  }
  return used;
}
export function compilePostgresQueries(input) {
  if (!record(input) || Object.keys(input).length < 1 || Object.keys(input).length > 64) throw new TypeError('Expected 1–64 named queries');
  const output = Object.create(null);
  for (const [name, raw] of Object.entries(input)) {
    if (!validName(name) || !record(raw) || typeof raw.sql !== 'string' || !raw.sql.trim() || raw.sql.length > 65536 || raw.sql.includes('\0'))
      throw new TypeError('Named queries require trusted SQL up to 64 KiB');
    if (!Array.isArray(raw.columns) || !raw.columns.length || raw.columns.length > 64 ||
        raw.columns.some(column => !validName(column)) || new Set(raw.columns).size !== raw.columns.length)
      throw new TypeError('Each query requires explicit unique projected columns');
    const parameters = raw.parameters ?? [];
    if (!Array.isArray(parameters) || parameters.length > 64) throw new TypeError('parameters must be an ordered array up to 64');
    const specs = parameters.map(compileParameter);
    if (new Set(specs.map(spec => spec.name)).size !== specs.length) throw new TypeError('Duplicate parameter name');
    const sql = raw.sql.trim().replace(/;\s*$/, '');
    const used = positions(sql);
    if (used.size !== specs.length || [...used].some(index => index < 1 || index > specs.length))
      throw new TypeError(`SQL positions must exactly match the ordered parameter array for ${name}`);
    const maxRows = limit(raw.maxRows ?? 100, 1, 1000, 'maxRows');
    output[name] = { sql: `SELECT ${raw.columns.map(column => `"${column}"`).join(', ')} FROM (\n${sql}\n) AS sf30_query LIMIT ${maxRows + 1}`,
      parameters: specs, columns: [...raw.columns], maxRows,
      maxBytes: limit(raw.maxBytes ?? 524288, 1024, 917504, 'maxBytes'),
      timeoutMs: limit(raw.timeoutMs ?? 3000, 50, 30000, 'timeoutMs') };
  }
  return output;
}
export function bindPostgresParameters(query, input) {
  if (!record(input)) reject(null, 'EXPECTED_OBJECT');
  const names = new Set(query.parameters.map(spec => spec.name));
  if (Object.keys(input).some(name => !names.has(name))) reject(null, 'UNKNOWN_PARAMETER');
  return query.parameters.map(spec => {
    if (!own(input, spec.name) && !own(spec, 'default')) reject(spec.name, 'MISSING_PARAMETER');
    return valueFor(own(input, spec.name) ? input[spec.name] : spec.default, spec);
  });
}
