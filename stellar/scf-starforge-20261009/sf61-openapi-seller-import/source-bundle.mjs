// MIT. Local OpenAPI source graph, consumed by the original SF61 compiler.
// This module reads only the caller-supplied source map. It performs no I/O.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parseOpenApiValue } from './source-value.mjs';

export const SOURCE_BUNDLE_SCHEMA = 'stellar.openapi.source-bundle.v1';
export const SOURCE_BUNDLE_LIMIT = 4 * 1024 * 1024;
const REGISTRY = 'x-stellar-source-targets';
const MAX_FILES = 128, MAX_REFERENCES = 4096, MAX_NODES = 50000;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pointerPart = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const at = (pointer, key) => pointer + '/' + pointerPart(String(key));
const referenceKinds = new Set(['schema', 'pathItem', 'parameter', 'header',
  'requestBody', 'response', 'example', 'callback', 'link', 'securityScheme']);
const methodNames = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace']);
const componentKinds = { schemas: 'schema', parameters: 'parameter', headers: 'header',
  requestBodies: 'requestBody', responses: 'response', examples: 'example',
  callbacks: 'callback', links: 'link', securitySchemes: 'securityScheme', pathItems: 'pathItem' };
const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const schemaValues = new Set(['additionalProperties', 'unevaluatedProperties', 'unevaluatedItems',
  'contentSchema', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'additionalItems']);
const schemaLists = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

function fail(code, message, detail = {}) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code; error.detail = detail;
  throw error;
}
export function sourceBundleDigest(value) { return digest(value); }
export function sourceBundleJSON(value) { return json(value); }

/** Names are decoded, root-relative POSIX paths, never URI references. */
export function sourceBundlePath(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 ||
      /[\\\x00-\x1f\x7f]/.test(name) || posix.isAbsolute(name) ||
      name === '.' || name === '..' || name.startsWith('../') ||
      posix.normalize(name) !== name || name.endsWith('/') || /^[A-Za-z]:/.test(name))
    fail('OPENAPI_SOURCE_PATH', 'Use a normalized relative source filename', { path: name });
  return name;
}

function assertJSON(value, state, depth = 0) {
  if (++state.nodes > MAX_NODES || depth > 48)
    fail('OPENAPI_SOURCE_COMPLEXITY', 'The source graph exceeds the original compiler complexity limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const child of value) assertJSON(child, state, depth + 1); return; }
  if (!plain(value)) fail('OPENAPI_SOURCE_VALUE', 'Sources must contain JSON-compatible values');
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      fail('OPENAPI_SOURCE_KEY', 'Unsupported dictionary key: ' + key);
    assertJSON(child, state, depth + 1);
  }
}

function resolveReference(from, ref) {
  if (typeof ref !== 'string' || ref.length > 4096 || /[\\\x00-\x20\x7f]/.test(ref))
    fail('OPENAPI_SOURCE_REFERENCE', 'Invalid URI reference', { from, ref });
  const hash = ref.indexOf('#');
  const uriPath = hash < 0 ? ref : ref.slice(0, hash);
  const fragment = hash < 0 ? '' : ref.slice(hash + 1);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uriPath) || uriPath.startsWith('/') || uriPath.includes('?'))
    fail('OPENAPI_SOURCE_LOCAL_ONLY', 'Supply a relative file reference within the selected source root', { from, ref });
  let decodedPath, pointer;
  try { decodedPath = decodeURIComponent(uriPath); pointer = decodeURIComponent(fragment); }
  catch { fail('OPENAPI_SOURCE_REFERENCE', 'Malformed percent encoding', { from, ref }); }
  // Encoded separators are ambiguous across operating systems and URI resolvers.
  if (/%(?:2f|5c)/i.test(uriPath) || /[\\\x00-\x1f\x7f]/.test(decodedPath) || posix.isAbsolute(decodedPath))
    fail('OPENAPI_SOURCE_REFERENCE', 'Reference contains an encoded separator or invalid filename', { from, ref });
  const path = uriPath === '' ? from : posix.normalize(posix.join(posix.dirname(from), decodedPath));
  sourceBundlePath(path);
  if (pointer !== '' && !pointer.startsWith('/'))
    fail('OPENAPI_SOURCE_POINTER', 'Use an empty fragment or a JSON Pointer; named anchors require a separate schema resource', { from, ref });
  const tokens = pointer === '' ? [] : pointer.slice(1).split('/').map(token => {
    if (/~(?![01])/.test(token)) fail('OPENAPI_SOURCE_POINTER', 'Invalid JSON Pointer escape', { from, ref });
    return token.replaceAll('~1', '/').replaceAll('~0', '~');
  });
  return { path, pointer: tokens.length ? '/' + tokens.map(pointerPart).join('/') : '', tokens };
}

/**
 * Capture an entry's complete structural $ref graph. readSource(path) returns
 * exact UTF-8 text synchronously. Referenced examples are followed; example
 * values, schema defaults/const/examples and extension payloads remain data.
 */
export function createSourceBundle({ entry, readSource }) {
  sourceBundlePath(entry);
  if (typeof readSource !== 'function') throw new TypeError('readSource must return exact source text');
  const loaded = new Map(), targets = new Map(), queue = [], edges = new Map();
  const inputState = { nodes: 0 }; let totalBytes = 0, steps = 0;
  function load(path) {
    if (loaded.has(path)) return loaded.get(path);
    if (loaded.size >= MAX_FILES) fail('OPENAPI_SOURCE_FILES', 'A source bundle supports at most 128 files');
    let text;
    try { text = readSource(path); }
    catch (cause) {
      fail('OPENAPI_SOURCE_MISSING', `Cannot read ${path}: ${cause.message}`, { path, causeCode: cause.code });
    }
    if (typeof text !== 'string') fail('OPENAPI_SOURCE_MISSING', 'Missing source: ' + path, { path });
    if (Buffer.from(text).toString('utf8') !== text) fail('OPENAPI_SOURCE_ENCODING', 'Source text must be valid UTF-8: ' + path);
    const bytes = Buffer.byteLength(text);
    totalBytes += bytes;
    if (totalBytes > SOURCE_BUNDLE_LIMIT) fail('OPENAPI_SOURCE_SIZE', 'Source text exceeds 4 MiB in total');
    let parsed;
    try { parsed = parseOpenApiValue(text); }
    catch (cause) { fail('OPENAPI_SOURCE_PARSE', `${path}: ${cause.message}`, { path }); }
    assertJSON(parsed.value, inputState);
    const item = { path, text, bytes, sha256: digest(text), format: parsed.format, value: parsed.value };
    loaded.set(path, item);
    return item;
  }
  const root = load(entry).value;
  if (!plain(root) || !/^3\.[01]\.\d+$/.test(root.openapi) || !plain(root.paths))
    fail('OPENAPI_SOURCE_ENTRY', 'The entry must be an OpenAPI 3.0 or 3.1 document with paths');
  const legacy = /^3\.0\./.test(root.openapi);
  if (own(root, REGISTRY)) fail('OPENAPI_SOURCE_RESERVED', REGISTRY + ' is reserved for generated targets');

  function targetReference(ref, kind, file, pointer) {
    const target = resolveReference(file, ref);
    let value = load(target.path).value;
    for (const token of target.tokens) {
      if (value === null || typeof value !== 'object' || !own(value, token))
        fail('OPENAPI_SOURCE_POINTER', `Unresolved target ${target.path}#${target.pointer}`, { from: file, pointer, ref });
      value = value[token];
    }
    if (!plain(value) && !(kind === 'schema' && typeof value === 'boolean'))
      fail('OPENAPI_SOURCE_TARGET', `Expected ${kind} at ${target.path}#${target.pointer}`, { from: file, pointer, ref });
    const key = digest(JSON.stringify([kind, target.path, target.pointer]));
    if (!targets.has(key)) {
      if (targets.size >= MAX_REFERENCES) fail('OPENAPI_SOURCE_REFERENCES', 'Too many distinct reference targets');
      targets.set(key, null);
      queue.push({ key, value, kind, file: target.path, pointer: target.pointer });
    }
    const localRef = '#/' + REGISTRY + '/' + key;
    const edge = { from: file, pointer, ref, kind, target: target.path,
      targetPointer: target.pointer, localRef };
    edges.set(JSON.stringify([file, pointer, ref, kind]), edge);
    return localRef;
  }
  function map(value, kind, file, pointer, depth, skipExtensions = false) {
    if (!plain(value)) return structuredClone(value);
    return Object.fromEntries(Object.entries(value).map(([key, child]) =>
      [key, skipExtensions && key.startsWith('x-') ? structuredClone(child) : walk(child, kind, file, at(pointer, key), depth + 1)]));
  }
  function list(value, kind, file, pointer, depth) {
    if (!Array.isArray(value)) return structuredClone(value);
    return value.map((child, i) => walk(child, kind, file, at(pointer, i), depth + 1));
  }
  function walk(value, kind, file, pointer, depth = 0) {
    if (++steps > MAX_NODES || depth > 48) fail('OPENAPI_SOURCE_COMPLEXITY', 'Reference graph exceeds supported complexity');
    if (!plain(value)) return structuredClone(value);
    if (kind === 'schema' && !(legacy && own(value, '$ref')) && ['$id', '$anchor', '$dynamicRef', '$dynamicAnchor'].some(key => own(value, key)))
      fail('OPENAPI_SOURCE_SCHEMA_RESOURCE', `Schema resource identifiers/anchors are unsupported at ${file}#${pointer}`);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      const here = at(pointer, key);
      if (key === '$ref' && referenceKinds.has(kind))
        return [key, targetReference(child, kind, file, here)];
      // OAS 3.0 reference siblings are ignored by the original compiler.
      if (legacy && referenceKinds.has(kind) && own(value, '$ref')) return [key, structuredClone(child)];
      // Free-form values are never interpreted as references.
      if (key.startsWith('x-')) return [key, structuredClone(child)];
      let next = null, collection = null;
      if (kind === 'document') {
        if (key === 'paths' || key === 'webhooks') { next = 'pathItem'; collection = 'map'; }
        if (key === 'components') next = 'components';
      } else if (kind === 'components' && own(componentKinds, key)) {
        next = componentKinds[key]; collection = 'map';
      } else if (kind === 'pathItem') {
        if (methodNames.has(key)) next = 'operation';
        if (key === 'parameters') { next = 'parameter'; collection = 'list'; }
      } else if (kind === 'operation') {
        if (key === 'parameters') { next = 'parameter'; collection = 'list'; }
        if (key === 'requestBody') next = 'requestBody';
        if (key === 'responses') { next = 'response'; collection = 'map'; }
        if (key === 'callbacks') { next = 'callback'; collection = 'map'; }
      } else if (kind === 'parameter' || kind === 'header' || kind === 'media') {
        if (key === 'schema') next = 'schema';
        if (key === 'content') { next = 'media'; collection = 'map'; }
        if (key === 'examples') { next = 'example'; collection = 'map'; }
        if (kind === 'media' && key === 'encoding') { next = 'encoding'; collection = 'map'; }
      } else if (kind === 'requestBody' || kind === 'response') {
        if (key === 'content') { next = 'media'; collection = 'map'; }
        if (kind === 'response' && key === 'headers') { next = 'header'; collection = 'map'; }
        if (kind === 'response' && key === 'links') { next = 'link'; collection = 'map'; }
      } else if (kind === 'encoding' && key === 'headers') {
        next = 'header'; collection = 'map';
      } else if (kind === 'callback' && key !== '$ref') {
        next = 'pathItem';
      } else if (kind === 'link' && key === 'operationRef') {
        return [key, targetReference(child, 'operation', file, here)];
      } else if (kind === 'schema') {
        if (schemaMaps.has(key)) { next = 'schema'; collection = 'schemaMap'; }
        if (schemaValues.has(key)) next = 'schema';
        if (schemaLists.has(key)) { next = 'schema'; collection = 'list'; }
        if (key === 'items') { next = 'schema'; collection = Array.isArray(child) ? 'list' : null; }
        if (key === 'dependencies' && plain(child)) return [key, Object.fromEntries(Object.entries(child).map(([name, item]) =>
          [name, plain(item) ? walk(item, 'schema', file, at(here, name), depth + 1) : structuredClone(item)]))];
      }
      if (!next) return [key, structuredClone(child)];
      // Schema property names beginning x- are still property names.
      if (collection === 'schemaMap' && plain(child)) return [key, Object.fromEntries(Object.entries(child).map(([name, item]) =>
        [name, walk(item, next, file, at(here, name), depth + 1)]))];
      if (collection === 'map') return [key, map(child, next, file, here, depth, (kind === 'document' && key === 'paths') || (kind === 'operation' && key === 'responses'))];
      if (collection === 'list') return [key, list(child, next, file, here, depth)];
      return [key, walk(child, next, file, here, depth + 1)];
    }));
  }
  const document = walk(root, 'document', entry, '');
  // Work queue makes cycles finite while preserving references for the original
  // compiler to accept or reject. It never recursively inlines a schema.
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    targets.set(item.key, walk(item.value, item.kind, item.file, item.pointer));
  }
  if (targets.size) document[REGISTRY] = Object.fromEntries([...targets].sort(([a], [b]) => compare(a, b)));
  assertJSON(document, { nodes: 0 });
  const documentText = json(document);
  if (Buffer.byteLength(documentText) > SOURCE_BUNDLE_LIMIT)
    fail('OPENAPI_SOURCE_COMPILED_SIZE', 'The self-contained document exceeds the original 4 MiB source limit');
  const sources = [...loaded.values()].sort((a, b) => compare(a.path, b.path))
    .map(({ path, text, bytes, sha256, format }) => ({ path, format, bytes, sha256, text }));
  const sourceDigest = digest(JSON.stringify({ entry, sources: sources.map(({ text, ...row }) => row) }));
  const bundle = { schema: SOURCE_BUNDLE_SCHEMA, entry, sourceDigest, documentSha256: digest(documentText), sources };
  const text = json(bundle);
  if (Buffer.byteLength(text) > SOURCE_BUNDLE_LIMIT)
    fail('OPENAPI_SOURCE_PACKET_SIZE', 'The portable JSON packet exceeds the original 4 MiB upload limit');
  const references = [...edges.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  return { bundle, text, document, documentText, summary: { schema: SOURCE_BUNDLE_SCHEMA, entry,
    sourceDigest, documentSha256: bundle.documentSha256, files: sources.map(({ text, ...row }) => row),
    totalBytes, targets: targets.size, references } };
}

/** Rebuild using only the embedded original bytes; no filesystem/network reads. */
export function openSourceBundle(bundle) {
  if (!plain(bundle) || bundle.schema !== SOURCE_BUNDLE_SCHEMA ||
      Object.keys(bundle).some(key => !['schema', 'entry', 'sourceDigest', 'documentSha256', 'sources'].includes(key)) ||
      !Array.isArray(bundle.sources) || !bundle.sources.length || bundle.sources.length > MAX_FILES)
    fail('OPENAPI_SOURCE_PACKET', 'Invalid source bundle structure');
  const texts = new Map();
  for (const row of bundle.sources) {
    if (!plain(row) || Object.keys(row).some(key => !['path', 'format', 'bytes', 'sha256', 'text'].includes(key)) ||
        typeof row.text !== 'string' || !Number.isSafeInteger(row.bytes) ||
        !['json', 'yaml'].includes(row.format) || !/^[a-f0-9]{64}$/.test(row.sha256))
      fail('OPENAPI_SOURCE_PACKET', 'Invalid source file record');
    sourceBundlePath(row.path);
    if (texts.has(row.path)) fail('OPENAPI_SOURCE_DUPLICATE', 'Duplicate source: ' + row.path);
    if (Buffer.byteLength(row.text) !== row.bytes || digest(row.text) !== row.sha256)
      fail('OPENAPI_SOURCE_INTEGRITY', 'Source bytes changed: ' + row.path, { path: row.path });
    texts.set(row.path, row.text);
  }
  const rebuilt = createSourceBundle({ entry: bundle.entry, readSource: path => texts.get(path) });
  if (rebuilt.bundle.sourceDigest !== bundle.sourceDigest || rebuilt.bundle.documentSha256 !== bundle.documentSha256 ||
      rebuilt.bundle.sources.length !== bundle.sources.length)
    fail('OPENAPI_SOURCE_INTEGRITY', 'Source graph or normalized document does not match the retained packet');
  // Format is validated independently; record order in uploaded JSON is harmless.
  for (const row of rebuilt.bundle.sources) {
    if (bundle.sources.find(original => original.path === row.path).format !== row.format)
      fail('OPENAPI_SOURCE_INTEGRITY', 'Source format changed: ' + row.path);
  }
  return rebuilt;
}
