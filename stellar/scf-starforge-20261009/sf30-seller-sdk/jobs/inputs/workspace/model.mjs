// MIT. Merchant receiving operations borrow the original input store and model lease.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, isAbsolute } from 'node:path';
import { need, object, canonical } from '../../intake/protocol.mjs';
import { INPUT_FILES_FIELD, CHUNK_BYTES } from '../protocol.mjs';
import { readChunk, sameFile, checkPrivateFile, inspectHandle, syncDirectory } from '../files.mjs';

export const INPUT_DESK_SCHEMA = 'stellar-forge.job-input-workspace.v1';
export const PREVIEW_BYTES = 262144;
const fields = (value, allowed) => need(object(value) &&
  Object.keys(value).every(key => allowed.includes(key)), 'JOB_INPUT_DESK_OPTIONS_INVALID');
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const number = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const summary = job => job ? { id: job.id, label: job.label, functionId: job.functionId,
  state: job.state, revision: job.revision, createdAt: job.createdAt, updatedAt: job.updatedAt } : null;

/** This service has no second store or writer. Close it before its owning model. */
export function openJobInputWorkspace({ model, maxReaders = 8 } = {}) {
  need(model && typeof model.snapshot === 'function' && typeof model.get === 'function',
    'JOB_MODEL_REQUIRED');
  need(number(maxReaders, 1, 16), 'JOB_INPUT_READER_LIMIT_INVALID');
  const tasks = new Set(), controllers = new Set(), retained = new Set();
  let closing = false, closePromise, readers = 0;
  const assertOpen = () => need(!closing, 'JOB_INPUT_DESK_CLOSED', 503);
  const inputs = () => { assertOpen(); need(model.inputs, 'JOB_INPUT_FUNCTION_FILES_NOT_CONFIGURED', 409); return model.inputs; };
  function task(run, signal) {
    assertOpen();
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    controllers.add(controller);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const pending = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return run(controller.signal); });
    tasks.add(pending);
    pending.finally(() => {
      tasks.delete(pending); controllers.delete(controller); signal?.removeEventListener('abort', abort);
    }).catch(() => {});
    return pending;
  }
  async function jobFor(reference) {
    try { return await model.get(reference); }
    catch (error) { if (error.code === 'JOB_NOT_FOUND') return null; throw error; }
  }
  async function detail(id) {
    const store = inputs(), upload = store.status(id), plan = store.plan(id), job = await jobFor(plan.reference);
    const current = model.configuration?.functions?.[plan.functionId]?.inputFiles ?? null;
    const configured = current?.slots?.[plan.slot] ?? null;
    const attached = job?.input?.[INPUT_FILES_FIELD]?.[plan.slot];
    const usesFile = !!(job && job.functionId === plan.functionId && attached &&
      canonical(attached) === canonical(plan.file));
    return { upload, original: plan, job: summary(job), usesFile,
      policy: { current: !!configured && current.policySha256 === plan.file.policySha256,
        configured: configured ? structuredClone(configured) : null,
        configuredPolicySha256: current?.policySha256 ?? null },
      release: { allowed: !job, orphanPin: !job && upload.pinned,
        reason: job ? 'RETAINED_JOB' : upload.pinned ? 'ORPHAN_PIN' : 'UNASSIGNED',
        revision: upload.revision } };
  }
  async function acquire(id, signal) {
    const store = inputs();
    need(readers < maxReaders, 'JOB_INPUT_READ_CAPACITY_REACHED', 429); readers++;
    let opened;
    try {
      const plan = store.plan(id), upload = store.status(id);
      need(upload.state === 'SEALED', 'JOB_INPUT_FILE_NOT_SEALED', 409);
      opened = await store.openFile(id, undefined, { signal });
      signal?.throwIfAborted(); assertOpen();
      let release;
      const resource = { file: opened.file, info: opened.info, plan,
        dispose() {
          return release ??= (async () => {
            retained.delete(resource); readers--;
            await opened.file.close();
          })();
        } };
      retained.add(resource);
      return resource;
    } catch (error) { readers--; await opened?.file.close().catch(() => {}); throw error; }
  }
  const api = {
    query(options = {}) { return task(async () => {
      assertOpen(); fields(options, ['q', 'functionId', 'reference', 'state', 'ownership', 'offset', 'limit']);
      const { q = '', functionId = '', reference = '', state = '', ownership = '', offset = 0, limit = 50 } = options;
      need(text(q, 240) && text(functionId, 56) && text(reference, 80) &&
        ['', 'UPLOADING', 'SEALED'].includes(state) &&
        ['', 'UNASSIGNED', 'ORPHAN_PIN', 'RETAINED_JOB'].includes(ownership) &&
        number(offset, 0, 1000000) && number(limit, 1, 200), 'JOB_INPUT_DESK_FILTER_INVALID');
      const snapshot = await model.snapshot(), all = model.inputs?.list() ?? [], jobs = new Map(snapshot.jobs.map(job => [job.id, job]));
      const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const rows = all.map(row => ({ ...row, job: summary(jobs.get(row.reference)),
        ownership: jobs.has(row.reference) ? 'RETAINED_JOB' : row.pinned ? 'ORPHAN_PIN' : 'UNASSIGNED' }));
      const selected = rows.filter(row => (!functionId || row.functionId === functionId) &&
        (!reference || row.reference === reference) && (!state || row.state === state) &&
        (!ownership || row.ownership === ownership) && terms.every(term =>
          [row.id, row.reference, row.functionId, row.slot, row.file.filename, row.file.sha256,
            row.job?.label ?? ''].join(' ').toLowerCase().includes(term)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      const totals = { uploading: 0, sealed: 0, unassigned: 0, orphanPins: 0, retainedJobs: 0, receivedBytes: 0 };
      for (const row of rows) {
        totals[row.state === 'SEALED' ? 'sealed' : 'uploading']++;
        totals[row.ownership === 'RETAINED_JOB' ? 'retainedJobs' : row.ownership === 'ORPHAN_PIN' ? 'orphanPins' : 'unassigned']++;
        totals.receivedBytes += row.receivedBytes;
      }
      return { schema: INPUT_DESK_SCHEMA, configured: !!model.inputs,
        serviceName: snapshot.serviceName, publicOrigin: snapshot.publicOrigin, capturedAt: new Date().toISOString(),
        capacity: model.inputs?.capacity() ?? null, readers: { active: readers, maximum: maxReaders },
        functions: snapshot.functions.filter(fn => fn.inputFiles).map(fn =>
          ({ id: fn.id, description: fn.description, inputFiles: fn.inputFiles })),
        totals, total: selected.length, offset, limit, items: selected.slice(offset, offset + limit) };
    }); },
    get(id) { return task(() => detail(id)); },
    preview(id, { signal, maxBytes = PREVIEW_BYTES } = {}) {
      need(number(maxBytes, 1, PREVIEW_BYTES), 'JOB_INPUT_PREVIEW_LIMIT_INVALID');
      return task(async ownedSignal => {
        const opened = await acquire(id, ownedSignal);
        try {
          const bytes = await readChunk(opened.file, Math.min(maxBytes, opened.plan.file.bytes), 0, ownedSignal);
          need(sameFile(opened.info, await opened.file.stat()), 'JOB_INPUT_FILE_CHANGED', 409);
          const truncated = bytes.length < opened.plan.file.bytes;
          let text = null;
          try {
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes, { stream: truncated });
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) text = null;
          } catch {}
          return { id, ...opened.plan.file, verifiedAt: new Date().toISOString(),
            previewBytes: bytes.length, truncated, text, hex: text === null ? bytes.subarray(0, 128).toString('hex') : null };
        } finally { await opened.dispose(); }
      }, signal);
    },
    download(id, { signal } = {}) {
      return task(async ownedSignal => {
        const opened = await acquire(id, ownedSignal);
        return { file: opened.file, resource: { id, name: opened.plan.file.filename },
          bytes: opened.plan.file.bytes, sha256: opened.plan.file.sha256, dispose: opened.dispose };
      }, signal);
    },
    save(id, { path, resume = false, signal, onProgress } = {}) {
      need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && path !== '/' && !path.includes('\0') &&
        typeof resume === 'boolean', 'JOB_INPUT_OUTPUT_PATH_INVALID');
      return task(async ownedSignal => {
        const source = await acquire(id, ownedSignal);
        let target, initialBytes = 0, created = false;
        try {
          const parent = dirname(path), parentInfo = await lstat(parent);
          need(parentInfo.isDirectory() && !parentInfo.isSymbolicLink() && await realpath(parent) === parent,
            'JOB_INPUT_OUTPUT_DIRECTORY_INVALID', 409);
          try { target = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true; }
          catch (error) {
            if (error.code !== 'EEXIST' || !resume) throw error;
            target = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          }
          const original = await target.stat();
          checkPrivateFile(original, source.plan.file.bytes); initialBytes = original.size;
          for (let position = 0; position < initialBytes; position += CHUNK_BYTES) {
            const count = Math.min(CHUNK_BYTES, initialBytes - position);
            const [actual, expected] = await Promise.all([
              readChunk(target, count, position, ownedSignal), readChunk(source.file, count, position, ownedSignal)]);
            need(actual.equals(expected), 'JOB_INPUT_OUTPUT_PREFIX_MISMATCH', 409);
            onProgress?.({ phase: 'VERIFYING_PREFIX', bytes: position + count, totalBytes: source.plan.file.bytes });
          }
          need(sameFile(original, await target.stat()), 'JOB_INPUT_OUTPUT_CHANGED', 409);
          for (let position = initialBytes; position < source.plan.file.bytes; position += CHUNK_BYTES) {
            const bytes = await readChunk(source.file, Math.min(CHUNK_BYTES, source.plan.file.bytes - position), position, ownedSignal);
            for (let offset = 0; offset < bytes.length;) {
              ownedSignal.throwIfAborted();
              const result = await target.write(bytes, offset, bytes.length - offset, position + offset);
              need(result.bytesWritten > 0, 'JOB_INPUT_OUTPUT_WRITE_FAILED', 500); offset += result.bytesWritten;
            }
            onProgress?.({ phase: 'COPYING', bytes: position + bytes.length, totalBytes: source.plan.file.bytes });
          }
          need(sameFile(source.info, await source.file.stat()), 'JOB_INPUT_FILE_CHANGED', 409);
          const verified = await inspectHandle(target, source.plan.file, { signal: ownedSignal });
          need(verified.sha256 === source.plan.file.sha256, 'JOB_INPUT_OUTPUT_DIGEST_MISMATCH', 409);
          await target.sync(); if (created) await syncDirectory(parent);
          return { id, path, bytes: source.plan.file.bytes, sha256: source.plan.file.sha256,
            resumedFrom: initialBytes, reused: !created && initialBytes === source.plan.file.bytes };
        } finally {
          // An interrupted private output remains available to an explicit --resume.
          try { await target?.close(); } finally { await source.dispose(); }
        }
      }, signal);
    },
    discard({ id, expectedRevision, reason, releaseOrphan = false } = {}) {
      need(number(expectedRevision, 1, Number.MAX_SAFE_INTEGER), 'JOB_INPUT_REVISION_REQUIRED', 409);
      need(text(reason, 500) && reason.trim(), 'JOB_INPUT_REASON_REQUIRED');
      need(typeof releaseOrphan === 'boolean', 'JOB_INPUT_DESK_OPTIONS_INVALID');
      return task(async () => {
        const store = inputs();
        // The original store decides under its own serial operation, including
        // the model's in-flight pin + create reservation and every retained job.
        return store.discard({ id, expectedRevision, reason, releaseOrphan });
      });
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const controller of controllers) controller.abort(new Error('JOB_INPUT_DESK_CLOSED'));
      closePromise = (async () => {
        await Promise.allSettled([...tasks]);
        const results = await Promise.allSettled([...retained].map(file => file.dispose()));
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'JOB_INPUT_DESK_CLOSE_FAILED');
        return { closed: true };
      })();
      return closePromise;
    },
  };
  return Object.freeze(api);
}
