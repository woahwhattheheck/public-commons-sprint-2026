// MIT. The original Databento workbench in the maintained Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/databento';
const STARTUP = 'stellar-forge.databento-workspace-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function databentoApplication(common = []) {
  return {
    id: 'databento-migration', command: 'databento-workspace',
    title: 'Databento migration', terminal: false,
    requiredSource: SOURCE + '/managed.mjs',
    description: 'Reopen the original historical-data workspace, complete source editions, exact field mappings, named reviews, retained results and full customer handoff.',
    fields: [
      field('workspaceDirectory', 'Initialized Databento workbench', 'path', true,
        'Select the directory created or received by databento-workspace. It contains operation.json and the original workspace/ directory.'),
      ...common,
    ],
  };
}

export async function prepareDatabentoApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_DATABENTO_INPUT_READER_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const inputs = [await inputPath(directory, 'directory', false, true)];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const native = await import(pathToFileURL(join(runtime.sourceRoot, SOURCE, 'managed.mjs')).href);
  need(typeof native.inspectDatabentoWorkspace === 'function' &&
    typeof native.inspectDatabentoLaunchSource === 'function' &&
    typeof native.databentoIdentity === 'function' && Array.isArray(native.DATABENTO_LAUNCH_FILES),
  'APPLICATION_DATABENTO_NATIVE_READER_REQUIRED');
  const workspace = await native.inspectDatabentoWorkspace(directory);
  inputs.push(await inputPath(workspace.workspaceDirectory, 'directory', false, true));
  const marker = await inputPath(workspace.marker.path, 'file');
  need(marker.sha256 === workspace.marker.sha256 &&
    String(marker.dev) === workspace.marker.dev && String(marker.ino) === workspace.marker.ino,
  'APPLICATION_DATABENTO_WORKSPACE_CHANGED');
  inputs.push(marker);
  const source = await native.inspectDatabentoLaunchSource(runtime.sourceRoot);
  need(source.files.length === native.DATABENTO_LAUNCH_FILES.length, 'APPLICATION_DATABENTO_SOURCE_CHANGED');
  for (const [index, name] of native.DATABENTO_LAUNCH_FILES.entries()) {
    const file = await inputPath(join(runtime.sourceRoot, name), 'file');
    need(source.files[index].name === name && source.files[index].sha256 === file.sha256,
      'APPLICATION_DATABENTO_SOURCE_CHANGED');
    inputs.push(file);
  }
  // Mutable native SQLite bytes, the current source head and retained previews
  // are work, not saved launch settings. Their stable identity is checked again
  // by the original native launch before opening the model and listener.
  const args = ['managed', '--dir', directory, '--source-root', runtime.sourceRoot,
    '--expected-workspace-identity', workspace.sha256,
    '--expected-source-sha256', source.sha256];
  return {
    args, inputs, createDirectories: [],
    resourceKey: native.databentoIdentity({
      family: 'python-workspace', directory: workspace.workspaceDirectory,
      workspaceId: workspace.workspace.id,
    }),
  };
}

function selection(request) {
  need(Array.isArray(request.args) && request.args[0] === 'managed',
    'APPLICATION_DATABENTO_STARTUP_CHANGED');
  const options = new Map(), args = request.args.slice(1);
  const allowed = new Set(['--dir', '--source-root', '--expected-workspace-identity',
    '--expected-source-sha256', '--port']);
  need(args.length % 2 === 0, 'APPLICATION_DATABENTO_STARTUP_CHANGED');
  for (let i = 0; i < args.length; i += 2) {
    need(allowed.has(args[i]) && !options.has(args[i]) && typeof args[i + 1] === 'string',
      'APPLICATION_DATABENTO_STARTUP_CHANGED');
    options.set(args[i], args[i + 1]);
  }
  need(options.size === allowed.size && HASH.test(options.get('--expected-workspace-identity') ?? '') &&
    HASH.test(options.get('--expected-source-sha256') ?? '') &&
    /^(0|[1-9]\d*)$/.test(options.get('--port') ?? '') &&
    Number(options.get('--port')) <= 65535, 'APPLICATION_DATABENTO_STARTUP_CHANGED');
  return {
    directory: absolute(options.get('--dir')), sourceRoot: absolute(options.get('--source-root')),
    workspaceIdentity: options.get('--expected-workspace-identity'),
    sourceSha256: options.get('--expected-source-sha256'), port: Number(options.get('--port')),
  };
}

async function liveState(url, token) {
  const response = await fetch(new URL('/api/state', url), {
    redirect: 'error',
    headers: { 'X-Python-Workspace-Token': token },
    signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 &&
    /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
  'APPLICATION_DATABENTO_STARTUP_UNAVAILABLE', 'The original Databento listener did not return its authenticated saved state.');
  const declared = response.headers.get('content-length');
  need(declared === null || /^\d+$/.test(declared) && Number(declared) <= 8 * 1024 * 1024,
    'APPLICATION_DATABENTO_STARTUP_UNAVAILABLE');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    need(bytes <= 8 * 1024 * 1024, 'APPLICATION_DATABENTO_STARTUP_UNAVAILABLE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { need(false, 'APPLICATION_DATABENTO_STARTUP_UNAVAILABLE', 'The original listener returned an unreadable saved state.'); }
}

export async function databentoStartup(request, text) {
  if (request.command !== 'databento-workspace' || typeof text !== 'string' || text.length > 32768 ||
      !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'DATABENTO_WORKSPACE_READY') return null;
  const selected = selection(request);
  const executedSourceRoot = join(absolute(request.releaseDirectory), 'source');
  need(value.directory === selected.directory &&
    value.workspaceDirectory === join(selected.directory, 'workspace') &&
    value.workspaceIdentity === selected.workspaceIdentity &&
    value.sourceRoot === selected.sourceRoot && value.executedSourceRoot === executedSourceRoot &&
    value.sourceSha256 === selected.sourceSha256 && UUID.test(value.instanceId ?? '') &&
    Number.isSafeInteger(value.pid) && value.pid > 0, 'APPLICATION_DATABENTO_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(selected.sourceRoot, SOURCE, 'managed.mjs')).href);
  const workspace = await native.inspectDatabentoWorkspace(selected.directory, {
    expectedIdentity: selected.workspaceIdentity,
  });
  const source = await native.inspectDatabentoLaunchSource(selected.sourceRoot, {
    expectedSha256: selected.sourceSha256,
  });
  await native.inspectDatabentoLaunchSource(executedSourceRoot, { expectedSha256: selected.sourceSha256 });
  need(value.workspaceId === workspace.workspace.id &&
    value.workspaceCreatedAt === workspace.workspace.createdAt &&
    value.configuration === workspace.configuration &&
    JSON.stringify(value.sourceFiles) === JSON.stringify(source.files),
  'APPLICATION_DATABENTO_STARTUP_CHANGED');
  let url, nativeUrl;
  try { url = new URL(value.operatorUrl); nativeUrl = new URL(value.nativeOperatorUrl); }
  catch { need(false, 'APPLICATION_DATABENTO_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && url.pathname === '/databento-migration/' &&
    /^#[a-f0-9]{64}$/.test(url.hash) && port >= 1 && port <= 65535 &&
    (!selected.port || selected.port === port) &&
    nativeUrl.origin === url.origin && nativeUrl.pathname === '/' && nativeUrl.hash === url.hash &&
    !nativeUrl.search && !nativeUrl.username && !nativeUrl.password,
  'APPLICATION_DATABENTO_STARTUP_CHANGED');
  const state = await liveState(url, url.hash.slice(1));
  need(state?.schema === 'stellar-forge.python-workspace.v1' &&
    state.workspace?.id === workspace.workspace.id &&
    state.workspace?.createdAt === workspace.workspace.createdAt &&
    state.workspace?.directory === workspace.workspaceDirectory,
  'APPLICATION_DATABENTO_STARTUP_CHANGED', 'The live original workspace differs from the reviewed application.');
  return { url: url.href, original: {
    schema: STARTUP, directory: workspace.directory, workspaceDirectory: workspace.workspaceDirectory,
    workspaceId: workspace.workspace.id, workspaceCreatedAt: workspace.workspace.createdAt,
    workspaceIdentity: workspace.sha256, configuration: workspace.configuration,
    sourceRoot: selected.sourceRoot, executedSourceRoot, sourceSha256: source.sha256,
    sourceFiles: source.files, instanceId: value.instanceId, pid: value.pid,
    nativeOperatorUrl: nativeUrl.href,
  } };
}
