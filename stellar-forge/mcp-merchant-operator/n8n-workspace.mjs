// MIT. Agent operations through the same original n8n merchant and launch.
import { n8nWorkspaceTools } from './catalog/n8n-workspace.mjs';
export { n8nWorkspaceTools } from './catalog/n8n-workspace.mjs';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain } from './host-files.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { N8N_JOB_ID, N8N_SHA, N8N_UUID, N8N_EXPORT_MANIFEST } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/n8n/transfer-format.mjs';

export const N8N_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.n8n-workspace-connection.v1';
const SOURCE_DIRECTORY = fileURLToPath(new URL('../../stellar/scf-starforge-20261009/sf30-seller-sdk/n8n/', import.meta.url));
const MAX_REQUEST_BYTES = 1100000;
const MAX_REPLY_BYTES = 8 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const checked = (value, pattern, name) => {
  if (typeof value !== 'string' || !pattern.test(value)) throw failure('INVALID_PARAMS', 'Select the original ' + name + '.');
  return value;
};
function integer(value, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', 'Use an integer within the declared range.');
  return value;
}
function text(value, maximum, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw failure('INVALID_PARAMS', 'Use single-line text within the declared length.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Select the original host path in the private connection file.');
  return resolve(base, value);
}
async function privateDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory ||
      process.platform !== 'win32' && ((info.mode & 0o077) || typeof process.getuid === 'function' && info.uid !== process.getuid()))
    throw failure('CONFIGURATION_ERROR', 'Select an owned canonical private original merchant directory (0700).');
  return directory;
}
async function privateBytes(path, maximum = 65536) {
  if (await realpath(path) !== path) throw failure('CONFIGURATION_ERROR', 'Select the canonical private connection or launch file.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum || process.platform !== 'win32' &&
        ((info.mode & 0o077) || typeof process.getuid === 'function' && info.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR', 'Read an owned private regular connection or launch file within its size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw failure('CONFIGURATION_ERROR', 'The selected private file exceeded its size limit.');
    return bytes;
  } finally { await handle.close(); }
}

/** Read host selections only. The original merchant is attached on a tool call. */
export async function readN8nWorkspaceConfiguration(path) {
  path = resolve(path);
  const bytes = await privateBytes(path);
  let raw; try { raw = JSON.parse(decode(bytes)); }
  catch { throw failure('CONFIGURATION_ERROR', 'Read the complete UTF-8 n8n workspace connection JSON.'); }
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== N8N_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare one to thirty-two original n8n merchant workspaces.');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [workspace, input] of Object.entries(raw.workspaces)) {
    identifier(workspace, 'n8n workspace alias');
    exact(input, ['label', 'directory', 'sourceDirectory'], ['directory']);
    const directory = await privateDirectory(hostPath(input.directory, base));
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original merchant directory one workspace alias.');
    seen.add(directory);
    const sourceDirectory = input.sourceDirectory === undefined ? resolve(SOURCE_DIRECTORY) : hostPath(input.sourceDirectory, base);
    const info = await lstat(sourceDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(sourceDirectory) !== sourceDirectory)
      throw failure('CONFIGURATION_ERROR', 'Select the canonical installed original n8n source directory.');
    const launch = await lstat(join(sourceDirectory, 'launch.mjs'));
    if (!launch.isFile() || launch.isSymbolicLink())
      throw failure('CONFIGURATION_ERROR', 'The selected original source must contain its launch.mjs.');
    workspaces[workspace] = { label: line(input.label ?? workspace, 'n8n workspace label'), directory, sourceDirectory };
  }
  return { schema: N8N_WORKSPACE_CONNECTION_SCHEMA, selectionSha256: sha(bytes), workspaces };
}

const definitions = new Map(n8nWorkspaceTools((name, description, properties, required) =>
  ({ name, properties, required })).map(value => [value.name, value]));

function query(route, input) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value));
  return route + (params.size ? '?' + params.toString() : '');
}
function validate(name, input) {
  if (input.jobId !== undefined) checked(input.jobId, N8N_JOB_ID, 'job identifier');
  if (input.reference !== undefined) checked(input.reference, N8N_JOB_ID, 'job reference');
  if (input.requestId !== undefined) checked(input.requestId, N8N_UUID, 'request UUID');
  if (input.functionId !== undefined) checked(input.functionId, /^[A-Za-z][A-Za-z0-9_]{0,55}$/, 'function identifier');
  for (const key of ['expectedRevision', 'jobRevision']) if (input[key] !== undefined) integer(input[key], 1);
  if (input.expectedDispatchRevision !== undefined && input.expectedDispatchRevision !== null) integer(input.expectedDispatchRevision, 1);
  for (const key of ['exportId', 'expectedManifestSha256', 'expectedSha256']) if (input[key] !== undefined) checked(input[key], N8N_SHA, 'SHA256');
  if (input.readId !== undefined) checked(input.readId, N8N_UUID, 'read UUID');
  if (input.limit !== undefined) integer(input.limit, 1, name === 'merchant_n8n_file' ? MAX_RETAINED_CHUNK_BYTES : 200);
  if (input.offset !== undefined) integer(input.offset, 0);
  if (input.cursor !== undefined) checked(input.cursor, /^[A-Za-z0-9_-]{1,2048}$/, 'query cursor');
  if (input.status !== undefined) checked(input.status, /^[A-Z_]{1,32}$/, 'job state');
  if (input.q !== undefined) text(input.q, 300, { empty: true });
  if (input.label !== undefined) text(input.label, 300, { empty: true });
  if (input.reason !== undefined) text(input.reason, 500);
  if (input.executionId !== undefined) checked(input.executionId, /^[A-Za-z0-9_-]{1,128}$/, 'n8n execution identifier');
  if (name === 'merchant_n8n_prepare' && !plain(input.input)) throw failure('INVALID_PARAMS', 'Supply the complete original JSON input object.');
  if (input.file !== undefined && ![N8N_EXPORT_MANIFEST, 'job.json', 'dispatch.json', 'result.json'].includes(input.file))
    throw failure('INVALID_PARAMS', 'Select a file listed in the original export manifest.');
}
function publicServices(services) {
  return Object.fromEntries(Object.entries(services ?? {}).map(([name, value]) => {
    let origin = null; try { origin = new URL(value).origin; } catch {}
    return [name, { configured: Boolean(value), origin }];
  }));
}

/** Borrows the original listener. Closing this adapter drains its own calls only. */
export class MerchantN8nWorkspaces {
  #workspaces; #active = new Set(); #reads = new Map(); #closing = false; #closed;
  constructor(config) { this.#workspaces = config.n8nWorkspaces?.workspaces ?? Object.create(null); }
  get summary() {
    return { configured: Object.keys(this.#workspaces).length > 0, ownership: 'ORIGINAL_N8N_MERCHANT',
      workspaces: Object.entries(this.#workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
      activeCalls: this.#active.size, activeFileReads: this.#reads.size, closing: this.#closing };
  }
  async #launch(workspace) {
    const selected = this.#workspaces[workspace];
    if (!selected) throw failure('N8N_WORKSPACE_NOT_CONFIGURED', 'Choose a host-declared original n8n workspace alias.');
    await privateDirectory(selected.directory);
    let saved;
    try { saved = JSON.parse(decode(await privateBytes(join(selected.directory, 'n8n-launch.json')))); }
    catch (error) {
      if (error.code === 'ENOENT') throw failure('N8N_WORKSPACE_NOT_RUNNING', 'Start this saved merchant in Applications or its original n8n serve command, then repeat the same request.');
      throw error;
    }
    // Only the host-selected module executes. Its original reader verifies every
    // selected/copied source byte and authenticates the actual live launch record.
    const native = await import(pathToFileURL(join(selected.sourceDirectory, 'launch.mjs')).href);
    if (typeof native.readN8nMerchantLaunch !== 'function')
      throw failure('N8N_WORKSPACE_SOURCE', 'Select the original n8n source with its native launch reader.');
    const ready = await native.readN8nMerchantLaunch({ directory: selected.directory,
      sourceDirectory: selected.sourceDirectory, launchSourceDirectory: saved.launchSourceDirectory });
    const url = new URL(ready.url);
    return { selected, ready, origin: url.origin, token: url.hash.slice(1) };
  }
  async #request(workspace, method, route, input) {
    const launch = await this.#launch(workspace);
    const encoded = input === undefined ? undefined : JSON.stringify(input);
    if (encoded !== undefined && Buffer.byteLength(encoded) > MAX_REQUEST_BYTES)
      throw failure('INVALID_PARAMS', 'The original job request exceeds its 1,100,000-byte HTTP limit.');
    const response = await fetch(launch.origin + route, { method, redirect: 'error',
      headers: { authorization: 'Bearer ' + launch.token, origin: launch.origin, accept: 'application/json',
        ...(encoded === undefined ? {} : { 'content-type': 'application/json' }) },
      body: encoded, signal: AbortSignal.timeout(120000) });
    const chunks = []; let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > MAX_REPLY_BYTES) throw failure('N8N_REPLY_LIMIT', 'Read this original job through its retained export; the direct reply exceeds eight MiB.');
      chunks.push(Buffer.from(chunk));
    }
    let value;
    try { value = JSON.parse(decode(Buffer.concat(chunks, size))); }
    catch { throw failure('N8N_REPLY_INVALID', 'The original merchant returned an invalid UTF-8 JSON reply.'); }
    if (!response.ok) throw Object.assign(failure(
      /^[A-Z][A-Z0-9_]{0,127}$/.test(value?.code ?? '') ? value.code : 'N8N_HTTP_' + response.status,
      typeof value?.message === 'string' ? value.message : 'The original merchant rejected this operation.'),
      { status: response.status });
    if (!plain(value)) throw failure('N8N_REPLY_INVALID', 'The original merchant operation did not return an object.');
    return { value, launch };
  }
  async #execute(name, workspace, input) {
    let method = 'POST', route, body = input;
    const action = name.slice('merchant_n8n_'.length);
    if (['status', 'jobs', 'exports', 'manifest', 'file'].includes(action)) {
      method = 'GET'; route = query('/api/agent/' + action, input); body = undefined;
    } else if (action === 'job') {
      method = 'GET'; route = '/api/jobs/' + encodeURIComponent(input.jobId); body = undefined;
    } else if (['prepare', 'renew', 'export'].includes(action)) route = '/api/agent/' + action;
    else if (action === 'file_release') route = '/api/agent/file-release';
    else if (action === 'worker_start' || action === 'worker_stop') {
      route = '/api/worker/' + action.slice('worker_'.length); body = {};
    } else {
      const { jobId, ...decision } = input;
      route = '/api/jobs/' + encodeURIComponent(jobId) + '/' + action.replaceAll('_', '-');
      body = decision;
    }
    const { value, launch } = await this.#request(workspace, method, route, body);
    if (action === 'file') {
      if (input.readId) this.#reads.delete(workspace + ':' + input.readId);
      if (value.readId && value.nextOffset !== null) {
        for (const [key, read] of this.#reads) if (Date.now() - read.touched > 180000) this.#reads.delete(key);
        this.#reads.set(workspace + ':' + value.readId, { workspace, exportId: input.exportId, readId: value.readId, touched: Date.now() });
      }
    } else if (action === 'file_release') this.#reads.delete(workspace + ':' + input.readId);
    const result = { ...value, workspace };
    if (value.services) result.services = publicServices(value.services);
    if (action === 'status') {
      result.launch = { instanceId: launch.ready.instanceId, startedAt: launch.ready.startedAt,
        configurationSha256: launch.ready.configurationSha256, applicationSha256: launch.ready.applicationSha256 };
    }
    return result;
  }
  call(name, args = {}) {
    if (this.#closing) return Promise.reject(failure('N8N_WORKSPACE_CLOSING', 'The n8n agent adapter is closing.'));
    const definition = definitions.get(name);
    if (!definition) return Promise.reject(failure('TOOL_NOT_FOUND', 'Unknown original n8n merchant tool.'));
    exact(args, Object.keys(definition.properties), definition.required);
    const workspace = identifier(args.workspace, 'n8n workspace alias'), { workspace: ignored, ...input } = args;
    validate(name, input);
    const selected = JSON.parse(JSON.stringify(input));
    const pending = this.#execute(name, workspace, selected);
    this.#active.add(pending);
    pending.finally(() => this.#active.delete(pending)).catch(() => {});
    return pending;
  }
  close() {
    return this.#closed ??= (async () => {
      this.#closing = true;
      await Promise.allSettled([...this.#active]);
      await Promise.allSettled([...this.#reads.values()].map(({ workspace, exportId, readId }) =>
        this.#request(workspace, 'POST', '/api/agent/file-release', { exportId, readId })));
      this.#reads.clear();
    })();
  }
}
