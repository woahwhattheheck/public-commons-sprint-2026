// MIT. Managed launch of the original OpenCage workspace and private operator.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { GeocodeWorkspace } from './workspace.mjs';
import { createGeocodeServer } from './server.mjs';
import { digest, jsonBytes } from '../twelvedata/files.mjs';
import { fail } from './config.mjs';

export const OPENCAGE_APPLICATION_SCHEMA = 'stellar-forge.opencage-application-startup.v1';
export const OPENCAGE_SELECTION_SCHEMA = 'stellar-forge.opencage-application-selection.v1';
export const OPENCAGE_SOURCE_FILES = Object.freeze([
  'launch.mjs', 'cli.mjs', 'config.mjs', 'customer.mjs', 'index.mjs', 'merchant.mjs',
  'batch.mjs', 'batch-delivery.mjs', 'ui/batch.js',
  'server.mjs', 'source.mjs', 'workspace.mjs', 'ui/app.js', 'ui/index.html', 'ui/style.css',
]);
const SOURCE_SCHEMA = 'stellar-forge.opencage-application-source.v1';
const WORKSPACE_SCHEMA = 'stellar-forge.opencage-application-workspace.v1';
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => digest(jsonBytes(canonical(value)));
const need = (ok, code = 'GEOCODE_MANAGED_SELECTION_CHANGED') => {
  if (!ok) fail(code, 'Review the current saved workspace and installed OpenCage source before starting.');
};
const keys = (value, names) => need(object(value) && Object.keys(value).length === names.length &&
  names.every(name => Object.hasOwn(value, name)));
const inode = value => ({ device: String(value.dev), inode: String(value.ino) });
const same = (left, right) => hash(left) === hash(right);
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !value.includes('\0'), 'GEOCODE_MANAGED_PATH_REQUIRED');
  return value;
}
async function directory(path) {
  absolute(path);
  const stat = await lstat(path, { bigint: true });
  need(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path,
    'GEOCODE_MANAGED_PATH_CHANGED');
  return inode(stat);
}
async function file(path, maxBytes = 2097152) {
  absolute(path);
  need(await realpath(path) === path, 'GEOCODE_MANAGED_PATH_CHANGED');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= maxBytes, 'GEOCODE_MANAGED_FILE_INVALID');
    const bytes = await handle.readFile(), after = await handle.stat();
    need(bytes.length === before.size && after.size === before.size &&
      after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
    'GEOCODE_MANAGED_FILE_CHANGED');
    return { bytes, sha256: digest(bytes) };
  } finally { await handle.close(); }
}

/** Read the original immutable configuration. Mutable requests, candidate
 * decisions, exports, packages and release generations do not enter this hash. */
export async function inspectGeocodeWorkspaceBinding(path, { expectedSha256 } = {}) {
  const before = await directory(path), configurationFile = join(path, 'configuration.json');
  const first = await file(configurationFile, 1048576);
  const workspace = await GeocodeWorkspace.open(path, { readOnly: true, env: {} });
  let configuration;
  try { configuration = structuredClone(workspace.configuration); }
  finally { await workspace.close(); }
  const last = await file(configurationFile, 1048576), after = await directory(path);
  need(same(before, after) && first.sha256 === last.sha256, 'GEOCODE_MANAGED_WORKSPACE_CHANGED');
  const value = {
    schema: WORKSPACE_SCHEMA, directory: path, directoryIdentity: after,
    workspaceIdentity: configuration.identity, configurationFile,
    configurationSha256: last.sha256, configurationCanonicalSha256: hash(configuration),
    planSha256: configuration.planSha256, termsSha256: configuration.termsSha256,
  };
  const sha256 = hash(value);
  need(expectedSha256 === undefined || expectedSha256 === sha256, 'GEOCODE_MANAGED_WORKSPACE_CHANGED');
  return { ...value, sha256 };
}

/** The selected and adopted runtime paths may differ; the native source bytes
 * and UI assets must be the same exact ordered set. */
export async function inspectGeocodeLaunchSource(path, { expectedSha256 } = {}) {
  await directory(path);
  const files = [];
  for (const name of OPENCAGE_SOURCE_FILES) {
    const value = await file(join(path, name));
    files.push({ name, bytes: value.bytes.length, sha256: value.sha256 });
  }
  const body = { schema: SOURCE_SCHEMA, files }, sha256 = hash(body);
  need(expectedSha256 === undefined || expectedSha256 === sha256, 'GEOCODE_MANAGED_SOURCE_CHANGED');
  return { ...body, directory: path, sha256 };
}

export function readGeocodeManagedSelection(value) {
  if (typeof value === 'string') {
    need(Buffer.byteLength(value) <= 16384, 'GEOCODE_MANAGED_SELECTION_INVALID');
    try { value = JSON.parse(value); }
    catch { fail('GEOCODE_MANAGED_SELECTION_INVALID'); }
  }
  keys(value, ['schema', 'workspace', 'source', 'sha256']);
  need(value.schema === OPENCAGE_SELECTION_SCHEMA && HASH.test(value.sha256));
  keys(value.workspace, ['schema', 'directory', 'directoryIdentity', 'workspaceIdentity',
    'configurationFile', 'configurationSha256', 'configurationCanonicalSha256',
    'planSha256', 'termsSha256', 'sha256']);
  keys(value.workspace.directoryIdentity, ['device', 'inode']);
  need(value.workspace.schema === WORKSPACE_SCHEMA &&
    Object.values(value.workspace.directoryIdentity).every(x => typeof x === 'string' && /^[0-9]+$/.test(x)) &&
    ['workspaceIdentity', 'configurationSha256', 'configurationCanonicalSha256', 'planSha256', 'termsSha256', 'sha256']
      .every(key => HASH.test(value.workspace[key] ?? '')));
  absolute(value.workspace.directory);
  need(value.workspace.configurationFile === join(value.workspace.directory, 'configuration.json'));
  keys(value.source, ['schema', 'files', 'directory', 'sha256']);
  need(value.source.schema === SOURCE_SCHEMA && HASH.test(value.source.sha256) &&
    Array.isArray(value.source.files) && value.source.files.length === OPENCAGE_SOURCE_FILES.length);
  absolute(value.source.directory);
  for (const [index, entry] of value.source.files.entries()) {
    keys(entry, ['name', 'bytes', 'sha256']);
    need(entry.name === OPENCAGE_SOURCE_FILES[index] && Number.isSafeInteger(entry.bytes) &&
      entry.bytes >= 0 && entry.bytes <= 2097152 && HASH.test(entry.sha256));
  }
  const { sha256, ...body } = value;
  const { sha256: workspaceHash, ...workspaceBody } = value.workspace;
  need(hash(body) === sha256 && hash(workspaceBody) === workspaceHash &&
    hash({ schema: SOURCE_SCHEMA, files: value.source.files }) === value.source.sha256);
  return structuredClone(value);
}

export async function prepareGeocodeManagedSelection({ workspaceDirectory, sourceDirectory } = {}) {
  const body = {
    schema: OPENCAGE_SELECTION_SCHEMA,
    workspace: await inspectGeocodeWorkspaceBinding(absolute(workspaceDirectory)),
    source: await inspectGeocodeLaunchSource(absolute(sourceDirectory)),
  };
  return { ...body, sha256: hash(body) };
}

function readyIdentity(selection, launchSourceDirectory) {
  const selected = selection.workspace;
  return {
    schema: OPENCAGE_APPLICATION_SCHEMA, status: 'OPENCAGE_WORKSPACE_READY',
    directory: selected.directory, workspaceIdentity: selected.workspaceIdentity,
    workspaceBindingSha256: selected.sha256, configurationSha256: selected.configurationSha256,
    planSha256: selected.planSha256, termsSha256: selected.termsSha256,
    selectionSha256: selection.sha256, sourceDirectory: selection.source.directory,
    launchSourceDirectory, sourceSha256: selection.source.sha256,
  };
}
async function validateCurrentSelection(selection, launchSourceDirectory) {
  const workspace = await inspectGeocodeWorkspaceBinding(selection.workspace.directory,
    { expectedSha256: selection.workspace.sha256 });
  const source = await inspectGeocodeLaunchSource(selection.source.directory,
    { expectedSha256: selection.source.sha256 });
  await inspectGeocodeLaunchSource(absolute(launchSourceDirectory), { expectedSha256: selection.source.sha256 });
  need(same(workspace, selection.workspace) && same(source, selection.source));
}

function operatorUrl(value, port) {
  let url;
  try { url = new URL(value); } catch { fail('GEOCODE_MANAGED_OPERATOR_URL_INVALID'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username &&
    !url.password && !url.search && url.pathname === '/' && /^#[a-f0-9]{64}$/.test(url.hash) &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535,
  'GEOCODE_MANAGED_OPERATOR_URL_INVALID');
  need(port === undefined || port === 0 || Number(url.port || 80) === port,
    'GEOCODE_MANAGED_OPERATOR_URL_INVALID');
  return url;
}

/** Authenticate the running original instance. This fixed loopback read uses
 * neither the provider transport nor an ambient HTTP proxy. */
async function readOperatorIdentity(url) {
  return new Promise((resolve, reject) => {
    const issue = () => Object.assign(new Error('The original managed OpenCage operator is not ready.'),
      { code: 'GEOCODE_MANAGED_OPERATOR_UNAVAILABLE' });
    const call = httpRequest({
      hostname: '127.0.0.1', port: Number(url.port || 80), method: 'GET',
      path: '/api/managed-launch', agent: false,
      headers: { authorization: 'Bearer ' + url.hash.slice(1), accept: 'application/json' },
    }, response => {
      const parts = []; let size = 0;
      response.on('data', part => {
        size += part.length;
        if (size > 32768) { response.destroy(issue()); call.destroy(issue()); }
        else parts.push(part);
      });
      response.once('error', reject);
      response.once('aborted', () => reject(issue()));
      response.once('end', () => {
        try {
          need(response.statusCode === 200 &&
            /^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] ?? ''),
          'GEOCODE_MANAGED_OPERATOR_UNAVAILABLE');
          resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))));
        } catch (error) { reject(error); }
      });
    });
    call.once('error', reject);
    const timer = setTimeout(() => call.destroy(issue()), 5000);
    call.once('close', () => clearTimeout(timer));
    call.end();
  });
}

export async function verifyGeocodeManagedStartup(value, {
  selection, launchSourceDirectory, port,
} = {}) {
  selection = readGeocodeManagedSelection(selection);
  const expected = readyIdentity(selection, absolute(launchSourceDirectory));
  keys(value, [...Object.keys(expected), 'instanceId', 'pid', 'url']);
  need(Object.entries(expected).every(([key, item]) => value[key] === item) &&
    UUID.test(value.instanceId ?? '') && Number.isSafeInteger(value.pid) && value.pid > 0,
  'GEOCODE_MANAGED_STARTUP_CHANGED');
  await validateCurrentSelection(selection, launchSourceDirectory);
  const url = operatorUrl(value.url, port), observed = await readOperatorIdentity(url);
  const { url: ignored, ...identity } = value;
  need(same(observed, identity), 'GEOCODE_MANAGED_OPERATOR_CHANGED');
  return { url: url.href, original: identity };
}

export async function openGeocodeManagedWorkspace({
  directory: path, selection, port = 0, env = process.env,
} = {}) {
  selection = readGeocodeManagedSelection(selection);
  need(absolute(path) === selection.workspace.directory &&
    Number.isInteger(port) && port >= 0 && port <= 65535);
  await validateCurrentSelection(selection, SOURCE_DIRECTORY);
  const workspace = await GeocodeWorkspace.open(path, { env });
  let server;
  try {
    await validateCurrentSelection(selection, SOURCE_DIRECTORY);
    server = await createGeocodeServer({
      workspace, port, managedLaunch: readyIdentity(selection, SOURCE_DIRECTORY),
    });
    const startup = { ...server.managedStartup, url: server.url };
    await verifyGeocodeManagedStartup(startup, { selection, launchSourceDirectory: SOURCE_DIRECTORY, port });
    return { workspace, server, startup, selection };
  } catch (error) {
    if (server) await server.close(); else await workspace.close();
    throw error;
  }
}
