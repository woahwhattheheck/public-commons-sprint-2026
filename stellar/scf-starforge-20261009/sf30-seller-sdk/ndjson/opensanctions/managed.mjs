// MIT. Source monitoring in the original Applications and NDJSON lifecycle.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { absolute, canonical, digest, need, plain } from '../../../distribution/runtime-workspace/storage.mjs';
import { prepareNdjsonApplication } from '../../../distribution/runtime-workspace/application-ndjson.mjs';

const run = promisify(execFile);
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk';
export const OPENSANCTIONS_BINDING = 'stellar-forge.opensanctions-managed-binding.v1';
export const OPENSANCTIONS_STARTUP = 'stellar-forge.opensanctions-workspace-launch.v1';
export const OPENSANCTIONS_SOURCE_FILES = Object.freeze([
  'model.py', 'updates.py', 'matching.py', 'web.py', 'cli.py',
  'application_binding.py', 'cli.mjs', 'managed.mjs', 'application-provider.mjs',
  'public/index.html', 'public/app.js', 'public/style.css', 'SOURCE_CONTRACT.json',
]);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function opensanctionsApplication(common = []) {
  return {
    id: 'opensanctions', command: 'source-monitoring', title: 'OpenSanctions source monitoring',
    terminal: false, requiredSource: ROOT + '/ndjson/opensanctions/application_binding.py',
    description: 'Receive original data editions and changes, inspect native screening responses, preserve separate identity and relevance decisions, and export the complete customer workspace.',
    fields: [
      field('workspaceDirectory', 'Original source-monitoring workspace', 'path', true,
        'Choose the private NDJSON workspace initialized or received by the original source-monitoring command.'),
      field('pythonExecutable', 'Existing Python executable', 'path', true,
        'Select the absolute Python 3.11+ executable; the existing interpreter and environment remain on this host.'),
      field('connectionFile', 'Private console connection file', 'path', false,
        'Optional new private file for the original console connection. The console owns and removes only its exact file.'),
      ...common,
    ],
  };
}

export async function prepareOpenSanctionsApplication(settings, context = {}) {
  const native = await prepareNdjsonApplication(settings, context);
  const { inputPath, applicationEnvironment } = context;
  const python = native.args[1], workspace = native.args[3];
  const sourceRoot = native.binding.sourceRoot;
  const { environment } = await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const result = await run(python, [join(sourceRoot, 'ndjson/opensanctions/cli.py'),
      '--workspace', workspace, 'binding'], {
      encoding: 'utf8', maxBuffer: 65536, timeout: 15000, windowsHide: true, env: environment,
    });
    observed = JSON.parse(result.stdout);
  } catch (error) {
    need(false, 'APPLICATION_OPENSANCTIONS_BINDING_UNAVAILABLE',
      'The original source-monitoring binding could not open: ' +
      String(error.stderr || error.message || error).trim().slice(0, 1500));
  }
  need(plain(observed) && observed.schema === OPENSANCTIONS_BINDING &&
    observed.domainSchema === 'starforge.opensanctions-workspace.v1' &&
    observed.workspace === workspace && observed.sourceRoot === sourceRoot &&
    observed.nativeBindingSha256 === native.binding.sha256 &&
    plain(observed.source) && plain(observed.workspaceIdentity) && plain(observed.python) &&
    hex(observed.sha256), 'APPLICATION_OPENSANCTIONS_BINDING_CHANGED');
  const { sha256, sourceRoot: ignoredRoot, ...core } = observed;
  need(digest(JSON.stringify(canonical(core)) + '\n') === sha256,
    'APPLICATION_OPENSANCTIONS_BINDING_CHANGED');
  for (const key of ['workspaceIdentity', 'python'])
    need(JSON.stringify(canonical(observed[key])) === JSON.stringify(canonical(native.binding[key])),
      'APPLICATION_OPENSANCTIONS_NATIVE_IDENTITY_CHANGED');
  const expected = [...Object.keys(native.binding.source),
    ...OPENSANCTIONS_SOURCE_FILES.map(name => 'ndjson/opensanctions/' + name)];
  need(Object.keys(observed.source).length === expected.length &&
    expected.every(name => hex(observed.source[name])) &&
    Object.entries(native.binding.source).every(([name, hash]) => observed.source[name] === hash),
  'APPLICATION_OPENSANCTIONS_SOURCE_INCOMPLETE');
  const inputs = [...native.inputs];
  for (const name of OPENSANCTIONS_SOURCE_FILES) {
    const relative = 'ndjson/opensanctions/' + name;
    const item = await inputPath(join(sourceRoot, relative), 'file');
    need(item.sha256 === observed.source[relative], 'APPLICATION_OPENSANCTIONS_SOURCE_CHANGED',
      'The source-monitoring application changed during the original review.');
    inputs.push(item);
  }
  const args = [...native.args], index = args.indexOf('--expected-binding');
  need(index >= 0 && args[index + 1] === native.binding.sha256,
    'APPLICATION_OPENSANCTIONS_NATIVE_COMMAND_CHANGED');
  args[index + 1] = sha256;
  return { args, inputs, createDirectories: [], binding: observed };
}

function selection(request) {
  const args = request.args;
  need(Array.isArray(args) && args.length >= 11 && args[0] === '--python' &&
    args[2] === '--workspace' && args[4] === 'serve', 'APPLICATION_OPENSANCTIONS_STARTUP_CHANGED');
  const flags = [...args.slice(0, 4), ...args.slice(5)], options = new Map();
  need(flags.length % 2 === 0, 'APPLICATION_OPENSANCTIONS_STARTUP_CHANGED');
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i], value = flags[i + 1];
    need(['--python', '--workspace', '--expected-binding', '--startup-format',
      '--connection-file', '--port'].includes(key) && !options.has(key) &&
      typeof value === 'string', 'APPLICATION_OPENSANCTIONS_STARTUP_CHANGED');
    options.set(key, value);
  }
  need(options.size === (options.has('--connection-file') ? 6 : 5) &&
    options.get('--startup-format') === 'json' && hex(options.get('--expected-binding')) &&
    /^(0|[1-9]\d*)$/.test(options.get('--port')) && Number(options.get('--port')) <= 65535,
  'APPLICATION_OPENSANCTIONS_STARTUP_CHANGED');
  return {
    workspace: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    binding: options.get('--expected-binding'), port: Number(options.get('--port')),
    connection: options.has('--connection-file') ? absolute(options.get('--connection-file')) : null,
  };
}

export async function opensanctionsStartup(request, text) {
  if (request.command !== 'source-monitoring' || typeof text !== 'string' ||
      text.length > 16384 || !text.startsWith('{')) return null;
  let value; try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== OPENSANCTIONS_STARTUP ||
      value.status !== 'OPENSANCTIONS_WORKSPACE_READY') return null;
  const selected = selection(request);
  need(value.domainSchema === 'starforge.opensanctions-workspace.v1' &&
    value.workspace === selected.workspace && value.bindingSha256 === selected.binding &&
    hex(value.nativeBindingSha256) && (value.connectionFile ?? null) === selected.connection &&
    plain(value.python) && Array.isArray(value.python.version) && value.python.version.length === 3 &&
    value.python.version.every(Number.isSafeInteger) && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.sourceRoot === 'string', 'APPLICATION_OPENSANCTIONS_STARTUP_CHANGED');
  need(await realpath(value.python.executable) === await realpath(selected.python) &&
    await realpath(value.sourceRoot) === await realpath(join(absolute(request.releaseDirectory), 'source', ROOT)),
  'APPLICATION_OPENSANCTIONS_EXECUTION_CHANGED');
  let url; try { url = new URL(value.console); } catch { need(false, 'APPLICATION_OPENSANCTIONS_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (!selected.port || port === selected.port) &&
    !url.username && !url.password && !url.search && url.pathname === '/monitor' &&
    /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)), 'APPLICATION_OPENSANCTIONS_STARTUP_CHANGED');
  const response = await fetch(new URL('/api/launch', url), {
    redirect: 'error', headers: { authorization: 'Bearer ' + url.hash.slice(1) },
    signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') &&
    /^\d+$/.test(response.headers.get('content-length') ?? '') &&
    Number(response.headers.get('content-length')) <= 16384,
  'APPLICATION_OPENSANCTIONS_STARTUP_UNAVAILABLE');
  const active = await response.json();
  need(JSON.stringify(canonical(active)) === JSON.stringify(canonical(value)),
    'APPLICATION_OPENSANCTIONS_STARTUP_CHANGED', 'The original live console differs from its announcement.');
  return {
    url: url.href,
    original: {
      schema: OPENSANCTIONS_STARTUP, domainSchema: value.domainSchema,
      workspace: selected.workspace, bindingSha256: selected.binding,
      nativeBindingSha256: value.nativeBindingSha256, sourceRoot: value.sourceRoot,
      python: value.python, pid: value.pid,
      ...(selected.connection ? { connectionFile: selected.connection } : {}),
    },
  };
}
