// MIT. Original Mercury/feed/buyer applications inside the retained runtime launcher.
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readBundle, bundlePath } from '../../../mercury-event-operations/starforge-feed/plan.mjs';
import { mercuryConfiguration } from '../../../mercury-event-operations/starforge-feed/native.mjs';
import { DELIVERY_PATH } from '../../../mercury-event-operations/starforge-feed/bridge.mjs';
import { absolute, canonical, digest, json, need, plain, privateDirectory, readJSON,
  recordId, regular } from './storage.mjs';

const SCHEMA = 'stellar-forge.event-feed-application.v1';
const SUBSCRIPTION = 'stellar-forge.event-feed-subscription.v1';
const MERCURY = 'mercury-feed', BUYER = 'buyer-event-feed';
const HEX = /^[a-f0-9]{64}$/;
const hash = value => digest(json(canonical(value)));
const same = (left, right) => hash(left) === hash(right);
const executeFile = promisify(execFile);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function eventFeedApplications(common) {
  return [
    { id: MERCURY, command: MERCURY,
      requiredSource: 'stellar/mercury-event-operations/starforge-feed/cli.mjs',
      title: 'Mercury event operations', terminal: false,
      description: 'Open the original Mercury source console, signed event feed, merchant terms and retained event lifecycle as one managed application.',
      fields: [
        field('workspaceDirectory', 'Prepared Mercury/feed bundle', 'path', true,
          'Select the complete original bundle containing bridge.json, Mercury state and the retained feed. Its four saved ports are used.'),
        field('pythonInstallationId', 'Reviewed Python runtime installation', 'text', false,
          'Choose the installation ID from the selected runtime’s Python pane, or provide an explicit existing Python executable below.'),
        field('pythonExecutable', 'Original Mercury Python executable', 'path', false,
          'Choose one Python source: its reviewed installation ID or an absolute Python 3.11+ executable. Virtual-environment paths remain intact.'),
        field('facilitator', 'Original facilitator URL', 'text', false,
          'Optional original HTTPS facilitator when the saved feed has a merchant payment plan.'),
        field('allowLocalFacilitator', 'Use an explicitly local facilitator', 'boolean'),
        ...common.filter(item => item.name !== 'port'),
      ] },
    { id: BUYER, command: BUYER,
      requiredSource: 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/event-feed/workspace.mjs',
      title: 'Event-feed buyer', terminal: true,
      description: 'Reopen the original subscription, received event pages, durable cursor, recovery and immutable exports. New collection uses its existing buyer policy.',
      fields: [
        field('workspaceDirectory', 'Original subscription directory', 'path', true,
          'Select an initialized buyer-event-feed directory containing subscription.sqlite. It retains its original buyer configuration and source runtime.'),
        field('terminalPython', 'Terminal Python executable', 'path', false,
          'Defaults to /usr/bin/python3. The original managed terminal carries the buyer’s explicit approval prompts.'),
        ...common,
      ] },
  ];
}

function nodeRuntime() {
  need(Number(process.versions.node.split('.')[0]) >= 24, 'EVENT_APPLICATION_NODE_24_REQUIRED',
    'Open this runtime workspace with Node 24 or later for the original event feed.');
}
function facilitator(value, allowLocal) {
  if (!value) {
    need(!allowLocal, 'EVENT_APPLICATION_FACILITATOR_REQUIRED');
    return null;
  }
  let url;
  try { url = new URL(value); } catch { need(false, 'EVENT_APPLICATION_FACILITATOR_INVALID'); }
  need((url.protocol === 'https:' || allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1') &&
    !url.username && !url.password && !url.search && !url.hash,
  'EVENT_APPLICATION_FACILITATOR_INVALID');
  return url.href.replace(/\/$/, '');
}
async function privateFile(path) {
  const stat = await lstat(path);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && !(stat.mode & 0o077) &&
    (process.getuid === undefined || stat.uid === process.getuid()), 'EVENT_APPLICATION_PRIVATE_FILE_REQUIRED');
}
async function pythonSelection(settings, context, selectedExecutable) {
  need(Boolean(settings.pythonInstallationId) !== Boolean(settings.pythonExecutable),
    'EVENT_APPLICATION_PYTHON_SELECTION_REQUIRED',
    'Choose the selected runtime’s Python installation or one explicit original Python executable.');
  let executable, installation = null;
  if (settings.pythonInstallationId) {
    need(context.root && context.runtimeId && context.runtime?.directory,
      'EVENT_APPLICATION_RUNTIME_CONTEXT_REQUIRED');
    const { inspectPythonInstallation } = await import('../python-runtime/workspace.mjs');
    const observed = await inspectPythonInstallation(context.root, {
      runtimeId: context.runtimeId, runtimeDirectory: context.runtime.directory,
      installationId: settings.pythonInstallationId,
    });
    executable = observed.installation.python;
    installation = {
      runtimeId: context.runtimeId, runtimeDirectory: context.runtime.directory,
      installationId: observed.installation.id, python: executable,
      sourceId: observed.installation.source.id, lockSha256: observed.installation.lockSha256,
      binding: observed.binding,
    };
  } else executable = settings.pythonExecutable;
  const selected = await selectedExecutable(executable);
  let version;
  try {
    const observed = await executeFile(selected.executable,
      ['-I', '-c', 'import json,sys; print(json.dumps(list(sys.version_info[:3])))'],
      { timeout: 10000, maxBuffer: 4096, encoding: 'utf8', windowsHide: true });
    version = JSON.parse(observed.stdout.trim());
  } catch { need(false, 'EVENT_APPLICATION_PYTHON_EXECUTABLE_REQUIRED', 'Select the original Python 3.11 or later executable.'); }
  need(Array.isArray(version) && version.length === 3 && version.every(Number.isInteger) &&
    version[0] === 3 && version[1] >= 11, 'EVENT_APPLICATION_PYTHON_311_REQUIRED');
  return { executable: selected.executable, inputs: selected.inputs, installation, version };
}

/** Read the original immutable subscription definition without changing its WAL or cursor. */
function subscriptionDefinition(directory) {
  const db = new DatabaseSync(join(directory, 'subscription.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT body,sha256 FROM definition WHERE singleton=1').get();
    need(row && HEX.test(row.sha256) && digest(row.body) === row.sha256,
      'EVENT_APPLICATION_SUBSCRIPTION_DEFINITION_CHANGED');
    const value = JSON.parse(row.body);
    need(value.schema === SUBSCRIPTION && value.directory === directory &&
      typeof value.subscriptionKey === 'string' && value.subscriptionKey &&
      typeof value.id === 'string' && typeof value.feedId === 'string',
    'EVENT_APPLICATION_SUBSCRIPTION_BINDING_CHANGED');
    for (const name of ['runtimeDirectory', 'buyerStateDirectory']) absolute(value[name]);
    return { definition: value, sha256: row.sha256 };
  } finally { db.close(); }
}

/** Construct exact original argv; all provider and buyer execution stays in those commands. */
export async function prepareEventFeedApplication(kind, settings, {
  inputPath, selectedExecutable, ...context
} = {}) {
  nodeRuntime();
  need([MERCURY, BUYER].includes(kind), 'EVENT_APPLICATION_KIND_INVALID');
  const directory = absolute(settings.workspaceDirectory), inputs = [];
  inputs.push(await inputPath(directory, 'directory', false, true));
  if (kind === BUYER) {
    const database = join(directory, 'subscription.sqlite');
    inputs.push(await inputPath(database, 'file'));
    const { definition, sha256 } = subscriptionDefinition(directory);
    inputs.push(await inputPath(definition.runtimeDirectory, 'directory'));
    inputs.push(await inputPath(definition.buyerStateDirectory, 'directory', true, true));
    return {
      args: ['workspace', '--dir', directory], inputs,
      identity: { schema: SCHEMA, kind, directory, definitionSha256: sha256,
        subscriptionKey: definition.subscriptionKey, subscriptionId: definition.id,
        feedId: definition.feedId, endpoint: definition.endpoint,
        sourceRuntimeDirectory: definition.runtimeDirectory,
        buyerStateDirectory: definition.buyerStateDirectory, port: settings.port ?? 0 },
    };
  }
  const bundle = await readBundle(directory);
  const mercury = await mercuryConfiguration(bundle);
  const feed = bundlePath(directory, bundle.config.stateDirectory);
  const environment = bundlePath(directory, bundle.config.bridgeEnvFile);
  await privateFile(environment);
  inputs.push(await inputPath(join(directory, 'bridge.json'), 'file'));
  inputs.push(await inputPath(mercury.path, 'file'));
  inputs.push(await inputPath(environment, 'file'));
  inputs.push(await inputPath(feed, 'directory', false, true));
  inputs.push(await inputPath(join(feed, 'events.sqlite'), 'file'));
  const python = await pythonSelection(settings, context, selectedExecutable);
  inputs.push(...python.inputs);
  const selectedFacilitator = facilitator(settings.facilitator, settings.allowLocalFacilitator);
  const args = ['run', '--bundle', directory, '--python', python.executable];
  if (selectedFacilitator) args.push('--facilitator', selectedFacilitator);
  if (settings.allowLocalFacilitator) args.push('--allow-local-facilitator');
  return {
    args, inputs,
    identity: { schema: SCHEMA, kind, directory,
      bridgeSha256: bundle.descriptorSha256,
      mercuryConfig: mercury.path,
      mercuryConfigSha256: digest(await regular(mercury.path, 262144)),
      environmentFile: environment,
      storeId: bundle.config.storeId, sourceId: bundle.config.sourceId,
      feedIds: bundle.config.feedIds, scope: bundle.config.scope,
      ports: bundle.config.ports, feedDirectory: feed,
      python: { executable: python.executable, installation: python.installation, version: python.version },
    },
  };
}

async function retainedLaunch(request, operationDirectory) {
  need(request.applicationId && [MERCURY, BUYER].includes(request.command),
    'EVENT_APPLICATION_REQUEST_REQUIRED');
  const root = dirname(dirname(operationDirectory));
  const id = operationDirectory.split('/').at(-1);
  const run = await readJSON(join(root, 'applications', recordId(request.applicationId), 'runs', id + '.json'));
  need(run.id === id && run.applicationId === request.applicationId &&
    Object.entries(run.request).every(([name, value]) => Object.hasOwn(request, name) && same(value, request[name])),
  'EVENT_APPLICATION_ORIGINAL_RUN_CHANGED');
  const reviewed = await readJSON(join(root, 'application-reviews', recordId(run.reviewId) + '.json'));
  const identity = reviewed.command?.eventFeed;
  need(reviewed.schema === 'stellar-forge.application-start-review.v1' &&
    reviewed.applicationId === request.applicationId &&
    identity?.schema === SCHEMA && identity.kind === request.command &&
    reviewed.command.command === request.command && same(reviewed.command.args, request.args),
  'EVENT_APPLICATION_ORIGINAL_REVIEW_CHANGED');
  return { root, id, reviewed, identity };
}
async function recheckInput(expected) {
  absolute(expected.path);
  need(await realpath(dirname(expected.path)) === dirname(expected.path), 'EVENT_APPLICATION_INPUT_PARENT_CHANGED');
  let actual;
  try { actual = await lstat(expected.path); }
  catch (error) {
    if (error.code === 'ENOENT' && expected.exists === false) return;
    throw error;
  }
  need(expected.exists !== false, 'EVENT_APPLICATION_INPUT_CHANGED',
    'Review the current original application files before launching.', 409);
  if (expected.kind === 'executable-link') {
    need(actual.isSymbolicLink() && await realpath(expected.path) === expected.target &&
      actual.dev === expected.dev && actual.ino === expected.ino &&
      actual.mtimeMs === expected.mtimeMs && actual.ctimeMs === expected.ctimeMs,
    'EVENT_APPLICATION_PYTHON_CHANGED');
    return;
  }
  need(!actual.isSymbolicLink() && await realpath(expected.path) === expected.path &&
    (expected.kind === 'file' ? actual.isFile() : actual.isDirectory()) &&
    actual.dev === expected.dev && actual.ino === expected.ino,
  'EVENT_APPLICATION_INPUT_CHANGED');
  if (expected.kind === 'file') {
    need(actual.size === expected.bytes && actual.mtimeMs === expected.mtimeMs &&
      actual.ctimeMs === expected.ctimeMs, 'EVENT_APPLICATION_INPUT_CHANGED');
    if (expected.sha256) need(digest(await regular(expected.path, Math.max(expected.bytes, 1))) === expected.sha256,
      'EVENT_APPLICATION_INPUT_CHANGED');
  }
}

/** Verify the saved start immediately before the existing managed worker invokes its child. */
export async function verifyEventFeedLaunch(request, operationDirectory) {
  if (![MERCURY, BUYER].includes(request.command) || !request.applicationId) return;
  nodeRuntime();
  const selected = await retainedLaunch(request, operationDirectory);
  for (const item of selected.reviewed.command.inputs) await recheckInput(item);
  await privateDirectory(selected.identity.directory);
  if (selected.identity.kind === MERCURY) {
    const current = await readBundle(selected.identity.directory);
    const mercury = await mercuryConfiguration(current);
    need(current.descriptorSha256 === selected.identity.bridgeSha256 &&
      mercury.path === selected.identity.mercuryConfig &&
      digest(await regular(mercury.path, 262144)) === selected.identity.mercuryConfigSha256,
    'EVENT_APPLICATION_MERCURY_SOURCE_CHANGED');
    await privateFile(selected.identity.environmentFile);
    const python = selected.identity.python;
    await access(python.executable, constants.X_OK);
    if (python.installation) {
      const { inspectPythonInstallation } = await import('../python-runtime/workspace.mjs');
      const previous = python.installation;
      const observed = await inspectPythonInstallation(selected.root, {
        runtimeId: previous.runtimeId, runtimeDirectory: previous.runtimeDirectory,
        installationId: previous.installationId,
      });
      need(same(previous.binding, observed.binding) && observed.installation.id === previous.installationId &&
        observed.installation.python === python.executable && observed.installation.source.id === previous.sourceId &&
        observed.installation.lockSha256 === previous.lockSha256, 'EVENT_APPLICATION_PYTHON_CHANGED');
    }
  } else {
    const current = subscriptionDefinition(selected.identity.directory);
    need(current.sha256 === selected.identity.definitionSha256 &&
      current.definition.subscriptionKey === selected.identity.subscriptionKey,
    'EVENT_APPLICATION_SUBSCRIPTION_DEFINITION_CHANGED');
  }
}

function loopback(value, port, mode) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const actualPort = Number(url.port || 80);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      actualPort < 1 || actualPort > 65535 || port && actualPort !== port ||
      url.username || url.password) return null;
  if (mode === 'feed' && (url.pathname !== '/' || url.search ||
      !/^#token=[A-Za-z0-9_-]{32,256}$/.test(url.hash))) return null;
  if (mode === 'buyer' && (url.pathname !== '/' || url.hash ||
      [...url.searchParams.keys()].join(',') !== 'access' ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(url.searchParams.get('access') ?? ''))) return null;
  if (mode === 'origin' && (url.pathname !== '/' || url.search || url.hash)) return null;
  return url.href;
}
export async function eventFeedStartup(request, operationDirectory, value) {
  if (![MERCURY, BUYER].includes(request.command)) return null;
  if (!plain(value)) return null;
  if (request.command === MERCURY && value.schema !== 'stellar-forge.mercury-feed-session.v1') return null;
  if (request.command === BUYER && !(typeof value.url === 'string' && typeof value.directory === 'string')) return null;
  const { identity } = await retainedLaunch(request, operationDirectory);
  if (identity.kind === BUYER) {
    if (value.directory !== identity.directory) return null;
    const url = loopback(value.url, identity.port, 'buyer');
    if (!url) return null;
    return { url, links: [], original: { ...identity, observedDirectory: value.directory } };
  }
  if (value.storeId !== identity.storeId || !Array.isArray(value.feedIds) || !same(value.feedIds, identity.feedIds) ||
      value.mercury?.managed !== true) return null;
  const url = loopback(value.feedWorkspace, identity.ports.workspace, 'feed');
  const mercury = loopback(value.mercury.url, identity.ports.mercury, 'origin');
  let bridge;
  try { bridge = new URL(value.bridge); } catch { return null; }
  if (!url || !mercury || bridge.protocol !== 'http:' || bridge.hostname !== '127.0.0.1' ||
      Number(bridge.port || 80) !== identity.ports.bridge || bridge.pathname !== DELIVERY_PATH ||
      bridge.username || bridge.password || bridge.search || bridge.hash)
    return null;
  const links = [{ id: 'mercury-source', label: 'Open Mercury source', url: mercury }];
  let merchant = null;
  if (value.merchant) {
    merchant = loopback(value.merchant.url, identity.ports.merchant, 'origin');
    if (!merchant) return null;
    links.push({ id: 'merchant', label: 'Open feed merchant', url: merchant });
  }
  return { url, links, original: { ...identity,
    observed: { feedWorkspace: url, mercury, bridge: bridge.href, merchant } } };
}

/** Frame the original pretty or compact JSON announcements without guessing a port. */
export function eventFeedOutputReader(request) {
  if (![MERCURY, BUYER].includes(request.command)) return null;
  let text = '', depth = 0, quoted = false, escaped = false;
  return line => {
    const outputs = [];
    if (!text && !line.trimStart().startsWith('{')) return outputs;
    for (const character of line + '\n') {
      if (!text) {
        if (character !== '{') continue;
        text = '{'; depth = 1; quoted = false; escaped = false; continue;
      }
      text += character;
      if (text.length > 65536) { text = ''; depth = 0; quoted = false; escaped = false; return outputs; }
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === '{' || character === '[') depth++;
      else if (character === '}' || character === ']') {
        depth--;
        if (depth === 0) {
          try { outputs.push(JSON.parse(text)); } catch {}
          text = ''; quoted = false; escaped = false;
        }
      }
    }
    return outputs;
  };
}
