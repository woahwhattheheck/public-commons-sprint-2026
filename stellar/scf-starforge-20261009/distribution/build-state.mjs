// MIT. Continue one immutable distribution in its original output directory.
import { execFileSync, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, link, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, posix, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'stellar-forge.distribution-build.v1';
const MANIFEST = 'stellar-forge.merchant-distribution-manifest.v1';
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (condition, code, message = code) => {
  if (!condition) throw Object.assign(new Error(message), { code });
};
const missing = error => error.code === 'ENOENT';
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256 = /^[a-f0-9]{64}$/;

async function info(path) {
  try { return await lstat(path); } catch (error) { if (missing(error)) return null; throw error; }
}
async function regular(path, maximum = 4 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= maximum, 'DISTRIBUTION_REGULAR_FILE_REQUIRED', basename(path));
    const bytes = await handle.readFile(), after = await handle.stat(), named = await lstat(path);
    need(before.dev === named.dev && before.ino === named.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes.length === before.size,
    'DISTRIBUTION_FILE_CHANGED', basename(path));
    return bytes;
  } finally { await handle.close(); }
}
async function record(path) {
  try { return JSON.parse(await regular(path)); }
  catch (error) { if (missing(error)) return null; throw error; }
}
async function directory(path, create = false, mode = 0o700) {
  let created = false;
  if (create) {
    try { await mkdir(path, { mode }); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const observed = await lstat(path);
  need(observed.isDirectory() && !observed.isSymbolicLink() && await realpath(path) === path,
    'DISTRIBUTION_REAL_DIRECTORY_REQUIRED', path);
  if (created) await syncDirectory(dirname(path));
}
async function syncDirectory(path) {
  if (process.platform !== 'linux') return;
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

// Retain the same open-description flock pattern used by runtime-install.mjs.
// npm inherits fd3, so an original pack process still owns this output after
// its parent disappears. A PID from another namespace never releases the lock.
async function lease(directory) {
  if (process.platform !== 'linux') return null;
  const path = join(directory, 'build.lock');
  const handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat(), named = await lstat(path);
    need(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) &&
      stat.dev === named.dev && stat.ino === named.ino, 'DISTRIBUTION_PRIVATE_LOCK_REQUIRED');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'],
      { stdio: ['ignore', 'ignore', 'ignore', handle.fd], timeout: 5000 });
    need(!result.error, 'DISTRIBUTION_FLOCK_REQUIRED');
    need(result.status === 0, result.status === 75 ? 'DISTRIBUTION_BUILD_ALREADY_RUNNING' : 'DISTRIBUTION_LOCK_FAILED');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

function validIntent(value) {
  return value?.schema === SCHEMA && OID.test(value.sourceCommit ?? '') &&
    SHA256.test(value.manifestSha256 ?? '') && typeof value.packageName === 'string' &&
    typeof value.packageVersion === 'string' && /^[A-Za-z0-9_.-]+\.tgz$/.test(value.archiveName ?? '');
}

/** Recover the immutable source pin without resolving today's branch tip. */
export async function readDistributionBuildPin(output) {
  const root = resolve(output);
  await directory(root);
  let intent;
  try { intent = await record(join(root, 'build.json')); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  if (intent) {
    need(validIntent(intent), 'DISTRIBUTION_BUILD_RECORD_INVALID');
    return intent;
  }
  let manifest;
  try { manifest = await record(join(root, 'package', 'manifest.json')); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  if (manifest) {
    need(manifest.schema === MANIFEST && OID.test(manifest.sourceCommit ?? ''),
      'DISTRIBUTION_LEGACY_MANIFEST_INVALID');
    return { sourceCommit: manifest.sourceCommit, legacy: true };
  }
  return null;
}

async function archiveIdentity(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat(), hashes = { sha256: createHash('sha256'), sha512: createHash('sha512') };
    need(before.isFile() && before.size > 0 && before.size <= 64 * 1024 * 1024,
      'DISTRIBUTION_ARCHIVE_INVALID');
    const buffer = Buffer.allocUnsafe(256 * 1024); let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      need(bytesRead > 0, 'DISTRIBUTION_ARCHIVE_CHANGED');
      for (const digest of Object.values(hashes)) digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat(), named = await lstat(path);
    need(before.dev === named.dev && before.ino === named.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'DISTRIBUTION_ARCHIVE_CHANGED');
    return { bytes: position, sha256: hashes.sha256.digest('hex'), integrity: 'sha512-' + hashes.sha512.digest('base64') };
  } finally { await handle.close(); }
}
async function completed(root, intent) {
  const receipt = await record(join(root, 'distribution.json'));
  if (!receipt) return null;
  need(receipt.status === 'PACKAGED' && receipt.sourceCommit === intent.sourceCommit &&
    receipt.packageName === intent.packageName && receipt.packageVersion === intent.packageVersion &&
    receipt.archive === join(root, intent.archiveName) && SHA256.test(receipt.sha256 ?? ''),
  'DISTRIBUTION_RECEIPT_CONFLICT');
  const observed = await archiveIdentity(receipt.archive);
  need(observed.sha256 === receipt.sha256 && observed.bytes === receipt.archiveBytes &&
    observed.integrity === receipt.integrity, 'DISTRIBUTION_ARCHIVE_CONFLICT');
  return receipt;
}

/** Return an existing completed operation without reading Git or running npm. */
export async function recoverCompletedDistribution(output, ref) {
  const root = resolve(output), intent = await readDistributionBuildPin(root);
  if (!validIntent(intent)) return null;
  // Symbolic refs require the original resolver to compare the caller's choice.
  if (ref !== undefined && ref !== intent.sourceCommit) return null;
  const owned = await lease(root);
  try { return await completed(root, intent); } finally { await owned?.close(); }
}

/** Read retained progress; this describes files, not whether a process is alive. */
export async function inspectDistributionBuild({ output } = {}) {
  need(typeof output === 'string' && output, 'DISTRIBUTION_OUTPUT_REQUIRED');
  const root = resolve(output), pin = await readDistributionBuildPin(root);
  const receipt = await record(join(root, 'distribution.json'));
  if (receipt) {
    need(receipt.status === 'PACKAGED' && receipt.sourceCommit === pin?.sourceCommit &&
      typeof receipt.archive === 'string' && dirname(receipt.archive) === root &&
      SHA256.test(receipt.sha256 ?? ''), 'DISTRIBUTION_RECEIPT_CONFLICT');
    const archive = await info(receipt.archive);
    need(archive?.isFile() && !archive.isSymbolicLink() && archive.size === receipt.archiveBytes,
      'DISTRIBUTION_ARCHIVE_MISSING_OR_CHANGED');
  }
  const staged = await info(join(root, 'package', 'manifest.json'));
  return { output: root, sourceCommit: pin?.sourceCommit ?? null,
    state: receipt ? 'PACKAGED' : staged ? 'MATERIALIZED' : 'MATERIALIZING',
    packageName: pin?.packageName ?? receipt?.packageName ?? null,
    packageVersion: pin?.packageVersion ?? receipt?.packageVersion ?? null,
    archive: receipt?.archive ?? null, sha256: receipt?.sha256 ?? null,
    resumeRequiresRef: pin === null, legacy: pin?.legacy === true };
}

function relativePath(path) {
  need(typeof path === 'string' && path && !path.startsWith('/') && !path.includes('\\') &&
    !/[\x00-\x1f\x7f]/.test(path) && posix.normalize(path) === path &&
    path.split('/').every(part => part !== '.' && part !== '..' && part !== ''),
  'DISTRIBUTION_PACKAGE_PATH_INVALID');
  return path;
}

async function writeOriginal(root, relative, bytes, mode) {
  const path = join(root, relativePath(relative));
  let folder = root;
  for (const part of relative.split('/').slice(0, -1)) {
    folder = join(folder, part); await directory(folder, true, 0o755);
  }
  let handle, existed = true;
  try { handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW); }
  catch (error) {
    if (!missing(error)) throw error;
    handle = await open(path, 'wx+', mode); existed = false;
  }
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && before.size <= bytes.length,
      'DISTRIBUTION_STAGED_FILE_CONFLICT', relative);
    const prefix = await handle.readFile();
    need(prefix.equals(bytes.subarray(0, prefix.length)) && prefix.length === before.size,
      'DISTRIBUTION_STAGED_FILE_CONFLICT', relative);
    let offset = prefix.length;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
      need(bytesWritten > 0, 'DISTRIBUTION_SHORT_WRITE', relative); offset += bytesWritten;
    }
    if ((before.mode & 0o777) !== mode) await handle.chmod(mode);
    await handle.sync();
    const after = await handle.stat(), named = await lstat(path);
    need(after.size === bytes.length && before.dev === named.dev && before.ino === named.ino,
      'DISTRIBUTION_STAGED_FILE_CHANGED', relative);
    if (!existed) await syncDirectory(dirname(path));
    return { reused: existed && prefix.length === bytes.length,
      resumed: existed && prefix.length < bytes.length, writtenBytes: bytes.length - prefix.length };
  } finally { await handle.close(); }
}

async function inventory(root, expected) {
  const parents = new Set();
  for (const path of expected) {
    let parent = posix.dirname(path);
    while (parent !== '.') { parents.add(parent); parent = posix.dirname(parent); }
  }
  async function visit(relative = '') {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = relative ? relative + '/' + entry.name : entry.name;
      need(!entry.isSymbolicLink(), 'DISTRIBUTION_STAGED_LINK_REJECTED', path);
      if (entry.isDirectory()) {
        need(parents.has(path), 'DISTRIBUTION_UNEXPECTED_STAGE_DIRECTORY', path); await visit(path);
      } else need(entry.isFile() && expected.has(path), 'DISTRIBUTION_UNEXPECTED_STAGE_FILE', path);
    }
  }
  await visit();
}

async function immutableRecord(root, name, value) {
  const bytes = Buffer.from(json(value)), target = join(root, name);
  if (await info(target)) {
    need((await regular(target)).equals(bytes), 'DISTRIBUTION_RECORD_CONFLICT', name); return;
  }
  const temporary = name + '.pending';
  const pending = join(root, temporary);
  if (await info(pending)) {
    // Only this builder's uncommitted record is replaceable; read it first.
    await regular(pending); await unlink(pending);
  }
  await writeOriginal(root, temporary, bytes, 0o600);
  await link(pending, target); await syncDirectory(root);
  await unlink(pending); await syncDirectory(root);
}

/** Materialize and pack one manifest, keeping all mutations under one lease. */
export async function openDistributionBuild({ output, resume = false, manifest, files, onProgress = () => {} }) {
  const root = resolve(output), stage = join(root, 'package'), pack = join(root, 'pack-work');
  need(typeof resume === 'boolean', 'DISTRIBUTION_RESUME_BOOLEAN_REQUIRED');
  need(!resume || process.platform === 'linux', 'DISTRIBUTION_RESUME_LINUX_REQUIRED');
  const archiveName = manifest.packageName.replace(/^@/, '').replace('/', '-') + '-' + manifest.packageVersion + '.tgz';
  const intent = { schema: SCHEMA, sourceCommit: manifest.sourceCommit, packageName: manifest.packageName,
    packageVersion: manifest.packageVersion, manifestSha256: hash(Buffer.from(json(manifest))), archiveName };
  need(validIntent(intent), 'DISTRIBUTION_BUILD_INTENT_INVALID');
  if (resume) await directory(root);
  else { await mkdir(root, { mode: 0o700 }); await directory(root); await syncDirectory(dirname(root)); }
  const owned = await lease(root);
  try {
    const allowed = new Set(['build.lock', 'build.json', 'package', 'pack-work', archiveName,
      'distribution.json', 'distribution.json.pending']);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      need(allowed.has(entry.name) && !entry.isSymbolicLink() &&
        (['package', 'pack-work'].includes(entry.name) ? entry.isDirectory() : entry.isFile()),
      'DISTRIBUTION_UNEXPECTED_OUTPUT', entry.name);
    }
    const expected = new Set(files.map(file => relativePath(file.path)));
    need(expected.size === files.length, 'DISTRIBUTION_DUPLICATE_PACKAGE_FILE');
    if (await info(stage)) await inventory(stage, expected);
    await writeOriginal(root, 'build.json', Buffer.from(json(intent)), 0o600);
    await directory(stage, true); await directory(pack, true);
    return {
      async completed() { return completed(root, intent); },
      async materialize() {
        const result = { copiedFiles: 0, resumedFiles: 0, reusedFiles: 0, writtenBytes: 0 };
        for (const [index, file] of files.entries()) {
          const outcome = await writeOriginal(stage, file.path, file.bytes, file.mode);
          result[outcome.reused ? 'reusedFiles' : outcome.resumed ? 'resumedFiles' : 'copiedFiles']++;
          result.writtenBytes += outcome.writtenBytes;
          if ((index + 1) % 64 === 0 || index === files.length - 1)
            onProgress('materialized', { files: index + 1, totalFiles: files.length, ...result });
        }
        await syncDirectory(stage); return result;
      },
      async pack({ npm = process.platform === 'win32' ? 'npm.cmd' : 'npm', python = 'python3' } = {}) {
        const candidate = join(pack, archiveName), published = join(root, archiveName);
        const installedBytes = files.reduce((total, file) => total + file.bytes.length, 0);
        for (const entry of await readdir(pack, { withFileTypes: true }))
          need([archiveName, 'pack.json', 'pack.json.pending', 'failed-pack.json', 'failed-pack.json.pending'].includes(entry.name) &&
            entry.isFile() && !entry.isSymbolicLink(), 'DISTRIBUTION_UNEXPECTED_PACK_FILE', entry.name);
        let observed, reused = false;
        const retained = await record(join(pack, 'pack.json'));
        const existing = await info(published) ? published : await info(candidate) ? candidate : null;
        if (existing) {
          try {
            observed = await archiveIdentity(existing);
            if (retained) need(retained.sourceCommit === intent.sourceCommit &&
              retained.manifestSha256 === intent.manifestSha256 && retained.sha256 === observed.sha256 &&
              retained.integrity === observed.integrity && retained.size === observed.bytes &&
              retained.unpackedSize === installedBytes, 'DISTRIBUTION_PACK_RECORD_CONFLICT');
            else {
              // Parent loss may leave npm's complete archive before its JSON is
              // retained. Reuse the original release reader against this exact
              // manifest and stage; no extraction or replacement package occurs.
              const result = JSON.parse(execFileSync(python, [fileURLToPath(new URL('./runtime-unpack.py', import.meta.url)),
                '--archive', existing, '--sha256', observed.sha256, '--out', stage, '--verify'],
              { encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
              need(result.sourceCommit === intent.sourceCommit && result.manifestSha256 === intent.manifestSha256,
                'DISTRIBUTION_PACK_SOURCE_CONFLICT');
            }
            reused = true;
          } catch (error) {
            // A final archive or an already acknowledged pack is retained on
            // conflict. Only an incomplete unacknowledged private npm output
            // belongs to the resumed build's replaceable work area.
            const truncated = error.status === 1 && /EOFError|end-of-stream marker|unexpected end of data|empty file|truncated header/.test(String(error.stderr ?? ''));
            const empty = error.code === 'DISTRIBUTION_ARCHIVE_INVALID' && (await info(candidate))?.size === 0;
            if (existing === published || retained || !(truncated || empty)) throw error;
            const stat = await lstat(candidate);
            need(stat.isFile() && stat.nlink === 1 && !stat.isSymbolicLink(), 'DISTRIBUTION_PACK_FILE_CONFLICT');
            await regular(candidate, 64 * 1024 * 1024);
            if (!(await info(join(pack, 'failed-pack.json'))))
              await immutableRecord(pack, 'failed-pack.json', { sourceCommit: intent.sourceCommit,
                bytes: stat.size, sha256: observed?.sha256 ?? null, reason: 'INCOMPLETE_UNACKNOWLEDGED_NPM_OUTPUT' });
            await unlink(candidate); await syncDirectory(pack); observed = null;
            onProgress('pack-recovery', { discardedPartialBytes: stat.size });
          }
        }
        if (!observed) {
          need(!retained, 'DISTRIBUTION_ACKNOWLEDGED_ARCHIVE_MISSING');
          onProgress('packing', { files: files.length });
          const packed = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', pack],
            { cwd: stage, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
              stdio: ['ignore', 'pipe', 'pipe', ...(owned ? [owned.fd] : [])] }));
          need(Array.isArray(packed) && packed.length === 1 && packed[0]?.filename === archiveName,
            'DISTRIBUTION_NPM_RESULT_INVALID');
          observed = await archiveIdentity(candidate);
          need(packed[0].size === observed.bytes && packed[0].integrity === observed.integrity &&
            packed[0].unpackedSize === installedBytes, 'DISTRIBUTION_NPM_ARCHIVE_MISMATCH');
        }
        await immutableRecord(pack, 'pack.json', { sourceCommit: intent.sourceCommit, manifestSha256: intent.manifestSha256,
          filename: archiveName, sha256: observed.sha256, integrity: observed.integrity,
          size: observed.bytes, unpackedSize: installedBytes });
        if (!(await info(published))) { await link(candidate, published); await syncDirectory(root); }
        const final = await archiveIdentity(published);
        need(final.sha256 === observed.sha256, 'DISTRIBUTION_FINAL_ARCHIVE_CONFLICT');
        return { archive: published, sha256: final.sha256, integrity: final.integrity,
          archiveBytes: final.bytes, installedBytes, reusedArchive: reused };
      },
      async complete(receipt) { await immutableRecord(root, 'distribution.json', receipt); },
      async close() { await owned?.close(); },
    };
  } catch (error) { await owned?.close(); throw error; }
}
