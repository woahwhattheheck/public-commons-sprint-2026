// MIT. Streamed, complete Tyk source and saved-history handover.
import { constants } from 'node:fs';
import { open, link, unlink, mkdir, lstat, realpath } from 'node:fs/promises';
import { join, basename, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { SCHEMA, KINDS, MAX_BLOB_BYTES, MAX_JSON_BYTES, requestId, recordId, idFor, textHash, field } from './store.mjs';
import { digest, json, need, now, regular, saveJSON } from '../../../distribution/runtime-workspace/storage.mjs';
import { normalizeTykConnection } from '../native.mjs';

export const DELIVERY_SCHEMA = 'stellar-forge.tyk-delivery.v1';
const SNAPSHOT_SCHEMA = 'stellar-forge.tyk-delivery-snapshot.v1';
const CHUNK = 65536;
const LINE_LIMIT = MAX_JSON_BYTES + 1024 * 1024;
const reference = item => ({ kind: item.kind, id: item.id, revision: item.revision, sha256: item.sha256, bytes: item.bytes });
function operation(input, method) {
  requestId(input.requestId);
  const { signal, ...args } = input;
  return { requestId: input.requestId, requestSha256: textHash({ method, args }) };
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function fileHash(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile(), 'TYK_DELIVERY_FILE_REQUIRED');
    const hash = createHash('sha256'), buffer = Buffer.alloc(CHUNK);
    let position = 0;
    while (position < first.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, first.size-position), position);
      need(bytesRead > 0, 'TYK_DELIVERY_TRUNCATED');
      hash.update(buffer.subarray(0,bytesRead)); position += bytesRead;
    }
    const last = await handle.stat();
    need(first.dev === last.dev && first.ino === last.ino && first.size === last.size &&
      first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs, 'TYK_DELIVERY_CHANGED');
    return { sha256: hash.digest('hex'), bytes: position };
  } finally { await handle.close(); }
}
async function publishFile(temporary, destination, expected) {
  try { await link(temporary, destination); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const original = await fileHash(destination);
    need(original.sha256 === expected.sha256 && original.bytes === expected.bytes,
      'TYK_DELIVERY_COLLISION', 'This original delivery ID has different complete bytes.', 409);
  }
  await unlink(temporary); await syncDirectory(dirname(destination));
}
function selectedPath(store, value, folder) {
  need(typeof value === 'string' && value === folder + '/' + basename(value) &&
    /^[a-f0-9]{24}\.ndjson$/.test(basename(value)), 'TYK_DELIVERY_PATH_INVALID');
  return join(store.directory, value);
}
async function writePackage(store, record) {
  const snapshot = await store.getJSON(record.value.snapshot);
  need(snapshot.schema === SNAPSHOT_SCHEMA, 'TYK_DELIVERY_SNAPSHOT_INVALID');
  const destination = selectedPath(store, record.value.relativePath, 'deliveries');
  const temporary = destination + '.pending-' + randomUUID();
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const bodyHash = createHash('sha256'), completeHash = createHash('sha256');
  let bytes = 0, finished = false;
  const write = async (value, body = true) => {
    const encoded = Buffer.from(JSON.stringify(value) + '\n');
    need(encoded.length <= LINE_LIMIT, 'TYK_DELIVERY_LINE_TOO_LARGE');
    await handle.writeFile(encoded); completeHash.update(encoded);
    if (body) bodyHash.update(encoded);
    bytes += encoded.length;
  };
  try {
    await write({ type: 'header', schema: DELIVERY_SCHEMA, deliveryId: record.id,
      sourceWorkspace: snapshot.sourceWorkspace, createdAt: record.value.createdAt,
      snapshot: record.value.snapshot, chunkBytes: CHUNK });
    for (const ref of snapshot.records) {
      const original = await store.get(ref.kind, ref.id, ref.revision);
      need(original.sha256 === ref.sha256 && original.bytes === ref.bytes, 'TYK_DELIVERY_RECORD_CHANGED');
      await write({ type: 'record', record: original });
    }
    const blobs = [...snapshot.blobs, record.value.snapshot];
    for (const blob of blobs) {
      const source = await open(store.blobPath(blob), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const first = await source.stat();
        need(first.isFile() && first.size === blob.bytes, 'TYK_DELIVERY_BLOB_CHANGED');
        await write({ type: 'blob', reference: blob });
        const hash = createHash('sha256'), buffer = Buffer.alloc(CHUNK);
        let position = 0, index = 0;
        while (position < first.size) {
          const { bytesRead } = await source.read(buffer, 0, Math.min(CHUNK, first.size-position), position);
          need(bytesRead > 0, 'TYK_DELIVERY_BLOB_TRUNCATED');
          const chunk = buffer.subarray(0,bytesRead);
          hash.update(chunk);
          await write({ type: 'chunk', sha256: blob.sha256, index, data: chunk.toString('base64') });
          position += bytesRead; index++;
        }
        const last = await source.stat();
        need(first.dev === last.dev && first.ino === last.ino && first.size === last.size &&
          first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs && hash.digest('hex') === blob.sha256,
          'TYK_DELIVERY_BLOB_CHANGED');
        await write({ type: 'blob-end', sha256: blob.sha256, chunks: index, bytes: position });
      } finally { await source.close(); }
    }
    const bodySha256 = bodyHash.digest('hex');
    await write({ type: 'end', records: snapshot.records.length, blobs: blobs.length,
      sourceBytes: blobs.reduce((sum, item) => sum + item.bytes, 0), bodySha256 }, false);
    await handle.sync(); await handle.close(); finished = true;
    const file = { relativePath: record.value.relativePath, filename: 'tyk-workspace-' + record.id + '.ndjson',
      bytes, sha256: completeHash.digest('hex'), bodySha256, mediaType: 'application/x-ndjson' };
    await publishFile(temporary, destination, file);
    return file;
  } catch (error) {
    if (!finished) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
export async function exportTykDelivery(store, input) {
  const op = operation(input, 'exportWorkspace'), prior = await store.findRequest(op.requestId, op.requestSha256);
  let record = prior ? await store.get('delivery', prior.id) : null;
  if (!record) {
    const journals = await store.journals(), records = await store.allVersions();
    const snapshot = { schema: SNAPSHOT_SCHEMA, sourceWorkspace: store.identity,
      records: records.map(reference), heads: await store.heads(), blobs: await store.blobInventory(), journals };
    const snapshotRef = await store.putJSON(snapshot), id = idFor(input.requestId);
    record = await store.commit('delivery', id, { expectedRevision: 0, ...op,
      value: { label: field(input.label ?? 'Complete workspace handover', 300, true),
        state: 'PREPARING', createdAt: now(), snapshot: snapshotRef, relativePath: 'deliveries/' + id + '.ndjson',
        summary: { records: records.length, originalBlobs: snapshot.blobs.length, journals: journals.length,
          originalBytes: snapshot.blobs.reduce((sum,item) => sum+item.bytes,0) } } });
  }
  if (record.value.state === 'EXPORTED') {
    await ensureTykDeliveryFile(store, record);
    return record;
  }
  const file = await writePackage(store, record);
  return store.revise(record, { ...record.value, state: 'EXPORTED', file, completedAt: now() });
}
export async function ensureTykDeliveryFile(store, record) {
  const path = selectedPath(store, record.value.relativePath, 'deliveries');
  try {
    const found = await fileHash(path);
    need(found.sha256 === record.value.file.sha256 && found.bytes === record.value.file.bytes, 'TYK_DELIVERY_FILE_CHANGED');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const reconstructed = await writePackage(store, record);
    need(reconstructed.sha256 === record.value.file.sha256 && reconstructed.bytes === record.value.file.bytes,
      'TYK_DELIVERY_RECONSTRUCTION_CHANGED');
  }
  return { path, ...record.value.file };
}
async function eachLine(path, consume) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile(), 'TYK_DELIVERY_FILE_REQUIRED');
    let remaining = Buffer.alloc(0), position = 0, line = 0;
    const buffer = Buffer.alloc(CHUNK);
    while (position < first.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, first.size-position), position);
      need(bytesRead > 0, 'TYK_DELIVERY_TRUNCATED');
      position += bytesRead;
      remaining = Buffer.concat([remaining, buffer.subarray(0,bytesRead)]);
      let newline;
      while ((newline = remaining.indexOf(10)) >= 0) {
        const original = remaining.subarray(0,newline+1);
        need(original.length <= LINE_LIMIT && original.length > 1, 'TYK_DELIVERY_LINE_INVALID');
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(original.subarray(0,-1));
        await consume(JSON.parse(decoded), original, line++);
        remaining = remaining.subarray(newline+1);
      }
      need(remaining.length <= LINE_LIMIT, 'TYK_DELIVERY_LINE_TOO_LARGE');
    }
    need(remaining.length === 0, 'TYK_DELIVERY_TRUNCATED', 'The complete delivery must end with its original final record.');
    const last = await handle.stat();
    need(first.dev === last.dev && first.ino === last.ino && first.size === last.size &&
      first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs, 'TYK_DELIVERY_CHANGED');
    return { bytes: first.size, lines: line };
  } finally { await handle.close(); }
}
async function parsePackage(store, path, id) {
  const bodyHash = createHash('sha256'), completeHash = createHash('sha256'), records = [], blobs = [], recordKeys = new Set();
  const operationIds = new Set(), blobKeys = new Set();
  let header, ending, current = null, blobsStarted = false;
  const temporaryRoot = join(store.directory, 'incoming', id + '-parts');
  try { await mkdir(temporaryRoot, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const rootInfo = await lstat(temporaryRoot);
  need(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && await realpath(temporaryRoot) === temporaryRoot &&
    !(rootInfo.mode & 0o077), 'TYK_RECEIVING_DIRECTORY_INVALID');
  try {
    const original = await eachLine(path, async (item, raw, index) => {
      need(!ending, 'TYK_DELIVERY_TRAILING_DATA');
      completeHash.update(raw);
      if (item.type !== 'end') bodyHash.update(raw);
      if (index === 0) {
        need(item.type === 'header' && item.schema === DELIVERY_SCHEMA &&
          item.sourceWorkspace?.schema === SCHEMA && item.chunkBytes === CHUNK, 'TYK_DELIVERY_SCHEMA_INVALID');
        recordId(item.deliveryId); requestId(item.sourceWorkspace.workspaceId);
        header = item; return;
      }
      if (item.type === 'record') {
        need(!current && !blobsStarted, 'TYK_DELIVERY_ORDER_INVALID');
        const value = item.record;
        need(value?.schema === SCHEMA && KINDS.includes(value.kind), 'TYK_RECEIVED_RECORD_INVALID');
        recordId(value.id); requestId(value.requestId);
        need(Number.isSafeInteger(value.revision) && value.revision > 0 &&
          /^[a-f0-9]{64}$/.test(value.sha256) && /^[a-f0-9]{64}$/.test(value.requestSha256), 'TYK_RECEIVED_RECORD_INVALID');
        const key = value.kind + '/' + value.id + '/' + value.revision;
        need(!recordKeys.has(key) && !operationIds.has(value.requestId), 'TYK_RECEIVED_RECORD_DUPLICATE');
        const { sha256, bytes, ...saved } = value, encoded = Buffer.from(json(saved));
        need(encoded.length === bytes && digest(encoded) === sha256, 'TYK_RECEIVED_RECORD_HASH_MISMATCH');
        if (value.kind === 'connection') {
          need(textHash(normalizeTykConnection(value.value.connection)) === value.value.configurationSha256,
            'TYK_RECEIVED_CONNECTION_INVALID');
        }
        recordKeys.add(key); operationIds.add(value.requestId); records.push(value); return;
      }
      if (item.type === 'blob') {
        need(!current && item.reference && /^[a-f0-9]{64}$/.test(item.reference.sha256) &&
          Number.isSafeInteger(item.reference.bytes) && item.reference.bytes >= 0 &&
          item.reference.bytes <= MAX_BLOB_BYTES && !blobKeys.has(item.reference.sha256), 'TYK_RECEIVED_BLOB_INVALID');
        blobsStarted = true;
        const temporary = join(temporaryRoot, item.reference.sha256 + '.pending-' + randomUUID());
        current = { reference: item.reference, temporary,
          handle: await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600),
          hash: createHash('sha256'), index: 0, bytes: 0 };
        return;
      }
      if (item.type === 'chunk') {
        need(current && current.reference.sha256 === item.sha256 && item.index === current.index &&
          typeof item.data === 'string' && item.data.length <= Math.ceil(CHUNK/3)*4, 'TYK_RECEIVED_CHUNK_INVALID');
        const bytes = Buffer.from(item.data, 'base64');
        need(bytes.length > 0 && bytes.length <= CHUNK && bytes.toString('base64') === item.data &&
          current.bytes + bytes.length <= current.reference.bytes, 'TYK_RECEIVED_CHUNK_INVALID');
        await current.handle.writeFile(bytes); current.hash.update(bytes);
        current.bytes += bytes.length; current.index++; return;
      }
      if (item.type === 'blob-end') {
        need(current && current.reference.sha256 === item.sha256 && item.bytes === current.bytes &&
          item.chunks === current.index && current.bytes === current.reference.bytes &&
          current.hash.digest('hex') === current.reference.sha256, 'TYK_RECEIVED_BLOB_HASH_MISMATCH');
        await current.handle.sync(); await current.handle.close(); current.handle = null;
        await store.adoptBlobFile(current.reference, current.temporary);
        await unlink(current.temporary);
        blobKeys.add(current.reference.sha256); blobs.push(current.reference); current = null; return;
      }
      if (item.type === 'end') {
        need(header && !current && item.records === records.length && item.blobs === blobs.length &&
          item.sourceBytes === blobs.reduce((sum,blob) => sum+blob.bytes,0) &&
          item.bodySha256 === bodyHash.digest('hex'), 'TYK_DELIVERY_FINAL_HASH_MISMATCH');
        ending = item; return;
      }
      need(false, 'TYK_DELIVERY_ENTRY_UNKNOWN');
    });
    need(header && ending, 'TYK_DELIVERY_TRUNCATED');
    need(blobs.some(blob => blob.sha256 === header.snapshot.sha256 && blob.bytes === header.snapshot.bytes),
      'TYK_DELIVERY_SNAPSHOT_MISSING');
    const snapshot = await store.getJSON(header.snapshot);
    need(snapshot.schema === SNAPSHOT_SCHEMA && textHash(snapshot.sourceWorkspace) === textHash(header.sourceWorkspace) &&
      textHash(snapshot.records) === textHash(records.map(reference)) &&
      textHash([...snapshot.blobs, header.snapshot]) === textHash(blobs), 'TYK_DELIVERY_SNAPSHOT_MISMATCH');
    const groups = new Map();
    for (const item of records) {
      const key = item.kind + '/' + item.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const heads = [];
    for (const values of groups.values()) {
      values.sort((a,b) => a.revision-b.revision);
      let previous = null;
      for (let i=0; i<values.length; i++) {
        need(values[i].revision === i+1 && values[i].parentSha256 === previous, 'TYK_RECEIVED_HISTORY_INCOMPLETE');
        previous = values[i].sha256;
      }
      heads.push(reference(values.at(-1)));
    }
    const order = value => [...value].sort((a,b) => (a.kind+'/'+a.id).localeCompare(b.kind+'/'+b.id));
    need(textHash(order(heads)) === textHash(order(snapshot.heads)), 'TYK_RECEIVED_HEADS_MISMATCH');
    for (const journal of snapshot.journals) {
      recordId(journal.id);
      need(blobs.some(blob => blob.sha256 === journal.reference.sha256 && blob.bytes === journal.reference.bytes),
        'TYK_RECEIVED_JOURNAL_MISSING');
    }
    const available = new Map(blobs.map(blob => [blob.sha256,blob]));
    const checkReferences = value => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value) && typeof value.mediaType === 'string' &&
        typeof value.sha256 === 'string' && Number.isSafeInteger(value.bytes)) {
        need(available.get(value.sha256)?.bytes === value.bytes, 'TYK_RECEIVED_SOURCE_MISSING');
        return;
      }
      for (const part of Object.values(value)) checkReferences(part);
    };
    for (const record of records) checkReferences(record.value);
    return { schema: 'stellar-forge.tyk-delivery-inspection.v1', header, snapshot, records, blobs,
      original: { path, sha256: completeHash.digest('hex'), bytes: original.bytes, bodySha256: ending.bodySha256 },
      summary: { records: records.length, currentRecords: heads.length, blobs: blobs.length,
        originalBytes: ending.sourceBytes, journals: snapshot.journals.length,
        byKind: Object.fromEntries(KINDS.map(kind => [kind,heads.filter(head => head.kind === kind).length])) } };
  } finally {
    if (current?.handle) await current.handle.close().catch(() => {});
    if (current?.temporary) await unlink(current.temporary).catch(() => {});
  }
}
export async function stageTykDelivery(store, readable, input) {
  requestId(input.requestId);
  const id = idFor(input.requestId), relativePath = 'incoming/' + id + '.ndjson';
  const destination = selectedPath(store, relativePath, 'incoming');
  const temporary = destination + '.pending-' + randomUUID();
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const hash = createHash('sha256'); let bytes = 0, closed = false;
  try {
    for await (const original of readable) {
      const chunk = Buffer.from(original);
      need(Number.isSafeInteger(bytes + chunk.length), 'TYK_DELIVERY_SIZE_INVALID');
      await handle.writeFile(chunk); hash.update(chunk); bytes += chunk.length;
    }
    need(bytes > 0, 'TYK_DELIVERY_EMPTY');
    await handle.sync(); await handle.close(); closed = true;
    const received = { bytes, sha256: hash.digest('hex') };
    await publishFile(temporary, destination, received);
    return inspectTykDelivery(store, { requestId: input.requestId, path: destination,
      label: field(input.filename ?? 'Imported workspace handover', 300, true) });
  } catch (error) {
    if (!closed) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {}); throw error;
  }
}
export async function inspectTykDelivery(store, input) {
  const op = operation(input, 'inspectDelivery');
  const prior = await store.findRequest(op.requestId, op.requestSha256);
  if (prior) return store.get('receiving', prior.id);
  need(typeof input.path === 'string' && input.path === resolve(input.path) &&
    await realpath(input.path) === input.path, 'TYK_DELIVERY_ABSOLUTE_FILE_REQUIRED');
  const id = idFor(input.requestId);
  const inspected = await parsePackage(store, input.path, id);
  const manifest = await store.putJSON(inspected);
  return store.commit('receiving', id, { expectedRevision: 0, ...op, value: {
    label: field(input.label ?? 'Received workspace handover', 300, true), state: 'INSPECTED',
    sourceWorkspace: inspected.header.sourceWorkspace, sourceDeliveryId: inspected.header.deliveryId,
    manifest, manifestSha256: manifest.sha256, original: inspected.original, summary: inspected.summary,
    inspectedAt: now(),
  } });
}
export async function adoptTykDelivery(store, input) {
  const op = operation(input, 'adoptDelivery');
  let record = await store.get('receiving', recordId(input.id));
  need(input.manifestSha256 === record.value.manifestSha256, 'TYK_RECEIVING_SELECTION_CHANGED', undefined, 409);
  if (record.value.state === 'ADOPTED') return record;
  need(['INSPECTED','ADOPTING'].includes(record.value.state), 'TYK_RECEIVING_NOT_READY', undefined, 409);
  if (record.value.state === 'INSPECTED')
    need(input.expectedRevision === record.revision, 'TYK_RECORD_CONFLICT', undefined, 409);
  else need(record.value.adoptRequestId === input.requestId && record.value.adoptRequestSha256 === op.requestSha256,
    'TYK_RECEIVING_OPERATION_RUNNING', 'Resume the original receiving operation.', 409);
  const inspected = await store.getJSON(record.value.manifest);
  need(inspected.schema === 'stellar-forge.tyk-delivery-inspection.v1', 'TYK_RECEIVING_MANIFEST_INVALID');
  // Validate all collisions before publishing any imported record or current head.
  for (const original of inspected.records) {
    let local;
    try { local = await store.get(original.kind,original.id,original.revision); }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'TYK_RECORD_NOT_FOUND') throw error; }
    need(!local || local.sha256 === original.sha256, 'TYK_RECEIVED_HISTORY_CONFLICT',
      'This workspace contains a different revision of the same original record. Receive this handover in a fresh workspace.', 409);
    const reused = await store.findRequest(original.requestId, original.requestSha256);
    need(!reused || reused.sha256 === original.sha256, 'TYK_RECEIVED_REQUEST_CONFLICT', undefined, 409);
  }
  const journalWrites = [];
  for (const journal of inspected.snapshot.journals) {
    const destination = join(store.directory,'journals',journal.id+'.ndjson');
    const bytes = await store.readBlob(journal.reference);
    const complete = bytes.subarray(0,bytes.lastIndexOf(10)+1);
    let current;
    try { current = await regular(destination, MAX_JSON_BYTES); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const currentComplete = current?.subarray(0,current.lastIndexOf(10)+1);
    if (currentComplete) {
      const shared = Math.min(currentComplete.length,complete.length);
      need(currentComplete.subarray(0,shared).equals(complete.subarray(0,shared)),
        'TYK_RECEIVED_JOURNAL_CONFLICT', undefined, 409);
      if (currentComplete.length >= complete.length) continue;
    }
    if (current && current.length !== currentComplete.length)
      await store.putBlob(current,'application/x-ndjson');
    journalWrites.push({ destination, complete, current: !!current });
  }
  if (record.value.state === 'INSPECTED') {
    record = await store.commit('receiving', record.id, { expectedRevision: record.revision, ...op,
      value: { ...record.value, state: 'ADOPTING', adoptRequestId: input.requestId,
        adoptRequestSha256: op.requestSha256, adoptExpectedRevision: input.expectedRevision, adoptedAt: null } });
  }
  for (const original of inspected.records) await store.adoptRecord(original);
  for (const head of inspected.snapshot.heads) await store.adoptHead(head);
  for (const { destination, complete, current } of journalWrites) {
    const temporary = destination+'.pending-'+randomUUID();
    const handle = await open(temporary,'wx',0o600);
    try { await handle.writeFile(complete); await handle.sync(); } finally { await handle.close(); }
    if (current) {
      // Both histories were checked above and this original workspace lease is the only writer.
      const { rename } = await import('node:fs/promises');
      await rename(temporary,destination); await syncDirectory(dirname(destination));
    } else await publishFile(temporary,destination,{sha256:digest(complete),bytes:complete.length});
  }
  return store.revise(record, { ...record.value, state: 'ADOPTED', adoptedAt: now(),
    adoptedWorkspaceId: store.identity.workspaceId, adoptedHeads: inspected.snapshot.heads.length });
}
