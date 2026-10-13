// MIT. Original CKAN exact-number semantics for DCAT browser review.
// The token reader and serializer retain the same values on browsers without
// JSON.parse source contexts or JSON.rawJSON.
function fault(code) { return Object.assign(new Error(code), { code }); }
export class ExactCkanNumber {
  constructor(source) { this.source = source; Object.freeze(this); }
  toString() { return this.source; }
  toJSON() {
    if (typeof JSON.rawJSON !== 'function') throw fault('CKAN_EXACT_NUMBER_RUNTIME_REQUIRED');
    return JSON.rawJSON(this.source);
  }
}
function decimalIdentity(source) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) throw fault('CKAN_RESPONSE_JSON_INVALID');
  const fraction = match[3] ?? '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const trailing = /0*$/.exec(digits)[0].length;
  if (trailing) digits = digits.slice(0, -trailing);
  return match[1] + digits + 'e' + (BigInt(match[4] ?? '0') - BigInt(fraction.length) + BigInt(trailing));
}
export function parseCkanJson(buffer) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw fault('CKAN_RESPONSE_ENCODING'); }
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value === 'number') {
        if (typeof context?.source !== 'string') throw fault('CKAN_EXACT_NUMBER_RUNTIME_REQUIRED');
        if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value) ||
            Object.is(value, -0) || decimalIdentity(context.source) !== decimalIdentity(String(value)))
          return new ExactCkanNumber(context.source);
      }
      return value;
    });
  } catch (error) {
    if (error.code) throw error;
    throw fault('CKAN_RESPONSE_JSON_INVALID');
  }
}
export const isExactCkanNumber = value => value instanceof ExactCkanNumber;
let hasSourceContext = false;
JSON.parse('1', (_key, value, context) => {
  if (typeof value === 'number') hasSourceContext = typeof context?.source === 'string';
  return value;
});
function numberValue(source) {
  const value = Number(source);
  return !Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value) ||
    Object.is(value, -0) || decimalIdentity(source) !== decimalIdentity(String(value))
    ? new ExactCkanNumber(source) : value;
}
function readExactTokens(text) {
  let offset = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(text[offset] ?? '') && offset < text.length) offset++; };
  function string() {
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') {
        try { return JSON.parse(text.slice(start, offset)); }
        catch { throw fault('CKAN_RESPONSE_JSON_INVALID'); }
      }
      if (character === '\\') offset++;
    }
    throw fault('CKAN_RESPONSE_JSON_INVALID');
  }
  function value() {
    whitespace();
    const character = text[offset];
    if (character === '"') return string();
    if (character === '{' || character === '[') {
      const object = character === '{', result = object ? {} : [], closing = object ? '}' : ']';
      offset++; whitespace();
      if (text[offset] === closing) { offset++; return result; }
      while (offset < text.length) {
        let key;
        if (object) {
          if (text[offset] !== '"') throw fault('CKAN_RESPONSE_JSON_INVALID');
          key = string(); whitespace();
          if (text[offset++] !== ':') throw fault('CKAN_RESPONSE_JSON_INVALID');
        }
        const item = value();
        if (object) Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
        else result.push(item);
        whitespace();
        const separator = text[offset++];
        if (separator === closing) return result;
        if (separator !== ',') throw fault('CKAN_RESPONSE_JSON_INVALID');
        whitespace();
      }
      throw fault('CKAN_RESPONSE_JSON_INVALID');
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    if (!match) throw fault('CKAN_RESPONSE_JSON_INVALID');
    offset += match[0].length;
    return numberValue(match[0]);
  }
  const result = value(); whitespace();
  if (offset !== text.length) throw fault('CKAN_RESPONSE_JSON_INVALID');
  return result;
}
export function parseDcatJsonText(text) {
  if (typeof text !== 'string') throw fault('CKAN_RESPONSE_JSON_INVALID');
  if (!hasSourceContext) return readExactTokens(text);
  try {
    return JSON.parse(text, (_key, value, context) =>
      typeof value === 'number' ? numberValue(context.source) : value);
  } catch (error) {
    if (error.code) throw error;
    throw fault('CKAN_RESPONSE_JSON_INVALID');
  }
}
export function parseDcatJson(buffer) {
  if (hasSourceContext) return parseCkanJson(buffer);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw fault('CKAN_RESPONSE_ENCODING'); }
  return readExactTokens(text);
}
export function stringifyDcatJson(value, replacer = null, space = 0) {
  if (replacer !== null && replacer !== undefined) throw fault('DCAT_JSON_REPLACER_UNSUPPORTED');
  const gap = typeof space === 'number' ? ' '.repeat(Math.min(10, Math.max(0, Math.floor(space)))) : String(space).slice(0, 10);
  const ancestors = new Set();
  function write(item, depth) {
    if (isExactCkanNumber(item)) {
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(item.source))
        throw fault('CKAN_RESPONSE_JSON_INVALID');
      return item.source;
    }
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number')
      return JSON.stringify(item);
    if (typeof item === 'undefined' || typeof item === 'function' || typeof item === 'symbol') return undefined;
    if (typeof item !== 'object' || ancestors.has(item)) throw fault('DCAT_JSON_VALUE_INVALID');
    ancestors.add(item);
    const array = Array.isArray(item), parts = [];
    if (array) for (const part of item) parts.push(write(part, depth + 1) ?? 'null');
    else for (const key of Object.keys(item)) {
      const part = write(item[key], depth + 1);
      if (part !== undefined) parts.push(JSON.stringify(key) + (gap ? ': ' : ':') + part);
    }
    ancestors.delete(item);
    const opening = array ? '[' : '{', closing = array ? ']' : '}';
    return parts.length === 0 ? opening + closing : !gap ? opening + parts.join(',') + closing :
      opening + '\n' + gap.repeat(depth + 1) + parts.join(',\n' + gap.repeat(depth + 1)) + '\n' + gap.repeat(depth) + closing;
  }
  return write(value, 0);
}
