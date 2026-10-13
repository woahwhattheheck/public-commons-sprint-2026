#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ORIGIN = 'https://veqix61rpf.execute-api.us-east-1.amazonaws.com';
const CONTRACT = 'https://www.jsonsupport.com/developers.html';
const RESERVED = new Set(['operation.json', 'request.json', 'original-input.json', 'original-input.csv', 'original-input.xlsx', 'response-error.txt']);
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const now = () => new Date().toISOString();
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const recordArray = value => Array.isArray(value) && value.every(plainObject);

export function help() {
  return [
    'JSON Support conversion adapter — Node 22+',
    '',
    'node conversion-adapter.mjs to-xlsx --input records.json --output-dir NEW_DIRECTORY',
    '  [--input-shape records|envelope] [--output-name converted.xlsx]',
    'node conversion-adapter.mjs to-json --format xlsx|csv --input source.xlsx --output-dir NEW_DIRECTORY',
    '  [--output-name converted.json]',
    '',
    'Both commands: [--timeout-seconds 180] [--max-input-mib 32] [--max-response-mib 64]',
    'Set JSON_SUPPORT_API_KEY in the environment through your existing secret manager.',
    'The directory must not exist. One request is sent; no retries or redirects.',
    'Original bytes, exact request, output and operation.json are retained in that directory.',
    'records accepts an array of objects or one object. envelope accepts only {"data":[...]}',
    'Exit 0: validated conversion saved. Exit 1: failed or uncertain, inspect operation.json.',
    'Exit 2: local arguments/input/configuration failed before the request.',
    '',
    'These commands send the input to the vendor API. The separate browser converter is local.',
    'Published contract: ' + CONTRACT
  ].join('\n');
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv[0] === 'help') return { help: true };
  const direction = argv[0];
  if (!['to-xlsx', 'to-json'].includes(direction)) throw new Error('Choose to-xlsx or to-json.');
  const allowed = new Set(['input', 'output-dir', 'output-name', 'input-shape', 'format', 'timeout-seconds', 'max-input-mib', 'max-response-mib']);
  const flags = {};
  for (let i = 1; i < argv.length; i += 2) {
    const name = argv[i];
    if (!name?.startsWith('--') || !allowed.has(name.slice(2)) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error('Unknown option or missing value; use --help.');
    const key = name.slice(2);
    if (Object.hasOwn(flags, key)) throw new Error('Duplicate option: --' + key);
    flags[key] = argv[i + 1];
  }
  if (!flags.input || !flags['output-dir']) throw new Error('--input and --output-dir are required.');
  if (direction === 'to-xlsx' && flags.format) throw new Error('to-xlsx reads JSON; use --input-shape for records or envelope.');
  if (direction === 'to-json' && flags['input-shape']) throw new Error('--input-shape applies only to to-xlsx.');
  const format = direction === 'to-xlsx' ? 'json' : flags.format;
  if (!['json', 'xlsx', 'csv'].includes(format) || (direction === 'to-json' && format === 'json')) throw new Error('to-json requires --format xlsx or --format csv.');
  const inputShape = flags['input-shape'] || 'records';
  if (!['records', 'envelope'].includes(inputShape)) throw new Error('--input-shape must be records or envelope.');
  const outputName = flags['output-name'] || (direction === 'to-xlsx' ? 'converted.xlsx' : 'converted.json');
  const wantedExt = direction === 'to-xlsx' ? '.xlsx' : '.json';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(outputName) || !outputName.toLowerCase().endsWith(wantedExt) || RESERVED.has(outputName.toLowerCase())) throw new Error('--output-name must be a simple new ' + wantedExt + ' filename and must not use a reserved source/result name.');
  const positive = (name, fallback) => {
    const n = Number(flags[name] ?? fallback);
    if (!Number.isFinite(n) || n <= 0) throw new Error('--' + name + ' must be a positive number.');
    return n;
  };
  const timeoutMs = Math.ceil(positive('timeout-seconds', 180) * 1000);
  const maxInputBytes = Math.floor(positive('max-input-mib', 32) * 1024 * 1024);
  const maxResponseBytes = Math.floor(positive('max-response-mib', 64) * 1024 * 1024);
  if (![timeoutMs, maxInputBytes, maxResponseBytes].every(Number.isSafeInteger) || timeoutMs > 2147483647 || maxInputBytes < 1 || maxResponseBytes < 1) throw new Error('Local limits are outside the supported numeric range.');
  return { direction, format, inputShape, input: flags.input, outputDir: flags['output-dir'], outputName, timeoutMs, maxInputBytes, maxResponseBytes };
}

export function buildRequest(options, bytes) {
  if (options.direction === 'to-xlsx') {
    // Parse for shape only. Embed original text to preserve large integers and decimals.
    let text = utf8(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('Input is not valid JSON. The original file is unchanged.'); }
    let body;
    if (options.inputShape === 'envelope') {
      if (!plainObject(value) || Object.keys(value).length !== 1 || !recordArray(value.data)) throw new Error('Envelope input must contain only data: an array of objects.');
      body = text;
    } else {
      if (!plainObject(value) && !recordArray(value)) throw new Error('Records input must be one JSON object or an array of objects.');
      body = '{"data":' + (Array.isArray(value) ? text : '[' + text + ']') + '}';
    }
    return { url: ORIGIN + '/dev/v1/convert', body: Buffer.from(body, 'utf8'), inputRows: Array.isArray(value) ? value.length : options.inputShape === 'envelope' ? value.data.length : 1 };
  }
  if (options.format === 'xlsx') assertXlsx(bytes, options.maxInputBytes);
  const file = options.format === 'xlsx' ? bytes.toString('base64') : utf8(bytes);
  return { url: ORIGIN + '/dev/v1/excel-to-json', body: Buffer.from(JSON.stringify({ format: options.format, file }), 'utf8'), inputRows: null };
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function assertXlsx(bytes, maxXmlBytes = 64 * 1024 * 1024) {
  if (bytes.length < 22) throw new Error('XLSX response/input is not a complete ZIP workbook.');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { eocd = i; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) throw new Error('XLSX must be a complete single-disk ZIP workbook.');
  const entries = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  let at = bytes.readUInt32LE(eocd + 16);
  const directoryStart = at;
  if (entries === 0xffff || directorySize === 0xffffffff || at === 0xffffffff) throw new Error('ZIP64 workbook is not supported by this local adapter.');
  if (bytes.readUInt16LE(eocd + 8) !== entries || at + directorySize !== eocd) throw new Error('XLSX central directory is incomplete.');
  const end = at + directorySize, members = new Map(), extents = [];
  for (let i = 0; i < entries; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid XLSX central directory entry.');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16), compressedSize = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42), next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end || bytes.readUInt16LE(at + 34) !== 0) throw new Error('Truncated or multi-disk XLSX member.');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength), name = nameBytes.toString('utf8');
    if (members.has(name)) throw new Error('Duplicate XLSX archive member.');
    if (flags & 1) throw new Error('Encrypted workbook is not accepted.');
    if ([compressedSize, size, local].includes(0xffffffff)) throw new Error('ZIP64 workbook is not supported by this local adapter.');
    if (local + 30 > directoryStart || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('XLSX member has no actual local header.');
    const localFlags = bytes.readUInt16LE(local + 6), localMethod = bytes.readUInt16LE(local + 8);
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressedSize;
    if (dataStart > directoryStart || dataEnd > directoryStart || localFlags !== flags || localMethod !== method) throw new Error('XLSX member data/header does not match its directory.');
    if (!bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) throw new Error('XLSX member names differ between headers.');
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressedSize || bytes.readUInt32LE(local + 22) !== size)) throw new Error('XLSX member size/checksum headers disagree.');
    members.set(name, { method, crc, compressedSize, size, dataStart, dataEnd });
    extents.push({ start: local, end: dataEnd });
    at = next;
  }
  if (at !== end) throw new Error('XLSX directory size differs.');
  extents.sort((a,b) => a.start - b.start);
  if (extents.some((v,i) => i && v.start < extents[i-1].end)) throw new Error('XLSX member data overlaps.');
  const required = [['[Content_Types].xml', 'Types'], ['xl/workbook.xml', 'workbook']];
  let totalXml = 0;
  for (const [name, root] of required) {
    const m = members.get(name);
    if (!m || m.size === 0 || m.size > maxXmlBytes - totalXml) throw new Error('Required workbook XML is missing, empty or above the local decompression limit.');
    const compressed = bytes.subarray(m.dataStart, m.dataEnd);
    let raw;
    if (m.method === 0) raw = compressed;
    else if (m.method === 8) raw = inflateRawSync(compressed, { maxOutputLength: m.size });
    else throw new Error('Required workbook XML uses an unsupported ZIP compression method.');
    if (raw.length !== m.size || crc32(raw) !== m.crc) throw new Error('Actual workbook member bytes/checksum differ.');
    totalXml += raw.length;
    const xml = utf8(raw);
    const rootPattern = new RegExp('<(?:[A-Za-z_][\\w.-]*:)?' + root + '(?:\\s|/?>)');
    if (!rootPattern.test(xml)) throw new Error('Required XLSX part has no expected XML root.');
  }
  return { kind: 'xlsx', check: 'local_headers_directory_required_xml_bytes_crc', verified_parts: required.map(([name]) => name) };
}

export function validateResult(direction, bytes, maxXmlBytes = 64 * 1024 * 1024) {
  if (direction === 'to-xlsx') return assertXlsx(bytes, maxXmlBytes);
  const parsed = JSON.parse(utf8(bytes));
  if (!plainObject(parsed) || !recordArray(parsed.data)) throw new Error('Vendor JSON must contain data: an array of row objects.');
  return { kind: 'json', check: 'data_array_of_objects', rows: parsed.data.length };
}

export function makeRedactor(key) {
  const tokens = [...new Set([key, encodeURIComponent(key), Buffer.from(key, 'utf8').toString('base64'), JSON.stringify(key).slice(1, -1)])].filter(Boolean).sort((a, b) => b.length - a.length);
  return value => {
    let text = String(value);
    for (const token of tokens) text = text.split(token).join('[REDACTED]');
    // Suppress labeled credential values even if a provider uses a different token.
    return text.replace(/("(?:x-api-key|api[_-]?key|authorization|access[_-]?token|secret)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"');
  };
}

async function readResponse(response, maxBytes) {
  if (!response.body) return { bytes: Buffer.alloc(0), complete: true, error: null };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      const room = maxBytes - total;
      if (chunk.length > room) {
        if (room > 0) { chunks.push(chunk.subarray(0, room)); total += room; }
        await reader.cancel().catch(() => {});
        return { bytes: Buffer.concat(chunks, total), complete: false, error: 'Response exceeded the local byte limit.' };
      }
      chunks.push(chunk); total += chunk.length;
    }
    return { bytes: Buffer.concat(chunks, total), complete: true, error: null };
  } catch {
    return { bytes: Buffer.concat(chunks, total), complete: false, error: 'Response body interrupted; the captured prefix is retained.' };
  } finally { reader.releaseLock(); }
}

const describe = (filename, bytes, mediaType) => ({ filename, bytes: bytes.length, sha256: sha(bytes), media_type: mediaType });
async function writeNew(root, filename, bytes) {
  const handle = await fs.open(path.join(root, filename), 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function writeOperation(root, operation) {
  const temporary = '.operation-' + randomUUID() + '.json';
  await writeNew(root, temporary, Buffer.from(JSON.stringify(operation, null, 2) + '\n', 'utf8'));
  await fs.rename(path.join(root, temporary), path.join(root, 'operation.json'));
}

export async function convert(options, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required.');
  const key = env.JSON_SUPPORT_API_KEY;
  if (typeof key !== 'string' || !key.length || key.trim() !== key || /[\r\n]/.test(key)) throw new Error('JSON_SUPPORT_API_KEY must be set without surrounding whitespace or newlines.');
  const redact = makeRedactor(key);
  const inputPath = await fs.realpath(options.input);
  const stat = await fs.stat(inputPath);
  if (!stat.isFile() || stat.size > options.maxInputBytes) throw new Error('Input must be a regular file within --max-input-mib.');
  const original = await fs.readFile(inputPath);
  if (original.length > options.maxInputBytes) throw new Error('Input grew beyond --max-input-mib.');
  const request = buildRequest(options, original);
  const outputDir = path.resolve(options.outputDir);
  // Exclusive directory creation is the operation reservation; existing paths are refused.
  await fs.mkdir(outputDir, { mode: 0o700 });
  const sourceName = 'original-input.' + options.format;
  const operation = {
    schema: 'json-support.conversion-return/v1',
    operation_id: randomUUID(), status: 'preparing', direction: options.direction,
    created_at: now(), completed_at: null, contract_url: CONTRACT,
    request: { endpoint: request.url, method: 'POST', body: describe('request.json', request.body, 'application/json'), attempts: 0 },
    input: { ...describe(sourceName, original, options.format === 'xlsx' ? MIME_XLSX : options.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8'), original_filename: path.basename(inputPath), rows_if_known: request.inputRows },
    output: null, response: null, failure: null,
    local_limits: { timeout_ms: options.timeoutMs, input_bytes: options.maxInputBytes, response_bytes: options.maxResponseBytes }
  };
  let response;
  let captured;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Operator interrupted the request.'));
  let timer;
  const recordFailure = async (code, message, uncertain) => {
    operation.status = uncertain ? 'uncertain' : 'failed';
    operation.completed_at = now();
    operation.failure = { code, message: redact(message), automatic_retry: false, provider_may_have_processed: uncertain };
    if (captured) {
      const clean = Buffer.from(redact(captured.bytes.toString('utf8')), 'utf8');
      await writeNew(outputDir, 'response-error.txt', clean);
      operation.failure.response_body = {
        ...describe('response-error.txt', clean, 'text/plain; charset=utf-8'),
        original_captured_bytes: captured.bytes.length,
        original_captured_sha256: sha(captured.bytes),
        complete: captured.complete, credential_redacted: true,
        encoding_note: 'UTF-8 text with replacement for invalid bytes; original raw error bytes are not saved.'
      };
    }
    await writeOperation(outputDir, operation);
    return { exitCode: 1, outputDir, operation };
  };
  try {
    await writeNew(outputDir, sourceName, original);
    await writeNew(outputDir, 'request.json', request.body);
    operation.status = 'prepared';
    await writeOperation(outputDir, operation);
    operation.status = 'requesting';
    operation.request.attempts = 1;
    operation.request.started_at = now();
    await writeOperation(outputDir, operation);
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    timer = setTimeout(() => controller.abort(new Error('Request timeout.')), options.timeoutMs);
    response = await fetchImpl(request.url, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-api-key': key, accept: options.direction === 'to-xlsx' ? MIME_XLSX : 'application/json' },
      body: request.body, signal: controller.signal
    });
    operation.response = { status: response.status, ok: response.ok, received_at: now(), headers: {} };
    for (const name of ['content-type', 'retry-after', 'x-amzn-requestid', 'x-amz-apigw-id', 'date']) {
      const value = response.headers.get(name);
      if (value !== null) operation.response.headers[name] = redact(value);
    }
    captured = await readResponse(response, options.maxResponseBytes);
    if (!captured.complete) return await recordFailure('response_incomplete', captured.error, true);
    if (!response.ok) return await recordFailure('http_error', 'Provider returned HTTP ' + response.status + '. Inspect the retained redacted response and Retry-After, if present.', response.status >= 500);
    let validated;
    try { validated = validateResult(options.direction, captured.bytes, options.maxResponseBytes); }
    catch { return await recordFailure('invalid_success_body', 'Provider returned success with a body outside the documented output contract.', true); }
    await writeNew(outputDir, options.outputName, captured.bytes);
    operation.output = { ...describe(options.outputName, captured.bytes, options.direction === 'to-xlsx' ? MIME_XLSX : 'application/json'), validation: validated };
    operation.status = 'succeeded';
    operation.completed_at = now();
    await writeOperation(outputDir, operation);
    return { exitCode: 0, outputDir, operation };
  } catch (error) {
    const uncertain = operation.request.attempts > 0;
    try { return await recordFailure(uncertain ? 'request_or_save_interrupted' : 'local_preparation_failed', error?.message || 'Operation failed.', uncertain); }
    catch (saveError) {
      const failure = new Error('Operation could not save its final state in ' + redact(outputDir) + ': ' + redact(saveError?.message || 'local write failed') + '. Preserve the directory and inspect operation.json before a deliberate retry.');
      failure.exitCode = 1;
      throw failure;
    }
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) { console.log(help()); return 0; }
    const result = await convert(options);
    console.log(JSON.stringify({ status: result.operation.status, operation_id: result.operation.operation_id, output_directory: result.outputDir, result_file: path.join(result.outputDir, 'operation.json'), output: result.operation.output, failure: result.operation.failure }, null, 2));
    return result.exitCode;
  } catch (error) {
    const key = process.env.JSON_SUPPORT_API_KEY || '';
    const safe = key ? makeRedactor(key)(error?.message || 'Local error.') : (error?.message || 'Local error.');
    console.error('JSON Support: ' + safe);
    return error.exitCode || 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
