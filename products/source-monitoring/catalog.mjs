// MIT. Closed customer-agent interface over the original MonitoringClient.
// Native contract: PR1918 / 7b142022a315055123bd01072c9465818d3080fc.
// The original workspace, matching service and review writers remain authoritative.
export const MONITORING_CATALOG_SCHEMA = 'stellar-forge.merchant-monitoring-tools.v1';
export const MAX_MONITORING_JSON_BYTES = 24 * 1024 * 1024;
export const MAX_MONITORING_OBJECT_BYTES = 256 * 1024 * 1024;
export const MAX_MONITORING_ARCHIVE_BYTES = 4 * MAX_MONITORING_OBJECT_BYTES;
export const MAX_MONITORING_CHUNK_BYTES = 196608;

const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const text = (description, maximum = 4096, minimum = 1) =>
  ({ type: 'string', minLength: minimum, maxLength: maximum, description });
const alias = description => ({ ...text(description, 64), pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' });
const sha = description => ({ ...text(description, 64), pattern: '^[a-f0-9]{64}$' });
const uuid = description => ({ ...text(description, 36), pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' });
const integer = (description, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  ({ type: 'integer', minimum, maximum, description });
const object = (properties = {}, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const choice = (values, description) => ({ type: 'string', enum: values, description });
const scope = object({
  workspace: alias('Configured original monitoring workspace alias.'),
  expectedWorkspace: { ...text('Exact absolute original physical workspace directory; portable identities do not select a branch.'), pattern: '^/' },
  expectedBindingSha256: sha('Actual original launch binding SHA-256 for this reviewed source and workspace.'),
});
const pagination = (maximum = Number.MAX_SAFE_INTEGER) => ({
  offset: integer('Original page offset; continue the actual returned pagination.', 0, maximum),
  limit: integer('Complete native rows per page.', 1, 250),
});
const id = () => sha('Exact retained native SHA-256 identity.');
const eventId = maximum => text('Exact original native request ID. Portfolio refresh IDs may be prefixed strings, not UUIDs.', maximum);
const page = (properties, required, maximum) => object({ ...properties, ...pagination(maximum) }, required);

export const MONITORING_READ_PARAMETERS = freeze({
  state: object(),
  contract: object(),
  entity: object({ scope: id(), id: text('Original entity identifier, preserving its source spelling.', 512) }),
  entities: page({ scope: id() }, ['scope'], 1000000),
  aliases: object({ scope: id(), id: text('Original entity identifier.', 512) }),
  changes: object({ comparison: id(), ...pagination(10000000),
    kind: text('Exact native change kind; supplied kind takes precedence over material filtering.', 80),
    material: { type: 'boolean', description: 'When kind is absent, exclude observation-only changes.' } }, ['comparison']),
  impacts: object({ comparison: id() }),
  case: object({ id: id() }),
  statements: object({ set: id(), entity: text('Optional exact entity or canonical identifier.', 4096), ...pagination(10000000) }, ['set']),
  response: object({ id: id() }),
  request: object({ id: id() }),
  'update-plan': object({ before: id(), after: id(), index: id() }),
  cycles: object(),
  cycle: object({ id: id() }),
  'cycle-request': object({ id: uuid('Original saved review-cycle command UUID.') }),
  'cycle-report': object({ id: id(), version: integer('Original selected historical cycle version.', 1) }),
  'gleif-intake': object({ requestId: eventId(128) }),
  'review-exchanges': page({}, []),
  'review-exchange': page({ id: id() }, ['id']),
  'review-exchange-request': object({ requestId: uuid('Original reviewer-exchange command UUID.') }),
  'review-exchange-compare': object({ returnId: id(), editionId: uuid('Actual named returned edition.'),
    adoptionRequestId: uuid('Optional original committed adoption UUID; selects its read-only historical comparison.') },
    ['returnId', 'editionId']),
  'portfolio-cycle-reviews': object({ comparisonId: id() }),
  'portfolio-refreshes': object(),
  'portfolio-refresh': object({ id: id(), ...pagination(1000000),
    kind: choice(['', 'added', 'removed', 'changed', 'unchanged'], 'Selected original portfolio-change kind.'),
    query: text('Native case-insensitive entity/caption search.', 512, 0) }, ['id']),
  'portfolio-refresh-request': object({ requestId: eventId(160) }),
  'portfolio-refresh-report': object({ id: id() }),
});
export const MONITORING_GET_OPERATIONS = Object.freeze(Object.keys(MONITORING_READ_PARAMETERS));
export const MONITORING_POST_OPERATIONS = Object.freeze([
  'published-edition', 'edition', 'portfolio', 'statement-set', 'compare', 'update',
  'review-exchange-issue', 'review-exchange-command', 'review-exchange-return-preview',
  'fetch-update', 'select-update', 'review', 'case', 'profile', 'prepare',
  'dispatch', 'receive-response', 'query', 'cycle-command', 'gleif-preview', 'gleif-receive',
  'portfolio-refresh-prepare', 'portfolio-refresh-command',
]);

const inputFile = object({
  alias: alias('Configured immutable input-file alias; not an arbitrary path.'),
  bytes: integer('Exact complete original UTF-8 JSON file byte count.', 2, MAX_MONITORING_JSON_BYTES),
  sha256: sha('Exact complete original JSON file SHA-256.'),
});
const nativeSelections = [
  object({ kind: { const: 'workspace', type: 'string' } }),
  ...['object', 'source'].map(kind => object({
    kind: { const: kind, type: 'string' },
    id: id(),
    bytes: integer('Optional reviewed complete source byte count.', 0, MAX_MONITORING_OBJECT_BYTES),
  }, ['kind', 'id'])),
  object({
    kind: { const: 'review-exchange', type: 'string' },
    id: id(),
    role: choice(['issued_json', 'issued_html', 'returned_file'], 'Original native reviewer document role.'),
    sha256: sha('Exact file SHA-256 from the selected native exchange descriptor.'),
    bytes: integer('Exact complete descriptor byte count.', 0, MAX_MONITORING_OBJECT_BYTES),
  }),
];
const retainedSelection = object({
  kind: { const: 'retained', type: 'string' },
  sha256: sha('Previously retained complete agent output SHA-256.'),
  bytes: integer('Previously retained exact complete output byte count.', 0, MAX_MONITORING_ARCHIVE_BYTES),
});
const nativeSelection = { oneOf: nativeSelections };
const readSelection = { oneOf: [...nativeSelections, retainedSelection] };

function specifications() {
  return [
    {
      name: 'merchant_monitoring_workspaces',
      description: 'List configured original Source Monitoring workspace aliases and exact reviewable scope. Does not create, start, import or stop a workspace.',
      properties: {}, required: [], options: { readOnly: true, idempotent: true },
    },
    {
      name: 'merchant_monitoring_inspect',
      description: 'Verify the selected original private loopback Applications connection and actual physical workspace/source binding. No credentials are returned.',
      properties: { scope }, required: ['scope'], options: { readOnly: true, idempotent: true },
    },
    {
      name: 'merchant_monitoring_read',
      description: 'Read one original native source, case, matching request, cycle, portfolio-refresh or reviewer-exchange operation. Closed route-specific query parameters. Retains complete original response bytes; follow native pages without inventing missing rows.',
      properties: { scope, operation: choice(MONITORING_GET_OPERATIONS, 'Exact original native GET operation.'),
        parameters: { type: 'object' } }, required: ['scope', 'operation', 'parameters'],
      constraints: { oneOf: MONITORING_GET_OPERATIONS.map(operation => ({
        properties: { operation: { const: operation }, parameters: MONITORING_READ_PARAMETERS[operation] },
        required: ['operation', 'parameters'],
      })) },
      options: { readOnly: true, idempotent: true },
    },
    {
      name: 'merchant_monitoring_command',
      description: 'Send one explicitly selected original native operation using complete original JSON text or one verified configured JSON file. Preserves numeric tokens and reviewed UUID/version fields. May acquire publisher data or dispatch matching. Never invent decisions, automatically retry uncertain effects, or replace native validation.',
      properties: { scope, operation: choice(MONITORING_POST_OPERATIONS, 'Exact original native POST operation; query uses the maintained /api/query route.'),
        jsonText: text('Complete original JSON object text, sent byte-for-byte. Actual UTF-8 size must be at most 24 MiB.', MAX_MONITORING_JSON_BYTES, 2),
        inputFile }, required: ['scope', 'operation'],
      constraints: { oneOf: [{ required: ['jsonText'] }, { required: ['inputFile'] }] },
      options: { readOnly: false, idempotent: false, openWorld: true },
    },
    {
      name: 'merchant_monitoring_upload',
      description: 'Receive one complete explicitly configured original file into the selected native object store after exact size/SHA verification. Retains the original name, media type and source URL; this does not accept an edition, portfolio, match response or reviewer decision.',
      properties: { scope, fileAlias: alias('Configured original file alias.'),
        bytes: integer('Exact complete input file size.', 0, MAX_MONITORING_OBJECT_BYTES),
        sha256: sha('Exact original input file SHA-256.'),
        name: text('Original filename retained by the native object writer.', 240),
        media: text('Original media type, without control characters.', 240),
        sourceUrl: text('Original public/source URL or empty; never include credentials.', 4096, 0) },
      required: ['scope', 'fileAlias', 'bytes', 'sha256'],
      options: { readOnly: false, idempotent: false },
    },
    {
      name: 'merchant_monitoring_receive_archive',
      description: 'Receive one complete verified configured workspace ZIP through the original native importer into the explicitly selected physical workspace. Preserves original native builds and source/case/cycle/exchange history. The native importer governs conflicts and replay.',
      properties: { scope, fileAlias: alias('Configured complete original workspace ZIP alias.'),
        bytes: integer('Exact full ZIP byte count.', 1, MAX_MONITORING_ARCHIVE_BYTES),
        sha256: sha('Exact complete original ZIP SHA-256.') },
      required: ['scope', 'fileAlias', 'bytes', 'sha256'],
      options: { readOnly: false, idempotent: false },
    },
    {
      name: 'merchant_monitoring_download',
      description: 'Acquire and retain one complete original workspace ZIP, native object/source, or issued/returned reviewer document. Returns an immutable complete descriptor. For continuation use file_read with kind retained plus that descriptor; do not regenerate a later workspace export to stand in for the original.',
      properties: { scope, selection: nativeSelection }, required: ['scope', 'selection'],
      options: { readOnly: true, idempotent: false },
    },
    {
      name: 'merchant_monitoring_file_read',
      description: 'Read a bounded range from a complete retained output or selected original native file. Prefer download then kind retained with exact SHA/bytes. Preserve readId and offset on interruption; every range belongs to the same complete file. A range is not a substitute for the full source.',
      properties: { scope, selection: readSelection,
        expectedSha256: sha('Optional full-file expected SHA; must agree with the selected immutable identity.'),
        readId: text('Original live retained-file read handle, when continuing the same file.', 200),
        offset: integer('Absolute original byte offset.', 0, MAX_MONITORING_ARCHIVE_BYTES),
        limit: integer('Maximum bytes in this returned range.', 1, MAX_MONITORING_CHUNK_BYTES) },
      required: ['scope', 'selection'], options: { readOnly: true, idempotent: true },
    },
    {
      name: 'merchant_monitoring_file_release',
      description: 'Release only the specified retained-file read handle. The durable complete source/output and native workspace remain available. Does not stop the original application or release another owner.',
      properties: { scope, readId: text('Exact retained-file read handle.', 200) },
      required: ['scope', 'readId'], options: { readOnly: true, idempotent: true },
    },
  ];
}
function inputSchema(spec) {
  return { ...object(clone(spec.properties), [...spec.required]), ...clone(spec.constraints ?? {}) };
}
/** Uses the maintained Merchant tool helper; does not register another dispatcher. */
export function monitoringTools(tool) {
  if (typeof tool !== 'function') throw new TypeError('Provide the maintained Merchant tool metadata helper.');
  return specifications().map(spec => {
    const output = tool(spec.name, spec.description, clone(spec.properties), [...spec.required], { ...spec.options });
    output.inputSchema = { ...output.inputSchema, ...inputSchema(spec) };
    return output;
  });
}
function fail(message) {
  const error = new TypeError(message);
  error.code = 'MONITORING_TOOL_ARGUMENTS';
  throw error;
}
function check(schema, value, at) {
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(at + ' must be an object.');
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(at + ' must be a plain JSON object.');
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail(at + ' must be text.');
    if (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength) fail(at + ' has an invalid text length.');
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) fail(at + ' does not match its original identity format.');
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) fail(at + ' must be an integer within the declared original bound.');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail(at + ' must be true or false.');
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) fail(at + ' selects a different operation.');
  if (schema.enum && !schema.enum.includes(value)) fail(at + ' must select one declared original value.');
  if (schema.required) for (const key of schema.required) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) fail(at + '.' + key + ' is required.');
  }
  if (schema.properties && value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(schema.properties, key)) check(schema.properties[key], value[key], at + '.' + key);
      else if (schema.additionalProperties === false) fail(at + '.' + key + ' is not part of this original operation.');
    }
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const candidate of schema.oneOf) {
      try { check(candidate, value, at); matches += 1; }
      catch (error) { if (error.code !== 'MONITORING_TOOL_ARGUMENTS') throw error; }
    }
    if (matches !== 1) fail(at + ' must match exactly one declared operation/selection shape.');
  }
}
/**
 * Call synchronously on the runtime's already copied JSON arguments, before any
 * await or native effect. This verifies the closed tool boundary, not business
 * decisions: the original domain remains the only source of those rules.
 */
export function validateMonitoringArguments(name, args) {
  const spec = specifications().find(item => item.name === name);
  if (!spec) fail('Choose a declared merchant_monitoring_ tool.');
  check(inputSchema(spec), args, name);
  if (args.scope) for (const [key, value] of Object.entries(args.scope)) {
    if (/[\u0000-\u001f\u007f]/.test(value)) fail('scope.' + key + ' must not contain control characters.');
  }
  if (args.parameters) for (const [key, value] of Object.entries(args.parameters)) {
    if (typeof value === 'string' && /[\u0000-\u001f\u007f]/.test(value)) fail('parameters.' + key + ' must not contain control characters.');
  }
  for (const key of ['fileAlias', 'name', 'media', 'sourceUrl', 'readId']) {
    if (typeof args[key] === 'string' && /[\u0000-\u001f\u007f]/.test(args[key])) fail(key + ' must not contain control characters.');
  }
  if (args.inputFile && /[\u0000-\u001f\u007f]/.test(args.inputFile.alias)) fail('inputFile.alias must not contain control characters.');
  if (Object.prototype.hasOwnProperty.call(args, 'jsonText')) {
    if (new TextEncoder().encode(args.jsonText).length > MAX_MONITORING_JSON_BYTES) fail('The complete original JSON request exceeds 24 MiB.');
    let parsed;
    try { parsed = JSON.parse(args.jsonText); } catch { fail('jsonText must be one complete original JSON object.'); }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('jsonText must be one complete original JSON object.');
    // Do not stringify this parsed value: large original numeric tokens must
    // remain in the immutable original jsonText sent by MonitoringClient.
  }
  const selected = args.selection;
  if (selected) {
    const selectedSha = selected.kind === 'object' || selected.kind === 'source' ? selected.id : selected.sha256;
    if (args.expectedSha256 !== undefined && selectedSha !== undefined && args.expectedSha256 !== selectedSha) fail('expectedSha256 differs from the selected complete original file.');
    if (selected.bytes !== undefined && args.offset !== undefined && args.offset > selected.bytes) fail('The selected range begins beyond the complete file.');
  }
  return args;
}
