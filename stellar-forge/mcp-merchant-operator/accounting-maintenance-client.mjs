// MIT. Accounting maintenance through the merchant's existing MCP connection.
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openMerchantFileClient } from './retained-download.mjs';

const PREFIX = 'merchant_accounting_maintenance_';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const ACTIVE = new Set(['QUEUED', 'RUNNING']);
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const FIELDS = {
  pause: [], review: [], resume: [],
  backup: ['expectedReviewId', 'externalWritersStopped', 'label'],
  verify: ['backupId', 'expectedSha256'],
  restore: ['backupId', 'expectedSha256', 'externalWritersStopped'],
  cancel: ['jobId'],
};
const FILE_FIELDS = ['kind', 'recoveryId', 'runId', 'exportId', 'collectionId', 'sourceId',
  'reviewId', 'closeId', 'handoffId', 'revisionId', 'file'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code: 'ACCOUNTING_MAINTENANCE_CLIENT_' + code });
function exact(value, fields) {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key)))
    throw fail('ARGUMENTS', 'Use only the declared fields for this operation.');
}
function identifier(value, expression, name) {
  if (typeof value !== 'string' || !expression.test(value)) throw fail('ARGUMENTS', 'Supply the exact ' + name + '.');
  return value;
}
function number(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw fail('ARGUMENTS', name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}
function workspaceAlias(value) { return identifier(value, /^[a-z0-9][a-z0-9_-]{0,63}$/, 'configured workspace alias'); }

/** Validate the exact request before retaining or submitting it. No ID is generated here. */
export function accountingMaintenanceArguments(kind, value) {
  if (!Object.hasOwn(FIELDS, kind)) throw fail('ARGUMENTS', 'Choose pause, review, backup, verify, restore, resume or cancel.');
  exact(value, ['actor', 'requestId', ...FIELDS[kind]]);
  if (typeof value.actor !== 'string' || !value.actor.trim() || value.actor.trim().length > 160)
    throw fail('ARGUMENTS', 'Supply the responsible actor, from 1 to 160 characters.');
  const args = { actor: value.actor.trim(), requestId: identifier(value.requestId, UUID, 'retained request UUID') };
  for (const field of FIELDS[kind]) {
    if (field === 'label' && value.label === undefined) continue;
    if (field === 'expectedReviewId' || field === 'expectedSha256') args[field] = identifier(value[field], SHA, field + ' SHA256');
    else if (field === 'jobId') args[field] = identifier(value[field], UUID, 'original job UUID');
    else if (field === 'externalWritersStopped') {
      if (value[field] !== true) throw fail('ARGUMENTS', 'Confirm externalWritersStopped:true after stopping source writers outside this MCP session.');
      args[field] = true;
    } else if (field === 'backupId') {
      args[field] = identifier(value[field], /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'retained backup ID');
      if (value[field] === 'operations') throw fail('ARGUMENTS', 'Choose an original backup catalog ID.');
    } else {
      if (typeof value[field] !== 'string' || !value[field].trim() || value[field].trim().length > 160)
        throw fail('ARGUMENTS', 'Use a backup label from 1 to 160 characters.');
      args[field] = value[field].trim();
    }
  }
  return args;
}

/** Reuse an already initialized stdio, in-process or HTTP merchant connection. */
export function createAccountingMaintenanceClient({ workspace, call } = {}) {
  workspaceAlias(workspace);
  if (typeof call !== 'function') throw fail('ARGUMENTS', 'Supply the existing MCP structured-result call(name, arguments, options).');
  const ownedReads = new Set(), fileCalls = new Set();
  let drainingReaders = false;
  async function invoke(name, args = {}, options) {
    const result = await call(name, { ...args, workspace }, options);
    if (!plain(result)) throw fail('REPLY', 'The merchant tool returned no structured result.');
    return result;
  }
  function checkedJob(result, jobId) {
    if (!plain(result.job) || result.job.id !== jobId || result.job.requestId !== jobId ||
        !ACTIVE.has(result.job.status) && !TERMINAL.has(result.job.status))
      throw fail('REPLY', 'The merchant reply does not identify the original retained job and status.');
    return result;
  }
  function readOriginal(args, options) {
    if (drainingReaders) throw fail('READ_DRAINING', 'Finish the current reader drain before opening another original read.');
    const pending = invoke('merchant_accounting_file', args, options).then(result => {
      if (UUID.test(result.readId ?? '') && result.nextOffset !== null) ownedReads.add(result.readId);
      return result;
    });
    fileCalls.add(pending); pending.then(() => fileCalls.delete(pending), () => fileCalls.delete(pending));
    return pending;
  }
  async function drainThen(operation) {
    if (drainingReaders) throw fail('READ_DRAINING', 'A reader drain is already active on this client.');
    drainingReaders = true;
    try {
      await Promise.allSettled([...fileCalls]);
      for (const readId of [...ownedReads]) await client.releaseFile(readId, { timeoutMs: 10000 });
      return operation ? await operation() : { workspace, released: true, activeFileReads: ownedReads.size };
    } finally { drainingReaders = false; }
  }
  const client = {
    workspace,
    open: options => invoke('merchant_accounting_open', {}, options),
    closeWorkspace: options => drainThen(() => invoke('merchant_accounting_close', {}, options)),
    registerFileRead(readId) {
      identifier(readId, UUID, 'owned file-read UUID');
      if (drainingReaders) throw fail('READ_DRAINING', 'Register an already-owned read before the reader drain begins.');
      ownedReads.add(readId); return { workspace, readId };
    },
    drainFileReads: () => drainThen(),
    async status(args = {}, options) {
      exact(args, ['view', 'offset', 'limit']);
      if (args.view !== undefined && !['summary', 'backups', 'jobs', 'sources'].includes(args.view)) throw fail('ARGUMENTS', 'Choose summary, backups, jobs or sources.');
      if (args.offset !== undefined) number(args.offset, 0, Number.MAX_SAFE_INTEGER, 'offset');
      if (args.limit !== undefined) number(args.limit, 1, 200, 'limit');
      return invoke(PREFIX + 'status', args, options);
    },
    async command(kind, value, options) {
      const args = accountingMaintenanceArguments(kind, value);
      const submit = () => invoke(PREFIX + kind, args, options);
      const result = checkedJob(await (kind === 'pause' ? drainThen(submit) : submit()), args.requestId);
      if (result.accepted !== true) throw fail('REPLY', 'The merchant did not acknowledge this retained operation.');
      return result;
    },
    async job(jobId, options) {
      identifier(jobId, UUID, 'original job UUID');
      return checkedJob(await invoke(PREFIX + 'job', { jobId }, options), jobId);
    },
    /** Poll only the retained job. A timeout or failed job never starts another operation. */
    async wait(jobId, { maxWaitMs = 30000, pollMs = 500, signal } = {}) {
      number(maxWaitMs, 0, 86400000, 'maxWaitMs'); number(pollMs, 100, 60000, 'pollMs');
      const until = Date.now() + maxWaitMs;
      for (;;) {
        signal?.throwIfAborted();
        const result = await client.job(jobId, { requestSignal: signal });
        const pending = ACTIVE.has(result.job.status);
        if (!pending || Date.now() >= until) return { ...result, pending };
        await delay(Math.min(pollMs, until - Date.now()), undefined, { signal });
      }
    },
    async releaseFile(readId, options) {
      identifier(readId, UUID, 'owned file-read UUID');
      const result = await invoke('merchant_accounting_file_release', { readId }, options);
      ownedReads.delete(readId); return result;
    },
    /** Consume one original file, retaining its selectors and SHA on every chunk. */
    async *fileChunks(selection, { expectedSha256, chunkBytes = 65536, signal } = {}) {
      exact(selection, FILE_FIELDS);
      if (!['response', 'report', 'export', 'collection', 'pricing', 'period', 'accountant'].includes(selection.kind))
        throw fail('ARGUMENTS', 'Choose an original accounting file kind.');
      if (expectedSha256 !== undefined) identifier(expectedSha256, SHA, 'original file SHA256');
      number(chunkBytes, 1, 196608, 'chunkBytes');
      const selectors = structuredClone(selection), hash = createHash('sha256');
      let readId, file, offset = 0, complete = false, problem;
      try {
        for (;;) {
          signal?.throwIfAborted();
          if (readId && !ownedReads.has(readId)) throw fail('READ_RELEASED', 'This client drained the unfinished read. Open a new read with its original selectors and SHA256.');
          const chunk = await readOriginal({ ...selectors, offset, limit: chunkBytes,
            ...(readId ? { readId } : {}), ...(expectedSha256 ? { expectedSha256 } : {}) }, { requestSignal: signal });
          identifier(chunk.readId, UUID, 'owned file-read UUID');
          // Retain the observed handle even if a malformed reply needs cleanup.
          if (!readId) readId = chunk.readId;
          if (chunk.nextOffset !== null) ownedReads.add(readId);
          if (chunk.readId !== readId || !plain(chunk.file) || !SHA.test(chunk.file.sha256 ?? '') ||
              !Number.isSafeInteger(chunk.file.bytes) || chunk.file.bytes < 0 || chunk.offset !== offset ||
              chunk.encoding !== 'base64' || typeof chunk.data !== 'string') throw fail('FILE_REPLY', 'The original file chunk has inconsistent metadata.');
          if (!file) { file = chunk.file; expectedSha256 ??= file.sha256; }
          if (chunk.file.sha256 !== expectedSha256 || chunk.file.bytes !== file.bytes || chunk.file.name !== file.name)
            throw fail('FILE_CHANGED', 'The retained file identity changed during this read.');
          const bytes = Buffer.from(chunk.data, 'base64');
          const next = offset + bytes.length;
          if (bytes.toString('base64') !== chunk.data || bytes.length !== chunk.bytesRead || bytes.length > chunkBytes ||
              next > file.bytes || (next < file.bytes ? chunk.nextOffset !== next || !bytes.length : chunk.nextOffset !== null))
            throw fail('FILE_REPLY', 'The original file chunk has inconsistent bytes or offsets.');
          hash.update(bytes); offset = next; complete = chunk.nextOffset === null;
          if (complete) ownedReads.delete(readId);
          if (complete && hash.digest('hex') !== expectedSha256) throw fail('FILE_CHANGED', 'The complete original file differs from its SHA256.');
          yield { ...chunk, bytes, complete };
          if (complete) return;
        }
      } catch (error) { problem = error; throw error; }
      finally {
        // The host releases an EOF snapshot itself. A partial read belongs to this caller.
        if (readId && !complete && ownedReads.has(readId)) {
          try { await client.releaseFile(readId, { timeoutMs: 10000 }); }
          catch (error) { if (problem) problem.releaseError = { code: error.code, message: error.message }; else throw error; }
        }
      }
    },
  };
  return Object.freeze(client);
}

/** Connect to the existing merchant HTTP listener; never starts a second host. */
export async function connectAccountingMaintenanceClient({ workspace, ...options } = {}) {
  workspaceAlias(workspace);
  const connection = await openMerchantFileClient({ ...options, errorPrefix: 'ACCOUNTING_MAINTENANCE',
    clientName: 'starforge-accounting-maintenance' });
  return Object.freeze({ ...createAccountingMaintenanceClient({ workspace, call: connection.call }), endpoint: connection.endpoint });
}
