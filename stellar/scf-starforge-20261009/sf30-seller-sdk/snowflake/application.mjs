// MIT. Snowflake preparation and authenticated startup in the original Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain } from '../../distribution/runtime-workspace/storage.mjs';
import { canonical, sha256 } from '../../sf46-release/release-core.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/snowflake';
const STARTUP = 'stellar-forge.snowflake-workspace-startup.v1';
const WORKSPACE = 'stellar-forge.snowflake-workspace.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const field = (name, label, type, required, description) => ({ name, label, type, required, description });

export function snowflakeApplication(common = []) {
  return {
    id: 'snowflake-workspace', command: 'snowflake-workspace',
    title: 'Snowflake data workspace', terminal: false,
    requiredSource: SOURCE + '/managed.mjs',
    description: 'Capture and receive original SQL API results, review exact retained editions, and reopen the original merchant publication and release console.',
    fields: [
      field('workspaceDirectory', 'Snowflake workspace', 'path', true,
        'Select the private workspace initialized by snowflake init or received by snowflake receive. Its source, editions, reviews and publications remain in that original directory.'),
      ...common,
    ],
  };
}

async function nativeAt(sourceRoot) {
  const native = await import(pathToFileURL(join(sourceRoot, SOURCE, 'managed.mjs')).href);
  need(typeof native.inspectSnowflakeWorkspace === 'function' &&
    typeof native.inspectSnowflakeLaunchSource === 'function' &&
    Array.isArray(native.SNOWFLAKE_LAUNCH_FILES), 'APPLICATION_SNOWFLAKE_NATIVE_READER_REQUIRED');
  return native;
}

export async function prepareSnowflakeApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_SNOWFLAKE_INPUT_READER_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const inputs = [await inputPath(directory, 'directory', false, true)];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const native = await nativeAt(runtime.sourceRoot);
  const workspace = await native.inspectSnowflakeWorkspace(directory);
  const source = await native.inspectSnowflakeLaunchSource(runtime.sourceRoot);
  for (const [index, name] of native.SNOWFLAKE_LAUNCH_FILES.entries()) {
    const original = await inputPath(join(runtime.sourceRoot, name), 'file');
    need(source.files[index]?.name === name && source.files[index].sha256 === original.sha256,
      'APPLICATION_SNOWFLAKE_SOURCE_CHANGED');
    inputs.push(original);
  }
  return {
    args: ['--directory', workspace.directory, '--source-root', runtime.sourceRoot,
      '--expected-workspace-id', workspace.id, '--expected-source-sha256', source.sha256],
    inputs, createDirectories: [],
    resourceKey: sha256(canonical({ family: 'snowflake-workspace',
      directory: workspace.directory, workspaceId: workspace.id })),
  };
}

export function snowflakeApplicationSelection(request) {
  need(request.command === 'snowflake-workspace' && !request.pythonCommand &&
    Array.isArray(request.args) && request.args.length % 2 === 0,
  'APPLICATION_SNOWFLAKE_SELECTION_CHANGED');
  const allowed = new Set(['--directory', '--source-root', '--expected-workspace-id',
    '--expected-source-sha256', '--port']), options = new Map();
  for (let i = 0; i < request.args.length; i += 2) {
    const [key, value] = request.args.slice(i, i + 2);
    need(allowed.has(key) && !options.has(key) && typeof value === 'string' && value,
      'APPLICATION_SNOWFLAKE_SELECTION_CHANGED');
    options.set(key, value);
  }
  const port = options.get('--port') ?? '0';
  need(options.has('--directory') && options.has('--source-root') &&
    UUID.test(options.get('--expected-workspace-id') ?? '') &&
    HASH.test(options.get('--expected-source-sha256') ?? '') &&
    /^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535,
  'APPLICATION_SNOWFLAKE_SELECTION_CHANGED');
  return {
    directory: absolute(options.get('--directory')),
    sourceRoot: absolute(options.get('--source-root')),
    workspaceId: options.get('--expected-workspace-id'),
    sourceSha256: options.get('--expected-source-sha256'),
    port: Number(port),
  };
}

export async function verifySnowflakeApplicationLaunch(request) {
  const selection = snowflakeApplicationSelection(request);
  const native = await nativeAt(selection.sourceRoot);
  const workspace = await native.inspectSnowflakeWorkspace(selection.directory, { expectedId: selection.workspaceId });
  const source = await native.inspectSnowflakeLaunchSource(selection.sourceRoot, { expectedSha256: selection.sourceSha256 });
  const executedSourceRoot = join(absolute(request.releaseDirectory), 'source');
  await native.inspectSnowflakeLaunchSource(executedSourceRoot, { expectedSha256: selection.sourceSha256 });
  return { selection, workspace, source, executedSourceRoot };
}

async function liveState(url) {
  const response = await fetch(new URL('/api/state', url), {
    redirect: 'error', headers: { 'X-Snowflake-Workspace': url.hash.slice(1) },
    signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
    'APPLICATION_SNOWFLAKE_STARTUP_UNAVAILABLE');
  const length = response.headers.get('content-length');
  need(length === null || /^\d+$/.test(length) && Number(length) <= 2097152,
    'APPLICATION_SNOWFLAKE_STARTUP_UNAVAILABLE');
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      need(bytes <= 2097152, 'APPLICATION_SNOWFLAKE_STARTUP_UNAVAILABLE');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error.code) throw error;
    need(false, 'APPLICATION_SNOWFLAKE_STARTUP_UNAVAILABLE', 'The original workspace did not return readable saved state.');
  }
}

export async function snowflakeStartup(request, text) {
  if (request.command !== 'snowflake-workspace' || typeof text !== 'string' || text.length > 32768 ||
      !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'SNOWFLAKE_WORKSPACE_READY') return null;
  const { selection, workspace, source, executedSourceRoot } = await verifySnowflakeApplicationLaunch(request);
  need(value.directory === selection.directory && value.workspaceId === workspace.id &&
    value.sourceRoot === selection.sourceRoot && value.executedSourceRoot === executedSourceRoot &&
    value.sourceSha256 === source.sha256 && JSON.stringify(value.sourceFiles) === JSON.stringify(source.files) &&
    UUID.test(value.instanceId ?? '') && Number.isSafeInteger(value.pid) && value.pid > 0,
  'APPLICATION_SNOWFLAKE_STARTUP_CHANGED');
  let url;
  try { url = new URL(value.operatorUrl); } catch { need(false, 'APPLICATION_SNOWFLAKE_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && /^#[a-f0-9]{64}$/.test(url.hash) &&
    port >= 1 && port <= 65535 && (!selection.port || selection.port === port),
  'APPLICATION_SNOWFLAKE_STARTUP_CHANGED');
  const state = await liveState(url);
  need(state?.schema === WORKSPACE && state.id === workspace.id && state.instanceId === value.instanceId,
    'APPLICATION_SNOWFLAKE_STARTUP_CHANGED', 'The live listener differs from the reviewed Snowflake workspace.');
  return { url: url.href, original: {
    schema: STARTUP, directory: workspace.directory, workspaceId: workspace.id,
    sourceRoot: source.sourceRoot, executedSourceRoot, sourceSha256: source.sha256,
    sourceFiles: source.files, instanceId: value.instanceId, pid: value.pid,
  } };
}
