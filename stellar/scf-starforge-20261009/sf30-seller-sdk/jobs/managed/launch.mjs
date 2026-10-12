// MIT. Native private launch and live workspace identity for the original job service.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdtemp, link, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonical, plain, jobError } from '../config.mjs';
import { serviceAbsolute, readServiceFile } from './selection.mjs';

import { privateJobWorkspaceUrl, readJobWorkspaceIdentity, assertJobSourceIdentity } from '../workspace/identity.mjs';
import { CATALOG_PATH } from '../intake/protocol.mjs';

export const JOB_SERVICE_LAUNCH_SCHEMA = 'stellar-forge.job-service-launch.v1';
export const JOB_SERVICE_EXIT_SCHEMA = 'stellar-forge.job-service-exit.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code, status = 409) => { throw jobError(code, status); };
const same = (left, right) => left === right || left !== undefined && right !== undefined && canonical(left) === canonical(right);
export const jobServiceLaunchPath = operationDirectory =>
  join(serviceAbsolute(operationDirectory), 'job-service-launch.json');
export const jobServiceExitPath = operationDirectory =>
  join(serviceAbsolute(operationDirectory), 'job-service-exit.json');

async function privateParent(file) {
  serviceAbsolute(file);
  const parent = dirname(file), info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 ||
      process.getuid !== undefined && info.uid !== process.getuid() || await realpath(parent) !== parent)
    fail('JOB_SERVICE_PRIVATE_OPERATION_REQUIRED');
  return parent;
}
export async function assertJobServiceLaunchTarget(file) {
  await privateParent(file);
  if (file !== jobServiceLaunchPath(dirname(file))) fail('JOB_SERVICE_LAUNCH_PATH_INVALID', 400);
  try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return file; throw error; }
  fail('JOB_SERVICE_RECORD_ALREADY_EXISTS');
}

/** The maintained operation owns these create-once records, outside mutable merchant state. */
export async function writeJobServiceRecord(file, value) {
  const parent = await privateParent(file);
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > 131072) fail('JOB_SERVICE_RECORD_TOO_LARGE', 413);
  const temporary = await mkdtemp(join(parent, '.job-service-record-'));
  try {
    const staged = join(temporary, 'record.json');
    const handle = await open(staged, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await link(staged, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = await readServiceFile(file, 131072, { privateFile: true });
      if (!prior.bytes.equals(bytes)) fail('JOB_SERVICE_RECORD_ALREADY_EXISTS');
    }
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
    return { file, bytes: bytes.length };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

function launchValue(value) {
  if (!plain(value) || value.schema !== JOB_SERVICE_LAUNCH_SCHEMA || value.state !== 'LISTENING' ||
      value.service !== 'starforge-paid-jobs' || !UUID.test(value.instanceId ?? '') ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 || !HASH.test(value.selectionSha256 ?? '') ||
      typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt)) ||
      new Date(value.startedAt).toISOString() !== value.startedAt) fail('JOB_SERVICE_LAUNCH_INVALID');
  for (const field of ['directory', 'configPath', 'runtimeDirectory', 'applicationPath']) serviceAbsolute(value[field]);
  assertJobSourceIdentity(value.source);
  const operator = privateJobWorkspaceUrl(value.operator);
  if (value.inputReceiving !== operator.origin + '/inputs/' + operator.hash ||
      value.resolution !== operator.origin + '/resolutions/' + operator.hash ||
      value.deliveries !== null && value.deliveries !== operator.origin + '/deliveries' + operator.hash)
    fail('JOB_SERVICE_LAUNCH_LINK_CHANGED');
  const entries = { jobs: value.operator, inputs: value.inputReceiving,
    resolutions: value.resolution, deliveries: value.deliveries };
  if (!Object.hasOwn(entries, value.landing) || typeof entries[value.landing] !== 'string' ||
      value.entryUrl !== entries[value.landing]) fail('JOB_SERVICE_LAUNCH_LINK_CHANGED');
  for (const name of ['seller', 'customer', 'operations']) {
    let endpoint;
    try { endpoint = new URL(value[name]); } catch { fail('JOB_SERVICE_LAUNCH_ENDPOINT_CHANGED'); }
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
        endpoint.username || endpoint.password || endpoint.search ||
        Number(endpoint.port || 80) < 1 || Number(endpoint.port || 80) > 65535)
      fail('JOB_SERVICE_LAUNCH_ENDPOINT_CHANGED');
  }
  if (value.intake !== null) {
    let intake; try { intake = new URL(value.intake); } catch { fail('JOB_SERVICE_LAUNCH_ENDPOINT_CHANGED'); }
    if (intake.origin !== value.source.publicOrigin || intake.pathname !== CATALOG_PATH ||
        intake.search || intake.hash) fail('JOB_SERVICE_LAUNCH_ENDPOINT_CHANGED');
  }
  return value;
}
export async function readJobServiceLaunch({ file, expected = {}, signal } = {}) {
  await privateParent(file);
  const { bytes } = await readServiceFile(file, 131072, { privateFile: true });
  let value;
  try { value = launchValue(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
  catch (error) { if (error.code) throw error; fail('JOB_SERVICE_LAUNCH_INVALID'); }
  if (!plain(expected)) fail('JOB_SERVICE_EXPECTATION_INVALID', 400);
  for (const [name, selected] of Object.entries(expected)) {
    if (!['directory', 'configPath', 'runtimeDirectory', 'source', 'selectionSha256', 'instanceId', 'pid'].includes(name))
      fail('JOB_SERVICE_EXPECTATION_INVALID', 400);
    if (selected !== undefined && !same(value[name], selected)) fail('JOB_SERVICE_LAUNCH_CHANGED');
  }
  const identity = await readJobWorkspaceIdentity({ url: value.operator, signal, expected: {
    instanceId: value.instanceId, pid: value.pid, directory: value.directory, configPath: value.configPath,
    runtimeDirectory: value.runtimeDirectory, source: value.source, selectionSha256: value.selectionSha256,
  } });
  if (identity.capabilities.delivery !== (value.deliveries !== null)) fail('JOB_SERVICE_LAUNCH_CHANGED');
  return { ...value, workspaceIdentity: identity };
}
