// MIT. Persist and reopen the original support handoff through its retained MCP files.
import { constants } from 'node:fs';
import { open, mkdir, readdir, realpath, link, unlink, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { MCP_VERSION } from '../mcp-paid-agent/http-tools.mjs';
import { parseSupportExportManifest } from './support.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { failure, identifier, privateSupportDirectory, writePrivate } from './config.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { importRuntimeHandoff, MAX_HANDOFF_BYTES } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';
import { openCaseStore, caseMetadata } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-store.mjs';

const STATE_SCHEMA = 'stellar-forge.merchant-support-download.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validReadId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const json = value => JSON.stringify(value, null, 2) + '\n';

/** Connect only to the operator-selected MCP endpoint; no payment or export calls. */
export async function openMerchantFileClient({ url, tokenEnv = 'MCP_ACCESS_TOKEN', environment = process.env, signal } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw failure('SUPPORT_DOWNLOAD_CONFIGURATION', 'Supply an HTTPS MCP endpoint or its original loopback HTTP listener.'); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname)) ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv) || typeof environment[tokenEnv] !== 'string' || environment[tokenEnv].length < 24 ||
      /[^\x21-\x7e]/.test(environment[tokenEnv]))
    throw failure('SUPPORT_DOWNLOAD_CONFIGURATION', 'Use an HTTPS or loopback MCP URL and its bearer token environment variable.');
  const token = environment[tokenEnv]; let sequence = 0;
  async function request(method, params, { requestSignal = signal, timeoutMs = 120000 } = {}) {
    const id = method.startsWith('notifications/') ? undefined : ++sequence;
    const deadline = AbortSignal.timeout(timeoutMs), combined = requestSignal ? AbortSignal.any([requestSignal, deadline]) : deadline;
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: combined,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }) });
    if (id === undefined && response.status === 202) { await response.body?.cancel(); return; }
    if (!response.ok) { await response.body?.cancel(); throw failure('SUPPORT_DOWNLOAD_HTTP_' + response.status, 'The original MCP endpoint returned HTTP ' + response.status + '.'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw failure('SUPPORT_DOWNLOAD_REPLY_TOO_LARGE', 'The bounded MCP file response is oversized.');
      chunks.push(chunk);
    }
    let reply;
    try { reply = JSON.parse(decode(Buffer.concat(chunks, size))); }
    catch { throw failure('SUPPORT_DOWNLOAD_REPLY_INVALID', 'The original MCP endpoint did not return a valid JSON response.'); }
    if (!plain(reply) || reply.jsonrpc !== '2.0' || reply.id !== id || Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error'))
      throw failure('SUPPORT_DOWNLOAD_REPLY_INVALID', 'The MCP reply does not match this request.');
    if (reply.error) throw failure('SUPPORT_DOWNLOAD_RPC_ERROR', 'The original MCP endpoint rejected this protocol request.');
    return reply.result;
  }
  const initialized = await request('initialize', { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: 'starforge-support-download', version: '0.1.0' } });
  if (initialized?.protocolVersion !== MCP_VERSION) throw failure('SUPPORT_DOWNLOAD_PROTOCOL', 'The endpoint uses a different MCP protocol version.');
  await request('notifications/initialized', {});
  return { endpoint: endpoint.href,
    async call(name, args, options) {
      const result = await request('tools/call', { name, arguments: args }, options);
      const value = result?.structuredContent;
      if (result?.isError) throw failure(/^[A-Z][A-Z0-9_]+$/.test(value?.code ?? '') ? value.code : 'SUPPORT_DOWNLOAD_TOOL_FAILED',
        typeof value?.reason === 'string' ? value.reason : 'The original retained-file operation failed.');
      if (!plain(value)) throw failure('SUPPORT_DOWNLOAD_REPLY_INVALID', 'The retained-file tool returned no structured result.');
      return value;
    } };
}

async function regular(path, flags = constants.O_RDONLY, maximum = MAX_HANDOFF_BYTES) {
  const handle = await open(path, flags | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum || process.platform !== 'win32' && info.mode & 0o077)
      throw failure('SUPPORT_DOWNLOAD_PRIVATE_FILE_REQUIRED', 'Use private regular download files within the original size limits.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function bytesAt(path, maximum) {
  const { handle } = await regular(path, constants.O_RDONLY, maximum);
  try { const bytes = await handle.readFile(); if (bytes.length > maximum) throw failure('SUPPORT_DOWNLOAD_FILE_CHANGED', 'The saved file grew beyond its limit.'); return bytes; }
  finally { await handle.close(); }
}
async function prefixHash(handle, length) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, length - offset), offset);
    if (!bytesRead) throw failure('SUPPORT_DOWNLOAD_FILE_CHANGED', 'The saved file ended before its retained byte count.');
    hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
  }
  return hash;
}
async function verifiedFile(path, file) {
  const { handle, info } = await regular(path, constants.O_RDONLY, file.bytes);
  try {
    if (info.size !== file.bytes || (await prefixHash(handle, info.size)).digest('hex') !== file.sha256)
      throw failure('SUPPORT_DOWNLOAD_FILE_CHANGED', 'A saved original file differs from its completion manifest: ' + file.name + '.');
  } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function checkpoint(context) {
  context.lease.assertHeld();
  const temporary = join(context.stateDirectory, 'checkpoint.next');
  try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writePrivate(temporary, context.state); context.lease.assertHeld();
  await rename(temporary, join(context.stateDirectory, 'checkpoint.json')); await syncDirectory(context.stateDirectory);
}
async function lockedDownload(directory, operation) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') || resolve(directory) === '/')
    throw failure('SUPPORT_DOWNLOAD_CONFIGURATION', 'Choose a private output directory for this support export.');
  const root = resolve(directory);
  try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateSupportDirectory(root);
  if (await realpath(root) !== root) throw failure('SUPPORT_DOWNLOAD_PRIVATE_DIRECTORY_REQUIRED', 'Use the canonical private download path without symlink components.');
  const stateDirectory = join(root, 'download-state');
  try {
    const entries = await readdir(root);
    if (entries.length && !entries.includes('download-state')) throw failure('SUPPORT_DOWNLOAD_DIRECTORY_IN_USE', 'Choose an empty output directory or this download’s existing directory.');
    await mkdir(stateDirectory, { mode: 0o700 });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateSupportDirectory(stateDirectory);
  let lease;
  try { lease = await acquireStateLease(stateDirectory); }
  catch (error) {
    throw failure(error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'SUPPORT_DOWNLOAD_BUSY' : 'SUPPORT_DOWNLOAD_LEASE_UNAVAILABLE',
      error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'Another client owns this download directory.' : 'The download requires the original Linux flock lease (util-linux).');
  }
  try { return await operation({ root, stateDirectory, lease }); }
  finally { await lease.close(); }
}
async function loadContext(context, manifestBytes, exportId, endpoint) {
  const manifest = parseSupportExportManifest(manifestBytes, exportId), manifestSha256 = sha(manifestBytes);
  const rootNames = new Set(['download-state', 'support-export.json', ...manifest.files.map(file => file.name)]);
  const stateNames = new Set(['lease.lock', 'checkpoint.json', 'checkpoint.next', 'support-export.json', ...manifest.files.map(file => file.name + '.part')]);
  if ((await readdir(context.root)).some(name => !rootNames.has(name)) || (await readdir(context.stateDirectory)).some(name => !stateNames.has(name)))
    throw failure('SUPPORT_DOWNLOAD_DIRECTORY_IN_USE', 'This directory contains files outside the selected original support download.');
  let savedBytes;
  try { savedBytes = await bytesAt(join(context.stateDirectory, 'support-export.json'), 65000); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (savedBytes && !savedBytes.equals(manifestBytes)) throw failure('SUPPORT_DOWNLOAD_EXPORT_CHANGED', 'This directory belongs to a different completion manifest. Keep its original files and select the intended export.');
  if (!savedBytes) await writePrivate(join(context.stateDirectory, 'support-export.json'), manifestBytes);
  let state;
  try { state = JSON.parse(decode(await bytesAt(join(context.stateDirectory, 'checkpoint.json'), 65000))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state && (state.schema !== STATE_SCHEMA || state.exportId !== exportId || state.manifestSha256 !== manifestSha256 ||
      endpoint !== undefined && state.endpoint !== endpoint || !plain(state.files) || Object.keys(state.files).some(name => !manifest.files.some(file => file.name === name))))
    throw failure('SUPPORT_DOWNLOAD_CHECKPOINT_CONFLICT', 'The retained download identity does not match this export and endpoint.');
  const resumed = Boolean(state);
  state ??= { schema: STATE_SCHEMA, exportId, endpoint, manifestSha256, createdAt: new Date().toISOString(), files: {} };
  Object.assign(context, { manifest, manifestBytes, manifestSha256, state, resumed });
  await checkpoint(context); return context;
}
function chunkBytes(result, file, offset, limit, exportId, manifestSha256, readId) {
  const size = Math.min(limit, file.bytes - offset);
  if (result.exportId !== exportId || result.manifestSha256 !== manifestSha256 || result.file?.name !== file.name ||
      result.file?.bytes !== file.bytes || result.file?.sha256 !== file.sha256 || !validReadId(result.readId) ||
      readId && result.readId !== readId || result.offset !== offset || result.bytesRead !== size || result.encoding !== 'base64' ||
      result.nextOffset !== (offset + size < file.bytes ? offset + size : null) || typeof result.data !== 'string')
    throw failure('SUPPORT_DOWNLOAD_CHUNK_CONFLICT', 'The returned chunk does not match its pinned original file and byte offset.');
  const bytes = Buffer.from(result.data, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== result.data)
    throw failure('SUPPORT_DOWNLOAD_CHUNK_INVALID', 'The retained chunk has invalid base64 or a different byte count.');
  return bytes;
}
async function retainedManifest(client, exportId) {
  const info = await client.call('merchant_support_export_manifest', { exportId }), file = info.manifestFile;
  if (info.state !== 'MANIFEST_RETAINED' || info.exportId !== exportId || file?.name !== 'support-export.json' ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 65000 || !validSha(file.sha256))
    throw failure('SUPPORT_DOWNLOAD_MANIFEST_INVALID', 'Inspect a retained original support completion manifest.');
  const result = await client.call('merchant_support_export_file', { exportId, file: file.name,
    expectedManifestSha256: file.sha256, expectedSha256: file.sha256, limit: MAX_RETAINED_CHUNK_BYTES });
  const bytes = chunkBytes(result, file, 0, MAX_RETAINED_CHUNK_BYTES, exportId, file.sha256);
  if (sha(bytes) !== file.sha256) throw failure('SUPPORT_DOWNLOAD_MANIFEST_INVALID', 'The original completion manifest digest differs.');
  parseSupportExportManifest(bytes, exportId); return bytes;
}
async function persistFile(context, client, file, { chunkSize, signal, onProgress }) {
  const destination = join(context.root, file.name), partial = join(context.stateDirectory, file.name + '.part');
  try {
    await verifiedFile(destination, file);
    context.state.files[file.name] = { bytes: file.bytes, sha256: file.sha256, complete: true };
    await checkpoint(context);
    await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const saved = context.state.files[file.name] ?? { bytes: 0, sha256: sha(Buffer.alloc(0)), complete: false };
  if (!Number.isSafeInteger(saved.bytes) || saved.bytes < 0 || saved.bytes > file.bytes || !validSha(saved.sha256) || saved.complete)
    throw failure('SUPPORT_DOWNLOAD_CHECKPOINT_CONFLICT', 'A completed or invalid checkpoint has no matching original file: ' + file.name + '.');
  let opened;
  try { opened = await regular(partial, constants.O_RDWR, file.bytes); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (saved.bytes) throw failure('SUPPORT_DOWNLOAD_FILE_CHANGED', 'A checkpointed partial file is missing: ' + file.name + '.');
    const handle = await open(partial, 'wx+', 0o600); opened = { handle, info: await handle.stat() };
  }
  const { handle, info } = opened; let readId = saved.readId ?? null, offset = saved.bytes;
  try {
    const hash = await prefixHash(handle, offset);
    if (info.size < offset || hash.copy().digest('hex') !== saved.sha256)
      throw failure('SUPPORT_DOWNLOAD_FILE_CHANGED', 'The saved partial bytes differ from their checkpoint: ' + file.name + '.');
    // A killed write may leave an uncheckpointed suffix. Only that owned suffix
    // is discarded; the durable, verified prefix is retained and rehashed once.
    await handle.truncate(offset);
    while (offset < file.bytes) {
      signal?.throwIfAborted(); context.lease.assertHeld();
      const args = { exportId: context.manifest.exportId, file: file.name, expectedManifestSha256: context.manifestSha256,
        expectedSha256: file.sha256, offset, limit: chunkSize, ...(readId ? { readId } : {}) };
      let result;
      try { result = await client.call('merchant_support_export_file', args); }
      catch (error) {
        if (error.code !== 'SUPPORT_READ_NOT_FOUND' || !readId) throw error;
        readId = null; delete args.readId; result = await client.call('merchant_support_export_file', args);
      }
      const bytes = chunkBytes(result, file, offset, chunkSize, context.manifest.exportId, context.manifestSha256, readId);
      readId = result.nextOffset === null ? null : result.readId;
      let written = 0;
      while (written < bytes.length) { const value = await handle.write(bytes, written, bytes.length - written, offset + written); if (!value.bytesWritten) throw failure('SUPPORT_DOWNLOAD_WRITE_FAILED', 'The local partial file could not advance.'); written += value.bytesWritten; }
      hash.update(bytes); offset += bytes.length; await handle.sync();
      context.state.files[file.name] = { bytes: offset, sha256: hash.copy().digest('hex'), readId, complete: false };
      await checkpoint(context);
      await onProgress?.({ exportId: context.manifest.exportId, file: file.name, bytes: offset, total: file.bytes, state: 'DOWNLOADING' });
    }
    if (hash.digest('hex') !== file.sha256) throw failure('SUPPORT_DOWNLOAD_FILE_CHANGED', 'The complete downloaded file differs from the original SHA256: ' + file.name + '.');
    context.lease.assertHeld();
    await link(partial, destination); await unlink(partial); await syncDirectory(context.root);
    context.state.files[file.name] = { bytes: file.bytes, sha256: file.sha256, complete: true }; await checkpoint(context);
  } finally {
    await handle.close();
    if (readId) await client.call('merchant_support_export_file_release', { exportId: context.manifest.exportId, readId },
      { requestSignal: null, timeoutMs: 2000 }).catch(() => {});
  }
}

/** Saves the exact original files; a second invocation resumes the same directory. */
export async function downloadSupportExport({ url, exportId, directory, tokenEnv, environment, signal,
  chunkSize = MAX_RETAINED_CHUNK_BYTES, onProgress } = {}) {
  identifier(exportId, 'Export ID');
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_RETAINED_CHUNK_BYTES)
    throw failure('SUPPORT_DOWNLOAD_CONFIGURATION', 'Chunk size must be 1–196608 bytes.');
  const client = await openMerchantFileClient({ url, tokenEnv, environment, signal });
  const manifestBytes = await retainedManifest(client, exportId);
  return lockedDownload(directory, async context => {
    await loadContext(context, manifestBytes, exportId, client.endpoint);
    const resumedBytes = Object.values(context.state.files).reduce((sum, value) => sum + (Number.isSafeInteger(value.bytes) ? value.bytes : 0), 0);
    for (const file of context.manifest.files) await persistFile(context, client, file, { chunkSize, signal, onProgress });
    const final = join(context.root, 'support-export.json');
    try { await writePrivate(final, manifestBytes); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (!(await bytesAt(final, 65000)).equals(manifestBytes)) throw failure('SUPPORT_DOWNLOAD_EXPORT_CHANGED', 'The existing local completion manifest differs.'); }
    await syncDirectory(context.root);
    return { schema: 'stellar-forge.merchant-support-download-result.v1', state: 'COMPLETE', directory: context.root,
      exportId, case: context.manifest.case, manifestSha256: context.manifestSha256, resumed: context.resumed, resumedBytes,
      files: context.manifest.files.length, bytes: context.manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
  });
}

/** Offline continuation through the original SF74 importer and its versioned store. */
export async function reopenDownloadedSupportExport({ directory, casesDirectory } = {}) {
  if (typeof casesDirectory !== 'string' || !casesDirectory || casesDirectory.includes('\0'))
    throw failure('SUPPORT_DOWNLOAD_CONFIGURATION', 'Supply the original private case directory.');
  const cases = await realpath(await privateSupportDirectory(resolve(casesDirectory)));
  return lockedDownload(directory, async context => {
    const bytes = await bytesAt(join(context.root, 'support-export.json'), 65000);
    let exportId; try { exportId = JSON.parse(decode(bytes)).exportId; } catch { throw failure('SUPPORT_EXPORT_INVALID', 'Open a completed original support export.'); }
    await loadContext(context, bytes, exportId);
    for (const file of context.manifest.files) await verifiedFile(join(context.root, file.name), file);
    const source = JSON.parse(decode(await bytesAt(join(context.root, 'case.json'), MAX_HANDOFF_BYTES)));
    let original = { workspaceText: decode(await bytesAt(join(context.root, 'merchant-workspace.json'), MAX_HANDOFF_BYTES)), supportText: null, metadata: caseMetadata(source.metadata) };
    if (context.manifest.case.supportSha256 !== null)
      original = await importRuntimeHandoff(decode(await bytesAt(join(context.root, 'merchant-support.json'), MAX_HANDOFF_BYTES)));
    if (sha(original.workspaceText) !== context.manifest.case.workspaceSha256 ||
        (original.supportText === null ? null : sha(original.supportText)) !== context.manifest.case.supportSha256)
      throw failure('SUPPORT_DOWNLOAD_EXPORT_CHANGED', 'The original case inputs disagree with the downloaded completion manifest.');
    const bound = context.state.localCase;
    if (bound && (bound.directory !== cases || !validReadId(bound.id)))
      throw failure('SUPPORT_DOWNLOAD_CASE_CONFLICT', 'This download already reopens in a different local case directory. Use its retained original case.');
    if (!bound) { context.state.localCase = { directory: cases, id: randomUUID(), revision: null }; await checkpoint(context); }
    const local = context.state.localCase, store = await openCaseStore(cases);
    if (!local.revision) {
      const saved = await store.save({ id: local.id, expectedRevision: null, ...original, metadata: caseMetadata(original.metadata) });
      local.revision = saved.case.revision; await checkpoint(context);
    }
    const reopened = await store.read(local.id);
    return { schema: 'stellar-forge.merchant-support-reopened.v1', exportId, sourceCase: context.manifest.case,
      case: { id: reopened.id, revision: reopened.revision, importedRevision: local.revision, directory: cases },
      manifestSha256: context.manifestSha256, state: 'REOPENED' };
  });
}
