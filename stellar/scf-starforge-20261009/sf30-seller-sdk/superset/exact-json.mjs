// MIT. Preserve native JSON number tokens before dataset projection (Node 24+).
export class JsonNumber {
  constructor(source) {
    if (typeof source !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(source))
      throw new TypeError('Invalid native JSON number.');
    this.source = source; Object.freeze(this);
  }
}
export function parseExact(bytes) {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== 'number') return value;
    if (!context?.source) throw new Error('Superset receiving requires Node 24 JSON source context.');
    return new JsonNumber(context.source);
  });
}
export function stringifyExact(value) {
  if (typeof JSON.rawJSON !== 'function') throw new Error('Superset receiving requires Node 24 JSON.rawJSON.');
  return JSON.stringify(value, (_key, item) => item instanceof JsonNumber ? JSON.rawJSON(item.source) : item);
}
export function canonicalExact(value, depth=0) {
  if (depth>128) throw new TypeError('Native JSON exceeds the supported nesting depth.');
  if (value instanceof JsonNumber) return value;
  if (Array.isArray(value)) return value.map(v=>canonicalExact(v,depth+1));
  if (value!==null&&typeof value==='object')
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalExact(value[k],depth+1)]));
  return value;
}
export const numberToken = value => value instanceof JsonNumber ? value.source : null;
export const displayExact = value => value instanceof JsonNumber ? value.source :
  typeof value==='string' ? value : stringifyExact(value);
