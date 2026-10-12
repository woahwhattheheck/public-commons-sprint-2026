// MIT. Original gRPC authoring workspace in the maintained Applications lifecycle.
import { join, dirname, basename } from 'node:path';
import { lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, privateDirectory, plain, need, recordId, operationId, readJSON, regular }
  from './storage.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/';
const SELECTION = 'stellar-forge.grpc-workspace-selection.v1';
const LAUNCH = 'stellar-forge.grpc-workspace-launch.v1';
const MAX_STARTUP = 16384;
const SOURCE_FILES = [
  'workspace/binding.mjs', 'workspace/managed-launch.mjs',
  'workspace/model.mjs', 'workspace/server.mjs',
];
const bindingKeys = ['directory', 'installationId', 'profileId', 'profileSha256',
  'lockSha256', 'sourceCommit', 'sourceManifestSha256'];
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function grpcApplication(common) {
  return {
    id: 'grpc-workspace', command: 'grpc-workspace', title: 'gRPC merchant authoring',
    terminal: false, requiredSource: ROOT + 'workspace/managed-launch.mjs',
    description: 'Reopen the original gRPC source, captured protobuf contract, reviewed methods and message sequences, merchant editions and retained release controls.',
    fields: [
      field('workspaceDirectory', 'Private gRPC workspace', 'path', true,
        'Use the original private directory, or create one directory in an existing private parent. Saved source and release history remain here.'),
      field('sellerPort', 'Seller preview port', 'port', false,
        'Use 0 for an available local port. The original workspace starts its preview when you explicitly request it.'),
      field('operationsPort', 'Seller operations port', 'port', false,
        'Use 0 for an available local port. This belongs to the original seller preview.'),
      field('facilitator', 'Payment facilitator URL', 'text', false,
        'Optional HTTPS endpoint for the original native paid preview. Omit it to use the workspace without this payment configuration.'),
      field('allowLocalFacilitator', 'Allow the selected local facilitator', 'boolean', false,
        'Permit an explicitly selected http://127.0.0.1 facilitator for local development. A facilitator URL is required.'),
      ...common,
    ],
  };
}

async function selectedModules(runtimeDirectory, expected = null) {
  const selected = await inspectMerchantRuntime(absolute(runtimeDirectory), {
    ...(expected ? { expectedManifest: expected.sourceManifestSha256 } : {}), load: false,
  });
  if (expected) need(bindingKeys.every(key => selected[key] === expected[key]),
    'APPLICATION_GRPC_RUNTIME_CHANGED', 'Select the original reviewed runtime before reopening this application.');
  const root = join(selected.sourceRoot, ROOT);
  const [binding, managed, common] = await Promise.all([
    import(pathToFileURL(join(root, 'workspace/binding.mjs')).href),
    import(pathToFileURL(join(root, 'workspace/managed-launch.mjs')).href),
    import(pathToFileURL(join(root, 'common.mjs')).href),
  ]);
  need(typeof binding.inspectGrpcWorkspaceBinding === 'function' &&
    typeof managed.readGrpcLaunchSource === 'function' &&
    typeof managed.validateGrpcManagedSelection === 'function' &&
    typeof managed.parseGrpcManagedSelection === 'function' &&
    managed.GRPC_MANAGED_SELECTION === SELECTION && managed.GRPC_MANAGED_LAUNCH === LAUNCH &&
    isDeepStrictEqual(managed.GRPC_LAUNCH_FILES, SOURCE_FILES) &&
    typeof common.canonical === 'function' && typeof common.sha256 === 'function',
  'APPLICATION_GRPC_MANAGED_SOURCE_REQUIRED',
  'Choose an installed runtime containing the original gRPC managed workspace binding and launch record.');
  return { root, binding, managed, common };
}

function selectedPort(value) {
  value ??= 0;
  need(Number.isInteger(value) && value >= 0 && value <= 65535,
    'APPLICATION_GRPC_PORT_INVALID', 'Use an integer port from 0 through 65535.');
  return String(value);
}

function facilitatorArguments(settings) {
  const supplied = settings.facilitator;
  need(settings.allowLocalFacilitator === undefined || typeof settings.allowLocalFacilitator === 'boolean',
    'APPLICATION_GRPC_FACILITATOR_INVALID');
  if (!supplied) {
    need(!settings.allowLocalFacilitator, 'APPLICATION_GRPC_FACILITATOR_REQUIRED',
      'Enter the local facilitator URL before enabling its local-development option.');
    return [];
  }
  need(typeof supplied === 'string' && supplied.length <= 4096 && supplied.trim() === supplied &&
    !/[\x00-\x1f\x7f]/.test(supplied), 'APPLICATION_GRPC_FACILITATOR_INVALID');
  let endpoint;
  try { endpoint = new URL(supplied); } catch { need(false, 'APPLICATION_GRPC_FACILITATOR_INVALID'); }
  const local = settings.allowLocalFacilitator === true &&
    endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
  need((local || endpoint.protocol === 'https:') && !endpoint.username &&
    !endpoint.password && !endpoint.search && !endpoint.hash,
  'APPLICATION_GRPC_FACILITATOR_INVALID',
  'Use HTTPS, or explicitly allow a selected http://127.0.0.1 endpoint without credentials, query or fragment.');
  return ['--facilitator', supplied, ...(settings.allowLocalFacilitator ? ['--allow-local-facilitator'] : [])];
}

export async function prepareGrpcApplication(settings, inputPath, runtimeDirectory) {
  const directory = absolute(settings.workspaceDirectory);
  const workspace = await inputPath(directory, 'directory', true, true);
  const original = await selectedModules(runtimeDirectory);
  const source = await original.managed.readGrpcLaunchSource(original.root);
  const inputs = [workspace];
  for (const name of SOURCE_FILES) {
    const input = await inputPath(join(original.root, name), 'file');
    need(input.exists && input.bytes === source.files[name].bytes &&
      input.sha256 === source.files[name].sha256, 'APPLICATION_GRPC_SOURCE_CHANGED',
    'The original gRPC launch files changed during review. Review the selected runtime again.');
    inputs.push(input);
  }
  const args = ['--state', directory];
  if (workspace.exists) {
    const binding = await original.binding.inspectGrpcWorkspaceBinding(directory);
    const selection = original.managed.validateGrpcManagedSelection({
      schema: SELECTION, workspace: binding, sourceFiles: source.files, sourceSha256: source.sha256,
    });
    args.push('--managed-selection', JSON.stringify(selection));
  }
  // Save creates a missing reviewed private directory. Its subsequent Start
  // review binds the directory inode and current.json before any execution.
  args.push('--seller-port', selectedPort(settings.sellerPort),
    '--operations-port', selectedPort(settings.operationsPort),
    ...facilitatorArguments(settings));
  // The original Applications caller owns its common --port and private environment.
  return { args, inputs, createDirectories: workspace.exists ? [] : [directory] };
}

function selectedValue(request, name) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_GRPC_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

async function reviewedModules(request, operationDirectory) {
  const directory = absolute(operationDirectory), root = dirname(dirname(directory));
  need(basename(dirname(directory)) === 'operations', 'APPLICATION_GRPC_START_REVIEW_CHANGED');
  const applicationId = recordId(request.applicationId), id = operationId(basename(directory));
  const run = await readJSON(join(root, 'applications', applicationId, 'runs', id + '.json'));
  need(run.schema === 'stellar-forge.application-run.v1' && run.applicationId === applicationId &&
    run.id === id && run.request.requestId === id &&
    (request.requestId === undefined || request.requestId === id) && run.request.command === request.command &&
    run.request.applicationId === applicationId && isDeepStrictEqual(run.request.args, request.args),
  'APPLICATION_GRPC_START_REVIEW_CHANGED');
  const review = await readJSON(join(root, 'application-reviews', recordId(run.reviewId) + '.json'));
  need(review.schema === 'stellar-forge.application-start-review.v1' &&
    review.applicationId === applicationId && review.command?.command === request.command &&
    isDeepStrictEqual(review.command.args, request.args) && Array.isArray(review.command.inputs) &&
    review.homeId === request.homeId && review.releaseId === request.releaseId &&
    plain(review.runtime), 'APPLICATION_GRPC_START_REVIEW_CHANGED');
  const original = await selectedModules(review.runtime.directory, review.runtime);
  for (const name of SOURCE_FILES) {
    const path = join(original.root, name);
    const inputs = review.command.inputs.filter(input => input.kind === 'file' && input.path === path);
    need(inputs.length === 1 && /^[a-f0-9]{64}$/.test(inputs[0].sha256 ?? '') &&
      original.common.sha256(await regular(path, 262144)) === inputs[0].sha256,
    'APPLICATION_GRPC_SOURCE_CHANGED');
  }
  return original;
}

async function sameDirectory(binding) {
  await privateDirectory(binding.directory);
  const info = await lstat(binding.directory, { bigint: true });
  need(info.isDirectory() && !info.isSymbolicLink() &&
    info.dev.toString() === binding.identity.device && info.ino.toString() === binding.identity.inode,
  'APPLICATION_GRPC_WORKSPACE_CHANGED', 'The selected original workspace directory has been replaced.');
}

async function launchFile(path) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(path, MAX_STARTUP)));
}

async function liveLaunch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const response = await fetch(new URL('/api/launch', url.origin), {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { 'x-workspace-token': url.hash.slice(1), accept: 'application/json' },
    });
    need(response.status === 200 && response.body, 'APPLICATION_GRPC_INSTANCE_NOT_READY',
      'The original gRPC instance is no longer listening. Inspect its retained operation before reopening.');
    const advertised = response.headers.get('content-length');
    need(advertised === null || /^\d+$/.test(advertised) && Number(advertised) <= MAX_STARTUP,
      'APPLICATION_GRPC_STARTUP_TOO_LARGE');
    reader = response.body.getReader();
    const chunks = []; let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      need(total <= MAX_STARTUP, 'APPLICATION_GRPC_STARTUP_TOO_LARGE');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)));
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}

/** Admit only the exact original instance, after native ownership and live readiness. */
export async function grpcStartup(request, text, operationDirectory) {
  if (request.command !== 'grpc-workspace' || !Array.isArray(request.args) ||
      typeof text !== 'string' || Buffer.byteLength(text) > MAX_STARTUP || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== LAUNCH || value.state !== 'LISTENING') return null;
  const original = await reviewedModules(request, operationDirectory);
  const selection = original.managed.parseGrpcManagedSelection(selectedValue(request, '--managed-selection'));
  const directory = absolute(selectedValue(request, '--state')), port = selectedValue(request, '--port');
  const source = await original.managed.readGrpcLaunchSource(original.root);
  need(/^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535 &&
    selection.workspace.directory === directory && value.directory === directory &&
    value.selectionSha256 === original.common.sha256(original.common.canonical(selection)) &&
    value.sourceSha256 === selection.sourceSha256 && source.sha256 === selection.sourceSha256 &&
    isDeepStrictEqual(value.sourceFiles, selection.sourceFiles) &&
    isDeepStrictEqual(source.files, selection.sourceFiles) &&
    isDeepStrictEqual(value.selectedCurrent, selection.workspace.current) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.instanceId ?? '') &&
    Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)),
  'APPLICATION_GRPC_STARTUP_CHANGED', 'The original startup must match the reviewed workspace, source and instance.');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_GRPC_STARTUP_CHANGED'); }
  const actualPort = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[a-f0-9]{64}$/.test(url.hash.slice(1)) && value.url === url.href &&
    value.origin === url.origin && actualPort >= 1 && actualPort <= 65535 &&
    (port === '0' || actualPort === Number(port)), 'APPLICATION_GRPC_STARTUP_CHANGED');
  await sameDirectory(selection.workspace);
  const folder = await privateDirectory(join(directory, 'managed-launches'));
  const record = join(folder, value.instanceId + '.json');
  need(isDeepStrictEqual(await launchFile(record), value), 'APPLICATION_GRPC_INSTANCE_CHANGED');
  need(isDeepStrictEqual(await liveLaunch(url), value), 'APPLICATION_GRPC_INSTANCE_CHANGED');
  // A close or directory replacement during the live check cannot restore an
  // old advertised link. Later Stop remains the original Applications control.
  await sameDirectory(selection.workspace);
  need(isDeepStrictEqual(await launchFile(record), value), 'APPLICATION_GRPC_INSTANCE_CHANGED');
  return { url: url.href, original: {
    schema: LAUNCH, directory, workspaceIdentity: selection.workspace.identity,
    selectedCurrent: value.selectedCurrent, selectionSha256: value.selectionSha256,
    sourceSha256: value.sourceSha256, sourceFiles: value.sourceFiles,
    instanceId: value.instanceId, pid: value.pid, createdAt: value.createdAt, launchRecord: record,
  } };
}
