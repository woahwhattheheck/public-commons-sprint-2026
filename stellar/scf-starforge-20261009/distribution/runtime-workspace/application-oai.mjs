// MIT. Original OAI repository workspace in the maintained Applications lifecycle.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { absolute, canonical, digest, need, plain } from './storage.mjs';

const run = promisify(execFile);
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk';
const BINDING = 'stellar-forge.oai-managed-binding.v1';
const STARTUP = 'stellar-forge.oai-workspace-launch.v1';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function oaiApplication(common = []) {
  return {
    id: 'oai-repository', command: 'oai', title: 'Repository metadata editions', terminal: false,
    requiredSource: ROOT + '/oai-pmh/managed.py',
    description: 'Reopen original OAI responses, retained harvests, record changes, reviewed editions, typed datasets and complete receiving packages.',
    fields: [
      field('workspaceDirectory', 'Original repository workspace', 'path', true,
        'Choose the private workspace initialized or restored by the original OAI command.'),
      field('pythonExecutable', 'Existing Python executable', 'path', true,
        'Absolute Python 3.11+ executable; the selected virtual environment remains in use.'),
      ...common,
    ],
  };
}

export async function prepareOaiApplication(settings, {
  inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function' &&
    typeof applicationEnvironment === 'function', 'APPLICATION_OAI_CONTEXT_REQUIRED');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const python = await selectedExecutable(settings.pythonExecutable);
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const sourceRoot = await realpath(join(selected.sourceRoot, ROOT));
  const cli = join(sourceRoot, 'oai-pmh', 'cli.py');
  const inputs = [workspace, ...python.inputs, await inputPath(cli, 'file'),
    await inputPath(join(sourceRoot, 'oai-pmh', 'managed.py'), 'file')];
  const { environment } = await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const output = await run(python.executable, [cli, '--workspace', workspace.path, 'binding'], {
      encoding: 'utf8', maxBuffer: 65536, timeout: 15000, windowsHide: true, env: environment,
    });
    observed = JSON.parse(output.stdout);
  } catch (error) {
    need(false, 'APPLICATION_OAI_BINDING_UNAVAILABLE',
      'The original repository workspace could not open with this Python: ' +
      String(error.stderr || error.message || error).trim().slice(0, 1500));
  }
  need(plain(observed) && observed.schema === BINDING && observed.workspace === workspace.path &&
    observed.sourceRoot === sourceRoot && plain(observed.workspaceIdentity) && plain(observed.python) &&
    plain(observed.source) && hex(observed.sha256), 'APPLICATION_OAI_BINDING_CHANGED');
  const { sha256, sourceRoot: inspectedSourceRoot, ...core } = observed;
  need(digest(JSON.stringify(canonical(core)) + '\n') === sha256, 'APPLICATION_OAI_BINDING_CHANGED');
  need(await realpath(observed.python.executable) === await realpath(python.executable) &&
    Array.isArray(observed.python.version) && observed.python.version.length === 3 &&
    observed.python.version.every(Number.isSafeInteger) &&
    (observed.python.version[0] > 3 || observed.python.version[0] === 3 && observed.python.version[1] >= 11),
    'APPLICATION_OAI_PYTHON_CHANGED');
  const sourceFiles = Object.entries(observed.source);
  need(sourceFiles.length >= 15 && hex(observed.source['oai-pmh/managed.py']) &&
    hex(observed.source['oai-pmh/harvest.py']) && hex(observed.source['xml/workspace.py']) &&
    hex(observed.source['dataset-handler.mjs']), 'APPLICATION_OAI_SOURCE_INCOMPLETE');
  const indexed = new Set(inputs.map(item => item.path));
  for (const [relative, expected] of sourceFiles) {
    need(/^(?:oai-pmh\/[A-Za-z0-9_.-]+|xml\/[A-Za-z0-9_.-]+|dataset-handler\.mjs)$/.test(relative) &&
      !relative.split('/').some(part => !part || part === '.' || part === '..') && hex(expected),
      'APPLICATION_OAI_SOURCE_CHANGED');
    const item = await inputPath(join(sourceRoot, relative), 'file');
    need(item.sha256 === expected, 'APPLICATION_OAI_SOURCE_CHANGED',
      'Original repository source changed during application review.');
    if (!indexed.has(item.path)) { indexed.add(item.path); inputs.push(item); }
  }
  const marker = await inputPath(join(workspace.path, 'workspace.json'), 'file');
  need(marker.sha256 === observed.workspaceIdentity.markerSha256 &&
    String(marker.dev) === observed.workspaceIdentity.markerDevice &&
    String(marker.ino) === observed.workspaceIdentity.markerInode &&
    String(workspace.dev) === observed.workspaceIdentity.device &&
    String(workspace.ino) === observed.workspaceIdentity.inode, 'APPLICATION_OAI_WORKSPACE_CHANGED');
  inputs.push(marker);
  return { args: ['--python', python.executable, '--workspace', workspace.path, 'serve',
    '--expected-binding', sha256, '--startup-format', 'json'], inputs, binding: observed };
}

function selected(request) {
  if (request.command !== 'oai' || !Array.isArray(request.args)) return null;
  const args = request.args;
  need(args.length === 11 && args[0] === '--python' && args[2] === '--workspace' && args[4] === 'serve',
    'APPLICATION_OAI_STARTUP_CHANGED');
  const options = new Map(), flags = [...args.slice(0, 4), ...args.slice(5)];
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i], value = flags[i + 1];
    need(['--python','--workspace','--expected-binding','--startup-format','--port'].includes(key) &&
      !options.has(key) && typeof value === 'string', 'APPLICATION_OAI_STARTUP_CHANGED');
    options.set(key, value);
  }
  need(options.size === 5 && options.get('--startup-format') === 'json' &&
    hex(options.get('--expected-binding')) &&
    /^(0|[1-9]\d*)$/.test(options.get('--port')) && Number(options.get('--port')) <= 65535,
    'APPLICATION_OAI_STARTUP_CHANGED');
  return { directory: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    binding: options.get('--expected-binding'), port: Number(options.get('--port')) };
}

export async function oaiStartup(request, text) {
  if (request.command !== 'oai' || typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'OAI_WORKSPACE_READY') return null;
  const original = selected(request);
  need(original && value.workspace === original.directory && value.bindingSha256 === original.binding &&
    plain(value.python) && Array.isArray(value.python.version) && typeof value.sourceRoot === 'string' &&
    Number.isSafeInteger(value.pid) && value.pid > 0, 'APPLICATION_OAI_STARTUP_CHANGED');
  let consoleUrl;
  try { consoleUrl = new URL(value.console); } catch { need(false, 'APPLICATION_OAI_STARTUP_CHANGED'); }
  const port = Number(consoleUrl.port || 80);
  need(consoleUrl.protocol === 'http:' && consoleUrl.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (!original.port || port === original.port) &&
    !consoleUrl.username && !consoleUrl.password && !consoleUrl.search && consoleUrl.pathname === '/' &&
    /^[a-f0-9]{32}$/.test(consoleUrl.hash.slice(1)) && value.url === consoleUrl.href,
    'APPLICATION_OAI_STARTUP_CHANGED');
  const response = await fetch(new URL('/api/launch', consoleUrl), {
    redirect: 'error', headers: { 'X-OAI-Session': consoleUrl.hash.slice(1) },
    signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') &&
    /^\d+$/.test(response.headers.get('content-length') ?? '') &&
    Number(response.headers.get('content-length')) <= 16384, 'APPLICATION_OAI_STARTUP_UNAVAILABLE');
  const active = await response.json();
  need(JSON.stringify(canonical(active)) === JSON.stringify(canonical(value)),
    'APPLICATION_OAI_STARTUP_CHANGED', 'The live original OAI process differs from its launch announcement.');
  return { url: consoleUrl.href,
    links: [{ id: 'repository-metadata', label: 'Open repository metadata', url: consoleUrl.href }],
    original: { schema: STARTUP, workspace: original.directory, bindingSha256: original.binding,
      sourceRoot: value.sourceRoot, python: value.python, pid: value.pid } };
}
