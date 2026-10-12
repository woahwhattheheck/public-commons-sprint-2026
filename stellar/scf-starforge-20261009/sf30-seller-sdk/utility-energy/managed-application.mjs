// MIT. Utility preparation and authenticated startup in original Applications.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, canonical, digest, need, plain } from '../../distribution/runtime-workspace/storage.mjs';

const run = promisify(execFile);
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk';
const BINDING = 'stellar-forge.utility-managed-binding.v1';
const STARTUP = 'stellar-forge.utility-workspace-launch.v1';
const APPLICATION = 'stellar-forge.utility-workspace.v1';
const SOURCE_FILES = [
  "ndjson/application.py",
  "ndjson/cli.py",
  "ndjson/cli.mjs",
  "ndjson/ndjson_source.py",
  "ndjson/managed.py",
  "ndjson/merchant.mjs",
  "ndjson/public/index.html",
  "ndjson/public/app.js",
  "ndjson/public/style.css",
  "xml/xml_source.py",
  "xml/workspace.py",
  "xml/server.py",
  "xml/native.mjs",
  "dataset-handler.mjs",
  "utility-energy/application-provider.mjs",
  "utility-energy/managed-application.mjs",
  "utility-energy/managed.py",
  "utility-energy/cli.mjs",
  "utility-energy/cli.py",
  "utility-energy/utility-client.mjs",
  "utility-energy/utility_shared.py",
  "utility-energy/utility_source.py",
  "utility-energy/utility_time.py",
  "utility-energy/utility_contracts.py",
  "utility-energy/utility_analysis.py",
  "utility-energy/utility_workspace.py",
  "utility-energy/utility_api.py",
  "utility-energy/utility_delivery.py",
  "utility-energy/utility_publisher.py",
  "utility-energy/utility_server.py",
  "utility-energy/public/app.js",
  "utility-energy/public/index.html",
  "utility-energy/public/style.css",
  "utility-energy/contracts/source-contracts.json",
  "utility-energy/contracts/espi-4.0.xsd",
  "utility-energy/contracts/atom-4.1.xsd",
  "clinicaltrials/publisher-bridge.mjs"
];
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function utilityEnergyApplication(common = []) {
  return {
    id: 'utility-energy', command: 'utility-energy', title: 'Utility data workspace', terminal: false,
    requiredSource: ROOT + '/utility-energy/managed.py',
    description: 'Receive utility sources, review interval corrections and coverage, reconcile bills, publish native datasets and reopen complete customer deliveries.',
    fields: [
      field('workspaceDirectory', 'Original Utility workspace', 'path', true,
        'Choose the private directory initialized or received by the original Utility command.'),
      field('pythonExecutable', 'Existing Python executable', 'path', true,
        'Select the absolute Python 3.11+ executable with Expat 2.6+ used by the original XML parser.'),
      field('connectionFile', 'Console connection file', 'path', false,
        'Optional new private one-line URL file for the original Utility MCP connection; the console removes it on Stop.'),
      ...common,
    ],
  };
}

export async function prepareUtilityApplication(settings, {
  inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function' &&
    typeof applicationEnvironment === 'function', 'APPLICATION_UTILITY_CONTEXT_REQUIRED');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const python = await selectedExecutable(settings.pythonExecutable);
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const sourceRoot = await realpath(join(selected.sourceRoot, ROOT));
  const inputs = [workspace, ...python.inputs];
  const { environment } = await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const output = await run(python.executable,
      [join(sourceRoot, 'utility-energy', 'cli.py'), '--workspace', workspace.path, 'binding'], {
        encoding: 'utf8', maxBuffer: 65536, timeout: 15000, windowsHide: true,
        env: { ...environment, PYTHONDONTWRITEBYTECODE: '1' },
      });
    observed = JSON.parse(output.stdout);
  } catch (error) {
    need(false, 'APPLICATION_UTILITY_BINDING_UNAVAILABLE',
      'The original Utility workspace and XML runtime could not open with the selected Python: ' +
      String(error.stderr || error.message || error).trim().slice(0, 1500));
  }
  need(plain(observed) && observed.schema === BINDING && observed.applicationSchema === APPLICATION &&
    observed.workspace === workspace.path && observed.sourceRoot === sourceRoot &&
    plain(observed.workspaceIdentity) && plain(observed.python) && plain(observed.parser) &&
    plain(observed.source) && hex(observed.sha256), 'APPLICATION_UTILITY_BINDING_CHANGED');
  const { sha256, sourceRoot: inspectedSourceRoot, ...core } = observed;
  need(digest(JSON.stringify(canonical(core)) + '\n') === sha256, 'APPLICATION_UTILITY_BINDING_CHANGED');
  need(await realpath(observed.python.executable) === await realpath(python.executable) &&
    Array.isArray(observed.python.version) && observed.python.version.length === 3 &&
    observed.python.version.every(Number.isSafeInteger) &&
    (observed.python.version[0] > 3 || observed.python.version[0] === 3 && observed.python.version[1] >= 11),
  'APPLICATION_UTILITY_PYTHON_CHANGED');
  need(observed.parser.name === 'expat' && Array.isArray(observed.parser.version) &&
    observed.parser.version.length === 3 && observed.parser.version.every(Number.isSafeInteger) &&
    (observed.parser.version[0] > 2 || observed.parser.version[0] === 2 && observed.parser.version[1] >= 6),
  'APPLICATION_UTILITY_XML_CHANGED');
  need(Object.keys(observed.source).length === SOURCE_FILES.length &&
    SOURCE_FILES.every(name => hex(observed.source[name])), 'APPLICATION_UTILITY_SOURCE_INCOMPLETE');
  for (const relative of SOURCE_FILES) {
    const item = await inputPath(join(sourceRoot, relative), 'file');
    need(item.sha256 === observed.source[relative], 'APPLICATION_UTILITY_SOURCE_CHANGED',
      'The original Utility source changed during application review.');
    inputs.push(item);
  }
  const marker = await inputPath(join(workspace.path, 'workspace.json'), 'file');
  need(marker.sha256 === observed.workspaceIdentity.markerSha256 &&
    String(marker.dev) === observed.workspaceIdentity.markerDevice &&
    String(marker.ino) === observed.workspaceIdentity.markerInode &&
    String(workspace.dev) === observed.workspaceIdentity.device &&
    String(workspace.ino) === observed.workspaceIdentity.inode, 'APPLICATION_UTILITY_WORKSPACE_CHANGED');
  inputs.push(marker);
  const args = ['--python', python.executable, '--workspace', workspace.path, 'serve',
    '--expected-binding', sha256, '--startup-format', 'json'];
  if (settings.connectionFile) {
    const connection = await inputPath(settings.connectionFile, 'file', true, true);
    need(!connection.exists, 'APPLICATION_UTILITY_CONNECTION_EXISTS',
      'Choose a new connection file, or reopen the original running console that owns the existing file.');
    inputs.push(connection);
    args.push('--connection-file', connection.path);
  }
  return { args, inputs, createDirectories: [], binding: observed };
}

function selection(request) {
  need(Array.isArray(request.args), 'APPLICATION_UTILITY_STARTUP_CHANGED');
  const args = request.args;
  need(args.length >= 11 && args[0] === '--python' && args[2] === '--workspace' &&
    args[4] === 'serve', 'APPLICATION_UTILITY_STARTUP_CHANGED');
  const flags = [...args.slice(0, 4), ...args.slice(5)], options = new Map();
  need(flags.length % 2 === 0, 'APPLICATION_UTILITY_STARTUP_CHANGED');
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i], value = flags[i + 1];
    need(['--python', '--workspace', '--expected-binding', '--startup-format', '--connection-file', '--port'].includes(key) &&
      !options.has(key) && typeof value === 'string', 'APPLICATION_UTILITY_STARTUP_CHANGED');
    options.set(key, value);
  }
  need(options.size === (options.has('--connection-file') ? 6 : 5) &&
    options.get('--startup-format') === 'json' && hex(options.get('--expected-binding')) &&
    /^(0|[1-9]\d*)$/.test(options.get('--port')) && Number(options.get('--port')) <= 65535,
  'APPLICATION_UTILITY_STARTUP_CHANGED');
  return {
    workspace: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    binding: options.get('--expected-binding'), port: Number(options.get('--port')),
    connection: options.has('--connection-file') ? absolute(options.get('--connection-file')) : null,
  };
}

function liveLaunch(url) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL('/api/launch', url), {
      method: 'GET',
      headers: { authorization: 'Bearer ' + url.hash.slice(1), origin: url.origin },
    }, response => {
      const chunks = [];
      let size = 0, length;
      try {
        need(response.statusCode === 200 &&
          /^application\/json(?:;|$)/i.test(response.headers['content-type'] ?? '') &&
          /^\d+$/.test(response.headers['content-length'] ?? ''),
        'APPLICATION_UTILITY_STARTUP_UNAVAILABLE');
        length = Number(response.headers['content-length']);
        need(length > 0 && length <= 16384, 'APPLICATION_UTILITY_STARTUP_UNAVAILABLE');
      } catch (error) { response.destroy(); reject(error); return; }
      response.on('data', chunk => {
        size += chunk.length;
        if (size > length || size > 16384) {
          response.destroy();
          reject(Object.assign(new Error('The original launch response exceeded its declared size'),
            { code: 'APPLICATION_UTILITY_STARTUP_CHANGED' }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          need(size === length, 'APPLICATION_UTILITY_STARTUP_CHANGED');
          resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
        } catch (error) { reject(error); }
      });
      response.on('aborted', () => reject(Object.assign(new Error('The original console launch response was interrupted'),
        { code: 'APPLICATION_UTILITY_STARTUP_UNAVAILABLE' })));
      response.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(Object.assign(new Error('The original console launch read timed out'),
      { code: 'APPLICATION_UTILITY_STARTUP_UNAVAILABLE' })));
    req.on('error', reject);
    req.end();
  });
}

export async function utilityEnergyStartup(request, text) {
  if (request.command !== 'utility-energy' || typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'UTILITY_WORKSPACE_READY') return null;
  const selected = selection(request);
  need(value.applicationSchema === APPLICATION && value.workspace === selected.workspace &&
    value.bindingSha256 === selected.binding && (value.connectionFile ?? null) === selected.connection &&
    plain(value.python) && Array.isArray(value.python.version) && value.python.version.length === 3 &&
    plain(value.parser) && value.parser.name === 'expat' && Array.isArray(value.parser.version) && plain(value.workspaceIdentity) &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.sourceRoot === 'string',
  'APPLICATION_UTILITY_STARTUP_CHANGED');
  need(await realpath(value.python.executable) === await realpath(selected.python) &&
    await realpath(value.sourceRoot) === await realpath(join(
      absolute(request.releaseDirectory), 'source', ROOT)),
  'APPLICATION_UTILITY_EXECUTION_CHANGED',
  'The original console must use the reviewed Python and adopted Utility source.');
  let url;
  try { url = new URL(value.console); } catch { need(false, 'APPLICATION_UTILITY_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (!selected.port || port === selected.port) &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)), 'APPLICATION_UTILITY_STARTUP_CHANGED');
  const active = await liveLaunch(url);
  need(JSON.stringify(canonical(active)) === JSON.stringify(canonical(value)),
    'APPLICATION_UTILITY_STARTUP_CHANGED',
    'The live original Utility console differs from its managed startup announcement.');
  return {
    url: url.href,
    original: {
      schema: STARTUP, applicationSchema: APPLICATION, workspace: selected.workspace,
      bindingSha256: selected.binding, sourceRoot: value.sourceRoot,
      python: value.python, parser: value.parser, workspaceIdentity: value.workspaceIdentity, pid: value.pid,
      ...(selected.connection ? { connectionFile: selected.connection } : {}),
    },
  };
}
