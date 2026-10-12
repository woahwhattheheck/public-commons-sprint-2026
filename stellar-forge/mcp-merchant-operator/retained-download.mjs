// MIT. One durable client transport for original retained merchant files.
import { constants } from 'node:fs';
import { open, mkdir, readdir, realpath, link, unlink, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { MCP_VERSION } from '../mcp-paid-agent/http-tools.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { failure, identifier, privateSupportDirectory, writePrivate } from './host-files.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validReadId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

/** Connect only to the operator-selected MCP endpoint; no payment or export calls. */
export async function openMerchantFileClient({ url, tokenEnv = 'MCP_ACCESS_TOKEN', environment = process.env, signal, errorPrefix = 'SUPPORT', clientName = 'starforge-support-download' } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw failure(errorPrefix + '_DOWNLOAD_CONFIGURATION', 'Supply an HTTPS MCP endpoint or its original loopback HTTP listener.'); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname)) ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv) || typeof environment[tokenEnv] !== 'string' || environment[tokenEnv].length < 24 ||
      /[^\x21-\x7e]/.test(environment[tokenEnv]))
    throw failure(errorPrefix + '_DOWNLOAD_CONFIGURATION', 'Use an HTTPS or loopback MCP URL and its bearer token environment variable.');
  const token = environment[tokenEnv]; let sequence = 0;
  async function request(method, params, { requestSignal = signal, timeoutMs = 120000 } = {}) {
    const id = method.startsWith('notifications/') ? undefined : ++sequence;
    const deadline = AbortSignal.timeout(timeoutMs), combined = requestSignal ? AbortSignal.any([requestSignal, deadline]) : deadline;
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: combined,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }) });
    if (id === undefined && response.status === 202) { await response.body?.cancel(); return; }
    if (!response.ok) { await response.body?.cancel(); throw failure(errorPrefix + '_DOWNLOAD_HTTP_' + response.status, 'The original MCP endpoint returned HTTP ' + response.status + '.'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw failure(errorPrefix + '_DOWNLOAD_REPLY_TOO_LARGE', 'The bounded MCP file response is oversized.');
      chunks.push(chunk);
    }
    let reply;
    try { reply = JSON.parse(decode(Buffer.concat(chunks, size))); }
    catch { throw failure(errorPrefix + '_DOWNLOAD_REPLY_INVALID', 'The original MCP endpoint did not return a valid JSON response.'); }
    if (!plain(reply) || reply.jsonrpc !== '2.0' || reply.id !== id || Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error'))
      throw failure(errorPrefix + '_DOWNLOAD_REPLY_INVALID', 'The MCP reply does not match this request.');
    if (reply.error) throw failure(errorPrefix + '_DOWNLOAD_RPC_ERROR', 'The original MCP endpoint rejected this protocol request.');
    return reply.result;
  }
  const initialized = await request('initialize', { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: clientName, version: '0.1.0' } });
  if (initialized?.protocolVersion !== MCP_VERSION) throw failure(errorPrefix + '_DOWNLOAD_PROTOCOL', 'The endpoint uses a different MCP protocol version.');
  await request('notifications/initialized', {});
  return { endpoint: endpoint.href,
    async call(name, args, options) {
      const result = await request('tools/call', { name, arguments: args }, options);
      const value = result?.structuredContent;
      if (result?.isError) throw failure(/^[A-Z][A-Z0-9_]+$/.test(value?.code ?? '') ? value.code : errorPrefix + '_DOWNLOAD_TOOL_FAILED',
        typeof value?.reason === 'string' ? value.reason : 'The original retained-file operation failed.');
      if (!plain(value)) throw failure(errorPrefix + '_DOWNLOAD_REPLY_INVALID', 'The retained-file tool returned no structured result.');
      return value;
    } };
}

/** Owner adapters supply the original manifest parser, names and identity schema. */
export function createRetainedDownload({ manifestName, parseManifest, maximumBytes, stateSchema,
  resultSchema, toolPrefix, errorPrefix, clientName, describe = () => ({}), connect = openMerchantFileClient, nestedFiles = false }) {
  async function regular(path, flags = constants.O_RDONLY, maximum = maximumBytes) {
    const handle = await open(path, flags | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > maximum || process.platform !== 'win32' && info.mode & 0o077)
        throw failure(errorPrefix + '_DOWNLOAD_PRIVATE_FILE_REQUIRED', 'Use private regular download files within the original size limits.');
      return { handle, info };
    } catch (error) { await handle.close(); throw error; }
  }
  async function bytesAt(path, maximum) {
    const { handle } = await regular(path, constants.O_RDONLY, maximum);
    try { const bytes = await handle.readFile(); if (bytes.length > maximum) throw failure(errorPrefix + '_DOWNLOAD_FILE_CHANGED', 'The saved file grew beyond its limit.'); return bytes; }
    finally { await handle.close(); }
  }
  async function prefixHash(handle, length) {
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, length - offset), offset);
      if (!bytesRead) throw failure(errorPrefix + '_DOWNLOAD_FILE_CHANGED', 'The saved file ended before its retained byte count.');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    return hash;
  }
  async function verifiedFile(path, file) {
    const { handle, info } = await regular(path, constants.O_RDONLY, file.bytes);
    try {
      if (info.size !== file.bytes || (await prefixHash(handle, info.size)).digest('hex') !== file.sha256)
        throw failure(errorPrefix + '_DOWNLOAD_FILE_CHANGED', 'A saved original file differs from its completion manifest: ' + file.name + '.');
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
  async function publishManifest(context, destination, bytes) {
    context.lease.assertHeld();
    const temporary = join(context.stateDirectory, manifestName + '.next');
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    try {
      await writePrivate(temporary, bytes); context.lease.assertHeld();
      try { await link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!(await bytesAt(destination, 65000)).equals(bytes))
          throw failure(errorPrefix + '_DOWNLOAD_EXPORT_CHANGED', 'The existing local completion manifest differs.');
      }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    await syncDirectory(context.stateDirectory); await syncDirectory(context.root);
  }
  async function lockedDownload(directory, operation) {
    if (typeof directory !== 'string' || !directory || directory.includes('\0') || resolve(directory) === '/')
      throw failure(errorPrefix + '_DOWNLOAD_CONFIGURATION', 'Choose a private output directory for this retained export.');
    const root = resolve(directory);
    try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await privateSupportDirectory(root);
    if (await realpath(root) !== root) throw failure(errorPrefix + '_DOWNLOAD_PRIVATE_DIRECTORY_REQUIRED', 'Use the canonical private download path without symlink components.');
    const stateDirectory = join(root, 'download-state');
    try {
      const entries = await readdir(root);
      if (entries.length && !entries.includes('download-state')) throw failure(errorPrefix + '_DOWNLOAD_DIRECTORY_IN_USE', 'Choose an empty output directory or this download’s existing directory.');
      await mkdir(stateDirectory, { mode: 0o700 });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await privateSupportDirectory(stateDirectory);
    let lease;
    try { lease = await acquireStateLease(stateDirectory); }
    catch (error) {
      throw failure(error.message === 'FLEET_STATE_ALREADY_OWNED' ? errorPrefix + '_DOWNLOAD_BUSY' : errorPrefix + '_DOWNLOAD_LEASE_UNAVAILABLE',
        error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'Another client owns this download directory.' : 'The download requires the original Linux flock lease (util-linux).');
    }
    try { return await operation({ root, stateDirectory, lease }); }
    finally { await lease.close(); }
  }
  const partialName = file => nestedFiles ? 'part-' + sha(Buffer.from(file.name)) + '.part' : file.name + '.part';
  async function validateNestedRoot(context, manifest) {
    const files = new Set([manifestName, ...manifest.files.map(file => file.name)]), directories = new Set();
    for (const name of files) {
      if (typeof name !== 'string' || !name || name.startsWith('/') || /[\\:\u0000-\u001f\u007f]/.test(name)
          || name.split('/').some(part => !part || part === '.' || part === '..') || name.split('/').length > 32
          || name === 'download-state' || name.startsWith('download-state/'))
        throw failure(errorPrefix + '_DOWNLOAD_MANIFEST_INVALID', 'Use canonical original relative file paths outside download-state.');
      const parts = name.split('/');
      for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'));
    }
    if ([...directories].some(name => files.has(name)))
      throw failure(errorPrefix + '_DOWNLOAD_MANIFEST_INVALID', 'A retained file conflicts with another file’s directory.');
    async function visit(path, relative = '') {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (!relative && entry.name === 'download-state') continue;
        const name = relative ? relative + '/' + entry.name : entry.name;
        if (entry.isDirectory() && directories.has(name)) {
          const child = join(path, entry.name);
          await privateSupportDirectory(child);
          if (await realpath(child) !== child) throw failure(errorPrefix + '_DOWNLOAD_DIRECTORY_IN_USE', 'A retained directory changed identity.');
          await visit(child, name);
        } else if (!entry.isFile() || !files.has(name))
          throw failure(errorPrefix + '_DOWNLOAD_DIRECTORY_IN_USE', 'This directory contains files outside the selected original retained download.');
      }
    }
    await visit(context.root);
  }
  async function ensureNativeParents(context, name) {
    if (!nestedFiles) return;
    let parent = context.root;
    for (const part of name.split('/').slice(0, -1)) {
      const child = join(parent, part); let created = false;
      try { await mkdir(child, { mode: 0o700 }); created = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await privateSupportDirectory(child);
      if (await realpath(child) !== child) throw failure(errorPrefix + '_DOWNLOAD_DIRECTORY_IN_USE', 'An original file parent changed identity.');
      if (created) await syncDirectory(parent);
      parent = child;
    }
  }
  async function loadContext(context, manifestBytes, exportId, endpoint) {
    const manifest = parseManifest(manifestBytes, exportId), manifestSha256 = sha(manifestBytes);
    const rootNames = new Set(['download-state', manifestName, ...manifest.files.map(file => file.name)]);
    const stateNames = new Set(['lease.lock', 'checkpoint.json', 'checkpoint.next', manifestName, manifestName + '.next', ...manifest.files.map(partialName)]);
    if (nestedFiles) await validateNestedRoot(context, manifest);
    if ((!nestedFiles && (await readdir(context.root)).some(name => !rootNames.has(name))) || (await readdir(context.stateDirectory)).some(name => !stateNames.has(name)))
      throw failure(errorPrefix + '_DOWNLOAD_DIRECTORY_IN_USE', 'This directory contains files outside the selected original retained download.');
    let savedBytes;
    try { savedBytes = await bytesAt(join(context.stateDirectory, manifestName), 65000); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (savedBytes && !savedBytes.equals(manifestBytes)) throw failure(errorPrefix + '_DOWNLOAD_EXPORT_CHANGED', 'This directory belongs to a different completion manifest. Keep its original files and select the intended export.');
    if (!savedBytes) await publishManifest(context, join(context.stateDirectory, manifestName), manifestBytes);
    let state;
    try { state = JSON.parse(decode(await bytesAt(join(context.stateDirectory, 'checkpoint.json'), 65000))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state && (state.schema !== stateSchema || state.exportId !== exportId || state.manifestSha256 !== manifestSha256 ||
        endpoint !== undefined && state.endpoint !== endpoint || !plain(state.files) || Object.keys(state.files).some(name => !manifest.files.some(file => file.name === name))))
      throw failure(errorPrefix + '_DOWNLOAD_CHECKPOINT_CONFLICT', 'The retained download identity does not match this export and endpoint.');
    const resumed = Boolean(state);
    state ??= { schema: stateSchema, exportId, endpoint, manifestSha256, createdAt: new Date().toISOString(), files: {} };
    Object.assign(context, { exportId, manifest, manifestBytes, manifestSha256, state, resumed });
    await checkpoint(context); return context;
  }
  function chunkBytes(result, file, offset, limit, exportId, manifestSha256, readId) {
    const size = Math.min(limit, file.bytes - offset);
    if (result.exportId !== exportId || result.manifestSha256 !== manifestSha256 || result.file?.name !== file.name ||
        result.file?.bytes !== file.bytes || result.file?.sha256 !== file.sha256 || !validReadId(result.readId) ||
        readId && result.readId !== readId || result.offset !== offset || result.bytesRead !== size || result.encoding !== 'base64' ||
        result.nextOffset !== (offset + size < file.bytes ? offset + size : null) || typeof result.data !== 'string')
      throw failure(errorPrefix + '_DOWNLOAD_CHUNK_CONFLICT', 'The returned chunk does not match its pinned original file and byte offset.');
    const bytes = Buffer.from(result.data, 'base64');
    if (bytes.length !== size || bytes.toString('base64') !== result.data)
      throw failure(errorPrefix + '_DOWNLOAD_CHUNK_INVALID', 'The retained chunk has invalid base64 or a different byte count.');
    return bytes;
  }
  async function retainedManifest(client, exportId) {
    const info = await client.call(toolPrefix + '_manifest', { exportId }), file = info.manifestFile;
    if (info.state !== 'MANIFEST_RETAINED' || info.exportId !== exportId || file?.name !== manifestName ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 65000 || !validSha(file.sha256))
      throw failure(errorPrefix + '_DOWNLOAD_MANIFEST_INVALID', 'Inspect a retained original completion manifest.');
    const result = await client.call(toolPrefix + '_file', { exportId, file: file.name,
      expectedManifestSha256: file.sha256, expectedSha256: file.sha256, limit: MAX_RETAINED_CHUNK_BYTES });
    const bytes = chunkBytes(result, file, 0, MAX_RETAINED_CHUNK_BYTES, exportId, file.sha256);
    if (sha(bytes) !== file.sha256) throw failure(errorPrefix + '_DOWNLOAD_MANIFEST_INVALID', 'The original completion manifest digest differs.');
    parseManifest(bytes, exportId); return bytes;
  }
  async function persistFile(context, client, file, { chunkSize, signal, onProgress }) {
    await ensureNativeParents(context, file.name);
    const destination = join(context.root, file.name), partial = join(context.stateDirectory, partialName(file));
    try {
      await verifiedFile(destination, file);
      context.state.files[file.name] = { bytes: file.bytes, sha256: file.sha256, complete: true };
      await checkpoint(context);
      await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const saved = context.state.files[file.name] ?? { bytes: 0, sha256: sha(Buffer.alloc(0)), complete: false };
    if (!Number.isSafeInteger(saved.bytes) || saved.bytes < 0 || saved.bytes > file.bytes || !validSha(saved.sha256) || saved.complete)
      throw failure(errorPrefix + '_DOWNLOAD_CHECKPOINT_CONFLICT', 'A completed or invalid checkpoint has no matching original file: ' + file.name + '.');
    let opened;
    try { opened = await regular(partial, constants.O_RDWR, file.bytes); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (saved.bytes) throw failure(errorPrefix + '_DOWNLOAD_FILE_CHANGED', 'A checkpointed partial file is missing: ' + file.name + '.');
      const handle = await open(partial, 'wx+', 0o600); opened = { handle, info: await handle.stat() };
    }
    const { handle, info } = opened; let readId = saved.readId ?? null, offset = saved.bytes;
    try {
      const hash = await prefixHash(handle, offset);
      if (info.size < offset || hash.copy().digest('hex') !== saved.sha256)
        throw failure(errorPrefix + '_DOWNLOAD_FILE_CHANGED', 'The saved partial bytes differ from their checkpoint: ' + file.name + '.');
      // A killed write may leave an uncheckpointed suffix. Only that owned suffix
      // is discarded; the durable, verified prefix is retained and rehashed once.
      await handle.truncate(offset);
      while (offset < file.bytes) {
        signal?.throwIfAborted(); context.lease.assertHeld();
        const args = { exportId: context.exportId, file: file.name, expectedManifestSha256: context.manifestSha256,
          expectedSha256: file.sha256, offset, limit: chunkSize, ...(readId ? { readId } : {}) };
        let result;
        try { result = await client.call(toolPrefix + '_file', args); }
        catch (error) {
          if (error.code !== errorPrefix + '_READ_NOT_FOUND' || !readId) throw error;
          readId = null; delete args.readId; result = await client.call(toolPrefix + '_file', args);
        }
        const bytes = chunkBytes(result, file, offset, chunkSize, context.exportId, context.manifestSha256, readId);
        readId = result.nextOffset === null ? null : result.readId;
        let written = 0;
        while (written < bytes.length) { const value = await handle.write(bytes, written, bytes.length - written, offset + written); if (!value.bytesWritten) throw failure(errorPrefix + '_DOWNLOAD_WRITE_FAILED', 'The local partial file could not advance.'); written += value.bytesWritten; }
        hash.update(bytes); offset += bytes.length; await handle.sync();
        context.state.files[file.name] = { bytes: offset, sha256: hash.copy().digest('hex'), readId, complete: false };
        await checkpoint(context);
        await onProgress?.({ exportId: context.exportId, file: file.name, bytes: offset, total: file.bytes, state: 'DOWNLOADING' });
      }
      if (hash.digest('hex') !== file.sha256) throw failure(errorPrefix + '_DOWNLOAD_FILE_CHANGED', 'The complete downloaded file differs from the original SHA256: ' + file.name + '.');
      context.lease.assertHeld();
      await link(partial, destination); await syncDirectory(dirname(destination));
      await unlink(partial); await syncDirectory(context.stateDirectory);
      context.state.files[file.name] = { bytes: file.bytes, sha256: file.sha256, complete: true }; await checkpoint(context);
    } finally {
      await handle.close();
      if (readId) await client.call(toolPrefix + '_file_release', { exportId: context.exportId, readId },
        { requestSignal: null, timeoutMs: 2000 }).catch(() => {});
    }
  }

  /** Saves the exact original files; a second invocation resumes the same directory. */
  async function download({ url, exportId, directory, tokenEnv, environment, signal,
    chunkSize = MAX_RETAINED_CHUNK_BYTES, onProgress, expectedManifestSha256 } = {}) {
    identifier(exportId, 'Export ID');
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_RETAINED_CHUNK_BYTES)
      throw failure(errorPrefix + '_DOWNLOAD_CONFIGURATION', 'Chunk size must be 1–196608 bytes.');
    const client = await connect({ url, tokenEnv, environment, signal, errorPrefix, clientName });
    const manifestBytes = await retainedManifest(client, exportId);
    if (expectedManifestSha256 !== undefined && (!validSha(expectedManifestSha256) || sha(manifestBytes) !== expectedManifestSha256))
      throw failure(errorPrefix + '_DOWNLOAD_EXPORT_CHANGED', 'The retained completion manifest differs from the reviewed original export.');
    return lockedDownload(directory, async context => {
      await loadContext(context, manifestBytes, exportId, client.endpoint);
      const resumedBytes = Object.values(context.state.files).reduce((sum, value) => sum + (Number.isSafeInteger(value.bytes) ? value.bytes : 0), 0);
      for (const file of context.manifest.files) await persistFile(context, client, file, { chunkSize, signal, onProgress });
      const final = join(context.root, manifestName);
      await publishManifest(context, final, manifestBytes);
      return { schema: resultSchema, state: 'COMPLETE', directory: context.root,
        exportId, ...describe(context.manifest), manifestSha256: context.manifestSha256, resumed: context.resumed, resumedBytes,
        files: context.manifest.files.length, bytes: context.manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
    });
  }

  async function inspect({ url, exportId, tokenEnv, environment, signal } = {}) {
    identifier(exportId, 'Export ID');
    const client = await connect({ url, tokenEnv, environment, signal, errorPrefix, clientName });
    const bytes = await retainedManifest(client, exportId);
    return { manifest: parseManifest(bytes, exportId), manifestSha256: sha(bytes) };
  }
  return Object.freeze({ download, inspect, lockedDownload, loadContext, bytesAt, verifiedFile, checkpoint });
}
