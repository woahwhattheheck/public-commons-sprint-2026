// MIT. File selection and transfers extend the original retained self-service request.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, need, problem } from '../../../sf30-seller-sdk/jobs/intake/protocol.mjs';
import { openInputStore } from '../../../sf30-seller-sdk/jobs/inputs/store.mjs';
import { openAllowedInput, planFromHandle } from '../../../sf30-seller-sdk/jobs/inputs/source.mjs';
import { readChunk, sameFile } from '../../../sf30-seller-sdk/jobs/inputs/files.mjs';
import { INPUT_FILES_FIELD, UPLOAD_PATH, CHUNK_BYTES, MAX_PLAN_BYTES, MAX_FILE_BYTES,
  validateFilePolicy, inputManifest, validateUploadPlan, uploadIdentity, fileUploadIdentity,
  chunkLength, validateUploadStatus, hash } from '../../../sf30-seller-sdk/jobs/inputs/protocol.mjs';

const now = () => new Date().toISOString();
const code = error => /^[A-Z][A-Z0-9_]{0,119}$/.test(error?.code ?? '') ? error.code : 'JOB_INPUT_OPERATION_FAILED';
export async function openJobInputFiles({ directory, lease, readRequest, editFile, assertEditable, assertCleanup,
  refresh, fetchJson, fileRoots = [], library, limits, maxConcurrent = 4, deadlineMs = 3600000 } = {}) {
  const operations = new Map(), remote = new Map();
  let closing = false, closePromise;
  const active = () => { lease.assertHeld(); need(!closing, 'JOB_INPUT_CUSTOMER_CLOSED', 503); };
  const store = await openInputStore({ directory, lease, limits, canDiscard: async plan => {
    const id = hash(canonical(['job-intake', plan.origin, plan.reference]));
    const row = await readRequest(id).catch(error => {
      if (error.code === 'JOB_INTAKE_REQUEST_NOT_FOUND') return null; throw error;
    });
    // A durable attempt is written only after every merchant original is
    // sealed. Cleanup may then free customer copies without changing a ticket.
    if (!row || row.requestAttempts > 0 || row.phase === 'WITHDRAWN') return true;
    const descriptor = row.input?.[INPUT_FILES_FIELD]?.[plan.slot];
    return !descriptor || fileUploadIdentity({ origin: row.merchant.origin, reference: row.reference,
      functionId: row.merchant.function.id, slot: plan.slot, file: descriptor }) !== uploadIdentity(plan);
  } });
  const identity = (row, slot, file) => fileUploadIdentity({ origin: row.merchant.origin,
    reference: row.reference, functionId: row.merchant.function.id, slot, file });
  const selected = row => inputManifest(row.merchant.function.inputFiles, row.input, { complete: false });
  async function mutable(id) { active(); const row = await readRequest(id); assertEditable(row); return row; }
  async function run(id, kind, signal, operation) {
    active(); need(!operations.has(id), 'JOB_INPUT_OPERATION_ACTIVE', 409);
    need(operations.size < maxConcurrent, 'JOB_INPUT_CUSTOMER_CAPACITY_REACHED', 429);
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    const task = { controller, public: { id: randomUUID(), kind, state: 'RUNNING',
      startedAt: now(), completedAt: null, progress: null } };
    let finish;
    task.complete = new Promise(resolve => { finish = resolve; });
    operations.set(id, task);
    const timer = setTimeout(() => controller.abort(problem('JOB_INPUT_DEADLINE', 408)), deadlineMs);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const progress = value => { task.public.progress = value; };
    try { return await operation(controller.signal, progress); }
    finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      try { await refresh(id).catch(() => {}); }
      finally { operations.delete(id); finish(); }
    }
  }
  async function beginOriginal(id, { plan, expectedRevision, source = null }, signal) {
    const row = await mutable(id); plan = validateUploadPlan(plan);
    need(row.merchant.function.inputFiles, 'JOB_INPUT_FUNCTION_FILES_NOT_CONFIGURED');
    need(plan.origin === row.merchant.origin && plan.reference === row.reference &&
      plan.functionId === row.merchant.function.id, 'JOB_INPUT_REQUEST_BINDING_CHANGED', 409);
    inputManifest(row.merchant.function.inputFiles, {
      [INPUT_FILES_FIELD]: { ...selected(row), [plan.slot]: plan.file } }, { complete: false });
    // Retain the selected descriptor in the original request before accepting
    // chunk bytes. A lost local reply reopens this same plan and reference.
    await editFile(id, { slot: plan.slot, file: plan.file, source, expectedRevision });
    signal?.throwIfAborted();
    return store.begin({ plan, token: row.claimToken });
  }
  async function selectedUpload(id, uploadId) {
    const row = await mutable(id), plan = store.plan(uploadId, row.claimToken);
    need(selected(row)[plan.slot] && identity(row, plan.slot, selected(row)[plan.slot]) === uploadId &&
      canonical(selected(row)[plan.slot]) === canonical(plan.file), 'JOB_INPUT_SELECTION_CHANGED', 409);
    return { row, plan };
  }
  async function stageHandle(id, row, source, options, signal, progress) {
    const { plan, info } = await planFromHandle({ file: source.file, origin: row.merchant.origin,
      reference: row.reference, functionId: row.merchant.function.id, slot: options.slot,
      policy: row.merchant.function.inputFiles, filename: options.filename ?? source.filename,
      contentType: options.contentType, signal, onProgress: progress });
    let state = await beginOriginal(id, { plan, expectedRevision: options.expectedRevision,
      source: source.origin }, signal);
    const uploadId = uploadIdentity(plan);
    for (const index of state.missing) {
      signal.throwIfAborted();
      state = await store.writeChunk({ id: uploadId, token: row.claimToken, index,
        body: await readChunk(source.file, chunkLength(plan, index), index * CHUNK_BYTES, signal), signal });
      progress({ phase: 'STAGING', bytes: state.receivedBytes, totalBytes: plan.file.bytes, slot: plan.slot });
    }
    need(sameFile(info, await source.file.stat()), 'JOB_INPUT_SOURCE_CHANGED', 409);
    state = await store.finish({ id: uploadId, token: row.claimToken, signal });
    return { upload: state, request: await readRequest(id) };
  }
  function cleanupCandidates(row) {
    const definition = row.merchant.function ?? { id: row.merchant.functionId };
    const descriptors = row.input?.[INPUT_FILES_FIELD] ?? row.inputFiles?.descriptors ?? {};
    return store.list({ origin: row.merchant.origin, reference: row.reference,
      functionId: definition.id }).filter(upload =>
      (row.requestAttempts > 0 || row.phase === 'WITHDRAWN' || !descriptors[upload.slot] ||
        fileUploadIdentity({ origin: upload.origin, reference: upload.reference,
          functionId: upload.functionId, slot: upload.slot, file: descriptors[upload.slot] }) !== upload.id));
  }
  function summary(row) {
    const definition = row.merchant.function ?? { id: row.merchant.functionId, inputFiles: row.inputFiles?.policy };
    if (!definition.inputFiles) return null;
    const policy = validateFilePolicy(definition.inputFiles);
    const descriptors = row.input ? inputManifest(policy, row.input, { complete: false }) :
      structuredClone(row.inputFiles?.descriptors ?? {});
    const slots = [];
    let ready = true;
    for (const [slot, rule] of Object.entries(policy.slots)) {
      const descriptor = descriptors[slot] ?? null;
      let upload = null, error = null, remoteState = null;
      if (descriptor) {
        const id = fileUploadIdentity({ origin: row.merchant.origin, reference: row.reference,
          functionId: definition.id, slot, file: descriptor });
        try { const { missing, ...view } = store.status(id); upload = view; } catch (caught) { error = code(caught); }
        remoteState = remote.get(id) ?? null;
      }
      if (rule.required && !descriptor || descriptor && upload?.state !== 'SEALED') ready = false;
      slots.push({ slot, rule: structuredClone(rule), file: descriptor, upload, remote: remoteState, error });
    }
    const cleanup = cleanupCandidates(row);
    return { policy, descriptors, slots, ready: row.requestAttempts > 0 || ready,
      merchantReceived: row.requestAttempts > 0, capacity: store.capacity(),
      cleanup: { uploads: cleanup.length, bytes: cleanup.reduce((sum, upload) => sum + upload.file.bytes, 0) },
      task: operations.has(row.id) ? structuredClone(operations.get(row.id).public) : null,
      editable: row.requestAttempts === 0 && !row.hasTicket && !row.handoffBase64 &&
        !['IMPORTED', 'WITHDRAWN'].includes(row.phase) };
  }
  function checkReady(row) {
    if (!row.merchant.function.inputFiles || row.requestAttempts > 0) return true;
    inputManifest(row.merchant.function.inputFiles, row.input);
    need(summary(row).ready, 'JOB_INPUT_LOCAL_FILES_NOT_READY', 409);
    return true;
  }
  const api = {
    directory, summary, checkReady,
    busy(id) { return operations.has(id); },
    begin(id, options = {}) { return run(id, 'file-selection', options.signal,
      signal => beginOriginal(id, options, signal)); },
    chunk(id, { uploadId, index, body, signal } = {}) {
      return run(id, 'file-staging', signal, async ownedSignal => {
        const { row } = await selectedUpload(id, uploadId);
        return store.writeChunk({ id: uploadId, token: row.claimToken, index, body, signal: ownedSignal });
      });
    },
    seal(id, { uploadId, signal } = {}) {
      return run(id, 'file-sealing', signal, async ownedSignal => {
        const { row } = await selectedUpload(id, uploadId);
        return store.finish({ id: uploadId, token: row.claimToken, signal: ownedSignal });
      });
    },
    local(id, options = {}) {
      return run(id, 'file-selection', options.signal, async (signal, progress) => {
        const row = await mutable(id);
        const source = await openAllowedInput(options.path, fileRoots);
        try {
          source.origin = { kind: 'local-file', filename: source.filename };
          const result = await stageHandle(id, row, source, options, signal, progress);
          return { upload: result.upload };
        } finally { await source.close(); }
      });
    },
    library(id, options = {}) {
      return run(id, 'library-file-selection', options.signal, async (signal, progress) => {
        const row = await mutable(id);
        need(library && typeof library.download === 'function', 'JOB_INPUT_RESOURCE_LIBRARY_REQUIRED');
        const record = library.resource(options.resourceId);
        need(record.deliveryStatus === 'SAVED' && record.status === 'VERIFIED',
          'JOB_INPUT_VERIFIED_LIBRARY_RESOURCE_REQUIRED', 409);
        const selected = await library.download(options.resourceId, { signal });
        try {
          const source = { file: selected.file, filename: options.filename ??
            record.filename ?? record.contentDispositionFilename ?? record.path.split('/').at(-1),
            origin: { kind: 'resource-library', resourceId: record.id, sha256: record.sha256,
              bytes: record.bytes, source: structuredClone(record.source ?? null) } };
          const result = await stageHandle(id, row, source, { ...options,
            contentType: options.contentType ?? record.contentType?.split(';')[0]?.trim()?.toLowerCase() ??
              'application/octet-stream' }, signal, progress);
          return { upload: result.upload, resourceId: record.id, sourceSha256: record.sha256 };
        } finally { await selected.dispose(); }
      });
    },
    searchLibrary(options = {}) {
      active(); need(library && typeof library.search === 'function', 'JOB_INPUT_RESOURCE_LIBRARY_REQUIRED');
      const result = library.search({ ...options, status: 'VERIFIED' });
      return { total: result.total, offset: result.offset, limit: result.limit,
        items: result.items.filter(value => value.deliveryStatus === 'SAVED').map(value => ({
          id: value.id, label: value.label, bytes: value.bytes, sha256: value.sha256,
          contentType: value.contentType ?? null, filename: value.filename ?? value.path?.split('/').at(-1),
          source: structuredClone(value.source ?? null), status: value.status })) };
    },
    remove(id, { slot, expectedRevision, signal } = {}) {
      return run(id, 'file-remove', signal, async ownedSignal => {
        const row = await mutable(id), descriptor = selected(row)[slot];
        need(descriptor, 'JOB_INPUT_SLOT_NOT_SELECTED', 404);
        const uploadId = identity(row, slot, descriptor);
        await editFile(id, { slot, file: null, source: null, expectedRevision });
        ownedSignal.throwIfAborted();
        try {
          const status = store.status(uploadId, row.claimToken);
          await store.discard({ id: uploadId, token: row.claimToken, expectedRevision: status.revision });
        } catch (error) { if (error.code !== 'JOB_INPUT_UPLOAD_NOT_FOUND') throw error; }
        return { slot, removed: true };
      });
    },
    cleanup(id, { expectedRevision, signal } = {}) {
      return run(id, 'file-cleanup', signal, async ownedSignal => {
        const row = await readRequest(id); assertCleanup(row, expectedRevision);
        let bytes = 0, uploads = 0;
        for (const value of cleanupCandidates(row)) {
          ownedSignal.throwIfAborted();
          await store.discard({ id: value.id, token: row.claimToken, expectedRevision: value.revision });
          bytes += value.file.bytes; uploads++;
        }
        return { uploads, bytes };
      });
    },
    withSelected(id, { slots, expectedRevision, signal } = {}, consume) {
      need(Array.isArray(slots) && slots.length > 0 && slots.length <= 16 &&
        slots.every(slot => typeof slot === 'string') && new Set(slots).size === slots.length &&
        Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && typeof consume === 'function',
        'JOB_INPUT_READ_SELECTION_INVALID');
      return run(id, 'source-read', signal, async ownedSignal => {
        const row = await readRequest(id);
        need(row.revision === expectedRevision, 'JOB_INTAKE_REVISION_CONFLICT', 409);
        const descriptors = selected(row), opened = [];
        let result, failure;
        try {
          const files = {};
          for (const slot of slots) {
            ownedSignal.throwIfAborted();
            const descriptor = descriptors[slot];
            need(descriptor, 'JOB_INPUT_SLOT_NOT_SELECTED', 404);
            const uploadId = identity(row, slot, descriptor), plan = store.plan(uploadId, row.claimToken);
            need(canonical(plan.file) === canonical(descriptor), 'JOB_INPUT_SELECTION_CHANGED', 409);
            const held = await store.openFile(uploadId, row.claimToken, { signal: ownedSignal });
            opened.push(held);
            files[slot] = { file: held.file, descriptor: structuredClone(descriptor),
              uploadId, plan: structuredClone(plan) };
          }
          result = await consume({
            requestId: row.id, revision: row.revision, reference: row.reference,
            merchant: { origin: row.merchant.origin, catalogSha256: row.merchant.catalogSha256,
              functionId: row.merchant.function.id, functionSha256: row.merchant.function.functionSha256 },
            input: structuredClone(row.input), files, signal: ownedSignal,
          });
          ownedSignal.throwIfAborted();
          for (const held of opened)
            need(sameFile(held.info, await held.file.stat()), 'JOB_INPUT_SOURCE_CHANGED', 409);
          const after = await readRequest(id);
          need(canonical(after.input) === canonical(row.input), 'JOB_INPUT_SELECTION_CHANGED', 409);
        } catch (error) { failure = error; }
        const closed = await Promise.allSettled(opened.map(held => held.file.close()));
        const errors = closed.filter(value => value.status === 'rejected').map(value => value.reason);
        if (errors.length) throw new AggregateError([...(failure ? [failure] : []), ...errors],
          'JOB_INPUT_SELECTED_READ_CLOSE_FAILED');
        if (failure) throw failure;
        return result;
      });
    },
    async upload(row, { signal, onProgress = () => {} } = {}) {
      active(); checkReady(row);
      if (!row.merchant.function.inputFiles || row.requestAttempts > 0) return;
      for (const [slot, descriptor] of Object.entries(selected(row))) {
        signal?.throwIfAborted();
        const id = identity(row, slot, descriptor), plan = store.plan(id, row.claimToken);
        const opened = await store.openFile(id, row.claimToken, { signal });
        const headers = { 'x-sfjobs-token': row.claimToken,
          ...(row.accessToken ? { 'x-sfjobs-intake-token': row.accessToken } : {}) };
        const base = row.merchant.origin + UPLOAD_PATH;
        const remember = value => {
          const status = validateUploadStatus(value, plan);
          const { missing, ...view } = status; remote.set(id, view);
          onProgress({ phase: status.state === 'SEALED' ? 'FILE_READY' : 'UPLOADING',
            slot, bytes: status.receivedBytes, totalBytes: descriptor.bytes, uploadId: id });
          return status;
        };
        try {
          let status = remember((await fetchJson(base, { method: 'POST', headers, signal,
            body: canonical({ catalogSha256: row.merchant.catalogSha256,
              functionSha256: row.merchant.function.functionSha256, plan }), maximum: MAX_PLAN_BYTES })).value);
          for (const index of status.missing) {
            signal?.throwIfAborted();
            status = remember((await fetchJson(base + '/' + id + '/chunks/' + index, {
              method: 'PUT', headers, signal, maximum: MAX_PLAN_BYTES,
              body: await readChunk(opened.file, chunkLength(plan, index), index * CHUNK_BYTES, signal) })).value);
          }
          signal?.throwIfAborted();
          const sealed = remember((await fetchJson(base + '/' + id + '/seal', {
            method: 'POST', headers, signal, body: '{}', maximum: MAX_PLAN_BYTES })).value);
          need(sealed.state === 'SEALED', 'JOB_INPUT_REMOTE_NOT_SEALED', 502);
          need(sameFile(opened.info, await opened.file.stat()), 'JOB_INPUT_SOURCE_CHANGED', 409);
        } finally { await opened.file.close(); }
      }
    },
    cancel(id) {
      const task = operations.get(id);
      if (task) {
        task.public.state = 'CANCELLING';
        task.controller.abort(problem('JOB_INPUT_OPERATION_CANCELLED', 409));
      }
      return Boolean(task);
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const id of operations.keys()) api.cancel(id);
      closePromise = (async () => {
        await Promise.allSettled([...operations.values()].map(task => task.complete));
        return store.close();
      })();
      return closePromise;
    },
  };
  return Object.freeze(api);
}
