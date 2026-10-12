// MIT. Original managed WQX operations exposed through the merchant operator.
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const pointer = { type: 'string', maxLength: 1024, pattern: '^(?:|/.*)$' };
const reference = { type: 'string', pattern: '^(?:input:[a-z0-9][a-z0-9_-]{0,63}|host:[a-z0-9][a-z0-9_-]{0,63}|file:[0-9a-f]{64})$' };
const record = { type: 'object', additionalProperties: true };
const offset = { type: 'integer', minimum: 0 };
const limit = { type: 'integer', minimum: 1, maximum: 250 };
const readId = { type: 'string', minLength: 1, maxLength: 96 };
const page = { offset, limit, expectedSnapshot: digest };
const workspace = { workspace: alias };
const input = { ...workspace, request: record, inputRef: reference };
const document = { document: record, documentRef: reference };
const native = (path, keys, required, description, readOnly = false, idempotent = false, openWorld = false) =>
  Object.freeze({ path, keys, required, description, readOnly, idempotent, openWorld });

export const WQX_NATIVE_OPERATIONS = Object.freeze({
  project_save: native('/api/project', ['title', 'selection', 'expectedRevision'], ['title', 'selection', 'expectedRevision'],
    'Save the original station, date, constituent and project selection at its current revision.'),
  capture_start: native('/api/captures', ['operationId', 'expectedRevision'], ['operationId', 'expectedRevision'],
    'Start or resume this original capture identifier through the managed WQX provider. Read jobs and captures for actual completion.', false, false, true),
  analyze: native('/api/analysis', ['captureId', 'options', 'comparisonCaptureId'], ['captureId'],
    'Analyze the entire retained original capture, with the native optional comparison. Retains the complete scientific JSON.', true, true),
  review_save: native('/api/reviews', ['reviewId', 'captureId', 'options', 'note', 'comparisonCaptureId', 'expectedCaptureSha256'],
    ['reviewId', 'captureId', 'expectedCaptureSha256'],
    'Save or reopen the same immutable original scientific review and its selected capture hash.', false, true),
  plan_preview: native('/api/open-waters/preview', ['reviewId', 'options', 'expectedReviewSha256'],
    ['reviewId', 'expectedReviewSha256'],
    'Build the native Open Waters preview from the exact saved scientific review and complete receiving choices.', true, true),
  plan_save: native('/api/open-waters', ['planId', 'reviewId', 'options', 'expectedReviewSha256'],
    ['planId', 'reviewId', 'expectedReviewSha256'],
    'Save or reopen an immutable original Open Waters plan, including all native receiving files.', false, true),
  edition_prepare: native('/api/editions', ['editionId', 'reviewId'], ['editionId', 'reviewId'],
    'Prepare the original complete scientific merchant edition from its retained review.', false, true),
  merchant_stage: native('/api/merchant/stage', ['editionId', 'origin', 'path', 'payment'], ['editionId', 'origin', 'payment'],
    'Stage the original edition with its native seller origin, resource path and payment terms.'),
  merchant_start: native('/api/merchant/start', ['editionId', 'allowLocalFacilitator', 'challengeOnly'], ['editionId'],
    'Start the selected original scientific edition using the managed host native SDK and configured facilitator.', false, false, true),
  merchant_stop: native('/api/merchant/stop', [], [],
    'Stop the original scientific seller in this managed WQX host. The saved project remains open.', false, true),
  customer_prepare: native('/api/customer/prepare', ['editionId', 'intentId', 'query', 'file', 'kind', 'previous', 'acceptIndex'],
    ['editionId', 'intentId'],
    'Prepare the exact native scientific purchase intent and retain its full requirements before execution.', true, true),
  customer_execute: native('/api/customer/execute', ['intentId'], ['intentId'],
    'Execute the original prepared intent through the managed host configured buyer and retain its complete result.', false, false, true),
  customer_reopen: native('/api/customer/reopen', ['editionId', 'intentId'], ['editionId', 'intentId'],
    'Reopen this exact original buyer intent and complete scientific delivery from retained native state.', true, true),
});

export function wqxWorkspaceTools(tool) {
  const read = { readOnly: true, idempotent: true }, retained = { idempotent: true };
  const result = [
    tool('merchant_wqx_status', 'Inspect configured WQX projects, their current original managed launch, project revision, runtime and inventory counts. Follows the saved project after an Applications restart.',
      workspace, [], read),
    tool('merchant_wqx_inventory', 'Page the complete original captures, scientific reviews, Open Waters plans, bulk decisions, editions or capture jobs. Repeat the exact snapshot for subsequent pages.',
      { ...workspace, kind: { type: 'string', enum: ['captures', 'reviews', 'plans', 'decisions', 'editions', 'jobs'] }, ...page },
      ['workspace', 'kind'], read),
    tool('merchant_wqx_record', 'Inspect one complete original capture, scientific review, Open Waters plan, decision review or edition. A JSON pointer exposes bounded original fields or rows, and a retained file carries the complete exact document.',
      { ...workspace, family: { type: 'string', enum: ['capture', 'review', 'plan', 'decision', 'edition'] }, id, pointer, offset, limit,
        expectedDocumentSha256: digest }, ['workspace', 'family', 'id'], read),
    tool('merchant_wqx_result', 'Read one original result using its exact retained capture and source-file pointer.',
      { ...workspace, captureId: id, id: { type: 'string', pattern: '^wqx-record-[0-9a-f]{64}$' },
        sourceSha256: digest, sourceIndex: offset, captureSha256: digest },
      ['workspace', 'captureId', 'id', 'sourceSha256', 'sourceIndex', 'captureSha256'], read),
    tool('merchant_wqx_targets', 'Page every matching original bulk-decision target from one immutable plan. Keep expectedPlanSha256 on every following page; filters retain the full native cohort count.',
      { ...workspace, planId: id, kind: { type: 'string', enum: ['settings', 'location', 'activity', 'result', 'translation', 'limit', 'reference'] },
        field: { type: 'string', maxLength: 96 }, search: { type: 'string', maxLength: 500 },
        status: { type: 'string', maxLength: 96 }, attentionOnly: { type: 'boolean' }, offset,
        limit: { type: 'integer', minimum: 1, maximum: 1000 }, expectedPlanSha256: digest },
      ['workspace', 'planId'], read),
    tool('merchant_wqx_file', 'Retain a complete native source response, review export, Open Waters file, bulk-decision export or purchased scientific file. Receive every byte through file_read.',
      { ...workspace, family: { type: 'string', enum: ['capture', 'review', 'plan', 'decision', 'customer'] }, id,
        format: { type: 'string', maxLength: 32 }, index: offset, intentId: id },
      ['workspace', 'family', 'id'], read),
    tool('merchant_wqx_files', 'Page complete immutable WQX file descriptors already retained by this operator, including files from an earlier process or managed launch.',
      page, [], read),
    tool('merchant_wqx_file_read', 'Read up to 65,536 exact bytes from a retained WQX file. Repeat its full SHA256, offset and readId; after expiry reopen the same file and offset without readId.',
      { fileId: digest, expectedSha256: digest, offset, limit: { type: 'integer', minimum: 1, maximum: 65536 }, readId },
      ['fileId', 'expectedSha256'], read),
    tool('merchant_wqx_file_release', 'Release this temporary file read while retaining the complete original WQX export.',
      { fileId: digest, readId }, ['fileId', 'readId'], read),
    tool('merchant_wqx_input_begin', 'Begin or reopen one immutable complete-file upload, up to 128 MiB. The same inputId must retain its exact name, size and SHA256.',
      { inputId: alias, name: { type: 'string', minLength: 1, maxLength: 180 },
        contentType: { type: 'string', minLength: 1, maxLength: 240 }, bytes: { type: 'integer', minimum: 0, maximum: 134217728 }, sha256: digest },
      ['inputId', 'name', 'bytes', 'sha256'], retained),
    tool('merchant_wqx_input_append', 'Append up to 65,536 original bytes at the retained upload offset. Replaying identical committed bytes resumes an interrupted response.',
      { inputId: alias, sha256: digest, offset, dataBase64: { type: 'string', minLength: 4, maxLength: 87384 } },
      ['inputId', 'sha256', 'offset', 'dataBase64'], retained),
    tool('merchant_wqx_input_finish', 'Verify every uploaded byte against the original size and SHA256, then retain the complete immutable input reference.',
      { inputId: alias, sha256: digest }, ['inputId', 'sha256'], retained),
    tool('merchant_wqx_input_status', 'Read the authoritative received byte offset or completed input reference for this original upload.',
      { inputId: alias }, ['inputId'], read),
    tool('merchant_wqx_input_files', 'List configured complete input-file references and original capture source aliases.',
      {}, [], read),
    tool('merchant_wqx_concentration_units', 'Read the complete source concentration catalogue from one immutable receiving plan. The response includes every exact source-unit group count, supported blank-result limit-only count and preserved other-unit records; its retained file contains every original result ID.',
      { ...workspace, planId: id, expectedPlanSha256: digest }, ['workspace', 'planId'], read),
    tool('merchant_wqx_concentration_prepare', 'Prepare the full paired result/unit and independent reported/native limit choices through the original concentration workflow. Supply one complete document/documentRef and exactly one source selection: resultIds, exact fromUnit, or reportedLimitsOnly:true. Keeps unrelated choices and all original blank values. Returns the complete proposal, CSV report and a directly reusable documentRef when every chosen record is prepared.',
      { ...workspace, ...document, resultIds: { type: 'array', minItems: 1, maxItems: 100000, uniqueItems: true,
          items: { type: 'string', pattern: '^wqx-record-[0-9a-f]{64}$' } },
        fromUnit: { type: 'string', maxLength: 240 }, reportedLimitsOnly: { type: 'boolean', enum: [true] },
        targetUnit: { type: 'string', minLength: 1, maxLength: 64 }, reason: { type: 'string', minLength: 1, maxLength: 600 },
        expectedPlanSha256: digest }, ['workspace', 'targetUnit', 'reason'], read),
    tool('merchant_wqx_concentration_report', 'Reopen the complete original concentration report from one saved decision review, including every retained reported limit and actual native postimage. JSON and CSV are returned as full retained files for the existing resumable client.',
      { ...workspace, reviewId: id, format: { type: 'string', enum: ['json', 'csv'] } }, ['workspace', 'reviewId'], read),
    tool('merchant_wqx_table_export', 'Export the complete unfiltered native CSV or TSV receiving table, including its source-bound decisions. Supply exactly one document or complete documentRef.',
      { ...workspace, ...document, format: { type: 'string', enum: ['csv', 'tsv'] } }, ['workspace', 'format'], read),
    tool('merchant_wqx_table_import', 'Parse a complete CSV or TSV input with the original bulk-decision parser and retain the complete source-bound JSON document.',
      { ...workspace, inputRef: reference, format: { type: 'string', enum: ['csv', 'tsv'] } }, ['workspace', 'inputRef', 'format'], read),
    tool('merchant_wqx_decisions_preview', 'Preview the complete bulk decision document through the original native planner. Retains the full preview, including all proposed native outputs and before/after counts.',
      { ...workspace, ...document, newPlanId: id }, ['workspace', 'newPlanId'], read),
    tool('merchant_wqx_decisions_save', 'Save or resume the same original immutable bulk decision review and new plan using the complete document and exact preview SHA256.',
      { ...workspace, ...document, reviewId: id, newPlanId: id, expectedPreviewSha256: digest },
      ['workspace', 'reviewId', 'newPlanId', 'expectedPreviewSha256'], retained),
    tool('merchant_wqx_receive', 'Receive a complete original scientific review, Open Waters plan or bulk decision bundle into the selected managed project. The native receiver verifies and reconstructs the original source and exports.',
      { ...workspace, kind: { type: 'string', enum: ['review', 'plan', 'decision'] }, inputRef: reference },
      ['workspace', 'kind', 'inputRef'], retained),
    tool('merchant_wqx_capture_import', 'Import one configured original capture directory and require its full capture hash. Uses the host-selected capture alias and current project revision.',
      { ...workspace, source: alias, expectedRevision: offset, title: { type: 'string', minLength: 1, maxLength: 240 } },
      ['workspace', 'source', 'expectedRevision'], retained),
    tool('merchant_wqx_capture_cancel', 'Request cancellation of the exact original capture operation in this managed project. Progress and retained source remain available in inventory.',
      { ...workspace, captureId: id }, ['workspace', 'captureId'], retained),
  ];
  for (const [name, definition] of Object.entries(WQX_NATIVE_OPERATIONS))
    result.push(tool('merchant_wqx_' + name,
      definition.description + ' Supply exactly one request or complete inputRef; large results are retained as exact complete files.',
      input, ['workspace'], definition));
  return result;
}
