// MIT. Complete original-workspace snapshot, archive intake and relocated receiving.
import { readdir, lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fields, canonical, sha256, fail } from '../common.mjs';
import { inspectGrpcWorkspaceBinding, inspectGrpcWorkspaceParent, assertGrpcWorkspaceBinding } from '../workspace/binding.mjs';
import { GRPC_TRANSFER_MANIFEST, GRPC_TRANSFER_ARCHIVE, GRPC_TRANSFER_MANIFEST_BYTES,
  GRPC_TRANSFER_ARCHIVE_BYTES, GRPC_TRANSFER_CHUNK_BYTES, normalizeGrpcTransferCapture,
  validateGrpcTransferManifest, validateGrpcTransferArchive, transferDescriptor,
  transferId, transferSha, transferInteger } from './manifest.mjs';
import { transferDirectory, transferRead, transferJson, transferWrite, transferRange, runArchiveHelper } from './files.mjs';
import { captureGrpcTransferSnapshot } from './snapshot.mjs';
import { createGrpcTransferUploads } from './upload.mjs';
import { inspectGrpcWorkspaceArchive, receiveGrpcWorkspaceArchive } from './receiving.mjs';

const RECORD = 'stellar-forge.grpc-workspace-transfer-operation.v1';
const RECEIPT = 'stellar-forge.grpc-workspace-transfer-receipt.v1';
const CAP = GRPC_TRANSFER_MANIFEST_BYTES + 131072;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const stamp = () => new Date().toISOString();
const safeError = issue => /^[A-Z][A-Z0-9_]{0,119}$/.test(issue?.code ?? '') ? issue.code : 'GRPC_TRANSFER_OPERATION_FAILED';
function page(rows, body, snapshot = sha256(canonical(rows))) {
  const offset = body.offset ?? 0, limit = body.limit ?? 50;
  transferInteger(offset, rows.length); transferInteger(limit, 250, 1);
  if (offset && body.expectedSnapshot === undefined || body.expectedSnapshot !== undefined && body.expectedSnapshot !== snapshot)
    fail('GRPC_TRANSFER_PAGE_CHANGED', 409);
  return { snapshot, total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null,
    items: rows.slice(offset, offset + limit) };
}
function summary(record) {
  return { schema: record.schema, id: record.id, state: record.state, createdAt: record.createdAt,
    updatedAt: record.updatedAt, phase: record.phase, progress: record.progress,
    ...(record.error ? { error: record.error } : {}),
    ...(record.archive ? { archiveSha256: record.archive.sha256, archiveBytes: record.archive.bytes,
      manifestSha256: record.archive.manifestSha256, counts: (record.manifest ?? record.archive.manifest).counts,
      origin: (record.manifest ?? record.archive.manifest).origin.directory } : {}),
    ...(record.request?.directory ? { directory: record.request.directory } : {}) };
}
export function createGrpcTransferWorkspace({ root, directory, assertHeld, visitHealthPrefixes,
  openOptions = {}, env = process.env }) {
  const exports = join(directory, 'exports'), receipts = join(directory, 'receipts'), uploadRoot = join(directory, 'uploads');
  const uploads = createGrpcTransferUploads({ directory: uploadRoot, assertHeld });
  const opened = new Map();
  let closing = false, closePromise, active = null;
  const held = () => { assertHeld(); if (closing) fail('GRPC_TRANSFER_CLOSING', 503); };
  const exportRoot = id => join(exports, transferId(id));
  const receiptPath = id => join(receipts, transferId(id) + '.json');
  async function initialize() {
    held();
    for (const path of [directory, exports, receipts, uploadRoot]) await transferDirectory(path, true);
  }
  async function originalExport(id) {
    const folder = exportRoot(id), request = await transferJson(join(folder, 'request.json'), 131072);
    if (!request || request.schema !== RECORD || request.id !== id ||
      request.inputSha256 !== sha256(canonical(request.input))) fail('GRPC_TRANSFER_NOT_FOUND', 404);
    normalizeGrpcTransferCapture(request.input);
    const record = await transferJson(join(folder, 'record.json'), CAP);
    if (record && (record.schema !== RECORD || record.id !== id || record.inputSha256 !== request.inputSha256))
      fail('GRPC_TRANSFER_RECORD_CHANGED', 409);
    return { folder, request, record };
  }
  async function read(body) {
    fields(body, ['id'], 'GRPC_TRANSFER_READ_FIELDS_INVALID');
    const original = await originalExport(body.id);
    const record = original.record ?? { schema: RECORD, id: body.id, state: 'CAPTURING',
      createdAt: original.request.createdAt, inputSha256: original.request.inputSha256 };
    if (record.archive) validateGrpcTransferArchive(record.archive);
    const manifest = record.archive?.manifest ?? await transferJson(join(original.folder, 'snapshot', GRPC_TRANSFER_MANIFEST));
    if (manifest) {
      validateGrpcTransferManifest(manifest);
      if (manifest.id !== body.id || canonical(manifest.origin.binding) !== canonical(original.request.binding))
        fail('GRPC_TRANSFER_RECORD_CHANGED', 409);
    }
    const archive = record.archive ? Object.fromEntries(Object.entries(record.archive).filter(([key]) => key !== 'manifest')) : null;
    return { ...record, ...(archive ? { archive } : {}), input: original.request.input, ...(manifest ? { manifest } : {}) };
  }
  async function list(body = {}) {
    fields(body, ['kind', 'offset', 'limit', 'expectedSnapshot'], 'GRPC_TRANSFER_LIST_FIELDS_INVALID');
    const kind = body.kind ?? 'captures';
    if (!['captures', 'receipts'].includes(kind)) fail('GRPC_TRANSFER_LIST_KIND_INVALID');
    const rows = [];
    for (const name of await readdir(kind === 'captures' ? exports : receipts)) {
      const id = kind === 'captures' ? name : name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!UUID.test(id)) continue;
      rows.push(summary(kind === 'captures' ? await read({ id }) : await receiptRecord(id)));
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return { kind, ...page(rows, body), binding: await inspectGrpcWorkspaceBinding(root),
      runtime: runtime() };
  }
  async function perform(kind, id, signal, action) {
    held();
    if (active) fail('GRPC_TRANSFER_BUSY', 409);
    const controller = new AbortController();
    const selected = { id, kind, controller, promise: null };
    active = selected;
    const joined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    selected.promise = Promise.resolve().then(() => { joined.throwIfAborted(); return action(joined); });
    try { return await selected.promise; }
    finally { if (active === selected) active = null; }
  }
  async function capture(body, { signal } = {}) {
    const input = normalizeGrpcTransferCapture(body), folder = exportRoot(input.id);
    return perform('capture', input.id, signal, async signal => {
      await transferDirectory(folder, true);
      let request = await transferJson(join(folder, 'request.json'), 131072);
      const inputSha256 = sha256(canonical(input));
      if (request) {
        if (request.schema !== RECORD || request.id !== input.id || request.inputSha256 !== inputSha256 ||
          canonical(request.input) !== canonical(input)) fail('GRPC_TRANSFER_ID_CONFLICT', 409);
      } else {
        const binding = await inspectGrpcWorkspaceBinding(root);
        if (input.expectedBinding) await assertGrpcWorkspaceBinding(root, input.expectedBinding);
        request = { schema: RECORD, id: input.id, inputSha256, input, binding, createdAt: stamp() };
        await transferWrite(join(folder, 'request.json'), request, { exclusive: true, cap: 131072 });
      }
      const old = await transferJson(join(folder, 'record.json'), CAP);
      if (old?.state === 'COMPLETED') return read({ id: input.id });
      let record = { schema: RECORD, id: input.id, inputSha256, createdAt: request.createdAt,
        updatedAt: stamp(), state: 'CAPTURING', phase: 'snapshot' };
      const save = async patch => {
        record = { ...record, ...patch, updatedAt: stamp() };
        await transferWrite(join(folder, 'record.json'), record, { cap: CAP });
      };
      try {
        await save({});
        const snapshotDirectory = join(folder, 'snapshot');
        let manifest = await transferJson(join(snapshotDirectory, GRPC_TRANSFER_MANIFEST));
        if (manifest) {
          validateGrpcTransferManifest(manifest);
          if (manifest.id !== input.id || canonical(manifest.origin.binding) !== canonical(request.binding))
            fail('GRPC_TRANSFER_ID_CONFLICT', 409);
        } else manifest = await captureGrpcTransferSnapshot({ root, directory: snapshotDirectory,
          id: input.id, expectedBinding: request.binding, maxBytes: input.maxBytes, assertHeld, visitHealthPrefixes,
          signal, onProgress: progress => save({ progress }) });
        await save({ state: 'PACKING', phase: 'archive',
          progress: { files: manifest.files.length, bytes: manifest.bytes } });
        const archive = validateGrpcTransferArchive(await runArchiveHelper({ command: 'pack', snapshotDirectory,
          archivePath: join(folder, GRPC_TRANSFER_ARCHIVE), expectedManifestSha256: manifest.sha256 }, { signal }));
        if (archive.manifestSha256 !== manifest.sha256 || archive.manifest.id !== input.id)
          fail('GRPC_TRANSFER_ARCHIVE_CHANGED', 409);
        await save({ state: 'COMPLETED', phase: 'complete', archive });
        return read({ id: input.id });
      } catch (issue) {
        await save({ state: 'FAILED', error: safeError(issue) }).catch(() => {});
        throw issue;
      }
    });
  }
  async function files(body) {
    fields(body, ['id', 'offset', 'limit', 'expectedSnapshot', 'kind', 'search'], 'GRPC_TRANSFER_FILES_FIELDS_INVALID');
    const selected = await read({ id: body.id }), manifest = selected.manifest;
    if (!manifest) fail('GRPC_TRANSFER_SNAPSHOT_NOT_COMPLETE', 409);
    if (body.search !== undefined && (typeof body.search !== 'string' || body.search.length > 512) ||
      body.kind !== undefined && !['workspace', 'health-prefix', 'observation'].includes(body.kind))
      fail('GRPC_TRANSFER_FILE_FILTER_INVALID');
    const rows = manifest.files.filter(file => (!body.kind || file.kind === body.kind) &&
      (!body.search || file.path.toLowerCase().includes(body.search.toLowerCase())));
    return { id: body.id, manifestSha256: manifest.sha256, ...page(rows, body, manifest.sha256) };
  }
  async function download(body) {
    fields(body, ['id', 'expectedManifestSha256'], 'GRPC_TRANSFER_DOWNLOAD_FIELDS_INVALID');
    transferSha(body.expectedManifestSha256);
    const selected = transferDescriptor(await read({ id: body.id }));
    if (selected.manifestSha256 !== body.expectedManifestSha256) fail('GRPC_TRANSFER_MANIFEST_CHANGED', 409);
    return { descriptor: selected, path: join(exportRoot(body.id), GRPC_TRANSFER_ARCHIVE) };
  }
  async function manifestFile(body) {
    const selected = await download(body);
    const bytes = await transferRead(join(exportRoot(body.id), 'snapshot', GRPC_TRANSFER_MANIFEST));
    const value = validateGrpcTransferManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (value.sha256 !== selected.descriptor.manifestSha256) fail('GRPC_TRANSFER_MANIFEST_CHANGED', 409);
    return { bytes, filename: GRPC_TRANSFER_MANIFEST, sha256: sha256(bytes), contentType: 'application/json' };
  }
  async function chunk(body) {
    fields(body, ['id', 'expectedManifestSha256', 'offset', 'limit'], 'GRPC_TRANSFER_CHUNK_FIELDS_INVALID');
    const selected = await download({ id: body.id, expectedManifestSha256: body.expectedManifestSha256 });
    return { id: body.id, manifestSha256: selected.descriptor.manifestSha256,
      ...await transferRange(selected.path, selected.descriptor, { offset: body.offset, limit: body.limit }) };
  }
  function selection(value) {
    fields(value, ['kind', 'id'], 'GRPC_TRANSFER_ARCHIVE_SELECTION_INVALID');
    if (!['capture', 'upload'].includes(value.kind)) fail('GRPC_TRANSFER_ARCHIVE_SELECTION_INVALID');
    return { kind: value.kind, id: transferId(value.id) };
  }
  async function archiveFile(value) {
    const selected = selection(value);
    if (selected.kind === 'upload') return uploads.archive(selected.id);
    const saved = transferDescriptor(await read({ id: selected.id }));
    return { path: join(exportRoot(selected.id), GRPC_TRANSFER_ARCHIVE), sha256: saved.sha256, bytes: saved.bytes,
      manifestSha256: saved.manifestSha256 };
  }
  async function inspect(body, { signal } = {}) {
    fields(body, ['archive'], 'GRPC_TRANSFER_INSPECT_FIELDS_INVALID');
    const source = await archiveFile(body.archive);
    return inspectGrpcWorkspaceArchive({ archivePath: source.path, expectedSha256: source.sha256,
      expectedBytes: source.bytes, expectedManifestSha256: source.manifestSha256 }, { signal });
  }
  async function receiptRecord(id) {
    const record = await transferJson(receiptPath(id), CAP);
    if (!record || record.schema !== RECEIPT || record.id !== id ||
      record.inputSha256 !== sha256(canonical(record.request))) fail('GRPC_TRANSFER_RECEIPT_NOT_FOUND', 404);
    return record;
  }
  async function receipt(body) {
    fields(body, ['id'], 'GRPC_TRANSFER_RECEIPT_FIELDS_INVALID');
    const value = await receiptRecord(body.id);
    let binding;
    if (value.state === 'COMPLETED') {
      const original = await transferJson(join(value.request.directory, '.grpc-transfer-receiving.json'), 131072);
      if (canonical(original) !== canonical(value.result.receipt)) fail('GRPC_TRANSFER_RECEIVING_CHANGED', 409);
      binding = await inspectGrpcWorkspaceBinding(value.request.directory);
    }
    return { ...value, ...(binding ? { binding } : {}), runningHere: opened.has(body.id) };
  }
  async function receive(body, { signal } = {}) {
    fields(body, ['id', 'archive', 'directory', 'expectedSha256', 'expectedBytes', 'expectedManifestSha256'],
      'GRPC_TRANSFER_RECEIVE_FIELDS_INVALID');
    const id = transferId(body.id), archive = selection(body.archive);
    transferSha(body.expectedSha256); transferSha(body.expectedManifestSha256);
    transferInteger(body.expectedBytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1);
    if (typeof body.directory !== 'string' || resolve(body.directory) !== body.directory ||
      body.directory === dirname(body.directory) || body.directory === root ||
      body.directory.startsWith(root + '/') || root.startsWith(body.directory + '/'))
      fail('GRPC_TRANSFER_DISJOINT_DESTINATION_REQUIRED');
    await inspectGrpcWorkspaceParent(body.directory);
    return perform('receive', id, signal, async signal => {
      const request = { archive, directory: body.directory, expectedSha256: body.expectedSha256,
        expectedBytes: body.expectedBytes, expectedManifestSha256: body.expectedManifestSha256 };
      const inputSha256 = sha256(canonical(request));
      let record = await transferJson(receiptPath(id), CAP);
      if (record && (record.schema !== RECEIPT || record.id !== id || record.inputSha256 !== inputSha256 ||
        canonical(record.request) !== canonical(request))) fail('GRPC_TRANSFER_RECEIVE_ID_CONFLICT', 409);
      if (record?.state === 'COMPLETED') return receipt({ id });
      record ??= { schema: RECEIPT, id, inputSha256, request, createdAt: stamp() };
      const save = async patch => {
        record = { ...record, ...patch, updatedAt: stamp() };
        if (record.state !== 'FAILED') delete record.error;
        await transferWrite(receiptPath(id), record, { cap: CAP });
      };
      await save({ state: 'RECEIVING', phase: 'archive' });
      try {
        const source = await archiveFile(archive);
        if (source.sha256 !== request.expectedSha256 || source.bytes !== request.expectedBytes ||
          source.manifestSha256 !== undefined && source.manifestSha256 !== request.expectedManifestSha256)
          fail('GRPC_TRANSFER_ARCHIVE_SELECTION_CHANGED', 409);
        const received = await receiveGrpcWorkspaceArchive({ archivePath: source.path, directory: request.directory,
          expectedSha256: request.expectedSha256, expectedBytes: request.expectedBytes,
          expectedManifestSha256: request.expectedManifestSha256, operationId: id }, { signal, env });
        await save({ state: 'COMPLETED', phase: 'complete', result: { receipt: received.receipt,
          archiveSha256: received.sha256, archiveBytes: received.bytes, manifestSha256: received.manifestSha256,
          transferId: received.manifest.id, counts: received.manifest.counts,
          environmentNames: received.manifest.environmentNames, native: received.native } });
        return receipt({ id });
      } catch (issue) { await save({ state: 'FAILED', error: safeError(issue) }).catch(() => {}); throw issue; }
    });
  }
  async function openReceived(body) {
    held(); fields(body, ['id', 'expectedBinding'], 'GRPC_TRANSFER_OPEN_FIELDS_INVALID');
    const record = await receipt({ id: body.id });
    if (record.state !== 'COMPLETED') fail('GRPC_TRANSFER_RECEIVING_NOT_COMPLETE', 409);
    await assertGrpcWorkspaceBinding(record.request.directory, body.expectedBinding);
    if (opened.has(body.id)) {
      const current = opened.get(body.id);
      return { id: body.id, directory: record.request.directory, url: current.url, binding: record.binding };
    }
    if (opened.size >= 4) fail('GRPC_TRANSFER_OPEN_CAPACITY', 409);
    const { startGrpcWorkspace } = await import('../workspace/server.mjs');
    const session = await startGrpcWorkspace({ ...openOptions, env, port: 0,
      stateDirectory: record.request.directory, expectedBinding: body.expectedBinding });
    if (closing) { await session.close(); fail('GRPC_TRANSFER_CLOSING', 503); }
    opened.set(body.id, session);
    return { id: body.id, directory: record.request.directory, url: session.url,
      binding: await inspectGrpcWorkspaceBinding(record.request.directory) };
  }
  async function closeReceived(body) {
    assertHeld(); fields(body, ['id'], 'GRPC_TRANSFER_CLOSE_FIELDS_INVALID'); transferId(body.id);
    const session = opened.get(body.id);
    if (session) { await session.close(); opened.delete(body.id); }
    return receipt({ id: body.id });
  }
  async function cancel(body) {
    assertHeld(); fields(body, ['id'], 'GRPC_TRANSFER_CANCEL_FIELDS_INVALID'); transferId(body.id);
    const selected = active;
    if (selected?.id === body.id) {
      selected.controller.abort(); await selected.promise.catch(() => {});
    }
    return { id: body.id, cancellationRequested: selected?.id === body.id, runtime: runtime() };
  }
  function runtime() {
    return { active: active ? { id: active.id, kind: active.kind } : null,
      opened: [...opened.keys()], closing };
  }
  function close() {
    if (closePromise) return closePromise;
    closing = true; active?.controller.abort();
    closePromise = (async () => {
      try { await active?.promise; } catch {}
      const owned = [...opened.entries()];
      const results = await Promise.allSettled(owned.map(async ([id, session]) => {
        await session.close(); opened.delete(id);
      }));
      const issues = results.filter(row => row.status === 'rejected').map(row => row.reason);
      if (issues.length) throw Object.assign(new AggregateError(issues, 'GRPC_TRANSFER_CLOSE_FAILED'),
        { code: 'GRPC_TRANSFER_CLOSE_FAILED' });
    })();
    return closePromise;
  }
  return { initialize, capture, list, read, files, download, manifestFile, chunk, inspect, receive, receipt, openReceived,
    closeReceived, cancel, runtime, close, upload: uploads.chunk, uploadStatus: uploads.status };
}
