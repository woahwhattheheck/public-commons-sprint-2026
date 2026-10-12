// MIT. The original WebDAV source application in the maintained managed launcher.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/webdav';
const STARTUP = 'stellar-forge.webdav-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function webdavApplication(common) {
  return {
    id: 'webdav', command: 'webdav', title: 'WebDAV source and merchant workspace', terminal: false,
    requiredSource: SOURCE + '/managed.mjs',
    description: 'Review retained file-cloud versions, continue original captures, prepare native dataset editions and operate their existing merchant and customer handoffs.',
    fields: [
      field('workspaceDirectory', 'Original private WebDAV workspace', 'path', true,
        'Select an initialized source workspace or a freshly received source packet. Its existing captures, decisions and publisher records remain in use.'),
      field('python', 'Original Python executable', 'path', false,
        'Optional canonical Python executable. Leave empty to use python3 from the managed environment.'),
      ...common,
    ],
  };
}

export async function prepareWebDavApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_WEBDAV_INPUT_READER_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const inputs = [await inputPath(directory, 'directory', false, true)];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const sourceDirectory = join(runtime.sourceRoot, SOURCE);
  const managedFile = await inputPath(join(sourceDirectory, 'managed.mjs'), 'file');
  const native = await import(pathToFileURL(join(sourceDirectory, 'managed.mjs')).href);
  need(typeof native.inspectWebDavWorkspaceBinding === 'function' &&
    typeof native.inspectWebDavLaunchSource === 'function' && Array.isArray(native.WEBDAV_SOURCE_FILES),
    'APPLICATION_WEBDAV_NATIVE_BINDING_REQUIRED');
  const binding = await native.inspectWebDavWorkspaceBinding(directory);
  const source = await native.inspectWebDavLaunchSource(sourceDirectory);
  for (const file of source.files) {
    const pinned = file.name === 'managed.mjs' ? managedFile :
      await inputPath(join(sourceDirectory, file.name), 'file');
    need(pinned.sha256 === file.sha256 && pinned.bytes === file.bytes,
      'APPLICATION_WEBDAV_SOURCE_CHANGED');
    inputs.push(pinned);
  }
  need(source.files.length === native.WEBDAV_SOURCE_FILES.length,
    'APPLICATION_WEBDAV_SOURCE_CHANGED');
  const args = ['serve', '--directory', directory,
    '--expected-workspace-id', binding.workspaceId,
    '--expected-workspace-identity', binding.sha256,
    '--managed-source', sourceDirectory, '--expected-source-sha256', source.sha256,
    '--startup-format', 'json'];
  if (settings.python) {
    const python = absolute(settings.python);
    inputs.push(await inputPath(python, 'file'));
    args.push('--python', python);
  }
  // workspace.json is mutable operator state. Its stable UUID/creation identity,
  // not its revision, byte hash or mtime, is checked under the original writer lock.
  return { args, inputs, createDirectories: [], binding };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_WEBDAV_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_WEBDAV_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export async function webdavStartup(request, text) {
  if (request.command !== 'webdav' || typeof text !== 'string' || text.length > 16384 ||
      !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'WEBDAV_OPERATOR_READY') return null;
  need(request.args?.[0] === 'serve' && option(request, '--startup-format') === 'json',
    'APPLICATION_WEBDAV_STARTUP_CHANGED');
  const directory = absolute(option(request, '--directory'));
  const sourceDirectory = absolute(option(request, '--managed-source'));
  const launchSourceDirectory = join(absolute(request.releaseDirectory), 'source', SOURCE);
  const workspaceId = option(request, '--expected-workspace-id');
  const workspaceIdentity = option(request, '--expected-workspace-identity');
  const sourceSha256 = option(request, '--expected-source-sha256');
  const portText = option(request, '--port', true) ?? '0';
  need(UUID.test(workspaceId) && HASH.test(workspaceIdentity) && HASH.test(sourceSha256) &&
    /^(0|[1-9]\d*)$/.test(portText) && Number(portText) <= 65535 &&
    value.directory === directory && value.workspaceId === workspaceId &&
    value.workspaceIdentity === workspaceIdentity && value.sourceDirectory === sourceDirectory &&
    value.launchSourceDirectory === launchSourceDirectory && value.sourceSha256 === sourceSha256 &&
    UUID.test(value.instanceId ?? '') && Number.isSafeInteger(value.pid) && value.pid > 0,
    'APPLICATION_WEBDAV_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(sourceDirectory, 'managed.mjs')).href);
  const source = await native.inspectWebDavLaunchSource(sourceDirectory, { expectedSha256: sourceSha256 });
  await native.inspectWebDavLaunchSource(launchSourceDirectory, { expectedSha256: sourceSha256 });
  const binding = await native.inspectWebDavWorkspaceBinding(directory, {
    expectedWorkspaceId: workspaceId, expectedWorkspaceIdentity: workspaceIdentity,
  });
  need(JSON.stringify(value.sourceFiles) === JSON.stringify(source.files) &&
    value.createdAt === binding.createdAt, 'APPLICATION_WEBDAV_STARTUP_CHANGED');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_WEBDAV_STARTUP_CHANGED'); }
  const actualPort = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    actualPort >= 1 && actualPort <= 65535 &&
    (portText === '0' || actualPort === Number(portText)), 'APPLICATION_WEBDAV_STARTUP_CHANGED');
  return { url: url.href, original: {
    schema: STARTUP, directory, workspaceId, workspaceIdentity, createdAt: binding.createdAt,
    sourceDirectory, launchSourceDirectory, sourceSha256, sourceFiles: source.files,
    instanceId: value.instanceId, pid: value.pid, revision: value.revision,
  } };
}
