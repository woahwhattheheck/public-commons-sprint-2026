// MIT. Reuse the original authenticated workbench owner and its private startup record.
import { resolve, dirname, basename } from 'node:path';
import { parseCkanJson } from './capture.mjs';
import { stringifyRemote } from './remote-json.mjs';
import { readPrivate, atomicJson, privateDirectory, digest, fault } from '../postgres/publisher/files.mjs';
const STARTUP_SCHEMAS = ['stellar-forge.dcat-workbench-startup.v1', 'stellar-forge.ckan-workbench-startup.v1'];

export async function openWorkbenchOwner(startupFile, directory) {
  const raw = await readPrivate(startupFile, 65536);
  let startup;
  try { startup = JSON.parse(raw.toString('utf8')); } catch { throw fault('DCAT_STARTUP_FILE_INVALID'); }
  if (!STARTUP_SCHEMAS.includes(startup?.schema) ||
      startup.directory !== directory || typeof startup.instanceId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(startup.instanceId))
    throw fault('DCAT_STARTUP_FILE_INVALID', 'Select the private startup record from this project’s current owner.');
  let url;
  try { url = new URL(startup.url); } catch { throw fault('DCAT_STARTUP_FILE_INVALID'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/' || url.search || url.username || url.password || startup.origin !== url.origin ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(url.hash.slice(1)))
    throw fault('DCAT_STARTUP_FILE_INVALID', 'Use the original private loopback startup record.');
  const authorization = 'Bearer ' + url.hash.slice(1);
  async function api(path, value) {
    let response;
    try { response = await fetch(url.origin + '/api/' + path, {
      method: value === undefined ? 'GET' : 'POST', headers: { authorization,
        ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(value === undefined ? {} : { body: stringifyRemote(value) }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    }); } catch { throw fault('DCAT_LISTENER_UNAVAILABLE', 'The selected project owner did not answer. Read its original lifecycle status.'); }
    let count = 0; const parts = [];
    for await (const part of response.body ?? []) {
      count += part.length;
      if (count > 33554432) throw fault('DCAT_LISTENER_RESPONSE_TOO_LARGE');
      parts.push(Buffer.from(part));
    }
    let result;
    try { result = parseCkanJson(Buffer.concat(parts)); }
    catch { throw fault('DCAT_LISTENER_RESPONSE_INVALID'); }
    if (!response.ok) throw fault(result.error ?? 'DCAT_LISTENER_REQUEST_FAILED',
      result.message ?? 'The original project owner rejected the request.', response.status);
    return result;
  }
  const listener = await api('launch');
  if (listener.schema !== 'stellar-forge.ckan-workbench-listener.v1' ||
      listener.instanceId !== startup.instanceId || listener.pid !== startup.pid ||
      listener.directory !== directory || listener.project?.createdAt !== startup.projectCreatedAt ||
      listener.project?.catalogOrigin !== startup.catalogOrigin || listener.project?.sourceKind !== startup.sourceKind)
    throw fault('DCAT_LISTENER_IDENTITY_CHANGED', 'Select the current original startup record before dispatching due acquisitions.');
  return { api, listener, startup, startupSha256: digest(raw) };
}

export async function saveWorkbenchStartup({project, web, file, schema = STARTUP_SCHEMAS[1], extra = {}}) {
  if (!STARTUP_SCHEMAS.includes(schema)) throw fault('CKAN_STARTUP_FILE_INVALID');
  const state = project.status();
  const startup = { ...extra, schema, pid: process.pid, directory: project.directory,
    projectCreatedAt: state.createdAt, catalogOrigin: state.catalogOrigin, sourceKind: state.sourceKind ?? 'ckan',
    instanceId: web.instanceId, origin: web.origin, url: web.url };
  if (file !== undefined) {
    const path = resolve(file);
    if (path === project.directory || path.startsWith(project.directory + '/'))
      throw fault('DCAT_STARTUP_FILE_LOCATION', 'Keep the private listener record outside the portable catalog project.');
    await privateDirectory(dirname(path));
    let previous;
    try { previous = JSON.parse((await readPrivate(path, 65536)).toString('utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous && (!STARTUP_SCHEMAS.includes(previous.schema) || previous.directory !== startup.directory ||
        previous.projectCreatedAt !== startup.projectCreatedAt))
      throw fault('DCAT_STARTUP_FILE_CHANGED', 'This startup record belongs to another saved project.');
    await atomicJson(dirname(path), basename(path), startup);
  }
  return startup;
}
