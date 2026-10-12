// MIT. Filesystem selections for the original Study operator and retained agent files.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, readdir, access, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUDY_HERE = dirname(fileURLToPath(import.meta.url));
export const STUDY_MAX_PACKET_BYTES = 512 * 1024 * 1024;
export const STUDY_MAX_JSON_BYTES = 64 * 1024 * 1024;
export const STUDY_REQUEST_BYTES = 4 * 1024 * 1024;
export const STUDY_CHUNK_BYTES = 65536;
export const STUDY_SELECTION_SCHEMA = 'stellar-forge.study-operator-selection.v1';
export const STUDY_INSTANCE_SCHEMA = 'stellar-forge.study-operator-instance.v1';
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const failure = (code, message, details = {}) => Object.assign(new Error(message), {code, ...details});
export const need = (test, code, message, details) => { if (!test) throw failure(code, message, details); };
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const decode = bytes => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
export function ordered(value) {
  return Array.isArray(value) ? value.map(ordered) : plain(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
}
export const canonical = value => JSON.stringify(ordered(value));
export const json = value => Buffer.from(JSON.stringify(value) + '\n');
export function exact(value, allowed, required = []) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'STUDY_ARGUMENTS_INVALID',
    'Supply the declared fields, including every required field.');
}
export function identifier(value) {
  need(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value), 'STUDY_ALIAS_INVALID',
    'Choose a declared alias of 1–64 lowercase letters, digits, underscores or hyphens.'); return value;
}
export function sha(value) {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'STUDY_SHA256_REQUIRED',
    'Use the exact retained SHA256.'); return value;
}
export function integer(value, maximum, minimum = 0) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'STUDY_INTEGER_INVALID',
    'Use an integer within the declared range.'); return value;
}
export function text(value, maximum = 2000, empty = false) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\0') &&
    (empty || value.trim()), 'STUDY_TEXT_INVALID', 'Use text within the declared bound.'); return value;
}
export function absolute(value, base) {
  text(value, 4096);
  need(base !== undefined || isAbsolute(value), 'STUDY_ABSOLUTE_PATH_REQUIRED', 'Host selections use absolute paths.');
  return resolve(base ?? '', value);
}
export async function privateDirectory(filename, create = false) {
  filename = absolute(filename);
  if (create) await mkdir(filename, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(filename);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (!process.getuid || info.uid === process.getuid()) && await realpath(filename) === filename,
  'STUDY_PRIVATE_DIRECTORY_REQUIRED', 'Use an owned private directory without symlink traversal.');
  return filename;
}
const same = (a, b) => ['dev','ino','size','mtimeNs','ctimeNs'].every(key => a[key] === b[key]);
export async function fileHandle(filename, maximum = STUDY_MAX_PACKET_BYTES, privateOnly = false) {
  filename = absolute(filename);
  need(await realpath(filename) === filename, 'STUDY_ORIGINAL_PATH_REQUIRED', 'Select the original file without symlink traversal.');
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat({bigint:true});
    need(stat.isFile() && stat.size <= BigInt(maximum), 'STUDY_REGULAR_FILE_REQUIRED',
      'Select a complete regular file within its original size limit.');
    if (privateOnly) need(stat.nlink === 1n && !(stat.mode & 0o077n) &&
      (!process.getuid || stat.uid === BigInt(process.getuid())), 'STUDY_PRIVATE_FILE_REQUIRED',
    'Keep the original connection or retained file private and owned by its operator.');
    return {handle, stat, path:filename, bytes:Number(stat.size)};
  } catch (error) { await handle.close(); throw error; }
}
export async function verifyHandle(original, expected) {
  const digest = createHash('sha256'), buffer = Buffer.alloc(STUDY_CHUNK_BYTES); let offset = 0;
  while (offset < original.bytes) {
    const read = await original.handle.read(buffer, 0, Math.min(buffer.length, original.bytes - offset), offset);
    need(read.bytesRead > 0, 'STUDY_FILE_CHANGED', 'The original file ended before its recorded length.');
    digest.update(buffer.subarray(0, read.bytesRead)); offset += read.bytesRead;
  }
  need(same(original.stat, await original.handle.stat({bigint:true})), 'STUDY_FILE_CHANGED',
    'The original file changed during verification.');
  const sha256 = digest.digest('hex');
  if (expected !== undefined) need(sha256 === sha(expected), 'STUDY_FILE_CHANGED', 'The original file differs from the selected SHA256.');
  return {sha256, bytes:offset};
}
export async function readFile(filename, maximum = STUDY_MAX_JSON_BYTES, privateOnly = false) {
  const original = await fileHandle(filename, maximum, privateOnly);
  try {
    const bytes = await original.handle.readFile();
    need(bytes.length === original.bytes && same(original.stat, await original.handle.stat({bigint:true})),
      'STUDY_FILE_CHANGED', 'The original file changed during its read.');
    return bytes;
  } finally { await original.handle.close(); }
}
export async function fileIdentity(filename, maximum = STUDY_MAX_PACKET_BYTES, privateOnly = false) {
  const original = await fileHandle(filename, maximum, privateOnly);
  try { return await verifyHandle(original); } finally { await original.handle.close(); }
}
export async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function immutable(filename, bytes) {
  const temporary = join(dirname(filename), '.new-' + randomUUID()), handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await link(temporary, filename); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readFile(filename, Math.max(bytes.length, STUDY_MAX_JSON_BYTES), true);
      need(previous.equals(bytes), 'STUDY_RETAINED_CONFLICT', 'This retained identity already has different original bytes.');
    }
    await syncDirectory(dirname(filename));
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function sourceSelection(directory) {
  directory = absolute(directory);
  const sourceDirectory = await realpath(STUDY_HERE), sources = {};
  const skip = new Set(['__pycache__','node_modules','examples','test','tests']);
  const suffixes = new Set(['.py','.mjs','.js','.html','.css']);
  async function visit(path, prefix = '') {
    for (const entry of (await readdir(path, {withFileTypes:true})).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      const filename = join(path, entry.name), name = prefix + entry.name;
      if (entry.isDirectory()) await visit(filename, name + '/');
      else if (entry.isSymbolicLink()) need(false, 'STUDY_SOURCE_SYMLINK', 'The original application source has a symlink.');
      else if (suffixes.has(extname(entry.name))) sources[name] = hash(await readFile(filename, 8 * 1024 * 1024));
    }
  }
  await visit(sourceDirectory);
  for (const name of ['server.py','application.py','workspace.py','operator_runtime.py'])
    need(Object.hasOwn(sources,name), 'STUDY_SOURCE_INCOMPLETE', 'The original Study application is incomplete.');
  const selection = {schema:STUDY_SELECTION_SCHEMA, workspace_directory:directory,
    source_directory:sourceDirectory, source_files:ordered(sources)};
  return {selection, selectionSha256:hash(Buffer.from(canonical(selection))),
    sourceSha256:hash(Buffer.from(canonical(sources)))};
}
export async function inspectStudyBinding(input) {
  exact(input, ['directory','pythonExecutable','allowStart','label'], ['directory']);
  const directory = absolute(input.directory);
  try { await privateDirectory(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await privateDirectory(dirname(directory)); }
  const pythonExecutable = absolute(input.pythonExecutable ?? process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? '/usr/bin/python3');
  await access(pythonExecutable, constants.X_OK);
  if (input.allowStart !== undefined) need(typeof input.allowStart === 'boolean', 'STUDY_CONFIGURATION_INVALID',
    'allowStart is an explicit host boolean.');
  return {directory, pythonExecutable, pythonRealpath:await realpath(pythonExecutable),
    allowStart:input.allowStart === true, label:text(input.label ?? 'Study workspace', 240),
    ...await sourceSelection(directory)};
}
