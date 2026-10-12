// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const SHA256 = /^[a-f0-9]{64}$/;

const text = { type: 'string', minLength: 1, maxLength: 128 };

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuid = { type: 'string', pattern: UUID.source };

const digest = { type: 'string', pattern: SHA256.source };

const revision = { type: 'integer', minimum: 0 };

const version = { type: 'integer', minimum: 1 };

const selection = { type: ['integer', 'null'], minimum: 1 };

const range = { type: 'string', minLength: 1, maxLength: 512 };

const selected = { workspace: alias };

const read = { readOnly: true, idempotent: true };

const column = { type: 'object', additionalProperties: false,
  properties: { column: { type: 'string', pattern: '^[A-Z]+$' }, header: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: ['string', 'integer', 'number', 'boolean'] },
    nullable: { type: 'boolean' }, formula: { type: 'string', enum: ['reject', 'effective'] } },
  required: ['column', 'header', 'type', 'nullable', 'formula'] };

const draftSchema = { type: 'object', additionalProperties: false, properties: {
  captureId: uuid, title: text, name: text, range, columns: { type: 'object', minProperties: 1, additionalProperties: column },
  emptyRows: { type: 'string', enum: ['skip', 'reject'] }, mode: { type: 'string', enum: ['capture', 'live'] },
  connectionAlias: { type: ['string', 'null'] } },
  required: ['captureId', 'title', 'name', 'range', 'columns', 'emptyRows', 'mode', 'connectionAlias'] };

const deploymentFile = { type: 'string', enum: ['dataset.csv','dataset.json','seller.json','source.json','binding.json'] };

const merchantTerms = { type: 'object', additionalProperties: false, properties: {
  origin: { type:'string', minLength:1, maxLength:2048 }, path: { type:'string', minLength:1, maxLength:1024 },
  payment: { type:'object', additionalProperties:false, properties: {
    scheme:text, network:text, asset:{type:'string',minLength:1,maxLength:512},
    payTo:{type:'string',minLength:1,maxLength:512}, amount:{type:'string',pattern:'^[0-9]+$'},
    maxTimeoutSeconds:{type:'integer',minimum:1}
  }, required:['scheme','network','asset','payTo','amount','maxTimeoutSeconds'] }
}, required:['origin','path','payment'] };

const deploymentRuntime = { type:'object', additionalProperties:false, properties: {
  port:{type:'integer',minimum:0,maximum:65535}, facilitator:{type:'string',minLength:1,maxLength:2048},
  allowLocalFacilitator:{type:'boolean'}
} };

function sheetsWorkspaceTools(tool) {
  return [
    tool('merchant_sheets_workspaces', 'List host-declared original Sheets source-authoring aliases and this MCP process ownership. Does not open a model, query Google or start a publisher.', {}, [], read),
    tool('merchant_sheets_open', 'Open one existing original Sheets source workspace under its native lease and serve its same browser on loopback. The browser and these tools share one model. Release a separately running source CLI first. This does not start the publisher or read Google.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_sheets_close', 'Close this exact owned Sheets/browser instance, drain its original operations, publisher and deployment console/owned merchant, release verified file reads and its original lease. Saved source versions and operation receipts remain.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_sheets_status', 'Read original source selection, current draft/revision, capture and version pages, latest preview, native operation IDs and current browser/publisher/deployment ownership. Public samples retain original values; local storage and credential references are omitted.', {
      ...selected, capturesOffset: revision, versionsOffset: revision, limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['workspace'], read),
    tool('merchant_sheets_inputs', 'List host-declared input aliases, or inspect one original observation/private packet file to obtain its current exact bytes and SHA256. Does not import, parse source values or read Google. Import requires this reviewed SHA256.', {
      ...selected, input: alias,
    }, ['workspace'], read),
    tool('merchant_sheets_import', 'Import one host-declared exact Spreadsheet CellData observation with its host-bound original requested range. Recheck expectedSha256 before the original importer retains the bytes. Reusing requestId with the same retained bytes preserves native idempotency; use merchant_sheets_operation or resume if the host input has changed. This does not query Google or change the draft.', {
      ...selected, input: alias, expectedSha256: digest, title: text, requestId: uuid,
    }, ['workspace', 'input', 'expectedSha256', 'title', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_import_packet', 'Import one host-declared original private source packet as a capture-backed editable draft. Rechecks original packet/hash bindings and the current draft revision; live credential references are never imported. Reuse the same requestId after an uncertain reply.', {
      ...selected, input: alias, expectedSha256: digest, title: text, expectedDraftRevision: revision, requestId: uuid,
    }, ['workspace', 'input', 'expectedSha256', 'title', 'expectedDraftRevision', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_workbook', 'Read original Google workbook metadata through one existing host-declared connection: exact workbook identity and tab IDs/titles. Does not capture cells or grant access. Workbook URLs must be ordinary Google Sheets URLs.', {
      ...selected, connectionAlias: text, spreadsheet: { type: 'string', minLength: 1, maxLength: 2048 },
    }, ['workspace', 'connectionAlias', 'spreadsheet'], { readOnly: true, openWorld: true }),
    tool('merchant_sheets_capture', 'Explicitly read and retain the selected original Google tab and bounded CellData range through an existing host connection. The original request ID and read receipt govern recovery; an uncertain Google request is never automatically repeated by resume.', {
      ...selected, connectionAlias: text, spreadsheet: { type: 'string', minLength: 1, maxLength: 2048 },
      sheetId: revision, sheetTitle: text, range, title: text, requestId: uuid,
    }, ['workspace', 'connectionAlias', 'spreadsheet', 'sheetId', 'sheetTitle', 'range', 'title', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_sheets_columns', 'Inspect actual retained headers, types, formula/blank counts and source samples for one original capture and an optional bounded subrange. Nothing is public until the operator explicitly selects columns and publishes through the original publisher.', {
      ...selected, captureId: uuid, range,
    }, ['workspace', 'captureId'], read),
    tool('merchant_sheets_draft_save', 'Save the explicit public projection against the original expected draft revision. Column letters and exact headers, scalar types, blank and formula policies retain their original meanings. No new provider observation or publication occurs.', {
      ...selected, draft: draftSchema, expectedRevision: revision, requestId: uuid,
    }, ['workspace', 'draft', 'expectedRevision', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_preview', 'Validate the complete selected retained range with the original typed extractor for this saved draft revision. Returns its retained preview ID, complete row count and first25 public rows. Live-source authoring preview uses the retained observation, not another Google read.', {
      ...selected, draftRevision: revision, requestId: uuid,
    }, ['workspace', 'draftRevision', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_version_save', 'Review the exact original draft/preview and save a source version, installing its managed source declaration only when the current selection still matches. The original request UUID prevents duplicate saved versions after a lost reply.', {
      ...selected, draftRevision: revision, previewId: uuid, reviewer: text, note: { type: 'string', minLength: 1, maxLength: 2000 },
      expectedSelectedVersion: selection, requestId: uuid,
    }, ['workspace', 'draftRevision', 'previewId', 'reviewer', 'note', 'expectedSelectedVersion', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_version', 'Read one original saved source version, reviewer and public projection. Does not replace the current draft or selection.', {
      ...selected, versionId: version,
    }, ['workspace', 'versionId'], read),
    tool('merchant_sheets_compare', 'Compare two original source versions and their retained typed previews, including observation/range/projection identity. Original values and nulls are returned without recomputing the source or performing a provider read.', {
      ...selected, leftVersion: version, rightVersion: version,
    }, ['workspace', 'leftVersion', 'rightVersion'], read),
    tool('merchant_sheets_select', 'Select a saved source version using the current expected selection and original request UUID. It changes the managed source used by a new original publisher plan; existing plans and buyer snapshots retain their native source.', {
      ...selected, versionId: version, expectedSelectedVersion: selection, requestId: uuid,
    }, ['workspace', 'versionId', 'expectedSelectedVersion', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_operation', 'Read the original request receipt and current source/publisher state after a lost response. A historical publisher-open receipt does not establish that its old URL is still running.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], read),
    tool('merchant_sheets_resume', 'Continue only the original retained interrupted request. Uses its saved bytes and original engine recovery; it never repeats an uncertain Google request. Pending stays attached to the same request and terminal errors retain their original code.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_publisher_open', 'Open the SAME original publisher against the exact selected source version. Saved enabled original publication policies may resume. A replay returns the original receipt plus live currentPublisher; use only that current URL. Does not start a second publisher for the same directory.', {
      ...selected, expectedSelectedVersion: version, requestId: uuid,
    }, ['workspace', 'expectedSelectedVersion', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_sheets_publisher_close', 'Close and drain the original publisher owned by this source workspace using one retained request UUID. Original plans, candidates, versions, schedules and buyer handoffs remain.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], { idempotent: true, destructive: true }),

    tool('merchant_sheets_deployment_status', 'Read original published runs matched to saved Sheets source versions, deployment request history, immutable release selection and current original merchant/console ownership. Uses retained native data; no Google read, extraction or merchant start.', {
      ...selected, runsOffset:revision, operationsOffset:revision, limit:{type:'integer',minimum:1,maximum:100},
    }, ['workspace'], read),
    tool('merchant_sheets_deployment_review', 'Bind one originally published run and exact retained source version to reviewed public merchant terms. Reuses the original candidate and seller compiler. The amount is an atomic integer string. Retain requestId and returned reviewSha256.', {
      ...selected, versionId:version, runId:uuid, terms:merchantTerms, requestId:uuid,
    }, ['workspace','versionId','runId','terms','requestId'], {idempotent:true}),
    tool('merchant_sheets_deployment_prepare', 'Prepare the five original dataset-release files from the completed deployment review and exact reviewSha256. Retains the original dataset directory and public projection; no raw Sheet cells, Google credentials, extraction or version-store migration. Same request recovery completes the same package.', {
      ...selected, reviewRequestId:uuid, expectedReviewSha256:digest, requestId:uuid,
    }, ['workspace','reviewRequestId','expectedReviewSha256','requestId'], {idempotent:true}),
    tool('merchant_sheets_deployment_package', 'Inspect the exact completed original package request, public file hashes, source binding and merchant configuration hash. Package and dataset paths are host-local and omitted from MCP output.', {
      ...selected, packageRequestId:uuid,
    }, ['workspace','packageRequestId'], read),
    tool('merchant_sheets_deployment_stage', 'Stage the reviewed package through the original SF82 release store. Requires the package source SHA256 and a stable immutable release ID. Reusing an ID requires identical package, label and normalized runtime. Does not select or start the merchant.', {
      ...selected, packageRequestId:uuid, expectedSourceSha256:digest, id:text,
      label:{type:'string',minLength:1,maxLength:240}, runtime:deploymentRuntime, requestId:uuid,
    }, ['workspace','packageRequestId','expectedSourceSha256','id','requestId'], {idempotent:true}),
    tool('merchant_sheets_deployment_compare', 'Compare retained merchant releases through the original SF82 comparator. Omit from to use the original active selection. Returns the current selection generation and original diff; does not change either release or the dataset.', {
      ...selected, from:{type:['string','null']}, to:text,
    }, ['workspace','to'], read),
    tool('merchant_sheets_deployment_console_open', 'Open the original loopback SF82 deployment console inside this same Sheets workspace. That original console solely owns merchant lifecycle. CurrentDeployment establishes the live URL/instance; a recorded receipt alone does not. Opening does not start a merchant.', {
      ...selected, requestId:uuid,
    }, ['workspace','requestId'], {idempotent:true}),
    tool('merchant_sheets_deployment_console_close', 'Close only the exact current deployment console instance, drain its owned merchant and retain release/dataset state. Reusing the original request never closes a successor console.', {
      ...selected, instanceId:uuid, requestId:uuid,
    }, ['workspace','instanceId','requestId'], {idempotent:true,destructive:true}),
    tool('merchant_sheets_deployment_command', 'Run one explicit activate, rollback, run, stop or restart through the SAME original console used by the browser. Use current consoleInstanceId and expectedGeneration; use the inspected target release expectedDigest except for stop, and exact merchant instanceId for stop/restart. Activate uses id; rollback uses to or original previous release. Original receiving review may be supplied. After an uncertain local reply, operation/resume only observes current native state and NEVER replays the command; inspect before a new explicit request.', {
      ...selected, action:{type:'string',enum:['activate','rollback','run','stop','restart']},
      consoleInstanceId:uuid, expectedGeneration:revision, expectedDigest:digest, instanceId:uuid, id:text, to:text,
      reason:{type:'string',maxLength:2000}, receiving:{type:'object'}, requestId:uuid,
    }, ['workspace','action','consoleInstanceId','expectedGeneration','requestId'], {idempotent:true,destructive:true,openWorld:true}),
    tool('merchant_sheets_deployment_file_read', 'Read one exact verified original package file through the existing SHA256-pinned retained-file reader. Files over its existing 256,000,000-byte limit use the original browser/CLI download. Reuse readId, expectedSha256 and offset; after expiry/restart omit readId and resume the SAME package/file/hash/offset. No host path input.', {
      ...selected, packageRequestId:uuid, file:deploymentFile, readId:uuid, expectedSha256:digest, offset:revision,
      limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES},
    }, ['workspace','packageRequestId','file'], read),
    tool('merchant_sheets_deployment_file_release', 'Release only the current alias retained-file snapshot. Does not delete a package, source, dataset version or release.', {
      ...selected, readId:uuid,
    }, ['workspace','readId'], read),
    tool('merchant_sheets_packet_read', 'Read a private portable source packet from the original saved version. Live credential references are stripped by the original exporter. Returns SHA256-pinned base64 chunks through the existing retained-file reader; reuse readId, expectedSha256 and offset. After expiry or restart omit readId and resume the SAME version/hash/offset.', {
      ...selected, versionId: version, readId: uuid, expectedSha256: digest, offset: revision,
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'versionId'], read),
    tool('merchant_sheets_packet_release', 'Release only this alias original verified packet-read snapshot. Does not delete a source version, capture, handoff or workspace.', {
      ...selected, readId: uuid,
    }, ['workspace', 'readId'], read),
  ];
}

export { sheetsWorkspaceTools, read, selected, uuid, revision, alias, digest, text, range, draftSchema, selection, version, merchantTerms, deploymentRuntime, deploymentFile, UUID, SHA256, column };
