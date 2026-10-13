import { createHash } from 'node:crypto';

export class SupplierStatementReconciliationError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SupplierStatementReconciliationError';
    this.code = code;
  }
}

export const fail = (code, detail = '') => { throw new SupplierStatementReconciliationError(code, detail); };

const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function sortedOwnKeys(value) {
  const keys = Object.keys(value);
  for (let i = 1; i < keys.length; i += 1) {
    const key = keys[i];
    let j = i - 1;
    while (j >= 0 && key < keys[j]) {
      keys[j + 1] = keys[j];
      j -= 1;
    }
    keys[j + 1] = key;
  }
  return keys;
}

export function canonicalize(value) {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NONFINITE_NUMBER');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObj(value)) {
    const out = Object.create(null);
    for (const key of sortedOwnKeys(value)) {
      Object.defineProperty(out, key, {
        value: canonicalize(value[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return out;
  }
  fail('UNSUPPORTED_VALUE');
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex');
}

class StrictJsonParser {
  constructor(text) { this.text = text; this.i = 0; }
  ws() { while ([' ', '\t', '\r', '\n'].includes(this.text[this.i] ?? '')) this.i += 1; }
  parse() {
    this.ws();
    const value = this.value();
    this.ws();
    if (this.i !== this.text.length) fail('INVALID_JSON');
    return value;
  }
  value() {
    this.ws();
    const c = this.text[this.i];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    if (this.text.startsWith('true', this.i)) { this.i += 4; return true; }
    if (this.text.startsWith('false', this.i)) { this.i += 5; return false; }
    if (this.text.startsWith('null', this.i)) { this.i += 4; return null; }
    return this.number();
  }
  string() {
    const start = this.i;
    this.i += 1;
    let escaped = false;
    while (this.i < this.text.length) {
      const c = this.text[this.i];
      if (!escaped && c === '"') {
        this.i += 1;
        try { return JSON.parse(this.text.slice(start, this.i)); } catch { fail('INVALID_JSON'); }
      }
      if (!escaped && c === '\\') escaped = true;
      else escaped = false;
      if (c.charCodeAt(0) < 0x20) fail('INVALID_JSON');
      this.i += 1;
    }
    fail('INVALID_JSON');
  }
  number() {
    const match = this.text.slice(this.i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (!match) fail('INVALID_JSON');
    this.i += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail('INVALID_JSON');
    return value;
  }
  array() {
    this.i += 1;
    const out = [];
    this.ws();
    if (this.text[this.i] === ']') { this.i += 1; return out; }
    while (true) {
      out.push(this.value());
      this.ws();
      if (this.text[this.i] === ']') { this.i += 1; return out; }
      if (this.text[this.i] !== ',') fail('INVALID_JSON');
      this.i += 1;
      this.ws();
    }
  }
  object() {
    this.i += 1;
    const out = Object.create(null);
    const keys = new Set();
    this.ws();
    if (this.text[this.i] === '}') { this.i += 1; return out; }
    while (true) {
      if (this.text[this.i] !== '"') fail('INVALID_JSON');
      const key = this.string();
      if (keys.has(key)) fail('DUPLICATE_JSON_KEY', key);
      keys.add(key);
      this.ws();
      if (this.text[this.i] !== ':') fail('INVALID_JSON');
      this.i += 1;
      out[key] = this.value();
      this.ws();
      if (this.text[this.i] === '}') { this.i += 1; return out; }
      if (this.text[this.i] !== ',') fail('INVALID_JSON');
      this.i += 1;
      this.ws();
    }
  }
}

export function parseStrictJson(text) {
  if (typeof text !== 'string') fail('JSON_TEXT_REQUIRED');
  return new StrictJsonParser(text).parse();
}
