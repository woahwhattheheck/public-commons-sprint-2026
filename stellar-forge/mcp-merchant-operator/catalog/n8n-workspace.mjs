// MIT. Original n8n tool metadata; its merchant runtime loads only when configured.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const N8N_EXPORT_MANIFEST = 'n8n-job-export.json';
const N8N_SHA = /^[a-f0-9]{64}$/;
const N8N_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const N8N_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const jobSchema = { type: 'string', pattern: N8N_JOB_ID.source };
const functionSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,55}$' };
const digestSchema = { type: 'string', pattern: N8N_SHA.source };
const uuidSchema = { type: 'string', pattern: N8N_UUID.source };
const revisionSchema = { type: 'integer', minimum: 1 };
const reasonSchema = { type: 'string', minLength: 1, maxLength: 500 };
const selected = { workspace: aliasSchema };
const selectedJob = { ...selected, jobId: jobSchema };
const page = { cursor: { type: 'string', minLength: 1, maxLength: 2048 },
  limit: { type: 'integer', minimum: 1, maximum: 200 } };
const read = { readOnly: true, idempotent: true };
export function n8nWorkspaceTools(tool) {
  return [
    tool('merchant_n8n_status', 'Inspect the original running automation merchant, complete configured functions, current worker and source identities. Uses the host-selected source and current private launch.',
      selected, ['workspace'], read),
    tool('merchant_n8n_jobs', 'Page original retained jobs by query and state. Follow nextCursor with the same filters; if the collection revision changes, restart that query.',
      { ...selected, ...page, q: { type: 'string', maxLength: 300 }, status: { type: 'string', pattern: '^[A-Z_]{1,32}$' } }, ['workspace'], read),
    tool('merchant_n8n_job', 'Read the complete original job and its dispatch history before a revision-bound change or full export. Original result bytes are retrieved through the retained export.',
      selectedJob, ['workspace', 'jobId'], read),
    tool('merchant_n8n_prepare', 'Prepare an original application job and its private customer claim handoff. Retain the request UUID and exact input; retrying that same request recovers the same job and token.',
      { ...selected, requestId: uuidSchema, reference: jobSchema, functionId: functionSchema, input: { type: 'object' },
        label: { type: 'string', maxLength: 300 } }, ['workspace', 'requestId', 'functionId', 'input'], { idempotent: true }),
    tool('merchant_n8n_renew', 'Renew the original unsubmitted claim at its current job revision. Retain the UUID, revision and reason; the exact retry recovers the same renewed private handoff.',
      { ...selectedJob, requestId: uuidSchema, expectedRevision: revisionSchema, reason: reasonSchema },
      ['workspace', 'requestId', 'jobId', 'expectedRevision', 'reason'], { idempotent: true }),
    tool('merchant_n8n_cancel', 'Cancel the selected original job at its current revision. After an interrupted response, inspect that same job before another change.',
      { ...selectedJob, expectedRevision: revisionSchema, reason: reasonSchema },
      ['workspace', 'jobId', 'expectedRevision', 'reason'], { destructive: true }),
    tool('merchant_n8n_retry', 'Retry the same original job under its native state and revision rules. Read its existing dispatch before retrying; uncertain n8n execution has its own reconcile/rerun operations.',
      { ...selectedJob, expectedRevision: revisionSchema, reason: reasonSchema },
      ['workspace', 'jobId', 'expectedRevision', 'reason'], { openWorld: true }),
    tool('merchant_n8n_reconcile', 'Reconcile the original dispatch against the actual n8n execution. Supply an execution ID only to adopt that exact verified workflow and original job input; expectedRevision selects the dispatch.',
      { ...selectedJob, expectedRevision: revisionSchema, reason: reasonSchema,
        executionId: { type: 'string', minLength: 1, maxLength: 128 } },
      ['workspace', 'jobId', 'expectedRevision', 'reason'], { openWorld: true }),
    tool('merchant_n8n_authorize_rerun', 'Authorize another actual n8n execution after reviewing the original uncertain dispatch. Requires both current dispatch and paid-job revisions plus the operator reason.',
      { ...selectedJob, expectedRevision: revisionSchema, jobRevision: revisionSchema, reason: reasonSchema },
      ['workspace', 'jobId', 'expectedRevision', 'jobRevision', 'reason'], { destructive: true, openWorld: true }),
    tool('merchant_n8n_worker_start', 'Start the original merchant worker. It processes the same paid job queue and retained execution history shared with the browser and Applications launch.',
      selected, ['workspace'], { idempotent: true, openWorld: true }),
    tool('merchant_n8n_worker_stop', 'Request the original worker to drain its current jobs. Read status until it finishes; the merchant and its customer/operator services remain available.',
      selected, ['workspace'], { idempotent: true, destructive: true }),
    tool('merchant_n8n_export', 'Freeze the complete original job, dispatch and completed result at the selected revisions. Keep this request UUID; its exact retry returns the same immutable export after the live job changes.',
      { ...selectedJob, requestId: uuidSchema, expectedRevision: revisionSchema,
        expectedDispatchRevision: { anyOf: [revisionSchema, { type: 'null' }] } },
      ['workspace', 'requestId', 'jobId', 'expectedRevision', 'expectedDispatchRevision'], { idempotent: true }),
    tool('merchant_n8n_exports', 'Page retained complete original job exports, optionally for one job. Every item contains its original revision, full file descriptors and manifest SHA256.',
      { ...selected, ...page, jobId: jobSchema }, ['workspace'], read),
    tool('merchant_n8n_manifest', 'Read the retained completion manifest identity for one immutable original job export.',
      { ...selected, exportId: digestSchema }, ['workspace', 'exportId'], read),
    tool('merchant_n8n_file', 'Read an original export file in SHA-pinned base64 chunks. Continue the same readId and nextOffset; after expiry, reopen the same manifest, file digest and byte offset.',
      { ...selected, exportId: digestSchema, file: { type: 'string', enum: [N8N_EXPORT_MANIFEST, 'job.json', 'dispatch.json', 'result.json'] },
        expectedManifestSha256: digestSchema, expectedSha256: digestSchema, readId: uuidSchema,
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
      ['workspace', 'exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], read),
    tool('merchant_n8n_file_release', 'Release this temporary original file-read continuation while preserving its complete retained job export.',
      { ...selected, exportId: digestSchema, readId: uuidSchema }, ['workspace', 'exportId', 'readId'], read),
  ];
}
