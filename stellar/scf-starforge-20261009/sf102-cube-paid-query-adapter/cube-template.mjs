// MIT. Compile operator-owned Cube analytical templates into bounded, exact query requests.
// No network, payment, secrets or dynamic Cube query language execution in this module.
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const INPUT = /^[a-z][a-z0-9_]{0,39}$/;
const CUBE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const plain = obj => obj !== null && typeof obj === 'object' && !Array.isArray(obj) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(obj));
const bad = message => { throw new TypeError(message); };
const str = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max &&
  !/[\x00-\x1f\x7f]/.test(s);

function valueDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(s + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
}
function inputSpec(name, spec) {
  if (!INPUT.test(name) || !plain(spec) || Object.keys(spec).some(k => !['type','values','min','max'].includes(k))) bad('Invalid Cube input descriptor');
  if (spec.type === 'enum') {
    if (!Array.isArray(spec.values) || !spec.values.length || spec.values.length > 32 ||
      spec.values.some(v => !str(v, 128)) || new Set(spec.values).size !== spec.values.length ||
      own(spec,'min') || own(spec,'max')) bad('Invalid enum choices');
  } else if (spec.type === 'date') {
    if (own(spec,'values') || own(spec,'min') || own(spec,'max')) bad('Invalid date input descriptor');
  } else if (spec.type === 'integer') {
    if (own(spec,'values') || !Number.isSafeInteger(spec.min) || !Number.isSafeInteger(spec.max) ||
      spec.min > spec.max) bad('Invalid integer input bounds');
  } else bad('Only enum, date and bounded integer inputs are supported');
  return spec;
}
function scalar(input, spec) {
  if (typeof input !== 'string' || input.length > 128) bad('Invalid input value');
  if (spec.type === 'enum' && spec.values.includes(input)) return input;
  if (spec.type === 'date' && valueDate(input)) return input;
  if (spec.type === 'integer' && /^-?(?:0|[1-9]\d*)$/.test(input)) {
    const value = Number(input);
    if (Number.isSafeInteger(value) && value >= spec.min && value <= spec.max) return value;
  }
  bad('Input not permitted by operator template');
}
function cloneTemplate(source, inputs, seen, args, depth = 0, tally = {n:0}) {
  if (depth > 16 || ++tally.n > 2048) bad('Cube query too complex');
  if (source === null || typeof source === 'boolean' || typeof source === 'number' && Number.isFinite(source)) return source;
  if (typeof source === 'string') {
    if (!str(source, 1024)) bad('Invalid Cube query string');
    return source;
  }
  if (Array.isArray(source)) {
    if (source.length > 256) bad('Oversized Cube query array');
    return source.map(value => cloneTemplate(value,inputs,seen,args,depth + 1,tally));
  }
  if (!plain(source)) bad('Non-JSON Cube query node');
  const keys = Object.keys(source);
  if (keys.length === 1 && keys[0] === '$param') {
    const name = source.$param;
    if (!INPUT.test(name) || !own(inputs,name)) bad('Unregistered Cube query parameter');
    seen.add(name);
    return args === null ? null : scalar(args[name], inputs[name]);
  }
  if (keys.length > 64 || keys.some(k => !str(k,80) || ['__proto__','prototype','constructor','$param'].includes(k))) bad('Invalid Cube query object');
  const output = Object.create(null);
  for (const key of keys) output[key] = cloneTemplate(source[key],inputs,seen,args,depth + 1,tally);
  return output;
}

/** Compile once from a trusted merchant-owned JSON config. No buyer-selected schemas. */
export function compileCubeCatalog(config) {
  if (!plain(config) || config.schema !== 'stellar-forge.cube-paid-query.v1' ||
      !plain(config.reports) || Object.keys(config.reports).length < 1 || Object.keys(config.reports).length > 24) bad('Invalid Cube adapter catalog');
  const catalog = new Map();
  for (const [name, record] of Object.entries(config.reports)) {
    if (!NAME.test(name) || !plain(record) || !plain(record.query) || !plain(record.inputs) ||
        Object.keys(record).some(k => !['query','inputs','range'].includes(k)) ||
        Object.keys(record.inputs).length > 12) bad('Invalid named Cube report');
    const allowedKeys = new Set(['measures','dimensions','segments','filters','timeDimensions',
      'order','limit','offset','timezone','total','ungrouped','renewQuery']);
    if (Object.keys(record.query).some(key => !allowedKeys.has(key)) ||
        JSON.stringify(record.query).length > 16384) bad('Unapproved Cube query structure');
    if (!Array.isArray(record.query.measures) || record.query.measures.length < 1 ||
        record.query.measures.length > 16 || record.query.measures.some(v => !CUBE.test(v)) ||
        own(record.query,'limit') && (!Number.isSafeInteger(record.query.limit) ||
        record.query.limit < 1 || record.query.limit > 1000)) bad('Invalid Cube measures or result limit');
    const inputs = Object.create(null);
    for (const [key, spec] of Object.entries(record.inputs)) inputs[key] = inputSpec(key,spec);
    const seen = new Set();
    cloneTemplate(record.query,inputs,seen,null);
    if (seen.size !== Object.keys(inputs).length) bad('Every declared input must be used in Cube query');
    const range = record.range;
    if (range !== undefined && (!plain(range) || Object.keys(range).some(k => !['start','end','maxDays'].includes(k)) ||
        typeof range.start !== 'string' || typeof range.end !== 'string' || range.start === range.end ||
        inputs[range.start]?.type !== 'date' || inputs[range.end]?.type !== 'date' ||
        !Number.isSafeInteger(range.maxDays) || range.maxDays < 1 || range.maxDays > 366)) bad('Invalid Cube date-range guard');
    catalog.set(name, {query:record.query,inputs,range});
  }
  return catalog;
}

/** Build only a named approved report. Any unknown/repeated buyer input fails closed. */
export function renderCubeQuery(catalog, context) {
  if (!(catalog instanceof Map) || !plain(context) || context.method !== 'GET' ||
      !plain(context.query) || !(context.url instanceof URL)) bad('Invalid Cube GET report context');
  const match = /^\/reports\/([a-z][a-z0-9-]{0,39})$/.exec(context.url.pathname);
  if (!match) bad('Unapproved Cube route');
  const record = catalog.get(match[1]);
  if (!record) bad('Unknown report');
  const keys = Object.keys(context.query);
  if (keys.length !== Object.keys(record.inputs).length ||
      keys.some(key => !own(record.inputs,key) || typeof context.query[key] !== 'string') ||
      Object.keys(record.inputs).some(key => !own(context.query,key))) bad('Missing, repeated or undeclared report input');
  const seen = new Set();
  const query = cloneTemplate(record.query,record.inputs,seen,context.query);
  if (record.range) {
    const from = context.query[record.range.start], to = context.query[record.range.end];
    const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
    if (!Number.isFinite(days) || days < 0 || days > record.range.maxDays) bad('Invalid approved report date span');
  }
  return query;
}
