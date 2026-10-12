// MIT. Follow the original managed WQX project and its current private loopback host.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain } from './host-files.mjs';

export const WQX_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.wqx-workspace-connection.v1';
export const WQX_MAX_FILE_BYTES = 128 * 1024 * 1024;
export const WQX_SHA = /^[0-9a-f]{64}$/;
export const WQX_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
export const wqxHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const wqxJson = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function wqxId(value, label = 'original identifier') {
  if (typeof value !== 'string' || !WQX_ID.test(value)) throw failure('INVALID_PARAMS', 'Choose the exact ' + label + '.');
  return value;
}
export function wqxDigest(value, label = 'SHA256') {
  if (typeof value !== 'string' || !WQX_SHA.test(value)) throw failure('INVALID_PARAMS', 'Use the complete original ' + label + '.');
  return value;
}
export function wqxInteger(value, minimum, maximum, label = 'integer') {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw failure('INVALID_PARAMS', 'Use ' + label + ' within its declared range.');
  return value;
}
export function wqxHostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw failure('CONFIGURATION_ERROR', 'Choose an original host path in the connection file.');
  return resolve(base, value);
}
export async function wqxPrivateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path ||
      process.platform !== 'win32' && ((info.mode & 0o077) || process.getuid && info.uid !== process.getuid()))
    throw failure('WQX_PRIVATE_DIRECTORY', 'Use an owned canonical private directory (0700).');
  return path;
}
const unchanged = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid'].every(key => a[key] === b[key]);
export async function wqxPrivateFile(path, maximum = WQX_MAX_FILE_BYTES, { writable = false } = {}) {
  if (await realpath(dirname(path)) !== dirname(path)) throw failure('WQX_FILE_CHANGED', 'The selected file parent changed.');
  const handle = await open(path, (writable ? constants.O_RDWR : constants.O_RDONLY) | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const identity = await handle.stat({ bigint: true });
    if (!identity.isFile() || identity.size < 0n || identity.size > BigInt(maximum) || identity.nlink !== 1n ||
        process.platform !== 'win32' && ((identity.mode & 0o077n) || process.getuid && identity.uid !== BigInt(process.getuid())))
      throw failure('WQX_PRIVATE_FILE', 'Use an owned private regular file within the original size limit.');
    return { handle, identity };
  } catch (error) { await handle.close(); throw error; }
}
export async function wqxReadPrivate(path, maximum = WQX_MAX_FILE_BYTES, expectedSha256) {
  const { handle, identity } = await wqxPrivateFile(path, maximum);
  try {
    const bytes = await handle.readFile();
    if (bytes.length !== Number(identity.size) || !unchanged(identity, await handle.stat({ bigint: true })) ||
        expectedSha256 !== undefined && wqxHash(bytes) !== wqxDigest(expectedSha256))
      throw failure('WQX_FILE_CHANGED', 'The original selected file changed while being read.');
    return bytes;
  } finally { await handle.close(); }
}
export async function wqxDescribeFile(path, maximum = WQX_MAX_FILE_BYTES, expectedSha256) {
  const { handle, identity } = await wqxPrivateFile(path, maximum), digest = createHash('sha256');
  try {
    for await (const bytes of handle.createReadStream({ start: 0, autoClose: false })) digest.update(bytes);
    const sha256 = digest.digest('hex');
    if (!unchanged(identity, await handle.stat({ bigint: true })) ||
        expectedSha256 !== undefined && sha256 !== wqxDigest(expectedSha256))
      throw failure('WQX_FILE_CHANGED', 'The retained file differs from its original identity.');
    return { bytes: Number(identity.size), sha256 };
  } finally { await handle.close(); }
}
export function wqxDecode(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('WQX_JSON_REQUIRED', 'Use one complete original UTF-8 JSON document.'); }
}
async function privateJson(path, maximum = 65536) { return wqxDecode(await wqxReadPrivate(path, maximum)); }
function entries(value, maximum, label) {
  if (!plain(value) || Object.keys(value).length > maximum) throw failure('CONFIGURATION_ERROR', 'Declare at most ' + maximum + ' ' + label + '.');
  return Object.entries(value);
}
export async function readWqxWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await privateJson(path, 1024 * 1024), base = dirname(path);
  exact(raw, ['schema', 'workspaces', 'inputs', 'captures'], ['schema', 'workspaces']);
  if (raw.schema !== WQX_WORKSPACE_CONNECTION_SCHEMA || !Object.keys(raw.workspaces ?? {}).length)
    throw failure('CONFIGURATION_ERROR', 'Choose an original WQX workspace connection with at least one managed project.');
  const workspaces = Object.create(null), inputs = Object.create(null), captures = Object.create(null), directories = new Set();
  for (const [alias, value] of entries(raw.workspaces, 32, 'named managed projects')) {
    identifier(alias, 'Workspace alias');
    exact(value, ['label', 'directory', 'projectBindingId', 'expectedSourceSha256'], ['directory', 'projectBindingId']);
    const directory = await wqxPrivateDirectory(wqxHostPath(value.directory, base));
    if (directories.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original managed project one workspace alias.');
    directories.add(directory);
    const binding = await privateJson(join(directory, 'managed-water-quality-binding.json'));
    if (binding.schema !== 'stellar-forge.wqx-managed-project.v1' || binding.directory !== directory ||
        typeof value.projectBindingId !== 'string' || binding.id !== value.projectBindingId)
      throw failure('WQX_PROJECT_CHANGED', 'The configured project differs from its original managed binding.');
    workspaces[alias] = { label: line(value.label ?? alias), directory, projectBindingId: binding.id,
      ...(value.expectedSourceSha256 === undefined ? {} : { expectedSourceSha256: wqxDigest(value.expectedSourceSha256) }) };
  }
  for (const [alias, value] of entries(raw.inputs ?? {}, 64, 'named complete input files')) {
    identifier(alias, 'Input alias');
    exact(value, ['label', 'file', 'sha256', 'bytes', 'contentType'], ['file', 'sha256']);
    const file = wqxHostPath(value.file, base), sha256 = wqxDigest(value.sha256);
    const observed = await wqxDescribeFile(file, WQX_MAX_FILE_BYTES, sha256);
    if (value.bytes !== undefined && observed.bytes !== wqxInteger(value.bytes, 0, WQX_MAX_FILE_BYTES, 'file length'))
      throw failure('WQX_FILE_CHANGED', 'The original configured input length changed.');
    inputs[alias] = { label: line(value.label ?? alias), file, ...observed,
      contentType: line(value.contentType ?? 'application/json', 'Input content type') };
  }
  for (const [alias, value] of entries(raw.captures ?? {}, 32, 'named original capture directories')) {
    identifier(alias, 'Capture source alias');
    exact(value, ['label', 'directory', 'captureSha256'], ['directory', 'captureSha256']);
    captures[alias] = { label: line(value.label ?? alias),
      directory: await wqxPrivateDirectory(wqxHostPath(value.directory, base)), captureSha256: wqxDigest(value.captureSha256) };
  }
  return { schema: WQX_WORKSPACE_CONNECTION_SCHEMA, connectionFile: path, workspaces, inputs, captures };
}
export function wqxPublic(value) {
  if (Array.isArray(value)) return value.map(wqxPublic);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['token', 'directory', 'root', 'sourceDirectory', 'buyerConfig', 'privateKey', 'secretKey', 'environment', 'promise'].includes(key))
    .map(([key, item]) => [key, wqxPublic(item)]));
}
export async function readWqxManagedLaunch(entry) {
  await wqxPrivateDirectory(entry.directory);
  const [binding, launch] = await Promise.all([
    privateJson(join(entry.directory, 'managed-water-quality-binding.json')),
    privateJson(join(entry.directory, 'managed-water-quality-launch.json')),
  ]);
  if (binding.schema !== 'stellar-forge.wqx-managed-project.v1' || binding.directory !== entry.directory ||
      binding.id !== entry.projectBindingId || launch.schema !== 'stellar-forge.wqx-managed-startup.v1' ||
      launch.status !== 'WQX_MANAGED_READY' || launch.directory !== entry.directory || launch.projectBindingId !== binding.id)
    throw failure('WQX_MANAGED_NOT_RUNNING', 'Start or reopen this saved WQX project through its original Applications or managed command.');
  wqxId(launch.launchId, 'managed launch identifier'); wqxDigest(launch.sourceSha256); wqxDigest(launch.selectionSha256);
  if (entry.expectedSourceSha256 !== undefined && launch.sourceSha256 !== entry.expectedSourceSha256)
    throw failure('WQX_MANAGED_SOURCE_CHANGED', 'The current managed source differs from the selected connection.');
  const url = new URL(launch.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || !url.port ||
      url.username || url.password || url.search || url.hash)
    throw failure('WQX_MANAGED_LISTENER_CHANGED', 'Use the private loopback listener retained by the original managed host.');
  wqxInteger(launch.pid, 1, Number.MAX_SAFE_INTEGER, 'managed process identifier');
  try { process.kill(launch.pid, 0); }
  catch (error) { if (error.code !== 'EPERM') throw failure('WQX_MANAGED_NOT_RUNNING', 'The original managed host has stopped. Reopen the saved application.'); }
  return { value: launch, sha256: wqxHash(wqxJson(launch)), origin: url.origin };
}
export function wqxLaunchView(launch) {
  const value = launch.value;
  return { launchId: value.launchId, projectBindingId: value.projectBindingId, sourceSha256: value.sourceSha256,
    selectionSha256: value.selectionSha256, projectRevision: value.projectRevision, pid: value.pid };
}
async function responseBytes(response, maximum) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel(); throw failure('WQX_RESPONSE_TOO_LARGE', 'The original response exceeds the selected complete-file limit.');
  }
  const chunks = []; let total = 0;
  try {
    for await (const bytes of response.body ?? []) {
      total += bytes.length;
      if (total > maximum) throw failure('WQX_RESPONSE_TOO_LARGE', 'The original response exceeds the selected complete-file limit.');
      chunks.push(Buffer.from(bytes));
    }
  } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
  if (declared !== null && Number(declared) !== total) throw failure('WQX_RESPONSE_INCOMPLETE', 'The complete original response was interrupted.');
  return Buffer.concat(chunks, total);
}
export class WqxWorkspaceConnection {
  #entry; #launch; #token; #workspace;
  constructor(entry) { this.#entry = entry; }
  get launch() { return this.#launch; }
  get workspace() { return this.#workspace; }
  async assertCurrent() {
    const current = await readWqxManagedLaunch(this.#entry);
    if (!this.#launch || current.sha256 !== this.#launch.sha256)
      throw failure('WQX_MANAGED_LAUNCH_CHANGED', 'The original managed host changed during this operation. Reopen the same saved result in the current launch.');
  }
  async open() {
    this.#launch = await readWqxManagedLaunch(this.#entry);
    const response = await this.request('/api/workspace');
    const value = wqxDecode(await responseBytes(response, 16 * 1024 * 1024));
    if (!plain(value) || typeof value.token !== 'string' || !/^[0-9a-f]{64}$/.test(value.token) ||
        !Array.isArray(value.captures) || !Array.isArray(value.reviews) || !Array.isArray(value.openWaters) ||
        !Array.isArray(value.reviewSheets))
      throw failure('WQX_WORKSPACE_SOURCE_REQUIRED', 'Use the original complete water-quality workspace with Bulk decisions installed.');
    if (value.project && this.#launch.value.projectRevision !== null &&
        (!Number.isSafeInteger(value.project.revision) || value.project.revision < this.#launch.value.projectRevision))
      throw failure('WQX_PROJECT_CHANGED', 'The open workspace precedes its saved managed launch.');
    this.#token = value.token;
    const { token, ...workspace } = value; this.#workspace = workspace;
    await this.assertCurrent(); return this;
  }
  async request(path, input, { maximumRequestBytes = 2 * 1024 * 1024 } = {}) {
    if (!this.#launch || typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//') || /[\r\n#]/.test(path))
      throw failure('INVALID_PARAMS', 'Select an original WQX operation.');
    const changing = input !== undefined, body = changing ? JSON.stringify(input) : undefined;
    if (changing && (!this.#token || Buffer.byteLength(body) > maximumRequestBytes))
      throw failure('WQX_REQUEST_TOO_LARGE', 'Use one complete original request within its native limit.');
    let response;
    try {
      response = await fetch(this.#launch.origin + path, {
        method: changing ? 'POST' : 'GET', redirect: 'error', cache: 'no-store',
        headers: changing ? { 'content-type': 'application/json', 'x-workspace-token': this.#token } : {},
        body, signal: AbortSignal.timeout(240000),
      });
    } catch (error) {
      const failureValue = failure(changing ? 'WQX_TRANSPORT_UNCERTAIN' : 'WQX_TRANSPORT_UNAVAILABLE',
        changing ? 'Read the same original operation or saved identifiers before resuming this interrupted request.'
          : 'The current managed host could not return the original response.');
      failureValue.launchId = this.#launch.value.launchId; failureValue.operation = path; throw failureValue;
    }
    if (!response.ok) {
      let value;
      try { value = wqxDecode(await responseBytes(response, 65536)); }
      catch { throw failure('WQX_HTTP_ERROR', 'The original WQX host returned HTTP ' + response.status + '.'); }
      const error = failure(typeof value?.error?.code === 'string' ? value.error.code : 'WQX_HTTP_ERROR',
        typeof value?.error?.message === 'string' ? value.error.message : 'The original WQX operation did not complete.');
      error.status = response.status;
      for (const key of ['retryAt', 'retryAfter']) if (value?.error?.[key] !== undefined) error[key] = value.error[key];
      throw error;
    }
    return response;
  }
  async json(path, input, options = {}) {
    const response = await this.request(path, input, options);
    const value = wqxDecode(await responseBytes(response, options.maximumResponseBytes ?? WQX_MAX_FILE_BYTES));
    await this.assertCurrent(); return value;
  }
}
