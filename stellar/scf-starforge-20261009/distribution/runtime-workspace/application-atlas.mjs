// MIT. Retained Atlas through the original installed Applications managed process.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, plain, need } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf61-bazaar-explorer';
const STARTUP = 'stellar-forge.sf61.atlas-launch.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function atlasApplication(common) {
  return {
    id: 'catalog-atlas', command: 'atlas', title: 'Catalog Atlas', terminal: false,
    requiredSource: SOURCE + '/managed-launch.mjs',
    description: 'Receive original catalog captures, compare saved offers, prepare exact buyer requests and reopen the retained workspace.',
    fields: [
      field('workspaceDirectory', 'Private Atlas workspace', 'path', true,
        'Reopen the original or completely received workspace, or create one directory in an existing private parent.'),
      field('upstream', 'Public HTTPS catalog origin', 'text', false,
        'Optional original live source. Leave both catalog origins empty to work from retained pages.'),
      field('localUpstream', 'Local seller catalog origin', 'text', false,
        'Optional original http://127.0.0.1:PORT catalog. Choose this or the public HTTPS origin.'),
      ...common,
    ],
  };
}

export async function prepareAtlasApplication(settings, inputPath, runtimeDirectory) {
  need(!(settings.upstream && settings.localUpstream), 'APPLICATION_ATLAS_SOURCE_SELECTION_REQUIRED',
    'Choose one live catalog origin, or leave both empty for retained pages');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', true, true);
  const inputs = [workspace], createDirectories = workspace.exists ? [] : [workspace.path];
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const native = join(selected.sourceRoot, SOURCE);
  for (const file of ['server.mjs', 'workspace.mjs', 'workspace-http.mjs', 'managed-launch.mjs'])
    inputs.push(await inputPath(join(native, file), 'file'));
  const { inspectAtlasWorkspace } = await import(pathToFileURL(join(native, 'managed-launch.mjs')).href);
  need(typeof inspectAtlasWorkspace === 'function', 'APPLICATION_ATLAS_READER_REQUIRED');
  if (workspace.exists) {
    const original = await inspectAtlasWorkspace(workspace.path);
    if (original.initialized) inputs.push(await inputPath(original.manifestFile, 'file'));
    for (const file of original.transferFiles) inputs.push(await inputPath(file, 'file'));
  }
  const args = ['--workspace', workspace.path, '--managed-source', native];
  if (settings.upstream || settings.localUpstream) {
    const original = await import(pathToFileURL(join(native, 'server.mjs')).href);
    if (settings.upstream) {
      need(typeof original.normalizeUpstream === 'function', 'APPLICATION_ATLAS_SOURCE_READER_REQUIRED');
      args.push('--upstream', original.normalizeUpstream(settings.upstream));
    } else {
      need(typeof original.normalizeLocalUpstream === 'function', 'APPLICATION_ATLAS_SOURCE_READER_REQUIRED');
      args.push('--local-upstream', original.normalizeLocalUpstream(settings.localUpstream));
    }
  }
  return { args, inputs, createDirectories };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_ATLAS_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && !positions.length) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_ATLAS_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function atlasStartup(request, text) {
  if (request.command !== 'atlas' || typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let announcement;
  try { announcement = JSON.parse(text); } catch { return null; }
  if (!plain(announcement) || announcement.schema !== STARTUP || announcement.state !== 'LISTENING') return null;
  const directory = absolute(option(request, '--workspace'));
  const sourceDirectory = absolute(option(request, '--managed-source'));
  const upstream = option(request, '--upstream', true), localUpstream = option(request, '--local-upstream', true);
  need(!(upstream && localUpstream), 'APPLICATION_ATLAS_STARTUP_CHANGED');
  const source = upstream ? 'PUBLIC_FACILITATOR_READ_ONLY' : localUpstream ?
    'ORIGINAL_SF60_DURABLE_CATALOG' : 'RETAINED_CATALOG_WORKSPACE';
  need(announcement.directory === directory && announcement.sourceDirectory === sourceDirectory &&
    announcement.source === source && announcement.sourceOrigin === (upstream ?? localUpstream ?? null) &&
    Number.isSafeInteger(announcement.pid) && announcement.pid > 0, 'APPLICATION_ATLAS_STARTUP_CHANGED');
  const { readAtlasLaunch } = await import(pathToFileURL(join(sourceDirectory, 'managed-launch.mjs')).href);
  need(typeof readAtlasLaunch === 'function', 'APPLICATION_ATLAS_READER_REQUIRED');
  const ready = await readAtlasLaunch({ directory, sourceDirectory, pid: announcement.pid,
    instanceId: announcement.instanceId });
  need(ready.url === announcement.url && ready.workspaceId === announcement.workspaceId &&
    ready.privateLaunch === announcement.privateLaunch && ready.source === source &&
    ready.sourceOrigin === announcement.sourceOrigin &&
    ready.workspaceFileSha256 === announcement.workspaceFileSha256,
  'APPLICATION_ATLAS_STARTUP_CHANGED');
  const port = Number(option(request, '--port', true) ?? 0);
  need(Number.isInteger(port) && port >= 0 && port <= 65535 &&
    (port === 0 || Number(new URL(ready.url).port || 80) === port), 'APPLICATION_ATLAS_PORT_CHANGED');
  return { url: ready.url, original: { schema: STARTUP, directory, sourceDirectory,
    workspaceId: ready.workspaceId, workspaceFileSha256: ready.workspaceFileSha256,
    sourceFiles: ready.sourceFiles, source, sourceOrigin: ready.sourceOrigin,
    pid: ready.pid, instanceId: ready.instanceId, privateLaunch: ready.privateLaunch } };
}
