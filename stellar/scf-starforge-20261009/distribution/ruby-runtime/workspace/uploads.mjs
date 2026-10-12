// MIT. Stream complete runtime archives into their original private receiving selection.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, link, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SHA = /^[a-f0-9]{64}$/;
const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const need = (yes, code, message, status) => { if (!yes) throw fault(code, message, status); };
const serial = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');

function operation(value) {
  need(typeof value === 'string' && UUID.test(value), 'RUBY_UPLOAD_OPERATION', 'Use the original receiving operation UUID.');
  return value;
}
function identity(stat) {
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(key => [key, String(stat[key])]));
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function regular(stat) {
  need(stat.isFile() && Number(stat.uid) === process.getuid() && (Number(stat.mode) & 0o077) === 0,
    'RUBY_UPLOAD_PRIVATE_FILE', 'The original private receiving file is required.', 409);
}
async function privateDirectory(path, create = false) {
  if (create) {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (issue) { if (issue.code !== 'EEXIST') throw issue; }
    await syncDirectory(resolve(path, '..'));
  }
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() &&
    (stat.mode & 0o077) === 0 && await realpath(path) === path,
    'RUBY_UPLOAD_PRIVATE_DIRECTORY', 'Use the original private runtime directory.', 409);
  return path;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    need(bytesWritten > 0, 'RUBY_UPLOAD_WRITE', 'The receiving file could not be written.', 500);
    offset += bytesWritten;
  }
}
async function readSmall(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true }); regular(before);
    need(before.size <= 65536n, 'RUBY_UPLOAD_RECORD_SIZE', 'The original receiving record is too large.', 409);
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    need(BigInt(bytes.length) === before.size && same(identity(before), identity(after)),
      'RUBY_UPLOAD_RECORD_CHANGED', 'The original receiving record changed during reading.', 409);
    return bytes;
  } finally { await handle.close(); }
}
async function once(path, bytes) {
  const temporary = path + '.' + randomUUID() + '.part';
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { await writeAll(handle, bytes); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, path); }
    catch (issue) {
      if (issue.code !== 'EEXIST') throw issue;
      need((await readSmall(path)).equals(bytes), 'RUBY_UPLOAD_SELECTION_CHANGED',
        'This original receiving operation already has different inputs.', 409);
    }
  } finally { await unlink(temporary); }
  await syncDirectory(resolve(path, '..'));
}
function selection(input) {
  need(input && typeof input === 'object' && !Array.isArray(input), 'RUBY_UPLOAD_SELECTION', 'Select a complete runtime archive.');
  const allowed = ['operationId', 'id', 'title', 'ruby', 'bundlerVersion', 'expectedSha256', 'bytes'];
  need(Object.keys(input).every(key => allowed.includes(key)), 'RUBY_UPLOAD_FIELD', 'Unknown receiving field.');
  const value = { operationId: operation(input.operationId), id: input.id, title: input.title, ruby: input.ruby };
  need(typeof value.id === 'string' && ID.test(value.id), 'RUBY_UPLOAD_ENVIRONMENT', 'Choose an environment ID of 1–80 letters, numbers, dots, dashes or underscores.');
  need(typeof value.title === 'string' && value.title.trim() && value.title.length <= 160 && !/[\u0000-\u001f]/.test(value.title),
    'RUBY_UPLOAD_TITLE', 'Give the received environment a title.');
  need(typeof value.ruby === 'string' && value.ruby.startsWith('/') && resolve(value.ruby) === value.ruby &&
    value.ruby.length <= 4096 && !/[\u0000-\u001f]/.test(value.ruby),
    'RUBY_UPLOAD_RUBY', 'Select the absolute existing Ruby executable.');
  if (input.bundlerVersion !== undefined && input.bundlerVersion !== '') {
    need(typeof input.bundlerVersion === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/.test(input.bundlerVersion),
      'RUBY_UPLOAD_BUNDLER', 'Use the exact selected Bundler version.');
    value.bundlerVersion = input.bundlerVersion;
  }
  need(typeof input.expectedSha256 === 'string' && SHA.test(input.expectedSha256),
    'RUBY_UPLOAD_SHA', 'Enter the complete SHA-256 from the original archive export.');
  need(Number.isSafeInteger(input.bytes) && input.bytes > 0 && input.bytes <= MAX_UPLOAD_BYTES,
    'RUBY_UPLOAD_SIZE', 'Choose a complete runtime TAR archive of at most 4 GiB.');
  return { ...value, expectedSha256: input.expectedSha256, bytes: input.bytes };
}

/** This staging adapter does not create a second native receiving job. */
export async function openRubyRuntimeUploads({ directory }) {
  need(typeof directory === 'string' && directory.startsWith('/') && resolve(directory) === directory,
    'RUBY_UPLOAD_DIRECTORY', 'Use the absolute original runtime directory.');
  await privateDirectory(directory);
  const root = await privateDirectory(join(directory, 'browser-uploads'), true);
  const active = new Map(), finalizations = new Map();
  async function area(id, create = false) {
    return privateDirectory(join(root, operation(id)), create);
  }
  async function read(id) {
    const path = await area(id);
    const value = JSON.parse((await readSmall(join(path, 'request.json'))).toString('utf8'));
    const selected = selection(value);
    need(same(selected, value) && selected.operationId === id, 'RUBY_UPLOAD_SELECTION_CHANGED',
      'The retained receiving selection differs from its original operation.', 409);
    return { path, selected };
  }
  async function originalArchive(path, selected) {
    const name = join(path, 'archive.tar');
    let handle;
    try { handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (issue) { if (issue.code === 'ENOENT') return null; throw issue; }
    try {
      const before = await handle.stat({ bigint: true }); regular(before);
      need(before.size === BigInt(selected.bytes), 'RUBY_UPLOAD_ARCHIVE_SIZE', 'The complete retained archive has another length.', 409);
      let recorded;
      try { recorded = JSON.parse((await readSmall(join(path, 'received.json'))).toString('utf8')); }
      catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
      const binding = sha(serial(selected));
      if (recorded) {
        need(recorded.schema === 'stellar-forge.ruby-runtime-upload.v1' &&
          recorded.selectionSha256 === binding && recorded.sha256 === selected.expectedSha256 &&
          recorded.bytes === selected.bytes && same(recorded.fileIdentity, identity(before)),
          'RUBY_UPLOAD_ARCHIVE_CHANGED', 'The received archive changed after its complete transfer.', 409);
        return { archive: name, receipt: recorded };
      }
      // Complete a publication interrupted between the final hard link and receipt.
      const hash = createHash('sha256'); let bytes = 0;
      for await (const part of handle.createReadStream({ autoClose: false, start: 0 })) {
        bytes += part.length; hash.update(part);
      }
      const after = await handle.stat({ bigint: true });
      need(bytes === selected.bytes && hash.digest('hex') === selected.expectedSha256 && same(identity(before), identity(after)),
        'RUBY_UPLOAD_ARCHIVE_CHANGED', 'The retained archive does not match its original complete export.', 409);
      const receipt = { schema: 'stellar-forge.ruby-runtime-upload.v1', operationId: selected.operationId,
        selectionSha256: binding, bytes, sha256: selected.expectedSha256, fileIdentity: identity(after), receivedAt: new Date(Number(after.mtimeNs / 1000000n)).toISOString() };
      await once(join(path, 'received.json'), serial(receipt));
      return { archive: name, receipt };
    } finally { await handle.close(); }
  }
  async function finalizedArchive(path, selected) {
    const id = selected.operationId;
    if (finalizations.has(id)) return finalizations.get(id);
    const work = originalArchive(path, selected);
    finalizations.set(id, work);
    try { return await work; }
    finally { if (finalizations.get(id) === work) finalizations.delete(id); }
  }
  async function status({ operationId }) {
    const { path, selected } = await read(operationId), transfer = active.get(operationId);
    if (transfer) return { schema: 'stellar-forge.ruby-runtime-upload.v1', ...selected,
      phase: transfer.phase, receivedBytes: transfer.bytes,
      ...(transfer.receivedAt ? { receivedAt: transfer.receivedAt } : {}) };
    const complete = await finalizedArchive(path, selected);
    return { schema: 'stellar-forge.ruby-runtime-upload.v1', ...selected,
      phase: complete ? 'RECEIVED' : 'READY_TO_UPLOAD', receivedBytes: complete ? selected.bytes : 0,
      ...(complete ? { receivedAt: complete.receipt.receivedAt } : {}) };
  }
  return {
    async prepare(input) {
      const selected = selection(input), path = await area(selected.operationId, true);
      await once(join(path, 'request.json'), serial(selected));
      return status({ operationId: selected.operationId });
    },
    status,
    async write({ operationId, readable, contentLength }) {
      const { path, selected } = await read(operationId);
      need(!active.has(operationId), 'RUBY_UPLOAD_ACTIVE', 'The original archive transfer is already active. Read its progress.', 409);
      if (contentLength !== undefined) need(String(selected.bytes) === String(contentLength),
        'RUBY_UPLOAD_SIZE', 'The uploaded archive length differs from its original selection.', 409);
      const progress = { bytes: 0, phase: 'CHECKING_ARCHIVE' }; active.set(operationId, progress);
      const temporary = join(path, 'archive.' + randomUUID() + '.part');
      let handle = null;
      try {
        const retained = await finalizedArchive(path, selected);
        if (retained) {
          progress.bytes = selected.bytes; progress.phase = 'RECEIVED'; progress.receivedAt = retained.receipt.receivedAt;
          readable.resume?.(); return status({ operationId });
        }
        progress.phase = 'UPLOADING';
        handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        const hash = createHash('sha256');
        for await (const part of readable) {
          progress.bytes += part.length;
          need(progress.bytes <= selected.bytes && progress.bytes <= MAX_UPLOAD_BYTES,
            'RUBY_UPLOAD_SIZE', 'The transfer exceeds the selected complete archive length.', 413);
          hash.update(part); await writeAll(handle, part);
        }
        need(progress.bytes === selected.bytes && hash.digest('hex') === selected.expectedSha256,
          'RUBY_UPLOAD_SHA', 'The transfer differs from the complete original archive. Re-select that archive.', 409);
        await handle.sync(); await handle.close(); handle = null;
        try { await link(temporary, join(path, 'archive.tar')); }
        catch (issue) { if (issue.code !== 'EEXIST') throw issue; }
        await unlink(temporary);
        await syncDirectory(path);
        // The one finishing promise is shared with original status/commit reads.
        progress.phase = 'VERIFYING';
        const finished = await finalizedArchive(path, selected);
        progress.phase = 'RECEIVED'; progress.receivedAt = finished.receipt.receivedAt;
        return status({ operationId });
      } finally {
        try {
          if (handle) await handle.close();
          try { await unlink(temporary); } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
        } finally { active.delete(operationId); }
      }
    },
    async commit({ operationId }, runtime) {
      const { path, selected } = await read(operationId), completed = await finalizedArchive(path, selected);
      need(completed, 'RUBY_UPLOAD_INCOMPLETE', 'Complete the original archive transfer before receiving it.', 409);
      const { bytes, ...input } = selected;
      return runtime.receive({ ...input, archive: completed.archive });
    },
  };
}
