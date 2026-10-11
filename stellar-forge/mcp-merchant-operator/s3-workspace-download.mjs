// MIT. Download the original S3 seller's two customer inputs through merchant MCP.
import { constants } from 'node:fs';
import { open, mkdir, readdir, realpath, link, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { failure, identifier, privateSupportDirectory, writePrivate } from './config.mjs';
import { openMerchantFileClient } from './retained-download.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const NAMES = ['objects.json', 'offers.json'];
const fail = (code, message) => failure('S3_DOWNLOAD_' + code, message);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function selection(value, releaseId) {
  if (value?.releaseId !== releaseId || !validSha(value.releaseDigest) || !Array.isArray(value.files) || value.files.length !== 2)
    throw fail('SELECTION_INVALID', 'Inspect the original release and its two customer files.');
  const files = NAMES.map(name => {
    const matches = value.files.filter(file => file?.file === name);
    const file = matches[0];
    if (matches.length !== 1 || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !validSha(file.sha256))
      throw fail('SELECTION_INVALID', 'The original customer file description is invalid.');
    return { file: name, bytes: file.bytes, sha256: file.sha256 };
  });
  return { releaseId, releaseDigest: value.releaseDigest, files };
}

async function clientAndSelection({ url, workspace, releaseId, tokenEnv, environment, signal, expectedReleaseDigest } = {}) {
  identifier(workspace, 'S3 workspace alias'); identifier(releaseId, 'Release ID');
  const client = await openMerchantFileClient({ url, tokenEnv, environment, signal,
    errorPrefix: 'S3', clientName: 'starforge-s3-customer-download' });
  await client.call('merchant_s3_open', { workspace });
  const manifest = selection(await client.call('merchant_s3_customer', { workspace, releaseId }), releaseId);
  if (expectedReleaseDigest !== undefined && (!validSha(expectedReleaseDigest) || manifest.releaseDigest !== expectedReleaseDigest))
    throw fail('RELEASE_CHANGED', 'The original release differs from the selected release digest.');
  return { client, workspace, manifest };
}

async function regular(path, flags = constants.O_RDONLY) {
  const handle = await open(path, flags | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || process.platform !== 'win32' && info.mode & 0o077)
      throw fail('PRIVATE_FILE_REQUIRED', 'Customer downloads require private regular files.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function verify(path, file) {
  const { handle, info } = await regular(path);
  try {
    if (info.size !== file.bytes) throw fail('FILE_CHANGED', 'The saved customer file has a different size: ' + file.file + '.');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
    while (offset < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - offset), offset);
      if (!bytesRead) throw fail('FILE_CHANGED', 'The saved customer file ended early.');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if (hash.digest('hex') !== file.sha256) throw fail('FILE_CHANGED', 'The saved customer file has a different SHA256: ' + file.file + '.');
  } finally { await handle.close(); }
}
async function retainSelection(context, bytes) {
  const destination = join(context.stateDirectory, 'selection.json');
  try {
    const { handle, info } = await regular(destination);
    try {
      if (info.size !== bytes.length || !(await handle.readFile()).equals(bytes))
        throw fail('SELECTION_CONFLICT', 'This directory belongs to a different endpoint, workspace or original release.');
    } finally { await handle.close(); }
    return true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if ((await readdir(context.root)).some(name => name !== 's3-download-state'))
    throw fail('DIRECTORY_IN_USE', 'Choose an empty output directory or this download’s existing directory.');
  const temporary = join(context.stateDirectory, 'selection.next');
  await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await writePrivate(temporary, bytes); context.lease.assertHeld();
  await link(temporary, destination); await unlink(temporary); await syncDirectory(context.stateDirectory);
  return false;
}
function chunk(result, file, manifest, offset, limit) {
  const size = Math.min(limit, file.bytes - offset), next = offset + size;
  if (result?.releaseId !== manifest.releaseId || result.releaseDigest !== manifest.releaseDigest ||
      result.file !== file.file || result.sha256 !== file.sha256 || result.totalBytes !== file.bytes ||
      result.offset !== offset || result.nextOffset !== next ||
      result.eof !== (next === file.bytes) || typeof result.dataBase64 !== 'string')
    throw fail('CHUNK_CONFLICT', 'The customer chunk differs from its pinned original file or byte offset.');
  const bytes = Buffer.from(result.dataBase64, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== result.dataBase64)
    throw fail('CHUNK_INVALID', 'The customer chunk has invalid base64 or a different byte count.');
  return bytes;
}

/** Inspect the exact original objects.json and offers.json, without downloading object bodies. */
export async function inspectS3Customer(options = {}) {
  return (await clientAndSelection(options)).manifest;
}

/** Reuse complete native inputs; an interrupted metadata file restarts on the next invocation. */
export async function downloadS3Customer({ directory, chunkSize = 49152, onProgress, ...options } = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') || resolve(directory) === '/' ||
      !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 65536)
    throw fail('CONFIGURATION', 'Choose a private output directory and a chunk size from 1 to 65536 bytes.');
  const root = resolve(directory);
  try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateSupportDirectory(root);
  if (await realpath(root) !== root) throw fail('PRIVATE_DIRECTORY_REQUIRED', 'Use the canonical private output path.');
  const stateDirectory = join(root, 's3-download-state');
  const existing = await readdir(root);
  if (existing.length && !existing.includes('s3-download-state'))
    throw fail('DIRECTORY_IN_USE', 'Choose an empty output directory or this download’s existing directory.');
  try { await mkdir(stateDirectory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateSupportDirectory(stateDirectory);
  const rootNames = new Set(['s3-download-state', ...NAMES]);
  const stateNames = new Set(['lease.lock', 'selection.json', 'selection.next', ...NAMES.map(name => name + '.part')]);
  if ((await readdir(root)).some(name => !rootNames.has(name)) || (await readdir(stateDirectory)).some(name => !stateNames.has(name)))
    throw fail('DIRECTORY_IN_USE', 'The output directory contains files outside this customer download.');
  let lease;
  try { lease = await acquireStateLease(stateDirectory); }
  catch (error) { throw fail(error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'BUSY' : 'LEASE_UNAVAILABLE',
    error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'Another client owns this download directory.' : 'The download requires the original Linux flock lease.'); }
  try {
    const { client, workspace, manifest } = await clientAndSelection(options);
    const context = { root, stateDirectory, lease };
    const savedSelection = Buffer.from(JSON.stringify({ schema: 'stellar-forge.s3-customer-download-selection.v1',
      endpoint: client.endpoint, workspace, ...manifest }, null, 2) + '\n');
    const resumed = await retainSelection(context, savedSelection); let reusedFiles = 0;
    for (const file of manifest.files) {
      const destination = join(root, file.file), partial = join(stateDirectory, file.file + '.part');
      try { await verify(destination, file); reusedFiles++; continue; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      let opened;
      try { opened = await regular(partial, constants.O_RDWR); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const handle = await open(partial, 'wx+', 0o600); opened = { handle };
      }
      const { handle } = opened; const hash = createHash('sha256'); let offset = 0;
      try {
        lease.assertHeld(); await handle.truncate(0);
        while (offset < file.bytes) {
          options.signal?.throwIfAborted(); lease.assertHeld();
          const value = await client.call('merchant_s3_customer_file', { workspace, releaseId: manifest.releaseId,
            file: file.file, expectedSha256: file.sha256, offset, limit: chunkSize });
          const bytes = chunk(value, file, manifest, offset, chunkSize); let written = 0;
          while (written < bytes.length) {
            const result = await handle.write(bytes, written, bytes.length - written, offset + written);
            if (!result.bytesWritten) throw fail('WRITE_FAILED', 'The customer download could not advance.');
            written += result.bytesWritten;
          }
          hash.update(bytes); offset += bytes.length;
          await onProgress?.({ releaseId: manifest.releaseId, file: file.file, bytes: offset, total: file.bytes });
        }
        if (hash.digest('hex') !== file.sha256) throw fail('FILE_CHANGED', 'The completed customer file differs from its original SHA256.');
        await handle.sync(); lease.assertHeld(); await link(partial, destination);
        await unlink(partial); await syncDirectory(root); await syncDirectory(stateDirectory);
      } finally { await handle.close(); }
    }
    return { schema: 'stellar-forge.s3-customer-download.v1', state: 'COMPLETE', directory: root, workspace,
      ...manifest, resumed, reusedFiles, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      selectionSha256: sha256(savedSelection) };
  } finally { await lease.close(); }
}
