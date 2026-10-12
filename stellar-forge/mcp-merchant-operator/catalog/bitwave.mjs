// MIT. Original tool metadata; provider runtimes load only when selected.


const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuid = { type: 'string', pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' };

const nullableId = { anyOf: [uuid, { type: 'null' }] };

const sha256 = { type: 'string', pattern: '^[0-9a-f]{64}$' };

const actor = { type: 'string', minLength: 1, maxLength: 240 };

const name = { type: 'string', minLength: 1, maxLength: 160 };

const revision = { type: 'integer', minimum: 1 };

const timestamp = { type: 'string', minLength: 1, maxLength: 80 };

const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };

const search = { type: 'string', maxLength: 500 };

const base = { workspace: alias };

const plan = { ...base, planId: uuid };

const change = { ...plan, revision, actor };

const capture = { ...plan, captureId: uuid };

const readOnly = { readOnly: true, idempotent: true };

const planViews = ['summary', 'batches', 'operations', 'captures', 'returns', 'returnIntents', 'files', 'schema'];

const previewViews = ['summary', 'sourceIssues', 'editConflicts', 'results', 'issues', 'assignments', 'missingRows'];

const bitwaveDefinitions = [
  ['merchant_accounting_bitwave_status', 'Inspect declared Bitwave organizations, table aliases, input page sets and the original retained plans. Native access uses the host token. Views page existing plans or configured organizations; no native request starts.', { ...base, organization: alias, view: { type: 'string', enum: ['summary', 'plans', 'organizations', 'pageSets'] }, ...page }, ['workspace'], readOnly],
  ['merchant_accounting_bitwave_plan_create', 'Freeze an original accountant handoff or exact saved return into a Bitwave plan for a declared organization. Native source values stay exact strings. Use a stable id to recover a lost reply; this creates local retained files only.', { ...base, revision, actor, id: uuid, organization: alias, handoffId: uuid, accountantRevisionId: nullableId, name, description: { type: 'string', maxLength: 2000 }, batchSize: { type: 'integer', minimum: 1, maximum: 250 } }, ['workspace', 'revision', 'actor', 'id', 'organization', 'handoffId', 'name']],
  ['merchant_accounting_bitwave_plan', 'Inspect an original immutable plan, current binding, source identities and current accountant parent. Page its batches, native operations, captures, saved returns, interrupted return intents, exact retained files or native column schema.', { ...plan, view: { type: 'string', enum: planViews }, ...page }, ['workspace', 'planId'], readOnly],
  ['merchant_accounting_bitwave_rows', 'Page the original frozen string rows or a retained capture comparison. Supplying captureId selects MATCHED, CHANGED, MISSING, DUPLICATE or UNKNOWN source outcomes. Original financial fields are never recomputed.', { ...plan, captureId: uuid, status: { type: 'string', enum: ['MATCHED', 'CHANGED', 'MISSING', 'DUPLICATE', 'UNKNOWN'] }, search, ...page }, ['workspace', 'planId'], readOnly],
  ['merchant_accounting_bitwave_bind', 'Select a host-declared native data-source alias in this plan’s organization. Use this to recover a table creation whose native response was interrupted. An already bound plan cannot switch to a different table.', { ...change, dataSource: alias, note: { type: 'string', minLength: 1, maxLength: 2000 } }, ['workspace', 'planId', 'revision', 'actor', 'dataSource', 'note']],
  ['merchant_accounting_bitwave_operation_start', 'Start the original native create, upload, paginated capture or reviewed missing-row repair. Keep the stable id after a lost reply and inspect its operation. Repair requires a complete fresh native captureId and comparisonSha256; resumeCaptureId continues a partial capture of the same table.', { ...change, id: uuid, action: { type: 'string', enum: ['create', 'upload', 'capture', 'repair'] }, captureId: uuid, comparisonSha256: sha256, resumeCaptureId: uuid }, ['workspace', 'planId', 'revision', 'actor', 'id', 'action'], { openWorld: true }],
  ['merchant_accounting_bitwave_operation', 'Inspect one original native operation and its retained request/response identities. Page individual steps. Completion and captureId come from the same durable workspace, so a lost MCP reply does not require a new write.', { ...plan, operationId: uuid, view: { type: 'string', enum: ['summary', 'steps'] }, ...page }, ['workspace', 'planId', 'operationId'], readOnly],
  ['merchant_accounting_bitwave_operation_stop', 'Request that the original operation stop between native requests. Completed responses and partial capture pages remain retained. Inspect the final status before continuing; an in-flight write is reconciled through native capture.', { ...plan, operationId: uuid, actor }, ['workspace', 'planId', 'operationId', 'actor'], { idempotent: true }],
  ['merchant_accounting_bitwave_input', 'Inspect a declared ordered original JSON page set, exact byte counts and SHA256 values. Retain inputSha256 for import. Local file paths and credentials remain host configuration.', { ...base, source: alias, ...page }, ['workspace', 'source'], readOnly],
  ['merchant_accounting_bitwave_import', 'Retain and compare an inspected native page set against its original plan and exact selected table. Rechecks inputSha256 before import and preserves all original file bytes. Use a stable capture id after a lost reply.', { ...change, source: alias, inputSha256: sha256, id: uuid, name }, ['workspace', 'planId', 'revision', 'actor', 'source', 'inputSha256', 'id', 'name']],
  ['merchant_accounting_bitwave_return_preview', 'Preview the original source-matched accountant return against the explicit current parent. Preserves concurrent local bookkeeping and pages three-way edit conflicts and original return outcomes. Carry the returned id, createdAt and integrity SHA unchanged to apply; preview:null means no usable rows.', { ...capture, expectedParentId: nullableId, actor, name, id: uuid, createdAt: timestamp, view: { type: 'string', enum: previewViews }, ...page }, ['workspace', 'planId', 'captureId', 'expectedParentId', 'actor', 'name'], { readOnly: true }],
  ['merchant_accounting_bitwave_return_apply', 'Apply an explicitly previewed capture through the original accountant return engine. Keep its stable id, timestamp, parent, revision and previewSha256. Retained return intents recover an interrupted save/link without duplicating the accountant revision.', { ...capture, revision, actor, id: uuid, createdAt: timestamp, name, expectedParentId: nullableId, previewSha256: sha256 }, ['workspace', 'planId', 'captureId', 'revision', 'actor', 'id', 'createdAt', 'name', 'expectedParentId', 'previewSha256']],
  ['merchant_accounting_bitwave_file', 'Read an exact retained plan/capture/request/response file or bitwave-handoff.tar in SHA-pinned base64 chunks. The shared original reader freezes one verified snapshot for all chunks. Keep workspace, planId, file, readId and expectedSha256 unchanged; release unfinished reads with merchant_accounting_file_release.', { ...plan, file: { type: 'string', minLength: 1, maxLength: 240, pattern: '^[A-Za-z0-9._/-]+$' }, readId: uuid, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 196608 }, expectedSha256: sha256 }, ['workspace', 'planId', 'file'], readOnly],
];

export { bitwaveDefinitions, base, alias, page, readOnly, revision, actor, uuid, nullableId, name, plan, planViews, search, change, sha256, capture, timestamp, previewViews };
