// MIT. One installed owner opens the original Tyk workspace and browser.
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRODUCT_SCHEMA, SETUP_SCHEMA, SESSION_SCHEMA, UUID, HASH, plain, canonical, sha256, need,
  absolute, exists, privateDirectory, privateBytes, publish, decode,
  leaseProduct, originalPaths, launchOptions, failure, privateUrl } from './common.mjs';

function title(value) {
  need(typeof value === 'string' && value.trim() && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value),
    'Give the product a printable name of at most 160 characters.');
  return value.trim();
}
async function connections(value) {
  need(Array.isArray(value), 'Supply an array of original Tyk connection declarations.');
  const { normalizeTykConnection } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/native.mjs');
  const result = value.map(item => normalizeTykConnection(item));
  need(new Set(result.map(item => item.id)).size === result.length, 'Use distinct native connection aliases.');
  return result;
}
const seedText = value => JSON.stringify({ schema: 'stellar-forge.tyk-product-connections.v1', connections: value }, null, 2) + '\n';
function profileFrom(setup) {
  return { schema: PRODUCT_SCHEMA, productId: setup.productId, createdAt: setup.createdAt,
    directory: setup.directory, workspaceDirectory: setup.workspaceDirectory, name: setup.name,
    connectionsSha256: sha256(seedText(setup.connections)), ...originalPaths(setup.directory) };
}

/** Partial setup reuses its same UUID, seed declarations and original workspace. */
export async function initializeTykProduct(input = {}) {
  const directory = absolute(input.directory);
  await privateDirectory(dirname(directory));
  const existed = await exists(directory);
  await privateDirectory(directory, true);
  const lease = await leaseProduct(directory);
  try {
    const saved = await privateBytes(join(directory, 'product.setup.json'), true), old = saved ? decode(saved) : null;
    if (!old && existed && (await readdir(directory)).some(name => name !== 'product.owner.lock' &&
      !/^product\.setup\.json\.pending-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name)))
      throw failure('CONFLICT', 'Select an empty private product directory or this product’s retained setup.');
    if (old) need(old.schema === SETUP_SCHEMA && old.directory === directory && UUID.test(old.productId),
      'Continue the original retained product setup.');
    const workspaceDirectory = absolute(input.workspaceDirectory ?? old?.workspaceDirectory ?? join(directory, 'workspace'));
    need(workspaceDirectory !== directory && !directory.startsWith(workspaceDirectory + '/'),
      'The original Tyk workspace needs its own directory and cannot contain the product directory.');
    need(input.connections === undefined || input.connectionsFile === undefined,
      'Select either original connection declarations or their private JSON file.');
    let source = old?.source ?? null, selected = old?.connections ?? [];
    if (input.connectionsFile !== undefined) {
      const path = absolute(input.connectionsFile), bytes = await privateBytes(path);
      const document = decode(bytes);
      need(Array.isArray(document) || plain(document) &&
        document.schema === 'stellar-forge.tyk-product-connections.v1' && Array.isArray(document.connections),
      'Select the complete original Tyk connection array or product connection document.');
      selected = Array.isArray(document) ? document : document.connections;
      source = { path, bytes: bytes.length, sha256: sha256(bytes) };
    } else if (input.connections !== undefined) { selected = input.connections; source = null; }
    selected = await connections(selected);
    const setup = { schema: SETUP_SCHEMA, productId: old?.productId ?? randomUUID(),
      createdAt: old?.createdAt ?? new Date().toISOString(), directory, workspaceDirectory,
      name: title(input.name ?? old?.name ?? 'Tyk API operations'), connections: selected, source };
    need(Buffer.byteLength(seedText(selected)) <= 1024 * 1024 &&
      Buffer.byteLength(JSON.stringify(setup, null, 2) + '\n') <= 1024 * 1024,
    'Keep the original initial connection declarations within 1 MiB; saved targets can be added in the workspace.');
    need(!old || canonical(old) === canonical(setup),
      'Continue setup with the original directory, connection declarations and name.', 'CONFLICT');
    await publish(join(directory, 'product.setup.json'), setup, { lease });
    await privateDirectory(dirname(workspaceDirectory));
    await privateDirectory(workspaceDirectory, true);
    const profile = profileFrom(setup);
    await privateDirectory(profile.receivingDirectory, true);
    await publish(profile.seedsFile, seedText(selected), { lease });
    await publish(join(directory, 'product.json'), profile, { lease });
    return { state: 'INITIALIZED', profile, connections: selected.map(item => ({ id: item.id, label: item.label, kind: item.kind })),
      owner: 'ORIGINAL_TYK_WORKSPACE' };
  } finally { await lease.close(); }
}

export async function readTykProduct(directory) {
  directory = await privateDirectory(directory);
  const profile = decode(await privateBytes(join(directory, 'product.json')));
  const setup = decode(await privateBytes(join(directory, 'product.setup.json')));
  need(plain(profile) && plain(setup) && setup.schema === SETUP_SCHEMA && profile.schema === PRODUCT_SCHEMA &&
    setup.directory === directory && UUID.test(setup.productId ?? '') &&
    typeof setup.workspaceDirectory === 'string' && setup.workspaceDirectory === absolute(setup.workspaceDirectory) &&
    canonical(profile) === canonical(profileFrom(setup)),
  'Select this initialized original Tyk product.');
  await privateDirectory(profile.workspaceDirectory);
  await privateDirectory(profile.receivingDirectory);
  const bytes = await privateBytes(profile.seedsFile), selected = decode(bytes);
  need(sha256(bytes) === profile.connectionsSha256 && selected.schema === 'stellar-forge.tyk-product-connections.v1' &&
    canonical(selected.connections) === canonical(setup.connections),
  'The product retains the original connection seed bytes.', 'BINDING_CHANGED');
  return { profile, connections: selected.connections };
}

export async function inspectTykProduct(directory) {
  const { profile, connections } = await readTykProduct(directory);
  const { inspectTykWorkspaceDirectory } = await import('./managed.mjs');
  const workspace = await inspectTykWorkspaceDirectory(profile.workspaceDirectory);
  const saved = await privateBytes(profile.connectionFile, true, 65536), session = saved ? decode(saved) : null;
  if (session) need(session.schema === SESSION_SCHEMA && session.productId === profile.productId &&
    session.directory === profile.directory, 'Read the original product session.', 'CONNECTION_INVALID');
  return { schema: 'stellar-forge.tyk-product-inspection.v1', profile, workspace,
    initialConnections: connections.map(item => ({ id: item.id, label: item.label, kind: item.kind })),
    session: session ? { state: session.state, instanceId: session.instanceId, workspaceId: session.workspaceId,
      startedAt: session.startedAt, endedAt: session.endedAt,
      note: 'Retained owner record; status calls the current original workspace.' } : null };
}

/** Connection seeds initialize missing aliases; saved native revisions remain authoritative. */
export async function openTykProduct(input = {}, { environment = process.env, fetch = globalThis.fetch, signal } = {}) {
  const { inspectTykProductLaunch, tykProductSource } = await import('./managed.mjs');
  const options = launchOptions(input), first = await inspectTykProductLaunch(options, { environment });
  const lease = await leaseProduct(first.directory);
  let native, started, closing;
  const initial = { schema: SESSION_SCHEMA, state: 'STARTING', productId: first.profile.productId,
    directory: first.directory, workspaceDirectory: first.profile.workspaceDirectory,
    instanceId: randomUUID(), startedAt: new Date().toISOString(), bindingSha256: first.bindingSha256,
    resourceId: first.resourceId, sourceSha256: first.source.sha256,
    connectionFile: first.profile.connectionFile, browserUrlFile: first.profile.browserUrlFile,
    port: options.port, browserUrl: null, workspaceId: null };
  const save = value => publish(first.profile.connectionFile, value, { replace: true, lease });
  async function finish(finalState = 'CLOSED', sourceError) {
    const errors = [];
    try { await save({ ...initial, ...started, state: 'CLOSING' }); } catch (error) { errors.push(error); }
    let nativeClosed = !native;
    try { await native?.close(); nativeClosed = true; } catch (error) { errors.push(error); }
    try {
      await save({ ...initial, ...started, state: nativeClosed ? finalState : 'STOP_UNCONFIRMED',
        endedAt: new Date().toISOString(), ...(sourceError || errors.length ? {
          errors: [sourceError, ...errors].filter(Boolean).map(error => String(error.code ?? 'TYK_PRODUCT_CLOSE_FAILED')),
        } : {}) });
    } catch (error) { errors.push(error); }
    if (nativeClosed) await lease.close();
    if (errors.length) throw Object.assign(new AggregateError(errors, 'Continue the original product close.'), {
      code: 'TYK_PRODUCT_CLOSE_INCOMPLETE',
    });
  }
  try {
    const selected = await inspectTykProductLaunch(options, { environment });
    need(selected.bindingSha256 === first.bindingSha256 &&
      (input.expectedBindingSha256 === undefined || input.expectedBindingSha256 === selected.bindingSha256),
    'The selected source, native workspace or configuration changed. Review the same product again.', 'BINDING_CHANGED');
    await save(initial);
    const { startTykWorkspaceServer } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/server.mjs');
    const declared = await readTykProduct(first.directory);
    native = await startTykWorkspaceServer({ directory: first.profile.workspaceDirectory,
      connections: declared.connections, environment, fetch, signal, hostname: '127.0.0.1', port: options.port });
    const url = privateUrl(native.url);
    need(native.directory === first.profile.workspaceDirectory && UUID.test(native.workspaceId ?? '') &&
      native.origin === url.origin && Number(url.port || 80) === native.port &&
      (options.port === 0 || native.port === options.port) &&
      (selected.workspace.workspaceId === null || native.workspaceId === selected.workspace.workspaceId),
    'The original Tyk owner must return its selected workspace and local listener.', 'NATIVE_STARTUP');
    const confirmed = await readTykProduct(first.directory);
    need(canonical(confirmed.profile) === canonical(first.profile) &&
      (await tykProductSource()).sha256 === first.source.sha256,
    'The original product or native source changed during startup.', 'BINDING_CHANGED');
    for (const file of selected.files) need(sha256(await privateBytes(file.path, false, file.maximum)) === file.sha256,
      'A selected product file changed during startup.', 'BINDING_CHANGED');
    const { inspectTykWorkspaceDirectory } = await import('./managed.mjs');
    const retainedWorkspace = await inspectTykWorkspaceDirectory(first.profile.workspaceDirectory);
    need(retainedWorkspace.workspaceId === native.workspaceId, 'The started native workspace identity changed.', 'NATIVE_STARTUP');
    await publish(first.profile.browserUrlFile, native.url + '\n', { replace: true, lease });
    started = { state: 'OPEN', browserUrl: native.url, workspaceId: native.workspaceId };
    await save({ ...initial, ...started });
    return { ...initial, ...started, workspace: native.workspace, native,
      close() { return closing ??= finish().catch(error => { closing = null; throw error; }); } };
  } catch (error) {
    try { await finish('FAILED', error); }
    catch (closeError) { throw new AggregateError([error, closeError], 'Original Tyk startup and close require continuation.'); }
    throw error;
  }
}
