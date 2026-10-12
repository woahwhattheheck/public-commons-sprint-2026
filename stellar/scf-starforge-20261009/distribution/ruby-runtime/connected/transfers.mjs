// MIT. Complete saved results and resumable original runtime archive receiving.
import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { directory, once, readJSON, json, hashObject, operationId, operationLease,
  openSnapshot, saveJSON, syncParent, MAX_BYTES } from '../files.mjs';
import { openRubyRuntimeUploads } from '../workspace/uploads.mjs';
import { need, MAX_CHUNK_BYTES, MAX_RESULT_BYTES } from './protocol.mjs';

const FILE_SCHEMA = 'stellar-forge.ruby-connected-file.v1';
const CURSOR_SCHEMA = 'stellar-forge.ruby-connected-upload.v1';
const MAX_OPEN = 4;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileIdentity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function privateFile(stat) {
  need(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
    'RUBY_CONNECTED_PRIVATE_FILE', 'The original private regular receiving file is required.', 409);
}
async function readExactly(handle, count, offset) {
  const buffer = Buffer.alloc(count);
  let done = 0;
  while (done < count) {
    const result = await handle.read(buffer, done, count - done, offset + done);
    need(result.bytesRead > 0, 'RUBY_CONNECTED_FILE_CHANGED', 'The complete selected file ended early.', 409);
    done += result.bytesRead;
  }
  return buffer;
}
async function writeExactly(handle, bytes, offset) {
  let done = 0;
  while (done < bytes.length) {
    const result = await handle.write(bytes, done, bytes.length - done, offset + done);
    need(result.bytesWritten > 0, 'RUBY_CONNECTED_WRITE', 'The original receiving file could not be written.', 500);
    done += result.bytesWritten;
  }
}
function unpack(value) {
  need(typeof value === 'string' && value.length <= 4 * Math.ceil(MAX_CHUNK_BYTES / 3) &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
    'RUBY_CONNECTED_BASE64', 'Use canonical base64 for the complete selected chunk.');
  const bytes = Buffer.from(value, 'base64');
  need(bytes.length > 0 && bytes.length <= MAX_CHUNK_BYTES && bytes.toString('base64') === value,
    'RUBY_CONNECTED_CHUNK_SIZE', 'Send 1 byte to 1 MiB of original archive bytes.');
  return bytes;
}

export async function openRubyTransfers({ runtime }) {
  const root = await directory(join(runtime.directory, 'connected-transfers'), true);
  const outgoing = await directory(join(root, 'outgoing'), true);
  const incoming = await directory(join(root, 'incoming'), true);
  const receiver = await openRubyRuntimeUploads({ directory: runtime.directory });
  const queues = new Map(), snapshots = new Map(), writers = new Map();
  let closing = false, closePromise = null;
  function serial(key, fn) {
    need(!closing, 'RUBY_CONNECTED_CLOSED', 'The connected workspace is closing.', 409);
    const prior = queues.get(key) ?? Promise.resolve();
    const work = prior.catch(() => {}).then(fn);
    queues.set(key, work);
    work.finally(() => { if (queues.get(key) === work) queues.delete(key); }).catch(() => {});
    return work;
  }
  async function area(parent, key, create = false) {
    return directory(join(parent, operationId(key)), create);
  }
  async function fileRecord(key) {
    const record = await readJSON(join(await area(outgoing, key), 'selection.json'));
    const { selectionSha256, ...body } = record;
    need(record.schema === FILE_SCHEMA && record.transferId === key &&
      hashObject(body) === selectionSha256 && Number.isSafeInteger(record.bytes) &&
      record.bytes >= 0 && record.bytes <= Math.max(MAX_BYTES, MAX_RESULT_BYTES) &&
      /^[a-f0-9]{64}$/.test(record.sha256),
      'RUBY_CONNECTED_SELECTION_CHANGED', 'The original complete-file selection changed.', 409);
    return record;
  }
  function fileView(record) {
    return { ...record, open: Boolean(snapshots.get(record.transferId)?.file) };
  }
  function roomForSnapshot(key) {
    if (snapshots.size < MAX_OPEN) return null;
    const candidate = [...snapshots.entries()]
      .filter(([id, entry]) => id !== key && entry.file && !entry.busy)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    need(candidate, 'RUBY_CONNECTED_TRANSFERS_ACTIVE',
      'Four original file snapshots are in use. Finish or close one before opening another.', 409);
    snapshots.delete(candidate[0]);
    return candidate[1].file.handle;
  }
  async function originalFile(source, key, expected) {
    if (source.kind === 'operation') return runtime.openFile({ operationId: source.operationId, name: source.name });
    if (source.kind === 'customer') return runtime.openCustomerFile({ id: source.id, name: source.name });
    if (source.kind === 'edition') return runtime.openEditionFile({
      id: source.id, editionId: source.editionId, reviewId: source.reviewId, name: source.name,
    });
    need(source.kind === 'record' && expected, 'RUBY_CONNECTED_FILE_SOURCE', 'Unknown saved file source.', 409);
    const path = await area(outgoing, key);
    const handle = await openSnapshot(join(path, 'result.json'), expected, path);
    return { handle, name: expected.name, bytes: expected.bytes, sha256: expected.sha256, type: expected.type };
  }
  async function acquireSnapshot(key, source, expectedSha256) {
    const existing = snapshots.get(key);
    if (existing?.file) {
      if (source) need(hashObject(existing.record.source) === hashObject(source),
        'RUBY_CONNECTED_TRANSFER_CHANGED', 'Reuse this transfer ID with its original selected file.', 409);
      if (expectedSha256) need(existing.record.sha256 === expectedSha256,
        'RUBY_CONNECTED_FILE_SHA', 'The original selected file has a different SHA.', 409);
      existing.busy = true; existing.lastUsed = Date.now();
      return existing;
    }
    const evicted = roomForSnapshot(key);
    const entry = { busy: true, file: null, record: null, lastUsed: Date.now() };
    // Reserve capacity before opening a potentially large immutable snapshot.
    snapshots.set(key, entry);
    try {
      if (evicted) await evicted.close();
      const path = await area(outgoing, key, true);
      let record = await readJSON(join(path, 'selection.json'), true);
      if (record) {
        record = await fileRecord(key);
        if (source) need(hashObject(record.source) === hashObject(source),
          'RUBY_CONNECTED_TRANSFER_CHANGED', 'Reuse this transfer ID with its original selected file.', 409);
        if (expectedSha256) need(record.sha256 === expectedSha256,
          'RUBY_CONNECTED_FILE_SHA', 'The original selected file has a different SHA.', 409);
      } else need(source, 'RUBY_CONNECTED_TRANSFER_UNKNOWN', 'Open the original selected file with its retained transfer ID first.', 404);
      entry.file = await originalFile(record?.source ?? source, key, record);
      if (record) need(entry.file.bytes === record.bytes && entry.file.sha256 === record.sha256 &&
        entry.file.name === record.name, 'RUBY_CONNECTED_FILE_CHANGED', 'The original selected file changed.', 409);
      else {
        if (expectedSha256) need(entry.file.sha256 === expectedSha256,
          'RUBY_CONNECTED_FILE_SHA', 'The selected original file differs from the expected complete SHA.', 409);
        const body = { schema: FILE_SCHEMA, transferId: key, source,
          name: entry.file.name, bytes: entry.file.bytes, sha256: entry.file.sha256,
          type: entry.file.type ?? 'application/octet-stream' };
        record = { ...body, selectionSha256: hashObject(body) };
        await once(join(path, 'selection.json'), json(record));
      }
      entry.record = record;
      return entry;
    } catch (error) {
      snapshots.delete(key);
      if (entry.file) await entry.file.handle.close().catch(() => {});
      throw error;
    }
  }
  async function closeSnapshot(key) {
    const current = snapshots.get(key);
    snapshots.delete(key);
    if (current?.file) await current.file.handle.close();
  }
  async function selectedUpload(key) {
    const path = await area(incoming, key);
    const selected = await readJSON(join(path, 'request.json'));
    need(selected.operationId === key && Number.isSafeInteger(selected.bytes) &&
      selected.bytes > 0 && selected.bytes <= MAX_BYTES && /^[a-f0-9]{64}$/.test(selected.expectedSha256),
      'RUBY_CONNECTED_UPLOAD_CHANGED', 'The original receiving request changed.', 409);
    return { path, selected };
  }
  async function cursorFor(path, selected) {
    const cursor = await readJSON(join(path, 'cursor.json'), true);
    if (!cursor) return null;
    need(cursor.schema === CURSOR_SCHEMA && cursor.operationId === selected.operationId &&
      cursor.selectionSha256 === hashObject(selected) && Number.isSafeInteger(cursor.committedBytes) &&
      cursor.committedBytes >= 0 && cursor.committedBytes <= selected.bytes &&
      cursor.file && typeof cursor.file.dev === 'string' && typeof cursor.file.ino === 'string',
      'RUBY_CONNECTED_CURSOR_CHANGED', 'The durable original receiving cursor changed.', 409);
    return cursor;
  }
  async function uploadView(key) {
    const { path, selected } = await selectedUpload(key);
    const original = await receiver.status({ operationId: key });
    const cursor = await cursorFor(path, selected);
    const complete = original.phase === 'RECEIVED';
    const committedBytes = complete ? selected.bytes : cursor?.committedBytes ?? 0;
    return { schema: CURSOR_SCHEMA, ...selected,
      phase: complete ? 'RECEIVED' : committedBytes === selected.bytes ? 'READY_TO_FINISH' : 'UPLOADING',
      committedBytes, nextOffset: committedBytes, active: writers.has(key),
      ...(original.receivedAt ? { receivedAt: original.receivedAt } : {}) };
  }
  async function releaseWriter(key) {
    const current = writers.get(key);
    writers.delete(key);
    if (!current) return;
    try { if (current.file) await current.file.close(); }
    finally { if (current.lease) await current.lease.close(); }
  }
  async function writer(key) {
    if (writers.has(key)) return writers.get(key);
    need(writers.size < MAX_OPEN, 'RUBY_CONNECTED_UPLOADS_ACTIVE',
      'Four original archive transfers are active. Finish one before starting another.', 409);
    const state = { file: null, lease: null };
    writers.set(key, state);
    try {
      const { path, selected } = await selectedUpload(key);
      Object.assign(state, { path, selected });
      state.lease = await operationLease(join(path, 'writer.lock'));
      const filename = join(path, 'archive.part');
      try { state.file = await open(filename, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        state.file = await open(filename, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      }
      const stat = await state.file.stat();
      privateFile(stat);
      let cursor = await cursorFor(path, selected);
      if (!cursor) {
        need(stat.size === 0, 'RUBY_CONNECTED_UNTRACKED_BYTES',
          'The original receiving file has bytes without its saved cursor.', 409);
        await state.file.sync();
        await syncParent(filename);
        cursor = { schema: CURSOR_SCHEMA, operationId: key, selectionSha256: hashObject(selected),
          committedBytes: 0, file: fileIdentity(stat) };
        await once(join(path, 'cursor.json'), json(cursor));
      }
      need(same(cursor.file, fileIdentity(stat)) && stat.size >= cursor.committedBytes,
        'RUBY_CONNECTED_UPLOAD_FILE_CHANGED', 'The original receiving file changed or lost committed bytes.', 409);
      // A dead writer may leave only its last unacknowledged tail. The saved
      // cursor follows fsync, so truncating to it preserves every committed byte.
      if (stat.size > cursor.committedBytes) {
        await state.file.truncate(cursor.committedBytes); await state.file.sync();
      }
      state.cursor = cursor;
      return state;
    } catch (error) {
      await releaseWriter(key).catch(() => {});
      throw error;
    }
  }
  async function stagedBytes(state) {
    const before = await state.file.stat(); privateFile(before);
    need(same(fileIdentity(before), state.cursor.file) && before.size === state.selected.bytes,
      'RUBY_CONNECTED_UPLOAD_FILE_CHANGED', 'The complete original staging file changed.', 409);
    return (async function* () {
      let offset = 0;
      while (offset < state.selected.bytes) {
        const bytes = await readExactly(state.file, Math.min(MAX_CHUNK_BYTES, state.selected.bytes - offset), offset);
        offset += bytes.length;
        yield bytes;
      }
    })();
  }
  return {
    openTransfer({ transferId, source, expectedSha256 }) {
      operationId(transferId);
      return serial('file:' + transferId, async () => {
        const entry = await acquireSnapshot(transferId, source, expectedSha256);
        try { return fileView(entry.record); } finally { entry.busy = false; }
      });
    },
    transfer({ transferId }) {
      operationId(transferId);
      return serial('file:' + transferId, async () => fileView(await fileRecord(transferId)));
    },
    readTransfer({ transferId, offset, limit = 256 * 1024 }) {
      operationId(transferId);
      need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) &&
        limit >= 1 && limit <= MAX_CHUNK_BYTES, 'RUBY_CONNECTED_FILE_RANGE', 'Use a valid complete-file byte range.');
      return serial('file:' + transferId, async () => {
        const entry = await acquireSnapshot(transferId);
        try {
          need(offset <= entry.record.bytes, 'RUBY_CONNECTED_FILE_RANGE', 'The offset exceeds the original complete file.', 416);
          const bytes = await readExactly(entry.file.handle, Math.min(limit, entry.record.bytes - offset), offset);
          return { schema: FILE_SCHEMA, transferId, offset, bytes: bytes.length, nextOffset: offset + bytes.length,
            totalBytes: entry.record.bytes, fileSha256: entry.record.sha256, sha256: hash(bytes),
            encoding: 'base64', data: bytes.toString('base64'), eof: offset + bytes.length === entry.record.bytes };
        } finally { entry.busy = false; entry.lastUsed = Date.now(); }
      });
    },
    closeTransfer({ transferId }) {
      operationId(transferId);
      return serial('file:' + transferId, async () => {
        const record = await fileRecord(transferId); await closeSnapshot(transferId);
        return fileView(record);
      });
    },
    prepareUpload(input) {
      operationId(input.operationId);
      return serial('upload:' + input.operationId, async () => {
        await receiver.prepare(input);
        const path = await area(incoming, input.operationId, true);
        await once(join(path, 'request.json'), json(input));
        return uploadView(input.operationId);
      });
    },
    upload({ operationId: key }) {
      operationId(key);
      return serial('upload:' + key, () => uploadView(key));
    },
    writeUpload({ operationId: key, offset, data, sha256 }) {
      operationId(key);
      const bytes = unpack(data);
      need(hash(bytes) === sha256, 'RUBY_CONNECTED_CHUNK_SHA', 'The decoded chunk differs from its original SHA.', 409);
      need(Number.isSafeInteger(offset) && offset >= 0, 'RUBY_CONNECTED_UPLOAD_OFFSET', 'Use the durable original byte offset.');
      return serial('upload:' + key, async () => {
        const selected = await selectedUpload(key);
        if (await readJSON(join(selected.path, 'finished.json'), true)) return uploadView(key);
        const state = await writer(key);
        try {
        const committed = state.cursor.committedBytes;
        need(offset + bytes.length <= state.selected.bytes, 'RUBY_CONNECTED_UPLOAD_SIZE',
          'The chunk exceeds the selected complete archive length.', 409);
        if (offset < committed) {
          need(offset + bytes.length <= committed &&
            (await readExactly(state.file, bytes.length, offset)).equals(bytes),
            'RUBY_CONNECTED_CHUNK_CHANGED', 'The original committed bytes differ. Continue from the saved offset.', 409,
            { nextOffset: committed });
        } else {
          need(offset === committed, 'RUBY_CONNECTED_UPLOAD_OFFSET',
            'Continue at the original durable receiving offset.', 409, { nextOffset: committed });
          await writeExactly(state.file, bytes, offset); await state.file.sync();
          const cursor = { ...state.cursor, committedBytes: offset + bytes.length };
          await saveJSON(join(state.path, 'cursor.json'), cursor, true);
          state.cursor = cursor;
        }
        return { schema: CURSOR_SCHEMA, operationId: key, bytes: state.selected.bytes,
          committedBytes: state.cursor.committedBytes, nextOffset: state.cursor.committedBytes,
          phase: state.cursor.committedBytes === state.selected.bytes ? 'READY_TO_FINISH' : 'UPLOADING' };
        } catch (error) {
          // A failed cursor write can have an unknown rename outcome. Reopen
          // the same original cursor before accepting another chunk.
          await releaseWriter(key).catch(() => {}); throw error;
        }
      });
    },
    finishUpload({ operationId: key }) {
      operationId(key);
      return serial('upload:' + key, async () => {
        const status = await uploadView(key);
        if (status.phase !== 'RECEIVED') {
          const state = await writer(key);
          need(state.cursor.committedBytes === state.selected.bytes, 'RUBY_CONNECTED_UPLOAD_INCOMPLETE',
            'Continue the same archive from its durable receiving offset.', 409,
            { nextOffset: state.cursor.committedBytes });
          await receiver.write({ operationId: key, readable: await stagedBytes(state), contentLength: state.selected.bytes });
        }
        // The original receiver verifies the whole TAR and reuses the original
        // receiving UUID. Its native worker owns installation after this returns.
        const result = await receiver.commit({ operationId: key }, runtime);
        const selected = await selectedUpload(key);
        await once(join(selected.path, 'finished.json'), json({ operationId: key,
          bytes: selected.selected.bytes, sha256: selected.selected.expectedSha256 }));
        await releaseWriter(key);
        // The full verified archive now belongs to the original receiver and
        // native environment. Remove only this completed staging copy.
        try { await unlink(join(selected.path, 'archive.part')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await syncParent(join(selected.path, 'archive.part'));
        return result;
      });
    },
    retainResult(value) {
      const key = randomUUID();
      return serial('file:' + key, async () => {
      const bytes = Buffer.from(JSON.stringify(value) + '\n');
      need(bytes.length <= MAX_RESULT_BYTES, 'RUBY_CONNECTED_RESULT_SIZE',
        'Read this complete result through the local typed client; it exceeds the saved MCP result limit.', 413);
      const path = await area(outgoing, key, true);
      await once(join(path, 'result.json'), bytes);
      const body = { schema: FILE_SCHEMA, transferId: key, source: { kind: 'record' },
        name: 'result.json', bytes: bytes.length, sha256: hash(bytes), type: 'application/json' };
      const record = { ...body, selectionSha256: hashObject(body) };
      await once(join(path, 'selection.json'), json(record));
      return fileView(record);
      });
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await Promise.allSettled([...queues.values()]);
        const results = await Promise.allSettled([
          ...[...snapshots.keys()].map(closeSnapshot),
          ...[...writers.keys()].map(releaseWriter),
        ]);
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Original Ruby transfer handles could not all be closed.');
      })();
      return closePromise;
    },
  };
}
