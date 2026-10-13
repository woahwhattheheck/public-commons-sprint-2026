import {createHash} from 'node:crypto';

export function invariant(condition, code, details = {}) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    error.details = details;
    throw error;
  }
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Keep the original numeric spelling beside the parsed value. Accounting uses
// these spellings, never the rounded JavaScript number. JCS deliberately uses
// the ECMAScript numeric serialization required by RFC 8785.
export function parseSourceJSON(input, {maxBytes = 8 * 1024 * 1024, maxDepth = 100} = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  invariant(bytes.length <= maxBytes, 'JSON_TOO_LARGE');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  let offset = 0;
  const numberTokens = Object.create(null);
  const pointer = (parent, key) => parent + '/' + String(key).replaceAll('~', '~0').replaceAll('/', '~1');
  const whitespace = () => { while (/[ \t\r\n]/.test(text[offset] ?? '\0')) offset++; };
  function string() {
    invariant(text[offset] === '"', 'JSON_STRING_REQUIRED', {offset});
    const start = offset++;
    while (offset < text.length) {
      const c = text[offset++];
      if (c === '\\') { offset++; continue; }
      if (c === '"') {
        const result = JSON.parse(text.slice(start, offset));
        invariant(result.isWellFormed(), 'JSON_INVALID_UNICODE', {offset: start});
        return result;
      }
    }
    invariant(false, 'JSON_UNTERMINATED_STRING', {offset: start});
  }
  function value(location, depth) {
    invariant(depth <= maxDepth, 'JSON_TOO_DEEP');
    whitespace();
    const c = text[offset];
    if (c === '"') return string();
    if (c === '{') {
      offset++;
      const object = Object.create(null), keys = new Set();
      whitespace();
      if (text[offset] === '}') { offset++; return object; }
      while (true) {
        whitespace();
        const key = string();
        invariant(!keys.has(key), 'JSON_DUPLICATE_KEY', {pointer: pointer(location, key)});
        keys.add(key);
        whitespace();
        invariant(text[offset++] === ':', 'JSON_COLON_REQUIRED', {offset: offset - 1});
        object[key] = value(pointer(location, key), depth + 1);
        whitespace();
        const separator = text[offset++];
        if (separator === '}') return object;
        invariant(separator === ',', 'JSON_OBJECT_SEPARATOR_REQUIRED', {offset: offset - 1});
      }
    }
    if (c === '[') {
      offset++;
      const array = [];
      whitespace();
      if (text[offset] === ']') { offset++; return array; }
      while (true) {
        array.push(value(pointer(location, array.length), depth + 1));
        whitespace();
        const separator = text[offset++];
        if (separator === ']') return array;
        invariant(separator === ',', 'JSON_ARRAY_SEPARATOR_REQUIRED', {offset: offset - 1});
      }
    }
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return parsed; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    invariant(match, 'JSON_VALUE_REQUIRED', {offset});
    const lexeme = match[0], number = Number(lexeme);
    invariant(Number.isFinite(number), 'JSON_NON_FINITE_NUMBER', {pointer: location});
    offset += lexeme.length;
    numberTokens[location] = lexeme;
    return number;
  }
  const parsed = value('', 0);
  whitespace();
  invariant(offset === text.length, 'JSON_TRAILING_DATA', {offset});
  return {value: parsed, numberTokens, rawSha256: sha256(bytes), bytes: bytes.length};
}

export function canonicalJSON(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), 'JCS_NON_FINITE_NUMBER');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    invariant(value.isWellFormed(), 'JCS_INVALID_UNICODE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + Array.from(value, canonicalJSON).join(',') + ']';
  invariant(value && typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'JCS_INVALID_VALUE');
  return '{' + Object.keys(value).sort().map(key => {
    invariant(key.isWellFormed(), 'JCS_INVALID_UNICODE');
    return JSON.stringify(key) + ':' + canonicalJSON(value[key]);
  }).join(',') + '}';
}

