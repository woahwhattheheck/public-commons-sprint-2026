// MIT. Original EBS 12.2 WADL selection and retained, resumable GET extraction.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  sha256, fault, fingerprint, integer, now, sourceUrl, fetchSource, retainSource,
  atomicWrite, readVerifiedSource, maybeJson, writeJson, writeProjection,
  withCaptureLock, reopenCapture, fileInside
} from './common.mjs';

export const EBS_REST_SOURCE = 'https://docs.oracle.com/cd/E26401_01/doc.122/e20927/T511473T669558.htm';
export const EBS_WADL_SOURCE = 'https://docs.oracle.com/cd/E26401_01/doc.122/e20927/T511473T516919.htm';
export const EBS_CONTEXT_PARAMETERS = ['ctx_responsibility', 'ctx_respapplication', 'ctx_securitygroup', 'ctx_nlslanguage', 'ctx_orgid'];
const identity = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_$#]*$/.test(value);
const asArray = value => value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];

function authorization(credentials, environment) {
  if (!credentials?.usernameEnv || !credentials?.passwordEnv) throw fault('EBS_CREDENTIAL_REFERENCES_REQUIRED', 'Select the environment variable names for the approved EBS account');
  for (const name of [credentials.usernameEnv, credentials.passwordEnv]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !environment[name]) throw fault('EBS_CREDENTIAL_UNAVAILABLE', 'A configured EBS credential environment variable is unavailable');
  }
  const username = environment[credentials.usernameEnv], password = environment[credentials.passwordEnv];
  if (username.includes(':') || /[\r\n]/.test(username)) throw fault('EBS_USERNAME_INVALID', 'Basic-auth username cannot contain a colon or line break');
  return 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64');
}
function parseWadl(bytes, { python = 'python3', signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [fileURLToPath(new URL('./wadl.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], signal });
    const output = [], errors = []; let count = 0;
    child.stdout.on('data', chunk => { count += chunk.length; if (count > 4 * 1024 * 1024) { child.kill(); reject(fault('WADL_RESULT_TOO_LARGE', 'WADL inspection output exceeds its limit')); } else output.push(chunk); });
    child.stderr.on('data', chunk => { if (errors.reduce((sum, item) => sum + item.length, 0) < 65536) errors.push(chunk); });
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => {
      let result;
      try { result = JSON.parse(Buffer.concat(output).toString('utf8')); }
      catch { reject(fault('WADL_INSPECTION_FAILED', 'The XML inspector did not return its document result')); return; }
      if (code !== 0 || result.error) reject(fault('WADL_INVALID', result.error || 'WADL inspection failed'));
      else resolve(result);
    });
    child.stdin.end(bytes);
  });
}
export async function inspectEbsWadl({ wadlFile, wadlText, python, signal }) {
  if (Boolean(wadlFile) === (wadlText !== undefined)) throw fault('WADL_INPUT_REQUIRED', 'Select exactly one original wadlFile or wadlText');
  const bytes = wadlFile ? await fs.readFile(wadlFile) : Buffer.from(wadlText);
  if (bytes.length > 2 * 1024 * 1024) throw fault('WADL_TOO_LARGE', 'WADL inspection is limited to 2 MiB');
  const result = await parseWadl(bytes, { python, signal });
  return { ...result, source: { ...(wadlFile ? { file: path.resolve(wadlFile) } : {}), sha256: sha256(bytes), bytes: bytes.length }, documentation: EBS_WADL_SOURCE };
}
export async function downloadEbsWadl({ wadlUrl, destination, approvedOrigin, credentials, environment = process.env, signal, fetchImpl = fetch }) {
  if (!approvedOrigin || !path.isAbsolute(destination)) throw fault('EBS_SOURCE_SELECTION_REQUIRED', 'Select the approved origin and an absolute WADL destination');
  const url = sourceUrl(wadlUrl, approvedOrigin);
  const source = await fetchSource(url, { signal, fetchImpl, maxBytes: 2 * 1024 * 1024,
    headers: { Accept: 'application/vnd.sun.wadl+xml, application/xml', Authorization: authorization(credentials, environment) } });
  if (!source.ok) throw fault('EBS_WADL_HTTP_ERROR', `Selected WADL returned HTTP ${source.receipt.status}`);
  await parseWadl(source.bytes, { signal });
  await atomicWrite(destination, source.bytes); await writeJson(destination + '.receipt.json', source.receipt);
  return inspectEbsWadl({ wadlFile: destination, signal });
}
export function ebsResponseRows(body, recordKey) {
  const envelope = body?.OutputParameters, summary = envelope?.Summary;
  if (!envelope || !summary) throw fault('EBS_RESPONSE_SCHEMA_CHANGED', 'Expected the native OutputParameters/Summary response');
  const rows = [];
  for (const output of asArray(envelope.Result?.Output)) {
    if (!output || typeof output !== 'object' || !(recordKey in output)) throw fault('EBS_RECORD_KEY_CHANGED', `Native response does not declare the selected ${recordKey} record`);
    for (const row of asArray(output[recordKey])) {
      if (!row || Array.isArray(row) || typeof row !== 'object') throw fault('EBS_RECORD_INVALID', 'Native interface record is not an object');
      rows.push(row);
    }
  }
  return { rows, summary };
}
function rowIdentity(row, keys) {
  const values = keys.map(key => {
    const value = row[key];
    if (value === null || value === undefined || typeof value === 'object' || value === '') throw fault('EBS_RECORD_KEY_MISSING', `Native identity field ${key} is empty or non-scalar`);
    return String(value);
  });
  return JSON.stringify(values);
}
async function* capturedRows(directory, manifest) {
  for (const page of manifest.pages) {
    const { rows } = ebsResponseRows(await readVerifiedSource(directory, page), manifest.config.recordKey);
    for (const row of rows) yield {
      record: Object.fromEntries(manifest.columns.map(column => [column, row[column] ?? null])),
      source: { key: rowIdentity(row, manifest.config.keyFields), page: page.file, pageSha256: page.sha256, offset: page.offset }
    };
  }
}
export async function reopenEbsCapture(directory) {
  const manifest = await reopenCapture(directory);
  if (manifest.schema !== 'tjl.oracle-ebs-capture.v1') throw fault('EBS_CAPTURE_SCHEMA', 'This directory is not an EBS capture');
  if (sha256(await fs.readFile(fileInside(directory, manifest.wadl.file))) !== manifest.wadl.sha256) throw fault('CAPTURE_HASH_MISMATCH', 'Retained WADL changed');
  return manifest;
}
export async function captureEbsInterface({
  directory, wadlFile, resourcePath, endpointOverride, approvedOrigin, recordKey,
  select, keyFields, filter = '', sort, context = {}, credentials,
  pageSize = 200, maxRecords = 1000000, maxResponseBytes = 32 * 1024 * 1024,
  resume = true, environment = process.env, signal, onProgress = () => {}, fetchImpl = fetch
}) {
  if (!approvedOrigin || !identity(recordKey) || typeof resourcePath !== 'string' || !resourcePath) throw fault('EBS_SELECTION_REQUIRED', 'Select the approved origin, native WADL resource and exact record element name');
  if (!Array.isArray(select) || !select.length || select.some(name => !identity(name)) || new Set(select).size !== select.length) throw fault('EBS_SELECT_REQUIRED', 'Select a unique list of original scalar column names');
  if (!Array.isArray(keyFields) || !keyFields.length || keyFields.some(name => !select.includes(name)) || new Set(keyFields).size !== keyFields.length) throw fault('EBS_KEYS_REQUIRED', 'Select native unique identity fields from the projected columns');
  if (typeof sort !== 'string' || !sort.trim() || typeof filter !== 'string') throw fault('EBS_ORDER_REQUIRED', 'Supply the approved native sort expression and optional filter; no ordering syntax is inferred');
  pageSize = integer(pageSize, 'pageSize', 1, 10000); maxRecords = integer(maxRecords, 'maxRecords', 1, 10000000);
  const inspection = await inspectEbsWadl({ wadlFile, signal });
  const candidates = inspection.resources.filter(resource => resource.path === resourcePath || resource.endpoint === resourcePath || resource.id === resourcePath);
  if (candidates.length !== 1) throw fault('EBS_RESOURCE_SELECTION', 'Select exactly one resource path or ID from the inspected WADL');
  const resource = candidates[0], method = resource.methods.find(item => item.name === 'GET');
  if (!method || !method.responseTypes.some(type => type.toLowerCase().split(';')[0] === 'application/json')) throw fault('EBS_JSON_GET_UNAVAILABLE', 'The selected WADL resource does not advertise JSON GET');
  const endpoint = sourceUrl(endpointOverride || resource.endpoint, approvedOrigin);
  if (endpoint.search || /[{}]/.test(endpoint.href)) throw fault('EBS_ENDPOINT_UNRESOLVED', 'Select an exact native resource endpoint without query or path placeholders');
  const parameters = method.parameters.filter(item => item.style === 'query');
  const supported = new Set(parameters.map(item => item.name));
  for (const name of ['select', 'offset', 'limit', 'sort', ...(filter ? ['filter'] : []), ...Object.keys(context)]) if (!supported.has(name)) throw fault('EBS_QUERY_NOT_DECLARED', `The selected WADL GET does not declare ${name}`);
  for (const [name, value] of Object.entries(context)) {
    if (!EBS_CONTEXT_PARAMETERS.includes(name) || typeof value !== 'string' || !value.trim()) throw fault('EBS_CONTEXT_INVALID', 'Use the exact declared EBS context query names and nonempty text values');
    if (name === 'ctx_orgid') integer(value, 'ctx_orgid', 0, 2147483647);
  }
  const requested = { select: select.join(','), sort, ...(filter ? { filter } : {}), ...context, offset: '0', limit: String(pageSize) };
  for (const parameter of parameters) {
    if (parameter.required === 'true' && requested[parameter.name] === undefined && parameter.default === undefined && parameter.fixed === undefined) throw fault('EBS_REQUIRED_QUERY', `Selected WADL requires ${parameter.name}`);
    if (parameter.fixed !== undefined && requested[parameter.name] !== undefined && requested[parameter.name] !== parameter.fixed) throw fault('EBS_FIXED_QUERY', `Selected WADL fixes ${parameter.name} to another value`);
  }
  const config = { endpoint: String(endpoint), wadlSha256: inspection.source.sha256, resourcePath: resource.path,
    declaredEndpoint: resource.endpoint, recordKey, select, keyFields, filter, sort, context,
    credentials: { usernameEnv: credentials?.usernameEnv, passwordEnv: credentials?.passwordEnv }, pageSize, maxRecords };
  const configSha256 = fingerprint(config);
  return withCaptureLock(directory, async () => {
    const filename = path.join(directory, 'capture.json'); let manifest = await maybeJson(filename);
    if (manifest && (!resume || manifest.configSha256 !== configSha256)) throw fault('CAPTURE_CONFIG_MISMATCH', 'Use a new directory for a changed EBS selection');
    if (manifest?.status === 'complete') return reopenEbsCapture(directory);
    if (!manifest) {
      const raw = await fs.readFile(wadlFile);
      if (sha256(raw) !== inspection.source.sha256) throw fault('WADL_CHANGED', 'Selected WADL changed between inspection and capture');
      await atomicWrite(fileInside(directory, 'source/interface.wadl'), raw);
      manifest = { schema: 'tjl.oracle-ebs-capture.v1', config, configSha256, columns: select, pages: [],
        wadl: { file: 'source/interface.wadl', sha256: sha256(raw) }, startedAt: now(), status: 'capturing', documentation: [EBS_REST_SOURCE, EBS_WADL_SOURCE] };
    }
    const checkpoint = async () => { manifest.updatedAt = now(); await writeJson(filename, manifest); };
    try {
      manifest.status = 'capturing'; delete manifest.error; await checkpoint();
      if (sha256(await fs.readFile(fileInside(directory, manifest.wadl.file))) !== manifest.wadl.sha256) throw fault('CAPTURE_HASH_MISMATCH', 'Retained WADL changed');
      let offset = 0; const seen = new Set();
      for (const page of manifest.pages) {
        const native = ebsResponseRows(await readVerifiedSource(directory, page), recordKey);
        if (page.offset !== offset || native.rows.length !== page.count) throw fault('EBS_CHECKPOINT_CHANGED', 'Retained page counts or offsets changed');
        for (const row of native.rows) { const key = rowIdentity(row, keyFields); if (seen.has(key)) throw fault('EBS_DUPLICATE_RECORD', 'Retained identity occurs more than once'); seen.add(key); }
        offset += page.count;
      }
      await onProgress({ stage: 'capture', completed: offset, total: manifest.totalCount ?? null });
      while (manifest.totalCount === undefined || offset < manifest.totalCount) {
        signal?.throwIfAborted();
        const url = new URL(endpoint); url.search = new URLSearchParams({ ...requested, offset: String(offset) }).toString();
        const source = await retainSource(directory, `source/page-${String(manifest.pages.length).padStart(6, '0')}.json`,
          await fetchSource(url, { signal, fetchImpl, maxBytes: maxResponseBytes, headers: { Accept: 'application/json', Authorization: authorization(credentials, environment) } }));
        const { rows, summary } = ebsResponseRows(source.body, recordKey);
        const nativeOffset = integer(summary.Offset, 'Summary.Offset'), count = integer(summary.GetCount, 'Summary.GetCount'), total = integer(summary.TotalCount, 'Summary.TotalCount');
        if (total > maxRecords) throw fault('SOURCE_RECORD_LIMIT', `EBS reports ${total} records; selected maxRecords is ${maxRecords}`);
        if (manifest.totalCount !== undefined && total !== manifest.totalCount) throw fault('EBS_SOURCE_COUNT_CHANGED', 'The source population changed during paging; accepted pages remain retained for review', { before: manifest.totalCount, after: total, offset });
        if (nativeOffset !== offset || count !== rows.length || count > pageSize || offset + count > total || (!count && offset < total)) throw fault('EBS_PAGING_MISMATCH', 'Native Summary offsets/counts do not describe a progressing complete page', { offset, nativeOffset, count, rows: rows.length, total });
        for (const row of rows) {
          for (const column of select) if (!(column in row) || (row[column] !== null && typeof row[column] === 'object')) throw fault('EBS_COLUMN_CHANGED', `Selected scalar column ${column} is missing or structured`);
          const key = rowIdentity(row, keyFields); if (seen.has(key)) throw fault('EBS_DUPLICATE_RECORD', 'Native key occurs in multiple records; select the correct grain or review source changes', { offset }); seen.add(key);
        }
        manifest.totalCount = total;
        manifest.pages.push({ file: source.file, encoding: source.encoding, sha256: source.receipt.sha256, bytes: source.receipt.bytes,
          retrievedAt: source.receipt.retrievedAt, offset, count, total, summary });
        offset += count; await checkpoint(); await onProgress({ stage: 'capture', completed: offset, total });
      }
      manifest.projection = await writeProjection({ directory, columns: select, rows: capturedRows(directory, manifest) });
      manifest.consistency = { kind: 'native-summary-and-unique-key-pages', records: seen.size, totalCount: manifest.totalCount,
        transactionalSnapshot: false, limitation: 'The native GET paging interface does not establish a transaction snapshot. Stable totals and unique keys cannot exclude in-place edits; retain the selected source window and each response time.' };
      manifest.status = 'complete'; manifest.completedAt = now(); await checkpoint();
      await onProgress({ stage: 'complete', completed: offset, total: manifest.totalCount }); return manifest;
    } catch (error) {
      manifest.status = signal?.aborted ? 'cancelled' : 'interrupted';
      manifest.error = { code: error.code || error.name || 'EBS_CAPTURE_FAILED', message: error.message, details: error.details || {} };
      await checkpoint(); throw error;
    }
  });
}
