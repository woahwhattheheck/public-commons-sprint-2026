// MIT. Exact JSON source values; native response bytes remain the primary record.
import { fault } from '../postgres/publisher/files.mjs';

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
export class JsonNumber {
  constructor(token) {
    if (typeof token !== 'string' || !NUMBER.test(token)) throw fault('DATASETTE_NUMBER_INVALID');
    this.token = token;
    Object.freeze(this);
  }
  toJSON() { return { $datasetteNumber: this.token }; }
}
export const isJsonNumber = value => value instanceof JsonNumber;
export const numericToken = value => isJsonNumber(value) ? value.token : null;

// A small strict reader is also available on Node versions without JSON.parse
// reviver context.source. It never materializes a source number as a JS Number.
export function parseExactJson(input, { maxDepth = 128 } = {}) {
  const source = typeof input === 'string' ? input :
    new TextDecoder('utf-8', { fatal: true }).decode(input);
  let at = 0;
  const whitespace = () => { while (at < source.length && /[ \t\r\n]/.test(source[at])) at++; };
  const invalid = () => { throw fault('DATASETTE_JSON_INVALID', 'Invalid JSON at character ' + at + '.'); };
  function string() {
    const start = at++;
    while (at < source.length) {
      const c = source[at++];
      if (c === '"') {
        try { return JSON.parse(source.slice(start, at)); } catch { invalid(); }
      }
      if (c === '\\') at++;
      else if (c.charCodeAt(0) < 32) invalid();
    }
    invalid();
  }
  function value(depth) {
    if (depth > maxDepth) throw fault('DATASETTE_JSON_TOO_DEEP');
    whitespace();
    const c = source[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; whitespace();
      const result = Object.create(null);
      if (source[at] === '}') { at++; return result; }
      while (at < source.length) {
        whitespace(); if (source[at] !== '"') invalid();
        const key = string(); whitespace();
        if (source[at++] !== ':') invalid();
        if (Object.hasOwn(result, key)) throw fault('DATASETTE_JSON_DUPLICATE_KEY', 'Duplicate JSON key: ' + key);
        result[key] = value(depth + 1); whitespace();
        const end = source[at++];
        if (end === '}') return result;
        if (end !== ',') invalid();
      }
      invalid();
    }
    if (c === '[') {
      at++; whitespace();
      const result = [];
      if (source[at] === ']') { at++; return result; }
      while (at < source.length) {
        result.push(value(depth + 1)); whitespace();
        const end = source[at++];
        if (end === ']') return result;
        if (end !== ',') invalid();
      }
      invalid();
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, at)) { at += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(at));
    if (match) { at += match[0].length; return new JsonNumber(match[0]); }
    invalid();
  }
  const result = value(0);
  whitespace();
  if (at !== source.length) invalid();
  return result;
}

export function exactJson(value, { canonical = false } = {}) {
  if (isJsonNumber(value)) return value.token;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => exactJson(item, { canonical })).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (canonical) keys.sort();
    return '{' + keys.map(key => JSON.stringify(key) + ':' + exactJson(value[key], { canonical })).join(',') + '}';
  }
  throw fault('DATASETTE_NATIVE_VALUE_INVALID');
}

export function exactCell(value) {
  return value === null ? null : typeof value === 'string' ? value :
    typeof value === 'boolean' ? String(value) : isJsonNumber(value) ? value.token : exactJson(value);
}

export function nativeKind(value) {
  return value === null ? 'null' : isJsonNumber(value) ?
    (/^-?(0|[1-9][0-9]*)$/.test(value.token) ? 'integer' : 'number') :
    Array.isArray(value) ? 'array' : typeof value;
}

function decimal(token) {
  if (typeof token !== 'string' || !NUMBER.test(token)) throw fault('DATASETTE_NUMBER_INVALID');
  let [mantissa, power = '0'] = token.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  if (negative) mantissa = mantissa.slice(1);
  const point = mantissa.indexOf('.');
  let exponent = BigInt(power) - BigInt(point < 0 ? 0 : mantissa.length - point - 1);
  let coefficient = mantissa.replace('.', '').replace(/^0+/, '');
  if (!coefficient) return { sign: 0, coefficient: '0', exponent: 0n };
  const trailing = coefficient.length - coefficient.replace(/0+$/, '').length;
  coefficient = coefficient.slice(0, coefficient.length - trailing);
  exponent += BigInt(trailing);
  return { sign: negative ? -1 : 1, coefficient, exponent };
}

export function canonicalNumber(token) {
  const value = decimal(token);
  return value.sign + ':' + value.coefficient + ':' + value.exponent;
}

export function compareExactNumbers(left, right) {
  const a = decimal(left), b = decimal(right);
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (!a.sign) return 0;
  const am = BigInt(a.coefficient.length) + a.exponent;
  const bm = BigInt(b.coefficient.length) + b.exponent;
  if (am !== bm) return (am < bm ? -1 : 1) * a.sign;
  const length = Math.max(a.coefficient.length, b.coefficient.length);
  const av = a.coefficient.padEnd(length, '0'), bv = b.coefficient.padEnd(length, '0');
  return (av < bv ? -1 : av > bv ? 1 : 0) * a.sign;
}

export function isSafeIntegerToken(token) {
  const value = Number(token);
  return Number.isSafeInteger(value) && compareExactNumbers(token, String(value)) === 0;
}
export function hasLosslessNumberRoundtrip(token) {
  const value = Number(token);
  return Number.isFinite(value) && compareExactNumbers(token, String(value)) === 0;
}
export function sourceCellIdentity(value, { numericValue = false } = {}) {
  return isJsonNumber(value) ? 'number:' + (numericValue ? canonicalNumber(value.token) : value.token) :
    value === null ? 'null' : typeof value === 'string' ? 'string:' + JSON.stringify(value) :
    typeof value === 'boolean' ? 'boolean:' + value : 'json:' + exactJson(value, { canonical: true });
}
