// MIT. Portable SF74 merchant cases. Browser/Node 22+, no dependencies or I/O.
// A digest detects changed bytes; it does not authenticate a merchant or approval.
export const WORKSPACE_SCHEMA = 'stellar-forge.merchant-workspace.v1';
export const MAX_SOURCE_BYTES = 2_000_000;
export const MAX_WORKSPACE_BYTES = 16_100_000;
const MAX_TERMS_BYTES = 65_536;
const INPUT_KEYS = ['resource', 'catalog', 'origin', 'network', 'payTo', 'method', 'credentialed'];
const SOURCE_SCHEMAS = Object.freeze({
  intake: 'stellar-forge.merchant-intake.v1',
  preflight: 'stellar-forge.post-only-browser-preflight.v1',
  before: 'stellar-forge.merchant-intake.v1',
  after: 'stellar-forge.merchant-intake.v1',
  postBefore: 'stellar-forge.post-only-browser-preflight.v1',
  postAfter: 'stellar-forge.post-only-browser-preflight.v1',
});
const SLOTS = Object.keys(SOURCE_SCHEMAS);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new TypeError(`Unexpected ${label} field: ${key}`);
  }
  return value;
}
function string(value, max, label, {empty = true} = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || textEncoder.encode(value).length > max)
    throw new TypeError(`Invalid ${label}`);
  // Lone surrogates cannot round-trip through UTF-8 and must not silently change.
  if (textDecoder.decode(textEncoder.encode(value)) !== value) throw new TypeError(`Invalid Unicode in ${label}`);
  return value;
}
function bool(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}
function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new TypeError('Invalid workspace save time');
  return value;
}
function inputs(value = {}) {
  object(value, INPUT_KEYS, 'intake inputs');
  const result = {};
  // Drafts may be unfinished. Original SF70, not this file format, validates a probe.
  for (const key of INPUT_KEYS) {
    result[key] = key === 'credentialed'
      ? bool(value[key] ?? false, key)
      : string(value[key] ?? '', 2048, key);
  }
  return result;
}
function sources(value = {}) {
  object(value, SLOTS, 'sources');
  return Object.fromEntries(SLOTS.map(slot => [slot, value[slot] ?? null]));
}
export function encodeSource(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Source must be bytes');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export function decodeSource(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0 ||
      encoded.length > 4 * Math.ceil(MAX_SOURCE_BYTES / 3) ||
      encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded))
    throw new TypeError('Source must be canonical Base64 containing 1..2,000,000 bytes');
  let binary;
  try { binary = atob(encoded); } catch { throw new TypeError('Invalid source Base64'); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES || encodeSource(bytes) !== encoded)
    throw new TypeError('Invalid source encoding or size');
  return bytes;
}
export async function sourceDigest(bytes) {
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
function sourceSchema(bytes, slot) {
  let data;
  try { data = JSON.parse(textDecoder.decode(bytes)); }
  catch { throw new TypeError(`${slot} must contain original UTF-8 JSON`); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schema !== SOURCE_SCHEMAS[slot])
    throw new TypeError(`${slot} is not an original ${SOURCE_SCHEMAS[slot]} source`);
  return data.schema;
}
function draft(value) {
  object(value, ['name', 'inputs', 'sources', 'termsText', 'baselineOnly', 'workorderSource'], 'workspace draft');
  if(value.workorderSource!==undefined&&!['diagnostic','runtime'].includes(value.workorderSource))
    throw new TypeError('Unknown workorder source');
  return {
    name: string(value.name ?? 'Merchant case', 480, 'case name', {empty: false}),
    inputs: inputs(value.inputs),
    sources: sources(value.sources),
    termsText: string(value.termsText ?? '', MAX_TERMS_BYTES, 'draft terms'),
    baselineOnly: bool(value.baselineOnly ?? false, 'baselineOnly'),
    ...(value.workorderSource===undefined?{}:{workorderSource:value.workorderSource}),
  };
}

/** Return one downloadable JSON file, retaining source bytes rather than reformatting JSON. */
export async function serializeWorkspace(value, {now = new Date().toISOString()} = {}) {
  const state = draft(value);
  const blobs = Object.create(null), refs = {};
  for (const slot of SLOTS) {
    const encoded = state.sources[slot];
    if (encoded === null) { refs[slot] = null; continue; }
    const bytes = decodeSource(encoded);
    const schema = sourceSchema(bytes, slot);
    const sha256 = await sourceDigest(bytes);
    refs[slot] = sha256;
    if (!own(blobs, sha256)) blobs[sha256] = {encoding: 'base64', bytes: bytes.length, schema, data: encoded};
  }
  const file = JSON.stringify({
    schema: WORKSPACE_SCHEMA, savedAt: utc(now), name: state.name,
    inputs: state.inputs, sources: refs, blobs, termsText: state.termsText,
    baselineOnly: state.baselineOnly,
    ...(state.workorderSource==='runtime'?{workorderSource:'runtime'}:{}),
  }, null, 2) + '\n';
  if (textEncoder.encode(file).length > MAX_WORKSPACE_BYTES) throw new TypeError('Workspace exceeds file size limit');
  return file;
}

/** Validate completely before the UI replaces any state. Never makes network requests. */
export async function parseWorkspace(text) {
  string(text, MAX_WORKSPACE_BYTES, 'workspace file', {empty: false});
  let file;
  try { file = JSON.parse(text); } catch { throw new TypeError('Workspace is not valid JSON'); }
  object(file, ['schema', 'savedAt', 'name', 'inputs', 'sources', 'blobs', 'termsText', 'baselineOnly', 'workorderSource'], 'workspace');
  for (const key of ['schema', 'savedAt', 'name', 'inputs', 'sources', 'blobs', 'termsText', 'baselineOnly'])
    if (!own(file, key)) throw new TypeError(`Missing workspace field: ${key}`);
  if (file.schema !== WORKSPACE_SCHEMA) throw new TypeError('Unsupported merchant workspace version');
  const savedAt = utc(file.savedAt);
  object(file.sources, SLOTS, 'source references');
  if (SLOTS.some(slot => !own(file.sources, slot))) throw new TypeError('Workspace source slots are missing');
  if (!file.blobs || typeof file.blobs !== 'object' || Array.isArray(file.blobs)) throw new TypeError('Missing source blobs');
  const keys = Object.keys(file.blobs);
  if (keys.length > SLOTS.length || keys.some(k => !/^[a-f0-9]{64}$/.test(k))) throw new TypeError('Invalid source blob keys');
  const validated = new Map(), used = new Set(), restored = {};
  for (const slot of SLOTS) {
    const ref = file.sources[slot];
    if (ref === null) { restored[slot] = null; continue; }
    if (typeof ref !== 'string' || !/^[a-f0-9]{64}$/.test(ref) || !own(file.blobs, ref))
      throw new TypeError(`Missing source blob for ${slot}`);
    used.add(ref);
    const blob = object(file.blobs[ref], ['encoding', 'bytes', 'schema', 'data'], 'source blob');
    if (blob.encoding !== 'base64' || blob.schema !== SOURCE_SCHEMAS[slot]) throw new TypeError(`Invalid ${slot} source metadata`);
    if (!validated.has(ref)) {
      const bytes = decodeSource(blob.data);
      if (blob.bytes !== bytes.length || await sourceDigest(bytes) !== ref) throw new TypeError(`Source bytes changed: ${slot}`);
      sourceSchema(bytes, slot);
      validated.set(ref, true);
    }
    restored[slot] = blob.data;
  }
  if (used.size !== keys.length) throw new TypeError('Workspace contains unreferenced source blobs');
  const state = draft({name: file.name, inputs: file.inputs, sources: restored,
    termsText: file.termsText, baselineOnly: file.baselineOnly,...(own(file,'workorderSource')?{workorderSource:file.workorderSource}:{})});
  return { ...state, savedAt, summary: {
    sourceCount: Object.values(restored).filter(v => v !== null).length,
    uniqueSourceCount: used.size,
    sourceBytes: keys.reduce((total, key) => total + file.blobs[key].bytes, 0),
    termsPresent: state.termsText.trim().length > 0,
  }};
}

export function workspaceFilename(name) {
  const slug = String(name).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${slug || 'merchant-case'}.merchant-workspace.json`;
}
