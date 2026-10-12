// MIT. Complete laboratory operation metadata; original native engines own every mutation.
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' };
const nativeId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' };
const revision = { type: 'integer', minimum: 0 };
const text = { type: 'string', maxLength: 1000 };
const reason = { type: 'string', minLength: 1, maxLength: 500 };
const inputRef = { type: 'string', pattern: '^(?:input:[a-z0-9][a-z0-9_-]{0,63}|file:[a-f0-9]{64})$' };
const readId = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };
const selected = { workspace: alias };
const request = { ...selected, requestId: sha };
const source = { ...request, expectedRevision: revision, expectedBindingSha256: sha };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };
const references = { type: 'object', properties: { current: inputRef, baseline: inputRef, correspondence: inputRef }, additionalProperties: false };
const documents = { type: 'object', properties: { current: { type: 'object' }, baseline: { type: 'object' }, correspondence: { type: 'object' } }, additionalProperties: false };
const preview = { ...source, documents, documentRefs: references };
const family = { type: 'string', enum: ['current', 'baseline', 'correspondence'] };
const side = { type: 'string', enum: ['current', 'baseline'] };
const fields = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1024 }, minItems: 1, maxItems: 512, uniqueItems: true };
const filename = { type: 'string', minLength: 1, maxLength: 180 };
const contentType = { type: 'string', minLength: 1, maxLength: 240 };
const read = { readOnly: true, idempotent: true }, saved = { idempotent: true };
const external = { idempotent: true, openWorld: true };
export function labWorkspaceTools(tool) {
  return [
    tool('merchant_lab_status', 'Read the configured laboratory desks and current original customer/merchant ownership. Select a workspace to open and inspect its saved source, intake, checkout and result state.', selected, [], read),
    tool('merchant_lab_profiles', 'Read complete installed laboratory source-profile identities and their primary format references.', selected, ['workspace'], read),
    tool('merchant_lab_discover', 'Read the configured merchant’s original public intake catalogue once, retain its full bytes and return the selected laboratory function and source-bound catalogue reference.', selected, ['workspace'], read),
    tool('merchant_lab_request_create', 'Create or reopen one original SF88 intake request from its retained catalogue. Keep the same reference, input parameters and original catalogue SHA; file slots are selected afterward.', {
      ...selected, catalogRef: inputRef, expectedCatalogSha256: sha, reference: nativeId,
      parameters: { type: 'object' }, label: { type: 'string', maxLength: 300 },
    }, ['workspace', 'catalogRef', 'expectedCatalogSha256', 'reference', 'parameters'], saved),
    tool('merchant_lab_requests', 'Page original laboratory customer requests and retained task states.', { ...selected, ...page, q: text, phase: text }, ['workspace'], read),
    tool('merchant_lab_request', 'Read the complete original request, selected file descriptors, upload states, merchant source, current revision and original checkout.', request, ['workspace', 'requestId'], read),
    tool('merchant_lab_select', 'Select a complete transferred file in one of the five original laboratory slots, then finish its native local upload. Exact retries continue that original upload. The request must retain its current revision.', {
      ...request, slot: { type: 'string', enum: ['source', 'baseline', 'decisions', 'baseline_decisions', 'reconciliation'] },
      inputRef, expectedSha256: sha, expectedRevision: revision,
    }, ['workspace', 'requestId', 'slot', 'inputRef', 'expectedSha256', 'expectedRevision'], saved),
    tool('merchant_lab_remove', 'Remove one selected source or decision slot through the original request writer at its current revision.', {
      ...request, slot: { type: 'string', enum: ['source', 'baseline', 'decisions', 'baseline_decisions', 'reconciliation'] },
      expectedRevision: revision,
    }, ['workspace', 'requestId', 'slot', 'expectedRevision'], { destructive: true }),
    tool('merchant_lab_inspect', 'Read and verify every selected original source byte, then run the installed source profile. Returns the complete retained source review plus compact table and provenance metadata.', source, ['workspace', 'requestId'], read),
    tool('merchant_lab_rows', 'Page complete original physical rows without dropping blank values, duplicates, field names, qualifiers, units, limits or worksheet provenance. Follow nextOffset with the same source binding.', {
      ...source, ...page, side, section: text, field: text, q: text, recordId: id,
    }, ['workspace', 'requestId'], read),
    tool('merchant_lab_issues', 'Page the original source profile’s actionable findings with exact source row and field identities.', {
      ...source, ...page, side, severity: text, code: text, q: text,
    }, ['workspace', 'requestId'], read),
    tool('merchant_lab_groups', 'Page complete source-bound cross-profile correspondence groups, every ambiguous candidate and native field difference. Complete oversized pages are retained as downloadable files.', {
      ...source, ...page, status: text, kind: text, groupId: id, q: text,
    }, ['workspace', 'requestId'], read),
    tool('merchant_lab_preview', 'Compose current, baseline and correspondence decisions through the original laboratory models. Retains the complete before/after preview and original source bindings; source bytes remain intact.', preview, ['workspace', 'requestId'], read),
    tool('merchant_lab_table', 'Export the full current-field, baseline-field or correspondence review as an editable CSV or TSV. The file is complete and source-bound.', {
      ...preview, family, format: { type: 'string', enum: ['csv', 'tsv'] },
      scope: { type: 'string', enum: ['issues', 'all'] }, fields,
    }, ['workspace', 'requestId'], read),
    tool('merchant_lab_table_import', 'Import a complete edited field or correspondence table, validate its source binding and catalogue, and retain the exact normalized native decision document.', {
      ...source, family, inputRef,
    }, ['workspace', 'requestId', 'family', 'inputRef'], saved),
    tool('merchant_lab_review_save', 'Save one immutable complete laboratory review with full field/correspondence documents, both editable formats, offline editors and original job-ready decision files. Reuses the same review ID only for its exact preview.', {
      ...preview, reviewId: id, expectedPreviewSha256: sha,
    }, ['workspace', 'requestId', 'reviewId', 'expectedPreviewSha256'], saved),
    tool('merchant_lab_reviews', 'Page immutable original laboratory reviews and their complete source/preview identities.', {
      ...selected, ...page, requestId: sha,
    }, ['workspace'], read),
    tool('merchant_lab_review', 'Reopen one exact saved laboratory review and every retained native file descriptor.', {
      ...selected, reviewId: id,
    }, ['workspace', 'reviewId'], read),
    tool('merchant_lab_review_apply', 'Stage all saved native decision files into the SAME original request. The stable apply ID resumes an interrupted upload; each complete target must be SEALED before completion.', {
      ...request, applyId: id, reviewId: id, expectedReviewSha256: sha, expectedRevision: revision,
    }, ['workspace', 'requestId', 'applyId', 'reviewId', 'expectedReviewSha256', 'expectedRevision'], saved),
    tool('merchant_lab_intake', 'Start original prepare/import/withdraw, or stop/wait for that same retained task. Prepare uploads the sealed originals and imports the native checkout; it does not approve a payment.', {
      ...request, action: { type: 'string', enum: ['prepare', 'import', 'withdraw', 'stop', 'wait'] },
      expectedRevision: revision, reason, taskId: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['workspace', 'requestId', 'action'], external),
    tool('merchant_lab_access_refresh', 'Refresh the original request’s intake access token from its existing host-selected environment variable, preserving the current request revision and private token custody.', {
      ...request, expectedRevision: revision,
    }, ['workspace', 'requestId', 'expectedRevision'], saved),
    tool('merchant_lab_checkouts', 'Page the original SF88 checkouts, real review states, task IDs and accepted buyer entries.', {
      ...selected, ...page, phase: text, q: text,
    }, ['workspace'], read),
    tool('merchant_lab_checkout', 'Read the original checkout and its exact payment review or acceptance before execute, recovery or stop.', {
      ...selected, checkoutId: sha,
    }, ['workspace', 'checkoutId'], read),
    tool('merchant_lab_checkout_action', 'Run the original checkout review/execute/recover operation, or stop/wait for the same task. A previous payment attempt requires recover. Execute retains the original operator approval mechanism.', {
      ...selected, checkoutId: sha, action: { type: 'string', enum: ['review', 'execute', 'recover', 'stop', 'wait'] },
      expectedRevision: revision, taskId: { type: 'string', maxLength: 128 },
    }, ['workspace', 'checkoutId', 'action'], { openWorld: true }),
    tool('merchant_lab_approval', 'Read the real original operator approval request for this active checkout; includes its exact request hash, intent and task identity.', {
      ...selected, checkoutId: sha,
    }, ['workspace', 'checkoutId'], read),
    tool('merchant_lab_approval_decide', 'Record an explicit approve or reject decision on the exact active original checkout approval. Host configuration must already select original operator approval mode.', {
      ...selected, checkoutId: sha, intent: { type: 'string', minLength: 1, maxLength: 256 },
      approvalId: { type: 'string', minLength: 1, maxLength: 256 }, requestSha256: sha,
      decision: { type: 'string', enum: ['approve', 'reject'] }, taskId: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['workspace', 'checkoutId', 'intent', 'approvalId', 'requestSha256', 'decision', 'taskId'], { openWorld: true }),
    tool('merchant_lab_customers', 'Page original accepted customer jobs and their retained result-library identities.', {
      ...selected, ...page, q: text, state: text, view: { type: 'string', enum: ['active', 'archived', 'all'] },
    }, ['workspace'], read),
    tool('merchant_lab_customer', 'Read one original accepted buyer entry, job state, current native task and retained result identity.', {
      ...selected, entryId: sha,
    }, ['workspace', 'entryId'], read),
    tool('merchant_lab_customer_action', 'Refresh, watch, or receive the COMPLETE original customer result, or stop/wait for the same retained task. The accepted buyer and payment identity stay unchanged.', {
      ...selected, entryId: sha, action: { type: 'string', enum: ['refresh', 'watch', 'fetch', 'stop', 'wait'] },
      deadlineMs: { type: 'integer', minimum: 100, maximum: 3600000 },
      pollMs: { type: 'integer', minimum: 100, maximum: 30000 }, taskId: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['workspace', 'entryId', 'action'], external),
    tool('merchant_lab_merchant_status', 'Read the SAME configured original paid-job merchant, function policies, native source, worker and queue state.', selected, ['workspace'], read),
    tool('merchant_lab_merchant_job', 'Read one complete job from the original paid-job merchant and preserve its exact current revision.', {
      ...selected, jobId: nativeId,
    }, ['workspace', 'jobId'], read),
    tool('merchant_lab_job_action', 'Cancel or retry the same original retained job at its current revision and explicit reason. Uses the original payment, native file inputs and worker.', {
      ...selected, jobId: nativeId, action: { type: 'string', enum: ['cancel', 'retry'] },
      expectedRevision: { type: 'integer', minimum: 1 }, reason,
    }, ['workspace', 'jobId', 'action', 'expectedRevision', 'reason'], { destructive: true, openWorld: true }),
    tool('merchant_lab_worker', 'Start or drain the configured merchant’s ORIGINAL worker while preserving its existing Applications and merchant lifetime.', {
      ...selected, action: { type: 'string', enum: ['start', 'stop'] },
    }, ['workspace', 'action'], { destructive: true, openWorld: true }),
    tool('merchant_lab_result_open', 'Verify a complete original Lab result from the customer resource library or an uploaded result ZIP, then retain its full source/native-output/correspondence graph for reopening.', {
      ...selected, inputRef, resourceId: sha, expectedSha256: sha,
    }, ['workspace', 'expectedSha256'], saved),
    tool('merchant_lab_result', 'Reopen the complete result manifest and page original members, or receive one exact member with its full bytes and SHA256.', {
      ...selected, ...page, resultId: sha, member: { type: 'string', minLength: 1, maxLength: 2048 },
    }, ['workspace', 'resultId'], read),
    tool('merchant_lab_files', 'Page full retained laboratory input, review, editor and native-result file descriptors. Keep expectedSnapshot while continuing a file catalogue.', {
      ...selected, ...page, expectedSnapshot: sha,
    }, ['workspace'], read),
    tool('merchant_lab_file_read', 'Read an exact bounded chunk of a complete retained file. Keep its original SHA and read ID, then release the original held reader when finished.', {
      ...selected, fileId: sha, expectedSha256: sha, readId,
      offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 65536 },
    }, ['workspace', 'fileId', 'expectedSha256'], read),
    tool('merchant_lab_file_release', 'Release this original retained file reader after complete download or an interrupted transfer.', {
      ...selected, fileId: sha, readId,
    }, ['workspace', 'fileId', 'readId'], saved),
    tool('merchant_lab_input_begin', 'Begin or reopen one complete laboratory input transfer using its stable input ID, exact filename, byte length and SHA256.', {
      ...selected, inputId: alias, name: filename, contentType, bytes: { type: 'integer', minimum: 0, maximum: 134217728 }, sha256: sha,
    }, ['workspace', 'inputId', 'name', 'contentType', 'bytes', 'sha256'], saved),
    tool('merchant_lab_input_status', 'Read the same retained input transfer’s committed offset and complete file identity.', {
      ...selected, inputId: alias,
    }, ['workspace', 'inputId'], read),
    tool('merchant_lab_input_append', 'Append or reopen the exact next original input chunk at its saved offset. Each chunk is at most 65,536 decoded bytes.', {
      ...selected, inputId: alias, sha256: sha, offset: { type: 'integer', minimum: 0 },
      dataBase64: { type: 'string', minLength: 4, maxLength: 87384 },
    }, ['workspace', 'inputId', 'sha256', 'offset', 'dataBase64'], saved),
    tool('merchant_lab_input_finish', 'Verify and publish the same complete input transfer. Its input reference can be selected into an original source/decision slot or imported as an editable table.', {
      ...selected, inputId: alias, sha256: sha,
    }, ['workspace', 'inputId', 'sha256'], saved),
  ];
}
