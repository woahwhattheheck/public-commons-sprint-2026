// MIT. Preserve native JSON numeric lexemes with the platform JSON parser.
import { createHash } from 'node:crypto';
import { fault } from '../postgres/publisher/files.mjs';
const NUMBER = Symbol('Matomo native JSON number');
export class NativeNumber {
  constructor(text) { this[NUMBER] = text; Object.freeze(this); }
  toString() { return this[NUMBER]; }
}
export const isNativeNumber = value => value instanceof NativeNumber;
export function parseNative(value) {
  const source = typeof value === 'string' ? value : new TextDecoder('utf-8', {fatal: true}).decode(value);
  if (typeof JSON.rawJSON !== 'function') throw fault('MATOMO_NODE_JSON_SOURCE_REQUIRED', 'Use the maintained Node runtime with native JSON source-text support.');
  try {
    return JSON.parse(source, (_key, item, context) => {
      if (typeof item !== 'number') return item;
      if (typeof context?.source !== 'string') throw fault('MATOMO_NODE_JSON_SOURCE_REQUIRED');
      return new NativeNumber(context.source);
    });
  } catch (error) {
    if (error.code) throw error;
    throw fault('MATOMO_RESPONSE_JSON_INVALID');
  }
}
export const encodeNative = value => JSON.stringify(value, (_key, item) => isNativeNumber(item) ? JSON.rawJSON(String(item)) : item);
export const nativeBytes = value => Buffer.from(encodeNative(value) + '\n');
export const nativeHash = value => createHash('sha256').update(encodeNative(value)).digest('hex');
export function scalarText(value) {
  if (isNativeNumber(value)) return String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value === null) return null;
  throw fault('MATOMO_SCALAR_REQUIRED');
}
export function nativeInteger(value, {minimum = 0, maximum = Number.MAX_SAFE_INTEGER} = {}) {
  const text = scalarText(value);
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(text ?? '') || !Number.isSafeInteger(Number(text)) ||
      Number(text) < minimum || Number(text) > maximum) throw fault('MATOMO_NATIVE_INTEGER_INVALID');
  return Number(text);
}
export function cell(value, present = true) {
  if (!present) return {kind: 'absent', text: null};
  if (value === null) return {kind: 'null', text: null};
  if (isNativeNumber(value) || typeof value === 'number') return {kind: 'number', text: scalarText(value)};
  if (typeof value === 'string') return {kind: 'string', text: value};
  if (typeof value === 'boolean') return {kind: 'boolean', text: String(value)};
  return {kind: 'json', text: encodeNative(value)};
}
export function shown(value) {
  if (isNativeNumber(value)) return String(value);
  if (Array.isArray(value)) return value.map(shown);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shown(child)]));
  return value;
}
export function numericIdentity(text) {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);
  if (!match) throw fault('MATOMO_NUMBER_INVALID');
  const digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '') || '0';
  let scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 1000000 || digits.length > 1048576) throw fault('MATOMO_NUMBER_LIMIT');
  if (digits === '0') return '0';
  const final = digits.replace(/0+$/, '');
  scale -= digits.length - final.length;
  return (match[1] ? '-' : '') + final + 'e' + String(-scale);
}
export function cellIdentity(value) {
  const item = cell(value);
  return item.kind + ':' + (item.kind === 'number' ? numericIdentity(item.text) : item.text);
}
