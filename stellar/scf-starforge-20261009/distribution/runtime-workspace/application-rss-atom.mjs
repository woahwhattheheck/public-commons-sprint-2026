// MIT. Original RSS/Atom and OPML workspace in the retained Applications lifecycle.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { absolute, canonical, digest, need, plain } from './storage.mjs';

const run = promisify(execFile);
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk';
const BINDING = 'stellar-forge.feed-managed-binding.v1';
const STARTUP = 'stellar-forge.feed-workspace-launch.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function rssAtomApplication(common = []) {
  return {
    id: 'rss-atom', command: 'dataset-feeds', title: 'RSS, Atom and subscription collections', terminal: false,
    requiredSource: ROOT + '/feeds/managed.py',
    description: 'Reopen retained feeds, original OPML, saved collections, source review, native editions and portable customer handoff.',
    fields: [
      field('workspaceDirectory', 'Original feed workspace', 'path', true,
        'Choose the private directory initialized or received by the original feed command.'),
      field('pythonExecutable', 'Existing Python executable', 'path', true,
        'Absolute Python 3.11+ executable; its virtual environment remains selected.'),
      field('landing', 'Opening page', 'text', false,
        'Use subscriptions (default) or feeds. Both consoles remain available after opening.'),
      ...common,
    ],
  };
}

export async function prepareRssAtomApplication(settings, {
  inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function' &&
    typeof applicationEnvironment === 'function', 'APPLICATION_FEEDS_CONTEXT_REQUIRED');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const python = await selectedExecutable(settings.pythonExecutable);
  const landing = settings.landing || 'subscriptions';
  need(['feeds', 'subscriptions'].includes(landing), 'APPLICATION_FEEDS_LANDING_REQUIRED',
    'Choose feeds or subscriptions as the opening page.');
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const sourceRoot = await realpath(join(selected.sourceRoot, ROOT));
  const cli = join(sourceRoot, 'feeds', 'cli.py');
  const inputs = [workspace, ...python.inputs, await inputPath(cli, 'file'),
    await inputPath(join(sourceRoot, 'feeds', 'managed.py'), 'file')];
  const { environment } = await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const output = await run(python.executable, [cli, '--workspace', workspace.path, 'binding'], {
      encoding: 'utf8', maxBuffer: 65536, timeout: 15000, windowsHide: true, env: environment,
    });
    observed = JSON.parse(output.stdout);
  } catch (error) {
    need(false, 'APPLICATION_FEEDS_BINDING_UNAVAILABLE',
      'The selected original feed workspace could not open with this Python: ' +
      String(error.stderr || error.message || error).trim().slice(0, 1500));
  }
  need(plain(observed) && observed.schema === BINDING && observed.workspace === workspace.path &&
    observed.sourceRoot === sourceRoot && plain(observed.workspaceIdentity) && plain(observed.python) &&
    plain(observed.source) && hex(observed.sha256), 'APPLICATION_FEEDS_BINDING_CHANGED');
  const { sha256, ...core } = observed;
  need(digest(JSON.stringify(canonical(core)) + '\n') === sha256, 'APPLICATION_FEEDS_BINDING_CHANGED');
  need(await realpath(observed.python.executable) === await realpath(python.executable) &&
    Array.isArray(observed.python.version) && observed.python.version.length === 3 &&
    observed.python.version.every(Number.isSafeInteger) &&
    (observed.python.version[0] > 3 || observed.python.version[0] === 3 && observed.python.version[1] >= 11),
  'APPLICATION_FEEDS_PYTHON_CHANGED');
  const sourceFiles = Object.entries(observed.source);
  need(sourceFiles.length >= 21 && hex(observed.source['feeds/managed.py']) &&
    hex(observed.source['xml/workspace.py']) && hex(observed.source['dataset-handler.mjs']),
  'APPLICATION_FEEDS_SOURCE_INCOMPLETE');
  const indexed = new Set(inputs.map(item => item.path));
  for (const [relative, expected] of sourceFiles) {
    need(/^(?:feeds\/[A-Za-z0-9_./-]+|xml\/[A-Za-z0-9_.-]+|dataset-handler\.mjs)$/.test(relative) &&
      !relative.split('/').some(part => !part || part === '.' || part === '..') && hex(expected),
    'APPLICATION_FEEDS_SOURCE_CHANGED');
    const item = await inputPath(join(sourceRoot, relative), 'file');
    need(item.sha256 === expected, 'APPLICATION_FEEDS_SOURCE_CHANGED',
      'The original feed console source changed during application review.');
    if (!indexed.has(item.path)) { indexed.add(item.path); inputs.push(item); }
  }
  const marker = await inputPath(join(workspace.path, 'workspace.json'), 'file');
  need(marker.sha256 === observed.workspaceIdentity.markerSha256 &&
    String(marker.dev) === observed.workspaceIdentity.markerDevice &&
    String(marker.ino) === observed.workspaceIdentity.markerInode &&
    String(workspace.dev) === observed.workspaceIdentity.device &&
    String(workspace.ino) === observed.workspaceIdentity.inode, 'APPLICATION_FEEDS_WORKSPACE_CHANGED');
  inputs.push(marker);
  // The original inspector binds the mutable database's inode without freezing
  // feed records, captures, operator notes or future collection revisions.
  return { args: ['--python', python.executable, '--workspace', workspace.path, 'serve',
    '--expected-binding', sha256, '--startup-format', 'json', '--landing', landing], inputs,
    binding: observed };
}

function selected(request) {
  if (request.command !== 'dataset-feeds' || !Array.isArray(request.args)) return null;
  const args = request.args;
  need(args.length >= 13 && args[0] === '--python' && args[2] === '--workspace' && args[4] === 'serve',
    'APPLICATION_FEEDS_STARTUP_CHANGED');
  const options = new Map(), flags = [...args.slice(0, 4), ...args.slice(5)];
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i], value = flags[i + 1];
    need(['--python','--workspace','--expected-binding','--startup-format','--landing','--port'].includes(key) &&
      !options.has(key) && typeof value === 'string', 'APPLICATION_FEEDS_STARTUP_CHANGED');
    options.set(key, value);
  }
  need(options.size === 6 && options.get('--startup-format') === 'json' &&
    hex(options.get('--expected-binding')) && ['feeds','subscriptions'].includes(options.get('--landing')) &&
    /^(0|[1-9]\d*)$/.test(options.get('--port')) && Number(options.get('--port')) <= 65535,
  'APPLICATION_FEEDS_STARTUP_CHANGED');
  return { directory: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    binding: options.get('--expected-binding'), port: Number(options.get('--port')), landing: options.get('--landing') };
}

export async function rssAtomStartup(request, text) {
  if (request.command !== 'dataset-feeds' || typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'FEED_WORKSPACE_READY') return null;
  const original = selected(request);
  need(original && value.workspace === original.directory && value.bindingSha256 === original.binding &&
    value.landing === original.landing && plain(value.python) && Array.isArray(value.python.version) &&
    typeof value.sourceRoot === 'string' && Number.isSafeInteger(value.pid) && value.pid > 0,
  'APPLICATION_FEEDS_STARTUP_CHANGED', 'The original feed startup must identify the reviewed workspace and source.');
  let feeds;
  try { feeds = new URL(value.feeds); } catch { need(false, 'APPLICATION_FEEDS_STARTUP_CHANGED'); }
  const port = Number(feeds.port || 80);
  need(feeds.protocol === 'http:' && feeds.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (!original.port || port === original.port) &&
    !feeds.username && !feeds.password && !feeds.search && feeds.pathname === '/' &&
    /^[A-Za-z0-9_-]{43}$/.test(feeds.hash.slice(1)), 'APPLICATION_FEEDS_STARTUP_CHANGED');
  const subscriptions = new URL('/subscriptions', feeds);
  subscriptions.hash = feeds.hash;
  need(value.subscriptions === subscriptions.href &&
    value.console === (original.landing === 'feeds' ? feeds.href : subscriptions.href),
  'APPLICATION_FEEDS_STARTUP_CHANGED');
  const endpoint = new URL('/api/launch', feeds);
  const response = await fetch(endpoint, { redirect: 'error',
    headers: { authorization: 'Bearer ' + feeds.hash.slice(1) }, signal: AbortSignal.timeout(5000) });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') &&
    /^\d+$/.test(response.headers.get('content-length') ?? '') &&
    Number(response.headers.get('content-length')) <= 16384, 'APPLICATION_FEEDS_STARTUP_UNAVAILABLE');
  const active = await response.json();
  need(JSON.stringify(canonical(active)) === JSON.stringify(canonical(value)),
    'APPLICATION_FEEDS_STARTUP_CHANGED', 'The live original feed process differs from its startup announcement.');
  return {
    url: value.console,
    links: [{ id: 'retained-feeds', label: 'Open retained feeds', url: feeds.href },
      { id: 'subscription-collections', label: 'Open subscription collections', url: subscriptions.href }],
    original: { schema: STARTUP, workspace: original.directory, bindingSha256: original.binding,
      sourceRoot: value.sourceRoot, python: value.python, pid: value.pid, landing: original.landing },
  };
}
