// MIT. Managed-release delivery through the original SF98 settlement decorator.
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants } from 'node:fs';
import { open, rename, unlink, realpath, lstat } from 'node:fs/promises';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openOutbox, instrumentNativeSettlement, inspectNativeSettlementInstrumentation }
  from '../sf98-merchant-delivery/outbox.mjs';

export const NATIVE_DELIVERY_SCHEMA = 'stellar-forge.native-settlement-delivery.v1';
const context = new AsyncLocalStorage();
const hex = /^[a-f0-9]{64}$/;
const failure = code => Object.assign(new Error(code), { code });
const now = () => new Date().toISOString();
const codeOf = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code :
  /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.message ?? '') ? error.message : 'SF98_OUTBOX_JOURNAL_WARNING';

async function privateDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path === '/' ||
      path.includes('\0') || await realpath(path) !== path) throw failure('SF98_DELIVERY_DIRECTORY_INVALID');
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 ||
      process.getuid && stat.uid !== process.getuid())
    throw failure('SF98_DELIVERY_DIRECTORY_INVALID');
}
async function readRecord(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.size > 65536 ||
        process.getuid && info.uid !== process.getuid()) throw failure('SF98_DELIVERY_RECORD_INVALID');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.readFile()));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { await file?.close(); }
}
async function writeRecord(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); await file.close();
    await rename(temporary, path);
    const parent = await open(dirname(path), 'r'); try { await parent.sync(); } finally { await parent.close(); }
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}

/** Called once at the original resource-handler boundary, after a family's own
 * factory decorators. A previously instrumented seller keeps that exact outbox. */
export function applyNativeSettlementDelivery(compiled, nativeServer) {
  const active = context.getStore();
  if (!active?.active || nativeServer === null) return nativeServer;
  let original = inspectNativeSettlementInstrumentation(nativeServer), selected = nativeServer;
  if (original) {
    active.detach.push(original.observeWriteFailures(active.onWriteFailure));
  } else {
    selected = instrumentNativeSettlement(nativeServer, {
      compiled, outbox: active.outbox, onWriteFailure: active.onWriteFailure,
    });
    original = inspectNativeSettlementInstrumentation(selected);
    // Preserve the original SDK's public accessors and method receiver. The
    // existing three HTTP methods keep the original settlement decorator.
    const bound = new Map();
    selected = new Proxy(nativeServer, { get(target, key) {
      if (['processHTTPRequest', 'processSettlement', 'createFailurePathSettlementHeaders'].includes(key))
        return original.server[key];
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const cached = bound.get(key);
      if (cached?.source === value) return cached.bound;
      const method = value.bind(target); bound.set(key, { source: value, bound: method }); return method;
    } });
  }
  if (typeof original?.outbox?.dir !== 'string') throw failure('SF98_NATIVE_OUTBOX_REQUIRED');
  if (active.sourceDirectory && active.sourceDirectory !== original.outbox.dir)
    throw failure('SF98_RELEASE_MULTIPLE_OUTBOXES');
  active.sourceDirectory = original.outbox.dir;
  active.originalDecoration ||= nativeServer === selected;
  active.servers++;
  return selected;
}

/** The original SF82 owner calls this only after its durable child-start grant. */
export async function withNativeSettlementDelivery(options, launch) {
  if (options === null || options === undefined) return launch();
  const { directory, outboxDirectory, instanceId, releaseId, releaseDigest } = options;
  if (typeof instanceId !== 'string' || !/^[a-f0-9-]{36}$/.test(instanceId) ||
      typeof releaseId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(releaseId) ||
      !hex.test(releaseDigest ?? '')) throw failure('SF98_RELEASE_DELIVERY_IDENTITY_INVALID');
  await privateDirectory(directory); await privateDirectory(outboxDirectory);
  if (outboxDirectory !== join(directory, 'outbox')) throw failure('SF98_RELEASE_OUTBOX_BINDING_INVALID');
  const producerFile = join(directory, 'producer.json'), bindingFile = join(directory, 'binding.json');
  const previous = await readRecord(producerFile), binding = await readRecord(bindingFile);
  if (previous && (previous.schema !== NATIVE_DELIVERY_SCHEMA ||
      !Number.isSafeInteger(previous.journalWarnings) || previous.journalWarnings < 0) ||
      binding && (binding.schema !== NATIVE_DELIVERY_SCHEMA || typeof binding.sourceDirectory !== 'string'))
    throw failure('SF98_DELIVERY_RECORD_INVALID');
  const active = { active: true, outbox: await openOutbox(outboxDirectory), sourceDirectory: null,
    originalDecoration: false, servers: 0, detach: [], onWriteFailure: null };
  let session, tail = Promise.resolve(), completed, persistenceWarning = null;
  const record = { schema: NATIVE_DELIVERY_SCHEMA, instanceId, releaseId, releaseDigest,
    sourceDirectory: binding?.sourceDirectory ?? outboxDirectory, phase: 'STARTING', mode: null,
    startedAt: now(), updatedAt: now(), servers: 0, originalDecoration: false,
    journalWarnings: previous?.journalWarnings ?? 0, lastWriteFailure: previous?.lastWriteFailure ?? null };
  const save = () => {
    const snapshot = structuredClone({ ...record, updatedAt: now() });
    const next = tail.then(() => writeRecord(producerFile, snapshot));
    tail = next.catch(error => {
      persistenceWarning = codeOf(error);
      process.stderr.write('SF98_DELIVERY_STATUS_WRITE_FAILED ' + instanceId + '\n');
    });
    return next;
  };
  active.onWriteFailure = error => {
    record.journalWarnings++;
    record.lastWriteFailure = { at: now(), instanceId, code: codeOf(error) };
    process.stderr.write('SF98_OUTBOX_JOURNAL_WARNING ' + instanceId + ' ' + codeOf(error) + '\n');
    void save().catch(() => {});
  };
  const finish = () => completed ??= (async () => {
    record.phase = 'STOPPED'; record.endedAt = now();
    try { await save(); } catch { /* The original close outcome remains authoritative. */ }
    await tail;
  })();
  try {
    await save();
    session = await context.run(active, launch);
    if (session?.mode === 'NATIVE_X402' && !active.servers) throw failure('SF98_NATIVE_DELIVERY_NOT_ATTACHED');
    const sourceDirectory = active.sourceDirectory ?? session?.outbox?.dir ?? binding?.sourceDirectory ?? outboxDirectory;
    await privateDirectory(sourceDirectory);
    if (binding && binding.sourceDirectory !== sourceDirectory) throw failure('SF98_DELIVERY_SOURCE_CHANGED');
    if (!binding) await writeRecord(bindingFile, { schema: NATIVE_DELIVERY_SCHEMA, sourceDirectory, createdAt: now() });
    Object.assign(record, { sourceDirectory, phase: 'RUNNING', mode: session.mode,
      servers: active.servers, originalDecoration: active.originalDecoration });
    await save();
    const originalClose = session.close.bind(session);
    let closing;
    session.close = () => {
      if (closing) return closing;
      const attempt = (async () => {
        const result = await originalClose();
        await finish(); for (const detach of active.detach) detach();
        return result;
      })();
      closing = attempt;
      attempt.catch(() => { if (closing === attempt) closing = undefined; });
      return attempt;
    };
    session.server?.once('close', () => { void finish(); });
    session.settlementDelivery = Object.freeze({ schema: NATIVE_DELIVERY_SCHEMA,
      instanceId, releaseId, releaseDigest, sourceDirectory,
      instrumented: active.servers > 0, originalDecoration: active.originalDecoration,
      get persistenceWarning() { return persistenceWarning; } });
    return session;
  } catch (error) {
    await session?.close().catch(() => {}); await finish();
    for (const detach of active.detach) detach(); throw error;
  } finally { active.active = false; }
}
