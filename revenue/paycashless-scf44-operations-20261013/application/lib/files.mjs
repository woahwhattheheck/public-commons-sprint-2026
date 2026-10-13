// MIT. Durable private files and process ownership for the Paycashless operations workspace.
import * as fs from 'node:fs/promises';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export class PaycashlessError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'PaycashlessError';
    this.code = code;
    this.details = details;
  }
}

export function need(condition, code, details = {}) {
  if (!condition) throw new PaycashlessError(code, code, details);
}

export const now = () => new Date().toISOString();
export const hash = value => createHash('sha256').update(value).digest('hex');
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const clone = value => JSON.parse(JSON.stringify(value));
export const shaPattern = /^[a-f0-9]{64}$/;

export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value);
    need(result !== undefined, 'UNSUPPORTED_JSON_VALUE');
    return result;
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

export function relativeName(value) {
  need(typeof value === 'string' && value.length > 0 && value.length < 4096,
    'INVALID_FILE_NAME');
  need(!value.includes('\\') && !value.includes('\0') && !path.isAbsolute(value),
    'INVALID_FILE_NAME');
  const parts = value.split('/');
  need(parts.every(part => part && part !== '.' && part !== '..'),
    'INVALID_FILE_NAME');
  return value;
}

export async function directory(value) {
  need(path.isAbsolute(value), 'ABSOLUTE_DIRECTORY_REQUIRED');
  await fs.mkdir(value, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(value);
  need(stat.isDirectory() && !stat.isSymbolicLink(), 'DIRECTORY_REQUIRED');
  return value;
}

export async function confined(root, relative, createParents = false) {
  relativeName(relative);
  let current = path.resolve(root);
  const initial = await fs.lstat(current);
  need(initial.isDirectory() && !initial.isSymbolicLink(), 'DIRECTORY_REQUIRED');
  const parts = relative.split('/');
  for (let index = 0; index < parts.length - 1; index++) {
    current = path.join(current, parts[index]);
    if (createParents) await fs.mkdir(current, { mode: 0o700 }).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
    const stat = await fs.lstat(current);
    need(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_FILE_PARENT');
  }
  return path.join(current, parts.at(-1));
}

export async function exists(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function syncDirectory(value) {
  const handle = await fs.open(value, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function fileDescriptor(file, relative = path.basename(file)) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(Number.MAX_SAFE_INTEGER),
      'REGULAR_FILE_REQUIRED');
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    const size = Number(before.size);
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, 0,
        Math.min(buffer.length, size - offset), offset);
      need(bytesRead > 0, 'SOURCE_CHANGED');
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    need(before.ino === after.ino && before.dev === after.dev &&
      before.size === after.size && before.mtimeNs === after.mtimeNs &&
      before.ctimeNs === after.ctimeNs, 'SOURCE_CHANGED');
    return {
      path: relative,
      bytes: size,
      sha256: digest.digest('hex'),
      mode: Number(before.mode & 0o777n),
    };
  } finally { await handle.close(); }
}

export async function verifyFile(root, descriptor, { mode = false } = {}) {
  need(Number.isSafeInteger(descriptor.bytes) && descriptor.bytes >= 0 &&
    shaPattern.test(descriptor.sha256), 'INVALID_FILE_DESCRIPTOR');
  const file = await confined(root, descriptor.path);
  const actual = await fileDescriptor(file, descriptor.path);
  need(actual.bytes === descriptor.bytes && actual.sha256 === descriptor.sha256,
    'FILE_IDENTITY_MISMATCH', { path: descriptor.path });
  if (mode) need(actual.mode === descriptor.mode, 'FILE_MODE_MISMATCH',
    { path: descriptor.path });
  return actual;
}

export async function writeExact(file, bytes, mode = 0o600) {
  bytes = Buffer.from(bytes);
  await directory(path.dirname(file));
  if (await exists(file)) {
    const previous = await fileDescriptor(file);
    need(previous.bytes === bytes.length && previous.sha256 === hash(bytes),
      'IMMUTABLE_FILE_CONFLICT', { file: path.basename(file) });
    await syncDirectory(path.dirname(file));
    return previous;
  }
  const temporary = file + '.pending-' + randomUUID();
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await fs.link(temporary, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const actual = await fileDescriptor(file);
    need(actual.bytes === bytes.length && actual.sha256 === hash(bytes),
      'IMMUTABLE_FILE_CONFLICT');
  } finally { await fs.unlink(temporary); }
  await syncDirectory(path.dirname(file));
  return fileDescriptor(file);
}

export async function atomicJSON(file, value) {
  await directory(path.dirname(file));
  const temporary = file + '.pending-' + randomUUID();
  await writeExact(temporary, jsonBytes(value));
  await fs.rename(temporary, file);
  await syncDirectory(path.dirname(file));
}

export async function readJSON(file, optional = false) {
  try {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return JSON.parse(await handle.readFile('utf8')); }
    finally { await handle.close(); }
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function copyDeclared(origin, descriptor, destination, relative = descriptor.path) {
  await verifyFile(origin, descriptor);
  await directory(destination);
  const target = await confined(destination, relative, true);
  if (await exists(target)) {
    await verifyFile(destination, { ...descriptor, path: relative });
    await fs.chmod(target, descriptor.mode);
    const selected = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await selected.sync(); } finally { await selected.close(); }
    await syncDirectory(path.dirname(target));
    return { ...descriptor, path: relative };
  }
  const source = await confined(origin, descriptor.path);
  const pending = target + '.pending-' + randomUUID();
  await fs.copyFile(source, pending, constants.COPYFILE_EXCL);
  const captured = await fileDescriptor(pending);
  need(captured.bytes === descriptor.bytes && captured.sha256 === descriptor.sha256,
    'SOURCE_CHANGED');
  await fs.chmod(pending, descriptor.mode);
  const handle = await fs.open(pending, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
  try { await fs.link(pending, target); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await verifyFile(destination, { ...descriptor, path: relative });
  } finally { await fs.unlink(pending); }
  await syncDirectory(path.dirname(target));
  return { ...descriptor, path: relative };
}

export async function writeStream(root, relative, input, { maximumBytes = 1024 ** 3,
  expectedSha256, signal } = {}) {
  await directory(root);
  const target = await confined(root, relative, true);
  const pending = target + '.pending-' + randomUUID();
  const handle = await fs.open(pending, constants.O_WRONLY | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const digest = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of input) {
      signal?.throwIfAborted();
      const body = Buffer.from(chunk);
      bytes += body.length;
      need(bytes <= maximumBytes, 'UPLOAD_TOO_LARGE');
      digest.update(body);
      await handle.writeFile(body);
    }
    const sha256 = digest.digest('hex');
    if (expectedSha256) need(sha256 === expectedSha256, 'UPLOAD_HASH_MISMATCH');
    await handle.sync();
    await handle.close();
    const descriptor = { path: relative, bytes, sha256, mode: 0o600 };
    try { await fs.link(pending, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await verifyFile(root, descriptor);
    }
    await syncDirectory(path.dirname(target));
    return descriptor;
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(pending).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function processIdentity(pid) {
  const self = pid === undefined;
  if (process.platform !== 'linux') return { platform: process.platform, pid: self ? process.pid : Number(pid) };
  try {
    const base = self ? '/proc/self' : '/proc/' + Number(pid);
    const stat = await fs.readFile(base + '/stat', 'utf8');
    const procPid = Number(stat.slice(0, stat.indexOf(' ')));
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    need(Number.isSafeInteger(procPid) && procPid > 0 && /^\d+$/.test(fields[19]),
      'PROCESS_IDENTITY_UNAVAILABLE');
    return {
      platform: 'linux', pid: self ? process.pid : procPid, procPid,
      state: fields[0], startTicks: fields[19],
      boot: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
      namespace: await fs.readlink(base + '/ns/pid'),
      procMountNamespace: await fs.readlink('/proc/self/ns/mnt'),
    };
  } catch (error) {
    if (!self && ['ENOENT', 'ESRCH'].includes(error.code)) return null;
    throw error;
  }
}

export async function processAlive(identity) {
  // Unknown owners must never be interpreted as retired.
  if (!identity) return true;
  if (identity.platform === 'linux') {
    try {
      const current = await processIdentity();
      if (!identity.boot || !identity.namespace || !identity.startTicks) return true;
      if (current.boot !== identity.boot) return false;
      if (!Number.isSafeInteger(identity.procPid) || identity.procPid <= 0) return true;
      const actual = await processIdentity(identity.procPid);
      if (!actual) {
        // An absent PID is conclusive only in the same observed proc visibility.
        return !(identity.procMountNamespace &&
          current.procMountNamespace === identity.procMountNamespace &&
          current.namespace === identity.namespace);
      }
      if (actual.boot === identity.boot && actual.namespace === identity.namespace &&
          actual.startTicks === identity.startTicks) {
        return actual.state !== 'Z' && actual.state !== 'X';
      }
      return !(identity.procMountNamespace &&
        current.procMountNamespace === identity.procMountNamespace &&
        current.namespace === identity.namespace);
    } catch (error) {
      if (['EACCES', 'EPERM', 'ENOENT', 'ESRCH'].includes(error.code)) return true;
      throw error;
    }
  }
  if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0) return true;
  try { process.kill(identity.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; return true; }
}

export async function lease(root, name) {
  relativeName(name);
  const parent = path.join(root, 'locks');
  await directory(parent);
  const target = await confined(parent, name);
  const token = randomUUID();
  for (let attempt = 0; attempt < 4; attempt++) {
    const pending = target + '.pending-' + token;
    await fs.mkdir(pending, { mode: 0o700 });
    const owner = { token, identity: await processIdentity(), createdAt: now() };
    await writeExact(path.join(pending, 'owner.json'), jsonBytes(owner));
    try {
      await fs.rename(pending, target);
      let released = false;
      return {
        owner,
        async release() {
          if (released) return;
          const current = await readJSON(path.join(target, 'owner.json'));
          need(current.token === token, 'LEASE_CHANGED');
          released = true;
          await fs.rm(target, { recursive: true });
          await syncDirectory(parent);
        },
      };
    } catch (error) {
      await fs.rm(pending, { recursive: true, force: true });
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      const previous = await readJSON(path.join(target, 'owner.json'));
      need(!await processAlive(previous.identity), 'OPERATION_BUSY', { name });
      try {
        await fs.rename(target, target + '.previous-' + previous.token);
      } catch (move) { if (move.code !== 'ENOENT') throw move; }
    }
  }
  throw new PaycashlessError('LEASE_UNAVAILABLE');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left)), b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function publicError(error) {
  return {
    code: String(error.code ?? error.name ?? 'ERROR'),
    message: String(error.publicMessage ?? error.code ?? 'Operation failed.'),
    details: error.publicDetails ?? (error.code === 'REVISION_CONFLICT' ? error.details : {}),
  };
}

export function redact(value, secrets = []) {
  const sensitive = /^(authorization|api[-_]?key|secret|secret[-_]?key|client[-_]?secret|webhook[-_]?secret|webhook[-_]?secret[-_]?key|token|access[-_]?token|refresh[-_]?token|password|private[-_]?key)$/i;
  if (typeof value === 'string') {
    let output = value;
    for (const secret of secrets.filter(value => typeof value === 'string' && value)) {
      for (const candidate of new Set([secret, encodeURIComponent(secret),
        JSON.stringify(secret).slice(1, -1)])) {
        if (candidate) output = output.split(candidate).join('[redacted]');
      }
    }
    return output;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) =>
      [key, sensitive.test(key) ? '[redacted]' : redact(item, secrets)]));
  return value;
}

export function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

// Original CSV cells remain strings; this parser does not infer numbers or dates.
export function parseLedgerCSV(raw) {
  const bytes = Buffer.from(raw);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new PaycashlessError('INVALID_CSV_UTF8'); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', quoted = false, afterQuote = false, atStart = true;
  const finishCell = () => { row.push(cell); cell = ''; atStart = true; afterQuote = false; };
  const finishRow = () => { finishCell(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; afterQuote = true; }
      } else cell += character;
      continue;
    }
    if (character === ',' ) { finishCell(); continue; }
    if (character === '\r' || character === '\n') {
      if (character === '\r') {
        need(text[index + 1] === '\n', 'MALFORMED_CSV_NEWLINE');
        index++;
      }
      finishRow(); continue;
    }
    need(!afterQuote, 'MALFORMED_CSV_QUOTING');
    if (character === '"') {
      need(atStart, 'MALFORMED_CSV_QUOTING'); quoted = true; atStart = false;
    } else { cell += character; atStart = false; }
  }
  need(!quoted, 'UNTERMINATED_CSV_QUOTE');
  if (row.length || cell.length || afterQuote || !atStart) finishRow();
  need(rows.length > 0, 'CSV_HEADER_REQUIRED');
  const headers = rows.shift();
  need(headers.every(header => header.length > 0) && new Set(headers).size === headers.length,
    'INVALID_CSV_HEADERS');
  const value = rows.map((cells, index) => {
    need(cells.length === headers.length, 'CSV_COLUMN_COUNT', { row: index + 2 });
    return Object.fromEntries(headers.map((header, column) => [header, cells[column]]));
  });
  return { value, headers, bodySha256: hash(bytes) };
}
