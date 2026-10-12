// MIT. Source-owned tool metadata for the original Snowflake workspace.
const alias = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const uuid = { type: 'string', pattern: '^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$' };
const object = { type: 'object', additionalProperties: true };
const text = { type: 'string' };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };
const workspace = { workspace: alias };
const edition = { ...workspace, editionId: hash };
const operation = { ...workspace, operationId: uuid };
const publication = { ...workspace, publicationId: uuid };
const transfer = { ...workspace, transferId: hash };
const read = { readOnlyHint: true, idempotentHint: true };
const change = { readOnlyHint: false };
const repeat = { readOnlyHint: false, idempotentHint: true };
export const SNOWFLAKE_TOOL_PREFIX = 'merchant_snowflake_';
export function snowflakeMerchantTools(tool) {
  const t = (name, description, properties, required = [], annotations = read) =>
    tool(SNOWFLAKE_TOOL_PREFIX + name, description, properties, required, annotations);
  return [
    t('workspaces', 'List the host-declared original Snowflake workspaces and their live process instances.', {}, []),
    t('open', 'Open or reuse the original Snowflake browser and workspace writer for this configured alias.', workspace, ['workspace'], repeat),
    t('state', 'Read the original workspace UUID, revision, selected source, active captures and publication state.', workspace, ['workspace']),
    t('sources', 'Read one complete original source-history page; follow nextOffset.', { ...workspace, ...page }, ['workspace']),
    t('source', 'Read one original Snowflake source declaration and its immutable source ID.', { ...workspace, sourceId: hash }, ['workspace','sourceId']),
    t('save_source', 'Save a complete native Snowflake source declaration against the current workspace revision.', {
      ...workspace, config: object, expectedRevision: { type: 'integer', minimum: 0 }
    }, ['workspace','config','expectedRevision'], change),
    t('operations', 'Read original capture and receiving operations in native history order; follow nextOffset.', { ...workspace, ...page }, ['workspace']),
    t('operation', 'Read the exact original request, statement handle, partition coverage and retry state.', operation, ['workspace','operationId']),
    t('observations', 'Read all original SQL API observations through the native paginated journal.', { ...operation, ...page }, ['workspace','operationId']),
    t('capture', 'Start the saved named query with its original caller-selected request UUID. Retain this ID for continuation.', {
      ...workspace, sourceId: hash, queryName: text, arguments: object, requestId: uuid
    }, ['workspace','queryName','requestId'], repeat),
    t('resume', 'Continue the same saved request, body and statement handle through the original SQL API engine.', operation, ['workspace','operationId'], repeat),
    t('cancel', 'Cancel the actual original running capture and retain its provider outcome.', operation, ['workspace','operationId'], repeat),
    t('editions', 'Read the complete native edition inventory page by page.', { ...workspace, ...page }, ['workspace']),
    t('edition', 'Inspect the original immutable edition, native partition descriptors and current review.', edition, ['workspace','editionId']),
    t('rows', 'Read exact retained SQL values and JSON nulls from one native SQLite edition; follow nextOffset.', { ...edition, ...page }, ['workspace','editionId']),
    t('compare', 'Compare complete original keyed editions and return exact counts with a selected change sample.', {
      ...workspace, beforeId: hash, afterId: hash, sampleLimit: { type: 'integer', minimum: 1, maximum: 200 }
    }, ['workspace','beforeId','afterId']),
    t('review', 'Save the actual operator decision and reason for this exact retained edition.', {
      ...edition, decision: { enum: ['ACCEPTED','REJECTED'] }, actor: { type: 'string', minLength: 1, maxLength: 128 },
      note: { type: 'string', minLength: 1, maxLength: 4096 }, comparisonId: hash
    }, ['workspace','editionId','decision','actor','note'], change),
    t('receive_begin', 'Create or reopen the original receiving record from the complete Snowflake receiving.json manifest.', {
      ...workspace, manifest: object
    }, ['workspace','manifest'], repeat),
    t('receive_status', 'Inspect original partition coverage and the exact receivedBytes cursor for every partition.', transfer, ['workspace','transferId']),
    t('receive_chunk', 'Append or replay one exact original partition chunk. The durable cursor and whole-partition hash remain with the native receiving record.', {
      ...transfer, partition: { type: 'integer', minimum: 0, maximum: 19999 }, offset: { type: 'integer', minimum: 0 },
      data: { type: 'string', minLength: 4, maxLength: 262144 }, chunkSha256: hash
    }, ['workspace','transferId','partition','offset','data','chunkSha256'], repeat),
    t('receive_repair', 'Reset one incomplete partition in the original receiving record so its exact original bytes can be received again.', {
      ...transfer, partition: { type: 'integer', minimum: 0, maximum: 19999 }
    }, ['workspace','transferId','partition'], repeat),
    t('receive_commit', 'Verify complete original coverage and materialize its same immutable native SQLite edition.', transfer, ['workspace','transferId'], repeat),
    t('publications', 'Read the original saved merchant publication history; follow nextOffset.', { ...workspace, ...page }, ['workspace']),
    t('publication', 'Reopen the saved original merchant terms, request, release and native snapshot identity.', publication, ['workspace','publicationId']),
    t('prepare', 'Prepare the accepted edition through the original SQLite workbench and SF82 release engine, retaining this publication UUID.', {
      ...edition, publicationId: uuid, draft: object, runtime: object, label: { type: 'string', maxLength: 256 }
    }, ['workspace','editionId','publicationId','draft'], repeat),
    t('resume_publication', 'Continue the exact saved publication and original merchant terms.', publication, ['workspace','publicationId'], repeat),
    t('release_console', 'Open or reuse the original native SF82 release, customer and receiving console.', workspace, ['workspace'], repeat),
    t('export', 'Retain a complete original-file delivery: receiving manifest, edition, review, exact native partitions and selected merchant files/snapshot.', {
      ...edition, exportId: alias, publicationId: uuid, cloudDelivery: object
    }, ['workspace','editionId','exportId'], repeat),
    t('exports', 'List this host’s complete retained Snowflake file deliveries with original selection and manifest identity.', { workspace: alias, ...page }),
    t('manifest', 'Inspect a retained complete-file manifest and its exact byte descriptor before downloading.', { exportId: alias }, ['exportId']),
    t('file', 'Read original retained bytes by manifest-selected filename, digest and offset. Continue until nextOffset is null.', {
      exportId: alias, file: text, expectedManifestSha256: hash, expectedSha256: hash, readId: uuid,
      offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 196608 }
    }, ['exportId','file','expectedManifestSha256']),
    t('file_release', 'Release one original native read handle after a completed or interrupted file transfer.', { exportId: alias, readId: uuid }, ['exportId','readId'], repeat),
    t('close', 'Close the selected native Snowflake process after its accepted calls drain, preserving the original saved workspace and publications.', {
      ...workspace, instanceId: uuid
    }, ['workspace','instanceId'], repeat),
  ];
}
export const snowflakeActions = Object.freeze(Object.fromEntries(snowflakeMerchantTools(
  (name, description, properties, required, annotations) => ({
    name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations
  })).map(value => [value.name.slice(SNOWFLAKE_TOOL_PREFIX.length), value])));


/** Both direct clients and the native provider use the declared argument contract. */
export function snowflakeAction(action, args = {}) {
  const short = typeof action === 'string' && action.startsWith(SNOWFLAKE_TOOL_PREFIX)
    ? action.slice(SNOWFLAKE_TOOL_PREFIX.length) : action;
  const definition = typeof short === 'string' && Object.hasOwn(snowflakeActions, short) ? snowflakeActions[short] : null;
  const invalid = message => Object.assign(new TypeError(message), { code: 'SNOWFLAKE_INVALID_PARAMS' });
  if (!definition) throw invalid('Choose an advertised Snowflake action.');
  const schema = definition.inputSchema;
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !Object.hasOwn(schema.properties, key)) ||
      schema.required.some(key => args[key] === undefined)) throw invalid('Supply the declared fields and every required argument.');
  for (const [name, value] of Object.entries(args)) {
    if (value === undefined) throw invalid(name + ' must be omitted or have its declared value.');
    const rule = schema.properties[name];
    if (rule.type === 'string' && (typeof value !== 'string' ||
        rule.minLength !== undefined && value.length < rule.minLength ||
        rule.maxLength !== undefined && value.length > rule.maxLength ||
        rule.pattern !== undefined && !(new RegExp(rule.pattern)).test(value)) ||
        rule.type === 'integer' && (!Number.isSafeInteger(value) ||
        rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum) ||
        rule.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value)) ||
        rule.enum && !rule.enum.includes(value)) throw invalid('Invalid ' + name + ' for ' + short + '.');
  }
  return { action: short, definition, args };
}
