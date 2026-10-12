// MIT. Authenticated identity of the original running paid-job workspace.
import { isAbsolute, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { canonical, plain, jobError } from '../config.mjs';

export const JOB_WORKSPACE_IDENTITY_SCHEMA = 'stellar-forge.job-workspace-identity.v1';
export const JOB_SERVICE_IDENTITY_SCHEMA = 'stellar-forge.job-service-identity.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code, status = 409) => { throw jobError(code, status); };
const same = (left, right) => left === right || left !== undefined && right !== undefined && canonical(left) === canonical(right);
function identityAbsolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value ||
      value === '/' || /[\x00-\x1f\x7f]/.test(value)) fail('JOB_WORKSPACE_IDENTITY_PATH_INVALID');
  return value;
}
export function validateJobServiceIdentity(value) {
  if (value === null || value === undefined) return null;
  if (!plain(value) || value.schema !== JOB_SERVICE_IDENTITY_SCHEMA ||
      !UUID.test(value.instanceId ?? '') || !HASH.test(value.selectionSha256 ?? '') ||
      Object.keys(value).some(key => !['schema', 'instanceId', 'selectionSha256'].includes(key)))
    fail('JOB_SERVICE_IDENTITY_INVALID', 400);
  return Object.freeze(structuredClone(value));
}
export function assertJobSourceIdentity(value) {
  if (!plain(value) || value.schema !== 'stellar-forge.job-source.v1' ||
      !HASH.test(value.configSha256 ?? '') || !HASH.test(value.applicationSha256 ?? ''))
    fail('JOB_WORKSPACE_SOURCE_IDENTITY_INVALID');
  identityAbsolute(value.application);
  let origin;
  try { origin = new URL(value.publicOrigin); } catch { fail('JOB_WORKSPACE_SOURCE_IDENTITY_INVALID'); }
  if (origin.protocol !== 'https:' || origin.origin !== value.publicOrigin || origin.username || origin.password)
    fail('JOB_WORKSPACE_SOURCE_IDENTITY_INVALID');
}
export function privateJobWorkspaceUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('JOB_WORKSPACE_URL_INVALID', 400); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.search || url.pathname !== '/' || !/^#[a-f0-9]{64}$/.test(url.hash) ||
      Number(url.port || 80) < 1 || Number(url.port || 80) > 65535)
    fail('JOB_WORKSPACE_URL_INVALID', 400);
  return url;
}
export function assertJobWorkspaceIdentity(value, expected = {}) {
  if (!plain(value) || value.schema !== JOB_WORKSPACE_IDENTITY_SCHEMA ||
      !UUID.test(value.instanceId ?? '') || !Number.isSafeInteger(value.pid) || value.pid < 1 ||
      !plain(value.capabilities) || value.capabilities.inputs !== true || value.capabilities.resolution !== true ||
      typeof value.capabilities.delivery !== 'boolean') fail('JOB_WORKSPACE_IDENTITY_INVALID');
  for (const name of ['directory', 'configPath', 'runtimeDirectory']) identityAbsolute(value[name]);
  assertJobSourceIdentity(value.source);
  let origin;
  try { origin = new URL(value.origin); } catch { fail('JOB_WORKSPACE_IDENTITY_INVALID'); }
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== value.origin ||
      origin.username || origin.password || Number(origin.port || 80) < 1 || Number(origin.port || 80) > 65535)
    fail('JOB_WORKSPACE_IDENTITY_INVALID');
  const service = validateJobServiceIdentity(value.service);
  if (service && service.instanceId !== value.instanceId) fail('JOB_WORKSPACE_IDENTITY_INVALID');
  const supported = new Set(['instanceId', 'pid', 'directory', 'configPath', 'runtimeDirectory',
    'source', 'origin', 'selectionSha256']);
  if (!plain(expected) || Object.keys(expected).some(key => !supported.has(key)))
    fail('JOB_WORKSPACE_EXPECTATION_INVALID', 400);
  for (const [key, selected] of Object.entries(expected)) {
    const actual = key === 'selectionSha256' ? service?.selectionSha256 : value[key];
    if (selected !== undefined && !same(actual, selected)) fail('JOB_WORKSPACE_IDENTITY_CHANGED');
  }
  return value;
}
function readIdentityRequest(url, signal) {
  const timeout = AbortSignal.timeout(5000);
  const selected = signal ? AbortSignal.any([signal, timeout]) : timeout;
  selected.throwIfAborted();
  return new Promise((done, reject) => {
    const request = httpRequest({
      protocol: 'http:', hostname: '127.0.0.1', port: Number(url.port || 80),
      method: 'GET', path: '/api/identity', signal: selected, agent: false,
      headers: { host: url.host, authorization: 'Bearer ' + url.hash.slice(1),
        accept: 'application/json', connection: 'close' },
    }, response => {
      if (response.statusCode !== 200 ||
          response.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        response.resume(); reject(jobError('JOB_WORKSPACE_IDENTITY_UNAVAILABLE', 409)); return;
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) { response.destroy(jobError('JOB_WORKSPACE_IDENTITY_TOO_LARGE', 413)); return; }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('aborted', () => reject(jobError('JOB_WORKSPACE_IDENTITY_INCOMPLETE', 409)));
      response.once('end', () => {
        try { done(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
        catch { reject(jobError('JOB_WORKSPACE_IDENTITY_INVALID', 409)); }
      });
    });
    request.once('error', reject); request.end();
  });
}
export async function readJobWorkspaceIdentity({ url, expected = {}, signal } = {}) {
  const address = privateJobWorkspaceUrl(url);
  const value = await readIdentityRequest(address, signal);
  return assertJobWorkspaceIdentity(value, { ...expected, origin: address.origin });
}
