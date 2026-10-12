// MIT. Original retained JSON Lines console in the Applications lifecycle.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { absolute, canonical, digest, need, plain } from './storage.mjs';

const run = promisify(execFile);
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk';
const BINDING = 'stellar-forge.ndjson-managed-binding.v1';
const STARTUP = 'stellar-forge.ndjson-workspace-launch.v1';
const SOURCE_FILES = [
  'ndjson/application.py', 'ndjson/cli.py', 'ndjson/cli.mjs',
  'ndjson/ndjson_source.py', 'ndjson/managed.py', 'ndjson/merchant.mjs',
  'ndjson/public/index.html', 'ndjson/public/app.js', 'ndjson/public/style.css',
  'xml/xml_source.py', 'xml/workspace.py', 'xml/server.py', 'xml/native.mjs',
  'dataset-handler.mjs',
];
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function ndjsonApplication(common = []) {
  return {
    id: 'ndjson', command: 'dataset-ndjson', title: 'JSON Lines datasets', terminal: false,
    requiredSource: ROOT + '/ndjson/managed.py',
    description: 'Reopen original JSON Lines sources, exact mappings, native dataset queries, edition comparisons, merchant packages and complete customer handoff.',
    fields: [
      field('workspaceDirectory', 'Original JSON Lines workspace', 'path', true,
        'Choose the private directory initialized or received by the original NDJSON command.'),
      field('pythonExecutable', 'Existing Python executable', 'path', true,
        'Select the absolute Python 3.11+ executable, including its existing virtual environment.'),
      field('connectionFile', 'Console connection file', 'path', false,
        'Optional new private file for the merchant MCP connection. The original console removes it when it stops.'),
      ...common,
    ],
  };
}

export async function prepareNdjsonApplication(settings, {
  inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function' &&
    typeof applicationEnvironment === 'function', 'APPLICATION_NDJSON_CONTEXT_REQUIRED');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const python = await selectedExecutable(settings.pythonExecutable);
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const sourceRoot = await realpath(join(selected.sourceRoot, ROOT));
  const cli = join(sourceRoot, 'ndjson', 'cli.py');
  const inputs = [workspace, ...python.inputs];
  const { environment } = await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const output = await run(python.executable, [cli, '--workspace', workspace.path, 'binding'], {
      encoding: 'utf8', maxBuffer: 65536, timeout: 15000, windowsHide: true, env: environment,
    });
    observed = JSON.parse(output.stdout);
  } catch (error) {
    need(false, 'APPLICATION_NDJSON_BINDING_UNAVAILABLE',
      'The original JSON Lines workspace could not open with the selected Python: ' +
      String(error.stderr || error.message || error).trim().slice(0, 1500));
  }
  need(plain(observed) && observed.schema === BINDING && observed.workspace === workspace.path &&
    observed.sourceRoot === sourceRoot && plain(observed.workspaceIdentity) && plain(observed.python) &&
    plain(observed.source) && hex(observed.sha256), 'APPLICATION_NDJSON_BINDING_CHANGED');
  const { sha256, sourceRoot: inspectedSourceRoot, ...core } = observed;
  need(digest(JSON.stringify(canonical(core)) + '\n') === sha256, 'APPLICATION_NDJSON_BINDING_CHANGED');
  need(await realpath(observed.python.executable) === await realpath(python.executable) &&
    Array.isArray(observed.python.version) && observed.python.version.length === 3 &&
    observed.python.version.every(Number.isSafeInteger) &&
    (observed.python.version[0] > 3 || observed.python.version[0] === 3 && observed.python.version[1] >= 11),
  'APPLICATION_NDJSON_PYTHON_CHANGED');
  need(Object.keys(observed.source).length === SOURCE_FILES.length &&
    SOURCE_FILES.every(name => hex(observed.source[name])), 'APPLICATION_NDJSON_SOURCE_INCOMPLETE');
  for (const relative of SOURCE_FILES) {
    const item = await inputPath(join(sourceRoot, relative), 'file');
    need(item.sha256 === observed.source[relative], 'APPLICATION_NDJSON_SOURCE_CHANGED',
      'The original JSON Lines console source changed during application review.');
    inputs.push(item);
  }
  const marker = await inputPath(join(workspace.path, 'workspace.json'), 'file');
  need(marker.sha256 === observed.workspaceIdentity.markerSha256 &&
    String(marker.dev) === observed.workspaceIdentity.markerDevice &&
    String(marker.ino) === observed.workspaceIdentity.markerInode &&
    String(workspace.dev) === observed.workspaceIdentity.device &&
    String(workspace.ino) === observed.workspaceIdentity.inode, 'APPLICATION_NDJSON_WORKSPACE_CHANGED');
  inputs.push(marker);
  const args = ['--python', python.executable, '--workspace', workspace.path, 'serve',
    '--expected-binding', sha256, '--startup-format', 'json'];
  if (settings.connectionFile) {
    const connection = await inputPath(settings.connectionFile, 'file', true, true);
    need(!connection.exists, 'APPLICATION_NDJSON_CONNECTION_EXISTS',
      'Select a new console connection file. The original console owns any existing connection.');
    inputs.push(connection);
    args.push('--connection-file', connection.path);
  }
  return { args, inputs, binding: observed };
}

function selection(request) {
  need(Array.isArray(request.args), 'APPLICATION_NDJSON_STARTUP_CHANGED');
  const args = request.args;
  need(args.length >= 11 && args[0] === '--python' && args[2] === '--workspace' &&
    args[4] === 'serve', 'APPLICATION_NDJSON_STARTUP_CHANGED');
  const flags = [...args.slice(0, 4), ...args.slice(5)], options = new Map();
  need(flags.length % 2 === 0, 'APPLICATION_NDJSON_STARTUP_CHANGED');
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i], value = flags[i + 1];
    need(['--python', '--workspace', '--expected-binding', '--startup-format',
      '--connection-file', '--port'].includes(key) &&
      !options.has(key) && typeof value === 'string', 'APPLICATION_NDJSON_STARTUP_CHANGED');
    options.set(key, value);
  }
  need(options.size === (options.has('--connection-file') ? 6 : 5) &&
    options.get('--startup-format') === 'json' && hex(options.get('--expected-binding')) &&
    /^(0|[1-9]\d*)$/.test(options.get('--port')) && Number(options.get('--port')) <= 65535,
  'APPLICATION_NDJSON_STARTUP_CHANGED');
  return {
    workspace: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    binding: options.get('--expected-binding'), port: Number(options.get('--port')),
    connection: options.has('--connection-file') ? absolute(options.get('--connection-file')) : null,
  };
}

export async function ndjsonStartup(request, text) {
  if (request.command !== 'dataset-ndjson' || typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'NDJSON_WORKSPACE_READY') return null;
  const selected = selection(request);
  need(value.workspace === selected.workspace && value.bindingSha256 === selected.binding &&
    (value.connectionFile ?? null) === selected.connection && plain(value.python) &&
    Array.isArray(value.python.version) && value.python.version.length === 3 &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.sourceRoot === 'string',
  'APPLICATION_NDJSON_STARTUP_CHANGED');
  need(await realpath(value.python.executable) === await realpath(selected.python) &&
    await realpath(value.sourceRoot) === await realpath(join(
      absolute(request.releaseDirectory), 'source', ROOT)),
  'APPLICATION_NDJSON_EXECUTION_CHANGED', 'The original console must use the reviewed Python and adopted source.');
  let url;
  try { url = new URL(value.console); } catch { need(false, 'APPLICATION_NDJSON_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (!selected.port || port === selected.port) &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)), 'APPLICATION_NDJSON_STARTUP_CHANGED');
  const response = await fetch(new URL('/api/launch', url), {
    redirect: 'error', headers: { authorization: 'Bearer ' + url.hash.slice(1) },
    signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') &&
    /^\d+$/.test(response.headers.get('content-length') ?? '') &&
    Number(response.headers.get('content-length')) <= 16384, 'APPLICATION_NDJSON_STARTUP_UNAVAILABLE');
  const active = await response.json();
  need(JSON.stringify(canonical(active)) === JSON.stringify(canonical(value)),
    'APPLICATION_NDJSON_STARTUP_CHANGED', 'The live original console differs from its startup announcement.');
  return {
    url: url.href,
    original: {
      schema: STARTUP, workspace: selected.workspace, bindingSha256: selected.binding,
      sourceRoot: value.sourceRoot, python: value.python, pid: value.pid,
      ...(selected.connection ? { connectionFile: selected.connection } : {}),
    },
  };
}
