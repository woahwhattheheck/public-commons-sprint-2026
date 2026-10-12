// MIT. Pinned SSH transport and immutable captures of complete remote file bytes.
import { constants, createReadStream } from 'node:fs';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { join, posix, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail, relativePath } from './config.mjs';
import { privateDirectory, acquireWorkspace, atomicJson, createFile, readJson, syncDirectory, identity } from '../postgres/publisher/files.mjs';

const stamp = () => new Date().toISOString();
const fingerprint = raw => 'SHA256:' + createHash('sha256').update(raw).digest('base64').replace(/=+$/, '');
const same = (a, b) => ['size', 'mtime', 'mode', 'uid', 'gid'].every(key => a[key] === b[key]);
const inside = (root, file) => root === '/' ? file.startsWith('/') : file === root || file.startsWith(root + '/');
function attributes(value) {
  if (!Number.isSafeInteger(value?.size) || value.size < 0 || !Number.isSafeInteger(value.mtime) || value.mtime < 0 ||
      !Number.isSafeInteger(value.mode)) throw fail('SFTP_REMOTE_ATTRIBUTES_INVALID');
  return { size: value.size, mtime: value.mtime, modifiedAt: new Date(value.mtime * 1000).toISOString(), mode: value.mode,
    ...(value.uid === undefined ? {} : { uid: value.uid }), ...(value.gid === undefined ? {} : { gid: value.gid }) };
}
function remoteType(mode) {
  return (mode & 0o170000) === 0o100000 ? 'file' : (mode & 0o170000) === 0o040000 ? 'directory' :
    (mode & 0o170000) === 0o120000 ? 'symlink' : 'other';
}
function transportIssue(issue, rejectedPin) {
  if (issue?.code?.startsWith?.('SFTP_')) return issue;
  if (rejectedPin) return fail('SFTP_HOST_KEY_MISMATCH', 'The server key does not match a configured SHA256 fingerprint.', rejectedPin);
  if (issue?.name === 'TimeoutError') return fail('SFTP_TIMEOUT', 'The source operation exceeded its configured time limit. Resume the same retained transfer.');
  if (issue?.name === 'AbortError') return fail('SFTP_CANCELLED', 'The source operation was cancelled. Its received prefix remains available to resume.');
  if (issue?.level === 'client-authentication') return fail('SFTP_AUTHENTICATION_FAILED', 'Review the declared authentication environment references and the remote account.');
  return fail('SFTP_CONNECTION_FAILED', 'The SFTP connection ended before this operation completed.',
    { providerCode: typeof issue?.code === 'string' || typeof issue?.code === 'number' ? issue.code : null });
}
async function credentials(config, env, baseDirectory) {
  const auth = config.connection.auth, result = {};
  const supplied = key => {
    const value = env[auth[key]];
    if (typeof value !== 'string' || !value) throw fail('SFTP_AUTH_ENV_REQUIRED', 'Set authentication environment reference ' + auth[key] + '.');
    return value;
  };
  if (auth.passwordEnv) result.password = supplied('passwordEnv');
  else if (auth.privateKeyEnv) result.privateKey = Buffer.from(supplied('privateKeyEnv'));
  else {
    const selected = supplied('privateKeyFileEnv');
    if (!isAbsolute(selected)) throw fail('SFTP_ABSOLUTE_KEY_PATH_REQUIRED', 'Set the key-file reference to an absolute private path.');
    const path = resolve(selected);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1048576 || stat.nlink !== 1 || process.platform !== 'win32' && stat.mode & 0o077)
        throw fail('SFTP_PRIVATE_KEY_FILE_REQUIRED', 'Use a private regular key file (0600).');
      result.privateKey = await handle.readFile();
    } finally { await handle.close(); }
  }
  if (auth.passphraseEnv) result.passphrase = supplied('passphraseEnv');
  return result;
}

/** This façade exposes only read operations from the SSH library. Every
 * operation pins the raw negotiated host key before authenticating. */
export function createSftpTransport(config, { env = process.env, baseDirectory = process.cwd() } = {}) {
  const active = new Set(); let closed = false;
  async function run(operation, { signal, timeoutMs = config.limits.timeoutMs } = {}) {
    if (closed) throw fail('SFTP_SOURCE_CLOSED');
    const stop = new AbortController();
    const timeout = AbortSignal.timeout(timeoutMs);
    const joined = AbortSignal.any([stop.signal, timeout, ...(signal ? [signal] : [])]);
    joined.throwIfAborted();
    let client, auth, rejectedPin, observedFingerprint, negotiated = null, completing = false;
    const cancel = () => { client?.destroy(); };
    const entry = () => { stop.abort(fail('SFTP_SOURCE_CLOSED')); client?.destroy(); };
    // Register before loading the runtime or key so close owns this whole run.
    active.add(entry); joined.addEventListener('abort', cancel, { once: true });
    const call = (receiver, method, ...args) => new Promise((done, reject) => {
      if (joined.aborted) return reject(joined.reason);
      let finished = false;
      const finish = (issue, ...values) => {
        if (finished) return; finished = true; joined.removeEventListener('abort', aborted);
        issue ? reject(issue) : done(values.length > 1 ? values : values[0]);
      };
      const aborted = () => finish(joined.reason); joined.addEventListener('abort', aborted, { once: true });
      try { receiver[method](...args, finish); } catch (issue) { finish(issue); }
    });
    try {
      const imported = await import('ssh2'); const Client = imported.Client ?? imported.default?.Client;
      if (!Client) throw fail('SFTP_RUNTIME_MISSING', 'Install the declared ssh2 runtime.');
      joined.throwIfAborted();
      auth = await credentials(config, env, baseDirectory);
      joined.throwIfAborted();
      client = new Client();
      client.on('handshake', value => { negotiated = structuredClone(value); });
      client.on('error', issue => { if (!completing) stop.abort(transportIssue(issue, rejectedPin)); });
      client.on('close', () => { if (!completing && !joined.aborted) stop.abort(fail('SFTP_CONNECTION_CLOSED')); });
      await new Promise((done, reject) => {
        const abort = () => { cleanup(); reject(joined.reason); };
        const ready = () => { cleanup(); done(); };
        const cleanup = () => { client.removeListener('ready', ready); joined.removeEventListener('abort', abort); };
        client.once('ready', ready); joined.addEventListener('abort', abort, { once: true });
        try {
          client.connect({ host: config.connection.host, port: config.connection.port, username: config.connection.username,
            ...auth, readyTimeout: Math.min(timeoutMs, 60000), keepaliveInterval: 15000, keepaliveCountMax: 2,
            hostVerifier(raw) {
              observedFingerprint = fingerprint(raw);
              if (config.connection.hostKeyFingerprints.includes(observedFingerprint)) return true;
              rejectedPin = { observedFingerprint, configuredFingerprints: [...config.connection.hostKeyFingerprints] }; return false;
            } });
        } catch (issue) { cleanup(); reject(issue); }
      });
      const sftp = await call(client, 'sftp');
      const root = await call(sftp, 'realpath', config.root);
      if (typeof root !== 'string' || !root.startsWith('/')) throw fail('SFTP_REMOTE_ROOT_INVALID');
      const host = { hostname: config.connection.host, port: config.connection.port, username: config.connection.username,
        fingerprint: observedFingerprint, negotiated };
      const resolvePath = async (path, { directory = false } = {}) => {
        path = relativePath(path, directory);
        const requested = posix.join(root, path), resolved = await call(sftp, 'realpath', requested);
        if (typeof resolved !== 'string' || !inside(root, resolved)) throw fail('SFTP_REMOTE_PATH_OUTSIDE_ROOT');
        const raw = await call(sftp, 'lstat', requested), stat = attributes(raw);
        if (remoteType(stat.mode) !== (directory ? 'directory' : 'file')) throw fail(directory ? 'SFTP_DIRECTORY_REQUIRED' : 'SFTP_REGULAR_FILE_REQUIRED');
        return { path, requested, resolved, stat };
      };
      const api = { host, root, signal: joined, resolvePath,
        lstat: path => call(sftp, 'lstat', path).then(attributes),
        open: path => call(sftp, 'open', path, 'r'),
        fstat: handle => call(sftp, 'fstat', handle).then(attributes),
        read: async (handle, length, offset) => {
          joined.throwIfAborted(); const buffer = Buffer.allocUnsafe(length);
          const value = await call(sftp, 'read', handle, buffer, 0, length, offset);
          const size = Array.isArray(value) ? value[0] : value;
          if (!Number.isSafeInteger(size) || size < 0 || size > length) throw fail('SFTP_REMOTE_READ_INVALID');
          return buffer.subarray(0, size);
        },
        close: handle => call(sftp, 'close', handle),
        opendir: path => call(sftp, 'opendir', path),
        readdir: async handle => {
          try { return await call(sftp, 'readdir', handle); }
          catch (issue) {
            // ssh2 returns SSH_FX_EOF through the callback for a directory handle.
            if (issue?.code === 1 && !joined.aborted) return false;
            throw issue;
          }
        },
      };
      return await operation(api);
    } catch (issue) { throw transportIssue(joined.aborted ? joined.reason : issue, rejectedPin); }
    finally {
      completing = true; active.delete(entry); joined.removeEventListener('abort', cancel);
      try { client?.end(); client?.destroy(); }
      finally { if (Buffer.isBuffer(auth?.privateKey)) auth.privateKey.fill(0); }
    }
  }
  return Object.freeze({ run, close() { closed = true; for (const cancel of active) cancel(); } });
}

export async function catalogueRemote(transport, config, { path = '', limit = 200, offset = 0, signal } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0)
    throw fail('SFTP_CATALOGUE_PAGE_INVALID');
  return transport.run(async api => {
    const selected = await api.resolvePath(path, { directory: true }), handle = await api.opendir(selected.resolved);
    const entries = []; let directoryComplete = false, excludedEntryCount = 0, observedEntries = 0;
    try {
      while (true) {
        api.signal.throwIfAborted(); const batch = await api.readdir(handle);
        if (batch === false || !batch?.length) { directoryComplete = true; break; }
        for (const item of batch) {
          if (item.filename === '.' || item.filename === '..') continue;
          if (++observedEntries > config.limits.maxDirectoryEntries) throw fail('SFTP_DIRECTORY_ENTRY_LIMIT', 'Choose a narrower source folder or raise its explicit directory limit.');
          if (typeof item.filename !== 'string' || item.filename.includes('/') || /[\x00-\x1f\x7f\\]/.test(item.filename)) { excludedEntryCount++; continue; }
          const stat = attributes(item.attrs);
          entries.push({ name: item.filename, path: posix.join(selected.path, item.filename), type: remoteType(stat.mode), ...stat });
        }
      }
    } finally { await api.close(handle).catch(() => {}); }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return { schema: 'stellar-forge.sftp-catalogue.v1', host: api.host, root: config.root, path: selected.path,
      resolvedPath: selected.resolved, observedAt: stamp(), entries: entries.slice(offset, offset + limit),
      totalEntries: entries.length, directoryComplete, excludedEntryCount, observedEntries, offset, limit,
      complete: offset + limit >= entries.length, nextOffset: offset + limit < entries.length ? offset + limit : null };
  }, { signal });
}

async function digestFile(path, expectedBytes) {
  const digest = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path, { flags: constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) })) { size += chunk.length; digest.update(chunk); }
  if (size !== expectedBytes) throw fail('SFTP_LOCAL_CAPTURE_CHANGED');
  return digest.digest('hex');
}
async function makeCaptureRoot(directory) {
  await privateDirectory(directory, true);
  for (const name of ['partial', 'objects', 'receipts']) await privateDirectory(join(directory, name), true);
}

/** Resume compares every retained prefix byte with the same newly opened
 * remote handle. Completion binds the exact full byte hash and both remote
 * observations; expectedSha256 can additionally bind an agreed remote edition. */
export async function captureRemote(transport, config, directory, path, { signal, expectedSha256, onProgress } = {}) {
  directory = resolve(directory); path = relativePath(path);
  if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw fail('SFTP_EXPECTED_HASH_INVALID');
  await makeCaptureRoot(directory); let release;
  try { release = await acquireWorkspace(directory); }
  catch (issue) { if (issue.code === 'PUBLISHER_ALREADY_OPEN') throw fail('SFTP_CAPTURE_BUSY', 'Wait for the active capture using this source directory.'); throw issue; }
  try {
    return await transport.run(async api => {
      const selected = await api.resolvePath(path), remoteHandle = await api.open(selected.resolved);
      let localHandle, state, partialFile, stateFile, offset = 0;
      try {
        const before = await api.fstat(remoteHandle);
        if (!same(before, selected.stat) || remoteType(before.mode) !== 'file') throw fail('SFTP_SOURCE_CHANGED_DURING_OPEN');
        if (before.size > config.limits.maxFileBytes) throw fail('SFTP_FILE_TOO_LARGE', 'The source file exceeds its configured full-capture byte limit.');
        const binding = { host: { hostname: api.host.hostname, port: api.host.port, username: api.host.username, fingerprint: api.host.fingerprint },
          root: api.root, path, resolvedPath: selected.resolved, before, expectedSha256: expectedSha256 ?? null };
        const transfer = identity(binding); partialFile = join(directory, 'partial', transfer + '.data'); stateFile = transfer + '.json';
        try { state = await readJson(join(directory, 'partial', stateFile), 65536); }
        catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
        if (state && (state.schema !== 'stellar-forge.sftp-transfer.v1' || state.transfer !== transfer || identity(state.binding) !== transfer))
          throw fail('SFTP_PARTIAL_BINDING_CHANGED');
        localHandle = await open(partialFile, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
        const local = await localHandle.stat();
        if (!local.isFile() || local.nlink < 1 || local.nlink > 2 || local.nlink === 2 && local.size !== before.size ||
            local.mode & 0o077 || local.size > before.size) throw fail('SFTP_PRIVATE_PARTIAL_REQUIRED');
        offset = local.size;
        if (!state && offset) throw fail('SFTP_PARTIAL_BINDING_REQUIRED');
        const startedAt = state?.startedAt ?? stamp(), attempts = (state?.attempts ?? 0) + 1;
        state = { schema: 'stellar-forge.sftp-transfer.v1', transfer, binding, startedAt, attempts, bytes: offset, updatedAt: stamp() };
        await atomicJson(join(directory, 'partial'), stateFile, state);
        const digest = createHash('sha256'); let verifiedPrefixBytes = 0;
        while (verifiedPrefixBytes < offset) {
          api.signal.throwIfAborted(); const length = Math.min(65536, offset - verifiedPrefixBytes);
          const retained = Buffer.allocUnsafe(length), remote = Buffer.allocUnsafe(length);
          let localRead = 0, remoteRead = 0;
          while (localRead < length) {
            const part = await localHandle.read(retained, localRead, length - localRead, verifiedPrefixBytes + localRead);
            if (!part.bytesRead) break; localRead += part.bytesRead;
          }
          while (remoteRead < length) {
            const part = await api.read(remoteHandle, length - remoteRead, verifiedPrefixBytes + remoteRead);
            if (!part.length) break; part.copy(remote, remoteRead); remoteRead += part.length;
          }
          if (localRead !== length || remoteRead !== length || !timingSafeEqual(retained, remote))
            throw fail('SFTP_RESUME_PREFIX_CHANGED', 'The remote prefix differs from retained bytes. Select a new remote edition or discard this partial capture explicitly.', { transfer, verifiedPrefixBytes });
          digest.update(retained); verifiedPrefixBytes += length;
        }
        const resumedBytes = offset; let checkpoint = offset;
        while (offset < before.size) {
          api.signal.throwIfAborted(); const chunk = await api.read(remoteHandle, Math.min(65536, before.size - offset), offset);
          if (!chunk.length) throw fail('SFTP_SOURCE_TRUNCATED_DURING_READ');
          let written = 0;
          while (written < chunk.length) {
            const next = await localHandle.write(chunk, written, chunk.length - written, offset + written);
            if (!next.bytesWritten) throw fail('SFTP_LOCAL_WRITE_INCOMPLETE'); written += next.bytesWritten;
          }
          digest.update(chunk); offset += chunk.length;
          if (offset - checkpoint >= 1048576) {
            await localHandle.sync(); state.bytes = offset; state.updatedAt = stamp();
            await atomicJson(join(directory, 'partial'), stateFile, state); checkpoint = offset;
          }
          if (onProgress) await onProgress({ transfer, bytes: offset, totalBytes: before.size, resumedBytes, verifiedPrefixBytes });
        }
        const extra = await api.read(remoteHandle, 1, offset);
        if (extra.length) throw fail('SFTP_SOURCE_GREW_DURING_READ');
        const after = await api.fstat(remoteHandle), pathAfter = await api.lstat(selected.resolved);
        if (!same(before, after) || !same(before, pathAfter)) throw fail('SFTP_SOURCE_CHANGED_DURING_READ');
        const sha256 = digest.digest('hex');
        if (expectedSha256 && sha256 !== expectedSha256) throw fail('SFTP_EXPECTED_HASH_MISMATCH', 'The full captured bytes differ from the reviewed remote edition.', { expectedSha256, receivedSha256: sha256 });
        await localHandle.sync(); await localHandle.close(); localHandle = null;
        const relative = 'objects/' + sha256 + '.data', file = join(directory, relative);
        try { await link(partialFile, file); }
        catch (issue) {
          if (issue.code !== 'EEXIST') throw issue;
          const prior = await lstat(file);
          if (!prior.isFile() || prior.isSymbolicLink() || prior.mode & 0o077 || prior.size !== offset || await digestFile(file, offset) !== sha256)
            throw fail('SFTP_RETAINED_OBJECT_CHANGED');
        }
        await syncDirectory(join(directory, 'objects'));
        const receipt = { schema: 'stellar-forge.sftp-capture.v1', id: 'capture_' + randomUUID().replaceAll('-', ''),
          complete: true, readOnly: true, sha256, bytes: offset, relativePath: relative, capturedAt: stamp(), startedAt,
          host: api.host, remote: { root: config.root, resolvedRoot: api.root, path, resolvedPath: selected.resolved, before, after, pathAfter },
          expectedSha256: expectedSha256 ?? null, resume: { transfer, attempts, resumedBytes, verifiedPrefixBytes },
          consistency: { fullByteDigest: true, attributesUnchanged: true, expectedDigestMatched: expectedSha256 ? true : null,
            observation: 'One opened SFTP file handle, complete received bytes, before/after handle and path attributes.' } };
        await createFile(join(directory, 'receipts', receipt.id + '.json'), Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
        await syncDirectory(join(directory, 'receipts'));
        await unlink(partialFile); await unlink(join(directory, 'partial', stateFile)); await syncDirectory(join(directory, 'partial'));
        return { receipt, file };
      } finally {
        if (localHandle) {
          try { await localHandle.sync(); if (state) { state.bytes = offset; state.updatedAt = stamp(); await atomicJson(join(directory, 'partial'), stateFile, state); } }
          finally { await localHandle.close(); }
        }
        await api.close(remoteHandle).catch(() => {});
      }
    }, { signal });
  } finally { await release(); }
}
