// MIT. Portable original Atlas workspace bytes; no network, signer, or imported code.
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export const WORKSPACE_TRANSFER_SCHEMA = 'stellar-forge.sf61.workspace-transfer.v1';
const WORKSPACE_SCHEMA = 'stellar-forge.sf61.workspace.v1';
const RECEIVE_SCHEMA = 'stellar-forge.sf61.workspace-receive.v1';
const STATE = '.atlas-transfer-state.json';
const COMPLETE = '.atlas-transfer-complete.json';
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 100000, maxFileBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message = code) { const error = new Error(message); error.code = code; throw error; }
function limitsFor(options) {
  const limits = { ...DEFAULT_LIMITS, ...options?.limits };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1) fail('ATLAS_TRANSFER_LIMIT_INVALID', `Invalid ${key}`);
  return limits;
}
function relativeFile(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 ||
      /[\\\u0000-\u001f\u007f<>:"|?*]/.test(value) || value.startsWith('/'))
    fail('ATLAS_TRANSFER_PATH_INVALID');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
      /^\.atlas-transfer-/i.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    fail('ATLAS_TRANSFER_PATH_INVALID');
  return value;
}
function absoluteDirectory(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\u0000\r\n]/.test(value))
    fail('ATLAS_TRANSFER_ABSOLUTE_DIRECTORY_REQUIRED');
  const directory = resolve(value);
  if (dirname(directory) === directory) fail('ATLAS_TRANSFER_ROOT_DIRECTORY_REFUSED');
  return directory;
}
async function statOrNull(path) {
  try { return await fs.lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function requireDirectory(path, privateDirectory = false) {
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(path) !== resolve(path))
    fail('ATLAS_TRANSFER_DIRECTORY_INVALID');
  if (privateDirectory && process.platform !== 'win32' &&
      ((stat.mode & 0o777) !== 0o700 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())))
    fail('ATLAS_TRANSFER_PRIVATE_DIRECTORY_REQUIRED');
}
async function parents(root, file) {
  await requireDirectory(root, true);
  let current = root;
  for (const part of file.split('/').slice(0, -1)) {
    current = join(current, part);
    try { await fs.mkdir(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await requireDirectory(current, true);
  }
}
async function exactFile(root, item) {
  const file = join(root, item.path), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.size)
    fail('ATLAS_TRANSFER_EXISTING_FILE_CHANGED', `Existing file differs: ${item.path}`);
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const bytes = await handle.readFile();
    if (bytes.length !== item.size || digest(bytes) !== item.sha256)
      fail('ATLAS_TRANSFER_EXISTING_FILE_CHANGED', `Existing file differs: ${item.path}`);
    return bytes;
  } finally { await handle.close(); }
}
async function putFile(root, file, bytes) {
  await parents(root, file);
  const item = { path: file, size: bytes.length, sha256: digest(bytes) };
  if (await statOrNull(join(root, file))) { await exactFile(root, item); return false; }
  const temporary = join(root, '.atlas-transfer-part-' + randomUUID());
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync();
    await handle.close(); handle = null;
    try { await fs.link(temporary, join(root, file)); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await exactFile(root, item);
      return false;
    }
    return true;
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function syncDirectory(directory) {
  // Windows does not expose directory fsync through this API.
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function nativeWorkspace(bytes, expectedId) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('ATLAS_TRANSFER_WORKSPACE_INVALID'); }
  if (value?.schema !== WORKSPACE_SCHEMA || typeof value.id !== 'string' || !value.id ||
      (expectedId !== undefined && value.id !== expectedId)) fail('ATLAS_TRANSFER_WORKSPACE_INVALID');
  return value;
}
function identity(workspaceId, files) {
  return digest(Buffer.from(JSON.stringify({ schema: WORKSPACE_TRANSFER_SCHEMA, workspaceId, files })));
}
function metadata(header) {
  return { schema: WORKSPACE_TRANSFER_SCHEMA, workspaceId: header.workspaceId,
    transferId: header.transferId, fileCount: header.fileCount, totalBytes: header.totalBytes,
    filename: `atlas-workspace-${header.transferId.slice(0, 20)}.ndjson`,
    contentType: 'application/x-ndjson; charset=utf-8' };
}

/** Retain only the first-pass manifest; recheck each original file while encoding the second pass. */
export async function prepareWorkspaceTransfer(workspace, options = {}) {
  if (typeof workspace?.snapshotFiles !== 'function') fail('ATLAS_TRANSFER_WORKSPACE_REQUIRED');
  const limits = limitsFor(options), files = [], names = new Set();
  let totalBytes = 0, workspaceId;
  for await (const value of await workspace.snapshotFiles()) {
    const path = relativeFile(value?.path), folded = path.toLowerCase();
    if (names.has(folded)) fail('ATLAS_TRANSFER_DUPLICATE_PATH');
    names.add(folded);
    if (!(value.bytes instanceof Uint8Array) && typeof value.bytes !== 'string')
      fail('ATLAS_TRANSFER_FILE_BYTES_REQUIRED');
    const bytes = Buffer.from(value.bytes);
    totalBytes += bytes.length;
    if (files.length >= limits.maxFiles || bytes.length > limits.maxFileBytes || totalBytes > limits.maxTotalBytes)
      fail('ATLAS_TRANSFER_LIMIT_EXCEEDED');
    if (path === 'workspace.json') workspaceId = nativeWorkspace(bytes).id;
    files.push({ path, size: bytes.length, sha256: digest(bytes) });
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!workspaceId) fail('ATLAS_TRANSFER_WORKSPACE_MISSING');
  const manifest = files.map(({ path, size, sha256 }) => ({ path, size, sha256 }));
  const header = { record: 'header', schema: WORKSPACE_TRANSFER_SCHEMA,
    transferId: identity(workspaceId, manifest), workspaceId, createdAt: new Date().toISOString(),
    fileCount: files.length, totalBytes, files: manifest };
  return { ...metadata(header), header,
    async *records() {
      yield encode(header);
      const expected = new Map(manifest.map(item => [item.path, item])), seen = new Set();
      for await (const value of await workspace.snapshotFiles()) {
        const path = relativeFile(value?.path), item = expected.get(path);
        if (!item || seen.has(path) || (!(value.bytes instanceof Uint8Array) && typeof value.bytes !== 'string'))
          fail('ATLAS_TRANSFER_SOURCE_CHANGED', 'The workspace changed between export passes; export again');
        const bytes = Buffer.from(value.bytes);
        if (bytes.length !== item.size || digest(bytes) !== item.sha256)
          fail('ATLAS_TRANSFER_SOURCE_CHANGED', `The workspace changed between export passes: ${path}`);
        seen.add(path);
        yield encode({ record: 'file', ...item, encoding: 'base64', data: bytes.toString('base64') });
      }
      if (seen.size !== manifest.length)
        fail('ATLAS_TRANSFER_SOURCE_CHANGED', 'A workspace file disappeared during export');
      yield encode({ record: 'complete', schema: WORKSPACE_TRANSFER_SCHEMA,
        transferId: header.transferId, fileCount: files.length, totalBytes });
    } };
}

/** Convenience response for the existing authenticated loopback host. */
export async function exportWorkspaceTransfer(workspace, options = {}) {
  const transfer = await prepareWorkspaceTransfer(workspace, options), chunks = [];
  for await (const record of transfer.records()) chunks.push(record);
  return { ...metadata(transfer.header), bytes: Buffer.concat(chunks) };
}

/** Create-only private export; the source snapshot is never changed. */
export async function writeWorkspaceTransfer(workspace, file, options = {}) {
  if (typeof file !== 'string' || !isAbsolute(file)) fail('ATLAS_TRANSFER_ABSOLUTE_FILE_REQUIRED');
  if (await statOrNull(file)) fail('ATLAS_TRANSFER_DESTINATION_EXISTS');
  const transfer = await prepareWorkspaceTransfer(workspace, options);
  const temporary = join(dirname(file), '.atlas-transfer-export-' + randomUUID());
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    for await (const record of transfer.records()) await handle.writeFile(record);
    await handle.sync();
    await fs.link(temporary, file);
    await syncDirectory(dirname(file));
  } finally { await handle.close(); await fs.unlink(temporary); }
  return { ...metadata(transfer.header), file: resolve(file) };
}

function validateHeader(header, limits) {
  if (!plain(header) || header.record !== 'header' || header.schema !== WORKSPACE_TRANSFER_SCHEMA ||
      typeof header.workspaceId !== 'string' || !header.workspaceId ||
      !Array.isArray(header.files) || !header.files.length || header.files.length > limits.maxFiles)
    fail('ATLAS_TRANSFER_HEADER_INVALID');
  const names = new Set(); let total = 0, previous = '';
  for (const item of header.files) {
    if (!plain(item)) fail('ATLAS_TRANSFER_MANIFEST_INVALID');
    relativeFile(item.path);
    if (item.path <= previous || names.has(item.path.toLowerCase()) ||
        !Number.isSafeInteger(item.size) || item.size < 0 || item.size > limits.maxFileBytes ||
        typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256))
      fail('ATLAS_TRANSFER_MANIFEST_INVALID');
    names.add(item.path.toLowerCase()); previous = item.path; total += item.size;
  }
  if (!names.has('workspace.json') || !Number.isSafeInteger(total) || total > limits.maxTotalBytes ||
      header.fileCount !== header.files.length || header.totalBytes !== total ||
      header.transferId !== identity(header.workspaceId, header.files)) fail('ATLAS_TRANSFER_MANIFEST_INVALID');
  return header;
}
async function* chunksOf(input) {
  if (typeof input === 'string' || input instanceof Uint8Array) { yield Buffer.from(input); return; }
  if (typeof input?.[Symbol.asyncIterator] === 'function' || typeof input?.[Symbol.iterator] === 'function') {
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array) && typeof chunk !== 'string') fail('ATLAS_TRANSFER_INPUT_INVALID');
      yield Buffer.from(chunk);
    }
    return;
  }
  fail('ATLAS_TRANSFER_INPUT_REQUIRED');
}
async function* recordsOf(input, limits) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const maximumLine = Math.ceil(limits.maxFileBytes * 4 / 3) + limits.maxFiles * 256 + 16384;
  const maximumWire = Math.ceil(limits.maxTotalBytes * 4 / 3) + limits.maxFiles * 512 + 32768;
  let tail = '', wire = 0;
  const parse = line => {
    if (!line || line.length > maximumLine) fail('ATLAS_TRANSFER_RECORD_INVALID');
    try { return JSON.parse(line); } catch { fail('ATLAS_TRANSFER_JSON_INVALID'); }
  };
  for await (const chunk of chunksOf(input)) {
    wire += chunk.length;
    if (wire > maximumWire) fail('ATLAS_TRANSFER_LIMIT_EXCEEDED');
    try { tail += decoder.decode(chunk, { stream: true }); }
    catch { fail('ATLAS_TRANSFER_UTF8_INVALID'); }
    let boundary;
    while ((boundary = tail.indexOf('\n')) >= 0) {
      const line = tail.slice(0, boundary); tail = tail.slice(boundary + 1);
      yield parse(line);
    }
    if (tail.length > maximumLine) fail('ATLAS_TRANSFER_LIMIT_EXCEEDED');
  }
  try { tail += decoder.decode(); } catch { fail('ATLAS_TRANSFER_UTF8_INVALID'); }
  if (tail) yield parse(tail);
}
async function consumeTransfer(input, options, hooks = {}) {
  const limits = limitsFor(options), seen = new Set();
  let header, byPath, complete = false, native;
  for await (const record of recordsOf(input, limits)) {
    if (!header) {
      header = validateHeader(record, limits); byPath = new Map(header.files.map(item => [item.path, item]));
      await hooks.header?.(header); continue;
    }
    if (complete) fail('ATLAS_TRANSFER_TRAILING_RECORD');
    if (record?.record === 'complete') {
      if (record.schema !== WORKSPACE_TRANSFER_SCHEMA || record.transferId !== header.transferId ||
          record.fileCount !== header.fileCount || record.totalBytes !== header.totalBytes ||
          seen.size !== header.fileCount) fail('ATLAS_TRANSFER_INCOMPLETE');
      complete = true; continue;
    }
    const item = byPath.get(record?.path);
    if (record?.record !== 'file' || !item || seen.has(item.path) || record.encoding !== 'base64' ||
        record.size !== item.size || record.sha256 !== item.sha256 || typeof record.data !== 'string')
      fail('ATLAS_TRANSFER_FILE_RECORD_INVALID');
    const bytes = Buffer.from(record.data, 'base64');
    if (bytes.toString('base64') !== record.data || bytes.length !== item.size || digest(bytes) !== item.sha256)
      fail('ATLAS_TRANSFER_FILE_HASH_MISMATCH', `File bytes differ: ${item.path}`);
    if (item.path === 'workspace.json') native = nativeWorkspace(bytes, header.workspaceId);
    seen.add(item.path); await hooks.file?.(item, bytes);
  }
  if (!header || !complete || !native) fail('ATLAS_TRANSFER_INCOMPLETE');
  return header;
}

/** Inspect the complete incoming stream without creating files. */
export async function inspectWorkspaceTransfer(input, options = {}) {
  const header = await consumeTransfer(input, options);
  return { ...metadata(header), files: header.files };
}
function receiveState(header) {
  return { schema: RECEIVE_SCHEMA, transferId: header.transferId, workspaceId: header.workspaceId,
    fileCount: header.fileCount, totalBytes: header.totalBytes, files: header.files };
}
async function requireState(directory, header) {
  await requireDirectory(directory, true);
  let state;
  const bytes = encode(receiveState(header));
  try { state = await exactFile(directory, { path: STATE, size: bytes.length, sha256: digest(bytes) }); }
  catch { fail('ATLAS_TRANSFER_DESTINATION_CONFLICT', 'The receive destination belongs to a different operation'); }
  return JSON.parse(state);
}
async function claim(directory, header, resume) {
  try { await fs.mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!resume) fail('ATLAS_TRANSFER_DESTINATION_EXISTS', 'Use --resume for this same transfer');
    await requireState(directory, header); return false;
  }
  await requireDirectory(directory, true);
  await putFile(directory, STATE, encode(receiveState(header)));
  await syncDirectory(directory);
  await syncDirectory(dirname(directory)); return true;
}
async function completed(directory, header) {
  const path = join(directory, COMPLETE), stat = await statOrNull(path);
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink()) fail('ATLAS_TRANSFER_DESTINATION_CONFLICT');
  let record;
  try { record = JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { fail('ATLAS_TRANSFER_DESTINATION_CONFLICT'); }
  if (record.schema !== RECEIVE_SCHEMA || record.transferId !== header.transferId ||
      record.workspaceId !== header.workspaceId || record.fileCount !== header.fileCount ||
      record.totalBytes !== header.totalBytes || record.state !== 'complete') fail('ATLAS_TRANSFER_DESTINATION_CONFLICT');
  return true;
}
async function clearLinkedStaging(stage, destination, header) {
  // Remove only our exact staging links; unrelated files keep their directory.
  const directories = new Set();
  for (const item of header.files) {
    const source = join(stage, item.path), target = join(destination, item.path);
    const [from, to] = await Promise.all([statOrNull(source), statOrNull(target)]);
    if (from?.isFile() && to?.isFile() && from.dev === to.dev && from.ino === to.ino)
      await fs.unlink(source).catch(error => { if (error.code !== 'ENOENT') throw error; });
    let path = dirname(source);
    while (path !== stage) { directories.add(path); path = dirname(path); }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length))
    await fs.rmdir(directory).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
  if (!(await statOrNull(stage))) return;
  if (await statOrNull(join(stage, STATE))) {
    await requireState(stage, header);
    await fs.unlink(join(stage, STATE)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await fs.rmdir(stage).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
}

/** Receive exact files into a new workspace. Same-content retries use {resume:true}. */
export async function receiveWorkspaceTransfer(input, directory, options = {}) {
  const destination = absoluteDirectory(directory), parent = dirname(destination);
  await requireDirectory(parent);
  let stage, alreadyReceived = false, written = 0, reused = 0;
  const header = await consumeTransfer(input, options, {
    async header(value) {
      stage = join(parent, `.${basename(destination)}.atlas-incoming-${value.transferId.slice(0, 24)}`);
      const existing = await statOrNull(destination);
      if (existing) {
        if (!options.resume) fail('ATLAS_TRANSFER_DESTINATION_EXISTS');
        await requireState(destination, value);
        alreadyReceived = await completed(destination, value);
      }
      if (alreadyReceived) return;
      await claim(stage, value, Boolean(options.resume));
    },
    async file(item, bytes) {
      if (alreadyReceived) { await exactFile(destination, item); reused++; return; }
      if (await putFile(stage, item.path, bytes)) written++; else reused++;
    },
  });
  if (alreadyReceived) return { ...metadata(header), directory: destination, alreadyReceived: true,
    writtenFiles: 0, reusedFiles: reused, stagingRetained: Boolean(await statOrNull(stage)) };
  await claim(destination, header, Boolean(options.resume));
  // Flush the referenced directory tree before publishing the native root.
  const directories = new Set([destination]);
  const install = async item => {
    await parents(destination, item.path);
    try { await fs.link(join(stage, item.path), join(destination, item.path)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await exactFile(destination, item); }
    let parent = dirname(join(destination, item.path));
    while (parent !== destination) { directories.add(parent); parent = dirname(parent); }
  };
  for (const item of header.files.filter(item => item.path !== 'workspace.json')) await install(item);
  for (const parent of [...directories].sort((a, b) => b.length - a.length)) await syncDirectory(parent);
  await install(header.files.find(item => item.path === 'workspace.json'));
  await syncDirectory(destination);
  if (!(await completed(destination, header)))
    await putFile(destination, COMPLETE, encode({ ...metadata(header), schema: RECEIVE_SCHEMA,
      state: 'complete', receivedAt: new Date().toISOString() }));
  await syncDirectory(destination);
  await clearLinkedStaging(stage, destination, header);
  return { ...metadata(header), directory: destination, alreadyReceived: false,
    writtenFiles: written, reusedFiles: reused, stagingRetained: Boolean(await statOrNull(stage)) };
}
