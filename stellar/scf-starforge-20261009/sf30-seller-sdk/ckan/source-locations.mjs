// MIT. Resolve retained source bytes through one project-owned receive location.
import { basename, dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { object, privateDirectory, readJson, fault } from '../postgres/publisher/files.mjs';

export const CKAN_SOURCE_LOCATIONS_SCHEMA = 'stellar-forge.ckan-source-locations.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function ckanWorkspaceMember(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(value) || posix.isAbsolute(value) || posix.normalize(value) !== value ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    throw fault('CKAN_WORKSPACE_MEMBER_INVALID');
  return value;
}
export async function ckanWorkspaceFile(root, value) {
  ckanWorkspaceMember(value); root = resolve(root);
  await privateDirectory(root);
  let parent = root;
  for (const part of value.split('/').slice(0, -1)) {
    parent = join(parent, part); await privateDirectory(parent);
  }
  const path = join(root, value);
  if (await realpath(path) !== path) throw fault('CKAN_WORKSPACE_MEMBER_INVALID');
  return path;
}
/** New relative declarations already move unchanged. Legacy absolute declarations
 * retain their exact bytes/hash; this binding chooses their installed capture. */
export async function resolveCkanSourceCapture(filename, config, sourceSha256) {
  const original = resolve(dirname(filename), config.connection.file);
  if (!isAbsolute(config.connection.file) || basename(dirname(filename)) !== 'sources') return original;
  const sourceName = basename(filename), sourceId = sourceName.replace(/\.json$/, '');
  if (!UUID.test(sourceId) || sourceName !== sourceId + '.json') return original;
  const root = dirname(dirname(resolve(filename)));
  let locations;
  try { locations = await readJson(join(root, 'sources', 'source-locations.json'), 33554432); }
  catch (error) { if (error.code === 'ENOENT') return original; throw error; }
  const state = await readJson(join(root, 'workbench.json'), 16777216);
  if (!object(locations) || locations.schema !== CKAN_SOURCE_LOCATIONS_SCHEMA ||
      locations.projectCreatedAt !== state.createdAt || locations.catalogOrigin !== state.catalogOrigin ||
      state.schema !== 'stellar-forge.ckan-workbench.v1' || !Array.isArray(state.sources) || !Array.isArray(state.editions) ||
      !Array.isArray(locations.sources) || locations.sources.length > 100000)
    throw fault('CKAN_SOURCE_LOCATIONS_INVALID');
  const names = new Set();
  for (const item of locations.sources) {
    if (!object(item) || typeof item.file !== 'string' || names.has(item.file))
      throw fault('CKAN_SOURCE_LOCATION_AMBIGUOUS');
    names.add(item.file);
  }
  const selected = locations.sources.find(item => item.file === sourceName);
  const declared = state.sources.filter(item => item.id === sourceId);
  if (!selected || declared.length !== 1) throw fault('CKAN_SOURCE_LOCATION_MISSING');
  const entry = declared[0], edition = state.editions.filter(item => item.id === entry.editionId);
  if (edition.length !== 1 || !UUID.test(entry.editionId) ||
      selected.sourceSha256 !== sourceSha256 || entry.sha256 !== sourceSha256 ||
      !HASH.test(selected.captureSha256 ?? '') || selected.captureSha256 !== config.connection.sha256 ||
      selected.captureSha256 !== edition[0].manifestSha256 ||
      selected.originalCaptureFile !== config.connection.file ||
      selected.captureFile !== 'editions/' + entry.editionId + '/capture.json')
    throw fault('CKAN_SOURCE_LOCATION_CHANGED');
  return ckanWorkspaceFile(root, selected.captureFile);
}
