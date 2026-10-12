// MIT. Receive complete native SF47 exports and retain their exact original bytes.
import {PLAN_SCHEMA, PLAN_SOURCE_SCHEMA, validatePlanDocument} from './grant-plan-core.mjs';
export const MAX_PLAN_BYTES = 32 * 1024 * 1024;
const ENTRIES = ['MANIFEST.json', 'README.txt', 'contributors.csv', 'daily-cash-flow.csv',
  'delivery-plan.json', 'original-model.json', 'original-source.json', 'planning.json',
  'scenario.json', 'work-packages.csv', 'workspace.json'];
function need(value, message) { if (!value) throw new Error(message); }
const encoder = () => new TextEncoder();
const decoder = bytes => new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
export function encodeBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', parts = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
    parts.push(alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63] : '='));
  }
  return parts.join('');
}
export function decodeBase64(text) {
  need(typeof text === 'string' && text.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(text),
    'Retain the complete original planning file.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
    size = text.length / 4 * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);
  need(size <= MAX_PLAN_BYTES, 'The original planning file exceeds 32 MiB.');
  const output = new Uint8Array(size);
  let offset = 0, value = 0, bits = 0;
  for (const char of text) {
    if (char === '=') break;
    value = (value << 6) | alphabet.indexOf(char); bits += 6;
    if (bits >= 8) { bits -= 8; output[offset++] = (value >>> bits) & 255; }
  }
  return output;
}
async function browserDigest(bytes) {
  need(globalThis.crypto?.subtle, 'Open the submission workspace through HTTPS or its loopback host.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
async function browserInflate(bytes, maximum) {
  need(typeof DecompressionStream === 'function', 'Open this ZIP in a browser with native decompression, or export the full native plan as JSON.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), parts = [];
  let total = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      total += value.length;
      if (total > maximum) { await reader.cancel(); throw new Error('The expanded planning entry exceeds its complete declared length.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
/** Python's native digest retains integer/float spellings from its original JSON.
 * The syntax tree preserves those spellings while ordering object keys by Unicode
 * code point, matching ensure_ascii=False, sort_keys=True in the SF47 workspace.
 */
export function parseNativeJson(input) {
  need(typeof input === 'string', 'Read complete native JSON text.');
  let offset = 0, nodes = 0;
  const whitespace = () => { while (/[ \t\n\r]/.test(input[offset] || '') && offset < input.length) offset++; };
  function value(depth = 0) {
    whitespace(); need(depth <= 128 && ++nodes <= 2000000, 'The planning JSON exceeds its receiving depth or size.');
    const start = offset, char = input[offset];
    if (char === '"') {
      offset++; let escaped = false;
      while (offset < input.length) {
        const next = input[offset++];
        if (!escaped && next === '"') return {kind: 'scalar', value: JSON.parse(input.slice(start, offset))};
        if (!escaped && next === '\\') escaped = true; else escaped = false;
      }
      throw new Error('Complete the native JSON string.');
    }
    if (char === '{') {
      offset++; whitespace(); const entries = [], object = Object.create(null), keys = new Set();
      if (input[offset] !== '}') for (;;) {
        need(input[offset] === '"', 'Retain valid native object keys.');
        const key = value(depth + 1).value;
        need(!keys.has(key), 'Native planning JSON contains a duplicate key: ' + key); keys.add(key);
        whitespace(); need(input[offset++] === ':', 'Retain complete native JSON fields.');
        const child = value(depth + 1); entries.push([key, child]); object[key] = child.value;
        whitespace(); if (input[offset] === '}') break;
        need(input[offset++] === ',', 'Retain complete native JSON objects.'); whitespace();
      }
      need(input[offset++] === '}', 'Retain complete native JSON objects.');
      return {kind: 'object', entries, value: object};
    }
    if (char === '[') {
      offset++; whitespace(); const items = [];
      if (input[offset] !== ']') for (;;) {
        items.push(value(depth + 1)); whitespace(); if (input[offset] === ']') break;
        need(input[offset++] === ',', 'Retain complete native JSON lists.'); whitespace();
      }
      need(input[offset++] === ']', 'Retain complete native JSON lists.');
      return {kind: 'array', items, value: items.map(x => x.value)};
    }
    for (const literal of ['true', 'false', 'null']) if (input.startsWith(literal, offset)) {
      offset += literal.length; return {kind: 'scalar', value: JSON.parse(literal)};
    }
    const match = input.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    need(match, 'Retain valid native JSON values.');
    offset += match[0].length;
    const number = Number(match[0]); need(Number.isFinite(number), 'Native JSON numbers must be finite.');
    return {kind: 'number', raw: match[0], value: number};
  }
  const result = value(); whitespace(); need(offset === input.length, 'Retain one complete native JSON document.');
  return result;
}
function keyOrder(a, b) {
  const left = Array.from(a, c => c.codePointAt(0)), right = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
export function nativeCanonical(node) {
  if (node.kind === 'number') return node.raw;
  if (node.kind === 'array') return '[' + node.items.map(nativeCanonical).join(',') + ']';
  if (node.kind === 'object') return '{' + [...node.entries].sort((a, b) => keyOrder(a[0], b[0]))
    .map(([key, child]) => JSON.stringify(key) + ':' + nativeCanonical(child)).join(',') + '}';
  return JSON.stringify(node.value);
}
function child(node, key) {
  const result = node.kind === 'object' && node.entries.find(x => x[0] === key)?.[1];
  need(result, 'Retain the native ' + key + ' field.'); return result;
}
async function verifyRevision(node, digest, encode) {
  const plan = node.value, scenario = child(node, 'scenario'), planning = child(node, 'planning');
  const content = '{"planning":' + nativeCanonical(planning) + ',"scenario":' + nativeCanonical(scenario) + '}';
  need(await digest(encode(content)) === plan.contentSha256, 'The saved plan differs from its original native content digest.');
  need(await digest(encode(nativeCanonical(scenario))) === plan.report?.scenarioSha256,
    'The retained calculation belongs to a different native scenario.');
  return plan;
}
const crcTable = Array.from({length: 256}, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Read the native export directly in memory; no file is extracted to a path. */
export async function readPlanningZip(bytes, {inflate = browserInflate, decode = decoder} = {}) {
  need(bytes instanceof Uint8Array && bytes.length <= MAX_PLAN_BYTES, 'Open a complete planning ZIP no larger than 32 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  need(end >= 0, 'Open the complete native planning ZIP.');
  need(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'Open the original single-file ZIP export.');
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true), central = view.getUint32(end + 16, true);
  need(count === ENTRIES.length && view.getUint16(end + 8, true) === count && central + centralSize === end,
    'Choose the complete SF47 planning export containing workspace.json and its original manifest.');
  let offset = central, total = 0; const records = [], names = new Set(), ranges = [];
  for (let i = 0; i < count; i++) {
    need(offset + 46 <= end && view.getUint32(offset, true) === 0x02014b50, 'Retain the complete ZIP directory.');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true),
      crc = view.getUint32(offset + 16, true), packed = view.getUint32(offset + 20, true),
      size = view.getUint32(offset + 24, true), nameSize = view.getUint16(offset + 28, true),
      extraSize = view.getUint16(offset + 30, true), commentSize = view.getUint16(offset + 32, true),
      disk = view.getUint16(offset + 34, true), local = view.getUint32(offset + 42, true);
    need(offset + 46 + nameSize + extraSize + commentSize <= end, 'Retain the complete ZIP entry.');
    const name = decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    need(ENTRIES.includes(name) && !names.has(name), 'Use the complete original planning entry set.'); names.add(name);
    need(!(flags & 1) && [0, 8].includes(method) && disk === 0, 'Use the native unencrypted planning export.');
    total += size; need(total <= MAX_PLAN_BYTES && packed <= MAX_PLAN_BYTES, 'Expanded planning source exceeds 32 MiB.');
    need(local + 30 <= central && view.getUint32(local, true) === 0x04034b50, 'Retain the original ZIP entry header.');
    const localFlags = view.getUint16(local + 6, true), localMethod = view.getUint16(local + 8, true),
      localNameSize = view.getUint16(local + 26, true), localExtraSize = view.getUint16(local + 28, true);
    const data = local + 30 + localNameSize + localExtraSize;
    need(localFlags === flags && localMethod === method && data + packed <= central &&
      decode(bytes.subarray(local + 30, local + 30 + localNameSize)) === name, 'ZIP entry metadata differs from its original directory.');
    if (!(flags & 8)) need(view.getUint32(local + 14, true) === crc && view.getUint32(local + 18, true) === packed &&
      view.getUint32(local + 22, true) === size, 'Retain matching native ZIP entry lengths.');
    ranges.push([local, data + packed]); records.push({name, method, crc, packed, size, data});
    offset += 46 + nameSize + extraSize + commentSize;
  }
  need(offset === end && names.size === ENTRIES.length, 'Retain the complete original ZIP directory.');
  ranges.sort((a, b) => a[0] - b[0]);
  need(ranges.every((x, i) => !i || x[0] >= ranges[i - 1][1]), 'Keep the original separate ZIP entries.');
  const files = new Map();
  for (const record of records) {
    const compressed = bytes.subarray(record.data, record.data + record.packed);
    const content = record.method === 0 ? new Uint8Array(compressed) : await inflate(compressed, record.size);
    need(content instanceof Uint8Array && content.length === record.size && crc32(content) === record.crc,
      'The native ZIP entry is incomplete: ' + record.name);
    files.set(record.name, content);
  }
  return files;
}
export async function receivePlanningFile(bytes, {
  filename = 'plan.json', receivedAt = new Date().toISOString(), digest = browserDigest,
  inflate = browserInflate, decode = decoder, encode = value => encoder().encode(value),
} = {}) {
  need(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_PLAN_BYTES, 'Open a complete SF47 planning file no larger than 32 MiB.');
  const zipped = bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4;
  let document;
  if (zipped) {
    const files = await readPlanningZip(bytes, {inflate, decode});
    const manifest = parseNativeJson(decode(files.get('MANIFEST.json'))).value;
    const expected = ENTRIES.filter(x => x !== 'MANIFEST.json');
    need(manifest.schema === PLAN_SCHEMA + '.bundle' && Array.isArray(manifest.files) && manifest.files.length === expected.length,
      'Retain the native planning manifest.');
    need(new Set(manifest.files.map(x => x.path)).size === expected.length &&
      manifest.files.every(x => expected.includes(x.path)), 'Retain every native manifest entry.');
    for (const entry of manifest.files) {
      const raw = files.get(entry.path);
      need(raw.length === entry.bytes && await digest(raw) === entry.sha256, 'The planning file differs from its manifest: ' + entry.path);
    }
    const tree = parseNativeJson(decode(files.get('workspace.json'))), workspace = tree.value;
    need(workspace.schema === PLAN_SCHEMA && Array.isArray(workspace.revisions) && workspace.revisions.length,
      'Retain the full original planning workspace.');
    const revisions = child(tree, 'revisions').items;
    for (let i = 0; i < revisions.length; i++) {
      need(revisions[i].value.revision === i + 1, 'Retain consecutive original native revisions.');
      await verifyRevision(revisions[i], digest, encode);
      need(revisions[i].value.source.sha256 === workspace.plan?.source?.sha256, 'Keep revisions with their original scenario source.');
    }
    const original = files.get('original-source.json');
    need(await digest(original) === workspace.plan?.source?.sha256, 'Retain the exact original imported scenario bytes.');
    const originalTree = parseNativeJson(decode(original));
    need(nativeCanonical(originalTree) === nativeCanonical(child(child(tree, 'plan'), 'originalScenario')),
      'The parsed scenario differs from the retained original source.');
    const current = revisions[revisions.length - 1];
    for (const [path, node] of [
      ['scenario.json', child(current, 'scenario')], ['planning.json', child(current, 'planning')],
      ['original-model.json', child(child(current, 'report'), 'originalModel')],
      ['delivery-plan.json', child(child(current, 'report'), 'deliveryPlan')],
    ]) need(nativeCanonical(parseNativeJson(decode(files.get(path)))) === nativeCanonical(node),
      'The current native export projection differs from its retained revision: ' + path);
    document = {id: workspace.plan.id, name: workspace.plan.name, currentRevision: current.value.revision,
      revisions: revisions.map(x => x.value)};
  } else {
    const tree = parseNativeJson(decode(bytes)), plan = await verifyRevision(tree, digest, encode);
    document = {id: plan.id, name: plan.name, currentRevision: plan.revision, revisions: [plan]};
  }
  validatePlanDocument(document);
  return {schema: PLAN_SOURCE_SCHEMA, kind: zipped ? 'zip' : 'json', filename, receivedAt,
    bytes: bytes.length, sha256: await digest(bytes), base64: encodeBase64(bytes), document};
}
export async function verifyPlanningSource(source, options = {}) {
  const bytes = decodeBase64(source.base64);
  const received = await receivePlanningFile(bytes, {...options, filename: source.filename, receivedAt: source.receivedAt});
  need(received.bytes === source.bytes && received.sha256 === source.sha256 && received.kind === source.kind &&
    JSON.stringify(received.document) === JSON.stringify(source.document), 'Reopen the complete original planning edition; its retained content differs.');
  return source;
}
