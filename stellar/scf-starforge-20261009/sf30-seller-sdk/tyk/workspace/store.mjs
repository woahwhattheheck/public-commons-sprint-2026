// MIT. Immutable private Tyk customer records and exact native source bytes.
import { constants } from 'node:fs';
import { mkdir, open, readdir, lstat, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import {
  absolute, privateDirectory, regular, saveJSON, digest, json, canonical, need, now, operationLease,
} from '../../../distribution/runtime-workspace/storage.mjs';

export const SCHEMA = 'stellar-forge.tyk-workspace.v1';
export const KINDS = Object.freeze(['connection', 'capture', 'cohort', 'commissioning', 'rollout', 'delivery', 'receiving']);
export const MAX_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_BLOB_BYTES = 512 * 1024 * 1024;
export const textHash = value => digest(JSON.stringify(canonical(value)));
export const copy = value => JSON.parse(JSON.stringify(value));
export function recordId(value) {
  need(typeof value === 'string' && /^[a-f0-9]{24}$/.test(value), 'TYK_RECORD_ID_INVALID');
  return value;
}
export function requestId(value) {
  need(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value), 'TYK_REQUEST_ID_INVALID');
  return value;
}
export function kindName(value) {
  need(KINDS.includes(value), 'TYK_RECORD_KIND_INVALID');
  return value;
}
export function field(value, maximum = 1000, required = false) {
  need(typeof value === 'string' && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) && (!required || value.trim()), 'TYK_TEXT_INVALID');
  return value.trim();
}
export const newId = () => randomBytes(12).toString('hex');
export const idFor = value => digest(value).slice(0, 24);
const refOf = (record, bytes) => ({
  kind: record.kind, id: record.id, revision: record.revision,
  sha256: digest(bytes), bytes: bytes.length,
});
async function directory(path) {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(path);
}
async function readJson(path, optional = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(path, MAX_JSON_BYTES))); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
async function immutable(path, bytes) {
  const temporary = path + '.pending-' + randomUUID();
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  try { await link(temporary, path); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const original = await regular(path, Math.max(bytes.length, MAX_JSON_BYTES));
    need(original.equals(bytes), 'TYK_IMMUTABLE_COLLISION', 'The saved original differs from this write.', 409);
  } finally { await unlink(temporary); }
  const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
}
export async function openTykStore(input) {
  const path = absolute(input);
  await directory(path);
  const lease = await operationLease(join(path, 'owner.lock'));
  try {
    for (const name of ['heads', 'records', 'requests', 'blobs', 'deliveries', 'incoming', 'journals'])
      await directory(join(path, name));
    for (const kind of KINDS) {
      await directory(join(path, 'heads', kind));
      await directory(join(path, 'records', kind));
    }
    const identityPath = join(path, 'workspace.json');
    let identity = await readJson(identityPath, true);
    if (!identity) {
      identity = { schema: SCHEMA, workspaceId: randomUUID(), createdAt: now() };
      await saveJSON(identityPath, identity);
    }
    need(identity.schema === SCHEMA && typeof identity.workspaceId === 'string', 'TYK_WORKSPACE_SCHEMA_INVALID');
    requestId(identity.workspaceId);
    let closed = false;
    const ready = () => need(!closed, 'TYK_WORKSPACE_CLOSED', 'The workspace is closed.', 409);
    const headPath = (kind, id) => join(path, 'heads', kindName(kind), recordId(id) + '.json');
    const versionPath = (kind, id, revision) => {
      need(Number.isSafeInteger(revision) && revision > 0, 'TYK_RECORD_REVISION_INVALID');
      return join(path, 'records', kindName(kind), recordId(id), String(revision) + '.json');
    };
    async function head(kind, id) {
      ready(); return readJson(headPath(kind, id), true);
    }
    async function get(kind, id, revision) {
      ready();
      const reference = revision == null ? await head(kind, id) : null;
      need(revision != null || reference, 'TYK_RECORD_NOT_FOUND', 'The saved record was not found.', 404);
      const selected = revision ?? reference.revision;
      const bytes = await regular(versionPath(kind, id, selected), MAX_JSON_BYTES);
      if (reference) need(digest(bytes) === reference.sha256 && bytes.length === reference.bytes,
        'TYK_RECORD_HASH_MISMATCH');
      const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      need(record.schema === SCHEMA && record.kind === kind && record.id === id && record.revision === selected,
        'TYK_RECORD_IDENTITY_MISMATCH');
      return { ...record, sha256: digest(bytes), bytes: bytes.length };
    }
    async function findRequest(id, expectedHash) {
      ready();
      const reference = await readJson(join(path, 'requests', requestId(id) + '.json'), true);
      if (!reference) return null;
      need(reference.requestSha256 === expectedHash, 'TYK_REQUEST_REUSED', 'This request ID belongs to different original input.', 409);
      const record = await get(reference.kind, reference.id, reference.revision);
      need(record.requestId === id && record.requestSha256 === expectedHash &&
        record.sha256 === reference.sha256, 'TYK_REQUEST_RECORD_MISMATCH');
      return record;
    }
    async function indexRequest(record, reference) {
      await immutable(join(path, 'requests', requestId(record.requestId) + '.json'),
        Buffer.from(json({ ...reference, requestSha256: record.requestSha256 })));
    }
    async function commit(kind, id, { expectedRevision, requestId: operation, requestSha256, value }) {
      ready(); kindName(kind); recordId(id); requestId(operation);
      need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 &&
        typeof requestSha256 === 'string' && /^[a-f0-9]{64}$/.test(requestSha256), 'TYK_WRITE_INPUT_INVALID');
      const prior = await findRequest(operation, requestSha256);
      if (prior) {
        need(prior.kind === kind && prior.id === id, 'TYK_REQUEST_REUSED', undefined, 409);
        return prior;
      }
      const current = await head(kind, id), revision = expectedRevision + 1;
      await directory(join(path, 'records', kind, id));
      const candidatePath = versionPath(kind, id, revision);
      const candidate = await readJson(candidatePath, true);
      if (candidate) {
        need(candidate.requestId === operation && candidate.requestSha256 === requestSha256,
          'TYK_RECORD_CONFLICT', 'Refresh the saved record before applying this edit.', 409);
        const bytes = Buffer.from(json(candidate)), reference = refOf(candidate, bytes);
        need((current?.revision ?? 0) >= expectedRevision, 'TYK_RECORD_CHAIN_MISMATCH');
        if ((current?.revision ?? 0) === expectedRevision)
          need(candidate.parentSha256 === (current?.sha256 ?? null), 'TYK_RECORD_CHAIN_MISMATCH');
        if (current?.revision >= revision)
          need((await get(kind, id, revision)).sha256 === reference.sha256, 'TYK_RECORD_CHAIN_MISMATCH');
        if (!current || current.revision < revision) await saveJSON(headPath(kind, id), reference, !!current);
        await indexRequest(candidate, reference);
        return get(kind, id, revision);
      }
      need((current?.revision ?? 0) === expectedRevision, 'TYK_RECORD_CONFLICT',
        'Refresh the saved record before applying this edit.', 409);
      const previous = current ? await get(kind, id) : null;
      const record = {
        schema: SCHEMA, kind, id, revision, parentSha256: current?.sha256 ?? null,
        requestId: operation, requestSha256, createdAt: previous?.createdAt ?? now(), updatedAt: now(), value,
      };
      const bytes = Buffer.from(json(record));
      need(bytes.length <= MAX_JSON_BYTES, 'TYK_RECORD_TOO_LARGE', 'Store original native documents as source blobs.', 413);
      const reference = refOf(record, bytes);
      await immutable(candidatePath, bytes);
      await saveJSON(headPath(kind, id), reference, !!current);
      await indexRequest(record, reference);
      return { ...record, sha256: reference.sha256, bytes: bytes.length };
    }
    async function revise(record, value) {
      return commit(record.kind, record.id, { expectedRevision: record.revision, requestId: randomUUID(),
        requestSha256: textHash({ parent: record.sha256, value }), value });
    }
    async function heads(kind) {
      ready();
      const items = [];
      for (const selected of kind ? [kindName(kind)] : KINDS) {
        const names = (await readdir(join(path, 'heads', selected))).filter(name => /^[a-f0-9]{24}\.json$/.test(name)).sort();
        for (const name of names) {
          const reference = await readJson(join(path, 'heads', selected, name));
          need(reference.kind === selected && reference.id + '.json' === name, 'TYK_HEAD_IDENTITY_MISMATCH');
          items.push(reference);
        }
      }
      return items;
    }
    async function list({ kind, offset = 0, limit = 50, snapshot } = {}) {
      need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) &&
        limit > 0 && limit <= 500, 'TYK_PAGE_INVALID');
      const references = await heads(kind), stamp = textHash(references);
      need(!snapshot || snapshot === stamp, 'TYK_PAGE_CHANGED', 'Saved records changed. Refresh this list.', 409);
      const selected = references.slice(offset, offset + limit), items = [];
      for (const reference of selected) items.push(await get(reference.kind, reference.id, reference.revision));
      return { schema: SCHEMA, snapshot: stamp, offset, limit, total: references.length,
        nextOffset: offset + items.length < references.length ? offset + items.length : null, items };
    }
    async function allVersions() {
      ready();
      const output = [];
      for (const reference of await heads()) {
        let previous = null;
        for (let revision = 1; revision <= reference.revision; revision++) {
          const record = await get(reference.kind, reference.id, revision);
          need(record.parentSha256 === previous, 'TYK_RECORD_CHAIN_MISMATCH');
          previous = record.sha256; output.push(record);
        }
        need(previous === reference.sha256, 'TYK_RECORD_CHAIN_MISMATCH');
      }
      return output;
    }
    async function putBlob(input, mediaType = 'application/octet-stream') {
      ready();
      const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
      need(bytes.length <= MAX_BLOB_BYTES, 'TYK_SOURCE_TOO_LARGE', 'One original native source exceeds 512 MiB.', 413);
      const sha256 = digest(bytes), selected = join(path, 'blobs', sha256 + '.bin');
      try {
        const info = await lstat(selected);
        need(info.isFile() && !info.isSymbolicLink() && info.size === bytes.length, 'TYK_BLOB_COLLISION');
        const original = await regular(selected, MAX_BLOB_BYTES);
        need(digest(original) === sha256, 'TYK_BLOB_HASH_MISMATCH');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await immutable(selected, bytes);
      }
      return { sha256, bytes: bytes.length, mediaType: field(mediaType, 200, true) };
    }
    const blobPath = reference => {
      need(reference && /^[a-f0-9]{64}$/.test(reference.sha256) &&
        Number.isSafeInteger(reference.bytes) && reference.bytes >= 0 && reference.bytes <= MAX_BLOB_BYTES,
        'TYK_BLOB_REFERENCE_INVALID');
      return join(path, 'blobs', reference.sha256 + '.bin');
    };
    async function readBlob(reference) {
      ready();
      const bytes = await regular(blobPath(reference), MAX_BLOB_BYTES);
      need(bytes.length === reference.bytes && digest(bytes) === reference.sha256, 'TYK_BLOB_HASH_MISMATCH');
      return bytes;
    }
    async function putJSON(value) { return putBlob(json(value), 'application/json'); }
    async function getJSON(reference) {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBlob(reference)));
    }
    async function adoptRecord(record) {
      ready();
      const { sha256, bytes: size, ...original } = record;
      kindName(original.kind); recordId(original.id); requestId(original.requestId);
      const bytes = Buffer.from(json(original));
      need(bytes.length === size && digest(bytes) === sha256 && original.schema === SCHEMA,
        'TYK_RECEIVED_RECORD_HASH_MISMATCH');
      await directory(join(path, 'records', original.kind, original.id));
      await immutable(versionPath(original.kind, original.id, original.revision), bytes);
      await indexRequest(original, { kind: original.kind, id: original.id, revision: original.revision, sha256, bytes: size });
    }
    async function adoptHead(reference) {
      ready();
      const record = await get(reference.kind, reference.id, reference.revision);
      need(record.sha256 === reference.sha256 && record.bytes === reference.bytes, 'TYK_RECEIVED_HEAD_MISMATCH');
      const current = await head(reference.kind, reference.id);
      if (current?.revision >= reference.revision) {
        need((await get(reference.kind, reference.id, reference.revision)).sha256 === reference.sha256,
          'TYK_RECEIVED_HISTORY_CONFLICT', undefined, 409);
        return;
      }
      await saveJSON(headPath(reference.kind, reference.id), reference, !!current);
    }
    async function blobInventory() {
      ready();
      const output = [];
      for (const name of (await readdir(join(path, 'blobs'))).filter(name => /^[a-f0-9]{64}\.bin$/.test(name)).sort()) {
        const info = await lstat(join(path, 'blobs', name));
        need(info.isFile() && !info.isSymbolicLink() && info.size <= MAX_BLOB_BYTES, 'TYK_BLOB_FILE_INVALID');
        output.push({ sha256: name.slice(0,64), bytes: info.size, mediaType: 'application/octet-stream' });
      }
      return output;
    }
    async function journals() {
      ready();
      const output = [];
      for (const name of (await readdir(join(path, 'journals'))).filter(name => /^[a-f0-9]{24}\.ndjson$/.test(name)).sort()) {
        const value = await journal(name.slice(0,24));
        if (value.original) output.push({ id: name.slice(0,24), reference: value.original });
      }
      return output;
    }
    async function adoptBlobFile(reference, sourcePath) {
      ready();
      const target = blobPath(reference);
      const handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const first = await handle.stat();
        need(first.isFile() && first.size === reference.bytes, 'TYK_RECEIVED_BLOB_SIZE_MISMATCH');
        const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
        let position = 0;
        while (position < first.size) {
          const result = await handle.read(buffer, 0, Math.min(buffer.length, first.size-position), position);
          need(result.bytesRead > 0, 'TYK_RECEIVED_BLOB_TRUNCATED');
          hash.update(buffer.subarray(0,result.bytesRead)); position += result.bytesRead;
        }
        const last = await handle.stat();
        need(first.dev === last.dev && first.ino === last.ino && first.size === last.size &&
          first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs &&
          hash.digest('hex') === reference.sha256, 'TYK_RECEIVED_BLOB_HASH_MISMATCH');
        try { await link(sourcePath, target); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const original = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const firstOriginal = await original.stat(), originalHash = createHash('sha256');
            need(firstOriginal.isFile() && firstOriginal.size === reference.bytes, 'TYK_RECEIVED_BLOB_COLLISION');
            let originalPosition = 0;
            while (originalPosition < firstOriginal.size) {
              const result = await original.read(buffer, 0, Math.min(buffer.length,firstOriginal.size-originalPosition), originalPosition);
              need(result.bytesRead > 0, 'TYK_RECEIVED_BLOB_TRUNCATED');
              originalHash.update(buffer.subarray(0,result.bytesRead)); originalPosition += result.bytesRead;
            }
            const lastOriginal = await original.stat();
            need(firstOriginal.dev === lastOriginal.dev && firstOriginal.ino === lastOriginal.ino &&
              firstOriginal.size === lastOriginal.size && firstOriginal.mtimeMs === lastOriginal.mtimeMs &&
              firstOriginal.ctimeMs === lastOriginal.ctimeMs && originalHash.digest('hex') === reference.sha256,
              'TYK_RECEIVED_BLOB_COLLISION');
          } finally { await original.close(); }
        }
        const parent = await open(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY);
        try { await parent.sync(); } finally { await parent.close(); }
      } finally { await handle.close(); }
    }
    async function appendJournal(id, event) {
      ready(); recordId(id);
      const selected = join(path, 'journals', id + '.ndjson');
      const handle = await open(selected, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
      try {
        const info = await handle.stat();
        need(info.isFile() && info.nlink === 1 && !(info.mode & 0o077) && info.size <= MAX_JSON_BYTES, 'TYK_JOURNAL_FILE_INVALID');
        if (info.size) {
          const tail = Buffer.alloc(1); await handle.read(tail,0,1,info.size-1);
          if (tail[0] !== 10) {
            const original = await handle.readFile(), reference = await putBlob(original,'application/x-ndjson');
            const completeBytes = original.lastIndexOf(10)+1;
            await handle.truncate(completeBytes);
            await handle.writeFile(Buffer.from(JSON.stringify({at:now(),type:'interrupted-append',
              reference,retainedCompleteBytes:completeBytes})+'\n'));
            await handle.sync();
          }
        }
        const bytes = Buffer.from(JSON.stringify({ at: now(), ...event }) + '\n');
        need(bytes.length <= 65536, 'TYK_JOURNAL_EVENT_TOO_LARGE');
        need((await handle.stat()).size + bytes.length <= MAX_JSON_BYTES,'TYK_JOURNAL_TOO_LARGE',undefined,413);
        await handle.writeFile(bytes); await handle.sync();
      } finally { await handle.close(); }
    }
    async function journal(id) {
      ready(); recordId(id);
      try {
        const bytes = await regular(join(path, 'journals', id + '.ndjson'), MAX_JSON_BYTES);
        // A process may stop inside the final UTF-8 character or append. Keep every original byte.
        const complete = bytes.subarray(0,bytes.lastIndexOf(10)+1);
        const rows = new TextDecoder('utf-8', { fatal: true }).decode(complete).split('\n');
        return { events: rows.filter(Boolean).map(line => JSON.parse(line)), original: await putBlob(bytes, 'application/x-ndjson') };
      } catch (error) { if (error.code === 'ENOENT') return { events: [], original: null }; throw error; }
    }
    async function close() {
      if (closed) return;
      await lease.close(); closed = true;
    }
    return Object.freeze({
      directory: path, identity: copy(identity), head, get, findRequest, commit, revise, heads, list, allVersions,
      putBlob, readBlob, putJSON, getJSON, blobPath, adoptRecord, adoptHead, close,
      recordPath: versionPath, appendJournal, journal, journals, blobInventory, adoptBlobFile,
    });
  } catch (error) { await lease.close(); throw error; }
}
