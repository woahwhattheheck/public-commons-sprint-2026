// MIT. Source-owned WordPress Applications adapter over the original managed launcher.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain } from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/wordpress';
const STARTUP = 'stellar-forge.wordpress-workspace-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function wordpressApplication(common, field) {
  return {
    id: 'wordpress', command: 'wordpress', title: 'WordPress source and merchant workspace', terminal: false,
    requiredSource: SOURCE + '/managed.mjs',
    description: 'Discover native WordPress collections, resume retained response captures, review dataset editions and operate their original seller and customer delivery.',
    fields: [
      field('workspaceDirectory', 'Original private WordPress workspace', 'path', true,
        'Select an initialized source workspace or a freshly received source packet. Use wordpress init to create a new private workspace. Its existing captures, decisions and publisher records remain in use.'),
      field('python', 'Original Python executable', 'path', false,
        'Optional canonical Python executable. Leave empty to use python3 from the managed environment.'),
      ...common,
    ],
  };
}

export async function prepareWordPressApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_WORDPRESS_INPUT_READER_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const inputs = [await inputPath(directory, 'directory', false, true)];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const sourceDirectory = join(runtime.sourceRoot, SOURCE);
  const managedFile = await inputPath(join(sourceDirectory, 'managed.mjs'), 'file');
  const native = await import(pathToFileURL(join(sourceDirectory, 'managed.mjs')).href);
  need(typeof native.inspectWordPressWorkspaceBinding === 'function' &&
    typeof native.inspectWordPressLaunchSource === 'function' && Array.isArray(native.WORDPRESS_SOURCE_FILES),
    'APPLICATION_WORDPRESS_NATIVE_BINDING_REQUIRED');
  const binding = await native.inspectWordPressWorkspaceBinding(directory);
  const source = await native.inspectWordPressLaunchSource(sourceDirectory);
  for (const file of source.files) {
    const pinned = file.name === 'managed.mjs' ? managedFile :
      await inputPath(join(sourceDirectory, file.name), 'file');
    need(pinned.sha256 === file.sha256 && pinned.bytes === file.bytes,
      'APPLICATION_WORDPRESS_SOURCE_CHANGED');
    inputs.push(pinned);
  }
  need(source.files.length === native.WORDPRESS_SOURCE_FILES.length,
    'APPLICATION_WORDPRESS_SOURCE_CHANGED');
  const args = ['serve', '--dir', directory,
    '--expected-workspace-id', binding.workspaceId,
    '--expected-workspace-identity', binding.sha256,
    '--managed-source', sourceDirectory, '--expected-source-sha256', source.sha256];
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
  need(Array.isArray(request.args), 'APPLICATION_WORDPRESS_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_WORDPRESS_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export async function wordpressStartup(request, text) {
  if (request.command !== 'wordpress' || typeof text !== 'string' || text.length > 16384 ||
      !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'WORDPRESS_OPERATOR_READY') return null;
  need(request.args?.[0] === 'serve',
    'APPLICATION_WORDPRESS_STARTUP_CHANGED');
  const directory = absolute(option(request, '--dir'));
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
    'APPLICATION_WORDPRESS_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(sourceDirectory, 'managed.mjs')).href);
  const source = await native.inspectWordPressLaunchSource(sourceDirectory, { expectedSha256: sourceSha256 });
  await native.inspectWordPressLaunchSource(launchSourceDirectory, { expectedSha256: sourceSha256 });
  const binding = await native.inspectWordPressWorkspaceBinding(directory, {
    expectedWorkspaceId: workspaceId, expectedWorkspaceIdentity: workspaceIdentity,
  });
  need(JSON.stringify(value.sourceFiles) === JSON.stringify(source.files) &&
    value.createdAt === binding.createdAt, 'APPLICATION_WORDPRESS_STARTUP_CHANGED');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_WORDPRESS_STARTUP_CHANGED'); }
  const actualPort = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    actualPort >= 1 && actualPort <= 65535 &&
    (portText === '0' || actualPort === Number(portText)), 'APPLICATION_WORDPRESS_STARTUP_CHANGED');
  const response = await fetch(url.href + 'api/health', { redirect: 'error', signal: AbortSignal.timeout(5000) });
  need(response.ok, 'APPLICATION_WORDPRESS_LISTENER_REQUIRED');
  const health = await response.json();
  need(health.status === 'ok' && health.workspaceId === workspaceId &&
    health.workspaceIdentity === workspaceIdentity && health.instanceId === value.instanceId &&
    health.pid === value.pid && health.createdAt === value.createdAt,
    'APPLICATION_WORDPRESS_LISTENER_CHANGED');
  return { url: url.href, original: {
    schema: STARTUP, directory, workspaceId, workspaceIdentity, createdAt: binding.createdAt,
    sourceDirectory, launchSourceDirectory, sourceSha256, sourceFiles: source.files,
    instanceId: value.instanceId, pid: value.pid, revision: value.revision,
  } };
}

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'wordpress', order: 85,
  catalog({ common, field }) { return [wordpressApplication(common, field)]; },
  async prepare(type, settings, context) {
    return prepareWordPressApplication(settings, { inputPath: context.inputPath, runtimeDirectory: context.runtimeDirectory });
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'wordpress'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.wordpress-workspace-startup.v1",')) return null;
      return () => wordpressStartup(request, text);
    });
  },
};
