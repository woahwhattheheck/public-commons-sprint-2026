// MIT. Agent access to the original XML/NDJSON console and its retained workspace.
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

export const SOURCE_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.source-workspace-connection.v1';
const EXPORT_SCHEMA = 'stellar-forge.source-console-export.v1';
const SHA = /^[0-9a-f]{64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_EXPORT = 256000000;
const MAX_SOURCE = 256 * 1024 * 1024;
const MAX_JSON = 16 * 1024 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function exact(value, keys, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw fail('INVALID_PARAMS', 'Supply the declared fields and every required field.');
}
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw fail('INVALID_PARAMS', 'Use a valid ' + label + '.');
  return value;
}
function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw fail('INVALID_PARAMS', 'Integer is outside its declared range.');
  return value;
}
function text(value, label, maximum = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw fail('INVALID_PARAMS', label + ' must be printable, nonempty text.');
  return value;
}
async function fileHandle(path, maximum, privateFile = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum || privateFile && process.platform !== 'win32' && (info.mode & 0o077))
      throw fail('SOURCE_FILE_INVALID', 'Use a regular file within its original size and privacy limits.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function bytes(path, maximum, privateFile = false) {
  const { handle } = await fileHandle(path, maximum, privateFile);
  try {
    const value = await handle.readFile();
    if (value.length > maximum) throw fail('SOURCE_FILE_INVALID', 'The selected file grew beyond its size limit.');
    return value;
  } finally { await handle.close(); }
}
async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077))
    throw fail('SOURCE_EXPORT_DIRECTORY_INVALID', 'Use the original private customer export directory.');
  return path;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw fail('CONFIGURATION_ERROR', 'Declare a host file path.');
  return resolve(base, value);
}
/** Connection files contain host references, never credentials or client-selected paths. */
export async function readSourceWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(path, 1024 * 1024, true)));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== SOURCE_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw fail('CONFIGURATION_ERROR', 'Declare 1–32 original XML or NDJSON source workspaces.');
  const workspaces = Object.create(null), base = dirname(path);
  for (const [alias, input] of Object.entries(raw.workspaces)) {
    checked(alias, ALIAS, 'workspace alias');
    exact(input, ['label', 'format', 'consoleUrlEnv', 'consoleUrlFile', 'files'], ['format']);
    if (!['xml', 'ndjson'].includes(input.format) || (input.consoleUrlEnv === undefined) === (input.consoleUrlFile === undefined))
      throw fail('CONFIGURATION_ERROR', 'Choose XML or NDJSON and exactly one original console URL environment or file reference.');
    const files = Object.create(null);
    if (input.files !== undefined && (!plain(input.files) || Object.keys(input.files).length > 128))
      throw fail('CONFIGURATION_ERROR', 'Declare up to 128 original source or project-packet file handles.');
    for (const [handle, file] of Object.entries(input.files ?? {})) {
      checked(handle, ALIAS, 'file handle');
      exact(file, ['path', 'kind', 'label', 'name', 'sha256'], ['path', 'kind']);
      if (!['source', 'packet'].includes(file.kind)) throw fail('CONFIGURATION_ERROR', 'File kind must be source or packet.');
      files[handle] = { path: hostPath(file.path, base), kind: file.kind,
        ...(file.label === undefined ? {} : { label: text(file.label, 'Source label') }),
        ...(file.name === undefined ? {} : { name: text(file.name, 'Source name') }),
        ...(file.sha256 === undefined ? {} : { sha256: checked(file.sha256, SHA, 'source SHA256') }) };
    }
    workspaces[alias] = { label: text(input.label ?? alias, 'Workspace label'), format: input.format, files,
      ...(input.consoleUrlEnv === undefined ? { consoleUrlFile: hostPath(input.consoleUrlFile, base) }
        : { consoleUrlEnv: checked(input.consoleUrlEnv, /^[A-Za-z_][A-Za-z0-9_]*$/, 'console URL environment name') }) };
  }
  return { schema: SOURCE_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}

const alias = { type: 'string', pattern: ALIAS.source };
const digest = { type: 'string', pattern: SHA.source };
const selection = { workspace: alias };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: digest };
const read = { readOnly: true, idempotent: true };
export function sourceWorkspaceTools(tool) {
  return [
    tool('merchant_source_workspaces', 'List configured original XML/NDJSON consoles, source-file handles and retained download sessions.', {}, [], read),
    tool('merchant_source_status', 'Read original saved source, mapping, build and comparison counts. Recover completed work here and through inventory after an interrupted reply.', selection, ['workspace'], read),
    tool('merchant_source_inventory', 'Page saved sources, plans, builds or comparisons from the original workspace. Continue its snapshot with expectedSnapshot.', { ...selection, kind: { type: 'string', enum: ['sources', 'plans', 'builds', 'comparisons'] }, ...page }, ['workspace', 'kind'], read),
    tool('merchant_source_inspect', 'Read the complete retained source inventory, original byte hash, label and shape.', { ...selection, source: digest }, ['workspace', 'source'], read),
    tool('merchant_source_ingest', 'Ingest a host-declared complete source file through the existing console. Returns its original content-addressed source and inventory.', { ...selection, file: alias }, ['workspace', 'file'], { idempotent: true }),
    tool('merchant_source_ingest_text', 'Retain a small complete XML or NDJSON document through the original console. Use a configured file handle for larger source.', { ...selection, text: { type: 'string', minLength: 1, maxLength: 131072 }, label: { type: 'string', maxLength: 160 }, name: { type: 'string', maxLength: 160 } }, ['workspace', 'text'], { idempotent: true }),
    tool('merchant_source_plan', 'Read one complete original saved mapping.', { ...selection, plan: digest }, ['workspace', 'plan'], read),
    tool('merchant_source_plan_save', 'Validate and save a complete mapping using the original selected format parser. Returned hash identifies the exact mapping.', { ...selection, definition: { type: 'object' } }, ['workspace', 'definition'], { idempotent: true }),
    tool('merchant_source_build', 'Build the exact source and mapping with the original SF30 dataset engine, retaining lineage, dataset files and complete review.', { ...selection, source: digest, plan: digest }, ['workspace', 'source', 'plan'], { idempotent: true }),
    tool('merchant_source_query', 'Query the exact retained build through the native dataset engine. Pass original query parameters as strings.', { ...selection, build: digest, query: { type: 'object', additionalProperties: { type: 'string' } } }, ['workspace', 'build'], read),
    tool('merchant_source_compare', 'Compare two editions using their original shared mapping and explicit unique keys. Retains the complete keyed changes file.', { ...selection, before: digest, after: digest }, ['workspace', 'before', 'after'], { idempotent: true }),
    tool('merchant_source_changes', 'Page original retained comparison changes. Continue nextOffset until null, or export the full change file.', { ...selection, comparison: digest, offset: page.offset, limit: page.limit }, ['workspace', 'comparison'], read),
    tool('merchant_source_export', 'Retain the complete original project packet, native dataset package or edition changes for resumable delivery. The native console creates the export once.', { ...selection, kind: { type: 'string', enum: ['project', 'dataset', 'changes'] }, build: digest, comparison: digest }, ['workspace', 'kind'], {}),
    tool('merchant_source_merchant_prepare', 'Prepare the original NDJSON merchant package with reviewed public payment terms, source, mapping, native dataset, seller, OpenAPI and generated customer SDK.', { ...selection, build: digest, payment: { type: 'object' }, origin: { type: 'string' }, path: { type: 'string' } }, ['workspace', 'build', 'payment', 'origin', 'path'], {}),
    tool('merchant_source_exports', 'Page retained complete exports, including results whose initial reply was interrupted. Files remain available after MCP or console restart.', { ...selection, ...page }, ['workspace'], read),
    tool('merchant_source_file_read', 'Read the exact retained export in verified base64 byte chunks. Repeat exportId and readId with nextOffset; completed reads release their temporary snapshot.', { ...selection, exportId: digest, readId: { type: 'string', pattern: UUID.source }, offset: page.offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['workspace', 'exportId'], read),
    tool('merchant_source_file_release', 'Release an original temporary download snapshot while preserving its complete retained export.', { ...selection, readId: { type: 'string', pattern: UUID.source } }, ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_source_import', 'Import a complete source project packet through the original receiving console. Select one configured packet file or a retained project export from a declared workspace.', { ...selection, file: alias, exportId: digest, fromWorkspace: alias }, ['workspace'], { idempotent: true }),
  ];
}
const definitions = new Map(sourceWorkspaceTools((name, description, properties, required) => ({ name, properties, required })).map(value => [value.name, value]));
function paged(items, input) {
  const offset = integer(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER), limit = integer(input.limit ?? 50, 1, 250);
  const snapshot = hash(JSON.stringify(items));
  if (input.expectedSnapshot !== undefined && checked(input.expectedSnapshot, SHA, 'inventory snapshot') !== snapshot)
    throw fail('SOURCE_INVENTORY_CHANGED', 'Original inventory changed. Continue a new page-zero snapshot.');
  if (offset && input.expectedSnapshot === undefined) throw fail('SOURCE_SNAPSHOT_REQUIRED', 'Continue the returned original inventory snapshot.');
  if (offset > items.length) throw fail('INVALID_PARAMS', 'Offset exceeds the original inventory.');
  return { total: items.length, snapshot, offset, items: items.slice(offset, offset + limit),
    nextOffset: offset + limit < items.length ? offset + limit : null };
}
async function responseBytes(response, maximum) {
  const pieces = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > maximum) throw fail('SOURCE_RESPONSE_TOO_LARGE', 'Use the complete native export for this response.');
    pieces.push(chunk);
  }
  return Buffer.concat(pieces, length);
}

export class MerchantSourceWorkspaces {
  #config; #pending = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'SOURCE_FILE' });
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.sourceWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.sourceWorkspaces?.workspaces ?? {}).map(([workspace, value]) => ({
        workspace, label: value.label, format: value.format, connection: value.consoleUrlFile ? 'ORIGINAL_CONSOLE_URL_FILE' : 'ORIGINAL_CONSOLE_URL_ENV',
        files: Object.entries(value.files).map(([file, source]) => ({ file, kind: source.kind, sha256: source.sha256 ?? null })),
        fileReads: this.#reads.status(workspace), ownership: 'EXISTING_SOURCE_CONSOLE' })) };
  }
  #definition(workspace) {
    checked(workspace, ALIAS, 'workspace alias');
    const value = this.#config.sourceWorkspaces?.workspaces[workspace];
    if (!value) throw fail('SOURCE_WORKSPACE_NOT_CONFIGURED', 'Choose an original source workspace from merchant_source_workspaces.');
    return value;
  }
  async #connection(definition) {
    let raw;
    try {
      raw = definition.consoleUrlFile
        ? new TextDecoder('utf-8', { fatal: true }).decode(await bytes(definition.consoleUrlFile, 4096, true)).trim()
        : process.env[definition.consoleUrlEnv];
    } catch {
      throw fail('SOURCE_CONSOLE_UNAVAILABLE', 'Start or reconnect the original source console using its declared private connection file.');
    }
    let url; try { url = new URL(raw); } catch {}
    if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
        url.pathname !== '/' || url.search || !/^#[A-Za-z0-9_-]{32,256}$/.test(url.hash))
      throw fail('SOURCE_CONSOLE_CONNECTION_INVALID', 'Use the exact private URL printed by the running original source console.');
    return { origin: url.origin, token: url.hash.slice(1) };
  }
  async #request(definition, route, { body, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}, consume) {
    const connection = await this.#connection(definition);
    try {
      const response = await fetch(connection.origin + route, { method, redirect: 'error', signal: AbortSignal.timeout(240000),
        headers: { Authorization: 'Bearer ' + connection.token, ...headers },
        ...(body === undefined ? {} : { body, ...(typeof body === 'string' || Buffer.isBuffer(body) ? {} : { duplex: 'half' }) }) });
      if (!response.ok) {
        let detail = {}; try { detail = JSON.parse((await responseBytes(response, 65536)).toString('utf8')); } catch {}
        const issue = fail('SOURCE_CONSOLE_REJECTED', typeof detail.error === 'string' ? detail.error.slice(0,2000) : 'Original source console returned HTTP ' + response.status + '.');
        issue.status = response.status; throw issue;
      }
      return await consume(response);
    } catch (error) {
      if (error.code?.startsWith('SOURCE_') || error.code === 'INVALID_PARAMS') throw error;
      if (['ENOSPC','EDQUOT','EROFS','EACCES'].includes(error.code))
        throw fail('SOURCE_STORAGE_UNAVAILABLE', 'Original export storage returned ' + error.code + '. Restore its private directory capacity or access and continue the saved source operation.');
      throw fail('SOURCE_CONSOLE_OPERATION_INTERRUPTED', 'Original console operation interrupted. Read its saved state and retained exports before repeating a change.');
    }
  }
  #json(definition, route, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && Buffer.byteLength(payload) > 131072) throw fail('INVALID_PARAMS', 'Native JSON request exceeds 128 KiB.');
    return this.#request(definition, route, { body: payload, headers: payload === undefined ? {} : { 'Content-Type': 'application/json' } },
      async response => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))));
  }
  async #state(definition) {
    const state = await this.#json(definition, '/api/state');
    if (state.schema !== 'stellar-forge.' + definition.format + '-workspace.v1') throw fail('SOURCE_FORMAT_CHANGED', 'Original console does not match this configured source format.');
    return state;
  }
  async #directory(workspace) {
    const root = await privateDirectory(join(this.#config.exportsDirectory, 'source-consoles'));
    return privateDirectory(join(root, workspace));
  }
  async #exportMetadata(workspace, id) {
    checked(id, SHA, 'export SHA256');
    const directory = await this.#directory(workspace);
    const metadata = JSON.parse((await bytes(join(directory, id + '.json'), 65536, true)).toString('utf8'));
    if (metadata.schema !== EXPORT_SCHEMA || metadata.workspace !== workspace || metadata.exportId !== id ||
        !['project','dataset','changes','merchant'].includes(metadata.kind) || metadata.bytes < 0 || metadata.bytes > MAX_EXPORT)
      throw fail('SOURCE_EXPORT_INVALID', 'Retained export metadata changed.');
    return { directory, metadata };
  }
  async #exports(workspace) {
    const directory = await this.#directory(workspace), results = [];
    for (const name of await readdir(directory)) {
      if (/^[0-9a-f]{64}\.json$/.test(name)) results.push((await this.#exportMetadata(workspace, name.slice(0,64))).metadata);
    }
    return results.sort((a,b) => b.created.localeCompare(a.created) || a.exportId.localeCompare(b.exportId));
  }
  async #retain(workspace, definition, route, kind, selection, body) {
    const directory = await this.#directory(workspace);
    return this.#request(definition, route, { body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' } }, async response => {
      const temporary = join(directory, '.partial-' + randomUUID()), handle = await open(temporary, 'wx', 0o600);
      const digest = createHash('sha256'); let length = 0;
      try {
        for await (const chunk of response.body ?? []) {
          length += chunk.length;
          if (length > MAX_EXPORT) throw fail('SOURCE_EXPORT_TOO_LARGE', 'Original export exceeds the existing 256 MB retained delivery limit.');
          digest.update(chunk); await handle.writeFile(chunk);
        }
        await handle.sync();
        const exportId = digest.digest('hex'), destination = join(directory, exportId + '.data');
        await link(temporary, destination).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const name = definition.format + '-' + kind + (kind === 'changes' ? '.jsonl' : '.zip');
        const metadata = { schema: EXPORT_SCHEMA, workspace, format: definition.format, exportId, kind, ...selection,
          name, bytes: length, sha256: exportId, contentType: kind === 'changes' ? 'application/x-ndjson' : 'application/zip', created: new Date().toISOString() };
        const recordPath = join(directory, '.record-' + randomUUID());
        let record;
        try {
          record = await open(recordPath, 'wx', 0o600);
          await record.writeFile(JSON.stringify(metadata, null, 2) + '\n'); await record.sync();
          await link(recordPath, join(directory, exportId + '.json')).catch(error => { if (error.code !== 'EEXIST') throw error; });
        } finally { await record?.close(); await unlink(recordPath).catch(() => {}); }
        return (await this.#exportMetadata(workspace, exportId)).metadata;
      } finally { await handle.close(); await unlink(temporary).catch(() => {}); }
    });
  }
  async #upload(definition, file, route) {
    const { handle, info } = await fileHandle(file.path, route === '/api/import' ? 2 * MAX_SOURCE : MAX_SOURCE);
    let stream;
    try {
      if (file.sha256) {
        const digest = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) digest.update(chunk);
        if (digest.digest('hex') !== file.sha256) throw fail('SOURCE_FILE_CHANGED', 'Configured source file differs from its selected SHA256.');
      }
      stream = handle.createReadStream({ autoClose: false, start: 0 });
      const prefix = 'X-' + definition.format.toUpperCase() + '-';
      const result = await this.#request(definition, route, { body: stream, headers: {
        'Content-Length': String(info.size), 'Content-Type': route === '/api/import' ? 'application/zip' : 'application/octet-stream',
        ...(file.name ? { [prefix + 'Name']: encodeURIComponent(file.name) } : {}),
        ...(file.label ? { [prefix + 'Label']: encodeURIComponent(file.label) } : {}) } },
        async response => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))));
      const after = await handle.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
        throw fail('SOURCE_FILE_CHANGED', 'Source changed during intake. Inspect the original saved source before continuing.');
      return result;
    } finally { stream?.destroy(); await handle.close(); }
  }
  async #execute(name, args) {
    if (name === 'merchant_source_workspaces') return this.summary;
    const { workspace, ...input } = args, definition = this.#definition(workspace);
    for (const field of ['source','plan','build','before','after','comparison','exportId'])
      if (input[field] !== undefined) checked(input[field], SHA, field + ' SHA256');
    const result = native => ({ workspace, native });
    switch (name) {
      case 'merchant_source_status': {
        const state = await this.#state(definition);
        return { workspace, schema: state.schema, counts: Object.fromEntries(['sources','plans','builds','comparisons'].map(key => [key,state[key].length])),
          ownership: 'EXISTING_SOURCE_CONSOLE', retainedExports: (await this.#exports(workspace)).length, fileReads: this.#reads.status(workspace) };
      }
      case 'merchant_source_inventory': {
        if (!['sources','plans','builds','comparisons'].includes(input.kind)) throw fail('INVALID_PARAMS', 'Select a saved source inventory kind.');
        return result({ kind: input.kind, ...paged((await this.#state(definition))[input.kind], input) });
      }
      case 'merchant_source_inspect': return result(await this.#json(definition, '/api/source?id=' + input.source));
      case 'merchant_source_plan': return result(await this.#json(definition, '/api/plan?id=' + input.plan));
      case 'merchant_source_plan_save':
        if (!plain(input.definition)) throw fail('INVALID_PARAMS', 'Supply the complete native mapping definition.');
        return result(await this.#json(definition, '/api/plan', input.definition));
      case 'merchant_source_build': return result(await this.#json(definition, '/api/build', { source: input.source, plan: input.plan }));
      case 'merchant_source_query':
        if (input.query !== undefined && (!plain(input.query) || Object.values(input.query).some(value => typeof value !== 'string')))
          throw fail('INVALID_PARAMS', 'Native query parameters must be scalar strings.');
        return result(await this.#json(definition, '/api/query', { build: input.build, query: input.query ?? {} }));
      case 'merchant_source_compare': return result(await this.#json(definition, '/api/compare', { before: input.before, after: input.after }));
      case 'merchant_source_changes': return result(await this.#json(definition, '/api/changes?id=' + input.comparison + '&offset=' +
        integer(input.offset ?? 0,0,Number.MAX_SAFE_INTEGER) + '&limit=' + integer(input.limit ?? 50,1,250)));
      case 'merchant_source_ingest': {
        const file = definition.files[checked(input.file, ALIAS, 'source file handle')];
        if (!file || file.kind !== 'source') throw fail('INVALID_PARAMS', 'Choose a configured original source file handle.');
        return result(await this.#upload(definition, file, '/api/source'));
      }
      case 'merchant_source_ingest_text': {
        if (typeof input.text !== 'string' || !input.text.length || Buffer.byteLength(input.text) > 131072)
          throw fail('INVALID_PARAMS', 'Use up to 128 KiB of complete source text, or a configured file handle.');
        const prefix = 'X-' + definition.format.toUpperCase() + '-';
        return result(await this.#request(definition, '/api/source', { body: Buffer.from(input.text), headers: {
          'Content-Type': 'application/octet-stream', 'Content-Length': String(Buffer.byteLength(input.text)),
          [prefix + 'Name']: encodeURIComponent(text(input.name ?? 'source.' + definition.format, 'Source name')),
          [prefix + 'Label']: encodeURIComponent(text(input.label ?? definition.label, 'Source label')) } },
          async response => JSON.parse((await responseBytes(response, MAX_JSON)).toString('utf8'))));
      }
      case 'merchant_source_export': {
        if (!['project','dataset','changes'].includes(input.kind)) throw fail('INVALID_PARAMS', 'Choose a complete project, dataset or changes export.');
        if (input.kind === 'changes') {
          if (!input.comparison || input.build !== undefined) throw fail('INVALID_PARAMS', 'Changes export requires only its original comparison.');
          return this.#retain(workspace, definition, '/api/changes/download?id=' + input.comparison, input.kind, { comparison: input.comparison });
        }
        if (!input.build || input.comparison !== undefined) throw fail('INVALID_PARAMS', 'Project or dataset export requires only its original build.');
        return this.#retain(workspace, definition, (input.kind === 'project' ? '/api/export' : '/api/dataset-export') + '?build=' + input.build, input.kind, { build: input.build });
      }
      case 'merchant_source_merchant_prepare':
        if (definition.format !== 'ndjson' || !plain(input.payment) || typeof input.origin !== 'string' || typeof input.path !== 'string' ||
            Buffer.byteLength(JSON.stringify(input)) > 131072) throw fail('INVALID_PARAMS', 'Supply an NDJSON build and its complete original public merchant terms.');
        return this.#retain(workspace, definition, '/api/merchant', 'merchant', { build: input.build }, input);
      case 'merchant_source_exports': return result(paged(await this.#exports(workspace), input));
      case 'merchant_source_file_read': {
        if (input.readId !== undefined) checked(input.readId, UUID, 'original file read');
        const { directory, metadata } = await this.#exportMetadata(workspace, input.exportId);
        return { workspace, exportId: input.exportId, ...await this.#reads.read({ scope: workspace, key: input.exportId,
          kind: 'source-' + metadata.kind, directory, readId: input.readId, expectedSha256: input.exportId, offset: input.offset, limit: input.limit,
          load: async () => ({ bytes: await bytes(join(directory, input.exportId + '.data'), MAX_EXPORT, true), name: metadata.name, type: metadata.contentType }) }) };
      }
      case 'merchant_source_file_release':
        await this.#reads.release(workspace, checked(input.readId, UUID, 'original file read'));
        return { workspace, readId: input.readId, state: 'RELEASED' };
      case 'merchant_source_import': {
        if ((input.file === undefined) === (input.exportId === undefined)) throw fail('INVALID_PARAMS', 'Choose exactly one configured packet file or retained project export.');
        let file;
        if (input.file !== undefined) {
          if (input.fromWorkspace !== undefined) throw fail('INVALID_PARAMS', 'fromWorkspace selects an existing retained export.');
          file = definition.files[checked(input.file, ALIAS, 'packet file handle')];
          if (!file || file.kind !== 'packet') throw fail('INVALID_PARAMS', 'Choose a configured original project-packet handle.');
        } else {
          const owner = input.fromWorkspace ?? workspace; this.#definition(owner);
          const { directory, metadata } = await this.#exportMetadata(owner, input.exportId);
          if (metadata.kind !== 'project' || metadata.format !== definition.format)
            throw fail('INVALID_PARAMS', 'Import a complete project packet matching the original receiving format.');
          file = { path: join(directory, input.exportId + '.data'), sha256: input.exportId };
        }
        return result(await this.#upload(definition, file, '/api/import'));
      }
      default: throw fail('TOOL_NOT_FOUND', 'Unknown original source-workspace operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw fail('SOURCE_WORKSPACE_CLOSING', 'Source-workspace access is closing.');
    const definition = definitions.get(name);
    if (!definition) throw fail('TOOL_NOT_FOUND', 'Unknown original source-workspace operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    const pending = Promise.resolve().then(() => this.#execute(name, args)); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => { await Promise.allSettled([...this.#pending]); await this.#reads.close(); })();
    }
    return this.#close;
  }
}

