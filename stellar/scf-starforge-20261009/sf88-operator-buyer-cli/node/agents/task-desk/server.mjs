import { createServer } from 'node:http';
import { openTaskDeskDelivery } from './customer-delivery.mjs';
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewInboxTask, createInboxTask, openInboxTask,
  openInboxTaskPacket, compareInboxTasks } from '../inbox-task.mjs';
import { privateDirectory, readJson, writeJson } from '../../store.mjs';
import { selectRetainedTask, requireRetainedReceiving, retainedTaskLocations,
  validateRetainedTaskStorage } from './retained-task.mjs';

const SCHEMA = 'stellar-forge.inbox-task-desk.v1';
const BODY_LIMIT = 4 * 1024 * 1024;
const RECORD_LIMIT = 128 * 1024 * 1024;
const ID = /^[a-f0-9]{64}$/;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TERMINAL = new Set(['succeeded', 'failed', 'interrupted']);
const activeInstances = new Set();
const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const stamp = () => new Date().toISOString();

class DeskError extends Error {
  constructor(code, message, status = 400, details) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
function need(value, code, message, status = 400) {
  if (!value) throw new DeskError(code, message, status);
}
function beneath(root, file) {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}
function errorRecord(error) {
  const record = { code: error?.code || 'DESK_OPERATION_FAILED',
    message: error?.message || 'The operation could not finish.' };
  if (error?.details !== undefined) record.details = error.details;
  if (error?.result !== undefined) record.nativeResult = error.result;
  return record;
}
function statusFor(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (error?.code === 'ENOENT') return 404;
  if (error?.code === 'ENOSPC' || error?.code === 'EDQUOT') return 507;
  if (/PENDING|CHANGED|MISMATCH|REQUIRED|OTHER_TASK|NOT_EMPTY|BINDING/.test(error?.code || '')) return 409;
  return 400;
}
function json(response, status, value) {
  const data = encode(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length, 'Cache-Control': 'no-store' });
  response.end(data);
}
async function body(request) {
  need((request.headers['content-type'] || '').split(';')[0].trim() === 'application/json',
    'DESK_JSON_REQUIRED', 'Send an application/json request.', 415);
  const declared = Number(request.headers['content-length']);
  need(!Number.isFinite(declared) || declared <= BODY_LIMIT, 'DESK_BODY_LIMIT',
    'The task specification exceeds 4 MiB.', 413);
  let length = 0; const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    need(length <= BODY_LIMIT, 'DESK_BODY_LIMIT', 'The task specification exceeds 4 MiB.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DeskError('DESK_JSON_INVALID', 'The request contains invalid JSON.'); }
  need(value && typeof value === 'object' && !Array.isArray(value),
    'DESK_OBJECT_REQUIRED', 'Send a JSON object.');
  return value;
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function taskId(task) {
  return sha(JSON.stringify([task?.system, task?.id, task?.revision]));
}
function requestId(value) {
  need(typeof value === 'string' && COMMAND_ID.test(value), 'DESK_REQUEST_ID_REQUIRED',
    'A stable requestId is required for this operation.');
  return value;
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
async function processIdentity(pid) {
  if (!processAlive(pid)) return null;
  if (process.platform === 'linux') {
    try {
      const value = await readFile('/proc/' + pid + '/stat', 'utf8');
      const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
      return 'linux:' + pid + ':' + fields[19];
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    }
  }
  return 'pid:' + pid;
}
async function checkedBytes(directory, item) {
  const path = join(directory, item.path);
  const actual = await realpath(path);
  need(beneath(directory, actual), 'DESK_PACKET_PATH', 'A packet file is outside its result folder.');
  const info = await stat(actual);
  need(info.isFile() && info.size <= RECORD_LIMIT, 'DESK_PACKET_FILE_LIMIT',
    'The packet metadata file is unavailable or too large.');
  const bytes = await readFile(actual);
  need(bytes.length === item.bytes && sha(bytes) === item.sha256,
    'DESK_PACKET_CHANGED', 'A delivered packet file changed. Reopen the original packet.', 409);
  return bytes;
}
async function writeChunk(response, chunk) {
  if (response.destroyed) throw new DeskError('DESK_DOWNLOAD_CLOSED', 'The download connection closed.');
  if (!response.write(chunk)) await new Promise((resolveDrain, reject) => {
    const cleanup = () => {
      response.off('drain', drained); response.off('close', closed); response.off('error', failed);
    };
    const drained = () => { cleanup(); resolveDrain(); };
    const closed = () => { cleanup(); reject(new DeskError('DESK_DOWNLOAD_CLOSED', 'The download connection closed.')); };
    const failed = error => { cleanup(); reject(error); };
    response.once('drain', drained); response.once('close', closed); response.once('error', failed);
    if (response.destroyed) closed();
  });
}
function tarHeader(name, length) {
  const header = Buffer.alloc(512);
  need(Buffer.byteLength(name) < 100 && Number.isSafeInteger(length) && length >= 0 &&
    length < 8 ** 11, 'DESK_ARCHIVE_ENTRY', 'A packet file cannot be represented in this archive.');
  header.write(name, 0, 100, 'utf8');
  const octal = (value, start, size) => header.write(value.toString(8).padStart(size - 1, '0') + '\0', start, size, 'ascii');
  octal(0o600, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
  octal(length, 124, 12); octal(0, 136, 12);
  header.fill(32, 148, 156); header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}
async function packetMetadataBytes(packet, name) {
  const expected = packet.packet.files.find(item => item.path === name);
  if (expected) return checkedBytes(packet.directory, expected);
  // These two metadata documents are already validated by the original packet opener.
  need(name === 'manifest.json' || name === 'receiving.json',
    'DESK_PACKET_FILE_UNKNOWN', 'This file is not part of the received packet.');
  const path = await realpath(join(packet.directory, name));
  need(beneath(packet.directory, path), 'DESK_PACKET_PATH', 'A packet file is outside its result folder.');
  const bytes = await readFile(path);
  need(bytes.length <= RECORD_LIMIT, 'DESK_PACKET_FILE_LIMIT', 'Packet metadata exceeds its supported size.');
  const decoded = JSON.parse(bytes.toString('utf8'));
  const selected = name === 'manifest.json' ? packet.packet : packet.plan;
  need(JSON.stringify(decoded) === JSON.stringify(selected), 'DESK_PACKET_CHANGED',
    'Packet metadata changed after it was opened.', 409);
  return bytes;
}

export async function startTaskDesk({ inbox, tasksDirectory, outputsDirectory,
  workspaceDirectory, commerceDirectory, customerDeliveryDirectory, existingTaskDirectory, existingOutputDirectory,
  port = 0, hostname = '127.0.0.1' } = {}) {
  need(inbox && typeof inbox.list === 'function' && typeof inbox.directory === 'string',
    'DESK_INBOX_REQUIRED', 'Select the existing native Inbox.');
  need(hostname === '127.0.0.1', 'DESK_LOOPBACK_REQUIRED', 'The local desk listens on 127.0.0.1.');
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'DESK_PORT_INVALID', 'Choose a port from 0 through 65535.');
  need(typeof tasksDirectory === 'string' && typeof outputsDirectory === 'string',
    'DESK_DIRECTORIES_REQUIRED', 'Select the saved-task and complete-result directories.');
  const tasksRoot = await privateDirectory(resolve(tasksDirectory));
  const outputsRoot = await privateDirectory(resolve(outputsDirectory));
  const inboxRoot = resolve(inbox.directory);
  need(!beneath(tasksRoot, outputsRoot) && !beneath(inboxRoot, outputsRoot) &&
    !beneath(outputsRoot, tasksRoot) && !beneath(outputsRoot, inboxRoot),
    'DESK_OUTPUT_DIRECTORY', 'Keep complete results outside the Inbox and saved-task directories.');
  if (workspaceDirectory !== undefined) workspaceDirectory = resolve(workspaceDirectory);
  async function commercePath(value = commerceDirectory) {
    need(typeof value === 'string' && isAbsolute(value), 'DESK_RPC_COMMERCE_REQUIRED',
      'Select the original absolute commerce session directory for these saved RPC reads.');
    const directory = resolve(value), actual = await realpath(directory);
    need(actual === directory && (await stat(actual)).isDirectory(),
      'DESK_RPC_COMMERCE_CHANGED', 'Use the original commerce session directory.');
    need(join(directory, 'inbox') === inboxRoot, 'DESK_RPC_COMMERCE_INBOX_CHANGED',
      'Choose the original commerce session that contains this Inbox.');
    return directory;
  }
  if (commerceDirectory !== undefined) commerceDirectory = await commercePath(commerceDirectory);
  const retained = await selectRetainedTask({ inbox,
    taskDirectory: existingTaskDirectory, outputDirectory: existingOutputDirectory });
  const retainedId = await validateRetainedTaskStorage({ selection: retained, inbox,
    tasksDirectory: tasksRoot, outputsDirectory: outputsRoot });
  const operationRoot = await privateDirectory(join(tasksRoot, '.desk-operations'));
  const instanceId = randomUUID(), token = randomBytes(32).toString('hex');
  const reviews = new Map(), running = new Set(), liveOperations = new Map();
  const ownerProcessIdentity = await processIdentity(process.pid);
  const packetCache = new Map();
  let cachedBytes = 0;
  const CACHE_LIMIT = 32 * 1024 * 1024;
  let origin, closing = false;

  const taskPath = id => {
    need(ID.test(id), 'DESK_TASK_ID_INVALID', 'Choose a saved task.', 404);
    return id === retainedId ? retained.taskDirectory : join(tasksRoot, id);
  };
  const outputPath = id => id === retainedId ? retained.outputDirectory : join(outputsRoot, id);
  const locations = id => id === retainedId ? retainedTaskLocations(retained) : {
    taskDirectory: taskPath(id), outputDirectory: outputPath(id), retained: false,
    mode: 'desk', receiveAllowed: true,
  };
  const operationPath = id => join(operationRoot, sha(requestId(id)) + '.json');
  const openTask = id => openInboxTask({ inbox, directory: taskPath(id),
    ...(id === retainedId ? { expectedTaskSha256: retained.taskSha256 } : {}) });
  const delivery = customerDeliveryDirectory === undefined ? null : await openTaskDeskDelivery({
    directory: customerDeliveryDirectory, privateRoots: [tasksRoot, outputsRoot, inboxRoot,
      workspaceDirectory, commerceDirectory, retained?.taskDirectory, retained?.outputDirectory],
    openTask, outputPath,
  });
  function customerDelivery() {
    need(delivery, 'DESK_CUSTOMER_DELIVERY_REQUIRED',
      'Open this desk with --delivery and a separate private customer-delivery directory.', 409);
    need(!closing, 'DESK_CLOSING', 'Reopen the same task desk to continue.', 503);
    return delivery;
  }
  function forgetPacket(id) {
    const previous = packetCache.get(id);
    if (previous) { cachedBytes -= previous.bytes; packetCache.delete(id); }
  }
  async function packetKey(id, task) {
    const directory = outputPath(id);
    const stamps = [];
    for (const name of ['manifest.json', 'receiving.json']) {
      const value = await stat(join(directory, name), { bigint: true });
      stamps.push([value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String));
    }
    return JSON.stringify([directory, task.taskSha256, stamps]);
  }
  const openPacket = async (id, { fresh = false } = {}) => {
    const task = await openTask(id), key = await packetKey(id, task);
    const previous = packetCache.get(id);
    if (!fresh && previous?.key === key) {
      packetCache.delete(id); packetCache.set(id, previous);
      return previous.packet;
    }
    forgetPacket(id);
    const packet = await openInboxTaskPacket({ directory: outputPath(id),
      expectedTaskSha256: task.taskSha256 });
    const finalKey = await packetKey(id, task);
    need(finalKey === key, 'DESK_PACKET_CHANGED', 'The packet changed while it was opened. Reopen its original receiving.', 409);
    const bytes = encode(packet.packet).length + encode(packet.plan).length;
    if (bytes <= CACHE_LIMIT) {
      while (packetCache.size >= 16 || cachedBytes + bytes > CACHE_LIMIT)
        forgetPacket(packetCache.keys().next().value);
      packetCache.set(id, { key, packet, bytes, openedAt: stamp() }); cachedBytes += bytes;
    }
    return packet;
  };
  async function operationView(id) {
    const active = liveOperations.get(id);
    if (active) return { ...active };
    const operation = await readJson(operationPath(id), RECORD_LIMIT);
    need(operation.schema === SCHEMA && operation.id === id, 'DESK_OPERATION_INVALID',
      'The saved operation could not be opened.');
    const originalProcess = !TERMINAL.has(operation.state)
      ? await processIdentity(operation.ownerPid) : null;
    const ownerMissing = operation.ownerPid === process.pid
      ? !activeInstances.has(operation.ownerInstance)
      : originalProcess === null ||
        (operation.ownerProcessIdentity && operation.ownerProcessIdentity !== originalProcess);
    if (!TERMINAL.has(operation.state) && ownerMissing) {
      return { ...operation, state: 'interrupted', finishedAt: null,
        error: { code: 'DESK_SERVICE_RESTARTED',
          message: 'The service stopped during this command. Inspect the original request, then continue its recovery or receiving.' } };
    }
    return operation;
  }
  async function operations(task) {
    const items = [];
    for (const file of await readdir(operationRoot)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      const row = await readJson(join(operationRoot, file), RECORD_LIMIT);
      if (row.schema !== SCHEMA || (task && row.taskId !== task)) continue;
      items.push(await operationView(row.id));
    }
    const listed = new Set(items.map(item => item.id));
    for (const item of liveOperations.values()) {
      if (!listed.has(item.id) && (!task || item.taskId === task)) items.push({ ...item });
    }
    return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async function specification(input) {
    const value = { inbox, task: input.task, selections: input.selections };
    if (input.predecessorId) {
      const previous = await openTask(input.predecessorId);
      value.predecessor = { taskSha256: previous.taskSha256,
        system: previous.manifest.task.system, id: previous.manifest.task.id,
        revision: previous.manifest.task.revision };
    }
    return value;
  }
  async function detail(id) {
    const task = await openTask(id);
    let inspection = null, inspectionError = null, packet = null, packetError = null;
    try { inspection = await task.inspect(); } catch (error) { inspectionError = errorRecord(error); }
    try { packet = (await openPacket(id)).toJSON(); }
    catch (error) { if (error.code !== 'ENOENT') packetError = errorRecord(error); }
    return { id, record: task.record, inspection, inspectionError, packet, packetError,
      locations: locations(id), packetOpenedAt: packetCache.get(id)?.openedAt ?? null };
  }
  async function queue(kind, id, input) {
    need(!closing, 'DESK_CLOSING', 'The desk is closing. Reopen it to continue.', 503);
    const command = requestId(input.requestId);
    const binding = { kind, taskId: id, intentId: input.intentId ?? null,
      reviewId: kind === 'execute' ? input.reviewId ?? null : null };
    const bindingSha256 = sha(JSON.stringify(binding));
    try {
      const saved = await operationView(command);
      need(saved.bindingSha256 === bindingSha256, 'DESK_REQUEST_ID_REUSED',
        'This requestId belongs to a different command. Keep the original command identity or choose a new one.', 409);
      return saved;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const task = await openTask(id);
    if (kind === 'receive' && id === retainedId) await requireRetainedReceiving(retained, task);
    if (kind !== 'receive') need(typeof input.intentId === 'string' &&
      task.manifest.entries.some(entry => entry.selection.intentId === input.intentId),
      'TASK_INTENT_NOT_SELECTED', 'Choose a request selected by this task.');
    let selectedReview;
    if (kind === 'execute') {
      selectedReview = reviews.get(input.reviewId);
      need(selectedReview && selectedReview.taskId === id && selectedReview.intentId === input.intentId,
        'TASK_MATCHING_REVIEW_REQUIRED', 'Open the current native review before executing this request.', 409);
    }
    const operation = { schema: SCHEMA, id: command, ...binding, bindingSha256, locations: locations(id),
      state: 'queued', ownerPid: process.pid, ownerInstance: instanceId, ownerProcessIdentity,
      startedAt: stamp(), finishedAt: null, result: null, error: null };
    try { await writeJson(operationPath(command), operation, { exclusive: true }); }
    catch (error) {
      if (error.code !== 'EEXIST') {
        // Even a failed journal publication can leave its queued record on disk.
        // Retain the known pre-dispatch failure for the running desk's recovery view.
        operation.state = 'failed'; operation.error = errorRecord(error); operation.finishedAt = stamp();
        operation.persistenceError = errorRecord(error); liveOperations.set(command, operation);
        throw error;
      }
      const saved = await operationView(command);
      need(saved.bindingSha256 === bindingSha256, 'DESK_REQUEST_ID_REUSED',
        'This requestId belongs to a different command.', 409);
      return saved;
    }
    liveOperations.set(command, operation);
    const work = (async () => {
      operation.state = 'running';
      try {
        await writeJson(operationPath(command), operation);
        if (kind === 'execute') {
          reviews.delete(input.reviewId);
          operation.result = await task.execute(input.intentId, {
            review: selectedReview.review, workspaceDirectory });
        } else if (kind === 'recover') operation.result = await task.recover(input.intentId);
        else {
          const directory = id === retainedId ? await requireRetainedReceiving(retained, task) : outputPath(id);
          operation.result = (await task.receive({ directory })).toJSON();
        }
        operation.state = 'succeeded';
      } catch (error) {
        operation.state = 'failed'; operation.error = errorRecord(error);
      }
      operation.finishedAt = stamp();
      if (kind === 'receive') forgetPacket(id);
      try {
        await writeJson(operationPath(command), operation);
        liveOperations.delete(command);
      } catch (error) {
        operation.persistenceError = errorRecord(error);
      }
    })();
    running.add(work);
    work.catch(() => {}).finally(() => running.delete(work));
    return { ...operation };
  }
  async function download(response, id, intent) {
    const packet = await openPacket(id), file = packet.files.find(item => item.intentId === intent);
    need(file, 'TASK_PACKET_INTENT_NOT_FOUND', 'Choose a complete result from this packet.', 404);
    const received = packet.response(intent);
    const chunks = received.chunks()[Symbol.asyncIterator]();
    try {
      // Opening the first chunk performs the original complete-file validation.
      const first = await chunks.next();
      response.writeHead(200, { 'Content-Type': 'application/octet-stream',
        'Content-Length': file.bytes, 'Content-Disposition': 'attachment; filename="' + file.path.split('/').pop() + '"',
        'Cache-Control': 'no-store' });
      if (!first.done) await writeChunk(response, first.value);
      for (;;) {
        const part = await chunks.next();
        if (part.done) break;
        await writeChunk(response, part.value);
      }
      response.end();
    } finally { await chunks.return?.(); }
  }
  async function archive(response, id) {
    const packet = await openPacket(id, { fresh: true });
    const documents = [];
    for (const name of ['task.json', 'receiving.json', 'review.html', 'manifest.json'])
      documents.push({ name, bytes: await packetMetadataBytes(packet, name) });
    response.writeHead(200, { 'Content-Type': 'application/x-tar',
      'Content-Disposition': 'attachment; filename="task-results-' + id.slice(0, 12) + '.tar"',
      'Cache-Control': 'no-store' });
    for (const item of documents) {
      await writeChunk(response, tarHeader(item.name, item.bytes.length));
      await writeChunk(response, item.bytes);
      if (item.bytes.length % 512) await writeChunk(response, Buffer.alloc(512 - item.bytes.length % 512));
    }
    for (const item of packet.files) {
      await writeChunk(response, tarHeader(item.path, item.bytes));
      for await (const chunk of packet.response(item.intentId).chunks()) await writeChunk(response, chunk);
      if (item.bytes % 512) await writeChunk(response, Buffer.alloc(512 - item.bytes % 512));
    }
    await writeChunk(response, Buffer.alloc(1024)); response.end();
  }
  const assets = new Map([
    ['/', { path: join(publicRoot, 'index.html'), type: 'text/html; charset=utf-8' }],
    ['/assets/customer-delivery.mjs', { path: join(publicRoot, 'customer-delivery.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/assets/app.mjs', { path: join(publicRoot, 'app.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/assets/style.css', { path: join(publicRoot, 'style.css'), type: 'text/css; charset=utf-8' }],
    ['/assets/client.mjs', { path: fileURLToPath(new URL('./client.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8' }],
    ['/client.mjs', { path: fileURLToPath(new URL('./client.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8' }],
  ]);
  const server = createServer((request, response) => {
    response.setHeader('X-Task-Desk-Instance', instanceId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const handle = async () => {
      need(origin && request.headers.host === new URL(origin).host,
        'DESK_HOST_REJECTED', 'Use this desk’s original local address.', 403);
      if (request.headers.origin) need(request.headers.origin === origin,
        'DESK_ORIGIN_REJECTED', 'Open this action from the task desk.', 403);
      const url = new URL(request.url, origin);
      need(url.origin === origin, 'DESK_ORIGIN_REJECTED', 'Use the original task desk address.', 403);
      if (request.method === 'POST') need(safeEqual(request.headers['x-task-desk-token'], token),
        'DESK_SESSION_REQUIRED', 'Reconnect to this desk before continuing.', 403);
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname), bytes = await readFile(asset.path);
        response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': bytes.length,
          'Cache-Control': 'no-store' }); response.end(bytes); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/status')
        return json(response, 200, { schema: SCHEMA, title: 'Task desk', instanceId, csrfToken: token,
          roots: { tasks: tasksRoot, outputs: outputsRoot, inbox: inbox.directory,
            ...(commerceDirectory === undefined ? {} : { commerce: commerceDirectory }),
            ...(delivery ? { customerDelivery: delivery.directory } : {}),
            ...(retained ? { existingTask: retained.taskDirectory, existingOutput: retained.outputDirectory } : {}) },
          runningOperations: running.size });
      if (request.method === 'POST' && url.pathname === '/api/customer-delivery/source-manifest')
        return json(response, 200, await customerDelivery().source(await body(request)));
      if (request.method === 'GET' && url.pathname === '/api/jobs') {
        const result = await inbox.list();
        return json(response, 200, { jobs: result.native?.jobs ?? [], process: result.process });
      }
      const rpc = /^\/api\/jobs\/([^/]+)\/rpc-results(?:\/([^/]+)(\/download)?)?$/.exec(url.pathname);
      if (request.method === 'GET' && rpc) {
        const intentId = decodeURIComponent(rpc[1]);
        const directory = await commercePath(url.searchParams.get('commerceDirectory') ?? commerceDirectory);
        need(typeof inbox.rpcResponses === 'function' && typeof inbox.rpcResponse === 'function',
          'DESK_RPC_RUNTIME_REQUIRED', 'Open the maintained Inbox runtime with saved RPC result support.');
        if (!rpc[2]) return json(response, 200, await inbox.rpcResponses(intentId, { commerceDirectory: directory }));
        const received = await inbox.rpcResponse(intentId, {
          commerceDirectory: directory, readId: decodeURIComponent(rpc[2]),
          expectedResponseSha256: url.searchParams.get('responseSha256'),
        });
        need(received, 'DESK_RPC_RESULT_NOT_FOUND', 'Select a completed original RPC read.', 404);
        if (!rpc[3]) return json(response, 200, {
          intentId, job: received.job, recovery: received.recovery,
          delivery: received.delivery, verified: await received.verify(),
        });
        // Keep the full original byte stream in the native verified-file path.
        const chunks = received.chunks()[Symbol.asyncIterator]();
        try {
          const first = await chunks.next();
          response.writeHead(200, { 'Content-Type': 'application/octet-stream',
            'Content-Length': received.delivery.bytes,
            'Content-Disposition': 'attachment; filename="rpc-result-' + received.recovery.readId + '.json"',
            'Cache-Control': 'no-store' });
          if (!first.done) await writeChunk(response, first.value);
          for (;;) {
            const part = await chunks.next();
            if (part.done) break;
            await writeChunk(response, part.value);
          }
          response.end();
        } finally { await chunks.return?.(); }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/tasks') {
        const tasks = [], issues = [];
        if (retained) {
          try {
            const task = await openTask(retainedId);
            tasks.push({ id: retainedId, record: task.record,
              summary: { requests: task.manifest.entries.length }, locations: locations(retainedId) });
          } catch (error) { issues.push({ id: retainedId, error: errorRecord(error) }); }
        }
        for (const entry of await readdir(tasksRoot, { withFileTypes: true })) {
          if (!entry.isDirectory() || !ID.test(entry.name) || entry.name === retainedId) continue;
          try {
            const task = await openTask(entry.name);
            tasks.push({ id: entry.name, record: task.record,
              summary: { requests: task.manifest.entries.length }, locations: locations(entry.name) });
          } catch (error) { issues.push({ id: entry.name, error: errorRecord(error) }); }
        }
        tasks.sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
        return json(response, 200, { tasks, issues });
      }
      if (request.method === 'POST' && url.pathname === '/api/tasks/preview')
        return json(response, 200, await previewInboxTask(await specification(await body(request))));
      if (request.method === 'POST' && url.pathname === '/api/tasks') {
        const input = await body(request), spec = await specification(input), id = taskId(spec.task);
        await createInboxTask({ ...spec, directory: taskPath(id),
          expectedPreviewSha256: input.expectedPreviewSha256 });
        return json(response, 201, await detail(id));
      }
      if (request.method === 'GET' && url.pathname === '/api/operations')
        return json(response, 200, { operations: await operations(url.searchParams.get('taskId')) });
      const op = /^\/api\/operations\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && op)
        return json(response, 200, { operation: await operationView(decodeURIComponent(op[1])) });
      const route = /^\/api\/tasks\/([a-f0-9]{64})(?:\/(.*))?$/.exec(url.pathname);
      if (!route) throw new DeskError('DESK_NOT_FOUND', 'This task desk route does not exist.', 404);
      const [, id, action = ''] = route;
      if (request.method === 'GET' && !action) return json(response, 200, await detail(id));
      if (action === 'customer-deliveries' && request.method === 'GET')
        return json(response, 200, await customerDelivery().list(id));
      if (action === 'customer-deliveries/inspect-task' && request.method === 'GET')
        return json(response, 200, await customerDelivery().inspectTask(id));
      if (action === 'customer-deliveries/preview' && request.method === 'POST')
        return json(response, 200, await customerDelivery().preview(id, await body(request)));
      if (action === 'customer-deliveries/prepare' && request.method === 'POST')
        return json(response, 200, await customerDelivery().prepare(id, await body(request)));
      const deliveryRoute = /^customer-deliveries\/named\/([^/]+)(\/download)?$/.exec(action);
      if (deliveryRoute && request.method === 'GET') {
        const selected = customerDelivery(), deliveryId = decodeURIComponent(deliveryRoute[1]);
        if (deliveryRoute[2]) return selected.download(id, deliveryId, response);
        return json(response, 200, await selected.inspect(id, deliveryId));
      }
      if (request.method === 'GET' && action === 'compare') {
        const previous = await openTask(url.searchParams.get('previousId')), next = await openTask(id);
        return json(response, 200, compareInboxTasks(previous.record, next.record));
      }
      if (request.method === 'GET' && action === 'packet') return json(response, 200, (await openPacket(id, { fresh: true })).toJSON());
      if (request.method === 'GET' && action === 'packet/download')
        return download(response, id, url.searchParams.get('intentId'));
      if (request.method === 'GET' && action === 'packet/archive') return archive(response, id);
      if (request.method === 'GET' && action === 'packet/review') {
        const packet = await openPacket(id), bytes = await packetMetadataBytes(packet, 'review.html');
        response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox allow-downloads");
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': bytes.length,
          'Content-Disposition': 'attachment; filename="task-review.html"', 'Cache-Control': 'no-store' });
        response.end(bytes); return;
      }
      if (request.method === 'POST' && action === 'review') {
        const input = await body(request), task = await openTask(id), review = await task.review(input.intentId);
        const reviewId = randomUUID();
        if (reviews.size >= 2048) reviews.delete(reviews.keys().next().value);
        reviews.set(reviewId, { taskId: id, intentId: input.intentId, review });
        return json(response, 200, { reviewId, review });
      }
      if (request.method === 'POST' && ['execute', 'recover', 'receive'].includes(action))
        return json(response, 202, { operation: await queue(action, id, await body(request)) });
      throw new DeskError('DESK_NOT_FOUND', 'This task desk action does not exist.', 404);
    };
    handle().catch(error => {
      if (response.headersSent || response.destroyed) { response.destroy(error); return; }
      json(response, statusFor(error), { error: errorRecord(error) });
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => { server.off('error', reject); resolveListening(); });
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  activeInstances.add(instanceId);
  return { server, url: origin, instanceId,
    async close() {
      closing = true;
      await Promise.allSettled([...running]);
      if (delivery) await delivery.close();
      try { await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); }
      finally { activeInstances.delete(instanceId); }
    } };
}
