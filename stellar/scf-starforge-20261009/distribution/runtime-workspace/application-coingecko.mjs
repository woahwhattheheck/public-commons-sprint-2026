// MIT. CoinGecko's original research/browser workspace in installed Applications.
import { join, dirname, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need, recordId, operationId, readJSON, privateDirectory } from './storage.mjs';

const ROOT = 'stellar/scf-starforge-20261009/partners/coingecko-stellar-market';
const SELECTION = 'stellar-forge.coingecko-managed-selection.v1';
const LAUNCH = 'stellar-forge.coingecko-managed-launch.v1';
const BINDING_KEYS = ['directory', 'installationId', 'profileId', 'profileSha256',
  'lockSha256', 'sourceCommit', 'sourceManifestSha256'];
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function coingeckoApplication(common) {
  return {
    id: 'coingecko', command: 'coingecko', title: 'CoinGecko market research',
    terminal: false, requiredSource: ROOT + '/workspace/managed.mjs',
    description: 'Reopen original source captures, request collections, research comparisons, provider plans and complete project handovers in the same CoinGecko workspace.',
    fields: [
      field('workspaceDirectory', 'Private CoinGecko workspace', 'path', true,
        'Choose the original saved workspace, or create one directory in an existing private parent. Its projects and original buyer operations remain here.'),
      field('projectId', 'Project to open', 'text', false,
        'Optional existing project ID. The same project is selected when the browser opens.'),
      field('configurationFile', 'Private buyer profile configuration', 'path', false,
        'Optional original JSON with buyerProfiles. Existing buyer configuration and operator directory references stay on this host.'),
      field('allowLocalMerchant', 'Allow the selected local merchant', 'boolean', false,
        'Use only for an explicitly selected local development merchant. Original native approval and payment controls remain in the workspace.'),
      ...common,
    ],
  };
}

async function modules(runtimeDirectory, expected = null) {
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), {
    ...(expected ? { expectedManifest: expected.sourceManifestSha256 } : {}), load: false,
  });
  if (expected) need(BINDING_KEYS.every(key => runtime[key] === expected[key]),
    'APPLICATION_COINGECKO_RUNTIME_CHANGED');
  const root = resolve(runtime.sourceRoot, ROOT);
  const native = await import(pathToFileURL(join(root, 'workspace/managed.mjs')).href);
  need(native.MARKET_SELECTION_SCHEMA === SELECTION && native.MARKET_LAUNCH_SCHEMA === LAUNCH &&
    typeof native.inspectMarketBinding === 'function' &&
    typeof native.readMarketManagedSource === 'function' &&
    typeof native.readMarketManagedConfiguration === 'function' &&
    typeof native.parseMarketSelection === 'function' &&
    typeof native.readMarketLaunch === 'function' &&
    typeof native.marketSelectionDigest === 'function',
  'APPLICATION_COINGECKO_SOURCE_REQUIRED',
    'Choose an installed runtime containing the complete CoinGecko managed application.');
  return { root, native };
}

export async function prepareCoingeckoApplication(settings, { inputPath, runtimeDirectory } = {}) {
  const directory = absolute(settings.workspaceDirectory);
  const selected = await inputPath(directory, 'directory', true, true);
  const original = await modules(runtimeDirectory);
  const source = await original.native.readMarketManagedSource(original.root);
  const inputs = [selected];
  for (const [name, expected] of Object.entries(source.files)) {
    const file = await inputPath(join(original.root, name), 'file');
    need(file.sha256 === expected.sha256 && file.bytes === expected.bytes,
      'APPLICATION_COINGECKO_SOURCE_CHANGED');
    inputs.push(file);
  }
  const configured = await original.native.readMarketManagedConfiguration(settings.configurationFile ?? null);
  const seen = new Set(inputs.map(input => input.path));
  for (const originalInput of configured.inputs) {
    if (seen.has(originalInput.path)) continue;
    const file = await inputPath(originalInput.path, originalInput.kind, false, true);
    if (originalInput.sha256) need(file.sha256 === originalInput.sha256,
      'APPLICATION_COINGECKO_CONFIGURATION_CHANGED');
    inputs.push(file); seen.add(file.path);
  }
  const workspace = await original.native.inspectMarketBinding(directory, {
    allowMissing: true, projectId: settings.projectId ?? null,
  });
  const selection = original.native.parseMarketSelection({
    schema: SELECTION, workspace, configuration: configured.configuration, source,
    allowLocalMerchant: settings.allowLocalMerchant === true,
  });
  const args = ['serve', '--state', directory, '--startup-format', 'json',
    '--managed-selection', JSON.stringify(selection)];
  if (settings.projectId) args.push('--project', settings.projectId);
  if (settings.configurationFile) args.push('--config', settings.configurationFile);
  if (settings.allowLocalMerchant) args.push('--allow-local-merchant');
  return { args, inputs, createDirectories: selected.exists ? [] : [directory] };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_COINGECKO_STARTUP_CHANGED');
  const indices = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && indices.length === 0) return null;
  need(indices.length === 1 && typeof request.args[indices[0] + 1] === 'string' &&
    !request.args[indices[0] + 1].startsWith('--'), 'APPLICATION_COINGECKO_STARTUP_CHANGED');
  return request.args[indices[0] + 1];
}
async function reviewed(request, operationDirectory) {
  const directory = absolute(operationDirectory), root = dirname(dirname(directory));
  need(basename(dirname(directory)) === 'operations', 'APPLICATION_COINGECKO_REVIEW_CHANGED');
  const appId = recordId(request.applicationId), id = operationId(basename(directory));
  const run = await readJSON(join(root, 'applications', appId, 'runs', id + '.json'));
  need(run.schema === 'stellar-forge.application-run.v1' && run.applicationId === appId &&
    run.id === id && run.request.requestId === id &&
    (request.requestId === undefined || request.requestId === id) && run.request.command === request.command &&
    run.request.applicationId === appId && isDeepStrictEqual(run.request.args, request.args),
  'APPLICATION_COINGECKO_REVIEW_CHANGED');
  const review = await readJSON(join(root, 'application-reviews', recordId(run.reviewId) + '.json'));
  need(review.schema === 'stellar-forge.application-start-review.v1' &&
    review.applicationId === appId && review.command?.command === request.command &&
    isDeepStrictEqual(review.command.args, request.args) && Array.isArray(review.command.inputs) &&
    review.homeId === request.homeId && review.releaseId === request.releaseId && plain(review.runtime),
  'APPLICATION_COINGECKO_REVIEW_CHANGED');
  const original = await modules(review.runtime.directory, review.runtime);
  const source = await original.native.readMarketManagedSource(original.root);
  for (const [name, expected] of Object.entries(source.files)) {
    const path = join(original.root, name);
    const selected = review.command.inputs.filter(input => input.kind === 'file' && input.path === path);
    need(selected.length === 1 && selected[0].sha256 === expected.sha256 &&
      selected[0].bytes === expected.bytes, 'APPLICATION_COINGECKO_SOURCE_CHANGED');
  }
  const releaseDirectory = absolute(request.releaseDirectory);
  need(releaseDirectory === join(absolute(request.homeDirectory), 'releases', request.releaseId),
    'APPLICATION_COINGECKO_RELEASE_CHANGED');
  const executedRoot = resolve(releaseDirectory, 'source', ROOT);
  need(isDeepStrictEqual(await original.native.readMarketManagedSource(executedRoot), source),
    'APPLICATION_COINGECKO_SOURCE_CHANGED');
  return { ...original, source, executedRoot };
}
async function readLiveLaunch(url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const response = await fetch(new URL('/api/managed-launch', url.origin), {
      redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    need(response.status === 200 && response.body, 'APPLICATION_COINGECKO_NOT_READY');
    const length = response.headers.get('content-length');
    need(length === null || /^\d+$/.test(length) && Number(length) <= 65536,
      'APPLICATION_COINGECKO_STARTUP_TOO_LARGE');
    reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      need(bytes <= 65536, 'APPLICATION_COINGECKO_STARTUP_TOO_LARGE');
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}

export async function coingeckoStartup(request, text, operationDirectory) {
  if (request.command !== 'coingecko' || request.args?.[0] !== 'serve' ||
    typeof text !== 'string' || Buffer.byteLength(text) > 65536 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== LAUNCH || value.status !== 'COINGECKO_READY') return null;
  const original = await reviewed(request, operationDirectory);
  const selection = original.native.parseMarketSelection(option(request, '--managed-selection'));
  const directory = absolute(option(request, '--state'));
  const projectId = option(request, '--project', true);
  const configurationFile = option(request, '--config', true);
  const port = Number(option(request, '--port', true) ?? 0);
  need(option(request, '--startup-format') === 'json' && selection.workspace.directory === directory &&
    selection.configuration.path === configurationFile &&
    (selection.workspace.project?.id ?? null) === projectId &&
    value.directory === directory && value.sourceDirectory === original.executedRoot &&
    value.selectionSha256 === original.native.marketSelectionDigest(selection) &&
    isDeepStrictEqual(value.source, selection.source) && isDeepStrictEqual(value.source, original.source) &&
    isDeepStrictEqual(value.configuration, selection.configuration) &&
    value.allowLocalMerchant === selection.allowLocalMerchant &&
    value.allowLocalMerchant === request.args.includes('--allow-local-merchant') &&
    UUID.test(value.instanceId ?? '') && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    Number.isInteger(port) && port >= 0 && port <= 65535,
  'APPLICATION_COINGECKO_STARTUP_CHANGED');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_COINGECKO_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.hash && url.pathname === '/' &&
    value.url === url.href && value.origin === url.origin &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    (port === 0 || Number(url.port || 80) === port) &&
    isDeepStrictEqual([...url.searchParams], projectId ? [['project', projectId]] : []),
  'APPLICATION_COINGECKO_STARTUP_CHANGED');
  const sameOriginal = async () => {
    const current = await original.native.inspectMarketBinding(directory);
    need(isDeepStrictEqual(current.identity, selection.workspace.identity) &&
      isDeepStrictEqual(current.identity, value.workspace?.identity) &&
      isDeepStrictEqual(current.database, value.workspace?.database) &&
      (selection.workspace.database === null ||
        isDeepStrictEqual(current.database, selection.workspace.database)),
    'APPLICATION_COINGECKO_WORKSPACE_CHANGED');
  };
  await sameOriginal();
  const configuration = await original.native.readMarketManagedConfiguration(configurationFile);
  need(isDeepStrictEqual(configuration.configuration, selection.configuration),
    'APPLICATION_COINGECKO_CONFIGURATION_CHANGED');
  const launchDirectory = await privateDirectory(join(directory, 'managed-launches'));
  const launchRecord = join(launchDirectory, value.instanceId + '.json');
  need(isDeepStrictEqual(await original.native.readMarketLaunch(launchRecord), value),
    'APPLICATION_COINGECKO_INSTANCE_CHANGED');
  need(isDeepStrictEqual(await readLiveLaunch(url), value), 'APPLICATION_COINGECKO_INSTANCE_CHANGED');
  await sameOriginal();
  need(isDeepStrictEqual(await original.native.readMarketLaunch(launchRecord), value),
    'APPLICATION_COINGECKO_INSTANCE_CHANGED');
  return { url: url.href, original: {
    schema: LAUNCH, directory, workspace: value.workspace, projectId, sourceDirectory: original.executedRoot,
    instanceId: value.instanceId, pid: value.pid, createdAt: value.createdAt,
    sourceSha256: value.source.sha256, selectionSha256: value.selectionSha256,
    configurationFile, configurationSha256: value.configuration.sha256, launchRecord,
  } };
}
