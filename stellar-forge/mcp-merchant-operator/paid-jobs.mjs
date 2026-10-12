// MIT. Agent access to configured original paid-job merchants and retained exports.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain } from './host-files.mjs';
import { paidJobWorkspaceTools } from './catalog/paid-jobs.mjs';
import { readJobServiceLaunch } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/launch.mjs';
import { readJobWorkspaceIdentity, privateJobWorkspaceUrl } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/workspace/identity.mjs';
import { SHA } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/agent/format.mjs';
import { RESOLUTION_RECEIVING_BYTES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/resolution/contract.mjs';

export const PAID_JOB_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.paid-job-workspace-connection.v1';
const REQUEST_BYTES = 1100000, REPLY_BYTES = 8 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const error = (code, message, status) => Object.assign(failure(code, message), status ? { status } : {});
const checked = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value)) throw error('JOB_AGENT_INVALID_PARAMS', 'Select the original ' + label + '.');
  return value;
};
const definitions = new Map(paidJobWorkspaceTools((name, description, properties, required) =>
  ({ name, properties, required })).map(value => [value.name, value]));

function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw error('CONFIGURATION_ERROR', 'Select the original canonical host path in the private connection file.');
  return resolve(base, value);
}
async function privateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path ||
      process.platform !== 'win32' && ((info.mode & 0o077) || typeof process.getuid === 'function' && info.uid !== process.getuid()))
    throw error('CONFIGURATION_ERROR', 'Select the original owned, canonical private merchant directory (0700).');
  return path;
}
async function privateBytes(path, maximum = 65536) {
  if (await realpath(path) !== path)
    throw error('CONFIGURATION_ERROR', 'Select the canonical private connection or launch file.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum) || process.platform !== 'win32' &&
        ((before.mode & 0o077n) || typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid())))
      throw error('CONFIGURATION_ERROR', 'Read an owned private regular connection or launch file within its size limit.');
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    if (bytes.length > maximum || !['dev','ino','size','mtimeNs','ctimeNs'].every(key => before[key] === after[key]))
      throw error('CONFIGURATION_ERROR', 'The selected private file changed during its read. Read the current complete file.');
    return bytes;
  } finally { await handle.close(); }
}
function property(value, schema, label) {
  if (schema.anyOf) {
    if (!schema.anyOf.some(option => { try { property(value, option, label); return true; } catch { return false; } }))
      throw error('JOB_AGENT_INVALID_PARAMS', 'Use the declared value for ' + label + '.');
    return;
  }
  const validType = schema.type === 'null' ? value === null
    : schema.type === 'integer' ? Number.isSafeInteger(value)
    : schema.type === 'object' ? plain(value)
    : typeof value === schema.type;
  if (!validType || schema.enum && !schema.enum.includes(value) ||
      schema.type === 'string' && (schema.minLength !== undefined && value.length < schema.minLength ||
        schema.maxLength !== undefined && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value)) ||
      schema.type === 'integer' && (schema.minimum !== undefined && value < schema.minimum ||
        schema.maximum !== undefined && value > schema.maximum))
    throw error('JOB_AGENT_INVALID_PARAMS', 'Use the declared value for ' + label + '.');
}

/** Read only explicit host selections. Attaching occurs on the first operation. */
export async function readPaidJobWorkspaceConfiguration(path) {
  path = resolve(path);
  const bytes = await privateBytes(path);
  let raw;
  try { raw = JSON.parse(decode(bytes)); }
  catch { throw error('CONFIGURATION_ERROR', 'Read the complete UTF-8 paid-job workspace connection JSON.'); }
  exact(raw, ['schema','workspaces'], ['schema','workspaces']);
  if (raw.schema !== PAID_JOB_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw error('CONFIGURATION_ERROR', 'Declare one to thirty-two original paid-job merchant workspaces.');
  const base = dirname(path), workspaces = Object.create(null), directories = new Set();
  for (const [workspace, input] of Object.entries(raw.workspaces)) {
    identifier(workspace, 'paid-job workspace alias');
    exact(input, ['label','directory','launchFile','urlFile','source','runtimeDirectory','selectionSha256'],
      ['directory','source']);
    if (Number(input.launchFile !== undefined) + Number(input.urlFile !== undefined) !== 1)
      throw error('CONFIGURATION_ERROR', 'Select one original managed launch file or one private original operator URL file.');
    exact(input.source, ['configSha256','applicationSha256'], ['configSha256','applicationSha256']);
    checked(input.source.configSha256, SHA, 'configuration SHA256');
    checked(input.source.applicationSha256, SHA, 'application SHA256');
    if (input.selectionSha256 !== undefined) checked(input.selectionSha256, SHA, 'service selection SHA256');
    const directory = await privateDirectory(hostPath(input.directory, base));
    if (directories.has(directory)) throw error('CONFIGURATION_ERROR', 'Give each original merchant directory one workspace alias.');
    directories.add(directory);
    workspaces[workspace] = {
      label: line(input.label ?? workspace, 'paid-job workspace label'), directory,
      source: { ...input.source },
      ...(input.launchFile === undefined ? { urlFile: hostPath(input.urlFile, base) } : { launchFile: hostPath(input.launchFile, base) }),
      ...(input.runtimeDirectory === undefined ? {} : { runtimeDirectory: hostPath(input.runtimeDirectory, base) }),
      ...(input.selectionSha256 === undefined ? {} : { selectionSha256: input.selectionSha256 }),
    };
  }
  return { schema: PAID_JOB_WORKSPACE_CONNECTION_SCHEMA, selectionSha256: hash(bytes), workspaces };
}

/** Borrows the original authenticated listener and owns only its requests/read handles. */
export class MerchantPaidJobWorkspaces {
  #workspaces; #active = new Set(); #controllers = new Set(); #reads = new Map(); #closing = false; #closed;
  constructor(config) { this.#workspaces = config.paidJobWorkspaces?.workspaces ?? Object.create(null); }
  get summary() {
    return { configured: Object.keys(this.#workspaces).length > 0, ownership: 'ORIGINAL_PAID_JOB_MERCHANT',
      workspaces: Object.entries(this.#workspaces).map(([workspace, item]) => ({
        workspace, label: item.label, source: item.source, launch: item.launchFile ? 'MANAGED_APPLICATION' : 'ORIGINAL_OPERATOR_URL' })),
      activeCalls: this.#active.size, activeFileReads: this.#reads.size, closing: this.#closing };
  }
  async #attach(workspace, signal) {
    const selected = this.#workspaces[workspace];
    if (!selected) throw error('JOB_AGENT_WORKSPACE_NOT_CONFIGURED', 'Choose a host-declared original paid-job workspace alias.');
    await privateDirectory(selected.directory); signal?.throwIfAborted();
    const expected = { directory: selected.directory,
      ...(selected.runtimeDirectory ? { runtimeDirectory: selected.runtimeDirectory } : {}),
      ...(selected.selectionSha256 ? { selectionSha256: selected.selectionSha256 } : {}) };
    let identity, url, launch = null;
    try {
      if (selected.launchFile) {
        launch = await readJobServiceLaunch({ file: selected.launchFile, expected, signal });
        url = privateJobWorkspaceUrl(launch.operator);
        // The managed launch reader has already authenticated its complete native
        // selection. Reuse its fixed source and instance for this operation.
        identity = launch.workspaceIdentity;
      } else {
        url = privateJobWorkspaceUrl(decode(await privateBytes(selected.urlFile, 4096)).trim());
        identity = await readJobWorkspaceIdentity({ url: url.href, expected, signal });
      }
    } catch (cause) {
      if (cause.code === 'ENOENT' || cause.code === 'ECONNREFUSED')
        throw error('JOB_AGENT_WORKSPACE_NOT_RUNNING',
          'Start the selected saved merchant in Applications or its original jobs serve command, then repeat this same request.', 409);
      throw cause;
    }
    if (identity.source.configSha256 !== selected.source.configSha256 ||
        identity.source.applicationSha256 !== selected.source.applicationSha256)
      throw error('JOB_AGENT_SOURCE_CHANGED', 'The running merchant differs from the host-selected configuration or application SHA256.', 409);
    return { selected, identity, origin: url.origin, token: url.hash.slice(1), startedAt: launch?.startedAt ?? null };
  }
  async #http(attached, method, route, input, signal, { maximum = REQUEST_BYTES, timeoutMs = 120000 } = {}) {
    const encoded = input === undefined ? undefined : JSON.stringify(input);
    if (encoded !== undefined && Buffer.byteLength(encoded) > maximum)
      throw error('JOB_AGENT_INVALID_PARAMS', 'The original request exceeds this endpoint’s complete-body limit.', 413);
    const timeout = AbortSignal.timeout(timeoutMs), requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(attached.origin + route, { method, redirect: 'error', signal: requestSignal,
      headers: { authorization: 'Bearer ' + attached.token, origin: attached.origin, accept: 'application/json',
        ...(encoded === undefined ? {} : { 'content-type': 'application/json' }) },
      body: encoded });
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.byteLength;
      if (bytes > REPLY_BYTES) throw error('JOB_AGENT_REPLY_LIMIT',
        'Read this original record by case section or through its complete retained export; the direct response exceeds eight MiB.', 413);
      chunks.push(Buffer.from(chunk));
    }
    let value;
    try { value = JSON.parse(decode(Buffer.concat(chunks, bytes))); }
    catch { throw error('JOB_AGENT_REPLY_INVALID', 'The original merchant returned an invalid UTF-8 JSON reply.'); }
    if (!response.ok) throw error(/^[A-Z][A-Z0-9_]{0,127}$/.test(value?.code ?? '') ? value.code : 'JOB_AGENT_HTTP_' + response.status,
      typeof value?.message === 'string' ? value.message : 'The original merchant rejected this operation.', response.status);
    if (!plain(value)) throw error('JOB_AGENT_REPLY_INVALID', 'The original merchant did not return an object.');
    return value;
  }
  #rememberRead(workspace, input, value, attached) {
    if (input.readId) this.#reads.delete(workspace + ':' + input.readId);
    if (value.readId && value.nextOffset !== null) {
      for (const [key, read] of this.#reads) if (Date.now() - read.touched > 180000) this.#reads.delete(key);
      this.#reads.set(workspace + ':' + value.readId, { workspace, exportId: input.exportId,
        readId: value.readId, attached, touched: Date.now() });
    }
  }
  async #execute(name, workspace, input, signal, requestOptions = {}) {
    const action = name.slice('merchant_jobs_'.length);
    if (action === 'case_receive') {
      identifier(input.sourceWorkspace, 'source paid-job workspace alias');
      const { readPaidJobCaseSource } = await import('./paid-jobs-client.mjs');
      const source = await readPaidJobCaseSource({ workspace: input.sourceWorkspace,
        client: { endpoint: 'original-paid-job-workspaces',
          call: (tool, args, options = {}) => {
            const { workspace: sourceWorkspace, ...fields } = args;
            const selectedSignal = Object.hasOwn(options, 'requestSignal') ? options.requestSignal : signal;
            return this.#execute(tool, sourceWorkspace, fields, selectedSignal,
              options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs });
          } },
        exportId: input.exportId, expectedManifestSha256: input.expectedManifestSha256, signal });
      signal?.throwIfAborted();
      const attached = await this.#attach(workspace, signal);
      const received = await this.#http(attached, 'POST', '/api/job-agent/receive', source, signal,
        { maximum: RESOLUTION_RECEIVING_BYTES });
      return { ...received, workspace, sourceWorkspace: input.sourceWorkspace,
        exportId: input.exportId, manifestSha256: input.expectedManifestSha256 };
    }
    const attached = await this.#attach(workspace, signal);
    if (['deliveries','delivery_control'].includes(action) && !attached.identity.capabilities.delivery)
      throw error('JOB_AGENT_DELIVERY_NOT_CONFIGURED', 'Open this merchant with its existing result-delivery configuration before operating deliveries.', 409);
    let method = 'POST', route = '/api/job-agent/' + action, body = input;
    if (action === 'cancel' || action === 'retry') {
      const { jobId, ...decision } = input;
      route = '/api/jobs/' + encodeURIComponent(jobId) + '/' + action; body = decision;
    } else if (action === 'worker') {
      route = '/api/worker/' + input.action; body = {};
    } else if (action === 'reconcile') {
      route = '/api/reconcile'; body = {};
    } else if (action === 'deliveries') {
      route = '/api/deliveries' + (input.deliveryId ? '/' + input.deliveryId : ''); method = 'GET'; body = undefined;
    } else if (action === 'delivery_control') {
      if (input.action === 'requeue') {
        checked(input.deliveryId, SHA, 'delivery ID');
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
            typeof input.reason !== 'string' || !input.reason.trim())
          throw error('JOB_AGENT_INVALID_PARAMS', 'Requeue the selected delivery with its current revision and reason.');
        route = '/api/deliveries/' + input.deliveryId + '/requeue';
        body = { expectedRevision: input.expectedRevision, reason: input.reason };
      } else {
        if (['deliveryId','expectedRevision','reason'].some(key => Object.hasOwn(input, key)))
          throw error('JOB_AGENT_INVALID_PARAMS', 'Use delivery selection fields only with the requeue action.');
        route = '/api/deliveries/' + input.action; body = {};
      }
    }
    const value = await this.#http(attached, method, route, body, signal, requestOptions);
    if (action === 'file') this.#rememberRead(workspace, input, value, attached);
    if (action === 'file_release') this.#reads.delete(workspace + ':' + input.readId);
    const result = { ...value, workspace };
    if (action === 'status') result.launch = { instanceId: attached.identity.instanceId, pid: attached.identity.pid,
      startedAt: attached.startedAt, source: attached.identity.source,
      selectionSha256: attached.identity.service?.selectionSha256 ?? null };
    return result;
  }
  call(name, args = {}) {
    if (this.#closing) return Promise.reject(error('JOB_AGENT_CLOSING', 'The paid-job merchant adapter is closing.'));
    const definition = definitions.get(name);
    if (!definition) return Promise.reject(error('TOOL_NOT_FOUND', 'Unknown original paid-job merchant tool.'));
    exact(args, Object.keys(definition.properties), definition.required);
    for (const [key, value] of Object.entries(args)) property(value, definition.properties[key], key);
    const workspace = identifier(args.workspace, 'paid-job workspace alias'), { workspace: ignored, ...input } = args;
    const controller = new AbortController(); this.#controllers.add(controller);
    const pending = this.#execute(name, workspace, JSON.parse(JSON.stringify(input)), controller.signal);
    this.#active.add(pending);
    pending.finally(() => { this.#active.delete(pending); this.#controllers.delete(controller); }).catch(() => {});
    return pending;
  }
  cancel() {
    this.#closing = true;
    for (const controller of this.#controllers) controller.abort(error('JOB_AGENT_CLOSING', 'The paid-job merchant adapter is closing.'));
  }
  close() {
    return this.#closed ??= (async () => {
      this.cancel(); await Promise.allSettled([...this.#active]);
      await Promise.allSettled([...this.#reads.values()].map(read =>
        this.#http(read.attached, 'POST', '/api/job-agent/file_release',
          { exportId: read.exportId, readId: read.readId }, undefined, { timeoutMs: 2000 })));
      this.#reads.clear();
    })();
  }
}
