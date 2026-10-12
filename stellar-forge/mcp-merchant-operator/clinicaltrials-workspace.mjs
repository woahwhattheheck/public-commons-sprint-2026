// MIT. ClinicalTrials agent operations through the existing retained Python console.
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { MerchantSourceWorkspaces, sourceWorkspaceTools } from './source-workspace.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

export const CLINICALTRIALS_CONNECTION_SCHEMA = 'stellar-forge.clinicaltrials-workspace-connection.v1';
export const CLINICALTRIALS_APPLICATION_SCHEMA = 'stellar-forge.clinicaltrials-workspace.v1';
export const CLINICALTRIALS_EXPORT_SCHEMA = 'stellar-forge.clinicaltrials-mcp-export.v1';
export const CLINICALTRIALS_MANIFEST = 'clinicaltrials-export.json';
const SHA = /^[0-9a-f]{64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NCT = /^NCT[0-9]{8}$/;
const MAX_FILE = 256_000_000;
const MAX_JSON = 16 * 1024 * 1024;
const MAX_REQUEST = 128 * 1024;
const MAX_PRS = 64 * 1024 * 1024;
const FILE_KINDS = ['source', 'packet', 'prs'];
const PUBLISHER_KINDS = ['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'];
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))
  : Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : value);

function exact(value, keys, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key)))
    throw fail('INVALID_PARAMS', 'Supply the declared fields and every required field.');
}
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value))
    throw fail('INVALID_PARAMS', 'Use a valid ' + label + '.');
  return value;
}
function integer(value, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw fail('INVALID_PARAMS', 'Integer is outside its declared range.');
  return value;
}
function text(value, label, maximum = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw fail('INVALID_PARAMS', label + ' must be nonempty printable text.');
  return value;
}
function relativeName(value) {
  text(value, 'Retained filename', 512);
  if (value.startsWith('/') || /[\\:]/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    throw fail('INVALID_PARAMS', 'Choose an original declared relative filename.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw fail('CONFIGURATION_ERROR', 'Declare an original host file path.');
  return resolve(base, value);
}
async function fileHandle(path, maximum, privateFile = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum ||
        privateFile && process.platform !== 'win32' && (info.mode & 0o077))
      throw fail('CLINICALTRIALS_FILE_INVALID', 'Use an original regular file within its size and privacy limits.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function bytes(path, maximum, privateFile = false) {
  const { handle } = await fileHandle(path, maximum, privateFile);
  try {
    const data = await handle.readFile();
    if (data.length > maximum) throw fail('CLINICALTRIALS_FILE_INVALID', 'Selected file exceeded its original size limit.');
    return data;
  } finally { await handle.close(); }
}
async function fileSha(path, maximum, privateFile = false) {
  const { handle, info } = await fileHandle(path, maximum, privateFile);
  try {
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) digest.update(chunk);
    const after = await handle.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
      throw fail('CLINICALTRIALS_FILE_CHANGED', 'The selected source changed while reading its original identity.');
    return { bytes: info.size, sha256: digest.digest('hex') };
  } finally { await handle.close(); }
}
async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      process.platform !== 'win32' && (info.mode & 0o077))
    throw fail('CLINICALTRIALS_EXPORT_DIRECTORY_INVALID', 'Use the original private customer export directory.');
  return path;
}
async function existingPrivateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077))
    throw fail('CLINICALTRIALS_EXPORT_DIRECTORY_INVALID', 'Use the existing private retained delivery directory.');
  return path;
}
async function responseBytes(response, maximum) {
  const parts = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > maximum) throw fail('CLINICALTRIALS_RESPONSE_TOO_LARGE', 'Page the original result or retain its complete file.');
    parts.push(chunk);
  }
  return Buffer.concat(parts, length);
}
function page(items, { offset = 0, limit = 50, expectedSnapshot } = {}) {
  integer(offset, 0); integer(limit, 1, 250);
  const snapshot = sha(canonical(items));
  if (offset && expectedSnapshot === undefined)
    throw fail('CLINICALTRIALS_SNAPSHOT_REQUIRED', 'Continue the original page-zero inventory snapshot.');
  if (expectedSnapshot !== undefined && checked(expectedSnapshot, SHA, 'inventory snapshot') !== snapshot)
    throw fail('CLINICALTRIALS_INVENTORY_CHANGED', 'The saved inventory changed. Read a new page-zero snapshot.');
  if (offset > items.length) throw fail('INVALID_PARAMS', 'Offset exceeds the original inventory.');
  return { total: items.length, snapshot, offset, items: items.slice(offset, offset + limit),
    nextOffset: offset + limit < items.length ? offset + limit : null };
}

/** Host references attach the existing console; this adapter never opens a Python Workspace. */
export async function readClinicalTrialsWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(path, 1024 * 1024, true)));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== CLINICALTRIALS_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw fail('CONFIGURATION_ERROR', 'Declare 1–32 original ClinicalTrials consoles.');
  const workspaces = Object.create(null), base = dirname(path);
  for (const [alias, input] of Object.entries(raw.workspaces)) {
    checked(alias, ALIAS, 'workspace alias');
    exact(input, ['label', 'consoleUrlEnv', 'consoleUrlFile', 'files']);
    if ((input.consoleUrlEnv === undefined) === (input.consoleUrlFile === undefined))
      throw fail('CONFIGURATION_ERROR', 'Select exactly one private console URL file or environment reference.');
    if (input.files !== undefined && (!plain(input.files) || Object.keys(input.files).length > 128))
      throw fail('CONFIGURATION_ERROR', 'Declare up to 128 original source, PRS or receiving file handles.');
    const files = Object.create(null);
    for (const [alias, file] of Object.entries(input.files ?? {})) {
      checked(alias, ALIAS, 'file alias');
      exact(file, ['path', 'kind', 'name', 'label', 'sha256'], ['path', 'kind']);
      if (!FILE_KINDS.includes(file.kind)) throw fail('CONFIGURATION_ERROR', 'Use source, packet or prs file kind.');
      files[alias] = { path: hostPath(file.path, base), kind: file.kind,
        ...(file.name === undefined ? {} : { name: text(file.name, 'Source name') }),
        ...(file.label === undefined ? {} : { label: text(file.label, 'Source label') }),
        ...(file.sha256 === undefined ? {} : { sha256: checked(file.sha256, SHA, 'source SHA256') }) };
    }
    workspaces[alias] = { label: text(input.label ?? alias, 'Workspace label'), files,
      ...(input.consoleUrlEnv === undefined ? { consoleUrlFile: hostPath(input.consoleUrlFile, base) }
        : { consoleUrlEnv: checked(input.consoleUrlEnv, /^[A-Za-z_][A-Za-z0-9_]*$/, 'console URL environment name') }) };
  }
  return { schema: CLINICALTRIALS_CONNECTION_SCHEMA, workspaces };
}

const alias = { type: 'string', pattern: ALIAS.source };
const digest = { type: 'string', pattern: SHA.source };
const id = { type: 'string', minLength: 1, maxLength: 160 };
const selection = { workspace: alias };
const mutation = { ...selection, expectedRevision: { type: 'integer', minimum: 0 },
  requestId: { type: 'string', pattern: UUID.source } };
const pagination = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 },
  expectedSnapshot: digest };
const read = { readOnly: true, idempotent: true };
const actionNames = [
  'cohort.configure', 'version.inspect', 'capture.start', 'capture.select', 'capture.advance',
  'capture.resume', 'capture.pause', 'review.record', 'mapping.default', 'mapping.save',
  'edition.build', 'edition.compare', 'dataset.query', 'merchant.configure', 'package.export',
  'prs.candidate', 'prs.plan', 'prs.apply', 'prs.reconcile', 'prs.preview'
];
const originalTools = sourceWorkspaceTools((name, description, properties, required, annotations) =>
  ({ name, description, properties, required, annotations }));
const sourceNames = new Map(originalTools.map(value =>
  ['merchant_clinicaltrials_source_' + value.name.slice('merchant_source_'.length), value.name]));

export function clinicalTrialsWorkspaceTools(tool) {
  return [
    tool('merchant_clinicaltrials_workspaces', 'List the declared original ClinicalTrials consoles, file handles and active verified downloads.', {}, [], read),
    tool('merchant_clinicaltrials_status', 'Read the same original ClinicalTrials state, revision, cohort, captures, reviews, PRS and publishing history used by its browser.', selection, ['workspace'], read),
    tool('merchant_clinicaltrials_inventory', 'Page retained ClinicalTrials captures, reviews, PRS documents/plans/reconciliations or native source inventories at an exact snapshot.',
      { ...selection, kind: { type: 'string', enum: ['captures', 'reviews', 'prs', 'prsPlans', 'prsReconciliations', 'prsPreviews', 'exports', 'sources', 'plans', 'builds', 'comparisons'] }, ...pagination }, ['workspace', 'kind'], read),
    tool('merchant_clinicaltrials_capture', 'Inspect a retained provider capture and its original source pages, request, provider version and completeness.', { ...selection, captureId: id }, ['workspace', 'captureId'], read),
    tool('merchant_clinicaltrials_studies', 'Page the actual retained study cohort. Preserve the original capture and continue its returned offset; query searches the saved studies.',
      { ...selection, captureId: id, offset: pagination.offset, limit: pagination.limit, query: { type: 'string', maxLength: 200 } }, ['workspace', 'captureId'], read),
    tool('merchant_clinicaltrials_study', 'Read one complete original nested study, its NCT ID, exact JSON hash and source page.', { ...selection, captureId: id, nctId: { type: 'string', pattern: NCT.source } }, ['workspace', 'captureId', 'nctId'], read),
    tool('merchant_clinicaltrials_study_compare', 'Compare the same original NCT study across two retained capture editions.',
      { ...selection, beforeId: id, afterId: id, nctId: { type: 'string', pattern: NCT.source } }, ['workspace', 'beforeId', 'afterId', 'nctId'], read),
    tool('merchant_clinicaltrials_prs', 'Read a retained PRS document and original official-schema validation or candidate comparison.', { ...selection, documentId: id }, ['workspace', 'documentId'], read),
    tool('merchant_clinicaltrials_prs_plan', 'Read the complete frozen original PRS modernization plan.', { ...selection, planId: id }, ['workspace', 'planId'], read),
    tool('merchant_clinicaltrials_prs_reconciliation', 'Read the complete original typed PRS-to-study reconciliation and retained source decisions.', { ...selection, reportId: id }, ['workspace', 'reportId'], read),
    tool('merchant_clinicaltrials_prs_preview', 'Read the complete retained original full or partial PRS upload composition, selected documents and candidate report.', { ...selection, previewId: id }, ['workspace', 'previewId'], read),
    tool('merchant_clinicaltrials_prs_catalog', 'Read the maintained PRS engine catalog of source-bound protocol and results fields and original reconciliation rules.', selection, ['workspace'], read),
    tool('merchant_clinicaltrials_operation', 'Recover the exact original request after an interrupted reply. Preserves UNKNOWN/RUNNING/COMPLETE/FAILED/INTERRUPTED and native result or error.',
      { ...selection, requestId: mutation.requestId }, ['workspace', 'requestId'], read),
    tool('merchant_clinicaltrials_action', 'Execute an original ClinicalTrials action with the reviewed revision and a retained UUID. Supports cohort/capture/review/mapping/edition/query/merchant/package, original PRS, publisher and dossier actions. Inspect the same operation after uncertainty.',
      { ...mutation, action: { anyOf: [{ type: 'string', enum: actionNames }, { type: 'string', pattern: '^(publisher|dossier)\\.[a-z][a-z0-9_.-]{0,95}$' }] }, payload: { type: 'object' } },
      ['workspace', 'action', 'payload', 'expectedRevision', 'requestId'], { openWorld: true }),
    tool('merchant_clinicaltrials_files', 'Inspect declared complete file identities before source, PRS or portable receiving. Returns original byte count and SHA256 without host path or credential values.',
      { ...selection, file: alias }, ['workspace'], read),
    tool('merchant_clinicaltrials_prs_upload', 'Send one complete host-declared PRS XML through the original raw-byte intake and original official protocol/results validator.',
      { ...mutation, file: alias, expectedSha256: digest, schema: { type: 'string', enum: ['protocol', 'results'] } }, ['workspace', 'file', 'expectedSha256', 'schema', 'expectedRevision', 'requestId'], {}),
    tool('merchant_clinicaltrials_prs_candidate', 'Retain a complete host-declared reviewed XML candidate against its original PRS document. Uses the native candidate comparison with the reviewed file SHA256, revision and request UUID.',
      { ...mutation, file: alias, expectedSha256: digest, originalId: digest,
        reviewedBy: { type: 'string', minLength: 1, maxLength: 160 },
        note: { type: 'string', minLength: 1, maxLength: 8192 } },
      ['workspace','file','expectedSha256','originalId','reviewedBy','note','expectedRevision','requestId'], {}),
    tool('merchant_clinicaltrials_restore', 'Receive one complete declared ClinicalTrials package through the existing receiving console and its original workspace lease.',
      { ...mutation, file: alias, expectedSha256: digest }, ['workspace', 'file', 'expectedSha256', 'expectedRevision', 'requestId'], {}),
    tool('merchant_clinicaltrials_file_prepare', 'Retain one complete declared native export, capture source member, contract, PRS XML/report or original publisher file for verified resumable delivery. Reads the original bytes once.',
      { ...selection, kind: { type: 'string', enum: ['export', 'source', 'contract', 'prs', 'publisher'] },
        exportId: id, captureId: id, documentId: id, file: { type: 'string', minLength: 1, maxLength: 512 },
        name: id, publisherKind: { type: 'string', enum: PUBLISHER_KINDS }, id, expectedRevision: mutation.expectedRevision, prsKind: { type: 'string', enum: ['xml', 'report'] }, expectedSha256: digest },
      ['workspace', 'kind'], {}),
    tool('merchant_clinicaltrials_exports', 'Page complete retained ClinicalTrials MCP deliveries after a lost reply or either service restart. Each manifest binds its original native selection and file hash.',
      { workspace: alias, ...pagination }, [], read),
    tool('merchant_clinicaltrials_manifest', 'Inspect the saved completion manifest for an original ClinicalTrials delivery, including its complete source selection and byte hashes.',
      { exportId: digest }, ['exportId'], read),
    tool('merchant_clinicaltrials_file', 'Read one exact retained original file or its completion manifest in verified base64 chunks. Repeat file/manifest hashes, readId and byte offset to continue.',
      { exportId: digest, file: { type: 'string', minLength: 1, maxLength: 160 }, expectedManifestSha256: digest, expectedSha256: digest,
        readId: mutation.requestId, offset: pagination.offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
      ['exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], read),
    tool('merchant_clinicaltrials_file_release', 'Release a temporary verified read while preserving the complete original retained delivery.',
      { exportId: digest, readId: mutation.requestId }, ['exportId', 'readId'], { idempotent: true }),
    ...originalTools.map(value => tool('merchant_clinicaltrials_source_' + value.name.slice('merchant_source_'.length),
      value.description + ' Uses this existing ClinicalTrials console and its original NDJSON source engine.',
      value.properties, value.required, value.annotations))
  ];
}
const definitions = new Map(clinicalTrialsWorkspaceTools((name, description, properties, required) =>
  ({ name, description, properties, required })).map(value => [value.name, value]));
export function validateClinicalTrialsArguments(name, args = {}) {
  const definition = definitions.get(name);
  if (!definition) throw fail('TOOL_NOT_FOUND', 'Choose a declared ClinicalTrials operation.');
  exact(args, Object.keys(definition.properties), definition.required);
  return args;
}

function deliveryName(value) {
  text(value, 'Delivery filename', 160);
  if (value === '.' || value === '..' || /[\\/:]/.test(value))
    throw fail('CLINICALTRIALS_EXPORT_INVALID', 'Retain one original file with a simple filename.');
  return value;
}
function manifestIdentity(value) {
  return { schema: value.schema, workspace: value.workspace, applicationSchema: value.applicationSchema,
    revision: value.revision, revisionAfter: value.revisionAfter, source: value.source, files: value.files };
}
/** The native body is retained unchanged; this manifest binds its complete delivery identity. */
export function parseClinicalTrialsExport(data, exportId) {
  if (!Buffer.isBuffer(data) || data.length > 65_000)
    throw fail('CLINICALTRIALS_EXPORT_INVALID', 'Use the original complete ClinicalTrials delivery manifest.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { throw fail('CLINICALTRIALS_EXPORT_INVALID', 'The retained completion manifest must be valid UTF-8 JSON.'); }
  exact(value, ['schema','workspace','applicationSchema','revision','revisionAfter','source','files','exportId','createdAt'],
    ['schema','workspace','applicationSchema','revision','revisionAfter','source','files','exportId','createdAt']);
  checked(exportId, SHA, 'export SHA256'); checked(value.workspace, ALIAS, 'original workspace alias');
  integer(value.revision, 0); integer(value.revisionAfter, 0);
  if (value.schema !== CLINICALTRIALS_EXPORT_SCHEMA || value.applicationSchema !== CLINICALTRIALS_APPLICATION_SCHEMA ||
      value.exportId !== exportId || !plain(value.source) || !Array.isArray(value.files) || value.files.length !== 1 ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)))
    throw fail('CLINICALTRIALS_EXPORT_INVALID', 'The saved completion record has a different original identity.');
  nativeFileSelection(value.source);
  for (const file of value.files) {
    exact(file, ['name','bytes','sha256','contentType'], ['name','bytes','sha256','contentType']);
    deliveryName(file.name); integer(file.bytes, 0, MAX_FILE); checked(file.sha256, SHA, 'file SHA256');
    text(file.contentType, 'Content type', 256);
    if ([CLINICALTRIALS_MANIFEST, 'download-state'].includes(file.name)) throw fail('CLINICALTRIALS_EXPORT_INVALID', 'Original data and completion manifest must have distinct names.');
  }
  if (sha(canonical(manifestIdentity(value))) !== exportId)
    throw fail('CLINICALTRIALS_EXPORT_INVALID', 'The completion manifest differs from its original selection and file identities.');
  return value;
}
function nativeFileSelection(input) {
  if (!plain(input)) throw fail('INVALID_PARAMS', 'Choose one original native file selection.');
  const spec = {
    export: { keys: ['kind','exportId','file'], route: 'export', fallback: () => basename(input.file) },
    source: { keys: ['kind','captureId','file'], route: 'source-file', fallback: () => basename(input.file) },
    contract: { keys: ['kind','name'], route: 'contract', fallback: () => input.name },
    prs: { keys: ['kind','documentId','prsKind'], route: 'prs-file', fallback: () => 'prs-' + input.documentId + (input.prsKind === 'xml' ? '.xml' : '-report.json') },
    publisher: { keys: ['kind','publisherKind','id'], route: 'publisher-export',
      fallback: () => input.publisherKind + (input.publisherKind.endsWith('csv') ? '.csv' : input.publisherKind.endsWith('jsonl') ? '.jsonl' : input.publisherKind === 'session-review' ? '.html' : '.json') }
  }[input.kind];
  if (!spec) throw fail('INVALID_PARAMS', 'Choose export, source, contract, prs or publisher.');
  exact(input, spec.keys, spec.keys);
  const parameters = {};
  for (const key of spec.keys.slice(1)) {
    const value = key === 'file' ? relativeName(input[key]) : text(input[key], 'Original ' + key);
    if (key === 'prsKind' && !['xml','report'].includes(value) ||
        key === 'publisherKind' && !PUBLISHER_KINDS.includes(value))
      throw fail('INVALID_PARAMS', 'Choose an original native download kind.');
    parameters[key === 'prsKind' || key === 'publisherKind' ? 'kind' : key] = value;
  }
  return { route: '/api/clinical/' + spec.route + '?' + new URLSearchParams(parameters),
    fallback: spec.fallback(), source: { ...input } };
}
function responseName(response, fallback) {
  const disposition = response.headers.get('content-disposition') ?? '';
  let name;
  const extended = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const quoted = /(?:^|;)\s*filename="([^"]+)"/i.exec(disposition);
  const simple = /(?:^|;)\s*filename=([^;]+)/i.exec(disposition);
  try { name = extended ? decodeURIComponent(extended[1]) : quoted?.[1] ?? simple?.[1]?.trim(); } catch {}
  try { deliveryName(name); } catch { name = basename(fallback); deliveryName(name); }
  return [CLINICALTRIALS_MANIFEST, 'download-state'].includes(name) ? 'original-' + name : name;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function immutableRecord(path, data) {
  const temporary = join(dirname(path), '.record-' + randomUUID());
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null;
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return false;
    }
    await syncDirectory(dirname(path)); return true;
  } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export class MerchantClinicalTrialsWorkspaces {
  #config; #source; #pending = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'CLINICALTRIALS' });
  constructor(config) {
    this.#config = config;
    const original = config.clinicalTrialsWorkspaces;
    this.#source = new MerchantSourceWorkspaces({ ...config,
      sourceWorkspaces: original ? { schema: 'stellar-forge.source-workspace-connection.v1',
        workspaces: Object.fromEntries(Object.entries(original.workspaces).map(([workspace, definition]) =>
          [workspace, { ...definition, format: 'ndjson',
            files: Object.fromEntries(Object.entries(definition.files).filter(([,file]) => file.kind !== 'prs')) }])) } : null });
  }
  get summary() {
    return { configured: Boolean(this.#config.clinicalTrialsWorkspaces), ownership: 'EXISTING_CLINICALTRIALS_CONSOLE',
      ...this.#reads.summary, originalSource: this.#source.summary,
      workspaces: Object.entries(this.#config.clinicalTrialsWorkspaces?.workspaces ?? {}).map(([workspace, definition]) =>
        ({ workspace, label: definition.label, connection: definition.consoleUrlFile ? 'ORIGINAL_CONSOLE_URL_FILE' : 'ORIGINAL_CONSOLE_URL_ENV',
          files: Object.entries(definition.files).map(([file, value]) => ({ file, kind: value.kind,
            name: value.name ?? null, label: value.label ?? null, sha256: value.sha256 ?? null })),
          fileReads: this.#reads.status(workspace), ownership: 'EXISTING_CLINICALTRIALS_CONSOLE' })) };
  }
  #definition(workspace) {
    checked(workspace, ALIAS, 'workspace alias');
    const definition = this.#config.clinicalTrialsWorkspaces?.workspaces[workspace];
    if (!definition) throw fail('CLINICALTRIALS_WORKSPACE_NOT_CONFIGURED', 'Choose an original console from merchant_clinicaltrials_workspaces.');
    return definition;
  }
  async #connection(definition) {
    let raw;
    try {
      raw = definition.consoleUrlFile
        ? new TextDecoder('utf-8', { fatal: true }).decode(await bytes(definition.consoleUrlFile, 4096, true)).trim()
        : process.env[definition.consoleUrlEnv];
    } catch { throw fail('CLINICALTRIALS_CONSOLE_UNAVAILABLE', 'Start or reconnect the original ClinicalTrials console using its existing private connection reference.'); }
    let url; try { url = new URL(raw); } catch {}
    if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || Number(url.port || 80) < 1 || url.username || url.password ||
        url.pathname !== '/' || url.search || !/^#[A-Za-z0-9_-]{32,256}$/.test(url.hash))
      throw fail('CLINICALTRIALS_CONSOLE_CONNECTION_INVALID', 'Use the exact private URL printed by the running original ClinicalTrials console.');
    return { origin: url.origin, token: url.hash.slice(1) };
  }
  async #request(definition, route, { body, headers = {}, requestId,
    method = body === undefined ? 'GET' : 'POST' } = {}, consume) {
    const connection = await this.#connection(definition);
    try {
      const response = await fetch(connection.origin + route, { method, redirect: 'error',
        signal: AbortSignal.timeout(240_000),
        headers: { Authorization: 'Bearer ' + connection.token, Origin: connection.origin, ...headers },
        ...(body === undefined ? {} : { body, ...(typeof body === 'string' || Buffer.isBuffer(body) ? {} : { duplex: 'half' }) }) });
      if (!response.ok) {
        let detail = {};
        try { detail = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, 65_536))); } catch {}
        const originalCode = typeof detail.code === 'string' ? detail.code : detail.error?.code;
        const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(originalCode ?? '') ? originalCode : 'CLINICALTRIALS_CONSOLE_REJECTED';
        const originalMessage = typeof detail.error === 'string' ? detail.error :
          typeof detail.error?.message === 'string' ? detail.error.message : typeof detail.message === 'string' ? detail.message : null;
        const message = (originalMessage ?? 'Original ClinicalTrials console returned HTTP ' + response.status + '.')
          .split(connection.token).join('[private capability]').slice(0, 2000);
        throw fail(code, message + (requestId ? ' Original requestId: ' + requestId + '.' : ''),
          { nativeResponse: true, status: response.status, requestId });
      }
      return await consume(response);
    } catch (error) {
      if (error.nativeResponse || error.code === 'INVALID_PARAMS' || error.code?.startsWith('CLINICALTRIALS_')) throw error;
      if (['ENOSPC','EDQUOT','EROFS','EACCES','EPERM'].includes(error.code))
        throw fail('CLINICALTRIALS_STORAGE_UNAVAILABLE', 'Original retained delivery storage returned ' + error.code +
          '. Restore its capacity or access and inspect the original retained operation.');
      throw fail(requestId ? 'CLINICALTRIALS_OPERATION_UNCERTAIN' : 'CLINICALTRIALS_CONSOLE_INTERRUPTED',
        requestId ? 'The original reply was interrupted. Read merchant_clinicaltrials_operation for requestId ' + requestId +
          ' before continuing this exact saved action.' :
          'The original console read was interrupted. Reconnect its existing listener and read the same retained selection.');
    }
  }
  #json(definition, route, body, requestId) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const maximum = body?.action === 'prs.candidate' ? MAX_PRS + 1024 * 1024 : MAX_REQUEST;
    if (payload !== undefined && Buffer.byteLength(payload) > maximum)
      throw fail('INVALID_PARAMS', 'Native JSON exceeds its original request limit. Use declared complete input files for source and PRS intake.');
    return this.#request(definition, route, { body: payload, requestId,
      headers: payload === undefined ? {} : { 'Content-Type': 'application/json' } },
      async response => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))));
  }
  async #state(definition) {
    const state = await this.#json(definition, '/api/state');
    if (!plain(state) || state.schema !== 'stellar-forge.ndjson-workspace.v1' ||
        state.applicationSchema !== CLINICALTRIALS_APPLICATION_SCHEMA)
      throw fail('CLINICALTRIALS_CONSOLE_CHANGED', 'Reconnect the declared original ClinicalTrials workspace console.');
    integer(state.revision, 0);
    return state;
  }
  async #root() {
    if (typeof this.#config.exportsDirectory !== 'string')
      throw fail('CLINICALTRIALS_EXPORT_DIRECTORY_INVALID', 'Configure the existing private customer export directory.');
    return privateDirectory(join(this.#config.exportsDirectory, 'clinicaltrials'));
  }
  async #retained(exportId) {
    checked(exportId, SHA, 'export SHA256');
    const directory = await existingPrivateDirectory(join(await this.#root(), exportId));
    const manifestBytes = await bytes(join(directory, CLINICALTRIALS_MANIFEST), 65_000, true);
    const manifest = parseClinicalTrialsExport(manifestBytes, exportId);
    this.#definition(manifest.workspace);
    return { directory, manifest, manifestBytes, manifestSha256: sha(manifestBytes),
      manifestFile: { name: CLINICALTRIALS_MANIFEST, bytes: manifestBytes.length, sha256: sha(manifestBytes), contentType: 'application/json' } };
  }
  async #exports(workspace) {
    if (workspace !== undefined) this.#definition(workspace);
    const root = await this.#root(), results = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!SHA.test(entry.name) || !entry.isDirectory()) continue;
      let retained;
      try { retained = await this.#retained(entry.name); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'CLINICALTRIALS_WORKSPACE_NOT_CONFIGURED') continue; throw error; }
      if (workspace === undefined || retained.manifest.workspace === workspace)
        results.push({ ...retained.manifest, manifestSha256: retained.manifestSha256, manifestFile: retained.manifestFile });
    }
    return results.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.exportId.localeCompare(b.exportId));
  }
  async #retain(workspace, definition, args) {
    const { expectedSha256, expectedRevision, ...source } = args;
    if (expectedSha256 !== undefined) checked(expectedSha256, SHA, 'original file SHA256');
    const selected = nativeFileSelection(source), before = await this.#state(definition);
    if (expectedRevision !== undefined && integer(expectedRevision, 0) !== before.revision)
      throw fail('CLINICALTRIALS_REVISION_CHANGED', 'Read the current original workspace before preparing this file.');
    const root = await this.#root();
    return this.#request(definition, selected.route, {}, async response => {
      const temporary = join(root, '.native-' + randomUUID());
      let handle, length = 0;
      try {
        handle = await open(temporary, 'wx', 0o600);
        const digest = createHash('sha256');
        for await (const chunk of response.body ?? []) {
          length += chunk.length;
          if (length > MAX_FILE) throw fail('CLINICALTRIALS_EXPORT_TOO_LARGE', 'Original file exceeds the existing 256 MB delivery limit.');
          digest.update(chunk); await handle.writeFile(chunk);
        }
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) !== length))
          throw fail('CLINICALTRIALS_EXPORT_TRUNCATED', 'The original native file ended before its declared byte count.');
        const digestHex = digest.digest('hex');
        if (expectedSha256 !== undefined && expectedSha256 !== digestHex)
          throw fail('CLINICALTRIALS_FILE_CHANGED', 'Original native bytes differ from the selected SHA256.');
        await handle.sync(); await handle.close(); handle = null;
        const after = await this.#state(definition);
        if (expectedRevision !== undefined && after.revision !== expectedRevision)
          throw fail('CLINICALTRIALS_REVISION_CHANGED', 'The original workspace changed during delivery. Review its current revision and exact file identity.');
        const file = { name: responseName(response, selected.fallback), bytes: length, sha256: digestHex,
          contentType: text(response.headers.get('content-type') ?? 'application/octet-stream', 'Native content type', 256) };
        const identity = { schema: CLINICALTRIALS_EXPORT_SCHEMA, workspace, applicationSchema: CLINICALTRIALS_APPLICATION_SCHEMA,
          revision: before.revision, revisionAfter: after.revision, source: selected.source, files: [file] };
        const exportId = sha(canonical(identity)), directory = await privateDirectory(join(root, exportId));
        try { await link(temporary, join(directory, file.name)); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const existing = await fileSha(join(directory, file.name), MAX_FILE, true);
          if (existing.bytes !== length || existing.sha256 !== digestHex)
            throw fail('CLINICALTRIALS_FILE_CHANGED', 'The retained destination differs from the original file identity.');
        }
        await unlink(temporary);
        const manifest = { ...identity, exportId, createdAt: new Date().toISOString() };
        const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
        parseClinicalTrialsExport(manifestBytes, exportId);
        await immutableRecord(join(directory, CLINICALTRIALS_MANIFEST), manifestBytes);
        const retained = await this.#retained(exportId);
        return { state: 'MANIFEST_RETAINED', workspace, exportId, manifest: retained.manifest,
          manifestFile: retained.manifestFile, manifestSha256: retained.manifestSha256 };
      } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
  }
  async #files(definition, selected) {
    if (selected !== undefined) checked(selected, ALIAS, 'file alias');
    const names = selected === undefined ? Object.keys(definition.files) : [selected], results = [];
    for (const alias of names) {
      const file = definition.files[alias];
      if (!file) throw fail('INVALID_PARAMS', 'Choose a declared original file alias.');
      const identity = await fileSha(file.path, MAX_FILE);
      results.push({ file: alias, kind: file.kind, name: file.name ?? basename(file.path), label: file.label ?? null,
        ...identity, expectedSha256: file.sha256 ?? null, matchesConfiguredSha256: file.sha256 ? identity.sha256 === file.sha256 : null });
    }
    return results;
  }
  async #upload(definition, input, kind) {
    checked(input.requestId, UUID, 'original request UUID'); integer(input.expectedRevision, 0);
    checked(input.expectedSha256, SHA, 'reviewed input SHA256');
    const file = definition.files[checked(input.file, ALIAS, 'file alias')];
    if (!file || file.kind !== kind) throw fail('INVALID_PARAMS', 'Choose a host-declared ' + kind + ' file handle.');
    if (kind === 'prs' && !['protocol','results'].includes(input.schema))
      throw fail('INVALID_PARAMS', 'Choose the original protocol or results XML schema.');
    const { handle, info } = await fileHandle(file.path, kind === 'prs' ? MAX_PRS : MAX_FILE); let stream;
    try {
      const digest = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) digest.update(chunk);
      const originalSha = digest.digest('hex');
      if (originalSha !== input.expectedSha256 || file.sha256 && originalSha !== file.sha256)
        throw fail('CLINICALTRIALS_FILE_CHANGED', 'The complete declared input differs from its reviewed SHA256.');
      const name = text(file.name ?? basename(file.path), 'Original filename');
      stream = handle.createReadStream({ autoClose: false, start: 0 });
      const result = await this.#request(definition, kind === 'prs' ? '/api/clinical/prs-upload' : '/api/clinical/restore',
        { body: stream, requestId: input.requestId, headers: {
          'Content-Type': kind === 'prs' ? 'application/xml' : 'application/zip',
          'Content-Length': String(info.size), 'X-Request-Id': input.requestId,
          'X-Expected-Revision': String(input.expectedRevision), 'X-Clinical-Name': encodeURIComponent(name),
          'X-Clinical-Sha256': originalSha,
          ...(kind === 'prs' ? { 'X-Clinical-Schema': input.schema } : {}) } },
        async response => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))));
      const after = await handle.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
        throw fail('CLINICALTRIALS_OPERATION_UNCERTAIN', 'Input changed during the original upload. Inspect original requestId ' +
          input.requestId + ' and its retained body SHA before continuing.');
      return result;
    } finally { stream?.destroy(); await handle.close(); }
  }
  async #candidate(definition, input) {
    checked(input.requestId, UUID, 'original request UUID'); integer(input.expectedRevision, 0);
    checked(input.expectedSha256, SHA, 'reviewed candidate SHA256'); checked(input.originalId, SHA, 'original PRS document');
    text(input.reviewedBy, 'Reviewer', 160); text(input.note, 'Review note', 8192);
    const file = definition.files[checked(input.file, ALIAS, 'candidate file alias')];
    if (!file || file.kind !== 'prs') throw fail('INVALID_PARAMS', 'Choose a declared reviewed PRS candidate file.');
    const data = await bytes(file.path, MAX_PRS), originalSha = sha(data);
    if (originalSha !== input.expectedSha256 || file.sha256 && file.sha256 !== originalSha)
      throw fail('CLINICALTRIALS_FILE_CHANGED', 'Complete candidate XML differs from the reviewed SHA256.');
    let xml;
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { throw fail('INVALID_PARAMS', 'The original reviewed candidate route accepts complete UTF-8 XML.'); }
    const result = await this.#json(definition, '/api/clinical/action', {
      action: 'prs.candidate', payload: { originalId: input.originalId, xml,
        name: text(file.name ?? basename(file.path), 'Candidate filename'),
        reviewedBy: input.reviewedBy, note: input.note },
      expectedRevision: input.expectedRevision, requestId: input.requestId
    }, input.requestId);
    return result;
  }
  async #execute(name, args) {
    if (name === 'merchant_clinicaltrials_workspaces') return this.summary;
    const originalName = sourceNames.get(name);
    if (originalName) {
      if (originalName !== 'merchant_source_workspaces') await this.#state(this.#definition(args.workspace));
      const native = await this.#source.call(originalName, args);
      return { ...native, applicationSchema: CLINICALTRIALS_APPLICATION_SCHEMA, ownership: 'EXISTING_CLINICALTRIALS_CONSOLE' };
    }
    if (name === 'merchant_clinicaltrials_exports')
      return { state: 'RETAINED_EXPORTS', ...page(await this.#exports(args.workspace), args) };
    if (['merchant_clinicaltrials_manifest','merchant_clinicaltrials_file','merchant_clinicaltrials_file_release'].includes(name)) {
      const retained = await this.#retained(args.exportId);
      if (name === 'merchant_clinicaltrials_manifest') return { state: 'MANIFEST_RETAINED', exportId: args.exportId,
        manifest: retained.manifest, manifestFile: retained.manifestFile, manifestSha256: retained.manifestSha256 };
      if (name === 'merchant_clinicaltrials_file_release') {
        await this.#reads.release(args.exportId, checked(args.readId, UUID, 'original file read'));
        return { state: 'RELEASED', exportId: args.exportId, readId: args.readId };
      }
      checked(args.expectedSha256, SHA, 'original file SHA256');
      if (checked(args.expectedManifestSha256, SHA, 'manifest SHA256') !== retained.manifestSha256)
        throw fail('CLINICALTRIALS_EXPORT_CHANGED', 'Repeat the original retained completion manifest SHA256.');
      deliveryName(args.file);
      const file = args.file === CLINICALTRIALS_MANIFEST ? retained.manifestFile :
        retained.manifest.files.find(file => file.name === args.file);
      if (!file || file.sha256 !== args.expectedSha256)
        throw fail('CLINICALTRIALS_FILE_CHANGED', 'Select an original declared file with its exact SHA256.');
      if (args.readId !== undefined) checked(args.readId, UUID, 'original file read');
      return { exportId: args.exportId, manifestSha256: retained.manifestSha256,
        ...await this.#reads.read({ scope: args.exportId, key: args.file, kind: retained.manifest.source.kind,
          directory: retained.directory, expectedSha256: file.sha256, readId: args.readId, offset: args.offset, limit: args.limit,
          load: async () => ({ bytes: args.file === CLINICALTRIALS_MANIFEST ? retained.manifestBytes :
            await bytes(join(retained.directory, file.name), MAX_FILE, true), name: file.name, type: file.contentType }) }) };
    }
    const { workspace, ...input } = args, definition = this.#definition(workspace);
    const native = value => ({ workspace, native: value });
    if (name === 'merchant_clinicaltrials_status')
      return { workspace, state: await this.#state(definition), retainedExports: (await this.#exports(workspace)).length,
        ownership: 'EXISTING_CLINICALTRIALS_CONSOLE', fileReads: this.#reads.summary };
    if (name === 'merchant_clinicaltrials_inventory') {
      const state = await this.#state(definition);
      if (!definitions.get(name).properties.kind.enum.includes(input.kind) || !Array.isArray(state[input.kind]))
        throw fail('CLINICALTRIALS_INVENTORY_INVALID', 'The original console did not provide the selected retained inventory array.');
      return native({ revision: state.revision, kind: input.kind, ...page(state[input.kind], input) });
    }
    if (name === 'merchant_clinicaltrials_files') return { workspace, files: await this.#files(definition, input.file) };
    if (name === 'merchant_clinicaltrials_file_prepare') return this.#retain(workspace, definition, input);
    if (name === 'merchant_clinicaltrials_prs_upload' || name === 'merchant_clinicaltrials_restore') {
      await this.#state(definition);
      return native(await this.#upload(definition, input, name.endsWith('prs_upload') ? 'prs' : 'packet'));
    }
    if (name === 'merchant_clinicaltrials_prs_candidate') {
      await this.#state(definition);
      return native(await this.#candidate(definition, input));
    }
    if (name === 'merchant_clinicaltrials_action') {
      checked(input.requestId, UUID, 'original request UUID'); integer(input.expectedRevision, 0);
      if (!actionNames.includes(input.action) && !(typeof input.action === 'string' && /^(publisher|dossier)\.[a-z][a-z0-9_.-]{0,95}$/.test(input.action)))
        throw fail('INVALID_PARAMS', 'Choose an original declared action. Original file imports use their raw-byte tools.');
      if (!plain(input.payload)) throw fail('INVALID_PARAMS', 'Supply the original action payload object.');
      await this.#state(definition);
      return native(await this.#json(definition, '/api/clinical/action', input, input.requestId));
    }
    const routes = {
      merchant_clinicaltrials_capture: ['capture',['captureId']],
      merchant_clinicaltrials_studies: ['studies',['captureId','offset','limit','query']],
      merchant_clinicaltrials_study: ['study',['captureId','nctId']],
      merchant_clinicaltrials_study_compare: ['study-compare',['beforeId','afterId','nctId']],
      merchant_clinicaltrials_prs: ['prs',['documentId']],
      merchant_clinicaltrials_prs_plan: ['prs-plan',['planId']],
      merchant_clinicaltrials_prs_reconciliation: ['prs-reconciliation',['reportId']],
      merchant_clinicaltrials_prs_preview: ['prs-preview',['previewId']],
      merchant_clinicaltrials_prs_catalog: ['prs-catalog',[]],
      merchant_clinicaltrials_operation: ['operation',['requestId']]
    };
    const route = routes[name];
    if (!route) throw fail('TOOL_NOT_FOUND', 'Choose an original declared ClinicalTrials tool.');
    const parameters = {};
    for (const key of route[1]) {
      if (input[key] === undefined) continue;
      if (key === 'offset') parameters[key] = String(integer(input[key], 0));
      else if (key === 'limit') parameters[key] = String(integer(input[key], 1, 250));
      else if (key === 'nctId') parameters[key] = checked(input[key], NCT, 'NCT identifier');
      else if (key === 'requestId') parameters[key] = checked(input[key], UUID, 'original request UUID');
      else if (key === 'query') {
        if (typeof input[key] !== 'string' || input[key].length > 200 || /[\x00-\x1f]/.test(input[key]))
          throw fail('INVALID_PARAMS', 'Use a saved-study search string of up to 200 printable characters.');
        parameters[key] = input[key];
      } else parameters[key] = text(input[key], 'Original ' + key);
    }
    await this.#state(definition);
    return native(await this.#json(definition, '/api/clinical/' + route[0] + '?' + new URLSearchParams(parameters)));
  }
  async call(name, args = {}) {
    if (this.#closing) throw fail('CLINICALTRIALS_WORKSPACE_CLOSING', 'ClinicalTrials attachment is closing.');
    validateClinicalTrialsArguments(name, args);
    const pending = Promise.resolve().then(() => this.#execute(name, args)); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await Promise.allSettled([...this.#pending]);
        const outcomes = await Promise.allSettled([this.#reads.close(), this.#source.close()]);
        if (outcomes.some(outcome => outcome.status === 'rejected'))
          throw fail('CLINICALTRIALS_CLOSE_INCOMPLETE', 'An owned original read reported an incomplete close.');
      })();
    }
    return this.#close;
  }
}
