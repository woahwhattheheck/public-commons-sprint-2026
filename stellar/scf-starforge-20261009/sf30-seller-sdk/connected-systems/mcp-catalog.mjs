// MIT. Source-owned Connected Systems discovery, acquisition and native receiving tools.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const operation = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$' };
const label = { type: 'string', minLength: 1, maxLength: 160 };
const object = { type: 'object' };
const offset = { type: 'integer', minimum: 0, maximum: 100000000 };
const limit = { type: 'integer', minimum: 1, maximum: 250 };
const collection = { type: 'string', enum: ['sources','plans','builds','comparisons','connections','queries','documents','operations'] };
const resource = { type: 'string', minLength: 1, maxLength: 8192 };
const params = { type: 'array', maxItems: 128, items: { type: 'object', additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, maxLength: 128 }, value: { type: 'string', maxLength: 8192 } }, required: ['name','value'] } };
export const fileFields = { kind: { type: 'string', enum: ['source','document','comparison','packet','dataset'] },
  sourceId: sha, documentId: sha, comparisonId: sha, buildId: sha, member: { type: 'string', minLength: 1, maxLength: 200 } };
export function connectedSystemsTools(tool) {
  const call = (name, description, properties = {}, required = [], flags = {}) =>
    tool('merchant_csapi_' + name, description, { workspace: alias, ...properties }, ['workspace', ...required], flags);
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_csapi_workspaces', 'List the host-configured original Connected Systems operators and exact source/packet aliases.', {}, [], read),
    call('status', 'Read the actual original operator, retained counts, complete-list coverage and borrowed client ownership.', {}, [], read),
    call('records', 'Page an entire retained collection, including old response documents and operations. Continue from its exact view SHA256; restart at offset zero if the view changes.', { collection, offset, limit, expectedViewSha256: sha }, ['collection'], read),
    call('connection_save', 'Save the reviewed public endpoint, approved linked origins and optional host authorization environment-variable NAME. Never pass a credential value.', { connection: object }, ['connection'], { idempotent: true }),
    call('connection', 'Read the exact retained endpoint connection and its declared authentication source name.', { id: sha }, ['id'], read),
    call('browse', 'Retrieve and retain one actual landing, conformance, system, datastream, schema or collection response under this explicit operation ID. Preserve ordered query pairs and original next links.', { connectionId: sha, resource, params, operationId: operation }, ['connectionId','resource','operationId'], { idempotent: true, openWorld: true }),
    call('document', 'Inspect the exact retained provider response receipt and decoded content, including an actual HTTP error response.', { id: sha }, ['id'], read),
    call('query_save', 'Save the complete reviewed JSON observation query with explicit datastream/schema/observation URLs, ordered filters, page/row/byte limits and source-rights facts. Inspect the normalized saved query before acquisition.', { query: object }, ['query'], { idempotent: true }),
    call('query', 'Read the full original saved query and its exact normalized request URLs and limits.', { id: sha }, ['id'], read),
    call('acquire', 'Acquire or resume the same explicit operation and query. Retain every original response page, schema before/after, next cursor and actual provider failure. A page-capped source remains explicitly partial.', { queryId: sha, operationId: operation, label }, ['queryId','operationId'], { idempotent: true, openWorld: true }),
    call('operation', 'Read the original request, exact label, saved pages, current state and actual error. Reuse this request after an interrupted response.', { operationId: operation }, ['operationId'], read),
    call('inputs', 'List host-pinned exact source ZIP and customer packet inputs.', {}, [], read),
    call('input_inspect', 'Hash-read an original configured input without changing the workspace.', { input: alias }, ['input'], read),
    call('import', 'Import an exact source ZIP or independently reconstruct the selected customer packet with the original SF30 engine.', { input: alias, expectedSha256: sha }, ['input','expectedSha256'], { idempotent: true }),
    call('source', 'Inspect original system/datastream metadata, complete observation schema, units, quality/nil definitions, exact coverage and repeated/conflicting observation IDs.', { sourceId: sha }, ['sourceId'], read),
    call('source_files', 'List every exact source member and its original byte/hash/HTTP receipt identity.', { sourceId: sha }, ['sourceId'], read),
    call('source_rows', 'Page original observations. JSON number tokens remain strings in this view; exact raw response bytes and numeric kinds remain available.', { sourceId: sha, offset, limit }, ['sourceId'], read),
    call('mapping_propose', 'Propose a lexical native projection retaining complete observations, missing/null distinctions and declared schema identity. Review coverage and types before saving.', { sourceId: sha, name: { type: 'string', minLength: 1, maxLength: 80 } }, ['sourceId'], read),
    call('mapping_save', 'Save the full reviewed native mapping with source/schema binding, explicit JSON-cell/type/null choices, edition keys and require-exhausted or allow-partial coverage.', { mapping: object }, ['mapping'], { idempotent: true }),
    call('mapping', 'Read one exact retained mapping before build or recovery.', { id: sha }, ['id'], read),
    call('build', 'Build the original native CSV/config/snapshot from the exact source and reviewed mapping.', { sourceId: sha, planId: sha }, ['sourceId','planId'], { idempotent: true }),
    call('build_read', 'Read a complete original native build, dataset file identities and snapshot.', { buildId: sha }, ['buildId'], read),
    call('native_query', 'Query the original SF30 dataset engine with exact scalar string parameters, retaining its real snapshot and cursor.', { buildId: sha, params: object }, ['buildId'], read),
    call('compare', 'Compare complete retained editions through the original engine using the reviewed mapping and explicit keys.', { beforeId: sha, afterId: sha }, ['beforeId','afterId'], { idempotent: true }),
    call('changes', 'Page all original added, removed, changed and unchanged comparison results.', { comparisonId: sha, offset, limit }, ['comparisonId'], read),
    call('file_read', 'Receive complete exact response bodies, source members, comparison JSONL, native seller dataset ZIPs or customer packets through the maintained retained-file reader. Continue with its SHA256, read ID and offsets.', { ...fileFields, expectedSha256: sha, readId: { type: 'string', minLength: 1, maxLength: 128 }, offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['kind'], read),
    call('file_release', 'Close this temporary file reader while retaining the original source, response or export.', { readId: { type: 'string', minLength: 1, maxLength: 128 } }, ['readId'], read),
    call('disconnect', 'Drain only this borrowed MCP client and its file readers; the original operator and native workspace stay with their owner.', {}, [], read)
  ];
}
