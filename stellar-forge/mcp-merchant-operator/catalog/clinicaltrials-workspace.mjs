// MIT. Original ClinicalTrials tool metadata; the configured provider loads on demand.
import { sourceWorkspaceTools } from './source-workspace.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
const SHA = /^[0-9a-f]{64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NCT = /^NCT[0-9]{8}$/;
const PUBLISHER_KINDS = ['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'];

const alias = { type: 'string', pattern: ALIAS.source };
const digest = { type: 'string', pattern: SHA.source };
const id = { type: 'string', minLength: 1, maxLength: 160 };
const selection = { workspace: alias };
const mutation = { ...selection, expectedRevision: { type: 'integer', minimum: 0 },
  requestId: { type: 'string', pattern: UUID.source } };
const pagination = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 },
  expectedSnapshot: digest };
const read = { readOnly: true, idempotent: true };
const actionNames = [
  'cohort.configure', 'version.inspect', 'capture.start', 'capture.select', 'capture.advance',
  'capture.resume', 'capture.pause', 'review.record', 'mapping.default', 'mapping.save',
  'edition.build', 'edition.compare', 'dataset.query', 'merchant.configure', 'package.export',
  'prs.candidate', 'prs.plan', 'prs.apply', 'prs.reconcile', 'prs.preview',
  'batch.create', 'batch.links', 'batch.plan', 'batch.apply', 'batch.preview', 'batch.select',
  'batch.reconcile', 'batch.review', 'batch.export'
];
const originalTools = sourceWorkspaceTools((name, description, properties, required, annotations) =>
  ({ name, description, properties, required, annotations }));
const sourceNames = new Map(originalTools.map(value =>
  ['merchant_clinicaltrials_source_' + value.name.slice('merchant_source_'.length), value.name]));

export function clinicalTrialsWorkspaceTools(tool) {
  return [
    tool('merchant_clinicaltrials_workspaces', 'List the declared original ClinicalTrials consoles, file handles and active verified downloads.', {}, [], read),
    tool('merchant_clinicaltrials_status', 'Read the same original ClinicalTrials state, revision, cohort, captures, reviews, PRS and publishing history used by its browser.', selection, ['workspace'], read),
    tool('merchant_clinicaltrials_inventory', 'Page retained ClinicalTrials captures, reviews, PRS documents/plans/reconciliations or native source inventories at an exact snapshot.',
      { ...selection, kind: { type: 'string', enum: ['captures', 'reviews', 'prs', 'prsPlans', 'prsReconciliations', 'prsPreviews', 'batches', 'batchExports', 'exports', 'sources', 'plans', 'builds', 'comparisons'] }, ...pagination }, ['workspace', 'kind'], read),
    tool('merchant_clinicaltrials_capture', 'Inspect a retained provider capture and its original source pages, request, provider version and completeness.', { ...selection, captureId: id }, ['workspace', 'captureId'], read),
    tool('merchant_clinicaltrials_studies', 'Page the actual retained study cohort. Preserve the original capture and continue its returned offset; query searches the saved studies.',
      { ...selection, captureId: id, offset: pagination.offset, limit: pagination.limit, query: { type: 'string', maxLength: 200 } }, ['workspace', 'captureId'], read),
    tool('merchant_clinicaltrials_study', 'Read one complete original nested study, its NCT ID, exact JSON hash and source page.', { ...selection, captureId: id, nctId: { type: 'string', pattern: NCT.source } }, ['workspace', 'captureId', 'nctId'], read),
    tool('merchant_clinicaltrials_study_compare', 'Compare the same original NCT study across two retained capture editions.',
      { ...selection, beforeId: id, afterId: id, nctId: { type: 'string', pattern: NCT.source } }, ['workspace', 'beforeId', 'afterId', 'nctId'], read),
    tool('merchant_clinicaltrials_prs', 'Read a retained PRS document and original official-schema validation or candidate comparison.', { ...selection, documentId: id }, ['workspace', 'documentId'], read),
    tool('merchant_clinicaltrials_prs_plan', 'Read the complete frozen original PRS modernization plan.', { ...selection, planId: id }, ['workspace', 'planId'], read),
    tool('merchant_clinicaltrials_prs_reconciliation', 'Read the complete original typed PRS-to-study reconciliation and retained source decisions.', { ...selection, reportId: id }, ['workspace', 'reportId'], read),
    tool('merchant_clinicaltrials_prs_preview', 'Read the complete retained original full or partial PRS upload composition, selected documents and candidate report.', { ...selection, previewId: id }, ['workspace', 'previewId'], read),
    tool('merchant_clinicaltrials_prs_catalog', 'Read the maintained PRS engine catalog of source-bound protocol and results fields and original reconciliation rules.', selection, ['workspace'], read),
    tool('merchant_clinicaltrials_batch', 'Read the complete retained disclosure batch, client entries, findings, dispositions, original history and declared deliveries.',
      { ...selection, batchId: id }, ['workspace', 'batchId'], read),
    tool('merchant_clinicaltrials_batch_entry', 'Read one original batch entry with input/current XML identity and its retained modernization, composition and source-reconciliation reports.',
      { ...selection, batchId: id, entryId: digest }, ['workspace', 'batchId', 'entryId'], read),
    tool('merchant_clinicaltrials_operation', 'Recover the exact original request after an interrupted reply. Preserves UNKNOWN/RUNNING/COMPLETE/FAILED/INTERRUPTED and native result or error.',
      { ...selection, requestId: mutation.requestId }, ['workspace', 'requestId'], read),
    tool('merchant_clinicaltrials_action', 'Execute an original ClinicalTrials action with the reviewed revision and a retained UUID. Supports cohort/capture/review/mapping/edition/query/merchant/package, original PRS and disclosure-batch, publisher and dossier actions. Inspect the same operation after uncertainty.',
      { ...mutation, action: { anyOf: [{ type: 'string', enum: actionNames }, { type: 'string', pattern: '^(publisher|dossier)\\.[a-z][a-z0-9_.-]{0,95}$' }] }, payload: { type: 'object' } },
      ['workspace', 'action', 'payload', 'expectedRevision', 'requestId'], { openWorld: true }),
    tool('merchant_clinicaltrials_files', 'Inspect declared complete file identities before source, PRS or portable receiving. Returns original byte count and SHA256 without host path or credential values.',
      { ...selection, file: alias }, ['workspace'], read),
    tool('merchant_clinicaltrials_prs_upload', 'Send one complete host-declared PRS XML through the original raw-byte intake and original official protocol/results validator.',
      { ...mutation, file: alias, expectedSha256: digest, schema: { type: 'string', enum: ['protocol', 'results'] } }, ['workspace', 'file', 'expectedSha256', 'schema', 'expectedRevision', 'requestId'], {}),
    tool('merchant_clinicaltrials_prs_candidate', 'Retain a complete host-declared reviewed XML candidate against its original PRS document. Uses the native candidate comparison with the reviewed file SHA256, revision and request UUID.',
      { ...mutation, file: alias, expectedSha256: digest, originalId: digest,
        reviewedBy: { type: 'string', minLength: 1, maxLength: 160 },
        note: { type: 'string', minLength: 1, maxLength: 8192 } },
      ['workspace','file','expectedSha256','originalId','reviewedBy','note','expectedRevision','requestId'], {}),
    tool('merchant_clinicaltrials_restore', 'Receive one complete declared ClinicalTrials package through the existing receiving console and its original workspace lease.',
      { ...mutation, file: alias, expectedSha256: digest }, ['workspace', 'file', 'expectedSha256', 'expectedRevision', 'requestId'], {}),
    tool('merchant_clinicaltrials_file_prepare', 'Retain one complete declared native cohort or batch export, capture source member, contract, PRS XML/report or original publisher file for verified resumable delivery. Reads the original bytes once.',
      { ...selection, kind: { type: 'string', enum: ['export', 'batch', 'source', 'contract', 'prs', 'publisher'] },
        exportId: id, captureId: id, documentId: id, file: { type: 'string', minLength: 1, maxLength: 512 },
        name: id, publisherKind: { type: 'string', enum: PUBLISHER_KINDS }, id, expectedRevision: mutation.expectedRevision, prsKind: { type: 'string', enum: ['xml', 'report'] }, expectedSha256: digest },
      ['workspace', 'kind'], {}),
    tool('merchant_clinicaltrials_exports', 'Page complete retained ClinicalTrials MCP deliveries after a lost reply or either service restart. Each manifest binds its original native selection and file hash.',
      { workspace: alias, ...pagination }, [], read),
    tool('merchant_clinicaltrials_manifest', 'Inspect the saved completion manifest for an original ClinicalTrials delivery, including its complete source selection and byte hashes.',
      { exportId: digest }, ['exportId'], read),
    tool('merchant_clinicaltrials_file', 'Read one exact retained original file or its completion manifest in verified base64 chunks. Repeat file/manifest hashes, readId and byte offset to continue.',
      { exportId: digest, file: { type: 'string', minLength: 1, maxLength: 160 }, expectedManifestSha256: digest, expectedSha256: digest,
        readId: mutation.requestId, offset: pagination.offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
      ['exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], read),
    tool('merchant_clinicaltrials_file_release', 'Release a temporary verified read while preserving the complete original retained delivery.',
      { exportId: digest, readId: mutation.requestId }, ['exportId', 'readId'], { idempotent: true }),
    ...originalTools.map(value => tool('merchant_clinicaltrials_source_' + value.name.slice('merchant_source_'.length),
      value.description + ' Uses this existing ClinicalTrials console and its original NDJSON source engine.',
      value.properties, value.required, value.annotations))
  ];
}
export { actionNames as clinicalTrialsActionNames };
export function clinicalTrialsOriginalSourceTool(name) { return sourceNames.get(name) ?? null; }
