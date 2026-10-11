// MIT. Multiple delivery consumers using exact original SF98 events and engines.
import { mkdir, rename, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openOutbox } from '../outbox.mjs';
import { drainOnce, validateDestination } from '../deliver.mjs';
import { acquireDeliveryLease, withDeliveryLease, inspectDeliveryLease } from '../delivery-lock.mjs';
import { deliveryRevision, requeueDelivery } from '../delivery-recovery.mjs';
import { ROOT_SCHEMA, DESTINATION_SCHEMA, CURSOR_SCHEMA, idPattern, eventPattern,
  fault, codeOf, privateDirectory, absoluteDirectory, separateDirectories, readPrivate,
  readJSON, writeJSON, destinationIds, destinationPath, eventPrefix, expectRevision,
  exactKeys, hash } from './storage.mjs';

const instant = () => new Date().toISOString();
const filtered = (event, destination) =>
  (!destination.routeIds.length || destination.routeIds.includes(event.routeId)) &&
  (!destination.networks.length || destination.networks.includes(event.network));
const fields = ['id', 'label', 'url', 'allowedHost', 'secretEnv', 'routeIds', 'networks', 'history'];
function textArray(value, pattern, maximum) {
  if (!Array.isArray(value) || value.length > maximum || value.some(item =>
      typeof item !== 'string' || !pattern.test(item)) || new Set(value).size !== value.length)
    throw fault('INVALID_DESTINATION_SELECTION');
  return [...value].sort();
}
export function validateEnrollment(input) {
  exactKeys(input, fields);
  if (!idPattern.test(input.id ?? '') || typeof input.label !== 'string' ||
      !input.label.trim() || input.label.length > 100 || /[\x00-\x1f\x7f]/.test(input.label))
    throw fault('INVALID_DESTINATION_NAME');
  const url = validateDestination(input.url, input.allowedHost).href;
  if (!/^[A-Z][A-Z0-9_]{1,64}$/.test(input.secretEnv ?? '')) throw fault('INVALID_SECRET_ENVIRONMENT_NAME');
  if (!['all', 'new'].includes(input.history)) throw fault('EXPLICIT_HISTORY_SELECTION_REQUIRED');
  return { id: input.id, label: input.label.trim(), url,
    allowedHost: new URL(url).hostname, secretEnv: input.secretEnv,
    routeIds: textArray(input.routeIds ?? [], /^[A-Za-z0-9_-]{1,80}$/, 100),
    networks: textArray(input.networks ?? [], /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9:_-]{1,100}$/, 32),
    history: input.history };
}
function numbers({ limit = 20, concurrency = 1, destinationConcurrency = 4, timeoutMs = 7000, pollMs = 5000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 ||
      !Number.isInteger(destinationConcurrency) || destinationConcurrency < 1 || destinationConcurrency > 16 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000 ||
      !Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60000)
    throw fault('INVALID_WORKER_SETTINGS');
  return { limit, concurrency, destinationConcurrency, timeoutMs, pollMs };
}
const wait = (ms, signal) => new Promise(resolve => {
  if (signal.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
});

export async function openDestinationWorkspace({ directory, sourceDirectory, environment = process.env } = {}) {
  await privateDirectory(directory, true);
  await mkdir(join(directory, 'destinations'), { recursive: true, mode: 0o700 });
  await privateDirectory(join(directory, 'destinations'));
  const configPath = join(directory, 'workspace.json');
  let config = await readJSON(configPath, { optional: true });
  if (!config) {
    if (!sourceDirectory) throw fault('ORIGINAL_SOURCE_DIRECTORY_REQUIRED');
    await privateDirectory(sourceDirectory); separateDirectories(directory, sourceDirectory);
    config = await withDeliveryLease(directory, async () => {
      const existing = await readJSON(configPath, { optional: true });
      if (existing) return existing;
      const source = await openOutbox(sourceDirectory); await source.rows();
      const value = { schema: ROOT_SCHEMA, sourceDirectory, createdAt: instant() };
      await writeJSON(configPath, value, { createOnly: true }); return value;
    });
  }
  if (config.schema !== ROOT_SCHEMA || typeof config.createdAt !== 'string') throw fault('INVALID_DESTINATION_WORKSPACE');
  absoluteDirectory(config.sourceDirectory); separateDirectories(directory, config.sourceDirectory);
  if (sourceDirectory && sourceDirectory !== config.sourceDirectory) throw fault('WORKSPACE_SOURCE_BINDING_CHANGED', 409);
  await privateDirectory(config.sourceDirectory);
  // The seller keeps the sole authoritative events journal. This reader never records there.
  const source = await openOutbox(config.sourceDirectory);
  let worker = null, closing = false;
  const lifetime = new AbortController();

  const readDescriptor = async id => {
    const path = destinationPath(directory, id); await privateDirectory(path);
    const result = await readJSON(join(path, 'destination.json'));
    if (!result || result.schema !== DESTINATION_SCHEMA || result.id !== id ||
        !Number.isSafeInteger(result.revision) || result.revision < 1 || typeof result.paused !== 'boolean')
      throw fault('INVALID_DESTINATION_DESCRIPTOR');
    const input = Object.fromEntries(fields.map(key => [key, result[key]]));
    validateEnrollment(input);
    if (!Number.isSafeInteger(result.enrollment?.count) || result.enrollment.count < 0 ||
        !eventPattern.test(result.enrollment.fingerprint ?? '')) throw fault('INVALID_DESTINATION_ENROLLMENT');
    return result;
  };
  const readCursor = async (id, destination) => {
    const cursor = await readJSON(join(destinationPath(directory, id), 'cursor.json'));
    if (cursor?.schema !== CURSOR_SCHEMA || !Number.isSafeInteger(cursor.count) ||
        cursor.count < destination.enrollment.count || !eventPattern.test(cursor.fingerprint ?? ''))
      throw fault('INVALID_DESTINATION_CURSOR');
    return cursor;
  };
  const sourceEvents = async () => (await source.rows()).map(row => row.event);
  function assertPrefix(events, cursor) {
    if (eventPrefix(events, cursor.count) !== cursor.fingerprint)
      throw fault('SOURCE_JOURNAL_CONTINUITY_CHANGED', 409);
  }
  async function synchronized(id, destination, outbox, events) {
    const cursor = await readCursor(id, destination);
    assertPrefix(events, destination.enrollment); assertPrefix(events, cursor);
    // Confirm any retained copied event is still the exact original source event.
    const original = new Map(events.map((event, index) => [event.id, { event, index }]));
    const copiedIds = new Set();
    for (const { event } of await outbox.rows()) {
      const found = original.get(event.id);
      if (!found || found.index < destination.enrollment.count || !filtered(found.event, destination) ||
          JSON.stringify(found.event) !== JSON.stringify(event)) throw fault('DESTINATION_SOURCE_EVENT_CHANGED', 409);
      copiedIds.add(event.id);
    }
    for (let index = destination.enrollment.count; index < cursor.count; index++)
      if (filtered(events[index], destination) && !copiedIds.has(events[index].id))
        throw fault('DESTINATION_JOURNAL_CONTINUITY_CHANGED', 409);
    let copied = 0, alreadyCopied = 0, skipped = 0;
    for (const event of events.slice(cursor.count)) {
      if (!filtered(event, destination)) { skipped++; continue; }
      const result = await outbox.record(event);
      if (result.duplicate) alreadyCopied++; else copied++;
    }
    const next = { schema: CURSOR_SCHEMA, count: events.length,
      fingerprint: eventPrefix(events), updatedAt: instant() };
    // Advance only after every selected original event was fsynced. A lost checkpoint
    // reopens the same native outbox and its native ID deduplication completes it.
    if (next.count !== cursor.count) await writeJSON(join(outbox.dir, 'cursor.json'), next);
    return { copied, alreadyCopied, skipped, observed: events.length, cursor: next };
  }
  async function selectedIds(id) {
    if (id !== undefined) { await readDescriptor(id); return [id]; }
    return destinationIds(directory);
  }
  async function destinationView(id, { events = null } = {}) {
    const destination = await readDescriptor(id), cursor = await readCursor(id, destination);
    const outbox = await openOutbox(destinationPath(directory, id));
    let continuity = 'CURRENT';
    if (events) {
      try { assertPrefix(events, destination.enrollment); assertPrefix(events, cursor); }
      catch { continuity = 'SOURCE_CHANGED'; }
    }
    return { ...destination, cursor, continuity,
      sourceEventsRemaining: events && continuity === 'CURRENT' ? events.length - cursor.count : null,
      secretAvailable: typeof environment[destination.secretEnv] === 'string' &&
        Buffer.byteLength(environment[destination.secretEnv]) >= 32 && Buffer.byteLength(environment[destination.secretEnv]) <= 1024,
      outbox: await outbox.status(), deliveryOwner: await inspectDeliveryLease(outbox.dir) };
  }
  async function writeWorker(state) {
    await withDeliveryLease(directory, () => writeJSON(join(directory, 'worker.json'), state));
  }

  const model = {
    directory, sourceDirectory: config.sourceDirectory,
    async state() {
      const events = await sourceEvents(), routes = new Map(), networks = new Map();
      for (const event of events) {
        routes.set(event.routeId, (routes.get(event.routeId) ?? 0) + 1);
        networks.set(event.network, (networks.get(event.network) ?? 0) + 1);
      }
      const destinations = [];
      for (const id of await destinationIds(directory)) {
        try { destinations.push(await destinationView(id, { events })); }
        catch (error) { destinations.push({ id, error: codeOf(error) }); }
      }
      const lastRun = await readJSON(join(directory, 'worker.json'), { optional: true });
      let owner = { active: false, owner: null };
      try { owner = await inspectDeliveryLease(join(directory, 'worker-owner')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { schema: ROOT_SCHEMA, observedAt: instant(), sourceDirectory: config.sourceDirectory,
        source: { events: events.length, routes: Object.fromEntries(routes), networks: Object.fromEntries(networks),
          fingerprint: eventPrefix(events) }, destinations,
        worker: { activeHere: Boolean(worker), owner, run: worker?.state ?? lastRun,
          previousRunNeedsReopen: !owner.active && lastRun?.state === 'RUNNING' } };
    },
    async enroll(input) {
      if (closing) throw fault('WORKSPACE_CLOSING', 503);
      const selected = validateEnrollment(input);
      return withDeliveryLease(directory, async () => {
        const ids = await destinationIds(directory);
        if (ids.length >= 128) throw fault('DESTINATION_WORKSPACE_FULL');
        if (ids.includes(selected.id)) throw fault('DESTINATION_ID_ALREADY_ENROLLED', 409);
        for (const id of ids) if ((await readDescriptor(id)).url === selected.url)
          throw fault('DESTINATION_ENDPOINT_ALREADY_ENROLLED', 409);
        const events = await sourceEvents(), count = selected.history === 'new' ? events.length : 0;
        const enrollment = { count, fingerprint: eventPrefix(events, count) };
        const destination = { schema: DESTINATION_SCHEMA, ...selected, revision: 1, paused: false,
          enrollment, createdAt: instant(), updatedAt: instant() };
        const temporary = join(directory, 'destinations', '.enroll-' + randomUUID());
        await privateDirectory(temporary, true);
        await openOutbox(temporary);
        await writeJSON(join(temporary, 'destination.json'), destination, { createOnly: true });
        await writeJSON(join(temporary, 'cursor.json'), { schema: CURSOR_SCHEMA, ...enrollment, updatedAt: instant() }, { createOnly: true });
        await rename(temporary, destinationPath(directory, selected.id));
        const parent = await open(join(directory, 'destinations'), 'r');
        try { await parent.sync(); } finally { await parent.close(); }
        return destinationView(selected.id, { events });
      });
    },
    async setPaused({ id, paused, expectedRevision }) {
      if (typeof paused !== 'boolean') throw fault('EXPLICIT_DESTINATION_STATE_REQUIRED');
      const path = destinationPath(directory, id);
      return withDeliveryLease(path, async () => {
        const destination = await readDescriptor(id); expectRevision(destination, expectedRevision);
        if (destination.paused !== paused) await writeJSON(join(path, 'destination.json'), {
          ...destination, paused, revision: destination.revision + 1, updatedAt: instant() });
        return destinationView(id);
      });
    },
    async sync({ id } = {}) {
      const events = await sourceEvents(), results = [];
      for (const selected of await selectedIds(id)) {
        try {
          const result = await withDeliveryLease(destinationPath(directory, selected), async () => {
            const destination = await readDescriptor(selected), outbox = await openOutbox(destinationPath(directory, selected));
            return synchronized(selected, destination, outbox, events);
          });
          results.push({ id: selected, ok: true, ...result });
        } catch (error) { results.push({ id: selected, ok: false, code: codeOf(error) }); }
      }
      return { observedAt: instant(), results };
    },
    async drain({ id, signal, ...settings } = {}) {
      signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
      const options = numbers(settings), events = await sourceEvents(), results = [];
      const ids = await selectedIds(id); let cursor = 0;
      const deliver = async () => {
        while (cursor < ids.length && !signal?.aborted && !closing) {
        const index = cursor++, selected = ids[index];
        try {
          const result = await withDeliveryLease(destinationPath(directory, selected), async lease => {
            const destination = await readDescriptor(selected);
            if (destination.paused) return { paused: true };
            const secret = environment[destination.secretEnv];
            if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 1024)
              throw fault('DESTINATION_SECRET_ENVIRONMENT_UNAVAILABLE');
            const outbox = await openOutbox(destinationPath(directory, selected));
            const synchronizedSource = await synchronized(selected, destination, outbox, events);
            const delivered = await drainOnce(outbox, { ...options, lease, signal, secret,
              url: destination.url, allowedHost: destination.allowedHost });
            return { synchronizedSource, delivery: delivered };
          });
          results[index] = { id: selected, ok: true, ...result };
        } catch (error) { results[index] = { id: selected, ok: false, code: codeOf(error) }; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(options.destinationConcurrency, ids.length) }, deliver));
      return { observedAt: instant(), results: results.filter(Boolean) };
    },
    async events({ id, state = 'ALL', offset = 0, limit = 50 } = {}) {
      if (!['ALL', 'PENDING', 'DELIVERED', 'RETRY', 'REQUEUE', 'EXHAUSTED'].includes(state) ||
          !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200)
        throw fault('INVALID_EVENT_PAGE');
      await readDescriptor(id);
      const rows = await (await openOutbox(destinationPath(directory, id))).rows();
      const selected = rows.filter(row => state === 'ALL' ||
        (state === 'PENDING' ? !row.state || ['RETRY', 'REQUEUE'].includes(row.state.state) : row.state?.state === state));
      return { id, total: selected.length, offset, limit,
        rows: selected.slice(offset, offset + limit).map(row => ({ event: row.event, delivery: row.state, deliveryRevision: deliveryRevision(row) })),
        nextOffset: offset + limit < selected.length ? offset + limit : null };
    },
    async requeue({ id, eventId, expectedRevision, expectedDeliveryRevision }) {
      if (!eventPattern.test(eventId ?? '')) throw fault('INVALID_EVENT_ID');
      const path = destinationPath(directory, id);
      return withDeliveryLease(path, async lease => {
        const destination = await readDescriptor(id); expectRevision(destination, expectedRevision);
        const recovered = await requeueDelivery(await openOutbox(path), {
          id: eventId, expectedRevision: expectedDeliveryRevision, lease });
        return { destinationId: id, eventId, ...recovered };
      }, { purpose: 'requeue' });
    },
    async start(settings = {}) {
      if (closing) throw fault('WORKSPACE_CLOSING', 503);
      if (worker) throw fault('DESTINATIONS_WORKER_ALREADY_RUNNING', 409);
      const options = numbers(settings), controller = new AbortController();
      // One coordinator owns its run metadata; the per-destination leases still
      // serialize original native sends and manual maintenance independently.
      const lockDirectory = join(directory, 'worker-owner'); await privateDirectory(lockDirectory, true);
      const lease = await acquireDeliveryLease(lockDirectory, { purpose: 'worker' });
      if (closing) { await lease.release(); throw fault('WORKSPACE_CLOSING', 503); }
      const state = { schema: 'stellar-forge.sf98.destinations-worker.v1', id: randomUUID(),
        state: 'RUNNING', startedAt: instant(), updatedAt: instant(), cycles: 0,
        settings: options, lastCycle: null, owner: lease.owner };
      worker = { controller, state, promise: null };
      const current = worker;
      try { await writeWorker(state); }
      catch (error) { worker = null; await lease.release(); throw error; }
      current.promise = (async () => {
        let observingStop = false;
        const monitor = setInterval(async () => {
          if (observingStop || controller.signal.aborted) return;
          observingStop = true;
          try {
            const request = await readJSON(join(directory, 'stop-request.json'), { optional: true });
            if (request?.runId === current.state.id) controller.abort(new Error('DESTINATIONS_WORKER_STOPPED'));
          } catch (error) { controller.abort(error); }
          finally { observingStop = false; }
        }, 250);
        try {
          while (!controller.signal.aborted && !closing) {
            const result = await model.drain({ ...options, signal: controller.signal });
            current.state = { ...current.state, updatedAt: instant(), cycles: current.state.cycles + 1, lastCycle: result };
            await writeWorker(current.state);
            const ready = result.results.some(item => item.delivery?.ready > 0);
            await wait(ready ? 100 : options.pollMs, controller.signal);
          }
          current.state = { ...current.state, state: 'STOPPED', updatedAt: instant() };
          await writeWorker(current.state);
        } catch (error) {
          current.state = { ...current.state, state: 'FAILED', updatedAt: instant(), code: codeOf(error) };
          await writeWorker(current.state).catch(() => {});
        } finally { clearInterval(monitor); await lease.release(); if (worker === current) worker = null; }
        return current.state;
      })();
      return state;
    },
    async stop() {
      if (!worker) {
        const lastRun = await readJSON(join(directory, 'worker.json'), { optional: true });
        if (lastRun?.state === 'RUNNING') {
          let owner;
          try { owner = await inspectDeliveryLease(join(directory, 'worker-owner')); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (owner?.active) {
            await withDeliveryLease(directory, () => writeJSON(join(directory, 'stop-request.json'), {
              schema: 'stellar-forge.sf98.destinations-stop.v1', runId: lastRun.id, requestedAt: instant() }));
            return { state: 'STOP_REQUESTED', runId: lastRun.id };
          }
        }
        return { state: 'STOPPED', activeHere: false };
      }
      const current = worker; current.controller.abort(new Error('DESTINATIONS_WORKER_STOPPED'));
      return current.promise;
    },
    async waitForWorker() { return worker ? worker.promise : null; },
    async handoff() {
      // Acquire the registration lease and each native destination lease in stable
      // order. Concurrent sends finish before exact receiver journals are exported.
      return withDeliveryLease(directory, async () => {
        const leases = [], destinations = [];
        try {
          for (const id of await destinationIds(directory)) leases.push(await acquireDeliveryLease(destinationPath(directory, id)));
          const events = await sourceEvents();
          for (const lease of leases) {
            const id = lease.directory.split('/').at(-1), destination = await readDescriptor(id);
            const cursor = await readCursor(id, destination); assertPrefix(events, cursor);
            const files = {};
            for (const name of ['events.ndjson', 'deliveries.ndjson']) {
              const content = await readPrivate(join(lease.directory, name), { optional: true, maxBytes: 67108864 }) ?? '';
              files[name] = { content, bytes: Buffer.byteLength(content), sha256: hash(content) };
            }
            destinations.push({ destination, cursor, files, status: await (await openOutbox(lease.directory)).status() });
          }
          return { schema: 'stellar-forge.sf98.destinations-handoff.v1', exportedAt: instant(), workspace: config,
            source: { events: events.length, fingerprint: eventPrefix(events) }, destinations,
            reopen: 'Retain the original source outbox and this private workspace directory. Use the same directory with the destinations CLI or workspace; signing secrets are supplied through the named environment references.' };
        } finally { for (const lease of leases.reverse()) await lease.release(); }
      });
    },
    async close() { closing = true; lifetime.abort(new Error('DESTINATIONS_WORKSPACE_CLOSING')); if (worker) await model.stop(); },
  };
  return model;
}
