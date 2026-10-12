// SPDX-License-Identifier: MIT
// Source-owned QGIS analyst preparation over the original Applications manager.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {realpath, readFile, lstat} from 'node:fs/promises';
import {inspectMerchantRuntime} from '../../../sf46-release/runtime-package.mjs';
import {absolute, need, plain, canonical, digest} from '../../../distribution/runtime-workspace/storage.mjs';
const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/stac/qgis';
const BINDING = 'starforge.stac-qgis-analyst-binding.v1';
const STARTUP = 'starforge.stac-qgis-analyst-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^qgis-[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const valueSha = value => digest(JSON.stringify(canonical(value)) + '\n');
const field = (name, label, type, required, description) => ({name, label, type, required, description});
export function qgisAnalystApplication(common = []) {
  return {
    id: 'stac-qgis-analyst', command: 'stac-qgis-analyst', title: 'QGIS analyst workspace', terminal: false,
    requiredSource: SOURCE + '/analyst/server.py',
    description: 'Operate original STAC, vector and PostGIS source editions, native maps, QField collection and complete project receiving in the same QGIS workspace.',
    fields: [
      field('workspaceDirectory', 'Original QGIS workspace', 'path', true,
        'Choose a private workspace initialized or received by the original stac-qgis command or desktop.'),
      field('pythonExecutable', 'Existing operator Python', 'path', true,
        'Select the absolute existing Python 3.11+ executable. This reader and listener use the original SQLite workspace.'),
      field('nativeRuntimeFile', 'Private native QGIS runtime JSON', 'path', false,
        'Select the existing native_command and optional qfieldsync_path/prefix_path used by the original QField bridge. Native map actions use that same QGIS installation.'),
      field('connectionFile', 'Private connection file', 'path', false,
        'Optional new private file for the original listener URL. The original process removes its own file on Stop.'),
      ...common,
    ],
  };
}
async function nativeAt(root) {
  const native = await import(pathToFileURL(join(root, 'analyst.mjs')).href);
  need(typeof native.inspectAnalystBinding === 'function', 'APPLICATION_QGIS_NATIVE_READER_REQUIRED');
  return native;
}
function validateBinding(value, {workspace, python, sourceRoot}) {
  need(plain(value) && value.schema === BINDING && value.workspaceDirectory === workspace &&
    value.sourceRoot === sourceRoot && ID.test(value.workspaceId ?? '') && HASH.test(value.sha256 ?? '') &&
    plain(value.workspaceIdentity) && plain(value.python) && plain(value.nativeRuntime) &&
    Array.isArray(value.sourceFiles) && HASH.test(value.sourceSha256 ?? ''),
  'APPLICATION_QGIS_BINDING_CHANGED');
  const {sha256, sourceRoot: ignored, ...body} = value;
  need(valueSha(body) === sha256 && valueSha(value.sourceFiles) === value.sourceSha256,
    'APPLICATION_QGIS_BINDING_CHANGED');
  need(Array.isArray(value.python.version) && value.python.version.length === 3 &&
    value.python.version.every(Number.isSafeInteger) && (value.python.version[0] > 3 ||
      value.python.version[0] === 3 && value.python.version[1] >= 11),
  'APPLICATION_QGIS_PYTHON_VERSION', 'Choose the existing Python 3.11 or later.');
  return value;
}
export async function prepareQgisAnalystApplication(settings, context = {}) {
  const {inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment} = context;
  need([inputPath, selectedExecutable, applicationEnvironment].every(value => typeof value === 'function'),
    'APPLICATION_QGIS_CONTEXT_REQUIRED');
  const workspace = await inputPath(absolute(settings.workspaceDirectory), 'directory', false, true);
  const python = await selectedExecutable(absolute(settings.pythonExecutable));
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), {load: false});
  const sourceRoot = await realpath(join(runtime.sourceRoot, SOURCE));
  const native = await nativeAt(sourceRoot);
  const environment = await applicationEnvironment(settings.environmentFile);
  const runtimeFile = settings.nativeRuntimeFile ? await inputPath(absolute(settings.nativeRuntimeFile), 'file', false, true) : null;
  const binding = validateBinding(await native.inspectAnalystBinding({pythonExecutable: python.executable,
    workspaceDirectory: workspace.path, nativeRuntimeFile: runtimeFile?.path, sourceRoot, environment: environment.environment}),
  {workspace: workspace.path, python: python.executable, sourceRoot});
  need(await realpath(binding.python.executable) === await realpath(python.executable) &&
    binding.workspaceIdentity.device === String(workspace.dev) &&
    binding.workspaceIdentity.inode === String(workspace.ino),
  'APPLICATION_QGIS_WORKSPACE_CHANGED');
  const inputs = [workspace, ...python.inputs];
  const seen = new Set();
  for (const row of binding.sourceFiles) {
    need(plain(row) && typeof row.path === 'string' && !row.path.startsWith('/') && !row.path.includes('\\') &&
      row.path.split('/').every(part => part && part !== '.' && part !== '..') &&
      !seen.has(row.path) && HASH.test(row.sha256 ?? '') && Number.isSafeInteger(row.bytes) && row.bytes >= 0,
    'APPLICATION_QGIS_SOURCE_CHANGED');
    seen.add(row.path);
    need(row.scope === undefined || row.scope === 'postgis-adapter', 'APPLICATION_QGIS_SOURCE_CHANGED');
    need((row.scope === 'postgis-adapter') === row.path.startsWith('postgis-adapter/'),
      'APPLICATION_QGIS_SOURCE_CHANGED');
    const file = await inputPath(row.scope === 'postgis-adapter'
      ? join(sourceRoot, '..', 'postgis', 'qgis', row.path.slice('postgis-adapter/'.length))
      : join(sourceRoot, row.path), 'file');
    need(file.sha256 === row.sha256, 'APPLICATION_QGIS_SOURCE_CHANGED');
    inputs.push(file);
  }
  need(['analyst/server.py', 'analyst/worker.py', 'starforge_stac/model.py', 'starforge_stac/qgis_project.py',
    'starforge_stac/analyst_state.py', 'starforge_stac/field.py', 'analyst/public/app.js',
    'analyst.mjs', 'application.mjs', 'application-provider.mjs', 'starforge_stac/postgis/__init__.py',
    'postgis-adapter/source.py', 'postgis-adapter/native.py', 'postgis-adapter/package.py'].every(path => seen.has(path)),
  'APPLICATION_QGIS_SOURCE_INCOMPLETE');
  if (runtimeFile) {
    need(binding.nativeRuntimeFile?.path === runtimeFile.path && binding.nativeRuntimeFile.sha256 === runtimeFile.sha256,
      'APPLICATION_QGIS_RUNTIME_CHANGED');
    inputs.push(runtimeFile);
  } else need(binding.nativeRuntimeFile === null && Object.keys(binding.nativeRuntime).length === 0, 'APPLICATION_QGIS_RUNTIME_CHANGED');
  if (binding.nativeRuntime.native_command) {
    const selected = await selectedExecutable(binding.nativeRuntime.native_command[0]);
    inputs.push(...selected.inputs);
    for (const key of ['qfieldsync_path', 'prefix_path'])
      if (binding.nativeRuntime[key]) inputs.push(await inputPath(binding.nativeRuntime[key], 'directory'));
  }
  const args = ['--python', python.executable, '--workspace', workspace.path, '--source-root', sourceRoot,
    '--expected-binding', binding.sha256];
  if (runtimeFile) args.push('--native-runtime-file', runtimeFile.path);
  if (settings.connectionFile) {
    const connection = await inputPath(absolute(settings.connectionFile), 'file', true, true);
    need(!connection.exists, 'APPLICATION_QGIS_CONNECTION_EXISTS', 'Choose a new connection file for this listener.');
    inputs.push(connection); args.push('--connection-file', connection.path);
  }
  return {args, inputs, createDirectories: [],
    resourceKey: valueSha({family: 'stac-qgis-analyst', directory: workspace.path, workspaceId: binding.workspaceId})};
}
export function qgisAnalystSelection(request) {
  need(request.command === 'stac-qgis-analyst' && !request.pythonCommand && Array.isArray(request.args) &&
    request.args.length % 2 === 0, 'APPLICATION_QGIS_SELECTION_CHANGED');
  const allowed = new Set(['--python', '--workspace', '--source-root', '--expected-binding', '--native-runtime-file', '--connection-file', '--port']);
  const options = new Map();
  for (let index = 0; index < request.args.length; index += 2) {
    const [name, value] = request.args.slice(index, index + 2);
    need(allowed.has(name) && !options.has(name) && typeof value === 'string' && value && !value.includes('\0'),
      'APPLICATION_QGIS_SELECTION_CHANGED');
    options.set(name, value);
  }
  need(['--python', '--workspace', '--source-root', '--expected-binding'].every(name => options.has(name)) &&
    HASH.test(options.get('--expected-binding')), 'APPLICATION_QGIS_SELECTION_CHANGED');
  const port = options.get('--port') || '0';
  need(/^(0|[1-9][0-9]*)$/.test(port) && Number(port) <= 65535, 'APPLICATION_QGIS_SELECTION_CHANGED');
  return {workspace: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    sourceRoot: absolute(options.get('--source-root')), bindingSha256: options.get('--expected-binding'),
    runtimeFile: options.has('--native-runtime-file') ? absolute(options.get('--native-runtime-file')) : null,
    connectionFile: options.has('--connection-file') ? absolute(options.get('--connection-file')) : null,
    port: Number(port)};
}
async function requestEnvironment(request) {
  if (!request.environmentFile) return process.env;
  const path = absolute(request.environmentFile), info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077) && info.size <= 1048576,
    'APPLICATION_QGIS_ENVIRONMENT_CHANGED');
  const values = JSON.parse(await readFile(path, 'utf8'));
  need(plain(values) && Object.entries(values).every(([name, value]) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && typeof value === 'string' && !value.includes('\0')),
  'APPLICATION_QGIS_ENVIRONMENT_CHANGED');
  return {...process.env, ...values};
}
export async function verifyQgisAnalystLaunch(request) {
  const selection = qgisAnalystSelection(request);
  const native = await nativeAt(selection.sourceRoot), environment = await requestEnvironment(request);
  const parameters = {pythonExecutable: selection.python, workspaceDirectory: selection.workspace,
    nativeRuntimeFile: selection.runtimeFile, environment};
  const selected = validateBinding(await native.inspectAnalystBinding({...parameters, sourceRoot: selection.sourceRoot}),
    {workspace: selection.workspace, python: selection.python, sourceRoot: selection.sourceRoot});
  need(selected.sha256 === selection.bindingSha256 && await realpath(selected.python.executable) === await realpath(selection.python),
    'APPLICATION_QGIS_BINDING_CHANGED');
  const executedSourceRoot = await realpath(join(absolute(request.releaseDirectory), 'source', SOURCE));
  const executing = await (await nativeAt(executedSourceRoot)).inspectAnalystBinding({...parameters, sourceRoot: executedSourceRoot});
  validateBinding(executing, {workspace: selection.workspace, python: selection.python, sourceRoot: executedSourceRoot});
  need(executing.sha256 === selected.sha256, 'APPLICATION_QGIS_SOURCE_CHANGED',
    'The executing release must contain the same reviewed original analyst source.');
  return {selection, binding: selected, executedSourceRoot};
}
async function liveStartup(url) {
  const response = await fetch(new URL('/api/launch', url), {redirect: 'error',
    headers: {'X-Starforge-Qgis-Workspace': url.hash.slice(1)}, signal: AbortSignal.timeout(5000)});
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') || ''),
    'APPLICATION_QGIS_STARTUP_UNAVAILABLE');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    need(length <= 2097152, 'APPLICATION_QGIS_STARTUP_UNAVAILABLE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function qgisAnalystStartup(request, text) {
  if (request.command !== 'stac-qgis-analyst' || typeof text !== 'string' || text.length > 32768 ||
    !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'QGIS_ANALYST_READY') return null;
  const {selection, binding, executedSourceRoot} = await verifyQgisAnalystLaunch(request);
  need(value.workspaceId === binding.workspaceId && value.workspaceDirectory === selection.workspace &&
    value.bindingSha256 === selection.bindingSha256 && value.sourceRoot === executedSourceRoot &&
    value.sourceSha256 === binding.sourceSha256 && UUID.test(value.instanceId ?? '') &&
    Number.isSafeInteger(value.pid) && value.pid > 0 &&
    value.nativeRuntimeSelected === !!binding.nativeRuntime.native_command,
  'APPLICATION_QGIS_STARTUP_CHANGED');
  let url;
  try { url = new URL(value.operatorUrl); } catch { need(false, 'APPLICATION_QGIS_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && /^#[a-f0-9]{64}$/.test(url.hash) &&
    port >= 1 && port <= 65535 && (!selection.port || selection.port === port),
  'APPLICATION_QGIS_STARTUP_CHANGED');
  const live = await liveStartup(url);
  need(valueSha(live) === valueSha(value), 'APPLICATION_QGIS_STARTUP_CHANGED',
    'The live authenticated listener must match the announced original project instance.');
  return {url: url.href, workspaceId: binding.workspaceId,
    ...(selection.connectionFile ? {connectionFile: selection.connectionFile} : {}),
    original: {schema: STARTUP, workspaceId: binding.workspaceId, workspaceDirectory: selection.workspace,
      bindingSha256: selection.bindingSha256, sourceRoot: executedSourceRoot, sourceSha256: binding.sourceSha256,
      nativeRuntimeSelected: value.nativeRuntimeSelected, instanceId: value.instanceId, pid: value.pid}};
}
