// MIT. Original NocoDB tool metadata; source and provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
import { publisherTools } from './publisher.mjs';

// Mirrors the original NocoDB declaration; its compiler remains authoritative.
const SCALAR_TYPES = new Set(['SingleLineText', 'LongText', 'PhoneNumber', 'URL', 'Email',
  'Number', 'Decimal', 'Currency', 'Percent', 'Duration', 'Date', 'DateTime', 'Time', 'SingleSelect',
  'Rating', 'Checkbox', 'Year', 'CreatedTime', 'LastModifiedTime', 'AutoNumber',
  'Formula', 'Lookup', 'Rollup', 'Barcode', 'QrCode']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const text = { type: 'string', minLength: 1, maxLength: 128 };
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: UUID.source };
const digest = { type: 'string', pattern: SHA256.source };
const revision = { type: 'integer', minimum: 0 };
const version = { type: 'integer', minimum: 1 };
const selection = { type: ['integer', 'null'], minimum: 1 };
const connectionAlias = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,47}$' };
const providerId = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' };
const queryName = '^[A-Za-z][A-Za-z0-9_]{0,47}$';
const selected = { workspace: alias };
const read = { readOnly: true, idempotent: true };
const column = { type: 'object', additionalProperties: false, properties: {
  source: { type: 'string', minLength: 1, maxLength: 128 },
  providerType: { type: 'string', enum: [...SCALAR_TYPES] },
  type: { type: 'string', enum: ['string', 'integer', 'number', 'boolean'] },
  encoding: { type: 'string', enum: ['native', 'number-text', 'identity-text'] },
  nullable: { type: 'boolean' }, empty: { type: 'string', enum: ['preserve', 'null'] },
}, required: ['source', 'type'] };
const queries = { type: 'object', minProperties: 1, maxProperties: 32,
  propertyNames: { pattern: queryName }, additionalProperties: { type: 'object',
    additionalProperties: false, properties: { columns: { type: 'object',
      minProperties: 1, maxProperties: 64, propertyNames: { pattern: queryName },
      additionalProperties: column } }, required: ['columns'] } };
const sourceOrder = { type: 'array', minItems: 1, maxItems: 8, items: {
  type: 'object', additionalProperties: false,
  properties: { field: providerId, direction: { enum: ['asc', 'desc'] } },
  required: ['field', 'direction'] } };
const draftSchema = { type: 'object', additionalProperties: false, properties: {
  captureId: uuid, title: text, queries,
}, required: ['captureId', 'title', 'queries'] };


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

export function nocodbWorkspaceTools(tool) {
  return [
    tool('merchant_nocodb_workspaces', 'List host-declared NocoDB authoring aliases, original workspace identities and current MCP ownership. Does not open a model, query the provider or start a publisher.', {}, [], read),
    tool('merchant_nocodb_open', 'Open one existing original NocoDB authoring workspace under its native lease and serve its same browser on loopback. Browser and MCP share one model. Stop a separately running source CLI or Application first. This does not read NocoDB or start the publisher.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_nocodb_close', 'Close this exact owned NocoDB/browser instance, drain original operations, publisher, scheduler and deployment console/owned merchant, and release native workspace and file reads. Saved versions and original request receipts remain.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_nocodb_status', 'Read original selected version, draft/revision, paginated discoveries/captures/versions, current preview, native request IDs and live browser/publisher/deployment ownership. Storage paths and credential references are omitted; public values are unchanged.', {
      ...selected, capturesOffset: revision, versionsOffset: revision, discoveriesOffset: revision,
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['workspace'], read),
    tool('merchant_nocodb_inputs', 'List host-declared frozen-source/private-packet aliases or inspect one file for exact bytes and SHA256. Does not import or query NocoDB. Use this reviewed expectedSha256 for the subsequent original import.', { ...selected, input: alias }, ['workspace'], read),
    tool('merchant_nocodb_import', 'Import one host-declared original frozen NocoDB source and its complete capture. The original packet builder verifies every capture member; its exact sourceSha256 must equal the reviewed hash. Original import retains bytes and saves the draft only when expectedDraftRevision still matches. Reuse the native request UUID or resume its saved input.', {
      ...selected, input: alias, expectedSha256: digest, title: text, expectedDraftRevision: revision, requestId: uuid,
    }, ['workspace', 'input', 'expectedSha256', 'title', 'expectedDraftRevision', 'requestId'], { idempotent: true }),
    tool('merchant_nocodb_import_packet', 'Import one host-declared original private NocoDB source packet as a capture-backed editable draft. Recheck the whole file SHA256, original page/count/schema identities and current draft revision. No connection credential is imported and no provider read occurs.', {
      ...selected, input: alias, expectedSha256: digest, title: text, expectedDraftRevision: revision, requestId: uuid,
    }, ['workspace', 'input', 'expectedSha256', 'title', 'expectedDraftRevision', 'requestId'], { idempotent: true }),
    tool('merchant_nocodb_discover', 'Explicitly read actual v3 table metadata through one host-declared connection. Retains field IDs/types, supported scalar/identity semantics and exact table/view/filter binding. This does not capture rows. Recovery never repeats an uncertain provider read.', {
      ...selected, connectionAlias, baseId: providerId, tableId: providerId,
      viewId: { anyOf: [providerId, { type: 'null' }] },
      where: { type: ['string', 'null'], minLength: 1, maxLength: 8192 }, requestId: uuid,
    }, ['workspace', 'connectionAlias', 'baseId', 'tableId', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_nocodb_discovery', 'Read one original retained metadata discovery by its request UUID. Does not make another provider request.', { ...selected, requestId: uuid }, ['workspace', 'requestId'], read),
    tool('merchant_nocodb_capture', 'Explicitly capture complete v3 pages using the exact retained discovery, same host connection, actual field IDs/types and stable native identity order. The original reader observes opening/closing schema and counts, keeps received pages and never splices reads. Expected draft revision controls adoption. This is a paged source observation, not a transactional snapshot.', {
      ...selected, discoveryId: uuid, connectionAlias, sourceOrder, queries, title: text,
      expectedDraftRevision: revision, requestId: uuid,
    }, ['workspace', 'discoveryId', 'connectionAlias', 'sourceOrder', 'queries', 'title', 'expectedDraftRevision', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_nocodb_capture_attempt', 'Inspect the original saved capture attempt and its retained member hashes/completeness after an interrupted provider observation. Does not combine pages, resume a provider request or start a new capture.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], read),
    tool('merchant_nocodb_columns', 'Inspect actual retained field IDs/types, native identity keys, null/missing/scalar counts and original number-token samples. The original capture selection remains fixed; aliases and explicit scalar/null encoding form the reviewed public projection.', {
      ...selected, captureId: uuid,
    }, ['workspace', 'captureId'], read),
    tool('merchant_nocodb_draft_save', 'Save the complete explicit public query/projection against the original expected draft revision. Preserve the captured field/type union, server/table/view/filter and native source order. The publisher may later expose a subset of the reviewed columns.', {
      ...selected, draft: draftSchema, expectedRevision: revision, requestId: uuid,
    }, ['workspace', 'draft', 'expectedRevision', 'requestId'], { idempotent: true }),
    tool('merchant_nocodb_preview', 'Validate every retained row through the original NocoDB typed extractor for this exact saved draft revision. Returns the original preview UUID, full row counts and first25 public rows per query without another provider observation.', {
      ...selected, draftRevision: revision, requestId: uuid,
    }, ['workspace', 'draftRevision', 'requestId'], { idempotent: true }),
    tool('merchant_nocodb_version_save', 'Review the exact saved draft/preview and retain an immutable source version using the current expected selection and request UUID. It installs the same managed source file used by a new original publisher plan.', {
      ...selected, draftRevision: revision, previewId: uuid, reviewer: text,
      note: { type: 'string', minLength: 1, maxLength: 2000 }, expectedSelectedVersion: selection, requestId: uuid,
    }, ['workspace', 'draftRevision', 'previewId', 'reviewer', 'note', 'expectedSelectedVersion', 'requestId'], { idempotent: true }),
    tool('merchant_nocodb_version', 'Read one original saved source version, reviewer, capture identity and public query map without changing the current draft or selection.', {
      ...selected, versionId: version,
    }, ['workspace', 'versionId'], read),
    tool('merchant_nocodb_compare', 'Compare two original source versions and retained typed previews. Preserves exact table/view/filter/source order, capture and projection identities; no provider read or new calculation occurs.', {
      ...selected, leftVersion: version, rightVersion: version,
    }, ['workspace', 'leftVersion', 'rightVersion'], read),
    tool('merchant_nocodb_select', 'Select an original saved version against the current expected selection using a retained request UUID. Existing publisher plans, published snapshots and buyer handoffs keep their original source.', {
      ...selected, versionId: version, expectedSelectedVersion: selection, requestId: uuid,
    }, ['workspace', 'versionId', 'expectedSelectedVersion', 'requestId'], { idempotent: true }),
    tool('merchant_nocodb_operation', 'Read the original request receipt after a lost response together with live publisher/deployment ownership and current selection. A historical open receipt is not proof its recorded URL is still running.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], read),
    tool('merchant_nocodb_resume', 'Continue only the original retained interrupted operation from its saved input. Native recovery never repeats uncertain NocoDB discovery/capture or deployment commands. A terminal native failure keeps its original code.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], { idempotent: true }),
    tool('merchant_nocodb_publisher_open', 'Open the SAME original publisher/browser/scheduler for the exact selected source version. Previously enabled native policies may resume. Browser and merchant_nocodb_publisher_* share these handles and native lease. Read currentPublisher for the live URL after a replay.', {
      ...selected, expectedSelectedVersion: version, requestId: uuid,
    }, ['workspace', 'expectedSelectedVersion', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_nocodb_publisher_close', 'Close and drain the original authoring-owned publisher and its scheduler using one native request UUID. Saved plans, runs, policies, publication versions and buyer handoffs remain.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], { idempotent: true, destructive: true }),

    tool('merchant_nocodb_deployment_status', 'Read original published runs matched to saved NocoDB source versions, deployment request history, immutable release selection and current original merchant/console ownership. Uses retained native data; no NocoDB read, extraction or merchant start.', {
      ...selected, runsOffset:revision, operationsOffset:revision, limit:{type:'integer',minimum:1,maximum:100},
    }, ['workspace'], read),
    tool('merchant_nocodb_deployment_review', 'Bind one originally published run and exact retained source version to reviewed public merchant terms. Reuses the original candidate and seller compiler. The amount is an atomic integer string. Retain requestId and returned reviewSha256.', {
      ...selected, versionId:version, runId:uuid, terms:merchantTerms, requestId:uuid,
    }, ['workspace','versionId','runId','terms','requestId'], {idempotent:true}),
    tool('merchant_nocodb_deployment_prepare', 'Prepare the five original dataset-release files from the completed deployment review and exact reviewSha256. Retains the original dataset directory and public projection; no raw private NocoDB records, token credentials, extraction or version-store migration. Same request recovery completes the same package.', {
      ...selected, reviewRequestId:uuid, expectedReviewSha256:digest, requestId:uuid,
    }, ['workspace','reviewRequestId','expectedReviewSha256','requestId'], {idempotent:true}),
    tool('merchant_nocodb_deployment_package', 'Inspect the exact completed original package request, public file hashes, source binding and merchant configuration hash. Package and dataset paths are host-local and omitted from MCP output.', {
      ...selected, packageRequestId:uuid,
    }, ['workspace','packageRequestId'], read),
    tool('merchant_nocodb_deployment_stage', 'Stage the reviewed package through the original SF82 release store. Requires the package source SHA256 and a stable immutable release ID. Reusing an ID requires identical package, label and normalized runtime. Does not select or start the merchant.', {
      ...selected, packageRequestId:uuid, expectedSourceSha256:digest, id:text,
      label:{type:'string',minLength:1,maxLength:240}, runtime:deploymentRuntime, requestId:uuid,
    }, ['workspace','packageRequestId','expectedSourceSha256','id','requestId'], {idempotent:true}),
    tool('merchant_nocodb_deployment_compare', 'Compare retained merchant releases through the original SF82 comparator. Omit from to use the original active selection. Returns the current selection generation and original diff; does not change either release or the dataset.', {
      ...selected, from:{type:['string','null']}, to:text,
    }, ['workspace','to'], read),
    tool('merchant_nocodb_deployment_console_open', 'Open the original loopback SF82 deployment console inside this same NocoDB workspace. That original console solely owns merchant lifecycle. CurrentDeployment establishes the live URL/instance; a recorded receipt alone does not. Opening does not start a merchant.', {
      ...selected, requestId:uuid,
    }, ['workspace','requestId'], {idempotent:true}),
    tool('merchant_nocodb_deployment_console_close', 'Close only the exact current deployment console instance, drain its owned merchant and retain release/dataset state. Reusing the original request never closes a successor console.', {
      ...selected, instanceId:uuid, requestId:uuid,
    }, ['workspace','instanceId','requestId'], {idempotent:true,destructive:true}),
    tool('merchant_nocodb_deployment_command', 'Run one explicit activate, rollback, run, stop or restart through the SAME original console used by the browser. Use current consoleInstanceId and expectedGeneration; use the inspected target release expectedDigest except for stop, and exact merchant instanceId for stop/restart. Activate uses id; rollback uses to or original previous release. Original receiving review may be supplied. After an uncertain local reply, operation/resume only observes current native state and NEVER replays the command; inspect before a new explicit request.', {
      ...selected, action:{type:'string',enum:['activate','rollback','run','stop','restart']},
      consoleInstanceId:uuid, expectedGeneration:revision, expectedDigest:digest, instanceId:uuid, id:text, to:text,
      reason:{type:'string',maxLength:2000}, receiving:{type:'object'}, requestId:uuid,
    }, ['workspace','action','consoleInstanceId','expectedGeneration','requestId'], {idempotent:true,destructive:true,openWorld:true}),
    tool('merchant_nocodb_deployment_file_read', 'Read one exact verified original package file through the existing SHA256-pinned retained-file reader. Files over its existing 256,000,000-byte limit use the original browser/CLI download. Reuse readId, expectedSha256 and offset; after expiry/restart omit readId and resume the SAME package/file/hash/offset. No host path input.', {
      ...selected, packageRequestId:uuid, file:deploymentFile, readId:uuid, expectedSha256:digest, offset:revision,
      limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES},
    }, ['workspace','packageRequestId','file'], read),
    tool('merchant_nocodb_deployment_file_release', 'Release only the current alias retained-file snapshot. Does not delete a package, source, dataset version or release.', {
      ...selected, readId:uuid,
    }, ['workspace','readId'], read),
    tool('merchant_nocodb_packet_read', 'Read an original private portable source packet for one immutable version through the existing SHA256-pinned retained-file reader. Contains complete captured metadata/pages and selected source, without credential references. Reuse readId/hash/offset; after expiry or MCP restart omit readId and resume the same version/hash/offset.', {
      ...selected, versionId: version, readId: uuid, expectedSha256: digest, offset: revision,
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'versionId'], read),
    tool('merchant_nocodb_capture_read', 'Read the original complete private observation packet before a source version is saved. Uses the same retained-file reader and original exportCapture; binds capture UUID, whole packet SHA256 and byte offset. No provider request or source mutation occurs.', {
      ...selected, captureId: uuid, readId: uuid, expectedSha256: digest, offset: revision,
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'captureId'], read),
    tool('merchant_nocodb_packet_release', 'Release only this alias verified packet-read snapshot. Does not delete an original version, capture, publisher, release or workspace.', {
      ...selected, readId: uuid,
    }, ['workspace', 'readId'], read),
    // Schema and behavior stay with the original retained-publisher adapter.
    ...publisherTools((name, description, properties, required, annotations) => {
      if (['merchant_publishers', 'merchant_publisher_open', 'merchant_publisher_close'].includes(name)) return null;
      const { publisher, ...input } = properties;
      return tool(name.replace('merchant_publisher_', 'merchant_nocodb_publisher_'),
        'Use the publisher already opened by merchant_nocodb_publisher_open in this SAME source workspace. ' + description,
        { ...selected, ...input }, required.map(key => key === 'publisher' ? 'workspace' : key), annotations);
    }).filter(Boolean),

  ];
}

export { UUID, SHA256, deploymentFile };
