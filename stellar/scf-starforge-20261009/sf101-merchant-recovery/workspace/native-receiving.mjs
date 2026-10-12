#!/usr/bin/env node
// MIT. Receive an existing native recovery workspace through its merchant MCP.
import { link, lstat, mkdir, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireDeliveryLease } from '../../sf98-merchant-delivery/delivery-lock.mjs';
import { serveRecoveryWorkspace } from './server.mjs';
import { readRecoveryWorkspaceIdentity } from './model.mjs';
import { readRecoveryWorkspaceLaunch } from './connection.mjs';
import { RECOVERY_WORKSPACE_CONNECTION_SCHEMA } from './merchant-client.mjs';
import { recoveryWorkspaceTools } from './merchant-catalog.mjs';
import { exact, failure, fileBytes, writePrivate } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';

export const HELP = 'Native recovery merchant receiving\n\n' +
  'starforge merchant-recovery-mcp-receive --input ABS_PRIVATE_RECEIVING_JSON\n\n' +
  'Select an existing recovery workspace, its original encrypted bundle, exact\n' +
  'snapshot and completed transfer journals. This command uses the registered\n' +
  'merchant MCP, original verifier, actual remote inventory and native reopen.\n' +
  'Continue the same input and retained operation ID after an interruption.\n' +
  'See workspace/MCP.md for the complete private input and operating flow.\n';

const SCHEMA = 'stellar-forge.recovery-merchant-receiving.v1';
const RESULT_SCHEMA = 'stellar-forge.recovery-merchant-receiving-result.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,70}$/;
const SHA = /^[a-f0-9]{64}$/;
const stamp = () => new Date().toISOString();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function requireValue(ok, code, message) { if (!ok) throw failure(code, message); }
async function present(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function ownedDirectory(path, create = false) {
  requireValue(typeof path === 'string' && isAbsolute(path) && path !== '/' && resolve(path) === path,
    'RECEIVING_PATH_REQUIRED', 'Use normalized absolute private receiving paths.');
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || !(info.mode & 0o077) && (typeof process.getuid !== 'function' || info.uid === process.getuid())),
    'RECEIVING_PRIVATE_DIRECTORY_REQUIRED', 'Use the owned private receiving directory.');
}
async function json(path) {
  const info = await lstat(path);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 32 * 1024 * 1024 &&
    (process.platform === 'win32' || !(info.mode & 0o077) && (typeof process.getuid !== 'function' || info.uid === process.getuid())),
    'RECEIVING_PRIVATE_FILE_REQUIRED', 'Use a complete private receiving file.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, 32 * 1024 * 1024)));
}
async function publishJSON(path, value) {
  const temporary = path + '.writing-' + randomBytes(8).toString('hex');
  try { await writePrivate(temporary, value); await link(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function retain(path, value) {
  if (await present(path)) {
    requireValue(same(await json(path), value), 'RECEIVING_SELECTION_CHANGED', 'Continue the same original receiving selection.');
    return;
  }
  await publishJSON(path, value);
}
function selection(input) {
  exact(input, ['schema','directory','workspaceDirectory','hostConfig','profileId','bundleId','snapshotId',
    'operationId','completedOperations','workspace'], ['schema','directory','workspaceDirectory','hostConfig',
    'profileId','bundleId','snapshotId','operationId','completedOperations']);
  requireValue(input.schema === SCHEMA && ID.test(input.operationId ?? '') &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(input.profileId ?? '') && SHA.test(input.snapshotId ?? '') &&
    typeof input.bundleId === 'string' && input.bundleId.includes('/') &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.workspace ?? 'recovery'),
    'RECEIVING_SELECTION_INVALID', 'Select the original profile, bundle, snapshot and receiving operation ID.');
  requireValue(Array.isArray(input.completedOperations) && input.completedOperations.length > 0 &&
    input.completedOperations.length <= 100, 'RECEIVING_ORIGINAL_OPERATIONS_REQUIRED', 'Select the exact completed original transfer journals.');
  const seen = new Set();
  for (const item of input.completedOperations) {
    exact(item, ['id','command'], ['id','command']);
    requireValue(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(item.id ?? '') &&
      ['push','pull','restore'].includes(item.command) && !seen.has(item.id),
      'RECEIVING_ORIGINAL_OPERATIONS_REQUIRED', 'Select each original completed transfer once.');
    seen.add(item.id);
  }
  return { ...input, workspace: input.workspace ?? 'recovery' };
}
function errorView(error) {
  return { code: error.code ?? 'RECOVERY_RECEIVING_FAILED', message: String(error.message).slice(0,8000),
    ...(error.details ? { details: error.details } : {}), ...(error.receiving ? { receiving: error.receiving } : {}) };
}

/**
 * Real host operation: existing bundle, original transfers, registered provider,
 * local authenticated listeners, and the original recovery verifier.
 * Repeating the same selection first reads its retained native request.
 */
export async function receiveRecoveryWorkspaceMerchant(input, { onProgress = () => {} } = {}) {
  input = selection(input);
  await ownedDirectory(input.directory, true);
  await ownedDirectory(input.workspaceDirectory);
  requireValue(input.directory !== input.workspaceDirectory &&
    !input.directory.startsWith(input.workspaceDirectory + '/') && !input.workspaceDirectory.startsWith(input.directory + '/'),
    'RECEIVING_PATH_OVERLAP', 'Keep receiving output beside the original workspace.');
  const lease = await acquireDeliveryLease(input.directory, { purpose: 'drain' });
  const resultFile = join(input.directory, 'result.json'), selectedFile = join(input.directory, 'selection.json');
  const result = { schema: RESULT_SCHEMA, operationId: input.operationId, status: 'RUNNING',
    startedAt: stamp(), snapshotId: input.snapshotId, phases: [] };
  let native, merchant, token, rpcId = 0, primaryError, completedReadback = false, retainedAttempt;
  async function phase(name, value) {
    result.phases.push({ name, completedAt: stamp(), value });
    await onProgress({ operationId: input.operationId, phase: name });
    return value;
  }
  async function rpc(method, params) {
    const id = ++rpcId;
    const response = await fetch(merchant.url, { method: 'POST', redirect: 'error',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(150000) });
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.byteLength;
      requireValue(bytes <= 32 * 1024 * 1024, 'RECEIVING_REPLY_LIMIT', 'Read the retained smaller native page.');
      chunks.push(Buffer.from(chunk));
    }
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
    requireValue(response.ok && envelope.id === id && !envelope.error && envelope.result,
      'RECEIVING_MCP_PROTOCOL', 'The original merchant MCP did not return this complete request.');
    if (envelope.result.isError) {
      const value = envelope.result.structuredContent ?? {};
      const error = failure(value.code ?? 'RECEIVING_MCP_ERROR', value.reason ?? 'Original merchant operation failed.');
      try { error.details = JSON.parse(value.reason); } catch { /* original plain error remains intact */ }
      throw error;
    }
    return envelope.result;
  }
  async function call(action, args = {}) {
    return (await rpc('tools/call', { name: 'merchant_recovery_' + action,
      arguments: { workspace: input.workspace, ...args } })).structuredContent;
  }
  async function current(id) {
    try { return await call('request', { profileId: input.profileId, id }); }
    catch (error) { if (error.code === 'WORKSPACE_REQUEST_NOT_FOUND') return null; throw error; }
  }
  async function completed(id) {
    for (;;) {
      const value = await current(id);
      requireValue(value, 'RECEIVING_REQUEST_MISSING', 'Read the retained native operation before continuing.');
      if (value.phase === 'COMPLETE') return value;
      requireValue(value.running, 'RECEIVING_NATIVE_OPERATION_STOPPED', JSON.stringify({
        profileId: input.profileId, operationId: id, phase: value.phase, error: value.error }));
      await delay(250);
    }
  }
  async function pages(action, property, args = {}) {
    const rows = [], pages = []; let cursor; const seen = new Set();
    do {
      const page = await call(action, { ...args, ...(cursor ? { cursor } : {}), limit: 20 });
      requireValue(Array.isArray(page[property]), 'RECEIVING_PAGE_INVALID', 'Read the original complete page.');
      pages.push(page); rows.push(...page[property]);
      cursor = page.nextCursor;
      if (cursor) { requireValue(!seen.has(cursor), 'RECEIVING_CURSOR_REPEATED', 'The original page cursor repeated.'); seen.add(cursor); }
    } while (cursor);
    return { rows, pages };
  }
  try {
    await retain(selectedFile, input);
    if (await present(resultFile)) {
      const retained = await json(resultFile);
      requireValue(retained.schema === RESULT_SCHEMA && retained.status === 'COMPLETE' &&
        retained.operationId === input.operationId && retained.snapshotId === input.snapshotId,
        'RECEIVING_RESULT_CHANGED', 'Use the exact completed original receiving result.');
      completedReadback = true;
      return retained;
    }
    const identity = await readRecoveryWorkspaceIdentity({ configFile: input.hostConfig, directory: input.workspaceDirectory });
    result.identity = identity;
    const { inspectMerchantProvider } = await import('../../../../stellar-forge/mcp-merchant-operator/provider-cli.mjs');
    const { initializeMerchantProvider } = await import('../../../../stellar-forge/mcp-merchant-operator/providers.mjs');
    const { startMerchantMcp } = await import('../../../../stellar-forge/mcp-merchant-operator/serve.mjs');
    const inspection = inspectMerchantProvider('recovery-workspaces');
    requireValue(inspection.providers.length === 1 && inspection.providers[0].toolCount === recoveryWorkspaceTools.length,
      'RECEIVING_SOURCE_INCOMPLETE', 'Select the complete maintained source with its native recovery provider.');
    await phase('registered-source', inspection);
    const sourceDirectory = fileURLToPath(new URL('./', import.meta.url)).replace(/[\\/]$/, '');
    const connectionFile = join(input.directory, 'connection.json');
    await retain(connectionFile, { schema: RECOVERY_WORKSPACE_CONNECTION_SCHEMA,
      workspaces: { [input.workspace]: { directory: input.workspaceDirectory, configFile: input.hostConfig, sourceDirectory } } });
    const merchantDirectory = join(input.directory, 'merchant'), configPath = join(merchantDirectory, 'merchant-mcp.json');
    if (!await present(configPath)) await initializeMerchantProvider('recovery-workspaces',
      { directory: merchantDirectory, connection: connectionFile, name: 'Native recovery receiving' });
    native = await serveRecoveryWorkspace({ configFile: input.hostConfig, directory: input.workspaceDirectory, port: 0 });
    token = randomBytes(32).toString('hex');
    const environment = { ...process.env, SCF_NATIVE_MCP_ACCESS_TOKEN: token, MCP_CLIENT_ORIGINS: '' };
    merchant = await startMerchantMcp({ configPath, port: 0, tokenEnv: 'SCF_NATIVE_MCP_ACCESS_TOKEN', environment });
    await phase('mcp-initialize', await rpc('initialize', { protocolVersion: '2025-11-25',
      capabilities: {}, clientInfo: { name: 'native-recovery-receiving', version: '1' } }));
    const listed = await rpc('tools/list');
    requireValue(recoveryWorkspaceTools.every(tool => listed.tools.some(row => row.name === tool.name)),
      'RECEIVING_TOOLS_MISSING', 'Use the complete registered recovery tool catalog.');
    const state = await call('status'), profile = state.profiles.find(row => row.id === input.profileId);
    requireValue(state.id === identity.workspaceId && profile?.passphraseAvailable && !state.active,
      'RECEIVING_ORIGINAL_WORKSPACE_REQUIRED', 'Finish the existing native operation and retain its original passphrase environment.');
    const bundles = await call('bundles', { profileId: input.profileId });
    const bundle = bundles.bundles.find(row => row.bundleId === input.bundleId);
    requireValue(bundle?.snapshotId === input.snapshotId, 'RECEIVING_ORIGINAL_BUNDLE_CHANGED', 'Select the exact retained encrypted original bundle.');
    await phase('original-workspace-and-bundle', { state, bundle });
    const verifyId = input.operationId + '-verify', verify = { profileId: input.profileId, id: verifyId,
      action: 'verify', bundleId: input.bundleId };
    let request = await current(verifyId);
    if (!request) {
      const review = await call('review', { selection: verify });
      requireValue(review.snapshotId === input.snapshotId, 'RECEIVING_REVIEW_CHANGED', 'Review the retained original bundle.');
      const { workspace: ignoredWorkspace, connection: ignoredConnection, ...nativeReview } = review;
      await retain(join(input.directory, 'verify-review.json'), nativeReview);
      request = await call('start', { selection: verify, expectedReviewHash: review.reviewHash });
    } else {
      requireValue(request.review.command === 'local-verify' && request.review.snapshotId === input.snapshotId &&
        request.review.profileId === input.profileId && request.review.options.bundle === bundle.directory, 'RECEIVING_REQUEST_SELECTION_CHANGED', 'Continue this exact original verification.');
      if (request.phase !== 'COMPLETE' && !request.running)
        request = await call('resume', { profileId: input.profileId, id: verifyId });
    }
    await phase('original-bundle-verified', await completed(verifyId));
    const transfers = [];
    for (const original of input.completedOperations) {
      const operation = await call('operation', { profileId: input.profileId, id: original.id });
      requireValue(operation.status === 'COMPLETE' && operation.command === original.command &&
        operation.snapshotId === input.snapshotId, 'RECEIVING_ORIGINAL_TRANSFER_CHANGED', 'Select the completed original transfer journal and snapshot.');
      let retained = await current(original.id);
      if (!retained) {
        const selected = { profileId: input.profileId, id: original.id, action: 'resume' };
        const reviewed = await call('review', { selection: selected });
        requireValue(reviewed.originalStatus === 'COMPLETE' && reviewed.snapshotId === input.snapshotId,
          'RECEIVING_ORIGINAL_TRANSFER_CHANGED', 'Adopt the same completed original transfer.');
        retained = await call('start', { selection: selected, expectedReviewHash: reviewed.reviewHash });
      } else {
        requireValue(retained.review.command === original.command && retained.review.snapshotId === input.snapshotId,
          'RECEIVING_REQUEST_SELECTION_CHANGED', 'Keep this original transfer with its own retained workspace request.');
        if (retained.phase !== 'COMPLETE' && !retained.running)
          retained = await call('resume', { profileId: input.profileId, id: original.id });
      }
      const complete = await completed(original.id);
      requireValue(complete.operation?.status === 'COMPLETE' && complete.operation.command === original.command &&
        complete.operation.snapshotId === input.snapshotId, 'RECEIVING_TRANSFER_NOT_COMPLETE', 'Read the completed original transfer.');
      transfers.push(complete);
    }
    await phase('completed-transfers-adopted', transfers);
    const inventory = await pages('inventory', 'snapshots', { profileId: input.profileId });
    requireValue(inventory.rows.some(row => row.snapshotId === input.snapshotId),
      'RECEIVING_REMOTE_SNAPSHOT_MISSING', 'The selected actual store inventory must contain the original snapshot.');
    await phase('actual-store-inventory', inventory);
    await phase('original-journal-pages', await pages('operations', 'operations', { profileId: input.profileId }));
    await phase('workspace-request-pages', await pages('requests', 'requests'));
    const before = await current(verifyId);
    const resumed = await call('resume', { profileId: input.profileId, id: verifyId });
    await completed(verifyId);
    const stopped = await call('cancel', { profileId: input.profileId, id: verifyId });
    requireValue(stopped.phase === 'COMPLETE' && stopped.attempts === before.attempts,
      'RECEIVING_COMPLETED_REQUEST_CHANGED', 'A completed original verification must stay complete without another attempt.');
    await phase('completed-request-readback', { resumed, stopped });
    const first = native.connection;
    await merchant.close(); merchant = null;
    const borrowed = await readRecoveryWorkspaceLaunch({ directory: input.workspaceDirectory,
      configFile: input.hostConfig, expectedIdentity: identity });
    requireValue(borrowed.instanceId === first.instanceId, 'RECEIVING_NATIVE_OWNER_CHANGED', 'Merchant closure must retain the original native owner.');
    await native.close({ cancelActive: false }); native = null;
    native = await serveRecoveryWorkspace({ configFile: input.hostConfig, directory: input.workspaceDirectory, port: 0 });
    requireValue(native.connection.instanceId !== first.instanceId &&
      native.connection.identity.workspaceId === identity.workspaceId,
      'RECEIVING_REOPEN_IDENTITY_CHANGED', 'Reopen the same original workspace with its new native listener instance.');
    merchant = await startMerchantMcp({ configPath, port: 0, tokenEnv: 'SCF_NATIVE_MCP_ACCESS_TOKEN', environment });
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'native-recovery-receiving', version: '1' } });
    const reopened = await current(verifyId);
    requireValue(reopened?.phase === 'COMPLETE' && reopened.attempts === before.attempts &&
      reopened.connection.workspaceId === identity.workspaceId,
      'RECEIVING_REOPEN_RESULT_CHANGED', 'The original verification must reopen without executing again.');
    await phase('native-and-mcp-cold-reopen', { previous: first, current: native.connection, request: reopened });
  } catch (error) { primaryError = error; result.error = errorView(error); }
  finally {
    try { await merchant?.close(); } catch (error) { result.merchantCloseError = errorView(error); primaryError ??= error; }
    try { await native?.close({ cancelActive: false }); } catch (error) { result.nativeCloseError = errorView(error); primaryError ??= error; }
    result.finishedAt = stamp(); result.status = primaryError ? 'INTERRUPTED' : 'COMPLETE';
    try {
      if (completedReadback) { /* the original complete result was returned without launching */ }
      else if (result.status === 'COMPLETE') await publishJSON(resultFile, result);
      else {
        retainedAttempt = join(input.directory, 'attempt-' + Date.now() + '-' + randomBytes(4).toString('hex') + '.json');
        await publishJSON(retainedAttempt, result);
      }
    } catch (error) { primaryError ??= error; }
    await lease.release();
  }
  if (primaryError) {
    primaryError.receiving = { operationId: input.operationId, snapshotId: input.snapshotId,
      directory: input.directory, attemptFile: retainedAttempt ?? null };
    throw primaryError;
  }
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) {
    process.stdout.write(HELP); return;
  }
  requireValue(argv.length === 2 && argv[0] === '--input', 'RECEIVING_INPUT_REQUIRED',
    'Use native-receiving.mjs --input /private/recovery/receiving.json.');
  const input = await json(resolve(argv[1]));
  const result = await receiveRecoveryWorkspaceMerchant(input, {
    onProgress: value => process.stderr.write(JSON.stringify(value) + '\n') });
  process.stdout.write(JSON.stringify({ schema: result.schema, operationId: result.operationId,
    status: result.status, snapshotId: result.snapshotId, result: join(input.directory, 'result.json') }) + '\n');
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write(JSON.stringify(errorView(error)) + '\n'); process.exitCode = 1; });
