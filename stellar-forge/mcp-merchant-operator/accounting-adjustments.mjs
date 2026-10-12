import { adjustmentDefinitions, base, page, readOnly, uuid, sha256, draft, requiredDraft, revision, selected, actor, alias, instant } from './catalog/accounting-adjustments.mjs';
export { adjustmentDefinitions } from './catalog/accounting-adjustments.mjs';
// MIT. Merchant cancellation and refund operations over the original workspace owner.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const fail = (code, message) => Object.assign(new Error(message), { code });
const copy = value => structuredClone(value);















function paged(items, args, kind, project = copy) {
  const offset = args.offset ?? 0, limit = args.limit ?? 50;
  return { kind, items: items.slice(offset, offset + limit).map(project), total: items.length, offset, limit,
    nextOffset: offset + limit < items.length ? offset + limit : null };
}
function fileIdentity(value) {
  if (!value) return null;
  return Object.fromEntries(['path', 'sha256', 'bytes'].filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function proofSummary(proof) {
  if (!proof) return null;
  return Object.fromEntries(['schema', 'origin', 'reservation', 'refundId', 'network', 'asset', 'payer', 'recipient',
    'atomicAmount', 'transaction', 'rpcEndpoint', 'source', 'verdict', 'ledger', 'transferAt', 'observedAt', 'matchingTransfers',
    'transactionResultSha256', 'networkResultSha256'].filter(key => proof[key] !== undefined).map(key => [key, copy(proof[key])]));
}
function verificationSummary(value) {
  if (!value) return null;
  return { ...fileIdentity(value), transaction: value.transaction, ledger: value.ledger,
    transferAt: value.transferAt, verifiedAt: value.verifiedAt, proof: proofSummary(value.proof) };
}
function recordSummary(record, { complete = false } = {}) {
  const fields = ['schema', 'id', 'runId', 'eventId', 'kind', 'amountAtomic', 'effectiveAt', 'actor', 'createdAt',
    'status', 'requestSha256', 'previewSha256', 'source', 'refundTerms'];
  if (complete) fields.push('reason', 'reference', 'original');
  return { ...Object.fromEntries(fields.filter(key => record[key] !== undefined).map(key => [key, copy(record[key])])),
    historyCount: record.history.length, requestFile: fileIdentity(record.requestFile),
    originalProofFile: fileIdentity(record.originalProofFile), originalProof: proofSummary(record.originalProof),
    verification: verificationSummary(record.verification) };
}
function jobSummary(job) {
  const { result, ...rest } = job;
  return { ...copy(rest), ...(result ? { result: { ...result, verification: verificationSummary(result.verification) } } : {}) };
}
function eventSummary(detail) {
  const { originalProof, adjustments, ...rest } = detail;
  return { ...copy(rest), originalProof: proofSummary(originalProof), adjustmentCount: adjustments.length };
}
function resultSummary(value) {
  return { ...value, ...(value.adjustment ? { adjustment: recordSummary(value.adjustment, { complete: true }) } : {}),
    ...(value.job ? { job: jobSummary(value.job) } : {}) };
}
function nativeArguments(args, omit = []) {
  const excluded = new Set(['workspace', 'adjustmentId', 'view', ...omit]);
  return Object.fromEntries(Object.entries(args).filter(([key]) => !excluded.has(key)));
}

/** The existing AccountingWorkspace owns initialization, native jobs and shutdown. */
export class MerchantAdjustments {
  constructor(workspace, { httpsProxyEnv } = {}) {
    if (!workspace.adjustments || typeof workspace.adjustments.savedJob !== 'function')
      throw fail('ACCOUNTING_ADJUSTMENTS_UNAVAILABLE', 'Use the maintained accounting source that includes the original adjustment controller.');
    this.workspace = workspace;
    this.controller = workspace.adjustments;
    this.controller.configureTransport({ httpsProxyEnv });
  }
  counts() {
    return { adjustments: this.workspace.state.adjustments.length, adjustmentJobs: this.workspace.state.adjustmentJobs.length };
  }
  status(args = {}) {
    const adjustments = this.workspace.state.adjustments, jobs = this.workspace.state.adjustmentJobs;
    const result = { revision: this.workspace.state.revision, counts: this.counts(),
      adjustments: adjustments.slice(0, 10).map(row => recordSummary(row)),
      jobs: jobs.slice(0, 10).map(jobSummary) };
    if (args.view === 'adjustments') result.page = paged(adjustments, args, 'adjustments', row => recordSummary(row));
    else if (args.view === 'jobs') result.page = paged(jobs, args, 'jobs', jobSummary);
    return result;
  }
  async call(operation, args) {
    const controller = this.controller;
    switch (operation) {
      case 'merchant_accounting_adjustment_status': return this.status(args);
      case 'merchant_accounting_adjustment_events': return controller.events(nativeArguments(args));
      case 'merchant_accounting_adjustment_event': {
        const detail = await controller.event(args.runId, args.eventId);
        const result = eventSummary(detail);
        result.page = paged(detail.adjustments, args, 'adjustments', row => recordSummary(row));
        return result;
      }
      case 'merchant_accounting_adjustment_preview': {
        const preview = await controller.preview(nativeArguments(args));
        return { ...preview, detail: eventSummary(preview.detail) };
      }
      case 'merchant_accounting_adjustment_record':
        return resultSummary(await controller.record(nativeArguments(args)));
      case 'merchant_accounting_adjustment': {
        const { adjustment, detail } = await controller.detail(args.adjustmentId);
        const result = { adjustment: recordSummary(adjustment, { complete: true }), detail: eventSummary(detail),
          revision: this.workspace.state.revision };
        if (args.view === 'history') result.page = paged(adjustment.history, args, 'history');
        else if (args.view === 'jobs') {
          result.page = paged(this.workspace.state.adjustmentJobs.filter(job => job.adjustmentId === args.adjustmentId), args, 'jobs', jobSummary);
        }
        return result;
      }
      case 'merchant_accounting_adjustment_verify':
        return resultSummary(await controller.verify(args.adjustmentId, nativeArguments(args)));
      case 'merchant_accounting_adjustment_job': {
        const job = await controller.savedJob(args.jobId);
        return { job: jobSummary(job), adjustment: recordSummary(controller.row(job.adjustmentId), { complete: true }),
          revision: this.workspace.state.revision };
      }
      case 'merchant_accounting_adjustment_withdraw':
        return resultSummary(await controller.withdraw(args.adjustmentId, nativeArguments(args)));
      default: throw fail('ACCOUNTING_UNKNOWN_TOOL', 'Choose the original merchant adjustment operation.');
    }
  }
  /** Load exact retained source once; RetainedFileReads owns every later chunk. */
  async file({ adjustmentId, jobId, file }) {
    const record = this.controller.row(adjustmentId);
    await this.controller.assertRequestFile(record);
    let expected, name, maximum;
    if (file === 'request.json' && jobId === undefined) {
      expected = record.requestFile; name = adjustmentId + '-request.json'; maximum = 1_000_000;
      if (expected?.path !== 'adjustments/' + adjustmentId + '/request.json')
        throw fail('ACCOUNTING_ADJUSTMENT_FILE_CHANGED', 'The original adjustment request identity changed.');
    } else if (file === 'proof.json' && jobId) {
      const job = await this.controller.savedJob(jobId);
      if (job.adjustmentId !== adjustmentId || job.status !== 'COMPLETED' || !job.result?.verification)
        throw fail('ACCOUNTING_ADJUSTMENT_PROOF_UNAVAILABLE', 'Choose this adjustment’s completed original verification job.');
      expected = job.result.verification; name = adjustmentId + '-' + jobId + '-proof.json'; maximum = 200_000;
      if (expected.path !== 'adjustments/' + adjustmentId + '/' + jobId + '.proof.json')
        throw fail('ACCOUNTING_ADJUSTMENT_FILE_CHANGED', 'The original verification file identity changed.');
    } else throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Choose request.json with adjustmentId, or proof.json with adjustmentId and its original jobId.');
    if (!/^[a-f0-9]{64}$/.test(expected?.sha256 ?? '') || !Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > maximum)
      throw fail('ACCOUNTING_ADJUSTMENT_FILE_CHANGED', 'The retained adjustment file descriptor changed.');
    const source = await open(join(this.workspace.directory, expected.path), constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await source.stat();
      if (!info.isFile() || info.size !== expected.bytes || info.size > maximum)
        throw fail('ACCOUNTING_ADJUSTMENT_FILE_CHANGED', 'The retained adjustment source changed.');
      const bytes = await source.readFile();
      if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256)
        throw fail('ACCOUNTING_ADJUSTMENT_FILE_CHANGED', 'The retained adjustment bytes differ from their original descriptor.');
      return { bytes, name, type: 'application/json; charset=utf-8' };
    } finally { await source.close(); }
  }
}
