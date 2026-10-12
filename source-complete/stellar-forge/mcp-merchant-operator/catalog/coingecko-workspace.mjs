// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
import { LIMITS } from '../../../stellar/scf-starforge-20261009/partners/coingecko-stellar-market/limits-contracts.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const SHA256 = /^[a-f0-9]{64}$/;

const ID = /^[A-Za-z0-9._:-]{1,160}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const id = { type: 'string', pattern: ID.source };

const uuid = { type: 'string', pattern: UUID.source };

const digest = { type: 'string', pattern: SHA256.source };

const label = { type: 'string', minLength: 1, maxLength: 240 };

const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };

const version = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };

const object = { type: 'object' };

const ids = maximum => ({ type: 'array', items: id, minItems: 1, maxItems: maximum, uniqueItems: true });

const selected = { workspace: alias };

const inProject = { ...selected, projectId: id };

const write = { ...inProject, opId: id, revision };

const page = { offset: revision, limit: { type: 'integer', minimum: 1, maximum: LIMITS.pageSize },
  q: { type: 'string', maxLength: 2000 } };

const read = { readOnly: true, idempotent: true };

const change = { idempotent: true };

const recordKinds = ['request', 'collection', 'capture', 'snapshot', 'comparison', 'note', 'provider-plan', 'job', 'export'];

const rowsKinds = ['capture', 'snapshot', 'comparison'];

const fileKinds = ['source', 'collection', 'snapshot', 'comparison', 'provider-plan', 'handover'];

function coingeckoWorkspaceTools(tool) {
  return [
    tool('merchant_coingecko_workspaces', 'List host-declared private CoinGecko workspaces, owned browser instances and configured input/profile aliases. Opens no workspace or provider connection.', {}, [], read),
    tool('merchant_coingecko_open', 'Open the original CoinGecko browser and research model once. Agent and browser share the same project revisions, source bytes and native jobs. Reopening this owned alias returns the same live instance. Native interrupted purchases remain interrupted.', selected, ['workspace'], change),
    tool('merchant_coingecko_close', 'Drain the exact owned browser/model and native workers, release retained file reads and the original workspace lease. Retained projects and original purchase IDs survive reopening.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_coingecko_status', 'Inspect the current original projects, endpoint contracts, public buyer-profile metadata, runtime and retained download sessions.', selected, ['workspace'], read),
    tool('merchant_coingecko_project', 'Read the original project, current revision, complete collection counts, recent events and native job status.', inProject, ['workspace', 'projectId'], read),
    tool('merchant_coingecko_project_create', 'Create a retained original research project. Supply one stable opId; inspect that same operation after a lost response.', { ...selected, opId: id, name: label }, ['workspace', 'opId', 'name'], change),
    tool('merchant_coingecko_configure', 'Save the project merchant origin, path prefix and host-declared buyer-profile ID against the current project revision. Credentials remain in the original host configuration.', { ...write, config: object }, ['workspace', 'projectId', 'opId', 'revision', 'config'], change),
    tool('merchant_coingecko_records', 'Page the original requests, collections, source files, captures, jobs, snapshots, comparisons, notes, provider plans, handovers or events. Continue until offset plus returned item count reaches total.', { ...inProject, kind: { type: 'string', enum: ['requests', 'collections', 'files', 'captures', 'jobs', 'snapshots', 'comparisons', 'notes', 'providerPlans', 'exports', 'events'] }, ...page }, ['workspace', 'projectId', 'kind'], read),
    tool('merchant_coingecko_inspect', 'Inspect one original project-owned record, including request versions, complete capture/source identities, collection definitions or native purchase review. Large original source and report bytes remain available through file_read.', { ...inProject, kind: { type: 'string', enum: recordKinds }, id }, ['workspace', 'projectId', 'kind', 'id'], read),
    tool('merchant_coingecko_rows', 'Page every retained capture, snapshot or comparison row using the original native analysis and exact decimal values. Optional status applies to the native row filter.', { ...inProject, kind: { type: 'string', enum: rowsKinds }, id, ...page, status: { type: 'string', maxLength: 80 }, rowKind: { type: 'string', maxLength: 80 } }, ['workspace', 'projectId', 'kind', 'id'], read),
    tool('merchant_coingecko_row', 'Inspect one original capture row and all linked provider entities retained with it. Preserves exact decimal values and original relationship IDs.', { ...inProject, captureId: id, rowId: id }, ['workspace', 'projectId', 'captureId', 'rowId'], read),
    tool('merchant_coingecko_operation', 'Recover the original saved write response by its stable opId and project scope. Omit projectId for project creation or handover restoration. This is a native operation-table read and never repeats a purchase or import.', { ...selected, projectId: id, opId: id }, ['workspace', 'opId'], read),
    tool('merchant_coingecko_request_save', 'Create or update an original endpoint request. Use the contract from status, preserving native path/query values. Updates require requestId and its current version as well as project revision.', { ...write, request: object, requestId: id, version }, ['workspace', 'projectId', 'opId', 'revision', 'request'], change),
    tool('merchant_coingecko_collection_save', 'Create or update a saved collection with its complete ordered requestIds. Updates require collectionId and its current version. Requests must belong to this project.', { ...write, collection: object, collectionId: id, version }, ['workspace', 'projectId', 'opId', 'revision', 'collection'], change),
    tool('merchant_coingecko_collection_import', 'Import a complete original CoinGecko collection package from a retained source file, preserving its original request definitions and references.', { ...write, fileId: id, name: label }, ['workspace', 'projectId', 'opId', 'revision', 'fileId'], change),
    tool('merchant_coingecko_sources', 'List the host-declared original input aliases and their source or handover purpose. Filesystem paths and buyer credentials are not tool arguments.', selected, ['workspace'], read),
    tool('merchant_coingecko_source_inspect', 'Read a declared original input and return its exact SHA256, byte length, filename and content type before import or restore. Retains no copy and makes no network request.', { ...selected, input: alias }, ['workspace', 'input'], read),
    tool('merchant_coingecko_source_import', 'Retain exact original source bytes through the native uploader. Select a host input alias for full sources up to 15,000,000 bytes, or supply filename plus canonical contentBase64 for up to 65,536 inline bytes. Pin expectedSha256. The original opId recovers a lost response.', { ...write, input: alias, filename: label, contentType: { type: 'string', minLength: 1, maxLength: 200 }, contentBase64: { type: 'string', maxLength: 87384 }, expectedSha256: digest }, ['workspace', 'projectId', 'opId', 'revision', 'expectedSha256'], change),
    tool('merchant_coingecko_response_import', 'Associate retained original response bytes, headers and observation metadata with their saved request. Preserves exact source bytes and native data provenance. A retained response-body file must belong to the same project.', { ...write, requestId: id, fileId: id, headersFileId: id, responseBodyFileId: id, httpStatus: { type: 'integer', minimum: 100, maximum: 599 }, sourceUrl: { type: 'string', minLength: 1, maxLength: 8192 }, observedAt: { type: 'string', minLength: 1, maxLength: 80 }, name: label }, ['workspace', 'projectId', 'opId', 'revision', 'requestId', 'fileId'], change),
    tool('merchant_coingecko_provider_example', 'Retain the example already present in the selected original provider challenge. Its native provider_bazaar_example basis remains explicit in captures, snapshots and handovers.', { ...write, captureId: id, name: label }, ['workspace', 'projectId', 'opId', 'revision', 'captureId'], change),
    tool('merchant_coingecko_probe', 'Create the original asynchronous unsigned GET observation job for exact saved requests and vendor or merchant target. Returns the original job ID; inspect it until terminal. Reuse the opId after an uncertain response.', { ...write, name: label, requestIds: ids(256), target: { type: 'string', enum: ['vendor', 'merchant'] } }, ['workspace', 'projectId', 'opId', 'revision', 'name', 'requestIds', 'target'], { idempotent: true, openWorld: true }),
    tool('merchant_coingecko_snapshot_create', 'Retain one complete native snapshot from selected response captures, with original source bases, exact values and full denominator counts. Select at most one capture per request.', { ...write, name: label, captureIds: ids(1000), collectionId: id }, ['workspace', 'projectId', 'opId', 'revision', 'name', 'captureIds'], change),
    tool('merchant_coingecko_comparison_create', 'Compare two different original project snapshots through the native exact-decimal market comparison engine. Keeps added, removed and changed rows and complete baseline/current source identities.', { ...write, name: label, baselineId: id, currentId: id }, ['workspace', 'projectId', 'opId', 'revision', 'name', 'baselineId', 'currentId'], change),
    tool('merchant_coingecko_note_save', 'Create or update a research, data-quality or follow-up note attached to its original request, capture, row, snapshot or comparison. Preserves source files, assignee, status and original record versions.', { ...write, note: object, noteId: id, version }, ['workspace', 'projectId', 'opId', 'revision', 'note'], change),
    tool('merchant_coingecko_provider_plan_preview', 'Compile a provider plan through the original CoinGecko product compiler, returning all selected endpoint routes, native payment alternatives and source configuration. Makes no payment or provider request.', { ...selected, plan: object }, ['workspace', 'plan'], read),
    tool('merchant_coingecko_provider_plan_save', 'Retain the original compiled provider deployment plan. Updates require planId and its current version. Download its complete native deployment document through file_read.', { ...write, plan: object, planId: id, version }, ['workspace', 'projectId', 'opId', 'revision', 'plan'], change),
    tool('merchant_coingecko_checkout_prepare', 'Prepare the original SF88 buyer inbox review for selected current merchant challenges in one collection. Each selection includes requestId, captureId and acceptIndex. Uses host-configured buyer identity and original SF31/SF36 budgets; preparation does not execute payment. Inspect the returned original job before explicit execute.', { ...write, collectionId: id, version, name: label, buyerProfileId: id, selections: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'object', additionalProperties: false, required: ['requestId', 'captureId', 'acceptIndex'], properties: { requestId: id, captureId: id, acceptIndex: { type: 'integer', minimum: 0, maximum: 1000 } } } } }, ['workspace', 'projectId', 'opId', 'revision', 'collectionId', 'version', 'name', 'selections'], change),
    tool('merchant_coingecko_job_control', 'Apply the explicitly selected native execute, cancel, resume or recover action to the original job ID and current job version/project revision. Execute may make the reviewed payment. Recovery reads the original attempt and saved response; it never creates a replacement attempt. Only native canExecute/canCancel/canResume/canRecover determine availability.', { ...write, jobId: id, version, action: { type: 'string', enum: ['execute', 'cancel', 'resume', 'recover'] } }, ['workspace', 'projectId', 'opId', 'revision', 'jobId', 'version', 'action'], { idempotent: true, destructive: true, openWorld: true }),
    tool('merchant_coingecko_handover_create', 'Save a complete native portable project archive, including original files, histories, rows, operations evidence and runnable source closure. Selected snapshot/comparison IDs remain attached. Download the original retained archive in chunks.', { ...write, name: label, snapshotId: id, comparisonId: id }, ['workspace', 'projectId', 'opId', 'revision', 'name'], change),
    tool('merchant_coingecko_restore', 'Restore a complete original handover as a new project using either a host-declared handover input, or sourceWorkspace plus its retained exportId. Pin the original expectedSha256 and reuse opId after a lost reply. Native ID mappings, source bytes and histories are retained; historical purchase jobs remain archived.', { ...selected, opId: id, name: label, input: alias, sourceWorkspace: alias, exportId: id, expectedSha256: digest }, ['workspace', 'opId', 'name', 'expectedSha256'], change),
    tool('merchant_coingecko_file_read', 'Read complete retained source bytes, collection JSON, snapshot/comparison report, provider deployment or portable handover. First read returns file SHA256, size and readId. Continue with the same selection, expectedSha256, readId and nextOffset. After expiry/reopen omit readId while keeping the exact SHA256 and offset.', { ...inProject, kind: { type: 'string', enum: fileKinds }, id, expectedSha256: digest, readId: uuid, offset: revision, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['workspace', 'projectId', 'kind', 'id'], read),
    tool('merchant_coingecko_file_release', 'Release this owned original download session when the caller stops reading before its last chunk. The retained project source remains available.', { ...selected, readId: uuid }, ['workspace', 'readId'], read),
  ];
}

export { coingeckoWorkspaceTools, read, selected, change, uuid, inProject, id, label, write, object, page, recordKinds, rowsKinds, version, alias, digest, ids, fileKinds, revision, UUID, ID, SHA256 };
