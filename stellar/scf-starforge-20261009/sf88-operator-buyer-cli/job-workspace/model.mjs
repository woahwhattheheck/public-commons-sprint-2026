// MIT. Customer application over original retained paid-job buyers and resource library.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openJobBuyer, createJobBuyer } from '../../sf30-seller-sdk/jobs/buyer.mjs';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { openLibrary } from '../resource-library/library.mjs';
import { openJobCheckout } from './checkout/controller.mjs';
import { readBytes, writeBytes, exists, digest, privateDirectory } from '../node/store.mjs';
import { SCHEMA, STATES, HASH, canonicalDirectory, readCatalog, saveCatalog, catalogPath,
  buyerId, resourceId, delivered, within, now, requireValue, failure } from './state.mjs';

export async function openJobWorkspace({ directory, buyerRoots, fileRoots, transport, fetchImpl,
  requestTimeoutMs = 60000, maxConcurrent = 4, checkout: checkoutOptions = {} } = {}) {
  directory = await canonicalDirectory(directory, { privateState: true, create: true });
  requireValue(Number.isInteger(maxConcurrent) && maxConcurrent >= 1 && maxConcurrent <= 4,
    'JOB_WORKSPACE_CONCURRENCY_INVALID');
  for (const name of ['buyers','artifacts','intake','library'])
    await privateDirectory(join(directory, name));
  const lease = await acquireStateLease(directory);
  let library, checkout;
  try {
    const normalize = async roots => {
      requireValue(Array.isArray(roots) && roots.length <= 30, 'JOB_WORKSPACE_ROOTS_INVALID');
      return [...new Set(await Promise.all(roots.map(path => canonicalDirectory(path))))].sort();
    };
    let catalog;
    if (await exists(catalogPath(directory))) {
      catalog = (await readCatalog(directory)).catalog;
      if (buyerRoots !== undefined) requireValue(JSON.stringify(await normalize(buyerRoots)) === JSON.stringify(catalog.buyerRoots),
        'JOB_WORKSPACE_BUYER_ROOTS_CONFLICT', 409);
      if (fileRoots !== undefined) requireValue(JSON.stringify(await normalize(fileRoots)) === JSON.stringify(catalog.fileRoots),
        'JOB_WORKSPACE_FILE_ROOTS_CONFLICT', 409);
    } else {
      catalog = { schema: SCHEMA, directory, revision: 0, createdAt: now(), updatedAt: now(),
        buyerRoots: await normalize(buyerRoots ?? []), fileRoots: await normalize(fileRoots ?? []), entries: [] };
      await saveCatalog(directory, catalog);
    }
    // A restarted browser process reopens the original buyer state; it does not
    // silently restart a previous watch or artifact transfer.
    let interrupted = false;
    for (const entry of catalog.entries) {
      if (['RUNNING','CANCELLING'].includes(entry.lastTask?.state)) {
        entry.lastTask = { ...entry.lastTask, state: 'INTERRUPTED', completedAt: now(), error: 'CUSTOMER_PROCESS_REOPENED' };
        interrupted = true;
      }
    }
    if (interrupted) { catalog.revision++; catalog.updatedAt = now(); await saveCatalog(directory, catalog); }
    const roots = [...new Set([join(directory, 'artifacts'), ...catalog.fileRoots])].sort();
    library = await openLibrary({ state: join(directory, 'library'), kind: 'paid-jobs', source: directory,
      roots, maxFileBytes: 67108864, indexBytes: 1024 * 1024 });
    const handles = new Map(), tasks = new Map();
    let tail = Promise.resolve(), closing = false, closePromise = null, indexWork = null;
    const serial = fn => {
      const result = tail.then(() => { lease.assertHeld(); return fn(); });
      tail = result.catch(() => {}); return result;
    };
    const commit = async next => {
      next.revision = catalog.revision + 1; next.updatedAt = now();
      await saveCatalog(directory, next); catalog = next;
    };
    const row = id => {
      requireValue(typeof id === 'string' && HASH.test(id), 'JOB_WORKSPACE_ID_INVALID');
      const entry = catalog.entries.find(item => item.id === id);
      requireValue(entry, 'JOB_WORKSPACE_ENTRY_NOT_FOUND', 404); return entry;
    };
    const active = () => requireValue(!closing, 'JOB_WORKSPACE_CLOSING', 503);
    function item(entry) {
      const receipt = structuredClone(entry.receipt);
      let resultId = null, result = null;
      try {
        const saved = delivered(receipt);
        if (saved) {
          resultId = resourceId(directory, entry.id, saved.sha256);
          try { result = library.resource(resultId); } catch (error) {
            if (error.code !== 'RESOURCE_NOT_IN_CURRENT_SOURCE') throw error;
          }
        }
      } catch { /* The explicit refresh/source scan records a stale receipt error. */ }
      return { id: entry.id, directory: entry.directory, label: entry.label, archived: entry.archived,
        revision: entry.revision, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
        observedAt: entry.observedAt, receipt, lastError: entry.lastError,
        task: structuredClone(tasks.get(entry.id)?.public ?? entry.lastTask),
        resourceId: resultId, resource: result };
    }
    async function handle(entry) {
      let buyer = handles.get(entry.id);
      if (!buyer) {
        buyer = await openJobBuyer({ directory: entry.directory, transport, fetchImpl, requestTimeoutMs });
        requireValue(buyerId(await buyer.receipt()) === entry.id, 'JOB_WORKSPACE_IDENTITY_CHANGED', 409);
        handles.set(entry.id, buyer);
      }
      return buyer;
    }
    async function remember(id, receipt, lastError = null, lastTask) {
      return serial(async () => {
        const next = structuredClone(catalog), entry = next.entries.find(value => value.id === id);
        requireValue(entry && (!receipt || buyerId(receipt) === id), 'JOB_WORKSPACE_IDENTITY_CHANGED', 409);
        if (receipt) entry.receipt = receipt;
        entry.lastError = lastError; entry.observedAt = now();
        if (lastTask !== undefined) entry.lastTask = lastTask;
        await commit(next); return item(row(id));
      });
    }
    async function register(options) { return registerBuyer(options); }
    async function registerBuyer({ buyerDirectory, label = '' } = {}, finishingCheckout = false) {
      if (!finishingCheckout) active();
      buyerDirectory = await canonicalDirectory(buyerDirectory, { privateState: true });
      requireValue([join(directory, 'buyers'), ...catalog.buyerRoots].some(root => within(buyerDirectory, root)),
        'JOB_BUYER_DIRECTORY_OUTSIDE_ROOTS', 403);
      requireValue(typeof label === 'string' && label.length <= 512, 'JOB_LABEL_INVALID');
      const buyer = await openJobBuyer({ directory: buyerDirectory, transport, fetchImpl, requestTimeoutMs });
      const receipt = await buyer.receipt(), id = buyerId(receipt);
      return serial(async () => {
        if (!finishingCheckout) active();
        const existing = catalog.entries.find(entry => entry.id === id);
        if (existing) return { entry: item(existing), reused: true };
        requireValue(catalog.entries.length < 10000, 'JOB_WORKSPACE_CAPACITY_REACHED', 409);
        const next = structuredClone(catalog), timestamp = now();
        next.entries.push({ id, directory: buyerDirectory, label: label || receipt.latestStatus?.label || receipt.jobId,
          archived: false, revision: 0, createdAt: timestamp, updatedAt: timestamp, observedAt: timestamp,
          receipt, lastError: null, lastTask: null });
        await commit(next); handles.set(id, buyer);
        return { entry: item(row(id)), reused: false };
      });
    }
    async function retain({ acceptanceBytes, claimToken, handoff, label = '' } = {}) {
      active();
      requireValue(Buffer.isBuffer(acceptanceBytes) && acceptanceBytes.length > 0 && acceptanceBytes.length <= 65536,
        'JOB_ACCEPTANCE_FILE_REQUIRED');
      const sha256 = digest(acceptanceBytes), acceptanceFile = join(directory, 'intake', sha256 + '.accepted.json');
      try { await writeBytes(acceptanceFile, acceptanceBytes, { exclusive: true }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        requireValue(digest(await readBytes(acceptanceFile)) === sha256, 'JOB_ACCEPTANCE_FILE_CHANGED', 409);
      }
      const buyer = await createJobBuyer({ directory: join(directory, 'buyers', sha256),
        acceptanceFile, claimToken, handoff, transport, fetchImpl, requestTimeoutMs });
      return register({ buyerDirectory: buyer.directory, label });
    }
    async function reconcile(id) {
      active(); const entry = row(id);
      try {
        const receipt = await (await handle(entry)).receipt();
        if (entry.lastError === null && JSON.stringify(receipt) === JSON.stringify(entry.receipt)) return item(entry);
        return await remember(id, receipt);
      } catch (error) { await remember(id, null, failure(error)); throw error; }
    }
    async function update(id, { expectedRevision, label, archived } = {}) {
      return serial(async () => {
        active(); const before = row(id);
        requireValue(label !== undefined || archived !== undefined, 'JOB_WORKSPACE_UPDATE_REQUIRED');
        requireValue(expectedRevision === before.revision, 'JOB_WORKSPACE_REVISION_CONFLICT', 409);
        requireValue(label === undefined || typeof label === 'string' && label.length <= 512, 'JOB_LABEL_INVALID');
        requireValue(archived === undefined || typeof archived === 'boolean', 'JOB_ARCHIVE_INVALID');
        const next = structuredClone(catalog), entry = next.entries.find(value => value.id === id);
        if (label !== undefined) entry.label = label;
        if (archived !== undefined) entry.archived = archived;
        entry.revision++; entry.updatedAt = now();
        await commit(next); return item(row(id));
      });
    }
    async function scan(options = {}) {
      active();
      if (!indexWork) {
        indexWork = library.scan(options).finally(() => { indexWork = null; });
      }
      return indexWork;
    }
    async function execute(task) {
      let buyer, receipt = null, error = null, indexState = null;
      const deadline = Date.now() + task.deadlineMs;
      const remaining = () => {
        task.controller.signal.throwIfAborted();
        const left = deadline - Date.now();
        requireValue(left > 0, 'JOB_CUSTOMER_DEADLINE', 408); return left;
      };
      try {
        buyer = await handle(row(task.entryId));
        const signal = task.controller.signal;
        if (task.public.kind === 'refresh') await buyer.inspect({ signal, deadlineMs: remaining() });
        if (task.public.kind === 'watch') await buyer.wait({ signal, deadlineMs: remaining(), pollMs: task.pollMs });
        if (task.public.kind === 'fetch') {
          const before = await buyer.receipt();
          if (before.latestStatus?.state !== 'COMPLETED')
            await buyer.wait({ signal, deadlineMs: remaining(), pollMs: task.pollMs });
          const prior = delivered(await buyer.receipt());
          const destination = prior && roots.some(root => within(prior.path, root))
            ? prior.path : join(directory, 'artifacts', task.entryId + '.result');
          await buyer.download({ destination, signal, deadlineMs: remaining() });
        }
        receipt = await buyer.receipt();
        await remember(task.entryId, receipt);
        if (task.public.kind === 'fetch') {
          try {
            await scan({ signal: task.controller.signal });
            indexState = library.resource(resourceId(directory, task.entryId, receipt.delivery.sha256)).status;
          }
          catch (scanError) { indexState = failure(scanError); }
        }
      } catch (caught) {
        error = task.controller.signal.aborted ? 'JOB_CUSTOMER_OPERATION_CANCELLED' : failure(caught);
        if (buyer) { try { receipt = await buyer.receipt(); } catch { /* Retain the original task error. */ } }
      } finally {
        const result = { ...task.public, state: error ? task.controller.signal.aborted ? 'CANCELLED' : 'FAILED' : 'COMPLETE',
          completedAt: now(), error, indexState };
        task.public = result;
        try { await remember(task.entryId, receipt, error, result); }
        finally { tasks.delete(task.entryId); }
      }
    }
    function start(id, { kind = 'refresh', deadlineMs = 300000, pollMs = 1500 } = {}) {
      return serial(async () => {
        active(); const entry = row(id);
        requireValue(['refresh','watch','fetch'].includes(kind), 'JOB_CUSTOMER_OPERATION_INVALID');
        requireValue(Number.isSafeInteger(deadlineMs) && deadlineMs >= 100 && deadlineMs <= 3600000 &&
          Number.isSafeInteger(pollMs) && pollMs >= 100 && pollMs <= 30000, 'JOB_CUSTOMER_DEADLINE_INVALID');
        const current = tasks.get(id);
        if (current) {
          requireValue(current.public.kind === kind, 'JOB_CUSTOMER_OPERATION_ACTIVE', 409); return item(entry);
        }
        requireValue(tasks.size < maxConcurrent, 'JOB_CUSTOMER_CAPACITY_REACHED', 429);
        const task = { entryId: id, deadlineMs, pollMs, controller: new AbortController(),
          public: { id: randomUUID(), kind, state: 'RUNNING', startedAt: now(), completedAt: null, error: null, indexState: null } };
        const next = structuredClone(catalog);
        next.entries.find(value => value.id === id).lastTask = task.public;
        await commit(next); tasks.set(id, task);
        task.promise = execute(task);
        // The retained task exposes failure to the operator; close also drains it.
        task.promise.catch(() => {});
        return item(row(id));
      });
    }
    async function cancel(id) {
      return serial(async () => {
        active(); row(id);
        const task = tasks.get(id);
        if (!task) return item(row(id));
        task.public = { ...task.public, state: 'CANCELLING' };
        task.controller.abort(Object.assign(new Error('JOB_CUSTOMER_OPERATION_CANCELLED'), { code: 'JOB_CUSTOMER_OPERATION_CANCELLED' }));
        return item(row(id));
      });
    }
    function list({ q = '', state = '', view = 'active', offset = 0, limit = 50 } = {}) {
      requireValue(typeof q === 'string' && q.length <= 1000 && ['', ...STATES].includes(state) &&
        ['active','archived','all'].includes(view) && Number.isSafeInteger(offset) && offset >= 0 &&
        Number.isSafeInteger(limit) && limit >= 1 && limit <= 200, 'JOB_WORKSPACE_FILTER_INVALID');
      const text = q.toLocaleLowerCase();
      const found = catalog.entries.filter(entry =>
        (view === 'all' || entry.archived === (view === 'archived')) &&
        (!state || (entry.receipt.latestStatus?.state ?? 'AWAITING_SETTLEMENT') === state) &&
        [entry.label, entry.receipt.jobId, entry.receipt.acceptance.functionId, entry.receipt.acceptance.statusUrl]
          .join(' ').toLocaleLowerCase().includes(text))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      return { total: found.length, offset, limit, items: found.slice(offset, offset + limit).map(item) };
    }
    function status() {
      const counts = {};
      for (const entry of catalog.entries) {
        const state = entry.receipt.latestStatus?.state ?? 'AWAITING_SETTLEMENT';
        counts[state] = (counts[state] ?? 0) + 1;
      }
      return { schema: SCHEMA, directory, revision: catalog.revision,
        buyerRoots: [...catalog.buyerRoots], fileRoots: [...roots], entries: catalog.entries.length,
        counts, capacity: maxConcurrent, active: [...tasks.values()].map(task => ({ entryId: task.entryId, ...task.public })),
        library: library.status(), checkout: checkout.status(), closing };
    }
    checkout = await openJobCheckout({ ...checkoutOptions, directory: join(directory, 'checkout'), lease,
      adopt: async ({ result, handoff, label }) => {
        const acceptedBytes = Buffer.from(await result.bytes({ limit: 65536 }));
        const buyer = await createJobBuyer({ directory: join(directory, 'buyers', digest(acceptedBytes)),
          result, handoff, transport, fetchImpl, requestTimeoutMs });
        return registerBuyer({ buyerDirectory: buyer.directory, label }, true);
      },
    });
    return Object.freeze({ directory, library, checkout, register, retain, reconcile, update, start, cancel, scan, list, status,
      get(id) { return item(row(id)); },
      async wait(id) {
        const task = tasks.get(id);
        if (task) await task.promise;
        return item(row(id));
      },
      close() {
        if (closePromise) return closePromise;
        closing = true;
        closePromise = (async () => {
          await tail;
          for (const task of tasks.values()) task.controller.abort(new Error('JOB_WORKSPACE_CLOSED'));
          const results = await Promise.allSettled([checkout.close(), ...[...tasks.values()].map(task => task.promise)]);
          // Checkout may have finished accepting a paid result while draining.
          // Its final catalog write uses this same lease and must finish first.
          await tail;
          try { await library.close(); } catch (error) { results.push({ status: 'rejected', reason: error }); }
          try { await lease.close(); } catch (error) { results.push({ status: 'rejected', reason: error }); }
          const rejected = results.filter(value => value.status === 'rejected');
          if (rejected.length) throw new AggregateError(rejected.map(value => value.reason), 'JOB_WORKSPACE_CLOSE_FAILED');
        })();
        return closePromise;
      },
    });
  } catch (error) {
    const cleanup = await Promise.allSettled([checkout?.close(), library?.close()]);
    try { await lease.close(); } catch (closed) { cleanup.push({ status: 'rejected', reason: closed }); }
    const failures = cleanup.filter(value => value.status === 'rejected').map(value => value.reason);
    if (failures.length) throw new AggregateError([error, ...failures], 'JOB_WORKSPACE_OPEN_FAILED');
    throw error;
  }
}
