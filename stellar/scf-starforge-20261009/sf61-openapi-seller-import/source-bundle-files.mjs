// MIT. Private local-file capture and portable extraction for the source graph.
import { openSync, closeSync, fstatSync, realpathSync, lstatSync,
  mkdirSync, writeFileSync, fsyncSync, linkSync, unlinkSync, constants } from 'node:fs';
import { resolve, relative, dirname, join, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSourceBundle, openSourceBundle, SOURCE_BUNDLE_LIMIT,
  sourceBundleDigest, sourceBundlePath } from './source-bundle.mjs';
import { parseOpenApiValue } from './source-value.mjs';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`); error.code = code; throw error;
}
function within(root, path) {
  const tail = relative(root, path);
  return tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail);
}
function identity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function utf8(bytes, label) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('OPENAPI_SOURCE_ENCODING', label + ' must contain valid UTF-8'); }
}
function syncDirectory(path) {
  // Directory fsync is supported on the original POSIX operator hosts.
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function regularBytes(path, limit = SOURCE_BUNDLE_LIMIT) {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(limit))
    fail('OPENAPI_SOURCE_FILE', 'Use a regular file of at most ' + limit + ' bytes: ' + path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || identity(before) !== identity(opened)) fail('OPENAPI_SOURCE_CHANGED', 'File changed while opening: ' + path);
    // Allocate a fixed bound rather than readFileSync's unbounded growing-file path.
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = requireRead(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== bytes.length || identity(opened) !== identity(fstatSync(fd, { bigint: true })))
      fail('OPENAPI_SOURCE_CHANGED', 'File changed while reading: ' + path);
    return bytes;
  } finally { closeSync(fd); }
}
// Imported separately to keep the fixed-length read visible at the call site.
import { readSync as requireRead } from 'node:fs';

/** Capture only entry/referenced files, rejecting source-root escape and symlinks. */
export function captureSourceBundle({ root, entry }) {
  if (typeof root !== 'string' || !root || typeof entry !== 'string' || !entry)
    throw new TypeError('Supply root and entry paths');
  const declaredRoot = resolve(root), physicalRoot = realpathSync(declaredRoot);
  if (!lstatSync(physicalRoot).isDirectory()) fail('OPENAPI_SOURCE_ROOT', 'Select a source directory');
  const entryPath = resolve(declaredRoot, entry);
  if (!within(declaredRoot, entryPath)) fail('OPENAPI_SOURCE_SCOPE', 'Entry is outside the selected source root');
  const name = sourceBundlePath(relative(declaredRoot, entryPath).split(sep).join('/'));
  const observed = new Map();
  function readSource(path) {
    sourceBundlePath(path);
    let selected = physicalRoot;
    for (const part of path.split('/')) {
      selected = join(selected, part);
      const stat = lstatSync(selected);
      if (stat.isSymbolicLink()) fail('OPENAPI_SOURCE_SYMLINK', 'Source paths must not contain symlinks: ' + path);
    }
    const actual = realpathSync(selected);
    if (!within(physicalRoot, actual)) fail('OPENAPI_SOURCE_SCOPE', 'Source reference escapes the selected root: ' + path);
    const fd = openSync(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes;
    try {
      // Linux checks the opened inode's real location, covering ancestor swaps
      // between the lexical checks and open. Other hosts repeat realpath below.
      const openedPath = process.platform === 'linux' ? realpathSync('/proc/self/fd/' + fd) : realpathSync(selected);
      if (!within(physicalRoot, openedPath)) fail('OPENAPI_SOURCE_SCOPE', 'Opened source is outside the selected root: ' + path);
      const before = fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.size > BigInt(SOURCE_BUNDLE_LIMIT))
        fail('OPENAPI_SOURCE_FILE', 'Source is not a regular file up to 4 MiB: ' + path);
      bytes = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < bytes.length) {
        const count = requireRead(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) break;
        offset += count;
      }
      if (offset !== bytes.length || identity(before) !== identity(fstatSync(fd, { bigint: true })) ||
          realpathSync(selected) !== actual)
        fail('OPENAPI_SOURCE_CHANGED', 'Source changed during capture: ' + path);
    } finally { closeSync(fd); }
    return utf8(bytes, path);
  }
  const result = createSourceBundle({ entry: name, readSource: path => {
    const text = readSource(path); observed.set(path, sourceBundleDigest(text)); return text;
  } });
  // Ensure every retained file still matches after the entire graph was read.
  for (const [path, expected] of observed) {
    if (sourceBundleDigest(readSource(path)) !== expected)
      fail('OPENAPI_SOURCE_CHANGED', 'Source changed before capture completed: ' + path);
  }
  return result;
}

/** Publish complete bytes without replacing any existing file, even on a race. */
export function writeSourceFile(path, bytes) {
  path = resolve(path); bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const parent = dirname(path), temporary = join(parent, '.starforge-source-' + randomUUID());
  let fd, created = false;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    created = true;
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    try { linkSync(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (process.platform !== 'win32' && (lstatSync(path).mode & 0o077) !== 0)
        fail('OPENAPI_SOURCE_PRIVATE_OUTPUT', 'Existing source output must have private permissions: ' + path);
      const existing = regularBytes(path, Math.max(bytes.length, SOURCE_BUNDLE_LIMIT));
      if (!existing.equals(bytes)) fail('OPENAPI_SOURCE_DESTINATION_EXISTS', 'Existing output has different bytes: ' + path);
      return { path, bytes: bytes.length, sha256: sourceBundleDigest(bytes), reused: true };
    }
    syncDirectory(parent);
    return { path, bytes: bytes.length, sha256: sourceBundleDigest(bytes), reused: false };
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (created) { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}

export function saveSourceBundle({ root, entry, out }) {
  const captured = captureSourceBundle({ root, entry });
  return { ...writeSourceFile(out, captured.text), ...captured.summary };
}

export function readSourceBundle(path) {
  const bytes = regularBytes(resolve(path));
  const parsed = parseOpenApiValue(utf8(bytes, path));
  return { ...openSourceBundle(parsed.value), originalBytes: bytes };
}

/** Restore into a fresh private directory. A repeated complete restore reopens it. */
export function extractSourceBundle({ bundle: input, out }) {
  const opened = readSourceBundle(input), folder = resolve(out);
  const packetPath = join(folder, 'source-bundle.json');
  const sourceRoot = join(folder, 'sources');
  let reused = false;
  try { mkdirSync(folder, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) throw error;
    const previous = readSourceBundle(packetPath);
    if (!previous.originalBytes.equals(opened.originalBytes))
      fail('OPENAPI_SOURCE_DESTINATION_EXISTS', 'Existing extraction belongs to another source packet');
    reused = true;
  }
  const ensureDirectories = path => {
    let current = folder;
    for (const part of relative(folder, path).split(sep).filter(Boolean)) {
      current = join(current, part);
      if (!reused) { try { mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('OPENAPI_SOURCE_DESTINATION', 'Unexpected extraction directory: ' + current);
    }
  };
  ensureDirectories(sourceRoot);
  for (const row of opened.bundle.sources) {
    const path = join(sourceRoot, ...sourceBundlePath(row.path).split('/'));
    ensureDirectories(dirname(path));
    if (reused) {
      if (!regularBytes(path).equals(Buffer.from(row.text)))
        fail('OPENAPI_SOURCE_DESTINATION_CHANGED', 'Extracted source has changed: ' + row.path);
    } else writeSourceFile(path, row.text);
  }
  // Completion is published last. Incomplete output stays separate from sources.
  if (!reused) writeSourceFile(packetPath, opened.originalBytes);
  syncDirectory(folder);
  return { directory: folder, sourceRoot, entry: join(sourceRoot, ...opened.bundle.entry.split('/')),
    packet: packetPath, sourceDigest: opened.bundle.sourceDigest,
    files: opened.bundle.sources.length, reused };
}
