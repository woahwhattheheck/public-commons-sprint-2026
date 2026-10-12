// MIT. Shared private browser delivery of the original already-verified file handle.
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { requireValue } from './files.mjs';

export function createVerifiedDownloads({ prefix = '/transfer/', capacity = 4, ttlMs = 60000 } = {}) {
  requireValue(/^\/[A-Za-z0-9_-]+\/$/.test(prefix) && Number.isInteger(capacity) && capacity >= 1 && capacity <= 16 &&
    Number.isInteger(ttlMs) && ttlMs >= 1000 && ttlMs <= 120000, 'DOWNLOAD_SETTINGS_INVALID');
  const tickets = new Map(), owned = new Set(), pending = new Set(), controllers = new Set();
  let slots = 0, closing = false, closePromise;
  function task(run, signal) {
    requireValue(!closing, 'SERVER_CLOSING', 503);
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    controllers.add(controller);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const work = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return run(controller.signal); });
    pending.add(work);
    work.finally(() => { pending.delete(work); controllers.delete(controller); signal?.removeEventListener('abort', abort); }).catch(() => {});
    return work;
  }
  function register(produce, { signal } = {}) {
    requireValue(typeof produce === 'function', 'DOWNLOAD_PRODUCER_REQUIRED');
    return task(async ownedSignal => {
      requireValue(slots < capacity, 'DOWNLOAD_CAPACITY_REACHED', 429); slots++;
      let saved, published = false;
      try {
        saved = await produce(ownedSignal);
        ownedSignal.throwIfAborted(); requireValue(!closing, 'SERVER_CLOSING', 503);
        requireValue(saved && Number.isSafeInteger(saved.bytes) && saved.bytes >= 0 &&
          /^[a-f0-9]{64}$/.test(saved.sha256 ?? '') && typeof saved.dispose === 'function' &&
          typeof saved.file?.createReadStream === 'function' && typeof saved.resource?.id === 'string' &&
          typeof saved.resource?.name === 'string', 'VERIFIED_DOWNLOAD_REQUIRED');
        const key = randomBytes(24).toString('hex');
        let releasePromise;
        const transfer = { saved, release() {
          return releasePromise ??= (async () => {
            slots--; owned.delete(transfer); tickets.delete(key); clearTimeout(transfer.timer);
            await saved.dispose();
          })();
        } };
        transfer.timer = setTimeout(() => { void transfer.release().catch(() => {}); }, ttlMs);
        transfer.timer.unref(); tickets.set(key, transfer); owned.add(transfer); published = true;
        return { url: prefix + key, bytes: saved.bytes, sha256: saved.sha256 };
      } finally {
        if (!published) { slots--; if (typeof saved?.dispose === 'function') await saved.dispose(); }
      }
    }, signal);
  }
  function serve({ request, response, path, signal } = {}) {
    if (typeof path !== 'string' || !path.startsWith(prefix) || request.method !== 'GET') return Promise.resolve(false);
    return task(async ownedSignal => {
      const key = path.slice(prefix.length), transfer = /^[a-f0-9]{48}$/.test(key) && tickets.get(key);
      requireValue(transfer, 'DOWNLOAD_EXPIRED', 404);
      tickets.delete(key); clearTimeout(transfer.timer);
      try {
        ownedSignal.throwIfAborted();
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': transfer.saved.bytes,
          'X-Content-SHA256': transfer.saved.sha256,
          'Content-Disposition': 'attachment; filename="resource-' + transfer.saved.resource.id.slice(0, 12).replace(/[^A-Za-z0-9._-]/g, '_') +
            '"; filename*=UTF-8\'\'' + encodeURIComponent(transfer.saved.resource.name).replaceAll("'", '%27') });
        await pipeline(transfer.saved.file.createReadStream({ start: 0, autoClose: false }), response, { signal: ownedSignal });
      } finally { await transfer.release(); }
      return true;
    }, signal);
  }
  return Object.freeze({ register, serve,
    status() { return { capacity, occupied: slots, tickets: tickets.size, closing }; },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const controller of controllers) controller.abort(new Error('SERVER_CLOSED'));
      closePromise = (async () => {
        await Promise.allSettled([...pending]);
        const releases = await Promise.allSettled([...owned].map(transfer => transfer.release()));
        tickets.clear();
        const failures = releases.filter(item => item.status === 'rejected').map(item => item.reason);
        if (failures.length) throw new AggregateError(failures, 'DOWNLOAD_CLOSE_FAILED');
        // Request failures stay with their actual HTTP operations.
        return { closed: true };
      })();
      return closePromise;
    },
  });
}
