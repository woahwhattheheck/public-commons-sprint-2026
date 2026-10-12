// SPDX-License-Identifier: MIT
// The original native publisher owns source selection, host mutations and receiving.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { realpath, lstat, readFile } from 'node:fs/promises';
import { absolute, canonical, digest, need, plain } from './storage.mjs';

const run = promisify(execFile);
const ROOT = 'stellar/scf-starforge-20261009';
const QWC = 'sf30-seller-sdk/stac/qwc';
const QGIS = 'sf30-seller-sdk/stac/qgis';
const BINDING = 'starforge.stac-qwc-managed-binding.v1';
const STARTUP = 'starforge.stac-qwc-launch.v1';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ownPath = value => typeof value === 'string' && !value.includes('\\') && !value.startsWith('/') &&
  value.split('/').every(part => part && part !== '.' && part !== '..') && !/[\u0000-\u001f\u007f]/.test(value);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function qwcApplication(common = []) {
  return {
    id: 'stac-qwc', command: 'stac-qwc', title: 'QWC publications', terminal: false,
    requiredSource: ROOT + '/' + QWC + '/managed.py',
    description: 'Review and publish complete native QGIS editions through the existing QWC host, restore original deployments, and receive portable project handovers.',
    fields: [
      field('workspaceDirectory', 'Original publication workspace', 'path', true,
        'Select the private directory initialized with the existing QWC host profile.'),
      field('pythonExecutable', 'Existing operator Python', 'path', true,
        'Select the absolute Python 3.11+ executable. The original host profile retains its QGIS and ConfigGenerator runtimes.'),
      field('connectionFile', 'Private console connection file', 'path', false,
        'Choose a new file for this console. Its original process removes it after native Stop completes.'),
      ...common,
    ],
  };
}

export async function prepareQwcApplication(settings, {
  inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function' &&
    typeof applicationEnvironment === 'function', 'APPLICATION_QWC_CONTEXT_REQUIRED');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const python = await selectedExecutable(settings.pythonExecutable);
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const sourceRoot = await realpath(join(selected.sourceRoot, ROOT));
  const { environment } = await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const output = await run(python.executable,
      ['-B', join(sourceRoot, QWC, 'cli.py'), '--workspace', workspace.path, 'binding'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000, windowsHide: true, env: environment });
    observed = JSON.parse(output.stdout);
  } catch (error) {
    need(false, 'APPLICATION_QWC_BINDING_UNAVAILABLE',
      'The original publisher could not open with the selected operator Python: ' +
      String(error.stderr || error.message || error).trim().slice(0, 1500));
  }
  need(plain(observed) && observed.schema === BINDING && observed.mode === 'publisher' &&
    observed.workspace === workspace.path && observed.sourceRoot === sourceRoot &&
    typeof observed.workspaceId === 'string' && /^qwc-[a-f0-9]{32}$/.test(observed.workspaceId) &&
    plain(observed.workspaceIdentity) && plain(observed.python) && plain(observed.nativeExecutables) &&
    plain(observed.generatorSource) && plain(observed.source) && hex(observed.sha256),
  'APPLICATION_QWC_BINDING_CHANGED');
  const { sha256, sourceRoot: unusedSourceRoot, ...core } = observed;
  need(digest(JSON.stringify(canonical(core)) + '\n') === sha256, 'APPLICATION_QWC_BINDING_CHANGED');
  need(await realpath(observed.python.executable) === await realpath(python.executable) &&
    Array.isArray(observed.python.version) && observed.python.version.length === 3 &&
    observed.python.version.every(Number.isSafeInteger) &&
    (observed.python.version[0] > 3 || observed.python.version[0] === 3 && observed.python.version[1] >= 11),
  'APPLICATION_QWC_PYTHON_CHANGED');
  const inputs = [workspace, ...python.inputs];
  const required = ['contract.py', 'project.py', 'generator.py', 'host.py', 'workspace.py',
    'portable.py', 'reopen.py', 'server.py', 'managed.py', 'cli.py', 'cli.mjs',
    'browser-assets.json', 'public/index.html', 'public/app.js', 'public/style.css'];
  need(required.every(name => hex(observed.source[QWC + '/' + name])) &&
    hex(observed.source[QGIS + '/starforge_stac/model.py']) &&
    hex(observed.source[QGIS + '/starforge_stac/qgis_project.py']),
  'APPLICATION_QWC_SOURCE_INCOMPLETE');
  for (const [path, sha] of Object.entries(observed.source)) {
    need(ownPath(path) && (path.startsWith(QWC + '/') || path.startsWith(QGIS + '/')) && hex(sha),
      'APPLICATION_QWC_SOURCE_INVALID');
    const item = await inputPath(join(sourceRoot, path), 'file');
    need(item.sha256 === sha, 'APPLICATION_QWC_SOURCE_CHANGED',
      'The complete original GIS or publication source changed during application review.');
    inputs.push(item);
  }
  const marker = await inputPath(join(workspace.path, 'workspace.json'), 'file');
  const identity = observed.workspaceIdentity;
  need(identity.markerPath === 'workspace.json' && marker.sha256 === identity.markerSha256 &&
    String(marker.dev) === identity.markerDevice && String(marker.ino) === identity.markerInode &&
    String(workspace.dev) === identity.device && String(workspace.ino) === identity.inode,
  'APPLICATION_QWC_WORKSPACE_CHANGED');
  inputs.push(marker);
  const markerBody = await readFile(marker.path);
  need(digest(markerBody) === marker.sha256, 'APPLICATION_QWC_WORKSPACE_CHANGED');
  const retained = JSON.parse(markerBody.toString('utf8'));
  need(retained.id === observed.workspaceId && plain(retained.profile) &&
    observed.generatorSource.root === retained.profile.generatorSource &&
    Array.isArray(observed.generatorSource.files), 'APPLICATION_QWC_HOST_CHANGED');
  for (const key of ['qgisPython', 'generatorPython']) {
    const item = observed.nativeExecutables[key];
    need(plain(item) && item.path === retained.profile[key], 'APPLICATION_QWC_NATIVE_CHANGED');
    const native = await selectedExecutable(item.path);
    const resolved = await realpath(native.executable), info = await lstat(resolved, { bigint: true });
    need(resolved === item.resolvedPath && info.isFile() && !info.isSymbolicLink() &&
      String(info.dev) === item.device && String(info.ino) === item.inode &&
      String(info.size) === String(item.bytes) && String(info.mtimeNs) === item.modifiedNs,
    'APPLICATION_QWC_NATIVE_CHANGED');
    inputs.push(...native.inputs);
  }
  const generatorRoot = await inputPath(observed.generatorSource.root, 'directory');
  inputs.push(generatorRoot);
  const seen = new Set();
  for (const row of observed.generatorSource.files) {
    need(plain(row) && ownPath(row.path) && !seen.has(row.path) && hex(row.sha256) &&
      Number.isSafeInteger(row.bytes) && row.bytes >= 0, 'APPLICATION_QWC_GENERATOR_SOURCE_CHANGED');
    seen.add(row.path);
    const item = await inputPath(join(generatorRoot.path, row.path), 'file');
    need(item.sha256 === row.sha256, 'APPLICATION_QWC_GENERATOR_SOURCE_CHANGED');
    inputs.push(item);
  }
  need(seen.has('config_generator/config_generator.py'),
    'APPLICATION_QWC_GENERATOR_SOURCE_INCOMPLETE', 'Select the complete original ConfigGenerator src directory.');
  const args = ['--python', python.executable, '--workspace', workspace.path,
    'serve', '--expected-binding', sha256, '--startup-format', 'json'];
  if (settings.connectionFile) {
    const connection = await inputPath(settings.connectionFile, 'file', true, true);
    need(!connection.exists, 'APPLICATION_QWC_CONNECTION_EXISTS',
      'The original process owns its existing console connection. Choose a new file.');
    inputs.push(connection); args.push('--connection-file', connection.path);
  }
  return { args, inputs, binding: observed };
}

function selection(request) {
  need(Array.isArray(request.args), 'APPLICATION_QWC_STARTUP_CHANGED');
  const args = request.args;
  need(args[0] === '--python' && args[2] === '--workspace' && args[4] === 'serve',
    'APPLICATION_QWC_STARTUP_CHANGED');
  const flags = [...args.slice(0, 4), ...args.slice(5)], options = new Map();
  need(flags.length % 2 === 0, 'APPLICATION_QWC_STARTUP_CHANGED');
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index], value = flags[index + 1];
    need(['--python', '--workspace', '--expected-binding', '--startup-format',
      '--connection-file', '--port'].includes(key) && !options.has(key) && typeof value === 'string',
    'APPLICATION_QWC_STARTUP_CHANGED');
    options.set(key, value);
  }
  need(options.size === (options.has('--connection-file') ? 6 : 5) &&
    options.get('--startup-format') === 'json' && hex(options.get('--expected-binding')) &&
    /^(0|[1-9]\d*)$/.test(options.get('--port')) && Number(options.get('--port')) <= 65535,
  'APPLICATION_QWC_STARTUP_CHANGED');
  return { workspace: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    binding: options.get('--expected-binding'), port: Number(options.get('--port')),
    connection: options.has('--connection-file') ? absolute(options.get('--connection-file')) : null };
}

export async function qwcStartup(request, text) {
  if (request.command !== 'stac-qwc' || typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'QWC_OPERATOR_READY') return null;
  const selected = selection(request);
  need(value.mode === 'publisher' && value.workspace === selected.workspace &&
    value.bindingSha256 === selected.binding && typeof value.workspaceId === 'string' &&
    /^qwc-[a-f0-9]{32}$/.test(value.workspaceId) && (value.connectionFile ?? null) === selected.connection &&
    plain(value.python) && Array.isArray(value.python.version) && Number.isSafeInteger(value.pid) && value.pid > 0,
  'APPLICATION_QWC_STARTUP_CHANGED');
  need(await realpath(value.python.executable) === await realpath(selected.python) &&
    await realpath(value.sourceRoot) === await realpath(join(absolute(request.releaseDirectory), 'source', ROOT)),
  'APPLICATION_QWC_EXECUTION_CHANGED');
  let url;
  try { url = new URL(value.console); } catch { need(false, 'APPLICATION_QWC_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && port >= 1 && port <= 65535 &&
    (!selected.port || selected.port === port) && !url.username && !url.password && !url.search &&
    url.pathname === '/' && /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)), 'APPLICATION_QWC_STARTUP_CHANGED');
  const response = await fetch(new URL('/api/launch', url), {
    redirect: 'error', headers: { Authorization: 'Bearer ' + url.hash.slice(1) },
    signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') &&
    /^\d+$/.test(response.headers.get('content-length') ?? '') &&
    Number(response.headers.get('content-length')) <= 16384, 'APPLICATION_QWC_STARTUP_UNAVAILABLE');
  const active = await response.json();
  need(JSON.stringify(canonical(active)) === JSON.stringify(canonical(value)),
    'APPLICATION_QWC_STARTUP_CHANGED', 'The live original console differs from its startup announcement.');
  return { url: url.href, original: {
    schema: STARTUP, mode: 'publisher', workspace: selected.workspace, workspaceId: value.workspaceId,
    bindingSha256: selected.binding, sourceRoot: value.sourceRoot, python: value.python, pid: value.pid,
    ...(selected.connection ? { connectionFile: selected.connection } : {}),
  } };
}
