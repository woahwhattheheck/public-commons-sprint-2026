#!/usr/bin/env node
/**
 * Operate the original OpenLineage collector for one retained Analysis receiving.
 * The Python owner supplies the complete native event file and owns this process.
 * stdout is a JSONL control channel; token contents never enter that channel.
 */
import { constants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { startServer } from '../../../sf30-seller-sdk/openlineage-workspace/server.mjs';
import { LineageClient } from '../../../sf30-seller-sdk/openlineage-workspace/client.mjs';
import { APPLICATION_FILES, verifyBundle, receiveBundle } from '../../../sf30-seller-sdk/openlineage-workspace/store.mjs';
import { parseSource, digest as nativeDigest } from '../../../sf30-seller-sdk/openlineage-workspace/model.mjs';

const SCHEMA = 'stellar-forge.analysis-lineage-collector.v1';
const APP_ROOT = fileURLToPath(new URL('../../../sf30-seller-sdk/openlineage-workspace/', import.meta.url));
const MAX_SOURCE = 16 * 1024 * 1024, MAX_BUNDLE = 128 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ACTIONS = new Set(['status', 'arm_loss', 'restart', 'verify', 'export_restore', 'close']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value) + '\n');
const same = (a, b) => nativeDigest(a) === nativeDigest(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, details = null) => { throw Object.assign(new Error(code), { code, details }); };
const need = (value, code) => { if (!value) fail(code); };
function keys(value, names, code = 'CONTROL_REQUEST_INVALID') {
  need(object(value) && Object.keys(value).length === names.length &&
    names.every(name => Object.hasOwn(value, name)), code);
}
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), 'ABSOLUTE_PATH_REQUIRED');
  return resolve(value);
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const file = await fs.open(path, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
async function privateDirectory(path) {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await fs.realpath(path) === path, 'PRIVATE_DIRECTORY_REQUIRED');
  if (typeof process.getuid === 'function')
    need(info.uid === process.getuid() && (info.mode & 0o077) === 0, 'PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
async function readFile(path, maximum, { privateFile = false, allowEmpty = false } = {}) {
  const before = await fs.lstat(path, { bigint: true });
  need(before.isFile() && before.size >= BigInt(allowEmpty ? 0 : 1) &&
    before.size <= BigInt(maximum), 'RETAINED_FILE_INVALID');
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  const stamp = value => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs, value.mode].join(':');
  try {
    const opened = await handle.stat({ bigint: true });
    need(stamp(before) === stamp(opened), 'RETAINED_FILE_CHANGED');
    if (privateFile && typeof process.getuid === 'function')
      need(opened.uid === BigInt(process.getuid()) && (opened.mode & 0o077n) === 0n, 'PRIVATE_FILE_REQUIRED');
    const bytes = Buffer.alloc(Number(opened.size)); let offset = 0;
    while (offset < bytes.length) {
      const part = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      need(part.bytesRead > 0, 'RETAINED_FILE_CHANGED'); offset += part.bytesRead;
    }
    const after = await handle.stat({ bigint: true }), current = await fs.lstat(path, { bigint: true });
    need(stamp(opened) === stamp(after) && stamp(opened) === stamp(current), 'RETAINED_FILE_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
async function readJson(path, maximum = 1024 * 1024) {
  try { return JSON.parse((await readFile(path, maximum)).toString('utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function immutable(path, bytes) {
  const temporary = path + '.' + randomUUID() + '.incoming';
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  try {
    try { await fs.link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need((await readFile(path, Math.max(1, bytes.length), { allowEmpty: true })).equals(bytes), 'RETAINED_ARTIFACT_CHANGED');
    }
    await syncDirectory(dirname(path));
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function save(path, value) {
  const temporary = path + '.' + randomUUID() + '.pending', handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temporary, path); await syncDirectory(dirname(path)); }
  finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function token(path) {
  if (!await readJson(path + '.identity.json')) {
    try { await fs.access(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await immutable(path, Buffer.from(randomBytes(32).toString('base64url') + '\n'));
    }
  }
  const value = (await readFile(path, 65536, { privateFile: true })).toString('utf8').trim();
  need(value.length >= 24 && !/[\r\n\0]/.test(value), 'ORIGINAL_TOKEN_INVALID');
  await immutable(path + '.identity.json', json({ sha256: sha(Buffer.from(value)), bytes: Buffer.byteLength(value) }));
  return value;
}
async function processIdentity(pid) {
  if (process.platform === 'linux') {
    try {
      const [raw, boot] = await Promise.all([fs.readFile('/proc/' + pid + '/stat', 'utf8'),
        fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')]);
      const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
      return { pid, boot: boot.trim(), started: fields[19], live: fields[0] !== 'Z' };
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
  }
  try { process.kill(pid, 0); return { pid, live: true }; }
  catch (error) { if (error.code === 'ESRCH') return null; throw error; }
}
async function acquireLease(root) {
  const path = join(root, 'collector.lock'), nonce = randomUUID();
  const identity = await processIdentity(process.pid);
  need(identity?.live, 'CURRENT_PROCESS_IDENTITY_UNAVAILABLE');
  const value = { schema: SCHEMA, nonce, ...identity };
  try { await immutable(path, json(value)); }
  catch (error) {
    if (error.code !== 'RETAINED_ARTIFACT_CHANGED') throw error;
    const old = await readJson(path);
    need(old?.schema === SCHEMA && Number.isInteger(old.pid) && old.pid > 0 && typeof old.nonce === 'string' && /^[a-f0-9-]{36}$/.test(old.nonce), 'ORIGINAL_HELPER_LEASE_INVALID');
    const observed = await processIdentity(old.pid);
    const sameProcess = observed && observed.live &&
      (process.platform !== 'linux' || (old.boot === observed.boot && old.started === observed.started));
    need(!sameProcess, 'ORIGINAL_HELPER_STILL_RUNNING');
    const before = await readFile(path, 65536);
    need(same(JSON.parse(before), old), 'ORIGINAL_HELPER_LEASE_CHANGED');
    await immutable(join(root, 'retired-lease-' + old.nonce + '.json'), before);
    need((await readFile(path, 65536)).equals(before), 'ORIGINAL_HELPER_LEASE_CHANGED');
    await fs.unlink(path);
    await immutable(path, json(value));
  }
  return async () => {
    const current = await readJson(path);
    need(current?.nonce === nonce, 'ORIGINAL_HELPER_LEASE_CHANGED');
    await fs.unlink(path); await syncDirectory(root);
  };
}
function receiptBinding(receipt, specification, workspaceId, bytes) {
  need(object(receipt) && receipt.workspaceId === workspaceId &&
    receipt.operationId === specification.operationId && object(receipt.source) &&
    receipt.source.id === specification.sourceSha256 && receipt.source.bytes === bytes &&
    receipt.source.name === specification.sourceName && receipt.source.sourceUrl === specification.sourceUrl &&
    receipt.source.contentEncoding === 'identity' && receipt.source.format === 'array' &&
    Number.isSafeInteger(receipt.revision) && receipt.revision >= 0 &&
    Number.isSafeInteger(receipt.added) && receipt.added >= 0 &&
    receipt.retained === specification.eventCount && receipt.added <= receipt.retained, 'NATIVE_RECEIPT_CHANGED');
}
function sourceSpecification(args) {
  keys(args, ['operationId', 'sourcePath', 'sourceSha256', 'sourceName', 'sourceUrl', 'eventCount'], 'SOURCE_REQUEST_INVALID');
  const id = typeof args.operationId === 'string' && /^analysis-([a-f0-9]{32})-([a-f0-9]{32})$/.exec(args.operationId);
  need(id && SHA.test(args.sourceSha256) && args.sourceName === 'analysis-lineage-' + id[2] + '.json' &&
    args.sourceUrl === 'urn:stellar-forge:analysis:' + id[1] + ':lineage:' + id[2] &&
    Number.isSafeInteger(args.eventCount) && args.eventCount > 0, 'SOURCE_REQUEST_INVALID');
  absolute(args.sourcePath); return args;
}

class Collector {
  constructor(root, operationId) {
    this.root = root; this.operationId = operationId;
    this.workspaceDirectory = join(root, 'workspace');
    this.connectionFile = join(this.workspaceDirectory, 'connection.json');
    this.producerTokenFile = join(root, 'producer-token');
    this.host = null; this.receivedHost = null; this.captureInFlight = false;
    this.pendingResponses = new Set(); this.stateWrites = Promise.resolve();
    this.controller = new AbortController(); this.captureError = null; this.release = null;
  }
  async initialize() {
    await privateDirectory(this.root);
    this.release = await acquireLease(this.root);
    for (const child of ['requests', 'receipts', 'exports', 'received']) await privateDirectory(join(this.root, child));
    const application = [];
    for (const path of APPLICATION_FILES) {
      const bytes = await readFile(join(APP_ROOT, path), 4 * 1024 * 1024);
      application.push({ path, bytes: bytes.length, sha256: sha(bytes) });
    }
    const input = { schema: SCHEMA, operationId: this.operationId, directory: this.root,
      helperSha256: sha(await readFile(fileURLToPath(import.meta.url), 1024 * 1024)), application };
    const original = await readJson(join(this.root, 'operation.json'), 1024 * 1024);
    if (original) need(same(original, input), 'ORIGINAL_COLLECTOR_SOURCE_CHANGED');
    else {
      const existing = await readJson(join(this.workspaceDirectory, 'workspace.json'), MAX_BUNDLE);
      need(!existing, 'UNSELECTED_COLLECTOR_WORKSPACE');
      await immutable(join(this.root, 'operation.json'), json(input));
    }
    this.input = input;
    this.operatorToken = await token(join(this.root, 'operator-token'));
    this.producerToken = await token(this.producerTokenFile);
    need(this.operatorToken !== this.producerToken, 'SEPARATE_PRODUCER_TOKEN_REQUIRED');
    this.state = await readJson(join(this.root, 'state.json'), 4 * 1024 * 1024) ??
      { schema: SCHEMA, operationId: this.operationId, workspaceId: null, instances: [], armed: null };
    need(this.state.schema === SCHEMA && this.state.operationId === this.operationId, 'ORIGINAL_COLLECTOR_STATE_CHANGED');
    await this.start();
    await this.reconcileCapture();
    return this.ready();
  }
  ready() {
    return { state: 'READY', operationId: this.operationId, identity: this.host.identity,
      connectionFile: this.connectionFile, producerTokenFile: this.producerTokenFile };
  }
  stateChange(action) {
    const result = this.stateWrites.then(async () => { action(this.state); await save(join(this.root, 'state.json'), this.state); });
    this.stateWrites = result.catch(() => {}); return result;
  }
  async start() {
    need(!this.host, 'ORIGINAL_COLLECTOR_ALREADY_STARTED');
    const host = await startServer({ directory: this.workspaceDirectory, title: 'Original Analysis lineage receiving',
      port: 0, token: this.operatorToken, producerToken: this.producerToken,
      ...(this.state.workspaceId ? { expectedWorkspaceId: this.state.workspaceId } : {}) });
    this.host = host;
    await this.recoverOriginalWriter(host);
    this.installLossObserver(host);
    await this.stateChange(state => {
      if (state.workspaceId) need(state.workspaceId === host.identity.workspaceId, 'COLLECTOR_WORKSPACE_CHANGED');
      state.workspaceId = host.identity.workspaceId;
      if (!state.instances.some(item => item.instanceId === host.identity.instanceId))
        state.instances.push({ ...host.identity });
    });
  }
  async recoverOriginalWriter(host) {
    const original = await readJson(join(host.workspace.directory, 'writer.lock'));
    if (!original) return;
    need(typeof original.id === 'string' && Number.isInteger(original.pid) &&
      this.state.instances.some(item => item.pid === original.pid), 'UNSELECTED_NATIVE_WRITER');
    // The original application verifies that its exact recorded writer is dead.
    const result = await host.workspace.recoverLock(original.id);
    await immutable(join(this.root, 'receipts', 'native-writer-' + sha(Buffer.from(original.id)) + '.json'),
      json({ schema: SCHEMA, original, result, workspaceId: this.state.workspaceId }));
  }
  captureFile() { return join(this.root, 'receipts', 'original-lost-response.json'); }
  async reconcileCapture() {
    const capture = await readJson(this.captureFile(), 2 * 1024 * 1024);
    if (!capture) return null;
    const arm = this.state.armed;
    need(arm && capture.status === 200 && capture.operationId === arm.operationId &&
      capture.sourceSha256 === arm.sourceSha256 && capture.receipt.workspaceId === this.state.workspaceId,
      'ORIGINAL_LOST_RESPONSE_CHANGED');
    const raw = Buffer.from(capture.bodyBase64, 'base64');
    need(raw.length === capture.bytes && sha(raw) === capture.sha256 &&
      same(JSON.parse(raw.toString('utf8')), capture.receipt) &&
      capture.receipt.operationId === arm.operationId && capture.receipt.source?.id === arm.sourceSha256,
      'ORIGINAL_LOST_RESPONSE_CHANGED');
    if (arm.state !== 'CAPTURED') await this.stateChange(state => { state.armed.state = 'CAPTURED'; });
    return capture;
  }
  installLossObserver(host) {
    host.server.prependListener('request', (request, response) => {
      const arm = this.state.armed;
      let pathname; try { pathname = new URL(request.url, host.url).pathname; } catch { return; }
      if (!arm || arm.state !== 'ARMED' || request.method !== 'POST' || pathname !== '/api/v1/lineage' ||
          request.headers['idempotency-key'] !== arm.operationId) return;
      const end = response.end;
      response.end = (...args) => {
        const chunk = args[0], encoding = typeof args[1] === 'string' ? args[1] : undefined;
        const raw = Buffer.isBuffer(chunk) ? Buffer.from(chunk) :
          typeof chunk === 'string' ? Buffer.from(chunk, encoding) : null;
        let receipt; try { receipt = raw && JSON.parse(raw.toString('utf8')); } catch {}
        if (this.captureInFlight || arm.state !== 'ARMED' || response.statusCode !== 200 || !raw ||
            raw.length > 1024 * 1024 || receipt?.workspaceId !== this.state.workspaceId ||
            receipt?.operationId !== arm.operationId || receipt?.source?.id !== arm.sourceSha256)
          return end.apply(response, args);
        this.captureInFlight = true;
        const captured = { schema: SCHEMA, operationId: arm.operationId, sourceSha256: arm.sourceSha256,
          status: response.statusCode, endpoint: host.url, instanceId: host.identity.instanceId,
          receivedAt: new Date().toISOString(), bytes: raw.length, sha256: sha(raw),
          bodyBase64: raw.toString('base64'), receipt,
          headers: { contentType: response.getHeader('content-type') ?? null, location: response.getHeader('location') ?? null } };
        const work = (async () => {
          let retained = false;
          try {
            await immutable(this.captureFile(), json(captured)); retained = true;
            await this.stateChange(state => { state.armed.state = 'CAPTURED'; });
          } catch (error) {
            this.captureError = { code: error.code ?? 'CAPTURE_RETENTION_FAILED', message: error.message };
          } finally {
            if (retained) response.destroy();
            else end.apply(response, args);
            this.captureInFlight = false;
          }
        })();
        this.pendingResponses.add(work);
        work.then(() => this.pendingResponses.delete(work), () => this.pendingResponses.delete(work));
        return response;
      };
    });
  }
  client(host = this.host, producer = false, fetchImpl = globalThis.fetch) {
    return new LineageClient(host.url, { token: producer ? this.producerToken : this.operatorToken,
      expectedWorkspaceId: this.state.workspaceId, timeoutMs: 300000, signal: this.controller.signal, fetchImpl });
  }
  async source(directory, args) {
    sourceSpecification(args);
    const path = join(directory, 'original-events.json');
    let bytes;
    try { bytes = await readFile(path, MAX_SOURCE, { privateFile: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      bytes = await readFile(absolute(args.sourcePath), MAX_SOURCE);
      need(sha(bytes) === args.sourceSha256, 'ORIGINAL_EVENT_SOURCE_CHANGED');
      await immutable(path, bytes);
    }
    need(sha(bytes) === args.sourceSha256, 'ORIGINAL_EVENT_SOURCE_CHANGED');
    const parsed = parseSource(bytes, args.sourceName);
    need(parsed.format === 'array' && parsed.events.length === args.eventCount, 'ORIGINAL_EVENT_COUNT_CHANGED');
    return { bytes, eventIds: parsed.events.map(item => item.id) };
  }
  async verified(args, source, host = this.host) {
    const state = await host.workspace.read();
    need(state.workspaceId === this.state.workspaceId, 'COLLECTOR_WORKSPACE_CHANGED');
    const native = state.operations.filter(item => item.id === args.operationId);
    need(native.length === 1, 'ORIGINAL_PUBLICATION_NOT_FOUND');
    const input = { action: 'source.import', objectId: args.sourceSha256, name: args.sourceName,
      sourceUrl: args.sourceUrl, contentEncoding: 'identity' };
    need(native[0].requestHash === nativeDigest(input), 'ORIGINAL_PUBLICATION_REQUEST_CHANGED');
    receiptBinding(native[0].result, args, state.workspaceId, source.bytes.length);
    const selected = state.sources.filter(item => item.id === args.sourceSha256);
    need(selected.length === 1 && same(selected[0].eventIds, source.eventIds), 'ORIGINAL_SOURCE_EVENTS_CHANGED');
    need((await host.workspace.readObject(args.sourceSha256)).equals(source.bytes), 'ORIGINAL_EVENT_SOURCE_CHANGED');
    const ids = new Set(source.eventIds);
    const actual = state.events.filter(item => ids.has(item.id) &&
      item.sources.some(origin => origin.sourceId === args.sourceSha256));
    need(actual.length === ids.size, 'ORIGINAL_EVENT_IDENTITY_CHANGED');
    return { state, result: { identity: host.identity, workspaceId: state.workspaceId, revision: state.revision,
      eventCount: state.events.length, sourceEventCount: source.eventIds.length, eventIds: source.eventIds,
      source: { path: args.sourcePath, name: args.sourceName, bytes: source.bytes.length, sha256: args.sourceSha256 },
      nativeOperation: native[0] } };
  }
  async exportRestore(directory, args) {
    const source = await this.source(directory, args);
    let intent = await readJson(join(directory, 'export-intent.json'), MAX_BUNDLE);
    if (!intent) {
      const checked = await this.verified(args, source);
      intent = { state: checked.state, stateSha256: nativeDigest(checked.state), verification: checked.result };
      await immutable(join(directory, 'export-intent.json'), json(intent));
    }
    need(intent.state.workspaceId === this.state.workspaceId && nativeDigest(intent.state) === intent.stateSha256, 'ORIGINAL_EXPORT_INTENT_CHANGED');
    const infoPath = join(directory, 'export-info.json');
    let info = await readJson(infoPath);
    if (!info) {
      const responsePath = join(directory, 'export-response.json');
      const retained = await readJson(responsePath, 2 * 1024 * 1024);
      if (retained) {
        const raw = Buffer.from(retained.bodyBase64, 'base64');
        need(retained.status === 200 && raw.length === retained.bytes && sha(raw) === retained.sha256, 'ORIGINAL_EXPORT_RESPONSE_CHANGED');
        info = JSON.parse(raw.toString('utf8'));
      } else {
        // Original exportBundle is a deterministic capture of this exact saved state.
        // Its existing content-addressed package may survive a lost helper reply.
        const candidates = [];
        for (const name of await fs.readdir(join(this.workspaceDirectory, 'exports'))) {
          if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
          const raw = await readFile(join(this.workspaceDirectory, 'exports', name), MAX_BUNDLE);
          const value = verifyBundle(raw);
          need(value.packageSha256 === name.slice(0, -5), 'ORIGINAL_EXPORT_FILENAME_CHANGED');
          if (nativeDigest(value.state) === intent.stateSha256 && value.application.size === this.input.application.length) {
            const exact = this.input.application.every(item => value.application.has(item.path) &&
              value.application.get(item.path).length === item.bytes && sha(value.application.get(item.path)) === item.sha256);
            if (exact) candidates.push({ id: value.packageSha256, bytes: raw.length, workspaceId: value.state.workspaceId,
              revision: value.state.revision, name: 'openlineage-' + value.state.workspaceId + '-r' + value.state.revision + '.json' });
          }
        }
        need(candidates.length <= 1, 'ORIGINAL_EXPORT_SELECTION_AMBIGUOUS');
        if (candidates.length) {
          info = candidates[0];
          await immutable(join(directory, 'export-readback.json'), json({ kind: 'original-content-addressed-export', info }));
        } else {
          need(nativeDigest(await this.host.workspace.read()) === intent.stateSha256, 'ORIGINAL_EXPORT_SCOPE_CHANGED');
          const captureFetch = async (url, init) => {
            const response = await globalThis.fetch(url, init);
            const reader = response.body?.getReader(); const parts = []; let count = 0, complete = false;
            try {
              if (reader) for (;;) {
                const next = await reader.read(); if (next.done) { complete = true; break; }
                count += next.value.byteLength; need(count <= 1024 * 1024, 'ORIGINAL_EXPORT_RESPONSE_TOO_LARGE');
                parts.push(Buffer.from(next.value));
              }
              else complete = true;
              const raw = Buffer.concat(parts, count);
              if (response.status === 200)
                await immutable(responsePath, json({ status: 200, endpoint: this.host.url,
                  bytes: raw.length, sha256: sha(raw), bodyBase64: raw.toString('base64') }));
              return new Response(raw.length ? raw : null, { status: response.status, statusText: response.statusText, headers: response.headers });
            } finally {
              if (reader && !complete) await reader.cancel().catch(() => {});
              reader?.releaseLock();
            }
          };
          info = await this.client(this.host, false, captureFetch).exportWorkspace({ includeApplication: true });
        }
      }
      need(info.workspaceId === this.state.workspaceId && info.revision === intent.state.revision &&
        SHA.test(info.id) && Number.isSafeInteger(info.bytes) && info.bytes > 0 && info.bytes <= MAX_BUNDLE,
        'ORIGINAL_EXPORT_CHANGED');
      await immutable(infoPath, json(info));
    }
    need(info.workspaceId === this.state.workspaceId && info.revision === intent.state.revision && SHA.test(info.id), 'ORIGINAL_EXPORT_CHANGED');
    const destination = join(this.root, 'exports', info.id + '.json');
    let raw;
    try { raw = await readFile(destination, MAX_BUNDLE, { privateFile: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const transfer = join(this.root, 'exports', info.id + '-' + sha(Buffer.from(this.host.url)).slice(0,16) + '.download.json');
      await this.client().downloadExport(info.id, transfer);
      raw = await readFile(transfer, MAX_BUNDLE, { privateFile: true });
      need(sha(raw) === info.id && raw.length === info.bytes, 'ORIGINAL_EXPORT_DOWNLOAD_CHANGED');
      await immutable(destination, raw);
    }
    need(sha(raw) === info.id && raw.length === info.bytes, 'ORIGINAL_EXPORT_DOWNLOAD_CHANGED');
    const bundle = verifyBundle(raw);
    need(bundle.packageSha256 === info.id && nativeDigest(bundle.state) === intent.stateSha256 &&
      bundle.application.size === this.input.application.length &&
      this.input.application.every(item => bundle.application.has(item.path) &&
        bundle.application.get(item.path).length === item.bytes && sha(bundle.application.get(item.path)) === item.sha256),
      'ORIGINAL_WHOLE_EXPORT_CHANGED');
    const receivedDirectory = join(this.root, 'received', info.id);
    try {
      const prior = await readJson(join(receivedDirectory, 'received.json'));
      if (prior) need(prior.packageSha256 === info.id, 'ORIGINAL_RECEIVING_CHANGED');
      else await receiveBundle(raw, receivedDirectory);
      for (const [name, expected] of bundle.application) {
        const actual = await readFile(join(receivedDirectory, 'application', name), 4 * 1024 * 1024);
        need(actual.equals(expected), 'ORIGINAL_RECEIVED_APPLICATION_CHANGED');
      }
      const received = await import(pathToFileURL(join(receivedDirectory, 'application', 'server.mjs')).href);
      need(!this.receivedHost, 'ORIGINAL_RECEIVED_HOST_STILL_RUNNING');
      this.receivedHost = await received.startServer({ directory: receivedDirectory, port: 0,
        token: this.operatorToken, producerToken: this.producerToken, expectedWorkspaceId: this.state.workspaceId });
      await this.recoverOriginalWriter(this.receivedHost);
      const before = await this.verified(args, source, this.receivedHost);
      need(nativeDigest(before.state) === intent.stateSha256, 'ORIGINAL_RECEIVED_STATE_CHANGED');
      const replayPath = join(directory, 'received-replay.json');
      let replay = await readJson(replayPath, 2 * 1024 * 1024);
      if (!replay) {
        replay = await this.client(this.receivedHost, true).emitSource(source.bytes, {
          name: args.sourceName, sourceUrl: args.sourceUrl, contentEncoding: 'identity', operationId: args.operationId });
        receiptBinding(replay, args, this.state.workspaceId, source.bytes.length);
        need(replay.replayed === true && replay.revision === before.state.revision, 'ORIGINAL_RECEIVED_REPLAY_CHANGED');
        await immutable(replayPath, json(replay));
      }
      receiptBinding(replay, args, this.state.workspaceId, source.bytes.length);
      need(replay.replayed === true && replay.revision === before.state.revision, 'ORIGINAL_RECEIVED_REPLAY_CHANGED');
      const after = await this.verified(args, source, this.receivedHost);
      need(nativeDigest(after.state) === nativeDigest(before.state), 'REPLAY_CHANGED_ORIGINAL_STATE');
      return { identity: this.host.identity, receipt: replay, native: intent.verification,
        export: { path: destination, bytes: raw.length, sha256: sha(raw), info },
        received: { directory: receivedDirectory, identity: this.receivedHost.identity,
          stateSha256: nativeDigest(after.state), sourceIds: after.state.sources.map(item => item.id),
          eventIds: after.state.events.map(item => item.id), operations: after.state.operations.map(item => item.id),
          applicationFiles: bundle.application.size } };
    } finally {
      if (this.receivedHost) { await this.receivedHost.close(); this.receivedHost = null; }
    }
  }
  async handle(request) {
    keys(request, ['id', 'action', 'args']);
    need(typeof request.id === 'string' && ID.test(request.id) && ACTIONS.has(request.action) && object(request.args), 'CONTROL_REQUEST_INVALID');
    const directory = await privateDirectory(join(this.root, 'requests', sha(Buffer.from(request.id))));
    await immutable(join(directory, 'request.json'), json(request));
    const completed = await readJson(join(directory, 'result.json'), MAX_BUNDLE);
    if (completed) {
      need(completed.id === request.id && completed.action === request.action && completed.inputSha256 === nativeDigest(request), 'ORIGINAL_CONTROL_RESULT_CHANGED');
      if (completed.result?.export) {
        const file = completed.result.export;
        const raw = await readFile(file.path, MAX_BUNDLE);
        need(raw.length === file.bytes && sha(raw) === file.sha256, 'ORIGINAL_EXPORT_DOWNLOAD_CHANGED');
      }
      if (request.action === 'close') await this.closeHosts();
      return completed.result;
    }
    let result;
    if (request.action === 'status') {
      keys(request.args, []);
      await this.stateWrites;
      const captured = await this.reconcileCapture(), state = await this.host.workspace.read();
      result = { ...this.ready(), revision: state.revision, eventCount: state.events.length,
        sourceIds: state.sources.map(item => item.id), operations: state.operations.map(item => item.id),
        loss: this.state.armed, capturedReceipt: captured?.receipt ?? null, captureError: this.captureError };
    } else if (request.action === 'arm_loss') {
      keys(request.args, ['operationId', 'sourceSha256']);
      need(/^analysis-[a-f0-9]{32}-[a-f0-9]{32}$/.test(request.args.operationId) && SHA.test(request.args.sourceSha256), 'LOSS_SELECTION_INVALID');
      if (this.state.armed) need(this.state.armed.operationId === request.args.operationId &&
        this.state.armed.sourceSha256 === request.args.sourceSha256, 'ORIGINAL_LOSS_ALREADY_SELECTED');
      else await this.stateChange(state => { state.armed = { ...request.args, state: 'ARMED', requestId: request.id }; });
      await this.reconcileCapture();
      result = { ...this.state.armed };
    } else if (request.action === 'restart') {
      keys(request.args, []);
      const path = join(directory, 'restart-intent.json');
      let intent = await readJson(path);
      if (!intent) { intent = { previousIdentity: this.host.identity }; await immutable(path, json(intent)); }
      if (this.host.identity.instanceId === intent.previousIdentity.instanceId) {
        await Promise.all([...this.pendingResponses]);
        await this.host.close(); this.host = null; await this.start();
      }
      need(this.host.identity.workspaceId === intent.previousIdentity.workspaceId &&
        this.host.identity.instanceId !== intent.previousIdentity.instanceId, 'ORIGINAL_RESTART_CHANGED');
      result = { ...this.ready(), previousIdentity: intent.previousIdentity };
    } else if (request.action === 'verify') {
      result = (await this.verified(request.args, await this.source(directory, request.args))).result;
    } else if (request.action === 'export_restore') {
      result = await this.exportRestore(directory, request.args);
    } else {
      keys(request.args, []);
      await this.closeHosts(); result = { state: 'CLOSED', operationId: this.operationId, workspaceId: this.state.workspaceId };
    }
    await immutable(join(directory, 'result.json'), json({ id: request.id, action: request.action,
      inputSha256: nativeDigest(request), result }));
    return result;
  }
  async closeHosts() {
    let primary = null;
    try { await Promise.all([...this.pendingResponses]); } catch (error) { primary = error; }
    for (const key of ['receivedHost', 'host']) {
      if (!this[key]) continue;
      try { await this[key].close(); this[key] = null; } catch (error) { primary ??= error; }
    }
    try { await this.stateWrites; } catch (error) { primary ??= error; }
    if (primary) throw primary;
  }
  async close() {
    if (!this.controller.signal.aborted) this.controller.abort(new Error('COLLECTOR_OWNER_CLOSED'));
    let primary = null;
    try { await this.closeHosts(); } catch (error) { primary = error; }
    if (!this.host && !this.receivedHost && this.release) {
      try { await this.release(); this.release = null; } catch (error) { primary ??= error; }
    }
    if (primary) throw primary;
  }
}

async function main() {
  const args = process.argv.slice(2);
  need(args.length === 4 && args[0] === '--directory' && args[2] === '--operation-id' &&
    typeof args[3] === 'string' && ID.test(args[3]), 'COLLECTOR_ARGUMENTS_INVALID');
  const collector = new Collector(absolute(args[1]), args[3]);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let closing = false, primary = null;
  const output = value => new Promise((resolve, reject) =>
    process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()));
  const stop = () => {
    closing = true; collector.controller.abort(new Error('COLLECTOR_OWNER_CANCELLED'));
    lines.close(); process.stdin.pause();
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    await output(await collector.initialize());
    for await (const line of lines) {
      if (closing) break;
      let request;
      try {
        need(Buffer.byteLength(line) <= 65536, 'CONTROL_REQUEST_TOO_LARGE');
        request = JSON.parse(line);
        const result = await collector.handle(request);
        await output({ id: request.id, ok: true, result });
        if (request.action === 'close') break;
      } catch (error) {
        const value = { id: request?.id ?? null, ok: false,
          error: { code: error.code ?? 'COLLECTOR_REQUEST_FAILED', message: error.message,
            status: Number.isInteger(error.status) ? error.status : null } };
        if (request && typeof request.id === 'string' && ID.test(request.id)) {
          const directory = join(collector.root, 'requests', sha(Buffer.from(request.id)));
          await save(join(directory, 'last-error.json'), value).catch(() => {});
        }
        await output(value);
      }
    }
  } catch (error) { primary = error; throw error; }
  finally {
    lines.close(); process.stdin.pause();
    try { await collector.close(); }
    catch (error) {
      if (!primary) throw error;
      await output({ state: 'CLEANUP_FAILED', operationId: collector.operationId,
        error: { code: error.code ?? 'COLLECTOR_CLEANUP_FAILED', message: error.message } }).catch(() => {});
    } finally {
      process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    }
  }
}
await main().catch(error => {
  process.exitCode = 1;
  process.stderr.write(JSON.stringify({ state: 'FAILED', error: { code: error.code ?? 'COLLECTOR_FAILED', message: error.message } }) + '\n');
});
