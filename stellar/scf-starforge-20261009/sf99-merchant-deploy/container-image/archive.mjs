// MIT. Read the original merchant distribution without executing package code.
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';

const MAX_ARCHIVE = 512 * 1024 * 1024;
const MAX_EXPANDED = 1024 * 1024 * 1024;
const MAX_METADATA = 16 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const need = (yes, message) => { if (!yes) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const text = bytes => utf8.decode(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)));
function octal(bytes, field) {
  const value = text(bytes).trim();
  need(/^[0-7]*$/.test(value), 'Unsupported TAR ' + field);
  const result = value ? parseInt(value, 8) : 0;
  need(Number.isSafeInteger(result) && result >= 0, 'Invalid TAR ' + field);
  return result;
}
function member(value, directory = false) {
  if (directory) value = value.replace(/\/$/, '');
  need(typeof value === 'string' && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(value) &&
    (value === 'package' || value.startsWith('package/')) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid distribution member path');
  return value;
}
function pax(bytes) {
  const result = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    need(space > offset && space - offset < 12, 'Invalid PAX record');
    const lengthText = bytes.subarray(offset, space).toString('ascii');
    need(/^[1-9][0-9]*$/.test(lengthText), 'Invalid PAX length');
    const length = Number(lengthText), end = offset + length;
    need(end <= bytes.length && end > space + 2 && bytes[end - 1] === 10, 'Truncated PAX record');
    const line = utf8.decode(bytes.subarray(space + 1, end - 1));
    const equals = line.indexOf('=');
    need(equals > 0, 'Invalid PAX field');
    const key = line.slice(0, equals), value = line.slice(equals + 1);
    need(!Object.hasOwn(result, key), 'Duplicate PAX field');
    // Time/ownership metadata do not alter file bytes or paths. Link/sparse/size
    // extensions are outside the original source archive contract.
    need(['path','mtime','atime','ctime','uid','gid','uname','gname','comment'].includes(key),
      'Unsupported PAX field: ' + key);
    result[key] = value; offset = end;
  }
  return result;
}

/** Streaming TAR scan. Extraction writes only regular source files to a new root. */
async function scanArchive(archive, expectedSha256, sourceRoot = null) {
  need(hex(expectedSha256), 'Expected original distribution SHA256 is required');
  const info = await lstat(archive);
  need(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= MAX_ARCHIVE,
    'Use a regular original distribution archive up to 512 MiB');
  const compressedHash = createHash('sha256');
  const input = createReadStream(archive), unzip = createGunzip();
  input.on('data', chunk => compressedHash.update(chunk));
  input.on('error', error => unzip.destroy(error));
  input.pipe(unzip);
  const iterator = unzip[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0), ended = false, expanded = 0, zeroBlocks = 0;
  let extended = null, longName = null;
  const records = new Map(), metadata = new Map();
  async function read(length, allowEnd = false) {
    while (pending.length < length && !ended) {
      const next = await iterator.next();
      if (next.done) ended = true;
      else {
        expanded += next.value.length;
        need(expanded <= MAX_EXPANDED, 'Distribution expands beyond 1 GiB');
        pending = pending.length ? Buffer.concat([pending, next.value]) : next.value;
      }
    }
    if (allowEnd && pending.length === 0 && ended) return null;
    need(pending.length >= length, 'Truncated distribution archive');
    const bytes = pending.subarray(0, length); pending = pending.subarray(length);
    return bytes;
  }
  try {
    for (;;) {
      const header = await read(512, true);
      if (header === null) break;
      if (header.every(value => value === 0)) { zeroBlocks++; continue; }
      need(zeroBlocks === 0, 'Nonzero data follows the TAR end marker');
      const expected = octal(header.subarray(148, 156), 'checksum');
      let checksum = 0;
      for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
      need(checksum === expected, 'Distribution TAR checksum does not match');
      const size = octal(header.subarray(124, 136), 'size');
      need(size <= MAX_EXPANDED, 'Distribution member is too large');
      const mode = octal(header.subarray(100, 108), 'mode');
      const type = String.fromCharCode(header[156] || 48);
      let name = text(header.subarray(0, 100));
      const prefix = text(header.subarray(345, 500));
      if (prefix && text(header.subarray(257, 263)).startsWith('ustar')) name = prefix + '/' + name;
      if (['x','g','L'].includes(type)) {
        need(size <= MAX_METADATA, 'Archive extension is too large');
        const value = await read(size);
        await read((512 - size % 512) % 512);
        if (type === 'L') { need(longName === null, 'Duplicate long-name header'); longName = text(value); }
        else {
          const fields = pax(value);
          if (type === 'g') need(fields.path === undefined, 'Global PAX path is unsupported');
          else { need(extended === null, 'Duplicate PAX header'); extended = fields; }
        }
        continue;
      }
      need(['0','5'].includes(type), 'Distribution must contain only regular files and directories');
      need(!(longName && extended?.path), 'Conflicting archive member paths');
      name = member(extended?.path ?? longName ?? name, type === '5');
      extended = null; longName = null;
      need(!records.has(name), 'Duplicate distribution member: ' + name);
      if (type === '5') { need(size === 0, 'Directory has data'); records.set(name, { directory: true }); continue; }
      need(name !== 'package', 'Package root must be a directory');
      const sha256 = createHash('sha256'), gitBlob = createHash('sha1').update('blob ' + size + '\0');
      const keep = ['package/manifest.json','package/package.json',
        'package/source/stellar/scf-starforge-20261009/distribution/distribution.json'].includes(name);
      need(!keep || size <= MAX_METADATA, 'Distribution metadata is too large');
      const pieces = [];
      let file = null;
      if (sourceRoot && name.startsWith('package/source/')) {
        const target = join(sourceRoot, name.slice('package/source/'.length));
        await mkdir(dirname(target), { recursive: true, mode: 0o755 });
        file = await open(target, 'wx', mode & 0o111 ? 0o755 : 0o644);
      }
      try {
        for (let remaining = size; remaining > 0;) {
          const bytes = await read(Math.min(64 * 1024, remaining)); remaining -= bytes.length;
          sha256.update(bytes); gitBlob.update(bytes);
          if (keep) pieces.push(bytes);
          if (file) await file.writeFile(bytes);
        }
      } finally { await file?.close(); }
      await read((512 - size % 512) % 512);
      const record = { bytes: size, sha256: sha256.digest('hex'), gitBlob: gitBlob.digest('hex'), mode };
      records.set(name, record);
      if (keep) metadata.set(name, Buffer.concat(pieces));
      need(records.size <= 50000, 'Distribution has too many members');
    }
    need(zeroBlocks >= 2 && !extended && !longName, 'Original TAR end marker is missing');
    const archiveSha256 = compressedHash.digest('hex');
    need(archiveSha256 === expectedSha256, 'Distribution archive SHA256 does not match the selected release');
    const manifest = JSON.parse(utf8.decode(metadata.get('package/manifest.json') ?? Buffer.alloc(0)));
    const packageJson = JSON.parse(utf8.decode(metadata.get('package/package.json') ?? Buffer.alloc(0)));
    need(manifest.schema === 'stellar-forge.merchant-distribution-manifest.v1' &&
      manifest.packageName === '@tokenjunkielabs/starforge-merchant' && /^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? '') &&
      packageJson.name === manifest.packageName && packageJson.version === manifest.packageVersion &&
      Array.isArray(manifest.files) && manifest.files.length > 0 && object(manifest.packageFiles),
      'Original maintained merchant distribution manifest is required');
    const expectedPaths = new Set(['package/manifest.json']);
    let sourceBytes = 0;
    for (const file of manifest.files) {
      need(object(file) && file.packagePath === 'source/' + file.path && hex(file.sha256) &&
        /^[a-f0-9]{40}$/.test(file.gitBlob ?? '') && Number.isSafeInteger(file.bytes) && file.bytes >= 0,
        'Invalid original source file record');
      const path = member('package/' + file.packagePath);
      need(!expectedPaths.has(path), 'Duplicate source manifest member'); expectedPaths.add(path);
      const actual = records.get(path);
      need(actual && !actual.directory && actual.bytes === file.bytes && actual.sha256 === file.sha256 &&
        actual.gitBlob === file.gitBlob, 'Original source bytes differ: ' + file.path);
      sourceBytes += actual.bytes;
    }
    for (const [path, expected] of Object.entries(manifest.packageFiles)) {
      need(['package.json','README.md','LICENSE'].includes(path) && hex(expected), 'Invalid original package metadata record');
      const name = 'package/' + path; expectedPaths.add(name);
      need(records.get(name)?.sha256 === expected, 'Original package metadata differs: ' + path);
    }
    need(expectedPaths.has('package/package.json') && sourceBytes === manifest.sourceBytes,
      'Incomplete original distribution manifest');
    for (const [path, record] of records) if (!record.directory)
      need(expectedPaths.has(path), 'Unlisted file in original distribution: ' + path);
    const distributionSpec = JSON.parse(utf8.decode(metadata.get(
      'package/source/stellar/scf-starforge-20261009/distribution/distribution.json') ?? Buffer.alloc(0)));
    need(distributionSpec.schema === 'stellar-forge.merchant-distribution.v1', 'Original distribution specification is missing');
    return { manifest, packageJson, distributionSpec, archiveSha256, archiveBytes: info.size,
      sourceBytes, sourceFiles: manifest.files.length,
      manifestSha256: digest(metadata.get('package/manifest.json')) };
  } finally { input.destroy(); unzip.destroy(); }
}

export async function inspectDistribution(archive, sha256) { return await scanArchive(archive, sha256); }

/** Used in the generated build: preserve all source bytes in a fresh image directory. */
export async function installDistribution(archive, sha256, sourceRoot) {
  await mkdir(sourceRoot, { mode: 0o755 });
  try { return await scanArchive(archive, sha256, sourceRoot); }
  catch (error) { await rm(sourceRoot, { recursive: true, force: true }); throw error; }
}
