// MIT. One workspace composes original Snowflake capture, SQLite and merchant tools.
import { randomUUID } from 'node:crypto';
import { openSnowflakeStore, canonical, sha256 } from './store.mjs';
import { compileSnowflakeSource, describeSnowflakeSource, fault } from './declaration.mjs';
import { createSnowflakeOperations } from './source.mjs';
import { materializeSnowflakeEdition, pageSnowflakeEdition, compareSnowflakeEditions,
  exportSnowflakeOriginals, readSnowflakeReceiving } from './edition.mjs';

export async function openSnowflakeWorkspace({ directory, env = process.env, transport = {} } = {}) {
  if (typeof directory !== 'string' || !directory) throw fault('SNOWFLAKE_WORKSPACE_DIRECTORY_REQUIRED');
  const store = await openSnowflakeStore(directory), operations = createSnowflakeOperations(store, { ...transport, env });
  const jobs = new Map(), publications = new Map(), receiving = new Set(); let consoleSession = null, consoleOpening = null, closed = false;
  function check() { if (closed) throw fault('SNOWFLAKE_WORKSPACE_CLOSED', undefined, 503); store.check(); }
  async function state() {
    check(); const summary = store.summary(); let source = null;
    if (summary.sourceId) {
      const selected = store.source(summary.sourceId);
      source = { ...selected, description: describeSnowflakeSource(compileSnowflakeSource(selected.config)) };
    }
    return { ...summary, source, activeJobs: [...jobs.keys()], activePublications: [...publications.keys()],
      releaseConsole: consoleSession?.operatorUrl ?? null };
  }
  function continueOperation(id) {
    check(); id = store.operation(id).id;
    if (jobs.has(id)) return jobs.get(id).promise;
    if (jobs.size >= 2) throw fault('SNOWFLAKE_WORKSPACE_BUSY', 'Two Snowflake captures are already running.', 429);
    const controller = new AbortController();
    const promise = operations.complete(id, { signal: controller.signal }).then(async result => {
      if (result.status === 'COMPLETE') await materializeSnowflakeEdition(store, result.editionId);
      return result;
    }).finally(() => jobs.delete(id));
    jobs.set(id, { controller, promise });
    // Background browser operations still retain their error on the original
    // operation. CLI/programmatic callers receive the original rejected promise.
    promise.catch(() => {});
    return promise;
  }
  async function receiveOriginalsTask(manifest, partitions) {
    check();
    const { validateSnowflakeReceivingManifest } = await import('./transfer.mjs');
    validateSnowflakeReceivingManifest(manifest);
    const sourceId = sha256(canonical(manifest.source));
    let selected;
    try { selected = store.source(sourceId); }
    catch (error) {
      if (error.code !== 'SNOWFLAKE_SOURCE_UNKNOWN') throw error;
      const current = store.summary().sourceId;
      selected = store.saveSource(manifest.source);
      if (current && current !== selected.id) store.saveSource(store.source(current).config);
    }
    const operation = await operations.receive({ sourceId: selected.id, queryName: manifest.queryName,
      arguments: manifest.arguments ?? {}, requestId: manifest.requestId, origin: manifest.origin,
      body: manifest.body, partitions, partitionCount: manifest.partitions.length });
    if (operation.status === 'COMPLETE') {
      if (manifest.editionId && manifest.editionId !== operation.editionId)
        throw fault('SNOWFLAKE_RECEIVING_EDITION_CHANGED', 'The received original content has a different edition identity.');
      await materializeSnowflakeEdition(store, operation.editionId);
    }
    return operation;
  }
  function receiveOriginals(manifest, partitions) {
    check();
    const task = receiveOriginalsTask(manifest, partitions).finally(() => receiving.delete(task));
    receiving.add(task); return task;
  }
  function prepareMerchant(input) {
    check(); const id = input.publicationId ?? randomUUID();
    const request = { ...input, publicationId: id }, requestSha256 = sha256(canonical(request));
    const pending = publications.get(id);
    if (pending) {
      if (pending.requestSha256 !== requestSha256)
        throw fault('SNOWFLAKE_PUBLICATION_CHANGED', 'This publication is already preparing its saved merchant terms.', 409);
      return pending.promise;
    }
    const promise = (async () => {
      const { prepareSnowflakeMerchant } = await import('./publisher.mjs');
      return prepareSnowflakeMerchant(store, request);
    })().finally(() => publications.delete(id));
    publications.set(id, { promise, requestSha256 });
    return promise;
  }
  return {
    directory: store.directory, store, operations, state,
    saveSource(config, expectedRevision) {
      check();
      if (Buffer.byteLength(JSON.stringify(config)) > 1048576) throw fault('SNOWFLAKE_SOURCE_TOO_LARGE');
      compileSnowflakeSource(config); return store.saveSource(config, expectedRevision);
    },
    begin(input, { background = false } = {}) {
      check();
      if (background && jobs.size >= 2) throw fault('SNOWFLAKE_WORKSPACE_BUSY', 'Two captures are already running.', 429);
      const operation = operations.begin(input);
      if (background) continueOperation(operation.id);
      return operation;
    },
    continueOperation,
    async cancel(id) {
      check(); const current = store.operation(id), job = jobs.get(current.id);
      if (job) { job.controller.abort(); await job.promise.catch(() => {}); }
      return operations.cancel(current.id);
    },
    receiveOriginals,
    async receive(filename) {
      check(); const { manifest, partitions } = await readSnowflakeReceiving(filename);
      return receiveOriginals(manifest, partitions);
    },
    async page(editionId, options) { check(); return pageSnowflakeEdition(store, editionId, options); },
    async compare(beforeId, afterId, options) { check(); return compareSnowflakeEditions(store, beforeId, afterId, options); },
    async review(editionId, input) {
      check(); await materializeSnowflakeEdition(store, editionId);
      return store.review(editionId, input);
    },
    async exportOriginals(editionId, destination, options) {
      check(); return exportSnowflakeOriginals(store, editionId, destination, options);
    },
    prepareMerchant,
    async resumeMerchant(publicationId) {
      check(); const original = store.getPublication(publicationId);
      if (!original) throw fault('SNOWFLAKE_PUBLICATION_UNKNOWN', 'The saved merchant publication was not found.', 404);
      const pending = publications.get(original.id);
      if (pending) return pending.promise;
      return prepareMerchant({ ...original.request, publicationId: original.id });
    },
    async openReleaseConsole(options = {}) {
      check();
      if (consoleSession) return { url: consoleSession.operatorUrl };
      if (!consoleOpening) consoleOpening = (async () => {
        const { openSnowflakeReleaseConsole } = await import('./publisher.mjs');
        consoleSession = await openSnowflakeReleaseConsole(store, { ...options, env });
        return { url: consoleSession.operatorUrl };
      })().finally(() => { consoleOpening = null; });
      return consoleOpening;
    },
    async close() {
      if (closed) return; closed = true;
      for (const job of jobs.values()) job.controller.abort();
      await Promise.allSettled([...jobs.values()].map(job => job.promise));
      await Promise.allSettled([...publications.values()].map(job => job.promise));
      await Promise.allSettled([...receiving]);
      await consoleOpening?.catch(() => {});
      try { await consoleSession?.close(); }
      finally { try { await operations.close(); } finally { await store.close(); } }
    },
  };
}
