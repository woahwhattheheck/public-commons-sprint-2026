// MIT. Original Console immutable file publication, shared by online and offline consumers.
import { open, link, unlink, realpath, lstat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { privateSupportDirectory } from '../host-files.mjs';
import { digest, fail } from './records.mjs';

const privateError = () => fail('OPENAPI_WORKFLOW_FILE', 'Select a private regular output file in an existing private directory.', 400);
async function recoverCompletedLink(path, handle, info) {
  const parent = dirname(path), prefix = '.' + basename(path) + '.pending-';
  const matches = [];
  for (const name of await readdir(parent)) {
    if (!name.startsWith(prefix) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name.slice(prefix.length))) continue;
    const candidate = join(parent, name);
    let current; try { current = await lstat(candidate); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (current.dev === info.dev && current.ino === info.ino) matches.push(candidate);
  }
  const final = await lstat(path), current = await handle.stat();
  if (!final.isFile() || final.isSymbolicLink() || final.dev !== info.dev || final.ino !== info.ino) throw privateError();
  if (current.nlink === 1) return;
  if (current.nlink !== 2 || matches.length !== 1) throw privateError();
  const pending = matches[0], owned = await lstat(pending).catch(error => {
    if (error.code === 'ENOENT') return null; throw error;
  });
  if (!owned) { if ((await handle.stat()).nlink === 1) return; throw privateError(); }
  if (!owned.isFile() || owned.isSymbolicLink() || owned.dev !== info.dev || owned.ino !== info.ino ||
      process.platform !== 'win32' && (owned.mode & 0o077)) throw privateError();
  const directory = await open(parent, constants.O_RDONLY);
  try {
    await directory.sync();
    const selected = await lstat(pending).catch(error => {
      if (error.code === 'ENOENT') return null; throw error;
    });
    if (selected) {
      if (selected.dev !== info.dev || selected.ino !== info.ino) throw privateError();
      await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await directory.sync();
  } finally { await directory.close(); }
  if ((await handle.stat()).nlink !== 1) throw privateError();
}
async function fileHash(path, expected) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || ![1, 2].includes(info.nlink) || process.platform !== 'win32' && (info.mode & 0o077) ||
        process.getuid && info.uid !== process.getuid()) throw privateError();
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let bytes = 0;
    while (bytes < info.size) {
      const read = await handle.read(buffer, 0, Math.min(buffer.length, info.size - bytes), bytes);
      if (!read.bytesRead) throw privateError();
      hash.update(buffer.subarray(0, read.bytesRead)); bytes += read.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw privateError();
    const result = { bytes, sha256: hash.digest('hex') };
    if (expected.bytes === result.bytes && expected.sha256 === result.sha256 && after.nlink === 2)
      await recoverCompletedLink(path, handle, info);
    return result;
  } finally { await handle.close(); }
}
/** Publish one complete output only after its original bytes have been synced. */
async function retainOutput(path, write) {
  path = resolve(path);
  const parent = dirname(path);
  await privateSupportDirectory(parent);
  if (await realpath(parent) !== parent) throw privateError();
  const temporary = join(parent, '.' + basename(path) + '.pending-' + randomUUID());
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  let summary;
  try {
    summary = await write(handle);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error;
  }
  await handle.close();
  let state = 'SAVED';
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const original = await fileHash(path, summary);
      if (original.bytes !== summary.bytes || original.sha256 !== summary.sha256)
        throw fail('OPENAPI_WORKFLOW_OUTPUT_CONFLICT', 'This output name retains different complete bytes. Choose another name.', 409);
      state = 'REOPENED';
    }
    const directory = await open(parent, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary).catch(() => {}); }
  return { state, path, ...summary };
}
// Shared receiving uses this original atomic stream writer and completed-file reader.
export { retainOutput as writeConsoleWorkflowStream, fileHash as inspectConsoleWorkflowFile };
export async function writeConsoleWorkflowFile(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value) : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return retainOutput(path, async handle => { await handle.writeFile(bytes); return { bytes: bytes.length, sha256: digest(bytes) }; });
}
