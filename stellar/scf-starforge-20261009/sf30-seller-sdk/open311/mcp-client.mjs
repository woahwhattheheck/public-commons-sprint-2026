// MIT. Host-selected source inputs and a typed adapter for the existing merchant transport.
import { basename, dirname, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readPrivateJson } from '../routescan/quota.mjs';
import { exact, plain, line, identifier, fileBytes, privateSupportDirectory, failure } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { canonicalJson } from './domain.mjs';

export const OPEN311_HOST_SCHEMA = 'stellar-forge.open311-workspace-host.v1';
export const OPEN311_MAX_INPUT_BYTES = 192 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(canonicalJson(value));
const requireValue = (ok, message, code = 'INVALID_PARAMS') => { if (!ok) throw failure(code, message); };
const connectionFields = ['id', 'name', 'baseUrl', 'jurisdictionId', 'discoveryUrl', 'apiKeyEnv',
  'apiKeyParameter', 'allowHttp', 'pagination', 'extendedAttributes', 'responseLimit',
  'statusValues', 'queryExtensions', 'timeoutMs', 'maxResponseBytes', 'attribution'];
function pathText(value, label) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 8192 &&
    !/[\x00-\x1f\x7f]/.test(value), 'Select the host ' + label + '.');
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export async function readOpen311WorkspaceConfiguration(path) {
  path = resolve(pathText(path, 'connection file'));
  const raw = await readPrivateJson(path, 1024 * 1024);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  requireValue(raw.schema === OPEN311_HOST_SCHEMA && plain(raw.workspaces) &&
    Object.keys(raw.workspaces).length >= 1 && Object.keys(raw.workspaces).length <= 128,
    'Declare one to 128 original municipal workspace aliases.', 'CONFIGURATION_ERROR');
  const workspaces = Object.create(null), base = dirname(path), directories = new Set();
  for (const [alias, value] of Object.entries(raw.workspaces)) {
    identifier(alias, 'Workspace alias');
    exact(value, ['label', 'directory', 'inputs', 'connectionProfiles'], ['directory']);
    const directory = resolve(base, pathText(value.directory, 'workspace directory'));
    await privateSupportDirectory(directory);
    requireValue(await realpath(directory) === directory && !directories.has(directory),
      'Each workspace alias must select a distinct original private directory.', 'CONFIGURATION_ERROR');
    directories.add(directory);
    const entry = { label: line(value.label ?? alias, 'Workspace label'), directory,
      inputs: Object.create(null), connectionProfiles: Object.create(null) };
    requireValue(plain(value.inputs ?? {}) && plain(value.connectionProfiles ?? {}),
      'Declare host input and connection-profile objects.', 'CONFIGURATION_ERROR');
    requireValue(Object.keys(value.inputs ?? {}).length <= 128 && Object.keys(value.connectionProfiles ?? {}).length <= 128,
      'Keep at most 128 input aliases and 128 source profiles per workspace.', 'CONFIGURATION_ERROR');
    for (const [name, input] of Object.entries(value.inputs ?? {})) {
      identifier(name, 'Input alias');
      exact(input, ['label', 'path', 'sha256'], ['path', 'sha256']);
      requireValue(hashPattern.test(input.sha256 ?? ''), 'Pin each original input file SHA-256.', 'CONFIGURATION_ERROR');
      entry.inputs[name] = { label: line(input.label ?? name, 'Input label'),
        path: resolve(base, pathText(input.path, 'input file')), sha256: input.sha256 };
    }
    for (const [name, profile] of Object.entries(value.connectionProfiles ?? {})) {
      identifier(name, 'Connection profile alias');
      exact(profile, connectionFields, ['baseUrl']);
      const configured = clone({ ...profile, id: profile.id ?? name, name: profile.name ?? name });
      requireValue(/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(configured.id),
        'Use the original connection ID in a source profile.', 'CONFIGURATION_ERROR');
      let url;
      try { url = new URL(configured.baseUrl); } catch { throw failure('CONFIGURATION_ERROR', 'Select an absolute civic API base URL.'); }
      requireValue(['https:', 'http:'].includes(url.protocol) &&
        (url.protocol !== 'http:' || configured.allowHttp === true) &&
        !url.username && !url.password && !url.search && !url.hash,
        'Use a complete civic API base URL without inline credentials or query parameters.', 'CONFIGURATION_ERROR');
      if (configured.apiKeyEnv !== undefined)
        requireValue(/^[A-Za-z_][A-Za-z0-9_]*$/.test(configured.apiKeyEnv), 'Use an environment variable name for source credentials.', 'CONFIGURATION_ERROR');
      entry.connectionProfiles[name] = configured;
    }
    workspaces[alias] = entry;
  }
  return freeze({ schema: OPEN311_HOST_SCHEMA, path, workspaces });
}
export async function readOpen311HostInput(entry, name, expectedSha256) {
  const input = entry.inputs[name];
  requireValue(input, 'Select a configured original workspace input.', 'OPEN311_INPUT_UNKNOWN');
  if (expectedSha256 !== undefined)
    requireValue(expectedSha256 === input.sha256, 'The input selection differs from its configured SHA-256.', 'OPEN311_INPUT_CHANGED');
  const bytes = await fileBytes(input.path, OPEN311_MAX_INPUT_BYTES), sha256 = digest(bytes);
  requireValue(sha256 === input.sha256, 'The original input file changed.', 'OPEN311_INPUT_CHANGED');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('OPEN311_INPUT_INVALID', 'The original workspace input must contain complete UTF-8 JSON.'); }
  requireValue(value?.schema === 'commons.open311.workspace-export.v1' && plain(value.payload) && plain(value.manifest),
    'Select a complete original Open311 workspace export.', 'OPEN311_INPUT_INVALID');
  return { input, bytes, value, sha256, name: basename(input.path) };
}
function toolValue(result) {
  if (result?.isError) {
    const detail = result.structuredContent?.error;
    const message = detail?.message ?? result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') ?? 'The merchant operation failed.';
    throw Object.assign(new Error(message), { code: detail?.code ?? 'OPEN311_MERCHANT_ERROR', result });
  }
  if (result && Object.hasOwn(result, 'structuredContent') && result.structuredContent !== undefined)
    return result.structuredContent;
  if (Array.isArray(result?.content)) {
    const content = result.content.filter(item => item.type === 'text');
    requireValue(content.length === 1, 'The merchant returned an unexpected tool response.', 'OPEN311_MERCHANT_RESPONSE');
    try { return JSON.parse(content[0].text); }
    catch { throw failure('OPEN311_MERCHANT_RESPONSE', 'The merchant tool response must contain its complete JSON value.'); }
  }
  return result;
}
export class Open311MerchantClient {
  #callTool; #workspace;
  constructor(callTool, workspace) {
    requireValue(typeof callTool === 'function', 'Supply the existing merchant callTool adapter.');
    this.#callTool = callTool; this.#workspace = identifier(workspace, 'Workspace alias');
  }
  call(name, input = {}) {
    requireValue(typeof name === 'string' && name.startsWith('merchant_open311_'), 'Select an Open311 merchant tool.');
    const args = clone(name === 'merchant_open311_workspaces' ? input : { ...input, workspace: this.#workspace });
    return Promise.resolve().then(() => this.#callTool(name, args)).then(toolValue);
  }
  workspaces() { return this.call('merchant_open311_workspaces'); }
  status() { return this.call('merchant_open311_status'); }
  records(kind, input) { return this.call('merchant_open311_records', { ...input, kind }); }
  configure(input) { return this.call('merchant_open311_connection_put', input); }
  capture(input) { return this.call('merchant_open311_capture', input); }
  captureInfo(id) { return this.call('merchant_open311_capture_info', { id }); }
  services(input) { return this.call('merchant_open311_services', input); }
  requests(input) { return this.call('merchant_open311_requests', input); }
  request(input) { return this.call('merchant_open311_request', input); }
  diff(input) { return this.call('merchant_open311_diff', input); }
  review(input) { return this.call('merchant_open311_review_put', input); }
  operation(requestId) { return this.call('merchant_open311_operation', { requestId }); }
  input(input) { return this.call('merchant_open311_input', { input }); }
  receive(input) { return this.call('merchant_open311_receive', input); }
  readFile(selection, continuation = {}) {
    return this.call('merchant_open311_file_read', { ...selection, ...continuation });
  }
  releaseFile(readId) { return this.call('merchant_open311_file_release', { readId }); }
  async downloadFile(selection, { limit = 196608, maximumBytes = 256000000, onChunk } = {}) {
    requireValue(Number.isSafeInteger(maximumBytes) && maximumBytes > 0, 'Set a positive download size limit.');
    requireValue(onChunk === undefined || typeof onChunk === 'function', 'Use an async byte sink for streaming downloads.');
    const chosen = clone(selection), parts = [], hash = createHash('sha256');
    let offset = 0, file, readId, expectedSha256, completed = false;
    try {
      for (;;) {
        const chunk = await this.readFile(chosen, { limit, offset,
          ...(readId ? { readId } : {}), ...(expectedSha256 ? { expectedSha256 } : {}) });
        requireValue(chunk?.encoding === 'base64' && chunk.offset === offset &&
          hashPattern.test(chunk.file?.sha256 ?? '') && Number.isSafeInteger(chunk.file?.bytes) &&
          chunk.file.bytes >= 0 && chunk.file.bytes <= maximumBytes, 'The retained download metadata changed.', 'OPEN311_DOWNLOAD_CHANGED');
        if (!file) { file = clone(chunk.file); expectedSha256 = file.sha256; }
        else requireValue(canonicalJson(file) === canonicalJson(chunk.file),
          'The retained download selection changed.', 'OPEN311_DOWNLOAD_CHANGED');
        readId = chunk.readId;
        const bytes = Buffer.from(chunk.data, 'base64');
        requireValue(bytes.toString('base64') === chunk.data && bytes.length === chunk.bytesRead &&
          offset + bytes.length <= file.bytes, 'The retained download bytes changed.', 'OPEN311_DOWNLOAD_CHANGED');
        hash.update(bytes);
        if (onChunk) await onChunk(bytes, { file, offset }); else parts.push(bytes);
        offset += bytes.length;
        if (chunk.nextOffset === null) {
          requireValue(offset === file.bytes && hash.digest('hex') === file.sha256,
            'The complete downloaded file differs from its source hash.', 'OPEN311_DOWNLOAD_CHANGED');
          completed = true;
          return { file, bytesRead: offset, ...(onChunk ? {} : { bytes: Buffer.concat(parts, offset) }) };
        }
        requireValue(chunk.nextOffset === offset && bytes.length > 0,
          'The retained reader did not advance by its original byte count.', 'OPEN311_DOWNLOAD_CHANGED');
      }
    } catch (error) {
      if (file) error.continuation = { selection: chosen, expectedSha256: file.sha256, offset, file };
      throw error;
    } finally {
      if (!completed && readId) await this.releaseFile(readId).catch(() => {});
    }
  }
}
