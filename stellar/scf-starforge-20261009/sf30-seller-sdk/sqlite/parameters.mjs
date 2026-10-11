// MIT. Trusted query declarations and typed values; caller SQL is never accepted.
const own = (value, key) => Object.hasOwn(value, key);
export const record = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MIN = -(2n ** 63n), MAX = 2n ** 63n - 1n;
export class QueryInputError extends Error {
  constructor(field, code) { super('QUERY_INPUT_INVALID'); this.name = 'QueryInputError'; this.field = field; this.code = code; }
}
function reject(field, code) { throw new QueryInputError(field, code); }
function integer(value, field) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || !/^(?:0|-[1-9]\d*|[1-9]\d*)$/.test(value) || value.length > 20)
    reject(field, 'EXPECTED_INTEGER');
  const parsed = BigInt(value);
  if (parsed < MIN || parsed > MAX) reject(field, 'INTEGER_OUT_OF_RANGE');
  return parsed;
}
function scalar(value, spec, field) {
  if (value === null) { if (spec.nullable === true) return null; reject(field, 'NULL_NOT_ALLOWED'); }
  let parsed;
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') reject(field, 'EXPECTED_STRING');
      if (value.length < (spec.minLength ?? 0) || value.length > (spec.maxLength ?? 4096)) reject(field, 'STRING_LENGTH');
      parsed = value; break;
    case 'integer': parsed = integer(value, field); break;
    case 'number':
      if (typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && value.length <= 128)
        value = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(value)) reject(field, 'EXPECTED_NUMBER');
      parsed = value; break;
    case 'boolean':
      if (value === true || value === 'true') return 1n;
      if (value === false || value === 'false') return 0n;
      reject(field, 'EXPECTED_BOOLEAN'); break;
    default: throw new TypeError(`Unknown parameter type for ${field}`);
  }
  if (spec.type === 'integer' || spec.type === 'number') {
    const bound = value => spec.type === 'integer' ? integer(value, field) : value;
    if (own(spec, 'minimum') && parsed < bound(spec.minimum) || own(spec, 'maximum') && parsed > bound(spec.maximum))
      reject(field, 'OUT_OF_RANGE');
  }
  return parsed;
}
function parse(value, spec, field) {
  const parsed = scalar(value, spec, field);
  if (spec.enum && !spec.enum.some(candidate => Object.is(scalar(candidate, spec, field), parsed))) reject(field, 'NOT_IN_ENUM');
  return parsed;
}
export function bindParameters(query, input) {
  if (!record(input)) reject(null, 'EXPECTED_OBJECT');
  const keys = Object.keys(input);
  if (keys.length > 64) reject(null, 'TOO_MANY_PARAMETERS');
  // Do not echo caller-selected unknown keys or any submitted values.
  if (keys.some(key => !own(query.parameters, key))) reject(null, 'UNKNOWN_PARAMETER');
  const bound = Object.create(null);
  for (const [name, spec] of Object.entries(query.parameters)) {
    if (!own(input, name) && !own(spec, 'default')) reject(name, 'MISSING_PARAMETER');
    bound[`$${name}`] = parse(own(input, name) ? input[name] : spec.default, spec, name);
  }
  return bound;
}

// Configuration lint, not a SQL authorization boundary. SQLite still parses the
// SELECT wrapper and opens the database read-only. Skip SQL literals/comments.
function sqlParameters(sql) {
  const found = new Set();
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); if (end < 0) throw new TypeError('Unclosed SQL comment'); i = end + 2; continue; }
    const char = sql[i];
    if (['\'', '"', '`', '['].includes(char)) {
      const close = char === '[' ? ']' : char; let ended = false; i++;
      while (i < sql.length) { if (sql[i++] !== close) continue;
        if (close !== ']' && sql[i] === close) { i++; continue; } ended = true; break; }
      if (!ended) throw new TypeError('Unclosed SQL literal'); continue;
    }
    if (char === ';' || char === '?' || char === ':' || char === '@') throw new TypeError('Use one query and only $name SQL parameters');
    if (char === '$') {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i + 1));
      if (!match || sql[i + 1 + match[0].length] === '(') throw new TypeError('Use simple $name SQL parameters');
      found.add(match[0]); i += match[0].length + 1; continue;
    }
    i++;
  }
  return found;
}

function limit(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(label);
  return value;
}
export function compileQueries(input) {
  if (!record(input) || Object.keys(input).length < 1 || Object.keys(input).length > 64) throw new TypeError('Expected 1–64 named queries');
  const result = Object.create(null);
  for (const [name, raw] of Object.entries(input)) {
    if (!NAME.test(name) || !record(raw) || typeof raw.sql !== 'string' || !raw.sql.trim() || raw.sql.length > 65536)
      throw new TypeError('Each named query requires trusted SQL');
    if (!Array.isArray(raw.columns) || !raw.columns.length || raw.columns.length > 64 ||
        raw.columns.some(column => typeof column !== 'string' || !NAME.test(column)) || new Set(raw.columns).size !== raw.columns.length)
      throw new TypeError(`Explicit unique projected columns required for ${name}`);
    const parameters = structuredClone(raw.parameters ?? {});
    if (!record(parameters) || Object.keys(parameters).length > 64) throw new TypeError('At most 64 parameters per query');
    for (const [field, spec] of Object.entries(parameters)) {
      if (!NAME.test(field) || field.startsWith('__sf30_') || !record(spec) ||
          !['string', 'integer', 'number', 'boolean'].includes(spec.type)) throw new TypeError(`Invalid parameter in ${name}`);
      if (own(spec, 'nullable') && typeof spec.nullable !== 'boolean') throw new TypeError('nullable must be boolean');
      if (own(spec, 'enum') && (!Array.isArray(spec.enum) || !spec.enum.length || spec.enum.length > 128)) throw new TypeError('enum requires 1–128 scalar values');
      if (spec.type === 'string') {
        const low = limit(spec.minLength ?? 0, 0, 65536, 'minLength out of range');
        limit(spec.maxLength ?? 4096, low, 65536, 'maxLength out of range');
      }
      for (const key of ['minimum', 'maximum']) if (own(spec, key)) {
        if (!['integer', 'number'].includes(spec.type)) throw new TypeError('Only numeric parameters have numeric bounds');
        if (spec.type === 'integer') integer(spec[key], field);
        else if (typeof spec[key] !== 'number' || !Number.isFinite(spec[key])) throw new TypeError('Finite numeric bounds required');
      }
      if (own(spec, 'minimum') && own(spec, 'maximum') &&
          (spec.type === 'integer' ? integer(spec.minimum, field) > integer(spec.maximum, field) : spec.minimum > spec.maximum))
        throw new TypeError('minimum exceeds maximum');
      if (spec.enum) for (const candidate of spec.enum) scalar(candidate, spec, field);
      if (own(spec, 'default')) parse(spec.default, spec, field);
    }
    const sql = raw.sql.trim().replace(/;\s*$/, '');
    const used = sqlParameters(sql);
    if (used.size !== Object.keys(parameters).length || [...used].some(field => !own(parameters, field)))
      throw new TypeError(`Declared parameters must exactly match SQL in ${name}`);
    result[name] = { sql, parameters,
      columns: [...raw.columns], maxRows: limit(raw.maxRows ?? 100, 1, 1000, 'maxRows must be 1–1000'),
      maxBytes: limit(raw.maxBytes ?? 524288, 1024, 917504, 'maxBytes must be 1–896 KiB'),
      timeoutMs: limit(raw.timeoutMs ?? 1500, 50, 30000, 'timeoutMs must be 50–30000') };
  }
  return result;
}
