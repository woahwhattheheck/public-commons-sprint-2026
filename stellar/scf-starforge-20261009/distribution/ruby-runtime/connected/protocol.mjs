// MIT. Shared contracts for the installed Ruby client and MCP front door.
export const CLIENT_SCHEMA = 'stellar-forge.ruby-connected-client.v1';
export const RESULT_SCHEMA = 'stellar-forge.ruby-tool-result.v1';
export const MAX_CHUNK_BYTES = 1024 * 1024;
export const MAX_INLINE_BYTES = 768 * 1024;
export const MAX_RESULT_BYTES = 128 * 1024 * 1024;

const text = (description, extra = {}) => ({ type: 'string', description, ...extra });
const identifier = text('The original saved ID.', { pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' });
const uuid = text('The original UUID. Retain it before calling and reuse it after a lost response.', {
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
});
const reviewUuid = text('The original lowercase version-4 review UUID. Retain this exact review across preparation, approval and receiving.', {
  pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
});
const editionActor = text('The actual application operator identity recorded by the original native review and receipt; at most 512 UTF-8 bytes.', {
  minLength: 1, maxLength: 512, pattern: '\\S',
});
const sha256 = text('Complete original bytes, lowercase SHA-256.', { pattern: '^[a-f0-9]{64}$' });
const path = text('Absolute path on the machine running this Ruby workspace.', { minLength: 1, maxLength: 4096 });
const title = text('Customer-facing title.', { minLength: 1, maxLength: 160 });
const bundler = text('Exact installed or selected Bundler version.', {
  pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$',
});
const integer = (description, minimum, maximum) => ({ type: 'integer', description, minimum, maximum });
const member = text('Complete relative filename from the saved result descriptor.', { minLength: 1, maxLength: 4096 });
const choice = (description, values) => text(description, { enum: values });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const originalOperation = object({ operationId: uuid }, ['operationId']);
const originalApplication = object({ id: identifier }, ['id']);
const workingCapture = object({ reviewId: reviewUuid, captureId: reviewUuid,
  expectedCaptureSha256: sha256 }, ['reviewId', 'captureId', 'expectedCaptureSha256']);
const customerSelection = object({ id: identifier, expectedSelectionSha256: sha256 }, ['id', 'expectedSelectionSha256']);
const customerControl = object({
  id: identifier, expectedSelectionSha256: sha256,
  phase: choice('The existing customer or registration operation.', ['customer', 'registration']),
}, ['id', 'expectedSelectionSha256', 'phase']);
const transferSource = {
  oneOf: [
    object({ kind: { const: 'operation' }, operationId: uuid, name: member }, ['kind', 'operationId', 'name']),
    object({ kind: { const: 'customer' }, id: identifier, name: member }, ['kind', 'id', 'name']),
    object({ kind: { const: 'edition' }, id: identifier, editionId: identifier,
      reviewId: reviewUuid, name: member }, ['kind', 'id', 'editionId', 'name']),
  ],
};
const upload = object({
  operationId: uuid, id: identifier, title, ruby: path, bundlerVersion: bundler,
  expectedSha256: sha256,
  bytes: integer('The full original TAR length in bytes.', 1, 4 * 1024 * 1024 * 1024),
}, ['operationId', 'id', 'title', 'ruby', 'expectedSha256', 'bytes']);
const rows = [];
function define(method, suffix, description, inputSchema, readOnly = false, openWorld = false) {
  rows.push({
    method, name: 'ruby_' + suffix, description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly,
      idempotentHint: true, openWorldHint: openWorld },
  });
}
define('inspect', 'runtime_inspect',
  'Read the complete saved Ruby workspace, exact environment selections, applications and original operations. Large results are retained as complete readable files.',
  object({}), true);
define('probe', 'runtime_probe',
  'Inspect an absolute Ruby executable and its installed Bundler versions on this host.',
  object({ ruby: path, bundlerVersion: bundler }, ['ruby']), true);
define('create', 'runtime_create_environment',
  'Retain a private Ruby/Bundler environment and full original project and client source under a saved ID. Reuse its original request UUID.',
  object({ id: identifier, title, ruby: path, bundlerVersion: bundler, projectDirectory: path,
    gemfile: member, requestId: uuid }, ['id', 'title', 'ruby', 'bundlerVersion', 'requestId']), false, true);
define('start', 'runtime_start_operation',
  'Start the selected install, verify or whole TAR export operation and return its saved status immediately. A selected workingCapture verifies the complete saved working dataset and carries legitimate application edits with original editions and files. Stop the original application listener before export or verification.',
  object({ id: identifier, operationId: uuid,
    action: choice('Native operation.', ['install', 'verify', 'export']),
    offline: { type: 'boolean' }, applicationId: identifier, workingCapture },
  ['id', 'operationId', 'action']), false, true);
define('run', 'runtime_run_customer_program',
  'Run an installed original customer lifecycle or complete record program in its selected environment. The original entry and literal argv are retained. The record lifecycle uses the existing managed application and its saved working dataset.',
  object({ id: identifier, operationId: uuid,
    entry: choice('Installed original lifecycle entry.', ['native-dataset-lifecycle','baserow-customer-lifecycle','dataset-records','dataset-records-lifecycle','dataset-source','dataset-mapping-lifecycle']),
    argv: { type: 'array', maxItems: 512, items: text('Original literal argument.', { maxLength: 65536 }) } },
  ['id', 'operationId', 'entry']), false, true);
define('resume', 'runtime_resume_operation',
  'Resume the same saved operation and original arguments after interruption or a corrected failure. A running or completed operation is reused.',
  originalOperation, false, true);
define('cancel', 'runtime_cancel_operation',
  'Request cancellation of the original operation, including its owned native child processes. Read that operation until its worker has stopped.',
  originalOperation);
define('operation', 'runtime_get_operation',
  'Read the original native operation, current worker state, result, exit and complete output descriptors.',
  originalOperation, true);
define('log', 'runtime_read_log',
  'Read original worker log bytes by offset. Continue at nextOffset to obtain the whole log.',
  object({ operationId: uuid, offset: integer('Starting byte offset.', 0, Number.MAX_SAFE_INTEGER),
    limit: integer('Bytes per response.', 1, MAX_CHUNK_BYTES) }, ['operationId']), true);
define('application', 'runtime_get_application',
  'Read a registered application, exact original source selection and current listener operation.',
  originalApplication, true);
define('registerApplication', 'runtime_register_application',
  'Receive a complete original native or Baserow Rails customer output into the selected environment, preserving its database, history and files.',
  object({ id: identifier, title, environmentId: identifier, directory: path, requestId: uuid },
    ['id', 'title', 'environmentId', 'directory', 'requestId']));
define('launchApplication', 'runtime_launch_application',
  'Launch the saved Rails application on the requested loopback port using its original managed environment. Returns the original serve operation; poll it for the actual HTTP startup.',
  object({ id: identifier, operationId: uuid, port: integer('Loopback Rails port.', 1, 65535),
    expectedApplicationSha256: sha256, expectedEnvironmentSelectionSha256: sha256 },
    ['id', 'operationId']));
define('stopApplication', 'runtime_stop_application',
  'Stop the current original Rails listener and inspect its saved serve operation until the native worker exits.',
  originalApplication);
define('receive', 'runtime_receive_archive',
  'Receive a complete original runtime TAR already present at an absolute host path. Verify its whole SHA and selected Ruby ABI, restore its private bundle offline, and preserve the same receiving operation.',
  object({ id: identifier, title, ruby: path, bundlerVersion: bundler, archive: path,
    expectedSha256: sha256, operationId: uuid },
    ['id', 'title', 'ruby', 'archive', 'expectedSha256', 'operationId']));
define('previewSource', 'customer_preview_source',
  'Inspect the complete original finalized native room or Baserow source. Use its returned source digest when retaining a customer selection.',
  object({ kind: choice('Original customer source.', ['native', 'baserow']), directory: path,
    expectedSha256: sha256 }, ['kind', 'directory']), true);
define('previewExisting', 'customer_preview_existing',
  'Inspect an existing original customer output and its exact lifecycle input. Use the returned input digest when adopting that saved output.',
  object({ directory: path }, ['directory']), true);
define('customers', 'customer_list',
  'List saved customer selections and original lifecycle/application status.',
  object({ offset: integer('First saved customer.', 0, Number.MAX_SAFE_INTEGER),
    limit: integer('Customers per response.', 1, 100) }), true);
define('customer', 'customer_get',
  'Read one complete retained customer selection, its original command, operations and receiving application.',
  originalApplication, true);
define('selectCustomer', 'customer_select',
  'Retain the complete customer application request against reviewed original source bytes, existing managed environment and original executable paths. Keep all selected IDs for later advance, resume and receiving.',
  object({ id: identifier, title, requestId: uuid, environmentId: identifier,
    kind: choice('Original customer source.', ['native', 'baserow']),
    sourceDirectory: path, expectedSourceSha256: sha256, outputDirectory: path,
    checkout: path, python: path, node: path,
    datasetId: text('The original dataset ID.', { pattern: '^[A-Za-z0-9._:-]{1,128}$' }),
    sourceKey: text('Original native source key.', { pattern: '^[A-Za-z0-9._:-]{1,128}$' }),
    keys: { type: 'array', minItems: 0, maxItems: 64, items: text('Original primary-key field; an empty array uses the original semantic key.', { pattern: '^[A-Za-z][A-Za-z0-9_]{0,47}$' }) },
    customerKey: text('Original Baserow customer key.', { pattern: '^[A-Za-z0-9._:-]{1,128}$' }),
    sourceRef: text('Original Baserow checkout commit SHA.', { pattern: '^[a-f0-9]{40}$' }),
    query: text('Original fixed customer query.', { maxLength: 65536 }),
    applicationId: identifier, operationId: uuid, registrationId: uuid },
  ['id', 'title', 'requestId', 'environmentId', 'kind', 'sourceDirectory',
    'expectedSourceSha256', 'outputDirectory', 'checkout', 'python', 'node', 'datasetId']));
define('adoptCustomer', 'customer_adopt',
  'Adopt a reviewed existing original lifecycle input/output, finding its exact retained native operation and using the same customer and application IDs.',
  object({ id: identifier, title, requestId: uuid, environmentId: identifier, outputDirectory: path,
    expectedInputSha256: sha256, applicationId: identifier, operationId: uuid, registrationId: uuid },
  ['id', 'title', 'requestId', 'environmentId', 'outputDirectory', 'expectedInputSha256']));
define('advanceCustomer', 'customer_advance',
  'Continue the same saved customer: start or read its original lifecycle, then register its complete actual output when that original operation succeeds.',
  customerSelection, false, true);
define('resumeCustomer', 'customer_resume',
  'Resume the selected original customer or registration operation using its retained selection and exact original arguments.',
  customerControl, false, true);
define('cancelCustomer', 'customer_cancel',
  'Cancel the selected original customer or registration operation and keep the saved customer available for inspection and resumption.',
  customerControl);
define('previewApplicationEditionSource', 'application_edition_preview_source',
  'Inspect the completed native or Baserow dataset packet selected for an existing Rails application. Retain its exact manifest SHA for staging the complete original source.',
  object({ format: choice('Completed Ruby packet format.', ['native', 'baserow']), directory: path,
    expectedManifestSha256: sha256 }, ['format', 'directory']), true);
define('stageApplicationEdition', 'application_edition_stage',
  'Receive the complete selected dataset edition into the stopped original managed application and prepare its original full Rails change review. Preserve application, edition, review, actor and operation IDs when continuing.',
  object({ id: identifier, editionId: identifier, title,
    format: choice('Completed Ruby packet format.', ['native', 'baserow']), directory: path,
    expectedManifestSha256: sha256, reviewId: reviewUuid, operationId: uuid, actor: editionActor },
    ['id', 'editionId', 'title', 'format', 'directory', 'expectedManifestSha256', 'reviewId', 'operationId', 'actor']));
define('prepareApplicationEdition', 'application_edition_prepare',
  'Prepare a full original change preview for a retained application data edition. Use a new retained review UUID to review against a later working revision; reuse the same UUID to recover its original request.',
  object({ id: identifier, editionId: identifier, reviewId: reviewUuid, operationId: uuid, actor: editionActor },
    ['id', 'editionId', 'reviewId', 'operationId', 'actor']));
define('commitApplicationEdition', 'application_edition_commit',
  'Approve the exact selected preview SHA and commit every mapped row and original receipt through the existing Rails stream transaction. The same saved operation recovers the original committed edition.',
  object({ id: identifier, editionId: identifier, reviewId: reviewUuid,
    expectedPreviewSha256: sha256, operationId: uuid, actor: editionActor },
    ['id', 'editionId', 'reviewId', 'expectedPreviewSha256', 'operationId', 'actor']));
define('applicationEditions', 'application_edition_list',
  'List original retained data editions, complete review and operation status, and saved file descriptors for one application. Follow nextOffset for all editions.',
  object({ id: identifier, offset: integer('First saved data edition.', 0, Number.MAX_SAFE_INTEGER),
    limit: integer('Data editions per response.', 1, 100) }, ['id']), true);
define('applicationEdition', 'application_edition_get',
  'Read the exact source selection, full original reviews and committed receipts, operations and complete-file descriptors for a retained application data edition.',
  object({ id: identifier, editionId: identifier }, ['id', 'editionId']), true);
define('openTransfer', 'file_open',
  'Open the complete verified original operation, customer result or retained application data-edition file. Retain transferId before calling; the same selected file can be reopened after reconnecting.',
  object({ transferId: uuid, source: transferSource, expectedSha256: sha256 }, ['transferId', 'source']), true);
define('transfer', 'file_status',
  'Read the retained complete-file selection and whether this process currently owns an open immutable snapshot.',
  object({ transferId: uuid }, ['transferId']), true);
define('readTransfer', 'file_read',
  'Read complete original bytes as base64 by offset, up to 1 MiB per response. Check the per-chunk SHA and the full selected file SHA.',
  object({ transferId: uuid, offset: integer('Starting byte offset.', 0, Number.MAX_SAFE_INTEGER),
    limit: integer('Decoded bytes per response.', 1, MAX_CHUNK_BYTES) }, ['transferId', 'offset']), true);
define('closeTransfer', 'file_close',
  'Close this process\'s original file snapshot after all reads finish. The retained selection remains available to the same transfer ID.',
  object({ transferId: uuid }, ['transferId']), true);
define('prepareUpload', 'archive_prepare',
  'Retain a complete original runtime archive receiving request. The original operation UUID identifies both its transfer and native receiving job.',
  upload);
define('upload', 'archive_status',
  'Read the original selected archive, durable committed byte offset and actual receiving status after reconnecting.',
  originalOperation, true);
define('writeUpload', 'archive_write',
  'Append decoded original archive bytes at the durable offset, or acknowledge an identical already committed chunk after a lost response. Each chunk includes its actual SHA.',
  object({ operationId: uuid, offset: integer('Durable original byte offset.', 0, 4 * 1024 * 1024 * 1024),
    data: text('Canonical base64 for at most 1 MiB.', { minLength: 4, maxLength: 4 * Math.ceil(MAX_CHUNK_BYTES / 3) }),
    sha256 }, ['operationId', 'offset', 'data', 'sha256']));
define('finishUpload', 'archive_finish',
  'Verify the complete staged archive against its original selected length and SHA, then use the existing runtime receiving implementation and original operation UUID.',
  originalOperation);

export const RUBY_TOOLS = Object.freeze(rows.map(row => Object.freeze(row)));
const byMethod = new Map(RUBY_TOOLS.map(row => [row.method, row]));
const byName = new Map(RUBY_TOOLS.map(row => [row.name, row]));

export function connectedError(code, message, status = 400, details) {
  return Object.assign(new Error(message), { code, status, ...(details === undefined ? {} : { details }) });
}
export function need(value, code, message, status, details) {
  if (!value) throw connectedError(code, message, status, details);
}
function validObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function verify(schema, value, at) {
  const invalid = message => { throw connectedError('RUBY_CONNECTED_ARGUMENT', at + ': ' + message); };
  if (schema.oneOf) {
    let count = 0;
    for (const option of schema.oneOf) {
      try { verify(option, value, at); count++; } catch (error) { if (error.code !== 'RUBY_CONNECTED_ARGUMENT') throw error; }
    }
    if (count !== 1) invalid('select exactly one supported input shape');
    return;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) invalid('unexpected selection');
  if (schema.enum && !schema.enum.includes(value)) invalid('unsupported selection');
  if (schema.type === 'object') {
    if (!validObject(value)) invalid('an object is required');
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) invalid('missing ' + key);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) invalid('unknown field ' + key);
      verify(schema.properties[key], value[key], at + '.' + key);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) invalid('an array is required');
    if (schema.minItems !== undefined && value.length < schema.minItems ||
        schema.maxItems !== undefined && value.length > schema.maxItems) invalid('array length is outside the supported range');
    value.forEach((item, index) => verify(schema.items, item, at + '[' + index + ']'));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.includes('\0')) invalid('a NUL-free string is required');
    if (schema.minLength !== undefined && value.length < schema.minLength ||
        schema.maxLength !== undefined && value.length > schema.maxLength) invalid('string length is outside the supported range');
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) invalid('invalid format');
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) invalid('integer is outside the supported range');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') invalid('a boolean is required');
}
export function validateCall(method, input = {}) {
  const tool = byMethod.get(method);
  need(tool, 'RUBY_CONNECTED_METHOD', 'Unknown Ruby client method: ' + method, 404);
  verify(tool.inputSchema, input, method);
  if (method === 'start' && input.workingCapture !== undefined) {
    need(typeof input.applicationId === 'string' && ['verify', 'export'].includes(input.action),
      'RUBY_CONNECTED_ARGUMENT', 'start.workingCapture: select the original application for verify or export');
  }
  return tool;
}
export function toolForName(name) {
  const tool = byName.get(name);
  need(tool, 'RUBY_CONNECTED_TOOL', 'Unknown Ruby tool: ' + name, 404);
  return tool;
}
export function errorView(error) {
  return { code: typeof error?.code === 'string' ? error.code : 'RUBY_CONNECTED_FAILED',
    message: error?.message ?? String(error), status: Number.isInteger(error?.status) ? error.status : 500,
    ...(error?.details === undefined ? {} : { details: error.details }) };
}
