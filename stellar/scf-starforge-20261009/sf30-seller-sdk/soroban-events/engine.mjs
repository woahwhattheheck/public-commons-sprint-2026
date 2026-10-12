import { promises as fs, constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  NETWORK_PASSPHRASES, SorobanEventsError, requireValue, normalizedConnection,
  normalizePlan, createRPCTransport, rpcResult, requestParameters, validateEvent,
  digest, clone, stableJSON, textValue, integer,
} from './rpc.mjs';

const WORKSPACE_SCHEMA = 'stellar-forge.soroban-events.workspace.v1';
const EXPORT_SCHEMA = 'stellar-forge.soroban-events.source-export.v1';
const now = () => new Date().toISOString();
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const own = (object, key) => Object.hasOwn(object, key);
function item(object, id, label) {
  requireValue(typeof id === 'string' && own(object, id), 'NOT_FOUND', label + ' was not found');
  return object[id];
}
function relativeFile(value) {
  requireValue(typeof value === 'string' && value.length <= 1000 && !isAbsolute(value) &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && value.split('/').every((part) => part && part !== '.' && part !== '..'),
    'INVALID_PATH', 'Use a declared relative source file path');
  return value;
}
async function privateDirectory(directory) {
  requireValue(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory, 'INVALID_DIRECTORY', 'Workspace directory must be an absolute normalized path');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(directory);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && await fs.realpath(directory) === directory, 'INVALID_DIRECTORY', 'Workspace must be a real private directory');
}
async function filePath(directory, relative, createParents = false) {
  const parts = relativeFile(relative).split('/');
  let current = directory;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (createParents) await fs.mkdir(current, { recursive: false, mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    const info = await fs.lstat(current);
    requireValue(info.isDirectory() && !info.isSymbolicLink(), 'INVALID_PATH', 'Source directory is not a real directory');
  }
  const target = join(directory, ...parts);
  try {
    const info = await fs.lstat(target);
    requireValue(info.isFile() && !info.isSymbolicLink(), 'INVALID_PATH', 'Source path is not a regular file');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}
async function readFile(directory, relative) {
  return fs.readFile(await filePath(directory, relative));
}
async function readJSON(directory, relative) {
  const bytes = await readFile(directory, relative);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new SorobanEventsError('INVALID_SOURCE_JSON', 'Saved source is not valid JSON', { path: relative }); }
}
async function writeNew(directory, relative, bytes) {
  const target = await filePath(directory, relative, true);
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try {
    const retained = await fs.readFile(target);
    requireValue(retained.equals(body), 'IMMUTABLE_SOURCE_CONFLICT', 'An existing source file has different bytes', { path: relative });
    return { path: relative, bytes: body.length, sha256: digest(body), contentType: 'application/json' };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = relative + '.pending-' + randomUUID();
  const source = await filePath(directory, temporary, true);
  let handle;
  try {
    handle = await fs.open(source, 'wx', 0o600);
    await handle.writeFile(body); await handle.sync();
    await handle.close(); handle = null;
    try { await fs.link(source, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireValue((await fs.readFile(target)).equals(body), 'IMMUTABLE_SOURCE_CONFLICT', 'An existing source file has different bytes', { path: relative });
    }
  } finally {
    await handle?.close();
    await fs.unlink(source).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  return { path: relative, bytes: body.length, sha256: digest(body), contentType: 'application/json' };
}
async function replaceJSON(directory, relative, value) {
  const target = await filePath(directory, relative, true);
  const temporary = relative + '.pending-' + randomUUID();
  const source = await filePath(directory, temporary, true);
  let handle;
  try {
    handle = await fs.open(source, 'wx', 0o600);
    await handle.writeFile(jsonBytes(value));
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(source, target);
    const parent = await fs.open(dirname(target), constants.O_RDONLY);
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    await handle?.close();
    await fs.unlink(source).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function acquireLock(directory) {
  const filename = join(directory, 'writer.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(filename, 'wx', 0o600);
      await handle.writeFile(jsonBytes({ pid: process.pid, host: hostname(), token, createdAt: now() }));
      await handle.close();
      return async () => {
        const saved = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (saved.token === token) await fs.unlink(filename);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let lock;
      try { lock = JSON.parse(await fs.readFile(filename, 'utf8')); } catch { throw new SorobanEventsError('WORKSPACE_BUSY', 'Workspace has an unreadable active writer lock'); }
      let abandoned = false;
      if (lock.host === hostname() && Number.isInteger(lock.pid)) {
        try { process.kill(lock.pid, 0); } catch (problem) { if (problem.code === 'ESRCH') abandoned = true; }
      }
      if (attempt === 0 && abandoned) {
        const fresh = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (fresh.token === lock.token) await fs.unlink(filename);
        continue;
      }
      throw new SorobanEventsError('WORKSPACE_BUSY', 'Another process is writing this event workspace');
    }
  }
  throw new SorobanEventsError('WORKSPACE_BUSY', 'Workspace writer could not be acquired');
}
function newState() {
  return { schema: WORKSPACE_SCHEMA, id: randomUUID(), revision: 0, createdAt: now(),
    connection: null, plans: {}, captures: {}, editions: {}, exports: {}, requests: {} };
}
function cursorPosition(cursor) {
  // Preserve the native token verbatim. Decode only the documented TOID ledger
  // for completion; an opaque future cursor can still advance and be retained.
  const parts = typeof cursor === 'string' ? /^([0-9]{1,20})-([0-9]{1,10})$/.exec(cursor) : null;
  if (!parts) return null;
  const toid = BigInt(parts[1]), event = BigInt(parts[2]);
  if (toid > 18446744073709551615n || event > 4294967295n) return null;
  return { ledger: Number(toid >> 32n), toid, event };
}
function cursorCompletesRange(position, endLedger) {
  return Boolean(position && (position.ledger >= endLedger ||
    (position.ledger === endLedger - 1 && (position.toid & 4294967295n) === 4294967295n && position.event === 4294967295n)));
}
function compareIDs(left, right) {
  const a = cursorPosition(left), b = cursorPosition(right);
  requireValue(a && b, 'RPC_INVALID_EVENT', 'RPC event identifiers must use the documented TOID/event ordering');
  return a.toid < b.toid ? -1 : a.toid > b.toid ? 1 : a.event < b.event ? -1 : a.event > b.event ? 1 : 0;
}
function publicError(error) {
  return { code: error.code ?? 'WORKSPACE_OPERATION_FAILED', message: error.message ?? 'Workspace operation failed', details: error.details ?? {}, at: now() };
}
function describeState(state) {
  return { workspaceId: state.id, revision: state.revision, connection: clone(state.connection),
    plans: Object.values(state.plans).map(clone), captures: Object.values(state.captures).map(clone),
    editions: Object.values(state.editions).map(clone), exports: Object.values(state.exports).map(clone) };
}
function pageRows(result, capture, seen) {
  requireValue(Array.isArray(result.events), 'RPC_INVALID_RESULT', 'getEvents did not return an events array');
  requireValue(result.events.length <= capture.plan.pageSize, 'RPC_INVALID_RESULT', 'getEvents exceeded the requested page limit');
  let prior = null, beyondEnd = false, added = 0, duplicates = 0;
  for (const event of result.events) {
    validateEvent(event);
    const position = cursorPosition(event.id);
    requireValue(position && position.ledger === event.ledger, 'RPC_INVALID_EVENT', 'Event ledger differs from its original TOID');
    if (prior !== null) requireValue(compareIDs(event.id, prior) >= 0, 'RPC_EVENT_ORDER', 'RPC events are not in native ascending order');
    prior = event.id;
    if (event.ledger >= capture.endLedger) { beyondEnd = true; continue; }
    requireValue(event.ledger >= capture.startLedger, 'RPC_RANGE_MISMATCH', 'RPC returned an event before the selected ledger range');
    const canonical = stableJSON(event);
    if (seen.has(event.id)) {
      requireValue(seen.get(event.id).canonical === canonical, 'RPC_EVENT_CONFLICT', 'The same native event identifier has conflicting original content', { eventId: event.id });
      duplicates += 1;
    } else {
      if (seen.lastId !== undefined) requireValue(compareIDs(event.id, seen.lastId) > 0, 'RPC_EVENT_ORDER', 'A later RPC page contains a new event before the retained high water event');
      seen.set(event.id, { canonical, event: clone(event) });
      seen.lastId = event.id;
      added += 1;
    }
  }
  return { beyondEnd, added, duplicates };
}

class SorobanEventsWorkspace {
  #directory; #connection; #rpc; #tail = Promise.resolve(); #closing = false;
  constructor(directory, connection, rpcRequest) {
    this.#directory = directory;
    this.#connection = connection ? normalizedConnection(connection) : null;
    this.#rpc = this.#connection ? createRPCTransport(this.#connection, rpcRequest) : null;
  }
  async initialize() {
    await privateDirectory(this.#directory);
    const release = await acquireLock(this.#directory);
    try {
      let state;
      try { state = await readJSON(this.#directory, 'workspace.json'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; state = newState(); await writeNew(this.#directory, 'workspace.json', jsonBytes(state)); }
      requireValue(state.schema === WORKSPACE_SCHEMA && Number.isSafeInteger(state.revision), 'WORKSPACE_SCHEMA', 'Unsupported event workspace');
      if (this.#connection && state.connection) requireValue(this.#connection.public.id === state.connection.id, 'CONNECTION_MISMATCH', 'Open this workspace with its original RPC endpoint and network');
      if (this.#connection && !state.connection) { state.connection = clone(this.#connection.public); state.revision += 1; await replaceJSON(this.#directory, 'workspace.json', state); }
    } finally { await release(); }
    return this;
  }
  async #state() {
    const state = await readJSON(this.#directory, 'workspace.json');
    requireValue(state.schema === WORKSPACE_SCHEMA, 'WORKSPACE_SCHEMA', 'Unsupported event workspace');
    return state;
  }
  async #save(state) {
    state.revision += 1;
    await replaceJSON(this.#directory, 'workspace.json', state);
  }
  async #mutate(kind, input, operation) {
    requireValue(!this.#closing, 'WORKSPACE_CLOSED', 'Workspace is closing');
    const args = clone(input);
    const requestId = textValue(args.requestId, 'requestId', 200);
    requireValue(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(requestId), 'INVALID_ARGUMENT', 'requestId uses unsupported characters');
    integer(args.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER);
    const body = { ...args }; delete body.requestId; delete body.expectedRevision;
    const inputSha256 = digest(stableJSON({ kind, body }));
    const run = this.#tail.then(async () => {
      const release = await acquireLock(this.#directory);
      try {
        const state = await this.#state();
        let request = own(state.requests, requestId) ? state.requests[requestId] : null;
        if (request) {
          requireValue(request.kind === kind && request.inputSha256 === inputSha256, 'REQUEST_CONFLICT', 'requestId already belongs to different original arguments');
          if (request.result) return clone(request.result);
        } else {
          requireValue(state.revision === args.expectedRevision, 'REVISION_CONFLICT', 'Workspace changed; reload it before changing this selection', { expectedRevision: args.expectedRevision, actualRevision: state.revision });
          request = { id: requestId, kind, inputSha256, startedAt: now(), context: {} };
          state.requests[requestId] = request;
          await this.#save(state);
        }
        const result = await operation(state, args, request);
        request.completedAt = now();
        request.result = { workspaceId: state.id, revision: state.revision + 1, ...clone(result) };
        await this.#save(state);
        return clone(request.result);
      } finally { await release(); }
    });
    this.#tail = run.catch(() => {});
    return run;
  }
  async describe() { return describeState(await this.#state()); }
  async planSave(input) {
    const normalized = normalizePlan(input);
    return this.#mutate('plan-save', input, async (state, args, request) => {
      if (!request.context.planId) {
        request.context.planId = args.planId ?? randomUUID();
        if (args.planId) item(state.plans, args.planId, 'Plan');
        await this.#save(state);
      }
      const id = request.context.planId;
      let plan = own(state.plans, id) ? state.plans[id] : null;
      if (!request.context.version) { request.context.version = plan ? Math.max(...plan.versions.map((version) => version.version)) + 1 : 1; await this.#save(state); }
      const version = request.context.version;
      if (!plan) { plan = { id, name: normalized.name, currentVersion: version, versions: [] }; state.plans[id] = plan; }
      if (!plan.versions.some((entry) => entry.version === version)) {
        const saved = { id, version, ...normalized, createdAt: request.startedAt };
        saved.sha256 = digest(stableJSON(saved));
        plan.versions.push(saved);
        plan.name = normalized.name; plan.currentVersion = version;
        await this.#save(state);
      }
      return { plan };
    });
  }
  async #exchange(state, capture, relative, method, params) {
    const id = capture.id + ':' + relative.split('/').at(-1);
    let exchange, raw;
    try { raw = await readFile(this.#directory, relative); exchange = JSON.parse(raw); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      requireValue(this.#rpc, 'CONNECTION_REQUIRED', 'Configure this workspace original RPC connection to capture events');
      exchange = await this.#rpc(method, params, id);
      raw = jsonBytes(exchange);
      await writeNew(this.#directory, relative, raw);
    }
    const expected = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    requireValue(exchange.request.sha256 === digest(expected) && Buffer.from(exchange.request.bodyBase64, 'base64').equals(expected), 'SOURCE_REQUEST_MISMATCH', 'Saved exchange belongs to different original request parameters');
    if (!capture.exchanges.some((entry) => entry.path === relative)) {
      capture.exchanges.push({ path: relative, bytes: raw.length, sha256: digest(raw), contentType: 'application/json', method });
      await this.#save(state);
    }
    return { result: rpcResult(exchange), exchange, file: capture.exchanges.find((entry) => entry.path === relative) };
  }
  async #seen(capture) {
    const seen = new Map();
    for (const page of capture.pages) {
      const raw = await readFile(this.#directory, page.path);
      requireValue(digest(raw) === page.sha256, 'SOURCE_MISMATCH', 'Saved page differs from the original capture', { path: page.path });
      pageRows(rpcResult(JSON.parse(raw)), capture, seen);
    }
    return seen;
  }
  async #collect(state, capture, request) {
    if (capture.status === 'COMPLETE') return capture;
    requireValue(this.#connection && this.#rpc, 'CONNECTION_REQUIRED', 'Open with the original host RPC connection before continuing this capture');
    requireValue(capture.connection.id === this.#connection.public.id, 'CONNECTION_MISMATCH', 'The capture belongs to its original RPC endpoint and network');
    capture.status = 'CAPTURING'; capture.lastError = null;
    let attempt = capture.attempts.find((entry) => entry.requestId === request.id);
    if (!attempt) { attempt = { requestId: request.id, id: capture.attempts.length + 1, startedAt: now() }; capture.attempts.push(attempt); }
    await this.#save(state);
    try {
      const attemptPrefix = 'captures/' + capture.id + '/exchanges/attempt-' + attempt.id;
      const network = await this.#exchange(state, capture, attemptPrefix + '-network.json', 'getNetwork', {});
      requireValue(network.result.passphrase === NETWORK_PASSPHRASES[capture.connection.network], 'RPC_NETWORK_MISMATCH', 'The RPC network passphrase differs from the selected network');
      const health = await this.#exchange(state, capture, attemptPrefix + '-health.json', 'getHealth', {});
      requireValue(health.result.status === 'healthy', 'RPC_UNHEALTHY', 'The original RPC reports that it is not healthy');
      integer(health.result.oldestLedger, 'oldestLedger');
      integer(health.result.latestLedger, 'latestLedger');
      requireValue(health.result.oldestLedger <= health.result.latestLedger, 'RPC_INVALID_RESULT', 'RPC retention bounds are inconsistent');
      attempt.oldestLedger = health.result.oldestLedger; attempt.latestLedger = health.result.latestLedger;
      if (capture.startLedger === null) {
        const selectedStart = capture.plan.startLedger ?? health.result.latestLedger;
        const selectedEnd = capture.plan.endLedger ?? health.result.latestLedger + 1;
        requireValue(selectedEnd > selectedStart, 'INVALID_RANGE', 'The selected endLedger must be after startLedger');
        requireValue(selectedEnd <= health.result.latestLedger + 1, 'FUTURE_LEDGER_RANGE', 'The selected range extends beyond the RPC current ledger', { latestLedger: health.result.latestLedger });
        requireValue(selectedStart >= health.result.oldestLedger, 'RETENTION_GAP', 'The original RPC no longer retains the requested first ledger', { oldestLedger: health.result.oldestLedger, startLedger: selectedStart });
        capture.startLedger = selectedStart; capture.endLedger = selectedEnd;
        capture.rangeSelectedAt = health.exchange.capturedAt;
      }
      if (capture.pages.length === 0) requireValue(capture.startLedger >= health.result.oldestLedger, 'RETENTION_GAP', 'The requested first ledger is outside current RPC retention', { oldestLedger: health.result.oldestLedger });
      await this.#save(state);
      const seen = await this.#seen(capture);
      while (capture.status === 'CAPTURING') {
        const oldCursor = capture.cursor;
        const params = requestParameters(capture);
        const relative = 'captures/' + capture.id + '/exchanges/page-' + String(capture.pages.length + 1).padStart(8, '0') + '-attempt-' + attempt.id + '.json';
        const fetched = await this.#exchange(state, capture, relative, 'getEvents', params);
        const result = fetched.result;
        textValue(result.cursor, 'RPC cursor', 300);
        integer(result.latestLedger, 'RPC latestLedger');
        const values = pageRows(result, capture, seen);
        const frontier = cursorPosition(result.cursor);
        if (oldCursor && frontier && cursorPosition(oldCursor)) requireValue(compareIDs(result.cursor, oldCursor) >= 0, 'RPC_CURSOR_REVERSED', 'The native cursor moved backwards');
        capture.pages.push({ ...fetched.file, cursor: result.cursor, inputCursor: oldCursor,
          eventCount: result.events.length, selectedCount: values.added, duplicateCount: values.duplicates,
          frontierLedger: frontier?.ledger ?? null, observedLatestLedger: result.latestLedger,
          capturedAt: fetched.exchange.capturedAt });
        capture.cursor = result.cursor;
        capture.eventCount = seen.size;
        capture.duplicateCount += values.duplicates;
        capture.latestLedger = result.latestLedger;
        capture.frontierLedger = frontier?.ledger ?? null;
        capture.updatedAt = now();
        if (values.beyondEnd || cursorCompletesRange(frontier, capture.endLedger)) {
          capture.status = 'COMPLETE';
          capture.completedAt = now();
          capture.completion = { reason: values.beyondEnd ? 'ORDERED_EVENT_PAST_BOUNDARY' : frontier.ledger === capture.endLedger - 1 ? 'NATIVE_RANGE_END_CURSOR' : 'NATIVE_CURSOR_PAST_BOUNDARY',
            cursor: result.cursor, sourcePath: relative, sourceSha256: fetched.file.sha256, endLedger: capture.endLedger };
        } else if (oldCursor === result.cursor) {
          capture.status = 'WAITING_FOR_LEDGER';
          capture.lastError = { code: 'RPC_CURSOR_NOT_ADVANCING', message: 'The RPC cursor is at its current scan frontier. Resume this capture after the provider advances.', details: { cursor: result.cursor, endLedger: capture.endLedger }, at: now() };
        }
        await this.#save(state);
      }
    } catch (error) {
      capture.status = 'INTERRUPTED'; capture.lastError = publicError(error); capture.updatedAt = now();
      await this.#save(state);
    }
    return capture;
  }
  async captureStart(input) {
    return this.#mutate('capture-start', input, async (state, args, request) => {
      if (!request.context.captureId) {
        requireValue(this.#connection, 'CONNECTION_REQUIRED', 'Configure the original RPC connection before capture');
        const original = item(state.plans, args.planId, 'Plan');
        request.context.captureId = randomUUID();
        request.context.plan = clone(original.versions.find((entry) => entry.version === original.currentVersion));
        await this.#save(state);
      }
      const id = request.context.captureId;
      if (!own(state.captures, id)) {
        requireValue(this.#connection, 'CONNECTION_REQUIRED', 'Configure the original RPC connection before capture');
        const selected = request.context.plan;
        state.captures[id] = { id, planId: selected.id, planVersion: selected.version, plan: clone(selected),
          connection: clone(this.#connection.public), status: 'PENDING', createdAt: request.startedAt,
          startLedger: null, endLedger: null, cursor: null, frontierLedger: null, latestLedger: null,
          eventCount: 0, duplicateCount: 0, pages: [], exchanges: [], attempts: [], lastError: null };
        await this.#save(state);
      }
      return { capture: await this.#collect(state, state.captures[id], request) };
    });
  }
  async captureResume(input) {
    return this.#mutate('capture-resume', input, async (state, args, request) =>
      ({ capture: await this.#collect(state, item(state.captures, args.captureId, 'Capture'), request) }));
  }
  async captureStatus({ captureId }) {
    const state = await this.#state();
    return { workspaceId: state.id, revision: state.revision, capture: clone(item(state.captures, captureId, 'Capture')) };
  }
  async eventPage({ captureId, after = null, limit = 100, contractId = null, type = null }) {
    integer(limit, 'limit', 1, 1000);
    if (after !== null) requireValue(cursorPosition(after), 'INVALID_ARGUMENT', 'after must be an original event identifier');
    if (type !== null) requireValue(['contract', 'system'].includes(type), 'INVALID_ARGUMENT', 'type must be contract or system');
    const state = await this.#state(), capture = item(state.captures, captureId, 'Capture');
    const rows = [...(await this.#seen(capture)).values()].map((entry) => entry.event)
      .filter((event) => (contractId === null || event.contractId === contractId) && (type === null || event.type === type))
      .sort((a, b) => compareIDs(a.id, b.id));
    const eligible = after === null ? rows : rows.filter((event) => compareIDs(event.id, after) > 0);
    const selected = eligible.slice(0, limit);
    return { workspaceId: state.id, revision: state.revision, captureId, rows: clone(selected),
      nextCursor: eligible.length > selected.length ? selected.at(-1)?.id ?? null : null,
      total: rows.length, complete: capture.status === 'COMPLETE' };
  }
  async editionCreate(input) {
    textValue(input.name, 'Edition name');
    return this.#mutate('edition-create', input, async (state, args, request) => {
      const capture = item(state.captures, args.captureId, 'Capture');
      requireValue(capture.status === 'COMPLETE', 'CAPTURE_INCOMPLETE', 'Complete the original selected ledger range before saving an edition');
      if (!request.context.editionId) { request.context.editionId = randomUUID(); await this.#save(state); }
      const id = request.context.editionId;
      if (!own(state.editions, id)) {
        const events = [...(await this.#seen(capture)).values()].map((entry) => entry.event).sort((a,b) => compareIDs(a.id,b.id));
        const file = await writeNew(this.#directory, 'editions/' + id + '/events.json', jsonBytes(events));
        const edition = { id, name: args.name, captureId: capture.id, planId: capture.planId,
          planVersion: capture.planVersion, createdAt: request.startedAt, network: capture.connection.network,
          startLedger: capture.startLedger, endLedger: capture.endLedger, eventCount: events.length,
          source: file, format: 'json-array', completion: clone(capture.completion) };
        edition.sha256 = digest(stableJSON(edition));
        state.editions[id] = edition;
        await this.#save(state);
      }
      return { edition: state.editions[id] };
    });
  }
  async edition({ editionId }) {
    const state = await this.#state();
    return { workspaceId: state.id, revision: state.revision, edition: clone(item(state.editions, editionId, 'Edition')) };
  }
  async publisherSource({ editionId }) {
    const state = await this.#state(), edition = item(state.editions, editionId, 'Edition');
    const bytes = await readFile(this.#directory, edition.source.path);
    requireValue(bytes.length === edition.source.bytes && digest(bytes) === edition.source.sha256, 'SOURCE_MISMATCH', 'Edition source differs from the saved events');
    return { workspaceId: state.id, revision: state.revision, editionId, file: join(this.#directory, edition.source.path),
      sha256: edition.source.sha256, bytes: edition.source.bytes, format: edition.format };
  }
  async sourceExport(input) {
    return this.#mutate('source-export', input, async (state, args, request) => {
      const edition = item(state.editions, args.editionId, 'Edition'), capture = item(state.captures, edition.captureId, 'Capture');
      const exportId = digest(stableJSON({ schema: EXPORT_SCHEMA, workspaceId: state.id, editionId: edition.id, editionSha256: edition.sha256 }));
      if (own(state.exports, exportId)) return { export: state.exports[exportId] };
      const directory = join(this.#directory, 'exports', exportId);
      await privateDirectory(directory);
      const descriptors = [];
      if (request.context.originRevision === undefined) { request.context.originRevision = state.revision; await this.#save(state); }
      const source = { schema: 'stellar-forge.soroban-events.source.v1', exportId,
        origin: { workspaceId: state.id, revision: request.context.originRevision }, plan: clone(capture.plan),
        capture: clone(capture), edition: clone(edition) };
      descriptors.push(await writeNew(directory, 'source.json', jsonBytes(source)));
      for (const entry of [...capture.exchanges, edition.source]) {
        const bytes = await readFile(this.#directory, entry.path);
        requireValue(bytes.length === entry.bytes && digest(bytes) === entry.sha256, 'SOURCE_MISMATCH', 'Original source file changed', { path: entry.path });
        descriptors.push(await writeNew(directory, entry.path, bytes));
      }
      const manifest = { schema: EXPORT_SCHEMA, exportId, editionId: edition.id,
        files: descriptors.sort((a,b) => a.path.localeCompare(b.path)), fileCount: descriptors.length,
        bytes: descriptors.reduce((sum, file) => sum + file.bytes, 0) };
      const manifestBytes = jsonBytes(manifest);
      await writeNew(directory, 'manifest.json', manifestBytes);
      const result = { id: exportId, directory, editionId: edition.id, manifest,
        manifestSha256: digest(manifestBytes), createdAt: request.startedAt };
      state.exports[exportId] = result; await this.#save(state);
      return { export: result };
    });
  }
  async sourceFile({ exportId, path, offset = 0, length = null }) {
    const state = await this.#state(), exported = item(state.exports, exportId, 'Export');
    const file = path === 'manifest.json'
      ? { path, sha256: exported.manifestSha256, contentType: 'application/json' }
      : exported.manifest.files.find((entry) => entry.path === path);
    requireValue(file, 'NOT_FOUND', 'File is not part of the selected source export');
    const bytes = await readFile(exported.directory, file.path);
    requireValue(digest(bytes) === file.sha256 && (file.bytes === undefined || bytes.length === file.bytes), 'SOURCE_MISMATCH', 'Export file differs from its source manifest');
    integer(offset, 'offset', 0, bytes.length);
    if (length !== null) integer(length, 'length', 1, 4 * 1024 * 1024);
    const content = bytes.subarray(offset, length === null ? bytes.length : offset + length);
    return { path, bytes: bytes.length, totalBytes: bytes.length, sha256: file.sha256,
      contentType: file.contentType, offset, complete: offset + content.length >= bytes.length, content };
  }
  async sourceReceive(input) {
    return this.#mutate('source-receive', input, async (state, args) => {
      const sourceDirectory = args.sourceDirectory;
      requireValue(typeof sourceDirectory === 'string' && isAbsolute(sourceDirectory) && resolve(sourceDirectory) === sourceDirectory && await fs.realpath(sourceDirectory) === sourceDirectory, 'INVALID_DIRECTORY', 'Select the original received source directory');
      const manifestBytes = await readFile(sourceDirectory, 'manifest.json');
      if (args.expectedManifestSha256 !== undefined) {
        requireValue(typeof args.expectedManifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(args.expectedManifestSha256),
          'INVALID_ARGUMENT', 'expectedManifestSha256 must be a lowercase SHA-256');
        requireValue(digest(manifestBytes) === args.expectedManifestSha256, 'SOURCE_MISMATCH', 'The selected original manifest changed before receiving');
      }
      const manifest = JSON.parse(manifestBytes);
      requireValue(manifest.schema === EXPORT_SCHEMA && /^[a-f0-9]{64}$/.test(manifest.exportId) && Array.isArray(manifest.files), 'SOURCE_SCHEMA', 'Unsupported event source export');
      requireValue(manifest.files.length > 0 && manifest.files.length <= 100000 && manifest.fileCount === manifest.files.length, 'SOURCE_MANIFEST', 'Source manifest file count is invalid');
      const files = new Map();
      for (const descriptor of manifest.files) {
        relativeFile(descriptor.path);
        requireValue(!files.has(descriptor.path) && /^[a-f0-9]{64}$/.test(descriptor.sha256) && Number.isSafeInteger(descriptor.bytes) && descriptor.bytes >= 0, 'SOURCE_MANIFEST', 'Source manifest has an invalid or repeated file');
        const bytes = await readFile(sourceDirectory, descriptor.path);
        requireValue(bytes.length === descriptor.bytes && digest(bytes) === descriptor.sha256, 'SOURCE_MISMATCH', 'Received file differs from its original source manifest', { path: descriptor.path });
        files.set(descriptor.path, { descriptor, bytes });
      }
      requireValue(Number.isSafeInteger(manifest.bytes) && manifest.bytes >= 0 &&
        manifest.bytes === [...files.values()].reduce((total, entry) => total + entry.descriptor.bytes, 0),
        'SOURCE_MANIFEST', 'Source manifest byte total differs from its declared native files');
      requireValue(files.has('source.json'), 'SOURCE_MANIFEST', 'Source metadata is missing');
      const source = JSON.parse(files.get('source.json').bytes);
      requireValue(source.schema === 'stellar-forge.soroban-events.source.v1' && source.exportId === manifest.exportId, 'SOURCE_SCHEMA', 'Source metadata does not match its manifest');
      const capture = source.capture, edition = source.edition;
      requireValue(capture?.status === 'COMPLETE' && Array.isArray(capture.pages) && Array.isArray(capture.exchanges) && capture.pages.length > 0 &&
        capture.id === edition?.captureId && edition.id === manifest.editionId, 'SOURCE_SCHEMA', 'Received edition is not a complete original capture');
      requireValue(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(capture.id) &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(edition.id) &&
        edition.source?.path === 'editions/' + edition.id + '/events.json', 'SOURCE_PATH', 'Source identifiers or edition path are invalid');
      for (const entry of capture.exchanges) requireValue(entry.path.startsWith('captures/' + capture.id + '/exchanges/') && /^[A-Za-z0-9-]+\.json$/.test(entry.path.split('/').at(-1)), 'SOURCE_PATH', 'Exchange file is outside its original capture');
      const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
      requireValue(uuid(source.origin?.workspaceId) && uuid(source.plan?.id), 'SOURCE_SCHEMA', 'Original source workspace and plan identifiers must be UUIDs');
      requireValue(capture.planId === capture.plan?.id && capture.planVersion === capture.plan?.version &&
        edition.planId === capture.plan?.id && edition.planVersion === capture.plan?.version,
        'SOURCE_PLAN_MISMATCH', 'Capture and edition must select the same original saved plan version');
      normalizePlan(capture.plan);
      const planCore = clone(capture.plan); delete planCore.sha256;
      requireValue(digest(stableJSON(planCore)) === capture.plan.sha256 && Number.isSafeInteger(capture.plan.version) && capture.plan.version > 0,
        'SOURCE_MISMATCH', 'Original saved plan metadata changed');
      requireValue(edition.format === 'json-array' && edition.network === capture.connection?.network &&
        edition.startLedger === capture.startLedger && edition.endLedger === capture.endLedger,
        'SOURCE_SCHEMA', 'Edition range or source format differs from its original capture');
      integer(capture.startLedger, 'startLedger'); integer(capture.endLedger, 'endLedger', 2, 4294967296);
      requireValue(capture.endLedger > capture.startLedger && capture.plan?.id === source.plan?.id && stableJSON(capture.plan) === stableJSON(source.plan), 'SOURCE_SCHEMA', 'Received source range or plan differs');
      const expectedPaths = new Set(['source.json', edition.source.path, ...capture.exchanges.map((entry) => entry.path)]);
      requireValue(expectedPaths.size === files.size && [...expectedPaths].every((path) => files.has(path)), 'SOURCE_MANIFEST', 'Source export has missing or undeclared native files');
      const seen = new Map();
      let completion = false, originalCursor = null;
      const nativeNetwork = NETWORK_PASSPHRASES[capture.connection?.network];
      requireValue(nativeNetwork, 'SOURCE_NETWORK', 'Received source has no supported original network');
      let matchingNetwork = false;
      for (const entry of capture.exchanges) {
        const file = files.get(entry.path);
        requireValue(file.descriptor.bytes === entry.bytes && file.descriptor.sha256 === entry.sha256, 'SOURCE_MISMATCH', 'Native exchange descriptor changed');
        const exchange = JSON.parse(file.bytes);
        if (exchange.request?.method === 'getNetwork') {
          try { if (rpcResult(exchange).passphrase === nativeNetwork) matchingNetwork = true; } catch {}
        }
      }
      requireValue(matchingNetwork, 'SOURCE_NETWORK', 'Received capture lacks its original matching network response');
      for (const page of capture.pages) {
        requireValue(page.inputCursor === originalCursor, 'SOURCE_CURSOR_GAP', 'Source pages omit or reorder the original cursor chain');
        requireValue(capture.exchanges.some((entry) => entry.path === page.path && entry.sha256 === page.sha256), 'SOURCE_MANIFEST', 'Page is not an original declared exchange');
        const exchange = JSON.parse(files.get(page.path).bytes);
        requireValue(exchange.request.method === 'getEvents', 'SOURCE_REQUEST_MISMATCH', 'Captured page is not a native getEvents response');
        const requestBytes = Buffer.from(exchange.request.bodyBase64, 'base64');
        requireValue(requestBytes.length === exchange.request.bytes && digest(requestBytes) === exchange.request.sha256, 'SOURCE_MISMATCH', 'Original request bytes changed');
        const request = JSON.parse(requestBytes);
        requireValue(request.jsonrpc === '2.0' && request.id === exchange.request.id && request.method === 'getEvents', 'SOURCE_REQUEST_MISMATCH', 'Original RPC request identity differs');
        const expected = { filters: clone(capture.plan.filters), pagination: { limit: capture.plan.pageSize }, xdrFormat: 'base64' };
        if (page.inputCursor !== null) expected.pagination.cursor = page.inputCursor;
        else { expected.startLedger = capture.startLedger; expected.endLedger = capture.endLedger; }
        requireValue(stableJSON(request.params) === stableJSON(expected), 'SOURCE_REQUEST_MISMATCH', 'Captured page does not match its saved original query');
        const result = rpcResult(exchange), values = pageRows(result, capture, seen), frontier = cursorPosition(result.cursor);
        requireValue(result.cursor === page.cursor, 'SOURCE_MISMATCH', 'Page cursor differs from the original response');
        originalCursor = result.cursor;
        completion ||= values.beyondEnd || cursorCompletesRange(frontier, capture.endLedger);
      }
      requireValue(originalCursor === capture.cursor, 'SOURCE_CURSOR_GAP', 'Capture cursor differs from its final original page');
      requireValue(completion, 'SOURCE_INCOMPLETE', 'Original pages do not establish the selected upper ledger boundary');
      const lastPage = capture.pages.at(-1);
      requireValue(capture.completion?.sourcePath === lastPage.path && capture.completion?.sourceSha256 === lastPage.sha256 &&
        capture.completion?.cursor === originalCursor && capture.completion?.endLedger === capture.endLedger &&
        stableJSON(edition.completion) === stableJSON(capture.completion), 'SOURCE_COMPLETION_MISMATCH', 'Edition completion is not bound to its final original page');
      const events = [...seen.values()].map((entry) => entry.event).sort((a,b) => compareIDs(a.id,b.id));
      const sourceFile = files.get(edition.source.path);
      requireValue(sourceFile.descriptor.sha256 === edition.source.sha256 && sourceFile.descriptor.bytes === edition.source.bytes &&
        sourceFile.bytes.equals(jsonBytes(events)) && events.length === edition.eventCount && events.length === capture.eventCount, 'SOURCE_PROJECTION_MISMATCH', 'Received event projection differs from its original RPC pages');
      const editionCore = clone(edition); delete editionCore.sha256; delete editionCore.receivedFrom;
      requireValue(digest(stableJSON(editionCore)) === edition.sha256, 'SOURCE_MISMATCH', 'Received edition metadata changed');
      const expectedId = digest(stableJSON({ schema: EXPORT_SCHEMA, workspaceId: source.origin.workspaceId, editionId: edition.id, editionSha256: edition.sha256 }));
      requireValue(expectedId === manifest.exportId, 'SOURCE_MISMATCH', 'Source export identity differs from its original edition');
      if (own(state.editions, edition.id)) requireValue(state.editions[edition.id].sha256 === edition.sha256, 'SOURCE_CONFLICT', 'A different edition already uses this original identifier');
      if (own(state.captures, capture.id)) requireValue(stableJSON(state.captures[capture.id].pages) === stableJSON(capture.pages), 'SOURCE_CONFLICT', 'A different capture already uses this original identifier');
      for (const [path, file] of files) if (path !== 'source.json') await writeNew(this.#directory, path, file.bytes);
      const retained = clone(edition);
      const originalWorkspaceId = edition.receivedFrom?.workspaceId ?? source.origin.workspaceId;
      requireValue(uuid(originalWorkspaceId), 'SOURCE_SCHEMA', 'The earliest retained source workspace must be an original UUID');
      retained.receivedFrom = { workspaceId: originalWorkspaceId, fromWorkspaceId: source.origin.workspaceId, exportId: manifest.exportId, manifestSha256: digest(manifestBytes) };
      state.captures[capture.id] ??= clone(capture);
      state.editions[edition.id] ??= retained;
      let plan = own(state.plans, source.plan.id) ? state.plans[source.plan.id] : null;
      if (!plan) { plan = { id: source.plan.id, name: source.plan.name, currentVersion: source.plan.version, versions: [clone(source.plan)] }; state.plans[plan.id] = plan; }
      else {
        const originalVersion = plan.versions.find((version) => version.version === source.plan.version);
        if (originalVersion) requireValue(stableJSON(originalVersion) === stableJSON(source.plan), 'SOURCE_CONFLICT', 'The original plan version has different saved fields');
        else { plan.versions.push(clone(source.plan)); plan.versions.sort((a,b) => a.version-b.version); }
      }
      await this.#save(state);
      return { edition: state.editions[edition.id], capture: state.captures[capture.id], received: true };
    });
  }
  async close() { this.#closing = true; await this.#tail; }
}
export async function openSorobanEventsWorkspace(options) {
  requireValue(options && typeof options === 'object', 'INVALID_ARGUMENT', 'Workspace options are required');
  return new SorobanEventsWorkspace(options.directory, options.connection, options.rpcRequest).initialize();
}

export async function inspectSorobanEventsWorkspace(directory, { allowMissing = false } = {}) {
  requireValue(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory, 'INVALID_DIRECTORY', 'Workspace directory must be an absolute normalized path');
  let info;
  try { info = await fs.lstat(directory); }
  catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return { schema: 'stellar-forge.soroban-events.workspace-inspection.v1', exists: false, directory, workspaceId: null, revision: null };
    throw error;
  }
  requireValue(info.isDirectory() && !info.isSymbolicLink() && await fs.realpath(directory) === directory, 'INVALID_DIRECTORY', 'Workspace must be a real directory');
  let state;
  try { state = await readJSON(directory, 'workspace.json'); }
  catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return { schema: 'stellar-forge.soroban-events.workspace-inspection.v1', exists: false, directory, workspaceId: null, revision: null };
    throw error;
  }
  requireValue(state.schema === WORKSPACE_SCHEMA && typeof state.id === 'string' && Number.isSafeInteger(state.revision), 'WORKSPACE_SCHEMA', 'Unsupported event workspace');
  return { schema: 'stellar-forge.soroban-events.workspace-inspection.v1', exists: true, directory,
    workspaceId: state.id, revision: state.revision, connection: clone(state.connection),
    plans: Object.keys(state.plans).length, captures: Object.keys(state.captures).length,
    editions: Object.keys(state.editions).length, exports: Object.keys(state.exports).length };
}
