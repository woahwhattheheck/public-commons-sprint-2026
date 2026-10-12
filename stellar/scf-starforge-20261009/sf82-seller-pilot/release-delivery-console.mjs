// MIT. Direct release-store controls over the original SF98 destination workspace.
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { inspectReleaseDelivery, openReleaseDeliveryWorkspace, createReleaseDeliveryTransfer,
  listReleaseDeliveryTransfers, inspectReleaseDeliveryTransfer, releaseDeliveryTransferCatalog,
  readReleaseDeliveryTransferFile, releaseDeliveryPaths } from './release-delivery.mjs';
import { createDestinationsHandler, DESTINATION_OPERATION_FIELDS }
  from '../sf98-merchant-delivery/destinations/server.mjs';
import { tarHeader } from './release-client.mjs';
import { RetainedFileReads } from '../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';

export const RELEASE_DELIVERY_ACTION_FIELDS = DESTINATION_OPERATION_FIELDS;
export const RELEASE_DELIVERY_CONSOLE_SCHEMA = 'stellar-forge.release-delivery-console.v1';
const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = /^[a-f0-9]{64}$/;
function fields(value, allowed = []) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw failure('RELEASE_DELIVERY_PARAMETERS');
}
function localOrigin(value) {
  let url; try { url = new URL(value); } catch { throw failure('RELEASE_DELIVERY_ORIGIN_REQUIRED'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw failure('RELEASE_DELIVERY_ORIGIN_REQUIRED');
  return url.origin;
}

/** This adapter owns only its original destination model, mounted handlers and
 * retained file reads. The existing release launcher owns the seller process. */
export function createReleaseDeliveryConsole(root, {
  getManaged = () => null, environment = process.env, basePath = '/delivery',
} = {}) {
  if (typeof root !== 'string' || !root || typeof getManaged !== 'function' ||
      !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(basePath))
    throw failure('RELEASE_DELIVERY_CONFIGURATION');
  root = resolve(root);
  const env = { ...environment }, active = new Set(), downloads = new Set();
  const reads = new RetainedFileReads({ errorPrefix: 'RELEASE_DELIVERY' });
  const lifetime = new AbortController();
  let canonical, opening, held, closing = false, closePromise;
  function assertOpen() { if (closing) throw failure('RELEASE_DELIVERY_CLOSING', 503); }
  const tracked = work => {
    assertOpen();
    const task = Promise.resolve().then(() => { assertOpen(); return work(); });
    active.add(task); task.finally(() => active.delete(task)).catch(() => {});
    return task;
  };
  async function selection(input, allowed = []) {
    fields(input, allowed); assertOpen();
    canonical ??= releaseDeliveryPaths(root);
    const paths = await canonical;
    assertOpen(); return paths;
  }
  async function scope(input = {}, allowed = []) {
    const paths = await selection(input, allowed);
    if (!opening) {
      const pending = (async () => {
        const model = await openReleaseDeliveryWorkspace(paths.root, { environment: env });
        // Record custody before checking shutdown: close() also waits this
        // opening attempt and must retain an original model whose close fails.
        held = { paths, model, handlers: new Map() };
        assertOpen(); return held;
      })();
      opening = pending;
      pending.catch(() => { if (!held && opening === pending) opening = undefined; });
    }
    await opening; assertOpen(); return held;
  }
  const view = (paths, result) => ({ releaseStore: paths.root, ...result });
  const readScope = (paths, id) => paths.root + '/settlement-delivery/' + id;
  async function fileInside(input) {
    const paths = await selection(input, ['id', 'expectedFingerprint', 'name', 'expectedSha256', 'readId', 'offset', 'limit']);
    if (!hex.test(input.expectedFingerprint ?? '') || !hex.test(input.expectedSha256 ?? '') ||
        typeof input.name !== 'string' || typeof input.id !== 'string')
      throw failure('RELEASE_DELIVERY_FILE_SELECTION_REQUIRED');
    return view(paths, await reads.read({ scope: readScope(paths, input.id),
      key: input.expectedFingerprint + '/' + input.name, kind: 'ORIGINAL_SF98_EXCHANGE',
      directory: paths.directory, readId: input.readId, expectedSha256: input.expectedSha256,
      offset: input.offset, limit: input.limit,
      load: () => readReleaseDeliveryTransferFile(paths.root, input) }));
  }
  async function* originalFile(paths, input, selected, signal) {
    let readId, offset = 0;
    try {
      do {
        signal.throwIfAborted();
        const result = await fileInside({ id: input.id, expectedFingerprint: input.expectedFingerprint,
          name: selected.name, expectedSha256: selected.sha256, readId, offset, limit: 196608 });
        readId = result.readId;
        const bytes = Buffer.from(result.data, 'base64');
        if (result.offset !== offset || bytes.length !== result.bytesRead)
          throw failure('RELEASE_DELIVERY_DOWNLOAD_CHANGED', 409);
        yield bytes;
        if (result.nextOffset === null) break;
        offset = result.nextOffset;
      } while (true);
    } finally { if (readId) await reads.release(readScope(paths, input.id), readId); }
  }
  const api = {
    status(input = {}) { return tracked(async () => {
      const paths = await selection(input), delivery = await inspectReleaseDelivery(paths.root);
      const status = delivery.initialized ? await (await scope()).model.state() : null;
      const managed = getManaged();
      return view(paths, { schema: RELEASE_DELIVERY_CONSOLE_SCHEMA, initialized: delivery.initialized,
        producer: delivery.producer && { ...delivery.producer,
          owned: Boolean(managed && managed.observation.instanceId === delivery.producer.instanceId) },
        originalSource: delivery.originalSource, destinations: status,
        workspacePath: delivery.initialized ? basePath + '/' : null, transferReads: reads.summary });
    }); },
    control(input) { return tracked(async () => {
      const current = await scope(input, ['action', 'input']);
      if (!Object.hasOwn(RELEASE_DELIVERY_ACTION_FIELDS, input.action) || !object(input.input) ||
          Object.keys(input.input).some(key => !RELEASE_DELIVERY_ACTION_FIELDS[input.action].includes(key)))
        throw failure('RELEASE_DELIVERY_ACTION_INVALID');
      const method = input.action === 'pause' ? 'setPaused' : input.action;
      return view(current.paths, { action: input.action, result: await current.model[method](input.input) });
    }); },
    events(input) { return tracked(async () => {
      const current = await scope(input, ['id', 'state', 'offset', 'limit']);
      return view(current.paths, await current.model.events(input));
    }); },
    handoff(input = {}) { return tracked(async () => {
      const current = await scope(input);
      return view(current.paths, { original: await current.model.handoff() });
    }); },
    transfers(input = {}) { return tracked(async () => {
      const paths = await selection(input, ['after', 'limit']);
      return view(paths, await listReleaseDeliveryTransfers(paths.root, input));
    }); },
    transfer(input) { return tracked(async () => {
      fields(input, ['id', 'expectedSourceFingerprint']);
      const paths = await selection(input, ['id', 'expectedSourceFingerprint']);
      // Reopen retained captures before consulting live source paths.
      // A new capture uses this adapter's original model, whose close cancels
      // native delivery before waiting for callers.
      let retained = false;
      try { await inspectReleaseDeliveryTransfer(paths.root, input.id); retained = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const model = retained ? held?.model : (await scope()).model;
      return view(paths, await createReleaseDeliveryTransfer(paths.root, {
        ...input, model, signal: lifetime.signal,
      }));
    }); },
    transferManifest(input) { return tracked(async () => {
      const paths = await selection(input, ['id', 'expectedFingerprint']);
      return view(paths, await releaseDeliveryTransferCatalog(paths.root, input.id, input.expectedFingerprint));
    }); },
    file(input) { return tracked(() => fileInside(input)); },
    releaseFile(input) { return tracked(async () => {
      const paths = await selection(input, ['id', 'readId']);
      await reads.release(readScope(paths, input.id), input.readId);
      return view(paths, { id: input.id, readId: input.readId, released: true });
    }); },
    mount(req, res, { origins } = {}) { return tracked(async () => {
      if (!Array.isArray(origins) || !origins.length) throw failure('RELEASE_DELIVERY_ORIGIN_REQUIRED');
      const selected = [...new Set(origins.map(localOrigin))].sort();
      const current = await scope(), key = JSON.stringify(selected);
      let handler = current.handlers.get(key);
      if (!handler) {
        const pending = createDestinationsHandler({ model: current.model, origins: selected, basePath });
        current.handlers.set(key, pending);
        pending.catch(() => { if (current.handlers.get(key) === pending) current.handlers.delete(key); });
        handler = pending;
      }
      return (await handler)(req, res);
    }); },
    sendTransfer(req, res, input) { return tracked(async () => {
      const paths = await selection(input, ['id', 'expectedFingerprint']);
      if (!hex.test(input.expectedFingerprint ?? '')) throw failure('RELEASE_DELIVERY_TRANSFER_FINGERPRINT_REQUIRED');
      if (req.headers.range) throw failure('RELEASE_DELIVERY_ARCHIVE_RANGE_UNAVAILABLE', 416);
      if (downloads.size >= 2) throw failure('RELEASE_DELIVERY_DOWNLOAD_CAPACITY', 409);
      const controller = new AbortController(), abort = () => controller.abort(new Error('RELEASE_DELIVERY_DOWNLOAD_CLOSED'));
      const signal = AbortSignal.any([controller.signal, lifetime.signal]);
      downloads.add(controller); res.once('close', abort);
      try {
        const manifest = await releaseDeliveryTransferCatalog(paths.root, input.id, input.expectedFingerprint);
        signal.throwIfAborted();
        res.writeHead(200, { 'content-type': 'application/gzip', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-disposition': 'attachment; filename="' + input.id + '-delivery.tar.gz"' });
        async function* archive() {
          for (const directory of manifest.directories)
            yield tarHeader(directory + '/', 0, manifest.createdAt, { directory: true });
          for (const selected of manifest.files) {
            signal.throwIfAborted();
            yield tarHeader(selected.name, selected.bytes, manifest.createdAt);
            yield* originalFile(paths, input, selected, signal);
            if (selected.bytes % 512) yield Buffer.alloc(512 - selected.bytes % 512);
          }
          yield Buffer.alloc(1024);
        }
        await pipeline(Readable.from(archive()), createGzip({ level: 6 }), res, { signal });
      } finally { res.off('close', abort); downloads.delete(controller); }
    }); },
    waitForWorker() { return tracked(async () => (await scope()).model.waitForWorker()); },
    get summary() {
      return { releaseStore: root, opened: Boolean(held), closing,
        activeOperations: active.size, activeDownloads: downloads.size, ...reads.summary };
    },
    close() {
      if (closePromise) return closePromise;
      closing = true; lifetime.abort(new Error('RELEASE_DELIVERY_CLOSING'));
      for (const controller of downloads) controller.abort(new Error('RELEASE_DELIVERY_CLOSING'));
      const attempt = (async () => {
        await Promise.allSettled(opening ? [opening] : []);
        const current = held;
        const handlers = (await Promise.allSettled(current ? [...current.handlers.values()] : []))
          .filter(row => row.status === 'fulfilled').map(row => row.value);
        for (const handler of handlers) handler.close();
        // Native model.close aborts its active signed sends. Start it before
        // waiting for HTTP/MCP callers or the original worker to drain.
        const stopped = current ? current.model.close() : Promise.resolve();
        stopped.catch(() => {});
        await Promise.allSettled([...active]);
        await Promise.allSettled(handlers.map(handler => handler.done()));
        let modelError; try { await stopped; } catch (error) { modelError = error; }
        await reads.close();
        if (modelError) throw modelError;
        if (held === current) held = undefined;
      })();
      closePromise = attempt;
      attempt.catch(() => { if (closePromise === attempt) closePromise = undefined; });
      return attempt;
    },
  };
  return api;
}
