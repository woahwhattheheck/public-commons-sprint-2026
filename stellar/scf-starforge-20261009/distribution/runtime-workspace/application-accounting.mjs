// MIT. Original merchant accounting in the maintained Applications provider registry.
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain } from './storage.mjs';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from './application-provider.mjs';

const ROOT = 'stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/';
const BINDING = 'stellar-forge.managed-accounting-binding.v1';
const STARTUP = 'stellar-forge.managed-accounting-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PROVIDERS = ['quickbooks', 'xero'];
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
const options = [
  ['outboxDir', '--outbox'], ['proofDir', '--proof-dir'], ['termsFile', '--terms'],
  ['recoveredDir', '--recovered-dir'], ['recoveryStateRoot', '--recovery-state-root'],
  ['recoveryBackupRoot', '--recovery-backup-root'], ['rpcProxyEnv', '--rpc-proxy-env'],
  ['recoveryPassEnv', '--recovery-pass-env'], ['deliverySecretEnv', '--delivery-secret-env'],
];

export function accountingApplication(common) {
  return {
    id: 'merchant-accounting', command: 'merchant-accounting-workspace',
    title: 'Accounting workspace', terminal: false, requiredSource: ROOT + 'managed-launch.mjs',
    description: 'Open retained merchant reconciliation or an issued buyer period, review the original native accounting target, and return its bookkeeping to the same source records. Saved company choices take effect on the next reviewed start.',
    fields: [
      field('directory', 'Private accounting workspace', 'path', true,
        'An initialized buyer or merchant accounting folder. A new merchant folder uses the original source paths below.'),
      field('oauthConnectionsFile', 'Original OAuth host configuration', 'path', false,
        'Use the reviewed provider setup edition or an existing initialized registry of native accounting connections.'),
      field('selectionDirectory', 'Private company selections', 'path', false,
        'Saved QuickBooks and Xero choices. Defaults to a separate sibling folder named after the accounting workspace.'),
      field('allowLoopbackOAuth', 'Use a local development OAuth provider', 'boolean', false,
        'Only for a deliberately configured local provider. Registered production providers retain their original HTTPS endpoints.'),
      field('outboxDir', 'Original merchant outbox', 'path'),
      field('proofDir', 'Original payment proofs', 'path'),
      field('termsFile', 'Original merchant terms JSON', 'path'),
      field('recoveredDir', 'Original recovered deliveries', 'path'),
      field('recoveryStateRoot', 'Private recovery state', 'path'),
      field('recoveryBackupRoot', 'Private recovery backups', 'path'),
      field('rpcProxyEnv', 'RPC proxy environment name', 'text'),
      field('recoveryPassEnv', 'Recovery passphrase environment name', 'text'),
      field('deliverySecretEnv', 'Delivery secret environment name', 'text'),
      field('recoveryStartPaused', 'Start recovery jobs paused', 'boolean'),
      ...common.map(item => item.name === 'port' ? { ...item,
        description: 'Use the fixed nonzero listener registered for selected OAuth callbacks, or 0 for an accounting workspace without those callbacks.' } : item),
    ],
  };
}

function sameDirectory(actual, expected) {
  need(plain(expected) && actual.path === expected.directory &&
    actual.exists === expected.exists &&
    (!actual.exists || String(actual.dev) === expected.device && String(actual.ino) === expected.inode),
  'APPLICATION_ACCOUNTING_INPUT_CHANGED', 'The reviewed original private directory changed.');
}

function buyerWorkspaceBinding(value, directory) {
  if (value === undefined || value === null) return null;
  const source = value.sources;
  need(plain(value) && value.schema === 'stellar-forge.accounting-workspace-binding.v1' &&
    value.directory === directory && HASH.test(value.workspaceId ?? '') && HASH.test(value.sourcesSha256 ?? '') &&
    plain(source) && Object.keys(source).length === 4 && source.sourceMode === 'buyer' &&
    HASH.test(source.buyerSourceSha256 ?? '') && Number.isSafeInteger(source.buyerSourceBytes) &&
    source.buyerSourceBytes > 0 && source.buyerSourceBytes <= 64 * 1024 * 1024 &&
    source.buyerSourceFile === join(directory, 'inputs', source.buyerSourceSha256 + '.buyer-source.json'),
  'APPLICATION_ACCOUNTING_BINDING_CHANGED', 'Retain the original initialized buyer workspace and issued-source identity.');
  return { schema: value.schema, directory, workspaceId: value.workspaceId, sourcesSha256: value.sourcesSha256,
    sources: { sourceMode: 'buyer', buyerSourceFile: source.buyerSourceFile,
      buyerSourceSha256: source.buyerSourceSha256, buyerSourceBytes: source.buyerSourceBytes } };
}

function nativeSettings(settings) {
  const directory = absolute(settings.directory);
  const selected = {
    directory, port: settings.port ?? 0,
    connectionsFile: settings.oauthConnectionsFile ?? null,
    selectionDirectory: settings.selectionDirectory ?? join(dirname(directory), basename(directory) + '-connections'),
    allowLoopbackOAuth: settings.allowLoopbackOAuth === true,
    recoveryStartPaused: settings.recoveryStartPaused === true,
  };
  for (const [name] of options) if (settings[name]) selected[name] = settings[name];
  return selected;
}

/** Read the native inspector from the selected READY runtime; private grants remain with OAuth. */
export async function prepareAccountingApplication(settings, {
  inputPath, applicationEnvironment, runtimeDirectory,
} = {}) {
  need(typeof inputPath === 'function' && typeof applicationEnvironment === 'function',
    'APPLICATION_ACCOUNTING_INTEGRATION', 'Use the maintained Applications input and environment readers.');
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const module = join(runtime.sourceRoot, ROOT + 'managed-launch.mjs');
  const inputs = [
    await inputPath(module, 'file'),
    await inputPath(join(runtime.sourceRoot, ROOT + 'server.mjs'), 'file'),
    await inputPath(join(runtime.sourceRoot, ROOT + 'connections-workspace.mjs'), 'file'),
  ];
  const original = await import(pathToFileURL(module).href);
  need(typeof original.inspectAccountingLaunch === 'function',
    'APPLICATION_ACCOUNTING_NOT_IN_RUNTIME', 'Choose a runtime containing the maintained accounting launch inspector.');
  const raw = nativeSettings(settings);
  const { environment } = await applicationEnvironment(settings.environmentFile);
  const selected = await original.inspectAccountingLaunch(raw, { env: environment, allowMissing: true });
  const binding = selected?.binding;
  need(plain(binding) && binding.schema === BINDING && HASH.test(selected.bindingSha256 ?? '') &&
    binding.settings?.directory === raw.directory &&
    binding.settings?.connectionsFile === raw.connectionsFile &&
    binding.settings?.selectionDirectory === raw.selectionDirectory &&
    plain(binding.oauth) && Array.isArray(binding.oauth.profiles) &&
    plain(binding.selections) && plain(selected.review) &&
    selected.review.bindingSha256 === selected.bindingSha256,
  'APPLICATION_ACCOUNTING_BINDING_CHANGED', 'Review the original native accounting launch and company selections.');

  const buyer = buyerWorkspaceBinding(binding.workspaceBinding, raw.directory);
  if (buyer) {
    need(selected.review.sourceMode === 'buyer' &&
      JSON.stringify(buyerWorkspaceBinding(selected.review.workspaceBinding, raw.directory)) === JSON.stringify(buyer),
    'APPLICATION_ACCOUNTING_BINDING_CHANGED', 'The buyer source review must match its native launch binding.');
    inputs.push(await inputPath(join(runtime.sourceRoot, ROOT + 'binding.mjs'), 'file'),
      await inputPath(join(runtime.sourceRoot, ROOT + 'buyer-startup.mjs'), 'file'));
  } else need(selected.review.sourceMode !== 'buyer', 'APPLICATION_ACCOUNTING_BINDING_CHANGED');

  const createDirectories = [];
  const workspace = await inputPath(raw.directory, 'directory', true, true);
  sameDirectory(workspace, binding.oauth.output); inputs.push(workspace);
  if (!workspace.exists) createDirectories.push(workspace.path);

  if (raw.connectionsFile) {
    const registry = await inputPath(raw.connectionsFile, 'file');
    need(registry.sha256 === binding.oauth.registry?.sha256 &&
      String(registry.dev) === binding.oauth.registry.device &&
      String(registry.ino) === binding.oauth.registry.inode,
    'APPLICATION_ACCOUNTING_INPUT_CHANGED', 'The reviewed OAuth host configuration changed.');
    inputs.push(registry);
    const selections = await inputPath(raw.selectionDirectory, 'directory', true, true);
    sameDirectory(selections, binding.selectionRoot); inputs.push(selections);
    if (!selections.exists) createDirectories.push(selections.path);
    for (const provider of PROVIDERS) {
      const sha256 = binding.selections[provider];
      need(sha256 === null || HASH.test(sha256 ?? ''), 'APPLICATION_ACCOUNTING_BINDING_CHANGED');
      if (sha256 === null) continue;
      const value = selected.selections?.[provider];
      need(value?.integrity?.sha256 === sha256, 'APPLICATION_ACCOUNTING_SELECTION_CHANGED');
      const directory = await inputPath(join(raw.selectionDirectory, provider), 'directory', false, true);
      const file = await inputPath(join(directory.path, 'selection.json'), 'file');
      inputs.push(directory, { ...file, accountingSelection: {
        provider, sha256, alias: value.alias, profileSha256: value.profileSha256, grantId: value.grantId,
      } });
    }
  } else {
    need(binding.selectionRoot === null && PROVIDERS.every(provider => binding.selections[provider] === null),
      'APPLICATION_ACCOUNTING_BINDING_CHANGED');
  }
  for (const profile of binding.oauth.profiles) {
    const directory = await inputPath(profile.directory.directory, 'directory', false, true);
    need(String(directory.dev) === profile.directory.device && String(directory.ino) === profile.directory.inode,
      'APPLICATION_ACCOUNTING_INPUT_CHANGED', 'The selected native provider directory changed.');
    inputs.push({ ...directory, oauth: {
      alias: profile.alias, directoryEnv: profile.directoryEnv,
      profileSha256: profile.profileSha256, source: profile.source, callbackUri: profile.callbackUri,
    } });
  }
  for (const expected of binding.inputs) {
    const actual = await inputPath(expected.path, expected.type, false,
      ['recoveryStateRoot', 'recoveryBackupRoot'].includes(expected.name));
    need(String(actual.dev) === expected.device && String(actual.ino) === expected.inode &&
      (expected.type !== 'file' || actual.bytes === expected.bytes &&
        (!actual.sha256 || actual.sha256 === expected.sha256)),
    'APPLICATION_ACCOUNTING_INPUT_CHANGED', 'An original merchant accounting input changed.');
    inputs.push({ ...actual, accountingInput: expected.name,
      ...(expected.sha256 ? { sha256: expected.sha256 } : {}) });
  }
  const args = ['--workspace', raw.directory, '--connection-selections', raw.selectionDirectory,
    '--managed-launch-sha256', selected.bindingSha256];
  if (raw.connectionsFile) args.push('--oauth-connections', raw.connectionsFile);
  for (const [name, flag] of options) if (raw[name]) args.push(flag, raw[name]);
  if (raw.allowLoopbackOAuth) args.push('--allow-loopback-oauth');
  if (raw.recoveryStartPaused) args.push('--recovery-start-paused');
  // The maintained provider finalizer appends the reviewed --port exactly once.
  return { args, inputs, createDirectories, accounting: selected.review };
}

function selectedValue(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_ACCOUNTING_STARTUP_CHANGED');
  const indexes = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && indexes.length === 0) return null;
  need(indexes.length === 1 && typeof request.args[indexes[0] + 1] === 'string' &&
    request.args[indexes[0] + 1] && !request.args[indexes[0] + 1].startsWith('--'),
  'APPLICATION_ACCOUNTING_STARTUP_CHANGED');
  return request.args[indexes[0] + 1];
}

/** Accept the original local server's exact managed startup, bound to its reviewed argv. */
export function accountingStartup(request, operationDirectory, text, context = {}) {
  if (request.command !== 'merchant-accounting-workspace' || typeof text !== 'string' ||
      text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'ACCOUNTING_WORKSPACE_READY') return null;
  const directory = absolute(selectedValue(request, '--workspace'));
  const selectionRoot = absolute(selectedValue(request, '--connection-selections'));
  const bindingSha256 = selectedValue(request, '--managed-launch-sha256');
  const connectionsFile = selectedValue(request, '--oauth-connections', true);
  const requested = selectedValue(request, '--port', true) ?? '0';
  need(HASH.test(bindingSha256) && /^(0|[1-9]\d*)$/.test(requested) && Number(requested) <= 65535 &&
    (!connectionsFile || absolute(connectionsFile)) &&
    value.directory === directory && value.bindingSha256 === bindingSha256 &&
    value.selectionDirectory === (connectionsFile ? selectionRoot : null) &&
    value.connectionsFile === connectionsFile && value.requestedPort === Number(requested) &&
    (connectionsFile ? HASH.test(value.connectionsSha256 ?? '') : value.connectionsSha256 === null) &&
    Number.isSafeInteger(value.profileCount) && value.profileCount >= 0 && value.profileCount <= 64 &&
    (connectionsFile || value.profileCount === 0) &&
    plain(value.selections) && Object.keys(value.selections).length === PROVIDERS.length &&
    PROVIDERS.every(provider => value.selections[provider] === null ||
      Boolean(connectionsFile) && HASH.test(value.selections[provider] ?? '')) &&
    UUID.test(value.instanceId ?? '') && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)),
  'APPLICATION_ACCOUNTING_STARTUP_CHANGED', 'The native startup differs from this reviewed accounting command.');
  let url, connectionsUrl = null;
  try {
    url = new URL(value.url);
    if (connectionsFile) connectionsUrl = new URL(value.connectionsUrl);
  } catch { need(false, 'APPLICATION_ACCOUNTING_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && port >= 1 && port <= 65535 &&
    port === value.port && (Number(requested) === 0 || port === Number(requested)) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    (connectionsFile ? connectionsUrl.origin === url.origin && connectionsUrl.pathname === '/connections.html' &&
      !connectionsUrl.username && !connectionsUrl.password && !connectionsUrl.search && !connectionsUrl.hash :
      value.connectionsUrl === null),
  'APPLICATION_ACCOUNTING_STARTUP_CHANGED', 'Open the original private accounting listener.');
  const buyer = buyerWorkspaceBinding(value.workspaceBinding, directory);
  return { url: url.href, original: {
    schema: STARTUP, status: value.status, instanceId: value.instanceId, pid: value.pid, startedAt: value.startedAt,
    directory, selectionDirectory: connectionsFile ? selectionRoot : null, bindingSha256,
    connectionsFile, connectionsSha256: value.connectionsSha256, profileCount: value.profileCount,
    selections: { quickbooks: value.selections.quickbooks, xero: value.selections.xero },
    requestedPort: Number(requested), port, connectionsUrl: connectionsUrl?.href ?? null,
    ...(buyer ? { workspaceBinding: buyer } : {}),
  } };
}

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'accounting-connections', order: 415,
  catalog({ common }) { return [accountingApplication(common)]; },
  async prepare(type, settings, context) { return prepareAccountingApplication(settings, context); },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'merchant-accounting-workspace' &&
      Array.isArray(request.args) && request.args.includes('--managed-launch-sha256');
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.managed-accounting-startup.v1",')) return null;
      return () => accountingStartup(request, directory, text, context);
    });
  },
};
