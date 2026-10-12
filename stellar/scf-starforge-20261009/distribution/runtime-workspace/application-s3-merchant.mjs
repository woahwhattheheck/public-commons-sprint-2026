// MIT. Original S3 merchant authoring and release lifecycle in Applications.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { inspectS3WorkspaceStore } from '../../sf30-seller-sdk/s3/workspace/store.mjs';
import { absolute, plain, need, regular, digest } from './storage.mjs';

const PREFIX = 'stellar/scf-starforge-20261009/';
const STARTUP = 'stellar-forge.s3-workspace-startup.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function s3MerchantApplication(common) {
  return {
    id: 's3-merchant', command: 's3', title: 'S3 object merchant', terminal: false,
    requiredSource: PREFIX + 'distribution/runtime-workspace/application-s3-merchant.mjs',
    description: 'Author the original object source and prices, retain selected object reviews and packages, operate releases, download customer files, and reopen the same merchant after Stop.',
    fields: [
      field('workspaceDirectory', 'Private S3 merchant workspace', 'path', true,
        'Select the original workspace, or a new directory inside an existing private parent.'),
      field('releaseStore', 'Original release store', 'path', false,
        'Defaults to the workspace’s saved store, or its releases directory on first use. Existing bindings remain unchanged.'),
      field('sourceFile', 'Initial S3 source JSON', 'path', false,
        'For the first revision, select source, payment and public origin together. Later starts use the saved revision.'),
      field('paymentFile', 'Initial Stellar payment JSON', 'path', false,
        'Original single-product terms or stellar-forge.s3-payments.v1 terms for the selected products.'),
      field('origin', 'Initial public HTTPS origin', 'text'),
      field('releaseConsolePort', 'Local release console port', 'port', false,
        'Use 0 for an available port. This console and its owned seller drain with the application.'),
      ...common,
    ],
  };
}

function parse(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, 'APPLICATION_S3_IMPORT_JSON_INVALID', 'Select valid original ' + label + ' JSON.'); }
}

/** Inspect only the selected installed source; the original S3 command owns all writes. */
export async function prepareS3MerchantApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_S3_CONTEXT_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const selected = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  need(selected.dependencies.some(item => item.name === '@aws-sdk/client-s3'),
    'APPLICATION_S3_RUNTIME_REQUIRED', 'Choose a READY runtime with the original S3 dependency profile.');
  const ports = [settings.port ?? 0, settings.releaseConsolePort ?? 0];
  need(ports.every(value => Number.isInteger(value) && value >= 0 && value <= 65535),
    'APPLICATION_PORT_INVALID');
  need(!ports[0] || ports[0] !== ports[1], 'APPLICATION_S3_PORT_CONFLICT',
    'Choose different fixed ports for authoring and release operations, or use 0.');
  const inputs = [await inputPath(directory, 'directory', true, true)];
  const storeModule = join(selected.sourceRoot, PREFIX + 'sf30-seller-sdk/s3/workspace/store.mjs');
  inputs.push(await inputPath(storeModule, 'file'));
  const originalStore = await import(pathToFileURL(storeModule).href);
  need(typeof originalStore.inspectS3WorkspaceStore === 'function',
    'APPLICATION_S3_SOURCE_REQUIRED', 'Choose a runtime containing the S3 Applications workspace lifecycle.');
  const workspace = await originalStore.inspectS3WorkspaceStore(directory, { allowMissing: true });
  need(workspace.directory === directory, 'APPLICATION_S3_WORKSPACE_CHANGED');
  if (workspace.database)
    inputs.push({ ...workspace.database, workspaceId: workspace.workspaceId, releaseStore: workspace.releaseStore });
  const releaseStore = absolute(settings.releaseStore ?? workspace.releaseStore ?? join(directory, 'releases'));
  need(!workspace.releaseStore || workspace.releaseStore === releaseStore,
    'APPLICATION_S3_RELEASE_STORE_CHANGED', 'Reopen this merchant with its saved original release store.');
  need(releaseStore !== directory, 'APPLICATION_S3_RELEASE_STORE_INVALID',
    'The release store must have its own directory.');
  // The original command creates a new workspace and its default child store
  // together. Other new stores require an existing private parent.
  if (inputs[0].exists || releaseStore !== join(directory, 'releases')) {
    const releaseInput = await inputPath(releaseStore, 'directory', true, true);
    inputs.push(releaseInput);
    if (releaseInput.exists) {
      const releaseModule = join(selected.sourceRoot, PREFIX + 'sf82-seller-pilot/releases.mjs');
      inputs.push(await inputPath(releaseModule, 'file'));
      const { readReleaseState } = await import(pathToFileURL(releaseModule).href);
      await readReleaseState(releaseStore);
    }
  }
  const args = ['workspace', '--state', directory, '--release-store', releaseStore,
    '--expected-workspace-id', workspace.workspaceId ?? 'new',
    '--release-console-port', String(ports[1])];
  // Once a revision exists, its original imports can be archived or moved.
  // Reopening the application consumes the immutable saved revision instead.
  if (workspace.revision === 0) {
    const count = [settings.sourceFile, settings.paymentFile, settings.origin].filter(Boolean).length;
    need(count === 0 || count === 3, 'APPLICATION_S3_COMPLETE_IMPORT_REQUIRED',
      'For the first revision, select source, payment and public HTTPS origin together.');
    if (count) {
      const sourceInput = await inputPath(settings.sourceFile, 'file');
      const paymentInput = await inputPath(settings.paymentFile, 'file');
      const source = await regular(settings.sourceFile, 1048576);
      const payment = await regular(settings.paymentFile, 65536);
      need(sourceInput.sha256 === digest(source) && paymentInput.sha256 === digest(payment),
        'APPLICATION_S3_IMPORT_CHANGED', 'Review the current original import files before starting.');
      const modelModule = join(selected.sourceRoot, PREFIX + 'sf30-seller-sdk/s3/workspace/controller.mjs');
      inputs.push(sourceInput, paymentInput, await inputPath(modelModule, 'file'));
      const { validateS3MerchantDraft } = await import(pathToFileURL(modelModule).href);
      validateS3MerchantDraft({ source: parse(source, 'source'), payment: parse(payment, 'payment'),
        origin: settings.origin });
      args.push('--source', settings.sourceFile, '--payment', settings.paymentFile, '--origin', settings.origin,
        '--expected-source-sha256', sourceInput.sha256, '--expected-payment-sha256', paymentInput.sha256);
    }
  }
  return { args, inputs, createDirectories: [] };
}

function selectedValue(request, name, optional = false) {
  need(Array.isArray(request.args) && request.args[0] === 'workspace', 'APPLICATION_S3_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return null;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_S3_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
function localUrl(value, port, capability) {
  let url;
  try { url = new URL(value); } catch { need(false, 'APPLICATION_S3_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    (capability ? /^#[a-f0-9]{64}$/.test(url.hash) : !url.hash) &&
    Number.isInteger(port) && port >= 0 && port <= 65535 && (!port || Number(url.port || 80) === port),
    'APPLICATION_S3_STARTUP_CHANGED');
  return url;
}

/** Bind the original native announcement to its reviewed workspace and private links. */
export async function s3MerchantStartup(request, operationDirectory, text, context = {}) {
  if (request.command !== 's3' || request.args?.[0] !== 'workspace' ||
      typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'S3_MERCHANT_WORKSPACE_READY') return null;
  const directory = absolute(selectedValue(request, '--state'));
  const releaseStore = absolute(selectedValue(request, '--release-store'));
  const expected = selectedValue(request, '--expected-workspace-id');
  need(expected === 'new' || UUID.test(expected), 'APPLICATION_S3_STARTUP_CHANGED');
  const current = await inspectS3WorkspaceStore(directory);
  need(value.directory === directory && value.workspaceId === current.workspaceId &&
    (expected === 'new' || current.workspaceId === expected) &&
    value.releaseStore === releaseStore && current.releaseStore === releaseStore,
    'APPLICATION_S3_STARTUP_CHANGED', 'The original startup must match this merchant and its reviewed release store.');
  const source = selectedValue(request, '--source', true), payment = selectedValue(request, '--payment', true);
  const origin = selectedValue(request, '--origin', true);
  const sourceSha = selectedValue(request, '--expected-source-sha256', true);
  const paymentSha = selectedValue(request, '--expected-payment-sha256', true);
  need([source, payment, origin, sourceSha, paymentSha].every(Boolean) ||
    [source, payment, origin, sourceSha, paymentSha].every(item => item === null),
    'APPLICATION_S3_STARTUP_CHANGED');
  if (source) {
    need(HASH.test(sourceSha) && HASH.test(paymentSha) && plain(value.initial) &&
      value.initial.sourceFile === absolute(source) && value.initial.paymentFile === absolute(payment) &&
      value.initial.sourceSha256 === sourceSha && value.initial.paymentSha256 === paymentSha &&
      value.initial.origin === origin && current.revision >= 1, 'APPLICATION_S3_STARTUP_CHANGED');
  } else need(value.initial === null, 'APPLICATION_S3_STARTUP_CHANGED');
  const port = Number(selectedValue(request, '--port', true) ?? 0);
  const releasePort = Number(selectedValue(request, '--release-console-port'));
  const url = localUrl(value.workspace, port, true);
  need(plain(value.releaseConsole), 'APPLICATION_S3_STARTUP_CHANGED');
  const release = localUrl(value.releaseConsole.operatorUrl, releasePort, true);
  const releaseOrigin = localUrl(value.releaseConsole.url, releasePort, false);
  need(release.origin === releaseOrigin.origin && release.origin !== url.origin,
    'APPLICATION_S3_STARTUP_CHANGED');
  return { url: url.href,
    links: [{ id: 's3-releases', label: 'Open merchant releases', url: release.href }],
    original: { schema: STARTUP, directory, workspaceId: current.workspaceId, releaseStore,
      initial: value.initial, observedRevision: current.revision,
      authoringOrigin: url.origin, releaseOrigin: release.origin } };
}
