// MIT. Agent operation and complete delivery over the original private gRPC workspace.
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, link, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { GRPC_CUSTOMER_FILES, GRPC_EXPORT_SCHEMA, GRPC_EXPORT_MANIFEST, GRPC_EXPORT_MAX_BYTES,
  grpcHash, grpcCanonical, grpcExportIdentity, parseGrpcExportManifest } from './grpc-workspace-export.mjs';

export const GRPC_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.grpc-workspace-connection.v1';
const SHA = /^[0-9a-f]{64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_JSON = 40 * 1024 * 1024, MAX_NATIVE_REQUEST = 17825792, INLINE = 96 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
function exact(value, keys, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw fail('INVALID_PARAMS', 'Supply the declared fields, including every required field.');
}
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw fail('INVALID_PARAMS', 'Use a valid ' + label + '.');
  return value;
}
function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw fail('INVALID_PARAMS', 'Integer is outside its declared range.');
  return value;
}
function printable(value, label, maximum = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw fail('INVALID_PARAMS', 'Use nonempty printable ' + label + '.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw fail('CONFIGURATION_ERROR', 'Declare an original host file or directory.');
  return resolve(base, value);
}
async function readBytes(path, maximum, privateFile = true) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum || privateFile && process.platform !== 'win32' && info.mode & 0o077)
      throw fail('GRPC_FILE_INVALID', 'Use a regular private file within its original size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw fail('GRPC_FILE_CHANGED', 'The selected original file grew beyond its size limit.');
    return bytes;
  } finally { await handle.close(); }
}
const jsonFile = async (path, maximum) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(path, maximum)));
async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && info.mode & 0o077)
    throw fail('GRPC_EXPORT_DIRECTORY_INVALID', 'Use the original private merchant export directory.');
  return path;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function verifyFile(path, expected) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== expected.bytes || process.platform !== 'win32' && info.mode & 0o077)
      throw fail('GRPC_EXPORT_CHANGED', 'An original retained file changed.');
    const digest = createHash('sha256'), buffer = Buffer.alloc(65536);
    let offset = 0;
    while (offset < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - offset), offset);
      if (!bytesRead) throw fail('GRPC_EXPORT_CHANGED', 'An original retained file ended early.');
      digest.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if (digest.digest('hex') !== expected.sha256) throw fail('GRPC_EXPORT_CHANGED', 'An original retained file differs from its complete manifest.');
  } finally { await handle.close(); }
}
/** Host references are loaded once; private connection URLs are read again for each request. */
export async function readGrpcWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await jsonFile(path, 1024 * 1024), base = dirname(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== GRPC_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw fail('CONFIGURATION_ERROR', 'Declare 1–32 original native gRPC workspaces.');
  const workspaces = Object.create(null);
  for (const [alias, input] of Object.entries(raw.workspaces)) {
    checked(alias, ALIAS, 'workspace alias');
    exact(input, ['label', 'consoleUrlEnv', 'consoleUrlFile', 'captures', 'files']);
    if ((input.consoleUrlEnv === undefined) === (input.consoleUrlFile === undefined))
      throw fail('CONFIGURATION_ERROR', 'Declare exactly one original console URL environment name or private file.');
    const captures = Object.create(null), files = Object.create(null);
    for (const name of ['captures', 'files']) if (input[name] !== undefined &&
      (!plain(input[name]) || Object.keys(input[name]).length > 128))
      throw fail('CONFIGURATION_ERROR', 'Declare up to 128 original capture or receiving file handles.');
    for (const [handle, source] of Object.entries(input.captures ?? {})) {
      checked(handle, ALIAS, 'capture handle');
      exact(source, ['label', 'directory', 'entrypoints', 'sourceFile', 'planFile'], ['directory', 'entrypoints', 'sourceFile', 'planFile']);
      if (!Array.isArray(source.entrypoints) || !source.entrypoints.length || source.entrypoints.length > 128 ||
          source.entrypoints.some(entry => typeof entry !== 'string' || !entry || entry.length > 1024 || entry.includes('\0')))
        throw fail('CONFIGURATION_ERROR', 'Declare the original protobuf entrypoint names.');
      captures[handle] = { label: printable(source.label ?? handle, 'capture label', 120), directory: hostPath(source.directory, base),
        entrypoints: [...source.entrypoints], sourceFile: hostPath(source.sourceFile, base), planFile: hostPath(source.planFile, base) };
    }
    for (const [handle, source] of Object.entries(input.files ?? {})) {
      checked(handle, ALIAS, 'receiving file handle');
      exact(source, ['label', 'path', 'kind', 'sha256'], ['path', 'kind']);
      if (!['revision', 'request'].includes(source.kind)) throw fail('CONFIGURATION_ERROR', 'Declare an original revision or request JSON file.');
      files[handle] = { label: printable(source.label ?? handle, 'file label'), path: hostPath(source.path, base), kind: source.kind,
        ...(source.sha256 === undefined ? {} : { sha256: checked(source.sha256, SHA, 'file SHA256') }) };
    }
    workspaces[alias] = { label: printable(input.label ?? alias, 'workspace label'), captures, files,
      ...(input.consoleUrlFile === undefined
        ? { consoleUrlEnv: checked(input.consoleUrlEnv, /^[A-Za-z_][A-Za-z0-9_]*$/, 'console URL environment name') }
        : { consoleUrlFile: hostPath(input.consoleUrlFile, base) }) };
  }
  return { schema: GRPC_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}

const alias = { type: 'string', pattern: ALIAS.source }, digest = { type: 'string', pattern: SHA.source };
const uuid = { type: 'string', pattern: UUID.source }, selection = { workspace: alias };
const revision = { ...selection, revision: digest }, generation = { type: 'integer', minimum: 0 };
const baseRevision = { anyOf: [digest, { type: 'null' }] };
const page = { offset: generation, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: digest };
const methodName = { type: 'string', minLength: 1, maxLength: 1024 };
const reason = { type: 'string', minLength: 1, maxLength: 240 };
const instance = { type: 'string', minLength: 1, maxLength: 160 };
const read = { readOnly: true, idempotent: true };
export function grpcWorkspaceTools(tool) {
  return [
    tool('merchant_grpc_workspaces', 'List original gRPC workspaces and host-declared capture/request/receiving handles.', {}, [], read),
    tool('merchant_grpc_status', 'Read the original current revision, generation, native runtime and complete inventory counts. Recover here after an interrupted action.', selection, ['workspace'], read),
    tool('merchant_grpc_inventory', 'Page every original revision, preparation, intent or retained call, or complete delivery exports. Continue with the returned snapshot and nextOffset.', { ...selection, kind: { type: 'string', enum: ['revisions', 'prepared', 'intents', 'attempts', 'exports'] }, ...page }, ['workspace', 'kind'], read),
    tool('merchant_grpc_revision', 'Inspect an exact saved revision. Source and plan preserve complete values; methods and routes are paged. The complete captured protobuf closure is available through revision export.', { ...revision, section: { type: 'string', enum: ['summary', 'source', 'plan', 'methods', 'routes'] }, ...page }, ['workspace', 'revision'], read),
    tool('merchant_grpc_capture', 'Capture a host-declared proto/import closure, connection and merchant plan through the original operator. baseRevision is the currently selected revision, or null for a new workspace.', { ...selection, capture: alias, baseRevision, title: { type: 'string', minLength: 1, maxLength: 120 } }, ['workspace', 'capture', 'baseRevision'], {}),
    tool('merchant_grpc_save', 'Save edited connection, exact payment terms or typed requests while preserving the specified revision’s original protobuf closure. Supply the current baseRevision; omitted fields retain the source revision’s values.', { ...revision, baseRevision, source: { type: 'object' }, plan: { type: 'object' }, title: { type: 'string', minLength: 1, maxLength: 120 } }, ['workspace', 'revision', 'baseRevision'], {}),
    tool('merchant_grpc_import', 'Receive a complete original revision from one host file handle or retained revision export into this native workspace. Native validation and baseRevision apply to the imported closure and plan.', { ...selection, file: alias, exportId: digest, baseRevision, title: { type: 'string', minLength: 1, maxLength: 120 } }, ['workspace', 'baseRevision'], {}),
    tool('merchant_grpc_checkout', 'Select an existing saved revision using the original current-revision check. This preserves its original source and history.', { ...revision, baseRevision }, ['workspace', 'revision', 'baseRevision'], {}),
    tool('merchant_grpc_method', 'Read the native exact request/response schema for one method, including presence, enums, bytes and decimal 64-bit values. Large schemas are retained as complete downloadable JSON.', { ...revision, method: methodName }, ['workspace', 'revision', 'method'], read),
    tool('merchant_grpc_review', 'Run the original contract/channel readiness review for the selected saved revision and retain its native review.', revision, ['workspace', 'revision'], { openWorld: true }),
    tool('merchant_grpc_call', 'Intentionally call one selected unary method through the original native service. Choose a stable UUID operationId and exactly one input object or host request file. Repeating the same ID recovers its original outcome.', { ...revision, operationId: uuid, method: methodName, input: { type: 'object' }, file: alias }, ['workspace', 'revision', 'operationId', 'method'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_attempt', 'Recover the original retained call by its operationId. This reads its exact input/output and completes an already-durable native outcome; it does not dispatch another application RPC.', { ...selection, operationId: uuid }, ['workspace', 'operationId'], { idempotent: true }),
    tool('merchant_grpc_prepare', 'Prepare the selected original merchant and complete generated customer files. Keep the same UUID operationId to recover its preparation intent after interruption.', { ...revision, operationId: uuid }, ['workspace', 'revision', 'operationId'], { idempotent: true }),
    tool('merchant_grpc_run', 'Start the specified original prepared merchant in its native workspace, retaining the native run and Operations identities.', { ...selection, preparation: uuid }, ['workspace', 'preparation'], { openWorld: true }),
    tool('merchant_grpc_stop', 'Drain and stop the original merchant owned by this gRPC workspace.', selection, ['workspace'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_stage', 'Stage the exact original preparation in this workspace’s existing SF82 release store. Stop its direct merchant first.', { ...selection, preparation: uuid, releaseId: alias }, ['workspace', 'preparation', 'releaseId'], {}),
    tool('merchant_grpc_release_open', 'Open or recover the original gRPC-owned SF82 release console and its retained selection/runtime status.', selection, ['workspace'], { idempotent: true }),
    tool('merchant_grpc_release_status', 'Read the already-open original release console, selection generation and running instance.', selection, ['workspace'], read),
    tool('merchant_grpc_release_diff', 'Compare two original staged releases before selecting them. Omit from to use the currently selected release.', { ...selection, from: alias, to: alias }, ['workspace', 'to'], read),
    tool('merchant_grpc_release_activate', 'Activate an original staged release at the observed selection generation.', { ...selection, id: alias, expectedGeneration: generation, reason }, ['workspace', 'id', 'expectedGeneration', 'reason'], {}),
    tool('merchant_grpc_release_rollback', 'Roll back through the original release controller at the observed generation. Omit to to select its recorded previous release.', { ...selection, to: alias, expectedGeneration: generation, reason }, ['workspace', 'expectedGeneration', 'reason'], {}),
    tool('merchant_grpc_release_run', 'Run the original selected release at the observed generation using the original release console.', { ...selection, expectedGeneration: generation }, ['workspace', 'expectedGeneration'], { openWorld: true }),
    tool('merchant_grpc_release_stop', 'Drain the exact seller instance owned by the original release console.', { ...selection, instanceId: instance }, ['workspace', 'instanceId'], { openWorld: true }),
    tool('merchant_grpc_release_restart', 'Drain the exact original instance and start the selected release at the observed generation.', { ...selection, instanceId: instance, expectedGeneration: generation }, ['workspace', 'instanceId', 'expectedGeneration'], { openWorld: true }),
    tool('merchant_grpc_release_close', 'Close the original workspace-owned release console and drain its managed merchant.', selection, ['workspace'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_export', 'Retain all seven original customer files, the complete captured revision, or the exact retained call for resumable delivery. Native revision/preparation/operation identities and complete SHA256s travel with the files.', { ...selection, kind: { type: 'string', enum: ['customer', 'revision', 'attempt'] }, revision: digest, preparation: uuid, operationId: uuid }, ['workspace', 'kind'], {}),
    tool('merchant_grpc_export_manifest', 'Inspect a completed immutable gRPC export, its original identities and all file hashes. This is the first receiving step.', { exportId: digest }, ['exportId'], read),
    tool('merchant_grpc_export_file', 'Read the exact manifest or an original export file in verified resumable byte chunks. Pin both the reviewed manifest and file hashes.', { exportId: digest, file: { type: 'string', minLength: 1, maxLength: 128 }, expectedManifestSha256: digest, expectedSha256: digest, readId: uuid, offset: generation, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], read),
    tool('merchant_grpc_export_file_release', 'Release one temporary file-read snapshot while retaining its complete original export for future receiving.', { exportId: digest, readId: uuid }, ['exportId', 'readId'], { idempotent: true }),
  ];
}
const definitions = new Map(grpcWorkspaceTools((name, description, properties, required) => ({ name, properties, required })).map(value => [value.name, value]));
function paged(items, input) {
  const offset = integer(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER), limit = integer(input.limit ?? 50, 1, 250);
  const snapshot = grpcHash(grpcCanonical(items));
  if (offset && input.expectedSnapshot === undefined) throw fail('GRPC_SNAPSHOT_REQUIRED', 'Continue the original page-zero snapshot.');
  if (input.expectedSnapshot !== undefined && checked(input.expectedSnapshot, SHA, 'inventory snapshot') !== snapshot)
    throw fail('GRPC_INVENTORY_CHANGED', 'Original inventory changed. Start a new page-zero snapshot.');
  if (offset > items.length) throw fail('INVALID_PARAMS', 'Offset exceeds the complete original inventory.');
  return { total: items.length, snapshot, offset, items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
}
async function responseBytes(response, maximum) {
  const chunks = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > maximum) throw fail('GRPC_RESPONSE_TOO_LARGE', 'The original workspace response exceeds its complete transport limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
function connectionUrl(raw) {
  let url; try { url = new URL(raw); } catch {}
  if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
      url.pathname !== '/' || url.search || !/^#[0-9a-f]{64}$/.test(url.hash))
    throw fail('GRPC_CONNECTION_INVALID', 'Use the exact private URL printed by the original native workspace or returned by its release console.');
  return { origin: url.origin, token: url.hash.slice(1) };
}
function revisionSummary(value) {
  return { revision: value.id, parent: value.parent, createdAt: value.createdAt, title: value.title,
    protoSha256: value.protoSource?.sha256, methods: value.methods?.length ?? 0, routes: value.routes?.length ?? 0,
    environmentNames: value.environmentNames, readyToPrepare: value.readyToPrepare };
}

export class MerchantGrpcWorkspaces {
  #config; #environment; #pending = new Set(); #controllers = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'GRPC_EXPORT' });
  constructor(config, { environment = process.env } = {}) { this.#config = config; this.#environment = environment; }
  get summary() {
    return { configured: Boolean(this.#config.grpcWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.grpcWorkspaces?.workspaces ?? {}).map(([workspace, entry]) => ({
        workspace, label: entry.label, ownership: 'ORIGINAL_GRPC_WORKSPACE',
        captures: Object.entries(entry.captures).map(([capture, source]) => ({ capture, label: source.label, entrypoints: source.entrypoints })),
        files: Object.entries(entry.files).map(([file, source]) => ({ file, label: source.label, kind: source.kind, sha256: source.sha256 ?? null })),
      })) };
  }
  #definition(workspace) {
    checked(workspace, ALIAS, 'workspace alias');
    const definition = this.#config.grpcWorkspaces?.workspaces[workspace];
    if (!definition) throw fail('GRPC_WORKSPACE_NOT_CONFIGURED', 'Choose an original workspace from merchant_grpc_workspaces.');
    return definition;
  }
  async #connection(definition) {
    let raw;
    try { raw = definition.consoleUrlFile ? new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(definition.consoleUrlFile, 4096)).trim() : this.#environment[definition.consoleUrlEnv]; }
    catch { throw fail('GRPC_WORKSPACE_UNAVAILABLE', 'Restore the original workspace connection through its declared host reference.'); }
    return connectionUrl(raw);
  }
  async #request(connection, route, body, consume, release = false) {
    if (this.#closing) throw fail('GRPC_OPERATOR_CLOSING', 'The merchant connection is closing.');
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && Buffer.byteLength(payload) > (release ? 32768 : MAX_NATIVE_REQUEST))
      throw fail('INVALID_PARAMS', 'The complete request exceeds the original operator body limit.');
    const controller = new AbortController(); this.#controllers.add(controller);
    try {
      const response = await fetch(connection.origin + route, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(420000)]),
        headers: { [release ? 'x-release-token' : 'x-workspace-token']: connection.token, origin: connection.origin,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(payload === undefined ? {} : { body: payload }) });
      if (!response.ok) {
        let original = {}; try { original = JSON.parse((await responseBytes(response, 65536)).toString('utf8')); } catch {}
        const code = /^[A-Z][A-Z0-9_]+$/.test(original.error ?? '') ? original.error : 'GRPC_ORIGINAL_OPERATOR_REJECTED';
        let message = typeof original.detail === 'string' ? original.detail : typeof original.message === 'string' ? original.message : code;
        message = message.split(connection.token).join('[private capability]').slice(0, 1200);
        const issue = fail(code, message); issue.status = response.status;
        if (typeof original.field === 'string') issue.field = original.field;
        throw issue;
      }
      return await consume(response);
    } catch (error) {
      if (error.status || error.code?.startsWith('GRPC_') || error.code === 'INVALID_PARAMS') throw error;
      if (['ENOSPC', 'EDQUOT', 'EROFS', 'EACCES'].includes(error.code)) throw fail('GRPC_EXPORT_STORAGE_UNAVAILABLE', 'Restore the private export directory capacity or access and continue the original saved operation.');
      throw fail('GRPC_OPERATION_INTERRUPTED', 'The original operator reply was interrupted. Read status and the same retained operationId before retrying an action.');
    } finally { this.#controllers.delete(controller); }
  }
  async #json(definition, route, body) {
    return this.#request(await this.#connection(definition), route, body, async response =>
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))));
  }
  async #state(definition) {
    const state = await this.#json(definition, '/api/state');
    if (state.schema !== 'stellar-forge.grpc-workspace-state.v1' || !Array.isArray(state.revisions) || !Array.isArray(state.prepared))
      throw fail('GRPC_WORKSPACE_CHANGED', 'The configured URL does not identify the original gRPC workspace.');
    return state;
  }
  async #revision(definition, id) {
    checked(id, SHA, 'saved revision');
    const value = await this.#json(definition, '/api/open', { revision: id });
    if (value.id !== id || !plain(value.source) || !plain(value.protoSource) || !plain(value.plan))
      throw fail('GRPC_REVISION_CHANGED', 'The native workspace returned a different saved revision.');
    return value;
  }
  async #release(definition, route, body) {
    const runtime = await this.#json(definition, '/api/runtime');
    if (!runtime.releaseConsole?.url) throw fail('GRPC_RELEASE_NOT_OPEN', 'Open the original gRPC release console before using its retained release controls.');
    return this.#request(connectionUrl(runtime.releaseConsole.url), route, body, async response =>
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))), true);
  }
  async #root() { return privateDirectory(join(this.#config.exportsDirectory, 'grpc-workspace-exports')); }
  async #manifest(id) {
    checked(id, SHA, 'export ID');
    const directory = await privateDirectory(join(await this.#root(), id));
    const bytes = await readBytes(join(directory, GRPC_EXPORT_MANIFEST), 65000);
    const manifest = parseGrpcExportManifest(bytes, id); this.#definition(manifest.workspace);
    return { directory, bytes, manifest, sha256: grpcHash(bytes) };
  }
  #delivery(value) {
    return { state: 'MANIFEST_RETAINED', exportId: value.manifest.exportId, workspace: value.manifest.workspace,
      kind: value.manifest.kind, original: value.manifest.original, files: value.manifest.files,
      manifestFile: { name: GRPC_EXPORT_MANIFEST, bytes: value.bytes.length, sha256: value.sha256, contentType: 'application/json' } };
  }
  async #exports(workspace) {
    const root = await this.#root(), result = [];
    for (const name of (await readdir(root)).sort()) {
      if (!SHA.test(name)) continue;
      let value; try { value = await this.#manifest(name); } catch (error) { if (['ENOENT', 'GRPC_WORKSPACE_NOT_CONFIGURED'].includes(error.code)) continue; throw error; }
      if (value.manifest.workspace === workspace) result.push(this.#delivery(value));
    }
    return result;
  }
  async #retain(workspace, kind, original, sources) {
    const root = await this.#root(), temporary = await privateDirectory(join(root, '.collect-' + randomUUID()));
    const files = []; let total = 0;
    try {
      for (const source of sources) {
        const name = source.path.replaceAll('/', '-'), path = join(temporary, name);
        const handle = await open(path, 'wx', 0o600);
        let length = 0, nativeHash, nativeLength, contentType = source.contentType ?? 'application/json';
        const digest = createHash('sha256');
        const consume = async response => {
          nativeHash = checked(response.headers.get('x-content-sha256'), SHA, 'original file SHA256');
          nativeLength = response.headers.get('content-length');
          if (nativeLength === null || !/^\d+$/.test(nativeLength)) throw fail('GRPC_EXPORT_CHANGED', 'The native customer file has no exact byte length.');
          nativeLength = Number(nativeLength);
          contentType = (response.headers.get('content-type') ?? contentType).toLowerCase().replace(/;\s*charset=utf-8/i, '; charset=utf-8');
          for await (const chunk of response.body ?? []) await append(chunk);
        };
        const append = async chunk => {
          length += chunk.length; total += chunk.length;
          if (length > source.maximum || total > GRPC_EXPORT_MAX_BYTES) throw fail('GRPC_EXPORT_TOO_LARGE', 'The complete native export exceeds its declared size limit.');
          digest.update(chunk); await handle.writeFile(chunk);
        };
        try {
          if (source.bytes) await append(source.bytes); else await source.receive(consume);
          await handle.sync();
        } finally { await handle.close(); }
        const sha256 = digest.digest('hex');
        if (nativeHash !== undefined && (nativeHash !== sha256 || nativeLength !== length))
          throw fail('GRPC_EXPORT_CHANGED', 'The native customer bytes differ from their original download headers.');
        files.push({ name, path: source.path, bytes: length, sha256, contentType });
      }
      const manifest = { schema: GRPC_EXPORT_SCHEMA, workspace, kind, original, files };
      manifest.exportId = grpcExportIdentity(manifest);
      const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
      parseGrpcExportManifest(bytes, manifest.exportId);
      const manifestPath = join(temporary, GRPC_EXPORT_MANIFEST), handle = await open(manifestPath, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const destination = await privateDirectory(join(root, manifest.exportId));
      for (const file of [...files, { name: GRPC_EXPORT_MANIFEST, bytes: bytes.length, sha256: grpcHash(bytes) }]) {
        await link(join(temporary, file.name), join(destination, file.name)).catch(async error => {
          if (error.code !== 'EEXIST') throw error;
          await verifyFile(join(destination, file.name), file);
        });
      }
      await syncDirectory(destination); await syncDirectory(root);
      return this.#delivery(await this.#manifest(manifest.exportId));
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  async #jsonExport(workspace, kind, original, value) {
    const path = kind === 'revision' ? 'grpc-revision.json' : kind === 'attempt' ? 'grpc-attempt.json' : 'grpc-result.json';
    return this.#retain(workspace, kind, original, [{ path, maximum: MAX_JSON, contentType: 'application/json', bytes: Buffer.from(JSON.stringify(value) + '\n') }]);
  }
  async #bounded(workspace, value, original) {
    if (Buffer.byteLength(JSON.stringify(value)) <= INLINE) return value;
    const delivery = await this.#jsonExport(workspace, 'result', original, value);
    return { state: 'COMPLETE_RESULT_RETAINED', original, delivery };
  }
  async #hostJson(definition, name, kind) {
    checked(name, ALIAS, 'receiving file handle');
    const source = definition.files[name];
    if (!source || source.kind !== kind) throw fail('GRPC_FILE_NOT_CONFIGURED', 'Choose a host-declared ' + kind + ' file.');
    const bytes = await readBytes(source.path, MAX_NATIVE_REQUEST);
    if (source.sha256 && grpcHash(bytes) !== source.sha256) throw fail('GRPC_FILE_CHANGED', 'The host-declared file differs from its pinned SHA256.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  async #export(workspace, definition, input) {
    if (input.kind === 'customer') {
      checked(input.preparation, UUID, 'original preparation ID');
      if (input.revision !== undefined || input.operationId !== undefined) throw fail('INVALID_PARAMS', 'Select only the preparation for a complete customer export.');
      const state = await this.#state(definition), prepared = state.prepared.find(row => row.id === input.preparation);
      if (!prepared) throw fail('GRPC_PREPARATION_NOT_FOUND', 'Choose one original retained preparation.');
      return this.#retain(workspace, 'customer', { preparation: prepared.id, revision: prepared.revision }, GRPC_CUSTOMER_FILES.map(file => ({
        ...file, receive: async consume => this.#request(await this.#connection(definition), '/api/download', { id: prepared.id, file: file.path }, consume),
      })));
    }
    if (input.kind === 'revision') {
      if (input.preparation !== undefined || input.operationId !== undefined) throw fail('INVALID_PARAMS', 'Select only the revision for a complete source export.');
      const value = await this.#revision(definition, input.revision);
      return this.#jsonExport(workspace, 'revision', { revision: value.id }, value);
    }
    if (input.kind === 'attempt') {
      checked(input.operationId, UUID, 'original operation ID');
      if (input.revision !== undefined || input.preparation !== undefined) throw fail('INVALID_PARAMS', 'Select only the operationId for a complete retained call.');
      const value = await this.#json(definition, '/api/attempt', { id: input.operationId });
      if (!value) throw fail('GRPC_ATTEMPT_NOT_FOUND', 'The original workspace has no retained call with this operationId.');
      return this.#jsonExport(workspace, 'attempt', { operationId: value.id, revision: value.revision }, value);
    }
    throw fail('INVALID_PARAMS', 'Choose a complete customer, revision or attempt export.');
  }
  async #execute(name, args) {
    if (name === 'merchant_grpc_workspaces') return this.summary;
    if (name.startsWith('merchant_grpc_export_')) {
      const retained = await this.#manifest(args.exportId);
      if (name === 'merchant_grpc_export_manifest') return this.#delivery(retained);
      if (name === 'merchant_grpc_export_file_release') return this.#reads.release(args.exportId, checked(args.readId, UUID, 'retained read ID'));
      if (checked(args.expectedManifestSha256, SHA, 'reviewed manifest SHA256') !== retained.sha256)
        throw fail('GRPC_EXPORT_CHANGED', 'The complete export manifest differs from the reviewed original.');
      const file = args.file === GRPC_EXPORT_MANIFEST
        ? { name: GRPC_EXPORT_MANIFEST, bytes: retained.bytes.length, sha256: retained.sha256, contentType: 'application/json' }
        : retained.manifest.files.find(row => row.name === args.file);
      if (!file || checked(args.expectedSha256, SHA, 'original file SHA256') !== file.sha256)
        throw fail('GRPC_EXPORT_CHANGED', 'Choose an original file and its exact manifest hash.');
      const result = await this.#reads.read({ scope: args.exportId, key: file.name, kind: 'grpc-export',
        directory: retained.directory, expectedSha256: file.sha256, readId: args.readId, offset: args.offset ?? 0, limit: args.limit ?? 65536,
        load: async () => {
          const bytes = file.name === GRPC_EXPORT_MANIFEST ? retained.bytes : await readBytes(join(retained.directory, file.name), file.bytes);
          if (bytes.length !== file.bytes || grpcHash(bytes) !== file.sha256) throw fail('GRPC_EXPORT_CHANGED', 'The original retained file differs from its manifest.');
          return { bytes, name: file.name, type: file.contentType };
        } });
      return { exportId: args.exportId, manifestSha256: retained.sha256, ...result };
    }
    const workspace = args.workspace, definition = this.#definition(workspace);
    if (name === 'merchant_grpc_status') {
      const state = await this.#state(definition);
      return { schema: state.schema, workspace, currentRevision: state.currentRevision, generation: state.generation,
        counts: { revisions: state.revisions.length, prepared: state.prepared.length, intents: state.intents.length, attempts: state.attemptCount },
        runtime: state.runtime };
    }
    if (name === 'merchant_grpc_inventory') {
      if (args.kind === 'exports') return { workspace, kind: args.kind, ...paged(await this.#exports(workspace), args) };
      if (args.kind === 'attempts') {
        const input = Object.fromEntries(['offset', 'limit', 'expectedSnapshot'].filter(key => args[key] !== undefined).map(key => [key, args[key]]));
        const result = await this.#json(definition, '/api/attempts', input);
        if (result.schema !== 'stellar-forge.grpc-workspace-attempt-page.v1') throw fail('GRPC_ATTEMPTS_PAGE_INVALID', 'Use the original complete retained-attempt page route.');
        return { workspace, kind: args.kind, ...result };
      }
      if (!['revisions', 'prepared', 'intents'].includes(args.kind)) throw fail('INVALID_PARAMS', 'Choose a declared complete inventory.');
      return { workspace, kind: args.kind, ...paged((await this.#state(definition))[args.kind], args) };
    }
    if (name === 'merchant_grpc_revision') {
      const value = await this.#revision(definition, args.revision), section = args.section ?? 'summary';
      if (section === 'summary') return revisionSummary(value);
      if (['methods', 'routes'].includes(section)) return { revision: value.id, section, ...paged(value[section], args) };
      if (!['source', 'plan'].includes(section)) throw fail('INVALID_PARAMS', 'Choose summary, source, plan, methods or routes.');
      return this.#bounded(workspace, { revision: value.id, [section]: value[section] }, { revision: value.id, topic: section });
    }
    if (name === 'merchant_grpc_capture') {
      const capture = definition.captures[checked(args.capture, ALIAS, 'capture handle')];
      if (!capture) throw fail('GRPC_CAPTURE_NOT_CONFIGURED', 'Choose one host-declared protobuf capture.');
      const source = await jsonFile(capture.sourceFile, 65536), plan = await jsonFile(capture.planFile, 262144);
      return revisionSummary(await this.#json(definition, '/api/capture', { directory: capture.directory, entrypoints: capture.entrypoints,
        source, plan, baseRevision: args.baseRevision, title: args.title ?? capture.label }));
    }
    if (name === 'merchant_grpc_save') {
      const value = await this.#revision(definition, args.revision);
      return revisionSummary(await this.#json(definition, '/api/save', { source: args.source === undefined ? value.source : args.source, protoSource: value.protoSource,
        plan: args.plan === undefined ? value.plan : args.plan, title: args.title ?? value.title, baseRevision: args.baseRevision }));
    }
    if (name === 'merchant_grpc_import') {
      if ((args.file === undefined) === (args.exportId === undefined)) throw fail('INVALID_PARAMS', 'Choose exactly one host file or retained revision export.');
      let value;
      if (args.file !== undefined) value = await this.#hostJson(definition, args.file, 'revision');
      else {
        const retained = await this.#manifest(args.exportId);
        if (retained.manifest.kind !== 'revision') throw fail('GRPC_REVISION_EXPORT_REQUIRED', 'Receive a complete original revision export.');
        const file = retained.manifest.files[0]; await verifyFile(join(retained.directory, file.name), file);
        value = await jsonFile(join(retained.directory, file.name), MAX_NATIVE_REQUEST);
        if (value.id !== retained.manifest.original.revision) throw fail('GRPC_REVISION_CHANGED', 'The received revision differs from its original manifest.');
      }
      checked(value?.id, SHA, 'original received revision');
      if (grpcHash(grpcCanonical({ source: value.source, protoSource: value.protoSource, plan: value.plan, title: value.title })) !== value.id)
        throw fail('GRPC_REVISION_CHANGED', 'The complete received source and plan differ from their native revision identity.');
      return revisionSummary(await this.#json(definition, '/api/save', { source: value.source, protoSource: value.protoSource, plan: value.plan,
        title: args.title ?? value.title, baseRevision: args.baseRevision }));
    }
    if (name === 'merchant_grpc_checkout') return revisionSummary(await this.#json(definition, '/api/checkout', { revision: args.revision, baseRevision: args.baseRevision }));
    if (name === 'merchant_grpc_method') return this.#bounded(workspace, await this.#json(definition, '/api/method', { revision: args.revision, method: args.method }), { revision: args.revision, topic: 'method-schema' });
    if (name === 'merchant_grpc_review') return this.#bounded(workspace, await this.#json(definition, '/api/review', { revision: args.revision }), { revision: args.revision, topic: 'review' });
    if (name === 'merchant_grpc_call') {
      if ((args.input === undefined) === (args.file === undefined)) throw fail('INVALID_PARAMS', 'Choose exactly one complete input object or host request file.');
      const input = args.file === undefined ? args.input : await this.#hostJson(definition, args.file, 'request');
      if (!plain(input)) throw fail('INVALID_PARAMS', 'Use a complete native request object.');
      const value = await this.#json(definition, '/api/call', { revision: args.revision, id: args.operationId, method: args.method, input });
      return this.#bounded(workspace, value, { revision: args.revision, operationId: args.operationId, topic: 'call' });
    }
    if (name === 'merchant_grpc_attempt') {
      const value = await this.#json(definition, '/api/attempt', { id: args.operationId });
      if (!value) return { operationId: args.operationId, state: 'NOT_FOUND' };
      return this.#bounded(workspace, value, { revision: value.revision, operationId: value.id, topic: 'attempt' });
    }
    if (name === 'merchant_grpc_prepare') return this.#json(definition, '/api/prepare', { revision: args.revision, id: args.operationId });
    if (name === 'merchant_grpc_run') return this.#json(definition, '/api/run', { id: args.preparation });
    if (name === 'merchant_grpc_stop') return this.#json(definition, '/api/stop', {});
    if (name === 'merchant_grpc_stage') return this.#bounded(workspace, await this.#json(definition, '/api/stage', { id: args.preparation, releaseId: args.releaseId }), { preparation: args.preparation, topic: 'stage' });
    if (name === 'merchant_grpc_release_open') {
      const opened = await this.#json(definition, '/api/release-console', {});
      return { ...opened, status: await this.#release(definition, '/api/status') };
    }
    if (name === 'merchant_grpc_release_close') return this.#json(definition, '/api/release-close', {});
    if (name === 'merchant_grpc_release_status') return this.#bounded(workspace, await this.#release(definition, '/api/status'), { topic: 'release-status' });
    if (name === 'merchant_grpc_release_diff') {
      const params = new URLSearchParams({ to: checked(args.to, ALIAS, 'release ID') });
      if (args.from !== undefined) params.set('from', checked(args.from, ALIAS, 'release ID'));
      return this.#bounded(workspace, await this.#release(definition, '/api/diff?' + params), { topic: 'release-diff' });
    }
    const releaseAction = name.slice('merchant_grpc_release_'.length);
    if (name.startsWith('merchant_grpc_release_') && ['activate', 'rollback', 'run', 'stop', 'restart'].includes(releaseAction)) {
      const input = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'workspace'));
      return this.#bounded(workspace, await this.#release(definition, '/api/' + releaseAction, input), { topic: 'release-' + releaseAction });
    }
    if (name === 'merchant_grpc_export') return this.#export(workspace, definition, args);
    throw fail('METHOD_NOT_FOUND', 'Unknown original gRPC workspace operation.');
  }
  call(name, args = {}) {
    if (this.#closing) return Promise.reject(fail('GRPC_OPERATOR_CLOSING', 'The merchant connection is closing.'));
    const definition = definitions.get(name);
    if (!definition) return Promise.reject(fail('METHOD_NOT_FOUND', 'Unknown original gRPC workspace operation.'));
    exact(args, Object.keys(definition.properties), definition.required);
    const pending = this.#execute(name, args); this.#pending.add(pending);
    pending.finally(() => this.#pending.delete(pending)).catch(() => {});
    return pending;
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    for (const controller of this.#controllers) controller.abort();
    this.#close = (async () => { await Promise.allSettled([...this.#pending]); await this.#reads.close(); })();
    return this.#close;
  }
}
