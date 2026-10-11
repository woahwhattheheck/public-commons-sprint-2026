// MIT. Original merchant adjustments and accounting through one MCP connection.
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openMerchantFileClient } from './retained-download.mjs';
import { createAccountingMaintenanceClient } from './accounting-maintenance-client.mjs';

const PREFIX = 'merchant_accounting_';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const ACTIVE = new Set(['QUEUED', 'RUNNING']);
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'INTERRUPTED']);
const REQUEST_FIELDS = ['id', 'runId', 'eventId', 'kind', 'amountAtomic', 'effectiveAt', 'reason', 'reference', 'actor', 'createdAt'];
const fail = (code, message) => Object.assign(new Error(message), { code: 'ACCOUNTING_ADJUSTMENT_CLIENT_' + code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(JSON.stringify(value, null, 2) + '\n').digest('hex');
function need(ok, message, code = 'ARGUMENTS') { if (!ok) throw fail(code, message); }
function identifier(value, pattern, name) { need(typeof value === 'string' && pattern.test(value), 'Supply the exact ' + name + '.'); return value; }
function exact(value, fields) { need(plain(value) && Object.keys(value).every(key => fields.includes(key)), 'Use only the declared request fields.'); }
function revision(value) { need(Number.isSafeInteger(value) && value >= 1, 'Use the observed original workspace revision.'); return value; }
function text(value, maximum, name, empty = false) {
  need(typeof value === 'string' && (empty || value.length > 0) && value === value.trim() && value.length <= maximum && !value.includes('\0'),
    'Use the normalized ' + name + ' returned by the original preview.'); return value;
}
function requestFields(value) { return Object.fromEntries(REQUEST_FIELDS.map(key => [key, value[key]])); }
function checkedRecord(value, id) {
  need(plain(value) && value.id === id && SHA.test(value.requestSha256 ?? '') &&
    SHA.test(value.previewSha256 ?? '') && ['RECORDED', 'REQUESTED', 'VERIFYING', 'VERIFIED', 'WITHDRAWN'].includes(value.status),
  'The reply does not identify the original adjustment and its request digests.', 'REPLY');
  return value;
}
function checkedJob(value, jobId, adjustmentId, transaction) {
  need(plain(value) && UUID.test(value.id ?? '') && (jobId === undefined || value.id === jobId) &&
    UUID.test(value.adjustmentId ?? '') && (adjustmentId === undefined || value.adjustmentId === adjustmentId) &&
    SHA.test(value.transaction ?? '') && (transaction === undefined || value.transaction === transaction) &&
    (ACTIVE.has(value.status) || TERMINAL.has(value.status)), 'The reply differs from the selected original refund-read job.', 'JOB_BINDING');
  return value;
}

/** Validate, without changing, the complete normalized preview and its native binding. */
export function accountingAdjustmentRecordArguments(preview) {
  need(plain(preview) && plain(preview.request) && plain(preview.detail), 'Retain the complete original preview.', 'PREVIEW');
  const value = preview.request;
  exact(value, REQUEST_FIELDS);
  need(Object.keys(value).length === REQUEST_FIELDS.length, 'Keep every normalized preview request field.', 'PREVIEW');
  for (const key of ['id', 'runId']) identifier(value[key], UUID, key + ' UUID');
  identifier(value.eventId, SHA, 'original event SHA256');
  need(['CANCELLATION', 'REFUND'].includes(value.kind), 'Choose the original cancellation or refund kind.');
  need(typeof value.amountAtomic === 'string' && /^[1-9][0-9]{0,38}$/.test(value.amountAtomic) && BigInt(value.amountAtomic) <= (1n << 127n) - 1n,
    'Keep the positive original-asset atomic amount as a string.');
  for (const key of ['effectiveAt', 'createdAt']) {
    need(typeof value[key] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value[key]) &&
      Number.isFinite(Date.parse(value[key])) && new Date(value[key]).toISOString() === value[key], 'Keep the normalized original UTC ' + key + '.');
  }
  text(value.actor, 1000, 'actor'); text(value.reason, 4000, 'reason'); text(value.reference, 1000, 'reference', true);
  identifier(preview.previewSha256, SHA, 'reviewed preview SHA256'); revision(preview.workspaceRevision);
  const request = requestFields(value), detail = preview.detail;
  need(plain(detail.source) && plain(detail.event) && plain(detail.totals) && Object.hasOwn(detail, 'refundTerms') &&
    detail.source.runId === request.runId && detail.event.eventId === request.eventId &&
    hash({ request, source: detail.source, original: detail.event, refundTerms: detail.refundTerms, totals: detail.totals }) === preview.previewSha256,
  'The retained preview differs from its native payment, amount, return terms or digest.', 'PREVIEW_BINDING');
  return { ...request, revision: preview.workspaceRevision, previewSha256: preview.previewSha256 };
}

/** Wire arguments only; accounting, capacity and transfer decisions remain native. */
export function accountingAdjustmentArguments(kind, value) {
  const fields = kind === 'verify' ? ['adjustmentId', 'revision', 'actor', 'transaction'] :
    kind === 'withdraw' ? ['adjustmentId', 'revision', 'actor', 'reason'] : null;
  need(fields !== null, 'Choose verify or withdraw; recording requires its complete original preview.');
  exact(value, fields); need(Object.keys(value).length === fields.length, 'Retain all original operation fields.');
  const result = { adjustmentId: identifier(value.adjustmentId, UUID, 'adjustment UUID'), revision: revision(value.revision),
    actor: text(value.actor, 1000, 'actor') };
  if (kind === 'verify') result.transaction = identifier(value.transaction, SHA, 'already-executed reverse-transfer transaction SHA256');
  else result.reason = text(value.reason, 4000, 'withdrawal reason');
  return result;
}

/** Inject an initialized original MCP call. This never creates a workspace or executor. */
export function createAccountingAdjustmentClient({ workspace, call } = {}) {
  identifier(workspace, /^[a-z0-9][a-z0-9_-]{0,63}$/, 'configured workspace alias');
  need(typeof call === 'function', 'Supply the original structured-result MCP call function.');
  const maintenance = createAccountingMaintenanceClient({ workspace, call });
  const pending = new Set(), ownedJobs = new Set();
  let transitioning = false, closed = false, closePromise;
  function accepting() { need(!closed && !transitioning, 'This caller is draining or closed; finish that transition before another call.', 'CLOSED'); }
  async function tracked(action) {
    accepting(); const operation = Promise.resolve().then(action);
    pending.add(operation);
    try { return await operation; } finally { pending.delete(operation); }
  }
  function invoke(name, value = {}, options) {
    need(typeof name === 'string' && name.startsWith(PREFIX) && plain(value) && !Object.hasOwn(value, 'workspace'),
      'Use an original accounting tool and this client’s selected workspace alias.');
    return tracked(async () => {
      const result = await call(name, { ...structuredClone(value), workspace }, options);
      need(plain(result), 'The merchant returned no original structured result.', 'REPLY');
      if (name === PREFIX + 'file' && UUID.test(result.readId ?? '') && result.nextOffset !== null) maintenance.registerFileRead(result.readId);
      if (name === PREFIX + 'adjustment_verify' && UUID.test(result.job?.id ?? '')) ownedJobs.add(result.job.id);
      return result;
    });
  }
  async function transition(operation, permanent = false) {
    accepting(); transitioning = true;
    try { await Promise.allSettled([...pending]); return await operation(); }
    finally { transitioning = false; if (permanent) closed = true; }
  }
  async function allDetailPages(adjustmentId, view, options) {
    let offset = 0, expectedRevision, expectedTotal;
    const items = [], ids = new Set();
    for (;;) {
      const result = await client.detail({ adjustmentId, view, offset, limit: 200 }, options), page = result.page;
      need(plain(page) && page.kind === view && Array.isArray(page.items) && page.offset === offset &&
        Number.isSafeInteger(page.total) && page.total >= 0 && (view !== 'jobs' || page.total <= 20000) && page.items.length <= 200,
      'The original history/job page is inconsistent.', 'REPLY');
      expectedRevision ??= result.revision; expectedTotal ??= page.total;
      need(result.revision === expectedRevision && page.total === expectedTotal,
        'The original workspace changed between pages. Read its current history or jobs again.', 'OBSERVATION_CHANGED');
      for (const item of page.items) {
        if (view === 'jobs') { checkedJob(item, undefined, adjustmentId); need(!ids.has(item.id), 'A retained job was repeated across pages.', 'REPLY'); ids.add(item.id); }
        items.push(item);
      }
      if (page.nextOffset === null) { need(items.length === page.total, 'The original inventory ended before its retained count.', 'REPLY'); return { items, revision: expectedRevision }; }
      need(page.nextOffset === offset + page.items.length && page.nextOffset > offset && page.nextOffset < page.total,
        'The original page did not advance through its inventory.', 'REPLY'); offset = page.nextOffset;
    }
  }
  const client = {
    workspace,
    open: options => invoke(PREFIX + 'open', {}, options),
    status: (args, options) => invoke(PREFIX + 'adjustment_status', args, options),
    events: (args, options) => invoke(PREFIX + 'adjustment_events', args, options),
    event: (args, options) => invoke(PREFIX + 'adjustment_event', args, options),
    async preview(args, options) {
      const result = await invoke(PREFIX + 'adjustment_preview', args, options);
      accountingAdjustmentRecordArguments(result); return result;
    },
    async record(preview, options) {
      const args = accountingAdjustmentRecordArguments(preview), result = await invoke(PREFIX + 'adjustment_record', args, options);
      checkedRecord(result.adjustment, args.id);
      need(result.adjustment.requestSha256 === hash(requestFields(args)) && result.adjustment.previewSha256 === args.previewSha256,
        'The recorded UUID belongs to another reviewed request.', 'REQUEST_BINDING'); return result;
    },
    async detail(args, options) {
      identifier(args?.adjustmentId, UUID, 'adjustment UUID');
      const result = await invoke(PREFIX + 'adjustment', args, options);
      checkedRecord(result.adjustment, args.adjustmentId); revision(result.revision); return result;
    },
    history: (args, options) => client.detail({ ...args, view: 'history' }, options),
    jobs: (args, options) => client.detail({ ...args, view: 'jobs' }, options),
    async verify(value, options) {
      const args = accountingAdjustmentArguments('verify', value), result = await invoke(PREFIX + 'adjustment_verify', args, options);
      checkedJob(result.job, undefined, args.adjustmentId, args.transaction); checkedRecord(result.adjustment, args.adjustmentId); return result;
    },
    async job(jobId, options) {
      identifier(jobId, UUID, 'original refund-read job UUID');
      const result = await invoke(PREFIX + 'adjustment_job', { jobId }, options);
      checkedJob(result.job, jobId); checkedRecord(result.adjustment, result.job.adjustmentId); revision(result.revision); return result;
    },
    async withdraw(value, options) {
      const args = accountingAdjustmentArguments('withdraw', value), result = await invoke(PREFIX + 'adjustment_withdraw', args, options);
      checkedRecord(result.adjustment, args.adjustmentId);
      need(result.adjustment.status === 'WITHDRAWN', 'The original request was not withdrawn.', 'REPLY'); return result;
    },
    /** No mutation: find the same reviewed UUID after an uncertain record reply. */
    async reconcileRecord(preview, options) {
      const args = accountingAdjustmentRecordArguments(preview); let result;
      try { result = await client.detail({ adjustmentId: args.id }, options); }
      catch (error) { if (error.code === 'ADJUSTMENT_NOT_FOUND') return { found: false, adjustmentId: args.id }; throw error; }
      need(result.adjustment.requestSha256 === hash(requestFields(args)) && result.adjustment.previewSha256 === args.previewSha256,
        'The original adjustment UUID was retained with different request inputs.', 'REQUEST_BINDING');
      return { found: true, ...result };
    },
    /** Only inspect original jobs/proofs. afterJobId selects a reviewed failed prior attempt. */
    async reconcileVerification({ adjustmentId, transaction, jobId, afterJobId } = {}, options) {
      identifier(adjustmentId, UUID, 'adjustment UUID'); identifier(transaction, SHA, 'reverse-transfer transaction SHA256');
      need(!(jobId && afterJobId), 'Choose an exact retained job or an explicitly reviewed failed predecessor.');
      if (jobId) {
        identifier(jobId, UUID, 'original job UUID'); let result;
        try { result = await client.job(jobId, options); }
        catch (error) { if (error.code === 'ADJUSTMENT_JOB_NOT_FOUND') return { found: false, adjustmentId, jobId }; throw error; }
        checkedJob(result.job, jobId, adjustmentId, transaction); return { found: true, ...result };
      }
      const { items } = await allDetailPages(adjustmentId, 'jobs', options);
      let candidates = items.filter(job => job.transaction === transaction);
      if (afterJobId) {
        identifier(afterJobId, UUID, 'reviewed failed predecessor UUID');
        const index = candidates.findIndex(job => job.id === afterJobId);
        need(index >= 0 && ['FAILED', 'INTERRUPTED'].includes(candidates[index].status),
          'The selected predecessor is not this transaction’s retained failed/interrupted job.', 'JOB_BINDING');
        candidates = candidates.slice(0, index);
      }
      const retained = candidates.filter(job => ACTIVE.has(job.status) || job.status === 'COMPLETED');
      need(retained.length <= 1, 'More than one retained active/completed job matches; select the original job UUID.', 'AMBIGUOUS_JOB');
      const selected = retained[0] ?? candidates[0];
      if (!selected) return { found: false, adjustmentId, transaction };
      const result = await client.job(selected.id, options);
      checkedJob(result.job, selected.id, adjustmentId, transaction); return { found: true, ...result };
    },
    async reconcileWithdrawal(value, options) {
      const args = accountingAdjustmentArguments('withdraw', value);
      const result = await client.detail({ adjustmentId: args.adjustmentId }, options);
      if (result.adjustment.status !== 'WITHDRAWN') return { found: false, ...result };
      const history = await allDetailPages(args.adjustmentId, 'history', options), last = history.items.at(-1);
      need(history.revision === result.revision, 'The original request changed while its withdrawal history was read.', 'OBSERVATION_CHANGED');
      need(last?.action === 'WITHDRAWN' && last.actor === args.actor && last.reason === args.reason,
        'This request has a different retained withdrawal; inspect its original history.', 'REQUEST_BINDING');
      return { found: true, ...result, withdrawal: last };
    },
    callAccounting(name, args, options) {
      if (name === PREFIX + 'close') { need(plain(args ?? {}) && !Object.keys(args ?? {}).length, 'Close uses the selected original workspace.'); return client.close(options); }
      if (name === PREFIX + 'file_release') return client.releaseFile(args?.readId, options);
      if (name === PREFIX + 'maintenance_status') return client.maintenanceStatus(args, options);
      if (name === PREFIX + 'maintenance_job') return client.maintenanceJob(args?.jobId, options);
      if (name?.startsWith(PREFIX + 'maintenance_')) return client.maintenanceCommand(name.slice((PREFIX + 'maintenance_').length), args, options);
      return invoke(name, args, options);
    },
    registerFileRead(readId) { accepting(); return maintenance.registerFileRead(readId); },
    releaseFile: (readId, options) => maintenance.releaseFile(readId, options),
    drainFileReads: () => transition(() => maintenance.drainFileReads()),
    async *fileChunks(selection, options) {
      accepting(); const iterator = maintenance.fileChunks(selection, options);
      try { for (;;) { accepting(); const item = await iterator.next(); if (item.done) return; yield item.value; } }
      finally { await iterator.return?.(); }
    },
    maintenanceStatus: (args, options) => tracked(() => maintenance.status(args, options)),
    maintenanceJob: (jobId, options) => tracked(() => maintenance.job(jobId, options)),
    maintenanceCommand(kind, args, options) {
      accepting(); return kind === 'pause' ? transition(() => maintenance.command(kind, args, options)) : tracked(() => maintenance.command(kind, args, options));
    },
    retainedVerificationJobs: () => [...ownedJobs],
    async waitForVerification(jobId, { maxWaitMs = 60000, pollMs = 1000, signal } = {}) {
      need(Number.isSafeInteger(maxWaitMs) && maxWaitMs >= 0 && maxWaitMs <= 300000 &&
        Number.isSafeInteger(pollMs) && pollMs >= 250 && pollMs <= 30000,
      'Choose a wait of up to five minutes and a 250–30000 ms polling interval.');
      const deadline = Date.now() + maxWaitMs;
      for (;;) {
        signal?.throwIfAborted(); const result = await client.job(jobId, { requestSignal: signal });
        const active = ACTIVE.has(result.job.status);
        if (!active || Date.now() >= deadline) return { ...result, pending: active };
        await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())), undefined, { signal });
      }
    },
    /** Release this caller’s reads only. Original verification jobs remain addressable. */
    disconnect() {
      if (!closePromise) {
        accepting();
        closePromise = transition(async () => ({ ...(await maintenance.drainFileReads()),
          retainedJobIds: [...ownedJobs], workspaceClosed: false }), true);
      }
      return closePromise;
    },
    /** Explicit owner handoff: original workspace close includes its native job shutdown. */
    close(options) {
      if (!closePromise) { accepting(); closePromise = transition(() => maintenance.closeWorkspace(options), true); }
      return closePromise;
    },
  };
  return Object.freeze(client);
}

export async function connectAccountingAdjustmentClient({ workspace, ...options } = {}) {
  const connection = await openMerchantFileClient({ ...options, errorPrefix: 'ACCOUNTING_ADJUSTMENT', clientName: 'starforge-accounting-adjustments' });
  return Object.freeze({ ...createAccountingAdjustmentClient({ workspace, call: connection.call }), endpoint: connection.endpoint });
}
