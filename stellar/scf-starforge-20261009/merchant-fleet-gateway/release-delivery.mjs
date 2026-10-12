// MIT. Fleet aliases over original SF98 destinations, exchange and file readers.
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { inspectReleaseDelivery, openReleaseDeliveryWorkspace, createReleaseDeliveryTransfer,
  listReleaseDeliveryTransfers, releaseDeliveryTransferCatalog,
  readReleaseDeliveryTransferFile, releaseDeliveryPaths } from '../sf82-seller-pilot/release-delivery.mjs';
import { createDestinationsHandler, DESTINATION_OPERATION_FIELDS } from '../sf98-merchant-delivery/destinations/server.mjs';
import { tarHeader } from '../sf82-seller-pilot/release-client.mjs';
import { RetainedFileReads } from '../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';

export const DELIVERY_ACTION_FIELDS = DESTINATION_OPERATION_FIELDS;
const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = /^[a-f0-9]{64}$/;
function fields(input, allowed) {
  if (!object(input) || typeof input.tenant !== 'string' || typeof input.slot !== 'string' ||
      Object.keys(input).some(key => !['tenant', 'slot', ...allowed].includes(key)))
    throw failure('FLEET_DELIVERY_PARAMETERS');
}
const parameters = ({ tenant, slot, ...input }) => input;

export function createFleetDeliveryDesk({ planDigest, locate, getManaged }) {
  const opened = new Map(), sourceOwners = new Map(), active = new Set(), downloads = new Set();
  const reads = new RetainedFileReads({ errorPrefix: 'FLEET_DELIVERY' }), lifetime = new AbortController();
  let closing = false, closed;
  function assertOpen() { if (closing) throw failure('FLEET_DELIVERY_CLOSING', 503); }
  function selection(input, allowed = []) {
    fields(input, allowed); assertOpen();
    const selected = locate(input.tenant, input.slot);
    return { root: selected.slot.store, key: selected.key, host: selected.tenant.host,
      tenant: input.tenant, slot: input.slot };
  }
  async function scope(input, allowed = []) {
    const selected = selection(input, allowed), key = selected.key;
    let pending = opened.get(key);
    if (!pending) {
      pending = (async () => {
        const model = await openReleaseDeliveryWorkspace(selected.root);
        const other = sourceOwners.get(model.sourceDirectory);
        if (other && other !== key) { await model.close(); throw failure('FLEET_DELIVERY_SOURCE_SHARED_BETWEEN_SLOTS', 409); }
        sourceOwners.set(model.sourceDirectory, key);
        if (closing) { await model.close(); throw failure('FLEET_DELIVERY_CLOSING', 503); }
        return { ...selected, model, handlers: new Map() };
      })();
      opened.set(key, pending);
      pending.catch(() => { if (opened.get(key) === pending) opened.delete(key); });
    }
    const held = await pending; assertOpen(); return held;
  }
  const tracked = work => {
    assertOpen();
    const task = Promise.resolve().then(work); active.add(task);
    task.finally(() => active.delete(task)).catch(() => {}); return task;
  };
  const view = (input, result) => ({ tenant: input.tenant, slot: input.slot, ...result });
  const readScope = (held, id) => planDigest + '/' + held.key + '/delivery/' + id;
  async function file(input) {
    const held = selection(input, ['id', 'expectedFingerprint', 'name', 'expectedSha256', 'readId', 'offset', 'limit']);
    if (!hex.test(input.expectedFingerprint ?? '') || !hex.test(input.expectedSha256 ?? '') ||
        typeof input.name !== 'string' || typeof input.id !== 'string')
      throw failure('FLEET_DELIVERY_FILE_SELECTION_REQUIRED');
    const root = (await releaseDeliveryPaths(held.root)).directory;
    return view(input, await reads.read({ scope: readScope(held, input.id),
      key: input.expectedFingerprint + '/' + input.name, kind: 'ORIGINAL_SF98_EXCHANGE', directory: root,
      readId: input.readId, expectedSha256: input.expectedSha256, offset: input.offset, limit: input.limit,
      load: () => readReleaseDeliveryTransferFile(held.root, parameters(input)) }));
  }
  async function* originalFile(held, input, selected, signal) {
    let readId, offset = 0;
    try {
      do {
        signal.throwIfAborted();
        const result = await file({ tenant: input.tenant, slot: input.slot, id: input.id,
          expectedFingerprint: input.expectedFingerprint, name: selected.name,
          expectedSha256: selected.sha256, readId, offset, limit: 196608 });
        readId = result.readId;
        const bytes = Buffer.from(result.data, 'base64');
        if (result.offset !== offset || bytes.length !== result.bytesRead)
          throw failure('FLEET_DELIVERY_DOWNLOAD_CHANGED', 409);
        yield bytes;
        if (result.nextOffset === null) break;
        offset = result.nextOffset;
      } while (true);
    } finally { if (readId) await reads.release(readScope(held, input.id), readId); }
  }
  const api = {
    async status(input) {
      const selected = selection(input), delivery = await inspectReleaseDelivery(selected.root);
      const held = delivery.initialized ? await scope(input) : selected;
      const status = delivery.initialized ? await held.model.state() : null;
      const managed = getManaged(input.tenant, input.slot);
      return view(input, { schema: 'stellar-forge.fleet-delivery.v1', host: held.host, planDigest,
        initialized: delivery.initialized,
        producer: delivery.producer && { ...delivery.producer,
          owned: Boolean(managed && managed.observation.instanceId === delivery.producer.instanceId) },
        originalSource: delivery.originalSource, destinations: status,
        workspacePath: delivery.initialized ? '/delivery/' + input.tenant + '/' + input.slot + '/' : null,
        transferReads: reads.summary });
    },
    control(input) { return tracked(async () => {
      const held = await scope(input, ['action', 'input']);
      if (!Object.hasOwn(DELIVERY_ACTION_FIELDS, input.action) || !object(input.input) ||
          Object.keys(input.input).some(key => !DELIVERY_ACTION_FIELDS[input.action].includes(key)))
        throw failure('FLEET_DELIVERY_ACTION_INVALID');
      const method = input.action === 'pause' ? 'setPaused' : input.action;
      return view(input, { action: input.action, result: await held.model[method](input.input) });
    }); },
    async events(input) {
      const held = await scope(input, ['id', 'state', 'offset', 'limit']);
      return view(input, await held.model.events(parameters(input)));
    },
    async handoff(input) {
      const held = await scope(input);
      return view(input, { scope: { planDigest, host: held.host }, original: await held.model.handoff() });
    },
    async transfers(input) {
      const held = selection(input, ['after', 'limit']);
      return view(input, await listReleaseDeliveryTransfers(held.root, parameters(input)));
    },
    transfer(input) { return tracked(async () => {
      const held = await scope(input, ['id', 'expectedSourceFingerprint']);
      return view(input, await createReleaseDeliveryTransfer(held.root, {
        ...parameters(input), model: held.model, signal: lifetime.signal }));
    }); },
    async transferManifest(input) {
      const held = selection(input, ['id', 'expectedFingerprint']);
      return view(input, await releaseDeliveryTransferCatalog(held.root, input.id, input.expectedFingerprint));
    },
    file,
    async releaseFile(input) {
      const held = selection(input, ['id', 'readId']);
      await reads.release(readScope(held, input.id), input.readId);
      return view(input, { id: input.id, readId: input.readId, released: true });
    },
    async mount(req, res, input) {
      const held = await scope(input, ['origin']);
      if (typeof input.origin !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(input.origin) ||
          Number(new URL(input.origin).port) > 65535) throw failure('FLEET_DELIVERY_ORIGIN_REQUIRED');
      let handler = held.handlers.get(input.origin);
      if (!handler) {
        const pending = createDestinationsHandler({ model: held.model, origins: [input.origin],
          basePath: '/delivery/' + input.tenant + '/' + input.slot });
        held.handlers.set(input.origin, pending);
        pending.catch(() => { if (held.handlers.get(input.origin) === pending) held.handlers.delete(input.origin); });
        handler = pending;
      }
      return (await handler)(req, res);
    },
    sendTransfer(req, res, input) { return tracked(async () => {
      const held = selection(input, ['id', 'expectedFingerprint']);
      if (!hex.test(input.expectedFingerprint ?? '')) throw failure('FLEET_DELIVERY_TRANSFER_FINGERPRINT_REQUIRED');
      if (req.headers.range) throw failure('FLEET_DELIVERY_ARCHIVE_RANGE_UNAVAILABLE', 416);
      if (downloads.size >= 2) throw failure('FLEET_DELIVERY_DOWNLOAD_CAPACITY', 409);
      const controller = new AbortController(), abort = () => controller.abort(new Error('FLEET_DELIVERY_DOWNLOAD_CLOSED'));
      const signal = AbortSignal.any([controller.signal, lifetime.signal]);
      downloads.add(controller); res.once('close', abort);
      try {
        const manifest = await releaseDeliveryTransferCatalog(held.root, input.id, input.expectedFingerprint);
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
            yield* originalFile(held, input, selected, signal);
            if (selected.bytes % 512) yield Buffer.alloc(512 - selected.bytes % 512);
          }
          yield Buffer.alloc(1024);
        }
        await pipeline(Readable.from(archive()), createGzip({ level: 6 }), res, { signal });
      } finally { res.off('close', abort); downloads.delete(controller); }
    }); },
    get summary() { return { openedDeliveryStores: opened.size, activeDeliveryOperations: active.size,
      activeDownloads: downloads.size, ...reads.summary }; },
    close() {
      if (closed) return closed;
      closing = true; lifetime.abort(new Error('FLEET_DELIVERY_CLOSING'));
      for (const controller of downloads) controller.abort(new Error('FLEET_DELIVERY_CLOSING'));
      closed = (async () => {
        const holdings = (await Promise.allSettled([...opened.values()])).filter(row => row.status === 'fulfilled').map(row => row.value);
        const handlers = (await Promise.allSettled(holdings.flatMap(row => [...row.handlers.values()])))
          .filter(row => row.status === 'fulfilled').map(row => row.value);
        for (const handler of handlers) handler.close();
        // Abort original native sends before awaiting their HTTP/MCP callers.
        const stopped = Promise.allSettled(holdings.map(row => row.model.close()));
        await Promise.allSettled([...active]); await Promise.allSettled(handlers.map(handler => handler.done()));
        await reads.close();
        const failures = (await stopped).filter(row => row.status === 'rejected').map(row => row.reason);
        if (failures.length) throw new AggregateError(failures, 'Original delivery shutdown failed');
      })();
      return closed;
    },
  };
  return api;
}
