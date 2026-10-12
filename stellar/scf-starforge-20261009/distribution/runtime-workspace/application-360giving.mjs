// MIT. Open the saved publisher through its original Python/Node console.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { realpath } from 'node:fs/promises';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, canonical, digest, need, plain, privateDirectory,
  recordId, operationId, readJSON, saveJSON } from './storage.mjs';

const run = promisify(execFile);
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk';
const OPERATOR = ROOT + '/ndjson/360giving/operator';
const BINDING = 'stellar-forge.360giving-managed-binding.v1';
export const PUBLISHER_STARTUP = 'stellar-forge.360giving-console.v1';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const shared = new Set(['dataset-handler.mjs', 'xml/workspace.py', 'xml/xml_source.py',
  'xml/native.mjs', 'xml/server.py', 'ndjson/application.py', 'ndjson/ndjson_source.py']);
const required = [...shared, ...['publisher.py', 'operator/publisher_workspace.py',
  'operator/operator_server.py', 'operator/cli.py', 'operator/cli.mjs',
  'operator/managed.py', 'operator/client.py', 'operator/public/index.html',
  'operator/public/app.js', 'operator/public/review-bridge.js', 'operator/public/style.css']
  .map(name => 'ndjson/360giving/' + name)];
const sourcePath = name => typeof name === 'string' && !name.includes('\\') &&
  !name.includes(':') && !name.split('/').some(part => !part || part === '.' || part === '..') &&
  (shared.has(name) || name === 'stellar-expert/exact-json.mjs' || name.startsWith('ndjson/360giving/'));
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function publisherApplication(common = []) {
  return {
    id: 'publisher-360giving', command: 'dataset-360giving-workspace',
    title: '360Giving publisher workspace', terminal: false,
    requiredSource: OPERATOR + '/managed.py',
    description: 'Save source reviews and candidates, query complete native grant datasets, and receive full publisher handoffs.',
    fields: [
      field('workspaceDirectory', 'Saved publisher workspace', 'path', true,
        'Choose the private directory initialized or received by the 360Giving workspace command.'),
      field('pythonExecutable', 'Existing Python executable', 'path', true,
        'Select Python 3.11 or newer with the original publisher requirements installed.'),
      ...common,
    ],
  };
}

export async function preparePublisherApplication(settings, {
  inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function' &&
    typeof applicationEnvironment === 'function', 'APPLICATION_360GIVING_CONTEXT_REQUIRED');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const python = await selectedExecutable(settings.pythonExecutable);
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const sourceRoot = await realpath(join(selected.sourceRoot, ROOT));
  const cli = join(sourceRoot, 'ndjson', '360giving', 'operator', 'cli.py');
  const { environment } = await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const output = await run(python.executable, [cli, '--workspace', workspace.path, 'binding'], {
      encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000, windowsHide: true,
      env: { ...environment, SF30_XML_NODE: environment.SF30_XML_NODE || process.execPath,
        PYTHONDONTWRITEBYTECODE: '1' },
    });
    observed = JSON.parse(output.stdout);
  } catch (error) {
    need(false, 'APPLICATION_360GIVING_BINDING_UNAVAILABLE',
      'The original publisher could not open with the selected Python: ' +
      String(error.stderr || error.message || error).trim().slice(0, 1500));
  }
  need(plain(observed) && observed.schema === BINDING && observed.workspace === workspace.path &&
    observed.sourceRoot === sourceRoot && uuid(observed.workspaceId) &&
    plain(observed.workspaceIdentity) && plain(observed.python) && plain(observed.node) &&
    plain(observed.dependencies?.jsonschema) && plain(observed.source) && hex(observed.sha256),
  'APPLICATION_360GIVING_BINDING_CHANGED');
  const { sha256, sourceRoot: inspectedRoot, ...bound } = observed;
  need(digest(JSON.stringify(canonical(bound)) + '\n') === sha256,
    'APPLICATION_360GIVING_BINDING_CHANGED');
  need(await realpath(observed.python.executable) === await realpath(python.executable) &&
    Array.isArray(observed.python.version) && observed.python.version.length === 3 &&
    observed.python.version.every(Number.isSafeInteger) &&
    (observed.python.version[0] > 3 || observed.python.version[0] === 3 && observed.python.version[1] >= 11),
  'APPLICATION_360GIVING_PYTHON_CHANGED');
  const sourceNames = Object.keys(observed.source);
  need(sourceNames.length <= 2000 && required.every(name => hex(observed.source[name])) &&
    sourceNames.every(name => sourcePath(name) && hex(observed.source[name])),
  'APPLICATION_360GIVING_SOURCE_INCOMPLETE');
  const inputs = [workspace, ...python.inputs];
  for (const name of sourceNames.sort()) {
    const item = await inputPath(join(sourceRoot, name), 'file');
    need(item.sha256 === observed.source[name], 'APPLICATION_360GIVING_SOURCE_CHANGED');
    inputs.push(item);
  }
  const marker = await inputPath(join(workspace.path, 'workspace.json'), 'file');
  need(marker.sha256 === observed.workspaceIdentity.markerSha256 &&
    String(marker.dev) === observed.workspaceIdentity.markerDevice &&
    String(marker.ino) === observed.workspaceIdentity.markerInode &&
    String(workspace.dev) === observed.workspaceIdentity.device &&
    String(workspace.ino) === observed.workspaceIdentity.inode,
  'APPLICATION_360GIVING_WORKSPACE_CHANGED');
  inputs.push(marker);
  const node = await selectedExecutable(observed.node.executable);
  const binary = node.inputs.find(item => item.path === observed.node.executable);
  need(binary && String(binary.dev) === observed.node.device && String(binary.ino) === observed.node.inode &&
    binary.bytes === observed.node.bytes, 'APPLICATION_360GIVING_NODE_CHANGED');
  inputs.push(...node.inputs);
  const dependency = await inputPath(observed.dependencies.jsonschema.module, 'file');
  need(dependency.sha256 === observed.dependencies.jsonschema.sha256,
    'APPLICATION_360GIVING_DEPENDENCY_CHANGED');
  inputs.push(dependency);
  return {
    args: ['--python', python.executable, '--workspace', workspace.path,
      'serve', '--expected-binding', sha256],
    inputs, createDirectories: [],
  };
}

function selection(request) {
  need(Array.isArray(request.args) && request.args.length === 9 &&
    request.args[0] === '--python' && request.args[2] === '--workspace' &&
    request.args[4] === 'serve', 'APPLICATION_360GIVING_STARTUP_CHANGED');
  const flags = [...request.args.slice(0, 4), ...request.args.slice(5)], options = new Map();
  for (let i = 0; i < flags.length; i += 2) {
    const name = flags[i], value = flags[i + 1];
    need(['--python', '--workspace', '--expected-binding', '--port'].includes(name) &&
      !options.has(name) && typeof value === 'string', 'APPLICATION_360GIVING_STARTUP_CHANGED');
    options.set(name, value);
  }
  need(options.size === 4 && hex(options.get('--expected-binding')) &&
    /^(0|[1-9]\d*)$/.test(options.get('--port')) && Number(options.get('--port')) <= 65535,
  'APPLICATION_360GIVING_STARTUP_CHANGED');
  return { workspace: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    binding: options.get('--expected-binding'), port: Number(options.get('--port')) };
}

export async function publisherStartup(request, text) {
  if (request.command !== 'dataset-360giving-workspace' || typeof text !== 'string' ||
      Buffer.byteLength(text) > 16384 || !text.startsWith('{"schema":"' + PUBLISHER_STARTUP + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== PUBLISHER_STARTUP || value.status !== '360GIVING_WORKSPACE_READY') return null;
  const selected = selection(request);
  need(value.workspace === selected.workspace && value.bindingSha256 === selected.binding &&
    uuid(value.workspaceId) && plain(value.python) && plain(value.node) &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.sourceRoot === 'string',
  'APPLICATION_360GIVING_STARTUP_CHANGED');
  need(await realpath(value.python.executable) === await realpath(selected.python) &&
    await realpath(value.sourceRoot) === await realpath(join(absolute(request.releaseDirectory), 'source', ROOT)),
  'APPLICATION_360GIVING_EXECUTION_CHANGED');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_360GIVING_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (!selected.port || port === selected.port) &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)), 'APPLICATION_360GIVING_STARTUP_CHANGED');
  const response = await fetch(new URL('/api/launch', url), {
    redirect: 'error', headers: { authorization: 'Bearer ' + url.hash.slice(1) },
    signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') &&
    /^\d+$/.test(response.headers.get('content-length') ?? '') &&
    Number(response.headers.get('content-length')) <= 16384, 'APPLICATION_360GIVING_STARTUP_UNAVAILABLE');
  const active = await response.json();
  need(JSON.stringify(canonical(active)) === JSON.stringify(canonical(value)),
    'APPLICATION_360GIVING_STARTUP_CHANGED', 'The live publisher differs from its startup announcement.');
  return { url: url.href, original: {
    schema: PUBLISHER_STARTUP, workspace: selected.workspace, workspaceId: value.workspaceId,
    bindingSha256: selected.binding, sourceRoot: value.sourceRoot,
    python: value.python, node: value.node, pid: value.pid,
  } };
}

export async function savePublisherApplicationConnection(request, directory, record) {
  const id = recordId(request.applicationId), operation = operationId(directory.split('/').at(-1));
  const applicationDirectory = join(dirname(dirname(absolute(directory))), 'applications', id);
  await privateDirectory(applicationDirectory);
  const saved = await readJSON(join(applicationDirectory, 'application.json'));
  const run = await readJSON(join(applicationDirectory, 'runs', operation + '.json'));
  need(saved.id === id && run.applicationId === id && run.id === operation &&
    saved.revision === run.revision && run.request.command === 'dataset-360giving-workspace' &&
    run.request.releaseId === request.releaseId && run.request.homeId === request.homeId &&
    JSON.stringify(run.request.args) === JSON.stringify(request.args) &&
    record.applicationId === id && record.operationId === operation &&
    record.workspaceId === record.original.workspaceId, 'APPLICATION_360GIVING_CONNECTION_CHANGED');
  const path = join(applicationDirectory, '360giving-connection.json');
  const previous = await readJSON(path, true);
  // A reviewed new application revision can deliberately select another publisher.
  // The current saved revision and original run above authorize this replacement.
  need(!previous || previous.schema === 'stellar-forge.application-url.v1' &&
    previous.applicationId === id && previous.command === 'dataset-360giving-workspace',
  'APPLICATION_360GIVING_CONNECTION_CHANGED');
  await saveJSON(path, record, true);
  return path;
}
